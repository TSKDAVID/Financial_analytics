import type { DB } from '../schema';
import { getSetting } from '../schema';

/**
 * Optional AI fallback for low-confidence categorisation.
 * Providers: local Ollama (default), any local OpenAI-compatible server (LM Studio, llama.cpp), or Groq (cloud).
 * Only merchant descriptions, amounts and direction are sent. API keys are never logged or returned by the API.
 */
export type Provider = 'ollama' | 'openai' | 'groq';
export interface AiConfig { enabled: boolean; provider: Provider; baseUrl: string; model: string; fallbackModel?: string; apiKey?: string; threshold: number; timeoutMs: number }
export interface AiItem { i: number; description: string; amount: number; currency: string; kind: 'income' | 'expense' }
export interface AiChoice { i: number; category: string; confidence: number }

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

function prompt(items: AiItem[], categories: { key: string; label: string; kind: string }[]) {
  const sys = 'You categorise personal bank transactions from Georgia (descriptions may be English or Georgian, merchants like Carrefour, Nikora, Wolt, Bolt, Telasi, Magti). '
    + 'For each item choose exactly one category key from the allowed list for its kind. Give confidence 0-1. Reply only with JSON {"items":[{"i":number,"category":string,"confidence":number}]}.';
  const user = JSON.stringify({ categories: categories.map((c) => ({ key: c.key, label: c.label, kind: c.kind })), items });
  return [{ role: 'system', content: sys }, { role: 'user', content: user }];
}
function schema(keys: string[]) {
  return { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { i: { type: 'integer' }, category: { type: 'string', enum: keys }, confidence: { type: 'number' } }, required: ['i', 'category', 'confidence'] } } }, required: ['items'] };
}
function parseChoices(content: string, keys: Set<string>): AiChoice[] {
  const m = content.match(/\{[\s\S]*\}/); if (!m) return [];
  const o = JSON.parse(m[0]);
  return (o.items ?? []).filter((x: any) => Number.isInteger(x.i) && keys.has(x.category)).map((x: any) => ({ i: x.i, category: x.category, confidence: Math.max(0, Math.min(1, Number(x.confidence) || 0.5)) }));
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
