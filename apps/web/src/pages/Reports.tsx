import { useState } from 'react';
import { FileText, Download } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { endOfMonth } from '@fa/core';
import { useT } from '../lib/i18n';
import { useApi } from '../lib/hooks';
import { get, qs } from '../lib/api';
import { money, pct, today, monthFmt } from '../lib/format';
import { Button, Card, Field, Input, PageHeader, Spinner, Stat, Tabs, Select, th, td, cn } from '../components/ui';

// jsPDF's built-in fonts are Latin-only, so PDFs use plain ASCII text and "GEL" instead of "₾".
const m = (n: number) => `${n < 0 ? '-' : ''}${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GEL`;
const ascii = (s: string) => s.normalize('NFKD').replace(/[^\x20-\x7E]/g, '').trim() || '-';

export async function buildPdf(from: string, to: string, title: string) {
  const r = await get<any>(`/reports${qs({ from, to })}`);
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(79, 70, 229); doc.rect(0, 0, W, 80, 'F');
  doc.setTextColor(255); doc.setFontSize(20); doc.text('Financial Analytics', 40, 38); doc.setFontSize(12); doc.text(`${title}  |  ${from} - ${to}`, 40, 60);
  doc.setTextColor(30);
  const stats = [['Income', m(r.income)], ['Expenses', m(r.expense)], ['Net cash flow', m(r.net)], ['Savings rate', `${(r.savingsRate * 100).toFixed(1)}%`], ['Net worth', m(r.netWorth)], ['Total debt', m(r.totalDebt)], ['Health score', `${r.health.score}/100 (${r.health.grade})`], ['Debt-to-income', `${(r.health.dti * 100).toFixed(1)}%`]];
  autoTable(doc, { startY: 100, head: [['Summary', '']], body: stats, theme: 'grid', headStyles: { fillColor: [79, 70, 229] }, columnStyles: { 1: { halign: 'right' } } });
  const cmp = [['Income', m(r.compare.prev.income), m(r.compare.yoy.income)], ['Expenses', m(r.compare.prev.expense), m(r.compare.yoy.expense)], ['Net', m(r.compare.prev.net), m(r.compare.yoy.net)]];
  autoTable(doc, { head: [['Comparison', 'Previous period', 'Same period last year']], body: cmp, theme: 'striped', headStyles: { fillColor: [99, 102, 241] }, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } } });
  const exp = r.byCategory.filter((c: any) => c.kind === 'expense');
  autoTable(doc, { head: [['Spending by type', 'Amount', 'Share']], body: exp.map((c: any) => [ascii(c.name), m(c.total), `${((c.total / (r.expense || 1)) * 100).toFixed(1)}%`]), theme: 'striped', headStyles: { fillColor: [239, 68, 68] }, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } } });
  const inc = r.byCategory.filter((c: any) => c.kind === 'income');
  if (inc.length) autoTable(doc, { head: [['Income by type', 'Amount']], body: inc.map((c: any) => [ascii(c.name), m(c.total)]), theme: 'striped', headStyles: { fillColor: [16, 185, 129] }, columnStyles: { 1: { halign: 'right' } } });
  if (r.trend.length) autoTable(doc, { head: [['Month', 'Income', 'Expenses', 'Net']], body: r.trend.filter((x: any) => x.month >= from.slice(0, 7) && x.month <= to.slice(0, 7)).map((x: any) => [x.month, m(x.income), m(x.expense), m(x.net)]), theme: 'grid', headStyles: { fillColor: [79, 70, 229] }, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } } });
  autoTable(doc, { head: [['Largest expenses', 'Date', 'Category', 'Amount']], body: r.top.map((x: any) => [ascii(x.description ?? ''), x.date, ascii(x.category ?? ''), m(x.amount_gel)]), theme: 'striped', headStyles: { fillColor: [245, 158, 11] }, columnStyles: { 3: { halign: 'right' } } });
  if (r.budgets.length) autoTable(doc, { head: [['Budget', 'Spent', 'Limit', 'Used']], body: r.budgets.map((b: any) => [ascii(b.name), m(b.spent), m(b.limit), `${Math.round(b.pct * 100)}%`]), theme: 'striped', headStyles: { fillColor: [139, 92, 246] }, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } } });
  autoTable(doc, { head: [['Accounts', 'Balance (GEL)']], body: r.accounts.map((a: any) => [ascii(a.name), m(a.balance_gel)]), theme: 'striped', headStyles: { fillColor: [14, 165, 233] }, columnStyles: { 1: { halign: 'right' } } });
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(140); doc.text(`Generated ${new Date().toLocaleString('en-GB')} - local data, page ${i}/${pages}`, 40, doc.internal.pageSize.getHeight() - 20); }
  doc.save(`finance-report-${from}_${to}.pdf`);
}

