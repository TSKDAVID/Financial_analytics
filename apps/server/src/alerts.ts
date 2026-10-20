import { addDays, monthKey, todayISO, dtiLevel } from '@fa/core';
import type { DB } from './db';
import { getSetting } from './db';
import { budgetStatus } from './services';
import { riskData, utilitiesData, anomaliesList } from './analytics';
import { pushAlert } from './notify';

interface NewAlert { key: string; type: string; severity: 'info' | 'warning' | 'danger'; title: string; body: string; ref_type?: string; ref_id?: number; due_date?: string }

/** Evaluate all alert rules; insert new ones (idempotent by key) and push them. Returns new alerts. */
export async function evaluateAlerts(db: DB): Promise<NewAlert[]> {
  const today = todayISO();
  const list: NewAlert[] = [];
  const fmt = (n: number) => `${Math.round(n).toLocaleString('en-US')} ₾`;
  const bills = db.prepare('SELECT b.*, s.kind AS skind FROM bills b LEFT JOIN subscriptions s ON s.id = b.subscription_id WHERE b.paid = 0 AND b.due_date <= ?').all(addDays(today, 3)) as any[];
  for (const b of bills) {
    const overdue = b.due_date < today;
    const isLoan = !!b.loan_id;
    const when = b.due_date === today ? 'today' : b.due_date === addDays(today, 1) ? 'tomorrow' : overdue ? `overdue since ${b.due_date}` : `on ${b.due_date}`;
    list.push({ key: `bill:${b.id}:${overdue ? 'over' : 'due'}`, type: isLoan ? 'loan' : 'bill', severity: overdue ? 'danger' : 'warning',
      title: `${isLoan ? 'Loan payment' : b.skind === 'subscription' ? 'Subscription' : 'Bill'}: ${b.name}`, body: `${b.amount} ${b.currency} due ${when}`, ref_type: 'bill', ref_id: b.id, due_date: b.due_date });
  }
  const mk = monthKey(today);
  for (const b of budgetStatus(db)) {
    if (b.pct >= 1) list.push({ key: `budget:${b.category_id}:${mk}:100`, type: 'budget', severity: 'danger', title: `Budget exceeded: ${b.name}`, body: `Spent ${fmt(b.spent)} of ${fmt(b.limit)} (${Math.round(b.pct * 100)}%)`, ref_type: 'budget', ref_id: b.id });
    else if (b.pct >= 0.8) list.push({ key: `budget:${b.category_id}:${mk}:80`, type: 'budget', severity: 'warning', title: `Budget at ${Math.round(b.pct * 100)}%: ${b.name}`, body: `${fmt(b.remaining)} left this month`, ref_type: 'budget', ref_id: b.id });
  }
  const risk = riskData(db);
  if (risk.lowBalance.firstBelow) {
    const fb = risk.lowBalance.firstBelow;
    list.push({ key: `lowbal:${fb.date}`, type: 'risk', severity: 'danger', title: 'Low balance ahead', body: `Balance forecast to drop to ${fmt(fb.balance)} on ${fb.date}, below your ${fmt(risk.lowBalance.minBalance)} minimum`, due_date: fb.date });
  }
  const lvl = dtiLevel(risk.health.dti);
  if (lvl !== 'ok' && risk.monthlyIncome > 0) list.push({ key: `dti:${mk}:${lvl}`, type: 'risk', severity: lvl === 'danger' ? 'danger' : 'warning', title: 'High debt-to-income', body: `Debt payments take ${Math.round(risk.health.dti * 100)}% of income (safe: under 36%)` });
  if (risk.monthlyExpenses > 0 && risk.emergency.months < 1) list.push({ key: `emergency:${mk}`, type: 'risk', severity: 'warning', title: 'Emergency fund is low', body: `Savings cover ${risk.emergency.months.toFixed(1)} months of expenses (target ${risk.emergency.target})` });
  for (const j of utilitiesData(db).jumps) list.push({ key: `utiljump:${j.key}:${j.month}`, type: 'utility', severity: 'warning', title: `${j.name} bill jumped ${j.pct}%`, body: `${fmt(j.amount)} in ${j.month} vs usual ${fmt(j.usual)}` });
  for (const a of anomaliesList(db).slice(0, 5)) list.push({ key: `anomaly:${a.id}`, type: 'anomaly', severity: 'info', title: 'Unusual transaction', body: `${a.description ?? a.category ?? 'Expense'}: ${fmt(a.amount_gel)} on ${a.date} (~${(a.amount_gel / a.median).toFixed(1)}× usual)`, ref_type: 'transaction', ref_id: a.id });

  const ins = db.prepare('INSERT OR IGNORE INTO alerts (key, type, severity, title, body, ref_type, ref_id, due_date) VALUES (@key,@type,@severity,@title,@body,@ref_type,@ref_id,@due_date)');
  const fresh: NewAlert[] = [];
  for (const a of list) {
    const r = ins.run({ ref_type: null, ref_id: null, due_date: null, ...a });
    if (r.changes) fresh.push(a);
  }
  // auto-resolve bill alerts for bills that got paid
  db.prepare("UPDATE alerts SET dismissed = 1 WHERE ref_type = 'bill' AND ref_id IN (SELECT id FROM bills WHERE paid = 1)").run();
  if (getSetting(db, 'pushEnabled') !== '0') for (const a of fresh) await pushAlert(db, a.title, a.body, a.severity).catch(() => undefined);
  db.prepare('UPDATE alerts SET pushed = 1 WHERE pushed = 0').run();
  return fresh;
}

/** Re-push snoozed alerts whose snooze expired. */
export async function wakeSnoozed(db: DB) {
  const now = new Date().toISOString();
  const rows = db.prepare('SELECT * FROM alerts WHERE snoozed_until IS NOT NULL AND snoozed_until <= ? AND dismissed = 0').all(now) as any[];
  for (const a of rows) {
    db.prepare('UPDATE alerts SET snoozed_until = NULL, read = 0 WHERE id = ?').run(a.id);
    await pushAlert(db, a.title, a.body, a.severity).catch(() => undefined);
  }
}
