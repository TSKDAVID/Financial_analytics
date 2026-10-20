import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Globe, Coins, Shield, Smartphone, Database, Gauge, RefreshCw, Trash2, Upload, Download, Send, Keyboard } from 'lucide-react';
import { useT, setLang, getLang } from '../lib/i18n';
import { useApi, useAction, setTheme, useTheme } from '../lib/hooks';
import { del, get, post, put, session } from '../lib/api';
import { dateFmt, today } from '../lib/format';
import { download } from '../lib/sheets';
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Spinner, Switch, Tabs, cn, th, td } from '../components/ui';
import { CurrencySelect } from '../components/pickers';

export default function Settings() {
  const t = useT(); const theme = useTheme();
  const s = useApi<Record<string, any>>('/settings'); const { run, busy } = useAction();
  const save = (patch: Record<string, string | number | boolean>) => run(() => put('/settings', patch), t('common.saved'));
  if (!s.data) return <Spinner />;
  return <div className="space-y-6 max-w-5xl">
    <PageHeader title={t('set.title')} />
    <Card title={<H icon={Globe}>{t('set.general')}</H>}><div className="grid sm:grid-cols-2 gap-4">
      <Field label={t('set.language')}><Tabs value={getLang()} onChange={(l) => { setLang(l); save({ language: l }); }} options={[{ value: 'en', label: 'English' }, { value: 'ka', label: 'ქართული' }]} /></Field>
      <Field label={t('set.theme')}><Tabs value={theme} onChange={(v) => setTheme(v)} options={[{ value: 'light', label: t('set.theme.light') }, { value: 'dark', label: t('set.theme.dark') }, { value: 'system', label: t('set.theme.system') }]} /></Field>
      <Switch checked={s.data.desktopNotifications !== '0'} onChange={(v) => { save({ desktopNotifications: v ? '1' : '0' }); if (v && 'Notification' in window) Notification.requestPermission(); }} label={t('alerts.enableDesktop')} />
      <ShortcutsHint />
    </div></Card>
    <Rates />
    <Card title={<H icon={Gauge}>{t('set.risk')}</H>}><RiskSettings s={s.data} onSave={save} /></Card>
    <Security lockEnabled={!!s.data.lockEnabled} />
    <Phone s={s.data} onSave={save} />
    <Card title={<H icon={Database}>{t('set.data')}</H>}><Backup />
      <div className="flex flex-wrap gap-2 mt-6 pt-4 border-t">
        <Button variant="outline" loading={busy} onClick={() => confirm(t('set.demo') + '?') && run(() => post('/demo/seed'), '✓')}>{t('set.demo')}</Button>
        <Button variant="danger" onClick={() => { const c = prompt('Type DELETE to erase all data (settings are kept)'); if (c === 'DELETE') run(() => post('/data/reset', { confirm: 'DELETE' }), t('common.deleted')); }}><Trash2 className="h-4 w-4" />{t('set.reset')}</Button>
      </div></Card>
  </div>;
}
const H = ({ icon: I, children }: { icon: any; children: React.ReactNode }) => <span className="flex items-center gap-2"><I className="h-4 w-4 text-primary" />{children}</span>;
function ShortcutsHint() { const t = useT(); return <div className="text-sm text-muted-foreground flex items-center gap-2"><Keyboard className="h-4 w-4" />{t('set.shortcuts')}: <kbd className="rounded border bg-muted px-1.5 text-xs">?</kbd></div>; }

