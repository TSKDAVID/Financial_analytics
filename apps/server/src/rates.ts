import { normalizeNbgRate, todayISO, addDays } from '@fa/core';
import type { DB } from './schema';

const NBG_URL = 'https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/en/json/';
export const SUPPORTED = ['USD', 'EUR', 'GBP', 'TRY', 'RUB', 'AMD', 'AZN', 'UAH', 'CHF', 'JPY', 'CNY', 'AED', 'PLN', 'CZK', 'SEK', 'NOK', 'DKK', 'CAD', 'AUD', 'ILS', 'KZT'];

interface NbgDay { date: string; currencies: { code: string; quantity: number; rate: number; validFromDate: string }[] }

/** Fetch official rates for a date from NBG and store them. Returns number of rates stored. */
export async function fetchNbg(db: DB, date: string): Promise<number> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10000);
  try {
    const res = await fetch(`${NBG_URL}?date=${date}`, { signal: ctl.signal });
    if (!res.ok) throw new Error(`NBG HTTP ${res.status}`);
    const data = (await res.json()) as NbgDay[];
    const ins = db.prepare('INSERT INTO rates (date, code, rate, manual) VALUES (?,?,?,0) ON CONFLICT(date, code) DO UPDATE SET rate = excluded.rate WHERE manual = 0');
    let n = 0;
    db.transaction(() => {
      for (const day of data) for (const c of day.currencies) {
        // store under the requested date (rate valid on that date) and the official valid-from date
        const r = normalizeNbgRate(c.rate, c.quantity);
        ins.run(date, c.code, r); ins.run(c.validFromDate.slice(0, 10), c.code, r); n++;
      }
    })();
    return n;
  } finally { clearTimeout(t); }
}

/** GEL per unit for `code` on `date`. Uses cache, then NBG, then most recent cached (offline fallback). */
export async function getRate(db: DB, code: string, date: string): Promise<{ rate: number; source: 'base' | 'cache' | 'nbg' | 'fallback' | 'manual' }> {
  if (code === 'GEL') return { rate: 1, source: 'base' };
  const d = date > todayISO() ? todayISO() : date;
  const row = db.prepare('SELECT rate, manual FROM rates WHERE code = ? AND date = ?').get(code, d) as { rate: number; manual: number } | undefined;
  if (row) return { rate: row.rate, source: row.manual ? 'manual' : 'cache' };
  try {
    await fetchNbg(db, d);
    const r2 = db.prepare('SELECT rate FROM rates WHERE code = ? AND date = ?').get(code, d) as { rate: number } | undefined;
    if (r2) return { rate: r2.rate, source: 'nbg' };
  } catch { /* offline */ }
  const fb = (db.prepare('SELECT rate FROM rates WHERE code = ? AND date <= ? ORDER BY date DESC LIMIT 1').get(code, d)
    ?? db.prepare('SELECT rate FROM rates WHERE code = ? ORDER BY date ASC LIMIT 1').get(code)) as { rate: number } | undefined;
  if (fb) return { rate: fb.rate, source: 'fallback' };
  throw new Error(`No exchange rate available for ${code} on ${d} (offline and nothing cached). Set a manual rate in Settings → Currency.`);
}

/** Latest known rate table (GEL per unit) for quick conversions. */
export function latestRates(db: DB): Record<string, number> {
  const rows = db.prepare('SELECT code, rate FROM rates r WHERE date = (SELECT MAX(date) FROM rates WHERE code = r.code)').all() as { code: string; rate: number }[];
  return Object.fromEntries([['GEL', 1], ...rows.map((r) => [r.code, r.rate])]);
}

export async function refreshToday(db: DB) {
  try { await fetchNbg(db, todayISO()); } catch { try { await fetchNbg(db, addDays(todayISO(), -1)); } catch { /* offline */ } }
}
