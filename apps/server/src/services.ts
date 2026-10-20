import { findImportedLoanPayment } from './cashflow';
import { importedMatch, isSkipped } from './reconcile';
import {
  addDays, addMonths, amortize, balanceAsOf, monthKey, occurrences, startOfMonth, endOfMonth, todayISO, nextOccurrence,
  perMonthFactor, type RecurringFlow, type FreqUnit, type LoanInput, mean, stdev,
} from '@fa/core';
import { REVOLVING_KINDS, type DB } from './schema';
import { getRate, latestRates } from './rates';

export interface TxRow {
  id: number; kind: 'income' | 'expense' | 'transfer'; amount: number; currency: string; rate: number; amount_gel: number; date: string;
  account_id: number | null; to_account_id: number | null; category_id: number | null; description: string | null; notes: string | null;
  tags: string; recurring_id: number | null; loan_id: number | null; subscription_id: number | null; rate_manual: number;
}
export interface AccountRow { id: number; name: string; type: string; currency: string; opening_balance: number; color: string; bank: string | null; liquid: number; archived: number }
export interface LoanRow { id: number; name: string; bank: string; principal: number; currency: string; annual_rate: number; term_months: number; start_date: string; extra_monthly: number; account_id: number | null; notes: string | null; active: number;
  kind?: string; monthly_payment?: number | null; payment_pct?: number | null; min_payment?: number | null; credit_limit?: number | null; due_day?: number | null; needs_input?: number; balance_date?: string | null; monthly_fee?: number; external_id?: string | null }
export interface SubRow { id: number; name: string; kind: 'subscription' | 'bill'; amount: number; currency: string; unit: FreqUnit; interval: number; start_date: string; category_id: number | null; account_id: number | null; provider: string | null; last_used: string | null; variable: number; active: number; notes: string | null }
export interface RecRow { id: number; kind: 'income' | 'expense'; name: string; amount: number; currency: string; account_id: number | null; category_id: number | null; notes: string | null; tags: string; unit: FreqUnit; interval: number; start_date: string; end_date: string | null; count: number | null; generated_until: string | null; auto_post: number; active: number }

const r2 = (x: number) => Math.round(x * 100) / 100;
export const isRevolving = (l: Pick<LoanRow, 'kind'>) => REVOLVING_KINDS.includes(l.kind ?? 'loan');
export const loanInput = (l: LoanRow): LoanInput => ({ principal: l.principal, annualRatePct: l.annual_rate, termMonths: l.term_months, startDate: l.start_date, extraMonthly: l.extra_monthly,
  payment: l.monthly_payment ?? null, paymentPct: l.payment_pct ?? null, minPayment: l.min_payment ?? null, revolving: isRevolving(l) });
/** Next date on `day` of the month strictly after `after` (clamped to month length). */
export function nextDueDate(after: string, day: number): string {
  const [y, m] = after.split('-').map(Number);
  for (let k = 0; k < 3; k++) {
    const dt = new Date(Date.UTC(y, m - 1 + k, 1)); const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
    const iso = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
    if (iso > after) return iso;
  }
  return after;
}

