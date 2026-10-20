import { engine } from './local/engine';
import { loadConn, remote } from './api';
import { snapshot, plan, resolve, applyChanges, recordSync, lastSync, undoSync, newSyncId, deviceId, type SyncPlan, type Snapshot } from '../../server/src/sync/engine';
import { getSetting } from '../../server/src/schema';

/** Phone side of approval-based sync. Nothing is written on either device until the user approves. */
export const myName = () => getSetting(engine().db, 'deviceName') || 'Phone';
export interface Pending { remote: Snapshot; plan: SyncPlan; peer: string; peerName: string }

/** Compare with the desktop (read-only on both sides). Also tells the desktop we're here so it can prompt too. */
export async function checkSync(): Promise<Pending | null> {
  if (!(await loadConn())) return null;
  const { db } = engine();
  const mine = snapshot(db, myName());
  await remote('/sync/offer', { body: mine }).catch(() => undefined);
  const theirs = await remote<Snapshot>('/sync/snapshot');
  const p = plan(mine, theirs, lastSync(db, theirs.deviceId));
  return { remote: theirs, plan: p, peer: theirs.deviceId, peerName: theirs.name };
}

/** User approved on the phone: apply our share locally, send the desktop its share, record history on both. */
export async function approveSync(pending: Pending, choices: Record<string, 'local' | 'remote'>) {
  const { db } = engine();
  const p = resolve(pending.plan, choices);
  if (p.conflicts.length) throw new Error(`Choose a version for ${p.conflicts.length} conflict(s) first`);
  const id = newSyncId(); const at = new Date().toISOString();
  // desktop first: if it's unreachable nothing changes on the phone either
  const r = await remote<{ errors: string[] }>('/sync/apply', { body: { syncId: id, peer: deviceId(db), peerName: myName(), changes: p.toRemote, summary: flip(p.summary), at } });
  const { undo, errors } = applyChanges(db, p.toLocal);
  recordSync(db, { id, peer: pending.peer, peerName: pending.peerName, direction: 'phone-approved', summary: p.summary, undo, at });
  return { id, errors: [...errors, ...(r.errors ?? [])] };
}
/** The desktop stores the summary from its own point of view. */
function flip(s: SyncPlan['summary']): SyncPlan['summary'] {
  return { ...s, toLocal: s.toRemote, toRemote: s.toLocal, samples: s.samples.map((x) => ({ ...x, dir: x.dir === 'toLocal' ? 'toRemote' : 'toLocal' })) };
}

/** Apply what the user approved on the desktop (or an undo started there). */
export async function pollOutbox(): Promise<number> {
  if (!(await loadConn())) return 0;
  const { db } = engine();
  const items = await remote<any[]>(`/sync/outbox?peer=${encodeURIComponent(deviceId(db))}`);
  for (const it of items) {
    if (it.kind === 'apply') {
      const { undo } = applyChanges(db, it.payload.changes);
      recordSync(db, { id: it.sync_id, peer: it.payload.peer, peerName: it.payload.peerName ?? 'Desktop', direction: 'desktop-approved', summary: flip(it.payload.summary), undo, at: it.payload.at });
    } else if (it.kind === 'undo') {
      try { undoSync(db, it.sync_id); } catch { /* unknown here: nothing to undo */ }
    }
    await remote(`/sync/outbox/${it.id}/ack`, { body: {} });
  }
  return items.length;
}

export function history() {
  return (engine().db.prepare('SELECT id, peer, peer_name, direction, summary, created_at, undone_at FROM sync_history ORDER BY created_at DESC LIMIT 50').all() as any[]).map((h) => ({ ...h, summary: JSON.parse(h.summary) }));
}
/** Undo a sync on both devices (best effort on the desktop if it's offline — it's retried from the desktop's own history). */
export async function undo(id: string) {
  const r = undoSync(engine().db, id);
  let remoteOk = true;
  await remote(`/sync/undo/${id}`, { body: { fromPeer: true } }).catch(() => { remoteOk = false; });
  return { ...r, remoteOk };
}
