import { useEffect, useState } from 'react';
import { useT } from '../lib/i18n';
import { post, put, del, get, qs } from '../lib/api';
import { useAction, useApi } from '../lib/hooks';
import { today, money } from '../lib/format';
import { Button, Field, Input, Modal, Switch, Tabs, Textarea } from './ui';
import { AccountSelect, CategorySelect, CurrencySelect, useAccounts } from './pickers';

export interface Tx { id?: number; kind: 'income' | 'expense' | 'transfer'; amount: number | string; currency: string; date: string; account_id: number | null; to_account_id?: number | null; category_id: number | null; description?: string | null; notes?: string | null; tags: string[]; rate?: number; rate_manual?: number | boolean; amount_gel?: number }

const blank = (): Tx => ({ kind: 'expense', amount: '', currency: 'GEL', date: today(), account_id: null, category_id: null, description: '', notes: '', tags: [] });

export default function TxDialog({ open, onClose, tx }: { open: boolean; onClose: () => void; tx?: Tx | null }) {
  const t = useT(); const { run, busy } = useAction();
  const [f, setF] = useState<Tx>(blank()); const [tagText, setTagText] = useState('');
  const accounts = useAccounts().data ?? [];
  const tags = useApi<string[]>('/tags').data ?? [];
  const [preview, setPreview] = useState<number | null>(null);
  useEffect(() => {
    if (!open) return;
    const base = tx ? { ...tx, tags: tx.tags ?? [] } : { ...blank(), account_id: accounts.find((a) => !a.archived)?.id ?? null };
    setF(base); setTagText((base.tags ?? []).join(', '));
  }, [open, tx]);
  useEffect(() => {
    if (!open || f.currency === 'GEL' || !Number(f.amount)) { setPreview(null); return; }
    if (f.rate_manual && f.rate) { setPreview(Number(f.amount) * Number(f.rate)); return; }
    const h = setTimeout(() => get(`/convert${qs({ amount: f.amount, from: f.currency, to: 'GEL', date: f.date })}`).then((r) => setPreview(r.result)).catch(() => setPreview(null)), 250);
    return () => clearTimeout(h);
  }, [open, f.amount, f.currency, f.date, f.rate_manual, f.rate]);
  const set = (p: Partial<Tx>) => setF((x) => ({ ...x, ...p }));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = { ...f, amount: Number(f.amount), tags: tagText.split(',').map((s) => s.trim()).filter(Boolean), rate_manual: !!f.rate_manual, rate: f.rate_manual ? Number(f.rate) : undefined,
      category_id: f.kind === 'transfer' ? null : f.category_id, to_account_id: f.kind === 'transfer' ? f.to_account_id : null };
    delete (body as any).id; delete (body as any).amount_gel;
    for (const k of Object.keys(body)) if (!['kind', 'amount', 'currency', 'date', 'account_id', 'to_account_id', 'category_id', 'description', 'notes', 'tags', 'rate', 'rate_manual'].includes(k)) delete (body as any)[k];
    const r = await run(() => (f.id ? put(`/transactions/${f.id}`, body) : post('/transactions', body)), t('common.saved'));
    if (r) onClose();
  };
  const remove = async () => { if (f.id && confirm(t('common.confirmDelete'))) { await run(() => del(`/transactions/${f.id}`), t('common.deleted')); onClose(); } };
  return (
    <Modal open={open} onClose={onClose} title={f.id ? t('tx.edit') : t('tx.new')}
      footer={<>{f.id && <Button type="button" variant="ghost" className="mr-auto text-danger" onClick={remove}>{t('common.delete')}</Button>}<Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button><Button form="txf" loading={busy}>{t('common.save')}</Button></>}>
      <form id="txf" onSubmit={save} className="space-y-4">
        <Tabs value={f.kind} onChange={(k) => set({ kind: k, category_id: null })} options={[{ value: 'expense', label: t('common.expense') }, { value: 'income', label: t('common.income') }, { value: 'transfer', label: t('common.transfer') }]} />
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('common.amount')} className="col-span-2"><Input autoFocus required type="number" step="0.01" min="0" value={f.amount} onChange={(e) => set({ amount: e.target.value })} className="text-lg font-semibold num" /></Field>
          <Field label={t('common.currency')}><CurrencySelect value={f.currency} onChange={(c) => set({ currency: c })} /></Field>
        </div>
        {f.currency !== 'GEL' && (
          <div className="rounded-lg bg-muted/60 p-3 space-y-2 text-xs">
            <div className="flex justify-between"><span className="text-muted-foreground">{t('tx.rateAuto')}</span>{preview != null && <b className="num">≈ {money(preview)}</b>}</div>
            <Switch checked={!!f.rate_manual} onChange={(v) => set({ rate_manual: v })} label={t('tx.rateManual')} />
            {f.rate_manual && <Input type="number" step="0.0001" placeholder={t('tx.rate')} value={f.rate ?? ''} onChange={(e) => set({ rate: Number(e.target.value) })} />}
          </div>)}
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('common.date')}><Input type="date" required value={f.date} onChange={(e) => set({ date: e.target.value })} /></Field>
          <Field label={t('common.account')}><AccountSelect value={f.account_id} onChange={(v) => set({ account_id: v })} /></Field>
        </div>
        {f.kind === 'transfer'
          ? <Field label={t('tx.toAccount')}><AccountSelect value={f.to_account_id} onChange={(v) => set({ to_account_id: v })} /></Field>
          : <Field label={t('common.category')}><CategorySelect kind={f.kind} value={f.category_id} onChange={(v) => set({ category_id: v })} /></Field>}
        <Field label={t('common.description')}><Input value={f.description ?? ''} onChange={(e) => set({ description: e.target.value })} placeholder="e.g. Carrefour, Netflix…" /></Field>
        <Field label={t('common.tags')} hint={tags.length ? tags.slice(0, 12).join(' · ') : undefined}><Input value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="food, family" list="tag-list" /></Field>
        <datalist id="tag-list">{tags.map((x) => <option key={x} value={x} />)}</datalist>
        <Field label={t('common.notes')}><Textarea value={f.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} /></Field>
      </form>
    </Modal>
  );
}
