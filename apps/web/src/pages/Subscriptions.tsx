import { useState } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, Pencil, Copy, Clock, Check, TrendingUp } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { addMonths, addDays, startOfMonth, endOfMonth } from '@fa/core';
import { useT } from '../lib/i18n';
import { useApi, useAction } from '../lib/hooks';
import { del, post, put, qs } from '../lib/api';
import { money, dateFmt, today, monthFmt } from '../lib/format';
import { MarkOverdueButton } from '../components/OverdueBills';
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Spinner, Stat, Switch, Tabs, cn, th, td } from '../components/ui';
import { AccountSelect, CategorySelect, CurrencySelect } from '../components/pickers';
import { IntervalPicker, useIntervalLabel } from './Recurring';
import { axis, grid, tooltipStyle } from '../components/shared';

export default function Subscriptions() {
  const t = useT(); const label = useIntervalLabel();
  const d = useApi<any>('/subscriptions'); const { run } = useAction();
  const [edit, setEdit] = useState<any>(null); const [tab, setTab] = useState<'list' | 'calendar' | 'utilities'>('list');
  if (!d.data) return <Spinner />;
  const items = d.data.items as any[];
  return <div className="space-y-6">
    <PageHeader title={t('sub.title')} actions={<><MarkOverdueButton /><Button onClick={() => setEdit({ name: '', kind: 'subscription', amount: '', currency: 'GEL', unit: 'month', interval: 1, start_date: today(), category_id: null, account_id: null, provider: '', last_used: null, variable: false, active: true })}>+ {t('sub.new')}</Button></>} />
    <div className="grid gap-4 sm:grid-cols-3">
      <Stat label={`${t('common.monthly')} (${t('common.all').toLowerCase()})`} value={money(d.data.totals.monthly)} icon={<CalendarClock className="h-4 w-4" />} />
      <Stat label={`${t('common.yearly')}`} value={money(d.data.totals.yearly)} tone="#f59e0b" />
      <Stat label={`${t('sub.kind.subscription')} / ${t('common.month').toLowerCase()}`} value={money(d.data.totals.subscriptionsMonthly)} tone="#a855f7" />
    </div>
    <Tabs value={tab} onChange={setTab} options={[{ value: 'list', label: t('sub.list') }, { value: 'calendar', label: t('sub.calendar') }, { value: 'utilities', label: t('sub.utilities') }]} />
    {tab === 'list' && (!items.length ? <Card><Empty icon={<CalendarClock className="h-6 w-6" />} title={t('common.empty')} /></Card> :
      <Card className="p-0"><div className="-m-5 overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted/40 border-b"><tr><th className={th}>{t('common.name')}</th><th className={th}>{t('sub.cycle')}</th><th className={th}>{t('sub.next')}</th><th className={cn(th, 'text-right')}>{t('common.amount')}</th><th className={cn(th, 'text-right')}>{t('common.monthly')}</th><th className={cn(th, 'text-right')}>{t('common.yearly')}</th><th className={th}></th></tr></thead>
        <tbody>{items.map((s) => <tr key={s.id} className={cn('border-b last:border-0 hover:bg-muted/30', !s.active && 'opacity-50')}>
          <td className={td}><div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: s.category_color ?? '#94a3b8' }} /><span className="font-medium">{s.name}</span>
            <Badge tone={s.kind === 'bill' ? 'info' : 'primary'}>{t('sub.kind.' + s.kind)}</Badge>
            {s.unused && <Badge tone="warning"><Clock className="h-3 w-3" />{t('sub.unused')}</Badge>}{s.duplicate && <Badge tone="danger"><Copy className="h-3 w-3" />{t('sub.duplicate')}</Badge>}</div>
            {s.unused && <div className="text-[11px] text-warning mt-0.5">{t('sub.cancelHint')}</div>}{s.kind === 'subscription' && <div className="text-[11px] text-muted-foreground">{t('sub.lastUsed')}: {dateFmt(s.last_used)}</div>}</td>
          <td className={cn(td, 'text-muted-foreground')}>{label(s.unit, s.interval)}</td><td className={td}>{dateFmt(s.next_charge)}</td>
          <td className={cn(td, 'text-right num')}>{s.variable ? '~' : ''}{money(s.amount, s.currency)}</td><td className={cn(td, 'text-right num')}>{money(s.monthly_gel)}</td><td className={cn(td, 'text-right num font-medium')}>{money(s.yearly_gel)}</td>
          <td className={cn(td, 'text-right whitespace-nowrap')}>{s.kind === 'subscription' && <Button size="sm" variant="ghost" title={t('sub.markUsed')} onClick={() => run(() => post(`/subscriptions/${s.id}/used`), '✓')}><Check className="h-4 w-4" /></Button>}<Button size="icon" variant="ghost" onClick={() => setEdit({ ...s, variable: !!s.variable, active: !!s.active })}><Pencil className="h-4 w-4" /></Button></td>
        </tr>)}</tbody></table></div></Card>)}
    {tab === 'calendar' && <BillCalendar />}
    {tab === 'utilities' && <Utilities />}
    {edit && <SubDialog item={edit} onClose={() => setEdit(null)} />}
  </div>;
}

