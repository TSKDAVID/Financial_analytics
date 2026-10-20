// v1.4 cash-flow reconciliation — synthetic data only.
import { describe, it, expect } from 'vitest';
import { openDb } from '../src/db';
import { linkImportAccounts, dedupeLoanPayments, guessAccountForBank } from '../src/cashflow';
import { refreshPeopleNetting } from '../src/statements/service';
import { runPlan } from '../src/plan';
import { dashboard } from '../src/analytics';

const cat = (db: any, key: string) => db.prepare('SELECT id FROM categories WHERE key = ?').pluck().get(key);
function setup() {
  const db = openDb(':memory:');
  const a = Number(db.prepare("INSERT INTO accounts (name, type, currency, opening_balance, opening_date, bank) VALUES ('Bank Of Georgia','bank','GEL',-6,'2026-03-31','Bank Of Georgia')").run().lastInsertRowid);
  const b = Number(db.prepare("INSERT INTO accounts (name, type, currency, opening_balance, opening_date, bank) VALUES ('TBC','bank','GEL',2,'2026-03-31','TBC')").run().lastInsertRowid);
  const batch = (bank: string) => Number(db.prepare("INSERT INTO import_batches (filename, bank, currency, status) VALUES ('s.pdf', ?, 'GEL', 'approved')").run(bank).lastInsertRowid);
  const bog = batch('Bank of Georgia'), tbc = batch('TBC Bank');
  let idx = 0;
  const add = (bt: number, dir: 'income' | 'expense', kind: string, amount: number, date: string, o: any = {}) => {
    const t = Number(db.prepare('INSERT INTO transactions (kind, amount, currency, amount_gel, date, category_id, description, tx_kind, counterparty, import_batch_id, loan_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(kind, amount, 'GEL', amount, date, o.cat ?? null, o.desc ?? null, o.txk ?? null, o.cp ?? null, bt, o.loan ?? null).lastInsertRowid);
    db.prepare('INSERT INTO import_rows (batch_id, idx, date, description, amount, currency, kind, transaction_id, tx_kind) VALUES (?,?,?,?,?,?,?,?,?)').run(bt, idx++, date, o.desc ?? '', amount, 'GEL', dir, t, o.txk ?? null);
    return t;
  };
  return { db, a, b, bog, tbc, add };
}

describe('imports are tied to their bank account', () => {
  it('guesses the single matching account by bank name', () => {
    const { db, a, b } = setup();
    expect(guessAccountForBank(db, 'Bank of Georgia')).toBe(a);
    expect(guessAccountForBank(db, 'TBC Bank')).toBe(b);
    expect(guessAccountForBank(db, 'Liberty')).toBeNull();
  });
});

describe('reconciliation: lines explain the real balance change', () => {
  it('a month where spending ≈ income: rent, loans, people, savings and an untracked own account', () => {
    const { db, a, b, bog, tbc, add } = setup();
    add(tbc, 'income', 'income', 1000, '2026-03-02', { cat: cat(db, 'salary'), txk: 'salary' });
    add(tbc, 'expense', 'expense', 600, '2026-03-07', { cat: cat(db, 'p2p_out'), txk: 'transfer_out', cp: 'Landlord Person', desc: 'მარტის ქირა' });
    add(bog, 'expense', 'expense', 300, '2026-03-10', { cat: cat(db, 'groceries'), txk: 'purchase' });
    add(bog, 'expense', 'expense', 88, '2026-03-12', { cat: cat(db, 'loans'), txk: 'loan_repayment' });
    add(bog, 'expense', 'expense', 5, '2026-03-12', { cat: cat(db, 'fees'), txk: 'fee', desc: 'insurance' });
    add(bog, 'expense', 'transfer', 2, '2026-03-13', { txk: 'internal', desc: 'ელექტრონულ ყულაბაზე დაგროვილი თანხის ანაბარზე გადატანა' });
    add(tbc, 'expense', 'transfer', 50, '2026-03-14', { txk: 'transfer_out', cp: 'Friend One' });
    add(bog, 'income', 'transfer', 50, '2026-03-20', { txk: 'transfer_in', cp: 'Friend One' });
    add(bog, 'income', 'transfer', 30, '2026-03-21', { txk: 'internal', desc: 'own business account' });
    linkImportAccounts(db); refreshPeopleNetting(db);
    // the rent was recognised from its description: spending, not a friend's flow
    const d: any = dashboard(db, '2026-03-01', '2026-03-31');
    expect(d.expense).toBe(993);
    const r = d.reconciliation;
    const L = Object.fromEntries(r.lines.map((l: any) => [l.key, l.amount]));
    expect(L.income).toBe(1000); expect(L.spending).toBe(-905); expect(L.debt).toBe(-88); expect(L.people).toBe(0); expect(L.savings).toBe(-2); expect(L.ownOther).toBe(30);
    expect(r.change).toBe(35); expect(r.unexplained).toBe(0);
    expect(r.end).toBe(-4); expect(r.start).toBe(-39);
    expect(r.accounts.find((x: any) => x.id === a).end).toBe(-6); expect(r.accounts.find((x: any) => x.id === b).end).toBe(2);
  });
});

describe('loan installments are not counted twice', () => {
  it('a bill marked paid in the app is dropped when the statement has the bank payment', () => {
    const { db, bog, add } = setup();
    const loan = Number(db.prepare("INSERT INTO loans (name, bank, principal, currency, annual_rate, term_months, start_date) VALUES ('L','BOG',1000,'GEL',20,24,'2026-01-26')").run().lastInsertRowid);
    add(bog, 'expense', 'expense', 24.39, '2026-03-02', { cat: cat(db, 'loans'), txk: 'loan_repayment' });
    add(bog, 'expense', 'expense', 1, '2026-03-02', { cat: cat(db, 'insurance'), txk: 'fee' });
    db.prepare('DELETE FROM bills').run();
    db.prepare("INSERT INTO bills (loan_id, name, due_date, amount, currency, paid) VALUES (?, 'L', '2026-02-26', 25.39, 'GEL', 1)").run(loan);
    const manual = Number(db.prepare("INSERT INTO transactions (kind, amount, currency, amount_gel, date, loan_id, category_id) VALUES ('expense', 25.39, 'GEL', 25.39, '2026-03-20', ?, ?)").run(loan, cat(db, 'loans')).lastInsertRowid);
    db.prepare("INSERT INTO bills (loan_id, name, due_date, amount, currency, paid, transaction_id) VALUES (?, 'L', '2026-03-26', 25.39, 'GEL', 1, ?)").run(loan, manual);
    expect(dedupeLoanPayments(db)).toHaveLength(1);
    expect(db.prepare('SELECT COUNT(*) FROM transactions WHERE id = ?').pluck().get(manual)).toBe(0);
  });
});

describe('forecast tab', () => {
  it('empty database: no made-up numbers', () => {
    const db = openDb(':memory:');
    const p: any = runPlan(db, null);
    expect(p.empty).toBe(true); expect(p.defaults.incomes).toEqual([]); expect(p.defaults.expenses).toBe(0); expect(p.months).toHaveLength(24);
  });
  it('uses real loans; overpaying saves interest', () => {
    const db = openDb(':memory:');
    const id = Number(db.prepare("INSERT INTO loans (name, bank, principal, currency, annual_rate, term_months, start_date) VALUES ('L','BOG',2000,'GEL',30,48,'2026-10-13')").run().lastInsertRowid);
    const base: any = runPlan(db, { months: 60 });
    const over: any = runPlan(db, { months: 60, debtExtra: { [id]: 50 } });
    expect(base.defaults.debts).toHaveLength(1);
    expect(over.interestSaved).toBeGreaterThan(0);
    expect(over.debts[0].payoffMonth).toBeLessThan(base.debts[0].payoffMonth);
  });
});
