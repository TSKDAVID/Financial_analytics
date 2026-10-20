// Pure schema + settings helpers, shared by the Node server and the offline Android app (no Node imports here).
import { migrateImports } from './statements/service';
import { migrateCredit } from './credit/service';
import { migrateSync } from './sync/track';
import { migrateTerms } from './terms/service';

export interface Stmt {
  get(...params: any[]): unknown; all(...params: any[]): unknown[];
  run(...params: any[]): { changes: number; lastInsertRowid: number | bigint };
  pluck(toggle?: boolean): Stmt;
}
/** Minimal subset of the better-sqlite3 API; the phone provides an expo-sqlite implementation. */
export interface DB {
  prepare(sql: string): Stmt; exec(sql: string): unknown; pragma(s: string): unknown;
  close?(): unknown;
  transaction<F extends (...args: any[]) => any>(fn: F): F;
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('cash','bank','card','savings')),
  currency TEXT NOT NULL DEFAULT 'GEL', opening_balance REAL NOT NULL DEFAULT 0, color TEXT NOT NULL DEFAULT '#6366f1',
  bank TEXT, liquid INTEGER NOT NULL DEFAULT 1, archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY, key TEXT UNIQUE, name TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
  parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE, color TEXT NOT NULL, icon TEXT NOT NULL,
  essential INTEGER NOT NULL DEFAULT 0, builtin INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS recurring (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'GEL',
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL, category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  notes TEXT, tags TEXT NOT NULL DEFAULT '[]', unit TEXT NOT NULL, interval INTEGER NOT NULL DEFAULT 1,
  start_date TEXT NOT NULL, end_date TEXT, count INTEGER, generated_until TEXT, auto_post INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS loans (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, bank TEXT NOT NULL, principal REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'GEL',
  annual_rate REAL NOT NULL, term_months INTEGER NOT NULL, start_date TEXT NOT NULL, extra_monthly REAL NOT NULL DEFAULT 0,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL, notes TEXT, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'subscription' CHECK (kind IN ('subscription','bill')),
  amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'GEL', unit TEXT NOT NULL DEFAULT 'month', interval INTEGER NOT NULL DEFAULT 1,
  start_date TEXT NOT NULL, category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL, account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  provider TEXT, last_used TEXT, variable INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, notes TEXT);
CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY, subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE CASCADE, loan_id INTEGER REFERENCES loans(id) ON DELETE CASCADE,
  name TEXT NOT NULL, due_date TEXT NOT NULL, amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'GEL',
  paid INTEGER NOT NULL DEFAULT 0, paid_date TEXT, transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
  UNIQUE(subscription_id, due_date), UNIQUE(loan_id, due_date));
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('income','expense','transfer')), amount REAL NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'GEL', rate REAL NOT NULL DEFAULT 1, amount_gel REAL NOT NULL, date TEXT NOT NULL,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL, to_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL, description TEXT, notes TEXT, tags TEXT NOT NULL DEFAULT '[]',
  recurring_id INTEGER REFERENCES recurring(id) ON DELETE SET NULL, loan_id INTEGER REFERENCES loans(id) ON DELETE SET NULL,
  subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE SET NULL, rate_manual INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS tx_date ON transactions(date);
CREATE INDEX IF NOT EXISTS tx_cat ON transactions(category_id);
CREATE TABLE IF NOT EXISTS rates (date TEXT NOT NULL, code TEXT NOT NULL, rate REAL NOT NULL, manual INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (date, code));
CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY, category_id INTEGER NOT NULL UNIQUE REFERENCES categories(id) ON DELETE CASCADE, amount REAL NOT NULL, rollover INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, target REAL NOT NULL, saved REAL NOT NULL DEFAULT 0, target_date TEXT,
  color TEXT NOT NULL DEFAULT '#10b981', icon TEXT NOT NULL DEFAULT 'target', account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, type TEXT NOT NULL, severity TEXT NOT NULL CHECK (severity IN ('info','warning','danger')),
  title TEXT NOT NULL, body TEXT NOT NULL, ref_type TEXT, ref_id INTEGER, due_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), read INTEGER NOT NULL DEFAULT 0, dismissed INTEGER NOT NULL DEFAULT 0,
  snoozed_until TEXT, pushed INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, push_token TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), last_seen TEXT);
