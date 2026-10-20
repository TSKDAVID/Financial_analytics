import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { wrap } from '../../mobile/src/local/wrap';
import { LocalApp } from '../../mobile/src/local/router';
import { initDb } from '../src/schema';
import { registerRoutes } from '../src/routes';

/** The Android app runs the server's routes in-process over expo-sqlite. Emulate expo-sqlite's sync API and drive it. */
function phone() {
  const b = new Database(':memory:'); b.pragma('foreign_keys = ON');
  const conv = (p: any) => (Array.isArray(p) ? p : Object.fromEntries(Object.entries(p).map(([k, v]) => [k.slice(1), v])));
  const raw = { getFirstSync: (s: string, p: any) => b.prepare(s).get(conv(p)) ?? null, getAllSync: (s: string, p: any) => b.prepare(s).all(conv(p)),
    runSync: (s: string, p: any) => { const r = b.prepare(s).run(conv(p)); return { changes: r.changes, lastInsertRowId: Number(r.lastInsertRowid) }; }, execSync: (s: string) => b.exec(s), closeSync: () => b.close() };
  const db = initDb(wrap(raw));
  const app = new LocalApp(); registerRoutes(app as any, db, () => 0);
  return { db, call: (m: string, u: string, body?: unknown) => app.inject(m, '/api' + u, body) };
}

describe('offline phone engine', () => {
  it('serves the full API from a local database', async () => {
    const { call } = phone();
    expect((await call('GET', '/risk')).insufficient).toBe(true);
    const acc = await call('POST', '/accounts', { name: 'TBC', type: 'bank' });
    await call('POST', '/transactions', { kind: 'income', amount: 3000, date: '2026-10-01', account_id: acc.id });
    await call('POST', '/transactions', { kind: 'expense', amount: 400, date: '2026-10-02', account_id: acc.id, description: 'Carrefour' });
    expect((await call('GET', '/dashboard')).dataStatus.sufficient).toBe(true);
    expect((await call('GET', '/transactions?q=Carre')).total).toBe(1);
    await call('POST', '/loans', { kind: 'credit_card', name: 'Card', bank: 'Liberty', principal: 1000, annual_rate: 0, term_months: 24, start_date: '2099-01-15' });
    expect((await call('GET', '/loans'))[0]).toMatchObject({ monthly_payment: 41.67, months_left: 24, needs_input: false });
    await expect(call('GET', '/nope')).rejects.toMatchObject({ status: 404 });
    await expect(call('POST', '/accounts', {})).rejects.toMatchObject({ status: 400 });
  });
});
