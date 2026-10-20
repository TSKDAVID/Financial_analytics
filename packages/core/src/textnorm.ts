/**
 * Georgian-aware text normalisation for matching.
 * - NFKC + case folding
 * - Georgian (Mkhedruli) → Latin transliteration
 * - a phonetic fold so that national romanisation ("tskhaltubo"), Georgian typed on a Latin keyboard
 *   ("sacxobi") and English spellings meet on one key
 * Patterns are matched token by token (whole words). A trailing "*" in a pattern token means "word starts with"
 * and is only used for explicit Georgian stems (e.g. "ხელფას*"), never for short prefixes.
 */
const KA: Record<string, string> = {
  'ა': 'a', 'ბ': 'b', 'გ': 'g', 'დ': 'd', 'ე': 'e', 'ვ': 'v', 'ზ': 'z', 'თ': 't', 'ი': 'i', 'კ': 'k', 'ლ': 'l', 'მ': 'm', 'ნ': 'n', 'ო': 'o', 'პ': 'p',
  'ჟ': 'zh', 'რ': 'r', 'ს': 's', 'ტ': 't', 'უ': 'u', 'ფ': 'p', 'ქ': 'k', 'ღ': 'gh', 'ყ': 'q', 'შ': 'sh', 'ჩ': 'ch', 'ც': 'ts', 'ძ': 'dz', 'წ': 'ts',
  'ჭ': 'ch', 'ხ': 'kh', 'ჯ': 'j', 'ჰ': 'h', 'ჱ': 'e', 'ჲ': 'i', 'ჳ': 'u', 'ჴ': 'kh', 'ჵ': 'o',
};
/** Mkhedruli → Latin (national system, simplified). */
export function translit(s: string): string { let o = ''; for (const ch of s) o += KA[ch] ?? ch; return o; }
/** Phonetic fold applied after transliteration (both to text and to patterns). */
function fold(s: string): string {
  return s.replace(/tch|ch/g, 'c').replace(/ts|tz/g, 'c').replace(/kh/g, 'x').replace(/sh/g, 's').replace(/zh/g, 'j').replace(/dz/g, 'z').replace(/gh/g, 'r')
    .replace(/ph/g, 'p').replace(/th/g, 't').replace(/w/g, 'v').replace(/y/g, 'i').replace(/q/g, 'k').replace(/(.)\1+/g, '$1');
}
export function normText(s: string): string { return fold(translit(s.normalize('NFKC').toLowerCase())); }
/** Whole-word tokens of the normalised text. */
export function tokens(s: string): string[] { return normText(s).split(/[^a-z0-9]+/).filter(Boolean); }

export interface Phrase { toks: { t: string; prefix: boolean }[]; src: string }
export function phrase(p: string): Phrase {
  const parts = p.trim().split(/\s+/).map((w) => ({ w, prefix: w.endsWith('*') }));
  const toks = parts.flatMap(({ w, prefix }) => { const t = tokens(w.replace(/\*$/, '')); return t.map((x, i) => ({ t: x, prefix: prefix && i === t.length - 1 })); });
  return { toks, src: p };
}
/** True when the phrase occurs as consecutive whole tokens. */
export function matchPhrase(toks: string[], p: Phrase): boolean {
  const n = p.toks.length; if (!n) return false;
  outer: for (let i = 0; i + n <= toks.length; i++) {
    for (let j = 0; j < n; j++) { const q = p.toks[j]; const t = toks[i + j]; if (q.prefix ? !t.startsWith(q.t) : t !== q.t) continue outer; }
    return true;
  }
  return false;
}
const ORG = /(^|\s)(shps|ss|sps|sip|ltd|llc|inc|jsc|i m|im|bank|banki|gmbh|corp|company)(\s|$)/;
/** Comparable person/company name: tokens sorted, legal-form words removed ("ი/მ დავით წყაბელია" ≡ "Tskabelia Davit"). */
export function nameKey(s: string): string {
  return tokens(s).filter((t) => !['i', 'm', 'shps', 'sps', 'ss', 'ltd', 'llc', 'sip', 'jsc', 'individualuri', 'mecarme', 'ie', 'pe', 'p', 'e'].includes(t)).sort().join(' ');
}
export function sameName(a?: string | null, b?: string | null): boolean { if (!a || !b) return false; const x = nameKey(a), y = nameKey(b); return !!x && x === y; }
/** Heuristic: looks like a private person ("Name Surname"), not a company or bank account. */
export function isPersonName(s?: string | null): boolean {
  if (!s) return false;
  if (/["„“«»]|შპს|სს |ს\.ს|სსიპ|ბანკ|ანგარიშ|სატრანზიტ|საკომისიო|დებიტორ|LTD|LLC|Bank|BANK|Account|Ltd|თანხები|სესხ|დარიცხ|ხარჯ|\d/.test(s)) return false;
  const w = s.trim().split(/\s+/);
  return w.length >= 2 && w.length <= 4 && w.every((x) => /^[\p{L}-]{2,}$/u.test(x)) && !ORG.test(normText(s));
}

const GEO_NOT_PERSON = /მეტრო|ავტობუს|საბაგირ|მარკეტ|აფთიაქ|კაფე|რესტორ|მაღაზი|ცენტრ|სერვის|კლინიკ|სალონ|ბარი|ჰოსტელ|სასტუმრ/;
/** A bare Georgian "Surname Name" ("უბილავა ლულა") printed where a merchant would be: a person, not a shop.
 *  Genitive place names ("თბილისის მეტრო") and shop words are excluded. */
export function isBarePersonName(s?: string | null): boolean {
  const x = s?.trim() ?? '';
  return /^[\u10D0-\u10FF]{2,}(?:-[\u10D0-\u10FF]{2,})?\s+[\u10D0-\u10FF]{2,}(?:-[\u10D0-\u10FF]{2,})?$/.test(x) && isPersonName(x) && !/ის(\s|$)/.test(x) && !GEO_NOT_PERSON.test(x);
}
