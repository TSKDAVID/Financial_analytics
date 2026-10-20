// PDF text extraction with positional info (pdf.js legacy build works in Node without a DOM).
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface Cell { x: number; w: number; str: string }
export interface Line { page: number; y: number; cells: Cell[]; text: string }

export class StatementError extends Error { statusCode = 422; constructor(msg: string) { super(msg); } }

export async function extractLines(data: Uint8Array): Promise<Line[]> {
  let doc;
  try { doc = await getDocument({ data: new Uint8Array(data), useSystemFonts: false, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise; }
  catch (e: any) { throw new StatementError(e?.name === 'PasswordException' ? 'This PDF is password-protected. Remove the password and try again.' : 'Could not read this file as a PDF.'); }
  const lines: Line[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items = (tc.items as any[]).filter((i) => typeof i.str === 'string' && i.str.trim()).map((i) => ({ x: i.transform[4] as number, y: i.transform[5] as number, w: (i.width as number) ?? 0, str: (i.str as string).replace(/\s+/g, ' ').trim() }));
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const pageLines: { y: number; cells: Cell[] }[] = [];
    for (const it of items) {
      const l = pageLines.find((pl) => Math.abs(pl.y - it.y) <= 2.5);
      if (l) l.cells.push({ x: it.x, w: it.w, str: it.str }); else pageLines.push({ y: it.y, cells: [{ x: it.x, w: it.w, str: it.str }] });
    }
    for (const l of pageLines) {
      l.cells.sort((a, b) => a.x - b.x);
      // merge cells that touch (pdf.js often splits words)
      const merged: Cell[] = [];
      for (const c of l.cells) { const last = merged[merged.length - 1]; if (last && c.x - (last.x + last.w) < 1.5) { last.str += c.str; last.w = c.x + c.w - last.x; } else merged.push({ ...c }); }
      lines.push({ page: p, y: l.y, cells: merged, text: merged.map((c) => c.str).join('  ') });
    }
  }
  await doc.destroy();
  if (!lines.some((l) => /\p{L}{2,}/u.test(l.text)) ) throw new StatementError('This PDF has no text layer (it looks like a scanned image), so transactions cannot be read. Download the digital statement (PDF) from your internet bank, or export CSV/Excel and use Transactions → Import.');
  return lines;
}
