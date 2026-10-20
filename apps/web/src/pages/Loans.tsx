import { useEffect, useState } from 'react';
import { Landmark, Pencil, Calculator, TableProperties, CreditCard, RefreshCw, AlertTriangle, Undo2 } from 'lucide-react';
import { monthlyPayment, termForPayment, addMonths } from '@fa/core';
import { Bar, BarChart, CartesianGrid, Line, ComposedChart, Area, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell, PieChart, Pie } from 'recharts';
import { useT } from '../lib/i18n';
import { useApi, useAction } from '../lib/hooks';
import { del, get, post, put } from '../lib/api';
import { money, dateFmt, pct, today, monthFmt } from '../lib/format';
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Progress, Select, Spinner, Stat, cn, th, td } from '../components/ui';
import { AccountSelect, CurrencySelect } from '../components/pickers';
import { axis, grid, tooltipStyle, CHART_COLORS } from '../components/shared';

export default function Loans() {
  const t = useT();
  const loans = useApi<any[]>('/loans'); const ov = useApi<any>('/loans/overview');
  const [edit, setEdit] = useState<any>(null); const [upd, setUpd] = useState<any>(null); const [sched, setSched] = useState<any>(null); const [calc, setCalc] = useState(false);
  if (!loans.data || !ov.data) return <Spinner />;
  return <div className="space-y-6">
    <PageHeader title={t('loan.title')} actions={<><Button variant="outline" onClick={() => setCalc(true)}><Calculator className="h-4 w-4" />{t('loan.calculator')}</Button><Button onClick={() => setEdit({ kind: 'loan', monthly_payment: null, name: '', bank: '', principal: '', currency: 'GEL', annual_rate: '', term_months: 24, start_date: today(), extra_monthly: 0, account_id: null, active: true })}>+ {t('loan.new')}</Button></>} />
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
      <div className="grid gap-4 lg:grid-cols-2">{loans.data.map((l) => <LoanCard key={l.id} l={l} onEdit={() => setEdit({ ...l, active: !!l.active })} onUpdate={() => setUpd(l)} onSchedule={() => setSched(l)} />)}</div>}
    {edit && <LoanDialog loan={edit} onClose={() => setEdit(null)} />}
    {upd && <UpdateDialog loan={upd} onClose={() => setUpd(null)} />}
    {sched && <ScheduleDialog loan={sched} onClose={() => setSched(null)} />}
    {calc && <CalcDialog onClose={() => setCalc(false)} />}
  </div>;
}

const REVOLVING = ['credit_card', 'overdraft', 'credit_line'];
const KINDS = ['loan', 'mortgage', 'installment', 'credit_card', 'overdraft', 'credit_line', 'other'];
const r2 = (x: number) => Math.round(x * 100) / 100;

