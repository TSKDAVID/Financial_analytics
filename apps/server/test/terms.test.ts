import { describe, it, expect } from 'vitest';
import { extractLines } from '../src/statements/pdf';
import { parseCardTerms } from '../src/terms/parse';
import { openDb } from '../src/db';
import { buildApp } from '../src/app';
import { termsPdf } from './fixtures/cardterms';

describe('card key-terms import', () => {
  it('parses limit, dual rates, minimum payment, fees and end date', async () => {
    expect(parseCardTerms(await extractLines(await termsPdf()))).toMatchObject({ bank: 'Liberty Bank', product: 'Top Card', creditLimit: 2000, rateType: 'fixed', rateRecommended: 0, rateMinimum: 30,
      effectiveRecommended: 0, effectiveMinimum: 28.1, minPayment: 55.1, cashFeePct: 2.5, cashFeeMin: 5, lateFeeOnce: 8, lateFeeDailyPct: 0.4, contractEnd: '2070-02-01', warnings: [] });
  });
  it('stages, applies with the chosen payment, switches mode and reverts', async () => {
    const db = openDb(':memory:'); const { app } = await buildApp(db);
    const call = async (method: string, url: string, payload?: unknown) => { const r = await app.inject({ method: method as any, url, payload: payload as any, remoteAddress: '127.0.0.1' }); return { code: r.statusCode, body: r.json() }; };
    const loan = (await call('POST', '/api/loans', { kind: 'credit_card', name: 'Top Card', bank: 'Liberty Bank', principal: 800, annual_rate: 0, term_months: 0, start_date: '2099-01-15', needs_input: 1 })).body;
    const st = (await call('POST', `/api/loans/${loan.id}/terms`, { filename: 't.pdf', data: Buffer.from(await termsPdf()).toString('base64') })).body;
    expect(st.status).toBe('staged');
    expect((db.prepare('SELECT credit_limit FROM loans WHERE id = ?').get(loan.id) as any).credit_limit).toBeNull(); // nothing applied yet
    const pv = (await call('GET', `/api/loan-terms/${st.id}?mode=minimum`)).body;
    expect(pv.next).toMatchObject({ annual_rate: 30, rate_alt: 0, monthly_payment: 55.1, credit_limit: 2000 });
    await call('POST', `/api/loan-terms/${st.id}/approve`, { mode: 'minimum' });
    let l = (await call('GET', '/api/loans')).body[0];
    expect(l).toMatchObject({ annual_rate: 30, monthly_payment: 55.1, credit_limit: 2000, pay_mode: 'minimum', needs_input: false });
    await call('POST', `/api/loans/${loan.id}/pay-mode`, { mode: 'recommended' });
    l = (await call('GET', '/api/loans')).body[0];
    expect(l).toMatchObject({ annual_rate: 0, rate_alt: 30, pay_mode: 'recommended', needs_input: true }); // recommended amount: user enters it
    await call('POST', `/api/loan-terms/${st.id}/revert`);
    l = (await call('GET', '/api/loans')).body[0];
    expect(l).toMatchObject({ annual_rate: 0, credit_limit: null, pay_mode: null });
  });
});
