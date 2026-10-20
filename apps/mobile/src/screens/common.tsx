import { View } from 'react-native';
import { Btn, Empty, Pick } from '../ui';
import { useQ, CURRENCIES } from '../lapi';

export interface Nav { push: (name: string, params?: any) => void; back: () => void; tab: (t: string) => void }
export interface ScreenProps { nav: Nav; params?: any }

/** Shown instead of scores / forecasts / insights while there's no income & expense history. */
export function NoData({ nav, what }: { nav: Nav; what?: string }) {
  return <Empty icon="📊" title={what ?? 'Add income and expenses to see this'} body="Scores, forecasts and alerts need at least one income and one expense. Nothing here is estimated from empty data."
    action={<View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}><Btn small title="Add transaction" onPress={() => nav.push('txForm')} /><Btn small kind="outline" title="Import statement" onPress={() => nav.push('import')} /></View>} />;
}
export function AccountPick({ value, onChange, label = 'Account', allowNone = true }: { value: number | null; onChange: (v: number | null) => void; label?: string; allowNone?: boolean }) {
  const a = useQ<any[]>('/accounts');
  return <Pick label={label} value={value} onChange={onChange} options={[...(allowNone ? [{ value: null, label: 'None' }] : []), ...(a.data ?? []).filter((x) => !x.archived).map((x) => ({ value: x.id, label: x.name, color: x.color }))]} />;
}
export function CategoryPick({ value, onChange, kind }: { value: number | null; onChange: (v: number | null) => void; kind?: 'income' | 'expense' }) {
  const c = useQ<any[]>('/categories');
  return <Pick label="Category" value={value} onChange={onChange} options={[{ value: null, label: 'Uncategorized' }, ...(c.data ?? []).filter((x) => !x.archived && (!kind || x.kind === kind)).map((x) => ({ value: x.id, label: x.name, color: x.color }))]} />;
}
export const CurrencyPick = ({ value, onChange }: { value: string; onChange: (v: string) => void }) =>
  <Pick label="Currency" value={value} onChange={onChange} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />;
export const UNITS = [{ value: 'day', label: 'Daily' }, { value: 'week', label: 'Weekly' }, { value: 'month', label: 'Monthly' }, { value: 'year', label: 'Yearly' }] as const;
export const num = (s: any) => (s === '' || s == null ? null : Number(String(s).replace(',', '.')));
