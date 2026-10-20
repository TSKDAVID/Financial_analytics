import { useState } from 'react';
import { CheckCheck, History, X } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useT } from '../lib/i18n';
import { useApi, useAction } from '../lib/hooks';
import { post } from '../lib/api';
import { money, dateFmt } from '../lib/format';
import { Badge, Button, Card, Modal } from './ui';

/** "Mark all overdue as paid": confirmation lists every installment; recorded on due dates; undo from the toast. */
export function MarkOverdueButton() {
  const t = useT(); const { run, busy } = useAction(); const qc = useQueryClient();
  const od = useApi<any[]>('/bills/overdue');
  const [open, setOpen] = useState(false);
  const list = od.data ?? [];
  if (!list.length) return null;
  const confirm = async () => {
    const r = await run(() => post<{ paid: number; ids: number[]; historical: number }>('/bills/pay-overdue', { ids: list.map((b) => b.id) }));
    setOpen(false);
    if (r) toast.success(t('od.done', { n: r.paid, h: r.historical }), { duration: 12000, action: { label: t('od.undo'), onClick: async () => { await post('/bills/unpay-many', { ids: r.ids }); await qc.invalidateQueries(); toast(t('od.undone')); } } });
  };
  const pre = list.filter((b) => b.pre_tracking); const counted = list.filter((b) => !b.pre_tracking);
  return <>
    <Button variant="outline" onClick={() => setOpen(true)}><CheckCheck className="h-4 w-4" />{t('od.button', { n: list.length })}</Button>
    {open && <Modal open onClose={() => setOpen(false)} title={t('od.title', { n: list.length })} footer={<><Button variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button><Button loading={busy} onClick={confirm}>{t('od.confirm')}</Button></>}>
      <p className="text-sm text-muted-foreground mb-3">{t('od.hint')}</p>
      <ul className="divide-y max-h-[50vh] overflow-auto text-sm">{list.map((b) => <li key={b.id} className="py-2 flex items-center gap-2">
        <span className="flex-1 min-w-0 truncate">{b.name}</span><span className="text-xs text-muted-foreground">{dateFmt(b.due_date)}</span>
        {b.pre_tracking ? <Badge><History className="h-3 w-3 mr-1 inline" />{t('od.history')}</Badge> : <Badge tone="warning">{t('od.expense')}</Badge>}
        <span className="num w-24 text-right">{money(b.amount, b.currency)}</span></li>)}</ul>
      <div className="mt-3 text-xs text-muted-foreground">{t('od.summary', { e: counted.length, h: pre.length })}</div>
    </Modal>}
  </>;
}

/** One-time notice describing what the v1.4 clean-up changed. */
export function BillCleanupNotice() {
  const t = useT(); const { run } = useAction();
  const c = useApi<any>('/maintenance/bill-cleanup');
  const [more, setMore] = useState(false);
  const v = c.data; if (!v || v.seen || (!v.removed?.length && !v.redated?.length)) return null;
  return <Card className="border-warning/50 bg-warning/5">
    <div className="flex items-start gap-3"><div className="flex-1 text-sm">
      <div className="font-semibold mb-1">{t('od.cleanTitle')}</div>
      <div>{t('od.cleanBody', { n: v.removed.length, amount: money(v.removedTotal), r: v.redated.length })}</div>
      <button className="text-xs text-primary hover:underline mt-1" onClick={() => setMore(!more)}>{more ? t('od.hide') : t('od.details')}</button>
      {more && <ul className="mt-2 text-xs space-y-0.5">{[...v.removed.map((x: any) => ({ ...x, a: 'removed' })), ...v.redated.map((x: any) => ({ ...x, a: 'redated' }))].map((x: any, i: number) =>
        <li key={i}>{x.a === 'removed' ? '✕' : '↺'} {x.name} · {t('od.due')} {dateFmt(x.due_date)} · {money(x.amount, x.currency)} {x.a === 'removed' ? `(${t('od.wasOn')} ${dateFmt(x.tx_date)})` : `(${dateFmt(x.tx_date)} → ${dateFmt(x.due_date)})`}</li>)}</ul>}
    </div><Button variant="ghost" size="icon" onClick={() => run(() => post('/maintenance/bill-cleanup/seen'))}><X className="h-4 w-4" /></Button></div>
  </Card>;
}
