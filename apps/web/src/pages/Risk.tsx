import { useState } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ShieldCheck, Landmark, LifeBuoy, TrendingDown, Activity, PiggyBank } from 'lucide-react';
import { useT } from '../lib/i18n';
import { useApi, useAction } from '../lib/hooks';
import { put } from '../lib/api';
import { money, pct, dateFmt } from '../lib/format';
import { Badge, Button, Card, Input, PageHeader, Progress, Spinner, cn } from '../components/ui';
import { ScoreRing } from './Dashboard';
import { CreditBureauCard } from '../components/CreditBureauCard';
import { axis, grid, tooltipStyle } from '../components/shared';

export default function Risk() {
  const t = useT(); const d = useApi<any>('/risk'); const { run } = useAction();
  const [minBal, setMinBal] = useState<string | null>(null);
  if (!d.data) return <Spinner />;
  const r = d.data; const h = r.health;
  const icons: Record<string, any> = { savings: PiggyBank, debt: Landmark, emergency: LifeBuoy, stability: Activity };
  const fmtVal = (k: string, v: number) => (k === 'emergency' ? `${v.toFixed(1)} mo` : k === 'stability' ? `${Math.round((1 - v) * 100)}%` : pct(v, 1));
  const dtiTone = r.dtiLevel === 'danger' ? 'danger' : r.dtiLevel === 'warning' ? 'warning' : 'success';
  return <div className="space-y-6">
    <PageHeader title={t('risk.title')} />
    <CreditBureauCard />
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" />{t('risk.score')}</span>}>
        <div className="flex flex-col items-center gap-2"><ScoreRing score={h.score} size={150} /><Badge tone={h.score >= 65 ? 'success' : h.score >= 50 ? 'warning' : 'danger'} className="text-sm px-3">{t('grade.' + h.grade)}</Badge></div>
        <div className="mt-5 space-y-3">{h.breakdown.map((b: any) => { const I = icons[b.key]; return <div key={b.key}>
          <div className="flex items-center justify-between text-sm mb-1"><span className="flex items-center gap-2"><I className="h-3.5 w-3.5 text-muted-foreground" />{t('risk.' + b.key)} <span className="text-xs text-muted-foreground num">({fmtVal(b.key, b.value)})</span></span><span className="num font-medium">{b.score}/{b.max}</span></div>
          <Progress value={b.score / b.max} tone={b.score / b.max >= 0.7 ? 'hsl(var(--success))' : b.score / b.max >= 0.4 ? 'hsl(var(--warning))' : 'hsl(var(--danger))'} /></div>; })}</div>
      </Card>
      <div className="space-y-4 lg:col-span-2">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card title={t('risk.dti')}><div className="flex items-baseline gap-2"><span className="text-3xl font-bold num">{pct(h.dti, 1)}</span><Badge tone={dtiTone}>{t(r.dtiLevel === 'ok' ? 'risk.dtiOk' : r.dtiLevel === 'warning' ? 'risk.dtiWarning' : 'risk.dtiDanger')}</Badge></div>
            <div className="relative mt-4 h-3 rounded-full bg-gradient-to-r from-success via-warning to-danger"><div className="absolute -top-1 h-5 w-1.5 rounded bg-foreground" style={{ left: `${Math.min(100, (h.dti / 0.6) * 100)}%` }} /></div>
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1"><span>0%</span><span>36%</span><span>43%</span><span>60%+</span></div>
            <p className="text-xs text-muted-foreground mt-3 num">{money(r.monthlyDebtPayments)} / {money(r.monthlyIncome)} {t('common.monthly').toLowerCase()}</p></Card>
          <Card title={t('risk.emergency')}><div className="flex items-baseline gap-2"><span className="text-3xl font-bold num">{r.emergency.months.toFixed(1)}</span><span className="text-sm text-muted-foreground">{t('risk.months')}</span></div>
            <Progress value={r.emergency.months / r.emergency.target} tone={r.emergency.months >= r.emergency.target ? 'hsl(var(--success))' : r.emergency.months >= 3 ? 'hsl(var(--warning))' : 'hsl(var(--danger))'} className="mt-4 h-3" />
            <p className="text-xs text-muted-foreground mt-3">{t('risk.target', { n: r.emergency.target })}{r.emergency.needed > 0 && ' · ' + t('risk.needed', { amount: money(r.emergency.needed) })}</p></Card>
        </div>
        <Card title={<span className="flex items-center gap-2"><TrendingDown className="h-4 w-4 text-danger" />{t('risk.lowBalance')}</span>} action={<div className="flex items-center gap-2 text-xs"><span className="text-muted-foreground">{t('risk.minBalance')}</span>
          <Input className="h-8 w-24" type="number" value={minBal ?? r.lowBalance.minBalance} onChange={(e) => setMinBal(e.target.value)} />{minBal !== null && <Button size="sm" onClick={() => run(() => put('/settings', { minBalance: minBal }), '✓').then(() => setMinBal(null))}>✓</Button>}</div>}>
          <div className={cn('rounded-lg p-3 text-sm mb-3', r.lowBalance.firstBelow ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success')}>{r.lowBalance.firstBelow ? t('risk.lowest', { amount: money(r.lowBalance.lowest.balance), date: dateFmt(r.lowBalance.lowest.date) }) : t('risk.safe', { days: r.lowBalance.days })}</div>
          <div className="h-48"><ResponsiveContainer><AreaChart data={r.lowBalance.projection}><CartesianGrid {...grid} /><XAxis dataKey="date" {...axis} tickFormatter={(v) => v.slice(5)} minTickGap={20} /><YAxis {...axis} tickFormatter={(v) => money(v, 'GEL', { compact: true })} width={60} />
            <Tooltip {...tooltipStyle} formatter={(v: number) => money(v)} labelFormatter={(l) => dateFmt(l)} /><ReferenceLine y={r.lowBalance.minBalance} stroke="hsl(var(--danger))" strokeDasharray="4 4" />
            <Area type="stepAfter" dataKey="balance" stroke="#6366f1" fill="#6366f1" fillOpacity={0.12} strokeWidth={2} name={t('common.balance')} /></AreaChart></ResponsiveContainer></div>
        </Card>
      </div>
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={t('risk.stress')} subtitle={`${t('risk.burn')}: ${money(r.stress.burn)}`}>
        <div className="text-2xl font-bold mb-3">{r.stress.runwayMonths == null ? '∞' : t('risk.runway', { n: r.stress.runwayMonths.toFixed(1) })}</div>
        <div className="h-52"><ResponsiveContainer><AreaChart data={r.stress.series}><CartesianGrid {...grid} /><XAxis dataKey="month" {...axis} tickFormatter={(v) => `${v}m`} /><YAxis {...axis} tickFormatter={(v) => money(v, 'GEL', { compact: true })} width={60} />
          <Tooltip {...tooltipStyle} formatter={(v: number) => money(v)} labelFormatter={(l) => `${l} months`} /><ReferenceLine y={0} stroke="hsl(var(--danger))" />
          <Area dataKey="balance" stroke="#ef4444" fill="#ef4444" fillOpacity={0.12} strokeWidth={2} /></AreaChart></ResponsiveContainer></div>
      </Card>
      <Card title={t('risk.budgets')}>{!r.budgets.length ? <p className="text-sm text-muted-foreground">—</p> : <div className="space-y-3">{r.budgets.map((b: any) => <div key={b.id}>
        <div className="flex justify-between text-sm mb-1"><span className="flex items-center gap-2">{b.name}{b.pct >= 1 ? <Badge tone="danger">100%</Badge> : b.pct >= 0.8 ? <Badge tone="warning">80%</Badge> : null}</span><span className="num text-muted-foreground">{money(b.spent, 'GEL', { decimals: 0 })} / {money(b.limit, 'GEL', { decimals: 0 })}</span></div>
        <Progress value={b.pct} /></div>)}</div>}</Card>
    </div>
  </div>;
}
