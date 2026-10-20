import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, useColorScheme, type TextInputProps, type ViewStyle } from 'react-native';
import type { ReactNode } from 'react';

export function useColors() {
  const dark = useColorScheme() === 'dark';
  return dark
    ? { bg: '#0d1017', card: '#161a23', text: '#eef0f6', muted: '#8b93a7', border: '#262c3a', primary: '#7c7cf5', success: '#34c38f', danger: '#f06565', warning: '#f5a524', input: '#1d2230' }
    : { bg: '#f6f7fb', card: '#ffffff', text: '#161a2b', muted: '#6b7280', border: '#e5e7ef', primary: '#4f46e5', success: '#10a36e', danger: '#e04848', warning: '#e8920c', input: '#f1f2f7' };
}
export type Colors = ReturnType<typeof useColors>;

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const c = useColors();
  return <View style={[{ backgroundColor: c.card, borderRadius: 16, padding: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border }, style]}>{children}</View>;
}
export function Btn({ title, onPress, kind = 'primary', loading, disabled, small }: { title: string; onPress: () => void; kind?: 'primary' | 'outline' | 'danger' | 'ghost'; loading?: boolean; disabled?: boolean; small?: boolean }) {
  const c = useColors();
  const bg = kind === 'primary' ? c.primary : kind === 'danger' ? c.danger : 'transparent';
  const fg = kind === 'primary' || kind === 'danger' ? '#fff' : kind === 'ghost' ? c.muted : c.text;
  return <Pressable onPress={onPress} disabled={disabled || loading} style={({ pressed }) => ({ backgroundColor: bg, borderWidth: kind === 'outline' ? 1 : 0, borderColor: c.border, paddingVertical: small ? 7 : 12, paddingHorizontal: small ? 12 : 18, borderRadius: 12, alignItems: 'center', opacity: pressed || disabled ? 0.6 : 1 })}>
    {loading ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontWeight: '600', fontSize: small ? 13 : 15 }}>{title}</Text>}
  </Pressable>;
}
export function Input(p: TextInputProps & { label?: string }) {
  const c = useColors();
  return <View style={{ gap: 6 }}>{p.label && <Text style={{ color: c.muted, fontSize: 12, fontWeight: '500' }}>{p.label}</Text>}
    <TextInput placeholderTextColor={c.muted} {...p} style={[{ backgroundColor: c.input, color: c.text, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15 }, p.style]} /></View>;
}
export function Chip({ label, active, onPress, color }: { label: string; active?: boolean; onPress?: () => void; color?: string }) {
  const c = useColors();
  return <Pressable onPress={onPress} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: active ? (color ?? c.primary) : c.input, marginRight: 6, marginBottom: 6 }}>
    <Text style={{ color: active ? '#fff' : c.text, fontSize: 13, fontWeight: '500' }}>{label}</Text></Pressable>;
}
export function H({ children, style }: { children: ReactNode; style?: object }) { const c = useColors(); return <Text style={[{ color: c.text, fontSize: 22, fontWeight: '700' }, style]}>{children}</Text>; }
export function T({ children, muted, style, bold }: { children: ReactNode; muted?: boolean; style?: object; bold?: boolean }) { const c = useColors(); return <Text style={[{ color: muted ? c.muted : c.text, fontSize: 14, fontWeight: bold ? '600' : '400' }, style]}>{children}</Text>; }
export function Center({ children }: { children: ReactNode }) { return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }}>{children}</View>; }
