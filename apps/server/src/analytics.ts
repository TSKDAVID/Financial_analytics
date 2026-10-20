import {
  addDays, addMonths, endOfMonth, monthKey, startOfMonth, todayISO, forecast, dailyProjection, healthScore, dtiLevel, stressTest,
  detectAnomalies, isSpike, seasonality, mean, diffDays, monthsBetween,
} from '@fa/core';
import type { DB } from './schema';
import { getSetting } from './schema';
import { accountBalances, budgetStatus, futureFlows, monthlyTotals, periodSummary, riskMetrics, subscriptionInfo, type SubRow, catTree } from './services';

const r2 = (x: number) => Math.round(x * 100) / 100;

/** Is there enough history to compute scores, forecasts and risk alerts? (≥1 income and ≥1 expense transaction) */
export function dataStatus(db: DB) {
  const r = db.prepare("SELECT SUM(kind = 'income') AS inc, SUM(kind = 'expense') AS exp, COUNT(DISTINCT substr(date,1,7)) AS months FROM transactions WHERE kind != 'transfer'").get() as { inc: number | null; exp: number | null; months: number };
  const accounts = (db.prepare('SELECT COUNT(*) AS c FROM accounts WHERE archived = 0').get() as { c: number }).c;
  const income = r.inc ?? 0, expense = r.exp ?? 0;
  return { incomeCount: income, expenseCount: expense, months: r.months, accounts, sufficient: income > 0 && expense > 0 };
}
/** User-defined minimum balance, or null when not set. */
export function minBalance(db: DB): number | null {
  const v = getSetting(db, 'minBalance'); if (v == null || v.trim() === '') return null;
  const n = Number(v); return isFinite(n) ? n : null;
}

export function dashboard(db: DB, from: string, to: string) {
  const len = diffDays(from, to) + 1;
  const cur = periodSummary(db, from, to);
  const prevTo = addDays(from, -1), prevFrom = addDays(prevTo, -(len - 1));
  const isMonth = from.slice(8) === '01' && to === endOfMonth(from);
  const prev = isMonth ? periodSummary(db, startOfMonth(addMonths(from, -1)), endOfMonth(addMonths(from, -1))) : periodSummary(db, prevFrom, prevTo);
  const yoy = periodSummary(db, addMonths(from, -12), addMonths(to, -12));
  const risk = riskMetrics(db);
  const byCategory = db.prepare(`SELECT COALESCE(p.id, c.id) AS id, COALESCE(p.name, c.name, 'Uncategorized') AS name, COALESCE(p.color, c.color, '#94a3b8') AS color, COALESCE(p.key, c.key) AS key, t.kind, SUM(t.amount_gel) AS total
    FROM transactions t LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN categories p ON p.id = c.parent_id
    WHERE t.date BETWEEN ? AND ? AND t.kind != 'transfer' GROUP BY 1, t.kind ORDER BY total DESC`).all(from, to);
  const trendFrom = startOfMonth(addMonths(to, -11));
  const months = monthsBetween(trendFrom, to);
  const mt = new Map(monthlyTotals(db, trendFrom, to).map((m) => [m.month, m]));
  const trend = months.map((m) => { const x = mt.get(m); const inc = r2(x?.income ?? 0), exp = r2(x?.expense ?? 0); return { month: m, income: inc, expense: exp, net: r2(inc - exp) }; });
  const daily = db.prepare(`SELECT date, SUM(CASE WHEN kind='income' THEN amount_gel WHEN kind='expense' THEN -amount_gel ELSE 0 END) AS net,
    SUM(CASE WHEN kind='expense' THEN amount_gel ELSE 0 END) AS expense FROM transactions WHERE date BETWEEN ? AND ? GROUP BY date`).all(addDays(to, -364), to);
  const series = db.prepare(`SELECT date, SUM(CASE WHEN kind='income' THEN amount_gel ELSE 0 END) AS income, SUM(CASE WHEN kind='expense' THEN amount_gel ELSE 0 END) AS expense FROM transactions WHERE date BETWEEN ? AND ? GROUP BY date ORDER BY date`).all(from, to);
  const pct = (a: number, b: number) => (b ? (a - b) / Math.abs(b) : null);
  return {
    period: { from, to }, ...cur, netWorth: risk.netWorth, totalAssets: risk.totalAssets, totalDebt: risk.totalDebt,
    compare: {
      prev: { ...prev, incomePct: pct(cur.income, prev.income), expensePct: pct(cur.expense, prev.expense), netPct: pct(cur.net, prev.net) },
      yoy: { ...yoy, incomePct: pct(cur.income, yoy.income), expensePct: pct(cur.expense, yoy.expense), netPct: pct(cur.net, yoy.net) },
    },
    byCategory, trend, daily, series, accounts: accountBalances(db).filter((a) => !a.archived), dataStatus: dataStatus(db),
  };
}

