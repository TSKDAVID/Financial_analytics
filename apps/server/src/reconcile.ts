import { addDays } from '@fa/core';
import type { DB } from './schema';

/**
 * A recurring rule's auto-posted entry and the real payment imported from a statement are the same money.
 * When an imported transaction of the same kind and category matches one auto-posted entry (±5% amount, ±5 days)
 * or 2–3 consecutive ones paid together (sum ±5%, e.g. two months of rent at once), the auto-posted entries are
 * removed and archived so it can be undone.
 */
export function ensureReconcileTable(db: DB) {
  db.exec(`CREATE TABLE IF NOT EXISTS recurring_reconciled (id INTEGER PRIMARY KEY, tx_id INTEGER NOT NULL, recurring_id INTEGER, imported_tx_id INTEGER NOT NULL, tx_json TEXT NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')))`);
}
const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, 0.05 * Math.max(a, b));
type Tx = { id: number; kind: string; amount_gel: number; date: string; category_id: number | null; recurring_id: number | null };

/** Does an imported payment already cover this planned entry? (used before auto-posting) */
export function importedMatch(db: DB, kind: string, categoryId: number | null, amountGel: number, date: string) {
  const c = db.prepare(`SELECT id, amount_gel FROM transactions WHERE import_batch_id IS NOT NULL AND kind = ? AND category_id IS ? AND date BETWEEN ? AND ?`).all(kind, categoryId, addDays(date, -5), addDays(date, 5)) as Tx[];
  return c.find((t) => near(t.amount_gel, amountGel)) ?? null;
}

export function reconcileRecurring(db: DB) {
  ensureReconcileTable(db);
  const planned = db.prepare(`SELECT t.id, t.kind, t.amount_gel, t.date, COALESCE(t.category_id, r.category_id) AS category_id, t.recurring_id FROM transactions t JOIN recurring r ON r.id = t.recurring_id
    WHERE t.import_batch_id IS NULL AND t.confirmed = 0 ORDER BY t.date`).all() as Tx[];
  if (!planned.length) return { removed: 0 };
  const imported = db.prepare(`SELECT id, kind, amount_gel, date, category_id FROM transactions WHERE import_batch_id IS NOT NULL AND kind IN ('income','expense') AND category_id IS NOT NULL AND date >= ? ORDER BY date`).all(addDays(planned[0].date, -10)) as Tx[];
  const used = new Set<number>(); const hits: { imp: Tx; legs: Tx[] }[] = [];
  for (const imp of imported) {
    const cand = planned.filter((p) => !used.has(p.id) && p.kind === imp.kind && p.category_id === imp.category_id);
    const one = cand.filter((p) => Math.abs(Date.parse(p.date) - Date.parse(imp.date)) <= 5 * 864e5 && near(p.amount_gel, imp.amount_gel))
      .sort((a, b) => Math.abs(Date.parse(a.date) - Date.parse(imp.date)) - Math.abs(Date.parse(b.date) - Date.parse(imp.date)))[0];
    let legs: Tx[] = one ? [one] : [];
    if (!legs.length) for (const n of [2, 3]) {
      // the last n entries of one rule due up to 5 days after the payment, starting no earlier than ~n months before
      const byRule = new Map<number, Tx[]>(); for (const p of cand) if (p.date <= addDays(imp.date, 5) && p.date >= addDays(imp.date, -32 * n)) byRule.set(p.recurring_id!, [...(byRule.get(p.recurring_id!) ?? []), p]);
      for (const l of byRule.values()) { const last = l.slice(-n); if (last.length === n && near(last.reduce((s, p) => s + p.amount_gel, 0), imp.amount_gel)) { legs = last; break; } }
      if (legs.length) break;
    }
    if (legs.length) { legs.forEach((l) => used.add(l.id)); hits.push({ imp, legs }); }
  }
  const arch = db.prepare('INSERT INTO recurring_reconciled (tx_id, recurring_id, imported_tx_id, tx_json) VALUES (?,?,?,?)');
  db.transaction(() => { for (const h of hits) for (const l of h.legs) {
    const row = db.prepare('SELECT * FROM transactions WHERE id = ?').get(l.id);
    arch.run(l.id, l.recurring_id, h.imp.id, JSON.stringify(row));
    db.prepare('UPDATE bills SET transaction_id = NULL WHERE transaction_id = ?').run(l.id);
    db.prepare('DELETE FROM transactions WHERE id = ?').run(l.id);
  } })();
  return { removed: hits.reduce((s, h) => s + h.legs.length, 0), payments: hits.length };
}

/** Put archived auto-posted entries back (all, or those covered by the given imported transactions). */
export function restoreReconciled(db: DB, importedIds?: number[]) {
  ensureReconcileTable(db);
  const rows = (db.prepare('SELECT * FROM recurring_reconciled').all() as any[]).filter((r) => !importedIds || importedIds.includes(r.imported_tx_id));
  db.transaction(() => { for (const r of rows) {
    const t = JSON.parse(r.tx_json); const cols = Object.keys(t);
    if (!db.prepare('SELECT 1 FROM transactions WHERE id = ?').get(t.id)) db.prepare(`INSERT INTO transactions (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => t[c]));
    db.prepare('DELETE FROM recurring_reconciled WHERE id = ?').run(r.id);
  } })();
  return { restored: rows.length };
}
