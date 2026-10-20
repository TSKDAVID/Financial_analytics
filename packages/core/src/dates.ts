/** Date helpers operating on ISO `YYYY-MM-DD` strings in UTC to avoid timezone drift. */
export type ISODate = string;

export function parseISO(d: ISODate): Date {
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}
export function toISO(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}
export function todayISO(now: Date = new Date()): ISODate {
  // local calendar date
  const y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
export function addDays(d: ISODate, n: number): ISODate {
  const x = parseISO(d);
  x.setUTCDate(x.getUTCDate() + n);
  return toISO(x);
}
function daysInMonth(y: number, m0: number): number {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}
/** Add months, clamping to the end of month while preserving the anchor day. */
export function addMonths(d: ISODate, n: number, anchorDay?: number): ISODate {
  const x = parseISO(d);
  const day = anchorDay ?? x.getUTCDate();
  const total = x.getUTCFullYear() * 12 + x.getUTCMonth() + n;
  const y = Math.floor(total / 12), m0 = total - y * 12;
  return toISO(new Date(Date.UTC(y, m0, Math.min(day, daysInMonth(y, m0)))));
}
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000);
}
export function monthKey(d: ISODate): string { return d.slice(0, 7); }
export function startOfMonth(d: ISODate): ISODate { return d.slice(0, 7) + '-01'; }
export function endOfMonth(d: ISODate): ISODate { return addDays(addMonths(startOfMonth(d), 1), -1); }
export function monthsBetween(a: ISODate, b: ISODate): string[] {
  const out: string[] = [];
  let cur = startOfMonth(a);
  while (cur <= b) { out.push(monthKey(cur)); cur = addMonths(cur, 1); }
  return out;
}
