import { useEffect, useState } from 'react';
import { Landmark, Pencil, Calculator, TableProperties } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Line, ComposedChart, Area, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell, PieChart, Pie } from 'recharts';
import { useT } from '../lib/i18n';
import { useApi, useAction } from '../lib/hooks';
import { del, get, post, put } from '../lib/api';
import { money, dateFmt, pct, today, monthFmt } from '../lib/format';
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Progress, Spinner, Stat, cn, th, td } from '../components/ui';
import { AccountSelect, CurrencySelect } from '../components/pickers';
import { axis, grid, tooltipStyle, CHART_COLORS } from '../components/shared';

export default function Loans() {
  const t = useT();
  const loans = useApi<any[]>('/loans'); const ov = useApi<any>('/loans/overview');
  const [edit, setEdit] = useState<any>(null); const [sched, setSched] = useState<any>(null); const [calc, setCalc] = useState(false);
  if (!loans.data || !ov.data) return <Spinner />;
  return <div className="space-y-6">
    <PageHeader title={t('loan.title')} actions={<><Button variant="outline" onClick={() => setCalc(true)}><Calculator className="h-4 w-4" />{t('loan.calculator')}</Button><Button onClick={() => setEdit({ name: '', bank: '', principal: '', currency: 'GEL', annual_rate: '', term_months: 24, start_date: today(), extra_monthly: 0, account_id: null, active: true })}>+ {t('loan.new')}</Button></>} />
    <div className="grid gap-4 sm:grid-cols-3">
      <Stat label={t('loan.totalDebt')} value={money(ov.data.totalDebt)} icon={<Landmark className="h-4 w-4" />} tone="#ef4444" />
      <Stat label={t('loan.monthly')} value={money(ov.data.monthly)} tone="#f59e0b" />
      <Stat label={t('loan.payoff')} value={ov.data.lastPayoff ? dateFmt(ov.data.lastPayoff) : '—'} tone="#10b981" />
    </div>
    {ov.data.byBank.length > 0 && <Card title={t('loan.byBank')}><div className="grid md:grid-cols-2 gap-6 items-center">
      <div className="h-52"><ResponsiveContainer><PieChart><Pie data={ov.data.byBank} dataKey="remaining_gel" nameKey="bank" innerRadius={50} outerRadius={85} stroke="none">{ov.data.byBank.map((_: any, i: number) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}</Pie><Tooltip {...tooltipStyle} formatter={(v: number) => money(v)} /></PieChart></ResponsiveContainer></div>
      <table className="text-sm w-full"><thead><tr><th className={th}>{t('loan.bank')}</th><th className={cn(th, 'text-right')}>{t('loan.remaining')}</th><th className={cn(th, 'text-right')}>{t('loan.monthly')}</th></tr></thead>
        <tbody>{ov.data.byBank.map((b: any, i: number) => <tr key={b.bank} className="border-t"><td className={td}><span className="inline-block h-2.5 w-2.5 rounded-full mr-2" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />{b.bank} <span className="text-muted-foreground text-xs">×{b.count}</span></td><td className={cn(td, 'text-right num')}>{money(b.remaining_gel)}</td><td className={cn(td, 'text-right num')}>{money(b.monthly_gel)}</td></tr>)}</tbody></table>
    </div></Card>}
    {!loans.data.length ? <Card><Empty icon={<Landmark className="h-6 w-6" />} title={t('common.empty')} /></Card> :
      <div className="grid gap-4 lg:grid-cols-2">{loans.data.map((l) => { const progress = l.paid_count / Math.max(1, l.paid_count + l.months_left); return (
        <Card key={l.id} className={cn(!l.active && 'opacity-60')}>
          <div className="flex items-start gap-3"><div className="rounded-xl bg-danger/10 text-danger p-2.5"><Landmark className="h-5 w-5" /></div>
            <div className="flex-1"><div className="font-semibold">{l.name}</div><div className="text-xs text-muted-foreground">{l.bank} · {l.annual_rate}% · {l.term_months} {t('unit.month')}</div></div>
            <Button variant="ghost" size="icon" onClick={() => setEdit({ ...l, active: !!l.active })}><Pencil className="h-4 w-4" /></Button></div>
          <div className="grid grid-cols-3 gap-3 mt-4 text-sm">
            <div><div className="text-xs text-muted-foreground">{t('loan.remaining')}</div><div className="font-semibold num">{money(l.remaining, l.currency)}</div></div>
            <div><div className="text-xs text-muted-foreground">{t('loan.monthly')}</div><div className="font-semibold num">{money(l.monthly_payment + l.extra_monthly, l.currency)}</div></div>
            <div><div className="text-xs text-muted-foreground">{t('loan.payoff')}</div><div className="font-semibold">{dateFmt(l.payoff_date, { month: 'short', year: 'numeric' })}</div></div>
          </div>
          <div className="mt-4"><Progress value={progress} tone="hsl(var(--success))" /><div className="flex justify-between text-[11px] text-muted-foreground mt-1"><span>{t('loan.paidOf', { paid: l.paid_count, total: l.paid_count + l.months_left })}</span><span>{pct(progress)}</span></div></div>
          {l.next_payment && <div className="mt-3 text-xs flex items-center gap-2"><Badge tone="warning">{t('common.next')}: {dateFmt(l.next_payment.date)}</Badge><span className="text-muted-foreground num">{t('loan.interest')} {money(l.next_payment.interest, l.currency)} · {t('loan.principalPart')} {money(l.next_payment.principal, l.currency)}</span></div>}
          <div className="mt-4 flex gap-2"><Button size="sm" variant="outline" onClick={() => setSched(l)}><TableProperties className="h-4 w-4" />{t('loan.schedule')}</Button></div>
        </Card>); })}</div>}
    {edit && <LoanDialog loan={edit} onClose={() => setEdit(null)} />}
    {sched && <ScheduleDialog loan={sched} onClose={() => setSched(null)} />}
    {calc && <CalcDialog onClose={() => setCalc(false)} />}
  </div>;
}

function LoanDialog({ loan, onClose }: { loan: any; onClose: () => void }) {
  const t = useT(); const { run, busy } = useAction(); const [f, setF] = useState(loan);
  const set = (p: any) => setF({ ...f, ...p });
  const save = async (e: React.FormEvent) => { e.preventDefault();
    const body = { name: f.name, bank: f.bank, principal: Number(f.principal), currency: f.currency, annual_rate: Number(f.annual_rate), term_months: Number(f.term_months), start_date: f.start_date, extra_monthly: Number(f.extra_monthly || 0), account_id: f.account_id, notes: f.notes ?? null, active: !!f.active };
    if (await run(() => (f.id ? put(`/loans/${f.id}`, body) : post('/loans', body)), t('common.saved'))) onClose(); };
  return <Modal open onClose={onClose} title={f.id ? t('common.edit') : t('loan.new')} footer={<>{f.id && <Button variant="ghost" className="mr-auto text-danger" onClick={() => confirm(t('common.confirmDelete')) && run(() => del(`/loans/${f.id}`)).then(onClose)}>{t('common.delete')}</Button>}<Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button><Button form="loanf" loading={busy}>{t('common.save')}</Button></>}>
    <form id="loanf" onSubmit={save} className="grid grid-cols-2 gap-3">
      <Field label={t('common.name')}><Input required value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Car loan" /></Field>
      <Field label={t('loan.bank')}><Input required value={f.bank} onChange={(e) => set({ bank: e.target.value })} placeholder="TBC Bank" list="banks" /></Field>
      <datalist id="banks">{['TBC Bank', 'Bank of Georgia', 'Liberty Bank', 'ProCredit Bank', 'Basisbank', 'Credo Bank', 'Tera Bank', 'Space Bank', 'Halyk Bank'].map((b) => <option key={b} value={b} />)}</datalist>
      <Field label={t('loan.principal')}><Input required type="number" step="0.01" min="1" value={f.principal} onChange={(e) => set({ principal: e.target.value })} /></Field>
      <Field label={t('common.currency')}><CurrencySelect value={f.currency} onChange={(c) => set({ currency: c })} /></Field>
      <Field label={t('loan.rate')}><Input required type="number" step="0.01" min="0" value={f.annual_rate} onChange={(e) => set({ annual_rate: e.target.value })} /></Field>
      <Field label={t('loan.term')}><Input required type="number" min="1" value={f.term_months} onChange={(e) => set({ term_months: e.target.value })} /></Field>
      <Field label={t('loan.start')}><Input required type="date" value={f.start_date} onChange={(e) => set({ start_date: e.target.value })} /></Field>
      <Field label={t('loan.extra')}><Input type="number" step="0.01" min="0" value={f.extra_monthly} onChange={(e) => set({ extra_monthly: e.target.value })} /></Field>
      <Field label={t('common.account')} className="col-span-2"><AccountSelect value={f.account_id} onChange={(v) => set({ account_id: v })} /></Field>
    </form></Modal>;
}

function ScheduleView({ data, currency = 'GEL' }: { data: any; currency?: string }) {
  const t = useT();
  const rows = data.schedule.rows as any[];
  return <div className="space-y-4">
    {data.interestSaved > 0 && <div className="rounded-xl bg-success/10 text-success p-4 font-medium">{t('loan.saved', { amount: money(data.interestSaved, currency), months: data.monthsSaved })}</div>}
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
      <Mini l={t('loan.monthly')} v={money(data.schedule.monthlyPayment, currency)} /><Mini l={t('loan.totalInterest')} v={money(data.schedule.totalInterest, currency)} />
      <Mini l={t('common.total')} v={money(data.schedule.totalPaid, currency)} /><Mini l={t('loan.payoff')} v={dateFmt(data.schedule.payoffDate)} />
    </div>
    <div className="h-56"><ResponsiveContainer><ComposedChart data={rows}>
      <CartesianGrid {...grid} /><XAxis dataKey="date" {...axis} tickFormatter={(v) => monthFmt(v.slice(0, 7))} minTickGap={30} /><YAxis yAxisId="a" {...axis} tickFormatter={(v) => money(v, currency, { compact: true })} width={60} /><YAxis yAxisId="b" orientation="right" {...axis} tickFormatter={(v) => money(v, currency, { compact: true })} width={60} />
      <Tooltip {...tooltipStyle} formatter={(v: number) => money(v, currency)} /><Legend />
      <Bar yAxisId="a" dataKey="principal" stackId="p" fill="#6366f1" name={t('loan.principalPart')} /><Bar yAxisId="a" dataKey="interest" stackId="p" fill="#ef4444" name={t('loan.interest')} /><Bar yAxisId="a" dataKey="extra" stackId="p" fill="#10b981" name="Extra" />
      <Area yAxisId="b" dataKey="balance" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.1} name={t('common.balance')} />
    </ComposedChart></ResponsiveContainer></div>
    <div className="max-h-80 overflow-y-auto rounded-lg border"><table className="w-full text-sm"><thead className="bg-muted/60 sticky top-0"><tr><th className={th}>#</th><th className={th}>{t('common.date')}</th><th className={cn(th, 'text-right')}>{t('loan.monthly')}</th><th className={cn(th, 'text-right')}>{t('loan.interest')}</th><th className={cn(th, 'text-right')}>{t('loan.principalPart')}</th><th className={cn(th, 'text-right')}>Extra</th><th className={cn(th, 'text-right')}>{t('loan.remaining')}</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.n} className={cn('border-t num', r.date < today() && 'text-muted-foreground')}><td className={td}>{r.n}</td><td className={td}>{dateFmt(r.date)}</td><td className={cn(td, 'text-right')}>{money(r.payment, currency)}</td><td className={cn(td, 'text-right text-danger')}>{money(r.interest, currency)}</td><td className={cn(td, 'text-right')}>{money(r.principal, currency)}</td><td className={cn(td, 'text-right text-success')}>{r.extra ? money(r.extra, currency) : ''}</td><td className={cn(td, 'text-right font-medium')}>{money(r.balance, currency)}</td></tr>)}</tbody></table></div>
  </div>;
}
const Mini = ({ l, v }: { l: string; v: string }) => <div className="rounded-lg bg-muted/50 p-3"><div className="text-[11px] text-muted-foreground">{l}</div><div className="font-semibold num">{v}</div></div>;

