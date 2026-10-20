import { useState } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { Store, GitMerge, Split } from 'lucide-react';
import { useT } from '../lib/i18n';
import { useApi, useAction } from '../lib/hooks';
import { post, qs } from '../lib/api';
import { money, monthFmt, dateFmt } from '../lib/format';
import { Button, Card, Input, PageHeader, Spinner, Stat, cn, Empty } from '../components/ui';
import { InsightList, axis, tooltipStyle, type Insight } from '../components/shared';
import { RangePicker, rangeOf, type RangeKey } from '../components/RangePicker';
import { SharePie } from '../components/SharePie';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export default function Merchants() {
  const t = useT();
  const [range, setRange] = useState<RangeKey>('6m'); const [q, setQ] = useState(''); const [open, setOpen] = useState<string | null>(null);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const r = rangeOf(range);
  const d = useApi<any>(`/merchants${qs({ months: range === 'all' ? 24 : undefined, from: r.from ?? '2000-01-01', to: r.to })}`);
  const { run, busy } = useAction();
  if (!d.data) return <Spinner />;
  const x = d.data; const list = x.merchants.filter((m: any) => !q || m.name.toLowerCase().includes(q.toLowerCase()));
  const toggle = (k: string) => setPick((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const merge = () => { const keys = [...pick]; const into = keys[0]; const name = x.merchants.find((m: any) => m.key === into)?.name;
    const groupKeys = keys.flatMap((k) => x.merchants.find((m: any) => m.key === k)?.variants?.map((v: any) => v.key) ?? [k]);
    run(() => post('/merchants/merge', { keys: groupKeys, into, name }), t('mer.merged')).then(() => setPick(new Set())); };
  const hmax = Math.max(1, ...x.heat.flat());
  return <div className="space-y-4">
    <PageHeader title={t('mer.title')} subtitle={t('mer.subtitle')} actions={<RangePicker value={range} onChange={setRange} />} />
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3"><Stat label={t('mer.total')} value={money(x.total)} /><Stat label={t('mer.count')} value={x.count} /><Stat label={t('mer.avg')} value={money(x.count ? x.total / x.count : 0)} /><Stat label={t('mer.unique')} value={x.merchants.length} /></div>
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><SharePie title={t('mer.shareMerchant')} data={x.byMerchant} /></Card>
      <Card><SharePie title={t('mer.shareCategory')} data={x.byCategory} /></Card>
    </div>
    {!!x.insights.length && <Card title={t('dash.insights')}><InsightList items={x.insights as Insight[]} max={10} /></Card>}
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={t('mer.when')}><table className="w-full text-xs"><thead><tr><th />{['mer.morning', 'mer.afternoon', 'mer.evening', 'mer.night'].map((k) => <th key={k} className="font-normal text-muted-foreground">{t(k)}</th>)}<th className="font-normal text-muted-foreground">Σ</th></tr></thead>
        <tbody>{x.heat.map((row: number[], i: number) => <tr key={i}><td className="pr-2 text-muted-foreground">{DAYS[i]}</td>{row.map((v, j) => <td key={j} className="p-0.5"><div title={money(v)} className="h-6 rounded" style={{ background: `rgba(99,102,241,${0.08 + 0.9 * (v / hmax)})` }} /></td>)}<td className="num pl-2 text-right">{money(x.weekday[i], 'GEL', { compact: true })}</td></tr>)}</tbody></table>
        <p className="mt-1 text-[11px] text-muted-foreground">{t('mer.whenHint')}</p></Card>
      <Card title={t('mer.subs')}>{!x.subscriptions.length ? <p className="text-sm text-muted-foreground">{t('mer.noSubs')}</p> :
        <ul className="divide-y text-sm">{x.subscriptions.map((s: any) => <li key={s.name} className="flex justify-between py-1.5"><span>{s.name} <span className="text-xs text-muted-foreground">×{s.count} · {dateFmt(s.last)}</span></span><span className="num">{money(s.amount)} <span className="text-xs text-muted-foreground">/ {t('mer.yearly', { amount: money(s.yearly) })}</span></span></li>)}</ul>}</Card>
    </div>
    <div className="flex flex-wrap items-center gap-2"><Input className="max-w-xs" placeholder={t('mer.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      {pick.size >= 2 && <Button size="sm" loading={busy} onClick={merge}><GitMerge className="h-4 w-4" />{t('mer.merge', { n: pick.size })}</Button>}
      <span className="text-xs text-muted-foreground">{t('mer.mergeHint')}</span></div>
    {!list.length ? <Card><Empty icon={<Store className="h-6 w-6" />} title={t('common.empty')} /></Card> :
    <Card className="p-0"><ul className="divide-y text-sm">{list.slice(0, 250).map((m: any) => {
      const diff = m.lastMonth ? m.thisMonth / m.lastMonth - 1 : null;
      return <li key={m.key} className="p-3">
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2"><input type="checkbox" aria-label="select" checked={pick.has(m.key)} onChange={() => toggle(m.key)} />
            <button className="text-left" onClick={() => setOpen(open === m.key ? null : m.key)}><b>{m.name}</b> <span className="text-xs text-muted-foreground">{m.category ?? ''} · ×{m.count} · {t('mer.avg')} {money(m.avg)} · {dateFmt(m.last)}{m.variants?.length > 1 ? ` · ${t('mer.variants', { n: m.variants.length })}` : ''}</span></button></span>
          <span className="flex items-center gap-3 text-xs"><span className="text-muted-foreground">{t('mer.thisMonth')} <b className="num text-foreground">{money(m.thisMonth)}</b>{diff !== null && <span className={cn('ml-1', diff > 0 ? 'text-danger' : 'text-success')}>{diff > 0 ? '▲' : '▼'}{Math.abs(Math.round(diff * 100))}%</span>}</span>
            <span className="num w-24 text-right text-sm font-semibold">{money(m.total)}</span></span></div>
        {open === m.key && <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <div className="space-y-1 text-xs"><div>{t('mer.lastMonth')}: <b className="num">{money(m.lastMonth)}</b></div><div>{t('mer.usual')}: <b className="num">{money(m.usualMonthly)}</b></div>
            <div>{t('mer.perWeek')}: <b>{m.perWeek}</b></div><div>{t('mer.share')}: <b>{x.total ? Math.round((m.total / x.total) * 100) : 0}%</b></div>
            {m.variants?.length > 1 && <div className="pt-1"><div className="text-muted-foreground">{t('mer.variantList')}</div>{m.variants.map((v: any) => <div key={v.key} className="flex items-center justify-between gap-2"><span className="truncate">{v.key} ×{v.count}</span>
              {v.key !== m.key && <button className="text-primary hover:underline" disabled={busy} onClick={() => run(() => post('/merchants/split', { key: v.key }), t('mer.splitDone'))}><Split className="inline h-3 w-3" /> {t('mer.split')}</button>}</div>)}</div>}</div>
          <div className="h-28 sm:col-span-2"><ResponsiveContainer><BarChart data={m.monthly}><XAxis dataKey="month" {...axis} tickFormatter={(v) => monthFmt(v)} /><Tooltip {...tooltipStyle} formatter={(v: number) => money(v)} labelFormatter={(l) => monthFmt(l, false)} /><Bar dataKey="total" fill="#6366f1" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div>
        </div>}
      </li>; })}</ul></Card>}
  </div>;
}