function RiskSettings({ s, onSave }: { s: Record<string, any>; onSave: (p: Record<string, string>) => void }) {
  const t = useT(); const [f, setF] = useState({ minBalance: s.minBalance, lowBalanceDays: s.lowBalanceDays, emergencyTargetMonths: s.emergencyTargetMonths });
  return <form className="grid sm:grid-cols-4 gap-3 items-end" onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
    <Field label={t('risk.minBalance') + ' (₾)'}><Input type="number" value={f.minBalance} onChange={(e) => setF({ ...f, minBalance: e.target.value })} /></Field>
    <Field label={t('set.lowDays')}><Input type="number" min={7} max={120} value={f.lowBalanceDays} onChange={(e) => setF({ ...f, lowBalanceDays: e.target.value })} /></Field>
    <Field label={t('set.emergencyTarget')}><Input type="number" min={1} max={24} value={f.emergencyTargetMonths} onChange={(e) => setF({ ...f, emergencyTargetMonths: e.target.value })} /></Field>
    <Button>{t('common.save')}</Button></form>;
}

function Rates() {
  const t = useT(); const [date, setDate] = useState(today());
  const r = useApi<any>(`/rates?date=${date}`); const { run, busy } = useAction();
  const [ov, setOv] = useState({ code: 'USD', rate: '' });
  const [conv, setConv] = useState({ amount: '100', from: 'USD', to: 'GEL', result: null as number | null });
  useEffect(() => { const h = setTimeout(() => get(`/convert?amount=${conv.amount}&from=${conv.from}&to=${conv.to}&date=${date}`).then((x) => setConv((c) => ({ ...c, result: x.result }))).catch(() => undefined), 250); return () => clearTimeout(h); }, [conv.amount, conv.from, conv.to, date]);
  const main = ['USD', 'EUR', 'GBP', 'TRY', 'RUB', 'AMD', 'AZN', 'UAH', 'CHF'];
  return <Card title={<H icon={Coins}>{t('set.currency')}</H>} subtitle={t('set.rates') + ' · nbg.gov.ge'} action={<div className="flex gap-2"><Input type="date" className="h-9 w-40" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
    <Button size="sm" variant="outline" loading={busy} onClick={() => run(() => post('/rates/refresh', { date }), '✓')}><RefreshCw className="h-4 w-4" />{t('set.refresh')}</Button></div>}>
    {!r.data ? <Spinner /> : <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">{main.map((c) => { const x = r.data.rates[c]; return <div key={c} className="rounded-lg border p-2.5 text-center">
      <div className="text-xs font-semibold text-muted-foreground">{c}</div><div className="font-bold num">{x ? x.rate.toFixed(c === 'AMD' || c === 'RUB' ? 4 : 4) : '—'}</div>{x && x.source !== 'cache' && x.source !== 'nbg' && <Badge tone={x.source === 'manual' ? 'warning' : 'info'}>{x.source}</Badge>}</div>; })}</div>}
    <div className="grid lg:grid-cols-2 gap-6 mt-6">
      <div><div className="text-sm font-medium mb-2">Converter</div><div className="flex gap-2 items-center"><Input className="w-28" type="number" value={conv.amount} onChange={(e) => setConv({ ...conv, amount: e.target.value })} /><CurrencySelect className="w-24" value={conv.from} onChange={(v) => setConv({ ...conv, from: v })} />→<CurrencySelect className="w-24" value={conv.to} onChange={(v) => setConv({ ...conv, to: v })} />
        <b className="num whitespace-nowrap">{conv.result != null ? conv.result.toFixed(2) : '…'}</b></div></div>
      <div><div className="text-sm font-medium mb-2">{t('set.manualRate')} ({date})</div><form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(() => put('/rates', { date, code: ov.code, rate: Number(ov.rate) }), t('common.saved')); }}>
        <CurrencySelect className="w-24" value={ov.code} onChange={(v) => setOv({ ...ov, code: v })} /><Input type="number" step="0.0001" placeholder="GEL per 1 unit" value={ov.rate} onChange={(e) => setOv({ ...ov, rate: e.target.value })} required /><Button variant="outline">{t('common.save')}</Button>
        <Button type="button" variant="ghost" onClick={() => run(() => put('/rates', { date, code: ov.code, rate: null }), '✓')}>↺</Button></form></div>
    </div>
    <Button className="mt-4" size="sm" variant="ghost" onClick={() => confirm(t('set.reapply') + '?') && run(() => post('/rates/reapply'), '✓')}>{t('set.reapply')}</Button>
  </Card>;
}

