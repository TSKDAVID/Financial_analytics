import type { DB } from '../schema';

/**
 * Change tracking for two-way sync. Every synced table gets a stable global id (gid), updated_at (ms ISO, UTC)
 * and updated_by (device id). Triggers maintain them for all code paths; deletes leave tombstones.
 * gids are deterministic where both devices may create the "same" row independently (built-in categories,
 * generated bills, auto-posted recurring transactions, rates, settings) so they merge instead of duplicating.
 */
export const SYNC_TABLES: Record<string, { fks: Record<string, string>; label: string; gid?: string }> = {
  accounts: { fks: {}, label: 'name' },
  categories: { fks: { parent_id: 'categories' }, label: 'name', gid: "CASE WHEN NEW.key IS NOT NULL THEN 'cat:' || NEW.key END" },
  recurring: { fks: { account_id: 'accounts', category_id: 'categories' }, label: 'name' },
  loans: { fks: { account_id: 'accounts' }, label: 'name', gid: "CASE WHEN NEW.external_id IS NOT NULL THEN 'loan:' || NEW.external_id END" },
  subscriptions: { fks: { category_id: 'categories', account_id: 'accounts' }, label: 'name' },
  transactions: { fks: { account_id: 'accounts', to_account_id: 'accounts', category_id: 'categories', recurring_id: 'recurring', loan_id: 'loans', subscription_id: 'subscriptions' }, label: 'description',
    gid: "CASE WHEN NEW.recurring_id IS NOT NULL THEN 'rtx:' || (SELECT gid FROM recurring WHERE id = NEW.recurring_id) || ':' || NEW.date END" },
  bills: { fks: { subscription_id: 'subscriptions', loan_id: 'loans', transaction_id: 'transactions' }, label: 'name',
    gid: "CASE WHEN NEW.subscription_id IS NOT NULL THEN 'sbill:' || (SELECT gid FROM subscriptions WHERE id = NEW.subscription_id) || ':' || NEW.due_date WHEN NEW.loan_id IS NOT NULL THEN 'lbill:' || (SELECT gid FROM loans WHERE id = NEW.loan_id) || ':' || NEW.due_date END" },
  budgets: { fks: { category_id: 'categories' }, label: 'category_id', gid: "'budget:' || (SELECT gid FROM categories WHERE id = NEW.category_id)" },
  goals: { fks: { account_id: 'accounts' }, label: 'name' },
  loan_updates: { fks: { loan_id: 'loans' }, label: 'date' },
};
/** Settings that never leave a device. */
export const LOCAL_SETTINGS = ['deviceId', 'lockHash', 'syncApplying', 'groqKey', 'openaiKey', 'ollamaUrl', 'openaiBaseUrl', 'lastSync', 'desktopNotifications'];

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const DEV = "(SELECT value FROM settings WHERE key = 'deviceId')";
const APPLYING = "COALESCE((SELECT value FROM settings WHERE key = 'syncApplying'), '0') = '1'";

