import { createElement } from 'react';
import TR, { act } from 'react-test-renderer';
import { api, reset } from './engine-node';
import { Accounts, Categories, Dashboard, Recurring, Transactions, TxForm } from '../src/screens/money';
import { Alerts, Budgets, Forecast, Insights, Loans, Reports, Risk, Schedule, Subscriptions } from '../src/screens/plan';
import { CardTermsScreen, ImportGroupsScreen, PeopleScreen, MerchantsScreen } from '../src/screens/extra';
import { BatchScreen, CreditReportScreen, ImportScreen, More, SettingsScreen, SyncScreen } from '../src/screens/app';
import { ErrorBoundary } from '../src/ErrorBoundary';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const SCREENS: Record<string, [any, any?]> = {
  dashboard: [Dashboard], more: [More], txForm: [TxForm], transactions: [Transactions], accounts: [Accounts], categories: [Categories], recurring: [Recurring],
  loans: [Loans], schedule: [Schedule, 'loan'], subscriptions: [Subscriptions], budgets: [Budgets], forecast: [Forecast], insights: [Insights], risk: [Risk], alerts: [Alerts], reports: [Reports],
  import: [ImportScreen], batch: [BatchScreen, { id: 1 }], importGroups: [ImportGroupsScreen, { id: 1 }], people: [PeopleScreen], merchants: [MerchantsScreen],
  cardTerms: [CardTermsScreen, 'loan'], editTx: [TxForm, 'tx'], accountTx: [Transactions, 'acct'], creditReport: [CreditReportScreen, { id: 1 }], sync: [SyncScreen], settings: [SettingsScreen],
};
const nav = { push: () => undefined, back: () => undefined, tab: () => undefined };
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };

async function seed() {
  const a = await api<any>('/accounts', { body: { name: 'Main bank', type: 'bank', opening_date: '2025-01-01' } });
  const cats = await api<any[]>('/categories'); const cat = (k: string) => cats.find((c) => c.key === k)?.id;
  const today = new Date();
  for (let m = 0; m < 6; m++) {
    const d = new Date(today.getFullYear(), today.getMonth() - m, 5).toISOString().slice(0, 10);
    await api('/transactions', { body: { kind: 'income', amount: 3000, date: d, account_id: a.id, category_id: cat('salary'), description: 'Employer' } });
    await api('/transactions', { body: { kind: 'expense', amount: 120 + m, date: d, account_id: a.id, category_id: cat('groceries'), description: 'Supermarket' } });
    await api('/transactions', { body: { kind: 'expense', amount: 500, date: d, account_id: a.id, category_id: cat('rent'), description: 'Rent' } });
  }
  await api('/loans', { body: { name: 'Car', bank: 'Bank', principal: 5000, annual_rate: 12, term_months: 24, start_date: '2026-01-10' } }).catch(() => undefined);
  await api('/recurring', { body: { name: 'Internet', kind: 'expense', amount: 50, frequency: 'monthly', start_date: '2026-01-15', account_id: a.id, category_id: cat('internet') } }).catch(() => undefined);
  await api('/budgets', { body: { category_id: cat('groceries'), amount: 300, period: 'monthly' } }).catch(() => undefined);
}

async function main() {
let failed = 0;
const texts = (n: any): string => (n == null ? '' : typeof n === 'string' ? n : Array.isArray(n) ? n.map(texts).join(' ') : texts(n.children));
for (const mode of ['empty', 'data'] as const) {
  reset(); if (mode === 'data') await seed();
  const loans = await api<any[]>('/loans'); const txs = await api<any>('/transactions'); const accts = await api<any[]>('/accounts');
  const P: Record<string, any> = { loan: { loan: loans[0] ?? { id: 999, name: 'Card', principal: 0, revolving: 1 } }, tx: { tx: txs.items?.[0] ?? txs.rows?.[0] ?? (Array.isArray(txs) ? txs[0] : undefined) }, acct: { account_id: accts[0]?.id ?? 999, title: 'Acct' } };
  for (const [name, [C, p0]] of Object.entries(SCREENS)) {
    const params = typeof p0 === 'string' ? P[p0] : p0 ?? {};
    const errs: string[] = []; const ce = console.error; console.error = (...a: any[]) => { errs.push(a.map(String).join(' ')); };
    let caught: string | null = null; let r: any;
    try {
      await act(async () => { r = TR.create(createElement(ErrorBoundary, { onError: (e: any) => { caught = e?.message ?? String(e); } } as any, createElement(C, { nav, params }))); });
      await flush();
      const shown = texts(r.toJSON()); if (!caught && shown.includes('Something went wrong')) caught = shown.match(/Something went wrong[\s\S]{0,400}/)?.[0] ?? 'error boundary';
      await act(async () => { r.update(createElement(ErrorBoundary, null as any, createElement(C, { nav, params }))); }); await flush();
      await act(async () => { r.unmount(); });
    } catch (e: any) { caught = e?.message ?? String(e); }
    console.error = ce;
    const hookErr = errs.find((e) => /hook|Rendered (more|fewer)/i.test(e));
    if (caught || hookErr) { failed++; console.log(`FAIL ${mode} ${name}: ${caught ?? hookErr}`); } else console.log(`ok   ${mode} ${name}`);
  }
}
if (failed) { console.log(`${failed} screen render(s) failed`); process.exit(1); }
console.log('all screens rendered (empty + data)'); process.exit(0);
}
main().catch((e) => { console.log('FAIL', e); process.exit(1); });
