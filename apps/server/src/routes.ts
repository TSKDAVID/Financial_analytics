import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { amortize, extraPaymentSavings, occurrences, todayISO, addMonths, suggestCategory, DEFAULT_KEYWORDS, startOfMonth, endOfMonth, monthKey } from '@fa/core';
import type { DB } from './schema';
import { getSetting, setSetting, seedBuiltins } from './schema';
import { getRate, latestRates, fetchNbg, SUPPORTED } from './rates';
import {
  insertTransaction, materialize, payBill, unpayBill, catTree, accountBalances, loanStatus, subscriptionInfo, duplicateSubscriptions,
  budgetStatus, goalStatus, loanInput, type LoanRow, type SubRow, periodSummary,
} from './services';
import { dashboard, forecastData, riskData, insights, anomaliesList, utilitiesData } from './analytics';
import { evaluateAlerts } from './alerts';
import { pushAlert } from './notify';
import * as sec from './security';
import { seedDemo, resetData } from './seed';
import { AI_DEFAULTS, SECRET_KEYS } from './statements/ai';
import { importRoutes } from './statements/routes';
import { creditRoutes } from './credit/routes';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.coerce.number().finite();
const id = z.coerce.number().int().positive();
const unit = z.enum(['day', 'week', 'month', 'year']);
const currency = z.string().length(3).toUpperCase();
const optId = z.coerce.number().int().positive().nullable().optional();

const txSchema = z.object({
  kind: z.enum(['income', 'expense', 'transfer']), amount: money.nonnegative(), currency: currency.default('GEL'), date,
  account_id: optId, to_account_id: optId, category_id: optId, description: z.string().max(300).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(), tags: z.array(z.string().max(40)).max(20).default([]),
  rate: z.coerce.number().positive().optional(), rate_manual: z.boolean().optional(),
});
const accountSchema = z.object({ name: z.string().min(1).max(80), type: z.enum(['cash', 'bank', 'card', 'savings']), currency: currency.default('GEL'), opening_balance: money.default(0), color: z.string().default('#6366f1'), bank: z.string().max(80).nullable().optional(), liquid: z.boolean().default(true), archived: z.boolean().default(false) });
const categorySchema = z.object({ name: z.string().min(1).max(60), kind: z.enum(['income', 'expense']), parent_id: optId, color: z.string().default('#64748b'), icon: z.string().default('circle'), essential: z.boolean().default(false), archived: z.boolean().default(false) });
const recurringSchema = z.object({ kind: z.enum(['income', 'expense']), name: z.string().min(1).max(100), amount: money.positive(), currency: currency.default('GEL'), account_id: optId, category_id: optId, notes: z.string().nullable().optional(), tags: z.array(z.string()).default([]), unit, interval: z.coerce.number().int().min(1).max(1000), start_date: date, end_date: date.nullable().optional(), count: z.coerce.number().int().positive().nullable().optional(), auto_post: z.boolean().default(true), active: z.boolean().default(true) });
const loanSchema = z.object({ name: z.string().min(1).max(100), bank: z.string().min(1).max(80), principal: money.positive(), currency: currency.default('GEL'), annual_rate: z.coerce.number().min(0).max(200), term_months: z.coerce.number().int().min(1).max(600), start_date: date, extra_monthly: money.nonnegative().default(0), account_id: optId, notes: z.string().nullable().optional(), active: z.boolean().default(true) });
const subSchema = z.object({ name: z.string().min(1).max(100), kind: z.enum(['subscription', 'bill']).default('subscription'), amount: money.nonnegative(), currency: currency.default('GEL'), unit: unit.default('month'), interval: z.coerce.number().int().min(1).default(1), start_date: date, category_id: optId, account_id: optId, provider: z.string().nullable().optional(), last_used: date.nullable().optional(), variable: z.boolean().default(false), active: z.boolean().default(true), notes: z.string().nullable().optional() });
const budgetSchema = z.object({ category_id: id, amount: money.positive(), rollover: z.boolean().default(false) });
const goalSchema = z.object({ name: z.string().min(1).max(100), target: money.positive(), saved: money.nonnegative().default(0), target_date: date.nullable().optional(), color: z.string().default('#10b981'), icon: z.string().default('target'), account_id: optId });

