import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FS from 'expo-file-system/legacy';
import { Badge, Bar, Btn, Card, Empty, H2, Loading, Row, Screen, Seg, Sep, Sheet, Stat, T, useColors } from '../ui';
import { Bars, Donut } from '../charts';
import { InsightRow } from './money';
import { act, money, post, put, useQ, dateFmt, monthFmt } from '../lapi';
import type { ScreenProps } from './common';

export const KIND_LABEL: Record<string, string> = { purchase: 'Purchase', subscription: 'Subscription', bill: 'Bill', topup: 'Top-up', cash_withdrawal: 'Cash withdrawal', cash_deposit: 'Cash deposit',
  transfer_out: 'Sent to person', transfer_in: 'From person', internal: 'Own transfer / savings', exchange: 'Currency exchange', salary: 'Salary', income: 'Income', loan_repayment: 'Loan repayment',
  loan_disbursement: 'Loan received', fee: 'Bank fee', interest: 'Interest', refund: 'Refund / cashback' };
export const PATTERN_LABEL: Record<string, string> = { settles: 'Settles up (flow)', rent: 'Rent (spending)', gift: 'Gift / payment (spending)', income: 'Pays me (income)' };

// ---------- Card / loan key terms ----------
export function CardTermsScreen({ nav, params }: ScreenProps) {
  const c = useColors(); const loan = params.loan;
  const hist = useQ<any[]>(`/loans/${loan.id}/terms`);
  const [id, setId] = useState<number | null>(null); const [mode, setMode] = useState<'recommended' | 'minimum'>('recommended'); const [busy, setBusy] = useState(false);
  const cur = id ?? hist.data?.[0]?.id ?? null;
  const d = useQ<any>(cur ? `/loan-terms/${cur}?mode=${mode}` : null as any);
  const upload = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf'], copyToCacheDirectory: true }); if (r.canceled || !r.assets?.[0]) return;
    setBusy(true);
    try { const data = await FS.readAsStringAsync(r.assets[0].uri, { encoding: FS.EncodingType.Base64 }); const x: any = await act(() => post(`/loans/${loan.id}/terms`, { filename: r.assets[0].name ?? 'terms.pdf', data })); if (x) setId(x.id); }
    finally { setBusy(false); }
  };
  const x = cur ? d.data : null; const tm = x?.terms ?? {};
  return <Screen title={`Card terms · ${loan.name}`} back={nav.back}>
    <Card style={{ gap: 10 }}><T muted>Upload the card's “key terms” PDF (e.g. Liberty Top Card). Rates, limit and minimum payment are proposed — nothing changes until you apply, and you can revert.</T>
      <Btn icon="📄" title={busy ? 'Reading PDF…' : 'Choose terms PDF'} loading={busy} onPress={upload} /></Card>
    {cur && !x ? <Loading /> : x && <>
      <Card style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}><T bold style={{ flex: 1 }}>{tm.bank ?? ''} {tm.product ?? ''}</T><Badge label={x.status} tone={x.status === 'applied' ? 'success' : x.status === 'staged' ? 'warning' : 'default'} /></View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {tm.creditLimit != null && <Stat label="Limit" value={money(tm.creditLimit, tm.currency)} />}
          <Stat label="Rate if paid in full" value={`${tm.rateRecommended ?? '—'}%`} /><Stat label="Rate on minimum" value={`${tm.rateMinimum ?? '—'}%`} tone={c.danger} />
        </View>
        {tm.minPayment != null && <T>Minimum payment {money(tm.minPayment, tm.currency)}</T>}
        {tm.cashFeePct != null && <T muted style={{ fontSize: 12 }}>Cash withdrawal fee {tm.cashFeePct}%{tm.cashFeeMin ? `, min ${money(tm.cashFeeMin, tm.currency)}` : ''}</T>}
        {(tm.warnings ?? []).map((w: string) => <T key={w} style={{ color: c.warning, fontSize: 12 }}>⚠ {w}</T>)}
      </Card>
      {x.status === 'staged' && <>
        <H2>How do you pay?</H2>
        <Seg value={mode} onChange={setMode} options={[{ value: 'recommended', label: 'Full / recommended' }, { value: 'minimum', label: 'Minimum only' }]} />
        <Card>{!x.diff.length ? <T muted>No changes to this loan.</T> : x.diff.map((df: any) => <T key={df.field} style={{ fontSize: 13 }}>{df.field}: {String(df.from ?? '—')} → <T bold>{String(df.to ?? '—')}</T></T>)}</Card>
        <View style={{ flexDirection: 'row', gap: 8 }}><Btn title="Apply to loan" onPress={() => act(() => post(`/loan-terms/${x.id}/approve`, { mode }), 'Terms applied')} />
          <Btn kind="ghost" title="Discard" onPress={() => act(() => post(`/loan-terms/${x.id}/discard`), 'Discarded')} /></View></>}
      {x.status === 'applied' && <Btn kind="danger" title="Revert to previous values" onPress={() => act(() => post(`/loan-terms/${x.id}/revert`), 'Reverted')} />}
    </>}
    {(hist.data ?? []).length > 1 && <><H2>History</H2><Card>{hist.data!.map((h, i) => <View key={h.id}>{i > 0 && <Sep />}<Row title={h.filename} sub={`${h.status} · ${dateFmt(h.created_at)}`} onPress={() => setId(h.id)} /></View>)}</Card></>}
  </Screen>;
}

