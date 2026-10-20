import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Device from 'expo-device';
import { api, pair, money, todayISO, saveConn, loadConn, type Conn } from './api';
import { setupNotifications, syncAlerts } from './notifications';
import { Btn, Card, Center, Chip, H, Input, T, useColors } from './ui';

function useLoad<T>(path: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(false);
  const load = useCallback(async () => { setLoading(true); try { setData(await api<T>(path)); setError(null); } catch (e: any) { setError(e.message); } finally { setLoading(false); } }, [path]);
  useEffect(() => { load(); }, [load, ...deps]);
  return { data, error, loading, reload: load };
}
const ErrorBox = ({ msg, retry }: { msg: string; retry: () => void }) => { const c = useColors(); return <Card style={{ borderColor: c.danger, margin: 16 }}><T bold style={{ color: c.danger }}>⚠ {msg}</T><View style={{ height: 10 }} /><Btn small kind="outline" title="Retry" onPress={retry} /></Card>; };

// ---------- Pairing ----------
export function PairScreen({ onPaired }: { onPaired: (c: Conn) => void }) {
  const c = useColors(); const [perm, requestPerm] = useCameraPermissions();
  const [scan, setScan] = useState(false); const [url, setUrl] = useState('http://100.'); const [code, setCode] = useState(''); const [busy, setBusy] = useState(false);
  const doPair = async (u: string, k: string) => {
    setBusy(true);
    try { const conn = await pair(u, k, `${Device.manufacturer ?? ''} ${Device.modelName ?? 'Android'}`.trim()); onPaired(conn); }
    catch (e: any) { Alert.alert('Pairing failed', e.message + '\n\nCheck that Tailscale is connected on both devices and the desktop app is running.'); }
    finally { setBusy(false); }
  };
  if (scan) return <View style={{ flex: 1 }}>
    <CameraView style={{ flex: 1 }} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => {
      try { const o = JSON.parse(data); if (o.fa && o.url && o.code) { setScan(false); setUrl(o.url); setCode(o.code); doPair(o.url, o.code); } } catch { /* not ours */ }
    }} />
    <View style={{ position: 'absolute', bottom: 40, left: 24, right: 24 }}><Btn title="Cancel" kind="danger" onPress={() => setScan(false)} /></View></View>;
  return <ScrollView contentContainerStyle={{ padding: 24, gap: 16, paddingTop: 60 }} style={{ backgroundColor: c.bg }}>
    <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontSize: 30 }}>₾</Text></View>
    <H>Connect to your computer</H>
    <T muted>Open the desktop app → Settings → Phone & notifications → “Pair Android phone”, then scan the QR code. Both devices must be signed in to Tailscale.</T>
    <Btn title="📷  Scan QR code" loading={busy} onPress={async () => { if (!perm?.granted) { const r = await requestPerm(); if (!r.granted) return; } setScan(true); }} />
    <Card style={{ gap: 12 }}><T bold>Or enter manually</T>
      <Input label="Server URL" value={url} onChangeText={setUrl} autoCapitalize="none" keyboardType="url" placeholder="http://100.x.y.z:5317" />
      <Input label="Pairing code" value={code} onChangeText={setCode} autoCapitalize="none" />
      <Btn title="Pair" kind="outline" loading={busy} disabled={!url || code.length < 8} onPress={() => doPair(url, code)} /></Card>
  </ScrollView>;
}

