import { useEffect, useState } from 'react';
import { Area, ComposedChart, CartesianGrid, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Sparkles, AlertTriangle, CheckCircle2, RotateCcw } from 'lucide-react';
import { useT } from '../lib/i18n';
import { useApi } from '../lib/hooks';
import { post } from '../lib/api';
import { money, dateFmt, monthFmt, today } from '../lib/format';
import { Button, Card, Field, Input, PageHeader, Spinner, Switch, Tabs, cn, th, td } from '../components/ui';
import { InsightList, axis, grid, tooltipStyle, type Insight } from '../components/shared';

const init = { incomeChangePct: 0, newExpenseMonthly: 0, loan: false, principal: 10000, annualRatePct: 15, termMonths: 36, oneOffAmount: 0, oneOffDate: today() };

export default function Forecast() {
  const t = useT();
  const [months, setMonths] = useState<3 | 6 | 12>(12);
  const [w, setW] = useState(init);
  const [data, setData] = useState<any>(null);
  const ins = useApi<Insight[]>('/insights'); const anomalies = useApi<any[]>('/anomalies');
  useEffect(() => {
    const h = setTimeout(() => post('/forecast', { months, incomeChangePct: Number(w.incomeChangePct) || undefined, newExpenseMonthly: Number(w.newExpenseMonthly) || undefined,
      newLoan: w.loan ? { principal: Number(w.principal), annualRatePct: Number(w.annualRatePct), termMonths: Number(w.termMonths) } : null,
      oneOff: Number(w.oneOffAmount) ? [{ date: w.oneOffDate, amount: -Math.abs(Number(w.oneOffAmount)) }] : undefined }).then(setData).catch(() => undefined), 200);
    return () => clearTimeout(h);
  }, [months, w]);
  const changed = JSON.stringify(w) !== JSON.stringify(init);
  const rows = data ? data.base.map((b: any, i: number) => ({ month: b.month, expected: b.expected, band: [b.worst, b.best], scenario: data.scenario[i].expected, sBand: [data.scenario[i].worst, data.scenario[i].best] })) : [];
  const set = (p: Partial<typeof init>) => setW({ ...w, ...p });
  return <div className="space-y-6">
    <PageHeader title={t('fc.title')} actions={<Tabs value={String(months) as any} onChange={(v: any) => setMonths(Number(v) as any)} options={[{ value: '3', label: '3m' }, { value: '6', label: '6m' }, { value: '12', label: '12m' }]} />} />
    <div className="grid gap-4 lg:grid-cols-4">
      <Card className="lg:col-span-3" title={t('dash.forecast')} subtitle={data && <>{t('common.balance')}: <b className="num">{money(data.startBalance)}</b> · min {money(data.minBalance)}</>}>
        {!data ? <Spinner /> : <><div className="h-96"><ResponsiveContainer><ComposedChart data={rows}>
          <CartesianGrid {...grid} /><XAxis dataKey="month" {...axis} tickFormatter={(v) => monthFmt(v)} /><YAxis {...axis} tickFormatter={(v) => money(v, 'GEL', { compact: true })} width={65} />
          <Tooltip {...tooltipStyle} formatter={(v: any) => (Array.isArray(v) ? `${money(v[0], 'GEL', { decimals: 0 })} – ${money(v[1], 'GEL', { decimals: 0 })}` : money(v))} labelFormatter={(l) => monthFmt(l, false)} /><Legend />
          <Area dataKey="band" stroke="none" fill="#6366f1" fillOpacity={0.15} name={`${t('fc.worst')} – ${t('fc.best')}`} />
          <Line dataKey="expected" stroke="#6366f1" strokeWidth={2.5} dot={false} name={`${t('fc.base')} · ${t('fc.expected')}`} />
          {changed && <Area dataKey="sBand" stroke="none" fill="#f59e0b" fillOpacity={0.15} name={`${t('fc.scenario')} range`} />}
          {changed && <Line dataKey="scenario" stroke="#f59e0b" strokeWidth={2.5} strokeDasharray="6 3" dot={false} name={t('fc.scenario')} />}
          <ReferenceLine y={data.minBalance} stroke="hsl(var(--danger))" strokeDasharray="4 4" label={{ value: 'min', fill: 'hsl(var(--danger))', fontSize: 11 }} />
        </ComposedChart></ResponsiveContainer></div>
          <div className={cn('mt-4 flex items-center gap-2 rounded-lg p-3 text-sm', data.firstBelow ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success')}>{data.firstBelow ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}{data.firstBelow ? t('fc.below', { min: money(data.minBalance), month: monthFmt(data.firstBelow, false) }) : t('fc.ok')}</div></>}
      </Card>
      <Card title={t('fc.whatif')} action={changed && <Button size="sm" variant="ghost" onClick={() => setW(init)}><RotateCcw className="h-3.5 w-3.5" /></Button>}>
        <div className="space-y-4">
          <Field label={`${t('fc.incomeChange')}: ${w.incomeChangePct > 0 ? '+' : ''}${w.incomeChangePct}%`}><input type="range" min={-100} max={50} step={5} value={w.incomeChangePct} onChange={(e) => set({ incomeChangePct: Number(e.target.value) })} className="w-full accent-[hsl(var(--primary))]" /></Field>
          <Field label={t('fc.newExpense')}><Input type="number" min="0" value={w.newExpenseMonthly} onChange={(e) => set({ newExpenseMonthly: Number(e.target.value) })} /></Field>
          <Switch checked={w.loan} onChange={(v) => set({ loan: v })} label={t('fc.newLoan')} />
          {w.loan && <div className="grid grid-cols-3 gap-2"><Field label="₾"><Input type="number" value={w.principal} onChange={(e) => set({ principal: Number(e.target.value) })} /></Field><Field label="%"><Input type="number" value={w.annualRatePct} onChange={(e) => set({ annualRatePct: Number(e.target.value) })} /></Field><Field label={t('unit.month')}><Input type="number" value={w.termMonths} onChange={(e) => set({ termMonths: Number(e.target.value) })} /></Field></div>}
          <Field label={t('fc.oneOff')}><div className="flex gap-2"><Input type="number" min="0" className="w-28 shrink-0" value={w.oneOffAmount} onChange={(e) => set({ oneOffAmount: Number(e.target.value) })} /><Input type="date" value={w.oneOffDate} onChange={(e) => set({ oneOffDate: e.target.value })} /></div></Field>
          {data && changed && <div className="rounded-lg bg-muted/50 p-3 text-sm space-y-1"><div className="flex justify-between"><span className="text-muted-foreground">{t('fc.endBalance')}</span><b className="num">{money(data.scenario.at(-1).expected)}</b></div>
            <div className="flex justify-between"><span className="text-muted-foreground">{t('fc.difference')}</span><b className={cn('num', data.scenario.at(-1).expected - data.base.at(-1).expected < 0 ? 'text-danger' : 'text-success')}>{money(data.scenario.at(-1).expected - data.base.at(-1).expected, 'GEL', { sign: true })}</b></div></div>}
        </div>
      </Card>
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" />{t('fc.insights')}</span>}><InsightList items={ins.data ?? []} /></Card>
      <Card title={<span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-warning" />{t('fc.anomalies')}</span>}>
        {!anomalies.data?.length ? <p className="text-sm text-muted-foreground">✓</p> : <table className="w-full text-sm"><thead><tr><th className={th}>{t('common.date')}</th><th className={th}>{t('common.description')}</th><th className={cn(th, 'text-right')}>{t('common.amount')}</th><th className={cn(th, 'text-right')}>× usual</th></tr></thead>
          <tbody>{anomalies.data.map((a) => <tr key={a.id} className="border-t"><td className={td}>{dateFmt(a.date)}</td><td className={td}>{a.description}<div className="text-[11px] text-muted-foreground">{a.category}</div></td><td className={cn(td, 'text-right num font-medium')}>{money(a.amount_gel)}</td><td className={cn(td, 'text-right num text-warning')}>{(a.amount_gel / a.median).toFixed(1)}×</td></tr>)}</tbody></table>}
      </Card>
    </div>
    {data && <Card title={t('fc.expected')} className="p-0"><div className="-mx-5 -mb-5 overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted/40"><tr><th className={th}>{t('common.month')}</th><th className={cn(th, 'text-right')}>Recurring</th><th className={cn(th, 'text-right')}>Variable</th><th className={cn(th, 'text-right')}>{t('fc.worst')}</th><th className={cn(th, 'text-right')}>{t('fc.expected')}</th><th className={cn(th, 'text-right')}>{t('fc.best')}</th>{changed && <th className={cn(th, 'text-right')}>{t('fc.scenario')}</th>}</tr></thead>
      <tbody>{data.base.map((b: any, i: number) => <tr key={b.month} className="border-t num"><td className={td}>{monthFmt(b.month, false)}</td><td className={cn(td, 'text-right')}>{money(b.recurringNet, 'GEL', { sign: true })}</td><td className={cn(td, 'text-right')}>{money(b.variableNet, 'GEL', { sign: true })}</td><td className={cn(td, 'text-right text-danger')}>{money(b.worst)}</td><td className={cn(td, 'text-right font-semibold')}>{money(b.expected)}</td><td className={cn(td, 'text-right text-success')}>{money(b.best)}</td>{changed && <td className={cn(td, 'text-right text-warning font-semibold')}>{money(data.scenario[i].expected)}</td>}</tr>)}</tbody></table></div></Card>}
  </div>;
}