`;

export interface BuiltinCat { key: string; name: string; kind: 'income' | 'expense'; color: string; icon: string; parent?: string; essential?: boolean }
export const BUILTIN_CATEGORIES: BuiltinCat[] = [
  { key: 'salary', name: 'Salary', kind: 'income', color: '#10b981', icon: 'briefcase' },
  { key: 'freelance', name: 'Freelance', kind: 'income', color: '#14b8a6', icon: 'laptop' },
  { key: 'business', name: 'Business', kind: 'income', color: '#0ea5e9', icon: 'building' },
  { key: 'rental', name: 'Rental', kind: 'income', color: '#6366f1', icon: 'home' },
  { key: 'gifts', name: 'Gifts', kind: 'income', color: '#ec4899', icon: 'gift' },
  { key: 'other_income', name: 'Other income', kind: 'income', color: '#84cc16', icon: 'plus-circle' },
  { key: 'p2p_in', name: 'From people', kind: 'income', color: '#2dd4bf', icon: 'users' },
  { key: 'interest_income', name: 'Interest', kind: 'income', color: '#4ade80', icon: 'percent' },
  { key: 'refunds', name: 'Refunds & cashback', kind: 'income', color: '#a3e635', icon: 'rotate-ccw' },
  { key: 'loans', name: 'Loans', kind: 'expense', color: '#ef4444', icon: 'landmark', essential: true },
  { key: 'subscriptions', name: 'Subscriptions', kind: 'expense', color: '#a855f7', icon: 'repeat' },
  { key: 'utilities', name: 'Utilities', kind: 'expense', color: '#f59e0b', icon: 'zap', essential: true },
  { key: 'electricity', name: 'Electricity', kind: 'expense', color: '#facc15', icon: 'zap', parent: 'utilities', essential: true },
  { key: 'gas', name: 'Gas', kind: 'expense', color: '#fb923c', icon: 'flame', parent: 'utilities', essential: true },
  { key: 'water', name: 'Water', kind: 'expense', color: '#38bdf8', icon: 'droplet', parent: 'utilities', essential: true },
  { key: 'internet', name: 'Internet', kind: 'expense', color: '#818cf8', icon: 'wifi', parent: 'utilities', essential: true },
  { key: 'phone', name: 'Phone', kind: 'expense', color: '#c084fc', icon: 'smartphone', parent: 'utilities', essential: true },
  { key: 'rent', name: 'Rent / Mortgage', kind: 'expense', color: '#f43f5e', icon: 'home', essential: true },
  { key: 'groceries', name: 'Groceries', kind: 'expense', color: '#22c55e', icon: 'shopping-cart', essential: true },
  { key: 'transport', name: 'Transport', kind: 'expense', color: '#06b6d4', icon: 'car', essential: true },
  { key: 'health', name: 'Health', kind: 'expense', color: '#e11d48', icon: 'heart-pulse', essential: true },
  { key: 'insurance', name: 'Insurance', kind: 'expense', color: '#64748b', icon: 'shield', essential: true },
  { key: 'education', name: 'Education', kind: 'expense', color: '#3b82f6', icon: 'graduation-cap' },
  { key: 'entertainment', name: 'Entertainment', kind: 'expense', color: '#d946ef', icon: 'film' },
  { key: 'shopping', name: 'Shopping', kind: 'expense', color: '#f97316', icon: 'shopping-bag' },
  { key: 'dining', name: 'Dining & cafés', kind: 'expense', color: '#fb7185', icon: 'utensils' },
  { key: 'travel', name: 'Travel', kind: 'expense', color: '#0891b2', icon: 'plane' },
  { key: 'cash', name: 'Cash withdrawals', kind: 'expense', color: '#78716c', icon: 'banknote' },
  { key: 'fees', name: 'Bank fees', kind: 'expense', color: '#9ca3af', icon: 'receipt' },
  { key: 'taxes', name: 'Taxes & government', kind: 'expense', color: '#475569', icon: 'landmark' },
  { key: 'p2p_out', name: 'To people', kind: 'expense', color: '#5eead4', icon: 'users' },
  { key: 'other_expense', name: 'Other', kind: 'expense', color: '#94a3b8', icon: 'circle' },
];

/** Create tables, seed built-ins and run all migrations. */
export function initDb(db: DB) {
  db.exec(SCHEMA);
  seedBuiltins(db);
  migrateImports(db);
  migrateCredit(db);
  migrateLoans(db);
  migrateBillTracking(db);
  migrateTerms(db);
  migrateSync(db);
  // v1.2: minimum balance is no longer pre-set (old untouched default was 300)
  if (!getSetting(db, 'minBalanceMigrated')) { if (getSetting(db, 'minBalance') === '300') setSetting(db, 'minBalance', ''); setSetting(db, 'minBalanceMigrated', '1'); }
  return db;
}

/** v1.3: monthly-payment override, revolving credit lines (cards/overdrafts) and a balance/payment update history. */
export const REVOLVING_KINDS = ['credit_card', 'overdraft', 'credit_line'];
export function migrateLoans(db: DB) {
  const cols = (db.prepare('PRAGMA table_info(loans)').all() as { name: string }[]).map((c) => c.name);
  const add = (c: string, def: string) => { if (!cols.includes(c)) db.exec(`ALTER TABLE loans ADD COLUMN ${c} ${def}`); };
  add('monthly_payment', 'REAL'); add('payment_pct', 'REAL'); add('min_payment', 'REAL'); add('credit_limit', 'REAL');
  add('due_day', 'INTEGER'); add('needs_input', 'INTEGER NOT NULL DEFAULT 0'); add('balance_date', 'TEXT'); add('monthly_fee', 'REAL NOT NULL DEFAULT 0'); // e.g. life insurance charged with every payment
  db.exec(`CREATE TABLE IF NOT EXISTS loan_updates (
    id INTEGER PRIMARY KEY, loan_id INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE, date TEXT NOT NULL,
    balance REAL, monthly_payment REAL, payment_pct REAL, annual_rate REAL, prev TEXT NOT NULL DEFAULT '{}', note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  if (!getSetting(db, 'loansV13')) {
    // revolving lines imported before v1.3 were modelled as 12-month 0% loans with a guessed payment: flag them for review
    // their 12-month term was a guess, not from the report
    db.prepare(`UPDATE loans SET term_months = 0 WHERE kind IN ('credit_card','overdraft') AND import_report_id IS NOT NULL AND monthly_payment IS NULL AND payment_pct IS NULL`).run();
    db.prepare(`UPDATE loans SET needs_input = 1, balance_date = COALESCE(balance_date, start_date) WHERE kind IN ('credit_card','overdraft') AND monthly_payment IS NULL AND payment_pct IS NULL`).run();
    setSetting(db, 'loansV13', '1');
  }
}

