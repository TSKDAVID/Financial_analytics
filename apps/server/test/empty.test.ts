import { describe, it, expect } from 'vitest';
import { openDb } from '../src/db';
import { buildApp } from '../src/app';

describe('empty start', () => {
  it('shows no scores, forecasts or risk alerts without data', async () => {
    const db = openDb(':memory:'); const { app } = await buildApp(db);
    const get = async (url: string, method: any = 'GET') => (await app.inject({ method, url, payload: method === 'POST' ? {} : undefined, remoteAddress: '127.0.0.1' })).json();
    const s = await get('/api/settings'); expect(s.minBalance).toBe('');
    const r = await get('/api/risk'); expect(r.insufficient).toBe(true); expect(r.lowBalance.firstBelow).toBeNull(); expect(r.lowBalance.minBalance).toBeNull();
    expect((await get('/api/forecast', 'POST')).insufficient).toBe(true);
    expect((await get('/api/dashboard')).dataStatus.sufficient).toBe(false);
    expect((await get('/api/insights')).filter((i: any) => /forecast|savings/.test(i.key))).toHaveLength(0);
    await get('/api/alerts/evaluate', 'POST');
    expect((await get('/api/alerts')).items.filter((a: any) => a.type === 'risk')).toHaveLength(0);
  });
});