const b = (v: boolean | undefined) => (v === undefined ? undefined : v ? 1 : 0);
function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (!r.success) { const e = new Error(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')) as Error & { statusCode: number }; e.statusCode = 400; throw e; }
  return r.data;
}
function upsert(db: DB, table: string, data: Record<string, unknown>, rowId?: number) {
  const row = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined).map(([k, v]) => [k, typeof v === 'boolean' ? (v ? 1 : 0) : Array.isArray(v) ? JSON.stringify(v) : v]));
  const cols = Object.keys(row);
  if (rowId) {
    if (cols.length) db.prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @__id`).run({ ...row, __id: rowId });
    return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(rowId);
  }
  const info = db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`).run(row);
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(info.lastInsertRowid);
}
const notFound = () => Object.assign(new Error('Not found'), { statusCode: 404 });
const P = (req: FastifyRequest) => req.params as Record<string, string>;
const Q = (req: FastifyRequest) => req.query as Record<string, string | undefined>;

export function registerRoutes(app: FastifyInstance, db: DB, port: () => number) {
  const crud = (name: string, table: string, schema: z.AnyZodObject, after?: () => Promise<void> | void) => {
    app.post(`/api/${name}`, async (req) => { const r = upsert(db, table, parse(schema, req.body)); await after?.(); return r; });
    app.put(`/api/${name}/:id`, async (req) => { const rid = parse(id, P(req).id); if (!db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(rid)) throw notFound(); const r = upsert(db, table, parse(schema.partial(), req.body), rid); await after?.(); return r; });
    app.delete(`/api/${name}/:id`, async (req) => { db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(parse(id, P(req).id)); await after?.(); return { ok: true }; });
  };
  const refresh = async () => { await materialize(db); };

  app.get('/api/health', async () => ({ ok: true, app: 'financial-analytics', version: '1.0.0', time: new Date().toISOString() }));

  // ---------- auth / lock ----------
  app.get('/api/auth/status', async (req) => ({ lockEnabled: sec.lockEnabled(db), unlocked: !sec.lockEnabled(db) || sec.validSession(bearer(req)) || !!(req as any).device }));
  app.post('/api/auth/unlock', async (req, reply) => {
    const { secret } = parse(z.object({ secret: z.string().min(1) }), req.body);
    const t = sec.unlock(db, secret); if (!t) return reply.code(401).send({ error: 'Wrong PIN or password' });
    return { token: t };
  });
  app.post('/api/auth/lock', async (req) => { sec.lockSession(bearer(req)); return { ok: true }; });
  app.post('/api/auth/set', async (req, reply) => {
    const { current, secret } = parse(z.object({ current: z.string().optional(), secret: z.string().min(4).max(128).nullable() }), req.body);
    if (sec.lockEnabled(db) && !(current && sec.unlock(db, current))) return reply.code(401).send({ error: 'Current PIN is incorrect' });
    sec.setLock(db, secret);
    return { lockEnabled: !!secret, token: secret ? sec.unlock(db, secret) : null };
  });

  // ---------- settings ----------
  app.get('/api/settings', async () => {
    const rows = db.prepare("SELECT key, value FROM settings WHERE key != 'lockHash'").all() as { key: string; value: string }[];
    const all: Record<string, unknown> = { ...AI_DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
    for (const k of SECRET_KEYS) { all[`${k}Set`] = !!all[k]; delete all[k]; } // never return API keys
    return { ...all, lockEnabled: sec.lockEnabled(db) };
  });
  app.put('/api/settings', async (req) => {
    const body = parse(z.record(z.union([z.string(), z.number(), z.boolean()])), req.body);
    for (const [k, v] of Object.entries(body)) if (k !== 'lockHash' && k !== 'lockEnabled' && !k.endsWith('KeySet')) setSetting(db, k, String(v));
    return { ok: true };
  });

  // ---------- accounts ----------
  app.get('/api/accounts', async () => accountBalances(db));
  crud('accounts', 'accounts', accountSchema);

  // ---------- categories ----------
  app.get('/api/categories', async () => db.prepare('SELECT * FROM categories ORDER BY kind, parent_id IS NOT NULL, builtin DESC, name').all());
  crud('categories', 'categories', categorySchema);

  // ---------- transactions ----------
  app.get('/api/transactions', async (req) => {
    const q = Q(req); const where: string[] = []; const args: unknown[] = [];
    if (q.from) { where.push('t.date >= ?'); args.push(q.from); }
    if (q.to) { where.push('t.date <= ?'); args.push(q.to); }
    if (q.kind) { where.push('t.kind = ?'); args.push(q.kind); }
    if (q.category_id) { const ids = catTree(db, Number(q.category_id)); where.push(`t.category_id IN (${ids.map(() => '?').join(',')})`); args.push(...ids); }
    if (q.account_id) { where.push('(t.account_id = ? OR t.to_account_id = ?)'); args.push(Number(q.account_id), Number(q.account_id)); }
    if (q.tag) { where.push("EXISTS (SELECT 1 FROM json_each(t.tags) WHERE value = ?)"); args.push(q.tag); }
    if (q.min) { where.push('t.amount_gel >= ?'); args.push(Number(q.min)); }
    if (q.max) { where.push('t.amount_gel <= ?'); args.push(Number(q.max)); }
    if (q.q) { where.push('(t.description LIKE ? OR t.notes LIKE ? OR t.tags LIKE ?)'); const s = `%${q.q}%`; args.push(s, s, s); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const sortCol = ({ date: 't.date', amount: 't.amount_gel', description: 't.description' } as Record<string, string>)[q.sort ?? 'date'] ?? 't.date';
    const dir = q.dir === 'asc' ? 'ASC' : 'DESC';
    const limit = Math.min(Number(q.limit ?? 100), 5000), offset = Number(q.offset ?? 0);
    const rows = db.prepare(`SELECT t.*, c.name AS category_name, c.color AS category_color, c.icon AS category_icon, a.name AS account_name FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN accounts a ON a.id = t.account_id ${w} ORDER BY ${sortCol} ${dir}, t.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as any[];
    const tot = db.prepare(`SELECT COUNT(*) AS count, SUM(CASE WHEN kind='income' THEN amount_gel ELSE 0 END) AS income, SUM(CASE WHEN kind='expense' THEN amount_gel ELSE 0 END) AS expense FROM transactions t ${w}`).get(...args) as any;
    return { rows: rows.map((r) => ({ ...r, tags: JSON.parse(r.tags) })), total: tot.count, income: tot.income ?? 0, expense: tot.expense ?? 0 };
  });
  app.get('/api/tags', async () => (db.prepare('SELECT DISTINCT value AS tag FROM transactions, json_each(transactions.tags) ORDER BY 1').all() as { tag: string }[]).map((r) => r.tag));
  app.post('/api/transactions', async (req) => { const t = parse(txSchema, req.body); const tid = await insertTransaction(db, t); return db.prepare('SELECT * FROM transactions WHERE id = ?').get(tid); });
  app.put('/api/transactions/:id', async (req) => {
    const tid = parse(id, P(req).id);
    const old = db.prepare('SELECT * FROM transactions WHERE id = ?').get(tid) as any; if (!old) throw notFound();
    const t = parse(txSchema.partial(), req.body);
    const merged = { ...old, ...t, tags: t.tags ?? JSON.parse(old.tags) };
    const rate = t.rate_manual && t.rate ? t.rate : t.currency || t.date ? (await getRate(db, merged.currency, merged.date)).rate : old.rate;
    upsert(db, 'transactions', { ...t, rate, rate_manual: t.rate_manual, amount_gel: Math.round(merged.amount * rate * 100) / 100 }, tid);
    return db.prepare('SELECT * FROM transactions WHERE id = ?').get(tid);
  });
  app.delete('/api/transactions/:id', async (req) => { const tid = parse(id, P(req).id); db.prepare('UPDATE bills SET paid = 0, paid_date = NULL, transaction_id = NULL WHERE transaction_id = ?').run(tid); db.prepare('DELETE FROM transactions WHERE id = ?').run(tid); return { ok: true }; });
  app.post('/api/transactions/bulk', async (req) => {
    const { ids, action, patch } = parse(z.object({ ids: z.array(id).min(1).max(5000), action: z.enum(['delete', 'update', 'addTag', 'removeTag']), patch: z.object({ category_id: optId, account_id: optId, kind: z.enum(['income', 'expense']).optional(), date: date.optional(), tag: z.string().optional(), notes: z.string().optional() }).default({}) }), req.body);
    const ph = ids.map(() => '?').join(',');
    db.transaction(() => {
      if (action === 'delete') { db.prepare(`UPDATE bills SET paid = 0, transaction_id = NULL WHERE transaction_id IN (${ph})`).run(...ids); db.prepare(`DELETE FROM transactions WHERE id IN (${ph})`).run(...ids); }
      else if (action === 'update') { const { tag: _t, ...p } = patch; void _t; for (const i of ids) upsert(db, 'transactions', p, i); }
      else for (const i of ids) {
        const r = db.prepare('SELECT tags FROM transactions WHERE id = ?').get(i) as { tags: string } | undefined; if (!r || !patch.tag) continue;
        const tags = new Set<string>(JSON.parse(r.tags)); if (action === 'addTag') tags.add(patch.tag); else tags.delete(patch.tag);
        db.prepare('UPDATE transactions SET tags = ? WHERE id = ?').run(JSON.stringify([...tags]), i);
      }
    })();
    return { ok: true, count: ids.length };
  });
  app.post('/api/import/suggest', async (req) => {
    const { descriptions } = parse(z.object({ descriptions: z.array(z.string()).max(10000) }), req.body);
    const cats = db.prepare('SELECT id, key, name FROM categories').all() as { id: number; key: string | null; name: string }[];
    const keyToId = new Map(cats.filter((c) => c.key).map((c) => [c.key!, c.id]));
    // learn from history: description -> most common category
    const hist = db.prepare('SELECT lower(description) AS d, category_id AS c, COUNT(*) AS n FROM transactions WHERE description IS NOT NULL AND category_id IS NOT NULL GROUP BY d, c ORDER BY n DESC').all() as { d: string; c: number }[];
    const learned = new Map<string, number>(); for (const h of hist) if (!learned.has(h.d)) learned.set(h.d, h.c);
    const custom = cats.filter((c) => !c.key).map((c) => ({ key: 'id:' + c.id, keywords: [c.name.toLowerCase()] }));
    return descriptions.map((d) => {
      const l = learned.get(d.toLowerCase()); if (l) return l;
      const k = suggestCategory(d, [...custom, ...DEFAULT_KEYWORDS]);
      return k ? (k.startsWith('id:') ? Number(k.slice(3)) : keyToId.get(k) ?? null) : null;
    });
  });
  app.post('/api/import', async (req) => {
    const { rows } = parse(z.object({ rows: z.array(txSchema).max(20000) }), req.body);
    let n = 0, skipped = 0;
    const dup = db.prepare('SELECT 1 FROM transactions WHERE date = ? AND amount = ? AND kind = ? AND COALESCE(description, \'\') = COALESCE(?, \'\') LIMIT 1');
    for (const r of rows) { if (dup.get(r.date, r.amount, r.kind, r.description ?? null)) { skipped++; continue; } await insertTransaction(db, r); n++; }
    return { imported: n, skipped };
  });

  // ---------- recurring ----------
  app.get('/api/recurring', async () => (db.prepare('SELECT r.*, c.name AS category_name, c.color AS category_color, a.name AS account_name FROM recurring r LEFT JOIN categories c ON c.id = r.category_id LEFT JOIN accounts a ON a.id = r.account_id ORDER BY r.kind DESC, r.name').all() as any[]).map((r) => {
    const next = occurrences({ unit: r.unit, interval: r.interval, start: r.start_date, end: r.end_date, count: r.count }, todayISO(), addMonths(todayISO(), 24)).slice(0, 5);
    return { ...r, tags: JSON.parse(r.tags), next };
  }));
  app.post('/api/recurring/preview', async (req) => {
    const r = parse(recurringSchema.pick({ unit: true, interval: true, start_date: true, end_date: true, count: true }), req.body);
    return occurrences({ unit: r.unit, interval: r.interval, start: r.start_date, end: r.end_date, count: r.count }, r.start_date, addMonths(r.start_date, 60)).slice(0, 12);
  });
  crud('recurring', 'recurring', recurringSchema, refresh);

  // ---------- currency ----------
  app.get('/api/rates', async (req) => {
    const d = Q(req).date ?? todayISO();
    const out: Record<string, { rate: number; source: string }> = {};
    for (const c of SUPPORTED) { try { out[c] = await getRate(db, c, d); } catch { /* none */ } }
    return { date: d, rates: out, supported: ['GEL', ...SUPPORTED] };
  });
  app.get('/api/rates/history', async (req) => db.prepare('SELECT date, rate, manual FROM rates WHERE code = ? AND date >= ? ORDER BY date').all(Q(req).code ?? 'USD', Q(req).from ?? addMonths(todayISO(), -6)));
  app.post('/api/rates/refresh', async (req) => { const d = parse(z.object({ date: date.default(todayISO()) }), req.body ?? {}).date; return { stored: await fetchNbg(db, d) }; });
  app.put('/api/rates', async (req) => {
    const r = parse(z.object({ date, code: currency, rate: z.coerce.number().positive().nullable() }), req.body);
    if (r.rate === null) db.prepare('DELETE FROM rates WHERE date = ? AND code = ? AND manual = 1').run(r.date, r.code);
    else db.prepare('INSERT INTO rates (date, code, rate, manual) VALUES (?,?,?,1) ON CONFLICT(date, code) DO UPDATE SET rate = excluded.rate, manual = 1').run(r.date, r.code, r.rate);
    return { ok: true };
  });
  app.post('/api/rates/reapply', async () => {
    const txs = db.prepare('SELECT id, currency, date, amount FROM transactions WHERE currency != \'GEL\' AND rate_manual = 0').all() as any[];
    for (const t of txs) { const { rate } = await getRate(db, t.currency, t.date); db.prepare('UPDATE transactions SET rate = ?, amount_gel = ? WHERE id = ?').run(rate, Math.round(t.amount * rate * 100) / 100, t.id); }
    return { updated: txs.length };
  });
  app.get('/api/convert', async (req) => { const q = Q(req); const amount = Number(q.amount ?? 1); const from = (q.from ?? 'USD').toUpperCase(), to = (q.to ?? 'GEL').toUpperCase(); const d = q.date ?? todayISO();
    const rf = (await getRate(db, from, d)).rate, rt = (await getRate(db, to, d)).rate; return { amount, from, to, date: d, result: (amount * rf) / rt }; });

  // ---------- loans ----------
  app.get('/api/loans', async () => (db.prepare('SELECT * FROM loans ORDER BY active DESC, id').all() as LoanRow[]).map((l) => loanStatus(db, l)));
  app.get('/api/loans/overview', async () => {
    const loans = (db.prepare('SELECT * FROM loans WHERE active = 1').all() as LoanRow[]).map((l) => loanStatus(db, l));
    const byBank = new Map<string, { bank: string; remaining_gel: number; monthly_gel: number; count: number }>();
    for (const l of loans) { const x = byBank.get(l.bank) ?? { bank: l.bank, remaining_gel: 0, monthly_gel: 0, count: 0 }; x.remaining_gel += l.remaining_gel; x.monthly_gel += l.monthly_gel; x.count++; byBank.set(l.bank, x); }
    return { totalDebt: loans.reduce((s, l) => s + l.remaining_gel, 0), monthly: loans.reduce((s, l) => s + l.monthly_gel, 0), byBank: [...byBank.values()], count: loans.length,
      lastPayoff: loans.map((l) => l.payoff_date).sort().pop() ?? null };
  });
  app.get('/api/loans/:id/schedule', async (req) => {
    const l = db.prepare('SELECT * FROM loans WHERE id = ?').get(parse(id, P(req).id)) as LoanRow | undefined; if (!l) throw notFound();
    const extra = Number(Q(req).extra ?? l.extra_monthly ?? 0);
    const s = extraPaymentSavings({ ...loanInput(l), extraMonthly: 0 }, extra);
    return { loan: loanStatus(db, l), schedule: extra > 0 ? s.withExtra : s.base, base: s.base, interestSaved: s.interestSaved, monthsSaved: s.monthsSaved, extra };
  });
  app.post('/api/loans/calculate', async (req) => {
    const r = parse(z.object({ principal: money.positive(), annual_rate: z.coerce.number().min(0), term_months: z.coerce.number().int().min(1), start_date: date.default(todayISO()), extra_monthly: money.nonnegative().default(0) }), req.body);
    const s = extraPaymentSavings({ principal: r.principal, annualRatePct: r.annual_rate, termMonths: r.term_months, startDate: r.start_date }, r.extra_monthly);
    return { schedule: r.extra_monthly > 0 ? s.withExtra : s.base, base: s.base, interestSaved: s.interestSaved, monthsSaved: s.monthsSaved };
  });
  crud('loans', 'loans', loanSchema, async () => { db.prepare('DELETE FROM bills WHERE loan_id IS NOT NULL AND paid = 0').run(); await refresh(); });

  // ---------- subscriptions & bills ----------
  app.get('/api/subscriptions', async () => {
    const subs = (db.prepare('SELECT s.*, c.name AS category_name, c.color AS category_color FROM subscriptions s LEFT JOIN categories c ON c.id = s.category_id ORDER BY s.active DESC, s.kind, s.name').all() as SubRow[]).map((s) => subscriptionInfo(db, s));
    const dups = duplicateSubscriptions(subs);
    const active = subs.filter((s) => s.active);
    return { items: subs.map((s) => ({ ...s, duplicate: dups.some((g) => g.includes(s.id)) })), duplicates: dups,
      totals: { monthly: active.reduce((a, s) => a + s.monthly_gel, 0), yearly: active.reduce((a, s) => a + s.yearly_gel, 0), subscriptionsMonthly: active.filter((s) => s.kind === 'subscription').reduce((a, s) => a + s.monthly_gel, 0) } };
  });
  crud('subscriptions', 'subscriptions', subSchema, async () => { db.prepare('DELETE FROM bills WHERE subscription_id IS NOT NULL AND paid = 0 AND subscription_id NOT IN (SELECT id FROM subscriptions WHERE active = 1)').run(); await refresh(); });
  app.post('/api/subscriptions/:id/used', async (req) => { db.prepare('UPDATE subscriptions SET last_used = ? WHERE id = ?').run(todayISO(), parse(id, P(req).id)); return { ok: true }; });
  const withGel = (b: any) => { const rt = latestRates(db); return { ...b, amount_gel: Math.round(b.amount * (b.currency === 'GEL' ? 1 : rt[b.currency] ?? 1) * 100) / 100 }; };
  app.get('/api/bills', async (req) => {
    const q = Q(req); const from = q.from ?? startOfMonth(todayISO()), to = q.to ?? endOfMonth(todayISO());
    return db.prepare(`SELECT b.*, CASE WHEN b.loan_id IS NOT NULL THEN 'loan' ELSE s.kind END AS type, c.color AS category_color FROM bills b LEFT JOIN subscriptions s ON s.id = b.subscription_id LEFT JOIN categories c ON c.id = s.category_id
      WHERE (b.due_date BETWEEN ? AND ?) ${q.unpaid ? 'AND b.paid = 0' : ''} ORDER BY b.due_date, b.name`).all(from, to).map(withGel);
  });
  app.get('/api/bills/upcoming', async () => db.prepare("SELECT b.*, CASE WHEN b.loan_id IS NOT NULL THEN 'loan' ELSE s.kind END AS type FROM bills b LEFT JOIN subscriptions s ON s.id = b.subscription_id WHERE b.paid = 0 AND b.due_date <= ? ORDER BY b.due_date LIMIT 50").all(addMonths(todayISO(), 1)).map(withGel));
  app.post('/api/bills/:id/pay', async (req) => { const body = parse(z.object({ date: date.optional(), amount: money.positive().optional(), account_id: optId }).default({}), req.body ?? {}); return payBill(db, parse(id, P(req).id), body); });
  app.post('/api/bills/:id/unpay', async (req) => { unpayBill(db, parse(id, P(req).id)); return { ok: true }; });
  app.get('/api/utilities', async () => utilitiesData(db));

  // ---------- budgets & goals ----------
  app.get('/api/budgets', async (req) => budgetStatus(db, Q(req).month ?? monthKey(todayISO())));
  crud('budgets', 'budgets', budgetSchema);
  app.get('/api/goals', async () => goalStatus(db));
  crud('goals', 'goals', goalSchema);
  app.post('/api/goals/:id/contribute', async (req) => { const { amount } = parse(z.object({ amount: money }), req.body); db.prepare('UPDATE goals SET saved = MAX(0, saved + ?) WHERE id = ?').run(amount, parse(id, P(req).id)); return { ok: true }; });

  // ---------- analytics ----------
  app.get('/api/dashboard', async (req) => { const q = Q(req); return dashboard(db, q.from ?? startOfMonth(todayISO()), q.to ?? endOfMonth(todayISO())); });
  app.post('/api/forecast', async (req) => forecastData(db, parse(z.object({ months: z.coerce.number().int().min(1).max(36).default(12), incomeChangePct: z.coerce.number().min(-100).max(500).optional(), newExpenseMonthly: money.nonnegative().optional(), newLoan: z.object({ principal: money.nonnegative(), annualRatePct: z.coerce.number().min(0), termMonths: z.coerce.number().int().min(1) }).nullable().optional(), oneOff: z.array(z.object({ date, amount: money })).optional() }), req.body ?? {})));
  app.get('/api/risk', async () => riskData(db));
  app.get('/api/insights', async () => insights(db));
  app.get('/api/anomalies', async () => anomaliesList(db));
  app.get('/api/reports', async (req) => {
    const q = Q(req); const from = q.from ?? startOfMonth(todayISO()), to = q.to ?? endOfMonth(todayISO());
    const d = dashboard(db, from, to);
    const top = db.prepare(`SELECT t.date, t.description, t.amount_gel, c.name AS category FROM transactions t LEFT JOIN categories c ON c.id = t.category_id WHERE t.kind='expense' AND t.date BETWEEN ? AND ? ORDER BY t.amount_gel DESC LIMIT 10`).all(from, to);
    const risk = riskData(db);
    return { ...d, top, health: risk.health, budgets: budgetStatus(db, from.slice(0, 7)), insights: insights(db), summary: periodSummary(db, from, to) };
  });

  // ---------- alerts ----------
  app.get('/api/alerts', async (req) => {
    const q = Q(req); const now = new Date().toISOString();
    const rows = db.prepare(`SELECT * FROM alerts WHERE ${q.all ? '1=1' : 'dismissed = 0 AND (snoozed_until IS NULL OR snoozed_until <= ?)'} ORDER BY read, CASE severity WHEN 'danger' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, created_at DESC LIMIT 200`).all(...(q.all ? [] : [now]));
    const unread = (db.prepare('SELECT COUNT(*) AS c FROM alerts WHERE read = 0 AND dismissed = 0 AND (snoozed_until IS NULL OR snoozed_until <= ?)').get(now) as { c: number }).c;
    return { items: rows, unread };
  });
  app.post('/api/alerts/evaluate', async () => { await materialize(db); return { new: await evaluateAlerts(db) }; });
  app.post('/api/alerts/read-all', async () => { db.prepare('UPDATE alerts SET read = 1').run(); return { ok: true }; });
  app.post('/api/alerts/:id/:action', async (req) => {
    const aid = parse(id, P(req).id); const action = P(req).action;
    if (action === 'read') db.prepare('UPDATE alerts SET read = 1 WHERE id = ?').run(aid);
    else if (action === 'unread') db.prepare('UPDATE alerts SET read = 0 WHERE id = ?').run(aid);
    else if (action === 'dismiss') db.prepare('UPDATE alerts SET dismissed = 1, read = 1 WHERE id = ?').run(aid);
    else if (action === 'snooze') { const { minutes } = parse(z.object({ minutes: z.coerce.number().int().min(1).max(60 * 24 * 30).default(60 * 24) }), req.body ?? {}); db.prepare('UPDATE alerts SET snoozed_until = ?, read = 1 WHERE id = ?').run(new Date(Date.now() + minutes * 60000).toISOString(), aid); }
    else throw notFound();
    return db.prepare('SELECT * FROM alerts WHERE id = ?').get(aid);
  });

  // ---------- devices / pairing / push ----------
  app.get('/api/devices', async () => db.prepare('SELECT id, name, created_at, last_seen, push_token IS NOT NULL AS has_push FROM devices ORDER BY id').all());
  app.delete('/api/devices/:id', async (req) => { db.prepare('DELETE FROM devices WHERE id = ?').run(parse(id, P(req).id)); return { ok: true }; });
  app.post('/api/pair/start', async () => ({ code: sec.startPairing(), urls: sec.serverUrls(port()), expiresInSec: 600 }));
  app.post('/api/pair/claim', async (req, reply) => {
    const { code, name } = parse(z.object({ code: z.string().min(8), name: z.string().default('Android') }), req.body);
    const r = sec.claimPairing(db, code, name); if (!r) return reply.code(401).send({ error: 'Pairing code invalid or expired' });
    return { token: r.token, deviceId: r.id };
  });
  app.put('/api/devices/me/push', async (req, reply) => {
    const dev = (req as any).device as { id: number } | undefined; if (!dev) return reply.code(400).send({ error: 'Only paired devices can register push tokens' });
    const { token } = parse(z.object({ token: z.string().max(300).nullable() }), req.body);
    db.prepare('UPDATE devices SET push_token = ? WHERE id = ?').run(token, dev.id); return { ok: true };
  });
  app.post('/api/notify/test', async () => ({ results: await pushAlert(db, 'Test alert', 'Financial Analytics notifications are working', 'info') }));

  // ---------- backup / data ----------
  app.post('/api/backup/export', async (req) => { const { password } = parse(z.object({ password: z.string().min(6) }), req.body); return { file: sec.encryptBackup(sec.dumpDb(db), password), name: `finance-backup-${todayISO()}.fabackup` }; });
  app.post('/api/backup/restore', async (req) => { const { file, password } = parse(z.object({ file: z.string(), password: z.string() }), req.body); sec.restoreDb(db, sec.decryptBackup(file, password)); seedBuiltins(db); return { ok: true }; });
  app.post('/api/demo/seed', async () => { await seedDemo(db); await materialize(db); await evaluateAlerts(db); return { ok: true }; });
  app.post('/api/data/reset', async (req) => { const { confirm } = parse(z.object({ confirm: z.literal('DELETE') }), req.body); void confirm; resetData(db); return { ok: true }; });
  app.get('/api/meta', async () => ({ today: todayISO(), rates: latestRates(db), hasData: (db.prepare('SELECT COUNT(*) AS c FROM transactions').get() as { c: number }).c > 0 || (db.prepare('SELECT COUNT(*) AS c FROM accounts').get() as { c: number }).c > 0, baseCurrency: getSetting(db, 'baseCurrency') ?? 'GEL' }));
  void b; void amortize;
  importRoutes(app, db);
  creditRoutes(app, db);
}

export function bearer(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization; return h?.startsWith('Bearer ') ? h.slice(7) : undefined;
}
