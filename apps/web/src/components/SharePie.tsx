import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { money } from '../lib/format';
import { tooltipStyle } from './shared';

export const PIE_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f97316', '#ef4444', '#8b5cf6', '#ec4899', '#f59e0b', '#94a3b8', '#14b8a6'];
/** Donut with a legend of shares. */
export function SharePie({ data, title }: { data: { name: string; total: number; color?: string | null }[]; title?: string }) {
  const sum = data.reduce((s, d) => s + d.total, 0) || 1;
  return <div>{title && <h4 className="mb-1 text-sm font-semibold">{title}</h4>}
    <div className="flex flex-wrap items-center gap-3"><div className="h-40 w-40 shrink-0"><ResponsiveContainer><PieChart>
      <Pie data={data} dataKey="total" nameKey="name" innerRadius={42} outerRadius={70} paddingAngle={1}>{data.map((d, i) => <Cell key={d.name} fill={d.color || PIE_COLORS[i % PIE_COLORS.length]} />)}</Pie>
      <Tooltip {...tooltipStyle} formatter={(v: number) => money(v)} /></PieChart></ResponsiveContainer></div>
      <ul className="min-w-0 flex-1 space-y-0.5 text-xs">{data.slice(0, 9).map((d, i) => <li key={d.name} className="flex items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-1.5"><span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: d.color || PIE_COLORS[i % PIE_COLORS.length] }} /><span className="truncate">{d.name}</span></span><span className="num text-muted-foreground">{Math.round((d.total / sum) * 100)}%</span></li>)}</ul></div></div>;
}
