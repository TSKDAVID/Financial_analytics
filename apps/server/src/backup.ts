import type { DB } from './schema';

export const BACKUP_TABLES = ['settings', 'accounts', 'categories', 'recurring', 'loans', 'subscriptions', 'transactions', 'bills', 'rates', 'budgets', 'goals', 'loan_updates', 'alerts', 'devices'];
export function dumpDb(db: DB) {
  const out: Record<string, unknown[]> = {};
  for (const t of BACKUP_TABLES) out[t] = db.prepare(`SELECT * FROM ${t}`).all();
  return JSON.stringify({ app: 'financial-analytics', exportedAt: new Date().toISOString(), tables: out });
}
export function restoreDb(db: DB, json: string) {
  const o = JSON.parse(json) as { tables: Record<string, Record<string, unknown>[]> };
  if (!o.tables) throw new Error('Invalid backup content');
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      for (const t of [...BACKUP_TABLES].reverse()) db.prepare(`DELETE FROM ${t}`).run();
      for (const t of BACKUP_TABLES) for (const row of o.tables[t] ?? []) {
        const cols = Object.keys(row);
        if (!cols.length) continue;
        db.prepare(`INSERT INTO ${t} (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => row[c] as any));
      }
    })();
  } finally { db.pragma('foreign_keys = ON'); }
}
