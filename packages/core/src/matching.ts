/**
 * Cross-statement matching.
 * 1. Own transfers between banks/accounts: an outflow in one account and an inflow in another with
 *    the same amount (within a fee tolerance, or converted through the NBG rate for different currencies)
 *    on the same day or within the clearing window. Your own name / IBAN on either leg is a strong signal.
 * 2. People: transfers to and from the same person (Georgian/Latin names normalised) are grouped with a running net balance.
 */
import { nameKey } from './textnorm';

export interface Leg {
  ref: string; account: string; date: string; time?: string | null; amount: number; currency: string; dir: 'in' | 'out';
  kind?: string | null; counterparty?: string | null; counterpartyAccount?: string | null; own?: boolean;
  /** bank code of this leg's account (IBAN letters 5-6, e.g. "TB", "BG") and the bank the money is sent to, if the text says so */
  bank?: string | null; toBank?: string | null;
  /** the counterparty is a third party (a person or company that is not you) */
  thirdParty?: boolean;
}
/** Bank code from an IBAN (GE29TB… → TB). */
export const ibanBank = (iban?: string | null) => (iban && /^GE\d{2}[A-Z]{2}/.test(iban) ? iban.slice(4, 6) : null);
/** Where a card-to-card / instant transfer goes, from the merchant text (TBC_P2P → TB, EGREVE.BOG.GE → BG). */
export function destinationBank(text?: string | null): string | null {
  if (!text) return null;
  if (/\bTBC|თიბისი/i.test(text)) return 'TB';
  if (/\bBOG\b|EGREVE|BANK OF GEORGIA|საქართველოს ბანკ/i.test(text)) return 'BG';
  if (/LIBERTY|ლიბერთი/i.test(text)) return 'LB';
  if (/CREDO|კრედო/i.test(text)) return 'CD';
  return null;
}
export interface MatchOpts { maxDays?: number; feeAbs?: number; feePct?: number; fxTolerance?: number; rate?: (cur: string, date: string) => number | null; minScore?: number }
export interface TransferMatch { out: string; in: string; score: number; fee: number; feeCurrency: string; reasons: string[]; crossCurrency: boolean }

const days = (a: string, b: string) => Math.abs(Date.parse(a.slice(0, 10)) - Date.parse(b.slice(0, 10))) / 86400000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const TRANSFERISH = new Set(['internal', 'transfer_out', 'transfer_in', 'exchange', 'cash_deposit', null, undefined]);

/** Score one candidate pair, or null when it cannot be the same movement. */
export function scorePair(o: Leg, i: Leg, opts: MatchOpts = {}): TransferMatch | null {
  const maxDays = opts.maxDays ?? 3, feeAbs = opts.feeAbs ?? 2, feePct = opts.feePct ?? 0.01, fxTol = opts.fxTolerance ?? 0.025;
  if (o.dir !== 'out' || i.dir !== 'in' || o.account === i.account) return null;
  if (!TRANSFERISH.has(o.kind as any) || !TRANSFERISH.has(i.kind as any)) return null;
  if (o.kind === 'exchange' || i.kind === 'exchange') return null;
  if (o.thirdParty || i.thirdParty) return null; // paid to / received from someone else
  // a named transfer to an IBAN in the same bank stays inside that bank
  for (const l of [o, i]) { const b = ibanBank(l.counterpartyAccount); if (b && l.bank && b === l.bank && (l.counterparty || l.kind === 'internal')) return null; }
  if (o.bank && i.bank && o.bank === i.bank && !(o.counterpartyAccount && o.counterpartyAccount === i.account)) return null;
  if (o.toBank && i.bank && o.toBank !== i.bank) return null;
  const d = days(o.date, i.date); if (d > maxDays) return null;
  if (i.date < o.date && d > 1) return null; // money cannot arrive long before it left
  const reasons: string[] = []; let score = 0.45; let fee = 0; const cross = o.currency !== i.currency;
  if (!cross) {
    const diff = r2(o.amount - i.amount);
    if (diff < -0.005 || diff > Math.max(feeAbs, o.amount * feePct)) return null;
    if (Math.abs(diff) < 0.005) { score += 0.2; reasons.push('same amount'); } else { score += 0.1; fee = diff; reasons.push(`amount differs by ${diff} ${o.currency} (fee)`); }
  } else {
    const ro = opts.rate?.(o.currency, o.date) ?? null, ri = opts.rate?.(i.currency, i.date) ?? null;
    if (!ro || !ri) return null;
    const outGel = o.amount * ro, inGel = i.amount * ri;
    const rel = Math.abs(outGel - inGel) / Math.max(outGel, inGel);
    if (rel > fxTol) return null;
    score += 0.1; reasons.push(`≈ via NBG rate (${(rel * 100).toFixed(1)}% apart)`);
  }
  if (d === 0) { score += 0.15; reasons.push('same day'); } else reasons.push(`${d} day(s) apart`);
  if (o.time && i.time && Math.abs(Date.parse(o.time) - Date.parse(i.time)) <= 2 * 3600000) { score += 0.05; reasons.push('same time'); }
  if (o.own || i.own) { score += 0.15; reasons.push('your own name/account on a leg'); }
  if (o.toBank && o.toBank === i.bank) { score += 0.2; reasons.push(`sent to ${i.bank} (card-to-card)`); }
  if (o.counterpartyAccount && o.counterpartyAccount === i.account) { score += 0.3; reasons.push('recipient IBAN is the other account'); }
  if (i.counterpartyAccount && i.counterpartyAccount === o.account) { score += 0.3; reasons.push('sender IBAN is the other account'); }
  if (o.kind === 'transfer_out' || o.kind === 'internal') score += 0.05;
  if (i.kind === 'transfer_in' || i.kind === 'internal') score += 0.05;
  return { out: o.ref, in: i.ref, score: Math.min(0.99, r2(score)), fee: r2(Math.max(0, fee)), feeCurrency: o.currency, reasons, crossCurrency: cross };
}

