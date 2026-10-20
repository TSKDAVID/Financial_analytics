import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { useT } from '../lib/i18n';
import { useAction } from '../lib/hooks';
import { del, post, put } from '../lib/api';
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Spinner, Switch, Tabs, cn } from '../components/ui';
import { useCategories, type Category } from '../components/pickers';
import { Icon, ICONS } from '../components/Icon';

const COLORS = ['#ef4444', '#f97316', '#f59e0b', '#facc15', '#84cc16', '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#64748b'];

export default function Categories() {
  const t = useT(); const d = useCategories(); const { run, busy } = useAction();
  const [kind, setKind] = useState<'expense' | 'income'>('expense'); const [edit, setEdit] = useState<any>(null);
  if (!d.data) return <Spinner />;
  const list = d.data.filter((c) => c.kind === kind); const parents = list.filter((c) => !c.parent_id);
  const save = async (e: React.FormEvent) => { e.preventDefault(); const { id, name, kind: k, parent_id, color, icon, essential, archived } = edit; const body = { name, kind: k, parent_id: parent_id || null, color, icon, essential: !!essential, archived: !!archived };
    if (await run(() => (id ? put(`/categories/${id}`, body) : post('/categories', body)), t('common.saved'))) setEdit(null); };
  const Item = ({ c, sub }: { c: Category; sub?: boolean }) => <div className={cn('flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted/50 group', sub && 'ml-8', c.archived && 'opacity-50')}>
    <span className="rounded-lg p-1.5" style={{ background: c.color + '22', color: c.color }}><Icon name={c.icon} className="h-4 w-4" /></span>
    <span className="flex-1 text-sm font-medium">{c.name}</span>{!!c.essential && <Badge tone="info">essential</Badge>}{!!c.builtin && <Badge>{t('cat.builtin')}</Badge>}
    {!sub && <Button size="icon" variant="ghost" className="opacity-0 group-hover:opacity-100" title="Add subcategory" onClick={() => setEdit({ name: '', kind, parent_id: c.id, color: c.color, icon: c.icon, essential: !!c.essential })}><Plus className="h-4 w-4" /></Button>}
    <Button size="icon" variant="ghost" onClick={() => setEdit({ ...c })}><Pencil className="h-4 w-4" /></Button></div>;
  return <div className="space-y-4">
    <PageHeader title={t('nav.categories')} actions={<Button onClick={() => setEdit({ name: '', kind, parent_id: null, color: COLORS[11], icon: 'circle', essential: false })}>+ {t('cat.new')}</Button>} />
    <Tabs value={kind} onChange={setKind} options={[{ value: 'expense', label: t('common.expense') }, { value: 'income', label: t('common.income') }]} />
    <Card><div className="divide-y">{parents.map((p) => <div key={p.id} className="py-1"><Item c={p} />{list.filter((c) => c.parent_id === p.id).map((c) => <Item key={c.id} c={c} sub />)}</div>)}</div></Card>
    {edit && <Modal open onClose={() => setEdit(null)} title={edit.id ? t('common.edit') : t('cat.new')} footer={<>{edit.id && !edit.builtin && <Button variant="ghost" className="mr-auto text-danger" onClick={() => confirm(t('common.confirmDelete')) && run(() => del(`/categories/${edit.id}`)).then(() => setEdit(null))}>{t('common.delete')}</Button>}<Button variant="outline" onClick={() => setEdit(null)}>{t('common.cancel')}</Button><Button form="catf" loading={busy}>{t('common.save')}</Button></>}>
      <form id="catf" onSubmit={save} className="space-y-4">
        <Field label={t('common.name')}><Input required value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label={t('common.type')}><Select value={edit.kind} disabled={!!edit.builtin} onChange={(e) => setEdit({ ...edit, kind: e.target.value, parent_id: null })}><option value="expense">{t('common.expense')}</option><option value="income">{t('common.income')}</option></Select></Field>
          <Field label={t('cat.parent')}><Select value={edit.parent_id ?? ''} onChange={(e) => setEdit({ ...edit, parent_id: e.target.value ? Number(e.target.value) : null })}><option value="">—</option>{d.data!.filter((c) => c.kind === edit.kind && !c.parent_id && c.id !== edit.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field></div>
        <Field label={t('cat.color')}><div className="flex gap-1.5 flex-wrap">{COLORS.map((c) => <button type="button" key={c} onClick={() => setEdit({ ...edit, color: c })} className={cn('h-7 w-7 rounded-full', edit.color === c && 'ring-2 ring-offset-2 ring-foreground ring-offset-card')} style={{ background: c }} />)}</div></Field>
        <Field label={t('cat.icon')}><div className="flex gap-1 flex-wrap">{ICONS.map((i) => <button type="button" key={i} onClick={() => setEdit({ ...edit, icon: i })} className={cn('rounded-lg p-2 border', edit.icon === i ? 'border-primary bg-primary/10 text-primary' : 'border-transparent hover:bg-muted')}><Icon name={i} className="h-4 w-4" /></button>)}</div></Field>
        {edit.kind === 'expense' && <Switch checked={!!edit.essential} onChange={(v) => setEdit({ ...edit, essential: v })} label={t('cat.essential')} />}
        <Switch checked={!!edit.archived} onChange={(v) => setEdit({ ...edit, archived: v })} label={t('acc.archived')} />
      </form></Modal>}
  </div>;
}
