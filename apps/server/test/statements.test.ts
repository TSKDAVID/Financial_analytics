import { describe, it, expect } from 'vitest';
import PDFDocument from 'pdfkit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractLines, StatementError } from '../src/statements/pdf';
import { parseStatement, parseDate, parseNumber } from '../src/statements/parse';
import { openDb } from '../src/db';
import { buildApp } from '../src/app';

const FONT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'NotoSansGeorgian-Regular.ttf');
function pdf(draw: (d: PDFKit.PDFDocument) => void): Promise<Uint8Array> {
  return new Promise((res) => { const d = new PDFDocument({ size: 'A4', margin: 30 }); const bufs: Buffer[] = []; d.on('data', (b) => bufs.push(b)); d.on('end', () => res(new Uint8Array(Buffer.concat(bufs)))); draw(d); d.end(); });
}
const row = (d: PDFKit.PDFDocument, y: number, cells: [number, string][]) => cells.forEach(([x, s]) => d.text(s, x, y, { lineBreak: false }));

export const bogPdf = () => pdf((d) => {
  d.font('Helvetica').fontSize(9);
  row(d, 30, [[30, 'Bank of Georgia - Account statement GE00BG0000000000000000 GEL']]);
  row(d, 60, [[30, 'Date'], [100, 'Description'], [330, 'Debit'], [400, 'Credit'], [480, 'Balance']]);
  row(d, 80, [[30, '01.09.2026'], [100, 'Opening balance'], [480, '1,000.00']]);
  row(d, 95, [[30, '02.09.2026'], [100, 'Payment - CARREFOUR TBILISI MALL'], [330, '45.30'], [480, '954.70']]);
  row(d, 110, [[30, '03.09.2026'], [100, 'Salary from ACME LLC'], [400, '3,200.00'], [480, '4,154.70']]);
  row(d, 125, [[30, '05.09.2026'], [100, 'NETFLIX.COM'], [330, '29.99'], [480, '4,124.71']]);
  row(d, 137, [[100, 'Amsterdam NL']]);
  row(d, 155, [[30, '07.09.2026'], [100, 'WOLT GEORGIA'], [330, '18.50'], [480, '4,106.21']]);
  row(d, 170, [[30, '08.09.2026'], [100, 'Mystery Shop 42'], [330, '1,234.56'], [480, '2,871.65']]);
  row(d, 190, [[30, 'Closing balance'], [480, '2,871.65']]);
});
const tbcPdf = () => pdf((d) => {
  d.font(FONT).fontSize(9);
  row(d, 30, [[30, 'თიბისი ბანკი — ამონაწერი']]);
  row(d, 60, [[30, 'თარიღი'], [110, 'აღწერა'], [360, 'თანხა'], [440, 'ვალუტა']]);
  row(d, 80, [[30, '2026-09-02'], [110, 'POS - ნიკორა ვაკე'], [360, '-23,40'], [440, 'GEL']]);
  row(d, 95, [[30, '2026-09-04'], [110, 'ხელფასის ჩარიცხვა'], [360, '+2 500,00'], [440, 'GEL']]);
  row(d, 110, [[30, '2026-09-06'], [110, 'POS - BOLT.EU'], [360, '-7,90'], [440, 'GEL']]);
  row(d, 125, [[30, '2026-09-09'], [110, 'Spotify'], [360, '-10,99'], [440, 'USD']]);
});

describe('statement parser', () => {
  it('parses dates and numbers', () => {
    expect(parseDate('05.09.2026')).toBe('2026-09-05');
    expect(parseDate('5 სექტემბერი 2026')).toBe('2026-09-05');
    expect(parseDate('12 Mar 2026')).toBe('2026-03-12');
    expect(parseNumber('1,234.56')).toBe(1234.56);
    expect(parseNumber('2 500,00')).toBe(2500);
    expect(parseNumber('1.234,5')).toBe(1234.5);
  });
  it('parses an English BOG debit/credit statement', async () => {
    const r = parseStatement(await extractLines(await bogPdf()));
    expect(r.bank).toBe('Bank of Georgia');
    expect(r.rows.map((x) => [x.date, x.kind, x.amount])).toEqual([
      ['2026-09-02', 'expense', 45.3], ['2026-09-03', 'income', 3200], ['2026-09-05', 'expense', 29.99], ['2026-09-07', 'expense', 18.5], ['2026-09-08', 'expense', 1234.56]]);
    expect(r.rows[0].description).toBe('CARREFOUR TBILISI MALL');
    expect(r.rows[2].description).toContain('Amsterdam');
    expect(r.periodFrom).toBe('2026-09-02');
  });
  it('parses a Georgian TBC signed-amount statement with currencies', async () => {
    const r = parseStatement(await extractLines(await tbcPdf()));
    expect(r.bank).toBe('TBC Bank');
    expect(r.rows).toHaveLength(4);
    expect(r.rows[0]).toMatchObject({ amount: 23.4, kind: 'expense', currency: 'GEL', description: 'ნიკორა ვაკე' });
    expect(r.rows[1]).toMatchObject({ amount: 2500, kind: 'income' });
    expect(r.rows[3]).toMatchObject({ currency: 'USD', amount: 10.99 });
  });
  it('rejects scanned PDFs without a text layer and non-PDFs', async () => {
    const scanned = await pdf((d) => { d.rect(50, 50, 200, 100).fill('#333'); });
    await expect(extractLines(scanned)).rejects.toThrow(StatementError);
    await expect(extractLines(scanned)).rejects.toThrow(/text layer|scanned/i);
    await expect(extractLines(new TextEncoder().encode('hello'))).rejects.toThrow(StatementError);
  });
});

