import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Btn, Card, H2, Input, Loading, NumInput, Pick, Row, Stat, T, useColors } from '../ui';
import { LineChart } from '../charts';
import { api, money, post } from '../lapi';

const HORIZONS = [6, 12, 24, 36, 48, 60];
const num = (v: string) => (v === '' ? 0 : Math.max(0, Number(v) || 0));
export const RECON_LABELS: Record<string, string> = {
  income: 'Income', spending: 'Spending (rent, cash, fees…)', debt: 'Loan & card payments', people: 'Friends (sent − got back)',
  savings: 'Moved to savings', ownOther: 'Your accounts not in the app', unlinked: 'Not on any account',
};

/** Overview › where the money went: start balance, lines, end balance. */
export function ReconCard({ r }: { r: any }) {
  const c = useColors();
  if (!r || !r.accounts?.length) return null;
  return <Card><H2>Where the money went</H2>
    <Row title="Start balance" right={money(r.start)} />
    {r.lines.filter((l: any) => Math.abs(l.amount) >= 0.005).map((l: any) => <Row key={l.key} title={RECON_LABELS[l.key] ?? l.key} right={<T style={{ color: l.amount >= 0 ? c.success : c.danger }}>{(l.amount >= 0 ? '+' : '') + money(l.amount)}</T>} />)}
    {Math.abs(r.unexplained) >= 0.01 && <Row title="Not explained" right={money(r.unexplained)} />}
    <Row title="End balance" right={<T bold>{money(r.end)}</T>} rightSub={`change ${(r.change >= 0 ? '+' : '') + money(r.change)}`} />
    <T muted style={{ fontSize: 12 }}>{r.accounts.map((a: any) => `${a.name}: ${money(a.start)} → ${money(a.end)}`).join(' · ')}</T>
  </Card>;
}

