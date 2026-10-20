import type { DB } from '../schema';
import { getSetting } from '../schema';

/**
 * Optional AI fallback for low-confidence categorisation.
 * Providers: local Ollama (default), any local OpenAI-compatible server (LM Studio, llama.cpp), or Groq (cloud).
 * Only merchant descriptions, amounts and direction are sent. API keys are never logged or returned by the API.
 */
export type Provider = 'ollama' | 'openai' | 'groq';
export interface AiConfig { enabled: boolean; provider: Provider; baseUrl: string; model: string; fallbackModel?: string; apiKey?: string; threshold: number; timeoutMs: number }
export interface AiItem { i: number; description: string; amount: number; currency: string; kind: 'income' | 'expense'; mcc?: string }
export interface AiChoice { i: number; kind: string; category: string | null; confidence: number }

export const AI_DEFAULTS: Record<string, string> = {
  aiEnabled: '1', aiProvider: 'ollama', ollamaUrl: 'http://localhost:11434', ollamaModel: 'qwen2.5:7b-instruct-q3_K_M', ollamaFallbackModel: 'qwen2.5:3b',
  openaiBaseUrl: 'http://localhost:1234/v1', openaiModel: '', groqModel: 'llama-3.3-70b-versatile', aiThreshold: '0.6', aiTimeoutSec: '90',
};
export const SECRET_KEYS = ['openaiKey', 'groqKey'];

export function aiConfig(db: DB): AiConfig {
  const g = (k: string) => getSetting(db, k) ?? AI_DEFAULTS[k] ?? '';
  const provider = (g('aiProvider') as Provider) || 'ollama';
  const base = { enabled: g('aiEnabled') === '1', provider, threshold: Number(g('aiThreshold')) || 0.6, timeoutMs: (Number(g('aiTimeoutSec')) || 90) * 1000 };
  if (provider === 'groq') return { ...base, baseUrl: 'https://api.groq.com/openai/v1', model: g('groqModel'), apiKey: g('groqKey') };
  if (provider === 'openai') return { ...base, baseUrl: g('openaiBaseUrl').replace(/\/$/, ''), model: g('openaiModel'), apiKey: g('openaiKey') || undefined };
  return { ...base, baseUrl: g('ollamaUrl').replace(/\/$/, ''), model: g('ollamaModel'), fallbackModel: g('ollamaFallbackModel') || undefined };
}

