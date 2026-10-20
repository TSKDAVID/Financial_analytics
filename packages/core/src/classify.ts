/**
 * Two-stage transaction classifier: first the KIND (what sort of money movement), then the CATEGORY.
 * Signals, strongest first: user-learned rules → structural facts from the bank (own name / own IBAN,
 * bank operation type) → scored keyword rules (whole-word, Georgian-aware, with negative keywords)
 * → MCC code → the bank's own merchant category → fallback. Every result carries a confidence and a "why".
 */
import { tokens, phrase, matchPhrase, normText, sameName, isPersonName, type Phrase } from './textnorm';

export const TX_KINDS = ['purchase', 'subscription', 'bill', 'topup', 'cash_withdrawal', 'cash_deposit', 'transfer_out', 'transfer_in', 'internal', 'exchange',
  'salary', 'income', 'loan_repayment', 'loan_disbursement', 'fee', 'interest', 'refund'] as const;
export type TxKind = (typeof TX_KINDS)[number];
/** Kinds that are not income or spending: moving your own money around. Posted as transfers, excluded from analytics. */
export const NON_PL_KINDS: TxKind[] = ['internal', 'exchange', 'loan_disbursement', 'cash_deposit'];
export const isNonPL = (k: string) => (NON_PL_KINDS as string[]).includes(k);
/** Kinds whose category is implied by the kind itself. */
const KIND_CATEGORY: Partial<Record<TxKind, string>> = { salary: 'salary', interest: 'interest_income', refund: 'refunds', cash_withdrawal: 'cash', fee: 'fees', loan_repayment: 'loans' };
const OUT_KINDS: TxKind[] = ['purchase', 'subscription', 'bill', 'topup', 'cash_withdrawal', 'transfer_out', 'loan_repayment', 'fee'];
const IN_KINDS: TxKind[] = ['cash_deposit', 'transfer_in', 'salary', 'income', 'loan_disbursement', 'interest', 'refund'];
export const kindDirection = (k: TxKind): 'in' | 'out' | 'both' => (OUT_KINDS.includes(k) ? 'out' : IN_KINDS.includes(k) ? 'in' : 'both');

export interface ClassifyInput {
  description: string; direction: 'income' | 'expense'; amount: number; currency?: string;
  opType?: string; merchant?: string; mcc?: string; counterparty?: string; counterpartyAccount?: string; purpose?: string; provider?: string; bankCategory?: string;
}
export interface ClassifyContext {
  ownerNames?: string[]; ownAccounts?: Set<string>;
  /** learned from user corrections: merchant key → kind/category (wins over everything) */
  learned?: Map<string, { kind?: TxKind | null; category?: string | null }>;
}
export interface Classification {
  kind: TxKind; category: string | null; confidence: number; source: 'learned' | 'structural' | 'rule' | 'mcc' | 'bank' | 'fallback' | 'ai';
  why: string; merchantKey: string; merchantName: string; subscription: boolean; counterpartyIsPerson: boolean; own: boolean;
}

interface Rule { id: string; kind?: TxKind; cat?: string; any: Phrase[]; not?: Phrase[]; dir?: 'in' | 'out'; w: number; on?: 'text' | 'merchant' | 'bankcat'; noMerchant?: boolean; sub?: boolean }
const R = (id: string, o: Omit<Rule, 'id' | 'any' | 'not'> & { any: string[]; not?: string[] }): Rule => ({ ...o, id, any: o.any.map(phrase), not: o.not?.map(phrase) });

