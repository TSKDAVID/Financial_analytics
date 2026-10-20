import type { DB } from '../schema';
import { SYNC_TABLES, LOCAL_SETTINGS } from './track';

/** Snapshot of all synced data on one device, with foreign keys expressed as gids so rows are portable. */
export interface RowRec { u: string; by: string | null; d: Record<string, unknown> }
export interface Snapshot { deviceId: string; name: string; at: string; rows: Record<string, Record<string, RowRec>>; tombs: Record<string, Record<string, string>> }
export interface Change { table: string; gid: string; op: 'upsert' | 'delete'; rec?: RowRec; deletedAt?: string; kind: 'added' | 'edited' | 'deleted'; newer: 'local' | 'remote'; label: string }
export interface Conflict { key: string; table: string; gid: string; label: string; local: RowRec | null; remote: RowRec | null; localDeleted?: string; remoteDeleted?: string }
export interface SyncPlan { toLocal: Change[]; toRemote: Change[]; conflicts: Conflict[]; summary: Summary }
export interface Summary { toLocal: Record<string, Counts>; toRemote: Record<string, Counts>; conflicts: number; total: number; samples: { dir: 'toLocal' | 'toRemote'; table: string; kind: string; label: string; newer: string }[] }
type Counts = { added: number; edited: number; deleted: number };

const META = new Set(['id', 'gid', 'updated_at', 'updated_by']);
const SKIP: Record<string, string[]> = { transactions: ['import_batch_id', 'created_at'], loans: ['import_report_id'], accounts: ['created_at'], goals: ['created_at'] };

export function deviceId(db: DB): string { return (db.prepare("SELECT value FROM settings WHERE key = 'deviceId'").get() as { value: string }).value; }

export function snapshot(db: DB, name = 'device'): Snapshot {
  const rows: Snapshot['rows'] = {}; const tombs: Snapshot['tombs'] = {};
  for (const [t, def] of Object.entries(SYNC_TABLES)) {
    const gidOf: Record<string, Map<number, string>> = {};
    for (const ft of new Set(Object.values(def.fks))) gidOf[ft] = new Map((db.prepare(`SELECT id, gid FROM ${ft}`).all() as { id: number; gid: string }[]).map((r) => [r.id, r.gid]));
    const out: Record<string, RowRec> = {};
    for (const r of db.prepare(`SELECT * FROM ${t}`).all() as Record<string, any>[]) {
      if (!r.gid) continue;
      const d: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) { if (META.has(k) || SKIP[t]?.includes(k)) continue; d[k] = def.fks[k] ? (v == null ? null : gidOf[def.fks[k]].get(v) ?? null) : v; }
      out[r.gid] = { u: r.updated_at, by: r.updated_by, d };
    }
    rows[t] = out;
    tombs[t] = Object.fromEntries((db.prepare('SELECT gid, deleted_at FROM sync_tombstones WHERE tbl = ?').all(t) as { gid: string; deleted_at: string }[]).map((x) => [x.gid, x.deleted_at]));
  }
  const ph = LOCAL_SETTINGS.map(() => '?').join(',');
  rows.settings = Object.fromEntries((db.prepare(`SELECT s.key, s.value, m.updated_at, m.updated_by FROM settings s JOIN settings_meta m ON m.key = s.key WHERE s.key NOT IN (${ph})`).all(...LOCAL_SETTINGS) as any[])
    .map((s) => [s.key, { u: s.updated_at, by: s.updated_by, d: { key: s.key, value: s.value } }]));
  tombs.settings = {};
  return { deviceId: deviceId(db), name, at: new Date().toISOString(), rows, tombs };
}

const same = (a: RowRec, b: RowRec) => JSON.stringify(Object.entries(a.d).sort()) === JSON.stringify(Object.entries(b.d).sort());
const labelOf = (t: string, r?: RowRec | null) => {
  const d = r?.d ?? {}; const f = (SYNC_TABLES[t]?.label ?? 'key');
  const base = String(d[f] ?? d.name ?? d.description ?? d.key ?? '').slice(0, 60);
  return t === 'transactions' ? `${d.date ?? ''} ${base} ${d.amount ?? ''} ${d.currency ?? ''}`.trim() : t === 'bills' ? `${base} ${d.due_date ?? ''}`.trim() : base || '(untitled)';
};

