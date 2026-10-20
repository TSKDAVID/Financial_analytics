import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { useT } from '../lib/i18n';
import { cn } from './ui';
import { addMonths, endOfMonth, startOfMonth } from '@fa/core';
import { today } from '../lib/format';

export interface Insight { key: string; severity: 'info' | 'warning' | 'danger' | 'success'; params: Record<string, string | number> }
export const sevIcon = { info: Info, warning: AlertTriangle, danger: XCircle, success: CheckCircle2 } as const;
export const sevColor = { info: 'text-sky-500 bg-sky-500/10', warning: 'text-warning bg-warning/10', danger: 'text-danger bg-danger/10', success: 'text-success bg-success/10' } as const;

export function InsightList({ items, max }: { items: Insight[]; max?: number }) {
  const t = useT();
  if (!items.length) return <p className="text-sm text-muted-foreground">—</p>;
  return <ul className="space-y-2">{items.slice(0, max).map((i, k) => { const I = sevIcon[i.severity]; return (
    <li key={k} className="flex gap-3 items-start rounded-lg p-2.5 hover:bg-muted/50 transition"><span className={cn('rounded-lg p-1.5 shrink-0', sevColor[i.severity])}><I className="h-4 w-4" /></span><span className="text-sm leading-snug pt-0.5">{t('ins.' + i.key, i.params)}</span></li>); })}</ul>;
}

export type PeriodKind = 'month' | 'quarter' | 'year' | 'custom';
export interface Period { kind: PeriodKind; from: string; to: string }
export function makePeriod(kind: PeriodKind, anchor = today()): Period {
  if (kind === 'month') return { kind, from: startOfMonth(anchor), to: endOfMonth(anchor) };
  if (kind === 'quarter') { const m = Number(anchor.slice(5, 7)); const q0 = Math.floor((m - 1) / 3) * 3 + 1; const from = `${anchor.slice(0, 4)}-${String(q0).padStart(2, '0')}-01`; return { kind, from, to: endOfMonth(addMonths(from, 2)) }; }
  if (kind === 'year') return { kind, from: `${anchor.slice(0, 4)}-01-01`, to: `${anchor.slice(0, 4)}-12-31` };
  return { kind, from: startOfMonth(addMonths(anchor, -2)), to: anchor };
}
export function shiftPeriod(p: Period, dir: number): Period {
  const n = p.kind === 'month' ? 1 : p.kind === 'quarter' ? 3 : p.kind === 'year' ? 12 : 0;
  return n ? makePeriod(p.kind, addMonths(p.from, n * dir)) : p;
}
export const CHART_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#ec4899', '#84cc16', '#f97316', '#64748b'];
export const axis = { stroke: 'hsl(var(--muted-foreground))', fontSize: 11, tickLine: false, axisLine: false } as const;
export const grid = { stroke: 'hsl(var(--border))', strokeDasharray: '3 3', vertical: false } as const;
export const tooltipStyle = { contentStyle: { background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 10, fontSize: 12 }, labelStyle: { color: 'hsl(var(--foreground))', fontWeight: 600 } };
