import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, BellRing, Check, Clock, X, RefreshCw, CreditCard } from 'lucide-react';
import { useT } from '../lib/i18n';
import { useApi, useAction } from '../lib/hooks';
import { post } from '../lib/api';
import { dateFmt } from '../lib/format';
import { MarkOverdueButton } from '../components/OverdueBills';
import { Badge, Button, Card, Empty, PageHeader, Spinner, Tabs, cn } from '../components/ui';
import { sevIcon, sevColor } from '../components/shared';

const LINK: Record<string, string> = { bill: '/subscriptions', loan: '/loans', budget: '/budgets', risk: '/risk', utility: '/subscriptions', anomaly: '/transactions' };

export default function Alerts() {
  const t = useT(); const nav = useNavigate(); const { run, busy } = useAction();
  const [all, setAll] = useState<'active' | 'all'>('active');
  const d = useApi<{ items: any[]; unread: number }>(all === 'all' ? '/alerts?all=1' : '/alerts');
  const [snooze, setSnooze] = useState<number | null>(null);
  const perm = 'Notification' in window ? Notification.permission : 'denied';
  const act = (id: number, a: string, body?: unknown) => run(() => post(`/alerts/${id}/${a}`, body ?? {}));
  if (!d.data) return <Spinner />;
  return <div className="space-y-4">
    <PageHeader title={t('alerts.title')} subtitle={`${d.data.unread} unread`} actions={<>
      <MarkOverdueButton />
      {perm === 'default' && <Button variant="outline" onClick={() => Notification.requestPermission().then(() => location.reload())}><BellRing className="h-4 w-4" />{t('alerts.enableDesktop')}</Button>}
      <Button variant="outline" loading={busy} onClick={() => run(() => post('/alerts/evaluate'), '✓')}><RefreshCw className="h-4 w-4" />{t('alerts.check')}</Button>
      <Button variant="outline" onClick={() => run(() => post('/alerts/read-all'))}><Check className="h-4 w-4" />{t('alerts.readAll')}</Button></>} />
    <Tabs value={all} onChange={setAll} options={[{ value: 'active', label: t('common.active') }, { value: 'all', label: t('common.all') }]} />
    {!d.data.items.length ? <Card><Empty icon={<Bell className="h-6 w-6" />} title={t('alerts.none')} /></Card> :
      <div className="space-y-2">{d.data.items.map((a) => { const I = sevIcon[a.severity as 'info']; return (
        <div key={a.id} className={cn('flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border bg-card p-4 transition', !a.read && 'border-l-4', !a.read && (a.severity === 'danger' ? 'border-l-danger' : a.severity === 'warning' ? 'border-l-warning' : 'border-l-sky-500'), (a.dismissed || a.read) && 'opacity-70')}>
          <div className="flex items-start gap-3 flex-1 min-w-0 cursor-pointer" onClick={() => { act(a.id, 'read'); nav(LINK[a.type] ?? '/'); }}>
            <span className={cn('rounded-lg p-2 shrink-0', sevColor[a.severity as 'info'])}><I className="h-4 w-4" /></span>
            <div className="min-w-0"><div className="font-medium flex items-center gap-2 flex-wrap">{a.title}{!a.read && <Badge tone="primary">new</Badge>}{a.snoozed_until && <Badge><Clock className="h-3 w-3" />{dateFmt(a.snoozed_until, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Badge>}{!!a.dismissed && <Badge>dismissed</Badge>}</div>
              <div className="text-sm text-muted-foreground">{a.body}</div><div className="text-[11px] text-muted-foreground mt-0.5">{dateFmt(a.created_at.replace(' ', 'T') + 'Z', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div></div>
          </div>
          <div className="flex gap-1 flex-wrap relative">
            {a.ref_type === 'bill' && !a.dismissed && <Button size="sm" onClick={() => run(() => post(`/bills/${a.ref_id}/pay`), t('common.paid'))}><CreditCard className="h-4 w-4" />{t('sub.pay')}</Button>}
            {!a.read && <Button size="sm" variant="ghost" onClick={() => act(a.id, 'read')}><Check className="h-4 w-4" /></Button>}
            <Button size="sm" variant="ghost" onClick={() => setSnooze(snooze === a.id ? null : a.id)}><Clock className="h-4 w-4" />{t('alerts.snooze')}</Button>
            {!a.dismissed && <Button size="sm" variant="ghost" onClick={() => act(a.id, 'dismiss')}><X className="h-4 w-4" /></Button>}
            {snooze === a.id && <div className="absolute right-0 top-10 z-10 rounded-lg border bg-card shadow-lg p-1 flex flex-col">{([['snooze.1h', 60], ['snooze.1d', 1440], ['snooze.3d', 4320], ['snooze.1w', 10080]] as const).map(([l, m]) =>
              <button key={l} className="px-3 py-1.5 text-sm text-left hover:bg-muted rounded" onClick={() => { act(a.id, 'snooze', { minutes: m }); setSnooze(null); }}>{t(l)}</button>)}</div>}
          </div>
        </div>); })}</div>}
  </div>;
}
