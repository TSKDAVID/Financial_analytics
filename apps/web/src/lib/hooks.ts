import { useQuery, useQueryClient, QueryClient } from '@tanstack/react-query';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { get } from './api';

export const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15000, retry: (n, e: any) => e?.status !== 423 && n < 1, refetchOnWindowFocus: true } } });
export function useApi<T = any>(path: string | null, opts: { refetchInterval?: number } = {}) {
  return useQuery<T>({ queryKey: [path], queryFn: () => get<T>(path!), enabled: !!path, refetchInterval: opts.refetchInterval });
}
/** Run a mutation, toast errors, and refresh all queries. */
export function useAction() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
    setBusy(true);
    try { const r = await fn(); if (success) toast.success(success); await qc.invalidateQueries(); return r; }
    catch (e: any) { if (e?.status !== 423) toast.error(e?.message ?? 'Something went wrong'); return undefined; }
    finally { setBusy(false); }
  }, [qc]);
  return { run, busy };
}

// ---- theme ----
type Theme = 'light' | 'dark' | 'system';
let theme: Theme = (localStorage.getItem('fa.theme') as Theme) ?? 'system';
const tsubs = new Set<() => void>();
export function applyTheme() {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}
export function setTheme(t: Theme) { theme = t; localStorage.setItem('fa.theme', t); applyTheme(); tsubs.forEach((f) => f()); }
export function useTheme() { return useSyncExternalStore((f) => { tsubs.add(f); return () => tsubs.delete(f); }, () => theme); }
export const isDark = () => document.documentElement.classList.contains('dark');
