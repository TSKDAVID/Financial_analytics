/** Forecast tab: defaults from your real data, the saved scenario, and the projection. */
import { addMonths, endOfMonth, startOfMonth, todayISO, planForecast, type PlanInput, type PlanStrategy } from '@fa/core';
import { getSetting, setSetting, type DB } from './schema';
import { accountBalances, loanStatus, type LoanRow } from './services';
import { latestRates } from './rates';
import { reconciliation, bankNorm } from './cashflow';
import { addDays } from '@fa/core';

const r2 = (x: number) => Math.round(x * 100) / 100;
export interface PlanScenario {
  months: number; incomes: { name: string; amount: number }[]; expenses: number; savingsMonthly: number; savingsRatePct: number;
  strategy: PlanStrategy; extraPool: number; debtExtra: Record<string, number>;
}

/** Averages of the last 3 full months that have data (current month if there is nothing older). */
export function planDefaults(db: DB, today = todayISO()) {
  const from = startOfMonth(addMonths(today, -3)), to = endOfMonth(addMonths(today, -1));
  let months = (db.prepare("SELECT COUNT(DISTINCT substr(date,1,7)) FROM transactions WHERE kind != 'transfer' AND date BETWEEN ? AND ?").pluck().get(from, to) as number) || 0;
  let f = from, t = to;
  if (!months) { f = startOfMonth(today); t = today; months = (db.prepare("SELECT COUNT(*) FROM transactions WHERE kind != 'transfer' AND date BETWEEN ? AND ?").pluck().get(f, t) as number) ? 1 : 0; }
  const live = 'NOT (t.recurring_id IS NOT NULL AND t.confirmed = 0)';
  const inc = months ? db.prepare(`SELECT COALESCE(p.name, c.name, 'Other') AS name, SUM(t.amount_gel) AS s FROM transactions t LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN categories p ON p.id = c.parent_id
    WHERE t.kind = 'income' AND t.date BETWEEN ? AND ? AND ${live} GROUP BY 1 ORDER BY s DESC`).all(f, t) as { name: string; s: number }[] : [];
  const exp = months ? (db.prepare(`SELECT COALESCE(SUM(t.amount_gel), 0) FROM transactions t LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN categories p ON p.id = c.parent_id
    WHERE t.kind = 'expense' AND t.date BETWEEN ? AND ? AND ${live} AND t.loan_id IS NULL AND COALESCE(t.tx_kind,'') != 'loan_repayment' AND COALESCE(c.key,'') != 'loans' AND COALESCE(p.key,'') != 'loans'`).pluck().get(f, t) as number) : 0;
  const bal = accountBalances(db).filter((a) => !a.archived);
  const rates = latestRates(db);
  // insurance etc. charged next to each installment: an imported "insurance" fee within 3 days of the loan's due date
  const feeRows = db.prepare(`SELECT t.date, t.amount_gel, b.bank FROM transactions t JOIN import_batches b ON b.id = t.import_batch_id WHERE t.kind = 'expense' AND t.tx_kind = 'fee' AND t.date >= ? AND (t.description LIKE '%დაზღვ%' OR lower(t.description) LIKE '%insurance%') ORDER BY t.date DESC`).all(addMonths(today, -4)) as { date: string; amount_gel: number; bank: string }[];
  const feeFor = (loanId: number, bank: string) => {
    for (const f of feeRows) { if (bankNorm(f.bank) !== bankNorm(bank)) continue; const hit = db.prepare('SELECT 1 FROM bills WHERE loan_id = ? AND due_date BETWEEN ? AND ?').get(loanId, addDays(f.date, -3), addDays(f.date, 3)); if (hit) return f.amount_gel; }
    return 0;
  };
  // money that keeps arriving from your own accounts that are not in the app (e.g. a business account) is income for planning
  const own = months ? monthsList(f, t).map((m) => reconciliation(db, m.from, m.to).lines.find((l) => l.key === 'ownOther')?.amount ?? 0) : [];
  const ownAvg = own.length ? own.reduce((a, b) => a + b, 0) / own.length : 0;
  const debts = (db.prepare('SELECT * FROM loans WHERE active = 1').all() as LoanRow[]).map((l) => {
    const st = loanStatus(db, l); const rate = rates[l.currency] ?? 1;
    return { id: l.id, name: `${l.bank} · ${l.name}`, balance: r2(st.remaining_gel), annualRatePct: l.annual_rate, minPayment: r2((st.months_left > 0 ? st.monthly_payment : 0) * rate),
      monthlyFee: r2((l.monthly_fee || feeFor(l.id, l.bank)) * rate), revolving: !!st.revolving, savedExtra: l.extra_monthly ?? 0 };
  }).filter((d) => d.balance > 0.005);
  return {
    basedOn: months ? { from: f, to: t, months } : null,
    incomes: [...inc.filter((i) => i.s > 0).map((i) => ({ name: i.name, amount: r2(i.s / months) })), ...(ownAvg > 1 ? [{ name: 'From your other own accounts', amount: r2(ownAvg) }] : [])],
    expenses: r2(months ? exp / months : 0),
    cash: r2(bal.filter((a) => a.type !== 'savings').reduce((s, a) => s + a.balance_gel, 0)),
    savings: r2(bal.filter((a) => a.type === 'savings').reduce((s, a) => s + a.balance_gel, 0)),
    debts,
  };
}

