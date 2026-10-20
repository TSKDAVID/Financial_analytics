import { addMonths, type ISODate } from './dates';

export interface LoanInput {
  principal: number;
  annualRatePct: number;
  termMonths: number;
  startDate: ISODate; // first payment date
  extraMonthly?: number;
}
export interface AmortRow {
  n: number; date: ISODate; payment: number; interest: number; principal: number; extra: number; balance: number;
}
export interface AmortResult {
  monthlyPayment: number; rows: AmortRow[]; totalInterest: number; totalPaid: number; payoffDate: ISODate; months: number;
}
const r2 = (x: number) => Math.round(x * 100) / 100;

export function monthlyPayment(principal: number, annualRatePct: number, termMonths: number): number {
  const i = annualRatePct / 100 / 12;
  if (termMonths <= 0) return principal;
  if (i === 0) return principal / termMonths;
  return (principal * i) / (1 - Math.pow(1 + i, -termMonths));
}

export function amortize(loan: LoanInput): AmortResult {
  const i = loan.annualRatePct / 100 / 12;
  const pay = monthlyPayment(loan.principal, loan.annualRatePct, loan.termMonths);
  const extra = Math.max(0, loan.extraMonthly ?? 0);
  let bal = loan.principal;
  const rows: AmortRow[] = [];
  let totalInterest = 0, totalPaid = 0;
  for (let n = 1; n <= loan.termMonths && bal > 0.005; n++) {
    const interest = bal * i;
    let principal = Math.min(pay - interest, bal);
    let ex = Math.min(extra, bal - principal);
    if (ex < 0) ex = 0;
    if (principal < 0) principal = 0;
    bal = bal - principal - ex;
    totalInterest += interest;
    totalPaid += interest + principal + ex;
    rows.push({ n, date: addMonths(loan.startDate, n - 1), payment: r2(interest + principal), interest: r2(interest), principal: r2(principal), extra: r2(ex), balance: r2(Math.max(0, bal)) });
  }
  const last = rows[rows.length - 1];
  return { monthlyPayment: r2(pay), rows, totalInterest: r2(totalInterest), totalPaid: r2(totalPaid), payoffDate: last?.date ?? loan.startDate, months: rows.length };
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
