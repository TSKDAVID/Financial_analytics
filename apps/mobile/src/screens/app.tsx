import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FS from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Device from 'expo-device';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Badge, Btn, Card, Chip, Empty, H2, Input, Loading, NumInput, Pick, Row, Screen, Seg, Sep, Sheet, Stat, T, Toggle, useColors } from '../ui';
import { act, api, del, money, post, put, useQ, dateFmt, invalidate } from '../lapi';
import { AccountPick, CategoryPick, NoData, type ScreenProps, type Nav } from './common';
import { loadConn, pair, saveConn, type Conn } from '../api';
import { KIND_LABEL } from './extra';
import { checkSync, approveSync, history, undo, pollOutbox, type Pending } from '../sync';

async function pickPdf(): Promise<{ name: string; data: string } | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf'], copyToCacheDirectory: true, multiple: false });
  if (r.canceled || !r.assets?.[0]) return null;
  const a = r.assets[0];
  return { name: a.name ?? 'statement.pdf', data: await FS.readAsStringAsync(a.uri, { encoding: FS.EncodingType.Base64 }) };
}

// ---------- Import (bank statements + Creditinfo) ----------
export function ImportScreen({ nav, params }: ScreenProps) {
  const [tab, setTab] = useState<'st' | 'credit'>(params?.tab === 'credit' ? 'credit' : 'st');
  const imps = useQ<any[]>('/imports'); const crs = useQ<any[]>('/credit-reports');
  const [account, setAccount] = useState<number | null>(null); const [busy, setBusy] = useState(false);
  const upload = async () => {
    const f = await pickPdf(); if (!f) return; setBusy(true);
    try {
      if (tab === 'st') { const r = await act(() => post('/imports', { filename: f.name, data: f.data, account_id: account, ai: true })); if (r) nav.push('batch', { id: (r as any).id }); }
      else { const r = await act(() => post('/credit-reports', { filename: f.name, data: f.data })); if (r) nav.push('creditReport', { id: (r as any).id }); }
    } finally { setBusy(false); }
  };
  return <Screen title="Import" back={nav.back}>
    <Seg value={tab} onChange={setTab} options={[{ value: 'st', label: 'Bank statement' }, { value: 'credit', label: 'Credit report' }]} />
    <Card style={{ gap: 12 }}>
      <T muted>{tab === 'st' ? 'PDF statements from Bank of Georgia, TBC and Liberty. Each row gets a kind (purchase, own transfer / ყულაბა, sent to person, …) and category; transfers between your banks are matched. Nothing is added until you approve. Everything is processed on this phone.' : 'Your “My Creditinfo” PDF. Loans are proposed for review — nothing changes until you approve. Personal details are never stored.'}</T>
      {tab === 'st' && <AccountPick value={account} onChange={setAccount} label="Into account (optional)" />}
      <Btn icon="📄" title={busy ? 'Reading PDF…' : 'Choose PDF'} loading={busy} onPress={upload} />
    </Card>
    <H2>History</H2>
    <Card>{tab === 'st' ? (!(imps.data ?? []).length ? <Empty icon="🗂" title="No imports yet" /> : (imps.data ?? []).map((b, i) => <View key={b.id}>{i > 0 && <Sep />}<Row title={b.filename} sub={`${b.bank ?? ''} · ${b.stats?.total ?? 0} rows · ${dateFmt(b.created_at)}`} right={<Badge label={b.status} tone={b.status === 'approved' ? 'success' : b.status === 'reverted' || b.status === 'discarded' ? 'default' : 'warning'} />} onPress={() => nav.push('batch', { id: b.id })} /></View>))
      : (!(crs.data ?? []).length ? <Empty icon="🗂" title="No reports yet" /> : (crs.data ?? []).map((r, i) => <View key={r.id}>{i > 0 && <Sep />}<Row title={r.filename} sub={`score ${r.score ?? '—'} ${r.rating ?? ''} · ${dateFmt(r.report_date)}`} right={<Badge label={r.status} tone={r.status === 'approved' ? 'success' : 'warning'} />} onPress={() => nav.push('creditReport', { id: r.id })} /></View>))}</Card>
  </Screen>;
}
const INTERNAL = ['internal', 'exchange', 'loan_disbursement', 'cash_deposit'];
export function BatchScreen({ nav, params }: ScreenProps) {
  const c = useColors(); const b = useQ<any>(`/imports/${params.id}`); const [edit, setEdit] = useState<any>(null); const [filter, setFilter] = useState<'all' | 'low' | 'internal' | 'dup'>('all');
  if (!b.data) return <Screen title="Import" back={nav.back}><Loading /></Screen>;
  const x = b.data; const done = x.status === 'approved'; const closed = x.status === 'discarded' || x.status === 'reverted';
  const rows = (x.rows as any[]).filter((r) => filter === 'all' || (filter === 'low' ? r.confidence < 0.6 && !r.excluded : filter === 'internal' ? INTERNAL.includes(r.tx_kind) || r.match_id : r.duplicate_of));
  return <Screen title={x.filename} back={nav.back}>
    <View style={{ flexDirection: 'row', gap: 10 }}><Stat label="Income" value={money(x.stats.income)} tone={c.success} /><Stat label="Expenses" value={money(x.stats.expense)} tone={c.danger} /></View>
    <T muted style={{ fontSize: 12 }}>{x.stats.included}/{x.stats.total} included · {x.stats.duplicates} possible duplicates · {x.stats.low} need review</T>
    {x.verification && <T style={{ fontSize: 12, color: x.verification.totals.every((v: any) => v.ok) && !x.verification.mismatches ? c.success : c.warning }}>{x.verification.totals.every((v: any) => v.ok) && !x.verification.mismatches ? '✓ Balances verified' : '⚠ Balances do not reconcile'} · {x.verification.totals.map((v: any) => `${v.currency} ${v.count}`).join(' · ')}</T>}
    {(x.warnings ?? []).map((w: string, i: number) => <T key={i} style={{ color: c.warning, fontSize: 12 }}>⚠ {w}</T>)}
    <Btn kind="soft" icon="⇄" title="Smart groups: transfers, people, recurring" onPress={() => nav.push('importGroups', { id: x.id, locked: closed })} />
    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
      {!done && !closed && <><Btn title="Approve" onPress={() => Alert.alert('Approve import?', `${x.stats.included} transactions will be added.`, [{ text: 'Cancel' }, { text: 'Approve', onPress: () => act(() => post(`/imports/${x.id}/approve`, {}), 'Imported') }])} />
        <Btn kind="outline" title="Ask AI" onPress={() => act(() => post(`/imports/${x.id}/ai`), 'AI suggestions applied')} /><Btn kind="ghost" title="Discard" onPress={() => act(() => post(`/imports/${x.id}/discard`)).then(nav.back)} /></>}
      {done && <Btn kind="danger" title="Revert import" onPress={() => Alert.alert('Revert?', 'Removes the transactions this import added.', [{ text: 'Cancel' }, { text: 'Revert', style: 'destructive', onPress: () => act(() => post(`/imports/${x.id}/revert`), 'Reverted') }])} />}
    </View>
    <View style={{ flexDirection: 'row' }}>{[['all', 'All'], ['low', 'Needs review'], ['internal', 'Internal'], ['dup', 'Duplicates']].map(([k, l]) => <Chip key={k} label={l} active={filter === k} onPress={() => setFilter(k as any)} />)}</View>
    <Card>{rows.map((r, i) => <View key={r.id} style={r.excluded ? { opacity: 0.45 } : undefined}>{i > 0 && <Sep />}
      <Row title={r.description} sub={`${dateFmt(r.date)} · ${KIND_LABEL[r.tx_kind] ?? ''}${INTERNAL.includes(r.tx_kind) ? '' : ' · ' + (r.category_name ?? 'Uncategorized')} · ${Math.round(r.confidence * 100)}%${r.match_id ? ` · ⇄ ${r.match_status}` : ''}${r.duplicate_of ? ' · duplicate?' : ''}${r.why ? `\n${r.why}` : ''}`}
        right={<Text style={{ fontWeight: '700', color: r.kind === 'income' ? c.success : c.text }}>{r.kind === 'income' ? '+' : '−'}{money(r.amount, r.currency)}</Text>} dot={r.category_color ?? (r.confidence < 0.6 ? c.warning : c.muted)}
        onPress={() => !done && !closed && setEdit(r)} /></View>)}</Card>
    {edit && <Sheet open title={edit.description} onClose={() => setEdit(null)} footer={<><Btn kind="outline" title={edit.excluded ? 'Include' : 'Exclude'} onPress={async () => { await act(() => put(`/imports/rows/${edit.id}`, { excluded: !edit.excluded })); setEdit(null); }} />
      <Btn title="Save" style={{ flex: 1 }} onPress={async () => { await act(() => put(`/imports/rows/${edit.id}`, { category_id: edit.category_id, kind: edit.kind, tx_kind: edit.tx_kind ?? undefined }), 'Saved — merchant learned'); setEdit(null); }} /></>}>
      <Seg value={edit.kind} onChange={(k) => setEdit({ ...edit, kind: k })} options={[{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }]} />
      <Pick label="Kind" value={edit.tx_kind ?? 'purchase'} options={Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))} onChange={(v) => setEdit({ ...edit, tx_kind: v })} />
      {edit.why && <T muted style={{ fontSize: 12 }}>Why: {edit.why}</T>}
      {!INTERNAL.includes(edit.tx_kind) && <CategoryPick value={edit.category_id} onChange={(v) => setEdit({ ...edit, category_id: v })} kind={edit.kind} />}
    </Sheet>}
  </Screen>;
}
export function CreditReportScreen({ nav, params }: ScreenProps) {
  const c = useColors(); const r = useQ<any>(`/credit-reports/${params.id}`); const [edit, setEdit] = useState<any>(null);
  if (!r.data) return <Screen title="Credit report" back={nav.back}><Loading /></Screen>;
  const x = r.data; const s = x.summary ?? {};
  return <Screen title="Credit report" back={nav.back}>
    <View style={{ flexDirection: 'row', gap: 10 }}><Stat label="Score" value={String(x.score ?? '—')} sub={x.rating ?? undefined} /><Stat label="Total debt" value={money(s.totalDebt ?? 0)} /></View>
    {x.ai_note && <T style={{ color: c.warning, fontSize: 12 }}>{x.ai_note}</T>}
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {x.status !== 'approved' && x.status !== 'discarded' && <Btn title="Approve into loans" onPress={() => act(() => post(`/credit-reports/${x.id}/approve`, {}), 'Loans updated')} />}
      {(x.status === 'approved' || x.status === 'partial') && <Btn kind="danger" title="Revert" onPress={() => act(() => post(`/credit-reports/${x.id}/revert`), 'Reverted')} />}
    </View>
    {(x.contracts ?? []).map((k: any) => { const p = k.proposed; const d = k.data;
      return <Card key={k.id} style={k.excluded ? { opacity: 0.5 } : undefined}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}><T bold style={{ flex: 1 }}>{k.creditor} …{(k.external_id ?? '').slice(-4)}</T><Badge label={k.action} tone={k.action === 'create' ? 'primary' : k.action === 'update' ? 'warning' : 'default'} /></View>
        <T muted style={{ fontSize: 12 }}>{p.name} · balance {money(d.balance ?? 0, d.currency)}</T>
        <T style={{ marginTop: 4 }}>{p.monthly_payment ? `Payment ${money(p.monthly_payment, d.currency)}` : p.needs_input && k.active ? '⚠ Needs your input — no monthly payment in the report' : p.term_months ? `Spread over ${p.term_months} months` : ''}{p.monthly_fee ? ` · fee ${money(p.monthly_fee, d.currency)}` : ''}</T>
        {(k.diff ?? []).map((df: any) => <T key={df.field} style={{ color: c.warning, fontSize: 12 }}>{df.field}: {String(df.from)} → {String(df.to)}</T>)}
        {!k.applied_loan_id && ['create', 'update', 'close'].includes(k.action) && <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <Btn small kind="outline" title="Edit" onPress={() => setEdit({ id: k.id, name: p.name, principal: String(p.principal), annual_rate: String(p.annual_rate), term_months: String(p.term_months), monthly_payment: p.monthly_payment ? String(p.monthly_payment) : '', start_date: p.start_date })} />
          <Btn small kind="ghost" title={k.excluded ? 'Include' : 'Exclude'} onPress={() => act(() => put(`/credit-contracts/${k.id}`, { excluded: !k.excluded }))} /></View>}
      </Card>; })}
    {edit && <Sheet open title="Edit proposed loan" onClose={() => setEdit(null)} footer={<Btn title="Save" style={{ flex: 1 }} onPress={async () => { await act(() => put(`/credit-contracts/${edit.id}`, { proposed: { name: edit.name, principal: Number(edit.principal), annual_rate: Number(edit.annual_rate), term_months: Math.round(Number(edit.term_months) || 0), monthly_payment: Number(edit.monthly_payment) > 0 ? Number(edit.monthly_payment) : null, start_date: edit.start_date } }), 'Saved'); setEdit(null); }} />}>
      <Input label="Name" value={edit.name} onChangeText={(v) => setEdit({ ...edit, name: v })} />
      <NumInput label="Principal / balance" value={edit.principal} onChange={(v) => setEdit({ ...edit, principal: v })} />
      <NumInput label="Annual rate %" value={edit.annual_rate} onChange={(v) => setEdit({ ...edit, annual_rate: v })} />
      <NumInput label="Term (months)" value={edit.term_months} onChange={(v) => setEdit({ ...edit, term_months: v })} />
      <NumInput label="Monthly payment" value={edit.monthly_payment} onChange={(v) => setEdit({ ...edit, monthly_payment: v })} />
      <Input label="Start / next payment date" value={edit.start_date} onChangeText={(v) => setEdit({ ...edit, start_date: v })} />
    </Sheet>}
  </Screen>;
}

