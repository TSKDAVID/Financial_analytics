import { addDays, addMonths, startOfMonth, todayISO } from '@fa/core';
import type { DB } from './schema';
import { seedBuiltins } from './schema';
import { catId, insertTransaction, materialize, payBill } from './services';

const DATA_TABLES = ['bills', 'transactions', 'recurring', 'subscriptions', 'loans', 'budgets', 'goals', 'alerts', 'accounts'];
export function resetData(db: DB) {
  db.transaction(() => { for (const t of DATA_TABLES) db.prepare(`DELETE FROM ${t}`).run(); db.prepare('DELETE FROM categories WHERE builtin = 0').run(); })();
  seedBuiltins(db);
}

function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }

/** Realistic 14-month demo dataset for a Tbilisi household. Replaces existing data. */
export async function seedDemo(db: DB) {
  resetData(db);
  const rand = rng(42);
  const today = todayISO();
  const start = startOfMonth(addMonths(today, -14));
  const acc = (name: string, type: string, currency: string, opening: number, color: string, bank: string | null, liquid = 1) =>
    Number(db.prepare('INSERT INTO accounts (name, type, currency, opening_balance, color, bank, liquid) VALUES (?,?,?,?,?,?,?)').run(name, type, currency, opening, color, bank, liquid).lastInsertRowid);
  const tbc = acc('TBC Card', 'card', 'GEL', 2500, '#0ea5e9', 'TBC Bank');
  const bog = acc('Bank of Georgia', 'bank', 'GEL', 1800, '#f97316', 'Bank of Georgia');
  const usd = acc('USD Account', 'bank', 'USD', 400, '#22c55e', 'TBC Bank');
  const cash = acc('Cash', 'cash', 'GEL', 300, '#a3a3a3', null);
  const savings = acc('Savings', 'savings', 'GEL', 6000, '#8b5cf6', 'Bank of Georgia');
  const C = (k: string) => catId(db, k);

  const rec = (kind: string, name: string, amount: number, cur: string, account: number, cat: string, unit: string, interval: number, s: string, extra: Partial<{ end: string; count: number }> = {}) =>
    db.prepare('INSERT INTO recurring (kind, name, amount, currency, account_id, category_id, unit, interval, start_date, end_date, count, tags) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(kind, name, amount, cur, account, C(cat), unit, interval, s, extra.end ?? null, extra.count ?? null, '["recurring"]');
  rec('income', 'Salary – Company LLC', 5200, 'GEL', tbc, 'salary', 'month', 1, addDays(start, 24));
  rec('income', 'Apartment rent income', 900, 'GEL', bog, 'rental', 'month', 1, addDays(start, 4));
  rec('expense', 'Rent – Vake apartment', 1500, 'GEL', tbc, 'rent', 'month', 1, addDays(start, 1));
  rec('expense', 'Gym membership', 120, 'GEL', tbc, 'health', 'month', 1, addDays(start, 9));
  rec('expense', 'Car insurance', 480, 'GEL', bog, 'insurance', 'month', 6, addDays(start, 14));
  rec('income', 'Pocket-money to self (weekly cash)', 0.01, 'GEL', cash, 'other_income', 'week', 2, start, { count: 1 });

  const loan = (name: string, bank: string, principal: number, rate: number, term: number, s: string, account: number) =>
    db.prepare('INSERT INTO loans (name, bank, principal, annual_rate, term_months, start_date, account_id) VALUES (?,?,?,?,?,?,?)').run(name, bank, principal, rate, term, s, account);
  loan('Car loan', 'TBC Bank', 24000, 13.5, 48, addDays(addMonths(start, -6), 14), tbc);
  loan('Consumer loan', 'Bank of Georgia', 6000, 19.9, 24, addDays(addMonths(start, 2), 9), bog);
  loan('Laptop installment', 'Space Bank', 3600, 0, 12, addDays(addMonths(start, 6), 19), tbc);

  const sub = (name: string, kind: string, amount: number, cur: string, unit: string, interval: number, s: string, cat: string, provider: string | null, lastUsed: string | null, variable = 0) =>
    db.prepare('INSERT INTO subscriptions (name, kind, amount, currency, unit, interval, start_date, category_id, account_id, provider, last_used, variable) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(name, kind, amount, cur, unit, interval, s, C(cat), tbc, provider, lastUsed, variable);
  sub('Netflix', 'subscription', 15.49, 'USD', 'month', 1, addDays(start, 11), 'subscriptions', 'Netflix', addDays(today, -2));
  sub('Spotify Premium', 'subscription', 6.99, 'USD', 'month', 1, addDays(start, 3), 'subscriptions', 'Spotify', addDays(today, -1));
  sub('Spotify Family', 'subscription', 11.99, 'USD', 'month', 1, addDays(start, 17), 'subscriptions', 'Spotify', addDays(today, -80));
  sub('YouTube Premium', 'subscription', 13.99, 'GEL', 'month', 1, addDays(start, 7), 'subscriptions', 'YouTube', addDays(today, -95));
  sub('iCloud 200GB', 'subscription', 2.99, 'USD', 'month', 1, addDays(start, 21), 'subscriptions', 'Apple', addDays(today, -5));
  sub('Adobe Creative Cloud', 'subscription', 239.88, 'USD', 'year', 1, addDays(start, 40), 'subscriptions', 'Adobe', addDays(today, -20));
  sub('Electricity – Telasi', 'bill', 85, 'GEL', 'month', 1, addDays(start, 14), 'electricity', 'Telasi', null, 1);
  sub('Gas – Tbilisi Energy', 'bill', 60, 'GEL', 'month', 1, addDays(start, 17), 'gas', 'Tbilisi Energy', null, 1);
  sub('Water – GWP', 'bill', 18, 'GEL', 'month', 1, addDays(start, 19), 'water', 'GWP', null, 1);
  sub('Internet – Magti Fiber', 'bill', 55, 'GEL', 'month', 1, addDays(start, 5), 'internet', 'Magti', null);
  sub('Mobile – Cellfie', 'bill', 25, 'GEL', 'month', 1, addDays(start, 8), 'phone', 'Cellfie', null);

  await materialize(db, today);
  db.prepare("DELETE FROM recurring WHERE name LIKE 'Pocket-money%'").run();

  // pay past bills with seasonal/variable amounts; leave the current month's latest ones unpaid
  const bills = db.prepare('SELECT b.*, s.provider FROM bills b LEFT JOIN subscriptions s ON s.id = b.subscription_id WHERE b.due_date < ? ORDER BY b.due_date').all(addDays(today, -2)) as any[];
  const lastMonth = addMonths(today, -1).slice(0, 7);
  for (const b of bills) {
    const m = Number(b.due_date.slice(5, 7));
    const winter = [11, 12, 1, 2, 3].includes(m);
    let amount = b.amount;
    if (b.provider === 'Tbilisi Energy') amount = winter ? 140 + rand() * 60 : 18 + rand() * 12;
    if (b.provider === 'Telasi') amount = (winter ? 95 : 70) + rand() * 25 + (b.due_date.slice(0, 7) === lastMonth || b.due_date.slice(0, 7) === today.slice(0, 7) ? 120 : 0);
    if (b.provider === 'GWP') amount = 15 + rand() * 6;
    await payBill(db, b.id, { date: b.due_date, amount: Math.round(amount * 100) / 100 });
  }

  // variable spending
  const tx = (kind: 'income' | 'expense', amount: number, date: string, cat: string, account: number, description: string, tags: string[] = [], currency = 'GEL') =>
    insertTransaction(db, { kind, amount: Math.round(amount * 100) / 100, date, category_id: C(cat), account_id: account, description, tags, currency });
  const shops = ['Carrefour', 'Nikora', 'Spar', 'Goodwill', 'Agrohub', '2 Nabiji'];
  const fun = ['Wolt order', 'Glovo order', 'Cinema Amirani', 'Restaurant Barbarestan', 'Fabrika bar', 'Steam purchase'];
  for (let d = start; d <= today; d = addDays(d, 1)) {
    const dow = new Date(d + 'T00:00:00Z').getUTCDay();
    if (dow === 6 || rand() < 0.18) await tx('expense', 40 + rand() * 110, d, 'groceries', rand() < 0.8 ? tbc : cash, shops[Math.floor(rand() * shops.length)], ['food']);
    if (rand() < 0.35) await tx('expense', 4 + rand() * 18, d, 'transport', tbc, rand() < 0.6 ? 'Bolt ride' : 'Metro / bus', ['commute']);
    if (rand() < 0.07) await tx('expense', 80 + rand() * 40, d, 'transport', tbc, rand() < 0.5 ? 'Gulf fuel' : 'Wissol fuel', ['car']);
    if ((dow === 5 || dow === 6) && rand() < 0.6) await tx('expense', 25 + rand() * 90, d, 'entertainment', tbc, fun[Math.floor(rand() * fun.length)], ['fun']);
    if (rand() < 0.05) await tx('expense', 30 + rand() * 250, d, 'shopping', tbc, rand() < 0.5 ? 'Zara – East Point' : 'Amazon order', []);
    if (rand() < 0.03) await tx('expense', 15 + rand() * 80, d, 'health', tbc, 'Aversi pharmacy', ['health']);
    if (Number(d.slice(8)) === 12 && rand() < 0.75) await tx('income', 600 + rand() * 900, d, 'freelance', usd, 'Upwork – web project', ['side'], 'USD');
    if (Number(d.slice(8)) === 27) await insertTransaction(db, { kind: 'transfer', amount: 400, date: d, account_id: tbc, to_account_id: savings, description: 'Monthly transfer to savings' });
  }
  await tx('expense', 1850, addDays(today, -6), 'shopping', tbc, 'iPhone purchase – Zoommer', ['gadget']);
  await tx('expense', 420, addDays(today, -40), 'education', bog, 'Udemy + English course', ['learning']);
  await tx('income', 500, addDays(today, -70), 'gifts', cash, 'Birthday gift', []);

  db.prepare('INSERT INTO budgets (category_id, amount, rollover) VALUES (?,?,?)').run(C('groceries'), 1000, 1);
  db.prepare('INSERT INTO budgets (category_id, amount, rollover) VALUES (?,?,?)').run(C('entertainment'), 350, 0);
  db.prepare('INSERT INTO budgets (category_id, amount, rollover) VALUES (?,?,?)').run(C('transport'), 450, 0);
  db.prepare('INSERT INTO budgets (category_id, amount, rollover) VALUES (?,?,?)').run(C('shopping'), 400, 0);
  db.prepare('INSERT INTO budgets (category_id, amount, rollover) VALUES (?,?,?)').run(C('utilities'), 350, 0);
  db.prepare('INSERT INTO goals (name, target, saved, target_date, color, icon, account_id) VALUES (?,?,?,?,?,?,?)').run('Emergency fund', 20000, 9500, addMonths(today, 18), '#10b981', 'shield', savings);
  db.prepare('INSERT INTO goals (name, target, saved, target_date, color, icon) VALUES (?,?,?,?,?,?)').run('Summer trip to Italy', 6000, 2100, addMonths(today, 8), '#0ea5e9', 'plane');
  db.prepare('INSERT INTO goals (name, target, saved, target_date, color, icon) VALUES (?,?,?,?,?,?)').run('New car down payment', 15000, 1200, addMonths(today, 30), '#f59e0b', 'car');
  db.prepare("INSERT INTO categories (name, kind, color, icon, parent_id) VALUES ('Coffee', 'expense', '#92400e', 'coffee', ?)").run(C('entertainment'));
  db.prepare("UPDATE settings SET value = '1500' WHERE key = 'minBalance'").run();
}
