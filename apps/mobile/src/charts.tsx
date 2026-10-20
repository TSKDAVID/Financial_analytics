import { useState } from 'react';
import { View, Text, type LayoutChangeEvent } from 'react-native';
import Svg, { Path, Rect, Line as SLine, G, Circle } from 'react-native-svg';
import { useColors } from './ui';
import { money } from './lapi';

const useWidth = () => { const [w, setW] = useState(0); return [w, (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)] as const; };

/** Grouped bars (e.g. income vs expense per month). */
export function Bars({ data, keys, colors, height = 160, label }: { data: any[]; keys: string[]; colors: string[]; height?: number; label: (d: any) => string }) {
  const c = useColors(); const [w, onLayout] = useWidth();
  const max = Math.max(1, ...data.flatMap((d) => keys.map((k) => Math.abs(d[k] ?? 0))));
  const gw = w / Math.max(1, data.length); const bw = Math.max(2, (gw * 0.7) / keys.length);
  return <View onLayout={onLayout}>{w > 0 && <Svg width={w} height={height}>
    <SLine x1={0} x2={w} y1={height - 1} y2={height - 1} stroke={c.border} />
    {data.map((d, i) => keys.map((k, j) => { const h = (Math.abs(d[k] ?? 0) / max) * (height - 8); return <Rect key={`${i}${k}`} x={i * gw + gw * 0.15 + j * bw} y={height - 1 - h} width={bw - 1} height={h} rx={2} fill={colors[j]} />; }))}
  </Svg>}
    <View style={{ flexDirection: 'row' }}>{data.map((d, i) => <Text key={i} style={{ width: gw, textAlign: 'center', fontSize: 9, color: c.muted }} numberOfLines={1}>{i % Math.ceil(data.length / 6) === 0 ? label(d) : ''}</Text>)}</View>
  </View>;
}
/** Line/area chart; optional band (lo/hi) and a horizontal reference line. */
export function LineChart({ data, y, band, height = 170, color, refY, label }: { data: any[]; y: string; band?: [string, string]; height?: number; color?: string; refY?: number | null; label: (d: any) => string }) {
  const c = useColors(); const [w, onLayout] = useWidth(); const col = color ?? c.primary;
  const vals = data.flatMap((d) => [d[y], ...(band ? [d[band[0]], d[band[1]]] : [])]).concat(refY != null ? [refY] : []).filter((v) => v != null) as number[];
  const min = Math.min(0, ...vals), max = Math.max(1, ...vals);
  const X = (i: number) => (data.length <= 1 ? w / 2 : (i / (data.length - 1)) * (w - 8) + 4);
  const Y = (v: number) => height - 6 - ((v - min) / (max - min || 1)) * (height - 12);
  const path = data.map((d, i) => `${i ? 'L' : 'M'}${X(i)},${Y(d[y])}`).join(' ');
  const area = band ? data.map((d, i) => `${i ? 'L' : 'M'}${X(i)},${Y(d[band[1]])}`).join(' ') + ' ' + [...data].reverse().map((d, i) => `L${X(data.length - 1 - i)},${Y(d[band[0]])}`).join(' ') + ' Z'
    : `${path} L${X(data.length - 1)},${Y(min)} L${X(0)},${Y(min)} Z`;
  return <View onLayout={onLayout}>{w > 0 && data.length > 0 && <Svg width={w} height={height}>
    <Path d={area} fill={col} opacity={0.14} />
    {refY != null && <SLine x1={0} x2={w} y1={Y(refY)} y2={Y(refY)} stroke={c.danger} strokeDasharray="4 4" />}
    {min < 0 && <SLine x1={0} x2={w} y1={Y(0)} y2={Y(0)} stroke={c.border} />}
    <Path d={path} stroke={col} strokeWidth={2.2} fill="none" />
    <Circle cx={X(data.length - 1)} cy={Y(data[data.length - 1][y])} r={3.5} fill={col} />
  </Svg>}
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ fontSize: 9, color: c.muted }}>{data[0] ? label(data[0]) : ''}</Text><Text style={{ fontSize: 9, color: c.muted }}>{data.length ? label(data[data.length - 1]) : ''}</Text></View>
  </View>;
}
/** Donut with legend. */
export function Donut({ data, size = 140 }: { data: { label: string; value: number; color: string }[]; size?: number }) {
  const c = useColors(); const total = data.reduce((s, d) => s + Math.max(0, d.value), 0) || 1;
  const R = size / 2, r = R * 0.62; let a0 = -Math.PI / 2;
  const arcs = data.map((d) => { const a1 = a0 + (Math.max(0, d.value) / total) * Math.PI * 2; const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (a: number, rad: number) => `${R + rad * Math.cos(a)},${R + rad * Math.sin(a)}`;
    const path = a1 - a0 >= Math.PI * 2 - 1e-6 ? `M${R},${R - R} A${R},${R} 0 1 1 ${R - 0.01},0 L${R - 0.01},${R - r} A${r},${r} 0 1 0 ${R},${R - r} Z` : `M${p(a0, R)} A${R},${R} 0 ${large} 1 ${p(a1, R)} L${p(a1, r)} A${r},${r} 0 ${large} 0 ${p(a0, r)} Z`;
    a0 = a1; return { path, color: d.color }; });
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
    <Svg width={size} height={size}><G>{arcs.map((a, i) => <Path key={i} d={a.path} fill={a.color} />)}</G></Svg>
    <View style={{ flex: 1, gap: 6 }}>{data.slice(0, 7).map((d) => <View key={d.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: d.color }} /><Text style={{ color: c.text, fontSize: 12, flex: 1 }} numberOfLines={1}>{d.label}</Text><Text style={{ color: c.muted, fontSize: 12 }}>{money(d.value, 'GEL', true)}</Text></View>)}</View>
  </View>;
}
