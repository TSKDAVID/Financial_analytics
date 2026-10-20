import * as SecureStore from 'expo-secure-store';

export interface Conn { url: string; token: string }
const KEY = 'fa.conn';
let cached: Conn | null | undefined;

export async function loadConn(): Promise<Conn | null> {
  if (cached !== undefined) return cached;
  const raw = await SecureStore.getItemAsync(KEY);
  cached = raw ? (JSON.parse(raw) as Conn) : null;
  return cached;
}
export async function saveConn(c: Conn | null) {
  cached = c;
  if (c) await SecureStore.setItemAsync(KEY, JSON.stringify(c)); else await SecureStore.deleteItemAsync(KEY);
}
export class ApiError extends Error { constructor(msg: string, public status: number) { super(msg); } }

export async function remote<T = any>(path: string, opts: { method?: string; body?: unknown; conn?: Conn } = {}): Promise<T> {
  const c = opts.conn ?? (await loadConn());
  if (!c) throw new ApiError('Not paired', 0);
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await fetch(`${c.url.replace(/\/$/, '')}/api${path}`, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'), signal: ctl.signal,
      headers: { Authorization: `Bearer ${c.token}`, ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError((data as any).error ?? `HTTP ${res.status}`, res.status);
    return data as T;
  } catch (e: any) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(e?.name === 'AbortError' ? 'Computer not reachable. Is it on and connected to Tailscale?' : e?.message ?? 'Network error', 0);
  } finally { clearTimeout(timer); }
}

export async function pair(url: string, code: string, name: string): Promise<Conn> {
  const base = url.trim().replace(/\/$/, '');
  const res = await fetch(`${base}/api/pair/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code.trim(), name }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  const conn = { url: base, token: data.token as string };
  await saveConn(conn);
  return conn;
}

export const money = (n: number, cur = 'GEL') => {
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? '−' : ''}${cur === 'GEL' ? '₾' : cur + ' '}${s}`;
};
export const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
