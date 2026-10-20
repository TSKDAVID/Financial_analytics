import { useState } from 'react';
import { Alert, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FS from 'expo-file-system/legacy';
import { Badge, Btn, Card, Empty, H2, Loading, Row, Screen, Seg, Sep, Stat, T, useColors } from '../ui';
import { act, money, post, put, useQ, dateFmt } from '../lapi';
import type { ScreenProps } from './common';

export const KIND_LABEL: Record<string, string> = { purchase: 'Purchase', subscription: 'Subscription', bill: 'Bill', topup: 'Top-up', cash_withdrawal: 'Cash withdrawal', cash_deposit: 'Cash deposit',
  transfer_out: 'Sent to person', transfer_in: 'From person', internal: 'Own transfer / savings', exchange: 'Currency exchange', salary: 'Salary', income: 'Income', loan_repayment: 'Loan repayment',
  loan_disbursement: 'Loan received', fee: 'Bank fee', interest: 'Interest', refund: 'Refund / cashback' };
export const PATTERN_LABEL: Record<string, string> = { lent_repaid: 'Lent & repaid', lent_open: 'Lent — not fully returned', borrowed: 'Borrowed', shared: 'Split / shared', one_way_out: 'Only sent', one_way_in: 'Only received' };

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
export function PeopleScreen({ nav }: ScreenProps) {
  const c = useColors(); const p = useQ<any>('/people'); const [open, setOpen] = useState<string | null>(null);
  return <Screen title="People" back={nav.back} onRefresh={p.reload}>
    {!p.data ? <Loading /> : !p.data.people.length ? <Card><Empty icon="👥" title="No person-to-person transfers yet" body="Import a bank statement." /></Card> : <>
      <View style={{ flexDirection: 'row', gap: 10 }}><Stat label="Owed to you" value={money(p.data.owedToYou)} tone={c.success} /><Stat label="You owe" value={money(p.data.youOwe)} tone={c.danger} /></View>
      <Card>{p.data.people.filter((x: any) => !x.hidden).map((x: any, i: number) => <View key={x.key}>{i > 0 && <Sep />}
        <Row title={x.name} sub={`${PATTERN_LABEL[x.pattern]} · ×${x.count} · ${dateFmt(x.lastDate)}`} right={<T bold style={{ color: x.net > 0 ? c.success : x.net < 0 ? c.danger : c.text }}>{money(x.net)}</T>}
          onPress={() => setOpen(open === x.key ? null : x.key)} />
        {open === x.key && <View style={{ paddingBottom: 8, gap: 2 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>{Object.entries(PATTERN_LABEL).map(([k, l]) => <Btn key={k} small kind={x.pattern === k ? 'primary' : 'outline'} title={l} onPress={() => act(() => put(`/people/${encodeURIComponent(x.key)}`, { pattern: k }), 'Saved')} />)}</View>
          {x.items.map((it: any) => <T key={it.ref} muted style={{ fontSize: 12 }}>{dateFmt(it.date)} · {it.dir === 'in' ? '+' : '−'}{money(it.amount, it.currency)} · balance {money(it.running)}</T>)}</View>}
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