export interface WhatIf { months?: number; incomeChangePct?: number; newLoan?: { principal: number; annualRatePct: number; termMonths: number } | null; newExpenseMonthly?: number; oneOff?: { date: string; amount: number }[] }

export function forecastData(db: DB, w: WhatIf = {}) {
  const today = todayISO();
  const months = w.months ?? 12;
  const balance = accountBalances(db).filter((a) => !a.archived && a.liquid).reduce((s, a) => s + a.balance_gel, 0);
  const histFrom = startOfMonth(addMonths(today, -12)), histTo = endOfMonth(addMonths(today, -1));
  const varHist = monthlyTotals(db, histFrom, histTo, { variableOnly: true }).map((m) => m.income - m.expense);
  const flows = futureFlows(db, today);
  const monthlyDelta = -(w.newExpenseMonthly ?? 0);
  const oneOff = [...(w.oneOff ?? [])];
  if (w.newLoan && w.newLoan.principal > 0) {
    const i = w.newLoan.annualRatePct / 100 / 12, n = w.newLoan.termMonths;
    const pay = i === 0 ? w.newLoan.principal / n : (w.newLoan.principal * i) / (1 - Math.pow(1 + i, -n));
    flows.push({ rule: { unit: 'month', interval: 1, start: addMonths(today, 1), count: n }, amount: -pay });
    oneOff.push({ date: addDays(today, 1), amount: w.newLoan.principal });
  }
  const base = forecast({ startBalance: balance, asOf: today, months, recurring: futureFlows(db, today), historyVariableNet: varHist });
  const scenario = forecast({ startBalance: balance, asOf: today, months, recurring: flows, historyVariableNet: varHist, adjustments: { incomeChangePct: w.incomeChangePct, monthlyDelta, oneOff } });
  const minBal = minBalance(db); const status = dataStatus(db);
  const firstBelow = minBal != null && status.sufficient ? scenario.find((p) => p.expected < minBal)?.month ?? null : null;
  return { startBalance: r2(balance), minBalance: minBal, base, scenario, firstBelow, monthlyVariableAvg: r2(mean(varHist)), dataStatus: status, insufficient: !status.sufficient };
}

export function riskData(db: DB) {
  const m = riskMetrics(db);
  const h = healthScore(m);
  const st = stressTest(m.liquidSavings, m.monthlyEssential, m.monthlyDebtPayments, 24);
  const target = Number(getSetting(db, 'emergencyTargetMonths') ?? 6);
  const minBal = minBalance(db); const status = dataStatus(db);
  const days = Number(getSetting(db, 'lowBalanceDays') ?? 30);
  const liquid = m.liquidSavings;
  const flows = futureFlows(db);
  const histFrom = startOfMonth(addMonths(todayISO(), -6));
  const varHist = monthlyTotals(db, histFrom, endOfMonth(addMonths(todayISO(), -1)), { variableOnly: true }).map((x) => x.income - x.expense);
  const proj = dailyProjection(liquid, todayISO(), days, flows, mean(varHist) / 30.4);
  const lowest = proj.reduce((lo, p) => (p.balance < lo.balance ? p : lo), proj[0] ?? { date: todayISO(), balance: liquid, change: 0 });
  const firstBelow = minBal != null && status.sufficient ? proj.find((p) => p.balance < minBal) ?? null : null;
  return {
    ...m, loans: undefined, health: h, dtiLevel: dtiLevel(h.dti), stress: { ...st, runwayMonths: isFinite(st.runwayMonths) ? r2(st.runwayMonths) : null },
    emergency: { months: r2(h.emergencyMonths), target, needed: r2(Math.max(0, target * m.monthlyExpenses - liquid)) },
    lowBalance: { minBalance: minBal, days, lowest, firstBelow, projection: proj }, budgets: budgetStatus(db), dataStatus: status, insufficient: !status.sufficient,
  };
}

