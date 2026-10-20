import { useState } from 'react';
import { Sparkles, PlugZap, RefreshCw } from 'lucide-react';
import { useT } from '../lib/i18n';
import { post } from '../lib/api';
import { Button, Card, Field, Input, Select, Switch, Tabs } from './ui';

/** AI provider settings: local Ollama (default), OpenAI-compatible local server, or Groq. */
export function AiSettings({ s, onSave }: { s: Record<string, any>; onSave: (p: Record<string, string>) => unknown }) {
  const t = useT();
  const [provider, setProvider] = useState<string>(s.aiProvider ?? 'ollama');
  const [f, setF] = useState<Record<string, string>>({ ollamaUrl: s.ollamaUrl, ollamaModel: s.ollamaModel, ollamaFallbackModel: s.ollamaFallbackModel, openaiBaseUrl: s.openaiBaseUrl, openaiModel: s.openaiModel ?? '', groqModel: s.groqModel, aiThreshold: s.aiThreshold, aiTimeoutSec: s.aiTimeoutSec, openaiKey: '', groqKey: '' });
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const urlKey = provider === 'ollama' ? 'ollamaUrl' : 'openaiBaseUrl';
  const modelKey = provider === 'ollama' ? 'ollamaModel' : provider === 'openai' ? 'openaiModel' : 'groqModel';
  const keyKey = provider === 'groq' ? 'groqKey' : 'openaiKey';
  async function test() {
    setTesting(true);
    try {
      const r = await post<{ ok: boolean; models: string[]; message: string }>('/ai/test', { provider, ...(provider !== 'groq' ? { baseUrl: f[urlKey] } : {}), model: f[modelKey], ...(f[keyKey] ? { apiKey: f[keyKey] } : {}) });
      setStatus(r); setModels(r.models);
    } catch (e: any) { setStatus({ ok: false, message: e.message }); } finally { setTesting(false); }
  }
  function save() {
    const p: Record<string, string> = { aiProvider: provider };
    for (const [k, v] of Object.entries(f)) if (!(k.endsWith('Key') && !v)) p[k] = v ?? '';
    onSave(p); setF((x) => ({ ...x, openaiKey: '', groqKey: '' }));
  }
  const modelList = models.length ? models : [f[modelKey], provider === 'ollama' ? f.ollamaFallbackModel : ''].filter(Boolean);
  return <Card title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4" />{t('ai.title')}</span>}>
    <div className="space-y-4">
      <Switch checked={s.aiEnabled !== '0'} onChange={(v) => onSave({ aiEnabled: v ? '1' : '0' })} label={t('ai.enabled')} />
      <Field label={t('ai.provider')}><Tabs value={provider} onChange={(v) => { setProvider(v); setModels([]); setStatus(null); }} options={[{ value: 'ollama', label: t('ai.ollama') }, { value: 'openai', label: 'LM Studio / llama.cpp' }, { value: 'groq', label: t('ai.groq') }]} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        {provider !== 'groq' && <Field label={t('ai.baseUrl')}><Input value={f[urlKey] ?? ''} onChange={set(urlKey)} placeholder={provider === 'ollama' ? 'http://localhost:11434' : 'http://localhost:1234/v1'} /></Field>}
        <Field label={t('ai.model')}>{modelList.length > 1 || models.length ? <Select value={f[modelKey] ?? ''} onChange={set(modelKey)}>{[...new Set([f[modelKey], ...modelList])].filter(Boolean).map((m) => <option key={m}>{m}</option>)}</Select>
          : <Input value={f[modelKey] ?? ''} onChange={set(modelKey)} placeholder="model name" />}</Field>
        {provider === 'ollama' && <Field label={t('ai.fallback')}><Select value={f.ollamaFallbackModel ?? ''} onChange={set('ollamaFallbackModel')}><option value="">—</option>{[...new Set([f.ollamaFallbackModel, ...modelList])].filter(Boolean).map((m) => <option key={m}>{m}</option>)}</Select></Field>}
        {provider !== 'ollama' && <Field label={t('ai.key')} hint={(provider === 'groq' ? s.groqKeySet : s.openaiKeySet) ? t('ai.keySet') : provider === 'openai' ? 'optional' : ''}><Input type="password" autoComplete="off" value={f[keyKey]} onChange={set(keyKey)} placeholder={(provider === 'groq' ? s.groqKeySet : s.openaiKeySet) ? '••••••••' : ''} /></Field>}
        <Field label={t('ai.threshold')}><Input type="number" step="0.05" min="0" max="1" value={f.aiThreshold} onChange={set('aiThreshold')} /></Field>
        <Field label={t('ai.timeout')}><Input type="number" min="5" max="600" value={f.aiTimeoutSec} onChange={set('aiTimeoutSec')} /></Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save}>{t('common.save')}</Button>
        <Button variant="outline" onClick={test} disabled={testing}>{testing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}{t('ai.test')}</Button>
        {status && <span className={status.ok ? 'text-sm text-success' : 'text-sm text-danger'}>{status.message}</span>}
      </div>
      <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">{t('ai.privacy')}</p>
    </div>
  </Card>;
}
