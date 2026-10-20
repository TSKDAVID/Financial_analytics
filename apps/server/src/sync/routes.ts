import type { FastifyInstance } from 'fastify';
import type { DB } from '../schema';
import { snapshot, plan, resolve, applyChanges, recordSync, lastSync, undoSync, newSyncId, deviceId, type Snapshot, type Change, type Summary } from './engine';

/**
 * Desktop side of approval-based two-way sync.
 * Phone-initiated: phone GETs /snapshot, computes the plan, asks the user, then POSTs /apply with the desktop's share.
 * Desktop-initiated: phone POSTs /offer (its snapshot) whenever it connects; the desktop UI shows "Do you want to sync?";
 * on approval the desktop applies its share and queues the phone's share in the outbox, which the phone applies on its next poll.
 */
export function syncRoutes(app: FastifyInstance, db: DB) {
  const name = 'Desktop';
  app.get('/api/sync/snapshot', async () => snapshot(db, name));
  app.get('/api/sync/info', async () => ({ deviceId: deviceId(db), name }));
  app.post('/api/sync/apply', async (req) => {
    const b = req.body as { syncId: string; peer: string; peerName: string; changes: Change[]; summary: Summary; at: string };
    if (!b?.syncId || !Array.isArray(b.changes)) throw Object.assign(new Error('Bad sync payload'), { statusCode: 400 });
    const { undo, errors } = applyChanges(db, b.changes);
    recordSync(db, { id: b.syncId, peer: b.peer, peerName: b.peerName ?? 'Phone', direction: 'phone→desktop', summary: b.summary, undo, at: b.at });
    db.prepare('DELETE FROM sync_offers WHERE peer = ?').run(b.peer);
    return { ok: true, errors };
  });
  app.post('/api/sync/offer', async (req) => {
    const s = req.body as Snapshot;
    if (!s?.deviceId || !s.rows) throw Object.assign(new Error('Bad snapshot'), { statusCode: 400 });
    db.prepare("INSERT INTO sync_offers (peer, name, snapshot, received_at) VALUES (?,?,?, strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(peer) DO UPDATE SET name = excluded.name, snapshot = excluded.snapshot, received_at = excluded.received_at").run(s.deviceId, s.name, JSON.stringify(s));
    const p = plan(snapshot(db, name), s, lastSync(db, s.deviceId));
    return { pending: p.summary.total };
  });
  const offerPlan = (peer: string) => {
    const o = db.prepare('SELECT * FROM sync_offers WHERE peer = ?').get(peer) as any;
    if (!o) throw Object.assign(new Error('Phone is not connected — open the app on the phone'), { statusCode: 404 });
    return { offer: o, plan: plan(snapshot(db, name), JSON.parse(o.snapshot), lastSync(db, peer)) };
  };
  app.get('/api/sync/offers', async () => (db.prepare('SELECT peer, name, received_at FROM sync_offers ORDER BY received_at DESC').all() as any[]).map((o) => {
    const { plan: p } = offerPlan(o.peer);
    return { ...o, summary: p.summary, conflicts: p.conflicts.map((c) => ({ key: c.key, table: c.table, label: c.label, local: c.local, remote: c.remote, localDeleted: c.localDeleted, remoteDeleted: c.remoteDeleted })), lastSync: lastSync(db, o.peer) };
  }));
  app.post('/api/sync/offers/:peer/approve', async (req) => {
    const peer = (req.params as { peer: string }).peer;
    const { offer, plan: p0 } = offerPlan(peer);
    const choices = ((req.body ?? {}) as { choices?: Record<string, 'local' | 'remote'> }).choices ?? {};
    const p = resolve(p0, choices);
    if (p.conflicts.length) throw Object.assign(new Error(`Choose a version for ${p.conflicts.length} conflict(s) first`), { statusCode: 400 });
    const id = newSyncId(); const at = new Date().toISOString();
    const { undo, errors } = applyChanges(db, p.toLocal);
    recordSync(db, { id, peer, peerName: offer.name, direction: 'desktop-approved', summary: p.summary, undo, at });
    db.prepare('INSERT INTO sync_outbox (peer, kind, sync_id, payload) VALUES (?,?,?,?)').run(peer, 'apply', id, JSON.stringify({ changes: p.toRemote, summary: p.summary, at, peer: deviceId(db), peerName: name }));
    db.prepare('DELETE FROM sync_offers WHERE peer = ?').run(peer);
    return { ok: true, id, applied: p.toLocal.length, queuedForPhone: p.toRemote.length, errors };
  });
  app.post('/api/sync/offers/:peer/dismiss', async (req) => { db.prepare('DELETE FROM sync_offers WHERE peer = ?').run((req.params as { peer: string }).peer); return { ok: true }; });
  app.get('/api/sync/outbox', async (req) => {
    const peer = (req.query as { peer?: string }).peer;
    return (db.prepare('SELECT * FROM sync_outbox WHERE peer = ? AND delivered = 0 ORDER BY id').all(peer ?? '') as any[]).map((o) => ({ ...o, payload: JSON.parse(o.payload) }));
  });
  app.post('/api/sync/outbox/:id/ack', async (req) => { db.prepare('UPDATE sync_outbox SET delivered = 1 WHERE id = ?').run(Number((req.params as { id: string }).id)); return { ok: true }; });
  app.get('/api/sync/history', async () => (db.prepare('SELECT id, peer, peer_name, direction, summary, created_at, undone_at FROM sync_history ORDER BY created_at DESC LIMIT 50').all() as any[]).map((h) => ({ ...h, summary: JSON.parse(h.summary) })));
  app.post('/api/sync/undo/:id', async (req) => {
    const id = (req.params as { id: string }).id;
    const h = db.prepare('SELECT peer FROM sync_history WHERE id = ?').get(id) as any;
    const r = undoSync(db, id);
    const fromPhone = ((req.body ?? {}) as { fromPeer?: boolean }).fromPeer;
    if (h && !fromPhone) db.prepare('INSERT INTO sync_outbox (peer, kind, sync_id, payload) VALUES (?,?,?,?)').run(h.peer, 'undo', id, '{}'); // phone undoes its side on next poll
    return r;
  });
}