function LoanCard({ l, onEdit, onUpdate, onSchedule }: { l: any; onEdit: () => void; onUpdate: () => void; onSchedule: () => void }) {
  const t = useT();
  const progress = l.paid_count / Math.max(1, l.paid_count + l.months_left);
  const Icon = l.revolving ? CreditCard : Landmark;
  const sub = l.revolving
    ? [l.bank, `${l.annual_rate}%`, l.monthly_payment_override ? null : l.payment_pct ? `${l.payment_pct}%` : l.term_months ? `${l.term_months} ${t('unit.month')}` : t('lx.noTerm'), l.due_day ? `${t('lx.dueDay')}: ${l.due_day}` : null]
    : [l.bank, `${l.annual_rate}%`, l.monthly_payment_override ? null : `${l.term_months} ${t('unit.month')}`];
  return <Card className={cn(!l.active && 'opacity-60', l.needs_input && 'ring-2 ring-warning/60')}>
    <div className="flex items-start gap-3"><div className={cn('rounded-xl p-2.5', l.revolving ? 'bg-primary/10 text-primary' : 'bg-danger/10 text-danger')}><Icon className="h-5 w-5" /></div>
      <div className="flex-1 min-w-0"><div className="font-semibold flex items-center gap-2 flex-wrap">{l.name}{l.kind && l.kind !== 'loan' && <Badge>{t(`lx.kind.${l.kind}`)}</Badge>}{l.needs_input && <Badge tone="warning"><AlertTriangle className="h-3 w-3 mr-1 inline" />{t('lx.needsInput')}</Badge>}</div>
        <div className="text-xs text-muted-foreground">{sub.filter(Boolean).join(' · ')}{l.monthly_payment_override ? <> · {t('lx.payment')} <span className="font-medium">{t('lx.pinned')}</span></> : null}</div></div>
      <Button variant="ghost" size="icon" onClick={onEdit} title={t('common.edit')}><Pencil className="h-4 w-4" /></Button></div>
    {l.needs_input && <div className="mt-3 rounded-lg bg-warning/10 text-sm p-3 flex items-center gap-3"><span className="flex-1">{t('lx.needsInputHint')}</span><Button size="sm" onClick={onUpdate}>{t('lx.enterPayment')}</Button></div>}
    <div className="grid grid-cols-3 gap-3 mt-4 text-sm">
      <div><div className="text-xs text-muted-foreground">{l.revolving ? t('lx.balance') : t('loan.remaining')}</div><div className="font-semibold num">{money(l.remaining, l.currency)}</div></div>
      <div><div className="text-xs text-muted-foreground">{t('loan.monthly')}</div><div className={cn('font-semibold num', l.needs_input && 'text-warning')}>{l.needs_input ? '—' : money(l.monthly_total || l.monthly_payment, l.currency)}</div>{l.monthly_fee > 0 && !l.needs_input && <div className="text-[10px] text-muted-foreground">{t('lx.inclFee', { fee: money(l.monthly_fee, l.currency) })}</div>}</div>
      <div><div className="text-xs text-muted-foreground">{l.revolving ? t('lx.payoffEst') : t('loan.payoff')}</div><div className={cn('font-semibold', l.never_pays_off && 'text-danger text-xs')}>{l.never_pays_off ? t('lx.never') : l.needs_input || !l.payoff_date ? '—' : dateFmt(l.payoff_date, { month: 'short', year: 'numeric' })}</div></div>
    </div>
    {l.revolving && l.credit_limit ? <div className="mt-4"><Progress value={l.utilization ?? 0} /><div className="flex justify-between text-[11px] text-muted-foreground mt-1"><span>{t('lx.utilization')} {pct(l.utilization ?? 0)} · {t('lx.limit')} {money(l.credit_limit, l.currency)}</span><span>{money(l.available ?? 0, l.currency)} {t('lx.available')}</span></div></div>
      : !l.revolving && <div className="mt-4"><Progress value={progress} tone="hsl(var(--success))" /><div className="flex justify-between text-[11px] text-muted-foreground mt-1"><span>{t('loan.paidOf', { paid: l.paid_count, total: l.paid_count + l.months_left })}</span><span>{pct(progress)}</span></div></div>}
    {l.next_payment && <div className="mt-3 text-xs flex items-center gap-2 flex-wrap"><Badge tone="warning">{t('common.next')}: {dateFmt(l.next_payment.date)}</Badge><span className="text-muted-foreground num">{t('loan.interest')} {money(l.next_payment.interest, l.currency)} · {t('loan.principalPart')} {money(l.next_payment.principal, l.currency)}</span></div>}
    <div className="mt-4 flex gap-2"><Button size="sm" variant="outline" onClick={onUpdate}><RefreshCw className="h-4 w-4" />{t('lx.update')}</Button>{!l.needs_input && <Button size="sm" variant="outline" onClick={onSchedule}><TableProperties className="h-4 w-4" />{t('loan.schedule')}</Button>}</div>
  </Card>;
}

