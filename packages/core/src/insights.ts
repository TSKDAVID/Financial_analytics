import { mean, median, stdev } from './stats';

export interface TxLite { id: number; date: string; amount: number; /* positive GEL */ categoryId: number | null; kind: 'income' | 'expense'; }

/** Flag transactions that are unusually large for their category (robust z-score). */
export function detectAnomalies(txs: TxLite[], minSamples = 5, threshold = 3): { id: number; score: number; median: number }[] {
  const by = new Map<number, TxLite[]>();
  for (const t of txs) if (t.kind === 'expense' && t.categoryId != null) {
    const a = by.get(t.categoryId) ?? []; a.push(t); by.set(t.categoryId, a);
  }
  const out: { id: number; score: number; median: number }[] = [];
  for (const list of by.values()) {
    if (list.length < minSamples) continue;
    const amts = list.map((t) => t.amount);
    const med = median(amts);
    const mad = median(amts.map((a) => Math.abs(a - med))) * 1.4826 || stdev(amts) || 1;
    for (const t of list) {
      const z = (t.amount - med) / mad;
      if (z > threshold && t.amount > med * 1.5) out.push({ id: t.id, score: Math.round(z * 10) / 10, median: med });
    }
  }
  return out;
}

/** Compare a current value vs a baseline series; returns pct change or null. */
export function pctChange(current: number, baseline: number[]): number | null {
  const b = mean(baseline.filter((x) => x > 0));
  if (!b) return null;
  return (current - b) / b;
}

/** Spike: latest value > mean + k*sd and > +25%. */
export function isSpike(latest: number, history: number[], k = 1.5): boolean {
  if (history.length < 3) return false;
  const m = mean(history), s = stdev(history);
  return latest > m + k * s && latest > m * 1.25;
}

/** Seasonal pattern: compare average of winter months (Nov-Feb) vs summer (May-Aug). */
export function seasonality(byMonth: { month: string; value: number }[]): 'winter' | 'summer' | null {
  const w = byMonth.filter((x) => [11, 12, 1, 2].includes(Number(x.month.slice(5, 7)))).map((x) => x.value);
  const s = byMonth.filter((x) => [5, 6, 7, 8].includes(Number(x.month.slice(5, 7)))).map((x) => x.value);
  if (w.length < 2 || s.length < 2) return null;
  const mw = mean(w), ms = mean(s);
  if (mw > ms * 1.4) return 'winter';
  if (ms > mw * 1.4) return 'summer';
  return null;
}

/** Simple keyword-based category suggestion for imports. */
export function suggestCategory(description: string, rules: { key: string; keywords: string[] }[]): string | null {
  const d = description.toLowerCase();
  for (const r of rules) if (r.keywords.some((k) => d.includes(k))) return r.key;
  return null;
}
export const DEFAULT_KEYWORDS: { key: string; keywords: string[] }[] = [
  { key: 'salary', keywords: ['salary', 'payroll', 'ხელფასი'] },
  { key: 'electricity', keywords: ['telasi', 'energo-pro', 'energo pro', 'electric'] },
  { key: 'gas', keywords: ['tbilisi energy', 'socar gas', 'gas supply', 'გაზი'] },
  { key: 'water', keywords: ['gwp', 'georgian water', 'water'] },
  { key: 'internet', keywords: ['magti', 'silknet', 'internet', 'fiber'] },
  { key: 'phone', keywords: ['cellfie', 'beeline', 'mobile', 'geocell'] },
  { key: 'subscriptions', keywords: ['netflix', 'spotify', 'youtube', 'apple.com', 'google', 'icloud', 'adobe', 'chatgpt', 'openai', 'subscription'] },
  { key: 'groceries', keywords: ['carrefour', 'spar', 'goodwill', 'nikora', 'agrohub', 'fresco', 'market', 'grocery', '2 nabiji'] },
  { key: 'transport', keywords: ['bolt', 'yandex', 'uber', 'metro', 'fuel', 'gulf', 'rompetrol', 'wissol', 'socar', 'lukoil', 'parking'] },
  { key: 'health', keywords: ['pharmacy', 'aversi', 'psp', 'gpc', 'clinic', 'hospital', 'dental'] },
  { key: 'entertainment', keywords: ['cinema', 'steam', 'playstation', 'concert', 'restaurant', 'cafe', 'bar', 'wolt', 'glovo'] },
  { key: 'shopping', keywords: ['zara', 'amazon', 'aliexpress', 'temu', 'h&m', 'mall'] },
  { key: 'loans', keywords: ['loan', 'credit', 'სესხი', 'installment'] },
  { key: 'insurance', keywords: ['insurance', 'aldagi', 'ardi', 'imedi l'] },
  { key: 'education', keywords: ['university', 'course', 'udemy', 'coursera', 'school'] },
  { key: 'rent', keywords: ['rent', 'mortgage', 'ქირა'] },
];
