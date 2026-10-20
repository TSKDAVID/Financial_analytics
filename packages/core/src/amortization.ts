import { addMonths, type ISODate } from './dates';

export interface LoanInput {
  principal: number;
  annualRatePct: number;
  termMonths: number;
  startDate: ISODate; // first payment date
  extraMonthly?: number;
  /** Fixed monthly payment chosen by the user (overrides the annuity payment; term/payoff are derived from it). */
  payment?: number | null;
  /** Revolving credit (card / overdraft / credit line): no fixed term; pays `payment` or `paymentPct`% of the balance. */
  revolving?: boolean;
  paymentPct?: number | null;
  /** Floor for percentage-based payments (card minimum), default 0. */
  minPayment?: number | null;
}
export interface AmortRow {
  n: number; date: ISODate; payment: number; interest: number; principal: number; extra: number; balance: number;
}
export interface AmortResult {
  monthlyPayment: number; rows: AmortRow[]; totalInterest: number; totalPaid: number; payoffDate: ISODate; months: number;
  /** Revolving line without a payment: the user has to enter one. */
  needsInput?: boolean;
  /** The payment doesn't even cover the interest — the debt would never be repaid. */
  neverPaysOff?: boolean;
}
export const MAX_MONTHS = 600;
const r2 = (x: number) => Math.round(x * 100) / 100;

export function monthlyPayment(principal: number, annualRatePct: number, termMonths: number): number {
  const i = annualRatePct / 100 / 12;
  if (termMonths <= 0) return principal;
  if (i === 0) return principal / termMonths;
  return (principal * i) / (1 - Math.pow(1 + i, -termMonths));
}

export function amortize(loan: LoanInput): AmortResult {
  const i = loan.annualRatePct / 100 / 12;
  const fixed = loan.payment && loan.payment > 0 ? loan.payment : null;
  const pct = loan.paymentPct && loan.paymentPct > 0 ? loan.paymentPct / 100 : null;
  const empty = (extra: Partial<AmortResult>): AmortResult => ({ monthlyPayment: 0, rows: [], totalInterest: 0, totalPaid: 0, payoffDate: loan.startDate, months: 0, ...extra });
  // revolving lines are driven by a fixed payment, a % of the balance, or a payoff term the user pinned
  if (loan.revolving && !fixed && !pct && !(loan.termMonths > 0)) return empty({ needsInput: loan.principal > 0 });
  const byPct = !fixed && loan.revolving && !!pct;
  const annuity = fixed ?? (byPct ? null : monthlyPayment(loan.principal, loan.annualRatePct, loan.termMonths));
  const limit = fixed || byPct ? MAX_MONTHS : loan.termMonths;
  const extra = Math.max(0, loan.extraMonthly ?? 0);
  let bal = loan.principal;
  const rows: AmortRow[] = [];
  let totalInterest = 0, totalPaid = 0, neverPaysOff = false;
  for (let n = 1; n <= limit && bal > 0.005; n++) {
    const interest = bal * i;
    const pay = annuity ?? Math.max(bal * pct!, Math.min(loan.minPayment ?? 0, bal + interest));
    if (n === 1 && (fixed || byPct) && pay + extra <= interest + 0.005) { neverPaysOff = true; }
    let principal = Math.min(pay - interest, bal);
    let ex = Math.min(extra, bal - principal);
    if (ex < 0) ex = 0;
    if (principal < 0) principal = 0;
    bal = bal - principal - ex;
    totalInterest += interest;
    totalPaid += interest + principal + ex;
    rows.push({ n, date: addMonths(loan.startDate, n - 1), payment: r2(interest + principal), interest: r2(interest), principal: r2(principal), extra: r2(ex), balance: r2(Math.max(0, bal)) });
    if (neverPaysOff && n >= 12) break; // show a year of the (non-shrinking) schedule
  }
  const last = rows[rows.length - 1];
  return { monthlyPayment: r2(rows[0]?.payment ?? annuity ?? 0), rows, totalInterest: r2(totalInterest), totalPaid: r2(totalPaid), payoffDate: last?.date ?? loan.startDate, months: rows.length,
    ...(neverPaysOff || (bal > 0.005 && limit === MAX_MONTHS) ? { neverPaysOff: true } : {}) };
}

/** Compare baseline vs extra payment. */
export function extraPaymentSavings(loan: LoanInput, extraMonthly: number) {
  const base = amortize({ ...loan, extraMonthly: 0 });
  const withExtra = amortize({ ...loan, extraMonthly });
  return {
    base, withExtra,
    interestSaved: r2(base.totalInterest - withExtra.totalInterest),
    monthsSaved: base.months - withExtra.months,
  };
}

/** Remaining balance after payments made up to (and including) `asOf`. */
export function balanceAsOf(loan: LoanInput, asOf: ISODate): { balance: number; paidCount: number; next?: AmortRow } {
  const res = amortize(loan);
  let balance = loan.principal, paidCount = 0;
  for (const row of res.rows) {
    if (row.date <= asOf) { balance = row.balance; paidCount++; } else return { balance, paidCount, next: row };
  }
  return { balance, paidCount };
}

/** Months needed to repay `principal` with a fixed `payment` (Infinity if it never pays off). Inverse of monthlyPayment. */
export function termForPayment(principal: number, annualRatePct: number, payment: number): number {
  const i = annualRatePct / 100 / 12;
  if (payment <= 0) return Infinity;
  if (i === 0) return Math.ceil(principal / payment - 1e-9);
  if (payment <= principal * i) return Infinity;
  return Math.ceil(-Math.log(1 - (principal * i) / payment) / Math.log(1 + i) - 1e-9);
}
