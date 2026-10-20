import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Pressable, Text, View, Animated } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { engine } from './src/local/engine';
import { PdfReader } from './src/local/PdfReader';
import { runLocalTick, setupNotifications } from './src/notifications';
import { checkSync, approveSync, pollOutbox, type Pending } from './src/sync';
import { invalidate, setToast, useQ } from './src/lapi';
import { Btn, Center, Sheet, T, useColors } from './src/ui';
import type { Nav } from './src/screens/common';
import { Accounts, Categories, Dashboard, Recurring, Transactions, TxForm } from './src/screens/money';
import { Alerts, Budgets, Forecast, Insights, Loans, Reports, Risk, Schedule, Subscriptions } from './src/screens/plan';
import { CardTermsScreen, ImportGroupsScreen, PeopleScreen } from './src/screens/extra';
import { BatchScreen, CreditReportScreen, ImportScreen, More, SettingsScreen, SummaryView, SyncScreen } from './src/screens/app';

const SCREENS: Record<string, (p: any) => any> = {
  txForm: TxForm, transactions: Transactions, accounts: Accounts, categories: Categories, recurring: Recurring, loans: Loans, schedule: Schedule,
  subscriptions: Subscriptions, budgets: Budgets, forecast: Forecast, insights: Insights, risk: Risk, alerts: Alerts, reports: Reports,
  import: ImportScreen, batch: BatchScreen, importGroups: ImportGroupsScreen, people: PeopleScreen, cardTerms: CardTermsScreen, creditReport: CreditReportScreen, sync: SyncScreen, settings: SettingsScreen,
};
const TABS = [{ key: 'home', label: 'Home', icon: '◎' }, { key: 'tx', label: 'Money', icon: '⇄' }, { key: 'plan', label: 'Budgets', icon: '◔' }, { key: 'alerts', label: 'Alerts', icon: '🔔' }, { key: 'more', label: 'More', icon: '☰' }] as const;