export interface Insight { key: string; severity: 'info' | 'warning' | 'danger' | 'success'; params: Record<string, string | number> }

export function insights(db: DB): Insight[] {
  const today = todayISO();
  const out: Insight[] = [];
  const status = dataStatus(db);
  const curFrom = startOfMonth(today);
  const dayFrac = Math.max(0.1, Number(today.slice(8)) / Number(endOfMonth(today).slice(8)));
  const cats = db.prepare("SELECT id, name, key FROM categories WHERE kind='expense' AND parent_id IS NULL").all() as { id: number; name: string; key: string }[];
  for (const c of cats) {
    const ids = catTree(db, c.id).join(',');
    const rows = db.prepare(`SELECT substr(date,1,7) AS m, SUM(amount_gel) AS s FROM transactions WHERE kind='expense' AND recurring_id IS NULL AND loan_id IS NULL AND subscription_id IS NULL AND category_id IN (${ids}) AND date BETWEEN ? AND ? GROUP BY m`).all(startOfMonth(addMonths(today, -6)), today) as { m: string; s: number }[];
    const cur = rows.find((r) => r.m === monthKey(today))?.s ?? 0;
    const hist = rows.filter((r) => r.m !== monthKey(today)).map((r) => r.s);
    if (hist.length >= 2) {
      const avg = mean(hist), projected = cur / dayFrac;
      if (avg > 50 && projected > avg * 1.25 && cur > avg * 0.5) out.push({ key: 'catAbove', severity: 'warning', params: { category: c.name, pct: Math.round((projected / avg - 1) * 100), avg: Math.round(avg) } });
      else if (avg > 50 && dayFrac > 0.8 && projected < avg * 0.75) out.push({ key: 'catBelow', severity: 'success', params: { category: c.name, pct: Math.round((1 - projected / avg) * 100) } });
    }
  }
  // seasonality for utilities subcategories
  for (const key of ['gas', 'electricity', 'water']) {
    const c = db.prepare('SELECT id, name FROM categories WHERE key = ?').get(key) as { id: number; name: string } | undefined;
    if (!c) continue;
    const rows = db.prepare(`SELECT substr(date,1,7) AS month, SUM(amount_gel) AS value FROM transactions WHERE kind='expense' AND category_id = ? AND date >= ? GROUP BY month`).all(c.id, addMonths(today, -24)) as { month: string; value: number }[];
    const s = seasonality(rows);
    if (s) out.push({ key: s === 'winter' ? 'seasonWinter' : 'seasonSummer', severity: 'info', params: { category: c.name } });
  }
  const sum = periodSummary(db, startOfMonth(addMonths(today, -3)), endOfMonth(addMonths(today, -1)));
  if (status.sufficient && sum.income > 0) {
    const sr = Math.round(sum.savingsRate * 100);
    out.push({ key: sr >= 20 ? 'savingsGood' : sr >= 0 ? 'savingsLow' : 'savingsNegative', severity: sr >= 20 ? 'success' : sr >= 0 ? 'warning' : 'danger', params: { pct: sr } });
  }
  const subs = (db.prepare('SELECT * FROM subscriptions WHERE active = 1').all() as SubRow[]).map((s) => subscriptionInfo(db, s));
  const subTotal = subs.filter((s) => s.kind === 'subscription').reduce((a, s) => a + s.yearly_gel, 0);
  if (subTotal > 0) out.push({ key: 'subsYearly', severity: 'info', params: { amount: Math.round(subTotal), count: subs.filter((s) => s.kind === 'subscription').length } });
  const unused = subs.filter((s) => s.unused);
  if (unused.length) out.push({ key: 'subsUnused', severity: 'warning', params: { names: unused.map((s) => s.name).join(', '), amount: Math.round(unused.reduce((a, s) => a + s.yearly_gel, 0)) } });
  const anomalies = anomaliesList(db).slice(0, 3);
  for (const a of anomalies) out.push({ key: 'anomaly', severity: 'warning', params: { description: a.description ?? a.category ?? '', amount: Math.round(a.amount_gel), date: a.date, times: r2(a.amount_gel / a.median) } });
  const fc = forecastData(db, { months: 6 });
  if (fc.insufficient) { /* no forecast insights without history */ }
  else if (fc.firstBelow) out.push({ key: 'forecastBelow', severity: 'danger', params: { month: fc.firstBelow, min: fc.minBalance } });
  else if (fc.base.length) out.push({ key: 'forecastOk', severity: 'success', params: { amount: Math.round(fc.base[fc.base.length - 1].expected), months: 6 } });
  void curFrom;
  return out;
}

