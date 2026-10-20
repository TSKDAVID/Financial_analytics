import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, ComposedChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Wallet, PiggyBank, Scale, Sparkles, CalendarClock, ShieldCheck } from 'lucide-react';
import { addDays } from '@fa/core';
import { useT } from '../lib/i18n';
import { useApi, useAction } from '../lib/hooks';
import { post, qs } from '../lib/api';
import { money, pct, dateFmt, monthFmt, today } from '../lib/format';
import { Button, Card, Input, PageHeader, Spinner, Stat, Tabs, Badge, cn, Empty } from '../components/ui';
import { NoData } from '../components/NoData';
import { InsightList, makePeriod, shiftPeriod, type Period, type PeriodKind, axis, grid, tooltipStyle, type Insight } from '../components/shared';
import { openNewTx } from '../components/Layout';

export default function Dashboard() {
  const t = useT();
  const [p, setP] = useState<Period>(makePeriod('month'));
  const d = useApi<any>(`/dashboard${qs({ from: p.from, to: p.to })}`);
  const meta = useApi<any>('/meta');
  const ins = useApi<Insight[]>('/insights');
  const bills = useApi<any[]>('/bills/upcoming');
  const risk = useApi<any>('/risk');
  const { run, busy } = useAction();
  const fcData = useFcPost();

  if (meta.data && !meta.data.hasData) return (
    <div className="max-w-xl mx-auto mt-16"><Card><Empty icon={<Sparkles className="h-6 w-6" />} title={t('dash.welcome')}>
      <div className="flex gap-2 flex-wrap justify-center mt-2">
        <Button loading={busy} onClick={() => run(() => post('/demo/seed'), '✓')}>{t('dash.loadDemo')}</Button>
        <Link to="/accounts"><Button variant="outline">{t('dash.startEmpty')}</Button></Link>
      </div></Empty></Card></div>);
  if (!d.data) return <Spinner />;
  const x = d.data;
  const expenseCats = x.byCategory.filter((c: any) => c.kind === 'expense');
  const showDaily = p.kind === 'month' || (p.kind === 'custom' && x.series.length <= 92);
  return (
    <div className="space-y-6">
      <PageHeader title={t('dash.title')} subtitle={`${dateFmt(p.from)} – ${dateFmt(p.to)}`} actions={
        <div className="flex flex-wrap items-center gap-2">
          <Tabs<PeriodKind> value={p.kind} onChange={(k) => setP(makePeriod(k))} options={[{ value: 'month', label: t('common.month') }, { value: 'quarter', label: t('common.quarter') }, { value: 'year', label: t('common.year') }, { value: 'custom', label: t('common.custom') }]} />
          {p.kind !== 'custom' ? <div className="flex"><Button variant="outline" size="icon" onClick={() => setP(shiftPeriod(p, -1))}><ChevronLeft className="h-4 w-4" /></Button><Button variant="outline" size="icon" className="ml-1" onClick={() => setP(shiftPeriod(p, 1))}><ChevronRight className="h-4 w-4" /></Button></div>
            : <div className="flex gap-1"><Input type="date" className="w-36 h-9" value={p.from} onChange={(e) => setP({ ...p, from: e.target.value })} /><Input type="date" className="w-36 h-9" value={p.to} onChange={(e) => setP({ ...p, to: e.target.value })} /></div>}
        </div>} />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
        <Stat label={t('dash.netCashFlow')} value={money(x.net)} delta={x.compare.prev.netPct} deltaLabel={t('dash.vsLast')} icon={<Scale className="h-4 w-4" />} tone="#6366f1" />
        <Stat label={t('dash.income')} value={money(x.income)} delta={x.compare.prev.incomePct} deltaLabel={t('dash.vsLast')} icon={<TrendingUp className="h-4 w-4" />} tone="#10b981" />
        <Stat label={t('dash.expenses')} value={money(x.expense)} delta={x.compare.prev.expensePct} deltaLabel={t('dash.vsLast')} icon={<TrendingDown className="h-4 w-4" />} tone="#ef4444" invert />
        <Stat label={t('dash.savingsRate')} value={pct(x.savingsRate, 1)} icon={<PiggyBank className="h-4 w-4" />} tone="#f59e0b" />
        <Stat label={t('dash.netWorth')} value={money(x.netWorth, 'GEL', { compact: Math.abs(x.netWorth) > 999999 })} icon={<Wallet className="h-4 w-4" />} tone="#8b5cf6" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <CompareCard title={t('dash.vsLast')} cur={x} other={x.compare.prev} />
        <CompareCard title={t('dash.vsYear')} cur={x} other={x.compare.yoy} />
        <Card title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" />{t('dash.health')}</span>} action={<Link to="/risk" className="text-xs text-primary">→</Link>}>
          {risk.data?.insufficient ? <NoData compact /> : risk.data ? <div className="flex items-center gap-4"><ScoreRing score={risk.data.health.score} /><div className="space-y-1 text-sm"><div className="font-semibold">{t('grade.' + risk.data.health.grade)}</div>
            <div className="text-muted-foreground text-xs">{t('risk.dti')}: <b className="num">{pct(risk.data.health.dti)}</b></div>
            <div className="text-muted-foreground text-xs">{t('risk.emergency')}: <b className="num">{risk.data.emergency.months.toFixed(1)}</b> {t('common.month').toLowerCase()}</div></div></div> : <Spinner />}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title={t('dash.incomeVsExpenses')}>
          <div className="h-72"><ResponsiveContainer>
            {showDaily ? <AreaChart data={cumulative(x.series, p.from, p.to)}>
              <defs><linearGradient id="gi" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#10b981" stopOpacity={0.35} /><stop offset="1" stopColor="#10b981" stopOpacity={0} /></linearGradient>
                <linearGradient id="ge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ef4444" stopOpacity={0.3} /><stop offset="1" stopColor="#ef4444" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid {...grid} /><XAxis dataKey="date" {...axis} tickFormatter={(v) => v.slice(8)} /><YAxis {...axis} tickFormatter={(v) => money(v, 'GEL', { compact: true })} width={60} />
              <Tooltip {...tooltipStyle} formatter={(v: number) => money(v)} labelFormatter={(l) => dateFmt(l)} /><Legend />
              <Area type="monotone" dataKey="income" name={t('common.income')} stroke="#10b981" fill="url(#gi)" strokeWidth={2} />
              <Area type="monotone" dataKey="expense" name={t('common.expense')} stroke="#ef4444" fill="url(#ge)" strokeWidth={2} />
            </AreaChart> : <BarChart data={x.trend.filter((m: any) => m.month >= p.from.slice(0, 7) && m.month <= p.to.slice(0, 7))}>
              <CartesianGrid {...grid} /><XAxis dataKey="month" {...axis} tickFormatter={(v) => monthFmt(v)} /><YAxis {...axis} tickFormatter={(v) => money(v, 'GEL', { compact: true })} width={60} />
              <Tooltip {...tooltipStyle} formatter={(v: number) => money(v)} labelFormatter={(l) => monthFmt(l, false)} /><Legend />
              <Bar dataKey="income" name={t('common.income')} fill="#10b981" radius={[4, 4, 0, 0]} /><Bar dataKey="expense" name={t('common.expense')} fill="#ef4444" radius={[4, 4, 0, 0]} />
            </BarChart>}
          </ResponsiveContainer></div>
        </Card>
        <Card title={t('dash.breakdown')}>
          {expenseCats.length ? <><div className="h-48"><ResponsiveContainer><PieChart>
            <Pie data={expenseCats} dataKey="total" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2} stroke="none">{expenseCats.map((c: any) => <Cell key={c.id ?? c.name} fill={c.color} />)}</Pie>
            <Tooltip {...tooltipStyle} formatter={(v: number) => money(v)} /></PieChart></ResponsiveContainer></div>
            <ul className="mt-3 space-y-1.5 max-h-40 overflow-y-auto pr-1">{expenseCats.map((c: any) => <li key={c.id ?? c.name} className="flex items-center gap-2 text-sm">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} /><Link to={`/transactions?category_id=${c.id}&from=${p.from}&to=${p.to}`} className="flex-1 truncate hover:underline">{c.name}</Link>
              <span className="text-muted-foreground text-xs num">{pct(c.total / x.expense)}</span><span className="num font-medium">{money(c.total, 'GEL', { decimals: 0 })}</span></li>)}</ul></>
            : <Empty title={t('common.empty')} />}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title={t('dash.trends')} subtitle="12 months">
          <div className="h-64"><ResponsiveContainer><ComposedChart data={x.trend}>
            <CartesianGrid {...grid} /><XAxis dataKey="month" {...axis} tickFormatter={(v) => monthFmt(v)} /><YAxis {...axis} tickFormatter={(v) => money(v, 'GEL', { compact: true })} width={60} />
            <Tooltip {...tooltipStyle} formatter={(v: number) => money(v)} labelFormatter={(l) => monthFmt(l, false)} /><Legend />
            <Bar dataKey="net" name={t('dash.netCashFlow')} radius={[4, 4, 0, 0]}>{x.trend.map((m: any) => <Cell key={m.month} fill={m.net >= 0 ? '#6366f1' : '#ef4444'} fillOpacity={0.75} />)}</Bar>
            <Line type="monotone" dataKey="income" name={t('common.income')} stroke="#10b981" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="expense" name={t('common.expense')} stroke="#f97316" strokeWidth={2} dot={false} />
          </ComposedChart></ResponsiveContainer></div>
        </Card>
        <Card title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" />{t('dash.insights')}</span>} action={<Link to="/forecast" className="text-xs text-primary">→</Link>}>
          {x.dataStatus && !x.dataStatus.sufficient ? <NoData compact what={t('nodata.insights')} /> : <InsightList items={ins.data ?? []} max={6} />}
        </Card>
      </div>

      <Card title={t('dash.heatmap')}><Heatmap daily={x.daily} /></Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={t('dash.accounts')} action={<Link to="/accounts" className="text-xs text-primary">→</Link>}>
          <ul className="space-y-2">{x.accounts.map((a: any) => <li key={a.id} className="flex items-center gap-3"><span className="h-8 w-1.5 rounded-full" style={{ background: a.color }} /><div className="flex-1"><div className="text-sm font-medium">{a.name}</div><div className="text-[11px] text-muted-foreground">{a.bank ?? t('acc.type.' + a.type)}</div></div>
            <div className={cn('text-sm font-semibold num', a.balance < 0 && 'text-danger')}>{money(a.balance, a.currency)}</div></li>)}</ul>
          {!x.accounts.length && <Button variant="outline" onClick={openNewTx}>+</Button>}
        </Card>
        <Card title={<span className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-primary" />{t('dash.upcoming')}</span>} action={<Link to="/subscriptions" className="text-xs text-primary">→</Link>}>
          <ul className="space-y-2 max-h-72 overflow-y-auto">{(bills.data ?? []).slice(0, 8).map((b) => <BillRow key={b.id} b={b} />)}</ul>
          {!bills.data?.length && <p className="text-sm text-muted-foreground">✓</p>}
        </Card>
        <Card title={t('dash.forecast')} action={<Link to="/forecast" className="text-xs text-primary">→</Link>}>
          {fcData?.insufficient ? <NoData compact what={t('nodata.forecast')} /> : fcData ? <div className="h-56"><ResponsiveContainer><AreaChart data={fcData.base}>
            <CartesianGrid {...grid} /><XAxis dataKey="month" {...axis} tickFormatter={(v) => monthFmt(v)} /><YAxis {...axis} tickFormatter={(v) => money(v, 'GEL', { compact: true })} width={55} />
            <Tooltip {...tooltipStyle} formatter={(v: number) => money(v)} />
            <Area dataKey="best" stroke="none" fill="#6366f1" fillOpacity={0.12} name={t('fc.best')} /><Area dataKey="worst" stroke="none" fill="hsl(var(--card))" fillOpacity={1} name={t('fc.worst')} />
            <Area dataKey="expected" stroke="#6366f1" strokeWidth={2} fill="none" name={t('fc.expected')} />
          </AreaChart></ResponsiveContainer></div> : <Spinner />}
        </Card>
      </div>
    </div>
  );
}

