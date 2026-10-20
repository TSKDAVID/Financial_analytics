// Android: PDF text is extracted by pdf.js running inside a hidden WebView (registered by the app at startup).
import { linesFromItems, StatementError, type Cell, type Line, type RawItem } from './lines';
export { StatementError, type Cell, type Line };
let extractor: ((data: Uint8Array) => Promise<RawItem[][]>) | null = null;
export function setPdfItemExtractor(fn: (data: Uint8Array) => Promise<RawItem[][]>) { extractor = fn; }
export async function extractLines(data: Uint8Array): Promise<Line[]> {
  if (!extractor) throw new StatementError('PDF reader is not ready yet — try again in a moment.');
  return linesFromItems(await extractor(data));
}
