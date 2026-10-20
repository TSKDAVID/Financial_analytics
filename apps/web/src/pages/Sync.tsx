import { Undo2, RefreshCw } from 'lucide-react';
import { useT } from '../lib/i18n';
import { useApi, useAction } from '../lib/hooks';
import { post } from '../lib/api';
import { Badge, Button, Card, Empty, PageHeader } from '../components/ui';
import { SummaryView } from '../components/SyncPrompt';

export default function Sync() {
  const t = useT();
  const hist = useApi<any[]>('/sync/history');
  const offers = useApi<any[]>('/sync/offers', { refetchInterval: 15000 });
  const { run } = useAction();
  const latest = hist.data?.find((h) => !h.undone_at);
  return <div className="space-y-5 max-w-4xl">
    <PageHeader title={t('sync.title')} subtitle={t('sync.subtitle')} />
    <Card title={<span className="flex items-center gap-2"><RefreshCw className="h-4 w-4" />{t('sync.connected')}</span>}>
      {!offers.data?.length ? <p className="text-sm text-muted-foreground">{t('sync.noPhone')}</p> :
        <ul className="space-y-2">{offers.data.map((o) => <li key={o.peer} className="flex items-center justify-between rounded-lg bg-muted/40 p-3 text-sm"><span><b>{o.name}</b> · {o.summary.total ? t('sync.intro', { n: o.summary.total }) : t('sync.upToDate')}</span>
          {o.summary.total > 0 && <Badge tone="warning">{t('sync.pending')}</Badge>}</li>)}</ul>}
    </Card>
    <Card title={t('sync.history')}>
      {!hist.data?.length ? <Empty title={t('sync.none')} /> : <ul className="divide-y">{hist.data.map((h) => <li key={h.id} className="py-3">
        <div className="flex items-center justify-between gap-3 text-sm"><span><b>{h.peer_name}</b> · {new Date(h.created_at).toLocaleString()}</span>
          {h.undone_at ? <Badge>{t('sync.undone')}</Badge> : h.id === latest?.id && <Button size="sm" variant="outline" onClick={() => confirm(t('sync.undoConfirm')) && run(() => post(`/sync/undo/${h.id}`, {}), t('sync.undone'))}><Undo2 className="h-4 w-4" />{t('sync.undo')}</Button>}</div>
        <div className="mt-2"><SummaryView s={h.summary} here={t('sync.desktop')} there={h.peer_name} /></div></li>)}</ul>}
    </Card>
  </div>;
}