function useFcPost() {
  return useQuery({ queryKey: ['forecast6'], queryFn: () => post<any>('/forecast', { months: 6 }) }).data;
}

export function BillRow({ b }: { b: any }) {
  const t = useT(); const { run } = useAction();
  const overdue = b.due_date < today();
  return <li className="flex items-center gap-3 text-sm"><div className={cn('w-11 text-center rounded-lg py-1 text-[11px] leading-tight', overdue ? 'bg-danger/15 text-danger' : 'bg-muted')}><div className="font-bold text-sm">{b.due_date.slice(8)}</div>{dateFmt(b.due_date, { month: 'short' })}</div>
    <div className="flex-1 min-w-0"><div className="truncate font-medium">{b.name}</div><div className="text-[11px] text-muted-foreground">{b.type === 'loan' ? t('nav.loans') : t('sub.kind.' + (b.type ?? 'bill'))}{overdue && <Badge tone="danger" className="ml-2">{t('common.overdue')}</Badge>}</div></div>
    <div className="text-right"><div className="num font-semibold">{money(b.amount, b.currency)}</div><button className="text-[11px] text-primary hover:underline" onClick={() => run(() => post(`/bills/${b.id}/pay`), t('common.paid'))}>{t('sub.pay')}</button></div></li>;
}

