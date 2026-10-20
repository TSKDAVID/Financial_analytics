import { addDays, addMonths, parseISO, type ISODate } from './dates';

export type FreqUnit = 'day' | 'week' | 'month' | 'year';
export interface RecurrenceRule {
  unit: FreqUnit;
  /** every N units, >= 1 (biweekly = week/2, quarterly = month/3) */
  interval: number;
  start: ISODate;
  end?: ISODate | null;
  /** total number of occurrences (from start) */
  count?: number | null;
}

export const PRESETS: Record<string, { unit: FreqUnit; interval: number }> = {
  daily: { unit: 'day', interval: 1 },
  weekly: { unit: 'week', interval: 1 },
  biweekly: { unit: 'week', interval: 2 },
  monthly: { unit: 'month', interval: 1 },
  quarterly: { unit: 'month', interval: 3 },
  semiannual: { unit: 'month', interval: 6 },
  yearly: { unit: 'year', interval: 1 },
};

/** n-th occurrence (0-based) of a rule, regardless of end/count. */
export function nthOccurrence(rule: RecurrenceRule, n: number): ISODate {
  const iv = Math.max(1, Math.floor(rule.interval));
  const anchor = parseISO(rule.start).getUTCDate();
  switch (rule.unit) {
    case 'day': return addDays(rule.start, n * iv);
    case 'week': return addDays(rule.start, n * iv * 7);
    case 'month': return addMonths(rule.start, n * iv, anchor);
    case 'year': return addMonths(rule.start, n * iv * 12, anchor);
  }
}

/** All occurrences within [from, to] inclusive. */
export function occurrences(rule: RecurrenceRule, from: ISODate, to: ISODate, max = 5000): ISODate[] {
  const out: ISODate[] = [];
  for (let n = 0; n < max; n++) {
    if (rule.count != null && n >= rule.count) break;
    const d = nthOccurrence(rule, n);
    if (rule.end && d > rule.end) break;
    if (d > to) break;
    if (d >= from) out.push(d);
  }
  return out;
}

export function nextOccurrence(rule: RecurrenceRule, after: ISODate): ISODate | null {
  for (let n = 0; n < 100000; n++) {
    if (rule.count != null && n >= rule.count) return null;
    const d = nthOccurrence(rule, n);
    if (rule.end && d > rule.end) return null;
    if (d >= after) return d;
  }
  return null;
}

/** Average monthly multiplier: how many times per month the rule fires. */
export function perMonthFactor(unit: FreqUnit, interval: number): number {
  const iv = Math.max(1, interval);
  switch (unit) {
    case 'day': return 30.4375 / iv;
    case 'week': return 30.4375 / 7 / iv;
    case 'month': return 1 / iv;
    case 'year': return 1 / 12 / iv;
  }
}
