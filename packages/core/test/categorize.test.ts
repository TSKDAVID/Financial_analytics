import { describe, it, expect } from 'vitest';
import { categorize, normalizeMerchant, detectRecurring } from '../src/categorize';

describe('categorizer', () => {
  it('matches Georgian and English merchants', () => {
    expect(categorize('POS CARREFOUR TBILISI MALL', 'expense').key).toBe('groceries');
    expect(categorize('ნიკორა ვაკე', 'expense').key).toBe('groceries');
    expect(categorize('Telasi payment', 'expense').key).toBe('electricity');
    expect(categorize('BOLT.EU/O/2609', 'expense').key).toBe('transport');
    const n = categorize('NETFLIX.COM', 'expense'); expect(n.key).toBe('subscriptions'); expect(n.subscription).toBe(true);
    expect(categorize('ხელფასის ჩარიცხვა', 'income').key).toBe('salary');
    expect(categorize('Mystery Shop 42', 'expense').confidence).toBeLessThan(0.6);
  });
  it('prefers learned corrections', () => {
    const m = normalizeMerchant('Mystery Shop 42');
    const r = categorize('Mystery Shop 42', 'expense', { learned: new Map([[m, 7]]) });
    expect(r).toMatchObject({ categoryId: 7, source: 'learned' });
    expect(r.confidence).toBeGreaterThan(0.9);
  });
  it('normalises merchant noise', () => {
    expect(normalizeMerchant('გადახდა ბარათი ****1234 WOLT GEORGIA 07.09.2026')).toBe('wolt');
  });
  it('detects monthly recurring charges', () => {
    const r = detectRecurring([{ merchant: 'netflix', date: '2026-07-05', amount: 30 }, { merchant: 'netflix', date: '2026-08-05', amount: 30 }, { merchant: 'netflix', date: '2026-09-05', amount: 30 }, { merchant: 'x', date: '2026-09-01', amount: 5 }]);
    expect(r).toHaveLength(1); expect(r[0]).toMatchObject({ merchant: 'netflix', cadence: 'monthly', count: 3 });
  });
});