function SubDialog({ item, onClose }: { item: any; onClose: () => void }) {
  const t = useT(); const { run, busy } = useAction(); const [f, setF] = useState(item); const set = (p: any) => setF({ ...f, ...p });
  const save = async (e: React.FormEvent) => { e.preventDefault();
    const body = { name: f.name, kind: f.kind, amount: Number(f.amount), currency: f.currency, unit: f.unit, interval: Number(f.interval), start_date: f.start_date, category_id: f.category_id, account_id: f.account_id, provider: f.provider || null, last_used: f.last_used || null, variable: !!f.variable, active: !!f.active, notes: f.notes ?? null };
    if (await run(() => (f.id ? put(`/subscriptions/${f.id}`, body) : post('/subscriptions', body)), t('common.saved'))) onClose(); };
  return <Modal open onClose={onClose} title={f.id ? t('common.edit') : t('sub.new')} footer={<>{f.id && <Button variant="ghost" className="mr-auto text-danger" onClick={() => confirm(t('common.confirmDelete')) && run(() => del(`/subscriptions/${f.id}`)).then(onClose)}>{t('common.delete')}</Button>}<Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button><Button form="subf" loading={busy}>{t('common.save')}</Button></>}>
    <form id="subf" onSubmit={save} className="space-y-4">
      <Tabs value={f.kind} onChange={(k) => set({ kind: k })} options={[{ value: 'subscription', label: t('sub.kind.subscription') }, { value: 'bill', label: t('sub.kind.bill') }]} />
      <div className="grid grid-cols-2 gap-3"><Field label={t('common.name')}><Input required value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder={f.kind === 'bill' ? 'Electricity – Telasi' : 'Netflix'} /></Field><Field label={t('sub.provider')}><Input value={f.provider ?? ''} onChange={(e) => set({ provider: e.target.value })} /></Field></div>
      <div className="grid grid-cols-3 gap-3"><Field label={t('common.amount')} className="col-span-2"><Input required type="number" step="0.01" min="0" value={f.amount} onChange={(e) => set({ amount: e.target.value })} /></Field><Field label={t('common.currency')}><CurrencySelect value={f.currency} onChange={(c) => set({ currency: c })} /></Field></div>
      <IntervalPicker unit={f.unit} interval={f.interval} onChange={(unit, interval) => set({ unit, interval })} />
      <div className="grid grid-cols-2 gap-3"><Field label={t('loan.start')}><Input type="date" required value={f.start_date} onChange={(e) => set({ start_date: e.target.value })} /></Field>
        {f.kind === 'subscription' && <Field label={t('sub.lastUsed')}><Input type="date" value={f.last_used ?? ''} onChange={(e) => set({ last_used: e.target.value })} /></Field>}</div>
      <div className="grid grid-cols-2 gap-3"><Field label={t('common.category')}><CategorySelect kind="expense" value={f.category_id} onChange={(v) => set({ category_id: v })} /></Field><Field label={t('common.account')}><AccountSelect value={f.account_id} onChange={(v) => set({ account_id: v })} /></Field></div>
      {f.kind === 'bill' && <Switch checked={!!f.variable} onChange={(v) => set({ variable: v })} label={t('sub.variable')} />}
      <Switch checked={!!f.active} onChange={(v) => set({ active: v })} label={t('common.active')} />
    </form></Modal>;
}

