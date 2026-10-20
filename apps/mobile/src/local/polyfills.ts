// Small runtime gaps between Node and Hermes used by the shared business logic.
const g = globalThis as any;
if (typeof AbortSignal !== 'undefined' && !(AbortSignal as any).timeout) {
  (AbortSignal as any).timeout = (ms: number) => { const c = new AbortController(); setTimeout(() => c.abort(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), ms); return c.signal; };
}
if (!g.structuredClone) g.structuredClone = (v: unknown) => JSON.parse(JSON.stringify(v));
if (!Array.prototype.findLast) Object.defineProperty(Array.prototype, 'findLast', { value(this: any[], f: (x: any, i: number) => boolean) { for (let i = this.length - 1; i >= 0; i--) if (f(this[i], i)) return this[i]; return undefined; } });
export {};