export async function insertTransaction(db: DB, t: Omit<Partial<TxRow>, 'tags' | 'rate_manual'> & { rate_manual?: boolean | number; kind: TxRow['kind']; amount: number; date: string; currency?: string; tags?: string | string[] }) {
  const currency = t.currency ?? 'GEL';
  const rate = t.rate_manual && t.rate ? t.rate : (await getRate(db, currency, t.date)).rate;
  const tags = Array.isArray(t.tags) ? JSON.stringify(t.tags) : t.tags ?? '[]';
  const info = db.prepare(`INSERT INTO transactions (kind, amount, currency, rate, amount_gel, date, account_id, to_account_id, category_id, description, notes, tags, recurring_id, loan_id, subscription_id, rate_manual)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(t.kind, t.amount, currency, rate, r2(t.amount * rate), t.date, t.account_id ?? null, t.to_account_id ?? null,
    t.category_id ?? null, t.description ?? null, t.notes ?? null, tags, t.recurring_id ?? null, t.loan_id ?? null, t.subscription_id ?? null, t.rate_manual ? 1 : 0);
  return Number(info.lastInsertRowid);
}

/** Post recurring occurrences up to today; generate bill instances for subscriptions & loans. */
export async function materialize(db: DB, today = todayISO()) {
  const recs = db.prepare('SELECT * FROM recurring WHERE active = 1 AND auto_post = 1').all() as RecRow[];
  for (const r of recs) {
    const from = r.generated_until ? addDays(r.generated_until, 1) : r.start_date;
    const dates = occurrences({ unit: r.unit, interval: r.interval, start: r.start_date, end: r.end_date, count: r.count }, from, today);
    for (const d of dates) {
      try {
        // the real payment is already imported from a statement: don't post the planned one on top
        if (isSkipped(db, r.id, d)) { db.prepare('UPDATE recurring SET generated_until = ? WHERE id = ?').run(d, r.id); continue; }
        if (importedMatch(db, r.kind, r.category_id, r.amount * (latestRates(db)[r.currency] ?? 1), d)) { db.prepare('UPDATE recurring SET generated_until = ? WHERE id = ?').run(d, r.id); continue; }
        await insertTransaction(db, { kind: r.kind, amount: r.amount, currency: r.currency, date: d, account_id: r.account_id, category_id: r.category_id, description: r.name, notes: r.notes, tags: r.tags, recurring_id: r.id }).then((id) => db.prepare('UPDATE transactions SET confirmed = 0 WHERE id = ?').run(id));
      } catch { break; /* missing rate offline: retry later */ }
      db.prepare('UPDATE recurring SET generated_until = ? WHERE id = ?').run(d, r.id);
    }
    if (!dates.length && (!r.generated_until || r.generated_until < today) && from <= today) db.prepare('UPDATE recurring SET generated_until = ? WHERE id = ?').run(today, r.id);
  }
  const horizon = addDays(today, 45);
  const subs = db.prepare('SELECT * FROM subscriptions WHERE active = 1').all() as SubRow[];
  const insB = db.prepare('INSERT OR IGNORE INTO bills (subscription_id, name, due_date, amount, currency) VALUES (?,?,?,?,?)');
  for (const s of subs) for (const d of occurrences({ unit: s.unit, interval: s.interval, start: s.start_date }, addMonths(today, -13), horizon)) insB.run(s.id, s.name, d, s.amount, s.currency);
  const loans = db.prepare('SELECT * FROM loans WHERE active = 1').all() as LoanRow[];
  const insL = db.prepare('INSERT OR IGNORE INTO bills (loan_id, name, due_date, amount, currency) VALUES (?,?,?,?,?)');
  for (const l of loans) for (const row of amortize(loanInput(l)).rows) if (row.date <= horizon && row.date >= addMonths(today, -13)) insL.run(l.id, `${l.bank} · ${l.name}`, row.date, r2(row.payment + row.extra + (l.monthly_fee ?? 0)), l.currency);
}

export async function payBill(db: DB, billId: number, opts: { date?: string; amount?: number; account_id?: number | null } = {}) {
  const b = db.prepare('SELECT * FROM bills WHERE id = ?').get(billId) as any;
  if (!b) throw new Error('Bill not found');
  if (b.paid) return b;
  const today = todayISO();
  // overdue installments are recorded on their due date, not today
  const date = opts.date ?? (b.due_date < today ? b.due_date : today);
  if (b.loan_id) {
    const l = db.prepare('SELECT tracked_from FROM loans WHERE id = ?').get(b.loan_id) as { tracked_from: string | null } | undefined;
    if (l?.tracked_from && b.due_date < l.tracked_from) {
      // before the loan was added to the app: history, already reflected in the imported balance — no expense
      db.prepare('UPDATE bills SET paid = 1, paid_date = due_date, historical = 1, transaction_id = NULL WHERE id = ?').run(billId);
      db.prepare("UPDATE alerts SET read = 1, dismissed = 1 WHERE ref_type = 'bill' AND ref_id = ?").run(billId);
      return db.prepare('SELECT * FROM bills WHERE id = ?').get(billId);
    }
  }
  if (b.loan_id && opts.amount == null) {
    // the installment is already in an imported statement: link it instead of adding a second expense
    const hit = findImportedLoanPayment(db, b);
    if (hit) { db.prepare('UPDATE bills SET paid = 1, paid_date = (SELECT date FROM transactions WHERE id = ?), transaction_id = ? WHERE id = ?').run(hit, hit, billId);
      db.prepare("UPDATE alerts SET read = 1, dismissed = 1 WHERE ref_type = 'bill' AND ref_id = ?").run(billId);
      return db.prepare('SELECT * FROM bills WHERE id = ?').get(billId); }
  }
  let category_id: number | null = null, account_id: number | null = opts.account_id ?? null;
  if (b.subscription_id) {
    const s = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(b.subscription_id) as SubRow;
    category_id = s.category_id ?? catId(db, s.kind === 'subscription' ? 'subscriptions' : 'utilities');
    account_id ??= s.account_id;
  } else if (b.loan_id) {
    const l = db.prepare('SELECT * FROM loans WHERE id = ?').get(b.loan_id) as LoanRow;
    category_id = catId(db, 'loans'); account_id ??= l.account_id;
  }
  const txId = await insertTransaction(db, { kind: 'expense', amount: opts.amount ?? b.amount, currency: b.currency, date, account_id, category_id, description: b.name, subscription_id: b.subscription_id, loan_id: b.loan_id });
  db.prepare('UPDATE bills SET paid = 1, paid_date = ?, transaction_id = ?, amount = ? WHERE id = ?').run(date, txId, opts.amount ?? b.amount, billId);
  db.prepare("UPDATE alerts SET read = 1, dismissed = 1 WHERE ref_type = 'bill' AND ref_id = ?").run(billId);
  return db.prepare('SELECT * FROM bills WHERE id = ?').get(billId);
}
export function unpayBill(db: DB, billId: number) {
  const b = db.prepare('SELECT * FROM bills WHERE id = ?').get(billId) as any;
  if (b?.transaction_id) db.prepare('DELETE FROM transactions WHERE id = ?').run(b.transaction_id);
  db.prepare('UPDATE bills SET paid = 0, paid_date = NULL, transaction_id = NULL, historical = 0 WHERE id = ?').run(billId);
}

export function catId(db: DB, key: string): number | null {
  return (db.prepare('SELECT id FROM categories WHERE key = ?').get(key) as { id: number } | undefined)?.id ?? null;
}
/** ids of a category and all its descendants */
export function catTree(db: DB, id: number): number[] {
  const rows = db.prepare('SELECT id, parent_id FROM categories').all() as { id: number; parent_id: number | null }[];
  const out = [id]; for (let i = 0; i < out.length; i++) for (const r of rows) if (r.parent_id === out[i]) out.push(r.id);
  return out;
}

export function accountBalances(db: DB) {
  const accounts = db.prepare('SELECT * FROM accounts ORDER BY archived, id').all() as AccountRow[];
  const rates = latestRates(db);
  // the opening balance is the balance ON the opening date: only transactions from that day on move it
  // (otherwise back-dated history — imported or auto-posted — would be counted twice)
  // the entered balance already contains everything up to the moment it was typed in: count only later-dated items, or
  // same-day items added after that moment (never imported statement rows of that day), and never unconfirmed auto-posts
  const after = `(a.opening_date IS NULL OR t.date > a.opening_date OR (t.date = a.opening_date AND t.import_batch_id IS NULL AND (a.opening_at IS NULL OR t.created_at > a.opening_at)))
    AND NOT (t.recurring_id IS NOT NULL AND t.confirmed = 0)`;
  const flows = db.prepare(`SELECT t.account_id AS id, SUM(CASE WHEN t.kind='income' THEN t.amount_gel WHEN t.kind IN ('expense','transfer') THEN -t.amount_gel END) AS gel
    FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE ${after} GROUP BY t.account_id`).all() as { id: number; gel: number }[];
  const inflow = db.prepare(`SELECT t.to_account_id AS id, SUM(t.amount_gel) AS gel FROM transactions t JOIN accounts a ON a.id = t.to_account_id
    WHERE t.kind='transfer' AND ${after} GROUP BY t.to_account_id`).all() as { id: number; gel: number }[];
  const fm = new Map(flows.map((f) => [f.id, f.gel])), im = new Map(inflow.map((f) => [f.id, f.gel]));
  return accounts.map((a) => {
    const rate = rates[a.currency] ?? 1;
    const gel = r2(a.opening_balance * rate + (fm.get(a.id) ?? 0) + (im.get(a.id) ?? 0));
    return { ...a, balance_gel: gel, balance: r2(gel / rate) };
  });
}

export function loanStatus(db: DB, l: LoanRow, today = todayISO()) {
  const rates = latestRates(db), rate = rates[l.currency] ?? 1;
  const sched = amortize(loanInput(l));
  const st = balanceAsOf(loanInput(l), addDays(today, 0));
  // paid bills (since the last balance update) override the time-based estimate
  const paid = (db.prepare('SELECT COUNT(*) AS c FROM bills WHERE loan_id = ? AND paid = 1 AND due_date >= ?').get(l.id, l.start_date) as { c: number }).c;
  const paidCount = Math.max(paid, 0) || st.paidCount;
  const remaining = paidCount === 0 ? l.principal : sched.rows[Math.min(paidCount, sched.rows.length) - 1]?.balance ?? 0;
  const next = sched.rows[paidCount];
  const revolving = isRevolving(l);
  const fee = l.monthly_fee ?? 0;
  const monthly = next ? next.payment : sched.monthlyPayment;
  return { ...l, revolving, monthly_payment_override: l.monthly_payment ?? null, monthly_payment: monthly, total_interest: sched.totalInterest, payoff_date: sched.neverPaysOff ? null : sched.payoffDate, paid_count: paidCount,
    remaining, remaining_gel: r2(remaining * rate), next_payment: next ?? null, months_left: sched.rows.length - paidCount, monthly_gel: r2((monthly + (next ? l.extra_monthly + fee : 0)) * rate), monthly_total: next ? r2(monthly + l.extra_monthly + fee) : 0,
    needs_input: !!l.needs_input || !!sched.needsInput, never_pays_off: !!sched.neverPaysOff,
    utilization: revolving && l.credit_limit ? r2(remaining / l.credit_limit) : null, available: revolving && l.credit_limit ? r2(Math.max(0, l.credit_limit - remaining)) : null };
}

/** Future cash flows used for forecasting (signed GEL). */
export function futureFlows(db: DB, today = todayISO()): RecurringFlow[] {
  const rates = latestRates(db);
  const out: RecurringFlow[] = [];
  for (const r of db.prepare('SELECT * FROM recurring WHERE active = 1').all() as RecRow[]) {
    out.push({ rule: { unit: r.unit, interval: r.interval, start: r.start_date, end: r.end_date, count: r.count }, amount: (r.kind === 'income' ? 1 : -1) * r.amount * (rates[r.currency] ?? 1) });
  }
  for (const s of db.prepare('SELECT * FROM subscriptions WHERE active = 1').all() as SubRow[]) {
    out.push({ rule: { unit: s.unit, interval: s.interval, start: s.start_date }, amount: -s.amount * (rates[s.currency] ?? 1) });
  }
  for (const l of db.prepare('SELECT * FROM loans WHERE active = 1').all() as LoanRow[]) {
    const st = loanStatus(db, l, today);
    if (st.next_payment && st.months_left > 0) out.push({ rule: { unit: 'month', interval: 1, start: st.next_payment.date, count: st.never_pays_off ? undefined : st.months_left }, amount: -st.monthly_gel });
  }
  return out;
}

export function monthlyTotals(db: DB, from: string, to: string, opts: { variableOnly?: boolean } = {}) {
  const where = opts.variableOnly ? 'AND recurring_id IS NULL AND loan_id IS NULL AND subscription_id IS NULL' : '';
  return db.prepare(`SELECT substr(date,1,7) AS month, SUM(CASE WHEN kind='income' THEN amount_gel ELSE 0 END) AS income,
      SUM(CASE WHEN kind='expense' THEN amount_gel ELSE 0 END) AS expense FROM transactions WHERE date BETWEEN ? AND ? ${where} GROUP BY month ORDER BY month`).all(from, to) as { month: string; income: number; expense: number }[];
}

export function periodSummary(db: DB, from: string, to: string) {
  const t = db.prepare(`SELECT SUM(CASE WHEN kind='income' THEN amount_gel ELSE 0 END) AS income, SUM(CASE WHEN kind='expense' THEN amount_gel ELSE 0 END) AS expense, COUNT(*) AS count FROM transactions WHERE date BETWEEN ? AND ?`).get(from, to) as { income: number | null; expense: number | null; count: number };
  const income = r2(t.income ?? 0), expense = r2(t.expense ?? 0);
  return { income, expense, net: r2(income - expense), savingsRate: income > 0 ? (income - expense) / income : 0, count: t.count };
}

export function riskMetrics(db: DB, today = todayISO()) {
  const from = startOfMonth(addMonths(today, -6)), lastEnd = endOfMonth(addMonths(today, -1));
  const months = monthlyTotals(db, from, lastEnd);
  const recent = months.slice(-3);
  const fallback = monthlyTotals(db, startOfMonth(today), today);
  const base = recent.length ? recent : fallback;
  const monthlyIncome = mean(base.map((m) => m.income));
  const monthlyExpenses = mean(base.map((m) => m.expense));
  const loans = (db.prepare('SELECT * FROM loans WHERE active = 1').all() as LoanRow[]).map((l) => loanStatus(db, l, today)).filter((l) => l.months_left > 0);
  const monthlyDebtPayments = loans.reduce((s, l) => s + l.monthly_gel, 0);
  const balances = accountBalances(db).filter((a) => !a.archived);
  const liquidSavings = balances.filter((a) => a.liquid).reduce((s, a) => s + a.balance_gel, 0);
  const nets = months.map((m) => m.income - m.expense);
  const m = mean(nets);
  const netVolatility = nets.length >= 3 ? Math.min(1, stdev(nets) / Math.max(Math.abs(m), monthlyIncome * 0.25, 1)) : 0.5;
  const essentialIds = (db.prepare('SELECT id FROM categories WHERE essential = 1').all() as { id: number }[]).map((r) => r.id);
  const ess = essentialIds.length ? db.prepare(`SELECT SUM(amount_gel) AS s FROM transactions WHERE kind='expense' AND loan_id IS NULL AND date BETWEEN ? AND ? AND category_id IN (${essentialIds.join(',')})`).get(startOfMonth(addMonths(today, -3)), lastEnd) as { s: number | null } : { s: 0 };
  const monthlyEssential = (ess.s ?? 0) / 3 || monthlyExpenses * 0.7;
  const totalDebt = loans.reduce((s, l) => s + l.remaining_gel, 0);
  const totalAssets = balances.reduce((s, a) => s + a.balance_gel, 0);
  return { monthlyIncome: r2(monthlyIncome), monthlyExpenses: r2(monthlyExpenses), monthlyDebtPayments: r2(monthlyDebtPayments), liquidSavings: r2(liquidSavings),
    netVolatility, monthlyEssential: r2(monthlyEssential), totalDebt: r2(totalDebt), totalAssets: r2(totalAssets), netWorth: r2(totalAssets - totalDebt), loans };
}

export function subscriptionInfo(db: DB, s: SubRow, today = todayISO()) {
  const rates = latestRates(db), rate = rates[s.currency] ?? 1;
  const monthly = s.amount * perMonthFactor(s.unit, s.interval);
  const next = nextOccurrence({ unit: s.unit, interval: s.interval, start: s.start_date }, today);
  const unused = s.kind === 'subscription' && s.last_used != null && s.last_used < addDays(today, -45);
  return { ...s, monthly: r2(monthly), yearly: r2(monthly * 12), monthly_gel: r2(monthly * rate), yearly_gel: r2(monthly * 12 * rate), next_charge: next, unused };
}

export function duplicateSubscriptions(subs: ReturnType<typeof subscriptionInfo>[]) {
  const norm = (n: string) => n.toLowerCase().replace(/[^a-z0-9ა-ჰ]/g, '').replace(/(premium|family|plus|basic|standard)$/, '');
  const groups = new Map<string, number[]>();
  for (const s of subs.filter((x) => x.active && x.kind === 'subscription')) {
    const k = norm(s.provider || s.name); groups.set(k, [...(groups.get(k) ?? []), s.id]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

export function budgetStatus(db: DB, month = monthKey(todayISO())) {
  const budgets = db.prepare('SELECT b.*, c.name, c.color, c.icon, c.key FROM budgets b JOIN categories c ON c.id = b.category_id').all() as any[];
  const from = month + '-01', to = endOfMonth(from);
  const pFrom = startOfMonth(addMonths(from, -1)), pTo = endOfMonth(pFrom);
  return budgets.map((b) => {
    const ids = catTree(db, b.category_id).join(',');
    const spent = (db.prepare(`SELECT COALESCE(SUM(amount_gel),0) AS s FROM transactions WHERE kind='expense' AND category_id IN (${ids}) AND date BETWEEN ? AND ?`).get(from, to) as { s: number }).s;
    let carry = 0;
    if (b.rollover) {
      const prev = (db.prepare(`SELECT COALESCE(SUM(amount_gel),0) AS s FROM transactions WHERE kind='expense' AND category_id IN (${ids}) AND date BETWEEN ? AND ?`).get(pFrom, pTo) as { s: number }).s;
      carry = Math.max(0, b.amount - prev);
    }
    const limit = b.amount + carry;
    return { ...b, spent: r2(spent), carry: r2(carry), limit: r2(limit), pct: limit > 0 ? spent / limit : 0, remaining: r2(limit - spent) };
  });
}

export function goalStatus(db: DB, today = todayISO()) {
  return (db.prepare('SELECT * FROM goals ORDER BY id').all() as any[]).map((g) => {
    const left = Math.max(0, g.target - g.saved);
    const months = g.target_date ? Math.max(1, (Number(g.target_date.slice(0, 4)) - Number(today.slice(0, 4))) * 12 + Number(g.target_date.slice(5, 7)) - Number(today.slice(5, 7))) : null;
    return { ...g, pct: g.target > 0 ? Math.min(1, g.saved / g.target) : 0, remaining: r2(left), months_left: months, required_monthly: months ? r2(left / months) : null };
  });
}

/**
 * Re-base a loan on a new balance (and optionally a new payment/rate) as of `date`. The previous values are stored
 * in loan_updates so the change shows in the history and can be undone. Paid bills before the date stay as history.
 */
export function applyLoanUpdate(db: DB, l: LoanRow, b: { date: string; balance?: number; monthly_payment?: number | null; payment_pct?: number | null; annual_rate?: number; due_day?: number | null; note?: string | null }) {
  const st = loanStatus(db, l, b.date);
  const prev = { principal: l.principal, start_date: l.start_date, term_months: l.term_months, monthly_payment: l.monthly_payment ?? null, payment_pct: l.payment_pct ?? null, annual_rate: l.annual_rate, due_day: l.due_day ?? null, needs_input: l.needs_input ?? 0, balance_date: l.balance_date ?? null };
  const revolving = isRevolving(l);
  const balance = b.balance ?? st.remaining;
  const dueDay = b.due_day !== undefined ? b.due_day : l.due_day ?? null;
  // first payment after the update date: the due day for cards, otherwise the loan's own payment day
  const day = dueDay ?? Number((st.next_payment?.date ?? l.start_date).slice(8, 10));
  const start = nextDueDate(b.date, day);
  const monthly = b.monthly_payment !== undefined ? b.monthly_payment : l.monthly_payment ?? null;
  const pct = b.payment_pct !== undefined ? b.payment_pct : l.payment_pct ?? null;
  // without an explicit payment, an amortizing loan keeps its remaining term
  // without an explicit payment the loan keeps its remaining term (a pinned payoff term for cards)
  const term = Math.max(revolving ? 0 : 1, st.months_left || (revolving ? 0 : l.term_months));
  const needs = revolving && !monthly && !pct && !term ? 1 : 0;
  db.transaction(() => {
    db.prepare('INSERT INTO loan_updates (loan_id, date, balance, monthly_payment, payment_pct, annual_rate, prev, note) VALUES (?,?,?,?,?,?,?,?)')
      .run(l.id, b.date, balance, monthly, pct, b.annual_rate ?? l.annual_rate, JSON.stringify(prev), b.note ?? null);
    db.prepare('UPDATE loans SET principal = ?, start_date = ?, term_months = ?, monthly_payment = ?, payment_pct = ?, annual_rate = ?, due_day = ?, needs_input = ?, balance_date = ? WHERE id = ?')
      .run(balance, start, term, monthly, pct, b.annual_rate ?? l.annual_rate, dueDay, needs, b.date, l.id);
    db.prepare('DELETE FROM bills WHERE loan_id = ? AND paid = 0').run(l.id);
  })();
}
