import * as SecureStore from 'expo-secure-store';

export interface Conn { url: string; token: string; urls?: string[] }
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
  try { return await remoteOnce<T>(path, opts); }
  catch (e: any) {
    if (!(e instanceof ApiError) || e.status !== 0 || opts.conn) throw e;
    const c = await loadConn(); const n = c && (await failover(c)); if (!n) throw e;
    return remoteOnce<T>(path, { ...opts, conn: n });
  }
}
async function remoteOnce<T = any>(path: string, opts: { method?: string; body?: unknown; conn?: Conn } = {}): Promise<T> {
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

/** "192.168.1.5" → "http://192.168.1.5:5317"; keeps explicit scheme/port. */
export function normalizeUrl(u: string) {
  let x = u.trim().replace(/\/+$/, ''); if (!x) return '';
  if (!/^https?:\/\//i.test(x)) x = 'http://' + x;
  if (!/:\d+$/.test(x.replace(/^https?:\/\//i, ''))) x += ':5317';
  return x;
}
async function timedFetch(url: string, init: RequestInit, ms: number) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctl.signal }); } finally { clearTimeout(t); }
}
/** Probe all candidates in parallel; returns the reachable ones in the given (ranked) order. */
export async function reachable(urls: string[], ms = 3500): Promise<string[]> {
  const ok = await Promise.all(urls.map(async (u) => { try { const r = await timedFetch(`${u}/api/health`, {}, ms); const j: any = await r.json().catch(() => ({})); return r.ok && j.app === 'financial-analytics'; } catch { return false; } }));
  return urls.filter((_, i) => ok[i]);
}
/** Pair using every candidate address (QR lists them ranked); the first that answers wins and is remembered. */
export async function pair(url: string | string[], code: string, name: string): Promise<Conn> {
  const all = [...new Set((Array.isArray(url) ? url : [url]).map(normalizeUrl).filter(Boolean))];
  if (!all.length) throw new Error('Enter the computer address, e.g. 192.168.1.10');
  const live = await reachable(all);
  const order = [...live, ...all.filter((u) => !live.includes(u))];
  const errors: string[] = [];
  for (const base of order) {
    try {
      const res = await timedFetch(`${base}/api/pair/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code.trim(), name }) }, live.includes(base) ? 10000 : 4000);
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(data.error ?? `HTTP ${res.status}`), { final: res.status === 400 || res.status === 401 || res.status === 403 });
      const conn = { url: base, token: data.token as string, urls: all };
      await saveConn(conn);
      return conn;
    } catch (e: any) {
      if (e?.final) throw e; // the computer answered and refused (wrong / expired code): don't keep trying
      errors.push(`${base.replace(/^https?:\/\//, '')}: ${e?.name === 'AbortError' ? 'no answer' : e?.message ?? 'failed'}`);
    }
  }
  const isolated = errors.some((e) => /no route to host|EHOSTUNREACH/i.test(e));
  throw new Error(`Could not reach the computer at any address:\n${errors.join('\n')}` + (isolated ? '\n\n"No route to host" on the same Wi-Fi usually means the router blocks devices from talking to each other (AP / client isolation). Turn it off in the router settings, or use Tailscale on both devices.' : ''));
}
/** If the saved address stops answering (e.g. Wi-Fi changed), find another candidate that does and remember it. */
async function failover(c: Conn): Promise<Conn | null> {
  const others = (c.urls ?? []).filter((u) => u !== c.url); if (!others.length) return null;
  const [u] = await reachable(others, 3000); if (!u) return null;
  const n = { ...c, url: u }; await saveConn(n); return n;
}

export const money = (n: number, cur = 'GEL') => {
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? '−' : ''}${cur === 'GEL' ? '₾' : cur + ' '}${s}`;
};
export const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
