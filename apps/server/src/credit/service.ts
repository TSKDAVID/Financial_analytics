import { monthlyPayment, todayISO } from '@fa/core';
import type { DB } from '../schema';
import { materialize, nextDueDate } from '../services';
import { extractLines } from '../statements/pdf';
import { aiConfig } from '../statements/ai';
import { parseCreditReport, type CreditContract, type CreditReport } from './parse';

export function migrateCredit(db: DB) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS credit_reports (
    id INTEGER PRIMARY KEY, filename TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'staged' CHECK (status IN ('staged','approved','partial','reverted','discarded')),
    score INTEGER, rating TEXT, default_probability REAL, report_date TEXT, summary TEXT NOT NULL DEFAULT '{}', warnings TEXT NOT NULL DEFAULT '[]', ai_note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), approved_at TEXT, reverted_at TEXT);
  CREATE TABLE IF NOT EXISTS credit_contracts (
    id INTEGER PRIMARY KEY, report_id INTEGER NOT NULL REFERENCES credit_reports(id) ON DELETE CASCADE, idx INTEGER NOT NULL,
    external_id TEXT, creditor TEXT, type TEXT NOT NULL, active INTEGER NOT NULL, data TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('create','update','unchanged','close','history')), match_loan_id INTEGER,
    proposed TEXT NOT NULL DEFAULT '{}', diff TEXT NOT NULL DEFAULT '[]', excluded INTEGER NOT NULL DEFAULT 0,
    applied_loan_id INTEGER, before TEXT);
  CREATE INDEX IF NOT EXISTS credit_contracts_report ON credit_contracts(report_id);`);
  const cols = (db.prepare('PRAGMA table_info(loans)').all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes('external_id')) db.exec('ALTER TABLE loans ADD COLUMN external_id TEXT');
  if (!cols.includes('import_report_id')) db.exec('ALTER TABLE loans ADD COLUMN import_report_id INTEGER');
  if (!cols.includes('kind')) db.exec("ALTER TABLE loans ADD COLUMN kind TEXT NOT NULL DEFAULT 'loan'");
}

/** Annual rate (%) that makes the annuity payment equal `payment` (bisection). */
export function estimateRate(principal: number, termMonths: number, payment: number): number | null {
  if (!(principal > 0 && termMonths > 0 && payment > 0)) return null;
  if (payment * termMonths <= principal * 1.0001) return 0;
  let lo = 0, hi = 200;
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (monthlyPayment(principal, mid, termMonths) > payment) hi = mid; else lo = mid; }
  return Math.round(((lo + hi) / 2) * 100) / 100;
}

const REVOLVING = new Set(['credit_card', 'overdraft']);
const TYPE_NAME: Record<string, string> = { loan: 'Loan', credit_card: 'Credit card', overdraft: 'Overdraft', installment: 'Installment', mortgage: 'Mortgage', other: 'Credit' };
export interface LoanFields { name: string; bank: string; principal: number; currency: string; annual_rate: number; term_months: number; start_date: string; extra_monthly: number; notes: string; kind: string; active: number;
  monthly_payment: number | null; credit_limit: number | null; due_day: number | null; needs_input: number; balance_date: string | null }

const monthsBetween = (a: string, b: string) => { const [y1, m1, d1] = a.split('-').map(Number); const [y2, m2, d2] = b.split('-').map(Number); return (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0); };

export function proposeLoan(c: CreditContract, reportDate: string | null): LoanFields {
  const tail = c.externalId ? ` …${c.externalId.slice(-4)}` : '';
  const asOf = (reportDate ?? todayISO()).slice(0, 10);
  const pay = c.monthlyPayment && c.monthlyPayment > 0 ? c.monthlyPayment : null;
  if (REVOLVING.has(c.type)) {
    // revolving line: current balance, limit and (only if reported) the payment; no term. Missing payment → "needs your input".
    const balance = Math.max(0, c.balance ?? c.principalDue ?? 0);
    const limit = c.undrawn != null ? Math.round((balance + c.undrawn) * 100) / 100 : c.originalAmount ?? null;
    const due = c.nextPaymentDate && c.nextPaymentDate > asOf ? c.nextPaymentDate : null;
    const dueDay = due ? Number(due.slice(8, 10)) : null;
    // a real contractual end date (cards often carry a decades-long "until revoked" date — ignore those) gives the payoff term
    const left = c.endDate ? monthsBetween(asOf, c.endDate) : 0;
    const term = !pay && left >= 1 && left <= 120 ? left : 0;
    return { name: `${TYPE_NAME[c.type]}${tail}`, bank: c.creditor ?? 'Unknown', principal: balance, currency: c.currency,
      annual_rate: c.interestRate ?? 0, term_months: term, start_date: due ?? nextDueDate(asOf, dueDay ?? 15), extra_monthly: 0, kind: c.type, active: c.active ? 1 : 0,
      monthly_payment: pay, credit_limit: limit, due_day: dueDay, needs_input: pay || term ? 0 : 1, balance_date: asOf,
      notes: `Imported from Creditinfo · revolving line${pay ? '' : term ? ` · no payment in the report — spread over the ${term} months left until the contract end date; adjust if your plan differs` : ' · the report has no monthly payment — enter yours'}${c.interestRate == null ? ' · interest rate not in the report' : ''}` };
  }
  const term = c.installmentsTotal && c.termMonths && Math.abs(c.installmentsTotal - c.termMonths) <= 2 ? c.installmentsTotal : c.termMonths ?? c.installmentsTotal ?? 12;
  const principal = c.originalAmount ?? c.balance ?? 0;
  const est = c.interestRate ?? (pay ? estimateRate(principal, term, pay) : null);
  return { name: `${TYPE_NAME[c.type]}${tail}`, bank: c.creditor ?? 'Unknown', principal, currency: c.currency, annual_rate: est ?? 0, term_months: term, start_date: c.startDate ?? todayISO(),
    extra_monthly: 0, kind: c.type, active: c.active ? 1 : 0, monthly_payment: pay, credit_limit: null, due_day: null, needs_input: pay || c.interestRate != null ? 0 : 1, balance_date: null,
    notes: `Imported from Creditinfo${c.interestRate == null && pay ? ` · rate estimated from the ${pay} ${c.currency} monthly payment` : ''}${!pay && c.interestRate == null ? ' · no payment or rate in the report — enter your monthly payment' : ''}${c.restructured ? ' · restructured' : ''}` };
}

const DIFF_KEYS: (keyof LoanFields)[] = ['bank', 'principal', 'currency', 'annual_rate', 'term_months', 'start_date', 'monthly_payment', 'credit_limit', 'active'];
function findMatch(db: DB, c: CreditContract, p: LoanFields): any | undefined {
  if (c.externalId) { const m = db.prepare('SELECT * FROM loans WHERE external_id = ?').get(c.externalId); if (m) return m; }
  return db.prepare('SELECT * FROM loans WHERE external_id IS NULL AND bank = ? AND currency = ? AND ABS(principal - ?) < 1 AND ABS(julianday(start_date) - julianday(?)) <= 5 LIMIT 1').get(p.bank, p.currency, p.principal, p.start_date);
}
function diffOf(existing: any, p: LoanFields) {
  return DIFF_KEYS.filter((k) => !(p[k] == null && (k === 'monthly_payment' || k === 'credit_limit'))).filter((k) => (typeof p[k] === 'number' ? Math.abs(Number(existing[k]) - Number(p[k])) > 0.005 : String(existing[k] ?? '') !== String(p[k] ?? '')))
    .map((k) => ({ field: k, from: existing[k], to: p[k] }));
}

export function stageReport(db: DB, filename: string, r: CreditReport): number {
  const s = r.summary;
  const id = Number(db.prepare('INSERT INTO credit_reports (filename, score, rating, default_probability, report_date, summary, warnings) VALUES (?,?,?,?,?,?,?)')
    .run(filename, s.score, s.rating, s.defaultProbability, s.reportDate, JSON.stringify(s), JSON.stringify(r.warnings)).lastInsertRowid);
  const ins = db.prepare('INSERT INTO credit_contracts (report_id, idx, external_id, creditor, type, active, data, action, match_loan_id, proposed, diff, excluded) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  db.transaction(() => r.contracts.forEach((c, i) => {
    const p = proposeLoan(c, s.reportDate); const m = findMatch(db, c, p);
    let action: string; let diff: unknown[] = [];
    if (m) { diff = diffOf(m, p); action = !c.active ? (m.active ? 'close' : 'unchanged') : diff.length ? 'update' : 'unchanged'; }
    else action = c.active ? 'create' : 'history';
    const { raw: _raw, ...data } = c; void _raw;
    ins.run(id, i, c.externalId, c.creditor, c.type, c.active ? 1 : 0, JSON.stringify(data), action, m?.id ?? null, JSON.stringify(p), JSON.stringify(diff), action === 'unchanged' || action === 'history' ? 1 : 0);
  }))();
  return id;
}

/** Local-model fallback for contract fields the rules could not read. Sends only that contract's text block (no personal section). */
async function aiFill(db: DB, report: CreditReport): Promise<string | null> {
  const cfg = aiConfig(db);
  const todo = report.contracts.filter((c) => c.active && c.missing.length);
  if (!todo.length || !cfg.enabled) return null;
  if (cfg.provider === 'groq') return 'Some fields could not be read; AI fallback skipped because only local models are used for credit reports.';
  let filled = 0;
  for (const c of todo) {
    const schema = { type: 'object', properties: { creditor: { type: ['string', 'null'] }, originalAmount: { type: ['number', 'null'] }, startDate: { type: ['string', 'null'], description: 'YYYY-MM-DD' }, termMonths: { type: ['integer', 'null'] }, monthlyPayment: { type: ['number', 'null'] } }, required: ['creditor', 'originalAmount', 'startDate', 'termMonths', 'monthlyPayment'] };
    const text = c.raw.replace(/\b\d{11}\b/g, '***').slice(0, 6000);
    const messages = [{ role: 'system', content: 'Extract loan contract fields from this Georgian Creditinfo report section. Reply with JSON only; use null when unknown.' }, { role: 'user', content: text }];
    try {
      const body = cfg.provider === 'ollama' ? { model: cfg.model, messages, stream: false, format: schema, options: { temperature: 0 } } : { model: cfg.model, messages, temperature: 0, response_format: { type: 'json_schema', json_schema: { name: 'contract', schema } } };
      const url = cfg.provider === 'ollama' ? `${cfg.baseUrl}/api/chat` : `${cfg.baseUrl}/chat/completions`;
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(cfg.timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j: any = await res.json(); const out = JSON.parse((cfg.provider === 'ollama' ? j.message?.content : j.choices?.[0]?.message?.content) ?? '{}');
      for (const k of c.missing as (keyof CreditContract)[]) if (out[k] != null) { (c as any)[k] = out[k]; filled++; }
      c.missing = c.missing.filter((k) => (c as any)[k] == null);
    } catch (e: any) { return `AI unavailable for missing fields (${String(e?.message ?? e).slice(0, 100)}); please fill them in manually.`; }
  }
  return filled ? `Local AI filled ${filled} missing field(s) — please double-check them.` : null;
}

export async function importCreditPdf(db: DB, filename: string, data: Uint8Array) {
  const report = parseCreditReport(await extractLines(data));
  const note = await aiFill(db, report).catch(() => null);
  const id = stageReport(db, filename, report);
  if (note) db.prepare('UPDATE credit_reports SET ai_note = ? WHERE id = ?').run(note, id);
  return id;
}

export function updateContract(db: DB, id: number, patch: { excluded?: boolean; proposed?: Partial<LoanFields> }) {
  const c = db.prepare('SELECT * FROM credit_contracts WHERE id = ?').get(id) as any;
  if (!c) throw Object.assign(new Error('Contract not found'), { statusCode: 404 });
  if (c.applied_loan_id) throw Object.assign(new Error('Already approved — revert the report to edit'), { statusCode: 400 });
  if (patch.excluded !== undefined) db.prepare('UPDATE credit_contracts SET excluded = ? WHERE id = ?').run(patch.excluded ? 1 : 0, id);
  if (patch.proposed) {
    const p = { ...JSON.parse(c.proposed), ...patch.proposed };
    if (p.monthly_payment > 0 || p.term_months > 0 || (!REVOLVING.has(p.kind) && p.annual_rate > 0)) p.needs_input = 0;
    else if (REVOLVING.has(p.kind)) p.needs_input = 1;
    const diff = c.match_loan_id ? diffOf(db.prepare('SELECT * FROM loans WHERE id = ?').get(c.match_loan_id), p) : [];
    db.prepare('UPDATE credit_contracts SET proposed = ?, diff = ? WHERE id = ?').run(JSON.stringify(p), JSON.stringify(diff), id);
  }
  return db.prepare('SELECT * FROM credit_contracts WHERE id = ?').get(id);
}

function setStatus(db: DB, reportId: number) {
  const s = db.prepare("SELECT SUM(applied_loan_id IS NOT NULL) AS done, SUM(excluded = 0 AND action IN ('create','update','close')) AS want FROM credit_contracts WHERE report_id = ?").get(reportId) as { done: number; want: number };
  const status = !s.done ? 'reverted' : s.done < s.want ? 'partial' : 'approved';
  db.prepare("UPDATE credit_reports SET status = ?, approved_at = datetime('now') WHERE id = ?").run(status, reportId);
  return status;
}

/** Create / update / close loans for the selected (or all included) contracts. Loan bills (recurring payments) are regenerated. */
export async function approveReport(db: DB, reportId: number, ids?: number[]) {
  const r = db.prepare('SELECT * FROM credit_reports WHERE id = ?').get(reportId) as any;
  if (!r) throw Object.assign(new Error('Report not found'), { statusCode: 404 });
  if (r.status === 'discarded') throw Object.assign(new Error('This report was discarded'), { statusCode: 400 });
  let rows = db.prepare("SELECT * FROM credit_contracts WHERE report_id = ? AND excluded = 0 AND applied_loan_id IS NULL AND action IN ('create','update','close') ORDER BY idx").all(reportId) as any[];
  if (ids?.length) { const s = new Set(ids); rows = rows.filter((x) => s.has(x.id)); }
  let n = 0;
  db.transaction(() => {
    for (const c of rows) {
      const p: LoanFields = JSON.parse(c.proposed);
      if (c.action === 'create') {
        const lid = Number(db.prepare('INSERT INTO loans (name, bank, principal, currency, annual_rate, term_months, start_date, extra_monthly, notes, active, external_id, import_report_id, kind, monthly_payment, credit_limit, due_day, needs_input, balance_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(p.name, p.bank, p.principal, p.currency, p.annual_rate, p.term_months, p.start_date, p.extra_monthly, p.notes, p.active, c.external_id, reportId, p.kind, p.monthly_payment ?? null, p.credit_limit ?? null, p.due_day ?? null, p.needs_input ?? 0, p.balance_date ?? null).lastInsertRowid);
        db.prepare('UPDATE credit_contracts SET applied_loan_id = ? WHERE id = ?').run(lid, c.id);
      } else {
        const before = db.prepare('SELECT * FROM loans WHERE id = ?').get(c.match_loan_id) as any;
        if (!before) continue;
        if (c.action === 'close') db.prepare('UPDATE loans SET active = 0 WHERE id = ?').run(before.id);
        // a payment the user entered by hand is kept when the report has none
        else db.prepare(`UPDATE loans SET bank = ?, principal = ?, currency = ?, annual_rate = ?, term_months = ?, start_date = ?, active = ?, external_id = COALESCE(external_id, ?),
            monthly_payment = COALESCE(?, monthly_payment), credit_limit = COALESCE(?, credit_limit), due_day = COALESCE(?, due_day), balance_date = COALESCE(?, balance_date), kind = ?,
            needs_input = CASE WHEN COALESCE(?, monthly_payment, payment_pct) IS NULL THEN ? ELSE 0 END WHERE id = ?`)
          .run(p.bank, p.principal, p.currency, p.annual_rate, p.term_months, p.start_date, p.active, c.external_id, p.monthly_payment ?? null, p.credit_limit ?? null, p.due_day ?? null, p.balance_date ?? null, p.kind, p.monthly_payment ?? null, p.needs_input ?? 0, before.id);
        db.prepare('DELETE FROM bills WHERE loan_id = ? AND paid = 0').run(before.id);
        db.prepare('UPDATE credit_contracts SET applied_loan_id = ?, before = ? WHERE id = ?').run(before.id, JSON.stringify(before), c.id);
      }
      n++;
    }
  })();
  await materialize(db);
  return { approved: n, status: setStatus(db, reportId) };
}

/** Undo exactly what this report changed: delete loans it created, restore loans it updated/closed. */
export async function revertReport(db: DB, reportId: number) {
  const rows = db.prepare('SELECT * FROM credit_contracts WHERE report_id = ? AND applied_loan_id IS NOT NULL').all(reportId) as any[];
  db.transaction(() => {
    for (const c of rows) {
      if (c.action === 'create') { db.prepare('DELETE FROM bills WHERE loan_id = ? AND paid = 0').run(c.applied_loan_id); db.prepare('UPDATE bills SET loan_id = NULL WHERE loan_id = ?').run(c.applied_loan_id); db.prepare('DELETE FROM loans WHERE id = ?').run(c.applied_loan_id); }
      else if (c.before) {
        const b = JSON.parse(c.before);
        db.prepare('UPDATE loans SET bank = ?, principal = ?, currency = ?, annual_rate = ?, term_months = ?, start_date = ?, active = ?, external_id = ?, monthly_payment = ?, credit_limit = ?, due_day = ?, needs_input = ?, balance_date = ?, kind = ? WHERE id = ?')
          .run(b.bank, b.principal, b.currency, b.annual_rate, b.term_months, b.start_date, b.active, b.external_id, b.monthly_payment ?? null, b.credit_limit ?? null, b.due_day ?? null, b.needs_input ?? 0, b.balance_date ?? null, b.kind ?? 'loan', b.id);
        db.prepare('DELETE FROM bills WHERE loan_id = ? AND paid = 0').run(b.id);
      }
    }
    db.prepare('UPDATE credit_contracts SET applied_loan_id = NULL, before = NULL WHERE report_id = ?').run(reportId);
    db.prepare("UPDATE credit_reports SET status = 'reverted', reverted_at = datetime('now') WHERE id = ?").run(reportId);
  })();
  await materialize(db);
  return { reverted: rows.length };
}

export function latestCredit(db: DB) {
  const r = (db.prepare("SELECT * FROM credit_reports WHERE status IN ('approved','partial') ORDER BY COALESCE(report_date, created_at) DESC, id DESC LIMIT 1").get()
    ?? db.prepare("SELECT * FROM credit_reports WHERE status != 'discarded' ORDER BY id DESC LIMIT 1").get()) as any;
  if (!r) return null;
  const history = db.prepare("SELECT report_date, score, rating FROM credit_reports WHERE status != 'discarded' AND score IS NOT NULL ORDER BY report_date").all();
  const active = (db.prepare('SELECT data FROM credit_contracts WHERE report_id = ? AND active = 1').all(r.id) as { data: string }[]).map((x) => JSON.parse(x.data));
  return { id: r.id, status: r.status, score: r.score, rating: r.rating, defaultProbability: r.default_probability, reportDate: r.report_date, summary: JSON.parse(r.summary), history,
    activeTotals: { count: active.length, balance: Math.round(active.reduce((s, c) => s + (c.balance ?? 0), 0) * 100) / 100, monthly: Math.round(active.reduce((s, c) => s + (c.monthlyPayment ?? 0), 0) * 100) / 100, penalties: Math.round(active.reduce((s, c) => s + (c.penalty ?? 0), 0) * 100) / 100 } };
}