export default function Reports() {
  const t = useT();
  const [kind, setKind] = useState<'monthly' | 'yearly' | 'custom'>('monthly');
  const [month, setMonth] = useState(today().slice(0, 7)); const [year, setYear] = useState(today().slice(0, 4));
  const [cf, setCf] = useState(today().slice(0, 8) + '01'); const [ct, setCt] = useState(today());
  const [busy, setBusy] = useState(false);
  const from = kind === 'monthly' ? month + '-01' : kind === 'yearly' ? `${year}-01-01` : cf;
  const to = kind === 'monthly' ? endOfMonth(month + '-01') : kind === 'yearly' ? `${year}-12-31` : ct;
  const r = useApi<any>(`/reports${qs({ from, to })}`);
  const years = Array.from({ length: 6 }, (_, i) => String(Number(today().slice(0, 4)) - i));
  const title = kind === 'monthly' ? `Monthly report ${month}` : kind === 'yearly' ? `Yearly report ${year}` : 'Report';
  return <div className="space-y-6">
    <PageHeader title={t('rep.title')} actions={<Button loading={busy} onClick={async () => { setBusy(true); try { await buildPdf(from, to, title); } finally { setBusy(false); } }}><Download className="h-4 w-4" />{t('rep.download')}</Button>} />
    <Card><div className="flex flex-wrap gap-3 items-end">
      <Tabs value={kind} onChange={setKind} options={[{ value: 'monthly', label: t('rep.monthly') }, { value: 'yearly', label: t('rep.yearly') }, { value: 'custom', label: t('common.custom') }]} />
      {kind === 'monthly' && <Field label={t('common.month')}><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>}
      {kind === 'yearly' && <Field label={t('common.year')}><Select value={year} onChange={(e) => setYear(e.target.value)}>{years.map((y) => <option key={y}>{y}</option>)}</Select></Field>}
      {kind === 'custom' && <><Field label={t('common.from')}><Input type="date" value={cf} onChange={(e) => setCf(e.target.value)} /></Field><Field label={t('common.to')}><Input type="date" value={ct} onChange={(e) => setCt(e.target.value)} /></Field></>}
    </div></Card>
    {!r.data ? <Spinner /> : <>
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4"><Stat label={t('dash.income')} value={money(r.data.income)} /><Stat label={t('dash.expenses')} value={money(r.data.expense)} /><Stat label={t('dash.netCashFlow')} value={money(r.data.net)} /><Stat label={t('dash.savingsRate')} value={pct(r.data.savingsRate, 1)} /></div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('dash.breakdown')}><table className="w-full text-sm"><tbody>{r.data.byCategory.filter((c: any) => c.kind === 'expense').map((c: any) => <tr key={c.name} className="border-t"><td className={td}><span className="inline-block h-2.5 w-2.5 rounded-full mr-2" style={{ background: c.color }} />{c.name}</td><td className={cn(td, 'text-right num')}>{money(c.total)}</td><td className={cn(td, 'text-right num text-muted-foreground')}>{pct(c.total / (r.data.expense || 1), 1)}</td></tr>)}</tbody></table></Card>
        <Card title={t('rep.top')}><table className="w-full text-sm"><tbody>{r.data.top.map((x: any, i: number) => <tr key={i} className="border-t"><td className={td}>{x.description}<div className="text-[11px] text-muted-foreground">{x.date} · {x.category}</div></td><td className={cn(td, 'text-right num font-medium')}>{money(x.amount_gel)}</td></tr>)}</tbody></table></Card>
      </div>
      {kind === 'yearly' && <Card title={t('dash.trends')}><table className="w-full text-sm"><thead><tr><th className={th}>{t('common.month')}</th><th className={cn(th, 'text-right')}>{t('common.income')}</th><th className={cn(th, 'text-right')}>{t('common.expense')}</th><th className={cn(th, 'text-right')}>Net</th></tr></thead>
        <tbody>{r.data.trend.filter((x: any) => x.month.startsWith(year)).map((x: any) => <tr key={x.month} className="border-t num"><td className={td}>{monthFmt(x.month, false)}</td><td className={cn(td, 'text-right text-success')}>{money(x.income)}</td><td className={cn(td, 'text-right')}>{money(x.expense)}</td><td className={cn(td, 'text-right font-medium', x.net < 0 && 'text-danger')}>{money(x.net)}</td></tr>)}</tbody></table></Card>}
      <p className="text-xs text-muted-foreground flex items-center gap-1"><FileText className="h-3 w-3" />PDF is generated locally in your browser.</p>
    </>}
  </div>;
}
