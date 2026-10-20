/**
 * Cash-flow reconciliation: does "income − expenses" explain how much the account balances really moved?
 * Also the data fixes that make it true: imports linked to their account, loan installments marked paid
 * in the app not double-counted next to the imported bank payment.
 */
import { addDays, addMonths } from '@fa/core';
import { getSetting, setSetting, type DB } from './schema';

const r2 = (x: number) => Math.round(x * 100) / 100;
const bankKey = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/\b(bank|of|jsc|ltd|llc)\b|სს|ბანკი/g, '').replace(/[^a-z\u10d0-\u10ff]/g, '');
const ALIASES: Record<string, string> = { bog: 'georgia', საქართველოს: 'georgia', თიბისი: 'tbc', ლიბერთი: 'liberty' };
export const bankNorm = (s: string | null | undefined) => { const k = bankKey(s); return ALIASES[k] ?? k; };

/** The one active account that belongs to this bank, or null when none / ambiguous. */
export function guessAccountForBank(db: DB, bank: string | null | undefined): number | null {
  const k = bankNorm(bank); if (!k) return null;
  const acc = db.prepare('SELECT id, name, bank FROM accounts WHERE archived = 0').all() as { id: number; name: string; bank: string | null }[];
  const hits = acc.filter((a) => [a.bank, a.name].some((x) => { const n = bankNorm(x); return !!n && (n === k || n.includes(k) || k.includes(n)); }));
  return hits.length === 1 ? hits[0].id : null;
}

/** Approved imports that were never tied to an account: tie them (and their transactions) to the matching account. */
export function linkImportAccounts(db: DB) {
  let batches = 0, txs = 0;
  db.transaction(() => {
    for (const b of db.prepare("SELECT id, bank FROM import_batches WHERE account_id IS NULL AND status != 'discarded'").all() as { id: number; bank: string }[]) {
      const acct = guessAccountForBank(db, b.bank); if (!acct) continue;
      db.prepare('UPDATE import_batches SET account_id = ? WHERE id = ?').run(acct, b.id); batches++;
      const rows = db.prepare(`SELECT t.id, t.kind, t.account_id, t.to_account_id, t.moved_from, r.kind AS dir FROM transactions t JOIN import_rows r ON r.transaction_id = t.id
        WHERE t.import_batch_id = ? AND r.batch_id = ? AND t.account_id IS NULL AND t.to_account_id IS NULL`).all(b.id, b.id) as any[];
      for (const t of rows) {
        const inbound = t.dir === 'income';
        const [from, to] = t.kind === 'transfer' ? (inbound ? [null, acct] : [acct, null]) : [acct, null];
        let mf = t.moved_from;
        if (mf) { const o = JSON.parse(mf); if (o.account_id == null && o.to_account_id == null) { if (o.kind === 'transfer') { o.account_id = inbound ? null : acct; o.to_account_id = inbound ? acct : null; } else o.account_id = acct; } mf = JSON.stringify(o); }
        db.prepare('UPDATE transactions SET account_id = ?, to_account_id = ?, moved_from = ? WHERE id = ?').run(from, to, mf, t.id); txs++;
      }
    }
  })();
  return { batches, txs };
}

/** An imported bank payment (principal + interest + fee lines of one day) that already covers this loan installment. */
export function findImportedLoanPayment(db: DB, bill: { loan_id: number; due_date: string; amount: number }): number | null {
  const loan = db.prepare('SELECT monthly_fee FROM loans WHERE id = ?').get(bill.loan_id) as { monthly_fee: number | null } | undefined;
  const prevDue = db.prepare('SELECT MAX(due_date) FROM bills WHERE loan_id = ? AND due_date < ?').pluck().get(bill.loan_id, bill.due_date) as string | null;
  const from = addDays(prevDue ?? addMonths(bill.due_date, -1), -3), to = addDays(bill.due_date, 5);
  const used = new Set(db.prepare('SELECT transaction_id FROM bills WHERE transaction_id IS NOT NULL').pluck().all() as number[]);
  const days = db.prepare(`SELECT date, GROUP_CONCAT(id) AS ids, SUM(CASE WHEN tx_kind = 'loan_repayment' THEN amount_gel ELSE 0 END) AS pay, SUM(CASE WHEN tx_kind = 'fee' THEN amount_gel ELSE 0 END) AS fee
    FROM transactions WHERE import_batch_id IS NOT NULL AND kind = 'expense' AND tx_kind IN ('loan_repayment','fee') AND date > ? AND date <= ? GROUP BY date HAVING pay > 0 ORDER BY date`).all(from, to) as { date: string; ids: string; pay: number; fee: number }[];
  const fee = loan?.monthly_fee ?? 0, tol = Math.max(1, bill.amount * 0.05);
  for (const d of days) {
    const ids = d.ids.split(',').map(Number); if (ids.some((i) => used.has(i))) continue;
    if ([d.pay, d.pay + d.fee, d.pay + fee].some((v) => Math.abs(v - bill.amount) <= tol)) return ids[0];
  }
  return null;
}

