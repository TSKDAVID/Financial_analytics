import { useEffect, useState } from 'react';
import { Repeat, Pencil } from 'lucide-react';
import { useT } from '../lib/i18n';
import { useApi, useAction } from '../lib/hooks';
import { del, post, put } from '../lib/api';
import { money, dateFmt, today } from '../lib/format';
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner, Switch, Tabs, cn } from '../components/ui';
import { AccountSelect, CategorySelect, CurrencySelect, UnitSelect } from '../components/pickers';
import { perMonthFactor, PRESETS } from '@fa/core';

export function presetOf(unit: string, interval: number) { return Object.entries(PRESETS).find(([, p]) => p.unit === unit && p.interval === interval)?.[0] ?? 'custom'; }
export function useIntervalLabel() { const t = useT(); return (unit: string, interval: number) => { const p = presetOf(unit, interval); return p !== 'custom' ? t('preset.' + p) : `${t('common.every')} ${interval} ${t('unit.' + unit)}`; }; }

export function IntervalPicker({ unit, interval, onChange }: { unit: string; interval: number; onChange: (unit: string, interval: number) => void }) {
  const t = useT(); const [custom, setCustom] = useState(presetOf(unit, interval) === 'custom');
  const preset = custom ? 'custom' : presetOf(unit, interval);
  return <div className="grid grid-cols-2 gap-3">
    <Field label={t('rec.preset')}><Select value={preset} onChange={(e) => { if (e.target.value === 'custom') setCustom(true); else { setCustom(false); const p = PRESETS[e.target.value]; onChange(p.unit, p.interval); } }}>
      {Object.keys(PRESETS).map((k) => <option key={k} value={k}>{t('preset.' + k)}</option>)}<option value="custom">{t('preset.custom')}</option></Select></Field>
    {preset === 'custom' && <Field label={t('rec.customN')}><div className="flex gap-2"><Input type="number" min={1} className="w-20" value={interval} onChange={(e) => onChange(unit, Math.max(1, Number(e.target.value)))} /><UnitSelect value={unit} onChange={(u) => onChange(u, interval)} /></div></Field>}
  </div>;
}

const blank = () => ({ kind: 'income', name: '', amount: '' as any, currency: 'GEL', account_id: null, category_id: null, notes: '', tags: [], unit: 'month', interval: 1, start_date: today(), end_date: null, count: null, auto_post: true, active: true });