// ---------- Home ----------
export function HomeScreen({ go }: { go: (tab: string) => void }) {
  const c = useColors();
  const d = useLoad<any>('/dashboard'); const r = useLoad<any>('/risk'); const bills = useLoad<any[]>('/bills/upcoming'); const al = useLoad<any>('/alerts');
  const reload = () => { d.reload(); r.reload(); bills.reload(); al.reload(); };
  if (d.error) return <ErrorBox msg={d.error} retry={reload} />;
  const x = d.data;
  const Stat = ({ l, v, color }: { l: string; v: string; color?: string }) => <Card style={{ flex: 1, minWidth: '45%' }}><T muted style={{ fontSize: 12 }}>{l}</T><Text style={{ color: color ?? c.text, fontSize: 19, fontWeight: '700', marginTop: 4 }}>{v}</Text></Card>;
  return <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 16, gap: 12 }} refreshControl={<RefreshControl refreshing={d.loading} onRefresh={reload} />}>
    <H>This month</H>
    {x && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      <Stat l="Net cash flow" v={money(x.net)} color={x.net >= 0 ? c.success : c.danger} /><Stat l="Savings rate" v={`${(x.savingsRate * 100).toFixed(1)}%`} />
      <Stat l="Income" v={money(x.income)} color={c.success} /><Stat l="Expenses" v={money(x.expense)} />
      <Stat l="Net worth" v={money(x.netWorth)} /><Stat l="Health score" v={r.data ? `${r.data.health.score}/100` : '…'} color={r.data && r.data.health.score >= 65 ? c.success : c.warning} />
    </View>}
    {!!al.data?.unread && <Pressable onPress={() => go('alerts')}><Card style={{ borderColor: c.danger, flexDirection: 'row', alignItems: 'center', gap: 10 }}><Text style={{ fontSize: 20 }}>🔔</Text><T bold>{al.data.unread} unread alert{al.data.unread > 1 ? 's' : ''}</T></Card></Pressable>}
    <Card style={{ gap: 10 }}><T bold>Upcoming bills</T>
      {(bills.data ?? []).slice(0, 6).map((b) => <View key={b.id} style={{ flexDirection: 'row', justifyContent: 'space-between' }}><View style={{ flex: 1 }}><T>{b.name}</T><T muted style={{ fontSize: 12, color: b.due_date < todayISO() ? c.danger : c.muted }}>{b.due_date}{b.due_date < todayISO() ? ' · overdue' : ''}</T></View><T bold>{money(b.amount, b.currency)}</T></View>)}
      {!bills.data?.length && <T muted>Nothing due ✓</T>}</Card>
    {x && <Card style={{ gap: 8 }}><T bold>Accounts</T>{x.accounts.map((a: any) => <View key={a.id} style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T>{a.name}</T><T bold style={{ color: a.balance < 0 ? c.danger : c.text }}>{money(a.balance, a.currency)}</T></View>)}</Card>}
  </ScrollView>;
}

// ---------- Alerts ----------
export function AlertsScreen({ onChange }: { onChange: () => void }) {
  const c = useColors(); const a = useLoad<{ items: any[]; unread: number }>('/alerts'); const [open, setOpen] = useState<any>(null);
  const act = async (id: number, action: string, body: unknown = {}) => { try { await api(`/alerts/${id}/${action}`, { body }); await a.reload(); onChange(); } catch (e: any) { Alert.alert('Error', e.message); } };
  const pay = async (billId: number) => { try { await api(`/bills/${billId}/pay`, { body: {} }); setOpen(null); await a.reload(); onChange(); } catch (e: any) { Alert.alert('Error', e.message); } };
  const sev = (s: string) => (s === 'danger' ? c.danger : s === 'warning' ? c.warning : c.primary);
  if (a.error) return <ErrorBox msg={a.error} retry={a.reload} />;
  return <View style={{ flex: 1, backgroundColor: c.bg }}>
    <FlatList data={a.data?.items ?? []} keyExtractor={(x) => String(x.id)} contentContainerStyle={{ padding: 16, gap: 10 }} refreshControl={<RefreshControl refreshing={a.loading} onRefresh={async () => { await api('/alerts/evaluate', { body: {} }).catch(() => undefined); a.reload(); }} />}
      ListHeaderComponent={<View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><H>Alerts</H>{!!a.data?.unread && <Btn small kind="ghost" title="Mark all read" onPress={async () => { await api('/alerts/read-all', { body: {} }); a.reload(); onChange(); }} />}</View>}
      ListEmptyComponent={<Center><Text style={{ fontSize: 40 }}>✅</Text><T muted>All clear — no active alerts</T></Center>}
      renderItem={({ item }) => <Pressable onPress={() => { setOpen(item); if (!item.read) act(item.id, 'read'); }}>
        <Card style={{ borderLeftWidth: item.read ? 0 : 4, borderLeftColor: sev(item.severity), opacity: item.read ? 0.75 : 1 }}>
          <T bold>{item.title}</T><T muted style={{ marginTop: 2 }}>{item.body}</T></Card></Pressable>} />
    <Modal visible={!!open} transparent animationType="slide" onRequestClose={() => setOpen(null)}>
      <Pressable style={{ flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' }} onPress={() => setOpen(null)}>
        <Pressable style={{ backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 12 }}>
          {open && <><View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: c.border, alignSelf: 'center' }} />
            <Text style={{ color: sev(open.severity), fontWeight: '700', textTransform: 'uppercase', fontSize: 12 }}>{open.type} · {open.severity}</Text>
            <H style={{ fontSize: 19 }}>{open.title}</H><T>{open.body}</T>
            {open.ref_type === 'bill' && <Btn title="✓  Mark bill as paid" onPress={() => pay(open.ref_id)} />}
            <T muted style={{ fontSize: 12 }}>Snooze</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{([['1 hour', 60], ['Tomorrow', 1440], ['3 days', 4320], ['1 week', 10080]] as const).map(([l, m]) => <Chip key={l} label={l} onPress={() => { act(open.id, 'snooze', { minutes: m }); setOpen(null); }} />)}</View>
            <View style={{ flexDirection: 'row', gap: 10 }}><View style={{ flex: 1 }}><Btn kind="outline" title={open.read ? 'Mark unread' : 'Mark read'} onPress={() => { act(open.id, open.read ? 'unread' : 'read'); setOpen(null); }} /></View><View style={{ flex: 1 }}><Btn kind="danger" title="Dismiss" onPress={() => { act(open.id, 'dismiss'); setOpen(null); }} /></View></View></>}
        </Pressable></Pressable></Modal>
  </View>;
}

