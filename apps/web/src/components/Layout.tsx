import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Users, LayoutDashboard, ArrowLeftRight, Repeat, Wallet, Tags, Landmark, CalendarClock, PiggyBank, LineChart, ShieldAlert, Bell, FileText, Settings, Plus, FileUp, RefreshCw, Moon, Sun, Lock, Menu, X, Keyboard, Languages, Store } from 'lucide-react';
import { useT, setLang, getLang } from '../lib/i18n';
import { useApi, setTheme, useTheme, isDark } from '../lib/hooks';
import { post, session } from '../lib/api';
import { Button, Modal, cn } from './ui';
import TxDialog from './TxDialog';
import { SyncPrompt } from './SyncPrompt';

const NAV = [
  { group: 'nav.group.money', items: [
    { to: '/', key: 'nav.dashboard', icon: LayoutDashboard, sc: 'd' }, { to: '/transactions', key: 'nav.transactions', icon: ArrowLeftRight, sc: 't' },
    { to: '/recurring', key: 'nav.recurring', icon: Repeat, sc: 'r' }, { to: '/accounts', key: 'nav.accounts', icon: Wallet, sc: 'a' }, { to: '/categories', key: 'nav.categories', icon: Tags, sc: 'c' } ] },
  { group: 'nav.group.plan', items: [
    { to: '/loans', key: 'nav.loans', icon: Landmark, sc: 'l' }, { to: '/subscriptions', key: 'nav.subscriptions', icon: CalendarClock, sc: 's' }, { to: '/budgets', key: 'nav.budgets', icon: PiggyBank, sc: 'b' },
    { to: '/forecast', key: 'nav.forecast', icon: LineChart, sc: 'f' }, { to: '/risk', key: 'nav.risk', icon: ShieldAlert, sc: 'k' } ] },
  { group: 'nav.group.app', items: [ { to: '/import', key: 'nav.import', icon: FileUp, sc: 'i' }, { to: '/people', key: 'nav.people', icon: Users }, { to: '/merchants', key: 'nav.merchants', icon: Store }, { to: '/sync', key: 'nav.sync', icon: RefreshCw, sc: 'y' }, { to: '/alerts', key: 'nav.alerts', icon: Bell, sc: 'n' }, { to: '/reports', key: 'nav.reports', icon: FileText, sc: 'p' }, { to: '/settings', key: 'nav.settings', icon: Settings, sc: ',' } ] },
];

export function openNewTx() { window.dispatchEvent(new Event('fa:newtx')); }