describe('import approval workflow', () => {
  it('stages, learns, approves, reverts and re-approves', async () => {
    const db = openDb(':memory:'); const { app } = await buildApp(db);
    const call = async (method: string, url: string, payload?: unknown) => { const r = await app.inject({ method: method as any, url, payload: payload as any, remoteAddress: '127.0.0.1' }); return { code: r.statusCode, body: r.json() }; };
    await call('PUT', '/api/settings', { aiEnabled: '0' });
    const acc = (await call('POST', '/api/accounts', { name: 'BOG', type: 'bank', currency: 'GEL', opening_balance: 0 })).body;
    // existing transaction -> duplicate
    await call('POST', '/api/transactions', { kind: 'expense', amount: 18.5, currency: 'GEL', date: '2026-09-07', description: 'Wolt' });
    const txCount = () => (db.prepare('SELECT COUNT(*) AS c FROM transactions').get() as { c: number }).c;
    const before = txCount();
    const up = await call('POST', '/api/imports', { filename: 'bog.pdf', data: Buffer.from(await bogPdf()).toString('base64'), account_id: acc.id });
    expect(up.code).toBe(200);
    expect(txCount()).toBe(before); // staging touches nothing
    const b = (await call('GET', `/api/imports/${up.body.id}`)).body;
    expect(b.rows).toHaveLength(5);
    const wolt = b.rows.find((r: any) => /WOLT/.test(r.description));
    expect(wolt.duplicate_of).toBeTruthy(); expect(wolt.excluded).toBe(1);
    const carrefour = b.rows.find((r: any) => /CARREFOUR/.test(r.description));
    expect(carrefour.source).toBe('rule');
    const mystery = b.rows.find((r: any) => /Mystery/.test(r.description));
    expect(mystery.confidence).toBeLessThan(0.6);
    const shopping = (db.prepare("SELECT id FROM categories WHERE key = 'shopping'").get() as { id: number }).id;
    await call('PUT', `/api/imports/rows/${mystery.id}`, { category_id: shopping });
    expect((db.prepare('SELECT category_id FROM merchant_rules').get() as any).category_id).toBe(shopping);
    const an = (await call('GET', `/api/imports/${up.body.id}/analysis`)).body;
    expect(an.totals.income).toBe(3200); expect(an.byCategory.length).toBeGreaterThan(0);
    // approve selected
    const ap1 = (await call('POST', `/api/imports/${up.body.id}/approve`, { ids: [carrefour.id] })).body;
    expect(ap1).toMatchObject({ approved: 1, status: 'partial' });
    const ap2 = (await call('POST', `/api/imports/${up.body.id}/approve`, {})).body;
    expect(ap2).toMatchObject({ approved: 3, status: 'approved' });
    expect(txCount()).toBe(before + 4);
    expect((db.prepare('SELECT category_id FROM transactions WHERE description LIKE ?').get('%Mystery%') as any).category_id).toBe(shopping);
    expect((await call('PUT', `/api/imports/rows/${mystery.id}`, { excluded: true })).code).toBe(400);
    const rv = (await call('POST', `/api/imports/${up.body.id}/revert`)).body;
    expect(rv.removed).toBe(4); expect(txCount()).toBe(before);
    expect((await call('GET', '/api/imports')).body[0].status).toBe('reverted');
    expect((await call('POST', `/api/imports/${up.body.id}/approve`, {})).body.approved).toBe(4);
    expect(txCount()).toBe(before + 4);
    // next import learns merchant
    const up2 = (await call('POST', '/api/imports', { filename: 'bog2.pdf', data: Buffer.from(await bogPdf()).toString('base64') })).body;
    const r2 = (await call('GET', `/api/imports/${up2.id}`)).body.rows.find((r: any) => /Mystery/.test(r.description));
    expect(r2).toMatchObject({ source: 'learned', category_id: shopping });
    expect(r2.duplicate_of).toBeTruthy(); // already imported
    await call('POST', `/api/imports/${up2.id}/discard`);
    expect((await call('GET', `/api/imports/${up2.id}`)).body.status).toBe('discarded');
  });
  it('never returns API keys and converts bills to GEL', async () => {
    const db = openDb(':memory:'); const { app } = await buildApp(db);
    await app.inject({ method: 'PUT', url: '/api/settings', payload: { groqKey: 'gsk_secret123' }, remoteAddress: '127.0.0.1' });
    const s = (await app.inject({ method: 'GET', url: '/api/settings', remoteAddress: '127.0.0.1' })).json();
    expect(JSON.stringify(s)).not.toContain('gsk_secret123'); expect(s.groqKeySet).toBe(true);
    expect(s.aiProvider).toBe('ollama'); expect(s.ollamaModel).toBe('qwen2.5:7b-instruct-q3_K_M'); expect(s.aiEnabled).toBe('1');
    db.prepare("INSERT INTO rates (date, code, rate, manual) VALUES ('2026-01-01','USD',2.7,1)").run();
    db.prepare("INSERT INTO bills (name, amount, currency, due_date, paid) VALUES ('X', 10, 'USD', date('now'), 0)").run();
    const bills = (await app.inject({ method: 'GET', url: '/api/bills', remoteAddress: '127.0.0.1' })).json();
    expect(bills[0].amount_gel).toBe(27);
  });
});