// ---------- Sync ----------
const TL: Record<string, string> = { accounts: 'Accounts', categories: 'Categories', recurring: 'Recurring', loans: 'Loans', subscriptions: 'Subscriptions', transactions: 'Transactions', bills: 'Bills', budgets: 'Budgets', goals: 'Goals', loan_updates: 'Loan updates', settings: 'Settings' };
export function SummaryView({ p, choices, setChoices, peerName }: { p: Pending; choices: Record<string, 'local' | 'remote'>; setChoices: (c: Record<string, 'local' | 'remote'>) => void; peerName: string }) {
  const c = useColors(); const s = p.plan.summary;
  const counts = (o: Record<string, any>) => Object.entries(o).map(([t, n]: any) => `${TL[t] ?? t}: ${[n.added && `+${n.added}`, n.edited && `~${n.edited}`, n.deleted && `−${n.deleted}`].filter(Boolean).join(' ')}`);
  return <View style={{ gap: 10 }}>
    <Card style={{ gap: 4 }}><T bold>To this phone</T>{counts(s.toLocal).length ? counts(s.toLocal).map((l) => <T key={l} muted>{l}</T>) : <T muted>Nothing</T>}</Card>
    <Card style={{ gap: 4 }}><T bold>To {peerName}</T>{counts(s.toRemote).length ? counts(s.toRemote).map((l) => <T key={l} muted>{l}</T>) : <T muted>Nothing</T>}</Card>
    {s.samples.length > 0 && <Card>{s.samples.map((x, i) => <T key={i} style={{ fontSize: 12 }} muted>{x.dir === 'toLocal' ? '⬇' : '⬆'} {x.kind} {TL[x.table] ?? x.table}: {x.label}</T>)}</Card>}
    {p.plan.conflicts.length > 0 && <Card style={{ gap: 8, borderColor: c.warning }}><T bold style={{ color: c.warning }}>{p.plan.conflicts.length} conflict(s) — edited on both devices. Pick the version to keep:</T>
      {p.plan.conflicts.map((k) => <View key={k.key} style={{ gap: 4 }}><T bold>{TL[k.table] ?? k.table}: {k.label}</T>
        <View style={{ flexDirection: 'row' }}><Chip label={k.localDeleted ? 'Phone (deleted)' : `Phone · ${k.local?.u?.slice(0, 16).replace('T', ' ') ?? ''}`} active={choices[k.key] === 'local'} onPress={() => setChoices({ ...choices, [k.key]: 'local' })} />
          <Chip label={k.remoteDeleted ? `${peerName} (deleted)` : `${peerName} · ${k.remote?.u?.slice(0, 16).replace('T', ' ') ?? ''}`} active={choices[k.key] === 'remote'} onPress={() => setChoices({ ...choices, [k.key]: 'remote' })} /></View></View>)}</Card>}
  </View>;
}
export function SyncScreen({ nav }: ScreenProps) {
  const c = useColors(); const [conn, setConn] = useState<Conn | null | undefined>(undefined);
  const [p, setP] = useState<Pending | null>(null); const [busy, setBusy] = useState(false); const [choices, setChoices] = useState<Record<string, 'local' | 'remote'>>({}); const [h, setH] = useState<any[]>([]);
  const refreshH = () => setH(history());
  useEffect(() => { loadConn().then(setConn); refreshH(); }, []);
  const check = async () => { setBusy(true); try { await pollOutbox(); refreshH(); invalidate(); const r = await checkSync(); setP(r); setChoices({}); } catch (e: any) { Alert.alert('Can’t reach your computer', e.message); } finally { setBusy(false); } };
  if (conn === undefined) return <Loading />;
  if (!conn) return <Screen title="Sync with computer" back={nav.back}><PairCard onPaired={(cn) => { setConn(cn); }} /></Screen>;
  return <Screen title="Sync with computer" back={nav.back}>
    <Card style={{ gap: 6 }}><T bold>Paired with {conn.url}</T><T muted style={{ fontSize: 12 }}>Two-way, approval-based. Nothing changes on either device until you approve. Newest change wins; true conflicts are shown so you pick.</T>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}><Btn title="Check for changes" loading={busy} onPress={check} /><Btn kind="ghost" title="Unpair" onPress={() => Alert.alert('Unpair?', 'Local data stays on this phone.', [{ text: 'Cancel' }, { text: 'Unpair', style: 'destructive', onPress: async () => { await saveConn(null); setConn(null); } }])} /></View></Card>
    {p && (p.plan.summary.total === 0 ? <Card><T style={{ color: c.success }}>✓ Everything is in sync.</T></Card> : <>
      <H2>Do you want to sync?</H2>
      <SummaryView p={p} choices={choices} setChoices={setChoices} peerName={p.peerName} />
      <View style={{ flexDirection: 'row', gap: 8 }}><Btn kind="outline" title="Not now" onPress={() => setP(null)} />
        <Btn title="Sync now" style={{ flex: 1 }} loading={busy} disabled={p.plan.conflicts.some((k) => !choices[k.key])} onPress={async () => { setBusy(true); try { const r = await approveSync(p, choices); setP(null); refreshH(); invalidate(); Alert.alert('Synced', r.errors.length ? r.errors.slice(0, 3).join('\n') : 'Both devices are up to date.'); } catch (e: any) { Alert.alert('Sync failed', e.message); } finally { setBusy(false); } }} /></View>
    </>)}
    <H2>History</H2>
    <Card>{!h.length ? <Empty icon="🔄" title="No syncs yet" /> : h.map((x, i) => <View key={x.id}>{i > 0 && <Sep />}<Row title={`${dateFmt(x.created_at)} ${x.created_at.slice(11, 16)} · ${x.peer_name}`} sub={`${x.direction} · ${x.summary.total} change(s)${x.undone_at ? ' · undone' : ''}`}
      right={i === 0 && !x.undone_at ? <Btn small kind="ghost" title="Undo" onPress={() => Alert.alert('Undo last sync?', 'Restores both devices to how they were before this sync.', [{ text: 'Cancel' }, { text: 'Undo', style: 'destructive', onPress: async () => { const r = await undo(x.id); refreshH(); invalidate(); if (!r.remoteOk) Alert.alert('Undone on this phone', 'The computer was not reachable — undo it from the desktop Phone sync page.'); } }])} /> : undefined} /></View>)}</Card>
  </Screen>;
}
export function PairCard({ onPaired }: { onPaired: (c: Conn) => void }) {
  const [perm, requestPerm] = useCameraPermissions(); const [scan, setScan] = useState(false); const [url, setUrl] = useState(''); const [code, setCode] = useState(''); const [busy, setBusy] = useState(false); const [cands, setCands] = useState<string[]>([]);
  const doPair = async (u: string | string[], k: string) => { setBusy(true); try { onPaired(await pair(u, k, `${Device.manufacturer ?? ''} ${Device.modelName ?? 'Android'}`.trim())); } catch (e: any) { Alert.alert('Pairing failed', e.message + '\n\nBoth devices must be on the same Wi-Fi (or Tailscale) and the desktop app must be running. You can type the computer\'s Wi-Fi address below (e.g. 192.168.1.10) and tap Pair.'); } finally { setBusy(false); } };
  if (scan) return <View style={{ height: 420, borderRadius: 18, overflow: 'hidden' }}><CameraView style={{ flex: 1 }} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => { try { const o = JSON.parse(data); if (o.fa && (o.url || o.urls) && o.code) { const list: string[] = [...(o.url ? [o.url] : []), ...(Array.isArray(o.urls) ? o.urls : [])]; setScan(false); setUrl(list[0]); setCands(list); setCode(o.code); doPair(list, o.code); } } catch { /* not ours */ } }} />
    <View style={{ position: 'absolute', bottom: 16, left: 16, right: 16 }}><Btn title="Cancel" kind="danger" onPress={() => setScan(false)} /></View></View>;
  return <Card style={{ gap: 12 }}><T bold style={{ fontSize: 16 }}>Pair with the desktop app (optional)</T>
    <T muted>The app works fully offline. Pair only if you want to sync with your computer: desktop → Settings → Phone & notifications → “Pair Android phone”.</T>
    <Btn icon="📷" title="Scan QR code" loading={busy} onPress={async () => { if (!perm?.granted) { const r = await requestPerm(); if (!r.granted) return; } setScan(true); }} />
    <Input label="Computer address (manual)" value={url} onChangeText={(v) => { setUrl(v); setCands([]); }} autoCapitalize="none" keyboardType="url" placeholder="192.168.1.10 or http://192.168.1.10:5317" />
    {cands.length > 1 && <T muted style={{ fontSize: 11 }}>From QR, tried in order: {cands.map((u) => u.replace(/^https?:\/\//, '')).join(' → ')}</T>}
    <Input label="Pairing code" value={code} onChangeText={setCode} autoCapitalize="none" />
    <Btn kind="outline" title="Pair" loading={busy} disabled={!url.trim() || code.length < 6} onPress={() => doPair(cands.length && cands[0] === url ? cands : url, code)} /></Card>;
}

// ---------- Settings ----------
export function SettingsScreen({ nav }: ScreenProps) {
  const s = useQ<any>('/settings'); const [f, setF] = useState<any>(null);
  useEffect(() => { if (s.data && !f) setF(s.data); }, [s.data]);
  if (!f) return <Screen title="Settings" back={nav.back}><Loading /></Screen>;
  const save = (patch: any) => { setF({ ...f, ...patch }); return act(() => put('/settings', patch), 'Saved'); };
  return <Screen title="Settings" back={nav.back}>
    <Card style={{ gap: 12 }}><H2>Money</H2>
      <NumInput label="Minimum balance (₾)" hint="Leave empty for no low-balance warnings" value={f.minBalance} onChange={(v) => setF({ ...f, minBalance: v })} onBlur={() => save({ minBalance: f.minBalance ?? '' })} />
      <NumInput label="Low-balance look-ahead (days)" value={f.lowBalanceDays} onChange={(v) => setF({ ...f, lowBalanceDays: v })} onBlur={() => save({ lowBalanceDays: f.lowBalanceDays })} />
      <NumInput label="Emergency fund target (months)" value={f.emergencyTargetMonths} onChange={(v) => setF({ ...f, emergencyTargetMonths: v })} onBlur={() => save({ emergencyTargetMonths: f.emergencyTargetMonths })} />
      <Input label="Device name (shown when syncing)" value={f.deviceName ?? 'Phone'} onChangeText={(v) => setF({ ...f, deviceName: v })} onBlur={() => save({ deviceName: f.deviceName })} /></Card>
    <Card style={{ gap: 12 }}><H2>AI categorization</H2><T muted style={{ fontSize: 12 }}>Only descriptions and amounts of low-confidence statement rows are sent. Credit reports use local providers only.</T>
      <Toggle label="Use AI for uncertain rows" value={f.aiEnabled === '1'} onChange={(v) => save({ aiEnabled: v ? '1' : '0' })} />
      <Pick label="Provider" value={f.aiProvider} options={[{ value: 'ollama', label: 'Ollama (your computer)' }, { value: 'openai', label: 'OpenAI-compatible' }, { value: 'groq', label: 'Groq' }]} onChange={(v) => save({ aiProvider: v })} />
      {f.aiProvider === 'ollama' && <Input label="Ollama URL" hint="e.g. http://100.x.y.z:11434 (your PC over Tailscale)" value={f.ollamaUrl} onChangeText={(v) => setF({ ...f, ollamaUrl: v })} onBlur={() => save({ ollamaUrl: f.ollamaUrl })} autoCapitalize="none" />}
      {f.aiProvider === 'openai' && <Input label="Base URL" value={f.openaiBaseUrl} onChangeText={(v) => setF({ ...f, openaiBaseUrl: v })} onBlur={() => save({ openaiBaseUrl: f.openaiBaseUrl })} autoCapitalize="none" />}
      {f.aiProvider === 'groq' && <Input label={`Groq API key${f.groqKeySet ? ' (saved)' : ''}`} secureTextEntry onEndEditing={(e) => e.nativeEvent.text && save({ groqKey: e.nativeEvent.text })} />}
      <Btn small kind="outline" title="Test connection" onPress={() => act(() => post('/ai/test', {})).then((r: any) => r && Alert.alert(r.ok ? 'Connected' : 'Not reachable', r.message ?? r.error ?? ''))} /></Card>
    <Card style={{ gap: 10 }}><H2>Data</H2>
      <Btn kind="outline" title="Export backup (share)" onPress={async () => { const r = await act(() => post<any>('/backup/export', { password: 'local-backup' })); if (!r) return; const path = FS.cacheDirectory + (r.name ?? 'finance-backup.json'); await FS.writeAsStringAsync(path, r.file); await Sharing.shareAsync(path); }} />
      <Btn kind="outline" title="Restore backup" onPress={async () => { const d = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true }); if (d.canceled || !d.assets?.[0]) return; const file = await FS.readAsStringAsync(d.assets[0].uri); Alert.alert('Restore backup?', 'This replaces all data on this phone.', [{ text: 'Cancel' }, { text: 'Restore', style: 'destructive', onPress: () => act(() => post('/backup/restore', { file, password: 'local-backup' }), 'Restored') }]); }} />
      <Btn kind="outline" title="Load demo data" onPress={() => Alert.alert('Load demo data?', 'Adds sample accounts and transactions.', [{ text: 'Cancel' }, { text: 'Load', onPress: () => act(() => post('/demo/seed'), 'Demo data loaded') }])} />
      <Btn kind="danger" title="Delete all data" onPress={() => Alert.alert('Delete everything on this phone?', 'This cannot be undone.', [{ text: 'Cancel' }, { text: 'Delete', style: 'destructive', onPress: () => act(() => post('/data/reset', { confirm: 'DELETE' }), 'All data deleted') }])} /></Card>
  </Screen>;
}

// ---------- More ----------
const ITEMS = [
  ['accounts', '🏦', 'Accounts'], ['categories', '🏷', 'Categories'], ['recurring', '🔁', 'Recurring'], ['loans', '💳', 'Loans & cards'],
  ['subscriptions', '🧾', 'Bills & subs'], ['budgets', '🎯', 'Budgets & goals'], ['forecast', '📈', 'Forecast'], ['insights', '💡', 'Insights'],
  ['risk', '🛡', 'Risk'], ['reports', '📊', 'Reports'], ['import', '📄', 'Import'], ['people', '👥', 'People'], ['merchants', '🏪', 'Merchants'], ['sync', '🔄', 'Sync'], ['settings', '⚙️', 'Settings'],
] as const;
export function More({ nav }: { nav: Nav }) {
  const c = useColors();
  return <Screen title="More">
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>{ITEMS.map(([k, i, l]) => <Pressable key={k} onPress={() => nav.push(k)} android_ripple={{ color: c.primarySoft }}
      style={({ pressed }) => ({ width: '31%', aspectRatio: 1, backgroundColor: c.card, borderRadius: 18, alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 0.5, borderColor: c.border, opacity: pressed ? 0.8 : 1 })}>
      <Text style={{ fontSize: 28 }}>{i}</Text><Text style={{ color: c.text, fontSize: 12, fontWeight: '600', textAlign: 'center' }}>{l}</Text></Pressable>)}</View>
    <T muted style={{ fontSize: 11, textAlign: 'center', marginTop: 12 }}>All data is stored on this phone. Works offline.</T>
  </Screen>;
}
void del; void NoData; void api; void money;
