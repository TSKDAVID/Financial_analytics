import { useMemo, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { useT } from '../lib/i18n';
import { post } from '../lib/api';
import { useAction } from '../lib/hooks';
import { readSheet, parseAmount, parseDate } from '../lib/sheets';
import { money } from '../lib/format';
import { Button, Field, Modal, Select, Tabs, cn, th, td } from './ui';
import { AccountSelect, CategorySelect, CurrencySelect, useCategories } from './pickers';

type Map = { date: string; description: string; amount: string; debit: string; credit: string; currency: string; category: string };
const guess = (headers: string[], words: string[]) => headers.find((h) => words.some((w) => h.toLowerCase().includes(w))) ?? '';

export default function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT(); const { run, busy } = useAction();
  const cats = useCategories().data ?? [];
  const [step, setStep] = useState(1);
  const [file, setFile] = useState<{ name: string; headers: string[]; rows: Record<string, unknown>[] } | null>(null);
  const [m, setM] = useState<Map>({ date: '', description: '', amount: '', debit: '', credit: '', currency: '', category: '' });
  const [mode, setMode] = useState<'signed' | 'split'>('signed');
  const [account, setAccount] = useState<number | null>(null);
  const [currency, setCurrency] = useState('GEL');
  const [invert, setInvert] = useState(false);
  const [parsed, setParsed] = useState<any[]>([]);
  const reset = () => { setStep(1); setFile(null); setParsed([]); };
  const close = () => { reset(); onClose(); };

  const onFile = async (fl: File) => {
    const s = await readSheet(fl);
    setFile({ name: fl.name, ...s });
    const h = s.headers;
    const debit = guess(h, ['debit', 'withdraw', 'დებეტ', 'outflow']), credit = guess(h, ['credit', 'deposit', 'კრედიტ', 'inflow']);
    setMode(debit && credit ? 'split' : 'signed');
    setM({ date: guess(h, ['date', 'თარიღ', 'time']), description: guess(h, ['desc', 'detail', 'narr', 'merchant', 'payee', 'დანიშნ', 'აღწერ', 'name']), amount: guess(h, ['amount', 'sum', 'თანხ', 'value']), debit, credit, currency: guess(h, ['currency', 'ccy', 'ვალუტ']), category: guess(h, ['category', 'კატეგორ']) });
    setStep(2);
  };
  const build = async () => {
    if (!file) return;
    const rows = file.rows.map((r) => {
      const date = parseDate(r[m.date]);
      let amt: number | null;
      if (mode === 'signed') { amt = parseAmount(r[m.amount]); if (amt != null && invert) amt = -amt; }
      else { const dbt = parseAmount(r[m.debit]) ?? 0, cr = parseAmount(r[m.credit]) ?? 0; amt = cr - Math.abs(dbt); }
      const cur = m.currency ? String(r[m.currency] || currency).toUpperCase().slice(0, 3) : currency;
      const catName = m.category ? String(r[m.category] ?? '').toLowerCase() : '';
      return { date, amount: amt, description: String(r[m.description] ?? '').trim(), currency: /^[A-Z]{3}$/.test(cur) ? cur : currency, catName };
    }).filter((r) => r.date && r.amount != null && r.amount !== 0);
    const sugg = await post<(number | null)[]>('/import/suggest', { descriptions: rows.map((r) => r.description) });
    setParsed(rows.map((r, i) => {
      const kind = (r.amount as number) >= 0 ? 'income' : 'expense';
      const byName = r.catName ? cats.find((c) => c.name.toLowerCase() === r.catName && c.kind === kind)?.id : undefined;
      let cat = byName ?? sugg[i]; if (cat && cats.find((c) => c.id === cat)?.kind !== kind) cat = null;
      return { ...r, kind, amount: Math.abs(r.amount as number), category_id: cat ?? null, include: true };
    }));
    setStep(3);
  };
  const doImport = async () => {
    const rows = parsed.filter((p) => p.include).map((p) => ({ kind: p.kind, amount: p.amount, currency: p.currency, date: p.date, description: p.description, category_id: p.category_id, account_id: account, tags: ['import'] }));
    const r = await run(() => post<{ imported: number; skipped: number }>('/import', { rows }));
    if (r) { alert(t('import.done', { n: r.imported, s: r.skipped })); close(); }
  };
  const cols = file?.headers ?? [];
  const colSel = (k: keyof Map, optional = false) => <Select value={m[k]} onChange={(e) => setM({ ...m, [k]: e.target.value })}>{optional && <option value="">—</option>}{!optional && !m[k] && <option value="">?</option>}{cols.map((c) => <option key={c}>{c}</option>)}</Select>;
  const stats = useMemo(() => ({ n: parsed.filter((p) => p.include).length, uncategorized: parsed.filter((p) => p.include && !p.category_id).length }), [parsed]);

  return (
    <Modal open={open} onClose={close} wide title={<span className="flex items-center gap-2"><FileSpreadsheet className="h-4 w-4" />{t('import.title')} · {step}/3</span>}
      footer={step === 2 ? <><Button variant="outline" onClick={reset}>←</Button><Button onClick={build} disabled={!m.date || (mode === 'signed' ? !m.amount : !m.debit && !m.credit)}>{t('import.step3')} →</Button></>
        : step === 3 ? <><Button variant="outline" onClick={() => setStep(2)}>←</Button><Button loading={busy} onClick={doImport} disabled={!stats.n}>{t('common.import')} {stats.n}</Button></> : undefined}>
      {step === 1 && <label className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-12 cursor-pointer hover:bg-muted/40 transition">
        <FileSpreadsheet className="h-10 w-10 text-primary" /><span className="font-medium">{t('import.step1')}</span><span className="text-xs text-muted-foreground">.csv · .xlsx · .xls</span>
        <input type="file" className="hidden" accept=".csv,.xlsx,.xls,.txt" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} /></label>}
      {step === 2 && file && <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{file.name} · {file.rows.length} rows</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={t('common.date') + ' *'}>{colSel('date')}</Field>
          <Field label={t('common.description')}>{colSel('description', true)}</Field>
          <Field label={t('import.amountMode')} className="sm:col-span-2"><Tabs value={mode} onChange={setMode} options={[{ value: 'signed', label: t('import.signed') }, { value: 'split', label: t('import.split') }]} /></Field>
          {mode === 'signed' ? <><Field label={t('common.amount') + ' *'}>{colSel('amount')}</Field><Field label="Sign"><Select value={invert ? '1' : '0'} onChange={(e) => setInvert(e.target.value === '1')}><option value="0">negative = expense</option><option value="1">positive = expense</option></Select></Field></>
            : <><Field label="Debit (expense)">{colSel('debit', true)}</Field><Field label="Credit (income)">{colSel('credit', true)}</Field></>}
          <Field label={t('common.currency') + ' column'}>{colSel('currency', true)}</Field>
          <Field label={t('common.currency') + ' (default)'}><CurrencySelect value={currency} onChange={setCurrency} /></Field>
          <Field label={t('common.category') + ' column'}>{colSel('category', true)}</Field>
          <Field label={t('common.account')}><AccountSelect value={account} onChange={setAccount} /></Field>
        </div>
        <div className="overflow-x-auto rounded-lg border"><table className="text-xs w-full"><thead className="bg-muted/50"><tr>{cols.map((c) => <th key={c} className={th}>{c}</th>)}</tr></thead>
          <tbody>{file.rows.slice(0, 5).map((r, i) => <tr key={i} className="border-t">{cols.map((c) => <td key={c} className={cn(td, 'whitespace-nowrap')}>{String(r[c] instanceof Date ? (r[c] as Date).toISOString().slice(0, 10) : r[c])}</td>)}</tr>)}</tbody></table></div>
      </div>}
      {step === 3 && <div className="space-y-3">
        <p className="text-sm">{stats.n} rows · <span className="text-muted-foreground">{stats.uncategorized} uncategorized (auto-suggested where possible)</span></p>
        <div className="max-h-[50vh] overflow-y-auto rounded-lg border"><table className="text-sm w-full"><thead className="bg-muted/50 sticky top-0"><tr><th className={th}></th><th className={th}>{t('common.date')}</th><th className={th}>{t('common.description')}</th><th className={th}>{t('common.category')}</th><th className={cn(th, 'text-right')}>{t('common.amount')}</th></tr></thead>
          <tbody>{parsed.map((p, i) => <tr key={i} className={cn('border-t', !p.include && 'opacity-40')}>
            <td className={td}><input type="checkbox" checked={p.include} onChange={() => setParsed(parsed.map((x, j) => j === i ? { ...x, include: !x.include } : x))} /></td>
            <td className={cn(td, 'whitespace-nowrap')}>{p.date}</td><td className={cn(td, 'max-w-[260px] truncate')}>{p.description}</td>
            <td className={td}><CategorySelect className="h-8 text-xs" kind={p.kind} value={p.category_id} onChange={(v) => setParsed(parsed.map((x, j) => j === i ? { ...x, category_id: v } : x))} /></td>
            <td className={cn(td, 'text-right num whitespace-nowrap', p.kind === 'income' ? 'text-success' : '')}>{p.kind === 'income' ? '+' : '−'}{money(p.amount, p.currency)}</td></tr>)}</tbody></table></div>
      </div>}
    </Modal>
  );
}
