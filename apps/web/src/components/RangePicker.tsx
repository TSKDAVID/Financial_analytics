import { addMonths, startOfMonth } from '@fa/core';
import { useT } from '../lib/i18n';
import { today } from '../lib/format';
import { Tabs } from './ui';

export type RangeKey = '1m' | '3m' | '6m' | '12m' | 'all';
/** from/to for a quick range ending today ("all" = no limit). */
export function rangeOf(k: RangeKey): { from?: string; to?: string } {
  if (k === 'all') return {};
  const n = { '1m': 0, '3m': 2, '6m': 5, '12m': 11 }[k];
  return { from: startOfMonth(addMonths(today(), -n)), to: today() };
}
export function RangePicker({ value, onChange }: { value: RangeKey; onChange: (k: RangeKey) => void }) {
  const t = useT();
  return <Tabs<RangeKey> value={value} onChange={onChange} options={(['1m', '3m', '6m', '12m', 'all'] as RangeKey[]).map((k) => ({ value: k, label: t('range.' + k) }))} />;
}
