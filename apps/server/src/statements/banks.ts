/**
 * Exact layout parsers for Bank of Georgia and TBC PDF statements. They are checked against real statements:
 * every row is parsed, and opening balance + rows = closing balance per currency. BOG also checks daily balances
 * and in/out totals; TBC also checks the running balance on every row.
 */
import type { Line, Cell } from './pdf';
import type { ParsedRow, ParseResult, Verification } from './parse';

const DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const iso = (s: string) => { const m = s.match(DATE)!; return `${m[3]}-${m[2]}-${m[1]}`; };
const num = (s: string) => Number(s.replace(/[\s,]/g, ''));
const isNum = (s: string) => /^-?[\d,]+(\.\d+)?$/.test(s.trim());
const ctr = (c: Cell) => c.x + c.w / 2;
const r2 = (n: number) => Math.round(n * 100) / 100;
const IBAN = /\bGE\d{2}[A-Z]{2}\d{16}\b/;
const MON: Record<string, string> = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };

function verifyTotals(cur: string, opening: number, closing: number, rows: ParsedRow[], extra: Partial<Verification> = {}): Verification {
  const sum = r2(rows.filter((r) => r.currency === cur).reduce((s, r) => s + (r.kind === 'income' ? r.amount : -r.amount), 0));
  return { currency: cur, opening, closing, sum, count: rows.filter((r) => r.currency === cur).length, ok: Math.abs(r2(opening + sum) - closing) < 0.005 && extra.ok !== false, ...extra, ...(extra.ok === false ? { ok: false } : {}) };
}

// ------------------------------------------------------------------ Bank of Georgia
export function isBog(lines: Line[]) { return lines.slice(0, 40).some((l) => /ანგარიშიდან ამონაწერი/.test(l.text)) && lines.some((l) => /BAGAGE22|ბარათის No:|საქართველოს ბანკ/.test(l.text)); }

