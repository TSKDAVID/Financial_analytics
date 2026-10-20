import { openDb, DATA_DIR } from './db';
import { buildApp } from './app';
import { materialize } from './services';
import { evaluateAlerts, wakeSnoozed } from './alerts';
import { refreshToday } from './rates';

const PORT = Number(process.env.PORT ?? 5317);
const HOST = process.env.HOST ?? '0.0.0.0';
const db = openDb();
const { app } = await buildApp(db, { logger: process.env.LOG === '1', port: PORT });

async function tick() {
  try { await refreshToday(db); await materialize(db); await evaluateAlerts(db); await wakeSnoozed(db); }
  catch (e) { app.log.error(e); }
}
await app.listen({ port: PORT, host: HOST });
const url = `http://localhost:${PORT}`;
console.log(`\n  💰 Financial Analytics running at ${url}\n  Data: ${DATA_DIR}\n  Phone access (Tailscale): http://<this-computer-tailscale-ip>:${PORT}\n`);
void tick();
setInterval(tick, 15 * 60 * 1000);
if (process.argv.includes('--open') && process.env.NO_OPEN !== '1') { const { default: open } = await import('open'); open(url).catch(() => undefined); }
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { db.close(); process.exit(0); });
