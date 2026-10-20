import type { Cell, Line } from './pdf';
import { isBog, parseBog, isTbc, parseTbc } from './banks';

export interface ParsedRow {
  date: string; description: string; amount: number; currency: string; kind: 'income' | 'expense'; raw: string; page: number;
  /** bank's own operation type, e.g. "გადახდა", "POS wallet", "საკუთარ ანგარიშზე გადარიცხვა" */
  opType?: string; merchant?: string; mcc?: string; card?: string; time?: string; counterparty?: string; counterpartyAccount?: string;
  purpose?: string; provider?: string; bankCategory?: string; balance?: number; origAmount?: number; origCurrency?: string;
}
export interface Verification { currency: string; opening: number; closing: number; sum: number; count: number; ok: boolean; totalIn?: number; totalOut?: number }
export interface ParseResult {
  bank: string; currency: string; rows: ParsedRow[]; periodFrom: string | null; periodTo: string | null; warnings: string[];
  format?: 'bog' | 'tbc' | 'generic'; holder?: string; holderLatin?: string; account?: string; verification?: Verification[];
  dailyChecks?: number; runningChecks?: number; dailyMismatches?: number;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  'იან': 1, 'თებ': 2, 'მარ': 3, 'აპრ': 4, 'მაი': 5, 'ივნ': 6, 'ივლ': 7, 'აგვ': 8, 'სექ': 9, 'ოქტ': 10, 'ნოე': 11, 'დეკ': 12 };