/** Pull structured fields out of a BOG description (merchant, MCC, card, counterparty, purpose, operation type). */
export function bogFields(desc: string) {
  const f: Partial<ParsedRow> = {};
  const op = desc.match(/^(.+?)(?:\s+-\s+თანხა|,)/); f.opType = (op?.[1] ?? desc.split(';')[0]).trim().slice(0, 60);
  const mcc = desc.match(/MCC:\s*(\d{4})/); if (mcc) f.mcc = mcc[1];
  const card = desc.match(/ბარათის No:\s*\*+(\d{4})/); if (card) f.card = card[1];
  const t = desc.match(/თარიღი:\s*(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2})/); if (t) f.time = `${t[3]}-${t[2]}-${t[1]}T${t[4]}`;
  const obj = desc.match(/(?:ობიექტი|ბანკომატი):\s*([^;]+)/); if (obj) f.merchant = obj[1].split(/,\s/)[0].trim();
  const transit = desc.match(/(თბილისის|ზუგდიდის|ბათუმის|ქუთაისის|რუსთავის)\s+(მეტრო|ავტობუსი|მიკროავტობუსი|საბაგირო)/); if (transit) f.merchant = `${transit[1]} ${transit[2]}`;
  const cp = desc.match(/(მიმღები|გადმომრიცხავი|შემომტანი):\s*([^;,]+)/); if (cp) f.counterparty = cp[2].trim();
  const acc = desc.match(/ანგარიში:\s*(GE\d{2}[A-Z]{2}\d{16})/); if (acc) f.counterpartyAccount = acc[1];
  const dep = desc.match(/ანაბრის ნომერი:\s*(GE\d{2}[A-Z]{2}\d{16})/); if (dep) f.counterpartyAccount = dep[1];
  const purpose = desc.match(/დანიშნულება:\s*(.+)$/); if (purpose) f.purpose = purpose[1].trim();
  const pay = desc.match(/^გადახდა, \d{2}\/\d{2}\/\d{4} , ([^,]+),/) ?? desc.match(/გადახდა, \d{2}\/\d{2}\/\d{4} , ([^,]+),/); if (pay) { f.merchant = pay[1].replace(/^(შპს|სს|სსიპ|ი\/მ)\s+/, '').replace(/["„“]/g, '').trim(); f.opType = 'გადახდა (სერვისი)'; }
  const cb = desc.match(/აქციის პარტნიორი:\s*([^,]+)/); if (cb) f.merchant = cb[1].trim();
  return f;
}
/** Human description: drop the "operation - amount;" prefix and technical tails. */
export function bogClean(desc: string) {
  return desc.replace(/^[^;]*?-\s*თანხა:?\s*[A-Z]{3}[\d.]*;\s*/, '').replace(/^გადახდა\s*-\s*თანხა:?\s*[A-Z]{3}[\d.]*;\s*/, '')
    .replace(/;?\s*თარიღი:\s*\d{2}\/\d{2}\/\d{4}[\s\d:]*/g, '').replace(/;?\s*ბარათის No:\s*\*+\d{4}(\s*\([^)]*\))?/g, '')
    .replace(/;?\s*გადახდის ოპერაციის თანხა და ვალუტა:.*$/, '').replace(/;?\s*ბანკი:[^;]*/g, '').replace(/;?\s*აბონენტი:[^;]*/g, '')
    .replace(/\s{2,}/g, ' ').replace(/[;\s]+$/, '').trim();
}

export function parseBog(lines: Line[]): ParseResult {
  const warnings: string[] = []; const rows: ParsedRow[] = [];
  const after = (label: RegExp) => { for (const l of lines.slice(0, 40)) { const i = l.cells.findIndex((c) => label.test(c.str)); if (i >= 0) return l.cells.slice(i + 1).map((c) => c.str).join(' ').trim(); } return null; };
  const holder = after(/ანგარიშის მფლობელი/); const account = after(/ანგარიშის ნომერი/); const period = after(/ამონაწერის პერიოდი/);
  const head = lines.find((l) => l.cells.filter((c) => /^(GEL|USD|EUR|GBP|CHF|TRY)$/.test(c.str)).length >= 2);
  if (!head) throw new Error('BOG: currency columns not found');
  const cols = head.cells.filter((c) => /^[A-Z]{3}$/.test(c.str)).map((c) => ({ cur: c.str, x: ctr(c) }));
  const curOf = (c: Cell) => cols.reduce((b, k) => (Math.abs(k.x - ctr(c)) < Math.abs(b.x - ctr(c)) ? k : b)).cur;
  const amountCells = (l: Line) => l.cells.filter((c) => c.x > cols[0].x - 40 && isNum(c.str));
  const vec = (l: Line) => Object.fromEntries(amountCells(l).map((c) => [curOf(c), num(c.str)]));
  let opening: Record<string, number> = {}, closing: Record<string, number> = {}, totalsIn: Record<string, number> = {}, totalsOut: Record<string, number> = {};
  const running: Record<string, number> = {}; let dailyBad = 0, dailyChecks = 0;
  let cur: { date: string; parts: string[]; amount: number; currency: string; page: number } | null = null;
  const flush = () => {
    if (!cur) return;
    const raw = cur.parts.join(' ').replace(/\s+/g, ' ').trim();
    const f = bogFields(raw);
    rows.push({ date: cur.date, description: bogClean(raw) || raw, amount: r2(Math.abs(cur.amount)), currency: cur.currency, kind: cur.amount < 0 ? 'expense' : 'income', raw, page: cur.page, ...f });
    running[cur.currency] = r2((running[cur.currency] ?? 0) + cur.amount); cur = null;
  };
  for (const l of lines) {
    const c0 = l.cells[0]?.str ?? '';
    if (/საწყისი ნაშთი/.test(l.text)) { opening = vec(l); Object.assign(running, opening); continue; }
    if (/საბოლოო ნაშთი/.test(l.text)) { closing = vec(l); continue; }
    if (/შემოსული თანხების ჯამი/.test(l.text)) { flush(); totalsIn = vec(l); continue; }
    if (/გასული თანხების ჯამი/.test(l.text)) { flush(); totalsOut = vec(l); continue; }
    if (/^გვ\. \d+/.test(c0) || /\(სულ \d+ გვ\.\)/.test(l.text) || (c0 === 'თარიღი' && /დანიშნულება/.test(l.text)) || l === head) continue;
    if (c0 === 'ნაშთი') { flush(); const v = vec(l); for (const [k, val] of Object.entries(v)) { dailyChecks++; if (Math.abs((running[k] ?? 0) - val) > 0.005) { dailyBad++; running[k] = val; } } continue; }
    if (DATE.test(c0) && l.cells[0].x < 80 && l.cells.length > 1) {
      flush();
      const amt = amountCells(l).at(-1);
      if (!amt) { warnings.push(`p${l.page}: row without amount`); continue; }
      cur = { date: iso(c0), parts: l.cells.filter((c) => c !== l.cells[0] && c !== amt).map((c) => c.str), amount: num(amt.str), currency: curOf(amt), page: l.page };
      continue;
    }
    if (cur) cur.parts.push(...l.cells.filter((c) => c.x < cols[0].x - 40).map((c) => c.str));
  }
  flush();
  const verification = cols.map((k) => {
    const its = rows.filter((r) => r.currency === k.cur);
    const inSum = r2(its.filter((r) => r.kind === 'income').reduce((s, r) => s + r.amount, 0)), outSum = r2(its.filter((r) => r.kind === 'expense').reduce((s, r) => s + r.amount, 0));
    const totalsOk = (totalsIn[k.cur] == null || Math.abs(totalsIn[k.cur] - inSum) < 0.01) && (totalsOut[k.cur] == null || Math.abs(totalsOut[k.cur] - outSum) < 0.01);
    return verifyTotals(k.cur, opening[k.cur] ?? 0, closing[k.cur] ?? 0, rows, { totalIn: inSum, totalOut: outSum, ok: totalsOk });
  });
  if (dailyBad) warnings.push(`${dailyBad} of ${dailyChecks} daily balances did not match`);
  for (const v of verification) if (!v.ok) warnings.push(`${v.currency}: opening ${v.opening} + rows ${v.sum} ≠ closing ${v.closing}`);
  const pm = period?.match(/(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/);
  return { bank: 'Bank of Georgia', format: 'bog', currency: 'GEL', rows, periodFrom: pm ? iso(pm[1]) : rows[0]?.date ?? null, periodTo: pm ? iso(pm[2]) : rows.at(-1)?.date ?? null, warnings,
    holder: holder ?? undefined, account: account?.match(IBAN)?.[0], verification, dailyChecks, dailyMismatches: dailyBad };
}

// ------------------------------------------------------------------ TBC
export function isTbc(lines: Line[]) { return lines.slice(0, 60).some((l) => /Account Statement|ამონაწერი ანგარიშიდან/.test(l.text)) && lines.some((l) => /Paid Out|გასული/.test(l.text)) && lines.some((l) => /TBCBGE22|თიბისი/.test(l.text)); }

export function tbcFields(desc: string, add: string) {
  const f: Partial<ParsedRow> = {};
  const pos = desc.match(/^(POS wallet|POS|ATM CASH|Transaction Fee)\s*-\s*(.+?),\s*(?:(-?[\d.]+)\s+([A-Z]{3}),\s*)?([A-Z][a-z]{2}) (\d{1,2}) (\d{4}) (\d{1,2}):(\d{2})(AM|PM)/);
  if (pos) {
    f.opType = pos[1]; f.merchant = pos[2].trim();
    let h = +pos[8] % 12; if (pos[10] === 'PM') h += 12;
    f.time = `${pos[7]}-${MON[pos[5]]}-${pos[6].padStart(2, '0')}T${String(h).padStart(2, '0')}:${pos[9]}`;
    if (pos[4] && pos[3]) { f.origAmount = Number(pos[3]); f.origCurrency = pos[4]; }
    const mcc = desc.match(/MCC:\s*(\d{4})/); if (mcc) f.mcc = mcc[1];
    const card = desc.match(/\d{6}\*+(\d{4})/); if (card) f.card = card[1];
    const cat = desc.match(/(?:AM|PM),\s*(.*?),\s*MCC/); if (cat) f.bankCategory = cat[1].trim();
    return f;
  }
  const parts = add.split(/,\s*/);
  const acc = add.match(IBAN); if (acc) f.counterpartyAccount = acc[0];
  if (/;/.test(desc) && /თანხა:/.test(desc)) { // pay-service bill: "GWP;5881110;თანხა:4.52"
    f.opType = /^საკომისიო:/.test(desc) ? 'საკომისიო (სერვისი)' : 'გადახდა (სერვისი)';
    f.merchant = desc.replace(/^საკომისიო:\s*/, '').split(';')[0].trim();
    const prov = add.match(/სატრანზიტო ანგარიში\s*-\s*([^,]+)/); if (prov) f.provider = prov[1].trim();
    return f;
  }
  f.opType = desc.split(/[;,.(]/)[0].trim().slice(0, 60);
  if (parts.length >= 2 && !/^(სს "თიბისი ბანკი"|სს თიბისი ბანკი)$/.test(parts[0]) && !/ანგარიში|დებიტორ|საცალო|დარიცხული|ვადიანი|ხარჯები|სატრანზიტო|ძირითადი თანხა|საკომისიო|P2P/.test(parts[0])) f.counterparty = parts[0].trim();
  f.purpose = desc.trim();
  return f;
}

export function parseTbc(lines: Line[]): ParseResult {
  const warnings: string[] = []; const rows: ParsedRow[] = [];
  const cellAfter = (re: RegExp) => { for (const l of lines.slice(0, 60)) { const i = l.cells.findIndex((c) => re.test(c.str)); if (i >= 0 && l.cells[i + 1]) return l.cells.slice(i + 1); } return null; };
  const holder = cellAfter(/ანგარიშის მფლობელი/)?.[0]?.str; const holderLatin = cellAfter(/Account Holder/)?.[0]?.str;
  const accLine = lines.findIndex((l) => /ამონაწერი ანგარიშიდან/.test(l.text));
  const account = lines[accLine + 1]?.text.match(IBAN)?.[0];
  const dates = lines[accLine + 1]?.cells.map((c) => c.str).filter((s) => DATE.test(s)) ?? [];
  const balOf = (re: RegExp) => { const c = cellAfter(re); return c ? { v: num(c[0].str), cur: c[1]?.str ?? 'GEL' } : null; };
  const open = balOf(/Opening Balance/), close = balOf(/Closing Balance/);
  const tIn = balOf(/Total Paid in/), tOut = balOf(/Total Paid out/);
  const currency = open?.cur ?? 'GEL';
  const hdr = lines.find((l) => l.cells.some((c) => c.str === 'გასული') && l.cells.some((c) => c.str === 'ბალანსი'));
  if (!hdr) throw new Error('TBC: table header not found');
  const hx = (s: string) => ctr(hdr.cells.find((c) => c.str === s)!);
  const outX = hx('გასული'), inX = hx('შემოსული'), balX = hx('ბალანსი'), addX = hdr.cells.find((c) => /დამატებითი/.test(c.str))!.x;
  let cur: { date: string; desc: string[]; add: string[]; out?: number; in?: number; bal?: number; page: number } | null = null;
  let descX = 0, addStart = 0; let prevBal = open?.v ?? 0; let balBad = 0;
  const flush = () => {
    if (!cur) return;
    const desc = cur.desc.join(' ').replace(/\s+/g, ' ').trim(), add = cur.add.join(' ').replace(/\s+/g, ' ').trim();
    const amount = cur.out ?? cur.in ?? 0; const kind = cur.out != null ? 'expense' : 'income';
    if (cur.bal != null) { if (Math.abs(r2(prevBal + (kind === 'income' ? amount : -amount)) - cur.bal) > 0.005) balBad++; prevBal = cur.bal; }
    rows.push({ date: cur.date, description: desc.replace(/,\s*(MC|VISA),?\s*\d{6}\*+\d{4}$/, '').replace(/,\s*\d{6}\*+\d{4}$/, ''), amount: r2(amount), currency, kind, raw: `${desc} || ${add}`, page: cur.page, balance: cur.bal, ...tbcFields(desc, add) });
    cur = null;
  };
  for (const l of lines) {
    if (l.page === 1 && l.y > hdr.y + 5) continue;
    const cs = l.cells; const c0 = cs[0]?.str ?? '';
    if (/^(თარიღი|Date)$/.test(c0) || cs.some((c) => c.str === 'Paid Out')) continue;
    if (DATE.test(c0) && cs[0].x < 80 && cs.length > 1) {
      flush(); cur = { date: iso(c0), desc: [], add: [], page: l.page };
      if (!descX) { descX = cs[1].x; addStart = cs.find((c) => c.x > descX + 150 && c.x < outX - 30)?.x ?? addX - 60; }
    } else if (!cur) continue;
    for (const c of DATE.test(c0) && cs[0].x < 80 ? cs.slice(1) : cs) {
      if (isNum(c.str) && c.x > outX - 40) {
        const d = { out: Math.abs(ctr(c) - outX), in: Math.abs(ctr(c) - inX), bal: Math.abs(ctr(c) - balX) };
        const k = d.out <= d.in && d.out <= d.bal ? 'out' : d.in <= d.bal ? 'in' : 'bal';
        cur![k] = num(c.str);
      } else if (c.x < addStart - 5) cur!.desc.push(c.str); else cur!.add.push(c.str);
    }
  }
  flush();
  const v = verifyTotals(currency, open?.v ?? 0, close?.v ?? 0, rows);
  const inSum = r2(rows.filter((r) => r.kind === 'income').reduce((s, r) => s + r.amount, 0)), outSum = r2(rows.filter((r) => r.kind === 'expense').reduce((s, r) => s + r.amount, 0));
  v.totalIn = inSum; v.totalOut = outSum;
  if (tIn && Math.abs(tIn.v - inSum) > 0.01) { v.ok = false; warnings.push(`Paid in ${inSum} ≠ statement total ${tIn.v}`); }
  if (tOut && Math.abs(tOut.v - outSum) > 0.01) { v.ok = false; warnings.push(`Paid out ${outSum} ≠ statement total ${tOut.v}`); }
  if (balBad) { v.ok = false; warnings.push(`${balBad} rows break the running balance`); }
  if (!v.ok && !warnings.length) warnings.push(`${currency}: opening ${v.opening} + rows ${v.sum} ≠ closing ${v.closing}`);
  return { bank: 'TBC Bank', format: 'tbc', currency, rows, periodFrom: dates[0] ? iso(dates[0]) : rows[0]?.date ?? null, periodTo: dates[1] ? iso(dates[1]) : rows.at(-1)?.date ?? null, warnings,
    holder: holder ?? undefined, holderLatin: holderLatin ?? undefined, account, verification: [v], runningChecks: rows.length, dailyMismatches: balBad };
}
