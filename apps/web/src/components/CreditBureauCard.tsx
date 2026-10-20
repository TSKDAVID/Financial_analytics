import { Link } from 'react-router-dom';
import { Gauge } from 'lucide-react';
import { useT } from '../lib/i18n';
import { useApi } from '../lib/hooks';
import { money, dateFmt } from '../lib/format';
import { Badge, Card } from './ui';

/** Creditinfo score / rating from the latest imported credit report (Risk page). */
export function CreditBureauCard() {
  const t = useT(); const c = useApi<any>('/credit-reports/latest');
  if (!c.data) return null;
  const title = <span className="flex items-center gap-2"><Gauge className="h-4 w-4 text-primary" />{t('cr.riskTitle')}</span>;
  if (c.data.none) return <Card title={title}><p className="text-sm text-muted-foreground">{t('cr.riskNone')} <Link className="text-primary underline" to="/import#credit">→</Link></p></Card>;
  const d = c.data; const r = String(d.rating ?? '');
  const tone = /^[AB]/.test(r) ? 'success' : /^C/.test(r) ? 'warning' : 'danger';
  return <Card title={title} subtitle={`${t('cr.reportDate')}: ${dateFmt(d.reportDate)}`}>
    <div className="grid grid-cols-2 gap-4 md:grid-cols-6 items-center">
      <div><div className="text-xs text-muted-foreground">{t('cr.score')}</div><div className="text-3xl font-bold num">{d.score ?? '—'}</div></div>
      <div><div className="text-xs text-muted-foreground">{t('cr.rating')}</div><Badge tone={tone} className="text-base">{d.rating ?? '—'}</Badge></div>
      <div><div className="text-xs text-muted-foreground">{t('cr.pd')}</div><div className="font-semibold num">{d.defaultProbability != null ? `${d.defaultProbability}%` : '—'}</div></div>
      <div><div className="text-xs text-muted-foreground">{t('cr.totalDebt')}</div><div className="font-semibold num">{money(d.summary?.totalDebt ?? d.activeTotals.balance)}</div></div>
      <div><div className="text-xs text-muted-foreground">{t('cr.monthly')}</div><div className="font-semibold num">{money(d.summary?.monthlyPayments ?? d.activeTotals.monthly)}</div></div>
      <div><div className="text-xs text-muted-foreground">{t('cr.penaltiesAcc')}</div><div className="font-semibold num">{money(d.activeTotals.penalties)}</div></div>
    </div>
    {d.summary?.factors?.length > 0 && <ul className="mt-3 space-y-1 text-xs text-muted-foreground">{d.summary.factors.map((f: any) => <li key={f.code}><b className="text-foreground">{f.code}</b> — {f.description}</li>)}</ul>}
  </Card>;
}