/** Term ⇄ payment, linked both ways. The field the user edited last is "pinned" and drives the schedule. */
function useLinkedTerm(init: { principal: number; rate: number; term: number; payment: number | null }) {
  const [pin, setPin] = useState<'term' | 'payment'>(init.payment ? 'payment' : 'term');
  const [term, setTerm] = useState(init.term ? String(init.term) : '');
  const [payment, setPayment] = useState(init.payment ? String(init.payment) : '');
  const derive = (P: number, rate: number, p = pin, tm = term, pay = payment) => {
    if (!(P > 0)) return;
    if (p === 'term' && Number(tm) > 0) setPayment(String(r2(monthlyPayment(P, rate, Number(tm)))));
    if (p === 'payment' && Number(pay) > 0) { const n = termForPayment(P, rate, Number(pay)); setTerm(Number.isFinite(n) ? String(n) : ''); }
  };
  return { pin, term, payment, derive,
    onTerm: (v: string, P: number, rate: number) => { setTerm(v); setPin('term'); derive(P, rate, 'term', v, payment); },
    onPayment: (v: string, P: number, rate: number) => { setPayment(v); setPin('payment'); derive(P, rate, 'payment', term, v); } };
}

function LoanDialog({ loan, onClose }: { loan: any; onClose: () => void }) {
  const t = useT(); const { run, busy } = useAction(); const [f, setF] = useState({ kind: 'loan', ...loan });
  const set = (p: any) => setF({ ...f, ...p });
  const revolving = REVOLVING.includes(f.kind);
  const lk = useLinkedTerm({ principal: Number(f.principal), rate: Number(f.annual_rate || 0), term: Number(f.term_months) || 0, payment: f.monthly_payment_override ?? f.monthly_payment ?? null });
  const [mode, setMode] = useState<'fixed' | 'pct' | 'term'>(f.payment_pct ? 'pct' : (f.monthly_payment_override ?? f.monthly_payment) ? 'fixed' : Number(f.term_months) > 0 ? 'term' : 'fixed');
  const P = Number(f.principal), rate = Number(f.annual_rate || 0);
  const setNum = (p: any) => { const nf = { ...f, ...p }; setF(nf); lk.derive(Number(nf.principal), Number(nf.annual_rate || 0)); };
  const termN = Number(lk.term), payN = Number(lk.payment);
  const never = lk.pin === 'payment' && payN > 0 && !Number.isFinite(termForPayment(P, rate, payN));
  const save = async (e: React.FormEvent) => { e.preventDefault();
    const pctMode = revolving && mode === 'pct';
    const payPinned = !pctMode && lk.pin === 'payment' && payN > 0;
    const body = { kind: f.kind, name: f.name, bank: f.bank, principal: P, currency: f.currency, annual_rate: rate,
      monthly_payment: payPinned ? payN : null,
      term_months: pctMode ? 0 : payPinned ? (revolving ? 0 : Math.max(1, Math.min(600, Number.isFinite(termN) && termN > 0 ? termN : Number(f.term_months) || 1))) : Math.max(revolving ? 0 : 1, termN || 0),
      payment_pct: pctMode ? Number(f.payment_pct) || null : null, min_payment: pctMode ? Number(f.min_payment) || null : null,
      credit_limit: revolving ? (Number(f.credit_limit) || null) : null, due_day: revolving ? (Number(f.due_day) || null) : null,
      start_date: f.start_date, extra_monthly: Number(f.extra_monthly || 0), monthly_fee: Number(f.monthly_fee || 0), account_id: f.account_id, notes: f.notes ?? null, active: !!f.active };
    if (await run(() => (f.id ? put(`/loans/${f.id}`, body) : post('/loans', body)), t('common.saved'))) onClose(); };
  const payoff = termN > 0 && f.start_date ? addMonths(f.start_date, termN - 1) : null;
  const linked = <>
    <Field label={<>{t('loan.term')}{lk.pin === 'term' && <Badge tone="primary" className="ml-2">{t('lx.pinned')}</Badge>}</>}><Input type="number" min="1" max="600" value={lk.term} onChange={(e) => lk.onTerm(e.target.value, P, rate)} required={lk.pin === 'term'} /></Field>
    <Field label={<>{t('lx.payment')}{lk.pin === 'payment' && <Badge tone="primary" className="ml-2">{t('lx.pinned')}</Badge>}</>}><Input type="number" step="0.01" min="0.01" value={lk.payment} onChange={(e) => lk.onPayment(e.target.value, P, rate)} required={lk.pin === 'payment'} /></Field>
    <p className="col-span-2 text-xs text-muted-foreground -mt-1">{t('lx.linked')}{payoff && !never && <> · {t('loan.payoff')}: <span className="font-medium text-foreground">{dateFmt(payoff, { month: 'short', year: 'numeric' })}</span></>}{never && <span className="text-danger"> · {t('lx.never')}</span>}</p>
  </>;
  return <Modal open onClose={onClose} title={f.id ? t('common.edit') : t('loan.new')} footer={<>{f.id && <Button variant="ghost" className="mr-auto text-danger" onClick={() => confirm(t('common.confirmDelete')) && run(() => del(`/loans/${f.id}`)).then(onClose)}>{t('common.delete')}</Button>}<Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button><Button form="loanf" loading={busy}>{t('common.save')}</Button></>}>
    <form id="loanf" onSubmit={save} className="grid grid-cols-2 gap-3">
      {f.needs_input && <div className="col-span-2 rounded-lg bg-warning/10 text-sm p-3">{t('lx.needsInputHint')}</div>}
      <Field label={t('lx.kind')}><Select value={f.kind} onChange={(e) => set({ kind: e.target.value })}>{KINDS.map((k) => <option key={k} value={k}>{t(`lx.kind.${k}`)}</option>)}</Select></Field>
      <Field label={t('common.name')}><Input required value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder={revolving ? 'Credit card' : 'Car loan'} /></Field>
      <Field label={t('loan.bank')}><Input required value={f.bank} onChange={(e) => set({ bank: e.target.value })} placeholder="TBC Bank" list="banks" /></Field>
      <datalist id="banks">{['TBC Bank', 'Bank of Georgia', 'Liberty Bank', 'ProCredit Bank', 'Basisbank', 'Credo Bank', 'Tera Bank', 'Space Bank', 'Halyk Bank'].map((b) => <option key={b} value={b} />)}</datalist>
      <Field label={t('common.currency')}><CurrencySelect value={f.currency} onChange={(c) => set({ currency: c })} /></Field>
      <Field label={revolving ? t('lx.balance') : t('loan.principal')}><Input required type="number" step="0.01" min="0" value={f.principal} onChange={(e) => setNum({ principal: e.target.value })} /></Field>
      <Field label={t('loan.rate')}><Input required type="number" step="0.01" min="0" value={f.annual_rate} onChange={(e) => setNum({ annual_rate: e.target.value })} /></Field>
      {revolving && <>
        <Field label={t('lx.limit')}><Input type="number" step="0.01" min="0" value={f.credit_limit ?? ''} onChange={(e) => set({ credit_limit: e.target.value })} /></Field>
        <Field label={t('lx.dueDay')}><Input type="number" min="1" max="31" value={f.due_day ?? ''} onChange={(e) => set({ due_day: e.target.value })} /></Field>
        <div className="col-span-2 space-y-1.5"><span className="text-xs font-medium text-muted-foreground">{t('lx.mode')}</span><div className="flex gap-2 flex-wrap">{(['fixed', 'pct', 'term'] as const).map((m) => <Button key={m} type="button" size="sm" variant={mode === m ? 'primary' : 'outline'} onClick={() => { setMode(m); if (m === 'term') lk.onTerm(lk.term, P, rate); if (m === 'fixed') lk.onPayment(lk.payment, P, rate); }}>{t(`lx.mode.${m}`)}</Button>)}</div></div>
        {mode === 'pct' ? <>
          <Field label={t('lx.pct')}><Input required type="number" step="0.1" min="0.1" max="100" value={f.payment_pct ?? ''} onChange={(e) => set({ payment_pct: e.target.value })} /></Field>
          <Field label={t('lx.minPay')}><Input type="number" step="0.01" min="0" value={f.min_payment ?? ''} onChange={(e) => set({ min_payment: e.target.value })} /></Field>
        </> : linked}
      </>}
      {!revolving && linked}
      <Field label={revolving ? t('common.next') : t('loan.start')}><Input required type="date" value={f.start_date} onChange={(e) => set({ start_date: e.target.value })} /></Field>
      <Field label={t('loan.extra')}><Input type="number" step="0.01" min="0" value={f.extra_monthly} onChange={(e) => set({ extra_monthly: e.target.value })} /></Field>
      <Field label={t('lx.fee')} hint={t('lx.feeHint')}><Input type="number" step="0.01" min="0" value={f.monthly_fee ?? ''} onChange={(e) => set({ monthly_fee: e.target.value })} placeholder="0" /></Field>
      <Field label={t('common.account')}><AccountSelect value={f.account_id} onChange={(v) => set({ account_id: v })} /></Field>
    </form></Modal>;
}

