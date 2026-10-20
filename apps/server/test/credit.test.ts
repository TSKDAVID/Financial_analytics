import { describe, it, expect } from 'vitest';
import { monthlyPayment, todayISO } from '@fa/core';
import { nextDueDate } from '../src/services';
import { extractLines } from '../src/statements/pdf';
import { parseCreditReport } from '../src/credit/parse';
import { estimateRate, proposeLoan } from '../src/credit/service';
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

const OPEN_CARD = SAMPLE.map((c) => (c.subtype === 'საკრედიტო ბარათი' ? { ...c, term: 600 } : c)); // "until revoked" card

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
  it('derives a card payoff term from a real contract end date, but not from an open-ended one', async () => {
    const card = (contracts: typeof SAMPLE) => creditPdf(contracts).then(extractLines).then((l) => { const r = parseCreditReport(l); return proposeLoan(r.contracts.find((c) => c.type === 'credit_card')!, r.summary.reportDate); });
    const p = await card(SAMPLE); // 60-month card contract → months left until its end date
    expect(p.monthly_payment).toBeNull(); expect(p.needs_input).toBe(0); expect(p.term_months).toBeGreaterThan(0); expect(p.term_months).toBeLessThanOrEqual(60);
    expect(await card(OPEN_CARD)).toMatchObject({ term_months: 0, needs_input: 1 });
  });
  it('models credit cards as revolving lines that need a payment, with quick updates and undo', async () => {
    const db = openDb(':memory:'); const { app } = await buildApp(db);
    const call = async (method: string, url: string, payload?: unknown) => { const r = await app.inject({ method: method as any, url, payload: payload as any, remoteAddress: '127.0.0.1' }); return { code: r.statusCode, body: r.json() }; };
    await call('PUT', '/api/settings', { aiEnabled: '0' });
    const up = await call('POST', '/api/credit-reports', { filename: 'ci.pdf', data: Buffer.from(await creditPdf(OPEN_CARD)).toString('base64') });
    const rep = (await call('GET', `/api/credit-reports/${up.body.id}`)).body;
    const pc = rep.contracts.find((c: any) => c.type === 'credit_card');
    expect(pc.proposed).toMatchObject({ principal: 640.5, monthly_payment: null, needs_input: 1, term_months: 0 });
    await call('POST', `/api/credit-reports/${up.body.id}/approve`, {});
    const card = () => ((call('GET', '/api/loans') as any).then((r: any) => r.body.find((l: any) => l.kind === 'credit_card')));
    let c = await card();
    expect(c).toMatchObject({ revolving: true, needs_input: true, monthly_payment: 0, months_left: 0, remaining: 640.5 });
    expect((db.prepare('SELECT COUNT(*) AS c FROM bills WHERE loan_id = ?').get(c.id) as any).c).toBe(0); // no invented payments
    const loan = (await call('GET', '/api/loans')).body.find((l: any) => l.kind === 'loan');
    expect(loan).toMatchObject({ needs_input: false, monthly_payment: 105.65 }); // payment from the report drives the schedule
    // quick update: new balance + my payment
    const today = todayISO(); const day = Number(today.slice(8, 10)); const first = nextDueDate(today, day);
    const u = await call('POST', `/api/loans/${c.id}/update`, { date: today, balance: 600, monthly_payment: 100, annual_rate: 24, due_day: day });
    expect(u.code).toBe(200);
    expect(u.body).toMatchObject({ needs_input: false, remaining: 600, monthly_payment: 100, start_date: first, due_day: day });
    expect(u.body.months_left).toBe(7); // 600 at 24%/yr with 100/month
    const hist = (await call('GET', `/api/loans/${c.id}/updates`)).body;
    expect(hist).toHaveLength(1); expect(hist[0].prev).toMatchObject({ principal: 640.5, monthly_payment: null });
    // percentage-of-balance payment
    await call('PUT', `/api/loans/${c.id}`, { monthly_payment: null, payment_pct: 10, min_payment: 20 });
    c = await card(); expect(c.monthly_payment).toBeCloseTo(60, 1);
    // undo only the latest update
    await call('PUT', `/api/loans/${c.id}`, { monthly_payment: 100, payment_pct: null });
    expect((await call('POST', `/api/loan-updates/${hist[0].id}/undo`)).code).toBe(200);
    c = await card(); expect(c).toMatchObject({ remaining: 640.5, needs_input: true });
  });
});
