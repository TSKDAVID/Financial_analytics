import type { DB, Stmt } from '../../../server/src/schema';

/** Minimal shape of expo-sqlite's synchronous database API used by the adapter. */
export interface RawSync { getFirstSync<T>(sql: string, p: any): T | null; getAllSync<T>(sql: string, p: any): T[]; runSync(sql: string, p: any): { changes: number; lastInsertRowId: number }; execSync(sql: string): void; closeSync(): void }
/** better-sqlite3-compatible adapter over expo-sqlite's synchronous API, so the server's services run unchanged. */
type P = any;
const norm = (args: any[]): P => {
  if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0]) && !(args[0] instanceof Uint8Array)) {
    const o: Record<string, any> = {}; for (const [k, v] of Object.entries(args[0])) o['@' + k] = v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v; return o as P;
  }
  return args.flat().map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v)) as P;
};

export function wrap(raw: RawSync): DB {
  let depth = 0;
  const prepare = (sql: string, pluck = false): Stmt => {
    const named = /@\w/.test(sql);
    const s: Stmt = {
      get: (...a: any[]) => { const r = raw.getFirstSync<Record<string, unknown>>(sql, named || a.length ? norm(a) : []); return pluck && r ? Object.values(r)[0] : r ?? undefined; },
      all: (...a: any[]) => { const r = raw.getAllSync<Record<string, unknown>>(sql, named || a.length ? norm(a) : []); return pluck ? r.map((x) => Object.values(x)[0]) : r; },
      run: (...a: any[]) => { const r = raw.runSync(sql, named || a.length ? norm(a) : []); return { changes: r.changes, lastInsertRowid: r.lastInsertRowId }; },
      pluck: (on = true) => prepare(sql, on),
    };
    return s;
  };
  return {
    prepare: (sql) => prepare(sql),
    exec: (sql) => raw.execSync(sql),
    pragma: (s) => raw.execSync(`PRAGMA ${s}`),
    close: () => raw.closeSync(),
    transaction: (<F extends (...args: any[]) => any>(fn: F) => ((...args: any[]) => {
      const sp = `sp${depth}`;
      raw.execSync(depth === 0 ? 'BEGIN' : `SAVEPOINT ${sp}`); depth++;
      try { const r = fn(...args); depth--; raw.execSync(depth === 0 ? 'COMMIT' : `RELEASE ${sp}`); return r; }
      catch (e) { depth--; raw.execSync(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}`); throw e; }
    }) as unknown as F),
  };
}

