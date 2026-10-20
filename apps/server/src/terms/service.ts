import type { DB } from '../schema';
import { extractLines } from '../statements/pdf';
import { parseCardTerms, type CardTerms } from './parse';
import { materialize } from '../services';

/** Staged key-terms imports: parse → review (choose which payment you make) → approve into the loan → undo. */
export function migrateTerms(db: DB) {
  db.exec(`CREATE TABLE IF NOT EXISTS loan_terms (
    id INTEGER PRIMARY KEY, loan_id INTEGER REFERENCES loans(id) ON DELETE CASCADE, filename TEXT NOT NULL, terms TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'staged', pay_mode TEXT, before TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), applied_at TEXT)`);
  const cols = (db.prepare('PRAGMA table_info(loans)').all() as { name: string }[]).map((c) => c.name);
  const add = (c: string, def: string) => { if (!cols.includes(c)) db.exec(`ALTER TABLE loans ADD COLUMN ${c} ${def}`); };
  add('rate_alt', 'REAL'); add('pay_mode', 'TEXT'); add('terms', 'TEXT');
}
type Mode = 'recommended' | 'minimum';
const FIELDS = ['credit_limit', 'annual_rate', 'rate_alt', 'pay_mode', 'min_payment', 'monthly_payment', 'payment_pct', 'term_months', 'needs_input', 'terms', 'kind'] as const;

export function proposal(loan: any, t: CardTerms, mode: Mode) {
  const rate = mode === 'minimum' ? t.rateMinimum : t.rateRecommended;
  const next: Record<string, unknown> = {
    kind: ['credit_card', 'overdraft', 'credit_line'].includes(loan.kind) ? loan.kind : 'credit_card',
    credit_limit: t.creditLimit ?? loan.credit_limit ?? null,
    annual_rate: rate ?? loan.annual_rate,
    rate_alt: mode === 'minimum' ? t.rateRecommended : t.rateMinimum,
    pay_mode: mode, min_payment: t.minPayment ?? loan.min_payment ?? null,
    terms: JSON.stringify({ ...t, warnings: undefined }),
  };
  if (mode === 'minimum' && t.minPayment) { next.monthly_payment = t.minPayment; next.payment_pct = null; next.needs_input = 0; }
  const diff = Object.entries(next).filter(([k, v]) => k !== 'terms' && String(loan[k] ?? '') !== String(v ?? '')).map(([field, to]) => ({ field, from: loan[field] ?? null, to }));
  return { next, diff };
}

export async function importTerms(db: DB, loanId: number, filename: string, data: Uint8Array) {
  const loan = db.prepare('SELECT * FROM loans WHERE id = ?').get(loanId);
  if (!loan) throw Object.assign(new Error('Loan not found'), { statusCode: 404 });
  const t = parseCardTerms(await extractLines(data));
  const id = Number(db.prepare('INSERT INTO loan_terms (loan_id, filename, terms) VALUES (?,?,?)').run(loanId, filename, JSON.stringify(t)).lastInsertRowid);
  return getTerms(db, id);
}
export function getTerms(db: DB, id: number, mode?: Mode) {
  const r = db.prepare('SELECT * FROM loan_terms WHERE id = ?').get(id) as any;
  if (!r) throw Object.assign(new Error('Not found'), { statusCode: 404 });
  const loan = db.prepare('SELECT * FROM loans WHERE id = ?').get(r.loan_id) as any;
  const terms: CardTerms = JSON.parse(r.terms);
  const m: Mode = mode ?? r.pay_mode ?? loan?.pay_mode ?? 'recommended';
  return { ...r, terms, mode: m, ...(loan ? proposal(loan, terms, m) : { next: {}, diff: [] }) };
}
export async function approveTerms(db: DB, id: number, mode: Mode) {
  const r = getTerms(db, id, mode);
  if (r.status !== 'staged') throw Object.assign(new Error(`Already ${r.status}`), { statusCode: 400 });
  const loan = db.prepare('SELECT * FROM loans WHERE id = ?').get(r.loan_id) as any;
  const before = Object.fromEntries(FIELDS.map((k) => [k, loan[k] ?? null]));
  const sets = Object.keys(r.next);
  db.transaction(() => {
    db.prepare(`UPDATE loans SET ${sets.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...r.next, id: loan.id });
    db.prepare("UPDATE loan_terms SET status = 'applied', pay_mode = ?, before = ?, applied_at = datetime('now') WHERE id = ?").run(mode, JSON.stringify(before), id);
    db.prepare('DELETE FROM bills WHERE loan_id = ? AND paid = 0').run(loan.id);
  })();
  await materialize(db);
  return getTerms(db, id);
}
export async function revertTerms(db: DB, id: number) {
  const r = db.prepare('SELECT * FROM loan_terms WHERE id = ?').get(id) as any;
  if (!r || r.status !== 'applied') throw Object.assign(new Error('Nothing to revert'), { statusCode: 400 });
  const b = JSON.parse(r.before);
  db.transaction(() => {
    db.prepare(`UPDATE loans SET ${FIELDS.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...b, id: r.loan_id });
    db.prepare("UPDATE loan_terms SET status = 'reverted' WHERE id = ?").run(id);
    db.prepare('DELETE FROM bills WHERE loan_id = ? AND paid = 0').run(r.loan_id);
  })();
  await materialize(db);
  return { ok: true };
}
/** Switch which payment you make on a dual-rate card (rate swaps with the alternative). */
export async function switchPayMode(db: DB, loanId: number, mode: Mode) {
  const l = db.prepare('SELECT * FROM loans WHERE id = ?').get(loanId) as any;
  if (!l?.terms) throw Object.assign(new Error('Import the card terms first'), { statusCode: 400 });
  const t: CardTerms = JSON.parse(l.terms);
  const { next } = proposal(l, t, mode);
  if (mode === 'recommended' && l.pay_mode === 'minimum' && l.monthly_payment === t.minPayment) next.monthly_payment = null; // recommended amount varies — user sets it
  db.prepare(`UPDATE loans SET ${Object.keys(next).map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...next, id: loanId });
  db.prepare("UPDATE loans SET needs_input = CASE WHEN monthly_payment IS NULL AND payment_pct IS NULL AND term_months = 0 THEN 1 ELSE 0 END WHERE id = ?").run(loanId);
  db.prepare('DELETE FROM bills WHERE loan_id = ? AND paid = 0').run(loanId);
  await materialize(db);
}
