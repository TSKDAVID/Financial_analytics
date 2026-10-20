/** A tiny in-process stand-in for Fastify: the server's route handlers are registered here and called directly. */
type Handler = (req: any, reply: any) => unknown;
interface Route { method: string; parts: string[]; handler: Handler }
export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }

export class LocalApp {
  routes: Route[] = [];
  private add(method: string, path: string, handler: Handler) { this.routes.push({ method, parts: path.split('/').filter(Boolean), handler }); }
  get(p: string, h: Handler) { this.add('GET', p, h); } post(p: string, h: Handler) { this.add('POST', p, h); }
  put(p: string, h: Handler) { this.add('PUT', p, h); } delete(p: string, h: Handler) { this.add('DELETE', p, h); }
  patch(p: string, h: Handler) { this.add('PATCH', p, h); }
  addHook() { /* auth hooks are desktop-only */ } setErrorHandler() { /* handled in inject */ } register() { return Promise.resolve(); }
  log = { error: (e: unknown) => console.warn(e), info: () => undefined };

  async inject(method: string, url: string, body?: unknown): Promise<any> {
    const [path, qs] = url.split('?');
    const segs = path.split('/').filter(Boolean);
    let match: { r: Route; params: Record<string, string> } | null = null;
    for (const r of this.routes) {
      if (r.method !== method || r.parts.length !== segs.length) continue;
      const params: Record<string, string> = {}; let ok = true;
      for (let i = 0; i < segs.length; i++) { const p = r.parts[i]; if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(segs[i]); else if (p !== segs[i]) { ok = false; break; } }
      // prefer static routes over parameterised ones
      if (ok && (!match || r.parts.filter((p) => p.startsWith(':')).length < match.r.parts.filter((p) => p.startsWith(':')).length)) match = { r, params };
    }
    if (!match) throw new ApiError(`Not found: ${method} ${path}`, 404);
    const query: Record<string, string> = {};
    if (qs) for (const kv of qs.split('&')) { const [k, v = ''] = kv.split('='); if (k) query[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' ')); }
    let status = 200; let sent: any;
    const reply = { code(n: number) { status = n; return reply; }, status(n: number) { status = n; return reply; }, send(o: any) { sent = o; return reply; }, header() { return reply; } };
    const req = { method, url, params: match.params, query, body: body ?? undefined, headers: {}, socket: { remoteAddress: '127.0.0.1' }, ip: '127.0.0.1' };
    try {
      const out = await match.r.handler(req, reply);
      const res = out === reply || out === undefined ? sent : out;
      if (status >= 400) throw new ApiError(res?.error ?? `Error ${status}`, status);
      return JSON.parse(JSON.stringify(res ?? null)); // same semantics as going over HTTP
    } catch (e: any) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(e?.message ?? String(e), e?.statusCode ?? 500);
    }
  }
}
