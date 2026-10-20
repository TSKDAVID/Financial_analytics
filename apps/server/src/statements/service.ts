import { guessAccountForBank } from '../cashflow';
import { reconcileRecurring, restoreReconciled } from '../reconcile';
import { normalizePattern } from '@fa/core';
import { transactionDate } from './parse';
import { classify, isNonPL, kindDirection, detectRecurring, addDays, matchTransfers, ibanBank, destinationBank, groupPeople, type TxKind, type Leg, type MatchOpts } from '@fa/core';
import { getSetting, setSetting } from '../schema';
import type { DB } from '../schema';
import { insertTransaction } from '../services';
import { latestRates } from '../rates';
import { extractLines } from './pdf';
import { parseStatement, type ParseResult } from './parse';
import { aiCategorize, aiConfig, type AiChoice } from './ai';

export function migrateImports(db: DB) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS import_batches (
    id INTEGER PRIMARY KEY, filename TEXT NOT NULL, bank TEXT, currency TEXT NOT NULL DEFAULT 'GEL', account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'staged' CHECK (status IN ('staged','approved','partial','reverted','discarded')),
    period_from TEXT, period_to TEXT, row_count INTEGER NOT NULL DEFAULT 0, warnings TEXT NOT NULL DEFAULT '[]', ai_note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), approved_at TEXT, reverted_at TEXT);
  CREATE TABLE IF NOT EXISTS import_rows (
    id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE, idx INTEGER NOT NULL,
    date TEXT NOT NULL, description TEXT NOT NULL, merchant TEXT NOT NULL DEFAULT '', amount REAL NOT NULL, currency TEXT NOT NULL, kind TEXT NOT NULL,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL, confidence REAL NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'none',
    subscription INTEGER NOT NULL DEFAULT 0, account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL, excluded INTEGER NOT NULL DEFAULT 0,
    duplicate_of INTEGER, transaction_id INTEGER, raw TEXT);
  CREATE INDEX IF NOT EXISTS import_rows_batch ON import_rows(batch_id);
  CREATE TABLE IF NOT EXISTS merchant_rules (merchant TEXT PRIMARY KEY, category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE, hits INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  -- v1.5: user corrections keyed by normalised merchant / person, with the kind as well as the category
  CREATE TABLE IF NOT EXISTS learned_rules (merchant_key TEXT PRIMARY KEY, label TEXT, tx_kind TEXT, category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL, hits INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS ai_cache (merchant_key TEXT PRIMARY KEY, tx_kind TEXT, category_key TEXT, confidence REAL, model TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  -- proposed / confirmed / rejected pairs of transfer legs (import rows or existing transactions)
  CREATE TABLE IF NOT EXISTS import_matches (
    id INTEGER PRIMARY KEY, out_row_id INTEGER REFERENCES import_rows(id) ON DELETE CASCADE, in_row_id INTEGER REFERENCES import_rows(id) ON DELETE CASCADE,
    out_tx_id INTEGER, in_tx_id INTEGER, score REAL NOT NULL, fee REAL NOT NULL DEFAULT 0, fee_currency TEXT, reasons TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','confirmed','rejected')), fee_tx_id INTEGER, prev TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS people_overrides (person_key TEXT PRIMARY KEY, pattern TEXT, hidden INTEGER NOT NULL DEFAULT 0);`);
  const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
  const add = (t: string, c: string, def: string) => { if (!cols(t).includes(c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`); };
  add('transactions', 'import_batch_id', 'INTEGER');
  for (const [c, d] of [['tx_kind', 'TEXT'], ['why', 'TEXT'], ['mcc', 'TEXT'], ['op_type', 'TEXT'], ['card', 'TEXT'], ['counterparty', 'TEXT'], ['counterparty_account', 'TEXT'],
    ['merchant_key', "TEXT NOT NULL DEFAULT ''"], ['time', 'TEXT'], ['own', 'INTEGER NOT NULL DEFAULT 0'], ['person', 'INTEGER NOT NULL DEFAULT 0']]) add('import_rows', c, d);
  for (const [c, d] of [['holder', 'TEXT'], ['account_iban', 'TEXT'], ['format', 'TEXT'], ['verification', 'TEXT']]) add('import_batches', c, d);
  for (const [c, d] of [['tx_kind', 'TEXT'], ['counterparty', 'TEXT'], ['moved_from', 'TEXT']]) add('transactions', c, d);
  db.exec('CREATE INDEX IF NOT EXISTS import_rows_mkey ON import_rows(merchant_key)');
}

const keyMaps = (db: DB) => {
  const cats = db.prepare('SELECT id, key, name, kind, parent_id FROM categories WHERE archived = 0').all() as { id: number; key: string | null; name: string; kind: string; parent_id: number | null }[];
  return { cats, keyToId: new Map(cats.filter((c) => c.key).map((c) => [c.key!, c.id])), idToKey: new Map(cats.map((c) => [c.id, c.key ?? `c${c.id}`])) };
};
/** User-learned rules: merchant key → kind and/or category key. */
export function learnedMap(db: DB) {
  const { idToKey } = keyMaps(db);
  const m = new Map<string, { kind?: TxKind | null; category?: string | null }>();
  for (const r of db.prepare('SELECT merchant_key, tx_kind, category_id FROM learned_rules').all() as any[]) m.set(r.merchant_key, { kind: r.tx_kind, category: r.category_id ? idToKey.get(r.category_id) ?? null : null });
  return m;
}
/** Your own names and accounts, from every statement imported so far plus the optional "ownerNames" setting. */
export function ownContext(db: DB, extra: { holder?: string; holderLatin?: string; account?: string } = {}) {
  const b = db.prepare('SELECT holder, account_iban FROM import_batches').all() as { holder: string | null; account_iban: string | null }[];
  const names = new Set<string>(); const accounts = new Set<string>();
  for (const x of [...b.flatMap((r) => (r.holder ?? '').split('|')), extra.holder, extra.holderLatin, ...(getSetting(db, 'ownerNames') ?? '').split(/[,;\n]/)]) if (x && x.trim()) names.add(x.trim());
  for (const x of [...b.map((r) => r.account_iban), extra.account]) if (x) accounts.add(x);
  return { ownerNames: [...names], ownAccounts: accounts };
}
/** Signed classification → the row's income/expense category id (transfer kinds get none). */
function categoryIdFor(c: { kind: TxKind; category: string | null }, dir: 'income' | 'expense', cats: { id: number; key: string | null; kind: string }[]) {
  if (isNonPL(c.kind) || !c.category) return null;
  const hit = cats.find((x) => x.key === c.category && x.kind === dir);
  if (hit) return hit.id;
  const fallback = dir === 'income' ? (c.kind === 'transfer_in' ? 'p2p_in' : 'other_income') : null;
  return fallback ? cats.find((x) => x.key === fallback)?.id ?? null : null;
}

/** Mark rows that already exist as transactions (same kind, amount, currency, date ±1 day). */
export function detectDuplicates(db: DB, batchId: number) {
  const rows = db.prepare('SELECT * FROM import_rows WHERE batch_id = ? AND transaction_id IS NULL').all(batchId) as any[];
  const q = db.prepare("SELECT id FROM transactions WHERE kind = ? AND ABS(amount - ?) < 0.005 AND currency = ? AND date BETWEEN ? AND ? AND (import_batch_id IS NULL OR import_batch_id != ?) LIMIT 1");
  const upd = db.prepare('UPDATE import_rows SET duplicate_of = ?, excluded = CASE WHEN ? IS NOT NULL THEN 1 ELSE excluded END WHERE id = ?');
  let n = 0;
  for (const r of rows) { const d = q.get(r.kind, r.amount, r.currency, addDays(r.date, -1), addDays(r.date, 1), batchId) as { id: number } | undefined; upd.run(d?.id ?? null, d?.id ?? null, r.id); if (d) n++; }
  return n;
}

export function stageParsed(db: DB, filename: string, parsed: ParseResult, accountId: number | null): number {
  const { cats } = keyMaps(db); const learned = learnedMap(db);
  const ctx = { ...ownContext(db, parsed), learned };
  const holder = [parsed.holder, parsed.holderLatin].filter(Boolean).join('|') || null;
  const batchId = Number(db.prepare('INSERT INTO import_batches (filename, bank, currency, account_id, period_from, period_to, row_count, warnings, holder, account_iban, format, verification) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(filename, parsed.bank, parsed.currency, accountId, parsed.periodFrom, parsed.periodTo, parsed.rows.length, JSON.stringify(parsed.warnings), holder, parsed.account ?? null, parsed.format ?? null,
      parsed.verification ? JSON.stringify({ totals: parsed.verification, dailyChecks: parsed.dailyChecks ?? 0, runningChecks: parsed.runningChecks ?? 0, mismatches: parsed.dailyMismatches ?? 0 }) : null).lastInsertRowid);
  const ins = db.prepare(`INSERT INTO import_rows (batch_id, idx, date, description, merchant, amount, currency, kind, category_id, confidence, source, subscription, account_id, raw,
    tx_kind, why, mcc, op_type, card, counterparty, counterparty_account, merchant_key, time, own, person) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const r of parsed.rows) { const d = transactionDate(r.raw ?? '', r.date); if (d !== r.date) { (r as any).booked = r.date; r.date = d; } }
  db.transaction(() => parsed.rows.forEach((r, i) => {
    const c = classify({ ...r, direction: r.kind }, ctx);
    ins.run(batchId, i, r.date, r.description, c.merchantName, r.amount, r.currency, r.kind, categoryIdFor(c, r.kind, cats), c.confidence, c.source, c.subscription ? 1 : 0, accountId, r.raw,
      c.kind, c.why, r.mcc ?? null, r.opType ?? null, r.card ?? null, r.counterparty ?? null, r.counterpartyAccount ?? null, c.merchantKey, r.time ?? null, c.own ? 1 : 0, c.counterpartyIsPerson ? 1 : 0);
  }))();
  for (const [i, r] of parsed.rows.entries()) if ((r as any).booked) db.prepare('UPDATE import_rows SET booked_date = ? WHERE batch_id = ? AND idx = ?').run((r as any).booked, batchId, i);
  detectDuplicates(db, batchId);
  rematch(db);
  return batchId;
}

export async function importPdf(db: DB, filename: string, data: Uint8Array, accountId: number | null, useAi = true) {
  const lines = await extractLines(data);
  const parsed = parseStatement(lines);
  const id = stageParsed(db, filename, parsed, accountId);
  if (useAi && aiConfig(db).enabled) await runAi(db, id);
  return id;
}


// ---------------- turning posted income/expense into "moving your own money" (reversible) ----------------
/** Re-post an existing transaction as a transfer, remembering the original so it can be restored. */
function asTransfer(db: DB, txId: number, reason: string) {
  const t = db.prepare('SELECT * FROM transactions WHERE id = ?').get(txId) as any;
  if (!t || t.kind === 'transfer') return false;
  const orig = JSON.stringify({ kind: t.kind, account_id: t.account_id, to_account_id: t.to_account_id, category_id: t.category_id, reason });
  // money in keeps landing on its account: a transfer INTO that account
  const [from, to] = t.kind === 'income' ? [null, t.account_id] : [t.account_id, null];
  db.prepare("UPDATE transactions SET kind = 'transfer', account_id = ?, to_account_id = ?, category_id = NULL, moved_from = ? WHERE id = ?").run(from, to, orig, txId);
  return true;
}
function restoreTx(db: DB, txId: number, reason?: string) {
  const t = db.prepare('SELECT moved_from FROM transactions WHERE id = ?').get(txId) as any;
  if (!t?.moved_from) return false;
  const o = JSON.parse(t.moved_from); if (reason && o.reason !== reason) return false;
  db.prepare('UPDATE transactions SET kind = ?, account_id = ?, to_account_id = ?, category_id = ?, moved_from = NULL WHERE id = ?').run(o.kind, o.account_id, o.to_account_id, o.category_id, txId);
  return true;
}
const legTx = (db: DB, rowId: number | null, txId: number | null) => txId ?? (rowId ? (db.prepare('SELECT transaction_id FROM import_rows WHERE id = ?').pluck().get(rowId) as number | null) : null);
/** A confirmed pair whose legs are both already real transactions: post both as transfers + the fee. */
async function applyPostedMatch(db: DB, m: any) {
  const o = legTx(db, m.out_row_id, m.out_tx_id), i = legTx(db, m.in_row_id, m.in_tx_id);
  if (!o || !i || o === i) return false;
  const a = asTransfer(db, o, `match:${m.id}`), b = asTransfer(db, i, `match:${m.id}`);
  if ((a || b) && m.fee > 0.004 && !m.fee_tx_id) {
    const t = db.prepare('SELECT * FROM transactions WHERE id = ?').get(o) as any;
    const fees = db.prepare("SELECT id FROM categories WHERE key = 'fees'").pluck().get() as number | undefined;
    const feeId = await insertTransaction(db, { kind: 'expense', amount: m.fee, currency: m.fee_currency ?? t.currency, date: t.date, account_id: JSON.parse(t.moved_from ?? '{}').account_id ?? t.account_id, category_id: fees ?? null, description: 'Transfer fee', tags: ['import', 'transfer-fee'] });
    db.prepare("UPDATE transactions SET import_batch_id = ?, tx_kind = 'fee' WHERE id = ?").run(t.import_batch_id, feeId);
    db.prepare('UPDATE import_matches SET fee_tx_id = ? WHERE id = ?').run(feeId, m.id);
  }
  return a || b;
}
function unapplyPostedMatch(db: DB, m: any) {
  for (const id of [legTx(db, m.out_row_id, m.out_tx_id), legTx(db, m.in_row_id, m.in_tx_id)]) if (id) restoreTx(db, id, `match:${m.id}`);
  if (m.fee_tx_id) { db.prepare('DELETE FROM transactions WHERE id = ?').run(m.fee_tx_id); db.prepare('UPDATE import_matches SET fee_tx_id = NULL WHERE id = ?').run(m.id); }
}

/**
 * Money that went to a friend and came back (or that you borrowed and repaid) is not income or spending.
 * Posted person-to-person transfers of two-way relationships are re-posted as transfers; one-way flows
 * (gifts, paying someone for something) and split costs stay as spending/income. Fully reversible.
 */
export function refreshPeopleNetting(db: DB) {
  const rows = db.prepare("SELECT id, date, amount_gel, currency, kind, counterparty, description, moved_from FROM transactions WHERE tx_kind IN ('transfer_out','transfer_in') AND counterparty IS NOT NULL AND (kind != 'transfer' OR moved_from LIKE '%\"reason\":\"people\"%')").all() as any[];
  const dirOf = (r: any) => (r.moved_from ? JSON.parse(r.moved_from).kind : r.kind) === 'income' ? 'in' : 'out';
  const groups = groupPeople(rows.map((r) => ({ ref: String(r.id), date: r.date, amount: r.amount_gel, amountGel: r.amount_gel, currency: 'GEL', dir: dirOf(r), counterparty: r.counterparty, text: r.description ?? '' })));
  const ov = new Map((db.prepare('SELECT person_key, pattern FROM people_overrides').all() as any[]).map((o) => [o.person_key, normalizePattern(o.pattern)]));
  const rentCat = db.prepare("SELECT id FROM categories WHERE key = 'rent'").pluck().get() as number | undefined;
  let moved = 0, restored = 0;
  db.transaction(() => {
    for (const g of groups) {
      const pattern = ov.get(g.key) ?? g.pattern;
      for (const it of g.items) {
        const id = Number(it.ref);
        const cur = db.prepare('SELECT moved_from FROM transactions WHERE id = ?').pluck().get(id) as string | null;
        const reason = cur ? JSON.parse(cur).reason : null;
        // settles: a flow, never P&L · rent: what you pay is rent spending · gift / income: stays spending / income
        const want = pattern === 'settles' ? 'people' : pattern === 'rent' && it.dir === 'out' && rentCat ? 'people-rent' : null;
        if (reason === want) continue;
        if (reason === 'people' || reason === 'people-rent') { restoreTx(db, id, reason); restored++; }
        if (want === 'people') { if (asTransfer(db, id, 'people')) moved++; }
        else if (want === 'people-rent') { const t = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as any;
          db.prepare('UPDATE transactions SET category_id = ?, moved_from = ? WHERE id = ?').run(rentCat, JSON.stringify({ kind: t.kind, account_id: t.account_id, to_account_id: t.to_account_id, category_id: t.category_id, reason: 'people-rent' }), id); moved++; }
      }
    }
  })();
  return { moved, restored };
}

/** v1.5 data fix: pairs between your banks that were approved as income + expense, and friends' loans counted as spending. */
export function migrateAnalyticsFix(db: DB) {
  if (getSetting(db, 'analyticsV15')) return;
  const before = periodTotals(db);
  let pairs = 0;
  for (const m of db.prepare("SELECT * FROM import_matches WHERE status = 'proposed' AND score >= ? ORDER BY score DESC").all(AUTO_CONFIRM) as any[]) {
    const o = legTx(db, m.out_row_id, m.out_tx_id), i = legTx(db, m.in_row_id, m.in_tx_id);
    if (!o || !i) continue;
    db.prepare("UPDATE import_matches SET status = 'confirmed' WHERE id = ?").run(m.id);
    applyPostedMatch(db, m).catch(() => undefined); pairs++;
  }
  // cash deposits were posted as transfers: money in, so income ("Other income")
  const oi = db.prepare("SELECT id FROM categories WHERE key = 'other_income'").pluck().get() as number | undefined;
  const cash = db.prepare("UPDATE transactions SET kind = 'income', category_id = ?, account_id = COALESCE(to_account_id, account_id), to_account_id = NULL WHERE kind = 'transfer' AND tx_kind = 'cash_deposit' AND moved_from IS NULL").run(oi ?? null).changes;
  db.prepare("UPDATE import_rows SET category_id = ? WHERE tx_kind = 'cash_deposit' AND category_id IS NULL").run(oi ?? null);
  // other incoming own-money moves were posted as leaving the account
  db.exec("UPDATE transactions SET to_account_id = account_id, account_id = NULL WHERE kind = 'transfer' AND to_account_id IS NULL AND account_id IS NOT NULL AND moved_from IS NULL AND id IN (SELECT transaction_id FROM import_rows WHERE kind = 'income' AND transaction_id IS NOT NULL)");
  const ppl = refreshPeopleNetting(db);
  setSetting(db, 'analyticsV15', '1');
  setSetting(db, 'analyticsFix', JSON.stringify({ at: new Date().toISOString(), transferPairs: pairs, peopleMoved: ppl.moved, cashDeposits: cash, before, after: periodTotals(db), seen: pairs + ppl.moved === 0 }));
}
const periodTotals = (db: DB) => db.prepare("SELECT ROUND(SUM(CASE WHEN kind='income' THEN amount_gel ELSE 0 END), 2) AS income, ROUND(SUM(CASE WHEN kind='expense' THEN amount_gel ELSE 0 END), 2) AS expense FROM transactions").get();
/** Suggested transfer pairs at or above this score are confirmed when you approve the import (you can still undo per pair). */
export const AUTO_CONFIRM = 0.9;

// ---------------- cross-statement transfer matching ----------------
const legOfRow = (r: any, bankOf: Map<number, string | null>): Leg => ({
  ref: `r${r.id}`, account: `b${r.batch_id}:${r.account_iban ?? r.account_id ?? r.batch_id}:${r.currency}`, bank: bankOf.get(r.batch_id) ?? null,
  toBank: r.kind === 'expense' ? destinationBank(r.merchant) : null, thirdParty: !!r.counterparty && !r.own && r.tx_kind !== 'internal' && r.person === 1,
  date: (r.time ?? r.date).slice(0, 10), time: r.time ?? undefined, amount: r.amount, currency: r.currency, dir: r.kind === 'income' ? 'in' : 'out',
  kind: r.tx_kind, counterparty: r.counterparty, counterpartyAccount: r.counterparty_account, own: !!r.own,
});
/**
 * Re-propose transfer pairs across every staged import and existing (non-imported or approved) transactions.
 * Confirmed and rejected decisions are kept; only open proposals are recomputed. Nothing is posted here.
 */
export function rematch(db: DB, opts: MatchOpts = {}) {
  const rows = db.prepare(`SELECT r.*, b.account_iban FROM import_rows r JOIN import_batches b ON b.id = r.batch_id WHERE b.status NOT IN ('discarded') AND r.excluded = 0 AND r.duplicate_of IS NULL`).all() as any[];
  const bankOf = new Map((db.prepare('SELECT id, account_iban FROM import_batches').all() as any[]).map((b) => [b.id, ibanBank(b.account_iban)]));
  const decided = db.prepare("SELECT * FROM import_matches WHERE status != 'proposed'").all() as any[];
  const busy = new Set<string>(); const rejected = new Set<string>();
  for (const m of decided) { const o = m.out_row_id ? `r${m.out_row_id}` : `t${m.out_tx_id}`, i = m.in_row_id ? `r${m.in_row_id}` : `t${m.in_tx_id}`; if (m.status === 'confirmed') { busy.add(o); busy.add(i); } else rejected.add(`${o}>${i}`); }
  const legs: Leg[] = rows.filter((r) => !r.transaction_id || true).map((r) => legOfRow(r, bankOf)).filter((l) => !busy.has(l.ref));
  // manual transactions not created by an import can be the other leg (e.g. a cash account or a bank you track by hand)
  if (rows.length) {
    const from = rows.reduce((m, r) => (r.date < m ? r.date : m), rows[0].date), to = rows.reduce((m, r) => (r.date > m ? r.date : m), rows[0].date);
    const txs = db.prepare("SELECT id, kind, amount, currency, date, account_id, description, counterparty, tx_kind FROM transactions WHERE import_batch_id IS NULL AND kind IN ('income','expense') AND date BETWEEN ? AND ?").all(addDays(from, -3), addDays(to, 3)) as any[];
    for (const t of txs) { const ref = `t${t.id}`; if (busy.has(ref)) continue;
      legs.push({ ref, account: `a${t.account_id ?? 0}:${t.currency}`, date: t.date, amount: t.amount, currency: t.currency, dir: t.kind === 'income' ? 'in' : 'out',
        kind: t.tx_kind ?? (t.kind === 'income' ? 'transfer_in' : 'transfer_out'), counterparty: t.counterparty, toBank: t.kind === 'expense' ? destinationBank(t.description) : null }); }
  }
  const rates = latestRates(db);
  const found = matchTransfers(legs, { rate: (c) => rates[c] ?? null, feeAbs: Number(getSetting(db, 'transferFeeAbs')) || 2, feePct: Number(getSetting(db, 'transferFeePct')) || 0.01, ...opts })
    .filter((m) => !rejected.has(`${m.out}>${m.in}`));
  const id = (ref: string) => Number(ref.slice(1));
  db.transaction(() => {
    db.prepare("DELETE FROM import_matches WHERE status = 'proposed'").run();
    const ins = db.prepare('INSERT INTO import_matches (out_row_id, in_row_id, out_tx_id, in_tx_id, score, fee, fee_currency, reasons) VALUES (?,?,?,?,?,?,?,?)');
    for (const m of found) ins.run(m.out[0] === 'r' ? id(m.out) : null, m.in[0] === 'r' ? id(m.in) : null, m.out[0] === 't' ? id(m.out) : null, m.in[0] === 't' ? id(m.in) : null, m.score, m.fee, m.feeCurrency, JSON.stringify(m.reasons));
  })();
  return found.length;
}
/** Confirm or reject a proposed pair. Confirming only changes how rows will be posted on approval. */
export async function decideMatch(db: DB, matchId: number, status: 'confirmed' | 'rejected' | 'proposed') {
  const m = db.prepare('SELECT * FROM import_matches WHERE id = ?').get(matchId) as any;
  if (!m) throw Object.assign(new Error('Match not found'), { statusCode: 404 });
  const posted = [m.out_row_id, m.in_row_id].filter(Boolean).some((r) => (db.prepare('SELECT transaction_id FROM import_rows WHERE id = ?').get(r) as any)?.transaction_id);
  db.prepare('UPDATE import_matches SET status = ? WHERE id = ?').run(status, matchId);
  if (posted) {
    // already-approved legs: re-post them right away (and undo it again when the pair is rejected)
    if (status === 'confirmed' && m.status !== 'confirmed') await applyPostedMatch(db, m);
    if (status !== 'confirmed' && m.status === 'confirmed') unapplyPostedMatch(db, m);
  }
  return db.prepare('SELECT * FROM import_matches WHERE id = ?').get(matchId);
}

/**
 * Ask the configured AI model about rows below the confidence threshold. Answers are cached per merchant key,
 * so a merchant is asked about once. Learned (user) and manual rows are never touched.
 */
export async function runAi(db: DB, batchId: number) {
  const cfg = aiConfig(db);
  const rows = db.prepare("SELECT * FROM import_rows WHERE batch_id = ? AND confidence < ? AND source NOT IN ('manual','learned') AND transaction_id IS NULL AND excluded = 0").all(batchId, cfg.threshold) as any[];
  if (!rows.length) { db.prepare('UPDATE import_batches SET ai_note = ? WHERE id = ?').run(null, batchId); return { updated: 0 }; }
  const { cats } = keyMaps(db);
  const upd = db.prepare("UPDATE import_rows SET tx_kind = ?, category_id = ?, confidence = ?, source = 'ai', why = ? WHERE id = ?");
  const apply = (r: any, kind: TxKind, catKey: string | null, conf: number, why: string) => {
    if (kindDirection(kind) !== 'both' && kindDirection(kind) !== (r.kind === 'income' ? 'in' : 'out')) return false;
    upd.run(kind, categoryIdFor({ kind, category: catKey }, r.kind, cats), Math.min(0.85, conf), why, r.id); return true;
  };
  let n = 0; const ask: any[] = [];
  const cache = db.prepare('SELECT * FROM ai_cache WHERE merchant_key = ?');
  for (const r of rows) { const c = r.merchant_key ? cache.get(r.merchant_key) as any : null; if (c) { if (apply(r, c.tx_kind, c.category_key, c.confidence, `AI (cached): ${c.model}`)) n++; } else ask.push(r); }
  // one question per merchant
  const uniq = new Map<string, any>(); for (const r of ask) if (!uniq.has(r.merchant_key || `#${r.id}`)) uniq.set(r.merchant_key || `#${r.id}`, r);
  const list = cats.filter((c) => c.key).map((c) => ({ key: c.key!, label: c.name, kind: c.kind }));
  const items = [...uniq.values()].map((r) => ({ i: r.id, description: aiText(r), amount: r.amount, currency: r.currency, kind: r.kind as 'income' | 'expense', mcc: r.mcc ?? undefined }));
  const res = items.length ? await aiCategorize(cfg, items, list) : { choices: [] as AiChoice[], model: cfg.model };
  const put = db.prepare("INSERT INTO ai_cache (merchant_key, tx_kind, category_key, confidence, model) VALUES (?,?,?,?,?) ON CONFLICT(merchant_key) DO UPDATE SET tx_kind = excluded.tx_kind, category_key = excluded.category_key, confidence = excluded.confidence, model = excluded.model, updated_at = datetime('now')");
  for (const ch of res.choices) {
    const src = rows.find((r) => r.id === ch.i); if (!src) continue;
    if (src.merchant_key) put.run(src.merchant_key, ch.kind, ch.category, ch.confidence, res.model ?? cfg.model);
    for (const r of ask.filter((x) => (x.merchant_key || `#${x.id}`) === (src.merchant_key || `#${src.id}`))) if (apply(r, ch.kind as TxKind, ch.category, ch.confidence, `AI: ${res.model ?? cfg.model}`)) n++;
  }
  const note = res.error ?? (n ? `AI (${cfg.provider} · ${res.model ?? cfg.model}) classified ${n} of ${rows.length} low-confidence rows` : null);
  db.prepare('UPDATE import_batches SET ai_note = ? WHERE id = ?').run(note, batchId);
  return { updated: n, error: res.error };
}
/** What the model sees: merchant/operation text only — no account numbers, card numbers or personal IDs. */
export const aiText = (r: { merchant?: string; description: string; op_type?: string | null }) =>
  [r.op_type, r.merchant || r.description].filter(Boolean).join(' · ').replace(/GE\d{2}[A-Z]{2}\d{6,}/g, '[IBAN]').replace(/\b\d{4,}\b/g, '#').slice(0, 140);

/**
 * User correction. It overrides everything for that row and is learned for the merchant / person,
 * then re-applied to other unposted rows with the same merchant key in every staged import.
 */
export function updateRow(db: DB, rowId: number, patch: { category_id?: number | null; account_id?: number | null; excluded?: boolean; kind?: 'income' | 'expense'; tx_kind?: TxKind }) {
  const r = db.prepare('SELECT * FROM import_rows WHERE id = ?').get(rowId) as any;
  if (!r) throw Object.assign(new Error('Row not found'), { statusCode: 404 });
  if (patch.kind) db.prepare('UPDATE import_rows SET kind = ? WHERE id = ?').run(patch.kind, rowId);
  if (patch.account_id !== undefined) db.prepare('UPDATE import_rows SET account_id = ? WHERE id = ?').run(patch.account_id, rowId);
  if (patch.excluded !== undefined) db.prepare('UPDATE import_rows SET excluded = ? WHERE id = ?').run(patch.excluded ? 1 : 0, rowId);
  let applied = 0;
  if (patch.category_id !== undefined || patch.tx_kind) {
    const kind = patch.tx_kind ?? r.tx_kind;
    const cat = isNonPL(kind) ? null : patch.category_id !== undefined ? patch.category_id : r.category_id;
    db.prepare("UPDATE import_rows SET tx_kind = ?, category_id = ?, confidence = 1, source = 'manual', why = 'your correction' WHERE id = ?").run(kind, cat, rowId);
    if (r.merchant_key) {
      db.prepare(`INSERT INTO learned_rules (merchant_key, label, tx_kind, category_id) VALUES (?,?,?,?) ON CONFLICT(merchant_key) DO UPDATE SET
        tx_kind = COALESCE(excluded.tx_kind, tx_kind), category_id = excluded.category_id, label = excluded.label, hits = hits + 1, updated_at = datetime('now')`).run(r.merchant_key, r.merchant || r.description.slice(0, 60), patch.tx_kind ?? null, cat);
      applied = db.prepare(`UPDATE import_rows SET tx_kind = ?, category_id = CASE WHEN kind = ? THEN ? ELSE category_id END, confidence = 0.98, source = 'learned', why = 'your rule for "' || merchant_key || '"'
        WHERE merchant_key = ? AND id != ? AND source != 'manual' AND transaction_id IS NULL`).run(kind, r.kind, cat, r.merchant_key, rowId).changes;
    }
    if (patch.tx_kind) rematch(db);
  }
  return { row: db.prepare('SELECT * FROM import_rows WHERE id = ?').get(rowId), applied };
}

function refreshStatus(db: DB, batchId: number) {
  const s = db.prepare('SELECT COUNT(*) AS total, SUM(transaction_id IS NOT NULL) AS posted FROM import_rows WHERE batch_id = ?').get(batchId) as { total: number; posted: number };
  const b = db.prepare('SELECT status FROM import_batches WHERE id = ?').get(batchId) as { status: string };
  const included = (db.prepare('SELECT COUNT(*) AS c FROM import_rows WHERE batch_id = ? AND excluded = 0').get(batchId) as { c: number }).c;
  const status = s.posted === 0 ? (b.status === 'approved' || b.status === 'partial' ? 'reverted' : b.status) : s.posted < included ? 'partial' : 'approved';
  db.prepare("UPDATE import_batches SET status = ?, approved_at = CASE WHEN ? IN ('approved','partial') THEN datetime('now') ELSE approved_at END WHERE id = ?").run(status, status, batchId);
  return status;
}

/** Post staged rows as real transactions (all included rows, or only the given ids). */
export async function approve(db: DB, batchId: number, rowIds?: number[]) {
  const b = db.prepare('SELECT * FROM import_batches WHERE id = ?').get(batchId) as any;
  if (!b) throw Object.assign(new Error('Import not found'), { statusCode: 404 });
  if (b.status === 'discarded') throw Object.assign(new Error('This import was discarded'), { statusCode: 400 });
  // no account picked: use the one account of this bank (balances and the cash-flow check need it)
  if (b.account_id == null) { const g = guessAccountForBank(db, b.bank); if (g) { db.prepare('UPDATE import_batches SET account_id = ? WHERE id = ?').run(g, batchId); b.account_id = g; } }
  let rows = db.prepare('SELECT * FROM import_rows WHERE batch_id = ? AND excluded = 0 AND transaction_id IS NULL ORDER BY idx').all(batchId) as any[];
  if (rowIds?.length) { const set = new Set(rowIds); rows = rows.filter((r) => set.has(r.id)); }
  // approving an import also confirms its strong transfer suggestions (≥ AUTO_CONFIRM); weaker ones stay suggestions
  db.prepare(`UPDATE import_matches SET status = 'confirmed' WHERE status = 'proposed' AND score >= ? AND (out_row_id IN (SELECT id FROM import_rows WHERE batch_id = ?) OR in_row_id IN (SELECT id FROM import_rows WHERE batch_id = ?))`).run(AUTO_CONFIRM, batchId, batchId);
  let n = 0; const touched = new Set<number>([batchId]);
  const link = db.prepare('UPDATE import_rows SET transaction_id = ? WHERE id = ?');
  const stamp = (txId: number, r: any) => db.prepare('UPDATE transactions SET import_batch_id = ?, tx_kind = ?, counterparty = ? WHERE id = ?').run(batchId, r.tx_kind ?? null, r.counterparty ?? null, txId);
  for (const r of rows) {
    const acct = r.account_id ?? b.account_id;
    const m = db.prepare("SELECT * FROM import_matches WHERE (out_row_id = ? OR in_row_id = ?) AND status = 'confirmed'").get(r.id, r.id) as any;
    if (m) {
      const isOut = m.out_row_id === r.id;
      const partnerRow = isOut ? m.in_row_id : m.out_row_id; const partnerTx = isOut ? m.in_tx_id : m.out_tx_id;
      const p = partnerRow ? db.prepare('SELECT r.*, b.account_id AS batch_account FROM import_rows r JOIN import_batches b ON b.id = r.batch_id WHERE r.id = ?').get(partnerRow) as any : null;
      const existing = partnerTx ?? p?.transaction_id ?? null;
      if (existing) {
        // the other leg is already a real transaction: turn it into the transfer (reversibly) and link this row to it
        const t = db.prepare('SELECT * FROM transactions WHERE id = ?').get(existing) as any;
        if (t && t.kind !== 'transfer') {
          db.prepare('UPDATE import_matches SET prev = ? WHERE id = ?').run(JSON.stringify({ tx: t.id, kind: t.kind, category_id: t.category_id, account_id: t.account_id, to_account_id: t.to_account_id, by: batchId }), m.id);
          const from = isOut ? acct : t.account_id, to = isOut ? t.account_id : acct;
          db.prepare("UPDATE transactions SET kind = 'transfer', category_id = NULL, account_id = ?, to_account_id = ?, tx_kind = 'internal' WHERE id = ?").run(from, to, t.id);
        }
        link.run(existing, r.id);
      } else {
        const toAcct = p ? p.account_id ?? p.batch_account : null;
        const txId = await insertTransaction(db, { kind: 'transfer', amount: r.amount, currency: r.currency, date: r.date, account_id: isOut ? acct : toAcct, to_account_id: isOut ? toAcct : acct,
          description: r.description, tags: ['import', `batch-${batchId}`, 'own-transfer'] });
        stamp(txId, { ...r, tx_kind: 'internal' }); link.run(txId, r.id);
      }
      if (m.fee > 0.004 && !m.fee_tx_id) {
        const fees = db.prepare("SELECT id FROM categories WHERE key = 'fees'").pluck().get() as number | undefined;
        const outAcct = isOut ? acct : p ? p.account_id ?? p.batch_account : null;
        const feeId = await insertTransaction(db, { kind: 'expense', amount: m.fee, currency: m.fee_currency ?? r.currency, date: r.date, account_id: outAcct, category_id: fees ?? null, description: 'Transfer fee', tags: ['import', `batch-${batchId}`, 'transfer-fee'] });
        db.prepare("UPDATE transactions SET import_batch_id = ?, tx_kind = 'fee' WHERE id = ?").run(batchId, feeId);
        db.prepare('UPDATE import_matches SET fee_tx_id = ? WHERE id = ?').run(feeId, m.id);
      }
      n++; continue;
    }
    const kind = isNonPL(r.tx_kind ?? '') ? 'transfer' : r.kind;
    const inbound = kind === 'transfer' && r.kind === 'income'; // money arriving on this account
    const txId = await insertTransaction(db, { kind, amount: r.amount, currency: r.currency, date: r.date, account_id: inbound ? null : acct, to_account_id: inbound ? acct : null, category_id: kind === 'transfer' ? null : r.category_id, description: r.description, tags: ['import', `batch-${batchId}`] });
    stamp(txId, r); link.run(txId, r.id);
    n++;
  }
  for (const id of touched) refreshStatus(db, id);
  refreshPeopleNetting(db);
  reconcileRecurring(db); // planned recurring entries now covered by an imported payment
  return { approved: n, status: refreshStatus(db, batchId) };
}

/** Remove exactly the transactions created by this batch and undo any transfer conversions it made. Rows stay staged. */
export function revert(db: DB, batchId: number) {
  const affected = new Set<number>();
  const r = db.transaction(() => {
    for (const m of db.prepare("SELECT * FROM import_matches WHERE prev IS NOT NULL").all() as any[]) {
      const p = JSON.parse(m.prev); if (p.by !== batchId) continue;
      db.prepare('UPDATE transactions SET kind = ?, category_id = ?, account_id = ?, to_account_id = ?, tx_kind = NULL WHERE id = ?').run(p.kind, p.category_id, p.account_id, p.to_account_id, p.tx);
      db.prepare('UPDATE import_matches SET prev = NULL WHERE id = ?').run(m.id);
      db.prepare('UPDATE import_rows SET transaction_id = NULL WHERE batch_id = ? AND transaction_id = ?').run(batchId, p.tx);
    }
    const ids = db.prepare('SELECT id FROM transactions WHERE import_batch_id = ?').pluck().all(batchId) as number[];
    restoreReconciled(db, ids); // planned entries this import replaced come back
    // pairs re-posted after approval: undo them on the partner side, which may belong to another import
    for (const m of db.prepare("SELECT * FROM import_matches WHERE status = 'confirmed'").all() as any[]) {
      const legs = [legTx(db, m.out_row_id, m.out_tx_id), legTx(db, m.in_row_id, m.in_tx_id)];
      if (legs.some((x) => x && ids.includes(x))) { for (const x of legs) if (x && !ids.includes(x)) restoreTx(db, x, `match:${m.id}`); }
    }
    const removed = db.prepare('DELETE FROM transactions WHERE import_batch_id = ?').run(batchId).changes;
    for (const id of ids) {
      for (const o of db.prepare('SELECT DISTINCT batch_id FROM import_rows WHERE transaction_id = ? AND batch_id != ?').pluck().all(id, batchId) as number[]) affected.add(o);
      db.prepare('UPDATE import_rows SET transaction_id = NULL WHERE transaction_id = ?').run(id);
      db.prepare('UPDATE import_matches SET fee_tx_id = NULL WHERE fee_tx_id = ?').run(id);
    }
    db.prepare('UPDATE import_rows SET transaction_id = NULL WHERE batch_id = ?').run(batchId);
    db.prepare("UPDATE import_batches SET status = 'reverted', reverted_at = datetime('now') WHERE id = ?").run(batchId);
    return removed;
  })();
  for (const id of affected) refreshStatus(db, id);
  refreshPeopleNetting(db);
  return { removed: r };
}
export function discard(db: DB, batchId: number) {
  const posted = db.prepare('SELECT COUNT(*) FROM import_rows WHERE batch_id = ? AND transaction_id IS NOT NULL').pluck().get(batchId) as number;
  if (posted) throw Object.assign(new Error('Revert the approved transactions first'), { statusCode: 400 });
  db.prepare("UPDATE import_batches SET status = 'discarded' WHERE id = ?").run(batchId);
}

/** Spending analysis computed from included staged rows (does not touch real data). */
export function analyze(db: DB, batchId: number) {
  const rates = latestRates(db);
  const rows = (db.prepare('SELECT r.*, c.name AS category_name, c.color AS category_color, p.name AS parent_name FROM import_rows r LEFT JOIN categories c ON c.id = r.category_id LEFT JOIN categories p ON p.id = c.parent_id WHERE r.batch_id = ? AND r.excluded = 0').all(batchId) as any[])
    .map((r) => ({ ...r, gel: r.amount * (rates[r.currency] ?? 1) }));
  // moving your own money (own-account transfers, exchanges, matched legs between banks, …) is neither income nor spending
  const paired = new Set((db.prepare("SELECT out_row_id, in_row_id FROM import_matches WHERE status != 'rejected'").all() as any[]).flatMap((m) => [m.out_row_id, m.in_row_id]).filter(Boolean));
  const internal = (r: any) => isNonPL(r.tx_kind ?? '') || paired.has(r.id);
  const moved = rows.filter(internal);
  // money lent to a friend and paid back is not spending either
  const people = peopleFrom(rows.filter((r) => !internal(r)));
  const ovp = new Map((db.prepare('SELECT person_key, pattern FROM people_overrides').all() as any[]).map((o) => [o.person_key, normalizePattern(o.pattern)]));
  const settled = new Set(people.filter((p) => (ovp.get(p.key) ?? p.pattern) === 'settles').flatMap((p) => p.items.map((i) => Number(i.ref))));
  const pl = rows.filter((r) => !internal(r) && !settled.has(r.id));
  const exp = pl.filter((r) => r.kind === 'expense'), inc = pl.filter((r) => r.kind === 'income');
  const sum = (a: any[]) => Math.round(a.reduce((s, r) => s + r.gel, 0) * 100) / 100;
  const group = (a: any[], key: (r: any) => string) => { const m = new Map<string, { name: string; total: number; count: number; color?: string }>(); for (const r of a) { const k = key(r); const x = m.get(k) ?? { name: k, total: 0, count: 0, color: r.category_color }; x.total += r.gel; x.count++; m.set(k, x); } return [...m.values()].map((x) => ({ ...x, total: Math.round(x.total * 100) / 100 })).sort((a, b) => b.total - a.total); };
  const byCategory = group(exp, (r) => r.category_name ?? 'Uncategorized');
  const topMerchants = group(exp, (r) => r.merchant || r.description).slice(0, 10);
  const dow = [0, 0, 0, 0, 0, 0, 0]; for (const r of exp) dow[(new Date(r.date + 'T00:00:00Z').getUTCDay() + 6) % 7] += r.gel;
  const weekly = group(exp, (r) => { const d = new Date(r.date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); }).sort((a, b) => a.name.localeCompare(b.name));
  const daily = group(exp, (r) => r.date).sort((a, b) => a.name.localeCompare(b.name));
  const recurring = detectRecurring(exp.map((r) => ({ merchant: r.merchant, date: r.date, amount: r.gel })));
  const subs = exp.filter((r) => r.subscription);
  const insights: { key: string; severity: string; params: Record<string, string | number> }[] = [];
  const total = sum(exp), totalIn = sum(inc);
  const days = rows.length ? Math.max(1, (Date.parse(rows.reduce((m, r) => (r.date > m ? r.date : m), rows[0].date)) - Date.parse(rows.reduce((m, r) => (r.date < m ? r.date : m), rows[0].date))) / 86400000 + 1) : 1;
  if (byCategory[0] && total) insights.push({ key: 'stTopCat', severity: 'info', params: { category: byCategory[0].name, pct: Math.round((byCategory[0].total / total) * 100), amount: Math.round(byCategory[0].total) } });
  if (topMerchants[0]) insights.push({ key: 'stTopMerchant', severity: 'info', params: { merchant: topMerchants[0].name, count: topMerchants[0].count, amount: Math.round(topMerchants[0].total) } });
  const wk = dow[5] + dow[6], wd = dow.slice(0, 5).reduce((a, b) => a + b, 0);
  if (total && wk / 2 > (wd / 5) * 1.5) insights.push({ key: 'stWeekend', severity: 'warning', params: { pct: Math.round(((wk / 2) / Math.max(1, wd / 5) - 1) * 100) } });
  const delivery = exp.filter((r) => /wolt|glovo|ვოლტ|გლოვო|yandex eats|bolt food/i.test(r.description));
  if (delivery.length >= 3) insights.push({ key: 'stDelivery', severity: 'warning', params: { count: delivery.length, amount: Math.round(sum(delivery)) } });
  const taxis = exp.filter((r) => /bolt|yandex|uber|maxim|ბოლტ|იანდექს/i.test(r.description) && !/food|eats/i.test(r.description));
  if (taxis.length >= 5) insights.push({ key: 'stTaxi', severity: 'info', params: { count: taxis.length, amount: Math.round(sum(taxis)) } });
  const small = exp.filter((r) => r.gel < 15);
  if (small.length >= 10) insights.push({ key: 'stSmall', severity: 'info', params: { count: small.length, amount: Math.round(sum(small)) } });
  if (recurring.length) insights.push({ key: 'stRecurring', severity: 'info', params: { count: recurring.length, amount: Math.round(recurring.reduce((s, r) => s + r.avgAmount, 0)) } });
  const cash = exp.filter((r) => /atm|განაღდ|ბანკომატ|cash withdrawal/i.test(r.description));
  if (cash.length) insights.push({ key: 'stCash', severity: 'info', params: { count: cash.length, amount: Math.round(sum(cash)) } });
  if (totalIn) insights.push({ key: totalIn >= total ? 'stNetPositive' : 'stNetNegative', severity: totalIn >= total ? 'success' : 'danger', params: { amount: Math.round(Math.abs(totalIn - total)) } });
  const uncategorized = rows.filter((r) => !r.category_id).length;
  if (uncategorized) insights.push({ key: 'stUncategorized', severity: 'warning', params: { count: uncategorized } });
  const big = [...exp].sort((a, b) => b.gel - a.gel)[0];
  if (big && total && big.gel > total * 0.2) insights.push({ key: 'stBig', severity: 'warning', params: { description: big.description.slice(0, 40), amount: Math.round(big.gel), pct: Math.round((big.gel / total) * 100) } });
  const byKind = group(rows, (r) => (internal(r) && !isNonPL(r.tx_kind ?? '') ? 'internal' : r.tx_kind ?? r.kind));
  const receivable = 0; // friends always settle up: flows, not debts
  return { excluded: { internal: sum(moved), internalCount: moved.length, friends: sum(rows.filter((r) => settled.has(r.id))), receivable }, byKind,
    totals: { expense: total, income: totalIn, net: Math.round((totalIn - total) * 100) / 100, count: rows.length, avgPerDay: Math.round((total / days) * 100) / 100, days: Math.round(days) },
    byCategory, topMerchants, dow: dow.map((v) => Math.round(v)), weekly, daily, recurring, subscriptions: group(subs, (r) => r.merchant || r.description), insights };
}

/** P2P flows grouped by person (normalised / transliterated name). */
export function peopleFrom(rows: any[]) {
  const rates = new Map<string, number>();
  const flows = rows.map((r) => ({ ...r, counterparty: r.counterparty || (r.person ? (r.merchant || r.description || '').trim() : '') })).filter((r) => r.counterparty && r.person && !r.own && (r.tx_kind === 'transfer_out' || r.tx_kind === 'transfer_in'))
    .map((r) => ({ ref: String(r.id), date: r.date, amount: r.amount, currency: r.currency, dir: (r.kind === 'income' ? 'in' : 'out') as 'in' | 'out', counterparty: r.counterparty, text: r.description ?? '', amountGel: r.gel ?? r.amount * (rates.get(r.currency) ?? 1) }));
  return groupPeople(flows);
}
/** People view across every import that was not discarded, with your choices applied; stats for an optional period. */
export function people(db: DB, from?: string, to?: string) {
  const rates = latestRates(db);
  const rows = (db.prepare("SELECT r.* FROM import_rows r JOIN import_batches b ON b.id = r.batch_id WHERE b.status != 'discarded' AND r.excluded = 0 AND r.duplicate_of IS NULL").all() as any[])
    .map((r) => ({ ...r, gel: r.amount * (rates[r.currency] ?? 1) }));
  const ov = new Map((db.prepare('SELECT * FROM people_overrides').all() as any[]).map((o) => [o.person_key, o]));
  const inP = (d: string) => (!from || d >= from) && (!to || d <= to);
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const list = peopleFrom(rows).map((p) => {
    const items = p.items.filter((i) => inP(i.date)); const v = (i: any) => i.amountGel ?? i.amount;
    const sent = r2(items.filter((i) => i.dir === 'out').reduce((a, i) => a + v(i), 0)), received = r2(items.filter((i) => i.dir === 'in').reduce((a, i) => a + v(i), 0));
    return { ...p, items, sent, received, net: r2(sent - received), count: items.length, total: r2(sent + received), monthly: p.monthly.filter((m) => inP(m.month + '-15')),
      detected: p.pattern, pattern: normalizePattern(ov.get(p.key)?.pattern) ?? p.pattern, overridden: !!ov.get(p.key)?.pattern, hidden: !!ov.get(p.key)?.hidden };
  }).filter((p) => p.count > 0).sort((a, b) => b.total - a.total);
  const vis = list.filter((p) => !p.hidden);
  const sum = (f: (p: any) => number, l = vis) => r2(l.reduce((a, p) => a + f(p), 0));
  const flows = vis.filter((p) => p.pattern === 'settles');
  const ta = flows.map((p) => p.turnaroundDays).filter((d): d is number => d !== null).sort((a, b) => a - b);
  const insights: { key: string; severity: string; params: Record<string, string | number> }[] = [];
  if (flows[0]) insights.push({ key: 'pTop', severity: 'info', params: { name: flows[0].name, amount: Math.round(flows[0].total), count: flows[0].count } });
  if (ta.length >= 3) insights.push({ key: 'pTurnaround', severity: 'info', params: { days: ta[Math.floor(ta.length / 2)] } });
  const rent = vis.filter((p) => p.pattern === 'rent'); if (rent.length) insights.push({ key: 'pRent', severity: 'info', params: { name: rent.map((p) => p.name).join(', '), amount: Math.round(sum((p) => p.sent, rent)) } });
  const months = new Set(vis.flatMap((p) => p.monthly.map((m) => m.month))).size || 1;
  insights.push({ key: 'pMonthly', severity: 'info', params: { amount: Math.round(sum((p) => p.total, flows) / months), people: flows.length } });
  return { people: list, from: from ?? null, to: to ?? null, sent: sum((p) => p.sent), received: sum((p) => p.received), flowTotal: sum((p) => p.total, flows), rentTotal: sum((p) => p.sent, rent),
    giftTotal: sum((p) => p.sent, vis.filter((p) => p.pattern === 'gift')), owedToYou: 0, youOwe: 0, insights };
}

/** Smart groups for the import preview; each can be confirmed or rejected in one click. */
export function clusters(db: DB, batchId: number) {
  const rows = db.prepare('SELECT * FROM import_rows WHERE batch_id = ? AND excluded = 0').all(batchId) as any[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const legOut = (m: any) => m.out_row_id ? (db.prepare('SELECT r.id, r.date, r.amount, r.currency, r.merchant, r.description, r.batch_id, b.bank FROM import_rows r JOIN import_batches b ON b.id = r.batch_id WHERE r.id = ?').get(m.out_row_id) as any) : (db.prepare("SELECT id, date, amount, currency, description, 'manual' AS bank FROM transactions WHERE id = ?").get(m.out_tx_id) as any);
  const legIn = (m: any) => m.in_row_id ? (db.prepare('SELECT r.id, r.date, r.amount, r.currency, r.merchant, r.description, r.batch_id, b.bank FROM import_rows r JOIN import_batches b ON b.id = r.batch_id WHERE r.id = ?').get(m.in_row_id) as any) : (db.prepare("SELECT id, date, amount, currency, description, 'manual' AS bank FROM transactions WHERE id = ?").get(m.in_tx_id) as any);
  const matches = (db.prepare('SELECT * FROM import_matches WHERE out_row_id IN (SELECT id FROM import_rows WHERE batch_id = ?) OR in_row_id IN (SELECT id FROM import_rows WHERE batch_id = ?) ORDER BY score DESC').all(batchId, batchId) as any[])
    .map((m) => ({ ...m, reasons: JSON.parse(m.reasons), out: legOut(m), in: legIn(m) }));
  const own = rows.filter((r) => isNonPL(r.tx_kind ?? ''));
  const ownGroups = [...group2(own, (r) => r.tx_kind)].map(([k, list]) => ({ key: k, count: list.length, ids: list.map((r) => r.id), total: r2(list.reduce((a, r) => a + r.amount, 0)), why: list[0].why, confidence: Math.min(...list.map((r) => r.confidence)) }));
  const ppl = peopleFrom(rows).map((p) => ({ key: p.key, name: p.name, pattern: p.pattern, sent: p.sent, received: p.received, net: p.net, count: p.count, ids: p.items.map((i) => Number(i.ref)) }));
  const exp = rows.filter((r) => r.kind === 'expense' && !isNonPL(r.tx_kind ?? '') && r.merchant_key);
  const rec = detectRecurring(exp.map((r) => ({ merchant: r.merchant_key, date: r.date, amount: r.amount })));
  const recurring = rec.map((x: any) => { const list = exp.filter((r) => r.merchant_key === x.merchant); return { key: x.merchant, name: list[0]?.merchant ?? x.merchant, count: list.length, avgAmount: x.avgAmount, cadence: x.cadence ?? x.period ?? null, ids: list.map((r) => r.id), subscription: list.every((r) => r.subscription) }; });
  const subs = [...group2(rows.filter((r) => r.subscription || r.tx_kind === 'subscription'), (r) => r.merchant_key || r.merchant)].map(([k, list]) => ({ key: k, name: list[0].merchant, count: list.length, ids: list.map((r) => r.id), total: r2(list.reduce((a, r) => a + r.amount, 0)) }));
  return { transfers: matches, own: ownGroups, people: ppl, recurring, subscriptions: subs, lowConfidence: rows.filter((r) => r.confidence < 0.6).map((r) => r.id), _n: byId.size };
}
function group2<T>(a: T[], k: (x: T) => string) { const m = new Map<string, T[]>(); for (const x of a) { const key = k(x); m.set(key, [...(m.get(key) ?? []), x]); } return m; }
const r2 = (n: number) => Math.round(n * 100) / 100;

/** v1.2.2: imported card payments get their real transaction date instead of the bank's booking date (old date kept in booked_date). */
export function migrateTransactionDates(db: DB) {
  const cols = (db.prepare('PRAGMA table_info(import_rows)').all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes('booked_date')) db.exec('ALTER TABLE import_rows ADD COLUMN booked_date TEXT');
  if (getSetting(db, 'txDatesV1')) return;
  const rows = db.prepare('SELECT id, date, raw, transaction_id FROM import_rows WHERE booked_date IS NULL AND raw IS NOT NULL').all() as any[];
  let n = 0;
  db.transaction(() => { for (const r of rows) { const d = transactionDate(r.raw, r.date); if (d === r.date) continue;
    db.prepare('UPDATE import_rows SET booked_date = date, date = ? WHERE id = ?').run(d, r.id);
    if (r.transaction_id) db.prepare('UPDATE transactions SET date = ? WHERE id = ? AND date = ?').run(d, r.transaction_id, r.date); n++; } })();
  setSetting(db, 'txDatesV1', JSON.stringify({ at: new Date().toISOString(), redated: n }));
}
