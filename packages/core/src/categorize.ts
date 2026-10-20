/** Local-first transaction categorizer: merchant normalisation + regex rules + learned corrections. */

export interface CatRule { key: string; re: RegExp; kind?: 'income' | 'expense'; subscription?: boolean }
export interface CategorizeResult { key: string | null; categoryId: number | null; confidence: number; source: 'learned' | 'rule' | 'keyword' | 'none'; subscription: boolean }

const B = (s: string) => new RegExp(`(?:^|[^\\p{L}])(?:${s})`, 'iu');
export const MERCHANT_RULES: CatRule[] = [
  // income
  { key: 'salary', re: B('salary|payroll|ხელფას|wage|სახელფასო'), kind: 'income' },
  { key: 'freelance', re: B('upwork|fiverr|payoneer|toptal|deel'), kind: 'income' },
  { key: 'rental', re: B('rent income|ქირის შემოსავ|airbnb payout|booking\\.com payout'), kind: 'income' },
  { key: 'gifts', re: B('gift|საჩუქ'), kind: 'income' },
  // utilities
  { key: 'electricity', re: B('telasi|თელასი|te-energy|te energy|energo-?pro|ენერგო-?პრო|electric|ელექტრო|სილქნეტ ენერგ') },
  { key: 'gas', re: B('tbilisi energy|თბილისი ენერჯი|tbilisienergy|socar gas|სოკარ გაზ|gas supply|გაზი|kaztransgas|ყაზტრანსგაზ') },
  { key: 'water', re: B('gwp|georgian water|ჯორჯიან უოთერ|წყალ|water') },
  { key: 'internet', re: B('silknet|სილქნეტ|magti ?fiber|მაგთი ?ფაიბ|internet|ინტერნეტ|globaltv|global tv|akhali kselebi|ახალი ქსელები') },
  { key: 'phone', re: B('magti|მაგთი|cellfie|სელფი|beeline|ბილაინ|geocell|mobile top|ბალანსის შევსება') },
  // subscriptions
  { key: 'subscriptions', re: B('netflix|spotify|youtube ?premium|youtubepremium|apple\\.com|itunes|icloud|google ?(one|storage|play)|adobe|chatgpt|openai|microsoft ?365|xbox|playstation ?(plus|network)|disney|hbo|amazon prime|patreon|notion|canva|dropbox|github|midjourney|claude|anthropic|duolingo|yandex ?plus|megogo|imovies|adjarabet ?premium'), subscription: true },
  // groceries
  { key: 'groceries', re: B('carrefour|კარფურ|spar|სპარ|nikora|ნიკორა|goodwill|გუდვილ|agrohub|აგროჰაბ|fresco|ფრესკო|2 nabiji|ორი ნაბიჯი|smart(?![a-z])|სმარტ|europroduct|ევროპროდუქტ|libre|ლიბრე|market|მარკეტ|supermarket|სუპერმარკეტ|ori nabiji|daily market|magniti|მაგნიტი|zgapari|zghapari') },
  // food delivery / restaurants -> entertainment
  { key: 'entertainment', re: B('wolt|ვოლტ|glovo|გლოვო|restaurant|რესტორან|cafe|კაფე|coffee|ყავა|bar |pub|pizza|პიცა|mcdonald|kfc|burger|dunkin|starbucks|shaurma|შაურმა|cinema|კინო|amirani|ამირანი|cavea|კავეა|steam|epic games|concert|tkt\\.ge|biletebi|ticket') },
  // transport
  { key: 'transport', re: B('bolt|ბოლტ|yandex|იანდექს|uber|maxim|metro|მეტრო|ttc|bus|ავტობუს|metromoney|parking|პარკირ|gulf|გალფ|rompetrol|რომპეტროლ|wissol|ვისოლ|socar|სოკარ|lukoil|ლუკოილ|connect fuel|fuel|საწვავ|petrol|benzin|ბენზინ|railway|რკინიგზ|georgian airways|wizz|pegasus|turkish airlines|flydubai') },
  // health
  { key: 'health', re: B('aversi|ავერსი|psp|პსპ|gpc|ჯიპისი|pharmadepot|ფარმადეპო|pharmacy|აფთიაქ|clinic|კლინიკ|hospital|საავადმყოფ|dental|სტომატ|medi club|მედი კლუბ|evex|ევექსი|lab |ლაბორატ|synevo|gym|fitness|ფიტნეს') },
  // insurance
  { key: 'insurance', re: B('insurance|დაზღვევ|aldagi|ალდაგი|ardi|არდი|imedi l|იმედი ლ|gpi|tbc insurance|irao|ირაო') },
  // education
  { key: 'education', re: B('university|უნივერსიტ|school|სკოლ|course|კურს|udemy|coursera|skillshare|tutor|books?(?![a-z])|წიგნ|biblusi|ბიბლუსი|santa esperanza') },
  // shopping
  { key: 'shopping', re: B('zara|h&m|lc waikiki|lcw|defacto|koton|mango|amazon|aliexpress|temu|shein|ebay|zoommer|ზუმერ|alta|ალტა|elit electronics|ელიტ ელექტრონ|megatechnica|east point|ისთ ფოინთ|tbilisi mall|თბილისი მოლ|galleria|გალერეა|city mall|სითი მოლ|ikea|jysk|domino|დომინო|extra\\.ge|vendoo|mymarket|ss\\.ge') },
  // loans & rent
  { key: 'loans', re: B('loan|სესხ|credit repay|კრედიტის დაფარვ|installment|განვადებ|space ?bank') },
  { key: 'rent', re: B('rent|ქირა|mortgage|იპოთეკ') },
];