function Security({ lockEnabled }: { lockEnabled: boolean }) {
  const t = useT(); const { run, busy } = useAction(); const [f, setF] = useState({ current: '', secret: '' });
  const submit = async (remove = false) => { const r = await run(() => post<any>('/auth/set', { current: f.current || undefined, secret: remove ? null : f.secret }), t('common.saved')); if (r) { session.set(r.token ?? null); setF({ current: '', secret: '' }); } };
  return <Card title={<H icon={Shield}>{t('set.security')}</H>} subtitle={t('set.pin')}>
    <div className="flex items-center gap-2 mb-4">{lockEnabled ? <Badge tone="success">🔒 enabled</Badge> : <Badge>off</Badge>}</div>
    <form className="grid sm:grid-cols-3 gap-3 items-end" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      {lockEnabled && <Field label={t('set.pinCurrent')}><Input type="password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} required /></Field>}
      <Field label={t('set.pinNew')}><Input type="password" minLength={4} value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value })} required /></Field>
      <div className="flex gap-2"><Button loading={busy}>{lockEnabled ? t('set.pinChange') : t('set.pinSet')}</Button>{lockEnabled && <Button type="button" variant="outline" onClick={() => f.current ? submit(true) : alert(t('set.pinCurrent'))}>{t('set.pinRemove')}</Button>}</div>
    </form></Card>;
}

function Backup() {
  const t = useT(); const { run, busy } = useAction(); const [pw, setPw] = useState(''); const [file, setFile] = useState<File | null>(null); const [rpw, setRpw] = useState('');
  return <div className="grid md:grid-cols-2 gap-6">
    <form className="space-y-2" onSubmit={async (e) => { e.preventDefault(); const r = await run(() => post<{ file: string; name: string }>('/backup/export', { password: pw })); if (r) { download(r.file, r.name); setPw(''); } }}>
      <div className="text-sm font-medium">{t('set.backupExport')}</div><Field label={t('set.backupPassword')}><Input type="password" minLength={6} required value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      <Button variant="outline" loading={busy}><Download className="h-4 w-4" />{t('set.backupExport')}</Button><p className="text-[11px] text-muted-foreground">AES-256-GCM · scrypt. Keep the password safe — it cannot be recovered.</p></form>
    <form className="space-y-2" onSubmit={async (e) => { e.preventDefault(); if (!file || !confirm(t('set.backupRestore') + '? All current data will be replaced.')) return; const content = await file.text(); if (await run(() => post('/backup/restore', { file: content, password: rpw }), '✓')) { setFile(null); setRpw(''); } }}>
      <div className="text-sm font-medium">{t('set.backupRestore')}</div><Input type="file" accept=".fabackup,.json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="pt-2" />
      <Field label={t('set.backupPassword')}><Input type="password" required value={rpw} onChange={(e) => setRpw(e.target.value)} /></Field><Button variant="outline" loading={busy} disabled={!file}><Upload className="h-4 w-4" />{t('set.backupRestore')}</Button></form>
  </div>;
}