/** Compare two snapshots. lastSync = time of the previous successful sync between these two devices (null = first sync). */
export function plan(local: Snapshot, remote: Snapshot, lastSync: string | null): SyncPlan {
  const toLocal: Change[] = [], toRemote: Change[] = [], conflicts: Conflict[] = [];
  const after = (u?: string | null) => !!u && (!lastSync || u > lastSync);
  for (const t of Object.keys({ ...local.rows, ...remote.rows })) {
    const L = local.rows[t] ?? {}, R = remote.rows[t] ?? {}, LT = local.tombs[t] ?? {}, RT = remote.tombs[t] ?? {};
    for (const gid of new Set([...Object.keys(L), ...Object.keys(R), ...Object.keys(LT), ...Object.keys(RT)])) {
      const l = L[gid], r = R[gid], lt = LT[gid], rt = RT[gid];
      const key = `${t}:${gid}`;
      if (l && r) {
        if (same(l, r)) continue;
        if (lastSync && after(l.u) && after(r.u)) { conflicts.push({ key, table: t, gid, label: labelOf(t, l), local: l, remote: r }); continue; }
        if (l.u >= r.u) toRemote.push({ table: t, gid, op: 'upsert', rec: l, kind: 'edited', newer: 'local', label: labelOf(t, l) });
        else toLocal.push({ table: t, gid, op: 'upsert', rec: r, kind: 'edited', newer: 'remote', label: labelOf(t, r) });
      } else if (l && !r) {
        if (rt) {
          if (rt >= l.u) { if (lastSync && after(l.u) && after(rt)) conflicts.push({ key, table: t, gid, label: labelOf(t, l), local: l, remote: null, remoteDeleted: rt }); else toLocal.push({ table: t, gid, op: 'delete', deletedAt: rt, kind: 'deleted', newer: 'remote', label: labelOf(t, l) }); }
          else if (lastSync && after(rt)) conflicts.push({ key, table: t, gid, label: labelOf(t, l), local: l, remote: null, remoteDeleted: rt });
          else toRemote.push({ table: t, gid, op: 'upsert', rec: l, kind: 'added', newer: 'local', label: labelOf(t, l) });
        } else toRemote.push({ table: t, gid, op: 'upsert', rec: l, kind: 'added', newer: 'local', label: labelOf(t, l) });
      } else if (r && !l) {
        if (lt) {
          if (lt >= r.u) { if (lastSync && after(r.u) && after(lt)) conflicts.push({ key, table: t, gid, label: labelOf(t, r), local: null, remote: r, localDeleted: lt }); else toRemote.push({ table: t, gid, op: 'delete', deletedAt: lt, kind: 'deleted', newer: 'local', label: labelOf(t, r) }); }
          else if (lastSync && after(lt)) conflicts.push({ key, table: t, gid, label: labelOf(t, r), local: null, remote: r, localDeleted: lt });
          else toLocal.push({ table: t, gid, op: 'upsert', rec: r, kind: 'added', newer: 'remote', label: labelOf(t, r) });
        } else toLocal.push({ table: t, gid, op: 'upsert', rec: r, kind: 'added', newer: 'remote', label: labelOf(t, r) });
      }
    }
  }
  return { toLocal, toRemote, conflicts, summary: summarize(toLocal, toRemote, conflicts.length) };
}

export function summarize(toLocal: Change[], toRemote: Change[], conflicts: number): Summary {
  const count = (list: Change[]) => { const o: Record<string, Counts> = {}; for (const c of list) { (o[c.table] ??= { added: 0, edited: 0, deleted: 0 })[c.kind]++; } return o; };
  const samples = [...toLocal.map((c) => ({ dir: 'toLocal' as const, c })), ...toRemote.map((c) => ({ dir: 'toRemote' as const, c }))].slice(0, 12).map(({ dir, c }) => ({ dir, table: c.table, kind: c.kind, label: c.label, newer: c.newer }));
  return { toLocal: count(toLocal), toRemote: count(toRemote), conflicts, total: toLocal.length + toRemote.length + conflicts, samples };
}

/** Apply conflict choices ('local' | 'remote' per conflict key) to a plan. */
export function resolve(p: SyncPlan, choices: Record<string, 'local' | 'remote'>): SyncPlan {
  const toLocal = [...p.toLocal], toRemote = [...p.toRemote];
  for (const c of p.conflicts) {
    const pick = choices[c.key]; if (!pick) continue;
    if (pick === 'local') toRemote.push(c.local ? { table: c.table, gid: c.gid, op: 'upsert', rec: { ...c.local, u: new Date().toISOString() }, kind: 'edited', newer: 'local', label: c.label } : { table: c.table, gid: c.gid, op: 'delete', deletedAt: c.localDeleted, kind: 'deleted', newer: 'local', label: c.label });
    else toLocal.push(c.remote ? { table: c.table, gid: c.gid, op: 'upsert', rec: { ...c.remote, u: new Date().toISOString() }, kind: 'edited', newer: 'remote', label: c.label } : { table: c.table, gid: c.gid, op: 'delete', deletedAt: c.remoteDeleted, kind: 'deleted', newer: 'remote', label: c.label });
  }
  const unresolved = p.conflicts.filter((c) => !choices[c.key]);
  return { toLocal, toRemote, conflicts: unresolved, summary: summarize(toLocal, toRemote, unresolved.length) };
}