export default function App() {
  const c = useColors();
  const [ready, setReady] = useState<string | null>(null);
  const [tab, setTab] = useState<string>('home');
  const [stack, setStack] = useState<{ name: string; params?: any }[]>([]);
  const [toast, setToastMsg] = useState<string | null>(null); const fade = useRef(new Animated.Value(0)).current;
  const [prompt, setPrompt] = useState<Pending | null>(null); const [choices, setChoices] = useState<Record<string, 'local' | 'remote'>>({}); const [syncing, setSyncing] = useState(false);
  const declined = useRef<string>('');

  useEffect(() => { try { engine(); setReady('ok'); } catch (e: any) { setReady('error:' + (e?.message ?? e)); } }, []);
  useEffect(() => { setToast((m) => { setToastMsg(m); fade.setValue(1); Animated.timing(fade, { toValue: 0, duration: 2200, delay: 900, useNativeDriver: true }).start(); }); }, []);

  const nav: Nav = { push: (name, params) => setStack((s) => [...s, { name, params }]), back: () => setStack((s) => s.slice(0, -1)), tab: (t) => { setStack([]); setTab(t); } };
  useEffect(() => { const sub = BackHandler.addEventListener('hardwareBackPress', () => { if (prompt) { setPrompt(null); return true; } if (stack.length) { nav.back(); return true; } if (tab !== 'home') { setTab('home'); return true; } return false; }); return () => sub.remove(); }, [stack, tab, prompt]);

  /** On start and every time the app comes to the foreground: housekeeping, then (if paired) see whether a sync is due. */
  const wake = useCallback(async () => {
    await runLocalTick().catch(() => undefined); invalidate();
    try {
      if (await pollOutbox()) invalidate();
      const p = await checkSync();
      const sig = p ? JSON.stringify(p.plan.summary) : '';
      if (p && p.plan.summary.total > 0 && sig !== declined.current) { setChoices({}); setPrompt(p); }
    } catch { /* computer not reachable: fully offline is fine */ }
  }, []);
  useEffect(() => {
    if (ready !== 'ok') return;
    setupNotifications().catch(() => undefined); wake();
    const s1 = AppState.addEventListener('change', (st) => st === 'active' && wake());
    const s2 = Notifications.addNotificationResponseReceivedListener(() => { setStack([]); setTab('alerts'); });
    const t = setInterval(() => { pollOutbox().then((n) => n && invalidate()).catch(() => undefined); }, 60000);
    return () => { s1.remove(); s2.remove(); clearInterval(t); };
  }, [ready]);

  if (!ready) return <Center><T muted>Loading…</T></Center>;
  if (ready.startsWith('error:')) return <Center><T bold>Could not open the local database</T><T muted>{ready.slice(6)}</T></Center>;

  const top = stack[stack.length - 1];
  const Cur = top ? SCREENS[top.name] : null;
  return <SafeAreaProvider><StatusBar style={c.dark ? 'light' : 'dark'} />
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'bottom']}>
      <PdfReader />
      <View style={{ flex: 1 }}>
        {Cur ? <Cur key={stack.length} nav={nav} params={top.params} /> : <>
          {tab === 'home' && <Dashboard nav={nav} />}
          {tab === 'tx' && <Transactions nav={nav} />}
          {tab === 'plan' && <Budgets nav={{ ...nav, back: () => setTab('home') }} />}
          {tab === 'alerts' && <Alerts nav={{ ...nav, back: () => setTab('home') }} />}
          {tab === 'more' && <More nav={nav} />}
        </>}
      </View>
      {!Cur && <TabBar tab={tab} setTab={setTab} />}
      {toast && <Animated.View pointerEvents="none" style={{ position: 'absolute', bottom: 90, alignSelf: 'center', backgroundColor: c.dark ? '#2a3042' : '#1f2433', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, opacity: fade }}><Text style={{ color: '#fff', fontWeight: '600' }}>{toast}</Text></Animated.View>}
      <Sheet open={!!prompt} title={`Do you want to sync with ${prompt?.peerName ?? 'your computer'}?`} onClose={() => { declined.current = prompt ? JSON.stringify(prompt.plan.summary) : ''; setPrompt(null); }}
        footer={<><Btn kind="outline" title="Not now" onPress={() => { declined.current = prompt ? JSON.stringify(prompt.plan.summary) : ''; setPrompt(null); }} />
          <Btn title="Sync now" style={{ flex: 1 }} loading={syncing} disabled={!!prompt?.plan.conflicts.some((k) => !choices[k.key])} onPress={async () => {
            if (!prompt) return; setSyncing(true);
            try { await approveSync(prompt, choices); setPrompt(null); invalidate(); setToastMsg('Synced'); fade.setValue(1); Animated.timing(fade, { toValue: 0, duration: 2200, delay: 900, useNativeDriver: true }).start(); }
            catch (e: any) { setPrompt(null); setTimeout(() => require('react-native').Alert.alert('Sync failed', e.message), 300); } finally { setSyncing(false); } }} /></>}>
        {prompt && <><T muted>{prompt.plan.summary.total} change(s). Nothing is applied until you approve; you can undo the last sync from More → Sync.</T><SummaryView p={prompt} choices={choices} setChoices={setChoices} peerName={prompt.peerName} /></>}
      </Sheet>
    </SafeAreaView></SafeAreaProvider>;
}

function TabBar({ tab, setTab }: { tab: string; setTab: (t: string) => void }) {
  const c = useColors(); const a = useQ<{ unread: number }>('/alerts'); const unread = a.data?.unread ?? 0;
  return <View style={{ flexDirection: 'row', borderTopWidth: 0.5, borderTopColor: c.border, backgroundColor: c.card, paddingTop: 8, paddingBottom: 6 }}>
    {TABS.map((x) => { const on = tab === x.key; return <Pressable key={x.key} onPress={() => setTab(x.key)} style={{ flex: 1, alignItems: 'center', gap: 2 }}>
      <View style={{ paddingHorizontal: 16, paddingVertical: 3, borderRadius: 999, backgroundColor: on ? c.primarySoft : 'transparent' }}><Text style={{ fontSize: 19, color: on ? c.primary : c.muted }}>{x.icon}</Text>
        {x.key === 'alerts' && unread > 0 && <View style={{ position: 'absolute', top: -2, right: 6, backgroundColor: c.danger, borderRadius: 9, paddingHorizontal: 5, minWidth: 16, alignItems: 'center' }}><Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{unread > 99 ? '99+' : unread}</Text></View>}</View>
      <Text style={{ fontSize: 11, color: on ? c.primary : c.muted, fontWeight: on ? '700' : '500' }}>{x.label}</Text></Pressable>; })}
  </View>;
}
