import { useT } from '../lib/i18n';
import { useApi, useAction } from '../lib/hooks';
import { post } from '../lib/api';
import { Button, Card } from './ui';

/** One-time explanation of the v1.2.1 analytics correction (own transfers / people flows no longer P&L). */
export function AnalyticsFixNotice() {
  const t = useT(); const d = useApi<any>('/maintenance/analytics-fix'); const { run, busy } = useAction();
  const f = d.data; if (!f || f.seen || !f.before) return null;
  const n = (v: number) => Math.round(v).toLocaleString();
  return <Card className="border-primary/40 bg-primary/5"><div className="flex flex-wrap items-start justify-between gap-3 text-sm">
    <div><b>{t('fix.title')}</b><p className="mt-1 text-muted-foreground">{t('fix.body', { pairs: f.transferPairs, bi: n(f.before.income), ai: n(f.after.income), be: n(f.before.expense), ae: n(f.after.expense) })}</p></div>
    <Button size="sm" loading={busy} onClick={() => run(() => post('/maintenance/analytics-fix/seen'))}>{t('fix.ok')}</Button></div></Card>;
}
