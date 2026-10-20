import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import { setPdfItemExtractor } from '../../../server/src/statements/pdf.native';
import type { RawItem } from '../../../server/src/statements/lines';
import { PDFJS_MAIN, PDFJS_WORKER } from './pdfjs-assets.generated';

/** Hidden WebView running pdf.js; extracts positioned text items, then the shared parser does the rest. */
const HTML = `<!doctype html><html><body><script>
window.__main = ${JSON.stringify(PDFJS_MAIN)}; window.__worker = ${JSON.stringify(PDFJS_WORKER)};
(async () => {
  const mu = URL.createObjectURL(new Blob([window.__main], { type: 'text/javascript' }));
  const wu = URL.createObjectURL(new Blob([window.__worker], { type: 'text/javascript' }));
  const pdfjs = await import(mu); pdfjs.GlobalWorkerOptions.workerSrc = wu;
  const post = (o) => window.ReactNativeWebView.postMessage(JSON.stringify(o));
  window.extract = async (id, b64) => {
    try {
      const bin = atob(b64); const data = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
      const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise; const pages = [];
      for (let p = 1; p <= doc.numPages; p++) { const tc = await (await doc.getPage(p)).getTextContent(); pages.push(tc.items.filter((i) => typeof i.str === 'string').map((i) => ({ x: i.transform[4], y: i.transform[5], w: i.width || 0, str: i.str }))); }
      post({ id, pages });
    } catch (e) { post({ id, error: e && e.name === 'PasswordException' ? 'This PDF is password-protected. Remove the password and try again.' : 'Could not read this file as a PDF.' }); }
  };
  post({ ready: true });
})().catch((e) => window.ReactNativeWebView.postMessage(JSON.stringify({ fatal: String(e) })));
</script></body></html>`;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function bytesToB64(u: Uint8Array): string {
  let out = '';
  for (let i = 0; i < u.length; i += 3) {
    const n = (u[i] << 16) | ((u[i + 1] ?? 0) << 8) | (u[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < u.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < u.length ? B64[n & 63] : '=');
  }
  return out;
}

export function PdfReader() {
  const ref = useRef<WebView>(null);
  const pending = useRef(new Map<string, { res: (p: RawItem[][]) => void; rej: (e: Error) => void }>());
  const ready = useRef<Promise<void>>(); const markReady = useRef<() => void>();
  if (!ready.current) ready.current = new Promise((r) => { markReady.current = r; });
  useEffect(() => {
    setPdfItemExtractor(async (data) => {
      await ready.current;
      const id = Math.random().toString(36).slice(2);
      return new Promise((res, rej) => { pending.current.set(id, { res, rej }); ref.current?.injectJavaScript(`window.extract(${JSON.stringify(id)}, ${JSON.stringify(bytesToB64(data))}); true;`); });
    });
  }, []);
  return <View style={{ width: 0, height: 0, position: 'absolute' }} pointerEvents="none">
    <WebView ref={ref} source={{ html: HTML }} originWhitelist={['*']} javaScriptEnabled onMessage={(e) => {
      const m = JSON.parse(e.nativeEvent.data);
      if (m.ready) markReady.current?.();
      else if (m.id) { const p = pending.current.get(m.id); pending.current.delete(m.id); if (m.error) p?.rej(Object.assign(new Error(m.error), { statusCode: 422 })); else p?.res(m.pages); }
    }} />
  </View>;
}
