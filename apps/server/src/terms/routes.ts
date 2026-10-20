import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DB } from '../schema';
import { b64ToBytes } from '../statements/lines';
import { importTerms, getTerms, approveTerms, revertTerms, switchPayMode } from './service';

const mode = z.enum(['recommended', 'minimum']);
export function termsRoutes(app: FastifyInstance, db: DB) {
  const idOf = (p: unknown) => Number((p as { id: string }).id);
  app.post('/api/loans/:id/terms', async (req) => {
    const b = z.object({ filename: z.string().min(1).max(255), data: z.string().min(10) }).parse(req.body);
    return importTerms(db, idOf(req.params), b.filename, b64ToBytes(b.data));
  });
  app.get('/api/loans/:id/terms', async (req) => db.prepare('SELECT id, filename, status, pay_mode, created_at, applied_at FROM loan_terms WHERE loan_id = ? ORDER BY id DESC').all(idOf(req.params)));
  app.get('/api/loan-terms/:id', async (req) => getTerms(db, idOf(req.params), (req.query as any)?.mode));
  app.post('/api/loan-terms/:id/approve', async (req) => approveTerms(db, idOf(req.params), mode.parse((req.body as any)?.mode ?? 'recommended')));
  app.post('/api/loan-terms/:id/revert', async (req) => revertTerms(db, idOf(req.params)));
  app.post('/api/loan-terms/:id/discard', async (req) => { db.prepare("UPDATE loan_terms SET status = 'discarded' WHERE id = ? AND status = 'staged'").run(idOf(req.params)); return { ok: true }; });
  app.post('/api/loans/:id/pay-mode', async (req) => { await switchPayMode(db, idOf(req.params), mode.parse((req.body as any)?.mode)); return { ok: true }; });
}
