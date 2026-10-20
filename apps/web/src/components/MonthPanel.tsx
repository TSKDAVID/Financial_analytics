import { useT } from '../lib/i18n';
import { useApi } from '../lib/hooks';
import { money, monthFmt, pct } from '../lib/format';
import { Modal, Spinner, Stat } from './ui';

/** One month at a glance: opened by clicking a month in the dashboard trend chart. */
export function MonthPanel({ month, onClose }: { month: string | null; onClose: () => void }) {
  const t = useT();
  const d = useApi<any>(month ? `/month-summary?month=${month}` : null);
  const x = d.data;
  const max = x?.byCategory?.[0]?.total || 1;
  return <Modal open={!!month} onClose={onClose} wide title={month ? t('month.title', { month: monthFmt(month, false) }) : ''}>
    {!x || x.month !== month ? <Spinner /> : <div className="space-y-4 text-sm">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2"><Stat label={t('common.income')} value={money(x.income)} /><Stat label={t('common.expense')} value={money(x.expense)} />
        <Stat label={t('dash.netCashFlow')} value={<span className={x.net < 0 ? 'text-danger' : 'text-success'}>{money(x.net, 'GEL', { sign: true })}</span>} /><Stat label="%" value={x.savingsRate === null ? '—' : pct(x.savingsRate)} /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><h4 className="mb-1 font-semibold">{t('month.byCategory')}</h4><ul className="space-y-1">{x.byCategory.map((c: any) => <li key={c.name}>
          <div className="flex justify-between"><span>{c.name} <span className="text-xs text-muted-foreground">×{c.count}</span></span><span className="num">{money(c.total)}</span></div>
          <div className="h-1.5 rounded bg-muted"><div className="h-1.5 rounded" style={{ width: `${(c.total / max) * 100}%`, background: c.color }} /></div></li>)}</ul></div>
        <div className="space-y-3">
          <div><h4 className="mb-1 font-semibold">{t('month.topMerchants')}</h4><ul className="space-y-0.5">{x.topMerchants.map((m: any) => <li key={m.name} className="flex justify-between"><span>{m.name} <span className="text-xs text-muted-foreground">×{m.count}</span></span><span className="num">{money(m.total)}</span></li>)}</ul></div>
          <div><h4 className="mb-1 font-semibold">{t('month.incomeBy')}</h4><ul className="space-y-0.5">{x.incomeBy.map((m: any) => <li key={m.name} className="flex justify-between"><span>{m.name}</span><span className="num text-success">{money(m.total)}</span></li>)}</ul></div>
          {x.movedOwn > 0 && <p className="text-xs text-muted-foreground">{t('month.moved', { amount: money(x.movedOwn) })}</p>}
        </div></div></div>}
  </Modal>;
}
