// PDF text extraction with positional info (pdf.js legacy build works in Node without a DOM).
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { linesFromItems, StatementError, type Cell, type Line, type RawItem } from './lines';
export { StatementError, type Cell, type Line };

export async function extractLines(data: Uint8Array): Promise<Line[]> {
  let doc;
  try { doc = await getDocument({ data: new Uint8Array(data), useSystemFonts: false, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise; }
  catch (e: any) { throw new StatementError(e?.name === 'PasswordException' ? 'This PDF is password-protected. Remove the password and try again.' : 'Could not read this file as a PDF.'); }
  const pages: RawItem[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    pages.push((tc.items as any[]).filter((i) => typeof i.str === 'string').map((i) => ({ x: i.transform[4], y: i.transform[5], w: i.width ?? 0, str: i.str })));
  }
  await doc.destroy();
  return linesFromItems(pages);
}
