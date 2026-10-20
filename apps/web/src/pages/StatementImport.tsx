import { useMemo, useRef, useState } from 'react';
import { Upload, FileText, Check, Undo2, Trash2, Sparkles, Copy, Loader2, ShieldCheck } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell } from 'recharts';
import { toast } from 'sonner';
import { useT } from '../lib/i18n';
import { useApi, useAction } from '../lib/hooks';
import { post, put } from '../lib/api';
import { money, dateFmt } from '../lib/format';
import { Button, Card, Badge, PageHeader, Empty, Spinner, Tabs, Stat, th, td, cn } from '../components/ui';
import { CategorySelect, AccountSelect } from '../components/pickers';
import CreditImport from './CreditImport';
import { InsightList, CHART_COLORS, axis, grid, tooltipStyle } from '../components/shared';

const statusTone: Record<string, any> = { staged: 'warning', approved: 'success', partial: 'default', reverted: 'default', discarded: 'default' };
const toB64 = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); });

export default function StatementImport() {
  const t = useT();
  const [mode, setMode] = useState<'statement' | 'credit'>(() => (location.hash === '#credit' ? 'credit' : 'statement'));
  return <div className="space-y-5">
    <PageHeader title={t('imp.title')} subtitle={t('imp.subtitle')} actions={<Tabs value={mode} onChange={(m) => { setMode(m); window.history.replaceState(null, '', m === 'credit' ? '#credit' : '#'); }} options={[{ value: 'statement', label: t('imp.tab.statement') }, { value: 'credit', label: t('imp.tab.credit') }]} />} />
    {mode === 'statement' ? <Statements /> : <CreditImport />}
  </div>;
}