/** Quick update: today's balance and/or a new payment; keeps a history that can be undone. */
function UpdateDialog({ loan, onClose }: { loan: any; onClose: () => void }) {
  const t = useT(); const { run, busy } = useAction();
  const hist = useApi<any[]>(`/loans/${loan.id}/updates`);
  const [f, setF] = useState({ date: today(), balance: String(loan.remaining ?? ''), monthly_payment: String(loan.monthly_payment_override ?? (loan.needs_input ? '' : loan.monthly_payment ?? '')), annual_rate: String(loan.annual_rate ?? 0), due_day: String(loan.due_day ?? ''), note: '' });
  const set = (p: any) => setF({ ...f, ...p });
  const bal = Number(f.balance), pay = Number(f.monthly_payment), rate = Number(f.annual_rate || 0);
  const n = pay > 0 && bal > 0 ? termForPayment(bal, rate, pay) : null;
  const save = async (e: React.FormEvent) => { e.preventDefault();
    const body: any = { date: f.date, balance: bal, annual_rate: rate, note: f.note || null };
    if (pay > 0) body.monthly_payment = pay;
    if (loan.revolving && f.due_day) body.due_day = Number(f.due_day);
    if (await run(() => post(`/loans/${loan.id}/update`, body), t('lx.updated'))) onClose(); };
  return <Modal open onClose={onClose} title={`${t('lx.updateTitle')} · ${loan.name}`} footer={<><Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button><Button form="loanu" loading={busy}>{t('common.save')}</Button></>}>
    <form id="loanu" onSubmit={save} className="grid grid-cols-2 gap-3">
      {loan.needs_input && <div className="col-span-2 rounded-lg bg-warning/10 text-sm p-3">{t('lx.needsInputHint')}</div>}
      <Field label={t('lx.asOf')}><Input type="date" required value={f.date} onChange={(e) => set({ date: e.target.value })} /></Field>
      <Field label={t('lx.balance')}><Input type="number" step="0.01" min="0" required value={f.balance} onChange={(e) => set({ balance: e.target.value })} /></Field>
      <Field label={t('lx.payment')}><Input type="number" step="0.01" min="0.01" required={loan.needs_input} value={f.monthly_payment} onChange={(e) => set({ monthly_payment: e.target.value })} className={cn(loan.needs_input && !pay && 'ring-2 ring-warning')} /></Field>
      <Field label={t('loan.rate')}><Input type="number" step="0.01" min="0" value={f.annual_rate} onChange={(e) => set({ annual_rate: e.target.value })} /></Field>
      {loan.revolving && <Field label={t('lx.dueDay')}><Input type="number" min="1" max="31" value={f.due_day} onChange={(e) => set({ due_day: e.target.value })} /></Field>}
      <Field label={t('lx.note')} className={loan.revolving ? '' : 'col-span-2'}><Input value={f.note} onChange={(e) => set({ note: e.target.value })} /></Field>
      {n != null && <p className="col-span-2 text-xs text-muted-foreground">{Number.isFinite(n) ? <>{t('lx.payoffEst')}: <span className="font-medium text-foreground">{n} {t('unit.month')} · {dateFmt(addMonths(f.date, n), { month: 'short', year: 'numeric' })}</span></> : <span className="text-danger">{t('lx.never')}</span>}</p>}
    </form>
    <div className="mt-5"><div className="text-sm font-semibold mb-2">{t('lx.history')}</div>
      {!hist.data ? <Spinner /> : !hist.data.length ? <p className="text-sm text-muted-foreground">{t('lx.noHistory')}</p> :
        <div className="rounded-lg border divide-y text-sm">{hist.data.map((h, i) => <div key={h.id} className="flex items-center gap-3 p-2.5">
          <div className="flex-1 min-w-0"><div className="font-medium">{dateFmt(h.date)} · {money(h.balance, loan.currency)}{h.monthly_payment ? <> · {money(h.monthly_payment, loan.currency)}/{t('unit.month')}</> : null}</div>
            <div className="text-xs text-muted-foreground truncate">{money(h.prev.principal, loan.currency)}{h.prev.monthly_payment ? ` · ${money(h.prev.monthly_payment, loan.currency)}` : ''} → {h.note ?? ''}</div></div>
          {i === 0 && <Button size="sm" variant="ghost" onClick={() => run(() => post(`/loan-updates/${h.id}/undo`), t('lx.undo')).then(onClose)}><Undo2 className="h-4 w-4" />{t('lx.undo')}</Button>}
        </div>)}</div>}
    </div>
  </Modal>;
}

