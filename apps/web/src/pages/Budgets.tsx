import { useState } from 'react';
import { Pencil, PiggyBank, Target, ChevronLeft, ChevronRight } from 'lucide-react';
import { addMonths } from '@fa/core';
import { useT } from '../lib/i18n';
import { useApi, useAction } from '../lib/hooks';
import { del, post, put } from '../lib/api';
import { money, dateFmt, pct, today, monthFmt } from '../lib/format';
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Progress, Spinner, Switch, cn } from '../components/ui';
import { AccountSelect, CategorySelect } from '../components/pickers';
import { Icon } from '../components/Icon';

export default function Budgets() {
  const t = useT(); const [month, setMonth] = useState(today().slice(0, 7));
  const b = useApi<any[]>(`/budgets?month=${month}`); const g = useApi<any[]>('/goals'); const { run, busy } = useAction();
  const [eb, setEb] = useState<any>(null); const [eg, setEg] = useState<any>(null); const [contrib, setContrib] = useState<any>(null);
  if (!b.data || !g.data) return <Spinner />;
  const totLimit = b.data.reduce((s, x) => s + x.limit, 0), totSpent = b.data.reduce((s, x) => s + x.spent, 0);
  const saveB = async (e: React.FormEvent) => { e.preventDefault(); const body = { category_id: eb.category_id, amount: Number(eb.amount), rollover: !!eb.rollover }; if (await run(() => (eb.id ? put(`/budgets/${eb.id}`, body) : post('/budgets', body)), t('common.saved'))) setEb(null); };
  const saveG = async (e: React.FormEvent) => { e.preventDefault(); const body = { name: eg.name, target: Number(eg.target), saved: Number(eg.saved || 0), target_date: eg.target_date || null, color: eg.color, icon: eg.icon, account_id: eg.account_id }; if (await run(() => (eg.id ? put(`/goals/${eg.id}`, body) : post('/goals', body)), t('common.saved'))) setEg(null); };
  return <div className="space-y-8">
    <section className="space-y-4">
      <PageHeader title={t('bud.title')} subtitle={<span className="num">{money(totSpent)} / {money(totLimit)} ({pct(totLimit ? totSpent / totLimit : 0)})</span>} actions={<>
        <div className="flex items-center"><Button size="icon" variant="outline" onClick={() => setMonth(addMonths(month + '-01', -1).slice(0, 7))}><ChevronLeft className="h-4 w-4" /></Button><span className="w-32 text-center text-sm font-medium capitalize">{monthFmt(month, false)}</span><Button size="icon" variant="outline" onClick={() => setMonth(addMonths(month + '-01', 1).slice(0, 7))}><ChevronRight className="h-4 w-4" /></Button></div>
        <Button onClick={() => setEb({ category_id: null, amount: '', rollover: false })}>+ {t('bud.new')}</Button></>} />
      {!b.data.length ? <Card><Empty icon={<PiggyBank className="h-6 w-6" />} title={t('common.empty')} /></Card> :
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{b.data.map((x) => <Card key={x.id}>
          <div className="flex items-center gap-3"><span className="rounded-lg p-2" style={{ background: x.color + '22', color: x.color }}><Icon name={x.icon} className="h-4 w-4" /></span><span className="font-semibold flex-1">{x.name}</span>
            {x.pct >= 1 ? <Badge tone="danger">100%+</Badge> : x.pct >= 0.8 ? <Badge tone="warning">{pct(x.pct)}</Badge> : <Badge>{pct(x.pct)}</Badge>}
            <Button size="icon" variant="ghost" onClick={() => setEb({ ...x, rollover: !!x.rollover })}><Pencil className="h-4 w-4" /></Button></div>
          <div className="mt-4 flex items-baseline justify-between"><span className="text-xl font-semibold num">{money(x.spent)}</span><span className="text-sm text-muted-foreground num">/ {money(x.limit)}</span></div>
          <Progress value={x.pct} className="mt-2 h-2.5" />
          <div className="mt-2 flex justify-between text-xs"><span className={cn('num', x.remaining < 0 ? 'text-danger' : 'text-muted-foreground')}>{money(Math.abs(x.remaining))} {x.remaining < 0 ? t('bud.over') : t('bud.left')}</span>{x.carry > 0 && <span className="text-success">{t('bud.carry', { amount: money(x.carry) })}</span>}</div>
        </Card>)}</div>}
    </section>
    <section className="space-y-4">
      <PageHeader title={t('goal.title')} actions={<Button onClick={() => setEg({ name: '', target: '', saved: 0, target_date: '', color: '#10b981', icon: 'target', account_id: null })}>+ {t('goal.new')}</Button>} />
      {!g.data.length ? <Card><Empty icon={<Target className="h-6 w-6" />} title={t('common.empty')} /></Card> :
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{g.data.map((x) => <Card key={x.id}>
          <div className="flex items-center gap-3"><span className="rounded-xl p-2.5" style={{ background: x.color + '22', color: x.color }}><Icon name={x.icon} className="h-5 w-5" /></span><div className="flex-1"><div className="font-semibold">{x.name}</div><div className="text-xs text-muted-foreground">{x.target_date ? dateFmt(x.target_date) : '—'}</div></div>
            <Button size="icon" variant="ghost" onClick={() => setEg({ ...x })}><Pencil className="h-4 w-4" /></Button></div>
          <div className="mt-4 flex items-baseline justify-between"><span className="text-xl font-semibold num">{money(x.saved)}</span><span className="text-sm text-muted-foreground num">/ {money(x.target)}</span></div>
          <Progress value={x.pct} tone={x.color} className="mt-2 h-2.5" />
          <div className="mt-3 flex items-center justify-between text-sm">{x.pct >= 1 ? <span className="text-success font-medium">{t('goal.reached')}</span> : x.required_monthly != null ? <span><span className="text-muted-foreground text-xs">{t('goal.required')}: </span><b className="num">{money(x.required_monthly)}</b></span> : <span className="text-muted-foreground">{money(x.remaining)} {t('bud.left')}</span>}
            <Button size="sm" variant="outline" onClick={() => setContrib({ id: x.id, amount: '' })}>+ {t('goal.contribute')}</Button></div>
        </Card>)}</div>}
    </section>
    {eb && <Modal open onClose={() => setEb(null)} title={eb.id ? t('common.edit') : t('bud.new')} footer={<>{eb.id && <Button variant="ghost" className="mr-auto text-danger" onClick={() => run(() => del(`/budgets/${eb.id}`)).then(() => setEb(null))}>{t('common.delete')}</Button>}<Button variant="outline" onClick={() => setEb(null)}>{t('common.cancel')}</Button><Button form="bf" loading={busy}>{t('common.save')}</Button></>}>
      <form id="bf" onSubmit={saveB} className="space-y-4"><Field label={t('common.category')}><CategorySelect kind="expense" allowEmpty={false} value={eb.category_id} onChange={(v) => setEb({ ...eb, category_id: v })} /></Field>
        <Field label={t('bud.limit')}><Input required type="number" min="1" step="0.01" value={eb.amount} onChange={(e) => setEb({ ...eb, amount: e.target.value })} /></Field>
        <Switch checked={!!eb.rollover} onChange={(v) => setEb({ ...eb, rollover: v })} label={t('bud.rollover')} /></form></Modal>}
    {eg && <Modal open onClose={() => setEg(null)} title={eg.id ? t('common.edit') : t('goal.new')} footer={<>{eg.id && <Button variant="ghost" className="mr-auto text-danger" onClick={() => run(() => del(`/goals/${eg.id}`)).then(() => setEg(null))}>{t('common.delete')}</Button>}<Button variant="outline" onClick={() => setEg(null)}>{t('common.cancel')}</Button><Button form="gf" loading={busy}>{t('common.save')}</Button></>}>
      <form id="gf" onSubmit={saveG} className="grid grid-cols-2 gap-3"><Field label={t('common.name')} className="col-span-2"><Input required value={eg.name} onChange={(e) => setEg({ ...eg, name: e.target.value })} /></Field>
        <Field label={t('goal.target')}><Input required type="number" min="1" value={eg.target} onChange={(e) => setEg({ ...eg, target: e.target.value })} /></Field><Field label={t('goal.saved')}><Input type="number" min="0" value={eg.saved} onChange={(e) => setEg({ ...eg, saved: e.target.value })} /></Field>
        <Field label={t('goal.date')}><Input type="date" value={eg.target_date ?? ''} onChange={(e) => setEg({ ...eg, target_date: e.target.value })} /></Field><Field label={t('common.account')}><AccountSelect value={eg.account_id} onChange={(v) => setEg({ ...eg, account_id: v })} /></Field>
        <Field label={t('cat.icon')} className="col-span-2"><div className="flex gap-1">{['target', 'shield', 'plane', 'car', 'home', 'graduation-cap', 'gift', 'laptop', 'baby', 'piggy-bank'].map((i) => <button type="button" key={i} onClick={() => setEg({ ...eg, icon: i })} className={cn('rounded-lg p-2 border', eg.icon === i ? 'border-primary bg-primary/10' : 'border-transparent')}><Icon name={i} className="h-4 w-4" /></button>)}</div></Field>
        <Field label={t('cat.color')} className="col-span-2"><div className="flex gap-1.5">{['#10b981', '#0ea5e9', '#6366f1', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6'].map((c) => <button type="button" key={c} onClick={() => setEg({ ...eg, color: c })} className={cn('h-7 w-7 rounded-full', eg.color === c && 'ring-2 ring-offset-2 ring-foreground ring-offset-card')} style={{ background: c }} />)}</div></Field></form></Modal>}
    {contrib && <Modal open onClose={() => setContrib(null)} title={t('goal.contribute')} footer={<Button loading={busy} onClick={() => run(() => post(`/goals/${contrib.id}/contribute`, { amount: Number(contrib.amount) }), t('common.saved')).then(() => setContrib(null))}>{t('common.save')}</Button>}>
      <Field label={t('common.amount')} hint="Use a negative number to withdraw"><Input autoFocus type="number" value={contrib.amount} onChange={(e) => setContrib({ ...contrib, amount: e.target.value })} /></Field></Modal>}
  </div>;
}