interface UndoItem { table: string; gid: string; before: RowRec | null; deletedAt?: string | null }

/** Apply incoming changes to this device. Returns undo data (before-images). */
export function applyChanges(db: DB, changes: Change[]): { undo: UndoItem[]; errors: string[] } {
  const undo: UndoItem[] = []; const errors: string[] = [];
  const order = [...Object.keys(SYNC_TABLES), 'settings'];
  const sorted = [...changes].sort((a, b) => order.indexOf(a.table) - order.indexOf(b.table));
  const before = (t: string, gid: string): RowRec | null => {
    if (t === 'settings') { const s = db.prepare('SELECT s.key, s.value, m.updated_at, m.updated_by FROM settings s LEFT JOIN settings_meta m ON m.key = s.key WHERE s.key = ?').get(gid) as any; return s ? { u: s.updated_at ?? '', by: s.updated_by, d: { key: s.key, value: s.value } } : null; }
    const snap = snapshotRow(db, t, gid); return snap;
  };
  db.prepare("INSERT INTO settings (key, value) VALUES ('syncApplying', '1') ON CONFLICT(key) DO UPDATE SET value = '1'").run();
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      const pendingFks: { t: string; gid: string; rec: RowRec }[] = [];
      for (const c of sorted) {
        try {
          undo.push({ table: c.table, gid: c.gid, before: before(c.table, c.gid), deletedAt: c.table === 'settings' ? null : ((db.prepare('SELECT deleted_at FROM sync_tombstones WHERE tbl = ? AND gid = ?').get(c.table, c.gid) as any)?.deleted_at ?? null) });
          if (c.table === 'settings') {
            if (c.op === 'upsert' && c.rec) { db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(c.gid, String(c.rec.d.value)); db.prepare('INSERT OR REPLACE INTO settings_meta (key, updated_at, updated_by) VALUES (?,?,?)').run(c.gid, c.rec.u, c.rec.by); }
            continue;
          }
          if (c.op === 'delete') {
            db.prepare(`DELETE FROM ${c.table} WHERE gid = ?`).run(c.gid);
            db.prepare('INSERT OR REPLACE INTO sync_tombstones (tbl, gid, deleted_at, deleted_by) VALUES (?,?,?,?)').run(c.table, c.gid, c.deletedAt ?? new Date().toISOString(), null);
            continue;
          }
          upsertRow(db, c.table, c.gid, c.rec!, false); pendingFks.push({ t: c.table, gid: c.gid, rec: c.rec! });
        } catch (e: any) { errors.push(`${c.table} ${c.label}: ${e?.message ?? e}`); }
      }
      for (const p of pendingFks) { try { setFks(db, p.t, p.gid, p.rec); } catch (e: any) { errors.push(`${p.t}: ${e?.message ?? e}`); } }
    })();
  } finally {
    db.prepare("UPDATE settings SET value = '0' WHERE key = 'syncApplying'").run();
    db.pragma('foreign_keys = ON');
  }
  return { undo, errors };
}

