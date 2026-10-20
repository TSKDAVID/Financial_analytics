import { useApi } from '../lib/hooks';
import { useT } from '../lib/i18n';
import { Select } from './ui';
import { CURRENCIES } from '../lib/format';

export interface Category { id: number; key: string | null; name: string; kind: 'income' | 'expense'; parent_id: number | null; color: string; icon: string; essential: number; builtin: number; archived: number }
export interface Account { id: number; name: string; type: string; currency: string; balance: number; balance_gel: number; color: string; archived: number; bank: string | null; liquid: number; opening_balance: number }

export function useCategories() { return useApi<Category[]>('/categories'); }
export function useAccounts() { return useApi<Account[]>('/accounts'); }

export function CategorySelect({ value, onChange, kind, allowEmpty = true, className }: { value: number | null | undefined; onChange: (v: number | null) => void; kind?: 'income' | 'expense' | null; allowEmpty?: boolean | string; className?: string }) {
  const t = useT(); const { data = [] } = useCategories();
  const list = data.filter((c) => !c.archived && (!kind || c.kind === kind));
  const parents = list.filter((c) => !c.parent_id);
  const groups = (['income', 'expense'] as const).filter((k) => !kind || k === kind);
  return (
    <Select className={className} value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      {allowEmpty && <option value="">{typeof allowEmpty === 'string' ? allowEmpty : `— ${t('common.none')} —`}</option>}
      {groups.map((g) => (
        <optgroup key={g} label={t(g === 'income' ? 'common.income' : 'common.expense')}>
          {parents.filter((p) => p.kind === g).flatMap((p) => [
            <option key={p.id} value={p.id}>{p.name}</option>,
            ...list.filter((c) => c.parent_id === p.id).map((c) => <option key={c.id} value={c.id}>{'\u00A0\u00A0\u00A0↳ ' + c.name}</option>),
          ])}
        </optgroup>))}
    </Select>
  );
}
export function AccountSelect({ value, onChange, allowEmpty = true, className }: { value: number | null | undefined; onChange: (v: number | null) => void; allowEmpty?: boolean | string; className?: string }) {
  const t = useT(); const { data = [] } = useAccounts();
  return <Select className={className} value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
    {allowEmpty && <option value="">{typeof allowEmpty === 'string' ? allowEmpty : `— ${t('common.none')} —`}</option>}
    {data.filter((a) => !a.archived || a.id === value).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
  </Select>;
}
export function CurrencySelect({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  return <Select className={className} value={value} onChange={(e) => onChange(e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select>;
}
export function UnitSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  return <Select value={value} onChange={(e) => onChange(e.target.value)}>{['day', 'week', 'month', 'year'].map((u) => <option key={u} value={u}>{t('unit.' + u)}</option>)}</Select>;
}