/** Strip noise: card masks, POS/terminal prefixes, dates, long digit runs, city/country codes. */
export function normalizeMerchant(desc: string): string {
  let s = desc.toLowerCase().normalize('NFKC');
  s = s.replace(/(?<!\p{L})(pos|purchase|payment|card|terminal|transaction|გადახდა|შენაძენი|ბარათი|ოპერაცია|ტრანზაქცია)(?!\p{L})[:\s-]*/giu, ' ');
  s = s.replace(/[*x]{2,}\d{2,4}|\d{4,}[*x]+\d*|\d{6,}/g, ' ');
  s = s.replace(/\d{1,2}[./-]\d{1,2}[./-]\d{2,4}(\s+\d{1,2}:\d{2}(:\d{2})?)?/g, ' ');
  s = s.replace(/(?<!\p{L})(tbilisi|თბილისი|batumi|ბათუმი|kutaisi|georgia|geo|ge|tb)(?!\p{L})/giu, ' ');
  s = s.replace(/(?<!\p{L})(gel|usd|eur|ლარი)(?!\p{L})/giu, ' ').replace(/[^\p{L}\p{N}&.\s-]/gu, ' ').replace(/\s+/g, ' ').trim();
  // keep first 3 meaningful tokens as merchant key
  return s.split(' ').filter((t) => t.length > 1 && !/^\d+([.,]\d+)?$/.test(t)).slice(0, 3).join(' ');
}

export function categorize(desc: string, kind: 'income' | 'expense', opts: { learned?: Map<string, number>; keyToId?: Map<string, number>; rules?: CatRule[] } = {}): CategorizeResult {
  const merchant = normalizeMerchant(desc);
  const learned = opts.learned?.get(merchant);
  const sub = /netflix|spotify|youtube|icloud|apple\.com|adobe|chatgpt|openai|subscription|გამოწერ/i.test(desc);
  if (learned) return { key: null, categoryId: learned, confidence: 0.98, source: 'learned', subscription: sub };
  for (const r of opts.rules ?? MERCHANT_RULES) {
    if (r.kind && r.kind !== kind) continue;
    if (!r.kind && kind === 'income' && r.key !== 'gifts') continue;
    if (r.re.test(desc) || r.re.test(merchant)) {
      return { key: r.key, categoryId: opts.keyToId?.get(r.key) ?? null, confidence: merchant.length > 2 ? 0.9 : 0.75, source: 'rule', subscription: !!r.subscription || sub };
    }
  }
  // weak keyword signals
  if (kind === 'income' && /transfer|გადმორიცხ|ჩარიცხ|deposit|შემოსავ/i.test(desc)) return { key: 'other_income', categoryId: opts.keyToId?.get('other_income') ?? null, confidence: 0.45, source: 'keyword', subscription: false };
  if (kind === 'expense' && /atm|cash withdrawal|განაღდ|ბანკომატ/i.test(desc)) return { key: 'other_expense', categoryId: opts.keyToId?.get('other_expense') ?? null, confidence: 0.5, source: 'keyword', subscription: false };
  return { key: null, categoryId: null, confidence: 0, source: 'none', subscription: sub };
}

/** Detect recurring merchants: >=2 occurrences, similar amounts, regular interval. */
export function detectRecurring(rows: { merchant: string; date: string; amount: number }[]) {
  const by = new Map<string, { date: string; amount: number }[]>();
  for (const r of rows) if (r.merchant) by.set(r.merchant, [...(by.get(r.merchant) ?? []), r]);
  const out: { merchant: string; count: number; avgAmount: number; intervalDays: number | null; cadence: 'weekly' | 'monthly' | 'irregular' }[] = [];
  for (const [merchant, list] of by) {
    if (list.length < 2) continue;
    const s = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const amts = s.map((x) => x.amount); const avg = amts.reduce((a, b) => a + b, 0) / amts.length;
    const similar = amts.every((a) => Math.abs(a - avg) <= Math.max(1, avg * 0.15));
    const gaps = s.slice(1).map((x, i) => (Date.parse(x.date) - Date.parse(s[i].date)) / 86400000);
    const gap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
    const cadence = gap && gap >= 25 && gap <= 35 ? 'monthly' : gap && gap >= 6 && gap <= 8 ? 'weekly' : 'irregular';
    if (similar && (cadence !== 'irregular' || list.length >= 3)) out.push({ merchant, count: list.length, avgAmount: Math.round(avg * 100) / 100, intervalDays: gap ? Math.round(gap) : null, cadence });
  }
  return out.sort((a, b) => b.avgAmount * b.count - a.avgAmount * a.count);
}