function Statements() {
  const t = useT();
  const batches = useApi<any[]>('/imports');
  const [sel, setSel] = useState<number | null>(null);
  const [account, setAccount] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { run } = useAction();
  const current = sel ?? batches.data?.[0]?.id ?? null;

  async function upload(f: File | undefined) {
    if (!f) return;
    setUploading(true);
    const r = await run(async () => post<{ id: number }>('/imports', { filename: f.name, data: await toB64(f), account_id: account }));
    setUploading(false); if (fileRef.current) fileRef.current.value = '';
    if (r) setSel(r.id);
  }

  return <div className="space-y-5">
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files[0]); }}
        onClick={() => fileRef.current?.click()} className={cn('cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition', drag ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50')}>
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => upload(e.target.files?.[0])} data-testid="pdf-input" />
        {uploading ? <><Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" /><p className="mt-2 text-sm">{t('imp.parsing')}</p></>
          : <><Upload className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-2 text-sm font-medium">{t('imp.drop')}</p><p className="mt-1 text-xs text-muted-foreground">PDF · BOG · TBC · Liberty · ProCredit · Credo</p></>}
      </div>
      <Card title={t('imp.account')}><AccountSelect value={account} onChange={setAccount} /><p className="mt-3 flex gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4 shrink-0 text-success" />{t('imp.notice')}</p></Card>
    </div>
    {batches.isLoading ? <Spinner /> : !batches.data?.length ? <Empty icon={<FileText className="h-8 w-8" />} title={t('imp.empty')} /> :
      <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
        <Card title={t('imp.history')}><ul className="space-y-1">{batches.data.map((b) =>
          <li key={b.id}><button onClick={() => setSel(b.id)} className={cn('w-full rounded-lg p-2 text-left text-sm transition', current === b.id ? 'bg-muted' : 'hover:bg-muted/50')}>
            <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{b.filename}</span><Badge tone={statusTone[b.status]}>{t('imp.' + b.status)}</Badge></div>
            <div className="text-xs text-muted-foreground">{b.bank} · {b.row_count} · {dateFmt(b.created_at.slice(0, 10))}</div></button></li>)}</ul></Card>
        {current && <BatchView id={current} />}
      </div>}
  </div>;
}

function BatchView({ id }: { id: number }) {
  const t = useT();
  const b = useApi<any>(`/imports/${id}`);
  const [tab, setTab] = useState<'rows' | 'analysis'>('rows');
  const [filter, setFilter] = useState<'all' | 'low' | 'dup' | 'excl'>('all');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const { run, busy } = useAction();
  const rows: any[] = b.data?.rows ?? [];
  const shown = useMemo(() => rows.filter((r) => filter === 'all' || (filter === 'low' && r.confidence < 0.6) || (filter === 'dup' && r.duplicate_of) || (filter === 'excl' && r.excluded)), [rows, filter]);
  if (!b.data) return <Spinner />;
  const d = b.data; const s = d.stats;
  const locked = d.status === 'discarded';
  const pendingIds = [...picked].filter((x) => rows.find((r) => r.id === x && !r.transaction_id && !r.excluded));
  const pending = rows.filter((r) => !r.excluded && !r.transaction_id).length;
  const patch = async (r: any, p: any) => { const res = await run(() => put<{ applied: number }>(`/imports/rows/${r.id}`, p)); if (res?.applied) toast.success(t('imp.learnedApplied', { n: res.applied })); };
  const toggle = (rid: number) => setPicked((p) => { const n = new Set(p); if (n.has(rid)) n.delete(rid); else n.add(rid); return n; });

  return <div className="space-y-4 min-w-0">
    <Card title={<span className="flex items-center gap-2">{d.filename}<Badge tone={statusTone[d.status]}>{t('imp.' + d.status)}</Badge></span>}
      subtitle={`${t('imp.bank')}: ${d.bank} · ${t('imp.period')}: ${dateFmt(d.period_from)} – ${dateFmt(d.period_to)}`}
      action={<div className="flex flex-wrap gap-2">
        {!locked && pending > 0 && <Button disabled={busy} onClick={() => run(() => post(`/imports/${id}/approve`, {}), t('imp.approved'))}><Check className="h-4 w-4" />{d.status === 'reverted' ? t('imp.reapprove') : t('imp.approveAll', { n: pending })}</Button>}
        {!locked && pendingIds.length > 0 && <Button variant="outline" disabled={busy} onClick={() => run(() => post(`/imports/${id}/approve`, { ids: pendingIds }), t('imp.approved')).then(() => setPicked(new Set()))}>{t('imp.approveSel', { n: pendingIds.length })}</Button>}
        {s.posted > 0 && <Button variant="outline" disabled={busy} onClick={() => confirm(t('imp.revertConfirm', { n: s.posted })) && run(() => post(`/imports/${id}/revert`), t('imp.reverted'))}><Undo2 className="h-4 w-4" />{t('imp.revert')}</Button>}
        {!locked && !s.posted && <Button variant="ghost" disabled={busy} onClick={() => run(() => post(`/imports/${id}/discard`), t('imp.discarded'))}><Trash2 className="h-4 w-4" />{t('imp.discard')}</Button>}
      </div>}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label={t('imp.rows')} value={s.total} /><Stat label={t('common.expense')} value={money(s.expense, d.currency)} /><Stat label={t('common.income')} value={money(s.income, d.currency)} />
        <Stat label={t('imp.duplicates')} value={s.duplicates ?? 0} /><Stat label={t('imp.posted')} value={`${s.posted ?? 0}/${s.included ?? 0}`} />
      </div>
      {d.warnings?.map((w: string) => <p key={w} className="mt-3 text-sm text-warning">{w}</p>)}
      {d.ai_note && <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><Sparkles className="h-3.5 w-3.5" />{d.ai_note}</p>}
    </Card>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Tabs value={tab} onChange={setTab} options={[{ value: 'rows', label: t('imp.rows') }, { value: 'analysis', label: t('imp.analysis') }]} />
      {tab === 'rows' && <div className="flex flex-wrap gap-2">
        <Tabs value={filter} onChange={setFilter} options={(['all', 'low', 'dup', 'excl'] as const).map((v) => ({ value: v, label: t('imp.filter.' + v) }))} />
        {!locked && (s.low ?? 0) > 0 && <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => post(`/imports/${id}/ai`))}><Sparkles className="h-4 w-4" />{t('imp.runAi')}</Button>}
      </div>}
    </div>
    {tab === 'rows' ? <Card className="p-0 overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm">
      <thead className="border-b bg-muted/40"><tr><th className={th}><input type="checkbox" aria-label="select all" checked={shown.length > 0 && shown.every((r) => picked.has(r.id))} onChange={(e) => setPicked(e.target.checked ? new Set(shown.map((r) => r.id)) : new Set())} /></th>
        <th className={th}>{t('common.date')}</th><th className={th}>{t('common.description')}</th><th className={cn(th, 'text-right')}>{t('common.amount')}</th><th className={th}>{t('common.category')}</th><th className={th}>{t('imp.conf')}</th><th className={th}>{t('nav.accounts')}</th><th className={th}></th></tr></thead>
      <tbody>{shown.map((r) => <tr key={r.id} className={cn('border-b last:border-0', r.excluded && 'opacity-50', r.transaction_id && 'bg-success/5')}>
        <td className={td}><input type="checkbox" aria-label="select row" checked={picked.has(r.id)} onChange={() => toggle(r.id)} /></td>
        <td className={cn(td, 'whitespace-nowrap')}>{dateFmt(r.date)}</td>
        <td className={cn(td, 'max-w-[280px]')}><div className="truncate" title={r.raw}>{r.description}</div>
          {r.duplicate_of && <div className="flex items-center gap-1 text-xs text-warning"><Copy className="h-3 w-3" />{t('imp.dup', { date: dateFmt(r.dup_date), desc: r.dup_description ?? '' })}</div>}
          {r.subscription ? <Badge className="mt-1">↻</Badge> : null}</td>
        <td className={cn(td, 'num text-right whitespace-nowrap', r.kind === 'income' ? 'text-success' : '')}>{r.kind === 'income' ? '+' : '−'}{money(r.amount, r.currency)}</td>
        <td className={cn(td, 'min-w-[170px]')}>{r.transaction_id || locked ? (r.category_name ?? '—') : <CategorySelect value={r.category_id} kind={r.kind} onChange={(v) => patch(r, { category_id: v })} />}</td>
        <td className={td}><div className="flex items-center gap-1.5"><div className="h-1.5 w-10 rounded bg-muted"><div className={cn('h-1.5 rounded', r.confidence >= 0.8 ? 'bg-success' : r.confidence >= 0.6 ? 'bg-warning' : 'bg-danger')} style={{ width: `${Math.round(r.confidence * 100)}%` }} /></div><span className="text-xs text-muted-foreground">{t('imp.src.' + r.source)}</span></div></td>
        <td className={cn(td, 'min-w-[140px]')}>{r.transaction_id || locked ? '' : <AccountSelect value={r.account_id} onChange={(v) => patch(r, { account_id: v })} />}</td>
        <td className={td}>{r.transaction_id ? <Badge tone="success">✓</Badge> : !locked && <Button size="sm" variant="ghost" onClick={() => patch(r, { excluded: !r.excluded })}>{r.excluded ? t('imp.include') : t('imp.excluded')}</Button>}</td>
      </tr>)}</tbody></table></div></Card> : <Analysis id={id} currency={d.currency} />}
  </div>;
}

