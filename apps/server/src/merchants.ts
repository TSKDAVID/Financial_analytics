import { addMonths, endOfMonth, mean, monthKey, monthsBetween, normalizeMerchantName, merchantKeyOf, startOfMonth, todayISO, canonicalMerchantKey, clusterMerchants, prettyMerchant } from '@fa/core';
import type { DB } from './schema';

export interface MerchantStat { key: string; name: string; category: string | null; total: number; count: number; avg: number; last: string; monthly: { month: string; total: number; count: number }[]; thisMonth: number; lastMonth: number; usualMonthly: number; activeMonths: number; variants?: { key: string; count: number }[]; perWeek?: number; categoryKey?: string | null }
const r2 = (x: number) => Math.round(x * 100) / 100;
interface Spend { id: number; date: string; time?: string | null; amount_gel: number; description: string | null; merchant: string | null; category: string | null; color: string | null; category_key: string | null }

/** Spending rows (purchases, bills, subscriptions…) — never transfers to people, own transfers, cash or fees. */
function spending(db: DB, from: string, to: string): Spend[] {
  return db.prepare(`SELECT t.id, t.date, r.time, t.amount_gel, t.description, r.merchant, COALESCE(p.name, c.name) AS category, COALESCE(p.color, c.color) AS color, COALESCE(p.key, c.key) AS category_key
    FROM transactions t LEFT JOIN import_rows r ON r.transaction_id = t.id LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN categories p ON p.id = c.parent_id
    WHERE t.kind = 'expense' AND t.date BETWEEN ? AND ? AND COALESCE(t.tx_kind, '') NOT IN ('transfer_out', 'cash_withdrawal', 'fee', 'loan_repayment')
    AND COALESCE(c.key, '') NOT IN ('p2p_out', 'cash', 'fees', 'loans') GROUP BY t.id`).all(from, to) as Spend[];
}
export const merchantOf = (s: { merchant: string | null; description: string | null }) => {
  const raw = s.merchant || (s.description ?? '').split(/[;,]/)[0] || '—';
  const name = normalizeMerchantName(raw);
  return { name, raw, key: canonicalMerchantKey(raw) || merchantKeyOf(name) || name.toLowerCase() };
};
export function ensureAliasTable(db: DB) { db.exec('CREATE TABLE IF NOT EXISTS merchant_aliases (from_key TEXT PRIMARY KEY, to_key TEXT NOT NULL, name TEXT)'); }
const aliases = (db: DB) => { ensureAliasTable(db); return db.prepare('SELECT * FROM merchant_aliases').all() as { from_key: string; to_key: string; name: string | null }[]; };
/** Group spending rows into merchants: canonical names, fuzzy clusters, then your manual merges/splits. */
export function groupMerchants(db: DB, rows: Spend[]) {
  const al = aliases(db); const alias = new Map(al.map((a) => [a.from_key, a.to_key])); const named = new Map(al.filter((a) => a.name).map((a) => [a.to_key, a.name!]));
  const items = rows.map((r) => ({ r, m: merchantOf(r) }));
  const catOf = new Map<string, Map<string, number>>();
  for (const { r, m } of items) { const c = catOf.get(m.key) ?? new Map(); if (r.category_key) c.set(r.category_key, (c.get(r.category_key) ?? 0) + 1); catOf.set(m.key, c); }
  const main = (k: string) => [...(catOf.get(k) ?? new Map())].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const cl = clusterMerchants(items.map((i) => i.m.key), main, alias);
  const by = new Map<string, { key: string; names: Map<string, number>; variants: Map<string, number>; rows: Spend[] }>();
  for (const { r, m } of items) { const k = cl.get(m.key) ?? m.key; const g = by.get(k) ?? { key: k, names: new Map(), variants: new Map(), rows: [] as Spend[] };
    g.names.set(m.raw, (g.names.get(m.raw) ?? 0) + 1); g.variants.set(m.key, (g.variants.get(m.key) ?? 0) + 1); g.rows.push(r); by.set(k, g); }
  return [...by.values()].map((g) => ({ ...g, display: named.get(g.key) ?? prettyMerchant(g.names, g.key) }));
}
export function mergeMerchants(db: DB, keys: string[], into: string, name?: string | null) {
  ensureAliasTable(db); const up = db.prepare('INSERT INTO merchant_aliases (from_key, to_key, name) VALUES (?,?,?) ON CONFLICT(from_key) DO UPDATE SET to_key = excluded.to_key, name = excluded.name');
  db.transaction(() => { for (const k of new Set([...keys, into])) up.run(k, into, name ?? null); })(); return { ok: true };
}
/** Keep this name variant as its own merchant (undoes an automatic or manual merge). */
export function splitMerchant(db: DB, key: string) { ensureAliasTable(db); db.prepare('INSERT INTO merchant_aliases (from_key, to_key, name) VALUES (?,?,NULL) ON CONFLICT(from_key) DO UPDATE SET to_key = excluded.to_key, name = NULL').run(key, key); return { ok: true }; }
export function resetMerchant(db: DB, key: string) { ensureAliasTable(db); db.prepare('DELETE FROM merchant_aliases WHERE from_key = ? OR to_key = ?').run(key, key); return { ok: true }; }