// ---------- Transactions ----------
export function TransactionsScreen() {
  const c = useColors(); const [q, setQ] = useState(''); const [ver, setVer] = useState(0);
  const tx = useLoad<{ rows: any[] }>(`/transactions?limit=60${q ? `&q=${encodeURIComponent(q)}` : ''}`, [ver]);
  const [edit, setEdit] = useState<any>(null);
  if (tx.error) return <ErrorBox msg={tx.error} retry={tx.reload} />;
  return <View style={{ flex: 1, backgroundColor: c.bg }}>
    <FlatList data={tx.data?.rows ?? []} keyExtractor={(x) => String(x.id)} contentContainerStyle={{ padding: 16, gap: 8 }} refreshControl={<RefreshControl refreshing={tx.loading} onRefresh={tx.reload} />}
      ListHeaderComponent={<View style={{ gap: 10, marginBottom: 6 }}><View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><H>Transactions</H><Btn small title="+ Add" onPress={() => setEdit({ kind: 'expense', amount: '', currency: 'GEL', date: todayISO(), category_id: null, account_id: null, description: '', tags: [] })} /></View>
        <Input placeholder="Search…" value={q} onChangeText={setQ} /></View>}
      renderItem={({ item }) => <Pressable onPress={() => setEdit({ ...item, amount: String(item.amount) })}><Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 }}>
        <View style={{ width: 10, height: 36, borderRadius: 5, backgroundColor: item.category_color ?? c.border }} />
        <View style={{ flex: 1 }}><T bold>{item.description || item.category_name || '—'}</T><T muted style={{ fontSize: 12 }}>{item.date} · {item.category_name ?? 'Uncategorized'}</T></View>
        <T bold style={{ color: item.kind === 'income' ? c.success : c.text }}>{item.kind === 'income' ? '+' : item.kind === 'expense' ? '−' : ''}{money(item.amount, item.currency)}</T></Card></Pressable>} />
    {edit && <TxForm tx={edit} onClose={(changed) => { setEdit(null); if (changed) setVer(ver + 1); }} />}
  </View>;
}

