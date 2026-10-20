// v1.2.1 analytics correctness — synthetic data only (names, IBANs and amounts invented).
import { describe, it, expect } from 'vitest';
import { classify, normalizeMerchantName, merchantKeyOf, isBarePersonName, addMonths, todayISO } from '@fa/core';
import { openDb } from '../src/db';
import { accountBalances } from '../src/services';
import { insights } from '../src/analytics';
import { merchantStats, monthSummary } from '../src/merchants';
import { stageParsed, approve, people, migrateAnalyticsFix } from '../src/statements/service';
import type { ParseResult } from '../src/statements/parse';

const cat = (db: any, key: string) => db.prepare('SELECT id FROM categories WHERE key = ?').pluck().get(key);
const tx = (db: any, o: any) => db.prepare('INSERT INTO transactions (kind, amount, currency, amount_gel, date, account_id, category_id, description, tx_kind) VALUES (?,?,?,?,?,?,?,?,?)')
  .run(o.kind, o.amount, 'GEL', o.amount, o.date, o.account_id ?? null, o.category_id ?? null, o.description ?? null, o.tx_kind ?? null);
const row = (date: string, kind: 'income' | 'expense', amount: number, description: string, extra: any = {}) => ({ date, kind, amount, currency: 'GEL', description, raw: description, page: 1, ...extra });
const stmt = (bank: string, account: string, rows: any[]): ParseResult => ({ bank, format: bank === 'TBC Bank' ? 'tbc' : 'bog', currency: 'GEL', rows, periodFrom: '2026-03-01', periodTo: '2026-03-31', warnings: [], holder: 'ბექა ტესტიძე', account,
  verification: [{ currency: 'GEL', opening: 0, closing: 0, sum: 0, count: rows.length, ok: true } as any] } as any);