/** Per-merchant stats for a period (default: the last N months): total, count, average, monthly trend, this month vs. usual. */
export function merchantStats(db: DB, months = 6, today = todayISO(), range?: { from?: string; to?: string }) {
  const from = range?.from ?? startOfMonth(addMonths(today, -(months - 1))); const to = range?.to ?? today;
  const rows = spending(db, from, to);
  const ms = monthsBetween(from, to); const cur = monthKey(today), prev = monthKey(addMonths(today, -1));
  const groups = groupMerchants(db, rows);
  const list: MerchantStat[] = groups.map((g): MerchantStat => {
    const total = g.rows.reduce((s, r) => s + r.amount_gel, 0);
    const monthly = ms.map((m) => { const x = g.rows.filter((r) => r.date.startsWith(m)); return { month: m, total: r2(x.reduce((s, r) => s + r.amount_gel, 0)), count: x.length }; });
    const past = monthly.filter((m) => m.month !== cur);
    const cats = new Map<string, number>(); for (const r of g.rows) if (r.category) cats.set(r.category, (cats.get(r.category) ?? 0) + 1);
    const ck = new Map<string, number>(); for (const r of g.rows) if (r.category_key) ck.set(r.category_key, (ck.get(r.category_key) ?? 0) + 1);
    return { key: g.key, name: g.display, categoryKey: [...ck].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null, category: [...cats].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      total: r2(total), count: g.rows.length, avg: r2(total / g.rows.length), last: g.rows.reduce((m, r) => (r.date > m ? r.date : m), ''), monthly,
      thisMonth: monthly.find((m) => m.month === cur)?.total ?? 0, lastMonth: monthly.find((m) => m.month === prev)?.total ?? 0, usualMonthly: r2(mean(past.map((m) => m.total))),
      activeMonths: monthly.filter((m) => m.count > 0).length, variants: [...g.variants].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count),
      perWeek: r2(g.rows.length / Math.max(1, (Date.parse(to) - Date.parse(from)) / (7 * 864e5))) };
  }).sort((a, b) => b.total - a.total);
  const total = list.reduce((s, m) => s + m.total, 0);
  // shares for the pie charts: top 8 + everything else
  const top = list.slice(0, 8); const rest = r2(total - top.reduce((s, m) => s + m.total, 0));
  const byMerchant = [...top.map((m) => ({ name: m.name, total: m.total })), ...(rest > 0 ? [{ name: 'Other', total: rest }] : [])];
  const cm = new Map<string, { name: string; total: number; color: string | null; count: number }>();
  for (const r of rows) { const k = r.category ?? 'Uncategorized'; const x = cm.get(k) ?? { name: k, total: 0, color: r.color, count: 0 }; x.total = r2(x.total + r.amount_gel); x.count++; cm.set(k, x); }
  const byCategory = [...cm.values()].sort((a, b) => b.total - a.total);
  // when you spend: weekday × part of day (hour from card time when known)
  const heat = Array.from({ length: 7 }, () => [0, 0, 0, 0]); const dow = Array(7).fill(0);
  for (const r of rows) { const d = (new Date(r.date + 'T12:00:00Z').getUTCDay() + 6) % 7; dow[d] += r.amount_gel; const h = r.time ? Number(String(r.time).slice(11, 13)) : NaN; if (!Number.isNaN(h)) heat[d][h < 6 ? 3 : h < 12 ? 0 : h < 18 ? 1 : 2] += r.amount_gel; }
  return { from, to, months: ms, total: r2(total), count: rows.length, merchants: list, byMerchant, byCategory, weekday: dow.map((v) => r2(v)), heat: heat.map((h) => h.map((v) => r2(v))),
    subscriptions: detectSubscriptions(groups), insights: merchantInsights(list, total, today, { rows, groups, from, to }) };
}

