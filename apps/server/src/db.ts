import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, type DB } from './schema';
export * from './schema';

export const DATA_DIR = process.env.FA_DATA_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data');

export function openDb(file?: string): DB {
  const f = file ?? (fs.mkdirSync(DATA_DIR, { recursive: true }), path.join(DATA_DIR, 'finance.db'));
  const db = new Database(f);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return initDb(db as unknown as DB);
}