export function anomaliesList(db: DB) {
  const rows = db.prepare(`SELECT t.id, t.date, t.amount_gel, t.category_id, t.kind, t.description, c.name AS category FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.date >= ? AND t.kind = 'expense' AND t.loan_id IS NULL`).all(addMonths(todayISO(), -6)) as any[];
  const res = detectAnomalies(rows.map((r) => ({ id: r.id, date: r.date, amount: r.amount_gel, categoryId: r.category_id, kind: r.kind })));
  const map = new Map(rows.map((r) => [r.id, r]));
  return res.map((a) => ({ ...map.get(a.id), score: a.score, median: a.median })).filter((a) => a.date >= addDays(todayISO(), -60)).sort((a, b) => b.date.localeCompare(a.date));
}

export function utilitiesData(db: DB) {
  const parent = db.prepare("SELECT id FROM categories WHERE key = 'utilities'").get() as { id: number } | undefined;
  if (!parent) return { months: [], categories: [], jumps: [] };
  const ids = catTree(db, parent.id);
  const cats = db.prepare(`SELECT id, key, name, color FROM categories WHERE id IN (${ids.join(',')})`).all() as { id: number; key: string; name: string; color: string }[];
  const from = startOfMonth(addMonths(todayISO(), -12));
  const rows = db.prepare(`SELECT substr(date,1,7) AS m, category_id AS c, SUM(amount_gel) AS s FROM transactions WHERE kind='expense' AND category_id IN (${ids.join(',')}) AND date >= ? GROUP BY m, c`).all(from) as { m: string; c: number; s: number }[];
  const months = monthsBetween(from, todayISO()).map((m) => {
    const o: Record<string, number | string> = { month: m };
    for (const c of cats) o[c.key] = r2(rows.filter((r) => r.m === m && r.c === c.id).reduce((s, r) => s + r.s, 0));
    return o;
  });
  const jumps: { key: string; name: string; month: string; amount: number; usual: number; pct: number }[] = [];
  for (const c of cats) {
    const vals = months.map((m) => Number(m[c.key])).filter((v) => v > 0);
    if (vals.length < 4) continue;
    const latestMonth = [...months].reverse().find((m) => Number(m[c.key]) > 0)!;
    const latest = Number(latestMonth[c.key]);
    const hist = vals.slice(0, -1);
    if (isSpike(latest, hist, 1)) jumps.push({ key: c.key, name: c.name, month: String(latestMonth.month), amount: latest, usual: r2(mean(hist)), pct: Math.round((latest / mean(hist) - 1) * 100) });
  }
  return { months, categories: cats.filter((c) => c.key !== 'utilities' || rows.some((r) => r.c === c.id)), jumps };
}