/** Same merchant, about monthly, about the same amount, 3+ times: a subscription (or a regular bill). */
export function detectSubscriptions(groups: ReturnType<typeof groupMerchants>) {
  const out: { name: string; amount: number; count: number; last: string; yearly: number }[] = [];
  for (const g of groups) {
    const r = [...g.rows].sort((a, b) => a.date.localeCompare(b.date)); if (r.length < 3) continue;
    const med = [...r.map((x) => x.amount_gel)].sort((a, b) => a - b)[Math.floor(r.length / 2)];
    const same = r.filter((x) => Math.abs(x.amount_gel - med) <= Math.max(0.5, 0.05 * med)); if (same.length < 3 || same.length < r.length * 0.6) continue;
    const gaps = same.slice(1).map((x, i) => (Date.parse(x.date) - Date.parse(same[i].date)) / 864e5);
    if (gaps.filter((d) => d >= 26 && d <= 35).length >= Math.max(2, gaps.length * 0.7)) out.push({ name: g.display, amount: r2(med), count: same.length, last: same[same.length - 1].date, yearly: r2(med * 12) });
  }
  return out.sort((a, b) => b.yearly - a.yearly);
}

/** Plain-language findings from the merchant stats — each only when the data clearly supports it. */
export function merchantInsights(list: MerchantStat[], total: number, today = todayISO(), ctx?: { rows: Spend[]; groups: ReturnType<typeof groupMerchants>; from: string; to: string }) {
  const out: { key: string; severity: 'info' | 'warning' | 'success'; params: Record<string, string | number> }[] = [];
  const dayFrac = Number(today.slice(8)) / Number(endOfMonth(today).slice(8));
  if (list[0] && total) out.push({ key: 'mTop', severity: 'info', params: { merchant: list[0].name, amount: Math.round(list[0].total), pct: Math.round((list[0].total / total) * 100), count: list[0].count } });
  const habit = list.filter((m) => m.activeMonths >= 3 && m.count >= 10).sort((a, b) => b.count - a.count)[0];
  if (habit) out.push({ key: 'mHabit', severity: 'info', params: { merchant: habit.name, count: habit.count, avg: r2(habit.avg), monthly: Math.round(habit.usualMonthly), perWeek: r2(habit.perWeek ?? 0) } });
  for (const m of list.filter((x) => x.activeMonths >= 3 && x.usualMonthly >= 30 && x.thisMonth > x.usualMonthly * 1.3 && dayFrac > 0.25).slice(0, 3))
    out.push({ key: 'mUp', severity: 'warning', params: { merchant: m.name, amount: Math.round(m.thisMonth), usual: Math.round(m.usualMonthly), pct: Math.round((m.thisMonth / m.usualMonthly - 1) * 100) } });
  const smallMany = list.filter((m) => m.avg < 10 && m.count >= 15);
  if (smallMany.length) { const t = smallMany.reduce((s, m) => s + m.total, 0); out.push({ key: 'mSmall', severity: 'info', params: { count: smallMany.reduce((s, m) => s + m.count, 0), amount: Math.round(t), names: smallMany.slice(0, 3).map((m) => m.name).join(', ') } }); }
  if (!ctx) return out;
  // average basket per grocery store (3+ visits)
  const groc = ctx.groups.filter((g) => g.rows.length >= 3 && g.rows.filter((r) => r.category_key === 'groceries').length >= g.rows.length * 0.6).map((g) => ({ name: g.display, avg: g.rows.reduce((s, r) => s + r.amount_gel, 0) / g.rows.length, n: g.rows.length })).sort((a, b) => b.n - a.n).slice(0, 3);
  if (groc.length >= 2) out.push({ key: 'mBasket', severity: 'info', params: { list: groc.map((g) => `${g.name} ${r2(g.avg)} ₾`).join(' · ') } });
  // category trend: last 3 full months vs the 3 before
  const m0 = startOfMonth(today), a1 = addMonths(m0, -3), a0 = addMonths(m0, -6);
  const sumCat = (f: string, t: string) => { const m = new Map<string, number>(); for (const r of ctx.rows) if (r.date >= f && r.date < t && r.category) m.set(r.category, (m.get(r.category) ?? 0) + r.amount_gel); return m; };
  if (ctx.from <= a0) { const now = sumCat(a1, m0), before = sumCat(a0, a1);
    const ch = [...now].map(([c, v]) => ({ c, v, b: before.get(c) ?? 0 })).filter((x) => x.b >= 150 && Math.abs(x.v - x.b) >= 100 && Math.abs(x.v / x.b - 1) >= 0.25).sort((x, y) => Math.abs(y.v - y.b) - Math.abs(x.v - x.b))[0];
    if (ch) out.push({ key: ch.v > ch.b ? 'mCatUp' : 'mCatDown', severity: ch.v > ch.b ? 'warning' : 'success', params: { category: ch.c, pct: Math.round(Math.abs(ch.v / ch.b - 1) * 100), now: Math.round(ch.v / 3), before: Math.round(ch.b / 3) } }); }
  // where you could save: the biggest non-essential regular, at 25% less
  const ess = new Set(['groceries', 'rent', 'utilities', 'electricity', 'gas', 'water', 'internet', 'phone', 'health', 'education', 'insurance']);
  const opt = list.filter((m) => m.activeMonths >= 3 && m.usualMonthly >= 40 && !ess.has(m.categoryKey ?? ''))[0];
  if (opt) out.push({ key: 'mSave', severity: 'info', params: { merchant: opt.name, monthly: Math.round(opt.usualMonthly), yearly: Math.round(opt.usualMonthly * 12 * 0.25) } });
  // weekday peak (only when clearly above the rest)
  const dow = Array(7).fill(0); for (const r of ctx.rows) dow[(new Date(r.date + 'T12:00:00Z').getUTCDay() + 6) % 7] += r.amount_gel;
  const mx = Math.max(...dow), avg = dow.reduce((a, b) => a + b, 0) / 7;
  if (ctx.rows.length >= 60 && mx > avg * 1.4) out.push({ key: 'mWeekday', severity: 'info', params: { day: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][dow.indexOf(mx)], pct: Math.round((mx / avg - 1) * 100) } });
  return out;
}