function CompareCard({ title, cur, other }: { title: string; cur: any; other: any }) {
  const t = useT();
  const rows = [['common.income', cur.income, other.income, other.incomePct, false], ['common.expense', cur.expense, other.expense, other.expensePct, true], ['dash.netCashFlow', cur.net, other.net, other.netPct, false]] as const;
  return <Card title={title}><div className="space-y-3">{rows.map(([k, a, b, d, inv]) => { const good = d == null ? null : inv ? d <= 0 : d >= 0; return (
    <div key={k} className="flex items-center justify-between text-sm"><span className="text-muted-foreground">{t(k)}</span><div className="text-right"><span className="num font-medium">{money(a, 'GEL', { decimals: 0 })}</span>
      <span className="text-xs text-muted-foreground num ml-2">/ {money(b, 'GEL', { decimals: 0 })}</span>{d != null && isFinite(d) && <span className={cn('ml-2 text-xs num', good ? 'text-success' : 'text-danger')}>{d >= 0 ? '+' : ''}{(d * 100).toFixed(0)}%</span>}</div></div>); })}</div></Card>;
}

export function ScoreRing({ score, size = 84 }: { score: number; size?: number }) {
  const r = size / 2 - 7, c = 2 * Math.PI * r; const color = score >= 80 ? '#10b981' : score >= 65 ? '#22c55e' : score >= 50 ? '#f59e0b' : score >= 30 ? '#f97316' : '#ef4444';
  return <svg width={size} height={size} className="-rotate-90"><circle cx={size / 2} cy={size / 2} r={r} stroke="hsl(var(--muted))" strokeWidth={8} fill="none" />
    <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={8} fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} style={{ transition: 'stroke-dashoffset .8s' }} />
    <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="rotate-90 origin-center fill-foreground font-bold" fontSize={size / 3.6}>{score}</text></svg>;
}