async function http(url: string, init: RequestInit & { timeoutMs?: number }) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 15000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200).replace(/(sk|gsk)_[A-Za-z0-9]+/g, '***')}`);
  return text ? JSON.parse(text) : {};
}
const authHeaders = (c: AiConfig): Record<string, string> => ({ 'Content-Type': 'application/json', ...(c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {}) });

/** Lists available models; used by the "Test connection" button. */
export async function testConnection(c: AiConfig): Promise<{ ok: boolean; models: string[]; message: string }> {
  try {
    if (c.provider === 'ollama') {
      const r = await http(`${c.baseUrl}/api/tags`, { method: 'GET', timeoutMs: 5000 });
      const models = (r.models ?? []).map((m: any) => m.name as string);
      const has = models.includes(c.model);
      return { ok: true, models, message: has ? `Connected · ${c.model} available` : `Connected, but model "${c.model}" is not installed (run: ollama pull ${c.model})` };
    }
    if (c.provider === 'groq' && !c.apiKey) return { ok: false, models: [], message: 'Enter your Groq API key first' };
    const r = await http(`${c.baseUrl}/models`, { method: 'GET', headers: authHeaders(c), timeoutMs: 8000 });
    const models = (r.data ?? []).map((m: any) => m.id as string);
    return { ok: true, models, message: `Connected · ${models.length} model(s)` };
  } catch (e: any) {
    return { ok: false, models: [], message: e?.name === 'TimeoutError' ? 'Timed out — is the model server running?' : `Unreachable: ${e?.message ?? e}` };
  }
}

/** Synthetic Georgian/English few-shot examples (no real data). */
const FEW_SHOT = [
  { in: { i: 1, description: 'გადახდა · ნიკორა საბურთალო', amount: 23.4, currency: 'GEL', kind: 'expense', mcc: '5411' }, out: { i: 1, kind: 'purchase', category: 'groceries', confidence: 0.95 } },
  { in: { i: 2, description: 'POS wallet · WOLT', amount: 31, currency: 'GEL', kind: 'expense', mcc: '5814' }, out: { i: 2, kind: 'purchase', category: 'dining', confidence: 0.92 } },
  { in: { i: 3, description: 'კომუნალური გადახდა · თელასი; აბონენტი #', amount: 64, currency: 'GEL', kind: 'expense' }, out: { i: 3, kind: 'bill', category: 'electricity', confidence: 0.95 } },
  { in: { i: 4, description: 'საკუთარ ანგარიშზე გადარიცხვა', amount: 200, currency: 'GEL', kind: 'expense' }, out: { i: 4, kind: 'internal', category: null, confidence: 0.97 } },
  { in: { i: 5, description: 'პირადი გადარიცხვა · გიორგი მაისურაძე', amount: 50, currency: 'GEL', kind: 'expense' }, out: { i: 5, kind: 'transfer_out', category: 'p2p_out', confidence: 0.85 } },
  { in: { i: 6, description: 'ხელფასი სექტემბერი', amount: 2500, currency: 'GEL', kind: 'income' }, out: { i: 6, kind: 'salary', category: 'salary', confidence: 0.97 } },
  { in: { i: 7, description: 'Spotify P#', amount: 9.99, currency: 'USD', kind: 'expense', mcc: '5815' }, out: { i: 7, kind: 'subscription', category: 'subscriptions', confidence: 0.95 } },
  { in: { i: 8, description: 'კონვერტაცია USD-GEL', amount: 100, currency: 'USD', kind: 'expense' }, out: { i: 8, kind: 'exchange', category: null, confidence: 0.97 } },
];
const KIND_HELP = 'purchase=card payment at a shop; subscription=recurring digital service; bill=utilities/taxes; topup=phone/transport card top-up; cash_withdrawal/cash_deposit; '
  + 'transfer_out/transfer_in=money to/from another person; internal=between your own accounts, savings, piggy bank, deposits; exchange=currency conversion; salary; income=other income; '
  + 'loan_repayment; loan_disbursement; fee=bank fees; interest=interest earned; refund=money returned by a merchant.';
function prompt(items: AiItem[], categories: { key: string; label: string; kind: string }[]) {
  const sys = 'You classify personal bank transactions from Georgia. Descriptions are Georgian or English (merchants like Carrefour, Nikora, Wolt, Bolt, Telasi, Magti). '
    + `First decide the KIND, then the CATEGORY. Kinds: ${KIND_HELP} Internal transfers and exchanges have category null. `
    + 'Choose a category only from the allowed list, matching the item direction (expense categories for money out, income categories for money in). Give confidence 0-1; use low confidence when unsure. '
    + 'Reply only with JSON {"items":[{"i":number,"kind":string,"category":string|null,"confidence":number}]}.';
  const cats = categories.map((c) => ({ key: c.key, label: c.label, kind: c.kind }));
  const shots = FEW_SHOT.flatMap((x) => [{ role: 'user', content: JSON.stringify({ items: [x.in] }) }, { role: 'assistant', content: JSON.stringify({ items: [x.out] }) }]);
  return [{ role: 'system', content: `${sys}\nAllowed categories: ${JSON.stringify(cats)}` }, ...shots, { role: 'user', content: JSON.stringify({ items }) }];
}
export const AI_KINDS = ['purchase', 'subscription', 'bill', 'topup', 'cash_withdrawal', 'cash_deposit', 'transfer_out', 'transfer_in', 'internal', 'exchange', 'salary', 'income', 'loan_repayment', 'loan_disbursement', 'fee', 'interest', 'refund'];
function schema(keys: string[]) {
  return { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { i: { type: 'integer' }, kind: { type: 'string', enum: AI_KINDS }, category: { type: ['string', 'null'], enum: [...keys, null] }, confidence: { type: 'number' } }, required: ['i', 'kind', 'category', 'confidence'] } } }, required: ['items'] };
}
export function parseChoices(content: string, keys: Set<string>): AiChoice[] {
  const m = content.match(/\{[\s\S]*\}/); if (!m) return [];
  let o: any; try { o = JSON.parse(m[0]); } catch { return []; }
  return (o.items ?? []).filter((x: any) => Number.isInteger(x.i) && AI_KINDS.includes(x.kind) && (x.category == null || keys.has(x.category)))
    .map((x: any) => ({ i: x.i, kind: x.kind, category: x.category ?? null, confidence: Math.max(0, Math.min(1, Number(x.confidence) || 0.5)) }));
}

async function callModel(c: AiConfig, model: string, items: AiItem[], cats: { key: string; label: string; kind: string }[]): Promise<AiChoice[]> {
  const keys = cats.map((x) => x.key); const set = new Set(keys);
  if (c.provider === 'ollama') {
    const r = await http(`${c.baseUrl}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, timeoutMs: c.timeoutMs,
      body: JSON.stringify({ model, messages: prompt(items, cats), stream: false, format: schema(keys), options: { temperature: 0 } }) });
    return parseChoices(r.message?.content ?? '', set);
  }
  const response_format = c.provider === 'groq' ? { type: 'json_object' } : { type: 'json_schema', json_schema: { name: 'categories', strict: true, schema: schema(keys) } };
  const r = await http(`${c.baseUrl}/chat/completions`, { method: 'POST', headers: authHeaders(c), timeoutMs: c.timeoutMs,
    body: JSON.stringify({ model, messages: prompt(items, cats), temperature: 0, response_format }) });
  return parseChoices(r.choices?.[0]?.message?.content ?? '', set);
}

/** Categorise in batches; never throws — returns whatever succeeded plus an error message for the UI. */
export async function aiCategorize(c: AiConfig, items: AiItem[], cats: { key: string; label: string; kind: string }[]): Promise<{ choices: AiChoice[]; error?: string; model?: string }> {
  if (!items.length) return { choices: [] };
  if (!c.model) return { choices: [], error: 'No AI model selected in Settings' };
  const out: AiChoice[] = []; let model = c.model; let error: string | undefined;
  for (let s = 0; s < items.length; s += 20) {
    const batch = items.slice(s, s + 20);
    try { out.push(...(await callModel(c, model, batch, cats))); }
    catch (e: any) {
      if (c.fallbackModel && model !== c.fallbackModel) {
        try { model = c.fallbackModel; out.push(...(await callModel(c, model, batch, cats))); continue; } catch (e2: any) { error = String(e2?.message ?? e2); }
      } else error = String(e?.message ?? e);
      break; // model unreachable: stop and fall back to rules for the rest
    }
  }
  return { choices: out, error: error ? `AI unavailable, kept rule-based categories (${error.slice(0, 160)})` : undefined, model };
}