// ---------- Import smart groups ----------
export function ImportGroupsScreen({ nav, params }: ScreenProps) {
  const c = useColors(); const g = useQ<any>(`/imports/${params.id}/clusters`);
  if (!g.data) return <Screen title="Smart groups" back={nav.back}><Loading /></Screen>;
  const x = g.data; const open = x.transfers.filter((m: any) => m.status === 'proposed');
  const decide = (ids: number[], status: string) => act(() => post('/imports/matches/decide', { ids, status }));
  return <Screen title="Smart groups" back={nav.back} onRefresh={g.reload}>
    <H2>Transfers between your accounts ({x.transfers.length})</H2>
    <T muted style={{ fontSize: 12 }}>Matched legs count once and are not income or spending. A difference is recorded as a transfer fee.</T>
    {open.length > 0 && !params.locked && <Btn title={`Confirm all (${open.length})`} onPress={() => decide(open.map((m: any) => m.id), 'confirmed')} />}
    <Card>{!x.transfers.length ? <Empty icon="⇄" title="No transfers found" /> : x.transfers.map((m: any, i: number) => <View key={m.id} style={m.status === 'rejected' ? { opacity: 0.5 } : undefined}>{i > 0 && <Sep />}
      <Row title={`−${money(m.out?.amount, m.out?.currency)} ${m.out?.bank ?? ''} → +${money(m.in?.amount, m.in?.currency)} ${m.in?.bank ?? ''}`}
        sub={`${dateFmt(m.out?.date)} · ${Math.round(m.score * 100)}% · ${m.reasons.join(' · ')}${m.fee > 0 ? ` · fee ${money(m.fee, m.fee_currency)}` : ''}`}
        right={<Badge label={m.status} tone={m.status === 'confirmed' ? 'success' : m.status === 'rejected' ? 'danger' : 'default'} />}
        onPress={() => !params.locked && Alert.alert('Transfer match', m.reasons.join('\n'), [{ text: 'Cancel' }, { text: 'Reject', style: 'destructive', onPress: () => decide([m.id], 'rejected') }, { text: m.status === 'confirmed' ? 'Undo' : 'Confirm', onPress: () => decide([m.id], m.status === 'confirmed' ? 'proposed' : 'confirmed') }])} /></View>)}</Card>
    <H2>Own-account moves</H2>
    <Card>{!x.own.length ? <Empty icon="🐷" title="None" /> : x.own.map((o: any, i: number) => <View key={o.key}>{i > 0 && <Sep />}<Row title={KIND_LABEL[o.key] ?? o.key} sub={`×${o.count} · ${o.why ?? ''}`} right={money(o.total)} /></View>)}</Card>
    <H2>People</H2>
    <Card>{!x.people.length ? <Empty icon="👥" title="None" /> : x.people.slice(0, 30).map((p: any, i: number) => <View key={p.key}>{i > 0 && <Sep />}<Row title={p.name} sub={`${PATTERN_LABEL[p.pattern]} · ×${p.count}`}
      right={<T bold style={{ color: p.net > 0 ? c.success : p.net < 0 ? c.danger : c.text }}>{money(p.net)}</T>} /></View>)}</Card>
    <H2>Recurring & subscriptions</H2>
    <Card>{!x.recurring.length ? <Empty icon="🔁" title="None" /> : x.recurring.map((r: any, i: number) => <View key={r.key}>{i > 0 && <Sep />}<Row title={`${r.name}${r.subscription ? ' ↻' : ''}`} sub={`${r.cadence} · ×${r.count}`} right={money(r.avgAmount)}
      onPress={() => !params.locked && act(() => post(`/imports/${params.id}/bulk`, { ids: r.ids, patch: { tx_kind: r.subscription ? 'purchase' : 'subscription' } }), r.subscription ? 'Not a subscription' : 'Marked as subscription')} /></View>)}</Card>
  </Screen>;
}

