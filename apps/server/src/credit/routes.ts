import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DB } from '../schema';
import { importCreditPdf, updateContract, approveReport, revertReport, latestCredit } from './service';

const bad = (m: string, statusCode = 400) => Object.assign(new Error(m), { statusCode });
function parse<T>(s: z.ZodType<T>, d: unknown): T { const r = s.safeParse(d); if (!r.success) throw bad(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')); return r.data; }
const idP = (p: unknown) => parse(z.coerce.number().int().positive(), (p as { id: string }).id);

export function creditRoutes(app: FastifyInstance, db: DB) {
  const report = (id: number) => { const r = db.prepare('SELECT * FROM credit_reports WHERE id = ?').get(id) as any; if (!r) throw bad('Report not found', 404); return { ...r, summary: JSON.parse(r.summary), warnings: JSON.parse(r.warnings) }; };
  app.get('/api/credit-reports', async () => (db.prepare('SELECT id, filename, status, score, rating, report_date, created_at, approved_at, reverted_at FROM credit_reports ORDER BY id DESC').all()));
  app.post('/api/credit-reports', async (req) => {
    const b = parse(z.object({ filename: z.string().min(1).max(255), data: z.string().min(10) }), req.body);
    const id = await importCreditPdf(db, b.filename, Uint8Array.from(Buffer.from(b.data.replace(/^data:[^,]*,/, ''), 'base64')));
    return report(id);
  });
  app.get('/api/credit-reports/latest', async () => latestCredit(db) ?? { none: true });
  app.get('/api/credit-reports/:id', async (req) => {
    const id = idP(req.params);
    const contracts = (db.prepare('SELECT c.*, l.name AS match_name FROM credit_contracts c LEFT JOIN loans l ON l.id = c.match_loan_id WHERE report_id = ? ORDER BY active DESC, idx').all(id) as any[])
      .map((c) => ({ ...c, data: JSON.parse(c.data), proposed: JSON.parse(c.proposed), diff: JSON.parse(c.diff) }));
    return { ...report(id), contracts };
  });
  const loanPatch = z.object({ name: z.string().min(1).max(100), bank: z.string().min(1).max(80), principal: z.number().positive(), currency: z.string().length(3), annual_rate: z.number().min(0).max(200), term_months: z.number().int().min(1).max(600), start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), notes: z.string() }).partial();
  app.put('/api/credit-contracts/:id', async (req) => updateContract(db, idP(req.params), parse(z.object({ excluded: z.boolean().optional(), proposed: loanPatch.optional() }), req.body)));
  app.post('/api/credit-reports/:id/approve', async (req) => approveReport(db, idP(req.params), parse(z.object({ ids: z.array(z.number().int()).optional() }).default({}), req.body ?? {})?.ids));
  app.post('/api/credit-reports/:id/revert', async (req) => revertReport(db, idP(req.params)));
  app.post('/api/credit-reports/:id/discard', async (req) => {
    const id = idP(req.params);
    if ((db.prepare('SELECT COUNT(*) AS c FROM credit_contracts WHERE report_id = ? AND applied_loan_id IS NOT NULL').get(id) as { c: number }).c) throw bad('Revert the approved changes first');
    db.prepare("UPDATE credit_reports SET status = 'discarded' WHERE id = ?").run(id); return { ok: true };
  });
}
