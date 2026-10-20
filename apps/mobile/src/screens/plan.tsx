import { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Badge, Bar, Btn, Card, Chip, Empty, H2, Input, Loading, NumInput, Pick, Row, Screen, Seg, Sep, Sheet, Stat, T, Toggle, useColors } from '../ui';
import { Donut, LineChart } from '../charts';
import { act, del, money, pct, post, put, useQ, dateFmt, monthFmt, todayISO, CHART_COLORS } from '../lapi';
import { AccountPick, CategoryPick, CurrencyPick, NoData, UNITS, num, type ScreenProps } from './common';
import { InsightRow } from './money';
import { OverdueButton, BillCleanupNotice } from './extra';

const REVOLVING = ['credit_card', 'overdraft', 'credit_line'];
const KINDS = [{ value: 'loan', label: 'Loan' }, { value: 'mortgage', label: 'Mortgage' }, { value: 'installment', label: 'Installment' }, { value: 'credit_card', label: 'Credit card' }, { value: 'overdraft', label: 'Overdraft' }, { value: 'credit_line', label: 'Credit line' }];
const mp = (P: number, rate: number, n: number) => { const i = rate / 1200; if (n <= 0) return P; return i === 0 ? P / n : (P * i) / (1 - Math.pow(1 + i, -n)); };
const tf = (P: number, rate: number, pay: number) => { const i = rate / 1200; if (pay <= 0) return Infinity; if (i === 0) return Math.ceil(P / pay - 1e-9); if (pay <= P * i) return Infinity; return Math.ceil(-Math.log(1 - (P * i) / pay) / Math.log(1 + i) - 1e-9); };

