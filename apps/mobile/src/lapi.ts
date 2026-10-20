import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { api } from './local/engine';
export { api };

/** Tiny query layer over the in-process API: every mutation bumps a version so all screens refetch. */
let version = 0; const subs = new Set<() => void>();
export const invalidate = () => { version++; subs.forEach((f) => f()); };
export function useQ<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null); const [error, setError] = useState<string | null>(null);
  const [v, setV] = useState(version); const [loading, setLoading] = useState(false);
  useEffect(() => { const f = () => setV(version); subs.add(f); return () => { subs.delete(f); }; }, []);
  const load = useCallback(async () => {
    if (!path) return; setLoading(true);
    try { setData(await api<T>(path)); setError(null); } catch (e: any) { setError(e?.message ?? String(e)); } finally { setLoading(false); }
  }, [path]);
  useEffect(() => { load(); }, [load, v]);
  return { data, error, loading, reload: load };
}
/** Run a mutation, refresh everything, surface errors. Returns the result or undefined on failure. */
export async function act<T>(fn: () => Promise<T>, okMsg?: string): Promise<T | undefined> {
  try { const r = await fn(); invalidate(); if (okMsg) toast(okMsg); return r; }
  catch (e: any) { Alert.alert('Error', e?.message ?? String(e)); return undefined; }
}
export const post = <T = any>(p: string, body: unknown = {}) => api<T>(p, { method: 'POST', body });
export const put = <T = any>(p: string, body: unknown) => api<T>(p, { method: 'PUT', body });
export const del = <T = any>(p: string) => api<T>(p, { method: 'DELETE' });

let toastFn: (m: string) => void = () => undefined;
export const setToast = (f: (m: string) => void) => { toastFn = f; };
export const toast = (m: string) => toastFn(m);

export const money = (n: number | null | undefined, cur = 'GEL', compact = false) => {
  const v = Number(n ?? 0);
  const s = compact && Math.abs(v) >= 1000 ? (Math.abs(v) / 1000).toFixed(Math.abs(v) >= 10000 ? 0 : 1) + 'k' : Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v < 0 ? '−' : ''}${cur === 'GEL' ? '₾' : cur + ' '}${s}`;
};
export const pct = (x: number | null | undefined, d = 0) => `${((x ?? 0) * 100).toFixed(d)}%`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dateFmt = (iso?: string | null) => { if (!iso) return '—'; const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
export const monthFmt = (ym: string) => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${String(y).slice(2)}`; };
export const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const CURRENCIES = ['GEL', 'USD', 'EUR', 'GBP', 'TRY', 'RUB', 'AMD', 'AZN', 'UAH', 'CHF'];
export const CHART_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#8b5cf6', '#ec4899', '#84cc16', '#f97316', '#14b8a6'];