/** KIND rules (bank wording for operations). */
export const KIND_RULES: Rule[] = [
  R('loan-card-repay', { kind: 'loan_repayment', any: ['ბარათის დასაფარად', 'credit card repayment'], dir: 'out', w: 0.98 }),
  R('loan-disburse', { kind: 'loan_disbursement', any: ['სესხის გაცემა', 'loan disbursement', 'loan issued'], dir: 'in', w: 0.97 }),
  R('loan-repay', { kind: 'loan_repayment', any: ['სესხის დაფარვა', 'ძირითადი თანხის დაფარვა', 'პროცენტის დაფარვა', 'განვადების დაფარვა', 'loan repayment', 'principal repayment', 'interest repayment'], dir: 'out', w: 0.95 }),
  R('fee-refund', { kind: 'refund', any: ['საკომისიოს დაბრუნება', 'fee refund'], dir: 'in', w: 0.96 }),
  R('exchange', { kind: 'exchange', any: ['კონვერტაცი*', 'ვალუტის გაცვლ*', 'გაცვლითი ოპერაცია', 'currency exchange', 'conversion', 'convert to virtual asset', 'convert from virtual asset', 'კურსით'], not: ['საბარათე სქემის'], noMerchant: true, w: 0.96 }),
  R('crypto', { kind: 'exchange', any: ['ვირტუალური აქტივ*', 'virtual asset', 'კრიპტოს ყიდვა', 'კრიპტოს გაყიდვა', 'crypto purchase', 'crypto sale'], w: 0.97 }),
  R('brokerage', { kind: 'internal', any: ['სავაჭრო ანგარიშიდან', 'სავაჭრო ანგარიშზე', 'brokerage account'], w: 0.95 }),
  R('tax', { kind: 'bill', cat: 'taxes', any: ['საჯარო რეესტრ*', 'public registry', 'იუსტიციის სახლ*', 'multifunctional', 'police', 'სახაზინო', 'საბიუჯეტო გადასახადი', 'სახელმწიფო ხაზინა', 'treasury', 'tax payment'], dir: 'out', w: 0.95 }),
  R('phone-instant', { kind: 'topup', cat: 'phone', any: ['მომენტალური ასახვით'], dir: 'out', w: 0.85 }),
  R('piggy', { kind: 'internal', any: ['ყულაბ*', 'piggy bank', 'ანაბარზე გადატანა'], w: 0.97 }),
  R('own-acct', { kind: 'internal', any: ['საკუთარ ანგარიშზე', 'საკუთარ ანგარიშებს შორის', 'transfer to own account', 'between own accounts', 'own account'], w: 0.96 }),
  R('deposit', { kind: 'internal', any: ['დეპოზიტზე თანხის', 'საანაბრე', 'ანაბრის შევსება', 'deposit for investments', 'სარეალიზაციო ანგარიშზე'], w: 0.95 }),
  R('overdraft', { kind: 'internal', any: ['ოვერდრაფტის დასაფარად', 'ავტომატური შეგროვება', 'არასანქცირებული დავალიანების დაფარვა'], w: 0.93 }),
  R('interest-in', { kind: 'interest', any: ['დარიცხული პროცენტ*', 'პროცენტის რეალიზაცია', 'interest earned', 'interest payment', 'interest capitalization'], dir: 'in', w: 0.95 }),
  R('cashback', { kind: 'refund', any: ['cashback*', 'ქეშბექ*', 'refund', 'reversal', 'თანხის დაბრუნება', 'ანაზღაურ*', 'დაბრუნება', 'chargeback'], dir: 'in', w: 0.92 }),
  R('salary', { kind: 'salary', any: ['salary', 'ხელფას*', 'სახელფასო', 'payroll', 'wage*'], dir: 'in', w: 0.95 }),
  R('goods-services', { kind: 'income', cat: 'freelance', any: ['pay for goods and services', 'invoice payment', 'upwork', 'payoneer', 'deel'], dir: 'in', w: 0.85 }),
  R('card-p2p', { kind: 'transfer_out', cat: 'p2p_out', any: ['p2p', 'egreve*', 'peertopeer', 'card to card'], on: 'merchant', dir: 'out', w: 0.97 }),
  R('cash-out', { kind: 'cash_withdrawal', any: ['განაღდება', 'atm cash', 'cash withdrawal', 'ბანკომატ*'], dir: 'out', w: 0.96 }),
  R('cash-in', { kind: 'cash_deposit', any: ['თანხის შეტანა', 'შემომტანი', 'cash deposit', 'cash in'], dir: 'in', w: 0.95 }),
  R('insurance-fee', { kind: 'fee', cat: 'insurance', any: ['სიცოცხლის დაზღვევა', 'დაზღვევის მართვის', 'loan insurance'], dir: 'out', w: 0.95 }),
  R('fee', { kind: 'fee', any: ['საკომისიო*', 'transaction fee', 'service fee', 'commission', 'monthly fee', 'annual fee'], not: ['დაბრუნება'], dir: 'out', w: 0.94 }),
  R('p2p-card', { kind: 'transfer_out', any: ['tbc p2p', 'peertopeer', 'peer to peer', 'p2p', 'თანხის გაგზავნა', 'card to card'], dir: 'out', w: 0.8 }),
  R('interbank-in', { kind: 'transfer_in', any: ['ბანკებს შორის', 'ეგრევე 24 7', 'instant transfer'], dir: 'in', w: 0.85 }),
  R('personal-transfer', { kind: 'transfer_out', any: ['პირადი გადარიცხვა*', 'private transfer', 'personal transfer'], dir: 'out', w: 0.8 }),
  R('personal-transfer-in', { kind: 'transfer_in', any: ['პირადი გადარიცხვა*', 'private transfer', 'personal transfer'], dir: 'in', w: 0.8 }),
  R('topup-transit', { kind: 'topup', cat: 'transport', any: ['სატრანსპორტო ბალანსის'], dir: 'out', w: 0.9 }),
];

