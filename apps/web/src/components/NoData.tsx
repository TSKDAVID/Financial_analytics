import { Link } from 'react-router-dom';
import { BarChart3 } from 'lucide-react';
import { useT } from '../lib/i18n';
import { Button, cn } from './ui';
import { openNewTx } from './Layout';

/** Shown instead of scores / forecasts / insights while there is no income & expense history. */
export function NoData({ compact, className, what }: { compact?: boolean; className?: string; what?: string }) {
  const t = useT();
  return <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'gap-2 py-4' : 'gap-3 py-12', className)}>
    <BarChart3 className={cn('text-muted-foreground', compact ? 'h-6 w-6' : 'h-10 w-10')} />
    <p className={cn('max-w-sm', compact ? 'text-sm' : 'text-base font-medium')}>{what ?? t('nodata.title')}</p>
    {!compact && <p className="max-w-md text-sm text-muted-foreground">{t('nodata.body')}</p>}
    <div className="flex flex-wrap justify-center gap-2"><Button size="sm" onClick={openNewTx}>{t('nodata.add')}</Button><Link to="/import"><Button size="sm" variant="outline">{t('nodata.import')}</Button></Link></div>
  </div>;
}
