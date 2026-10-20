import crypto from 'node:crypto';
import os from 'node:os';
import type { DB } from './schema';
import { getSetting, setSetting } from './schema';

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (prefix: string) => prefix + crypto.randomBytes(24).toString('base64url');

export function hashSecret(secret: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(secret, salt, 32);
  return `scrypt:${salt.toString('hex')}:${key.toString('hex')}`;
}
export function verifySecret(secret: string, stored: string): boolean {
  const [, saltHex, keyHex] = stored.split(':');
  if (!saltHex || !keyHex) return false;
  const key = crypto.scryptSync(secret, Buffer.from(saltHex, 'hex'), 32);
  return crypto.timingSafeEqual(key, Buffer.from(keyHex, 'hex'));
}

const sessions = new Map<string, number>(); // token -> expiry ms
const SESSION_MS = 12 * 3600 * 1000;
export function lockEnabled(db: DB) { return !!getSetting(db, 'lockHash'); }
export function setLock(db: DB, secret: string | null) { setSetting(db, 'lockHash', secret ? hashSecret(secret) : ''); sessions.clear(); }
export function unlock(db: DB, secret: string): string | null {
  const h = getSetting(db, 'lockHash');
  if (!h || !verifySecret(secret, h)) return null;
  const t = randomToken('s_'); sessions.set(t, Date.now() + SESSION_MS); return t;
}
export function validSession(t: string | undefined) {
  if (!t) return false; const e = sessions.get(t); if (!e) return false;
  if (e < Date.now()) { sessions.delete(t); return false; } return true;
}
export function lockSession(t?: string) { if (t) sessions.delete(t); }

export function deviceForToken(db: DB, token: string | undefined) {
  if (!token?.startsWith('d_')) return null;
  const d = db.prepare('SELECT * FROM devices WHERE token_hash = ?').get(sha256(token)) as { id: number; name: string } | undefined;
  if (d) db.prepare("UPDATE devices SET last_seen = datetime('now') WHERE id = ?").run(d.id);
  return d ?? null;
}

const pairings = new Map<string, number>();
export function startPairing() { const code = crypto.randomBytes(16).toString('hex'); pairings.set(code, Date.now() + 10 * 60 * 1000); return code; }
export function claimPairing(db: DB, code: string, name: string) {
  const e = pairings.get(code);
  if (!e || e < Date.now()) return null;
  pairings.delete(code);
  const token = randomToken('d_');
  const info = db.prepare('INSERT INTO devices (name, token_hash) VALUES (?, ?)').run(name.slice(0, 60) || 'Android', sha256(token));
  return { token, id: Number(info.lastInsertRowid) };
}

export function isLoopback(ip: string) { return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'; }

export type UrlKind = 'tailscale' | 'lan' | 'other' | 'virtual';
const VIRTUAL_NAME = /radmin|hamachi|openvpn|\btap\b|tap-|\btun\b|wintun|virtualbox|vbox|vmware|vethernet|hyper-v|wsl|docker|zerotier|npcap|loopback|bluetooth/i;
/** Rank one interface address for "can the phone reach me here?". null = never offer it. */
export function classifyAddress(name: string, address: string): { kind: UrlKind; rank: number } | null {
  const [o1, o2] = address.split('.').map(Number);
  if (o1 === 127 || o1 === 0 || (o1 === 169 && o2 === 254)) return null; // loopback / link-local
  if ((o1 === 100 && o2 >= 64 && o2 <= 127) || /tailscale/i.test(name)) return { kind: 'tailscale', rank: 0 };
  const priv = o1 === 192 && o2 === 168 || o1 === 10 || (o1 === 172 && o2 >= 16 && o2 <= 31);
  // Radmin VPN hands out 26.0.0.0/8; Hamachi 25.0.0.0/8 — public-looking but virtual.
  const virtual = VIRTUAL_NAME.test(name) || o1 === 26 || o1 === 25;
  if (virtual) return { kind: 'virtual', rank: 3 };
  if (priv) return { kind: 'lan', rank: /wi-?fi|wlan|wireless/i.test(name) ? 1 : 1.5 };
  return { kind: 'other', rank: 2 };
}
/** Candidate URLs reachable from the phone, best first: Tailscale, Wi-Fi/LAN, other, then virtual adapters (VPNs, VMs). */
export function rankUrls(ifaces: Record<string, { address: string; family: string | number; internal: boolean }[] | undefined>, port: number) {
  const out: { url: string; kind: UrlKind; iface: string; rank: number }[] = [];
  for (const [name, addrs] of Object.entries(ifaces)) for (const a of addrs ?? []) {
    if ((a.family !== 'IPv4' && a.family !== 4) || a.internal) continue;
    const c = classifyAddress(name, a.address); if (!c) continue;
    out.push({ url: `http://${a.address}:${port}`, kind: c.kind, iface: name, rank: c.rank });
  }
  return out.sort((x, y) => x.rank - y.rank).map((u) => ({ url: u.url, kind: u.kind, iface: u.iface }));
}
export function serverUrls(port: number) { return rankUrls(os.networkInterfaces() as any, port); }

// ---- encrypted backups (AES-256-GCM, scrypt key derivation) ----
export function encryptBackup(json: string, password: string): string {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(password, salt, 32);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(json, 'utf8'), c.final()]);
  return JSON.stringify({ format: 'fa-backup', version: 1, kdf: 'scrypt', salt: salt.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') });
}
export function decryptBackup(file: string, password: string): string {
  const o = JSON.parse(file);
  if (o.format !== 'fa-backup') throw new Error('Not a Financial Analytics backup file');
  const key = crypto.scryptSync(password, Buffer.from(o.salt, 'base64'), 32);
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(o.iv, 'base64'));
  d.setAuthTag(Buffer.from(o.tag, 'base64'));
  try { return Buffer.concat([d.update(Buffer.from(o.data, 'base64')), d.final()]).toString('utf8'); }
  catch { throw new Error('Wrong password or corrupted backup'); }
}

export { BACKUP_TABLES, dumpDb, restoreDb } from './backup';