function Analysis({ id }: { id: number; currency: string }) {
  const t = useT();
  const a = useApi<any>(`/imports/${id}/analysis`);
  if (!a.data) return <Spinner />;
  const x = a.data; const days = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  return <div className="grid gap-4 lg:grid-cols-2">
    <div className="grid grid-cols-2 gap-3 lg:col-span-2 md:grid-cols-4">
      <Stat label={t('common.expense')} value={money(x.totals.expense)} /><Stat label={t('common.income')} value={money(x.totals.income)} /><Stat label="Net" value={money(x.totals.net, 'GEL', { sign: true })} /><Stat label={t('imp.avgDay')} value={money(x.totals.avgPerDay)} />
    </div>
    <Card title={t('imp.insights')} className="lg:col-span-2"><InsightList items={x.insights} /></Card>
    <Card title={t('imp.byCategory')}><div className="h-64"><ResponsiveContainer><PieChart><Pie data={x.byCategory} dataKey="total" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={2}>
      {x.byCategory.map((c: any, i: number) => <Cell key={i} fill={c.color ?? CHART_COLORS[i % CHART_COLORS.length]} />)}</Pie><Tooltip {...tooltipStyle} formatter={(v: number) => money(v)} /></PieChart></ResponsiveContainer></div>
      <ul className="mt-2 space-y-1 text-sm">{x.byCategory.slice(0, 8).map((c: any, i: number) => <li key={c.name} className="flex justify-between"><span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: c.color ?? CHART_COLORS[i % CHART_COLORS.length] }} />{c.name}</span><span className="num">{money(c.total)}</span></li>)}</ul></Card>
    <Card title={t('imp.topMerchants')}><ul className="space-y-1.5 text-sm">{x.topMerchants.map((m: any) => <li key={m.name} className="flex justify-between gap-2"><span className="truncate capitalize">{m.name} <span className="text-xs text-muted-foreground">×{m.count}</span></span><span className="num">{money(m.total)}</span></li>)}</ul></Card>
    <Card title={t('imp.dow')}><div className="h-52"><ResponsiveContainer><BarChart data={x.dow.map((v: number, i: number) => ({ d: days[i], v }))}><CartesianGrid {...grid} /><XAxis dataKey="d" {...axis} /><YAxis {...axis} width={40} /><Tooltip {...tooltipStyle} formatter={(v: number) => money(v)} /><Bar dataKey="v" fill="#6366f1" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></Card>
    <Card title={t('imp.weekly')}><div className="h-52"><ResponsiveContainer><BarChart data={x.weekly}><CartesianGrid {...grid} /><XAxis dataKey="name" {...axis} tickFormatter={(v) => v.slice(5)} /><YAxis {...axis} width={40} /><Tooltip {...tooltipStyle} formatter={(v: number) => money(v)} /><Bar dataKey="total" fill="#10b981" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></Card>
    <Card title={t('imp.recurring')} className="lg:col-span-2">{!x.recurring.length && !x.subscriptions.length ? <p className="text-sm text-muted-foreground">—</p> :
      <ul className="grid gap-2 text-sm md:grid-cols-2">{x.recurring.map((r: any) => <li key={r.merchant} className="flex justify-between rounded-lg bg-muted/40 p-2"><span className="capitalize">{r.merchant} <Badge>{r.cadence}</Badge></span><span className="num">{money(r.avgAmount)} × {r.count}</span></li>)}
        {x.subscriptions.filter((s: any) => !x.recurring.some((r: any) => r.merchant === s.name)).map((s: any) => <li key={s.name} className="flex justify-between rounded-lg bg-muted/40 p-2"><span className="capitalize">{s.name} <Badge>↻</Badge></span><span className="num">{money(s.total)}</span></li>)}</ul>}</Card>
  </div>;
}
