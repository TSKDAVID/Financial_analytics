import type { Line } from '../statements/pdf';

/**
 * Parser for Creditinfo Georgia ("ჩემი კრედიტინფო") reports.
 * Works on positional lines from pdf.js: each line is split into cells (3+ spaces = new cell), labels are matched
 * as whole cells and the value is the following cell. Personal data (name, personal ID, passport, birth date) is
 * deliberately NOT extracted.
 */
export type ContractType = 'loan' | 'credit_card' | 'overdraft' | 'installment' | 'mortgage' | 'other';
export interface ScheduleRow { month: string; balance: number | null; principal: number | null; overdue: number | null }
export interface CreditContract {
  externalId: string | null; creditor: string | null; type: ContractType; typeLabel: string | null; status: string | null; active: boolean;
  currency: string; originalAmount: number | null; balance: number | null; principalDue: number | null; monthlyPayment: number | null; undrawn: number | null; monthlyFee: number | null;
  interestRate: number | null; termMonths: number | null; startDate: string | null; endDate: string | null; closedDate: string | null; nextPaymentDate: string | null;
  overdueAmount: number; overdueDays: number; maxOverdueDays: number; penalty: number; installmentsTotal: number | null; installmentsLeft: number | null;
  restructured: boolean; schedule: ScheduleRow[]; missing: string[]; raw: string;
}
export interface CreditSummary {
  score: number | null; rating: string | null; defaultProbability: number | null; reportDate: string | null;
  activeContracts: number | null; closedContracts: number | null; creditors: number | null; totalDebt: number | null; overdueAmount: number | null;
  monthlyPayments: number | null; inquiries12m: number | null; factors: { code: string; description: string }[];
}
export interface CreditReport { summary: CreditSummary; contracts: CreditContract[]; warnings: string[] }

export class NotCreditReport extends Error { statusCode = 422; }