function ScheduleDialog({ loan, onClose }: { loan: any; onClose: () => void }) {
  const t = useT(); const [extra, setExtra] = useState(String(loan.extra_monthly || '')); const [data, setData] = useState<any>(null);
  useEffect(() => { const h = setTimeout(() => get(`/loans/${loan.id}/schedule?extra=${Number(extra) || 0}`).then(setData), 250); return () => clearTimeout(h); }, [extra, loan.id]);
  return <Modal open wide onClose={onClose} title={`${t('loan.schedule')} · ${loan.bank} ${loan.name}`}>
    <Field label={t('loan.extra')} className="max-w-xs mb-4"><Input type="number" min="0" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="0" /></Field>
    {data ? <ScheduleView data={data} currency={loan.currency} /> : <Spinner />}
  </Modal>;
}
function CalcDialog({ onClose }: { onClose: () => void }) {
  const t = useT(); const [f, setF] = useState({ principal: '10000', annual_rate: '14', term_months: '36', extra_monthly: '100' }); const [data, setData] = useState<any>(null);
  useEffect(() => { const h = setTimeout(() => { if (Number(f.principal) > 0 && Number(f.term_months) > 0) post('/loans/calculate', { principal: Number(f.principal), annual_rate: Number(f.annual_rate), term_months: Number(f.term_months), extra_monthly: Number(f.extra_monthly) }).then(setData).catch(() => undefined); }, 250); return () => clearTimeout(h); }, [f]);
  return <Modal open wide onClose={onClose} title={t('loan.calculator')}>
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">{([['principal', 'loan.principal'], ['annual_rate', 'loan.rate'], ['term_months', 'loan.term'], ['extra_monthly', 'loan.extra']] as const).map(([k, l]) => <Field key={k} label={t(l)}><Input type="number" min="0" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>)}</div>
    {data ? <ScheduleView data={data} /> : <Spinner />}
  </Modal>;
}
void BarChart; void Line;