/** One month at a glance (for the dashboard trend drill-down). */
export function monthSummary(db: DB, month: string) {
  const from = `${month}-01`, to = endOfMonth(from);
  const t = db.prepare(`SELECT ROUND(SUM(CASE WHEN kind='income' THEN amount_gel ELSE 0 END), 2) AS income, ROUND(SUM(CASE WHEN kind='expense' THEN amount_gel ELSE 0 END), 2) AS expense,
    ROUND(SUM(CASE WHEN kind='transfer' THEN amount_gel ELSE 0 END), 2) AS moved, COUNT(*) AS count FROM transactions WHERE date BETWEEN ? AND ?`).get(from, to) as any;
  const byCategory = db.prepare(`SELECT COALESCE(p.name, c.name, 'Uncategorized') AS name, COALESCE(p.color, c.color, '#94a3b8') AS color, ROUND(SUM(t.amount_gel), 2) AS total, COUNT(*) AS count
    FROM transactions t LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN categories p ON p.id = c.parent_id WHERE t.kind = 'expense' AND t.date BETWEEN ? AND ? GROUP BY 1 ORDER BY total DESC`).all(from, to);
  const incomeBy = db.prepare(`SELECT COALESCE(p.name, c.name, 'Uncategorized') AS name, ROUND(SUM(t.amount_gel), 2) AS total FROM transactions t LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN categories p ON p.id = c.parent_id
    WHERE t.kind = 'income' AND t.date BETWEEN ? AND ? GROUP BY 1 ORDER BY total DESC`).all(from, to);
  const m = new Map<string, { name: string; total: number; count: number }>();
  for (const g of groupMerchants(db, spending(db, from, to))) m.set(g.key, { name: g.display, total: r2(g.rows.reduce((s, r) => s + r.amount_gel, 0)), count: g.rows.length });
  const income = t.income ?? 0, expense = t.expense ?? 0;
  return { month, income, expense, net: r2(income - expense), savingsRate: income > 0 ? r2((income - expense) / income) : null, movedOwn: t.moved ?? 0, count: t.count,
    byCategory, incomeBy, topMerchants: [...m.values()].sort((a, b) => b.total - a.total).slice(0, 8) };
}