// ---------- People ----------
const PAL = ['#6366f1', '#0ea5e9', '#10b981', '#f97316', '#ef4444', '#8b5cf6', '#ec4899', '#f59e0b', '#94a3b8'];
type RK = '1m' | '3m' | '6m' | '12m' | 'all';
const rangeQ = (k: RK) => { if (k === 'all') return ''; const n = { '1m': 0, '3m': 2, '6m': 5, '12m': 11 }[k]; const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - n); const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; return `from=${iso(d)}&to=${iso(new Date())}`; };
const RANGES = [{ value: '1m' as RK, label: 'Month' }, { value: '3m' as RK, label: '3M' }, { value: '6m' as RK, label: '6M' }, { value: '12m' as RK, label: '12M' }, { value: 'all' as RK, label: 'All' }];
export function PeopleScreen({ nav }: ScreenProps) {
  const c = useColors(); const [range, setRange] = useState<RK>('12m'); const p = useQ<any>(`/people?${rangeQ(range)}`); const [open, setOpen] = useState<string | null>(null);
  const [sort, setSort] = useState<'total' | 'sent' | 'received'>('total');
  const ranked = [...(p.data?.people ?? [])].filter((x: any) => !x.hidden).sort((a: any, b: any) => b[sort] - a[sort]);
  const share = (k: 'sent' | 'received') => { const l = [...ranked].sort((a: any, b: any) => b[k] - a[k]).filter((x: any) => x[k] > 0); const top = l.slice(0, 6).map((x: any, i: number) => ({ label: x.name, value: x[k], color: PAL[i] })); const rest = l.slice(6).reduce((s: number, x: any) => s + x[k], 0); return rest > 0 ? [...top, { label: 'Other', value: rest, color: PAL[8] }] : top; };
  return <Screen title="People" back={nav.back} onRefresh={p.reload}>
    <T muted style={{ fontSize: 12 }}>Friends settle up: money sent and received is a flow — never spending, income or debt. Rent is detected automatically; mark gifts yourself.</T>
    <Seg value={range} options={RANGES} onChange={setRange} />
    {!p.data ? <Loading /> : !p.data.people.length ? <Card><Empty icon="👥" title="No person-to-person transfers yet" body="Import a bank statement." /></Card> : <>
      <View style={{ flexDirection: 'row', gap: 10 }}><Stat label="Sent" value={money(p.data.sent)} /><Stat label="Received" value={money(p.data.received)} /></View>
      <View style={{ flexDirection: 'row', gap: 10 }}><Stat label="Exchanged (flow)" value={money(p.data.flowTotal)} /><Stat label="Rent" value={money(p.data.rentTotal)} /></View>
      <Card><H2>Sent — by person</H2><Donut data={share('sent')} size={120} /></Card>
      <Card><H2>Received — by person</H2><Donut data={share('received')} size={120} /></Card>
      {(p.data.insights ?? []).length > 0 && <Card>{p.data.insights.map((i: any, k: number) => <InsightRow key={k} i={i} />)}</Card>}
      <Seg value={sort} options={[{ value: 'total', label: 'Total' }, { value: 'sent', label: 'Sent most' }, { value: 'received', label: 'Received most' }]} onChange={setSort} />
      <Card>{ranked.map((x: any, i: number) => <View key={x.key}>{i > 0 && <Sep />}
        <Row title={`${i + 1}. ${x.name}`} sub={`${PATTERN_LABEL[x.pattern] ?? ''} · ×${x.count} · sent ${money(x.sent)} · got ${money(x.received)}${x.turnaroundDays !== null ? ` · back in ~${x.turnaroundDays} d` : ''}`} right={<T bold>{money(x.total)}</T>}
          onPress={() => setOpen(open === x.key ? null : x.key)} />
        {open === x.key && <View style={{ paddingBottom: 8, gap: 2 }}>
          {x.rentWhy && <T muted style={{ fontSize: 12 }}>Detected as rent: {x.rentWhy}</T>}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>{Object.entries(PATTERN_LABEL).map(([k, l]) => <Btn key={k} small kind={x.pattern === k ? 'primary' : 'outline'} title={l} onPress={() => act(() => put(`/people/${encodeURIComponent(x.key)}`, { pattern: k }), 'Saved')} />)}</View>
          {(x.monthly ?? []).length > 1 && <Bars data={x.monthly} keys={['sent', 'received']} colors={[c.warning, c.success]} height={70} label={(r) => monthFmt(r.month)} />}
          {x.items.map((it: any) => <T key={it.ref} muted style={{ fontSize: 12 }}>{dateFmt(it.date)} · {it.dir === 'in' ? '+' : '−'}{money(it.amount, it.currency)}</T>)}</View>}
      </View>)}</Card></>}
  </Screen>;
}

