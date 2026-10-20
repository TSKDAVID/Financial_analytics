import { describe, it, expect } from 'vitest';
import { openDb } from '../src/db';
import { snapshot, plan, resolve, applyChanges, recordSync, lastSync, undoSync, newSyncId } from '../src/sync/engine';
import { insertTransaction } from '../src/services';
import type { DB } from '../src/schema';

/** One full phone-initiated sync between a and b (a = initiator). */
function sync(a: DB, b: DB, choices: Record<string, 'local' | 'remote'> = {}) {
  const sa = snapshot(a, 'Phone'), sb = snapshot(b, 'Desktop');
  const p = resolve(plan(sa, sb, lastSync(a, sb.deviceId)), choices);
  const id = newSyncId(); const at = new Date(Date.now() + 5).toISOString();
  const ra = applyChanges(a, p.toLocal); const rb = applyChanges(b, p.toRemote);
  recordSync(a, { id, peer: sb.deviceId, peerName: 'Desktop', direction: 'x', summary: p.summary, undo: ra.undo, at });
  recordSync(b, { id, peer: sa.deviceId, peerName: 'Phone', direction: 'x', summary: p.summary, undo: rb.undo, at });
  return { p, id, errors: [...ra.errors, ...rb.errors] };
}
const wait = () => new Promise((r) => setTimeout(r, 15));
const names = (db: DB, t: string) => (db.prepare(`SELECT name FROM ${t} ORDER BY name`).all() as { name: string }[]).map((r) => r.name);

describe('two-way sync', () => {
  it('merges both sides, keeps FKs, propagates edits/deletes, detects conflicts and undoes', async () => {
    const phone = openDb(':memory:'), desk = openDb(':memory:');
    const acc = Number(desk.prepare("INSERT INTO accounts (name, type) VALUES ('BOG', 'bank')").run().lastInsertRowid);
    const groceries = (desk.prepare("SELECT id FROM categories WHERE key = 'groceries'").get() as any).id;
    await insertTransaction(desk, { kind: 'expense', amount: 40, date: '2026-10-01', account_id: acc, category_id: groceries, description: 'Nikora' });
    phone.prepare("INSERT INTO accounts (name, type) VALUES ('Cash', 'cash')").run();
    const first = sync(phone, desk);
    expect(first.errors).toEqual([]);
    expect(first.p.summary.toLocal.accounts.added).toBe(1); expect(first.p.summary.toRemote.accounts.added).toBe(1);
    expect(first.p.summary.toLocal.categories).toBeUndefined(); // built-ins have deterministic gids
    expect(names(phone, 'accounts')).toEqual(['BOG', 'Cash']); expect(names(desk, 'accounts')).toEqual(['BOG', 'Cash']);
    const tx = phone.prepare('SELECT t.*, a.name AS acc, c.key AS ck FROM transactions t JOIN accounts a ON a.id = t.account_id JOIN categories c ON c.id = t.category_id').get() as any;
    expect(tx).toMatchObject({ acc: 'BOG', ck: 'groceries', amount: 40 });
    expect(plan(snapshot(phone), snapshot(desk), lastSync(phone, snapshot(desk).deviceId)).summary.total).toBe(0);
    // edit on desktop, delete on phone
    await wait(); desk.prepare("UPDATE accounts SET name = 'BOG main' WHERE name = 'BOG'").run();
    phone.prepare("DELETE FROM accounts WHERE name = 'Cash'").run();
    const second = sync(phone, desk);
    expect(second.p.summary.toLocal.accounts.edited).toBe(1); expect(second.p.summary.toRemote.accounts.deleted).toBe(1);
    expect(names(desk, 'accounts')).toEqual(['BOG main']); expect(names(phone, 'accounts')).toEqual(['BOG main']);
    // conflict: both edit
    await wait(); phone.prepare("UPDATE accounts SET name = 'P'").run(); desk.prepare("UPDATE accounts SET name = 'D'").run();
    const p3 = plan(snapshot(phone), snapshot(desk), lastSync(phone, snapshot(desk).deviceId));
    expect(p3.conflicts).toHaveLength(1);
    const third = sync(phone, desk, { [p3.conflicts[0].key]: 'remote' });
    expect(third.p.conflicts).toHaveLength(0);
    expect(names(phone, 'accounts')).toEqual(['D']);
    // undo last sync on both sides
    undoSync(phone, third.id); undoSync(desk, third.id);
    expect(names(phone, 'accounts')).toEqual(['P']); expect(names(desk, 'accounts')).toEqual(['D']);
  });
  it('does not duplicate auto-generated recurring transactions', async () => {
    const phone = openDb(':memory:'), desk = openDb(':memory:');
    desk.prepare("INSERT INTO recurring (kind, name, amount, unit, interval, start_date) VALUES ('income', 'Salary', 1000, 'month', 1, '2026-08-01')").run();
    sync(phone, desk);
    for (const db of [phone, desk]) { const r = db.prepare('SELECT * FROM recurring').get() as any; await insertTransaction(db, { kind: 'income', amount: 1000, date: '2026-09-01', recurring_id: r.id, description: 'Salary' }); }
    const s = sync(phone, desk);
    expect(s.p.conflicts.length + s.p.toLocal.length + s.p.toRemote.length).toBeLessThanOrEqual(1);
    expect((phone.prepare('SELECT COUNT(*) AS c FROM transactions').get() as any).c).toBe(1);
  });
});