/** CATEGORY rules: merchants and keywords (whole words; "*" = explicit stem). */
export const CAT_RULES: Rule[] = [
  // utilities (bill payments)
  R('electricity', { cat: 'electricity', any: ['telasi', 'თელასი', 'telmico', 'ტელმიკო', 'ep georgia', 'energo pro', 'ენერგო პრო', 'energopro', 'ელექტროენერგი*', 'electricity'], w: 0.92 }),
  R('gas', { cat: 'gas', any: ['tbilisi energy', 'თბილისი ენერჯი', 'tbilisienergy', 'kaztransgas', 'ყაზტრანსგაზ*', 'socar gas', 'სოკარ გაზ*', 'gas supply', 'ბუნებრივი აირ*', 'გაზი', 'gas'], w: 0.92 }),
  R('water', { cat: 'water', any: ['gwp', 'georgian water', 'ჯორჯიან უოთერ', 'წყალმომარაგებ*', 'water supply', 'წყლის'], w: 0.92 }),
  R('cleaning', { cat: 'utilities', any: ['dasuftaveba', 'დასუფთავებ*', 'cleaning fee'], w: 0.9 }),
  R('phone', { cat: 'phone', any: ['ტელეფონის ნომერი', 'magti', 'მაგთი', 'magticom', 'მაგთიკომ*', 'cellfie', 'სელფი', 'geocell', 'ჯეოსელი', 'beeline', 'ბილაინ*', 'unlimited internet', 'ულიმიტო პაკეტ*', 'პაკეტის გადასახადი', 'account refill', 'ბალანსის შევსება', 'meti s', 'mobile top up'], w: 0.9 }),
  R('internet', { cat: 'internet', any: ['silknet', 'სილქნეტ*', 'magtifiber', 'magti fiber', 'globaltv', 'akhali kselebi', 'ახალი ქსელები'], not: ['ტელეფონის ნომერი', 'ჯეოსელი', 'silknet account', 'meti s', 'unlimited internet'], w: 0.85 }),
  // subscriptions
  R('subs', { cat: 'subscriptions', sub: true, any: ['spotify', 'netflix', 'youtube premium', 'youtubepremium', 'icloud', 'apple com bill', 'adobe', 'chatgpt', 'openai', 'microsoft 365', 'google one', 'google storage', 'lightroom', 'envato', 'github', 'canva', 'notion', 'dropbox', 'patreon', 'duolingo', 'megogo', 'disney', 'hbo', 'amazon prime', 'claude', 'anthropic', 'midjourney', 'xbox game pass', 'playstation plus'], w: 0.93 }),
  // groceries
  R('groceries', { cat: 'groceries', any: ['carrefour', 'კარფურ*', 'nikora', 'ნიკორა', 'spar', 'სპარ', 'goodwill', 'გუდვილ*', 'agrohub', 'აგროჰაბ*', 'fresco', 'ფრესკო', 'ori nabiji', '2 nabiji', 'ორი ნაბიჯი', 'europroduct', 'ევროპროდუქტ*', 'libre', 'ლიბრე', 'magniti', 'მაგნიტი', 'daily', 'zgapari', 'smart', 'სმარტ*', 'supermarket*', 'სუპერმარკეტ*', 'minimarket', 'მარკეტ*', 'market', 'products', 'პროდუქტ*', 'სურსათ*'], not: ['mymarket', 'apple market', 'google market', 'play market'], w: 0.88 }),
  // cafes, restaurants, snacks
  R('dining', { cat: 'dining', any: ['vending', 'gvg', 'glovoapp', 'woltapp', 'beanbot', 'grupgvg', 'kfc', 'mcdonald*', 'wolt', 'ვოლტ*', 'glovo', 'გლოვო', 'restaurant*', 'რესტორან*', 'cafe', 'caffe', 'კაფე', 'coffee*', 'mycoffee', 'ყავ*', 'backery', 'bar', 'pub', 'pizza*', 'pizzeria', 'პიცა', 'burger*', 'dunkin', 'starbucks', 'shaurma', 'შაურმა', 'საცხობ*', 'sacxobi', 'bakery', 'khinkali', 'ხინკალ*', 'subway', 'dominos', 'saubari', 'food'], not: ['bolt food courier'], w: 0.86 }),
  // transport
  R('transport', { cat: 'transport', any: ['bolt', 'ბოლტ*', 'yandex go', 'yandex', 'იანდექს*', 'uber', 'maxim', 'metro', 'მეტრო*', 'ავტობუს*', 'მიკროავტობუს*', 'საბაგირო', 'ttc', 'tbctpmtr', 'tbctpmin', 'scooter*', 'scooterre', 'jetshr', 'jet sharing', 'qbaride', 'flixbus', 'tre ge', 'railway', 'რკინიგზ*', 'parking', 'პარკირ*', 'gulf', 'გალფ*', 'rompetrol', 'wissol', 'ვისოლ*', 'socar', 'lukoil', 'connect', 'fuel', 'საწვავ*', 'ბენზინ*', 'taxi', 'ტაქს*', 'metromoney'], not: ['bolt food', 'yandex plus', 'yandex eda', 'socar gas', 'yandex market'], w: 0.88 }),
  R('travel', { cat: 'travel', any: ['booking com', 'airbnb', 'hotel*', 'სასტუმრო', 'hostel', 'wizz', 'wizzair', 'pegasus', 'turkish airlines', 'georgian airways', 'flydubai', 'ryanair', 'airline*', 'aviabilet*'], w: 0.88 }),
  // health
  R('health', { cat: 'health', any: ['aversi', 'ავერსი', 'psp', 'პსპ', 'gpc', 'ჯიპისი', 'pharmadepot', 'ფარმადეპო', 'pharmacy', 'აფთიაქ*', 'clinic*', 'კლინიკ*', 'hospital', 'საავადმყოფ*', 'dental', 'სტომატ*', 'evex', 'ევექს*', 'synevo', 'medi club', 'gym', 'fitness', 'ფიტნეს*'], w: 0.88 }),
  R('insurance', { cat: 'insurance', any: ['insurance', 'დაზღვევ*', 'aldagi', 'ალდაგი', 'ardi', 'არდი', 'irao', 'ირაო', 'imedi l'], w: 0.88 }),
  // education
  R('education', { cat: 'education', any: ['university', 'უნივერსიტეტ*', 'school', 'სკოლ*', 'course*', 'კურს*', 'udemy', 'coursera', 'გამოცდ*', 'exam*', 'tutor', 'biblus', 'ბიბლუს*', 'book*', 'წიგნ*', 'santa esperanza', 'სასწავლ*', 'სწავლის'], not: ['კურსით', 'კურსი ჯი', 'booking'], w: 0.88 }),
  // entertainment
  R('entertainment', { cat: 'entertainment', any: ['gaming', 'game lounge', 'arena', 'cybershoke', 'brawl stars', 'clash royale', 'supercell', 'steam', 'epic games', 'playstation', 'cinema', 'კინო*', 'cavea', 'კავეა', 'amirani', 'tkt ge', 'biletebi', 'ticket*', 'concert', 'museum', 'მუზეუმ*', 'bowling', 'quest'], w: 0.86 }),
  // shopping
  R('shopping', { cat: 'shopping', any: ['zara', 'h m', 'lc waikiki', 'lcw', 'defacto', 'koton', 'mango', 'amazon', 'aliexpress', 'temu', 'shein', 'ebay', 'zoommer', 'ზუმერ*', 'alta', 'ალტა', 'elit electronics', 'east point', 'tbilisi mall', 'city mall', 'galleria', 'ikea', 'jysk', 'miniso', 'მინისო', 'mymarket', 'extra ge', 'shopify', 'boxet', 'boxette', 'barber*', 'beauty', 'salon', 'vendoo', 'pepco', 'sinsay', 'sports', 'decathlon', 'nike', 'adidas'], w: 0.86 }),
  R('rent', { cat: 'rent', any: ['ქირა', 'ქირის', 'ბინის ქირა', 'rent', 'იპოთეკ*', 'mortgage'], w: 0.9 }),
  R('gifts', { cat: 'gifts', any: ['საჩუქ*', 'gift', 'დაბადების დღე*', 'birthday'], w: 0.75 }),
];

