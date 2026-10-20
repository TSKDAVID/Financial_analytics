import { categorize, normalizeMerchant, detectRecurring, addDays } from '@fa/core';
import type { DB } from '../db';
import { insertTransaction } from '../services';
import { latestRates } from '../rates';
import { extractLines } from './pdf';
import { parseStatement, type ParseResult } from './parse';
import { aiCategorize, aiConfig } from './ai';

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
  CREATE TABLE IF NOT EXISTS merchant_rules (merchant TEXT PRIMARY KEY, category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE, hits INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT (datetime('now')));`);
  const cols = (db.prepare('PRAGMA table_info(transactions)').all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes('import_batch_id')) db.exec('ALTER TABLE transactions ADD COLUMN import_batch_id INTEGER');
}

const keyMaps = (db: DB) => {
  const cats = db.prepare('SELECT id, key, name, kind, parent_id FROM categories WHERE archived = 0').all() as { id: number; key: string | null; name: string; kind: string; parent_id: number | null }[];
  return { cats, keyToId: new Map(cats.filter((c) => c.key).map((c) => [c.key!, c.id])) };
};
export const learnedMap = (db: DB) => new Map((db.prepare('SELECT merchant, category_id FROM merchant_rules').all() as { merchant: string; category_id: number }[]).map((r) => [r.merchant, r.category_id]));

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
  const { keyToId } = keyMaps(db); const learned = learnedMap(db);
  const batchId = Number(db.prepare('INSERT INTO import_batches (filename, bank, currency, account_id, period_from, period_to, row_count, warnings) VALUES (?,?,?,?,?,?,?,?)')
    .run(filename, parsed.bank, parsed.currency, accountId, parsed.periodFrom, parsed.periodTo, parsed.rows.length, JSON.stringify(parsed.warnings)).lastInsertRowid);
  const ins = db.prepare('INSERT INTO import_rows (batch_id, idx, date, description, merchant, amount, currency, kind, category_id, confidence, source, subscription, account_id, raw) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  db.transaction(() => parsed.rows.forEach((r, i) => {
    const c = categorize(r.description, r.kind, { learned, keyToId });
    ins.run(batchId, i, r.date, r.description, normalizeMerchant(r.description), r.amount, r.currency, r.kind, c.categoryId, c.confidence, c.source, c.subscription ? 1 : 0, accountId, r.raw);
  }))();
  detectDuplicates(db, batchId);
  return batchId;
}

export async function importPdf(db: DB, filename: string, data: Uint8Array, accountId: number | null, useAi = true) {
  const lines = await extractLines(data);
  const parsed = parseStatement(lines);
  const id = stageParsed(db, filename, parsed, accountId);
  if (useAi && aiConfig(db).enabled) await runAi(db, id);
  return id;
}

/** Ask the configured AI model about rows below the confidence threshold (never overrides learned/manual). */
export async function runAi(db: DB, batchId: number) {
  const cfg = aiConfig(db);
  const rows = db.prepare("SELECT * FROM import_rows WHERE batch_id = ? AND confidence < ? AND source NOT IN ('manual','learned') AND transaction_id IS NULL").all(batchId, cfg.threshold) as any[];
  if (!rows.length) { db.prepare('UPDATE import_batches SET ai_note = ? WHERE id = ?').run(null, batchId); return { updated: 0 }; }
  const { cats } = keyMaps(db);
  const list = cats.filter((c) => c.key !== 'utilities').map((c) => ({ key: c.key ?? `c${c.id}`, label: c.name, kind: c.kind, id: c.id }));
  const res = await aiCategorize(cfg, rows.map((r) => ({ i: r.id, description: r.description, amount: r.amount, currency: r.currency, kind: r.kind })), list);
  const byKey = new Map(list.map((c) => [c.key, c]));
  const upd = db.prepare("UPDATE import_rows SET category_id = ?, confidence = ?, source = 'ai' WHERE id = ? AND batch_id = ?");
  let n = 0;
  for (const ch of res.choices) { const c = byKey.get(ch.category); const row = rows.find((r) => r.id === ch.i); if (c && row && c.kind === row.kind) { upd.run(c.id, Math.min(0.85, ch.confidence), ch.i, batchId); n++; } }
  const note = res.error ?? (n ? `AI (${cfg.provider} · ${res.model}) categorised ${n} of ${rows.length} low-confidence rows` : null);
  db.prepare('UPDATE import_batches SET ai_note = ? WHERE id = ?').run(note, batchId);
  return { updated: n, error: res.error };
}

/** User correction: store rule per merchant and apply to other non-manual rows with same merchant (all staged batches). */
export function updateRow(db: DB, rowId: number, patch: { category_id?: number | null; account_id?: number | null; excluded?: boolean; kind?: 'income' | 'expense' }) {
  const r = db.prepare('SELECT * FROM import_rows WHERE id = ?').get(rowId) as any;
  if (!r) throw Object.assign(new Error('Row not found'), { statusCode: 404 });
  if (patch.kind) db.prepare('UPDATE import_rows SET kind = ? WHERE id = ?').run(patch.kind, rowId);
  if (patch.account_id !== undefined) db.prepare('UPDATE import_rows SET account_id = ? WHERE id = ?').run(patch.account_id, rowId);
  if (patch.excluded !== undefined) db.prepare('UPDATE import_rows SET excluded = ? WHERE id = ?').run(patch.excluded ? 1 : 0, rowId);
  let applied = 0;
  if (patch.category_id !== undefined) {
    db.prepare("UPDATE import_rows SET category_id = ?, confidence = 1, source = 'manual' WHERE id = ?").run(patch.category_id, rowId);
    if (patch.category_id && r.merchant) {
      db.prepare("INSERT INTO merchant_rules (merchant, category_id) VALUES (?, ?) ON CONFLICT(merchant) DO UPDATE SET category_id = excluded.category_id, hits = hits + 1, updated_at = datetime('now')").run(r.merchant, patch.category_id);
      applied = db.prepare("UPDATE import_rows SET category_id = ?, confidence = 0.98, source = 'learned' WHERE merchant = ? AND id != ? AND source != 'manual' AND transaction_id IS NULL AND kind = ?").run(patch.category_id, r.merchant, rowId, r.kind).changes;
    }
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
  let rows = db.prepare('SELECT * FROM import_rows WHERE batch_id = ? AND excluded = 0 AND transaction_id IS NULL ORDER BY idx').all(batchId) as any[];
  if (rowIds?.length) { const set = new Set(rowIds); rows = rows.filter((r) => set.has(r.id)); }
  let n = 0;
  for (const r of rows) {
    const txId = await insertTransaction(db, { kind: r.kind, amount: r.amount, currency: r.currency, date: r.date, account_id: r.account_id ?? b.account_id, category_id: r.category_id, description: r.description, tags: ['import', `batch-${batchId}`] });
    db.prepare('UPDATE transactions SET import_batch_id = ? WHERE id = ?').run(batchId, txId);
    db.prepare('UPDATE import_rows SET transaction_id = ? WHERE id = ?').run(txId, r.id);
    n++;
  }
  return { approved: n, status: refreshStatus(db, batchId) };
}

/** Remove exactly the transactions created by this batch. Rows stay staged so the batch can be re-approved. */
export function revert(db: DB, batchId: number) {
  const r = db.transaction(() => {
    const removed = db.prepare('DELETE FROM transactions WHERE import_batch_id = ?').run(batchId).changes;
    db.prepare('UPDATE import_rows SET transaction_id = NULL WHERE batch_id = ?').run(batchId);
    db.prepare("UPDATE import_batches SET status = 'reverted', reverted_at = datetime('now') WHERE id = ?").run(batchId);
    return removed;
  })();
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
  const exp = rows.filter((r) => r.kind === 'expense'), inc = rows.filter((r) => r.kind === 'income');
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
  return { totals: { expense: total, income: totalIn, net: Math.round((totalIn - total) * 100) / 100, count: rows.length, avgPerDay: Math.round((total / days) * 100) / 100, days: Math.round(days) },
    byCategory, topMerchants, dow: dow.map((v) => Math.round(v)), weekly, daily, recurring, subscriptions: group(subs, (r) => r.merchant || r.description), insights };
}
