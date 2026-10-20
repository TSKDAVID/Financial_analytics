import { money } from '../lib/format';
import { Card } from './ui';

export const RECON_LABELS: Record<string, string> = {
  income: 'Income', spending: 'Spending (incl. rent, cash, fees)', debt: 'Loan & card payments', people: 'Friends (sent − received back)',
  savings: 'Moved to savings (piggy bank / deposit)', ownOther: 'Your other accounts not in the app', unlinked: 'Entries not on any account (no balance effect)',
};

/** "Does income − expenses explain how my balances moved?" — start balance, each line, end balance. */
export function ReconciliationCard({ r }: { r: any }) {
  if (!r || !r.accounts?.length) return null;
  const lines = r.lines.filter((l: any) => Math.abs(l.amount) >= 0.005);
  return <Card title="Where the money went" subtitle="Your account balances, start → end of the period, explained line by line">
    <div className="grid gap-4 md:grid-cols-2 text-sm">
      <table className="w-full"><tbody>
        <tr className="border-b"><td className="py-1.5 text-muted-foreground">Start balance</td><td className="text-right num">{money(r.start)}</td></tr>
        {lines.map((l: any) => <tr key={l.key}><td className="py-1">{RECON_LABELS[l.key] ?? l.key}</td><td className={'text-right num ' + (l.amount >= 0 ? 'text-emerald-600' : 'text-red-500')}>{money(l.amount, 'GEL', { sign: true })}</td></tr>)}
        {Math.abs(r.unexplained) >= 0.01 && <tr><td className="py-1 text-amber-600">Not explained (check for missing statements)</td><td className="text-right num text-amber-600">{money(r.unexplained, 'GEL', { sign: true })}</td></tr>}
        <tr className="border-t font-semibold"><td className="py-1.5">End balance</td><td className="text-right num">{money(r.end)}</td></tr>
        <tr><td className="py-1 text-muted-foreground">Real change</td><td className="text-right num">{money(r.change, 'GEL', { sign: true })}</td></tr>
      </tbody></table>
      <div className="space-y-2">
        {r.accounts.map((a: any) => <div key={a.id} className="flex justify-between rounded-lg border px-3 py-2"><span>{a.name}</span><span className="num text-muted-foreground">{money(a.start)} → <b className="text-foreground">{money(a.end)}</b></span></div>)}
        <p className="text-xs text-muted-foreground">Income − expenses = <b className="num">{money(r.incomeMinusExpenses, 'GEL', { sign: true })}</b>. Money from your own accounts that are not added to the app (e.g. a business account) and money moved to savings change your balances without being income or spending.</p>
      </div>
    </div>
  </Card>;
}
