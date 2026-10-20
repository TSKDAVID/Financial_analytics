import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type DB = Database.Database;

export const DATA_DIR = process.env.FA_DATA_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data');

const SCHEMA = `
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
  { key: 'other_expense', name: 'Other', kind: 'expense', color: '#94a3b8', icon: 'circle' },
];

export function openDb(file?: string): DB {
  const f = file ?? (fs.mkdirSync(DATA_DIR, { recursive: true }), path.join(DATA_DIR, 'finance.db'));
  const db = new Database(f);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  seedBuiltins(db);
  return db;
}

export function seedBuiltins(db: DB) {
  const ins = db.prepare('INSERT OR IGNORE INTO categories (key,name,kind,color,icon,essential,builtin,parent_id) VALUES (?,?,?,?,?,?,1,(SELECT id FROM categories WHERE key = ?))');
  db.transaction(() => { for (const c of BUILTIN_CATEGORIES) ins.run(c.key, c.name, c.kind, c.color, c.icon, c.essential ? 1 : 0, c.parent ?? null); })();
  const defaults: Record<string, string> = {
    baseCurrency: 'GEL', minBalance: '300', language: 'en', theme: 'system', lowBalanceDays: '30',
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