/** Greedy one-to-one matching, best score first. */
export function matchTransfers(legs: Leg[], opts: MatchOpts = {}): TransferMatch[] {
  const outs = legs.filter((l) => l.dir === 'out'), ins = legs.filter((l) => l.dir === 'in');
  const byDate = new Map<string, Leg[]>();
  for (const i of ins) { const k = i.date.slice(0, 10); byDate.set(k, [...(byDate.get(k) ?? []), i]); }
  const maxDays = opts.maxDays ?? 3; const cands: TransferMatch[] = [];
  for (const o of outs) for (let k = -1; k <= maxDays; k++) {
    const dt = new Date(Date.parse(o.date.slice(0, 10)) + k * 86400000).toISOString().slice(0, 10);
    for (const i of byDate.get(dt) ?? []) { const m = scorePair(o, i, opts); if (m && m.score >= (opts.minScore ?? 0.6)) cands.push(m); }
  }
  cands.sort((a, b) => b.score - a.score || a.fee - b.fee);
  const used = new Set<string>(); const out: TransferMatch[] = [];
  for (const c of cands) { if (used.has(c.out) || used.has(c.in)) continue; used.add(c.out); used.add(c.in); out.push(c); }
  return out;
}

export interface PersonFlow { ref: string; date: string; amount: number; currency: string; dir: 'in' | 'out'; counterparty: string; amountGel?: number }
export interface PersonSummary {
  key: string; name: string; sent: number; received: number; net: number; count: number;
  /** lent: money went out and (partly) came back; split: small amounts both ways; gift: only one direction */
  pattern: 'lent_repaid' | 'lent_open' | 'borrowed' | 'shared' | 'one_way_out' | 'one_way_in';
  items: (PersonFlow & { running: number })[]; lastDate: string;
}
/** Group person-to-person transfers by normalised name; net > 0 means they owe you. */
export function groupPeople(flows: PersonFlow[]): PersonSummary[] {
  const by = new Map<string, PersonFlow[]>();
  for (const f of flows) { const k = nameKey(f.counterparty); if (!k) continue; by.set(k, [...(by.get(k) ?? []), f]); }
  const out: PersonSummary[] = [];
  for (const [key, list] of by) {
    const s = [...list].sort((a, b) => a.date.localeCompare(b.date)); let run = 0;
    const items = s.map((f) => { const v = f.amountGel ?? f.amount; run = r2(run + (f.dir === 'out' ? v : -v)); return { ...f, running: run }; });
    const sent = r2(s.filter((f) => f.dir === 'out').reduce((a, f) => a + (f.amountGel ?? f.amount), 0));
    const received = r2(s.filter((f) => f.dir === 'in').reduce((a, f) => a + (f.amountGel ?? f.amount), 0));
    const net = r2(sent - received);
    let pattern: PersonSummary['pattern'];
    if (!received) pattern = 'one_way_out'; else if (!sent) pattern = 'one_way_in';
    else if (Math.abs(net) <= Math.max(1, 0.05 * Math.max(sent, received))) pattern = sent / s.length < 40 && s.length >= 4 ? 'shared' : 'lent_repaid';
    else pattern = net > 0 ? 'lent_open' : 'borrowed';
    const nm = s.map((f) => f.counterparty).sort((a, b) => b.length - a.length)[0];
    out.push({ key, name: nm, sent, received, net, count: s.length, pattern, items, lastDate: s[s.length - 1].date });
  }
  return out.sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || b.count - a.count);
}