export default function Layout() {
  const t = useT(); useTheme();
  const nav = useNavigate(); const loc = useLocation();
  const [mobile, setMobile] = useState(false);
  const [txOpen, setTxOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const alerts = useApi<{ items: any[]; unread: number }>('/alerts', { refetchInterval: 60000 });
  const settings = useApi<Record<string, string>>('/settings');
  const gPressed = useRef(0);

  useEffect(() => { setMobile(false); }, [loc.pathname]);
  useEffect(() => { const f = () => setTxOpen(true); window.addEventListener('fa:newtx', f); return () => window.removeEventListener('fa:newtx', f); }, []);
  // keyboard shortcuts
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return;
      if (Date.now() - gPressed.current < 1200) {
        const item = NAV.flatMap((g) => g.items).find((i) => i.sc === e.key);
        gPressed.current = 0; if (item) { e.preventDefault(); nav(item.to); } return;
      }
      if (e.key === 'g') gPressed.current = Date.now();
      else if (e.key === 'n') { e.preventDefault(); setTxOpen(true); }
      else if (e.key === '/') { e.preventDefault(); nav('/transactions?focus=1'); setTimeout(() => document.getElementById('tx-search')?.focus(), 50); }
      else if (e.key === '?') setHelp(true);
      else if (e.key === 'T') setTheme(isDark() ? 'light' : 'dark');
    };
    window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f);
  }, [nav]);
  // desktop notifications for new alerts
  useEffect(() => {
    if (!alerts.data || settings.data?.desktopNotifications === '0' || !('Notification' in window) || Notification.permission !== 'granted') return;
    const seen = new Set<number>(JSON.parse(localStorage.getItem('fa.notified') ?? '[]'));
    const fresh = alerts.data.items.filter((a) => !a.read && !seen.has(a.id));
    for (const a of fresh.slice(0, 5)) { const n = new Notification(a.title, { body: a.body, icon: '/favicon.svg', tag: `fa-${a.id}` }); n.onclick = () => { window.focus(); nav('/alerts'); }; }
    for (const a of alerts.data.items) seen.add(a.id);
    localStorage.setItem('fa.notified', JSON.stringify([...seen].slice(-500)));
  }, [alerts.data]);

  const lock = async () => { await post('/auth/lock'); session.set(null); window.dispatchEvent(new Event('fa:locked')); };
  const sidebar = (
    <nav className="flex h-full flex-col gap-6 overflow-y-auto p-4">
      <div className="flex items-center gap-2.5 px-2">
        <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 grid place-items-center text-white shadow-lg shadow-indigo-500/30"><LineChart className="h-5 w-5" /></div>
        <div><div className="font-bold leading-tight">Financial</div><div className="text-[11px] text-muted-foreground -mt-0.5">Analytics · ₾</div></div>
      </div>
      {NAV.map((g) => (
        <div key={g.group}>
          <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">{t(g.group)}</div>
          <div className="space-y-0.5">{g.items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.to === '/'} className={({ isActive }) => cn('flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition', isActive ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
              <i.icon className="h-4 w-4" /><span className="flex-1">{t(i.key)}</span>
              {i.to === '/alerts' && !!alerts.data?.unread && <span className="rounded-full bg-danger px-1.5 text-[10px] font-semibold text-white">{alerts.data.unread}</span>}
            </NavLink>))}</div>
        </div>))}
      <div className="mt-auto text-[11px] text-muted-foreground px-3">🔒 Local data · {settings.data?.baseCurrency ?? 'GEL'}</div>
    </nav>
  );
  return (
    <div className="flex min-h-screen">
      <aside className="hidden lg:block w-64 shrink-0 border-r bg-card/50 sticky top-0 h-screen">{sidebar}</aside>
      {mobile && <div className="lg:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setMobile(false)}><aside className="w-72 h-full bg-card" onClick={(e) => e.stopPropagation()}>{sidebar}</aside></div>}
      <div className="flex-1 min-w-0">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b bg-background/80 backdrop-blur px-4 lg:px-8 h-14">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobile(!mobile)}>{mobile ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</Button>
          <div className="flex-1" />
          <Button variant="ghost" size="icon" title={t('set.shortcuts')} onClick={() => setHelp(true)}><Keyboard className="h-4 w-4" /></Button>
          <Button variant="ghost" size="sm" title={t('set.language')} onClick={() => setLang(getLang() === 'en' ? 'ka' : 'en')}><Languages className="h-4 w-4" />{getLang() === 'en' ? 'ქა' : 'EN'}</Button>
          <Button variant="ghost" size="icon" title={t('set.theme')} onClick={() => setTheme(isDark() ? 'light' : 'dark')}>{isDark() ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</Button>
          <Button variant="ghost" size="icon" title={t('nav.alerts')} onClick={() => nav('/alerts')} className="relative"><Bell className="h-4 w-4" />{!!alerts.data?.unread && <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-danger" />}</Button>
          {settings.data?.lockEnabled && <Button variant="ghost" size="icon" title={t('lock.lockNow')} onClick={lock}><Lock className="h-4 w-4" /></Button>}
          <Button onClick={() => setTxOpen(true)} size="sm"><Plus className="h-4 w-4" /><span className="hidden sm:inline">{t('tx.new')}</span></Button>
        </header>
        <main className="p-4 lg:p-8 max-w-[1500px] mx-auto"><Outlet /></main>
      </div>
      <SyncPrompt />
      <TxDialog open={txOpen} onClose={() => setTxOpen(false)} />
      <Modal open={help} onClose={() => setHelp(false)} title={t('set.shortcuts')}>
        <div className="space-y-2 text-sm">
          {[['n', t('sc.newTx')], ['/', t('sc.search')], ['?', t('sc.help')], ['Shift+T', t('sc.theme')], ['Esc', t('common.close')]].map(([k, l]) => <Row key={k} k={k} l={l} />)}
          <div className="pt-2 text-xs font-semibold text-muted-foreground">{t('sc.goto')}</div>
          {NAV.flatMap((g) => g.items).map((i) => <Row key={i.to} k={`g ${i.sc}`} l={t(i.key)} />)}
        </div>
      </Modal>
    </div>
  );
}
const Row = ({ k, l }: { k: string; l: string }) => <div className="flex justify-between"><span>{l}</span><kbd className="rounded border bg-muted px-2 py-0.5 text-xs font-mono">{k}</kbd></div>;
