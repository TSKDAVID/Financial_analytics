// Pure line grouping shared by the Node (pdfjs-dist) and Android (WebView) PDF readers.
export interface Cell { x: number; w: number; str: string }
export interface Line { page: number; y: number; cells: Cell[]; text: string }
export interface RawItem { x: number; y: number; w: number; str: string }
export class StatementError extends Error { statusCode = 422; constructor(msg: string) { super(msg); } }

export function linesFromItems(pages: RawItem[][]): Line[] {
  const lines: Line[] = [];
  pages.forEach((raw, idx) => {
    const p = idx + 1;
    const items = raw.filter((i) => i.str && i.str.trim()).map((i) => ({ ...i, str: i.str.replace(/\s+/g, ' ').trim() }));
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const pageLines: { y: number; cells: Cell[] }[] = [];
    for (const it of items) {
      const l = pageLines.find((pl) => Math.abs(pl.y - it.y) <= 2.5);
      if (l) l.cells.push({ x: it.x, w: it.w, str: it.str }); else pageLines.push({ y: it.y, cells: [{ x: it.x, w: it.w, str: it.str }] });
    }
    for (const l of pageLines) {
      l.cells.sort((a, b) => a.x - b.x);
      const merged: Cell[] = [];
      for (const c of l.cells) { const last = merged[merged.length - 1]; if (last && c.x - (last.x + last.w) < 1.5) { last.str += c.str; last.w = c.x + c.w - last.x; } else merged.push({ ...c }); }
      lines.push({ page: p, y: l.y, cells: merged, text: merged.map((c, i) => (i === 0 ? '' : c.x - (merged[i - 1].x + merged[i - 1].w) < 6 ? ' ' : '   ') + c.str).join('') });
    }
  });
  if (!lines.some((l) => /\p{L}{2,}/u.test(l.text))) throw new StatementError('This PDF has no text layer (it looks like a scanned image), so transactions cannot be read. Download the digital statement (PDF) from your internet bank, or export CSV/Excel and use Transactions → Import.');
  return lines;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** Base64 (optionally a data: URL) → bytes, without Node's Buffer (works on the phone too). */
export function b64ToBytes(s: string): Uint8Array {
  const str = s.replace(/^data:[^,]*,/, '').replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((str.length * 3) / 4)); let o = 0, buf = 0, bits = 0;
  for (let i = 0; i < str.length; i++) { buf = (buf << 6) | B64.indexOf(str[i]); bits += 6; if (bits >= 8) { bits -= 8; out[o++] = (buf >> bits) & 0xff; } }
  return out.subarray(0, o);
}
