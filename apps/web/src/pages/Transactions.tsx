import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Upload, Search, Filter, Trash2, Tag, X, ArrowUpDown, Repeat, Landmark, CalendarClock, ArrowLeftRight } from 'lucide-react';
import { useT } from '../lib/i18n';
import { useApi, useAction } from '../lib/hooks';
import { get, post, qs } from '../lib/api';
import { money, dateFmt } from '../lib/format';
import { exportRows } from '../lib/sheets';
import { Badge, Button, Card, Input, PageHeader, Select, Spinner, cn, th, td, Empty } from '../components/ui';
import { AccountSelect, CategorySelect } from '../components/pickers';
import { Icon } from '../components/Icon';
import TxDialog, { type Tx } from '../components/TxDialog';
import ImportDialog from '../components/ImportDialog';

const FILTERS = ['q', 'from', 'to', 'kind', 'category_id', 'account_id', 'tag', 'min', 'max', 'sort', 'dir'] as const;
const PAGE = 50;

export default function Transactions() {
  const t = useT();
  const [sp, setSp] = useSearchParams();
  const f = Object.fromEntries(FILTERS.map((k) => [k, sp.get(k) ?? ''])) as Record<(typeof FILTERS)[number], string>;
  const [page, setPage] = useState(0);
  const [q, setQ] = useState(f.q);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [edit, setEdit] = useState<Tx | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(!!(f.from || f.to || f.kind || f.category_id || f.account_id || f.tag || f.min || f.max));
  const tags = useApi<string[]>('/tags').data ?? [];
  const setF = (k: string, v: string | number | null | undefined) => { const n = new URLSearchParams(sp); if (v === '' || v == null) n.delete(k); else n.set(k, String(v)); n.delete('focus'); setSp(n, { replace: true }); setPage(0); setSel(new Set()); };
  useEffect(() => { const h = setTimeout(() => q !== f.q && setF('q', q), 300); return () => clearTimeout(h); }, [q]);
  const query = qs({ ...f, limit: PAGE, offset: page * PAGE });
  const d = useApi<{ rows: any[]; total: number; income: number; expense: number }>(`/transactions${query}`);
  const { run, busy } = useAction();
  const ids = [...sel];
  const bulk = (action: string, patch: Record<string, unknown> = {}) => run(() => post('/transactions/bulk', { ids, action, patch }), `✓ ${ids.length}`).then(() => setSel(new Set()));
  const active = FILTERS.filter((k) => f[k] && !['sort', 'dir', 'q'].includes(k)).length;
  const doExport = async (type: 'csv' | 'xlsx') => {
    const all = await get<{ rows: any[] }>(`/transactions${qs({ ...f, limit: 5000 })}`);
    exportRows(all.rows.map((r) => ({ Date: r.date, Type: r.kind, Description: r.description ?? '', Category: r.category_name ?? '', Account: r.account_name ?? '', Amount: r.amount, Currency: r.currency, Rate: r.rate, 'Amount GEL': r.amount_gel, Tags: r.tags.join(', '), Notes: r.notes ?? '' })), `transactions-${new Date().toISOString().slice(0, 10)}`, type);
  };
  const sortBy = (c: string) => { if (f.sort === c) setF('dir', f.dir === 'asc' ? 'desc' : 'asc'); else { setF('sort', c); } };
  const rows = d.data?.rows ?? [];
  const allSel = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const pages = Math.ceil((d.data?.total ?? 0) / PAGE);
  const sourceIcon = (r: any) => r.kind === 'transfer' ? <ArrowLeftRight className="h-3 w-3" /> : r.loan_id ? <Landmark className="h-3 w-3" /> : r.subscription_id ? <CalendarClock className="h-3 w-3" /> : r.recurring_id ? <Repeat className="h-3 w-3" /> : null;
  const totals = useMemo(() => d.data && <div className="flex gap-4 text-sm"><span className="text-muted-foreground">{d.data.total} items</span><span className="text-success num">+{money(d.data.income)}</span><span className="text-danger num">−{money(d.data.expense)}</span></div>, [d.data]);

  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.transactions')} subtitle={totals} actions={<>
        <Button variant="outline" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4" />{t('common.import')}</Button>
        <Button variant="outline" onClick={() => doExport('csv')}><Download className="h-4 w-4" />CSV</Button>
        <Button variant="outline" onClick={() => doExport('xlsx')}><Download className="h-4 w-4" />Excel</Button>
        <Button onClick={() => setEdit({ kind: 'expense', amount: '', currency: 'GEL', date: new Date().toISOString().slice(0, 10), account_id: null, category_id: null, tags: [] })}>+ {t('tx.new')}</Button></>} />
      <Card className="overflow-visible">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input id="tx-search" autoFocus={sp.get('focus') === '1'} className="pl-9" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <Select className="w-36" value={f.kind} onChange={(e) => setF('kind', e.target.value)}><option value="">{t('common.all')}</option><option value="income">{t('common.income')}</option><option value="expense">{t('common.expense')}</option><option value="transfer">{t('common.transfer')}</option></Select>
          <Button variant={showFilters ? 'secondary' : 'outline'} onClick={() => setShowFilters(!showFilters)}><Filter className="h-4 w-4" />{active ? <Badge tone="primary">{active}</Badge> : null}</Button>
          {active > 0 && <Button variant="ghost" onClick={() => { setSp(new URLSearchParams()); setQ(''); }}><X className="h-4 w-4" /></Button>}
        </div>
        {showFilters && <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 mt-3">
          <Input type="date" value={f.from} onChange={(e) => setF('from', e.target.value)} title={t('common.from')} />
          <Input type="date" value={f.to} onChange={(e) => setF('to', e.target.value)} title={t('common.to')} />
          <CategorySelect value={f.category_id ? Number(f.category_id) : null} onChange={(v) => setF('category_id', v)} allowEmpty={t('common.category') + ': ' + t('common.all')} />
          <AccountSelect value={f.account_id ? Number(f.account_id) : null} onChange={(v) => setF('account_id', v)} allowEmpty={t('common.account') + ': ' + t('common.all')} />
          <Select value={f.tag} onChange={(e) => setF('tag', e.target.value)}><option value="">{t('common.tags')}: {t('common.all')}</option>{tags.map((x) => <option key={x}>{x}</option>)}</Select>
          <Input type="number" placeholder={t('tx.minAmount')} value={f.min} onChange={(e) => setF('min', e.target.value)} />
          <Input type="number" placeholder={t('tx.maxAmount')} value={f.max} onChange={(e) => setF('max', e.target.value)} />
        </div>}
      </Card>

      {sel.size > 0 && <div className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-xl border bg-primary/5 border-primary/30 p-3 shadow-sm backdrop-blur">
        <b className="text-sm">{sel.size} {t('tx.bulk')}</b>
        <CategorySelect className="w-48 h-9" value={null} onChange={(v) => v && bulk('update', { category_id: v })} allowEmpty={t('tx.bulkCategory') + '…'} />
        <AccountSelect className="w-44 h-9" value={null} onChange={(v) => v && bulk('update', { account_id: v })} allowEmpty={t('tx.bulkAccount') + '…'} />
        <BulkTag onAdd={(tag) => bulk('addTag', { tag })} />
        <Button size="sm" variant="danger" loading={busy} onClick={() => confirm(t('common.confirmDelete')) && bulk('delete')}><Trash2 className="h-4 w-4" />{t('common.delete')}</Button>
        <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}><X className="h-4 w-4" /></Button>
      </div>}

      <Card className="p-0 overflow-hidden">
        {!d.data ? <Spinner /> : !rows.length ? <Empty title={t('common.empty')} /> : <div className="-m-5 overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-muted/40 border-b"><tr>
            <th className={cn(th, 'w-10')}><input type="checkbox" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(rows.map((r) => r.id)))} /></th>
            <th className={th}><button className="flex items-center gap-1" onClick={() => sortBy('date')}>{t('common.date')}<ArrowUpDown className="h-3 w-3" /></button></th>
            <th className={th}><button className="flex items-center gap-1" onClick={() => sortBy('description')}>{t('common.description')}<ArrowUpDown className="h-3 w-3" /></button></th>
            <th className={th}>{t('common.category')}</th><th className={cn(th, 'hidden md:table-cell')}>{t('common.account')}</th><th className={cn(th, 'hidden lg:table-cell')}>{t('common.tags')}</th>
            <th className={cn(th, 'text-right')}><button className="inline-flex items-center gap-1" onClick={() => sortBy('amount')}>{t('common.amount')}<ArrowUpDown className="h-3 w-3" /></button></th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className={cn('border-b last:border-0 hover:bg-muted/30 cursor-pointer transition', sel.has(r.id) && 'bg-primary/5')} onClick={() => setEdit({ ...r })}>
              <td className={td} onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(r.id)} onChange={() => { const n = new Set(sel); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); setSel(n); }} /></td>
              <td className={cn(td, 'whitespace-nowrap text-muted-foreground')}>{dateFmt(r.date)}</td>
              <td className={td}><div className="flex items-center gap-2"><span className="font-medium">{r.description || '—'}</span>{sourceIcon(r) && <span className="text-muted-foreground">{sourceIcon(r)}</span>}</div>{r.notes && <div className="text-[11px] text-muted-foreground truncate max-w-xs">{r.notes}</div>}</td>
              <td className={td}>{r.category_name ? <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs" style={{ background: r.category_color + '22', color: r.category_color }}><Icon name={r.category_icon} className="h-3 w-3" />{r.category_name}</span> : <span className="text-muted-foreground text-xs">—</span>}</td>
              <td className={cn(td, 'hidden md:table-cell text-muted-foreground')}>{r.account_name ?? '—'}</td>
              <td className={cn(td, 'hidden lg:table-cell')}><div className="flex gap-1 flex-wrap">{r.tags.map((x: string) => <Badge key={x}>{x}</Badge>)}</div></td>
              <td className={cn(td, 'text-right whitespace-nowrap')}><div className={cn('font-semibold num', r.kind === 'income' ? 'text-success' : r.kind === 'expense' ? '' : 'text-muted-foreground')}>{r.kind === 'income' ? '+' : r.kind === 'expense' ? '−' : ''}{money(r.amount, r.currency)}</div>
                {r.currency !== 'GEL' && <div className="text-[11px] text-muted-foreground num">{money(r.amount_gel)} @ {Number(r.rate).toFixed(4)}</div>}</td>
            </tr>))}</tbody></table></div>}
      </Card>
      {pages > 1 && <div className="flex justify-center items-center gap-2"><Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>←</Button><span className="text-sm text-muted-foreground">{page + 1} / {pages}</span><Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>→</Button></div>}
      <TxDialog open={!!edit} tx={edit} onClose={() => setEdit(null)} />
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}
function BulkTag({ onAdd }: { onAdd: (t: string) => void }) {
  const t = useT(); const [v, setV] = useState('');
  return <form className="flex" onSubmit={(e) => { e.preventDefault(); if (v) { onAdd(v); setV(''); } }}><Input className="h-9 w-32 rounded-r-none" placeholder={t('tx.bulkTag')} value={v} onChange={(e) => setV(e.target.value)} /><Button size="sm" variant="outline" className="h-9 rounded-l-none"><Tag className="h-4 w-4" /></Button></form>;
}
