import { monthlyPayment } from '@fa/core';
import { useRef, useState } from 'react';
import { Upload, Loader2, Check, Undo2, Trash2, ShieldCheck, Sparkles } from 'lucide-react';
import { useT } from '../lib/i18n';
import { useApi, useAction } from '../lib/hooks';
import { post, put } from '../lib/api';
import { money, dateFmt } from '../lib/format';
import { Badge, Button, Card, Empty, Input, Spinner, Stat, th, td, cn } from '../components/ui';

const tone: Record<string, any> = { staged: 'warning', approved: 'success', partial: 'default', reverted: 'default', discarded: 'default' };
const actTone: Record<string, any> = { create: 'success', update: 'warning', close: 'danger', unchanged: 'default', history: 'default' };
const toB64 = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); });

export default function CreditImport() {
  const t = useT();
  const list = useApi<any[]>('/credit-reports');
  const [sel, setSel] = useState<number | null>(null);
  const [busyUp, setBusyUp] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const { run } = useAction();
  const cur = sel ?? list.data?.[0]?.id ?? null;
  const upload = async (f?: File) => {
    if (!f) return; setBusyUp(true);
    const r = await run(async () => post<{ id: number }>('/credit-reports', { filename: f.name, data: await toB64(f) }));
    setBusyUp(false); if (ref.current) ref.current.value = ''; if (r) setSel(r.id);
  };
  return <div className="space-y-4">
    <div onClick={() => ref.current?.click()} className="cursor-pointer rounded-xl border-2 border-dashed border-border p-6 text-center hover:border-primary/50">
      <input ref={ref} type="file" accept="application/pdf,.pdf" className="hidden" data-testid="credit-input" onChange={(e) => upload(e.target.files?.[0])} />
      {busyUp ? <Loader2 className="mx-auto h-7 w-7 animate-spin text-primary" /> : <Upload className="mx-auto h-7 w-7 text-muted-foreground" />}
      <p className="mt-2 text-sm font-medium">{t('cr.drop')}</p>
      <p className="mt-1 flex items-center justify-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 text-success" />{t('cr.privacy')}</p>
    </div>
    {list.isLoading ? <Spinner /> : !list.data?.length ? <Empty title={t('cr.empty')} /> :
      <div className="grid gap-4 xl:grid-cols-[260px_1fr]">
        <Card title={t('imp.history')}><ul className="space-y-1">{list.data.map((r) => <li key={r.id}><button onClick={() => setSel(r.id)} className={cn('w-full rounded-lg p-2 text-left text-sm', cur === r.id ? 'bg-muted' : 'hover:bg-muted/50')}>
          <div className="flex justify-between gap-2"><span className="truncate font-medium">{r.filename}</span><Badge tone={tone[r.status]}>{t('imp.' + r.status)}</Badge></div>
          <div className="text-xs text-muted-foreground">{r.score ?? '—'} · {r.rating ?? '—'} · {dateFmt(r.report_date)}</div></button></li>)}</ul></Card>
        {cur && <ReportView id={cur} />}
      </div>}
  </div>;
}