export default function Recurring() {
  const t = useT(); const label = useIntervalLabel();
  const d = useApi<any[]>('/recurring');
  const [edit, setEdit] = useState<any>(null);
  const { run } = useAction();
  if (!d.data) return <Spinner />;
  const monthly = (k: string) => d.data!.filter((r) => r.active && r.kind === k).reduce((s, r) => s + r.amount * perMonthFactor(r.unit, r.interval), 0);
  return <div className="space-y-4">
    <PageHeader title={t('rec.title')} subtitle={<span className="num">{t('common.income')} ≈ <b className="text-success">{money(monthly('income'))}</b> / {t('common.month').toLowerCase()} · {t('common.expense')} ≈ <b className="text-danger">{money(monthly('expense'))}</b></span>} actions={<Button onClick={() => setEdit(blank())}>+ {t('rec.new')}</Button>} />
    {!d.data.length ? <Card><Empty icon={<Repeat className="h-6 w-6" />} title={t('common.empty')} /></Card> :
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{d.data.map((r) => <Card key={r.id} className={cn(!r.active && 'opacity-60')}>
        <div className="flex items-start gap-3">
          <div className={cn('rounded-xl p-2.5', r.kind === 'income' ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger')}><Repeat className="h-5 w-5" /></div>
          <div className="flex-1 min-w-0"><div className="font-semibold truncate">{r.name}</div><div className="text-xs text-muted-foreground">{label(r.unit, r.interval)} · {r.category_name ?? '—'} · {r.account_name ?? '—'}</div></div>
          <Button variant="ghost" size="icon" onClick={() => setEdit({ ...r, auto_post: !!r.auto_post, active: !!r.active })}><Pencil className="h-4 w-4" /></Button>
        </div>
        <div className={cn('mt-3 text-xl font-semibold num', r.kind === 'income' ? 'text-success' : '')}>{r.kind === 'income' ? '+' : '−'}{money(r.amount, r.currency)}</div>
        <div className="mt-2 flex flex-wrap gap-1">{r.next.slice(0, 3).map((n: string) => <Badge key={n}>{dateFmt(n, { day: 'numeric', month: 'short' })}</Badge>)}{!r.active && <Badge tone="warning">paused</Badge>}{r.end_date && <Badge tone="info">→ {dateFmt(r.end_date)}</Badge>}{r.count && <Badge tone="info">×{r.count}</Badge>}</div>
        <div className="mt-3 flex gap-2"><Button size="sm" variant="outline" onClick={() => run(() => put(`/recurring/${r.id}`, { active: !r.active }))}>{r.active ? '⏸' : '▶'}</Button></div>
      </Card>)}</div>}
    <RecurringDialog item={edit} onClose={() => setEdit(null)} onDelete={(id) => run(() => del(`/recurring/${id}`), t('common.deleted')).then(() => setEdit(null))} />
  </div>;
}

function RecurringDialog({ item, onClose, onDelete }: { item: any; onClose: () => void; onDelete: (id: number) => void }) {
  const t = useT(); const { run, busy } = useAction();
  const [f, setF] = useState<any>(item ?? blank()); const [preview, setPreview] = useState<string[]>([]);
  const [endType, setEndType] = useState<'never' | 'date' | 'count'>('never');
  useEffect(() => { if (item) { setF(item); setEndType(item.end_date ? 'date' : item.count ? 'count' : 'never'); } }, [item]);
  useEffect(() => { if (!item || !f.start_date) return; post<string[]>('/recurring/preview', { unit: f.unit, interval: f.interval, start_date: f.start_date, end_date: endType === 'date' ? f.end_date : null, count: endType === 'count' ? f.count : null }).then(setPreview).catch(() => setPreview([])); }, [f.unit, f.interval, f.start_date, f.end_date, f.count, endType, item]);
  if (!item) return null;
  const set = (p: any) => setF({ ...f, ...p });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = { kind: f.kind, name: f.name, amount: Number(f.amount), currency: f.currency, account_id: f.account_id, category_id: f.category_id, notes: f.notes, tags: f.tags, unit: f.unit, interval: Number(f.interval), start_date: f.start_date, end_date: endType === 'date' ? f.end_date : null, count: endType === 'count' ? Number(f.count) : null, auto_post: f.auto_post, active: f.active };
    if (await run(() => (f.id ? put(`/recurring/${f.id}`, body) : post('/recurring', body)), t('common.saved'))) onClose();
  };
  return <Modal open onClose={onClose} title={f.id ? t('common.edit') : t('rec.new')} footer={<>{f.id && <Button variant="ghost" className="mr-auto text-danger" onClick={() => confirm(t('common.confirmDelete')) && onDelete(f.id)}>{t('common.delete')}</Button>}<Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button><Button form="recf" loading={busy}>{t('common.save')}</Button></>}>
    <form id="recf" onSubmit={save} className="space-y-4">
      <Tabs value={f.kind} onChange={(k) => set({ kind: k, category_id: null })} options={[{ value: 'income', label: t('common.income') }, { value: 'expense', label: t('common.expense') }]} />
      <Field label={t('common.name')}><Input required value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Salary, Rent…" /></Field>
      <div className="grid grid-cols-3 gap-3"><Field label={t('common.amount')} className="col-span-2"><Input required type="number" step="0.01" min="0.01" value={f.amount} onChange={(e) => set({ amount: e.target.value })} /></Field><Field label={t('common.currency')}><CurrencySelect value={f.currency} onChange={(c) => set({ currency: c })} /></Field></div>
      <div className="grid grid-cols-2 gap-3"><Field label={t('common.category')}><CategorySelect kind={f.kind} value={f.category_id} onChange={(v) => set({ category_id: v })} /></Field><Field label={t('common.account')}><AccountSelect value={f.account_id} onChange={(v) => set({ account_id: v })} /></Field></div>
      <IntervalPicker unit={f.unit} interval={f.interval} onChange={(unit, interval) => set({ unit, interval })} />
      <div className="grid grid-cols-2 gap-3"><Field label={t('common.start')} hint={t('rec.startHint')}><Input type="date" required value={f.start_date} onChange={(e) => set({ start_date: e.target.value })} /></Field>
        <Field label={t('rec.endType')}><Select value={endType} onChange={(e) => setEndType(e.target.value as any)}><option value="never">{t('rec.never')}</option><option value="date">{t('rec.onDate')}</option><option value="count">{t('rec.after')}</option></Select></Field></div>
      {endType === 'date' && <Field label={t('common.end')}><Input type="date" required value={f.end_date ?? ''} onChange={(e) => set({ end_date: e.target.value })} /></Field>}
      {endType === 'count' && <Field label="N"><Input type="number" min={1} required value={f.count ?? ''} onChange={(e) => set({ count: e.target.value })} /></Field>}
      <Switch checked={f.auto_post} onChange={(v) => set({ auto_post: v })} label={t('rec.autopost')} />
      {preview.length > 0 && <div><div className="text-xs font-medium text-muted-foreground mb-1">{t('rec.preview')}</div><div className="flex flex-wrap gap-1">{preview.slice(0, 8).map((p) => <Badge key={p}>{dateFmt(p)}</Badge>)}</div></div>}
    </form>
  </Modal>;
}
