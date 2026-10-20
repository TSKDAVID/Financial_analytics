import { getLang } from './i18n';
const loc = () => (getLang() === 'ka' ? 'ka-GE' : 'en-US');
export function money(n: number | null | undefined, cur = 'GEL', opts: { compact?: boolean; sign?: boolean; decimals?: number } = {}) {
  const v = Number(n ?? 0);
  try {
    const s = new Intl.NumberFormat(loc(), { style: 'currency', currency: cur, notation: opts.compact ? 'compact' : 'standard', maximumFractionDigits: opts.decimals ?? (opts.compact ? 1 : 2), minimumFractionDigits: opts.compact ? 0 : opts.decimals ?? 2, signDisplay: opts.sign ? 'exceptZero' : 'auto' }).format(v);
    return cur === 'GEL' ? s.replace('GEL', '₾').replace(/\s?₾/, ' ₾').trim() : s;
  } catch { return `${v.toFixed(2)} ${cur}`; }
}
export const pct = (n: number | null | undefined, d = 0) => (n == null || !isFinite(n) ? '—' : `${(n * 100).toFixed(d)}%`);
export const num = (n: number, d = 0) => new Intl.NumberFormat(loc(), { maximumFractionDigits: d }).format(n);
export function dateFmt(d: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!d) return '—'; return new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString(loc(), opts);
}
export const monthFmt = (m: string, short = true) => new Date(m + '-01T00:00:00').toLocaleDateString(loc(), { month: short ? 'short' : 'long', year: short ? '2-digit' : 'numeric' });
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const UNIT_LABEL: Record<string, string> = { day: 'day', week: 'week', month: 'month', year: 'year' };
export const CURRENCIES = ['GEL', 'USD', 'EUR', 'GBP', 'TRY', 'RUB', 'AMD', 'AZN', 'UAH', 'CHF', 'JPY', 'CNY', 'AED', 'PLN', 'CZK', 'SEK', 'NOK', 'DKK', 'CAD', 'AUD', 'ILS', 'KZT'];
