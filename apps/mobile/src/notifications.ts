import * as Notifications from 'expo-notifications';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { api, loadConn, todayISO } from './api';
import { scheduleReminders } from './reminders';

export const TASK = 'fa-alert-sync';
const SEEN = 'fa.seenAlerts';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
});

/**
 * Background poll (WorkManager, ~every 15 min): fetches alerts over Tailscale and shows a local notification
 * for every new unread alert. Works with zero cloud services. Expo push (below) is used in addition for instant delivery.
 */
export async function syncAlerts(): Promise<number> {
  if (!(await loadConn())) return 0;
  const { items, unread } = await api<{ items: any[]; unread: number }>('/alerts');
  const seen = new Set<number>(JSON.parse((await SecureStore.getItemAsync(SEEN)) ?? '[]'));
  const first = seen.size === 0;
  let n = 0;
  for (const a of items) {
    if (!a.read && !seen.has(a.id) && !first) {
      await Notifications.scheduleNotificationAsync({ content: { title: a.title, body: a.body, data: { alertId: a.id }, sound: 'default' }, trigger: null });
      n++;
    }
    seen.add(a.id);
  }
  await SecureStore.setItemAsync(SEEN, JSON.stringify([...seen].slice(-400)));
  await Notifications.setBadgeCountAsync(unread).catch(() => undefined);
  await refreshReminders().catch(() => undefined);
  return n;
}

TaskManager.defineTask(TASK, async () => {
  try { await api('/alerts/evaluate', { body: {} }).catch(() => undefined); await syncAlerts(); return BackgroundTask.BackgroundTaskResult.Success; }
  catch { return BackgroundTask.BackgroundTaskResult.Failed; }
});

export async function setupNotifications(): Promise<{ push: string | null; error?: string }> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('alerts', { name: 'Finance alerts', importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 250, 250, 250], lightColor: '#4F46E5' });
  }
  const { status } = await Notifications.getPermissionsAsync();
  const final = status === 'granted' ? status : (await Notifications.requestPermissionsAsync()).status;
  if (final !== 'granted') return { push: null, error: 'Notification permission denied' };
  if (!(await TaskManager.isTaskRegisteredAsync(TASK))) await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 15 }).catch(() => undefined);
  // Expo push token (needs an EAS projectId; optional — background sync works without it)
  const projectId = (Constants.expoConfig?.extra as any)?.eas?.projectId || (Constants as any).easConfig?.projectId;
  if (!Device.isDevice || !projectId) return { push: null, error: projectId ? undefined : 'No EAS projectId – using background sync only' };
  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await api('/devices/me/push', { method: 'PUT', body: { token } });
    return { push: token };
  } catch (e: any) { return { push: null, error: e?.message }; }
}

/** Pull the next 60 days of unpaid bills/loan payments/subscription charges and (re)schedule local reminders. */
export async function refreshReminders(): Promise<number> {
  const from = todayISO(); const d = new Date(); d.setDate(d.getDate() + 60);
  const to = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const bills = await api<any[]>(`/bills?from=${from}&to=${to}&unpaid=1`);
  return scheduleReminders(bills);
}
