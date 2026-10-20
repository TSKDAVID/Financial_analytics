import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { loadConn, api, type Conn } from './src/api';
import { setupNotifications, syncAlerts } from './src/notifications';
import { AlertsScreen, HomeScreen, PairScreen, SettingsScreen, TransactionsScreen } from './src/screens';
import { Center, T, useColors } from './src/ui';

const TABS = [{ key: 'home', label: 'Home', icon: '◎' }, { key: 'alerts', label: 'Alerts', icon: '🔔' }, { key: 'tx', label: 'Money', icon: '⇄' }, { key: 'settings', label: 'Settings', icon: '⚙' }] as const;

export default function App() {
  const c = useColors();
  const [conn, setConn] = useState<Conn | null | undefined>(undefined);
  const [tab, setTab] = useState<string>('home');
  const [unread, setUnread] = useState(0);
  const refreshBadge = () => api<{ unread: number }>('/alerts').then((a) => setUnread(a.unread)).catch(() => undefined);
  useEffect(() => { loadConn().then(setConn); }, []);
  useEffect(() => {
    if (!conn) return;
    setupNotifications().catch(() => undefined); syncAlerts().catch(() => undefined); refreshBadge();
    const sub = Notifications.addNotificationResponseReceivedListener(() => setTab('alerts'));
    const t = setInterval(() => { syncAlerts().catch(() => undefined); refreshBadge(); }, 60000);
    return () => { sub.remove(); clearInterval(t); };
  }, [conn]);
  if (conn === undefined) return <Center><T muted>Loading…</T></Center>;
  return <SafeAreaProvider><StatusBar style="auto" />
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'bottom']}>
      {!conn ? <PairScreen onPaired={setConn} /> : <>
        <View style={{ flex: 1 }}>
          {tab === 'home' && <HomeScreen go={setTab} />}
          {tab === 'alerts' && <AlertsScreen onChange={refreshBadge} />}
          {tab === 'tx' && <TransactionsScreen />}
          {tab === 'settings' && <SettingsScreen onUnpair={() => setConn(null)} />}
        </View>
        <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.card, paddingVertical: 8 }}>
          {TABS.map((x) => <Pressable key={x.key} onPress={() => setTab(x.key)} style={{ flex: 1, alignItems: 'center', gap: 2 }}>
            <View><Text style={{ fontSize: 20, color: tab === x.key ? c.primary : c.muted }}>{x.icon}</Text>
              {x.key === 'alerts' && unread > 0 && <View style={{ position: 'absolute', top: -4, right: -12, backgroundColor: c.danger, borderRadius: 9, paddingHorizontal: 5 }}><Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{unread}</Text></View>}</View>
            <Text style={{ fontSize: 11, color: tab === x.key ? c.primary : c.muted, fontWeight: '600' }}>{x.label}</Text></Pressable>)}
        </View></>}
    </SafeAreaView></SafeAreaProvider>;
}
