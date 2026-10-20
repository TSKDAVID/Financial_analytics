import { useState } from 'react';
import { ArrowLeftRight, Check, X, Users, Repeat, PiggyBank } from 'lucide-react';
import { useT } from '../lib/i18n';
import { useApi, useAction } from '../lib/hooks';
import { post, put } from '../lib/api';
import { money, dateFmt } from '../lib/format';
import { Button, Card, Badge, Spinner, Stat, cn } from './ui';

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Smart groups of an import: matched transfers, own-account moves, people, recurring merchants, subscriptions. One click to confirm/reject; everything is reversible until approved. */
export function SmartGroups({ id, locked }: { id: number; locked: boolean }) {
  const t = useT();
  const c = useApi<any>(`/imports/${id}/clusters`);
  const { run, busy } = useAction();
  if (!c.data) return <Spinner />;
  const x = c.data;
  const open = x.transfers.filter((m: any) => m.status === 'proposed');
  const decide = (ids: number[], status: string) => run(() => post('/imports/matches/decide', { ids, status }));
  const bulk = (ids: number[], patch: any) => run(() => post(`/imports/${id}/bulk`, { ids, patch }));
  return <div className="space-y-4">
    <Card title={<span className="flex items-center gap-2"><ArrowLeftRight className="h-4 w-4" />{t('imp.g.transfers')} <Badge>{x.transfers.length}</Badge></span>} subtitle={t('imp.g.transfersHint')}
      action={!locked && open.length > 0 && <Button size="sm" disabled={busy} onClick={() => decide(open.map((m: any) => m.id), 'confirmed')}><Check className="h-4 w-4" />{t('imp.g.confirmAll', { n: open.length })}</Button>}>
      {!x.transfers.length ? <p className="text-sm text-muted-foreground">{t('imp.g.none')}</p> :
        <ul className="divide-y text-sm">{x.transfers.map((m: any) => <li key={m.id} className={cn('flex flex-wrap items-center justify-between gap-2 py-2', m.status === 'rejected' && 'opacity-50')}>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><span className="num">−{money(m.out?.amount, m.out?.currency)}</span><span className="text-xs text-muted-foreground">{m.out?.bank} · {dateFmt(m.out?.date)}</span>
              <span>→</span><span className="num text-success">+{money(m.in?.amount, m.in?.currency)}</span><span className="text-xs text-muted-foreground">{m.in?.bank} · {dateFmt(m.in?.date)}</span>
              {m.fee > 0 && <Badge tone="warning">{t('imp.g.fee', { amount: money(m.fee, m.fee_currency) })}</Badge>}</div>
            <div className="text-xs text-muted-foreground">{pct(m.score)} · {m.reasons.join(' · ')}</div>
          </div>
          <div className="flex items-center gap-1"><Badge tone={m.status === 'confirmed' ? 'success' : m.status === 'rejected' ? 'danger' : 'default'}>{t('imp.g.' + m.status)}</Badge>
            {!locked && m.status !== 'confirmed' && <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide([m.id], 'confirmed')} aria-label={t('imp.g.confirm')}><Check className="h-4 w-4" /></Button>}
            {!locked && m.status !== 'rejected' && <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide([m.id], 'rejected')} aria-label={t('imp.g.reject')}><X className="h-4 w-4" /></Button>}
            {!locked && m.status !== 'proposed' && <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide([m.id], 'proposed')}>{t('imp.g.undo')}</Button>}</div>
        </li>)}</ul>}
    </Card>
    <Card title={<span className="flex items-center gap-2"><PiggyBank className="h-4 w-4" />{t('imp.g.own')}</span>}>
      {!x.own.length ? <p className="text-sm text-muted-foreground">{t('imp.g.none')}</p> :
        <ul className="divide-y text-sm">{x.own.map((g: any) => <li key={g.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <div><b>{t('kind.' + g.key)}</b> <span className="text-xs text-muted-foreground">×{g.count} · {money(g.total)} · {pct(g.confidence)} · {g.why}</span></div>
          {!locked && <Button size="sm" variant="ghost" disabled={busy} onClick={() => bulk(g.ids, { tx_kind: 'purchase' })} title={t('imp.g.reject')}><X className="h-4 w-4" /></Button>}
        </li>)}</ul>}
    </Card>
    <Card title={<span className="flex items-center gap-2"><Users className="h-4 w-4" />{t('imp.g.people')}</span>}>
      {!x.people.length ? <p className="text-sm text-muted-foreground">{t('imp.g.none')}</p> :
        <ul className="divide-y text-sm">{x.people.slice(0, 40).map((p: any) => <li key={p.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <div><b className="capitalize">{p.name}</b> <Badge>{t('ppl.p.' + p.pattern)}</Badge> <span className="text-xs text-muted-foreground">×{p.count} · {t('ppl.sent')} {money(p.sent)} · {t('ppl.received')} {money(p.received)}</span></div>
          <span className={cn('num', p.net > 0 ? 'text-success' : p.net < 0 ? 'text-danger' : '')}>{money(p.net, 'GEL', { sign: true })}</span>
        </li>)}</ul>}
    </Card>
    <Card title={<span className="flex items-center gap-2"><Repeat className="h-4 w-4" />{t('imp.g.recurring')} / {t('imp.g.subs')}</span>}>
      {!x.recurring.length && !x.subscriptions.length ? <p className="text-sm text-muted-foreground">{t('imp.g.none')}</p> :
        <ul className="divide-y text-sm">{x.recurring.map((r: any) => <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <div><b className="capitalize">{r.name}</b> <Badge>{r.cadence}</Badge> <span className="text-xs text-muted-foreground">×{r.count} · ~{money(r.avgAmount)}</span> {r.subscription && <Badge tone="primary">↻</Badge>}</div>
          {!locked && <Button size="sm" variant="ghost" disabled={busy} onClick={() => bulk(r.ids, { tx_kind: r.subscription ? 'purchase' : 'subscription' })}>{r.subscription ? t('imp.g.reject') : t('imp.g.confirm') + ' ↻'}</Button>}
        </li>)}
        {x.subscriptions.filter((s: any) => !x.recurring.some((r: any) => r.key === s.key)).map((s: any) => <li key={s.key} className="flex justify-between py-2"><span className="capitalize">{s.name} <Badge tone="primary">↻</Badge></span><span className="num">{money(s.total)}</span></li>)}</ul>}
    </Card>
  </div>;
}

/** Everyone you exchanged money with, across all imports. */
export function PeopleList() {
  const t = useT();
  const p = useApi<any>('/people');
  const { run, busy } = useAction();
  const [sort, setSort] = useState<'sent' | 'received' | 'total' | 'net'>('sent');
  if (!p.data) return <Spinner />;
  const d = p.data;
  const ranked = [...d.people].filter((x: any) => !x.hidden).sort((a: any, b: any) => sort === 'net' ? Math.abs(b.net) - Math.abs(a.net) : (b[sort] ?? b.sent + b.received) - (a[sort] ?? a.sent + a.received));
  if (!d.people.length) return <Card><p className="text-sm text-muted-foreground">{t('ppl.empty')}</p></Card>;
  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-3"><Stat label={t('ppl.owedToYou')} value={money(d.owedToYou)} /><Stat label={t('ppl.youOwe')} value={money(d.youOwe)} /></div>
    <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">{t('ppl.sort')}</span>{(['sent', 'received', 'total', 'net'] as const).map((k) => <Button key={k} size="sm" variant={sort === k ? 'primary' : 'outline'} onClick={() => setSort(k)}>{t('ppl.sort.' + k)}</Button>)}</div>
    <Card className="p-0"><ul className="divide-y text-sm">{ranked.map((x: any, idx: number) => <li key={x.key} className="p-3">
      <details><summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
        <span><span className="mr-1 text-xs text-muted-foreground">#{idx + 1}</span><b className="capitalize">{x.name}</b> <span className="text-xs text-muted-foreground">×{x.count} · {dateFmt(x.lastDate)} · {t('ppl.sent')} {money(x.sent)} · {t('ppl.received')} {money(x.received)}</span></span>
        <span className="flex items-center gap-2">
          <select aria-label="pattern" className="h-7 rounded-md border bg-background px-1 text-xs" value={x.pattern} disabled={busy} onClick={(e) => e.stopPropagation()}
            onChange={(e) => run(() => put(`/people/${encodeURIComponent(x.key)}`, { pattern: e.target.value }))}>
            {['lent_repaid', 'lent_open', 'borrowed', 'shared', 'one_way_out', 'one_way_in'].map((k) => <option key={k} value={k}>{t('ppl.p.' + k)}</option>)}</select>
          <span className={cn('num w-24 text-right', x.net > 0 ? 'text-success' : x.net < 0 ? 'text-danger' : '')}>{money(x.net, 'GEL', { sign: true })}</span></span></summary>
        <ul className="mt-2 space-y-0.5 text-xs">{x.items.map((i: any) => <li key={i.ref} className="flex justify-between gap-2 text-muted-foreground"><span>{dateFmt(i.date)}</span>
          <span className={i.dir === 'in' ? 'text-success' : ''}>{i.dir === 'in' ? '+' : '−'}{money(i.amount, i.currency)}</span><span className="num">{t('ppl.net')} {money(i.running)}</span></li>)}</ul></details>
    </li>)}</ul></Card>
  </div>;
}
