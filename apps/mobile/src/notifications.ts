import * as Notifications from 'expo-notifications';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { api, tick } from './local/engine';
import { todayISO } from './lapi';
import { scheduleReminders } from './reminders';
import { pollOutbox } from './sync';

export const TASK = 'fa-local-tick';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
});

/**
 * Everything runs on the phone: post due recurring items, regenerate bills, evaluate alerts on the LOCAL database and
 * show a notification for each new alert; then (re)schedule bill reminders for the next 60 days. No computer needed.
 */
export async function runLocalTick(): Promise<number> {
  const { fresh } = await tick();
  for (const a of fresh ?? []) await Notifications.scheduleNotificationAsync({ content: { title: a.title, body: a.body, data: { kind: 'alert' }, sound: 'default' }, trigger: null }).catch(() => undefined);
  const { unread } = await api<{ unread: number }>('/alerts');
  await Notifications.setBadgeCountAsync(unread).catch(() => undefined);
  await refreshReminders().catch(() => undefined);
  return fresh?.length ?? 0;
}

TaskManager.defineTask(TASK, async () => {
  try { await runLocalTick(); await pollOutbox().catch(() => undefined); return BackgroundTask.BackgroundTaskResult.Success; }
  catch { return BackgroundTask.BackgroundTaskResult.Failed; }
});

export async function setupNotifications(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('alerts', { name: 'Finance alerts', importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 250, 250, 250], lightColor: '#4F46E5' });
  }
  const { status } = await Notifications.getPermissionsAsync();
  const final = status === 'granted' ? status : (await Notifications.requestPermissionsAsync()).status;
  if (!(await TaskManager.isTaskRegisteredAsync(TASK))) await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 15 }).catch(() => undefined);
  return final === 'granted';
}

/** Next 60 days of unpaid bills / loan payments / subscription charges from the local DB → local reminders. */
export async function refreshReminders(): Promise<number> {
  const d = new Date(); d.setDate(d.getDate() + 60);
  const to = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const bills = await api<any[]>(`/bills?from=${todayISO()}&to=${to}&unpaid=1`);
  return scheduleReminders(bills);
}