// ---------- Overdue bills ----------
export function OverdueButton() {
  const o = useQ<any[]>('/bills/overdue');
  const list = o.data ?? []; if (!list.length) return null;
  const pre = list.filter((b) => b.pre_tracking).length;
  return <Btn kind="soft" icon="✓" title={`Mark all overdue as paid (${list.length})`} onPress={() => Alert.alert('Mark all overdue as paid?',
    `${list.length} bills.${pre ? ` ${pre} loan installments were due before you started tracking: they are marked paid without adding expenses.` : ''} Others are recorded on their due date.`,
    [{ text: 'Cancel' }, { text: 'Mark paid', onPress: async () => {
      const r: any = await act(() => post('/bills/pay-overdue', { ids: list.map((b) => b.id) }));
      if (r?.ids?.length) Alert.alert('Done', `${r.paid} bills marked paid.`, [{ text: 'Undo', style: 'destructive', onPress: () => act(() => post('/bills/unpay-many', { ids: r.ids }), 'Undone') }, { text: 'OK' }]);
    } }])} />;
}
export function BillCleanupNotice() {
  const c = useColors(); const n = useQ<any>('/maintenance/bill-cleanup');
  const v = n.data; if (!v || v.seen || !((v.removed?.length ?? 0) + (v.redated?.length ?? 0))) return null;
  return <Card style={{ borderLeftWidth: 4, borderLeftColor: c.warning, gap: 6 }}>
    <T bold>Loan payments cleaned up</T>
    <T muted style={{ fontSize: 12 }}>Installments due before you started tracking no longer create expenses{v.removed?.length ? ` (${v.removed.length} removed, ${money(v.removedTotal)})` : ''}{v.redated?.length ? `; ${v.redated.length} late payments moved to their due date` : ''}.</T>
    {[...(v.removed ?? []), ...(v.redated ?? [])].slice(0, 12).map((b: any, i: number) => <T key={i} muted style={{ fontSize: 11 }}>{b.name} · due {dateFmt(b.due_date)} · {money(b.amount, b.currency)}</T>)}
    <Btn small kind="ghost" title="OK" onPress={() => act(() => post('/maintenance/bill-cleanup/seen'))} /></Card>;
}