// ---------- Loans ----------
export function Loans({ nav }: ScreenProps) {
  const c = useColors(); const l = useQ<any[]>('/loans'); const ov = useQ<any>('/loans/overview');
  const [edit, setEdit] = useState<any>(null); const [upd, setUpd] = useState<any>(null);
  return <Screen title="Loans & cards" back={nav.back} onRefresh={l.reload} fab={{ label: 'Loan', onPress: () => setEdit({ kind: 'loan', name: '', bank: '', principal: '', currency: 'GEL', annual_rate: '', term_months: '24', monthly_payment: '', start_date: todayISO(), extra_monthly: '0', monthly_fee: '0', pin: 'term', active: true }) }}>
    {ov.data && <View style={{ flexDirection: 'row', gap: 10 }}><Stat label="Total debt" value={money(ov.data.totalDebt)} tone={c.danger} /><Stat label="Monthly" value={money(ov.data.monthly)} sub={ov.data.lastPayoff ? `debt-free ${dateFmt(ov.data.lastPayoff)}` : undefined} /></View>}
    {ov.data?.byBank?.length > 0 && <Card><H2>Debt by bank</H2><View style={{ height: 8 }} /><Donut data={ov.data.byBank.map((b: any, i: number) => ({ label: b.bank, value: b.remaining_gel, color: CHART_COLORS[i % 10] }))} /></Card>}
    <Btn kind="soft" icon="📄" title="Import Creditinfo credit report" onPress={() => nav.push('import', { tab: 'credit' })} />
    {!l.data ? <Loading /> : !l.data.length ? <Empty icon="🏦" title="No loans" body="Add loans and credit cards, or import your credit report." /> : l.data.map((x) => {
      const prog = x.paid_count / Math.max(1, x.paid_count + x.months_left);
      return <Card key={x.id} style={[!x.active && { opacity: 0.6 }, x.needs_input && { borderColor: c.warning, borderWidth: 1.5 }] as any}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <View style={{ flex: 1 }}><T bold style={{ fontSize: 16 }}>{x.revolving ? '💳 ' : '🏦 '}{x.name}</T><T muted style={{ fontSize: 12 }}>{x.bank} · {x.annual_rate}%{x.revolving ? (x.due_day ? ` · due day ${x.due_day}` : '') : x.monthly_payment_override ? ' · payment pinned' : ` · ${x.term_months} mo`}</T></View>
          {x.needs_input && <Badge tone="warning" label="Needs your input" />}
        </View>
        {x.needs_input && <T style={{ fontSize: 12, marginTop: 8, color: c.warning }}>The credit report has no monthly payment for this line. Enter what you pay so forecasts and reminders are right.</T>}
        <View style={{ flexDirection: 'row', marginTop: 12 }}>
          <View style={{ flex: 1 }}><T muted style={{ fontSize: 11 }}>{x.revolving ? 'Balance' : 'Remaining'}</T><T bold>{money(x.remaining, x.currency)}</T></View>
          <View style={{ flex: 1 }}><T muted style={{ fontSize: 11 }}>Monthly</T><T bold>{x.needs_input ? '—' : money(x.monthly_total || x.monthly_payment, x.currency)}</T>{x.monthly_fee > 0 && <T muted style={{ fontSize: 10 }}>incl. {money(x.monthly_fee, x.currency)} fee</T>}</View>
          <View style={{ flex: 1 }}><T muted style={{ fontSize: 11 }}>Payoff</T><T bold style={x.never_pays_off ? { color: c.danger, fontSize: 12 } : undefined}>{x.never_pays_off ? 'Never' : x.needs_input || !x.payoff_date ? '—' : dateFmt(x.payoff_date)}</T></View>
        </View>
        <View style={{ marginTop: 10, gap: 4 }}>{x.revolving && x.credit_limit ? <><Bar value={x.utilization ?? 0} /><T muted style={{ fontSize: 11 }}>Used {pct(x.utilization)} of {money(x.credit_limit, x.currency)} · {money(x.available, x.currency)} available</T></>
          : !x.revolving && <><Bar value={prog} color={c.success} /><T muted style={{ fontSize: 11 }}>{x.paid_count} of {x.paid_count + x.months_left} paid{x.next_payment ? ` · next ${dateFmt(x.next_payment.date)}` : ''}</T></>}</View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
          <Btn small kind={x.needs_input ? 'primary' : 'outline'} title={x.needs_input ? 'Enter payment' : 'Update'} onPress={() => setUpd(x)} />
          <Btn small kind="outline" title="Edit" onPress={() => setEdit({ ...x, principal: String(x.principal), annual_rate: String(x.annual_rate), term_months: String(x.term_months || ''), monthly_payment: x.monthly_payment_override ? String(x.monthly_payment_override) : x.needs_input ? '' : String(x.monthly_payment), extra_monthly: String(x.extra_monthly ?? 0), monthly_fee: String(x.monthly_fee ?? 0), credit_limit: x.credit_limit != null ? String(x.credit_limit) : '', due_day: x.due_day != null ? String(x.due_day) : '', payment_pct: x.payment_pct != null ? String(x.payment_pct) : '', pin: x.monthly_payment_override ? 'payment' : 'term', active: !!x.active })} />
          {!x.needs_input && <Btn small kind="ghost" title="Schedule" onPress={() => nav.push('schedule', { loan: x })} />}
          {x.revolving && <Btn small kind="ghost" title="Card terms" onPress={() => nav.push('cardTerms', { loan: x })} />}
        </View>
      </Card>; })}
    {edit && <LoanSheet loan={edit} onClose={() => setEdit(null)} />}
    {upd && <UpdateSheet loan={upd} onClose={() => setUpd(null)} />}
  </Screen>;
}
function LoanSheet({ loan, onClose }: { loan: any; onClose: () => void }) {
  const [f, setF] = useState<any>(loan); const rev = REVOLVING.includes(f.kind);
  const P = num(f.principal) ?? 0, rate = num(f.annual_rate) ?? 0;
  const set = (p: any) => { const n = { ...f, ...p }; const P2 = num(n.principal) ?? 0, r2 = num(n.annual_rate) ?? 0;
    if (n.pin === 'term' && Number(n.term_months) > 0 && P2 > 0) n.monthly_payment = String(Math.round(mp(P2, r2, Number(n.term_months)) * 100) / 100);
    if (n.pin === 'payment' && Number(n.monthly_payment) > 0 && P2 > 0) { const t = tf(P2, r2, Number(n.monthly_payment)); n.term_months = Number.isFinite(t) ? String(t) : ''; }
    setF(n); };
  const pctMode = rev && f.mode === 'pct';
  const save = async () => {
    const payPinned = !pctMode && f.pin === 'payment' && Number(f.monthly_payment) > 0;
    const term = Number(f.term_months) || 0;
    const b = { kind: f.kind, name: f.name, bank: f.bank, principal: P, currency: f.currency, annual_rate: rate, monthly_payment: payPinned ? Number(f.monthly_payment) : null,
      term_months: pctMode ? 0 : payPinned ? (rev ? 0 : Math.max(1, Math.min(600, term || 1))) : Math.max(rev ? 0 : 1, term), payment_pct: pctMode ? num(f.payment_pct) : null,
      credit_limit: rev ? num(f.credit_limit) : null, due_day: rev ? num(f.due_day) : null, start_date: f.start_date, extra_monthly: num(f.extra_monthly) ?? 0, monthly_fee: num(f.monthly_fee) ?? 0, account_id: f.account_id ?? null, active: !!f.active };
    if (await act(() => (f.id ? put(`/loans/${f.id}`, b) : post('/loans', b)), 'Saved')) onClose();
  };
  const t = Number(f.term_months); const never = f.pin === 'payment' && Number(f.monthly_payment) > 0 && !Number.isFinite(tf(P, rate, Number(f.monthly_payment)));
  return <Sheet open title={f.id ? 'Edit loan' : 'New loan'} onClose={onClose} footer={<>{f.id && <Btn kind="danger" title="Delete" onPress={() => Alert.alert('Delete loan?', '', [{ text: 'Cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { if (await act(() => del(`/loans/${f.id}`))) onClose(); } }])} />}<Btn title="Save" style={{ flex: 1 }} onPress={save} /></>}>
    <Pick label="Type" value={f.kind} options={KINDS} onChange={(v) => set({ kind: v })} />
    <Input label="Name" value={f.name} onChangeText={(v) => set({ name: v })} />
    <Input label="Bank" value={f.bank} onChangeText={(v) => set({ bank: v })} placeholder="TBC Bank" />
    <CurrencyPick value={f.currency} onChange={(v) => set({ currency: v })} />
    <NumInput label={rev ? 'Current balance' : 'Principal'} value={f.principal} onChange={(v) => set({ principal: v })} />
    <NumInput label="Annual interest %" value={f.annual_rate} onChange={(v) => set({ annual_rate: v })} />
    {rev && <><NumInput label="Credit limit" value={f.credit_limit} onChange={(v) => set({ credit_limit: v })} /><NumInput label="Payment due day" value={f.due_day} onChange={(v) => set({ due_day: v })} />
      <Seg value={f.mode ?? (f.payment_pct ? 'pct' : 'linked')} onChange={(m) => set({ mode: m })} options={[{ value: 'linked', label: 'Amount / term' }, { value: 'pct', label: '% of balance' }]} /></>}
    {pctMode ? <NumInput label="% of balance each month" value={f.payment_pct} onChange={(v) => set({ payment_pct: v })} /> : <>
      <NumInput label={`Term (months)${f.pin === 'term' ? ' · pinned' : ''}`} value={f.term_months} onChange={(v) => set({ term_months: v, pin: 'term' })} />
      <NumInput label={`Monthly payment${f.pin === 'payment' ? ' · pinned' : ''}`} value={f.monthly_payment} onChange={(v) => set({ monthly_payment: v, pin: 'payment' })} />
      <T muted style={{ fontSize: 12 }}>Term and payment are linked — change one and the other is recalculated. The one you changed last is pinned.{never ? ' ⚠ This payment never covers the interest.' : t > 0 ? ` Payoff in ${t} months.` : ''}</T></>}
    <Input label={rev ? 'Next payment date' : 'First payment date'} value={f.start_date} onChangeText={(v) => set({ start_date: v })} />
    <NumInput label="Extra monthly payment" value={f.extra_monthly} onChange={(v) => set({ extra_monthly: v })} />
    <NumInput label="Monthly fee (e.g. insurance)" value={f.monthly_fee} onChange={(v) => set({ monthly_fee: v })} />
    <AccountPick value={f.account_id ?? null} onChange={(v) => set({ account_id: v })} label="Paid from" />
    <Toggle label="Active" value={!!f.active} onChange={(v) => set({ active: v })} />
  </Sheet>;
}
function UpdateSheet({ loan, onClose }: { loan: any; onClose: () => void }) {
  const h = useQ<any[]>(`/loans/${loan.id}/updates`);
  const [f, setF] = useState<any>({ date: todayISO(), balance: String(loan.remaining), monthly_payment: loan.monthly_payment_override ? String(loan.monthly_payment_override) : loan.needs_input ? '' : String(loan.monthly_payment), annual_rate: String(loan.annual_rate), due_day: loan.due_day ? String(loan.due_day) : '', note: '' });
  const b = num(f.balance) ?? 0, p = num(f.monthly_payment) ?? 0; const n = p > 0 && b > 0 ? tf(b, num(f.annual_rate) ?? 0, p) : null;
  return <Sheet open title={`Update · ${loan.name}`} onClose={onClose} footer={<Btn title="Save" style={{ flex: 1 }} onPress={async () => {
    const body: any = { date: f.date, balance: b, annual_rate: num(f.annual_rate) ?? 0, note: f.note || null }; if (p > 0) body.monthly_payment = p; if (loan.revolving && f.due_day) body.due_day = Number(f.due_day);
    if (await act(() => post(`/loans/${loan.id}/update`, body), 'Updated')) onClose(); }} />}>
    <Input label="As of" value={f.date} onChangeText={(v) => setF({ ...f, date: v })} />
    <NumInput label="Current balance" value={f.balance} onChange={(v) => setF({ ...f, balance: v })} />
    <NumInput label="Monthly payment" value={f.monthly_payment} onChange={(v) => setF({ ...f, monthly_payment: v })} />
    <NumInput label="Annual interest %" value={f.annual_rate} onChange={(v) => setF({ ...f, annual_rate: v })} />
    {loan.revolving && <NumInput label="Payment due day" value={f.due_day} onChange={(v) => setF({ ...f, due_day: v })} />}
    <Input label="Note" value={f.note} onChangeText={(v) => setF({ ...f, note: v })} />
    {n != null && <T muted>{Number.isFinite(n) ? `Paid off in about ${n} months.` : '⚠ This payment never covers the interest.'}</T>}
    <H2>Change history</H2>
    {!(h.data ?? []).length ? <T muted>No updates yet.</T> : (h.data ?? []).map((u, i) => <Row key={u.id} title={`${dateFmt(u.date)} · ${money(u.balance, loan.currency)}${u.monthly_payment ? ` · ${money(u.monthly_payment, loan.currency)}/mo` : ''}`} sub={`was ${money(u.prev.principal, loan.currency)}${u.note ? ' · ' + u.note : ''}`}
      right={i === 0 ? <Btn small kind="ghost" title="Undo" onPress={async () => { if (await act(() => post(`/loan-updates/${u.id}/undo`), 'Undone')) onClose(); }} /> : undefined} />)}
  </Sheet>;
}
export function Schedule({ nav, params }: ScreenProps) {
  const l = params.loan; const [extra, setExtra] = useState(String(l.extra_monthly || ''));
  const s = useQ<any>(`/loans/${l.id}/schedule?extra=${Number(extra) || 0}`);
  const d = s.data;
  return <Screen title={l.name} back={nav.back}>
    <NumInput label="Try an extra monthly payment" value={extra} onChange={setExtra} />
    {!d ? <Loading /> : <>
      {d.interestSaved > 0 && <Card><T bold style={{ color: '#10b981' }}>Save {money(d.interestSaved, l.currency)} interest and finish {d.monthsSaved} months earlier.</T></Card>}
      <View style={{ flexDirection: 'row', gap: 10 }}><Stat label="Monthly" value={money(d.schedule.monthlyPayment + (d.fee ?? 0), l.currency)} /><Stat label="Total interest" value={money(d.schedule.totalInterest, l.currency)} /></View>
      <Card><LineChart data={d.schedule.rows} y="balance" label={(r) => monthFmt(r.date.slice(0, 7))} /></Card>
      <Card>{d.schedule.rows.map((r: any, i: number) => <View key={r.n}>{i > 0 && <Sep />}<Row title={`${r.n}. ${dateFmt(r.date)}`} sub={`interest ${money(r.interest, l.currency)} · principal ${money(r.principal, l.currency)}${r.extra ? ` · extra ${money(r.extra, l.currency)}` : ''}${d.fee ? ` · fee ${money(d.fee, l.currency)}` : ''}`} right={money(r.payment + r.extra + (d.fee ?? 0), l.currency)} rightSub={`left ${money(r.balance, l.currency)}`} /></View>)}</Card>
    </>}
  </Screen>;
}

// ---------- Subscriptions & bills ----------
export function Subscriptions({ nav }: ScreenProps) {
  const c = useColors(); const [tab, setTab] = useState<'bills' | 'subs'>('bills');
  const s = useQ<any>('/subscriptions'); const d = new Date(); d.setDate(d.getDate() + 45);
  const to = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const from = new Date(); from.setDate(from.getDate() - 30);
  const b = useQ<any[]>(`/bills?from=${from.toISOString().slice(0, 10)}&to=${to}`);
  const [edit, setEdit] = useState<any>(null);
  return <Screen title="Bills & subscriptions" back={nav.back} fab={{ label: 'Add', onPress: () => setEdit({ name: '', kind: 'subscription', amount: '', currency: 'GEL', unit: 'month', interval: '1', start_date: todayISO(), category_id: null, account_id: null, provider: '', variable: false, active: true }) }}>
    <BillCleanupNotice /><OverdueButton />
    <Seg value={tab} onChange={setTab} options={[{ value: 'bills', label: 'Bill calendar' }, { value: 'subs', label: 'Subscriptions' }]} />
    {s.data && <View style={{ flexDirection: 'row', gap: 10 }}><Stat label="Per month" value={money(s.data.totals.monthly)} /><Stat label="Per year" value={money(s.data.totals.yearly)} /></View>}
    {tab === 'bills' ? <Card>{!b.data ? <Loading /> : !b.data.length ? <Empty icon="🧾" title="No bills in this period" /> : b.data.map((x, i) => {
      const overdue = !x.paid && x.due_date < todayISO();
      return <View key={x.id}>{i > 0 && <Sep />}<Row title={x.name} sub={`${dateFmt(x.due_date)}${x.paid ? ' · paid' : overdue ? ' · overdue' : ''}`} dot={x.paid ? c.success : overdue ? c.danger : x.category_color ?? c.warning} icon={x.paid ? '✓' : x.type === 'loan' ? '🏦' : '🧾'}
        right={money(x.amount, x.currency)} rightSub={x.currency !== 'GEL' ? money(x.amount_gel) : undefined}
        onPress={() => Alert.alert(x.name, `${money(x.amount, x.currency)} · ${dateFmt(x.due_date)}`, x.paid ? [{ text: 'Cancel' }, { text: 'Mark unpaid', onPress: () => act(() => post(`/bills/${x.id}/unpay`)) }] : [{ text: 'Cancel' }, { text: 'Mark paid', onPress: () => act(() => post(`/bills/${x.id}/pay`, {}), 'Paid — transaction added') }])} /></View>; })}</Card>
      : <Card>{!s.data ? <Loading /> : !s.data.items.length ? <Empty icon="📺" title="No subscriptions" /> : s.data.items.map((x: any, i: number) => <View key={x.id}>{i > 0 && <Sep />}
        <Row title={x.name + (x.active ? '' : ' (paused)')} sub={`${x.kind} · next ${dateFmt(x.next_charge)}${x.unused ? ' · unused?' : ''}${x.duplicate ? ' · possible duplicate' : ''}`} right={money(x.amount, x.currency)} rightSub={`${money(x.monthly_gel)}/mo`} dot={x.category_color ?? c.primary} icon={x.kind === 'bill' ? '🧾' : '📺'}
          onPress={() => setEdit({ ...x, amount: String(x.amount), interval: String(x.interval), variable: !!x.variable, active: !!x.active })} /></View>)}</Card>}
    {edit && <Sheet open title={edit.id ? 'Edit' : 'New subscription / bill'} onClose={() => setEdit(null)} footer={<>
      {edit.id && <Btn kind="danger" title="Delete" onPress={async () => { if (await act(() => del(`/subscriptions/${edit.id}`))) setEdit(null); }} />}
      {edit.id && <Btn kind="outline" title="Used today" onPress={async () => { await act(() => post(`/subscriptions/${edit.id}/used`), 'Noted'); setEdit(null); }} />}
      <Btn title="Save" style={{ flex: 1 }} onPress={async () => { const body = { name: edit.name, kind: edit.kind, amount: num(edit.amount) ?? 0, currency: edit.currency, unit: edit.unit, interval: Number(edit.interval) || 1, start_date: edit.start_date, category_id: edit.category_id, account_id: edit.account_id, provider: edit.provider || null, variable: edit.variable, active: edit.active };
        if (await act(() => (edit.id ? put(`/subscriptions/${edit.id}`, body) : post('/subscriptions', body)), 'Saved')) setEdit(null); }} /></>}>
      <Seg value={edit.kind} onChange={(k) => setEdit({ ...edit, kind: k })} options={[{ value: 'subscription', label: 'Subscription' }, { value: 'bill', label: 'Utility bill' }]} />
      <Input label="Name" value={edit.name} onChangeText={(v) => setEdit({ ...edit, name: v })} />
      <NumInput label="Amount" value={edit.amount} onChange={(v) => setEdit({ ...edit, amount: v })} />
      <CurrencyPick value={edit.currency} onChange={(v) => setEdit({ ...edit, currency: v })} />
      <Pick label="Repeats" value={edit.unit} options={UNITS as any} onChange={(v) => setEdit({ ...edit, unit: v })} />
      <Input label="First charge date" value={edit.start_date} onChangeText={(v) => setEdit({ ...edit, start_date: v })} />
      <Input label="Provider" value={edit.provider ?? ''} onChangeText={(v) => setEdit({ ...edit, provider: v })} />
      <CategoryPick value={edit.category_id} onChange={(v) => setEdit({ ...edit, category_id: v })} kind="expense" />
      <AccountPick value={edit.account_id} onChange={(v) => setEdit({ ...edit, account_id: v })} />
      <Toggle label="Amount varies (utility)" value={edit.variable} onChange={(v) => setEdit({ ...edit, variable: v })} />
      <Toggle label="Active" value={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} />
    </Sheet>}
  </Screen>;
}

// ---------- Budgets & goals ----------
export function Budgets({ nav }: ScreenProps) {
  const c = useColors(); const b = useQ<any[]>('/budgets'); const g = useQ<any[]>('/goals'); const [tab, setTab] = useState<'b' | 'g'>('b');
  const [eb, setEb] = useState<any>(null); const [eg, setEg] = useState<any>(null); const [contrib, setContrib] = useState<any>(null);
  return <Screen title="Budgets & goals" back={nav.back} fab={{ label: tab === 'b' ? 'Budget' : 'Goal', onPress: () => (tab === 'b' ? setEb({ category_id: null, amount: '', rollover: false }) : setEg({ name: '', target: '', saved: '0', target_date: '', account_id: null })) }}>
    <Seg value={tab} onChange={setTab} options={[{ value: 'b', label: 'Monthly budgets' }, { value: 'g', label: 'Savings goals' }]} />
    {tab === 'b' ? (!b.data ? <Loading /> : !b.data.length ? <Card><Empty icon="🎯" title="No budgets" body="Set a monthly limit per category." /></Card> : b.data.map((x) => <Card key={x.id} onPress={() => setEb({ ...x, amount: String(x.amount), rollover: !!x.rollover })}>
      <View style={{ flexDirection: 'row' }}><T bold style={{ flex: 1 }}>{x.name}</T><T bold style={{ color: x.pct >= 1 ? c.danger : c.text }}>{money(x.spent)} / {money(x.limit)}</T></View>
      <View style={{ height: 8 }} /><Bar value={x.pct} /><T muted style={{ fontSize: 12, marginTop: 4 }}>{x.remaining >= 0 ? `${money(x.remaining)} left` : `${money(-x.remaining)} over`}{x.carry ? ` · carried ${money(x.carry)}` : ''}</T></Card>))
      : (!g.data ? <Loading /> : !g.data.length ? <Card><Empty icon="🏁" title="No goals" body="Emergency fund, vacation, car…" /></Card> : g.data.map((x) => <Card key={x.id} onPress={() => setEg({ ...x, target: String(x.target), saved: String(x.saved), target_date: x.target_date ?? '' })}>
        <View style={{ flexDirection: 'row' }}><T bold style={{ flex: 1 }}>{x.name}</T><T bold>{pct(x.pct)}</T></View><View style={{ height: 8 }} /><Bar value={x.pct} color={x.color} />
        <T muted style={{ fontSize: 12, marginTop: 4 }}>{money(x.saved)} of {money(x.target)}{x.required_monthly ? ` · ${money(x.required_monthly)}/mo to reach by ${dateFmt(x.target_date)}` : ''}</T>
        <View style={{ flexDirection: 'row', marginTop: 8 }}><Btn small kind="soft" title="+ Add money" onPress={() => setContrib({ id: x.id, amount: '' })} /></View></Card>))}
    {eb && <Sheet open title={eb.id ? 'Edit budget' : 'New budget'} onClose={() => setEb(null)} footer={<>{eb.id && <Btn kind="danger" title="Delete" onPress={async () => { if (await act(() => del(`/budgets/${eb.id}`))) setEb(null); }} />}
      <Btn title="Save" style={{ flex: 1 }} onPress={async () => { const body = { category_id: eb.category_id, amount: num(eb.amount), rollover: eb.rollover }; if (await act(() => (eb.id ? put(`/budgets/${eb.id}`, body) : post('/budgets', body)), 'Saved')) setEb(null); }} /></>}>
      <CategoryPick value={eb.category_id} onChange={(v) => setEb({ ...eb, category_id: v })} kind="expense" />
      <NumInput label="Monthly limit (₾)" value={eb.amount} onChange={(v) => setEb({ ...eb, amount: v })} />
      <Toggle label="Roll unused amount to next month" value={eb.rollover} onChange={(v) => setEb({ ...eb, rollover: v })} /></Sheet>}
    {eg && <Sheet open title={eg.id ? 'Edit goal' : 'New goal'} onClose={() => setEg(null)} footer={<>{eg.id && <Btn kind="danger" title="Delete" onPress={async () => { if (await act(() => del(`/goals/${eg.id}`))) setEg(null); }} />}
      <Btn title="Save" style={{ flex: 1 }} onPress={async () => { const body = { name: eg.name, target: num(eg.target), saved: num(eg.saved) ?? 0, target_date: eg.target_date || null, account_id: eg.account_id ?? null }; if (await act(() => (eg.id ? put(`/goals/${eg.id}`, body) : post('/goals', body)), 'Saved')) setEg(null); }} /></>}>
      <Input label="Name" value={eg.name} onChangeText={(v) => setEg({ ...eg, name: v })} />
      <NumInput label="Target (₾)" value={eg.target} onChange={(v) => setEg({ ...eg, target: v })} />
      <NumInput label="Saved so far" value={eg.saved} onChange={(v) => setEg({ ...eg, saved: v })} />
      <Input label="Target date (optional)" value={eg.target_date} onChangeText={(v) => setEg({ ...eg, target_date: v })} placeholder="2027-12-31" />
      <AccountPick value={eg.account_id ?? null} onChange={(v) => setEg({ ...eg, account_id: v })} label="Linked account" /></Sheet>}
    {contrib && <Sheet open title="Add to goal" onClose={() => setContrib(null)} footer={<Btn title="Add" style={{ flex: 1 }} onPress={async () => { if (await act(() => post(`/goals/${contrib.id}/contribute`, { amount: num(contrib.amount) }), 'Added')) setContrib(null); }} />}>
      <NumInput label="Amount (negative to withdraw)" value={contrib.amount} onChange={(v) => setContrib({ ...contrib, amount: v })} autoFocus /></Sheet>}
  </Screen>;
}

// ---------- Forecast & what-if ----------
export function Forecast({ nav }: ScreenProps) {
  const c = useColors(); const [months, setMonths] = useState(12); const [inc, setInc] = useState(''); const [exp, setExp] = useState('');
  const [loan, setLoan] = useState({ principal: '', rate: '', term: '' });
  const [data, setData] = useState<any>(null);
  const run = async () => setData(await act(() => post('/forecast', { months, incomeChangePct: num(inc) ?? undefined, newExpenseMonthly: num(exp) ?? undefined, newLoan: num(loan.principal) ? { principal: num(loan.principal), annualRatePct: num(loan.rate) ?? 0, termMonths: num(loan.term) ?? 12 } : null })));
  useEffect(() => { run(); }, [months]);
  const scen = data?.scenario?.length ? data.scenario : null;
  return <Screen title="Forecast & what-if" back={nav.back}>
    {data?.insufficient ? <Card><NoData nav={nav} what="Add income and expenses to see a forecast" /></Card> : !data ? <Loading /> : <>
      <View style={{ flexDirection: 'row', gap: 10 }}><Stat label="Today" value={money(data.startBalance)} /><Stat label={`In ${months} months`} value={money((scen ?? data.base)[(scen ?? data.base).length - 1]?.expected)} tone={c.primary} /></View>
      <Card><H2>Expected balance{scen ? ' (scenario)' : ''}</H2><View style={{ height: 8 }} /><LineChart data={scen ?? data.base} y="expected" band={['worst', 'best']} refY={data.minBalance} label={(d) => monthFmt(d.month)} />
        {data.firstBelow && <T style={{ color: c.danger, marginTop: 6 }}>⚠ Drops below your minimum of {money(data.minBalance)} in {monthFmt(data.firstBelow.month ?? data.firstBelow)}.</T>}
        {data.minBalance == null && <T muted style={{ fontSize: 12, marginTop: 6 }}>Set a minimum balance in Settings to get low-balance warnings.</T>}</Card>
    </>}
    <Card style={{ gap: 12 }}><H2>What if…</H2>
      <View style={{ flexDirection: 'row' }}>{[6, 12, 24, 36].map((m) => <Chip key={m} label={`${m} mo`} active={months === m} onPress={() => setMonths(m)} />)}</View>
      <NumInput label="Income change %" value={inc} onChange={setInc} placeholder="-20" />
      <NumInput label="New monthly expense (₾)" value={exp} onChange={setExp} />
      <T bold>New loan</T>
      <View style={{ flexDirection: 'row', gap: 8 }}><NumInput label="Amount" value={loan.principal} onChange={(v) => setLoan({ ...loan, principal: v })} style={{ flex: 1 }} /><NumInput label="Rate %" value={loan.rate} onChange={(v) => setLoan({ ...loan, rate: v })} style={{ flex: 1 }} /><NumInput label="Months" value={loan.term} onChange={(v) => setLoan({ ...loan, term: v })} style={{ flex: 1 }} /></View>
      <Btn title="Run scenario" onPress={run} /></Card>
  </Screen>;
}

export function Insights({ nav }: ScreenProps) {
  const d = useQ<any>('/dashboard'); const i = useQ<any[]>('/insights'); const an = useQ<any[]>('/anomalies');
  return <Screen title="Insights" back={nav.back} onRefresh={i.reload}>
    {d.data && !d.data.dataStatus?.sufficient ? <Card><NoData nav={nav} what="Add income and expenses to get insights" /></Card> : <>
      <Card>{!i.data ? <Loading /> : !i.data.length ? <Empty icon="💡" title="Nothing notable yet" /> : i.data.map((x, k) => <InsightRow key={k} i={x} />)}</Card>
      {(an.data ?? []).length > 0 && <Card><H2>Unusual transactions</H2>{(an.data ?? []).slice(0, 10).map((a: any) => <Row key={a.id} title={a.description ?? a.category_name ?? '—'} sub={dateFmt(a.date)} right={money(a.amount_gel)} rightSub={a.times ? `~${a.times}× typical` : undefined} />)}</Card>}
    </>}
  </Screen>;
}

export function Risk({ nav }: ScreenProps) {
  const c = useColors(); const r = useQ<any>('/risk'); const cr = useQ<any>('/credit-reports/latest');
  const credit = cr.data && !cr.data.none ? <Card><H2>Credit bureau (Creditinfo)</H2><View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}><Stat label="Score" value={String(cr.data.score ?? '—')} sub={cr.data.rating ?? undefined} /><Stat label="Reported debt" value={money(cr.data.summary?.totalDebt ?? 0)} /></View>
    <T muted style={{ fontSize: 11, marginTop: 6 }}>Report date {dateFmt(cr.data.report_date)}</T></Card> : <Btn kind="soft" title="Import your Creditinfo report" onPress={() => nav.push('import', { tab: 'credit' })} />;
  if (!r.data) return <Screen title="Risk control" back={nav.back}><Loading /></Screen>;
  const x = r.data;
  if (x.insufficient) return <Screen title="Risk control" back={nav.back}>{credit}<Card><NoData nav={nav} what="Add income and expenses to see your score" /></Card></Screen>;
  const grade = x.health.grade; const gc = x.health.score >= 70 ? c.success : x.health.score >= 45 ? c.warning : c.danger;
  const LBL: Record<string, string> = { savings: 'Savings rate', debt: 'Debt-to-income', emergency: 'Emergency fund', stability: 'Income stability' };
  return <Screen title="Risk control" back={nav.back} onRefresh={r.reload}>
    <Card style={{ alignItems: 'center', gap: 4 }}><Text style={{ fontSize: 52, fontWeight: '800', color: gc }}>{x.health.score}</Text><T bold style={{ color: gc, textTransform: 'capitalize' }}>{grade}</T><T muted>Financial health score</T></Card>
    <Card>{x.health.breakdown.map((b: any) => <View key={b.key} style={{ paddingVertical: 6 }}><View style={{ flexDirection: 'row' }}><T style={{ flex: 1 }}>{LBL[b.key] ?? b.key}</T><T bold>{b.score}/{b.max}</T></View><View style={{ height: 4 }} /><Bar value={b.score / b.max} color={c.primary} /></View>)}</Card>
    <View style={{ flexDirection: 'row', gap: 10 }}><Stat label="Debt-to-income" value={pct(x.health.dti)} tone={x.dtiLevel === 'ok' ? c.success : x.dtiLevel === 'warning' ? c.warning : c.danger} /><Stat label="Emergency fund" value={`${x.emergency.months.toFixed(1)} mo`} sub={`target ${x.emergency.target} mo`} /></View>
    <Card><H2>Stress test — if income stopped</H2><T muted style={{ fontSize: 12 }}>Runway {x.stress.runwayMonths} months at {money(x.stress.burn)}/month essentials + debt</T><View style={{ height: 8 }} /><LineChart data={x.stress.series} y="balance" color={c.warning} label={(d) => `${d.month} mo`} /></Card>
    <Card><H2>Next {x.lowBalance.days} days</H2>{x.lowBalance.minBalance == null ? <T muted style={{ fontSize: 12 }}>Set a minimum balance in Settings to get low-balance warnings.</T> : x.lowBalance.firstBelow ? <T style={{ color: c.danger }}>⚠ Below {money(x.lowBalance.minBalance)} on {dateFmt(x.lowBalance.firstBelow.date)}</T> : <T style={{ color: c.success }}>Stays above {money(x.lowBalance.minBalance)}</T>}
      <View style={{ height: 8 }} /><LineChart data={x.lowBalance.projection} y="balance" refY={x.lowBalance.minBalance} label={(d) => dateFmt(d.date)} /></Card>
    {credit}
  </Screen>;
}

export function Alerts({ nav }: ScreenProps) {
  const c = useColors(); const a = useQ<any>('/alerts');
  return <Screen title="Alerts" back={nav.back} onRefresh={a.reload} actions={<Btn small kind="ghost" title="Read all" onPress={() => act(() => post('/alerts/read-all'))} />}>
    <OverdueButton />
    {!a.data ? <Loading /> : !a.data.items.length ? <Card><Empty icon="🔔" title="No alerts" body="You’ll be notified about bills, budgets, low balance and unusual spending." /></Card> : a.data.items.map((x: any) => {
      const col = x.severity === 'danger' ? c.danger : x.severity === 'warning' ? c.warning : c.primary;
      return <Card key={x.id} style={[{ borderLeftWidth: 4, borderLeftColor: col }, x.read && { opacity: 0.65 }] as any} onPress={() => !x.read && act(() => post(`/alerts/${x.id}/read`))}>
        <T bold>{x.title}</T><T muted style={{ marginTop: 2 }}>{x.body}</T>
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}><Btn small kind="ghost" title="Snooze 1d" onPress={() => act(() => post(`/alerts/${x.id}/snooze`, { minutes: 1440 }), 'Snoozed')} /><Btn small kind="ghost" title="Dismiss" onPress={() => act(() => post(`/alerts/${x.id}/dismiss`))} />
          {x.ref_type === 'bill' && <Btn small kind="soft" title="Bills" onPress={() => nav.push('subscriptions')} />}</View></Card>; })}
  </Screen>;
}

export function Reports({ nav }: ScreenProps) {
  const c = useColors(); const [off, setOff] = useState(0);
  const d0 = new Date(); d0.setDate(1); d0.setMonth(d0.getMonth() + off);
  const from = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, '0')}-01`; const last = new Date(d0.getFullYear(), d0.getMonth() + 1, 0).getDate();
  const r = useQ<any>(`/reports?from=${from}&to=${from.slice(0, 8)}${last}`);
  return <Screen title="Reports" back={nav.back}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Btn small kind="outline" title="‹" onPress={() => setOff(off - 1)} /><T bold style={{ flex: 1, textAlign: 'center' }}>{monthFmt(from.slice(0, 7))}</T><Btn small kind="outline" title="›" onPress={() => setOff(Math.min(0, off + 1))} /></View>
    {!r.data ? <Loading /> : <>
      <View style={{ flexDirection: 'row', gap: 10 }}><Stat label="Income" value={money(r.data.income)} tone={c.success} /><Stat label="Expenses" value={money(r.data.expense)} tone={c.danger} /></View>
      <View style={{ flexDirection: 'row', gap: 10 }}><Stat label="Net" value={money(r.data.net)} /><Stat label="vs prev. month" value={r.data.compare?.prev?.expensePct != null ? `${r.data.compare.prev.expensePct > 0 ? '+' : ''}${pct(r.data.compare.prev.expensePct)}` : '—'} sub="expenses" /></View>
      <Card><H2>By category</H2>{!r.data.byCategory.length ? <Empty title="No spending this month" /> : r.data.byCategory.map((k: any) => <View key={k.id ?? k.name} style={{ paddingVertical: 6 }}><View style={{ flexDirection: 'row' }}><T style={{ flex: 1 }}>{k.name}</T><T bold>{money(k.total)}</T></View><View style={{ height: 4 }} /><Bar value={k.total / Math.max(1, r.data.expense)} color={k.color} /></View>)}</Card>
    </>}
  </Screen>;
}
void Input; void Seg;