describe('account balance as of a date', () => {
  it('only transactions on/after opening_date move the balance', () => {
    const db = openDb(':memory:');
    const id = Number(db.prepare("INSERT INTO accounts (name, type, currency, opening_balance, opening_date) VALUES ('Card','card','GEL',100,'2026-03-10')").run().lastInsertRowid);
    tx(db, { kind: 'expense', amount: 500, date: '2026-02-07', account_id: id }); // back-dated bill: already inside the entered balance
    tx(db, { kind: 'expense', amount: 30, date: '2026-03-12', account_id: id });
    tx(db, { kind: 'income', amount: 50, date: '2026-03-11', account_id: id });
    expect(accountBalances(db).find((a: any) => a.id === id)!.balance_gel).toBe(120);
  });
  it('new accounts default to today', () => {
    const db = openDb(':memory:');
    db.prepare("INSERT INTO accounts (name, type, currency) VALUES ('X','cash','GEL')").run();
    expect(db.prepare('SELECT opening_date FROM accounts').pluck().get()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('merchant names', () => {
  it('strips facilitator prefixes and legal forms and groups variants', () => {
    expect(normalizeMerchantName('KEEPZ.ME LLC*ScooterRe')).toBe('ScooterRe');
    expect(normalizeMerchantName('FLT*Jetshr')).toBe('Jetshr');
    expect(normalizeMerchantName('FLT*QBAride')).toBe('QBAride');
    expect(normalizeMerchantName('Galleria Tbilisi LLC')).toBe('Galleria Tbilisi');
    expect(merchantKeyOf(normalizeMerchantName('FLT*Jetshr'))).toBe(merchantKeyOf('JETSHR'));
  });
  it('a bare Georgian name is a person, a transit operator is not', () => {
    expect(isBarePersonName('ბერიძე ნინო')).toBe(true);
    expect(isBarePersonName('თბილისის მეტრო')).toBe(false);
    expect(classify({ direction: 'expense', amount: 20, description: 'ბერიძე ნინო', merchant: 'ბერიძე ნინო' })).toMatchObject({ kind: 'transfer_out', counterpartyIsPerson: true });
  });
});

describe('merchant stats, month summary and insights', () => {
  it('totals per merchant, excludes transfers to people', () => {
    const db = openDb(':memory:'); const t = todayISO(); const m = (k: number, d = '05') => addMonths(t, -k).slice(0, 8) + d;
    for (let k = 0; k < 4; k++) { tx(db, { kind: 'expense', amount: 3, date: m(k, '02'), description: 'FLT*Jetshr', category_id: cat(db, 'groceries') }); tx(db, { kind: 'expense', amount: 3, date: m(k, '03'), description: 'JETSHR' }); }
    tx(db, { kind: 'expense', amount: 200, date: m(1), description: 'ბერიძე ნინო', tx_kind: 'transfer_out', category_id: cat(db, 'p2p_out') });
    const s = merchantStats(db, 6);
    expect(s.merchants).toHaveLength(1); expect(s.merchants[0]).toMatchObject({ name: 'Jetshr', count: 8, total: 24, avg: 3 });
    const ms = monthSummary(db, m(1).slice(0, 7));
    expect(ms).toMatchObject({ expense: 206, income: 0, net: -206 }); expect(ms.topMerchants[0]).toMatchObject({ name: 'Jetshr', total: 6, count: 2 });
  });
  it('rent: a lower one-off payment is not "above usual", people/scooters are not anomalies', () => {
    const db = openDb(':memory:'); const t = todayISO(); const rent = cat(db, 'rent');
    for (let k = 1; k <= 5; k++) if (k !== 3) tx(db, { kind: 'expense', amount: 600, date: addMonths(t, -k).slice(0, 8) + '01', category_id: rent });
    tx(db, { kind: 'expense', amount: 500, date: t.slice(0, 8) + '01', category_id: rent });
    for (let k = 0; k < 40; k++) tx(db, { kind: 'expense', amount: 4, date: addMonths(t, -(k % 4)).slice(0, 8) + '01', description: 'scooter', category_id: cat(db, 'groceries') });
    tx(db, { kind: 'expense', amount: 400, date: t.slice(0, 8) + '01', description: 'ბერიძე ნინო', tx_kind: 'transfer_out', category_id: cat(db, 'p2p_out') });
    const ins = insights(db);
    expect(ins.find((i) => i.key === 'catAbove' && String(i.params.category).includes('Rent'))).toBeUndefined();
    expect(ins.filter((i) => i.key === 'anomaly')).toHaveLength(0);
  });
});

describe('import fix', () => {
  it('auto-confirms ≥90% own-account transfers, nets people only up to what came back, counts own cash deposits as income', async () => {
    const db = openDb(':memory:');
    const bog = stageParsed(db, 'bog.pdf', stmt('Bank of Georgia', 'GE00BG0000000000000001', [
      row('2026-03-01', 'income', 50, 'ბანკებს შორის, ეგრევე 24/7', { opType: 'ჩარიცხვა' }),
      row('2026-03-04', 'income', 300, 'თანხის შეტანა ბანკომატით', { opType: 'შეტანა' }),
    ]), null);
    const tbc = stageParsed(db, 'tbc.pdf', stmt('TBC Bank', 'GE00TB0000000000000002', [
      row('2026-03-01', 'expense', 51, 'POS - EGREVE.BOG.GE', { merchant: 'EGREVE.BOG.GE', mcc: '6012', bankCategory: 'თანხის განაღდება', time: '2026-03-01T10:00' }),
      row('2026-03-05', 'expense', 100, 'პირადი გადარიცხვა', { counterparty: 'ნინო ბერიძე', counterpartyAccount: 'GE00TB0000000000000077' }),
      row('2026-03-12', 'income', 60, 'პირადი გადარიცხვა', { counterparty: 'NINO BERIDZE', counterpartyAccount: 'GE00BG0000000000000078' }),
      row('2026-03-14', 'expense', 70, 'პირადი გადარიცხვა', { counterparty: 'გიორგი კაპანაძე', counterpartyAccount: 'GE00TB0000000000000079' }),
      row('2026-03-20', 'income', 70, 'პირადი გადარიცხვა', { counterparty: 'GIORGI KAPANADZE', counterpartyAccount: 'GE00BG0000000000000080' }),
    ]), null);
    await approve(db, bog); await approve(db, tbc); // no manual confirmation of the BOG/TBC pair
    expect(db.prepare("SELECT status FROM import_matches").pluck().all()).toEqual(['confirmed']);
    const sum = (k: string) => db.prepare('SELECT ROUND(COALESCE(SUM(amount_gel),0),2) FROM transactions WHERE kind = ?').pluck().get(k);
    // the 50/51 pair is a transfer (+1 fee); 100 lent vs 60 back can't be netted leg by leg, so both stay and the net (−40) is right
    expect(sum('income')).toBe(360); expect(sum('expense')).toBe(101);
    expect((people(db) as any).people.map((p: any) => [p.sent, p.received])).toEqual([[100, 60], [70, 70]]); // ranked by sent; the 70/70 loan is netted out
    expect(await migrateAnalyticsFix(db)).toBeFalsy(); // fresh installs: already correct, migration is a no-op the second time
  });
});

import { reconcileRecurring, restoreReconciled } from '../src/reconcile';
import { transactionDate } from '../src/statements/parse';
describe('v1.2.2 balances, recurring duplicates, transaction dates', () => {
  it('balance entered now ignores same-day items added before it, unconfirmed auto-posts and older dates', () => {
    const db = openDb(':memory:');
    const id = Number(db.prepare("INSERT INTO accounts (name, type, currency, opening_balance, opening_date, opening_at) VALUES ('BOG','bank','GEL',-5.89,'2026-10-20','2026-10-20 10:00:00')").run().lastInsertRowid);
    db.prepare("INSERT INTO recurring (id, kind, name, amount, currency, unit, interval, start_date) VALUES (1,'income','Pay',450,'GEL','week',2,'2026-10-21')").run();
    const add = (o: any) => db.prepare("INSERT INTO transactions (kind, amount, currency, amount_gel, date, account_id, recurring_id, confirmed, created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(o.kind, o.a, 'GEL', o.a, o.date, id, o.rec ?? null, o.conf ?? 1, o.at);
    add({ kind: 'income', a: 450, date: '2026-10-20', rec: null, at: '2026-10-20 09:00:00' }); // added earlier the same day: already in the balance
    add({ kind: 'income', a: 450, date: '2026-10-21', rec: 1, conf: 0, at: '2026-10-20 11:00:00' }); // planned by a rule
    add({ kind: 'expense', a: 9, date: '2026-09-01', at: '2026-10-20 11:00:00' }); // back-dated
    expect(accountBalances(db).find((a: any) => a.id === id)!.balance_gel).toBe(-5.89);
    add({ kind: 'expense', a: 4, date: '2026-10-20', at: '2026-10-20 10:00:01' }); // a real payment after entering the balance
    expect(accountBalances(db).find((a: any) => a.id === id)!.balance_gel).toBe(-9.89);
    db.prepare("UPDATE accounts SET opening_balance = 1 WHERE id = ?").run(id); // re-entering the balance re-anchors it
    expect(accountBalances(db).find((a: any) => a.id === id)!.balance_gel).toBe(1);
  });
  it('one imported payment covering two planned rent entries removes them, undoably', () => {
    const db = openDb(':memory:'); const rent = cat(db, 'rent');
    const rid = Number(db.prepare("INSERT INTO recurring (kind, name, amount, currency, category_id, unit, interval, start_date) VALUES ('expense','Rent',500,'GEL',?,'month',1,'2026-09-07')").run(rent).lastInsertRowid);
    for (const d of ['2026-09-07', '2026-10-07']) db.prepare("INSERT INTO transactions (kind, amount, currency, amount_gel, date, category_id, recurring_id, confirmed) VALUES ('expense',500,'GEL',500,?,?,?,0)").run(d, rent, rid);
    const b = Number(db.prepare("INSERT INTO import_batches (filename, bank, currency, row_count) VALUES ('s.pdf','TBC Bank','GEL',1)").run().lastInsertRowid);
    const imp = Number(db.prepare("INSERT INTO transactions (kind, amount, currency, amount_gel, date, category_id, import_batch_id) VALUES ('expense',1000,'GEL',1000,'2026-10-07',?,?)").run(rent, b).lastInsertRowid);
    expect(reconcileRecurring(db)).toMatchObject({ removed: 2, payments: 1 });
    expect(db.prepare("SELECT SUM(amount_gel) FROM transactions WHERE category_id = ?").pluck().get(rent)).toBe(1000);
    expect(restoreReconciled(db, [imp]).restored).toBe(2);
    expect(db.prepare("SELECT SUM(amount_gel) FROM transactions WHERE category_id = ?").pluck().get(rent)).toBe(2000);
  });
  it('uses the transaction date printed in the text, not the booking date', () => {
    expect(transactionDate('POS - Shop, Oct 05 2026 12:01, MCC:5411', '2026-10-07')).toBe('2026-10-05');
    expect(transactionDate('გადახდა 05.10.2026', '2026-10-06')).toBe('2026-10-05');
    expect(transactionDate('contract 01.01.2020', '2026-10-06')).toBe('2026-10-06');
  });
});
describe('recurring salary rule', () => {
  it('maps Salary to Income › Salary and a deleted occurrence is never re-posted', async () => {
    const { materialize } = await import('../src/services');
    const { skipRecurringOf, migrateSalaryRules } = await import('../src/reconcile');
    const db = openDb(':memory:');
    const rid = Number(db.prepare("INSERT INTO recurring (kind, name, amount, currency, category_id, unit, interval, start_date) VALUES ('income','Salary',450,'GEL',?,'week',2,?)").run(cat(db, 'gifts'), todayISO()).lastInsertRowid);
    migrateSalaryRules(db);
    expect(db.prepare('SELECT category_id FROM recurring WHERE id = ?').pluck().get(rid)).toBe(cat(db, 'salary'));
    await materialize(db);
    const t = db.prepare('SELECT id, confirmed FROM transactions WHERE recurring_id = ?').get(rid) as any; expect(t.confirmed).toBe(0);
    skipRecurringOf(db, t.id); db.prepare('DELETE FROM transactions WHERE id = ?').run(t.id);
    db.prepare('UPDATE recurring SET generated_until = NULL WHERE id = ?').run(rid); // e.g. after editing the rule
    await materialize(db);
    expect(db.prepare('SELECT COUNT(*) FROM transactions WHERE recurring_id = ?').pluck().get(rid)).toBe(0);
  });
});
