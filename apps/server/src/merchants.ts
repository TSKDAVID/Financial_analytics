import { addMonths, endOfMonth, mean, monthKey, monthsBetween, normalizeMerchantName, merchantKeyOf, startOfMonth, todayISO } from '@fa/core';
import type { DB } from './schema';

export interface MerchantStat { key: string; name: string; category: string | null; total: number; count: number; avg: number; last: string; monthly: { month: string; total: number; count: number }[]; thisMonth: number; lastMonth: number; usualMonthly: number; activeMonths: number }
const r2 = (x: number) => Math.round(x * 100) / 100;
interface Spend { id: number; date: string; amount_gel: number; description: string | null; merchant: string | null; category: string | null; color: string | null; category_key: string | null }

/** Spending rows (purchases, bills, subscriptions…) — never transfers to people, own transfers, cash or fees. */
function spending(db: DB, from: string, to: string): Spend[] {
  return db.prepare(`SELECT t.id, t.date, t.amount_gel, t.description, r.merchant, COALESCE(p.name, c.name) AS category, COALESCE(p.color, c.color) AS color, COALESCE(p.key, c.key) AS category_key
    FROM transactions t LEFT JOIN import_rows r ON r.transaction_id = t.id LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN categories p ON p.id = c.parent_id
    WHERE t.kind = 'expense' AND t.date BETWEEN ? AND ? AND COALESCE(t.tx_kind, '') NOT IN ('transfer_out', 'cash_withdrawal', 'fee', 'loan_repayment')
    AND COALESCE(c.key, '') NOT IN ('p2p_out', 'cash', 'fees', 'loans') GROUP BY t.id`).all(from, to) as Spend[];
}
export const merchantOf = (s: { merchant: string | null; description: string | null }) => {
  const name = normalizeMerchantName(s.merchant || (s.description ?? '').split(/[;,]/)[0] || '—');
  return { name, key: merchantKeyOf(name) || name.toLowerCase() };
};

/** Per-merchant stats over the last N months: total, count, average, monthly trend and this month vs. the usual. */
export function merchantStats(db: DB, months = 6, today = todayISO()) {
  const from = startOfMonth(addMonths(today, -(months - 1)));
  const rows = spending(db, from, today);
  const ms = monthsBetween(from, today); const cur = monthKey(today), prev = monthKey(addMonths(today, -1));
  const by = new Map<string, { key: string; names: Map<string, number>; rows: Spend[] }>();
  const mk = (key: string) => ({ key, names: new Map<string, number>(), rows: [] as Spend[] });
  for (const r of rows) { const m = merchantOf(r); const g = by.get(m.key) ?? mk(m.key); g.names.set(m.name, (g.names.get(m.name) ?? 0) + 1); g.rows.push(r); by.set(m.key, g); }
  const list: MerchantStat[] = [...by.values()].map((g): MerchantStat => {
    const total = g.rows.reduce((s, r) => s + r.amount_gel, 0);
    const monthly = ms.map((m) => ({ month: m, total: r2(g.rows.filter((r) => r.date.startsWith(m)).reduce((s, r) => s + r.amount_gel, 0)), count: g.rows.filter((r) => r.date.startsWith(m)).length }));
    const past = monthly.filter((m) => m.month !== cur);
    const usual = mean(past.map((m) => m.total));
    const cats = new Map<string, number>(); for (const r of g.rows) if (r.category) cats.set(r.category, (cats.get(r.category) ?? 0) + 1);
    return { key: g.key, name: [...g.names].sort((a, b) => b[1] - a[1])[0][0], category: [...cats].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      total: r2(total), count: g.rows.length, avg: r2(total / g.rows.length), last: g.rows.reduce((m, r) => (r.date > m ? r.date : m), ''), monthly,
      thisMonth: monthly.find((m) => m.month === cur)?.total ?? 0, lastMonth: monthly.find((m) => m.month === prev)?.total ?? 0, usualMonthly: r2(usual),
      activeMonths: monthly.filter((m) => m.count > 0).length };
  }).sort((a, b) => b.total - a.total);
  const total = list.reduce((s, m) => s + m.total, 0);
  return { from, to: today, months: ms, total: r2(total), merchants: list, insights: merchantInsights(list, total, today) };
}

/** Plain-language findings from the merchant stats. */
export function merchantInsights(list: MerchantStat[], total: number, today = todayISO()) {
  const out: { key: string; severity: 'info' | 'warning' | 'success'; params: Record<string, string | number> }[] = [];
  const dayFrac = Number(today.slice(8)) / Number(endOfMonth(today).slice(8));
  if (list[0] && total) out.push({ key: 'mTop', severity: 'info', params: { merchant: list[0].name, amount: Math.round(list[0].total), pct: Math.round((list[0].total / total) * 100), count: list[0].count } });
  const habit = list.filter((m) => m.activeMonths >= 3 && m.count >= 10).sort((a, b) => b.count - a.count)[0];
  if (habit) out.push({ key: 'mHabit', severity: 'info', params: { merchant: habit.name, count: habit.count, avg: r2(habit.avg), monthly: Math.round(habit.usualMonthly) } });
  // regulars spending clearly more than usual this month (already paid, not extrapolated)
  for (const m of list.filter((x) => x.activeMonths >= 3 && x.usualMonthly >= 30 && x.thisMonth > x.usualMonthly * 1.3 && dayFrac > 0.25).slice(0, 3))
    out.push({ key: 'mUp', severity: 'warning', params: { merchant: m.name, amount: Math.round(m.thisMonth), usual: Math.round(m.usualMonthly), pct: Math.round((m.thisMonth / m.usualMonthly - 1) * 100) } });
  const smallMany = list.filter((m) => m.avg < 10 && m.count >= 15);
  if (smallMany.length) { const t = smallMany.reduce((s, m) => s + m.total, 0); out.push({ key: 'mSmall', severity: 'info', params: { count: smallMany.reduce((s, m) => s + m.count, 0), amount: Math.round(t), names: smallMany.slice(0, 3).map((m) => m.name).join(', ') } }); }
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
  for (const r of spending(db, from, to)) { const k = merchantOf(r); const x = m.get(k.key) ?? { name: k.name, total: 0, count: 0 }; x.total = r2(x.total + r.amount_gel); x.count++; m.set(k.key, x); }
  const income = t.income ?? 0, expense = t.expense ?? 0;
  return { month, income, expense, net: r2(income - expense), savingsRate: income > 0 ? r2((income - expense) / income) : null, movedOwn: t.moved ?? 0, count: t.count,
    byCategory, incomeBy, topMerchants: [...m.values()].sort((a, b) => b.total - a.total).slice(0, 8) };
}
