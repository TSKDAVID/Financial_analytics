import * as SQLite from 'expo-sqlite';
import type { DB } from '../../../server/src/schema';
import { wrap } from './wrap';

export function openLocalDb(name = 'finance.db'): DB {
  const raw = SQLite.openDatabaseSync(name);
  raw.execSync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  return wrap(raw as any);
}
