import { useState } from 'react';
import { RefreshCw, ArrowDownToLine, ArrowUpFromLine, AlertTriangle } from 'lucide-react';
import { useT } from '../lib/i18n';
import { useApi, useAction } from '../lib/hooks';
import { post } from '../lib/api';
import { dateFmt } from '../lib/format';
import { Badge, Button, Modal, cn } from './ui';

const TABLE_KEYS: Record<string, string> = { accounts: 'nav.accounts', categories: 'nav.categories', recurring: 'nav.recurring', loans: 'nav.loans', subscriptions: 'nav.subscriptions', bills: 'sync.bills', transactions: 'nav.transactions', budgets: 'nav.budgets', goals: 'sync.goals', settings: 'nav.settings' };

export function SummaryView({ s, here, there }: { s: any; here: string; there: string }) {
  const t = useT();
  const block = (dir: 'toLocal' | 'toRemote', title: string, Icon: any) => {
    const e = Object.entries(s[dir] ?? {}) as [string, any][];
    if (!e.length) return null;
    return <div><div className="mb-1 flex items-center gap-2 text-sm font-medium"><Icon className="h-4 w-4" />{title}</div>
      <ul className="space-y-0.5 text-sm">{e.map(([tb, c]) => <li key={tb} className="flex justify-between gap-3"><span>{t(TABLE_KEYS[tb] ?? tb)}</span><span className="text-muted-foreground num">
        {c.added ? `+${c.added} ` : ''}{c.edited ? `✎${c.edited} ` : ''}{c.deleted ? `−${c.deleted}` : ''}</span></li>)}</ul></div>;
  };
  return <div className="space-y-3">
    {block('toLocal', t('sync.toHere', { name: here }), ArrowDownToLine)}
    {block('toRemote', t('sync.toThere', { name: there }), ArrowUpFromLine)}
    {s.samples?.length > 0 && <ul className="rounded-lg bg-muted/40 p-2 text-xs space-y-0.5">{s.samples.map((x: any, i: number) => <li key={i} className="flex justify-between gap-2"><span className="truncate">{x.kind === 'added' ? '+' : x.kind === 'edited' ? '✎' : '−'} {x.label}</span><span className="text-muted-foreground shrink-0">{t(TABLE_KEYS[x.table] ?? x.table)} · {x.newer === 'local' ? here : there} {t('sync.newer')}</span></li>)}</ul>}
  </div>;
}

/** Shown on the desktop when a paired phone connected and there are differences. Nothing syncs without approval. */
export function SyncPrompt() {
  const t = useT();
  const offers = useApi<any[]>('/sync/offers', { refetchInterval: 15000 });
  const [hidden, setHidden] = useState<Record<string, string>>({});
  const [choices, setChoices] = useState<Record<string, 'local' | 'remote'>>({});
  const { run, busy } = useAction();
  const o = (offers.data ?? []).find((x) => x.summary.total > 0 && hidden[x.peer] !== x.received_at);
  if (!o) return null;
  const unresolved = o.conflicts.filter((c: any) => !choices[c.key]).length;
  return <Modal open onClose={() => setHidden({ ...hidden, [o.peer]: o.received_at })} title={<span className="flex items-center gap-2"><RefreshCw className="h-4 w-4" />{t('sync.ask', { name: o.name })}</span>}
    footer={<><Button variant="ghost" onClick={() => setHidden({ ...hidden, [o.peer]: o.received_at })}>{t('sync.later')}</Button>
      <Button disabled={busy || unresolved > 0} onClick={() => run(() => post(`/sync/offers/${o.peer}/approve`, { choices }), t('sync.done'))}>{t('sync.yes')}</Button></>}>
    <p className="mb-3 text-sm text-muted-foreground">{t('sync.intro', { n: o.summary.total })}{o.lastSync ? ` · ${t('sync.last')}: ${dateFmt(o.lastSync.slice(0, 10))}` : ''}</p>
    <SummaryView s={o.summary} here={t('sync.desktop')} there={o.name} />
    {o.conflicts.length > 0 && <div className="mt-4 space-y-2"><div className="flex items-center gap-2 text-sm font-medium text-warning"><AlertTriangle className="h-4 w-4" />{t('sync.conflicts', { n: o.conflicts.length })}</div>
      {o.conflicts.map((c: any) => <div key={c.key} className="rounded-lg border p-2 text-xs"><div className="mb-1 font-medium">{t(TABLE_KEYS[c.table] ?? c.table)} · {c.label}</div>
        <div className="flex gap-2">{(['local', 'remote'] as const).map((side) => <button key={side} onClick={() => setChoices({ ...choices, [c.key]: side })}
          className={cn('flex-1 rounded-md border p-2 text-left', choices[c.key] === side && 'border-primary bg-primary/5')}>
          <Badge>{side === 'local' ? t('sync.desktop') : o.name}</Badge>
          <div className="mt-1 break-all text-muted-foreground">{(side === 'local' ? c.local : c.remote) ? Object.entries((side === 'local' ? c.local : c.remote).d).filter(([k, v]) => v != null && !['tags'].includes(k)).slice(0, 6).map(([k, v]) => `${k}: ${v}`).join(' · ') : t('sync.deletedHere')}</div></button>)}</div></div>)}</div>}
  </Modal>;
}
