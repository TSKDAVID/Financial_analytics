import type { Line } from '../statements/lines';

/**
 * Card / loan key-terms documents ("მიმდინარე მნიშვნელოვანი პირობები"). Liberty Bank "Top Card" first; the patterns are
 * generic enough for similar Georgian key-facts sheets. Only product terms are extracted — no personal data.
 */
export interface CardTerms {
  bank: string | null; product: string | null; currency: string;
  creditLimit: number | null; rateType: 'fixed' | 'variable' | null;
  /** Annual rate when the recommended payment is paid (often 0% grace) vs when only the minimum is paid. */
  rateRecommended: number | null; rateMinimum: number | null;
  effectiveRecommended: number | null; effectiveMinimum: number | null;
  minPayment: number | null; cashFeePct: number | null; cashFeeMin: number | null;
  lateFeeOnce: number | null; lateFeeDailyPct: number | null; contractEnd: string | null; warnings: string[];
}
const n = (s: string | undefined) => (s == null ? null : Number(s.replace(/,/g, '')));
const RECO = 'რეკომენდებული\\s+გადასახად\\(ებ\\)ის\\s+გადახდის\\s+შემთხვევაში';
const MINI = 'მინიმალური\\s+გადასახად\\(ებ\\)ის\\s+გადახდის\\s+შემთხვევაში';

export function parseCardTerms(lines: Line[]): CardTerms {
  const text = lines.map((l) => l.text).join('\n').replace(/[ \t]+/g, ' ');
  const flat = text.replace(/\s*\n\s*/g, ' ');
  const section = (from: RegExp, to: RegExp) => { const i = flat.search(from); if (i < 0) return ''; const rest = flat.slice(i); const j = rest.slice(10).search(to); return j < 0 ? rest : rest.slice(0, j + 10); };
  const pctAfter = (s: string, what: string) => n(s.match(new RegExp(`${what}\\s*[-–]\\s*([\\d.,]+)\\s*%`))?.[1]);
  const annual = section(/წლიური საპროცენტო განაკვეთი:/, /ეფექტური საპროცენტო განაკვეთი/);
  const effective = section(/ეფექტური საპროცენტო განაკვეთი:/, /მაქსიმალური ეფექტური|ფინანსური ხარჯები/);
  const w: string[] = [];
  const end = flat.match(/ხელშეკრულების მოქმედების ვადა:\s*(\d{2})[/.](\d{2})[/.](\d{4})/);
  const t: CardTerms = {
    bank: /ტოპ ქარდ|ლიბერთი|Liberty/i.test(flat) ? 'Liberty Bank' : /თიბისი|TBC/.test(flat) ? 'TBC Bank' : /საქართველოს ბანკი|Bank of Georgia/.test(flat) ? 'Bank of Georgia' : null,
    product: /ტოპ ქარდ/.test(flat) ? 'Top Card' : null,
    currency: /ლარი/.test(flat) ? 'GEL' : /USD|აშშ დოლარი/.test(flat) ? 'USD' : 'GEL',
    creditLimit: n(flat.match(/(?:განვადების|საკრედიტო)\s+ლიმიტი:\s*([\d,.]+)\s*ლარი/)?.[1]),
    rateType: /განაკვეთის ტიპი:\s*ფიქსირებული/.test(flat) ? 'fixed' : /განაკვეთის ტიპი:\s*ცვლად/.test(flat) ? 'variable' : null,
    rateRecommended: pctAfter(annual, RECO), rateMinimum: pctAfter(annual, MINI),
    effectiveRecommended: pctAfter(effective, RECO), effectiveMinimum: pctAfter(effective, MINI),
    minPayment: n(flat.match(/მინიმალური გადასახადი\s*[-–]\s*([\d.,]+)\s*ლარი/)?.[1]),
    cashFeePct: n(flat.match(/განაღდების საკომისიო:\s*([\d.,]+)\s*%/)?.[1]),
    cashFeeMin: n(flat.match(/განაღდების საკომისიო:\s*[\d.,]+\s*%,\s*მინიმუმ\s*([\d.,]+)/)?.[1]),
    lateFeeOnce: n(flat.match(/ერთჯერადად\s*([\d.,]+)\s*ლარი/)?.[1]),
    lateFeeDailyPct: n(flat.match(/ვადაგადაცილებული თანხის\s*([\d.,]+)\s*%\s*ყოველ/)?.[1]),
    contractEnd: end ? `${end[3]}-${end[2]}-${end[1]}` : null, warnings: w,
  };
  if (t.rateRecommended == null && t.rateMinimum == null) w.push('Interest rates were not found in this document — check them manually.');
  if (t.creditLimit == null) w.push('Credit limit not found.');
  if (!t.bank) w.push('Bank not recognised.');
  return t;
}