// ---------- Merchants ----------
export function MerchantsScreen({ nav }: ScreenProps) {
  const c = useColors(); const [range, setRange] = useState<RK>('6m'); const d = useQ<any>(`/merchants?${rangeQ(range) || 'from=2000-01-01'}`); const [open, setOpen] = useState<string | null>(null);
  const [pick, setPick] = useState<string[]>([]);
  const x = d.data;
  const pie = (l: any[]) => (l ?? []).slice(0, 9).map((m: any, i: number) => ({ label: m.name, value: m.total, color: m.color || PAL[i % PAL.length] }));
  const merge = async () => { const into = pick[0]; const keys = pick.flatMap((k) => x.merchants.find((m: any) => m.key === k)?.variants?.map((v: any) => v.key) ?? [k]);
    if (await act(() => post('/merchants/merge', { keys, into, name: x.merchants.find((m: any) => m.key === into)?.name }), 'Merged')) { setPick([]); d.reload(); } };
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return <Screen title="Merchants" back={nav.back} onRefresh={d.reload}>
    <Seg value={range} options={RANGES} onChange={setRange} />
    {!x ? <Loading /> : !x.merchants.length ? <Card><Empty icon="🏪" title="No merchant payments yet" body="Import a bank statement." /></Card> : <>
      <View style={{ flexDirection: 'row', gap: 10 }}><Stat label="Spent at merchants" value={money(x.total)} /><Stat label="Payments" value={String(x.count)} sub={`avg ${money(x.count ? x.total / x.count : 0)}`} /></View>
      <Card><H2>Share by merchant</H2><Donut data={pie(x.byMerchant)} size={120} /></Card>
      <Card><H2>Share by category</H2><Donut data={pie(x.byCategory)} size={120} /></Card>
      {x.insights.length > 0 && <Card>{x.insights.map((i: any, k: number) => <InsightRow key={k} i={i} />)}</Card>}
      <Card><H2>By weekday</H2><Bars data={x.weekday.map((v: number, i: number) => ({ d: DAYS[i], v }))} keys={['v']} colors={[c.primary]} height={80} label={(r) => r.d} /></Card>
      {x.subscriptions.length > 0 && <Card><H2>Subscriptions & regular bills</H2>{x.subscriptions.map((s: any) => <Row key={s.name} title={s.name} sub={`×${s.count} · last ${dateFmt(s.last)}`} right={money(s.amount)} rightSub={`${money(s.yearly)}/yr`} />)}</Card>}
      {pick.length >= 2 && <Btn icon="⇄" title={`Merge ${pick.length} into one`} onPress={merge} />}
      <T muted style={{ fontSize: 11 }}>Long-press merchants to select and merge; open one to split a name variant out.</T>
      <Card>{x.merchants.slice(0, 150).map((m: any, i: number) => { const diff = m.lastMonth ? m.thisMonth / m.lastMonth - 1 : null; const sel = pick.includes(m.key); return <View key={m.key} style={sel ? { backgroundColor: c.border } : undefined}>{i > 0 && <Sep />}
        <Pressable onLongPress={() => setPick((p) => (p.includes(m.key) ? p.filter((k) => k !== m.key) : [...p, m.key]))}>
        <Row title={`${sel ? '✓ ' : ''}${m.name}`} sub={`${m.category ?? ''} · ×${m.count} · avg ${money(m.avg)}${m.variants?.length > 1 ? ` · ${m.variants.length} variants` : ''}`} right={<T bold>{money(m.total)}</T>}
          rightSub={`this month ${money(m.thisMonth)}${diff === null ? '' : ` ${diff > 0 ? '▲' : '▼'}${Math.abs(Math.round(diff * 100))}%`}`} onPress={() => setOpen(open === m.key ? null : m.key)} /></Pressable>
        {open === m.key && <View style={{ paddingBottom: 8, gap: 2 }}><T muted style={{ fontSize: 12 }}>Last month {money(m.lastMonth)} · usual {money(m.usualMonthly)}/month · {m.perWeek}/week · last {dateFmt(m.last)}</T>
          <Bars data={m.monthly} keys={['total']} colors={[c.primary]} height={70} label={(r) => monthFmt(r.month)} />
          {m.variants?.length > 1 && m.variants.filter((v: any) => v.key !== m.key).map((v: any) => <View key={v.key} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><T muted style={{ fontSize: 12, flex: 1 }}>{v.key} ×{v.count}</T>
            <Btn small kind="ghost" title="Split" onPress={async () => { if (await act(() => post('/merchants/split', { key: v.key }), 'Split')) d.reload(); }} /></View>)}</View>}
      </View>; })}</Card></>}
  </Screen>;
}

