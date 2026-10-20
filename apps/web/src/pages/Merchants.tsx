import { useState } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { Store } from 'lucide-react';
import { useT } from '../lib/i18n';
import { useApi } from '../lib/hooks';
import { money, monthFmt, dateFmt } from '../lib/format';
import { Card, Input, PageHeader, Select, Spinner, Stat, cn, Empty } from '../components/ui';
import { InsightList, axis, tooltipStyle, type Insight } from '../components/shared';

export default function Merchants() {
  const t = useT();
  const [months, setMonths] = useState(6); const [q, setQ] = useState(''); const [open, setOpen] = useState<string | null>(null);
  const d = useApi<any>(`/merchants?months=${months}`);
  if (!d.data) return <Spinner />;
  const x = d.data; const list = x.merchants.filter((m: any) => !q || m.name.toLowerCase().includes(q.toLowerCase()));
  const count = x.merchants.reduce((s: number, m: any) => s + m.count, 0);
  return <div className="space-y-4">
    <PageHeader title={t('mer.title')} subtitle={t('mer.subtitle')} actions={<Select aria-label={t('mer.months')} value={months} onChange={(e) => setMonths(Number(e.target.value))}>{[3, 6, 12, 24].map((n) => <option key={n} value={n}>{n} {t('mer.months')}</option>)}</Select>} />
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3"><Stat label={t('mer.total')} value={money(x.total)} /><Stat label={t('mer.count')} value={count} /><Stat label={t('mer.avg')} value={money(count ? x.total / count : 0)} /></div>
    {!!x.insights.length && <Card><InsightList items={x.insights as Insight[]} max={6} /></Card>}
    <Input placeholder={t('mer.search')} value={q} onChange={(e) => setQ(e.target.value)} />
    {!list.length ? <Card><Empty icon={<Store className="h-6 w-6" />} title={t('common.empty')} /></Card> :
    <Card className="p-0"><ul className="divide-y text-sm">{list.slice(0, 200).map((m: any) => {
      const diff = m.lastMonth ? m.thisMonth / m.lastMonth - 1 : null;
      return <li key={m.key} className="p-3">
        <button className="flex w-full flex-wrap items-center justify-between gap-2 text-left" onClick={() => setOpen(open === m.key ? null : m.key)}>
          <span><b>{m.name}</b> <span className="text-xs text-muted-foreground">{m.category ?? ''} · ×{m.count} · {t('mer.avg')} {money(m.avg)} · {dateFmt(m.last)}</span></span>
          <span className="flex items-center gap-3 text-xs"><span className="text-muted-foreground">{t('mer.thisMonth')} <b className="num text-foreground">{money(m.thisMonth)}</b>{diff !== null && <span className={cn('ml-1', diff > 0 ? 'text-danger' : 'text-success')}>{diff > 0 ? '▲' : '▼'}{Math.abs(Math.round(diff * 100))}%</span>}</span>
            <span className="num w-24 text-right text-sm font-semibold">{money(m.total)}</span></span></button>
        {open === m.key && <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <div className="text-xs space-y-1"><div>{t('mer.lastMonth')}: <b className="num">{money(m.lastMonth)}</b></div><div>{t('mer.usual')}: <b className="num">{money(m.usualMonthly)}</b></div><div>{t('mer.share')}: <b>{x.total ? Math.round((m.total / x.total) * 100) : 0}%</b></div></div>
          <div className="h-28 sm:col-span-2"><ResponsiveContainer><BarChart data={m.monthly}><XAxis dataKey="month" {...axis} tickFormatter={(v) => monthFmt(v)} /><Tooltip {...tooltipStyle} formatter={(v: number) => money(v)} labelFormatter={(l) => monthFmt(l, false)} /><Bar dataKey="total" fill="#6366f1" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div>
        </div>}
      </li>; })}</ul></Card>}
  </div>;
}
