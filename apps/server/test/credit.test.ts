import { describe, it, expect } from 'vitest';
import { monthlyPayment } from '@fa/core';
import { extractLines } from '../src/statements/pdf';
import { parseCreditReport } from '../src/credit/parse';
import { estimateRate } from '../src/credit/service';
import { openDb } from '../src/db';
import { buildApp } from '../src/app';
import { creditPdf, SAMPLE } from './fixtures/creditinfo';

describe('Creditinfo parser', () => {
  it('reads summary and contracts without personal data', async () => {
    const r = parseCreditReport(await extractLines(await creditPdf(SAMPLE)));
    expect(r.summary).toMatchObject({ score: 512, rating: 'C2', defaultProbability: 7.5, activeContracts: 2, closedContracts: 1, totalDebt: 3440.5, monthlyPayments: 105.65 });
    expect(r.summary.factors[0].code).toBe('NAC2');
    expect(r.contracts).toHaveLength(3);
    const [loan, card, closed] = r.contracts;
    expect(loan).toMatchObject({ creditor: 'საქართველოს ბანკი', type: 'loan', active: true, originalAmount: 3000, balance: 2800, monthlyPayment: 105.65, termMonths: 36, startDate: '2026-03-10', currency: 'GEL' });
    expect(loan.schedule[0]).toMatchObject({ month: '2026-09', balance: 2800 });
    expect(card).toMatchObject({ type: 'credit_card', active: true, balance: 640.5, penalty: 12.5 });
    expect(closed).toMatchObject({ active: false, closedDate: '2024-11-05' });
    expect(JSON.stringify(r)).not.toContain('00000000000');
    expect(JSON.stringify(r)).not.toContain('სატესტო მომხმარებელი');
  });
  it('estimates the interest rate from the payment', () => {
    expect(monthlyPayment(3000, estimateRate(3000, 36, 105.65)!, 36)).toBeCloseTo(105.65, 1);
    expect(estimateRate(1200, 12, 100)).toBe(0);
  });
});

describe('credit report approval', () => {
  it('stages, approves into loans, reverts, and diffs on re-import', async () => {
    const db = openDb(':memory:'); const { app } = await buildApp(db);
    const call = async (method: string, url: string, payload?: unknown) => { const r = await app.inject({ method: method as any, url, payload: payload as any, remoteAddress: '127.0.0.1' }); return { code: r.statusCode, body: r.json() }; };
    await call('PUT', '/api/settings', { aiEnabled: '0' });
    const loans = () => db.prepare('SELECT * FROM loans').all() as any[];
    const up = await call('POST', '/api/credit-reports', { filename: 'ci.pdf', data: Buffer.from(await creditPdf(SAMPLE)).toString('base64') });
    expect(up.code).toBe(200); expect(loans()).toHaveLength(0);
    const rep = (await call('GET', `/api/credit-reports/${up.body.id}`)).body;
    expect(rep.contracts.map((c: any) => c.action)).toEqual(['create', 'create', 'history']);
    const card = rep.contracts.find((c: any) => c.type === 'credit_card');
    await call('PUT', `/api/credit-contracts/${card.id}`, { proposed: { term_months: 6 } });
    const ap = (await call('POST', `/api/credit-reports/${up.body.id}/approve`, {})).body;
    expect(ap).toMatchObject({ approved: 2, status: 'approved' });
    expect(loans()).toHaveLength(2);
    expect(loans().find((l) => l.kind === 'credit_card').term_months).toBe(6);
    expect((db.prepare('SELECT COUNT(*) AS c FROM bills WHERE loan_id IS NOT NULL').get() as any).c).toBeGreaterThan(0);
    const latest = (await call('GET', '/api/credit-reports/latest')).body;
    expect(latest).toMatchObject({ score: 512, rating: 'C2' });
    // re-import with a changed balance/term -> update with diff
    const changed = SAMPLE.map((c, i) => (i === 0 ? { ...c, term: 40, installments: 40 } : c));
    const up2 = (await call('POST', '/api/credit-reports', { filename: 'ci2.pdf', data: Buffer.from(await creditPdf(changed)).toString('base64') })).body;
    const rep2 = (await call('GET', `/api/credit-reports/${up2.id}`)).body;
    const upd = rep2.contracts.find((c: any) => c.action === 'update' && c.type === 'loan');
    expect(upd.diff.find((d: any) => d.field === 'term_months')).toMatchObject({ from: 36, to: 40 });
    await call('POST', `/api/credit-reports/${up2.id}/approve`, { ids: [upd.id] });
    expect(loans().find((l) => l.kind === 'loan').term_months).toBe(40);
    await call('POST', `/api/credit-reports/${up2.id}/revert`);
    expect(loans().find((l) => l.kind === 'loan').term_months).toBe(36);
    await call('POST', `/api/credit-reports/${up.body.id}/revert`);
    expect(loans()).toHaveLength(0);
    expect((await call('POST', `/api/credit-reports/${up.body.id}/approve`, {})).body.approved).toBe(2);
  });
});
