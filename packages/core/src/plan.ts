/**
 * Long-range "what if" plan: income, spending, savings and debt payoff month by month.
 * Everything is in one currency (GEL). Pure math, no I/O.
 */
export interface PlanDebt {
  id: string | number; name: string;
  balance: number; annualRatePct: number;
  /** fixed minimum (loan installment, or card minimum floor) */
  minPayment: number;
  /** cards: minimum as a share of the balance (0.05 = 5%); the larger of this and minPayment applies */
  minPct?: number;
  /** charged with every payment while the debt is open (e.g. life insurance) — a cost, not principal */
  monthlyFee?: number;
  /** your own overpayment on this debt each month */
  extra?: number;
}
export type PlanStrategy = 'none' | 'avalanche' | 'snowball';
export interface PlanInput {
  months: number;
  startCash: number;
  startSavings: number;
  incomes: { name: string; amount: number }[];
  /** monthly spending, NOT counting debt payments or savings */
  expenses: number;
  savingsMonthly: number;
  savingsRatePct: number;
  debts: PlanDebt[];
  /** extra money each month aimed at debts in strategy order; with a strategy, paid-off debts' payments roll into it */
  strategy: PlanStrategy;
  extraPool?: number;
}
export interface PlanMonth { month: number; cash: number; savings: number; debt: number; netWorth: number; interest: number; debtPaid: number; fees: number; debts: Record<string, number> }
export interface PlanDebtResult { id: string | number; name: string; payoffMonth: number | null; interest: number; fees: number; neverPaysOff: boolean }
export interface PlanResult {
  months: PlanMonth[];
  debts: PlanDebtResult[];
  /** to payoff (or the 50-year cap), not just the horizon */
  totalInterest: number; totalFees: number;
  baseline: { totalInterest: number; totalFees: number; payoffMonth: number | null };
  interestSaved: number; feesSaved: number;
  debtFreeMonth: number | null;
  /** interest inside the selected horizon */
  horizonInterest: number;
}
const CAP = 600;
const r2 = (x: number) => Math.round(x * 100) / 100;
const minDue = (d: PlanDebt, bal: number) => Math.max(d.minPayment || 0, (d.minPct ?? 0) * bal);

function simulate(inp: PlanInput, withPlan: boolean) {
  const debts = inp.debts.map((d) => ({ d, bal: Math.max(0, d.balance), interest: 0, fees: 0, payoff: d.balance <= 0.005 ? 0 : (null as number | null) }));
  const income = inp.incomes.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const sr = (inp.savingsRatePct || 0) / 100 / 12;
  const useStrategy = withPlan && inp.strategy !== 'none';
  let cash = inp.startCash, sav = inp.startSavings;
  const rows: PlanMonth[] = [];
  const total = Math.max(1, Math.floor(inp.months));
  for (let m = 1; m <= CAP; m++) {
    let interest = 0, minPaid = 0, poolPaid = 0, fees = 0, freed = 0, progress = false;
    for (const x of debts) {
      if (x.bal <= 0.005) { if (useStrategy) freed += minDue(x.d, 0) + (x.d.extra ?? 0); continue; }
      const i = x.bal * (x.d.annualRatePct / 100 / 12); x.bal += i; x.interest += i; interest += i;
      const pay = Math.min(x.bal, minDue(x.d, x.bal) + (withPlan ? x.d.extra ?? 0 : 0));
      if (pay > i + 0.005) progress = true;
      x.bal -= pay; minPaid += pay;
      const fee = x.d.monthlyFee ?? 0; x.fees += fee; fees += fee;
      if (x.bal <= 0.005) { x.bal = 0; x.payoff = m; }
    }
    if (useStrategy) {
      // your extra plus the payments of debts already paid off go to the next debt in line
      let pool = Math.max(0, inp.extraPool ?? 0) + freed;
      const open = debts.filter((x) => x.bal > 0.005).sort((a, b) => inp.strategy === 'avalanche' ? b.d.annualRatePct - a.d.annualRatePct || a.bal - b.bal : a.bal - b.bal || b.d.annualRatePct - a.d.annualRatePct);
      for (const x of open) { if (pool <= 0.005) break; const pay = Math.min(x.bal, pool); x.bal -= pay; pool -= pay; poolPaid += pay; progress = true; if (x.bal <= 0.005) { x.bal = 0; x.payoff = m; } }
    }
    sav = sav * (1 + sr) + (inp.savingsMonthly || 0);
    cash += income - (inp.expenses || 0) - (inp.savingsMonthly || 0) - fees - minPaid - poolPaid; // unused pool stays in cash
    const debtLeft = debts.reduce((s, x) => s + x.bal, 0);
    if (m <= total) rows.push({ month: m, cash: r2(cash), savings: r2(sav), debt: r2(debtLeft), netWorth: r2(cash + sav - debtLeft), interest: r2(interest), debtPaid: r2(minPaid + poolPaid), fees: r2(fees),
      debts: Object.fromEntries(debts.map((x) => [String(x.d.id), r2(x.bal)])) });
    if (m >= total && (debtLeft <= 0.005 || !progress)) break; // done, or what is left never shrinks
  }
  return { rows, debts };
}

export function planForecast(inp: PlanInput): PlanResult {
  const a = simulate(inp, true), b = simulate(inp, false);
  const sum = (xs: { interest: number; fees: number }[], k: 'interest' | 'fees') => r2(xs.reduce((s, x) => s + x[k], 0));
  const payoffAll = (ds: { payoff: number | null }[]) => ds.length === 0 ? 0 : ds.some((x) => x.payoff == null) ? null : Math.max(...ds.map((x) => x.payoff as number));
  const totalInterest = sum(a.debts, 'interest'), totalFees = sum(a.debts, 'fees');
  const base = { totalInterest: sum(b.debts, 'interest'), totalFees: sum(b.debts, 'fees'), payoffMonth: payoffAll(b.debts) };
  return {
    months: a.rows,
    debts: a.debts.map((x) => ({ id: x.d.id, name: x.d.name, payoffMonth: x.payoff, interest: r2(x.interest), fees: r2(x.fees), neverPaysOff: x.payoff == null })),
    totalInterest, totalFees, baseline: base, interestSaved: r2(base.totalInterest - totalInterest), feesSaved: r2(base.totalFees - totalFees),
    debtFreeMonth: payoffAll(a.debts), horizonInterest: r2(a.rows.reduce((s, r) => s + r.interest, 0)),
  };
}