function ReportView({ id }: { id: number }) {
  const t = useT();
  const r = useApi<any>(`/credit-reports/${id}`);
  const { run, busy } = useAction();
  const [edit, setEdit] = useState<number | null>(null);
  if (!r.data) return <Spinner />;
  const d = r.data; const s = d.summary;
  const actionable = d.contracts.filter((c: any) => !c.excluded && !c.applied_loan_id && ['create', 'update', 'close'].includes(c.action));
  const applied = d.contracts.filter((c: any) => c.applied_loan_id).length;
  const active = d.contracts.filter((c: any) => c.active); const closed = d.contracts.filter((c: any) => !c.active);
  return <div className="space-y-4 min-w-0">
    <Card title={<span className="flex items-center gap-2">{d.filename}<Badge tone={tone[d.status]}>{t('imp.' + d.status)}</Badge></span>} subtitle={`${t('cr.reportDate')}: ${dateFmt(d.report_date)}`}
      action={<div className="flex flex-wrap gap-2">
        {d.status !== 'discarded' && actionable.length > 0 && <Button disabled={busy} onClick={() => run(() => post(`/credit-reports/${id}/approve`, {}), t('imp.approved'))}><Check className="h-4 w-4" />{t('imp.approveAll', { n: actionable.length })}</Button>}
        {applied > 0 && <Button variant="outline" disabled={busy} onClick={() => confirm(t('cr.revertConfirm')) && run(() => post(`/credit-reports/${id}/revert`), t('imp.reverted'))}><Undo2 className="h-4 w-4" />{t('imp.revert')}</Button>}
        {d.status !== 'discarded' && !applied && <Button variant="ghost" onClick={() => run(() => post(`/credit-reports/${id}/discard`), t('imp.discarded'))}><Trash2 className="h-4 w-4" />{t('imp.discard')}</Button>}
      </div>}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label={t('cr.score')} value={s.score ?? '—'} /><Stat label={t('cr.rating')} value={s.rating ?? '—'} /><Stat label={t('cr.pd')} value={s.defaultProbability != null ? `${s.defaultProbability}%` : '—'} />
        <Stat label={t('cr.totalDebt')} value={money(s.totalDebt ?? 0)} /><Stat label={t('cr.monthly')} value={money(s.monthlyPayments ?? 0)} /><Stat label={t('cr.overdue')} value={money(s.overdueAmount ?? 0)} />
      </div>
      {s.factors?.length > 0 && <ul className="mt-3 space-y-1 text-xs text-muted-foreground">{s.factors.map((f: any) => <li key={f.code}><b className="text-foreground">{f.code}</b> — {f.description}</li>)}</ul>}
      {d.ai_note && <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><Sparkles className="h-3.5 w-3.5" />{d.ai_note}</p>}
      {d.warnings?.map((w: string) => <p key={w} className="mt-2 text-sm text-warning">{w}</p>)}
    </Card>
    <Card title={`${t('cr.active')} (${active.length})`} className="p-0 overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm">
      <thead className="border-b bg-muted/40"><tr>{['cr.creditor', 'common.type', 'cr.original', 'cr.balance', 'cr.payment', 'cr.rate', 'cr.term', 'cr.dates', 'cr.overdueDays', 'cr.action', ''].map((k) => <th key={k} className={th}>{k ? t(k) : ''}</th>)}</tr></thead>
      <tbody>{active.map((c: any) => <ContractRow key={c.id} c={c} editing={edit === c.id} onEdit={() => setEdit(edit === c.id ? null : c.id)} run={run} />)}</tbody></table></div></Card>
    <Card title={`${t('cr.closed')} (${closed.length})`} className="p-0 overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm">
      <thead className="border-b bg-muted/40"><tr>{['cr.creditor', 'common.type', 'cr.original', 'cr.dates', 'cr.penalty', 'cr.action'].map((k) => <th key={k} className={th}>{t(k)}</th>)}</tr></thead>
      <tbody>{closed.map((c: any) => <tr key={c.id} className="border-b last:border-0"><td className={td}>{c.creditor}</td><td className={td}>{t('cr.type.' + c.type)}</td><td className={cn(td, 'num')}>{money(c.data.originalAmount ?? 0, c.data.currency)}</td>
        <td className={cn(td, 'whitespace-nowrap')}>{dateFmt(c.data.startDate)} → {dateFmt(c.data.closedDate)}</td><td className={cn(td, 'num')}>{money(c.data.penalty ?? 0)}</td><td className={td}><Badge tone={actTone[c.action]}>{t('cr.act.' + c.action)}</Badge></td></tr>)}</tbody></table></div></Card>
  </div>;
}