function TxForm({ tx, onClose }: { tx: any; onClose: (changed: boolean) => void }) {
  const c = useColors(); const [f, setF] = useState(tx); const [busy, setBusy] = useState(false);
  const cats = useLoad<any[]>('/categories'); const accts = useLoad<any[]>('/accounts');
  const set = (p: any) => setF({ ...f, ...p });
  const save = async () => {
    setBusy(true);
    const body = { kind: f.kind, amount: Number(String(f.amount).replace(',', '.')), currency: f.currency, date: f.date, category_id: f.kind === 'transfer' ? null : f.category_id, account_id: f.account_id, description: f.description, notes: f.notes ?? null, tags: f.tags ?? [] };
    try { await api(f.id ? `/transactions/${f.id}` : '/transactions', { method: f.id ? 'PUT' : 'POST', body }); onClose(true); } catch (e: any) { Alert.alert('Error', e.message); } finally { setBusy(false); }
  };
  const remove = () => Alert.alert('Delete transaction?', '', [{ text: 'Cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { await api(`/transactions/${f.id}`, { method: 'DELETE' }); onClose(true); } }]);
  const list = (cats.data ?? []).filter((x) => x.kind === f.kind && !x.archived);
  return <Modal visible animationType="slide" onRequestClose={() => onClose(false)}>
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 20, gap: 14, paddingTop: 48 }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><H>{f.id ? 'Edit' : 'New'} transaction</H><Btn small kind="ghost" title="✕" onPress={() => onClose(false)} /></View>
      <View style={{ flexDirection: 'row' }}>{(['expense', 'income'] as const).map((k) => <Chip key={k} label={k === 'expense' ? 'Expense' : 'Income'} active={f.kind === k} color={k === 'income' ? c.success : c.danger} onPress={() => set({ kind: k, category_id: null })} />)}</View>
      <Input label="Amount" keyboardType="decimal-pad" value={String(f.amount)} onChangeText={(v) => set({ amount: v })} style={{ fontSize: 24, fontWeight: '700' }} autoFocus={!f.id} />
      <T muted style={{ fontSize: 12 }}>Currency</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{['GEL', 'USD', 'EUR', 'GBP', 'TRY'].map((x) => <Chip key={x} label={x} active={f.currency === x} onPress={() => set({ currency: x })} />)}</View>
      <Input label="Date (YYYY-MM-DD)" value={f.date} onChangeText={(v) => set({ date: v })} />
      <Input label="Description" value={f.description ?? ''} onChangeText={(v) => set({ description: v })} />
      <T muted style={{ fontSize: 12 }}>Category</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{list.map((x) => <Chip key={x.id} label={(x.parent_id ? '↳ ' : '') + x.name} color={x.color} active={f.category_id === x.id} onPress={() => set({ category_id: x.id })} />)}</View>
      <T muted style={{ fontSize: 12 }}>Account</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{(accts.data ?? []).filter((a) => !a.archived).map((a) => <Chip key={a.id} label={a.name} color={a.color} active={f.account_id === a.id} onPress={() => set({ account_id: a.id })} />)}</View>
      <Btn title="Save" loading={busy} disabled={!Number(String(f.amount).replace(',', '.'))} onPress={save} />
      {f.id && <Btn title="Delete" kind="ghost" onPress={remove} />}
    </ScrollView></Modal>;
}

// ---------- Settings ----------
export function SettingsScreen({ onUnpair }: { onUnpair: () => void }) {
  const c = useColors(); const [conn, setConn] = useState<Conn | null>(null); const [status, setStatus] = useState('');
  useEffect(() => { loadConn().then(setConn); }, []);
  return <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 16, gap: 12 }}>
    <H>Settings</H>
    <Card style={{ gap: 8 }}><T bold>Server</T><T muted>{conn?.url}</T>
      <Btn small kind="outline" title="Test connection" onPress={async () => { try { await api('/health'); setStatus('✓ Connected'); } catch (e: any) { setStatus('✕ ' + e.message); } }} />{!!status && <T>{status}</T>}</Card>
    <Card style={{ gap: 8 }}><T bold>Notifications</T><T muted>Alerts are checked in the background about every 15 minutes over Tailscale, plus instant Expo push if configured.</T>
      <Btn small kind="outline" title="Re-register notifications" onPress={async () => { const r = await setupNotifications(); Alert.alert('Notifications', r.push ? 'Push token registered ✓' : r.error ?? 'Background sync enabled'); }} />
      <Btn small kind="outline" title="Check alerts now" onPress={async () => { try { const n = await syncAlerts(); Alert.alert('Synced', `${n} new alert(s)`); } catch (e: any) { Alert.alert('Error', e.message); } }} /></Card>
    <Btn kind="danger" title="Unpair this phone" onPress={() => Alert.alert('Unpair?', 'You will need to scan a new QR code.', [{ text: 'Cancel' }, { text: 'Unpair', style: 'destructive', onPress: async () => { await saveConn(null); onUnpair(); } }])} />
  </ScrollView>;
}
