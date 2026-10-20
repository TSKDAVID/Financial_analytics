import './polyfills';
import { initDb, setSetting, getSetting, type DB } from '../../../server/src/schema';
import { registerRoutes } from '../../../server/src/routes';
import { materialize } from '../../../server/src/services';
import { evaluateAlerts, wakeSnoozed } from '../../../server/src/alerts';
import { refreshToday } from '../../../server/src/rates';
import { openLocalDb } from './db';
import { LocalApp } from './router';

/** The phone's own offline engine: local SQLite + the same routes/services as the desktop. */
let db: DB | null = null; let app: LocalApp | null = null;
export function engine() {
  if (!db) {
    db = initDb(openLocalDb());
    if (!getSetting(db, 'deviceName')) setSetting(db, 'deviceName', 'Phone');
    setSetting(db, 'pushEnabled', '0'); // the phone notifies locally, never via ntfy/Expo push
    app = new LocalApp();
    registerRoutes(app as any, db, () => 0);
  }
  return { db: db!, app: app! };
}
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const { app } = engine();
  return app.inject(opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'), `/api${path}`, opts.body);
}
/** Periodic housekeeping (on start, on resume, in background): rates, recurring posting, bills, alerts. */
export async function tick(): Promise<{ fresh: { title: string; body: string; severity: string }[] }> {
  const { db } = engine();
  await refreshToday(db).catch(() => undefined);
  await materialize(db);
  const fresh = await evaluateAlerts(db);
  await wakeSnoozed(db).catch(() => undefined);
  return { fresh };
}
