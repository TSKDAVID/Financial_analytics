// Node replacement for src/local/engine.ts: same routes/services over better-sqlite3 (in-memory).
import Database from 'better-sqlite3';
import { wrap } from '../src/local/wrap';
import { LocalApp } from '../src/local/router';
import { initDb, type DB } from '../../server/src/schema';
import { registerRoutes } from '../../server/src/routes';
let db: DB | null = null; let app: LocalApp | null = null;
export function reset() {
  const b = new Database(':memory:'); b.pragma('foreign_keys = ON');
  const conv = (p: any) => (p == null ? [] : Array.isArray(p) ? p : typeof p === 'object' ? Object.fromEntries(Object.entries(p).map(([k, v]) => [k.replace(/^[:$@]/, ''), v])) : [p]);
  const raw = { getFirstSync: (s: string, p: any) => b.prepare(s).get(conv(p)) ?? null, getAllSync: (s: string, p: any) => b.prepare(s).all(conv(p)),
    runSync: (s: string, p: any) => { const r = b.prepare(s).run(conv(p)); return { changes: r.changes, lastInsertRowId: Number(r.lastInsertRowid) }; }, execSync: (s: string) => b.exec(s), closeSync: () => b.close() };
  db = initDb(wrap(raw as any)); app = new LocalApp(); registerRoutes(app as any, db, () => 0);
}
export function engine() { if (!db) reset(); return { db: db!, app: app! }; }
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  return engine().app.inject(opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'), `/api${path}`, opts.body);
}
export async function tick() { return { fresh: [] }; }