function ContractRow({ c, editing, onEdit, run }: { c: any; editing: boolean; onEdit: () => void; run: (fn: () => Promise<any>, m?: string) => Promise<any> }) {
  const t = useT(); const x = c.data; const p = c.proposed;
  const [f, setF] = useState({ monthly_payment: p.monthly_payment != null ? String(p.monthly_payment) : '', term_months: String(p.term_months), annual_rate: String(p.annual_rate), principal: String(p.principal), start_date: p.start_date, name: p.name });
  const locked = !!c.applied_loan_id;
  return <>
    <tr className={cn('border-b last:border-0', c.excluded && 'opacity-50', locked && 'bg-success/5')}>
      <td className={td}><div className="font-medium">{c.creditor}</div><div className="text-xs text-muted-foreground">…{(c.external_id ?? '').slice(-4)}{x.restructured ? ' · restructured' : ''}</div></td>
      <td className={td}>{t('cr.type.' + c.type)}</td>
      <td className={cn(td, 'num whitespace-nowrap')}>{money(x.originalAmount ?? 0, x.currency)}</td>
      <td className={cn(td, 'num whitespace-nowrap')}>{money(x.balance ?? 0, x.currency)}</td>
      <td className={cn(td, 'num whitespace-nowrap', p.needs_input && c.active && 'bg-warning/15')}>{p.monthly_payment ? money(p.monthly_payment, x.currency)
        : p.needs_input ? (c.active ? <Badge tone="warning">{t('lx.needsInput')}</Badge> : '—')
        : p.term_months > 0 && c.active ? <span title={p.notes}>≈{money(monthlyPayment(p.principal, p.annual_rate, p.term_months), x.currency)}<div className="text-[10px] text-muted-foreground">{p.term_months} {t('unit.month')}</div></span> : '—'}</td>
      <td className={cn(td, 'whitespace-nowrap')}>{x.interestRate != null ? `${x.interestRate}%` : p.annual_rate ? `≈${p.annual_rate}%` : '—'}</td>
      <td className={td}>{x.installmentsLeft != null ? `${x.installmentsLeft}/${x.installmentsTotal ?? x.termMonths}` : x.termMonths ?? '—'}</td>
      <td className={cn(td, 'whitespace-nowrap text-xs')}>{dateFmt(x.startDate)} → {dateFmt(x.endDate)}</td>
      <td className={td}>{x.overdueAmount > 0 ? <Badge tone="danger">{money(x.overdueAmount)}</Badge> : x.overdueDays || 0}</td>
      <td className={td}><Badge tone={actTone[c.action]}>{t('cr.act.' + c.action)}</Badge>{c.match_name && <div className="text-xs text-muted-foreground">{c.match_name}</div>}
        {c.diff?.length > 0 && <ul className="mt-1 text-xs text-warning">{c.diff.map((d: any) => <li key={d.field}>{d.field}: {String(d.from)} → {String(d.to)}</li>)}</ul>}</td>
      <td className={cn(td, 'whitespace-nowrap')}>{locked ? <Badge tone="success">✓</Badge> : ['create', 'update', 'close'].includes(c.action) && <>
        <Button size="sm" variant="ghost" onClick={onEdit}>{t('common.edit')}</Button>
        <Button size="sm" variant="ghost" onClick={() => run(() => put(`/credit-contracts/${c.id}`, { excluded: !c.excluded }))}>{c.excluded ? t('imp.include') : t('imp.excluded')}</Button></>}</td>
    </tr>
    {editing && !locked && <tr className="border-b bg-muted/30"><td colSpan={11} className="p-3"><div className="flex flex-wrap items-end gap-2 text-xs">
      {(['name', 'principal', 'annual_rate', 'term_months', 'monthly_payment', 'start_date'] as const).map((k) => <label key={k} className="space-y-1"><span className="text-muted-foreground">{k === 'monthly_payment' ? t('lx.payment') : t('cr.f.' + k)}</span>
        <Input className="h-8 w-32" type={k === 'start_date' ? 'date' : k === 'name' ? 'text' : 'number'} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>)}
      <Button size="sm" onClick={() => run(() => put(`/credit-contracts/${c.id}`, { proposed: { name: f.name, start_date: f.start_date, principal: Number(f.principal), annual_rate: Number(f.annual_rate), term_months: Math.round(Number(f.term_months)), monthly_payment: Number(f.monthly_payment) > 0 ? Number(f.monthly_payment) : null } }), t('common.saved')).then(onEdit)}>{t('common.save')}</Button>
      <span className="text-muted-foreground">{p.notes}</span></div></td></tr>}
  </>;
}