/** MCC → category (ISO 18245, common codes). */
export function mccCategory(mcc?: string): { cat: string; kind?: TxKind } | null {
  if (!mcc) return null; const m = Number(mcc);
  const tbl: [number, number, string, TxKind?][] = [
    [5411, 5411, 'groceries'], [5422, 5422, 'groceries'], [5441, 5441, 'groceries'], [5451, 5451, 'groceries'], [5499, 5499, 'groceries'],
    [5811, 5814, 'dining'], [5462, 5462, 'dining'], [4111, 4112, 'transport'], [4121, 4121, 'transport'], [4131, 4131, 'transport'], [4784, 4789, 'transport'], [5541, 5542, 'transport'], [7523, 7523, 'transport'], [5172, 5172, 'transport'],
    [3000, 3350, 'travel'], [4511, 4511, 'travel'], [4722, 4722, 'travel'], [3501, 3999, 'travel'], [7011, 7011, 'travel'],
    [4814, 4814, 'phone', 'topup'], [4899, 4899, 'internet'], [4900, 4900, 'utilities', 'bill'],
    [5912, 5912, 'health'], [8011, 8099, 'health'], [7997, 7997, 'health'],
    [5815, 5815, 'subscriptions', 'subscription'], [5817, 5818, 'subscriptions', 'subscription'], [5816, 5816, 'entertainment'], [5734, 5734, 'subscriptions', 'subscription'], [7372, 7372, 'subscriptions', 'subscription'], [7399, 7399, 'subscriptions', 'subscription'], [7832, 7832, 'entertainment'], [7991, 7999, 'entertainment'], [7922, 7922, 'entertainment'],
    [5942, 5943, 'education'], [8211, 8299, 'education'],
    [5300, 5399, 'shopping'], [5600, 5699, 'shopping'], [5700, 5733, 'shopping'], [5940, 5941, 'shopping'], [5944, 5999, 'shopping'], [5200, 5299, 'shopping'], [5045, 5045, 'shopping'],
    [6300, 6399, 'insurance'], [9211, 9402, 'taxes', 'bill'], [7311, 7311, 'shopping'], [7230, 7230, 'shopping'], [7298, 7298, 'health'], [5039, 5039, 'shopping'], [5169, 5169, 'shopping'], [4215, 4215, 'shopping'],
    [6011, 6011, 'cash', 'cash_withdrawal'], [6010, 6010, 'cash', 'cash_withdrawal'], [6012, 6012, 'p2p_out', 'transfer_out'], [6538, 6540, 'p2p_out', 'transfer_out'], [4829, 4829, 'p2p_out', 'transfer_out'],
  ];
  const hit = tbl.find(([a, b]) => m >= a && m <= b);
  return hit ? { cat: hit[2], kind: hit[3] } : null;
}

