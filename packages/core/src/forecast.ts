import { addMonths, monthKey, startOfMonth, type ISODate } from './dates';
import { occurrences, type RecurrenceRule } from './recurrence';
import { mean, stdev } from './stats';

export interface RecurringFlow { rule: RecurrenceRule; amount: number; /* signed GEL: +income -expense */ }
export interface ForecastInput {
  startBalance: number;
  asOf: ISODate;
  months: number;
  recurring: RecurringFlow[];
  /** historical monthly net of NON-recurring transactions (signed GEL), oldest first */
  historyVariableNet: number[];
  /** what-if adjustments */
  adjustments?: { monthlyDelta?: number; incomeChangePct?: number; oneOff?: { date: ISODate; amount: number }[] };
}
export interface ForecastPoint { month: string; expected: number; best: number; worst: number; recurringNet: number; variableNet: number; }

export function forecast(input: ForecastInput): ForecastPoint[] {
  const { months, asOf } = input;
  const hist = input.historyVariableNet.slice(-12);
  const varMean = hist.length ? mean(hist) : 0;
  const varSd = hist.length >= 2 ? stdev(hist) : Math.abs(varMean) * 0.25;
  const adj = input.adjustments ?? {};
  const out: ForecastPoint[] = [];
  let bal = input.startBalance;
  for (let k = 0; k < months; k++) {
    const mStart = k === 0 ? asOf : startOfMonth(addMonths(startOfMonth(asOf), k));
    const mEnd = addMonths(startOfMonth(asOf), k + 1);
    const lastDay = addMonthsMinusDay(mEnd);
    let recurringNet = 0;
    for (const f of input.recurring) {
      const n = occurrences(f.rule, k === 0 ? nextDay(asOf) : mStart, lastDay).length;
      let amt = f.amount;
      if (amt > 0 && adj.incomeChangePct) amt *= 1 + adj.incomeChangePct / 100;
      recurringNet += n * amt;
    }
    for (const o of adj.oneOff ?? []) if (o.date >= mStart && o.date <= lastDay) recurringNet += o.amount;
    recurringNet += adj.monthlyDelta ?? 0;
    // variable part prorated in first month
    const frac = k === 0 ? Math.max(0, 1 - (Number(asOf.slice(8, 10)) - 1) / 30) : 1;
    const variableNet = varMean * frac;
    bal += recurringNet + variableNet;
    const spread = varSd * Math.sqrt(k + 1) * 1.28; // ~80% band
    out.push({ month: monthKey(mStart), expected: round(bal), best: round(bal + spread), worst: round(bal - spread), recurringNet: round(recurringNet), variableNet: round(variableNet) });
  }
  return out;
}
function nextDay(d: ISODate) { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); }
function addMonthsMinusDay(d: ISODate) { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); }
const round = (x: number) => Math.round(x * 100) / 100;

/** Day-by-day projection used for low-balance alerts. */
export function dailyProjection(startBalance: number, asOf: ISODate, days: number, recurring: RecurringFlow[], dailyVariable = 0) {
  const to = new Date(asOf + 'T00:00:00Z'); to.setUTCDate(to.getUTCDate() + days);
  const toISO = to.toISOString().slice(0, 10);
  const events: Record<string, number> = {};
  for (const f of recurring) for (const d of occurrences(f.rule, nextDay(asOf), toISO)) events[d] = (events[d] ?? 0) + f.amount;
  const out: { date: ISODate; balance: number; change: number }[] = [];
  let bal = startBalance, cur = asOf;
  for (let i = 0; i < days; i++) {
    cur = nextDay(cur);
    const ch = (events[cur] ?? 0) + dailyVariable;
    bal += ch;
    out.push({ date: cur, balance: round(bal), change: round(ch) });
  }
  return out;
}