function ScheduleView({ data, currency = 'GEL' }: { data: any; currency?: string }) {
  const t = useT();
  const rows = data.schedule.rows as any[];
  return <div className="space-y-4">
    {data.interestSaved > 0 && <div className="rounded-xl bg-success/10 text-success p-4 font-medium">{t('loan.saved', { amount: money(data.interestSaved, currency), months: data.monthsSaved })}</div>}
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
      <Mini l={t('loan.monthly')} v={money(data.schedule.monthlyPayment + (data.fee ?? 0), currency)} /><Mini l={t('loan.totalInterest')} v={money(data.schedule.totalInterest, currency)} />
      <Mini l={t('common.total')} v={money(data.schedule.totalPaid, currency)} /><Mini l={t('loan.payoff')} v={dateFmt(data.schedule.payoffDate)} />
    </div>
    <div className="h-56"><ResponsiveContainer><ComposedChart data={rows}>
      <CartesianGrid {...grid} /><XAxis dataKey="date" {...axis} tickFormatter={(v) => monthFmt(v.slice(0, 7))} minTickGap={30} /><YAxis yAxisId="a" {...axis} tickFormatter={(v) => money(v, currency, { compact: true })} width={60} /><YAxis yAxisId="b" orientation="right" {...axis} tickFormatter={(v) => money(v, currency, { compact: true })} width={60} />
      <Tooltip {...tooltipStyle} formatter={(v: number) => money(v, currency)} /><Legend />
      <Bar yAxisId="a" dataKey="principal" stackId="p" fill="#6366f1" name={t('loan.principalPart')} /><Bar yAxisId="a" dataKey="interest" stackId="p" fill="#ef4444" name={t('loan.interest')} /><Bar yAxisId="a" dataKey="extra" stackId="p" fill="#10b981" name="Extra" />
      <Area yAxisId="b" dataKey="balance" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.1} name={t('common.balance')} />
    </ComposedChart></ResponsiveContainer></div>
    <div className="max-h-80 overflow-y-auto rounded-lg border"><table className="w-full text-sm"><thead className="bg-muted/60 sticky top-0"><tr><th className={th}>#</th><th className={th}>{t('common.date')}</th><th className={cn(th, 'text-right')}>{t('loan.monthly')}</th><th className={cn(th, 'text-right')}>{t('loan.interest')}</th><th className={cn(th, 'text-right')}>{t('loan.principalPart')}</th><th className={cn(th, 'text-right')}>Extra</th>{data.fee > 0 && <th className={cn(th, 'text-right')}>{t('lx.fee')}</th>}<th className={cn(th, 'text-right')}>{t('loan.remaining')}</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.n} className={cn('border-t num', r.date < today() && 'text-muted-foreground')}><td className={td}>{r.n}</td><td className={td}>{dateFmt(r.date)}</td><td className={cn(td, 'text-right')}>{money(r.payment, currency)}</td><td className={cn(td, 'text-right text-danger')}>{money(r.interest, currency)}</td><td className={cn(td, 'text-right')}>{money(r.principal, currency)}</td><td className={cn(td, 'text-right text-success')}>{r.extra ? money(r.extra, currency) : ''}</td>{data.fee > 0 && <td className={cn(td, 'text-right')}>{money(data.fee, currency)}</td>}<td className={cn(td, 'text-right font-medium')}>{money(r.balance, currency)}</td></tr>)}</tbody></table></div>
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