const DATE_RE = /(?<![\d.])(?:(\d{4})-(\d{2})-(\d{2})|(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})|(\d{1,2})\s+([A-Za-z]{3}|[ა-ჰ]{3})[A-Za-zა-ჰ]*\.?,?\s+(\d{4}))(?![\d])/u;
const AMOUNT_RE = /(?<![\d./:-])([-−+]?\s?)(\d{1,3}(?:[ ,\u00a0'’]\d{3})+(?:[.,]\d{1,2})?|\d+[.,]\d{1,2})(?![\d./:])/gu;
const CUR_RE = /\b(GEL|USD|EUR|GBP|TRY|RUB|AMD|AZN|UAH|CHF)\b|(₾|\$|€|£)|(ლარი|ლარ|აშშ დოლარი|ევრო)/u;
const CUR_MAP: Record<string, string> = { '₾': 'GEL', '$': 'USD', '€': 'EUR', '£': 'GBP', 'ლარი': 'GEL', 'ლარ': 'GEL', 'აშშ დოლარი': 'USD', 'ევრო': 'EUR' };
const SKIP_RE = /opening balance|closing balance|balance (at|brought|carried)|საწყისი ნაშთი|საბოლოო ნაშთი|ნაშთი პერიოდის|^\s*(total|ჯამი|სულ)(?![a-zა-ჰ])|სულ ბრუნვა|turnover|page \d+|გვერდი \d+|statement period|ამონაწერი პერიოდ/iu;
const INCOME_RE = /salary|ხელფას|incoming|ჩარიცხვ|შემოსავ|გადმორიცხ|refund|return|cashback|დაბრუნ|deposit|interest earned|received|from\s/iu;

export function parseDate(s: string): string | null {
  const m = s.match(DATE_RE); if (!m) return null;
  let y: number, mo: number, d: number;
  if (m[1]) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if (m[4]) { d = +m[4]; mo = +m[5]; y = +m[6]; if (y < 100) y += 2000; }
  else { d = +m[7]; mo = MONTHS[m[8].toLowerCase().slice(0, 3)] ?? 0; y = +m[9]; }
  if (!mo || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
export function parseNumber(raw: string): number {
  let s = raw.replace(/[\s\u00a0'’]/g, '').replace('−', '-');
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc > -1 && ld > -1) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lc > -1) s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  return Number(s);
}
export function detectBank(text: string): string {
  if (/bank of georgia|საქართველოს ბანკი|bankofgeorgia|bog\.ge|\bBOG\b/i.test(text)) return 'Bank of Georgia';
  if (/tbc ?bank|თიბისი|tbcbank|tbc\.ge|\bTBC\b/i.test(text)) return 'TBC Bank';
  if (/liberty ?bank|ლიბერთი|libertybank|liberty\.ge/i.test(text)) return 'Liberty Bank';
  if (/procredit|პროკრედიტ/i.test(text)) return 'ProCredit Bank';
  if (/credo|კრედო/i.test(text)) return 'Credo Bank';
  if (/basisbank|ბაზისბანკ/i.test(text)) return 'Basisbank';
  return 'Unknown bank';
}

/** Bank-specific description clean-up (adapters). */
const ADAPTERS: Record<string, (d: string) => string> = {
  'Bank of Georgia': (d) => d.replace(/^(გადახდა|payment)\s*-\s*/i, '').replace(/\bMCC[:\s]*\d{4}\b/gi, '').replace(/\bბარათი\s*\*+\d+/g, ''),
  'TBC Bank': (d) => d.replace(/^(POS\s*-?\s*|ბარათით გადახდა\s*-?\s*)/i, '').replace(/\bამოღება\b/g, 'ATM ამოღება').replace(/\bTrx ?ID[:\s]*\w+/gi, ''),
  'Liberty Bank': (d) => d.replace(/^(card payment|ბარათით შენაძენი)\s*[:-]?\s*/i, '').replace(/\bRRN[:\s]*\d+/gi, ''),
};

interface Columns { debit?: number; credit?: number; amount?: number; balance?: number; currency?: number }
function center(c: Cell) { return c.x + c.w / 2; }
function findColumns(lines: Line[]): Columns | null {
  for (const l of lines) {
    const col: Columns = {};
    for (const c of l.cells) {
      const s = c.str.toLowerCase();
      if (/^(debit|დებეტი|withdrawals?|paid out|money out|გასავალი|outflow|ხარჯი)$/iu.test(s)) col.debit = center(c);
      else if (/^(credit|კრედიტი|deposits?|paid in|money in|შემოსავალი|inflow)$/iu.test(s)) col.credit = center(c);
      else if (/^(amount|თანხა|amount \(gel\)|ოდენობა)/iu.test(s)) col.amount = center(c);
      else if (/balance|ნაშთი|ბალანსი/iu.test(s)) col.balance = center(c);
      else if (/^(currency|ვალუტა|ccy)$/iu.test(s)) col.currency = center(c);
    }
    if ((col.debit && col.credit) || col.amount) return col;
  }
  return null;
}

export function parseStatement(lines: Line[]): ParseResult {
  if (isBog(lines)) return parseBog(lines);
  if (isTbc(lines)) return parseTbc(lines);
  const full = lines.map((l) => l.text).join('\n');
  const bank = detectBank(full);
  const curCounts = new Map<string, number>();
  for (const l of lines) { const m = l.text.match(CUR_RE); if (m) { const c = m[1] ?? CUR_MAP[m[2] ?? m[3]]; curCounts.set(c, (curCounts.get(c) ?? 0) + 1); } }
  const currency = [...curCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'GEL';
  const cols = findColumns(lines);
  const clean = ADAPTERS[bank] ?? ((d: string) => d);
  const rows: ParsedRow[] = []; const warnings: string[] = [];
  let last: ParsedRow | null = null; let lastPos: { page: number; y: number } | null = null;
  for (const l of lines) {
    const text = l.text;
    if (SKIP_RE.test(text)) { last = null; continue; }
    const head = l.cells.slice(0, 2).map((c) => c.str).join(' ');
    const date = parseDate(head) ?? ((DATE_RE.exec(text)?.index ?? 99) < 6 ? parseDate(text) : null);
    // collect amounts with their cell positions
    const amounts: { v: number; sign: string; x: number; raw: string }[] = [];
    for (const c of l.cells) {
      const noDate = c.str.replace(new RegExp(DATE_RE.source, 'gu'), ' ').replace(/\d{1,2}:\d{2}(:\d{2})?/g, ' ');
      for (const m of noDate.matchAll(AMOUNT_RE)) amounts.push({ v: parseNumber(m[2]), sign: m[1].trim(), x: center(c), raw: m[0] });
    }
    if (!date || !amounts.length) {
      // continuation of previous description
      if (last && lastPos && lastPos.page === l.page && lastPos.y - l.y < 30 && !amounts.length && !parseDate(text) && text.length < 120) { last.description = (last.description + ' ' + clean(text.replace(/\s{2,}/g, ' '))).trim(); lastPos = { page: l.page, y: l.y }; }
      continue;
    }
    let amount: number | null = null; let kind: 'income' | 'expense' | null = null;
    const near = (x: number | undefined, a: { x: number }) => (x == null ? Infinity : Math.abs(a.x - x));
    let candidates = amounts;
    if (cols?.balance != null) candidates = amounts.filter((a) => near(cols.balance, a) > 25 || amounts.length === 1);
    if (cols?.debit != null && cols.credit != null) {
      const d = candidates.filter((a) => a.v !== 0).sort((a, b) => Math.min(near(cols.debit, a), near(cols.credit, a)) - Math.min(near(cols.debit, b), near(cols.credit, b)))[0];
      if (d) { amount = Math.abs(d.v); kind = near(cols.debit, d) <= near(cols.credit, d) ? 'expense' : 'income'; }
    } else {
      const a = (cols?.amount != null ? [...candidates].sort((p, q) => near(cols.amount, p) - near(cols.amount, q))[0] : candidates[0]) ?? amounts[0];
      amount = Math.abs(a.v);
      const neg = a.sign === '-' || a.sign === '−' || /\(\s*[\d.,]+\s*\)/.test(text);
      kind = neg ? 'expense' : a.sign === '+' ? 'income' : INCOME_RE.test(text) ? 'income' : 'expense';
    }
    if (amount == null || !isFinite(amount) || amount === 0 || !kind) continue;
    const curM = text.match(CUR_RE);
    const cur = curM ? curM[1] ?? CUR_MAP[curM[2] ?? curM[3]] : currency;
    let desc = text.replace(new RegExp(DATE_RE.source, 'gu'), ' ').replace(/\d{1,2}:\d{2}(:\d{2})?/g, ' ');
    for (const a of amounts) desc = desc.replace(a.raw, ' ');
    desc = clean(desc.replace(new RegExp(CUR_RE.source, 'gu'), ' ').replace(/\s{2,}/g, ' ').replace(/^[\s|:;,.-]+|[\s|:;,.-]+$/g, '').trim());
    last = { date, description: desc || '(no description)', amount: Math.round(amount * 100) / 100, currency: cur, kind, raw: text, page: l.page };
    rows.push(last); lastPos = { page: l.page, y: l.y };
  }
  if (!rows.length) warnings.push('No transactions recognised. The layout may be unusual — try the CSV/Excel export from your bank.');
  const dates = rows.map((r) => r.date).sort();
  return { bank, format: 'generic', currency, rows, periodFrom: dates[0] ?? null, periodTo: dates[dates.length - 1] ?? null, warnings };
}
