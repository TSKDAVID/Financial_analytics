import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/** A bill-like item that should produce a reminder (bill, loan payment or subscription charge). */
export interface Due { id: string | number; name: string; due_date: string; amount: number; currency: string; type?: string; paid?: number | boolean }
const KIND = 'fa-reminder';

/**
 * Schedules LOCAL notifications for every unpaid upcoming bill / loan payment / subscription charge in the next `days` days:
 * at 09:00 the day before and at 09:00 on the due date. All previous reminders are cancelled first, so calling this on every
 * sync keeps the schedule fresh. Reminders fire from the phone's own alarm manager — the PC can be off.
 */
export async function scheduleReminders(items: Due[], days = 60): Promise<number> {
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('reminders', { name: 'Bill reminders', importance: Notifications.AndroidImportance.HIGH }).catch(() => undefined);
  const existing = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of existing) if ((n.content.data as any)?.kind === KIND) await Notifications.cancelScheduledNotificationAsync(n.identifier);
  const now = Date.now(); const limit = now + days * 86400000; let count = 0;
  for (const b of items) {
    if (b.paid) continue;
    const [y, m, d] = b.due_date.slice(0, 10).split('-').map(Number);
    const due = new Date(y, m - 1, d, 9, 0, 0).getTime();
    const label = b.type === 'loan' ? 'Loan payment' : b.type === 'subscription' ? 'Subscription charge' : 'Bill due';
    const amount = `${Math.round(b.amount * 100) / 100} ${b.currency}`;
    for (const [when, title] of [[due - 86400000, `${label} tomorrow`], [due, `${label} today`]] as const) {
      if (when <= now || when > limit) continue;
      await Notifications.scheduleNotificationAsync({
        content: { title, body: `${b.name} · ${amount}`, data: { kind: KIND, billId: b.id }, sound: 'default' },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(when), channelId: 'reminders' } as any,
      });
      count++;
    }
  }
  return count;
}
