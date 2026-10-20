import Fastify from 'fastify';
import cors from '@fastify/cors';
import fstatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DB } from './db';
import { registerRoutes, bearer } from './routes';
import * as sec from './security';

const OPEN_PATHS = new Set(['/api/health', '/api/auth/status', '/api/auth/unlock', '/api/pair/claim']);

export async function buildApp(db: DB, opts: { logger?: boolean; port?: number } = {}) {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 50 * 1024 * 1024 });
  await app.register(cors, { origin: (origin, cb) => cb(null, !origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) });
  let port = opts.port ?? 5317;
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    const p = req.url.split('?')[0];
    const token = bearer(req);
    const device = sec.deviceForToken(db, token);
    if (device) { (req as any).device = device; return; }
    if (OPEN_PATHS.has(p)) return;
    const local = sec.isLoopback(req.socket.remoteAddress ?? '');
    if (!local) return reply.code(401).send({ error: 'Device not paired. Pair this device from the web app (Settings → Phone).' });
    if (sec.lockEnabled(db) && !sec.validSession(token)) return reply.code(423).send({ error: 'locked' });
  });
  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    const code = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (code >= 500) app.log.error(err);
    reply.code(code).send({ error: err.message });
  });
  registerRoutes(app, db, () => port);
  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (fs.existsSync(webDist)) {
    await app.register(fstatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api/') ? reply.code(404).send({ error: 'Not found' }) : reply.sendFile('index.html')));
  }
  return { app, setPort: (p: number) => { port = p; } };
}