/** TBC prints its own merchant category in Georgian. */
const BANK_CATS: [Phrase, string][] = ([['სასურსათო მაღაზიები', 'groceries'], ['რესტორანი', 'dining'], ['ბარი', 'dining'], ['ტრანსპორტი', 'transport'], ['მოგზაურობა', 'transport'],
  ['საყიდლები', 'shopping'], ['გართობა', 'entertainment'], ['ჯანმრთელობა', 'health'], ['სილამაზე', 'shopping'], ['განათლება', 'education'], ['კომუნალური გადახდები', 'utilities']] as [string, string][]).map(([p, c]) => [phrase(p), c]);

const GENERIC = new Set(['ltd', 'llc', 'shps', 'ss', 'sps', 'georgia', 'tbilisi', 'tbilisis', 'tb', 'ge', 'eu', 'o', 'com', 'gel', 'usd', 'eur', 'pos', 'payment', 'tbc', 'the', 'i', 'm', 'sakartvelo', 'grup', 'group']);
/** Display name for the merchant / counterparty. */
export function merchantDisplay(i: Pick<ClassifyInput, 'merchant' | 'counterparty' | 'description' | 'provider'>): string {
  const m = i.merchant?.trim();
  if (m) return m.replace(/\*.*$/, (x) => (x.length > 3 && /^\*[A-Z0-9]{6,}/.test(x) ? '' : x)).replace(/[/]O[/]\d+/i, '').replace(/\b(LTD|LLC|L\.L\.C\.)\b\.?/gi, '').replace(/[\s,]+$/, '').replace(/^["'„]+|["'“]+$/g, '').trim() || m;
  if (i.counterparty) return i.counterparty.trim();
  return i.description.replace(/\s{2,}/g, ' ').slice(0, 60);
}
/** Stable merchant key for learning/caching: folded tokens without generic words or numbers. */
export function merchantKeyOf(name: string): string {
  return tokens(name).filter((t) => !GENERIC.has(t) && !/^\d+$/.test(t) && t.length > 1).slice(0, 3).join(' ');
}

export function classify(input: ClassifyInput, ctx: ClassifyContext = {}): Classification {
  const dir = input.direction === 'income' ? 'in' : 'out';
  const name = merchantDisplay(input);
  const isPerson = !input.merchant && isPersonName(input.counterparty);
  const own = !!(input.counterparty && ctx.ownerNames?.some((n) => sameName(n, input.counterparty))) || !!(input.counterpartyAccount && ctx.ownAccounts?.has(input.counterpartyAccount));
  // key: merchant for card payments, person/company name for transfers, else the operation wording
  const mkey = merchantKeyOf(input.merchant ? name : input.counterparty ?? input.opType ?? name) || merchantKeyOf(input.description);
  const text = [input.opType, input.description, input.purpose, input.merchant, input.provider].filter(Boolean).join(' ; ');
  const tk = tokens(text); const mtk = tokens([input.merchant, input.provider, input.counterparty].filter(Boolean).join(' ; '));
  // card payments: category keywords are read from the merchant name only, never from the street address
  const ctk = input.merchant && input.mcc ? tokens([input.merchant, input.provider, input.purpose].filter(Boolean).join(' ; ')) : tk;
  const bctk = input.bankCategory ? tokens(input.bankCategory) : [];
  const fits = (r: Rule, toks: string[]) => (!r.dir || r.dir === dir) && (!r.noMerchant || !input.merchant) && r.any.some((p) => matchPhrase(toks, p)) && !(r.not ?? []).some((p) => matchPhrase(tk, p));
  const hit = (r: Rule, toks: string[]) => r.any.find((p) => matchPhrase(toks, p))?.src ?? '';
  const done = (kind: TxKind, category: string | null, confidence: number, source: Classification['source'], why: string, sub = false): Classification =>
    ({ kind, category: isNonPL(kind) ? null : category, confidence: Math.round(confidence * 100) / 100, source, why, merchantKey: mkey, merchantName: name, subscription: sub || kind === 'subscription', counterpartyIsPerson: isPerson, own });

  // 1. user corrections
  const l = ctx.learned?.get(mkey);
  if (l && (l.kind || l.category)) {
    const base = classify(input, { ...ctx, learned: undefined });
    return { ...done((l.kind ?? base.kind) as TxKind, l.category ?? base.category, 1, 'learned', `your rule for "${mkey}"`, base.subscription) };
  }

  // 2. kind
  let kind: TxKind | null = null; let kconf = 0; let kwhy = ''; let kcat: string | undefined; let ksrc: Classification['source'] = 'rule';
  for (const r of KIND_RULES) if (r.w > kconf && fits(r, tk)) { kind = r.kind!; kconf = r.w; kwhy = `${r.id}: "${hit(r, tk)}"`; kcat = r.cat; }
  if (own && kconf < 0.97 && !(kind && ['salary', 'loan_disbursement', 'exchange', 'cash_deposit', 'loan_repayment'].includes(kind))) { kind = 'internal'; kconf = 0.97; kwhy = input.counterpartyAccount && ctx.ownAccounts?.has(input.counterpartyAccount) ? 'own account (IBAN)' : 'counterparty is you'; ksrc = 'structural'; kcat = undefined; }
  const mccInfo = mccCategory(input.mcc);
  if (!kind && mccInfo?.kind && mccInfo.kind !== 'subscription' && kindDirection(mccInfo.kind) === dir) { kind = mccInfo.kind; kconf = 0.85; kwhy = `MCC ${input.mcc}`; ksrc = 'mcc'; }
  if (!kind && /სერვისი/.test(input.opType ?? '')) { kind = 'bill'; kconf = 0.8; kwhy = 'pay-service bill'; ksrc = 'structural'; }
  if (!kind && input.counterparty && !input.merchant) { kind = dir === 'out' ? 'transfer_out' : 'transfer_in'; kconf = isPerson ? 0.85 : 0.6; kwhy = isPerson ? 'transfer to/from a person' : 'transfer'; ksrc = 'structural'; }
  if (!kind && input.merchant) { kind = dir === 'out' ? 'purchase' : 'refund'; kconf = dir === 'out' ? 0.85 : 0.6; kwhy = dir === 'out' ? 'card payment at a merchant' : 'credit from a merchant'; ksrc = 'structural'; }
  if (!kind) { kind = dir === 'out' ? 'purchase' : 'income'; kconf = 0.35; kwhy = 'no signal'; ksrc = 'fallback'; }
  if (isNonPL(kind)) return done(kind, null, kconf, ksrc, kwhy);

  // 3. category
  let cat: string | null = kcat ?? KIND_CATEGORY[kind] ?? null; let cconf = cat ? kconf : 0; let cwhy = ''; let csrc: Classification['source'] = ksrc; let sub = false;
  const isTransfer = kind === 'transfer_out' || kind === 'transfer_in';
  const allowed = (r: Rule) => !isTransfer || (isPerson ? ['rent', 'gifts'] : ['rent', 'gifts', 'education', 'insurance', 'health']).includes(r.cat!);
  if (!cat || kind === 'fee') {
    let best: Rule | null = null; let bestWhere = '';
    // earliest match in the merchant name wins ("KFC 001 Goodwill" is KFC), then rule weight
    let bestPos = Infinity;
    const pos = (r: Rule, toks: string[]) => { let m = Infinity; for (const p of r.any) for (let i = 0; i < toks.length; i++) if (i < m && matchPhrase(toks.slice(i, i + p.toks.length), p)) m = i; return m; };
    for (const r of CAT_RULES) {
      if (!allowed(r)) continue;
      if (fits(r, mtk)) { const p = pos(r, mtk); if (p < bestPos || (p === bestPos && (!best || r.w > best.w))) { best = r; bestPos = p; bestWhere = hit(r, mtk); } }
      else if (bestPos === Infinity && fits(r, ctk) && (!best || r.w - 0.03 > best.w)) { best = { ...r, w: r.w - 0.03 }; bestWhere = hit(r, ctk); }
    }
    if (best && (kind !== 'fee' || best.cat === 'insurance')) { cat = best.cat!; cconf = best.w; cwhy = `${best.id}: "${bestWhere}"`; csrc = 'rule'; sub = !!best.sub; }
  }
  if (!cat && !isTransfer && mccInfo && !['cash', 'p2p_out'].includes(mccInfo.cat)) { cat = mccInfo.cat; cconf = 0.8; cwhy = `MCC ${input.mcc}`; csrc = 'mcc'; }
  if (!cat && !isTransfer && bctk.length) { const b = BANK_CATS.find(([p]) => matchPhrase(bctk, p)); if (b) { cat = b[1]; cconf = 0.72; cwhy = `bank category "${input.bankCategory}"`; csrc = 'bank'; } }
  if (!cat && kind === 'transfer_out') { cat = 'p2p_out'; cconf = isPerson ? 0.85 : 0.6; cwhy = isPerson ? 'money sent to a person' : 'outgoing transfer'; }
  if (!cat && kind === 'transfer_in') { cat = 'p2p_in'; cconf = isPerson ? 0.85 : 0.6; cwhy = isPerson ? 'money from a person' : 'incoming transfer'; }
  if (!cat && kind === 'income') { cat = 'other_income'; cconf = 0.4; }
  if ((sub || (mccInfo?.kind === 'subscription' && cat === 'subscriptions')) && kind === 'purchase') kind = 'subscription';
  if (kind === 'purchase' && cat && ['phone'].includes(cat) && (input.mcc === '4814' || /სერვისი/.test(input.opType ?? ''))) kind = 'topup';
  if (kind === 'bill' && cat === 'phone') kind = 'topup';
  // overall confidence = weakest link (kind × category)
  const conf = cat ? Math.min(kconf, cconf) : Math.min(kconf, 0.4);
  const why = [kwhy, cwhy].filter(Boolean).join(' · ') || 'fallback';
  return done(kind, cat, conf, cat ? (csrc === 'rule' || csrc === 'mcc' || csrc === 'bank' ? csrc : ksrc) : ksrc, why, sub);
}

/** Build learned-rule key from free text (used when a user corrects a row). */
export const learnKey = (merchantKey: string) => merchantKey;
export { normText };