function BillCalendar() {
  const t = useT(); const { run } = useAction();
  const [month, setMonth] = useState(startOfMonth(today()));
  const bills = useApi<any[]>(`/bills${qs({ from: month, to: endOfMonth(month) })}`);
  const [pay, setPay] = useState<any>(null);
  const first = (new Date(month + 'T00:00:00').getDay() + 6) % 7;
  const days = Number(endOfMonth(month).slice(8));
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => addDays(month, i))];
  const list = bills.data ?? [];
  const unpaid = list.filter((b) => !b.paid).reduce((s, b) => s + (b.amount_gel ?? b.amount), 0);
  return <Card title={<div className="flex items-center gap-2"><Button size="icon" variant="ghost" onClick={() => setMonth(addMonths(month, -1))}><ChevronLeft className="h-4 w-4" /></Button><span className="w-40 text-center capitalize">{monthFmt(month.slice(0, 7), false)}</span><Button size="icon" variant="ghost" onClick={() => setMonth(addMonths(month, 1))}><ChevronRight className="h-4 w-4" /></Button></div>}
    action={<div className="text-sm text-right"><div className="text-muted-foreground text-xs">{t('common.unpaid')}</div><b className="num">{money(unpaid)}</b></div>}>
    <div className="grid grid-cols-7 gap-1 text-[11px] text-muted-foreground mb-1">{['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => <div key={d} className="text-center">{d}</div>)}</div>
    <div className="grid grid-cols-7 gap-1">{cells.map((d, i) => d === null ? <div key={i} /> : <div key={d} className={cn('min-h-[92px] rounded-lg border p-1.5 text-xs', d === today() && 'border-primary bg-primary/5')}>
      <div className="font-semibold mb-1">{Number(d.slice(8))}</div>
      <div className="space-y-1">{list.filter((b) => b.due_date === d).map((b) => { const overdue = !b.paid && d < today(); return (
        <button key={b.id} onClick={() => (b.paid ? run(() => post(`/bills/${b.id}/unpay`), t('common.unpaid')) : setPay({ ...b, payAmount: b.amount }))} title={b.paid ? t('sub.unpay') : t('sub.pay')}
          className={cn('w-full text-left rounded px-1.5 py-1 leading-tight transition hover:opacity-80', b.paid ? 'bg-success/15 text-success line-through decoration-1' : overdue ? 'bg-danger/15 text-danger' : 'bg-warning/15 text-warning')}>
          <div className="truncate font-medium">{b.paid ? '✓ ' : ''}{b.name}</div><div className="num">{money(b.amount, b.currency, { decimals: 0 })}</div></button>); })}</div>
    </div>)}</div>
    <div className="flex gap-4 mt-3 text-[11px] text-muted-foreground"><span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-success/40" />{t('common.paid')}</span><span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-warning/40" />{t('common.unpaid')}</span><span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-danger/40" />{t('common.overdue')}</span></div>
    {pay && <Modal open onClose={() => setPay(null)} title={`${t('sub.pay')}: ${pay.name}`} footer={<><Button variant="outline" onClick={() => setPay(null)}>{t('common.cancel')}</Button><Button onClick={() => run(() => post(`/bills/${pay.id}/pay`, { amount: Number(pay.payAmount), date: pay.payDate || (pay.due_date < today() ? pay.due_date : today()) }), t('common.paid')).then(() => setPay(null))}>{t('sub.pay')}</Button></>}>
      <div className="grid grid-cols-2 gap-3"><Field label={t('sub.payAmount')}><Input type="number" step="0.01" value={pay.payAmount} onChange={(e) => setPay({ ...pay, payAmount: e.target.value })} /></Field><Field label={t('common.date')}><Input type="date" value={pay.payDate ?? (pay.due_date < today() ? pay.due_date : today())} onChange={(e) => setPay({ ...pay, payDate: e.target.value })} /></Field></div>
    </Modal>}
  </Card>;
}

function Utilities() {
  const t = useT(); const d = useApi<any>('/utilities');
  if (!d.data) return <Spinner />;
  const cats = d.data.categories.filter((c: any) => c.key !== 'utilities');
  return <div className="space-y-4">
    {d.data.jumps.map((j: any) => <div key={j.key} className="flex items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm"><TrendingUp className="h-5 w-5 text-warning" />{t('sub.jump', { name: j.name, pct: j.pct, usual: money(j.usual) })} — <b className="num">{money(j.amount)}</b> ({monthFmt(j.month, false)})</div>)}
    <Card title={t('sub.utilities')}><div className="h-80"><ResponsiveContainer><BarChart data={d.data.months}>
      <CartesianGrid {...grid} /><XAxis dataKey="month" {...axis} tickFormatter={(v) => monthFmt(v)} /><YAxis {...axis} tickFormatter={(v) => money(v, 'GEL', { compact: true })} width={55} /><Tooltip {...tooltipStyle} formatter={(v: number) => money(v)} labelFormatter={(l) => monthFmt(l, false)} /><Legend />
      {cats.map((c: any) => <Bar key={c.key} dataKey={c.key} name={c.name} stackId="u" fill={c.color} />)}
    </BarChart></ResponsiveContainer></div></Card>
    <Card className="p-0"><div className="-m-5 overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted/40"><tr><th className={th}>{t('common.month')}</th>{cats.map((c: any) => <th key={c.key} className={cn(th, 'text-right')}>{c.name}</th>)}<th className={cn(th, 'text-right')}>{t('common.total')}</th></tr></thead>
      <tbody>{[...d.data.months].reverse().map((m: any) => <tr key={m.month} className="border-t num"><td className={td}>{monthFmt(m.month, false)}</td>{cats.map((c: any) => <td key={c.key} className={cn(td, 'text-right')}>{m[c.key] ? money(m[c.key]) : '—'}</td>)}<td className={cn(td, 'text-right font-semibold')}>{money(cats.reduce((s: number, c: any) => s + (m[c.key] || 0), 0))}</td></tr>)}</tbody></table></div></Card>
  </div>;
}
