/** Rates are expressed as GEL per 1 unit of currency (NBG publishes rate per `quantity` units). */
export type RateTable = Record<string, number>;
export const BASE = 'GEL';

export function normalizeNbgRate(rate: number, quantity: number): number {
  return quantity > 0 ? rate / quantity : rate;
}
export function toGel(amount: number, code: string, rates: RateTable): number {
  if (code === BASE) return amount;
  const r = rates[code];
  if (!r || !isFinite(r)) throw new Error(`No rate for ${code}`);
  return amount * r;
}
export function convert(amount: number, from: string, to: string, rates: RateTable): number {
  if (from === to) return amount;
  const gel = toGel(amount, from, rates);
  if (to === BASE) return gel;
  const r = rates[to];
  if (!r) throw new Error(`No rate for ${to}`);
  return gel / r;
}
/** Pick the most recent rate on or before `date` from a dated history (sorted or not). */
export function rateOnOrBefore(history: { date: string; rate: number }[], date: string): number | null {
  let best: { date: string; rate: number } | null = null;
  for (const h of history) if (h.date <= date && (!best || h.date > best.date)) best = h;
  if (best) return best.rate;
  // fallback: earliest available after date
  let after: { date: string; rate: number } | null = null;
  for (const h of history) if (!after || h.date < after.date) after = h;
  return after?.rate ?? null;
}
export function formatMoney(amount: number, code = BASE, locale = 'en-US'): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: code, maximumFractionDigits: 2 }).format(amount);
  } catch { return `${amount.toFixed(2)} ${code}`; }
}
