// Generic stand-in for react-native / expo native modules in Node smoke tests.
const React = require('react');
const host = (name) => { const C = React.forwardRef((p, ref) => React.createElement(name, { ...p, ref: undefined }, typeof p.children === 'function' ? null : p.children)); C.displayName = name; return C; };
const noop = () => undefined; const anoop = async () => null;
function deep(name) {
  const cache = {};
  const get = (_, k) => {
      if (k === '__esModule') return true;
      if (typeof k === 'symbol') return undefined;
      if (k in cache) return cache[k];
      let v;
      if (k === 'default') v = host(name);
      else if (/^use/.test(k)) v = () => [{ granted: false }, anoop];
      else if (/^[A-Z][a-z]/.test(k)) v = Object.assign(host(k), deep(name + '.' + k));
      else if (/^[A-Z_]+$/.test(k)) v = k;
      else v = anoop;
      return (cache[k] = v);
  };
  // esbuild's __toESM copies own keys and inherits the prototype: route both to the lazy getter.
  const proto = new Proxy({}, { get });
  return new Proxy(function () {}, { get, getPrototypeOf: () => proto });
}
const rn = {
  View: host('View'), Text: host('Text'), Pressable: host('Pressable'), ScrollView: host('ScrollView'), TextInput: host('TextInput'), Modal: (p) => (p.visible ? React.createElement('Modal', null, p.children) : null),
  Switch: host('Switch'), ActivityIndicator: host('ActivityIndicator'), RefreshControl: host('RefreshControl'), KeyboardAvoidingView: host('KeyboardAvoidingView'), Image: host('Image'),
  FlatList: ({ data, renderItem, ListEmptyComponent, ListHeaderComponent, ListFooterComponent, keyExtractor }) => React.createElement('FlatList', null,
    ListHeaderComponent ? (React.isValidElement(ListHeaderComponent) ? ListHeaderComponent : React.createElement(ListHeaderComponent)) : null,
    (data ?? []).length ? data.map((item, index) => React.createElement(React.Fragment, { key: keyExtractor ? keyExtractor(item, index) : index }, renderItem({ item, index }))) : (ListEmptyComponent ? (React.isValidElement(ListEmptyComponent) ? ListEmptyComponent : React.createElement(ListEmptyComponent)) : null),
    ListFooterComponent ? (React.isValidElement(ListFooterComponent) ? ListFooterComponent : React.createElement(ListFooterComponent)) : null),
  StyleSheet: { create: (s) => s, hairlineWidth: 1, absoluteFill: {}, absoluteFillObject: {}, flatten: (s) => s },
  Platform: { OS: 'android', Version: 34, select: (o) => o.android ?? o.default },
  Alert: { alert: noop }, useColorScheme: () => 'light', useWindowDimensions: () => ({ width: 400, height: 800, scale: 2, fontScale: 1 }),
  Dimensions: { get: () => ({ width: 400, height: 800 }) }, AppState: { currentState: 'active', addEventListener: () => ({ remove: noop }) },
  BackHandler: { addEventListener: () => ({ remove: noop }) }, Keyboard: { dismiss: noop, addListener: () => ({ remove: noop }) }, Linking: { openURL: anoop }, Share: { share: anoop },
  Animated: { Value: class { constructor(v) { this.v = v; } setValue() {} interpolate() { return this; } }, View: host('Animated.View'), timing: () => ({ start: (cb) => cb && cb() }), sequence: () => ({ start: noop }), delay: () => ({}) },
};
const rnRest = deep('rn');
module.exports = { rn: new Proxy(rn, { get: (t, k) => (k in t ? t[k] : k === '__esModule' ? true : rnRest[k]), getPrototypeOf: () => Object.getPrototypeOf(rnRest) }), deep };
