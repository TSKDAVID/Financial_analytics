import { tokens } from './textnorm';
import { normalizeMerchantName } from './classify';

/** Words that never identify a merchant: places, shop types, legal forms, filler. */
const NOISE_WORDS = ['shopping', 'shoping', 'center', 'centre', 'centr', 'mall', 'store', 'shop', 'branch', 'filiali', 'tbilisi', 'tbilis', 'batumi', 'kutaisi', 'rustavi', 'georgia', 'geo', 'ge', 'ltd', 'llc', 'jsc', 'inc', 'shps', 'ss', 'the', 'and', 'com', 'www', 'pos', 'payment', 'gadakhda', 'obieqti', 'branch', 'n', 'no', 'market', 'supermarket', 'hypermarket'];
const NOISE = new Set(NOISE_WORDS.flatMap((w) => [w, ...tokens(w)]));
/** "WIZZ AIR0000000JIPSQY" → ["wizz","air"]: cut glued booking codes, drop numbers and noise. */
export function merchantTokens(raw: string): string[] {
  const s = normalizeMerchantName(raw).replace(/([A-Za-z]{2,})(\d{3,}[A-Za-z0-9]*)/g, '$1 ').replace(/\b[A-Z0-9]*\d[A-Z0-9]{4,}\b/g, ' ');
  const t = tokens(s).filter((t) => t.length > 1 && !/\d/.test(t) && !NOISE.has(t));
  return (t.length ? t : tokens(s).filter((x) => !/\d/.test(x))).slice(0, 3);
}
export const canonicalMerchantKey = (raw: string) => merchantTokens(raw).join(' ');

function lev(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const sameTok = (a: string, b: string) => a === b || (a.length >= 6 && b.length >= 6 && lev(a, b) <= 1);
/** Same merchant? first word agrees (≥4 letters, typo-tolerant) and one name's words are contained in the other's. */
export function sameMerchant(a: string, b: string): boolean {
  const x = a.split(' ').filter(Boolean), y = b.split(' ').filter(Boolean);
  if (!x.length || !y.length || !sameTok(x[0], y[0]) || x[0].length < 4) return false;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return s.every((t) => l.some((u) => sameTok(t, u)));
}
/**
 * Cluster merchant keys into one merchant each. `cat` gives each key's main category: keys whose categories
 * disagree are never merged automatically. `alias` holds your manual merges (key → target) and splits (key → itself).
 */
export function clusterMerchants(keys: string[], cat: (k: string) => string | null, alias: Map<string, string> = new Map()): Map<string, string> {
  const out = new Map<string, string>(); const roots: string[] = [];
  const sorted = [...new Set(keys)].sort((a, b) => a.split(' ').length - b.split(' ').length || a.length - b.length);
  for (const k of sorted) {
    if (alias.has(k)) { out.set(k, alias.get(k)!); if (alias.get(k) === k) roots.push(k); continue; }
    const r = roots.find((r) => sameMerchant(r, k) && (!cat(r) || !cat(k) || cat(r) === cat(k)));
    if (r) out.set(k, r); else { roots.push(k); out.set(k, k); }
  }
  // follow manual merges that point at an auto-merged key
  for (const [k, v] of out) { let t = v, n = 0; while (out.get(t) && out.get(t) !== t && n++ < 5) t = out.get(t)!; out.set(k, t); }
  return out;
}
/** Nice display name for a cluster: the variant seen most often, cleaned and title-cased when it is shouting. */
export function prettyMerchant(names: Map<string, number>, rootKey?: string): string {
  const all = [...names]; const root = rootKey ? all.filter(([n]) => canonicalMerchantKey(n) === rootKey) : [];
  const best = (root.length ? root : all).sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]?.[0] ?? '';
  const n = normalizeMerchantName(best).replace(/([A-Za-z]{2,})\d{3,}[A-Za-z0-9]*/g, '$1').replace(/\s*\(.*$/, '').replace(/\s+[A-Za-z]{0,2}\d[\w-]*/g, '').replace(/(\.[a-z]{2,3})?\d+$/i, '$1').replace(/\s{2,}/g, ' ').trim();
  return n === n.toUpperCase() && /[A-Z]{3}/.test(n) ? n.toLowerCase().replace(/(^|\s)[a-z]/g, (c) => c.toUpperCase()) : n;
}