export function savedScenario(db: DB): PlanScenario | null { try { const v = getSetting(db, 'forecastPlan'); return v ? JSON.parse(v) : null; } catch { return null; } }
export function saveScenario(db: DB, s: PlanScenario) { setSetting(db, 'forecastPlan', JSON.stringify(s)); }

export function runPlan(db: DB, s?: Partial<PlanScenario> | null) {
  const d = planDefaults(db);
  const sc: PlanScenario = {
    months: Math.min(60, Math.max(1, Math.round(s?.months ?? 24))), incomes: s?.incomes ?? d.incomes, expenses: s?.expenses ?? d.expenses,
    savingsMonthly: s?.savingsMonthly ?? 0, savingsRatePct: s?.savingsRatePct ?? 0, strategy: s?.strategy ?? 'none', extraPool: s?.extraPool ?? 0,
    debtExtra: s?.debtExtra ?? Object.fromEntries(d.debts.filter((x) => x.savedExtra > 0).map((x) => [String(x.id), x.savedExtra])),
  };
  const input: PlanInput = { months: sc.months, startCash: d.cash, startSavings: d.savings, incomes: sc.incomes, expenses: sc.expenses, savingsMonthly: sc.savingsMonthly,
    savingsRatePct: sc.savingsRatePct, strategy: sc.strategy, extraPool: sc.extraPool,
    debts: d.debts.map((x) => ({ id: x.id, name: x.name, balance: x.balance, annualRatePct: x.annualRatePct, minPayment: x.minPayment, monthlyFee: x.monthlyFee, extra: Number(sc.debtExtra[String(x.id)]) || 0 })) };
  const res = planForecast(input);
  const start = todayISO();
  const label = (m: number | null) => (m == null ? null : startOfMonth(addMonths(start, m)).slice(0, 7));
  return { scenario: sc, defaults: d, empty: !d.basedOn && !d.debts.length,
    ...res, debts: res.debts.map((x) => ({ ...x, payoff: label(x.payoffMonth) })), debtFree: label(res.debtFreeMonth),
    months: res.months.map((m) => ({ ...m, label: label(m.month) })) };
}

function monthsList(from: string, to: string) {
  const out: { from: string; to: string }[] = [];
  for (let m = startOfMonth(from); m <= to; m = addMonths(m, 1)) out.push({ from: m, to: endOfMonth(m) < to ? endOfMonth(m) : to });
  return out;
}
