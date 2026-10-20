import { useState } from 'react';
import { Wallet, CreditCard, Landmark, PiggyBank, Pencil, ArrowLeftRight } from 'lucide-react';
import { useT } from '../lib/i18n';
import { useAction } from '../lib/hooks';
import { del, post, put } from '../lib/api';
import { money, today } from '../lib/format';
import { Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner, Switch, cn } from '../components/ui';
import { AccountSelect, CurrencySelect, useAccounts, type Account } from '../components/pickers';
import { Link } from 'react-router-dom';

const ICON = { cash: Wallet, card: CreditCard, bank: Landmark, savings: PiggyBank } as Record<string, typeof Wallet>;
const COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f97316', '#ef4444', '#8b5cf6', '#ec4899', '#f59e0b', '#64748b', '#14b8a6'];

export default function Accounts() {
  const t = useT(); const d = useAccounts(); const { run, busy } = useAction();
  const [edit, setEdit] = useState<any>(null); const [transfer, setTransfer] = useState<any>(null);
  if (!d.data) return <Spinner />;
  const total = d.data.filter((a) => !a.archived).reduce((s, a) => s + a.balance_gel, 0);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); const { id, name, type, currency, opening_balance, color, bank, liquid, archived } = edit;
    const body = { name, type, currency, opening_balance: Number(opening_balance), color, bank, liquid: !!liquid, archived: !!archived };
    if (await run(() => (id ? put(`/accounts/${id}`, body) : post('/accounts', body)), t('common.saved'))) setEdit(null);
  };
  const doTransfer = async (e: React.FormEvent) => { e.preventDefault(); if (await run(() => post('/transactions', { kind: 'transfer', amount: Number(transfer.amount), currency: transfer.currency, date: transfer.date, account_id: transfer.from, to_account_id: transfer.to, description: transfer.description || 'Transfer', tags: [] }), t('common.saved'))) setTransfer(null); };
  return <div className="space-y-4">
    <PageHeader title={t('nav.accounts')} subtitle={<>{t('common.total')}: <b className="num">{money(total)}</b></>} actions={<><Button variant="outline" onClick={() => setTransfer({ amount: '', currency: 'GEL', date: today(), from: d.data![0]?.id, to: d.data![1]?.id, description: '' })} disabled={d.data.length < 2}><ArrowLeftRight className="h-4 w-4" />{t('acc.transfer')}</Button><Button onClick={() => setEdit({ name: '', type: 'card', currency: 'GEL', opening_balance: 0, color: COLORS[d.data!.length % COLORS.length], bank: '', liquid: true, archived: false })}>+ {t('acc.new')}</Button></>} />
    {!d.data.length ? <Card><Empty icon={<Wallet className="h-6 w-6" />} title={t('common.empty')}><Button onClick={() => setEdit({ name: 'Cash', type: 'cash', currency: 'GEL', opening_balance: 0, color: COLORS[0], liquid: true })}>+ {t('acc.new')}</Button></Empty></Card> :
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{d.data.map((a: Account) => { const I = ICON[a.type] ?? Wallet; return (
        <div key={a.id} className={cn('relative overflow-hidden rounded-2xl p-5 text-white shadow-lg', a.archived && 'opacity-50')} style={{ background: `linear-gradient(135deg, ${a.color}, ${a.color}bb)` }}>
          <div className="absolute -right-6 -top-6 h-28 w-28 rounded-full bg-white/10" /><div className="absolute -right-2 bottom-[-40px] h-28 w-28 rounded-full bg-white/10" />
          <div className="flex items-center justify-between relative"><div className="flex items-center gap-2"><I className="h-5 w-5" /><span className="text-sm opacity-90">{a.bank || t('acc.type.' + a.type)}</span></div>
            <button className="rounded-lg p-1.5 hover:bg-white/20" onClick={() => setEdit({ ...a })}><Pencil className="h-4 w-4" /></button></div>
          <div className="mt-6 text-2xl font-bold num relative">{money(a.balance, a.currency)}</div>
          {a.currency !== 'GEL' && <div className="text-xs opacity-80 num">≈ {money(a.balance_gel)}</div>}
          <div className="mt-2 flex items-center justify-between text-sm relative"><span className="font-medium">{a.name}</span><Link to={`/transactions?account_id=${a.id}`} className="text-xs underline opacity-90">→ {t('nav.transactions')}</Link></div>
        </div>); })}</div>}
    {edit && <Modal open onClose={() => setEdit(null)} title={edit.id ? t('common.edit') : t('acc.new')} footer={<>{edit.id && <Button variant="ghost" className="mr-auto text-danger" onClick={() => confirm(t('common.confirmDelete')) && run(() => del(`/accounts/${edit.id}`)).then(() => setEdit(null))}>{t('common.delete')}</Button>}<Button variant="outline" onClick={() => setEdit(null)}>{t('common.cancel')}</Button><Button form="accf" loading={busy}>{t('common.save')}</Button></>}>
      <form id="accf" onSubmit={save} className="space-y-4">
        <Field label={t('common.name')}><Input required value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label={t('common.type')}><Select value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value })}>{['cash', 'bank', 'card', 'savings'].map((x) => <option key={x} value={x}>{t('acc.type.' + x)}</option>)}</Select></Field>
          <Field label={t('common.currency')}><CurrencySelect value={edit.currency} onChange={(c) => setEdit({ ...edit, currency: c })} /></Field></div>
        <div className="grid grid-cols-2 gap-3"><Field label={t('acc.opening')}><Input type="number" step="0.01" value={edit.opening_balance} onChange={(e) => setEdit({ ...edit, opening_balance: e.target.value })} /></Field>
          <Field label={t('acc.bank')}><Input value={edit.bank ?? ''} onChange={(e) => setEdit({ ...edit, bank: e.target.value })} placeholder="TBC, Bank of Georgia…" /></Field></div>
        <Field label={t('cat.color')}><div className="flex gap-2 flex-wrap">{COLORS.map((c) => <button type="button" key={c} onClick={() => setEdit({ ...edit, color: c })} className={cn('h-8 w-8 rounded-full ring-offset-2 ring-offset-card', edit.color === c && 'ring-2 ring-foreground')} style={{ background: c }} />)}</div></Field>
        <Switch checked={!!edit.liquid} onChange={(v) => setEdit({ ...edit, liquid: v })} label={t('acc.liquid')} />
        <Switch checked={!!edit.archived} onChange={(v) => setEdit({ ...edit, archived: v })} label={t('acc.archived')} />
      </form></Modal>}
    {transfer && <Modal open onClose={() => setTransfer(null)} title={t('acc.transfer')} footer={<><Button variant="outline" onClick={() => setTransfer(null)}>{t('common.cancel')}</Button><Button form="trf" loading={busy}>{t('common.save')}</Button></>}>
      <form id="trf" onSubmit={doTransfer} className="space-y-4">
        <div className="grid grid-cols-2 gap-3"><Field label={t('common.from')}><AccountSelect allowEmpty={false} value={transfer.from} onChange={(v) => setTransfer({ ...transfer, from: v })} /></Field><Field label={t('common.to')}><AccountSelect allowEmpty={false} value={transfer.to} onChange={(v) => setTransfer({ ...transfer, to: v })} /></Field></div>
        <div className="grid grid-cols-3 gap-3"><Field label={t('common.amount')} className="col-span-2"><Input required type="number" step="0.01" min="0.01" value={transfer.amount} onChange={(e) => setTransfer({ ...transfer, amount: e.target.value })} /></Field><Field label={t('common.currency')}><CurrencySelect value={transfer.currency} onChange={(c) => setTransfer({ ...transfer, currency: c })} /></Field></div>
        <Field label={t('common.date')}><Input type="date" value={transfer.date} onChange={(e) => setTransfer({ ...transfer, date: e.target.value })} /></Field>
      </form></Modal>}
  </div>;
}
