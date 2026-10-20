import { describe, it, expect, beforeAll } from 'vitest';
import { openDb } from '../src/db';
import { buildApp } from '../src/app';
import { encryptBackup, decryptBackup } from '../src/security';

const db = openDb(':memory:');
// offline-safe: pre-seed a USD rate so tests never need the network
db.prepare("INSERT INTO rates (date, code, rate, manual) VALUES ('2026-01-01','USD',2.7,1)").run();
let app: Awaited<ReturnType<typeof buildApp>>['app'];
beforeAll(async () => { app = (await buildApp(db)).app; });
const inject = (method: string, url: string, payload?: unknown) => app.inject({ method: method as any, url, payload: payload as any, remoteAddress: '127.0.0.1' });

describe('api', () => {
  it('health', async () => { expect((await inject('GET', '/api/health')).json().ok).toBe(true); });
  it('builtin categories exist', async () => {
    const cats = (await inject('GET', '/api/categories')).json();
    for (const k of ['salary', 'freelance', 'business', 'rental', 'gifts', 'loans', 'subscriptions', 'electricity', 'gas', 'water', 'internet', 'phone', 'rent', 'groceries']) expect(cats.some((c: any) => c.key === k)).toBe(true);
  });
  it('creates account and transaction with currency conversion', async () => {
    const a = (await inject('POST', '/api/accounts', { name: 'Card', type: 'card' })).json();
    const t = await inject('POST', '/api/transactions', { kind: 'expense', amount: 10, currency: 'USD', date: '2026-01-01', account_id: a.id, tags: ['x'] });
    expect(t.statusCode).toBe(200);
    expect(t.json().amount_gel).toBe(27);
    const list = (await inject('GET', '/api/transactions?tag=x')).json();
    expect(list.total).toBe(1);
    const accts = (await inject('GET', '/api/accounts')).json();
    expect(accts[0].balance_gel).toBe(-27);
  });
  it('validates input', async () => { expect((await inject('POST', '/api/transactions', { kind: 'nope', amount: -1 })).statusCode).toBe(400); });
  it('rejects remote unpaired devices', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/dashboard', remoteAddress: '100.101.1.2' });
    expect(r.statusCode).toBe(401);
  });
  it('pairs a device and authenticates remotely', async () => {
    const { code } = (await inject('POST', '/api/pair/start')).json();
    const { token } = (await app.inject({ method: 'POST', url: '/api/pair/claim', payload: { code, name: 'Pixel' }, remoteAddress: '100.101.1.2' })).json();
    const r = await app.inject({ method: 'GET', url: '/api/alerts', headers: { authorization: `Bearer ${token}` }, remoteAddress: '100.101.1.2' });
    expect(r.statusCode).toBe(200);
  });
  it('pin lock', async () => {
    await inject('POST', '/api/auth/set', { secret: '1234' });
    expect((await inject('GET', '/api/dashboard')).statusCode).toBe(423);
    const { token } = (await inject('POST', '/api/auth/unlock', { secret: '1234' })).json();
    expect((await app.inject({ method: 'GET', url: '/api/dashboard', headers: { authorization: `Bearer ${token}` }, remoteAddress: '127.0.0.1' })).statusCode).toBe(200);
    await app.inject({ method: 'POST', url: '/api/auth/set', payload: { current: '1234', secret: null }, headers: { authorization: `Bearer ${token}` }, remoteAddress: '127.0.0.1' });
    expect((await inject('GET', '/api/dashboard')).statusCode).toBe(200);
  });
  it('loan schedule + bills', async () => {
    const l = (await inject('POST', '/api/loans', { name: 'Car', bank: 'TBC', principal: 10000, annual_rate: 12, term_months: 12, start_date: '2026-01-10' })).json();
    const s = (await inject('GET', `/api/loans/${l.id}/schedule?extra=200`)).json();
    expect(s.interestSaved).toBeGreaterThan(0);
    expect(s.base.rows).toHaveLength(12);
  });
  it('forecast, risk, insights, dashboard all respond', async () => {
    for (const [m, u] of [['POST', '/api/forecast'], ['GET', '/api/risk'], ['GET', '/api/insights'], ['GET', '/api/dashboard'], ['GET', '/api/utilities'], ['GET', '/api/subscriptions'], ['GET', '/api/budgets'], ['GET', '/api/goals'], ['GET', '/api/reports']])
      expect((await inject(m, u, m === 'POST' ? { months: 6, incomeChangePct: -20 } : undefined)).statusCode, u).toBe(200);
  });
  it('encrypted backup roundtrip', () => {
    const f = encryptBackup('{"a":1}', 'secret12');
    expect(decryptBackup(f, 'secret12')).toBe('{"a":1}');
    expect(() => decryptBackup(f, 'wrong')).toThrow();
  });
});