export function seedBuiltins(db: DB) {
  const ins = db.prepare('INSERT OR IGNORE INTO categories (key,name,kind,color,icon,essential,builtin,parent_id) VALUES (?,?,?,?,?,?,1,(SELECT id FROM categories WHERE key = ?))');
  db.transaction(() => { for (const c of BUILTIN_CATEGORIES) ins.run(c.key, c.name, c.kind, c.color, c.icon, c.essential ? 1 : 0, c.parent ?? null); })();
  const defaults: Record<string, string> = {
    baseCurrency: 'GEL', minBalance: '', language: 'en', theme: 'system', lowBalanceDays: '30',
    ntfyServer: 'https://ntfy.sh', ntfyTopic: '', expoPush: '1', desktopNotifications: '1', emergencyTargetMonths: '6',
  };
  const s = db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)');
  for (const [k, v] of Object.entries(defaults)) s.run(k, v);
}

export function getSetting(db: DB, key: string): string | undefined {
  return (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;
}
export function setSetting(db: DB, key: string, value: string) {
  db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

/**
 * v1.4: loan installments due before the loan was added to the app are history (already reflected in the
 * imported balance): marking them paid never creates an expense. Late payments are recorded on their due date.
 * One-time clean-up of transactions created the old way; the summary is kept in settings for the user to see.
 */
export function migrateBillTracking(db: DB) {
  const lc = (db.prepare('PRAGMA table_info(loans)').all() as { name: string }[]).map((c) => c.name);
  if (!lc.includes('tracked_from')) db.exec('ALTER TABLE loans ADD COLUMN tracked_from TEXT');
  const bc = (db.prepare('PRAGMA table_info(bills)').all() as { name: string }[]).map((c) => c.name);
  if (!bc.includes('historical')) db.exec('ALTER TABLE bills ADD COLUMN historical INTEGER NOT NULL DEFAULT 0');
  db.exec(`CREATE TRIGGER IF NOT EXISTS loans_tracked_from AFTER INSERT ON loans WHEN NEW.tracked_from IS NULL
    BEGIN UPDATE loans SET tracked_from = date('now','localtime') WHERE id = NEW.id; END;`);
  if (getSetting(db, 'billsV14')) return;
  const hasReports = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='credit_reports'").get();
  db.transaction(() => {
    // imported loans: tracking starts on the import date; manual ones keep their start date
    if (hasReports) db.exec(`UPDATE loans SET tracked_from = (SELECT date(created_at) FROM credit_reports r WHERE r.id = loans.import_report_id) WHERE tracked_from IS NULL AND import_report_id IS NOT NULL`);
    db.exec('UPDATE loans SET tracked_from = start_date WHERE tracked_from IS NULL');
    const pre = db.prepare(`SELECT b.id, b.name, b.due_date, b.amount, b.currency, b.transaction_id, t.date AS tx_date FROM bills b JOIN loans l ON l.id = b.loan_id
      JOIN transactions t ON t.id = b.transaction_id WHERE b.paid = 1 AND b.due_date < l.tracked_from`).all() as any[];
    for (const b of pre) {
      db.prepare('DELETE FROM transactions WHERE id = ?').run(b.transaction_id);
      db.prepare('UPDATE bills SET transaction_id = NULL, historical = 1, paid_date = due_date WHERE id = ?').run(b.id);
    }
    const late = db.prepare(`SELECT b.id, b.name, b.due_date, b.amount, b.currency, b.transaction_id, t.date AS tx_date FROM bills b JOIN transactions t ON t.id = b.transaction_id
      WHERE b.paid = 1 AND t.date > b.due_date AND t.date = b.paid_date`).all() as any[];
    for (const b of late) {
      db.prepare('UPDATE transactions SET date = ? WHERE id = ?').run(b.due_date, b.transaction_id);
      db.prepare('UPDATE bills SET paid_date = due_date WHERE id = ?').run(b.id);
    }
    const sum = (a: any[]) => Math.round(a.reduce((s, b) => s + b.amount, 0) * 100) / 100;
    setSetting(db, 'billCleanup', JSON.stringify({ at: new Date().toISOString(), removed: pre.map(({ name, due_date, amount, currency, tx_date }) => ({ name, due_date, amount, currency, tx_date })), removedTotal: sum(pre),
      redated: late.map(({ name, due_date, amount, currency, tx_date }) => ({ name, due_date, amount, currency, tx_date })), seen: pre.length + late.length === 0 }));
    setSetting(db, 'billsV14', '1');
  })();
}
