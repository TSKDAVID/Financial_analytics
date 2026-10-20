import { useState } from 'react';
import { Lock } from 'lucide-react';
import { post, session } from '../lib/api';
import { useT } from '../lib/i18n';
import { Button, Input } from './ui';

export default function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const t = useT();
  const [v, setV] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await post<{ token: string }>('/auth/unlock', { secret: v }); session.set(r.token); onUnlock(); }
    catch (er: any) { setErr(er.message); setV(''); } finally { setBusy(false); }
  };
  return (
    <div className="min-h-screen grid place-items-center bg-gradient-to-br from-primary/10 via-background to-background p-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border bg-card p-8 shadow-xl text-center space-y-5">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/15 text-primary grid place-items-center"><Lock /></div>
        <div><h1 className="text-xl font-semibold">{t('lock.title')}</h1><p className="text-sm text-muted-foreground mt-1">{t('lock.enter')}</p></div>
        <Input autoFocus type="password" value={v} onChange={(e) => setV(e.target.value)} className="text-center text-lg tracking-[0.4em]" />
        {err && <p className="text-sm text-danger">{err}</p>}
        <Button className="w-full" loading={busy} disabled={!v}>{t('lock.unlock')}</Button>
      </form>
    </div>
  );
}
