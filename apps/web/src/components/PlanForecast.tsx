import { useEffect, useRef, useState } from 'react';
import { CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Plus, Trash2, Save, RotateCcw } from 'lucide-react';
import { get, post } from '../lib/api';
import { money } from '../lib/format';
import { Button, Card, Field, Input, Select, Spinner, Stat } from './ui';
import { axis, grid, tooltipStyle } from './shared';

const HORIZONS = [6, 12, 24, 36, 48, 60];
const num = (v: string) => (v === '' ? 0 : Math.max(0, Number(v) || 0));

/** Dashboard › Forecast: your plan for income, spending, savings and paying off debt, month by month. */
export function PlanForecast() {
  const [res, setRes] = useState<any>(null);
  const [sc, setSc] = useState<any>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const first = useRef(true);
  useEffect(() => { get('/plan').then((r: any) => { setRes(r); setSc(r.scenario); }).catch(() => undefined); }, []);
  useEffect(() => {
    if (!sc) return; if (first.current) { first.current = false; return; }
    const h = setTimeout(() => post('/plan', { scenario: sc }).then(setRes).catch(() => undefined), 250);
    return () => clearTimeout(h);
  }, [sc]);
  if (!res || !sc) return <Spinner />;
  const set = (p: any) => { setSc({ ...sc, ...p }); setSaved(null); };
  const d = res.defaults;
  const last = res.months[res.months.length - 1];
  const chart = res.months.map((m: any) => ({ label: m.label, netWorth: m.netWorth, savings: m.savings, debt: -m.debt, cash: m.cash }));
  const incomeTotal = sc.incomes.reduce((s: number, i: any) => s + (Number(i.amount) || 0), 0);
  const debtMin = d.debts.reduce((s: number, x: any) => s + x.minPayment + x.monthlyFee, 0);
  const extras = Object.values(sc.debtExtra ?? {}).reduce((s: number, v: any) => s + (Number(v) || 0), 0) + (sc.strategy !== 'none' ? sc.extraPool : 0);
  const left = incomeTotal - sc.expenses - sc.savingsMonthly - debtMin - extras;
  return <div className="space-y-6">
    {res.empty && <Card><p className="text-sm text-muted-foreground">There is no history yet to start from. Enter your monthly income and spending below to build a plan.</p></Card>}
    <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
      <Stat label={`Net worth in ${sc.months} months`} value={money(last?.netWorth ?? 0)} tone="#6366f1" />
      <Stat label="Debt left then" value={money(last?.debt ?? 0)} tone="#ef4444" />
      <Stat label="Debt-free" value={res.debtFree ?? (d.debts.length ? 'never at minimums' : '—')} tone="#10b981" />
      <Stat label="Interest saved vs minimums" value={money(res.interestSaved + res.feesSaved)} tone="#f59e0b" />
    </div>
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2" title="Projection" subtitle={`Today: cash ${money(d.cash)} · savings ${money(d.savings)} · debt ${money(d.debts.reduce((s: number, x: any) => s + x.balance, 0))}`}
        action={<Select className="h-8 w-28" value={sc.months} onChange={(e) => set({ months: Number(e.target.value) })}>{HORIZONS.map((h) => <option key={h} value={h}>{h} months</option>)}</Select>}>
        <div className="h-80"><ResponsiveContainer><ComposedChart data={chart}><CartesianGrid {...grid} /><XAxis dataKey="label" {...axis} /><YAxis {...axis} width={60} />
          <Tooltip {...tooltipStyle} formatter={(v: any) => money(Number(v))} /><Legend />
          <Line dataKey="netWorth" name="Net worth" stroke="#6366f1" strokeWidth={2.5} dot={false} />
          <Line dataKey="savings" name="Savings" stroke="#10b981" dot={false} />
          <Line dataKey="debt" name="Debt (−)" stroke="#ef4444" dot={false} />
          <Line dataKey="cash" name="Cash" stroke="#94a3b8" strokeDasharray="4 3" dot={false} /></ComposedChart></ResponsiveContainer></div>
        <div className={'mt-2 text-sm ' + (left < 0 ? 'text-red-500' : 'text-muted-foreground')}>Each month: income {money(incomeTotal)} − spending {money(sc.expenses)} − savings {money(sc.savingsMonthly)} − debt payments {money(debtMin + extras)} = <b className="num">{money(left, 'GEL', { sign: true })}</b>{left < 0 && ' — this plan spends more than comes in; cash goes negative.'}</div>
      </Card>
      <Card title="Your plan" subtitle={d.basedOn ? `Defaults = your average ${d.basedOn.from.slice(0, 7)} – ${d.basedOn.to.slice(0, 7)}` : undefined}
        action={<div className="flex gap-1"><Button size="sm" variant="outline" title="Back to defaults" onClick={() => post('/plan', { reset: true }).then((r: any) => { setRes(r); setSc(r.scenario); first.current = true; })}><RotateCcw className="h-3.5 w-3.5" /></Button>
          <Button size="sm" onClick={() => post('/plan', { scenario: sc, save: true }).then(() => setSaved('Saved'))}><Save className="h-3.5 w-3.5 mr-1" />{saved ?? 'Save'}</Button></div>}>
        <div className="space-y-3">
          <div className="text-xs font-medium text-muted-foreground">Monthly income</div>
          {sc.incomes.map((i: any, k: number) => <div key={k} className="flex gap-2">
            <Input className="flex-1" value={i.name} onChange={(e) => set({ incomes: sc.incomes.map((x: any, j: number) => j === k ? { ...x, name: e.target.value } : x) })} />
            <Input className="w-28 num" type="number" min={0} value={i.amount} onChange={(e) => set({ incomes: sc.incomes.map((x: any, j: number) => j === k ? { ...x, amount: num(e.target.value) } : x) })} />
            <Button size="icon" variant="ghost" onClick={() => set({ incomes: sc.incomes.filter((_: any, j: number) => j !== k) })}><Trash2 className="h-4 w-4" /></Button></div>)}
          <Button size="sm" variant="outline" onClick={() => set({ incomes: [...sc.incomes, { name: 'New income', amount: 0 }] })}><Plus className="h-3.5 w-3.5 mr-1" />Add income</Button>
          <Field label="Monthly spending (without loan payments)"><Input type="number" min={0} value={sc.expenses} onChange={(e) => set({ expenses: num(e.target.value) })} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Put in savings / month"><Input type="number" min={0} value={sc.savingsMonthly} onChange={(e) => set({ savingsMonthly: num(e.target.value) })} /></Field>
            <Field label="Savings interest % / year"><Input type="number" min={0} step="0.1" value={sc.savingsRatePct} onChange={(e) => set({ savingsRatePct: num(e.target.value) })} /></Field>
          </div>
        </div>
      </Card>
    </div>
    {d.debts.length > 0 && <Card title="Loans & cards" subtitle={`Interest to payoff: ${money(res.totalInterest)} (minimums only: ${money(res.baseline.totalInterest)}) · fees ${money(res.totalFees)}`}
      action={<div className="flex gap-2 items-center"><Select className="h-8 w-44" value={sc.strategy} onChange={(e) => set({ strategy: e.target.value })}>
        <option value="none">Extra per debt only</option><option value="avalanche">Avalanche (highest rate first)</option><option value="snowball">Snowball (smallest first)</option></Select>
        {sc.strategy !== 'none' && <Input className="h-8 w-28" type="number" min={0} title="Extra each month, sent in strategy order" placeholder="Extra / month" value={sc.extraPool} onChange={(e) => set({ extraPool: num(e.target.value) })} />}</div>}>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted-foreground"><th className="py-2">Debt</th><th className="text-right">Balance</th><th className="text-right">Rate</th><th className="text-right">Minimum</th><th className="text-right">Fee</th><th className="text-right">Overpay / month</th><th className="text-right">Paid off</th><th className="text-right">Interest</th></tr></thead>
        <tbody>{d.debts.map((x: any) => { const r = res.debts.find((y: any) => y.id === x.id); return <tr key={x.id} className="border-t">
          <td className="py-2">{x.name}</td><td className="text-right num">{money(x.balance)}</td><td className="text-right num">{x.annualRatePct}%</td><td className="text-right num">{money(x.minPayment)}</td><td className="text-right num">{x.monthlyFee ? money(x.monthlyFee) : '—'}</td>
          <td className="text-right"><Input className="h-8 w-24 ml-auto num" type="number" min={0} value={sc.debtExtra?.[x.id] ?? 0} onChange={(e) => set({ debtExtra: { ...sc.debtExtra, [x.id]: num(e.target.value) } })} /></td>
          <td className="text-right num">{r?.payoff ?? 'never'}</td><td className="text-right num">{money(r?.interest ?? 0)}</td></tr>; })}</tbody></table></div>
      {res.interestSaved > 0 && <p className="mt-3 text-sm text-emerald-600">Overpaying saves {money(res.interestSaved)} in interest{res.feesSaved > 0 ? ` and ${money(res.feesSaved)} in fees` : ''}{res.debtFree && res.baseline.payoffMonth ? `, debt-free ${res.baseline.payoffMonth - (res.debtFreeMonth ?? 0)} months sooner` : ''}.</p>}
    </Card>}
    <Card title="Month by month"><div className="overflow-x-auto max-h-96"><table className="w-full text-sm"><thead className="sticky top-0 bg-card"><tr className="text-left text-xs text-muted-foreground"><th className="py-2">Month</th><th className="text-right">Cash</th><th className="text-right">Savings</th><th className="text-right">Debt</th><th className="text-right">Interest</th><th className="text-right">Net worth</th></tr></thead>
      <tbody>{res.months.map((m: any) => <tr key={m.month} className="border-t"><td className="py-1.5">{m.label}</td><td className="text-right num">{money(m.cash)}</td><td className="text-right num">{money(m.savings)}</td><td className="text-right num">{money(m.debt)}</td><td className="text-right num">{money(m.interest)}</td><td className="text-right num font-medium">{money(m.netWorth)}</td></tr>)}</tbody></table></div></Card>
  </div>;
}