/** Installments marked paid in the app whose payment is also in an imported statement: keep the bank's lines only. */
export function dedupeLoanPayments(db: DB) {
  const removed: any[] = [];
  db.transaction(() => {
    for (const b of db.prepare(`SELECT b.id, b.loan_id, b.due_date, b.amount, b.transaction_id FROM bills b JOIN transactions t ON t.id = b.transaction_id
      WHERE b.loan_id IS NOT NULL AND b.paid = 1 AND t.import_batch_id IS NULL`).all() as any[]) {
      const hit = findImportedLoanPayment(db, b); if (!hit) continue;
      removed.push(db.prepare('SELECT * FROM transactions WHERE id = ?').get(b.transaction_id));
      db.prepare('UPDATE bills SET transaction_id = ? WHERE id = ?').run(hit, b.id);
      db.prepare('DELETE FROM transactions WHERE id = ?').run(b.transaction_id);
    }
  })();
  return removed;
}

export type ReconKey = 'income' | 'spending' | 'debt' | 'people' | 'savings' | 'ownOther' | 'unlinked';
const SAVINGS_RE = /ყულაბ|ანაბარ|piggy|savings|deposit account|შემნახველ/i;

/**
 * How the balances of your accounts moved between from and to, explained line by line.
 * Lines are signed (+ money in). change = end − start; unexplained = change − sum(lines).
 */
export function reconciliation(db: DB, from: string, to: string) {
  const accounts = db.prepare('SELECT * FROM accounts WHERE archived = 0').all() as any[];
  const ids = new Set(accounts.map((a) => a.id));
  // same rule as accountBalances: which items are already inside the entered opening balance
  const after = `(a.opening_date IS NULL OR t.date > a.opening_date OR (t.date = a.opening_date AND t.import_batch_id IS NULL AND (a.opening_at IS NULL OR t.created_at > a.opening_at)))`;
  const live = 'NOT (t.recurring_id IS NOT NULL AND t.confirmed = 0)';
  const balAt = (a: any, d: string) => {
    const q = (side: 'account_id' | 'to_account_id', sign: string) => db.prepare(`SELECT
        COALESCE(SUM(CASE WHEN ${after} AND t.date <= @d THEN ${sign} END), 0) AS fwd,
        COALESCE(SUM(CASE WHEN NOT ${after} AND t.date > @d THEN ${sign} END), 0) AS back
      FROM transactions t JOIN accounts a ON a.id = t.${side} WHERE a.id = @id AND ${live}`).get({ id: a.id, d }) as { fwd: number; back: number };
    const o = q('account_id', "CASE WHEN t.kind = 'income' THEN t.amount_gel ELSE -t.amount_gel END");
    const i = q('to_account_id', "CASE WHEN t.kind = 'transfer' THEN t.amount_gel ELSE 0 END");
    return a.opening_balance + o.fwd + i.fwd - o.back - i.back;
  };
  const per = accounts.map((a) => { const start = r2(balAt(a, addDays(from, -1))), end = r2(balAt(a, to)); return { id: a.id, name: a.name, start, end, change: r2(end - start) }; });
  const rows = db.prepare(`SELECT t.kind, t.tx_kind, t.amount_gel AS v, t.account_id AS a, t.to_account_id AS b, t.loan_id, t.description, c.key AS ck, p.key AS pk
    FROM transactions t LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN categories p ON p.id = c.parent_id WHERE t.date BETWEEN ? AND ? AND ${live}`).all(from, to) as any[];
  const L: Record<ReconKey, number> = { income: 0, spending: 0, debt: 0, people: 0, savings: 0, ownOther: 0, unlinked: 0 };
  let unknownTransfers = 0;
  for (const t of rows) {
    const inA = t.a != null && ids.has(t.a), inB = t.b != null && ids.has(t.b);
    if (t.kind === 'income' || t.kind === 'expense') {
      const s = t.kind === 'income' ? t.v : -t.v;
      if (t.kind === 'income') L.income += t.v;
      else if (t.loan_id != null || t.tx_kind === 'loan_repayment' || t.ck === 'loans' || t.pk === 'loans') L.debt -= t.v;
      else L.spending -= t.v;
      if (!inA) L.unlinked -= s; // counted above but it never touched a tracked account
      continue;
    }
    if (inA && inB) continue; // between your accounts: nets to zero
    if (!inA && !inB) { unknownTransfers += t.v; continue; }
    const s = inB ? t.v : -t.v;
    if (t.tx_kind === 'transfer_in' || t.tx_kind === 'transfer_out') L.people += s;
    else if (SAVINGS_RE.test(t.description ?? '')) L.savings += s;
    else L.ownOther += s;
  }
  const lines = (Object.keys(L) as ReconKey[]).map((k) => ({ key: k, amount: r2(L[k]) }));
  const start = r2(per.reduce((s, a) => s + a.start, 0)), end = r2(per.reduce((s, a) => s + a.end, 0)), change = r2(end - start);
  const explained = r2(lines.reduce((s, l) => s + l.amount, 0));
  return { from, to, start, end, change, lines, explained, unexplained: r2(change - explained), unknownTransfers: r2(unknownTransfers), accounts: per,
    incomeMinusExpenses: r2(L.income + L.spending + L.debt) };
}

/** v1.4 data fix (once): link imports to accounts, drop double-counted loan installments. */
export function migrateCashflow(db: DB, refreshPeople: (db: DB) => unknown) {
  if (getSetting(db, 'cashflowV14')) return;
  const linked = linkImportAccounts(db);
  const removed = dedupeLoanPayments(db);
  refreshPeople(db); // rent is now recognised from its description
  setSetting(db, 'cashflowV14', JSON.stringify({ at: new Date().toISOString(), ...linked, loanDuplicates: removed.length, removed }));
}
