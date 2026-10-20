import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db';
import { importPdf, updateRow, approve, revert, discard, analyze, runAi, detectDuplicates, learnedMap } from './service';
import { aiConfig, testConnection, type Provider } from './ai';
import { getSetting } from '../db';

const bad = (msg: string, statusCode = 400) => Object.assign(new Error(msg), { statusCode });
function parse<T>(s: z.ZodType<T>, d: unknown): T { const r = s.safeParse(d); if (!r.success) throw bad(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')); return r.data; }
const idP = (p: unknown) => parse(z.coerce.number().int().positive(), (p as { id: string }).id);

export function importRoutes(app: FastifyInstance, db: DB) {
  const batch = (id: number) => { const b = db.prepare('SELECT * FROM import_batches WHERE id = ?').get(id) as any; if (!b) throw bad('Import not found', 404); return { ...b, warnings: JSON.parse(b.warnings || '[]') }; };
  const stats = (id: number) => db.prepare(`SELECT COUNT(*) AS total, SUM(excluded = 0) AS included, SUM(duplicate_of IS NOT NULL) AS duplicates, SUM(transaction_id IS NOT NULL) AS posted, SUM(confidence < 0.6 AND excluded = 0) AS low,
      ROUND(SUM(CASE WHEN kind='expense' AND excluded = 0 THEN amount ELSE 0 END), 2) AS expense, ROUND(SUM(CASE WHEN kind='income' AND excluded = 0 THEN amount ELSE 0 END), 2) AS income FROM import_rows WHERE batch_id = ?`).get(id);

  app.get('/api/imports', async () => (db.prepare("SELECT * FROM import_batches ORDER BY id DESC").all() as any[]).map((b) => ({ ...b, warnings: JSON.parse(b.warnings || '[]'), stats: stats(b.id) })));
  app.post('/api/imports', async (req) => {
    const body = parse(z.object({ filename: z.string().min(1).max(255), data: z.string().min(10), account_id: z.number().int().positive().nullable().optional(), ai: z.boolean().optional() }), req.body);
    const bytes = Uint8Array.from(Buffer.from(body.data.replace(/^data:[^,]*,/, ''), 'base64'));
    const id = await importPdf(db, body.filename, bytes, body.account_id ?? null, body.ai ?? true);
    return { id, ...batch(id), stats: stats(id) };
  });
  app.get('/api/imports/:id', async (req) => {
    const id = idP(req.params);
    const rows = db.prepare(`SELECT r.*, c.name AS category_name, c.color AS category_color, t.date AS dup_date, t.description AS dup_description FROM import_rows r LEFT JOIN categories c ON c.id = r.category_id
      LEFT JOIN transactions t ON t.id = r.duplicate_of WHERE r.batch_id = ? ORDER BY r.idx`).all(id);
    return { ...batch(id), stats: stats(id), rows };
  });
  app.get('/api/imports/:id/analysis', async (req) => analyze(db, idP(req.params)));
  const rowPatch = z.object({ category_id: z.number().int().positive().nullable().optional(), account_id: z.number().int().positive().nullable().optional(), excluded: z.boolean().optional(), kind: z.enum(['income', 'expense']).optional() });
  app.put('/api/imports/rows/:id', async (req) => {
    const rid = idP(req.params);
    const r = db.prepare('SELECT transaction_id FROM import_rows WHERE id = ?').get(rid) as { transaction_id: number | null } | undefined;
    if (r?.transaction_id) throw bad('Row is already approved — revert the import to edit it');
    return updateRow(db, rid, parse(rowPatch, req.body));
  });
  app.post('/api/imports/:id/bulk', async (req) => {
    const id = idP(req.params);
    const b = parse(z.object({ ids: z.array(z.number().int().positive()).min(1), patch: rowPatch }), req.body);
    let applied = 0;
    for (const rid of b.ids) { const r = db.prepare('SELECT batch_id, transaction_id FROM import_rows WHERE id = ?').get(rid) as any; if (r?.batch_id === id && !r.transaction_id) applied += updateRow(db, rid, b.patch).applied; }
    return { ok: true, applied };
  });
  app.put('/api/imports/:id', async (req) => {
    const id = idP(req.params);
    const b = parse(z.object({ account_id: z.number().int().positive().nullable() }), req.body);
    db.prepare('UPDATE import_batches SET account_id = ? WHERE id = ?').run(b.account_id, id);
    db.prepare('UPDATE import_rows SET account_id = ? WHERE batch_id = ? AND transaction_id IS NULL').run(b.account_id, id);
    return batch(id);
  });
  app.post('/api/imports/:id/ai', async (req) => runAi(db, idP(req.params)));
  app.post('/api/imports/:id/dedupe', async (req) => ({ duplicates: detectDuplicates(db, idP(req.params)) }));
  app.post('/api/imports/:id/approve', async (req) => {
    const b = parse(z.object({ ids: z.array(z.number().int().positive()).optional() }).default({}), req.body ?? {});
    return approve(db, idP(req.params), b?.ids);
  });
  app.post('/api/imports/:id/revert', async (req) => revert(db, idP(req.params)));
  app.post('/api/imports/:id/discard', async (req) => { discard(db, idP(req.params)); return { ok: true }; });
  app.get('/api/merchant-rules', async () => db.prepare('SELECT m.*, c.name AS category_name FROM merchant_rules m JOIN categories c ON c.id = m.category_id ORDER BY m.updated_at DESC').all());
  app.delete('/api/merchant-rules/:merchant', async (req) => { db.prepare('DELETE FROM merchant_rules WHERE merchant = ?').run((req.params as { merchant: string }).merchant); return { ok: true, count: learnedMap(db).size }; });

  // ---------- AI provider ----------
  const override = z.object({ provider: z.enum(['ollama', 'openai', 'groq']).optional(), baseUrl: z.string().url().optional(), model: z.string().optional(), apiKey: z.string().optional() }).default({});
  const cfgWith = (o: z.infer<typeof override>) => { const c = aiConfig(db); const provider = (o.provider ?? c.provider) as Provider;
    const base = provider === c.provider ? c : { ...aiConfig(db), provider, baseUrl: provider === 'groq' ? 'https://api.groq.com/openai/v1' : provider === 'openai' ? (getSetting(db, 'openaiBaseUrl') ?? 'http://localhost:1234/v1') : (getSetting(db, 'ollamaUrl') ?? 'http://localhost:11434'),
      apiKey: provider === 'groq' ? getSetting(db, 'groqKey') ?? undefined : provider === 'openai' ? getSetting(db, 'openaiKey') ?? undefined : undefined };
    return { ...base, baseUrl: (o.baseUrl ?? base.baseUrl).replace(/\/$/, ''), model: o.model ?? base.model, apiKey: o.apiKey || base.apiKey }; };
  app.post('/api/ai/test', async (req) => testConnection(cfgWith(parse(override, req.body ?? {}) ?? {})));
  app.post('/api/ai/models', async (req) => { const r = await testConnection(cfgWith(parse(override, req.body ?? {}) ?? {})); return { ok: r.ok, models: r.models, message: r.message }; });
}
