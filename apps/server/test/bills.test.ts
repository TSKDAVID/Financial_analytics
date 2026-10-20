import { describe, it, expect } from 'vitest';
import { addMonths, todayISO } from '@fa/core';
import { openDb } from '../src/db';
import { buildApp } from '../src/app';
import { initDb, migrateBillTracking, setSetting } from '../src/schema';

const setup = async () => {
  const db = openDb(':memory:'); const { app } = await buildApp(db);
  const call = async (method: string, url: string, payload?: unknown) => { const r = await app.inject({ method: method as any, url, payload: payload as any, remoteAddress: '127.0.0.1' }); return { code: r.statusCode, body: r.json() }; };
  return { db, call };
};
const expenses = (db: any) => db.prepare("SELECT date, amount FROM transactions WHERE kind = 'expense' ORDER BY date").all();

describe('overdue loan installments', () => {
  it('installments before tracking start are history; later overdue ones are recorded on the due date', async () => {
    const { db, call } = await setup();
    const loan = (await call('POST', '/api/loans', { name: 'Car', bank: 'BOG', principal: 6000, annual_rate: 12, term_months: 24, start_date: addMonths(todayISO(), -8) })).body;
    db.prepare('UPDATE loans SET tracked_from = ? WHERE id = ?').run(addMonths(todayISO(), -3).slice(0, 8) + '01', loan.id);
    const od = (await call('GET', '/api/bills/overdue')).body.filter((b: any) => b.loan_id === loan.id);
    expect(od.length).toBeGreaterThanOrEqual(7);
    const pre = od.filter((b: any) => b.pre_tracking), post = od.filter((b: any) => !b.pre_tracking);
    expect(pre.length).toBeGreaterThan(0); expect(post.length).toBeGreaterThan(0);
    const r = (await call('POST', '/api/bills/pay-overdue', { ids: od.map((b: any) => b.id) })).body;
    expect(r.paid).toBe(od.length); expect(r.historical).toBe(pre.length);
    const ex = expenses(db);
    expect(ex.length).toBe(post.length); // nothing for pre-tracking installments
    expect(ex.map((e: any) => e.date)).toEqual(post.map((b: any) => b.due_date)); // dated on due dates, not today
    await call('POST', '/api/bills/unpay-many', { ids: r.ids });
    expect(expenses(db).length).toBe(0);
    expect((await call('GET', '/api/bills/overdue')).body.filter((b: any) => b.loan_id === loan.id).length).toBe(od.length);
  });
  it('migration removes pre-tracking expenses and re-dates late ones', async () => {
    const { db, call } = await setup();
    const loan = (await call('POST', '/api/loans', { name: 'Old', bank: 'TBC', principal: 3000, annual_rate: 10, term_months: 24, start_date: addMonths(todayISO(), -6) })).body;
    const bills = db.prepare('SELECT * FROM bills WHERE loan_id = ? AND due_date < ? ORDER BY due_date').all(loan.id, todayISO()) as any[];
    // simulate the old behaviour: every overdue installment paid "today"
    for (const b of bills) {
      const tx = Number(db.prepare("INSERT INTO transactions (kind, amount, currency, amount_gel, date, loan_id) VALUES ('expense', ?, 'GEL', ?, ?, ?)").run(b.amount, b.amount, todayISO(), loan.id).lastInsertRowid);
      db.prepare('UPDATE bills SET paid = 1, paid_date = ?, transaction_id = ? WHERE id = ?').run(todayISO(), tx, b.id);
    }
    const tracked = bills[bills.length - 2].due_date;
    db.prepare('UPDATE loans SET tracked_from = ? WHERE id = ?').run(tracked, loan.id);
    setSetting(db, 'billsV14', ''); migrateBillTracking(db);
    const ex = expenses(db);
    expect(ex.map((e: any) => e.date)).toEqual(bills.filter((b) => b.due_date >= tracked).map((b) => b.due_date));
    const c = (await call('GET', '/api/maintenance/bill-cleanup')).body;
    expect(c.removed.length).toBe(bills.filter((b) => b.due_date < tracked).length);
    expect(c.redated.length).toBe(ex.length);
    initDb(db); // idempotent
    expect(expenses(db).length).toBe(ex.length);
  });
});