function cumulative(series: { date: string; income: number; expense: number }[], from: string, to: string) {
  const m = new Map(series.map((s) => [s.date, s])); const out: any[] = []; let inc = 0, exp = 0;
  const end = to < today() ? to : today();
  for (let d = from; d <= end; d = addDays(d, 1)) { const s = m.get(d); inc += s?.income ?? 0; exp += s?.expense ?? 0; out.push({ date: d, income: Math.round(inc), expense: Math.round(exp) }); }
  return out;
}

function Heatmap({ daily }: { daily: { date: string; net: number; expense: number }[] }) {
  const t = useT();
  const map = new Map(daily.map((d) => [d.date, d]));
  const end = today(); let start = addDays(end, -364);
  start = addDays(start, -((new Date(start + 'T00:00:00').getDay() + 6) % 7));
  const weeks: string[][] = []; for (let d = start; d <= end; d = addDays(d, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
  const max = Math.max(1, ...daily.map((d) => Math.abs(d.net)));
  const color = (v: number | undefined) => { if (v == null) return 'hsl(var(--muted))'; const a = Math.min(1, Math.sqrt(Math.abs(v) / max)) * 0.85 + 0.15; return v >= 0 ? `rgba(16,185,129,${a})` : `rgba(239,68,68,${a})`; };
  return <div className="overflow-x-auto"><div className="flex gap-[3px] min-w-max">{weeks.map((w, i) => <div key={i} className="flex flex-col gap-[3px]">{w.map((d) => { const v = map.get(d); return d > end ? <div key={d} className="h-3 w-3" /> :
    <div key={d} className="h-3 w-3 rounded-[3px] transition hover:ring-2 ring-primary" style={{ background: color(v?.net) }} title={`${dateFmt(d)}: ${v ? money(v.net, 'GEL', { sign: true }) : '—'}`} />; })}</div>)}</div>
    <div className="flex items-center gap-2 mt-3 text-[11px] text-muted-foreground"><span className="h-3 w-3 rounded-[3px]" style={{ background: 'rgba(239,68,68,.8)' }} />{t('common.expense')} <span className="h-3 w-3 rounded-[3px] ml-2" style={{ background: 'rgba(16,185,129,.8)' }} />{t('common.income')}</div></div>;
}
