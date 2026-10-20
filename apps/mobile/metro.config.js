// Monorepo-aware Metro config: the app bundles packages/core and the server's business logic (apps/server/src)
// so the phone runs the exact same rules offline. Platform files (*.native.ts) replace Node-only modules.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const config = getDefaultConfig(__dirname);
config.watchFolders = [path.join(root, 'packages/core'), path.join(root, 'apps/server/src'), path.join(root, 'node_modules')];
config.resolver.nodeModulesPaths = [path.join(__dirname, 'node_modules'), path.join(root, 'node_modules')];
config.resolver.extraNodeModules = { '@fa/core': path.join(root, 'packages/core/src') };
config.resolver.disableHierarchicalLookup = false;
// make sure React/RN always come from the app (root node_modules has the web app's React 18)
const pinned = ['react', 'react-native', 'react/jsx-runtime', 'react/jsx-dev-runtime'];
const orig = config.resolver.resolveRequest;
config.resolver.resolveRequest = (ctx, name, platform) => {
  if (pinned.includes(name)) return { type: 'sourceFile', filePath: require.resolve(name, { paths: [__dirname] }) };
  if (name === '@fa/core') return { type: 'sourceFile', filePath: path.join(root, 'packages/core/src/index.ts') };
  return (orig ?? ctx.resolveRequest)(ctx, name, platform);
};
module.exports = config;