function Phone({ s, onSave }: { s: Record<string, any>; onSave: (p: Record<string, string>) => void }) {
  const t = useT(); const devices = useApi<any[]>('/devices'); const { run, busy } = useAction();
  const [pair, setPair] = useState<any>(null); const [url, setUrl] = useState('');
  const [ntfy, setNtfy] = useState({ ntfyServer: s.ntfyServer ?? 'https://ntfy.sh', ntfyTopic: s.ntfyTopic ?? '' });
  const startPair = async () => { const r = await run(() => post<any>('/pair/start')); if (r) { setPair(r); setUrl(r.urls[0]?.url ?? `http://${location.hostname}:${location.port || 5317}`); } };
  const randomTopic = () => setNtfy({ ...ntfy, ntfyTopic: 'fa-' + crypto.getRandomValues(new Uint32Array(3)).join('').slice(0, 20) });
  return <Card title={<H icon={Smartphone}>{t('set.phone')}</H>}>
    <div className="grid md:grid-cols-2 gap-6">
      <div className="space-y-3"><div className="text-sm font-medium">{t('set.devices')}</div>
        {!devices.data?.length ? <p className="text-sm text-muted-foreground">—</p> : <table className="w-full text-sm"><thead><tr><th className={th}>{t('common.name')}</th><th className={th}>Last seen</th><th className={th}>Push</th><th className={th}></th></tr></thead>
          <tbody>{devices.data.map((d) => <tr key={d.id} className="border-t"><td className={td}>{d.name}</td><td className={cn(td, 'text-xs text-muted-foreground')}>{d.last_seen ? dateFmt(d.last_seen.replace(' ', 'T') + 'Z', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</td><td className={td}>{d.has_push ? <Badge tone="success">✓</Badge> : <Badge>—</Badge>}</td>
            <td className={td}><Button size="icon" variant="ghost" onClick={() => confirm('Unpair?') && run(() => del(`/devices/${d.id}`))}><Trash2 className="h-4 w-4" /></Button></td></tr>)}</tbody></table>}
        <Button onClick={startPair} loading={busy}><Smartphone className="h-4 w-4" />{t('set.pair')}</Button>
        <p className="text-[11px] text-muted-foreground">Install Tailscale on this computer and your phone (same account), then scan the QR code with the Financial Analytics Android app. See README → “Phone app”.</p>
      </div>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSave(ntfy); }}><div className="text-sm font-medium">{t('set.ntfy')}</div>
        <p className="text-[11px] text-muted-foreground">Optional extra channel. Install the free “ntfy” app and subscribe to the same secret topic. Only the short alert title + one line leave your computer. Expo push to the companion app is used automatically when paired.</p>
        <Field label={t('set.ntfyServer')}><Input value={ntfy.ntfyServer} onChange={(e) => setNtfy({ ...ntfy, ntfyServer: e.target.value })} /></Field>
        <Field label={t('set.ntfyTopic')}><div className="flex gap-2"><Input value={ntfy.ntfyTopic} onChange={(e) => setNtfy({ ...ntfy, ntfyTopic: e.target.value })} placeholder="leave empty to disable" /><Button type="button" variant="outline" onClick={randomTopic}>🎲</Button></div></Field>
        <Switch checked={s.expoPush !== '0'} onChange={(v) => onSave({ expoPush: v ? '1' : '0' })} label="Expo push to paired phones" />
        <div className="flex gap-2"><Button>{t('common.save')}</Button><Button type="button" variant="outline" onClick={() => run(async () => { const r = await post<any>('/notify/test'); alert(r.results.length ? r.results.join(', ') : 'No push channel configured yet'); })}><Send className="h-4 w-4" />{t('set.testPush')}</Button></div>
      </form>
    </div>
    {pair && <Modal open onClose={() => { setPair(null); devices.refetch(); }} title={t('set.pair')}>
      <div className="space-y-4 text-center">
        <Field label="Server URL (Tailscale IP of this computer)"><Select value={url} onChange={(e) => setUrl(e.target.value)}>{pair.urls.map((u: any) => <option key={u.url} value={u.url}>{u.url} ({u.kind})</option>)}<option value={url}>{url}</option></Select></Field>
        <Input value={url} onChange={(e) => setUrl(e.target.value)} />
        <div className="inline-block rounded-xl bg-white p-4"><QRCodeSVG value={JSON.stringify({ fa: 1, url, code: pair.code })} size={220} /></div>
        <p className="text-xs text-muted-foreground">Code (manual entry): <code className="font-mono select-all">{pair.code}</code><br />Expires in 10 minutes · single use</p>
      </div></Modal>}
  </Card>;
}