function snapshotRow(db: DB, t: string, gid: string): RowRec | null {
  const r = db.prepare(`SELECT * FROM ${t} WHERE gid = ?`).get(gid) as Record<string, any> | undefined; if (!r) return null;
  const def = SYNC_TABLES[t]; const d: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) { if (META.has(k) || SKIP[t]?.includes(k)) continue; d[k] = def.fks[k] ? (v == null ? null : (db.prepare(`SELECT gid FROM ${def.fks[k]} WHERE id = ?`).get(v) as any)?.gid ?? null) : v; }
  return { u: r.updated_at, by: r.updated_by, d };
}
function upsertRow(db: DB, t: string, gid: string, rec: RowRec, withFks: boolean) {
  const def = SYNC_TABLES[t];
  const cols = new Set((db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name));
  const data = Object.entries(rec.d).filter(([k]) => cols.has(k) && (withFks || !def.fks[k]));
  const exists = db.prepare(`SELECT id FROM ${t} WHERE gid = ?`).get(gid) as { id: number } | undefined;
  if (exists) db.prepare(`UPDATE ${t} SET ${[...data.map(([k]) => `${k} = ?`), 'updated_at = ?', 'updated_by = ?'].join(', ')} WHERE id = ?`).run(...data.map(([, v]) => v), rec.u, rec.by, exists.id);
  else {
    // a row may exist under a different gid but the same natural key (e.g. built-in category) -> adopt it
    if (t === 'categories' && rec.d.key) { const m = db.prepare('SELECT id FROM categories WHERE key = ?').get(rec.d.key) as { id: number } | undefined; if (m) { db.prepare('UPDATE categories SET gid = ? WHERE id = ?').run(gid, m.id); return upsertRow(db, t, gid, rec, withFks); } }
    db.prepare(`INSERT INTO ${t} (${[...data.map(([k]) => k), 'gid', 'updated_at', 'updated_by'].join(', ')}) VALUES (${[...data, 1, 2, 3].map(() => '?').join(', ')})`).run(...data.map(([, v]) => v), gid, rec.u, rec.by);
  }
  db.prepare('DELETE FROM sync_tombstones WHERE tbl = ? AND gid = ?').run(t, gid);
}
function setFks(db: DB, t: string, gid: string, rec: RowRec) {
  const def = SYNC_TABLES[t]; const fk = Object.entries(def.fks).filter(([k]) => k in rec.d);
  if (!fk.length) return;
  const vals = fk.map(([k, ft]) => (rec.d[k] == null ? null : (db.prepare(`SELECT id FROM ${ft} WHERE gid = ?`).get(rec.d[k]) as any)?.id ?? null));
  db.prepare(`UPDATE ${t} SET ${fk.map(([k]) => `${k} = ?`).join(', ')} WHERE gid = ?`).run(...vals, gid);
}

/** Restore before-images recorded by applyChanges. */
export function applyUndo(db: DB, undo: UndoItem[]) {
  const inverse: Change[] = undo.map((u) => (u.before
    ? { table: u.table, gid: u.gid, op: 'upsert', rec: u.before, kind: 'edited', newer: 'local', label: '' }
    : { table: u.table, gid: u.gid, op: 'delete', deletedAt: new Date().toISOString(), kind: 'deleted', newer: 'local', label: '' })) as Change[];
  const r = applyChanges(db, inverse);
  // a row that was not deleted before the sync should not keep a tombstone created by the undo
  for (const u of undo) if (!u.before && !u.deletedAt) db.prepare('DELETE FROM sync_tombstones WHERE tbl = ? AND gid = ?').run(u.table, u.gid);
  return r;
}

// ---------- history / peers ----------
export function lastSync(db: DB, peer: string): string | null { return (db.prepare('SELECT last_sync FROM sync_peers WHERE peer = ?').get(peer) as any)?.last_sync ?? null; }
export function recordSync(db: DB, o: { id: string; peer: string; peerName: string; direction: string; summary: Summary; undo: UndoItem[]; at?: string }) {
  const at = o.at ?? new Date().toISOString();
  db.prepare('INSERT OR REPLACE INTO sync_history (id, peer, peer_name, direction, summary, undo, created_at) VALUES (?,?,?,?,?,?,?)').run(o.id, o.peer, o.peerName, o.direction, JSON.stringify(o.summary), JSON.stringify(o.undo), at);
  db.prepare('INSERT INTO sync_peers (peer, name, last_sync) VALUES (?,?,?) ON CONFLICT(peer) DO UPDATE SET name = excluded.name, last_sync = excluded.last_sync').run(o.peer, o.peerName, at);
}
export function undoSync(db: DB, id: string) {
  const h = db.prepare('SELECT * FROM sync_history WHERE id = ?').get(id) as any;
  if (!h) throw Object.assign(new Error('Sync not found'), { statusCode: 404 });
  if (h.undone_at) return { ok: true, already: true };
  const r = applyUndo(db, JSON.parse(h.undo));
  db.prepare("UPDATE sync_history SET undone_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(id);
  // force a fresh comparison next time
  const prev = db.prepare('SELECT created_at FROM sync_history WHERE peer = ? AND undone_at IS NULL AND id != ? ORDER BY created_at DESC LIMIT 1').get(h.peer, id) as any;
  db.prepare('UPDATE sync_peers SET last_sync = ? WHERE peer = ?').run(prev?.created_at ?? null, h.peer);
  return { ok: true, errors: r.errors };
}
export const newSyncId = () => `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
