// Bundles every screen with stubbed native modules + the real phone engine (better-sqlite3), then renders each one.
// Run: node test/smoke.mjs   (Node 20, root node_modules installed so better-sqlite3 + esbuild resolve)
import { build } from 'esbuild'; import { fileURLToPath } from 'node:url'; import path from 'node:path'; import { execFileSync } from 'node:child_process'; import { createRequire } from 'node:module';
const here = path.dirname(fileURLToPath(import.meta.url)); const out = path.join(here, '.smoke.cjs');
const mobileReact = path.join(here, '..', 'node_modules');
const stub = { name: 'stubs', setup(b) {
  b.onResolve({ filter: /^react-native$/ }, () => ({ path: 'rn', namespace: 'stub' }));
  b.onResolve({ filter: /^(expo-[\w-]+|react-native-[\w-]+)(\/.*)?$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
  b.onResolve({ filter: /local\/engine$/ }, () => ({ path: path.join(here, 'engine-node.ts') }));
  b.onResolve({ filter: /^(react|react\/jsx-runtime|react-test-renderer|react-is|scheduler)$/ }, (a) => ({ path: createRequire(path.join(mobileReact, 'x.js')).resolve(a.path) }));
  b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: a.path === 'rn' ? `module.exports = require(${JSON.stringify(path.join(here, 'stub.cjs'))}).rn;` : `module.exports = require(${JSON.stringify(path.join(here, 'stub.cjs'))}).deep(${JSON.stringify(a.path)});`, loader: 'js', resolveDir: here }));
} };
await build({ entryPoints: [path.join(here, 'smoke-entry.tsx')], bundle: true, platform: 'node', format: 'cjs', target: 'node20', outfile: out, jsx: 'automatic', external: ['better-sqlite3'], plugins: [stub], logLevel: 'error', define: { __DEV__: 'true', 'process.env.NODE_ENV': '"development"' } });
execFileSync(process.execPath, [out], { stdio: 'inherit', cwd: path.join(here, '..', '..', '..') });