export function migrateSync(db: DB) {
  if (!db.prepare("SELECT value FROM settings WHERE key = 'deviceId'").get()) db.prepare("INSERT INTO settings (key, value) VALUES ('deviceId', lower(hex(randomblob(8))))").run();
  db.exec(`CREATE TABLE IF NOT EXISTS sync_tombstones (tbl TEXT NOT NULL, gid TEXT NOT NULL, deleted_at TEXT NOT NULL, deleted_by TEXT, PRIMARY KEY (tbl, gid));
    CREATE TABLE IF NOT EXISTS sync_history (id TEXT PRIMARY KEY, peer TEXT, peer_name TEXT, direction TEXT, summary TEXT NOT NULL, undo TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (${NOW}), undone_at TEXT);
    CREATE TABLE IF NOT EXISTS sync_peers (peer TEXT PRIMARY KEY, name TEXT, last_sync TEXT);
    CREATE TABLE IF NOT EXISTS sync_outbox (id INTEGER PRIMARY KEY, peer TEXT, kind TEXT NOT NULL, sync_id TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (${NOW}), delivered INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sync_offers (peer TEXT PRIMARY KEY, name TEXT, snapshot TEXT NOT NULL, received_at TEXT NOT NULL DEFAULT (${NOW}));
    CREATE TABLE IF NOT EXISTS settings_meta (key TEXT PRIMARY KEY, updated_at TEXT NOT NULL, updated_by TEXT);`);
  for (const [t, def] of Object.entries(SYNC_TABLES)) {
    const cols = (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes('gid')) db.exec(`ALTER TABLE ${t} ADD COLUMN gid TEXT`);
    if (!cols.includes('updated_at')) db.exec(`ALTER TABLE ${t} ADD COLUMN updated_at TEXT`);
    if (!cols.includes('updated_by')) db.exec(`ALTER TABLE ${t} ADD COLUMN updated_by TEXT`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${t}_gid ON ${t}(gid);
      DROP TRIGGER IF EXISTS ${t}_sync_ins; DROP TRIGGER IF EXISTS ${t}_sync_upd; DROP TRIGGER IF EXISTS ${t}_sync_del;
      CREATE TRIGGER ${t}_sync_ins AFTER INSERT ON ${t} WHEN NEW.gid IS NULL OR NEW.updated_at IS NULL BEGIN
        UPDATE ${t} SET gid = COALESCE(NEW.gid, ${def.gid ? `(${def.gid})` : 'NULL'}, lower(hex(randomblob(16)))), updated_at = COALESCE(NEW.updated_at, ${NOW}), updated_by = COALESCE(NEW.updated_by, ${DEV}) WHERE id = NEW.id;
        DELETE FROM sync_tombstones WHERE tbl = '${t}' AND gid = COALESCE(NEW.gid, ${def.gid ? `(${def.gid})` : 'NULL'});
      END;
      CREATE TRIGGER ${t}_sync_upd AFTER UPDATE ON ${t} WHEN NEW.updated_at IS OLD.updated_at AND NEW.gid IS OLD.gid AND NOT ${APPLYING} BEGIN
        UPDATE ${t} SET updated_at = ${NOW}, updated_by = ${DEV} WHERE id = NEW.id;
      END;
      CREATE TRIGGER ${t}_sync_del AFTER DELETE ON ${t} WHEN OLD.gid IS NOT NULL AND NOT ${APPLYING} BEGIN
        INSERT OR REPLACE INTO sync_tombstones (tbl, gid, deleted_at, deleted_by) VALUES ('${t}', OLD.gid, ${NOW}, ${DEV});
      END;`);
    // backfill existing rows (parents first so deterministic gids resolve)
    db.exec(`UPDATE ${t} SET updated_at = COALESCE(updated_at, ${NOW}), updated_by = COALESCE(updated_by, ${DEV}) WHERE updated_at IS NULL`);
    const missing = db.prepare(`SELECT id FROM ${t} WHERE gid IS NULL ORDER BY id`).all() as { id: number }[];
    if (missing.length) {
      const expr = def.gid ? def.gid.replace(/NEW\./g, `${t}.`) : 'NULL';
      db.exec(`UPDATE ${t} SET gid = COALESCE(${expr}, lower(hex(randomblob(16)))) WHERE gid IS NULL`);
    }
  }
  db.exec(`DROP TRIGGER IF EXISTS settings_sync_ins; DROP TRIGGER IF EXISTS settings_sync_upd;
    CREATE TRIGGER settings_sync_ins AFTER INSERT ON settings WHEN NOT ${APPLYING} AND NEW.key NOT IN (${LOCAL_SETTINGS.map((k) => `'${k}'`).join(',')}) BEGIN
      INSERT OR REPLACE INTO settings_meta (key, updated_at, updated_by) VALUES (NEW.key, ${NOW}, ${DEV}); END;
    CREATE TRIGGER settings_sync_upd AFTER UPDATE ON settings WHEN NOT ${APPLYING} AND NEW.value IS NOT OLD.value AND NEW.key NOT IN (${LOCAL_SETTINGS.map((k) => `'${k}'`).join(',')}) BEGIN
      INSERT OR REPLACE INTO settings_meta (key, updated_at, updated_by) VALUES (NEW.key, ${NOW}, ${DEV}); END;`);
}