/** Overview › Forecast: plan income, spending, savings and debt payoff. */
export function PlanForecastView() {
  const c = useColors();
  const [res, setRes] = useState<any>(null); const [sc, setSc] = useState<any>(null); const [msg, setMsg] = useState<string | null>(null);
  const first = useRef(true);
  useEffect(() => { api<any>('/plan').then((r) => { setRes(r); setSc(r.scenario); }).catch(() => undefined); }, []);
  useEffect(() => {
    if (!sc) return; if (first.current) { first.current = false; return; }
    const h = setTimeout(() => post<any>('/plan', { scenario: sc }).then(setRes).catch(() => undefined), 300);
    return () => clearTimeout(h);
  }, [sc]);
  if (!res || !sc) return <Loading />;
  const set = (p: any) => { setSc({ ...sc, ...p }); setMsg(null); };
  const d = res.defaults; const last = res.months[res.months.length - 1];
  const income = sc.incomes.reduce((s: number, i: any) => s + (Number(i.amount) || 0), 0);
  const debtMin = d.debts.reduce((s: number, x: any) => s + x.minPayment + x.monthlyFee, 0);
  const extras = Object.values(sc.debtExtra ?? {}).reduce((s: number, v: any) => s + (Number(v) || 0), 0) + (sc.strategy !== 'none' ? sc.extraPool : 0);
  const left = income - sc.expenses - sc.savingsMonthly - debtMin - extras;
  return <>
    {res.empty && <Card><T muted>No history yet — enter your monthly income and spending to build a plan.</T></Card>}
    <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
      <Stat label={`Net worth in ${sc.months}m`} value={money(last?.netWorth ?? 0)} tone={c.primary} />
      <Stat label="Debt-free" value={res.debtFree ?? (d.debts.length ? 'never' : '—')} tone={c.success} />
    </View>
    <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
      <Stat label="Debt left then" value={money(last?.debt ?? 0)} tone={c.danger} />
      <Stat label="Interest saved" value={money(res.interestSaved + res.feesSaved)} sub="vs minimums only" />
    </View>
    <Card><H2>Net worth</H2>
      <Pick value={sc.months} options={HORIZONS.map((h) => ({ value: h, label: `${h}m` }))} onChange={(v) => set({ months: v })} />
      <View style={{ height: 8 }} />
      <LineChart data={res.months} y="netWorth" label={(m) => m.label} />
      <T muted style={{ fontSize: 12, marginTop: 6 }}>Savings {money(last?.savings ?? 0)} · cash {money(last?.cash ?? 0)} · interest in period {money(res.horizonInterest)}</T>
      <T style={{ fontSize: 12, marginTop: 4, color: left < 0 ? c.danger : c.muted }}>Left each month: {money(left)}{left < 0 ? ' — spending more than comes in' : ''}</T>
    </Card>
    <Card><H2 right={<Btn small kind="ghost" title="Reset" onPress={() => post<any>('/plan', { reset: true }).then((r) => { first.current = true; setRes(r); setSc(r.scenario); })} />}>Your plan</H2>
      {d.basedOn && <T muted style={{ fontSize: 12 }}>Defaults = your average {d.basedOn.from.slice(0, 7)} – {d.basedOn.to.slice(0, 7)}</T>}
      {sc.incomes.map((i: any, k: number) => <View key={k} style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}><Input label={k === 0 ? 'Monthly income' : undefined} value={i.name} onChangeText={(v) => set({ incomes: sc.incomes.map((x: any, j: number) => j === k ? { ...x, name: v } : x) })} /></View>
        <View style={{ width: 100 }}><NumInput value={i.amount} onChange={(v) => set({ incomes: sc.incomes.map((x: any, j: number) => j === k ? { ...x, amount: num(v) } : x) })} /></View>
        <Btn small kind="ghost" title="✕" onPress={() => set({ incomes: sc.incomes.filter((_: any, j: number) => j !== k) })} /></View>)}
      <Btn small kind="outline" title="+ Add income" onPress={() => set({ incomes: [...sc.incomes, { name: 'New income', amount: 0 }] })} />
      <NumInput label="Monthly spending (without loan payments)" value={sc.expenses} onChange={(v) => set({ expenses: num(v) })} />
      <NumInput label="Put in savings / month" value={sc.savingsMonthly} onChange={(v) => set({ savingsMonthly: num(v) })} />
      <NumInput label="Savings interest % / year" value={sc.savingsRatePct} onChange={(v) => set({ savingsRatePct: num(v) })} />
      <Btn title={msg ?? 'Save plan'} onPress={() => post('/plan', { scenario: sc, save: true }).then(() => setMsg('Saved ✓'))} />
    </Card>
    {d.debts.length > 0 && <Card><H2>Loans & cards</H2>
      <T muted style={{ fontSize: 12 }}>Interest to payoff {money(res.totalInterest)} (minimums only {money(res.baseline.totalInterest)})</T>
      <Pick label="Extra money goes to" value={sc.strategy} options={[{ value: 'none', label: 'Per debt' }, { value: 'avalanche', label: 'Avalanche' }, { value: 'snowball', label: 'Snowball' }]} onChange={(v) => set({ strategy: v })} />
      {sc.strategy !== 'none' && <NumInput label={sc.strategy === 'avalanche' ? 'Extra / month (highest rate first)' : 'Extra / month (smallest balance first)'} value={sc.extraPool} onChange={(v) => set({ extraPool: num(v) })} />}
      {d.debts.map((x: any) => { const r = res.debts.find((y: any) => y.id === x.id); return <View key={x.id} style={{ paddingVertical: 6 }}>
        <Row title={x.name} sub={`${money(x.balance)} · ${x.annualRatePct}% · min ${money(x.minPayment)}${x.monthlyFee ? ` + fee ${money(x.monthlyFee)}` : ''}`} right={r?.payoff ?? 'never'} rightSub={`interest ${money(r?.interest ?? 0)}`} />
        <NumInput label="Overpay / month" value={sc.debtExtra?.[x.id] ?? 0} onChange={(v) => set({ debtExtra: { ...sc.debtExtra, [x.id]: num(v) } })} /></View>; })}
    </Card>}
    <Card><H2>Month by month</H2>{res.months.map((m: any) => <Row key={m.month} title={m.label} sub={`debt ${money(m.debt)} · savings ${money(m.savings)}`} right={money(m.netWorth)} />)}</Card>
  </>;
}