const cells = (l: Line) => l.text.split(/ {3,}/).map((s) => s.trim()).filter(Boolean);
const norm = (s: string) => s.replace(/\s+/g, ' ').replace(/[:：]$/, '').trim();
export function num(s: string | undefined | null): number | null {
  if (!s) return null; const m = s.replace(/\u00a0/g, ' ').match(/-?\d[\d ,]*(?:\.\d+)?/); if (!m) return null;
  let v = m[0].replace(/ /g, ''); v = /,\d{1,2}$/.test(v) && !v.includes('.') ? v.replace(',', '.') : v.replace(/,/g, '');
  const n = Number(v); return isFinite(n) ? n : null;
}
export function date(s: string | undefined | null): string | null {
  const m = s?.match(/(\d{2})\.(\d{2})\.(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
const CUR = /\b(GEL|USD|EUR|GBP|CHF|RUB|TRY)\b/;

/** First value cell after a cell matching the label. */
function field(lines: Line[], label: RegExp, valid: (v: string) => boolean = () => true): string | null {
  for (const l of lines) {
    const c = cells(l);
    for (let i = 0; i < c.length - 1; i++) if (label.test(norm(c[i])) && valid(c[i + 1]) && c[i + 1] !== '–' && c[i + 1] !== '-') return c[i + 1];
  }
  return null;
}
const isNum = (v: string) => /^-?\d[\d ,]*(\.\d+)?( ?(GEL|USD|EUR|GBP|CHF|RUB|TRY))?$/.test(v.trim());
const isDate = (v: string) => /^\d{2}\.\d{2}\.\d{4}/.test(v);
const isText = (v: string) => /\p{L}{2,}/u.test(v) && !isNum(v);

function typeOf(text: string): { type: ContractType; label: string | null } {
  const t = text.toLowerCase();
  if (/საკრედიტო ბარათ|credit card/.test(t)) return { type: 'credit_card', label: 'საკრედიტო ბარათი' };
  if (/ოვერდრაფტ|overdraft/.test(t)) return { type: 'overdraft', label: 'ოვერდრაფტი' };
  if (/იპოთეკ|mortgage|უძრავი ქონებ/.test(t)) return { type: 'mortgage', label: 'იპოთეკა' };
  if (/განვადებ|installment|pos სესხ/.test(t)) return { type: 'installment', label: 'განვადება' };
  if (/რეგულარული გადახდების კონტრაქტი|სამომხმარებლო|სესხი|loan/.test(t)) return { type: 'loan', label: 'სესხი' };
  return { type: 'other', label: null };
}

function parseSchedule(lines: Line[]): ScheduleRow[] {
  const out: ScheduleRow[] = [];
  for (let i = 0; i < lines.length; i++) {
    const c = cells(lines[i]);
    if (norm(c[0] ?? '') !== 'თვე/წელი') continue;
    const months = c.slice(1).map((m) => { const x = m.match(/(\d{1,2})\/(\d{4})/); return x ? `${x[2]}-${x[1].padStart(2, '0')}` : null; });
    const rows = months.map((m) => ({ month: m, balance: null as number | null, principal: null as number | null, overdue: null as number | null }));
    // read value rows until next header
    let lastLabel = '';
    for (let j = i + 1; j < lines.length && j < i + 60; j++) {
      const cj = cells(lines[j]); const first = norm(cj[0] ?? '');
      if (first === 'თვე/წელი' || /სესხის იდენტიფიკატორი/.test(lines[j].text)) break;
      const vals = cj.filter((v) => isNum(v) || v === '–');
      const label = cj.length > vals.length ? cj.find((v) => !isNum(v) && v !== '–') ?? '' : '';
      const ctx = (label || lastLabel);
      if (vals.length >= Math.min(2, months.length) && vals.length <= months.length) {
        const key = /^ნაშთი/.test(label) ? 'balance' : /გადასახდელი/.test(ctx) ? 'principal' : /ული თანხა|ვადაგადაცილებ$/.test(ctx) && !/ძირი/.test(ctx) ? 'overdue' : null;
        if (key) vals.forEach((v, k) => { if (rows[k]) (rows[k] as any)[key] = v === '–' ? null : num(v); });
      }
      if (label) lastLabel = label;
    }
    for (const r of rows) if (r.month && (r.balance != null || r.principal != null)) out.push(r as ScheduleRow);
  }
  return out.sort((a, b) => b.month.localeCompare(a.month));
}

function parseContract(lines: Line[]): CreditContract {
  const raw = lines.map((l) => l.text).join('\n');
  const idM = raw.match(/სესხის იდენტიფიკატორი\s*:\s*([A-Z0-9-]{6,})/);
  const info = raw.slice(0, raw.indexOf('ძირითადი თარიღები') > 0 ? raw.indexOf('ძირითადი თარიღები') : 2000);
  const amt = (re: RegExp) => num(field(lines, re, isNum));
  const curField = field(lines, /^სესხის ვალუტა$/, (v) => CUR.test(v));
  const original = amt(/^(გაცემული სესხის მოცულობა|სესხის საწყისი თანხა|სესხის მოცულობა|ლიმიტი|საკრედიტო ლიმიტი)$/);
  const balance = amt(/^ნაშთი$/);
  const closedDate = date(field(lines, /^სესხის ფაქტობრივი დახურვის თარიღი$/, isDate));
  const status = field(lines, /^(კონტრაქტის სტატუსი|სტატუსი)$/, isText);
  const { type, label } = typeOf((field(lines, /^კონტრაქტის ქვეტიპი$/, isText) ?? '') + ' ' + info);
  const rateRaw = field(lines, /^(საპროცენტო განაკვეთი|წლიური საპროცენტო განაკვეთი|ეფექტური საპროცენტო განაკვეთი)$/, (v) => /\d/.test(v));
  const c: CreditContract = {
    externalId: idM?.[1] ?? null,
    creditor: field(lines, /^ორგანიზაცია$/, isText),
    type, typeLabel: label, status,
    active: !closedDate && (status ? /არსებული|მიმდინარე|active/i.test(status) || (balance ?? 0) > 0 : (balance ?? 0) > 0),
    currency: curField?.match(CUR)?.[1] ?? raw.match(CUR)?.[1] ?? 'GEL',
    originalAmount: original, balance,
    principalDue: amt(/^სესხის მიმდინარე გადასახდელი ძირითადი( თანხა)?$/),
    // only what the report states; 0 / missing means "not reported" (cards often have none)
    monthlyPayment: amt(/^სტანდარტული შენატანის ოდენობა$/) || amt(/^გრაფიკით განსაზღვრული მაქსიმალური შენატანი$/) || null,
    undrawn: amt(/^სესხის მიმდინარე აუთვისებელი თანხა$/),
    // recurring fee/insurance, only when the report lists one (overdue "commission" is not a monthly fee)
    monthlyFee: amt(/^(ყოველთვიური საკომისიო|ყოველთვიური მომსახურების საფასური|დაზღვევის (ყოველთვიური )?(თანხა|შენატანი|საფასური|პრემია)|ყოველთვიური დაზღვევა)$/) || null,
    interestRate: rateRaw ? num(rateRaw) : null,
    termMonths: amt(/^სესხის საკონტრაქტო ვადა \(თვეებში\)$/),
    startDate: date(field(lines, /^სესხის გაცემის თარიღი$/, isDate)),
    endDate: date(field(lines, /^სესხის დაფარვის თარიღი( საკონტრაქტო)?$/, isDate)),
    closedDate,
    nextPaymentDate: date(field(lines, /^ძირის შემდეგი გადახდის თარიღი$/, isDate)),
    overdueAmount: amt(/^ვადაგადაცილებული თანხა$/) ?? 0,
    overdueDays: amt(/^ვადაგადაცილებული დღეების რაოდენობა$/) ?? 0,
    maxOverdueDays: amt(/^მაქსიმალური ვადაგადაცილებული დღეების რაოდენობა$/) ?? 0,
    penalty: amt(/^ჯარიმის თანხა$/) ?? 0,
    installmentsTotal: amt(/^თავდაპირველი გრაფიკის განსაზღვრული შენატანების$/),
    installmentsLeft: amt(/^განუხორციელებელი შენატანების რაოდენობა$/),
    restructured: field(lines, /^რესტრუქტურიზაციის სტატუსი$/) === 'დიახ',
    schedule: parseSchedule(lines), missing: [], raw,
  };
  if (c.endDate == null && c.startDate && c.termMonths) { const [y, m, d] = c.startDate.split('-').map(Number); const e = new Date(Date.UTC(y, m - 1 + c.termMonths, d)); c.endDate = e.toISOString().slice(0, 10); }
  for (const k of ['creditor', 'originalAmount', 'startDate', 'termMonths'] as const) if (c[k] == null) c.missing.push(k);
  return c;
}

export function parseCreditReport(lines: Line[]): CreditReport {
  const full = lines.map((l) => l.text).join('\n');
  if (!/კრედიტინფო|creditinfo|საკრედიტო ქულა|სესხის იდენტიფიკატორი/i.test(full)) throw new NotCreditReport('This does not look like a Creditinfo Georgia report.');
  // summary
  let score: number | null = null, rating: string | null = null;
  for (let i = 0; i < lines.length && score == null; i++) if (/^საკრედიტო ქულა$/.test(norm(lines[i].text))) {
    for (let j = i - 1; j >= Math.max(0, i - 4); j--) { const c = cells(lines[j]); const n = c.find((x) => /^\d{1,4}$/.test(x)); if (n) { score = Number(n); break; } }
  }
  if (score == null) { const v = field(lines, /^(სქორინგი|საკრედიტო ქულა)$/, (x) => /^\d{1,4}$/.test(x)); score = v ? Number(v) : null; }
  for (const l of lines) { const c = cells(l).find((x) => /^[A-H][1-3]?$/.test(x)); if (c && /რეიტინგ/.test(full.slice(0, 20000))) { rating = c; break; } }
  const pdM = full.match(/(\d{1,2}[.,]\d{1,2})\s*%/);
  const factors: { code: string; description: string }[] = [];
  const fi = lines.findIndex((l) => /ქულაზე მოქმედი ფაქტორი\s+აღწერა/.test(l.text));
  if (fi >= 0) for (let j = fi + 1; j < Math.min(lines.length, fi + 30); j++) {
    if (/დამატებითი ინფორმაცია|კონტრაქტის შეჯამებული/.test(lines[j].text)) break;
    const c = cells(lines[j]);
    if (/^[A-Z]{2,5}\d{0,3}$/.test(c[0] ?? '')) factors.push({ code: c[0], description: c.slice(1).join(' ') || (cells(lines[j - 1] ?? lines[j]).join(' ')) });
    else if (factors.length && c.length && !/^\d/.test(c[0]) && j - fi < 25 && !/\/ \d+$/.test(lines[j].text)) { if (!c[0].match(/^[A-Z]/)) factors[factors.length - 1].description += (factors[factors.length - 1].description ? ' ' : '') + c.join(' '); }
    if (/დამატებითი ინფორმაცია|კონტრაქტის შეჯამებული/.test(lines[j].text)) break;
  }
  const amt = (re: RegExp) => num(field(lines, re, isNum));
  const summary: CreditSummary = {
    score, rating, defaultProbability: pdM ? num(pdM[1]) : null,
    reportDate: date(full.match(/(\d{2}\.\d{2}\.\d{4})\s+\d{2}:\d{2}/)?.[1]),
    activeContracts: amt(/^(ყველა მიმდინარე კონტრაქტი|მიმდინარე ოპერაციები)$/),
    closedContracts: amt(/^(შეწყვეტილი ოპერაციები|შეწყვეტილი კონტრაქტების რაოდენობა)$/),
    creditors: amt(/^კრედიტორების რაოდენობა$/),
    totalDebt: amt(/^(მიმდინარე ჯამური ვალდებულება|გადასახდელი თანხის ჯამი)$/),
    overdueAmount: amt(/^მიმდინარე ვადაგადაცილებული თანხა$/),
    monthlyPayments: amt(/^ყოველთვიური რეგულარული$/),
    inquiries12m: null, factors,
  };
  // contracts
  const contracts: CreditContract[] = []; let cur: Line[] | null = null;
  const stop = /^(ძიებები|ძიებების ისტორია|კავშირები|უზრუნველყოფა|სასამართლო)/;
  for (const l of lines) {
    if (/სესხის იდენტიფიკატორი\s*:/.test(l.text)) { if (cur) contracts.push(parseContract(cur)); cur = [l]; continue; }
    if (cur && stop.test(norm(l.text)) && cells(l).length <= 2) { contracts.push(parseContract(cur)); cur = null; continue; }
    if (cur && !/^\d+ \/ \d+$/.test(norm(l.text))) cur.push(l);
  }
  if (cur) contracts.push(parseContract(cur));
  // de-dup ids (a contract may be listed in several sections)
  const seen = new Set<string>(); const uniq = contracts.filter((c) => !c.externalId || (seen.has(c.externalId) ? false : (seen.add(c.externalId), true)));
  const warnings: string[] = [];
  if (!uniq.length) warnings.push('No contracts were recognised in this report.');
  if (summary.score == null) warnings.push('Credit score not found.');
  return { summary, contracts: uniq, warnings };
}
