import { describe, it, expect } from 'vitest';
import { planForecast, type PlanInput } from '../src/plan';

const base = (o: Partial<PlanInput> = {}): PlanInput => ({ months: 12, startCash: 0, startSavings: 0, incomes: [], expenses: 0, savingsMonthly: 0, savingsRatePct: 0, debts: [], strategy: 'none', ...o });

describe('plan forecast', () => {
  it('no debts: cash grows by income − expenses − savings, savings compound monthly', () => {
    const r = planForecast(base({ incomes: [{ name: 'a', amount: 1000 }, { name: 'b', amount: 200 }], expenses: 700, savingsMonthly: 100, savingsRatePct: 12 }));
    expect(r.months).toHaveLength(12);
    expect(r.months[0].cash).toBe(400);
    expect(r.months[1].savings).toBe(201); // 100*1.01 + 100
    expect(r.months[11].cash).toBe(4800);
    expect(r.totalInterest).toBe(0); expect(r.debtFreeMonth).toBe(0);
  });
  it('0% loan pays off exactly on schedule', () => {
    const r = planForecast(base({ debts: [{ id: 1, name: 'L', balance: 1200, annualRatePct: 0, minPayment: 100 }] }));
    expect(r.debts[0].payoffMonth).toBe(12); expect(r.months[11].debt).toBe(0); expect(r.months[11].cash).toBe(-1200);
  });
  it('interest follows the standard amortization (1000 @ 12%, 100/month)', () => {
    const r = planForecast(base({ debts: [{ id: 1, name: 'L', balance: 1000, annualRatePct: 12, minPayment: 100 }] }));
    expect(r.months[0].interest).toBe(10); expect(r.months[0].debt).toBe(910);
    expect(r.debts[0].payoffMonth).toBe(11);
    expect(r.totalInterest).toBeCloseTo(58.98, 1);
  });
  it('overpaying saves interest vs minimums, and fees stop once paid off', () => {
    const d = { id: 1, name: 'L', balance: 2000, annualRatePct: 30, minPayment: 80, monthlyFee: 5 };
    const min = planForecast(base({ months: 60, debts: [d] }));
    const over = planForecast(base({ months: 60, debts: [{ ...d, extra: 70 }] }));
    expect(over.debts[0].payoffMonth!).toBeLessThan(min.debts[0].payoffMonth!);
    expect(over.interestSaved).toBeGreaterThan(0);
    expect(over.interestSaved).toBeCloseTo(min.totalInterest - over.totalInterest, 2);
    expect(over.feesSaved).toBe(5 * (min.debts[0].payoffMonth! - over.debts[0].payoffMonth!));
  });
  it('minimum below interest never pays off', () => {
    const r = planForecast(base({ debts: [{ id: 1, name: 'C', balance: 1000, annualRatePct: 36, minPayment: 20 }] }));
    expect(r.debts[0].neverPaysOff).toBe(true); expect(r.debtFreeMonth).toBeNull();
  });
  it('avalanche pays the highest rate first, snowball the smallest balance; avalanche costs ≤ interest', () => {
    const debts = [{ id: 'a', name: 'big-cheap', balance: 500, annualRatePct: 10, minPayment: 20 }, { id: 'b', name: 'small-dear', balance: 1500, annualRatePct: 35, minPayment: 50 }];
    const av = planForecast(base({ months: 60, debts, strategy: 'avalanche', extraPool: 100 }));
    const sn = planForecast(base({ months: 60, debts, strategy: 'snowball', extraPool: 100 }));
    expect(av.debts.find((d) => d.id === 'b')!.payoffMonth!).toBeLessThan(sn.debts.find((d) => d.id === 'b')!.payoffMonth!);
    expect(sn.debts.find((d) => d.id === 'a')!.payoffMonth!).toBeLessThan(av.debts.find((d) => d.id === 'a')!.payoffMonth!);
    expect(av.totalInterest).toBeLessThanOrEqual(sn.totalInterest);
  });
  it('cash accounting: same total outflow with or without a strategy roll-over', () => {
    const debts = [{ id: 1, name: 'x', balance: 300, annualRatePct: 0, minPayment: 100 }, { id: 2, name: 'y', balance: 600, annualRatePct: 0, minPayment: 100 }];
    const r = planForecast(base({ months: 12, debts, strategy: 'snowball', extraPool: 0 }));
    // 900 of 0% debt, all repaid: cash ends at −900 no matter the order
    expect(r.debtFreeMonth).toBe(5); expect(r.months[11].cash).toBe(-900); expect(r.months[11].netWorth).toBe(-900);
  });
});
