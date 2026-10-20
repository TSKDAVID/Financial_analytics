import type { DB } from './schema';
import { getSetting } from './schema';

/**
 * Sends a short alert text to phones. Only the title and one-line body leave the machine.
 * Channels: ntfy (self-hosted or ntfy.sh, topic is a secret) and Expo push (tokens of paired devices).
 */
export async function pushAlert(db: DB, title: string, body: string, severity: string) {
  const results: string[] = [];
  const topic = getSetting(db, 'ntfyTopic');
  if (topic) {
    const server = (getSetting(db, 'ntfyServer') || 'https://ntfy.sh').replace(/\/$/, '');
    const res = await fetch(`${server}/${encodeURIComponent(topic)}`, {
      method: 'POST', body,
      headers: { Title: encodeURIComponent(title) === title ? title : title.replace(/[^\x20-\x7E]/g, ''), Priority: severity === 'danger' ? '5' : severity === 'warning' ? '4' : '3', Tags: severity === 'danger' ? 'rotating_light' : 'moneybag' },
      signal: AbortSignal.timeout(8000),
    });
    results.push(`ntfy:${res.status}`);
  }
  if (getSetting(db, 'expoPush') !== '0') {
    const tokens = (db.prepare("SELECT push_token FROM devices WHERE push_token IS NOT NULL AND push_token LIKE 'ExponentPushToken%'").all() as { push_token: string }[]).map((d) => d.push_token);
    if (tokens.length) {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(tokens.map((to) => ({ to, title, body, sound: 'default', priority: severity === 'info' ? 'normal' : 'high', channelId: 'alerts' }))),
        signal: AbortSignal.timeout(8000),
      });
      results.push(`expo:${res.status}`);
    }
  }
  return results;
}
