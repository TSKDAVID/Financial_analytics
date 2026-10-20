// Synthetic rows in the field layout of BOG/TBC statements (all names, IBANs and amounts invented).
import { describe, it, expect } from 'vitest';
import { classify, matchTransfers, groupPeople, translit, sameName } from '@fa/core';
import { openDb } from '../src/db';
import { stageParsed, analyze, approve, revert, decideMatch, clusters, people } from '../src/statements/service';
import type { ParseResult } from '../src/statements/parse';

const own = { ownerNames: ['ბექა ტესტიძე', 'BEKA TESTIDZE'], ownAccounts: new Set(['GE00BG0000000000000001', 'GE00TB0000000000000002']) };
const c = (o: any) => classify({ direction: 'expense', amount: 10, ...o }, own);

describe('classifier', () => {
  it('kind first: savings, own transfers, exchange, p2p, purchases', () => {
    expect(c({ description: 'ელექტრონულ ყულაბაზე დაგროვილი თანხის ანაბარზე გადატანა' }).kind).toBe('internal');
    expect(c({ description: 'საკუთარ ანგარიშზე გადარიცხვა', counterparty: 'ბექა ტესტიძე' }).kind).toBe('internal');
    expect(c({ description: 'კონვერტაცია USD-GEL კურსით 2.7' }).kind).toBe('exchange');
    expect(c({ description: 'POS - TBC_P2P', merchant: 'TBC_P2P', mcc: '6012', bankCategory: 'თანხის განაღდება' }).kind).toBe('transfer_out');
    const n = c({ description: 'გადახდა - ობიექტი: Nikora', merchant: 'Nikora', mcc: '5411' });
    expect(n).toMatchObject({ kind: 'purchase', category: 'groceries' }); expect(n.why).toBeTruthy();
    expect(c({ description: 'POS wallet - Spotify', merchant: 'Google Spotify Music', mcc: '5815' }).category).toBe('subscriptions');
    expect(c({ description: 'ხელფასი', direction: 'income' }).kind).toBe('salary');
  });
  it('Georgian transliteration and name matching', () => {
    expect(translit('ნიკორა')).toBe('nikora');
    expect(sameName('ბექა ტესტიძე', 'TESTIDZE BEKA')).toBe(true);
  });
});

describe('matching', () => {
  it('pairs TBC→BOG legs with a fee and never pairs a payment to another person', () => {
    const m = matchTransfers([
      { ref: 'o1', account: 'tbc', bank: 'TB', toBank: 'BG', date: '2026-03-01', amount: 51, currency: 'GEL', dir: 'out', kind: 'transfer_out' },
      { ref: 'i1', account: 'bog', bank: 'BG', date: '2026-03-01', amount: 50, currency: 'GEL', dir: 'in', kind: 'transfer_in' },
      { ref: 'o2', account: 'bog', bank: 'BG', date: '2026-03-02', amount: 20, currency: 'GEL', dir: 'out', kind: 'transfer_out', counterparty: 'ნინო ბერიძე', thirdParty: true },
      { ref: 'i2', account: 'tbc', bank: 'TB', date: '2026-03-02', amount: 20, currency: 'GEL', dir: 'in', kind: 'transfer_in' },
    ]);
    expect(m).toHaveLength(1); expect(m[0]).toMatchObject({ out: 'o1', in: 'i1', fee: 1 });
  });
  it('people: lent and repaid nets to zero', () => {
    const p = groupPeople([{ ref: '1', date: '2026-01-01', amount: 100, currency: 'GEL', dir: 'out', counterparty: 'ნინო ბერიძე' }, { ref: '2', date: '2026-01-09', amount: 100, currency: 'GEL', dir: 'in', counterparty: 'NINO BERIDZE' }]);
    expect(p).toHaveLength(1); expect(p[0]).toMatchObject({ pattern: 'lent_repaid', net: 0 });
  });
});

const row = (date: string, kind: 'income' | 'expense', amount: number, description: string, extra: any = {}) => ({ date, kind, amount, currency: 'GEL', description, raw: description, page: 1, ...extra });
const stmt = (bank: string, account: string, rows: any[]): ParseResult => ({ bank, format: bank === 'TBC Bank' ? 'tbc' : 'bog', currency: 'GEL', rows, periodFrom: '2026-03-01', periodTo: '2026-03-31', warnings: [], holder: 'ბექა ტესტიძე', account,
  verification: [{ currency: 'GEL', opening: 0, closing: 0, sum: 0, count: rows.length, ok: true }] });

describe('import pipeline', () => {
  it('matches across statements, excludes internal from analytics, posts one transfer + fee, reverts cleanly', async () => {
    const db = openDb(':memory:');
    const bog = stageParsed(db, 'bog.pdf', stmt('Bank of Georgia', 'GE00BG0000000000000001', [
      row('2026-03-01', 'income', 50, 'ბანკებს შორის, ეგრევე 24/7', { opType: 'ჩარიცხვა' }),
      row('2026-03-02', 'expense', 3, 'ელექტრონულ ყულაბაზე დაგროვილი თანხის ანაბარზე გადატანა', { counterpartyAccount: 'GE00BG0000000000000009' }),
      row('2026-03-03', 'expense', 40, 'გადახდა - ობიექტი: Nikora; MCC:5411', { merchant: 'Nikora', mcc: '5411' }),
    ]), null);
    const tbc = stageParsed(db, 'tbc.pdf', stmt('TBC Bank', 'GE00TB0000000000000002', [
      row('2026-03-03', 'expense', 51, 'POS - EGREVE.BOG.GE', { merchant: 'EGREVE.BOG.GE', mcc: '6012', bankCategory: 'თანხის განაღდება', time: '2026-03-01T10:00' }),
      row('2026-03-05', 'expense', 100, 'პირადი გადარიცხვა', { counterparty: 'ნინო ბერიძე', counterpartyAccount: 'GE00TB0000000000000077' }),
      row('2026-03-12', 'income', 100, 'პირადი გადარიცხვა', { counterparty: 'NINO BERIDZE', counterpartyAccount: 'GE00BG0000000000000078' }),
    ]), null);
    const ms = db.prepare('SELECT * FROM import_matches').all() as any[];
    expect(ms).toHaveLength(1); expect(ms[0].fee).toBe(1);
    expect(db.prepare('SELECT COUNT(*) FROM transactions').pluck().get()).toBe(0); // nothing applied yet
    const a: any = analyze(db, bog); expect(a.totals.expense).toBe(40); expect(a.excluded.internalCount).toBe(2);
    const t: any = analyze(db, tbc); expect(t.totals.expense).toBe(0); expect(t.excluded.friends).toBe(200);
    expect((people(db) as any).people[0]).toMatchObject({ pattern: 'lent_repaid', net: 0 });
    expect((clusters(db, tbc) as any).transfers).toHaveLength(1);
    decideMatch(db, ms[0].id, 'confirmed');
    await approve(db, bog); await approve(db, tbc);
    const tx = db.prepare('SELECT kind, COUNT(*) c FROM transactions GROUP BY kind ORDER BY kind').all();
    expect(tx).toEqual([{ kind: 'expense', c: 3 }, { kind: 'income', c: 1 }, { kind: 'transfer', c: 2 }]); // nikora + fee + p2p out; p2p in; matched transfer once + piggy
    revert(db, tbc); revert(db, bog);
    expect(db.prepare('SELECT COUNT(*) FROM transactions').pluck().get()).toBe(0);
  });
});
