/* eslint-disable @typescript-eslint/no-unused-vars -- signature-compatible stubs for the Android build */
// Android (offline app) implementation: the phone is protected by the OS lock screen; there is no LAN server,
// no pairing host and no PIN sessions. Backups are plain JSON (stored in the app sandbox / shared by the user).
import type { DB } from './schema';
export { BACKUP_TABLES, dumpDb, restoreDb } from './backup';
export const lockEnabled = (_db: DB) => false;
export const setLock = (_db: DB, _s: string | null) => { throw Object.assign(new Error('Use the phone lock screen to protect the app'), { statusCode: 400 }); };
export const unlock = (_db: DB, _s: string): string | null => null;
export const validSession = (_t?: string) => true;
export const lockSession = (_t?: string) => undefined;
export const deviceForToken = (_db: DB, _t?: string) => null;
export const startPairing = () => { throw Object.assign(new Error('Pairing is started on the desktop app'), { statusCode: 400 }); };
export const claimPairing = (_db: DB, _c: string, _n: string) => null;
export const isLoopback = (_ip: string) => true;
export const serverUrls = (_p: number) => [] as string[];
export const encryptBackup = (json: string, _password: string) => JSON.stringify({ format: 'fa-plain', data: json });
export const decryptBackup = (file: string, _password: string) => { const o = JSON.parse(file); if (o.format === 'fa-plain') return o.data as string; throw Object.assign(new Error('Encrypted desktop backups must be restored on the desktop'), { statusCode: 400 }); };