// ---------- Month drill-down ----------
export function MonthSheet({ month, onClose }: { month: string | null; onClose: () => void }) {
  const c = useColors(); const d = useQ<any>(month ? `/month-summary?month=${month}` : '/meta'); const x = month && d.data?.month === month ? d.data : null;
  const max = x?.byCategory?.[0]?.total || 1;
  return <Sheet open={!!month} title={month ? `${monthFmt(month)} overview` : ''} onClose={onClose}>
    {!x ? <Loading /> : <>
      <View style={{ flexDirection: 'row', gap: 8 }}><Stat label="Income" value={money(x.income)} tone={c.success} /><Stat label="Expenses" value={money(x.expense)} tone={c.danger} /><Stat label="Net" value={money(x.net)} tone={x.net < 0 ? c.danger : c.success} /></View>
      <H2>Expenses by category</H2>{x.byCategory.map((k: any) => <View key={k.name} style={{ gap: 2, marginBottom: 4 }}><View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T>{k.name} ×{k.count}</T><T bold>{money(k.total)}</T></View><Bar value={k.total / max} color={k.color} height={5} /></View>)}
      <H2>Top merchants</H2>{x.topMerchants.map((m: any) => <Row key={m.name} title={m.name} sub={`×${m.count}`} right={money(m.total)} />)}
      <H2>Income</H2>{x.incomeBy.map((m: any) => <Row key={m.name} title={m.name} right={<T style={{ color: c.success }}>{money(m.total)}</T>} />)}
      {x.movedOwn > 0 && <T muted style={{ fontSize: 12 }}>Moved between your own accounts (not counted): {money(x.movedOwn)}</T>}
    </>}
  </Sheet>;
}

// ---------- Analytics fix notice ----------
export function AnalyticsFixNotice() {
  const c = useColors(); const n = useQ<any>('/maintenance/analytics-fix'); const f = n.data;
  if (!f || f.seen || !f.before) return null; const r = (v: number) => Math.round(v).toLocaleString();
  return <Card style={{ borderLeftWidth: 4, borderLeftColor: c.primary, gap: 6 }}><T bold>Analytics corrected</T>
    <T muted>Transfers between your own accounts ({f.transferPairs} pairs) were counted as both spending and income, and money that went to people and came back counted too. Fixed: income {r(f.before.income)} → {r(f.after.income)} ₾, expenses {r(f.before.expense)} → {r(f.after.expense)} ₾ (all history). Reversible from Import.</T>
    <Btn small title="Got it" onPress={async () => { await act(() => post('/maintenance/analytics-fix/seen')); n.reload(); }} /></Card>;
}
