import { describe, it, expect } from 'vitest';
import { termForPayment, occurrences, nextOccurrence, perMonthFactor, amortize, extraPaymentSavings, monthlyPayment, balanceAsOf,
  toGel, convert, normalizeNbgRate, rateOnOrBefore, forecast, dailyProjection, healthScore, dtiLevel, stressTest,
  detectAnomalies, isSpike, suggestCategory, DEFAULT_KEYWORDS, addMonths, seasonality } from '../src';

describe('recurrence', () => {
  it('monthly clamps to end of month and keeps anchor', () => {
    expect(occurrences({ unit: 'month', interval: 1, start: '2026-01-31' }, '2026-01-01', '2026-04-30'))
      .toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });
  it('biweekly', () => {
    expect(occurrences({ unit: 'week', interval: 2, start: '2026-01-01' }, '2026-01-01', '2026-02-01'))
      .toEqual(['2026-01-01', '2026-01-15', '2026-01-29']);
  });
  it('custom every 10 days with count', () => {
    expect(occurrences({ unit: 'day', interval: 10, start: '2026-01-01', count: 3 }, '2025-01-01', '2027-01-01'))
      .toEqual(['2026-01-01', '2026-01-11', '2026-01-21']);
  });
  it('respects end date and window', () => {
    const r = { unit: 'month' as const, interval: 3, start: '2026-01-15', end: '2026-12-01' };
    expect(occurrences(r, '2026-03-01', '2027-12-31')).toEqual(['2026-04-15', '2026-07-15', '2026-10-15']);
    expect(nextOccurrence(r, '2026-10-16')).toBeNull();
  });
  it('yearly leap day', () => {
    expect(occurrences({ unit: 'year', interval: 1, start: '2024-02-29' }, '2024-01-01', '2028-12-31'))
      .toEqual(['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
  });
  it('per month factor', () => {
    expect(perMonthFactor('month', 3)).toBeCloseTo(1 / 3);
    expect(perMonthFactor('year', 1)).toBeCloseTo(1 / 12);
    expect(perMonthFactor('week', 1)).toBeCloseTo(4.348, 2);
  });
  it('addMonths negative', () => { expect(addMonths('2026-03-31', -1)).toBe('2026-02-28'); });
});

describe('amortization', () => {
  const loan = { principal: 10000, annualRatePct: 12, termMonths: 12, startDate: '2026-01-10' };
  it('standard payment', () => { expect(monthlyPayment(10000, 12, 12)).toBeCloseTo(888.49, 2); });
  it('schedule pays off fully', () => {
    const r = amortize(loan);
    expect(r.rows).toHaveLength(12);
    expect(r.rows[11].balance).toBe(0);
    expect(r.totalInterest).toBeCloseTo(661.85, 0);
    expect(r.payoffDate).toBe('2026-12-10');
    expect(r.rows[0].interest).toBe(100);
  });
  it('zero interest', () => {
    const r = amortize({ ...loan, annualRatePct: 0 });
    expect(r.monthlyPayment).toBeCloseTo(833.33, 2);
    expect(r.totalInterest).toBe(0);
  });
  it('extra payments save interest and months', () => {
    const s = extraPaymentSavings({ ...loan, termMonths: 60 }, 200);
    expect(s.interestSaved).toBeGreaterThan(0);
    expect(s.monthsSaved).toBeGreaterThan(0);
    expect(s.withExtra.rows[s.withExtra.rows.length - 1].balance).toBe(0);
  });
  it('balance as of', () => {
    const b = balanceAsOf(loan, '2026-03-15');
    expect(b.paidCount).toBe(3);
    expect(b.next?.date).toBe('2026-04-10');
  });
});

describe('currency', () => {
  const rates = { USD: 2.7, EUR: 3.0, AMD: normalizeNbgRate(7.18, 1000) };
  it('converts to GEL', () => { expect(toGel(100, 'USD', rates)).toBeCloseTo(270); expect(toGel(5, 'GEL', rates)).toBe(5); });
  it('cross rates', () => { expect(convert(300, 'EUR', 'USD', rates)).toBeCloseTo(333.33, 2); });
  it('quantity normalisation', () => { expect(toGel(1000, 'AMD', rates)).toBeCloseTo(7.18); });
  it('throws on unknown', () => { expect(() => toGel(1, 'XYZ', rates)).toThrow(); });
  it('rate history picks date on or before', () => {
    const h = [{ date: '2026-01-01', rate: 2.6 }, { date: '2026-01-05', rate: 2.7 }, { date: '2026-01-10', rate: 2.8 }];
    expect(rateOnOrBefore(h, '2026-01-07')).toBe(2.7);
    expect(rateOnOrBefore(h, '2025-12-01')).toBe(2.6);
    expect(rateOnOrBefore([], '2026-01-01')).toBeNull();
  });
});

describe('forecast', () => {
  it('projects recurring flows with bands', () => {
    const f = forecast({ startBalance: 1000, asOf: '2026-01-01', months: 3,
      recurring: [{ rule: { unit: 'month', interval: 1, start: '2026-01-05' }, amount: 3000 }, { rule: { unit: 'month', interval: 1, start: '2026-01-10' }, amount: -1000 }],
      historyVariableNet: [-500, -700, -600] });
    expect(f).toHaveLength(3);
    expect(f[0].recurringNet).toBe(2000);
    expect(f[2].expected).toBeCloseTo(1000 + 6000 - 600 * 3, 0);
    expect(f[2].best).toBeGreaterThan(f[2].expected);
    expect(f[2].worst).toBeLessThan(f[2].expected);
  });
  it('what-if income drop reduces balance', () => {
    const base = { startBalance: 0, asOf: '2026-01-01', months: 6, recurring: [{ rule: { unit: 'month' as const, interval: 1, start: '2026-01-05' }, amount: 1000 }], historyVariableNet: [] };
    const a = forecast(base), b = forecast({ ...base, adjustments: { incomeChangePct: -20, monthlyDelta: -100 } });
    expect(b[5].expected).toBeCloseTo(a[5].expected - 6 * 200 - 6 * 100, 0);
  });
  it('daily projection', () => {
    const d = dailyProjection(100, '2026-01-01', 10, [{ rule: { unit: 'day', interval: 5, start: '2026-01-03' }, amount: -60 }]);
    expect(d.find((x) => x.date === '2026-01-08')?.balance).toBe(-20);
  });
});

describe('health score', () => {
  it('excellent profile', () => {
    const h = healthScore({ monthlyIncome: 5000, monthlyExpenses: 3000, monthlyDebtPayments: 300, liquidSavings: 20000, netVolatility: 0.1 });
    expect(h.score).toBeGreaterThanOrEqual(90);
    expect(h.grade).toBe('excellent');
    expect(h.breakdown.reduce((s, b) => s + b.max, 0)).toBe(100);
  });
  it('critical profile', () => {
    const h = healthScore({ monthlyIncome: 1000, monthlyExpenses: 1300, monthlyDebtPayments: 600, liquidSavings: 0, netVolatility: 1 });
    expect(h.score).toBeLessThan(30);
    expect(h.savingsRate).toBeLessThan(0);
  });
  it('dti levels', () => { expect(dtiLevel(0.2)).toBe('ok'); expect(dtiLevel(0.4)).toBe('warning'); expect(dtiLevel(0.5)).toBe('danger'); });
  it('stress test runway', () => {
    const s = stressTest(6000, 1500, 500);
    expect(s.runwayMonths).toBe(3);
    expect(s.series[3].balance).toBe(0);
  });
});

describe('insights', () => {
  it('detects anomalies', () => {
    const txs = [50, 55, 48, 60, 52, 400].map((a, i) => ({ id: i, date: '2026-01-0' + (i + 1), amount: a, categoryId: 1, kind: 'expense' as const }));
    expect(detectAnomalies(txs).map((x) => x.id)).toEqual([5]);
  });
  it('spikes', () => { expect(isSpike(200, [100, 105, 98, 102])).toBe(true); expect(isSpike(104, [100, 105, 98, 102])).toBe(false); });
  it('suggests categories', () => { expect(suggestCategory('NETFLIX.COM 123', DEFAULT_KEYWORDS)).toBe('subscriptions'); expect(suggestCategory('???', DEFAULT_KEYWORDS)).toBeNull(); });
  it('seasonality', () => {
    expect(seasonality([{ month: '2025-01', value: 200 }, { month: '2025-02', value: 180 }, { month: '2025-06', value: 50 }, { month: '2025-07', value: 40 }])).toBe('winter');
  });
});

describe('payment override & revolving credit', () => {
  const base = { principal: 1200, annualRatePct: 12, termMonths: 12, startDate: '2026-01-15' };
  it('derives term and payoff from a fixed payment', () => {
    const r = amortize({ ...base, payment: 300 });
    expect(r.monthlyPayment).toBe(300); expect(r.months).toBe(5); expect(r.rows.at(-1)!.balance).toBe(0); expect(r.neverPaysOff).toBeUndefined();
  });
  it('flags payments that do not cover interest', () => {
    expect(amortize({ ...base, payment: 10 }).neverPaysOff).toBe(true);
  });
  it('revolving lines need a payment and support % of balance with a minimum', () => {
    expect(amortize({ ...base, termMonths: 0, revolving: true })).toMatchObject({ needsInput: true, rows: [] });
    expect(amortize({ ...base, annualRatePct: 0, termMonths: 24, revolving: true }).monthlyPayment).toBe(50); // pinned payoff term
    const r = amortize({ ...base, annualRatePct: 0, revolving: true, paymentPct: 10, minPayment: 50 });
    expect(r.rows[0].payment).toBe(120); expect(r.rows.at(-1)!.balance).toBe(0); expect(r.rows.some((x) => x.payment === 50)).toBe(true);
  });
});
describe('term <-> payment', () => {
  it('is the inverse of monthlyPayment', () => {
    expect(termForPayment(1034.23, 0, 1034.23 / 24)).toBe(24);
    expect(termForPayment(10000, 12, monthlyPayment(10000, 12, 36))).toBe(36);
    expect(termForPayment(1000, 24, 10)).toBe(Infinity);
  });
});

