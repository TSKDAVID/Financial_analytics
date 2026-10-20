import { useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { Badge, Bar, Btn, Card, Chip, Empty, H2, Input, Loading, NumInput, Pick, Row, Screen, Seg, Sep, Sheet, Stat, T, Toggle, useColors } from '../ui';
import { Bars, Donut, LineChart } from '../charts';
import { act, del, money, pct, post, put, useQ, dateFmt, monthFmt, todayISO, CHART_COLORS } from '../lapi';
import { OverdueButton, BillCleanupNotice, AnalyticsFixNotice, MonthSheet } from './extra';
import { AccountPick, CategoryPick, CurrencyPick, NoData, UNITS, num, type ScreenProps } from './common';

// ---------- Dashboard ----------
export function Dashboard({ nav }: ScreenProps) {
  const c = useColors(); const d = useQ<any>('/dashboard'); const ins = useQ<any[]>('/insights'); const bills = useQ<any[]>('/bills/upcoming');
  if (!d.data) return <Loading />;
  const x = d.data; const ok = x.dataStatus?.sufficient;
  const [month, setMonth] = useState<string | null>(null);
  return <Screen title="Overview" onRefresh={d.reload} fab={{ label: 'Transaction', onPress: () => nav.push('txForm') }}>
    <Card style={{ backgroundColor: c.primary, borderWidth: 0 }}>
      <Text style={{ color: '#ffffffcc', fontSize: 13 }}>Net worth</Text>
      <Text style={{ color: '#fff', fontSize: 32, fontWeight: '800', marginTop: 2 }}>{money(x.netWorth)}</Text>
      <View style={{ flexDirection: 'row', marginTop: 10, gap: 16 }}><Text style={{ color: '#ffffffcc', fontSize: 12 }}>Assets {money(x.totalAssets, 'GEL', true)}</Text><Text style={{ color: '#ffffffcc', fontSize: 12 }}>Debt {money(x.totalDebt, 'GEL', true)}</Text></View>
    </Card>
    <BillCleanupNotice /><AnalyticsFixNotice /><OverdueButton />
    <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
      <Stat label="Income (month)" value={money(x.income)} tone={c.success} /><Stat label="Expenses (month)" value={money(x.expense)} tone={c.danger} />
    </View>
    <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
      <Stat label="Net" value={money(x.net)} tone={x.net >= 0 ? c.success : c.danger} />
      <Stat label="Savings rate" value={ok && x.income > 0 ? pct(x.savingsRate) : '—'} sub={ok ? undefined : 'needs income & expenses'} />
    </View>
    {!ok ? <Card><NoData nav={nav} what="Add income and expenses to see trends" /></Card> : <>
      <Card><H2>Last 12 months</H2><T muted style={{ fontSize: 11 }}>Tap a month for details</T><View style={{ height: 8 }} /><Bars data={x.trend} keys={['income', 'expense']} colors={[c.success, c.danger]} label={(d) => monthFmt(d.month)} onPick={(d) => setMonth(d.month)} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>{x.trend.slice(-6).map((m: any) => <Btn key={m.month} small kind="outline" title={monthFmt(m.month)} onPress={() => setMonth(m.month)} />)}</View></Card>
      <MonthSheet month={month} onClose={() => setMonth(null)} />
      {x.byCategory.length > 0 && <Card><H2>Spending by category</H2><View style={{ height: 10 }} /><Donut data={x.byCategory.slice(0, 7).map((k: any, i: number) => ({ label: k.name, value: k.total, color: k.color ?? CHART_COLORS[i % 10] }))} /></Card>}
    </>}
    {(bills.data ?? []).length > 0 && <Card><H2 right={<Btn small kind="ghost" title="All" onPress={() => nav.push('subscriptions')} />}>Upcoming bills</H2>
      {(bills.data ?? []).slice(0, 5).map((b) => <Row key={b.id} title={b.name} sub={dateFmt(b.due_date)} right={money(b.amount, b.currency)} dot={b.category_color ?? c.warning} icon={b.type === 'loan' ? '🏦' : '🧾'} onPress={() => nav.push('subscriptions')} />)}</Card>}
    {ok && (ins.data ?? []).length > 0 && <Card><H2 right={<Btn small kind="ghost" title="All" onPress={() => nav.push('insights')} />}>Insights</H2>{(ins.data ?? []).slice(0, 3).map((i, k) => <InsightRow key={k} i={i} />)}</Card>}
    <Card><H2>Accounts</H2>{(x.accounts ?? []).map((a: any) => <Row key={a.id} title={a.name} sub={a.bank ?? a.type} right={money(a.balance, a.currency)} dot={a.color} icon="◼" onPress={() => nav.push('transactions', { account_id: a.id, title: a.name })} />)}
      {!(x.accounts ?? []).length && <Empty icon="🏦" title="No accounts yet" action={<Btn small title="Add account" onPress={() => nav.push('accounts')} />} />}</Card>
  </Screen>;
}
const INS: Record<string, string> = {
  mTop: 'Your biggest merchant is {merchant}: {amount} ₾ ({pct}% of merchant spending) in {count} payments.', mHabit: 'Habit: {count} payments at {merchant} (~{perWeek} a week), about {avg} ₾ each — roughly {monthly} ₾ a month.',
  mBasket: 'Average basket: {list}.', mCatUp: '{category} is up {pct}%: about {now} ₾/month in the last 3 months vs {before} ₾ before.', mCatDown: '{category} is down {pct}%: about {now} ₾/month in the last 3 months vs {before} ₾ before.',
  mSave: 'Where you could save: {merchant} costs about {monthly} ₾/month — 25% less would save ~{yearly} ₾ a year.', mWeekday: 'You spend most on {day}s — {pct}% above an average day.',
  pTop: 'You exchange the most money with {name}: {amount} ₾ in {count} transfers.', pTurnaround: 'Money between you and friends usually comes back within {days} days.', pRent: 'Rent paid to {name}: {amount} ₾ (counted as spending).', pMonthly: 'About {amount} ₾ a month goes back and forth with {people} people — not counted as spending or income.',
  mUp: '{merchant}: {amount} ₾ this month, {pct}% more than your usual {usual} ₾.', mSmall: '{count} small payments (under 10 ₾ each) added up to {amount} ₾ — mostly {names}.',
  catAbove: '{category} spending is on track to be {pct}% above your usual {avg} ₾/month.', catBelow: 'Nice — {category} spending is {pct}% below your average this month.',
  seasonWinter: 'Your {category} bill rises every winter — plan for higher bills in Nov–Feb.', seasonSummer: 'Your {category} bill peaks in summer.',
  savingsGood: 'You saved {pct}% of income over the last 3 months — great job.', savingsLow: 'You saved only {pct}% of income over the last 3 months. Aim for 20%.', savingsNegative: 'You spent more than you earned over the last 3 months ({pct}% savings rate).',
  subsYearly: 'Your {count} subscriptions cost {amount} ₾ per year.', subsUnused: 'Unused subscriptions: {names} — cancelling saves {amount} ₾/year.',
  anomaly: 'Unusual: {description} {amount} ₾ on {date} (~{times}× typical).', forecastBelow: 'Warning: your balance is forecast to drop below {min} ₾ in {month}.', forecastOk: 'Forecast: about {amount} ₾ available in {months} months.',
};
export const insightText = (i: any) => (INS[i.key] ?? i.key).replace(/\{(\w+)\}/g, (_, k) => String(i.params?.[k] ?? ''));
export function InsightRow({ i }: { i: any }) {
  const c = useColors(); const col = i.severity === 'danger' ? c.danger : i.severity === 'warning' ? c.warning : i.severity === 'success' ? c.success : c.primary;
  return <View style={{ flexDirection: 'row', gap: 10, paddingVertical: 8 }}><View style={{ width: 4, borderRadius: 2, backgroundColor: col }} /><T style={{ flex: 1 }}>{insightText(i)}</T></View>;
}

// ---------- Transactions ----------
export function Transactions({ nav, params }: ScreenProps) {
  const c = useColors(); const [q, setQ] = useState(''); const [kind, setKind] = useState<string>('');
  const qs = new URLSearchParams({ limit: '300', ...(q ? { q } : {}), ...(kind ? { kind } : {}), ...(params?.account_id ? { account_id: String(params.account_id) } : {}), ...(params?.category_id ? { category_id: String(params.category_id) } : {}) }).toString();
  const r = useQ<any>(`/transactions?${qs}`);
  return <Screen title={params?.title ?? 'Transactions'} back={params ? nav.back : undefined} scroll={false} fab={{ label: 'Add', onPress: () => nav.push('txForm', { account_id: params?.account_id }) }}>
    <View style={{ paddingHorizontal: 16, gap: 8 }}>
      <Input placeholder="Search description, notes, tags" value={q} onChangeText={setQ} />
      <View style={{ flexDirection: 'row' }}>{[['', 'All'], ['expense', 'Expenses'], ['income', 'Income'], ['transfer', 'Transfers']].map(([k, l]) => <Chip key={k} label={l} active={kind === k} onPress={() => setKind(k)} />)}</View>
      {r.data && <T muted style={{ fontSize: 12 }}>{r.data.total} transactions · in {money(r.data.income)} · out {money(r.data.expense)}</T>}
    </View>
    {!r.data ? <Loading /> : <FlatList data={r.data.rows} keyExtractor={(x) => String(x.id)} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }} ItemSeparatorComponent={Sep}
      ListEmptyComponent={<Empty title="No transactions" body="Add one with the + button or import a bank statement." action={<Btn small kind="outline" title="Import statement" onPress={() => nav.push('import')} />} />}
      renderItem={({ item: t }) => <Row title={t.description || t.category_name || t.kind} sub={`${dateFmt(t.date)} · ${t.category_name ?? 'Uncategorized'}${t.account_name ? ' · ' + t.account_name : ''}`}
        right={<Text style={{ fontWeight: '700', color: t.kind === 'income' ? c.success : t.kind === 'transfer' ? c.muted : c.text }}>{t.kind === 'income' ? '+' : t.kind === 'expense' ? '−' : ''}{money(t.amount, t.currency).replace('−', '')}</Text>}
        rightSub={t.currency !== 'GEL' ? money(t.amount_gel) : undefined} dot={t.category_color ?? c.muted} icon={t.kind === 'income' ? '↓' : t.kind === 'transfer' ? '⇄' : '↑'} onPress={() => nav.push('txForm', { tx: t })} />} />}
  </Screen>;
}
export function TxForm({ nav, params }: ScreenProps) {
  const t0 = params?.tx;
  const [f, setF] = useState<any>(t0 ? { ...t0, tags: (t0.tags ?? []).join(', ') } : { kind: 'expense', amount: '', currency: 'GEL', date: todayISO(), account_id: params?.account_id ?? null, to_account_id: null, category_id: null, description: '', notes: '', tags: '' });
  const set = (p: any) => setF({ ...f, ...p });
  const save = async () => {
    const body = { kind: f.kind, amount: num(f.amount), currency: f.currency, date: f.date, account_id: f.account_id, to_account_id: f.kind === 'transfer' ? f.to_account_id : null, category_id: f.kind === 'transfer' ? null : f.category_id, description: f.description || null, notes: f.notes || null, tags: String(f.tags || '').split(',').map((s) => s.trim()).filter(Boolean) };
    if (!body.amount) return Alert.alert('Enter an amount');
    if (await act(() => (t0 ? put(`/transactions/${t0.id}`, body) : post('/transactions', body)), 'Saved')) nav.back();
  };
  return <Screen title={t0 ? 'Edit transaction' : 'New transaction'} back={nav.back} actions={t0 && <Btn small kind="ghost" title="Delete" onPress={() => Alert.alert('Delete transaction?', '', [{ text: 'Cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { if (await act(() => del(`/transactions/${t0.id}`))) nav.back(); } }])} />}>
    <Seg value={f.kind} onChange={(k) => set({ kind: k })} options={[{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }, { value: 'transfer', label: 'Transfer' }]} />
    <NumInput label="Amount" value={f.amount} onChange={(v) => set({ amount: v })} style={{ fontSize: 26, fontWeight: '700' }} autoFocus={!t0} />
    <CurrencyPick value={f.currency} onChange={(v) => set({ currency: v })} />
    <Input label="Date (YYYY-MM-DD)" hint="The day it really happened. Dates before an account's balance date don't change that balance." value={f.date} onChangeText={(v) => set({ date: v })} />
    <View style={{ flexDirection: 'row', gap: 6 }}>{[0, 1, 7].map((n) => { const d = new Date(Date.now() - n * 864e5 - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10); return <Chip key={n} label={n === 0 ? 'Today' : n === 1 ? 'Yesterday' : 'Week ago'} active={f.date === d} onPress={() => set({ date: d })} />; })}</View>
    <Input label="Description" value={f.description ?? ''} onChangeText={(v) => set({ description: v })} placeholder="e.g. Carrefour" />
    <AccountPick value={f.account_id} onChange={(v) => set({ account_id: v })} label={f.kind === 'transfer' ? 'From account' : 'Account'} />
    {f.kind === 'transfer' ? <AccountPick value={f.to_account_id} onChange={(v) => set({ to_account_id: v })} label="To account" /> : <CategoryPick value={f.category_id} onChange={(v) => set({ category_id: v })} kind={f.kind} />}
    <Input label="Tags (comma separated)" value={f.tags} onChangeText={(v) => set({ tags: v })} />
    <Input label="Notes" value={f.notes ?? ''} onChangeText={(v) => set({ notes: v })} multiline />
    <Btn title="Save" onPress={save} />
  </Screen>;
}

// ---------- Accounts ----------
const ACC_TYPES = [{ value: 'bank', label: 'Bank' }, { value: 'card', label: 'Card' }, { value: 'cash', label: 'Cash' }, { value: 'savings', label: 'Savings' }];
const COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#64748b'];
export function Accounts({ nav }: ScreenProps) {
  const a = useQ<any[]>('/accounts'); const [edit, setEdit] = useState<any>(null);
  const total = (a.data ?? []).filter((x) => !x.archived).reduce((s, x) => s + x.balance_gel, 0);
  return <Screen title="Accounts" back={nav.back} fab={{ label: 'Account', onPress: () => setEdit({ name: '', type: 'bank', currency: 'GEL', opening_balance: '0', color: COLORS[0], bank: '', liquid: true }) }}>
    <Stat label="Total balance" value={money(total)} />
    <Card>{!a.data ? <Loading /> : !a.data.length ? <Empty icon="🏦" title="No accounts yet" body="Add your bank accounts, cards and cash." /> :
      a.data.map((x, i) => <View key={x.id}>{i > 0 && <Sep />}<Row title={x.name + (x.archived ? ' (archived)' : '')} sub={[x.bank, x.type, x.liquid ? null : 'not liquid'].filter(Boolean).join(' · ')} right={money(x.balance, x.currency)} rightSub={x.currency !== 'GEL' ? money(x.balance_gel) : undefined} dot={x.color} icon="◼"
        onPress={() => nav.push('transactions', { account_id: x.id, title: x.name })} /><View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: -8 }}><Btn small kind="ghost" title="Edit" onPress={() => setEdit({ ...x, opening_balance: String(x.opening_balance), liquid: !!x.liquid, archived: !!x.archived })} /></View></View>)}</Card>
    {edit && <Sheet open title={edit.id ? 'Edit account' : 'New account'} onClose={() => setEdit(null)} footer={<>
      {edit.id && <Btn kind="danger" title="Delete" onPress={() => Alert.alert('Delete account?', 'Transactions stay but lose their account.', [{ text: 'Cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { if (await act(() => del(`/accounts/${edit.id}`))) setEdit(null); } }])} />}
      <Btn title="Save" style={{ flex: 1 }} onPress={async () => { const b = { name: edit.name, type: edit.type, currency: edit.currency, opening_balance: num(edit.opening_balance) ?? 0, opening_date: /^\d{4}-\d{2}-\d{2}$/.test(edit.opening_date ?? '') ? edit.opening_date : null, color: edit.color, bank: edit.bank || null, liquid: edit.liquid, archived: !!edit.archived };
        if (await act(() => (edit.id ? put(`/accounts/${edit.id}`, b) : post('/accounts', b)), 'Saved')) setEdit(null); }} /></>}>
      <Input label="Name" value={edit.name} onChangeText={(v) => setEdit({ ...edit, name: v })} />
      <Pick label="Type" value={edit.type} options={ACC_TYPES} onChange={(v) => setEdit({ ...edit, type: v })} />
      <Input label="Bank" value={edit.bank ?? ''} onChangeText={(v) => setEdit({ ...edit, bank: v })} placeholder="TBC Bank" />
      <CurrencyPick value={edit.currency} onChange={(v) => setEdit({ ...edit, currency: v })} />
      <NumInput label="Opening balance" value={edit.opening_balance} onChange={(v) => setEdit({ ...edit, opening_balance: v })} />
      <Input label="Balance as of (YYYY-MM-DD)" hint="Only transactions after this date change the balance." value={edit.opening_date ?? ''} onChangeText={(v) => setEdit({ ...edit, opening_date: v })} placeholder="2026-10-20" />
      <Pick label="Color" value={edit.color} options={COLORS.map((c) => ({ value: c, label: '●', color: c }))} onChange={(v) => setEdit({ ...edit, color: v })} />
      <Toggle label="Counts as liquid savings" value={edit.liquid} onChange={(v) => setEdit({ ...edit, liquid: v })} />
      {edit.id && <Toggle label="Archived" value={edit.archived} onChange={(v) => setEdit({ ...edit, archived: v })} />}
    </Sheet>}
  </Screen>;
}

// ---------- Categories ----------
export function Categories({ nav }: ScreenProps) {
  const cats = useQ<any[]>('/categories'); const [kind, setKind] = useState<'expense' | 'income'>('expense'); const [edit, setEdit] = useState<any>(null);
  const list = (cats.data ?? []).filter((c) => c.kind === kind);
  const top = list.filter((c) => !c.parent_id);
  return <Screen title="Categories" back={nav.back} fab={{ label: 'Category', onPress: () => setEdit({ name: '', kind, color: COLORS[0], parent_id: null, essential: false }) }}>
    <Seg value={kind} onChange={setKind} options={[{ value: 'expense', label: 'Expenses' }, { value: 'income', label: 'Income' }]} />
    <Card>{top.map((p) => <View key={p.id}>
      <Row title={p.name} sub={[p.builtin ? 'built-in' : null, p.essential ? 'essential' : null].filter(Boolean).join(' · ')} dot={p.color} onPress={() => setEdit({ ...p, essential: !!p.essential })} right={<Btn small kind="ghost" title="›" onPress={() => nav.push('transactions', { category_id: p.id, title: p.name })} />} />
      {list.filter((c) => c.parent_id === p.id).map((ch) => <View key={ch.id} style={{ paddingLeft: 28 }}><Row title={ch.name} dot={ch.color} onPress={() => setEdit({ ...ch, essential: !!ch.essential })} /></View>)}</View>)}</Card>
    {edit && <Sheet open title={edit.id ? 'Edit category' : 'New category'} onClose={() => setEdit(null)} footer={<>
      {edit.id && !edit.builtin && <Btn kind="danger" title="Delete" onPress={async () => { if (await act(() => del(`/categories/${edit.id}`))) setEdit(null); }} />}
      <Btn title="Save" style={{ flex: 1 }} onPress={async () => { const b = { name: edit.name, kind: edit.kind, color: edit.color, parent_id: edit.parent_id ?? null, essential: !!edit.essential, icon: edit.icon ?? 'circle' };
        if (await act(() => (edit.id ? put(`/categories/${edit.id}`, b) : post('/categories', b)), 'Saved')) setEdit(null); }} /></>}>
      <Input label="Name" value={edit.name} onChangeText={(v) => setEdit({ ...edit, name: v })} />
      <Pick label="Parent" value={edit.parent_id ?? null} options={[{ value: null, label: 'None' }, ...top.filter((p) => p.id !== edit.id).map((p) => ({ value: p.id, label: p.name, color: p.color }))]} onChange={(v) => setEdit({ ...edit, parent_id: v })} />
      <Pick label="Color" value={edit.color} options={COLORS.map((c) => ({ value: c, label: '●', color: c }))} onChange={(v) => setEdit({ ...edit, color: v })} />
      {edit.kind === 'expense' && <Toggle label="Essential spending" hint="Used for emergency fund and stress test" value={edit.essential} onChange={(v) => setEdit({ ...edit, essential: v })} />}
    </Sheet>}
  </Screen>;
}

// ---------- Recurring ----------
export function Recurring({ nav }: ScreenProps) {
  const c = useColors(); const r = useQ<any[]>('/recurring'); const [edit, setEdit] = useState<any>(null);
  return <Screen title="Recurring" back={nav.back} fab={{ label: 'Rule', onPress: () => setEdit({ kind: 'income', name: '', amount: '', currency: 'GEL', account_id: null, category_id: null, unit: 'month', interval: '1', start_date: todayISO(), end_date: '', auto_post: true, active: true }) }}>
    <T muted>Salary, rent and other repeating income/expenses. Auto-posted rules create transactions on their dates.</T>
    <Card>{!r.data ? <Loading /> : !r.data.length ? <Empty icon="🔁" title="No recurring rules" /> : r.data.map((x, i) => <View key={x.id}>{i > 0 && <Sep />}
      <Row title={x.name + (x.active ? '' : ' (paused)')} sub={`every ${x.interval > 1 ? x.interval + ' ' : ''}${x.unit}${x.interval > 1 ? 's' : ''} · next ${dateFmt(x.next?.[0])}`} right={<Text style={{ fontWeight: '700', color: x.kind === 'income' ? c.success : c.text }}>{x.kind === 'income' ? '+' : '−'}{money(x.amount, x.currency)}</Text>} dot={x.category_color ?? c.primary} icon="🔁"
        onPress={() => setEdit({ ...x, amount: String(x.amount), interval: String(x.interval), end_date: x.end_date ?? '', auto_post: !!x.auto_post, active: !!x.active })} /></View>)}</Card>
    {edit && <Sheet open title={edit.id ? 'Edit rule' : 'New recurring rule'} onClose={() => setEdit(null)} footer={<>
      {edit.id && <Btn kind="danger" title="Delete" onPress={async () => { if (await act(() => del(`/recurring/${edit.id}`))) setEdit(null); }} />}
      <Btn title="Save" style={{ flex: 1 }} onPress={async () => { const b = { kind: edit.kind, name: edit.name, amount: num(edit.amount), currency: edit.currency, account_id: edit.account_id, category_id: edit.category_id, unit: edit.unit, interval: Number(edit.interval) || 1, start_date: edit.start_date, end_date: edit.end_date || null, auto_post: edit.auto_post, active: edit.active, tags: edit.tags ?? [] };
        if (await act(() => (edit.id ? put(`/recurring/${edit.id}`, b) : post('/recurring', b)), 'Saved')) setEdit(null); }} /></>}>
      <Seg value={edit.kind} onChange={(k) => setEdit({ ...edit, kind: k })} options={[{ value: 'income', label: 'Income' }, { value: 'expense', label: 'Expense' }]} />
      <Input label="Name" value={edit.name} onChangeText={(v) => setEdit({ ...edit, name: v })} placeholder="Salary" />
      <NumInput label="Amount" value={edit.amount} onChange={(v) => setEdit({ ...edit, amount: v })} />
      <CurrencyPick value={edit.currency} onChange={(v) => setEdit({ ...edit, currency: v })} />
      <Pick label="Repeats" value={edit.unit} options={UNITS as any} onChange={(v) => setEdit({ ...edit, unit: v })} />
      <NumInput label="Every N" value={edit.interval} onChange={(v) => setEdit({ ...edit, interval: v })} />
      <Input label="Start date" value={edit.start_date} onChangeText={(v) => setEdit({ ...edit, start_date: v })} />
      <Input label="End date (optional)" value={edit.end_date} onChangeText={(v) => setEdit({ ...edit, end_date: v })} />
      <AccountPick value={edit.account_id} onChange={(v) => setEdit({ ...edit, account_id: v })} />
      <CategoryPick value={edit.category_id} onChange={(v) => setEdit({ ...edit, category_id: v })} kind={edit.kind} />
      <Toggle label="Post transactions automatically" value={edit.auto_post} onChange={(v) => setEdit({ ...edit, auto_post: v })} />
      <Toggle label="Active" value={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} />
    </Sheet>}
  </Screen>;
}
void Badge; void Bar; void LineChart; void Pressable;
