import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useColorScheme, type TextInputProps, type ViewStyle, KeyboardAvoidingView, Platform, RefreshControl } from 'react-native';
import { useState, type ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function useColors() {
  const dark = useColorScheme() === 'dark';
  return dark
    ? { dark, bg: '#0b0e14', card: '#151924', text: '#eef0f6', muted: '#8b93a7', border: '#252b39', primary: '#8183f7', primarySoft: '#8183f722', success: '#34c38f', danger: '#f06565', warning: '#f5a524', input: '#1c2130' }
    : { dark, bg: '#f4f5fa', card: '#ffffff', text: '#161a2b', muted: '#6b7280', border: '#e6e8f0', primary: '#4f46e5', primarySoft: '#4f46e518', success: '#0f9d68', danger: '#e04848', warning: '#d97f06', input: '#f1f2f7' };
}
export type Colors = ReturnType<typeof useColors>;

export function Card({ children, style, onPress }: { children: ReactNode; style?: ViewStyle | ViewStyle[]; onPress?: () => void }) {
  const c = useColors();
  const st = [{ backgroundColor: c.card, borderRadius: 18, padding: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, shadowColor: '#000', shadowOpacity: c.dark ? 0 : 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: c.dark ? 0 : 1 }, style] as any;
  return onPress ? <Pressable onPress={onPress} android_ripple={{ color: c.primarySoft }} style={({ pressed }) => [st, pressed && { opacity: 0.85 }]}>{children}</Pressable> : <View style={st}>{children}</View>;
}
export function Btn({ title, onPress, kind = 'primary', loading, disabled, small, icon, style }: { title: string; onPress: () => void; kind?: 'primary' | 'outline' | 'danger' | 'ghost' | 'soft'; loading?: boolean; disabled?: boolean; small?: boolean; icon?: string; style?: ViewStyle }) {
  const c = useColors();
  const bg = kind === 'primary' ? c.primary : kind === 'danger' ? c.danger : kind === 'soft' ? c.primarySoft : 'transparent';
  const fg = kind === 'primary' || kind === 'danger' ? '#fff' : kind === 'ghost' ? c.muted : kind === 'soft' ? c.primary : c.text;
  return <Pressable onPress={onPress} disabled={disabled || loading} style={({ pressed }) => [{ backgroundColor: bg, borderWidth: kind === 'outline' ? 1 : 0, borderColor: c.border, paddingVertical: small ? 7 : 12, paddingHorizontal: small ? 12 : 18, borderRadius: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6, opacity: pressed || disabled ? 0.6 : 1 }, style]}>
    {loading ? <ActivityIndicator color={fg} /> : <>{icon && <Text style={{ color: fg, fontSize: small ? 13 : 15 }}>{icon}</Text>}<Text style={{ color: fg, fontWeight: '600', fontSize: small ? 13 : 15 }}>{title}</Text></>}
  </Pressable>;
}
export function Input(p: TextInputProps & { label?: string; hint?: string }) {
  const c = useColors();
  return <View style={{ gap: 6, flex: (p.style as any)?.flex }}>{p.label && <Text style={{ color: c.muted, fontSize: 12, fontWeight: '600' }}>{p.label}</Text>}
    <TextInput placeholderTextColor={c.muted} {...p} style={[{ backgroundColor: c.input, color: c.text, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15 }, p.style]} />
    {p.hint && <Text style={{ color: c.muted, fontSize: 11 }}>{p.hint}</Text>}</View>;
}
export const NumInput = (p: Omit<TextInputProps, 'value' | 'onChangeText'> & { label?: string; hint?: string; value: string | number | null | undefined; onChange: (v: string) => void }) =>
  <Input {...p} keyboardType="decimal-pad" value={p.value == null ? '' : String(p.value)} onChangeText={(v) => p.onChange(v.replace(',', '.'))} />;
export function Chip({ label, active, onPress, color }: { label: string; active?: boolean; onPress?: () => void; color?: string }) {
  const c = useColors();
  return <Pressable onPress={onPress} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: active ? (color ?? c.primary) : c.input, marginRight: 6, marginBottom: 6 }}>
    <Text style={{ color: active ? '#fff' : c.text, fontSize: 13, fontWeight: '500' }}>{label}</Text></Pressable>;
}
/** Single-choice picker rendered as wrapping chips (native-feeling, no dropdown). */
export function Pick<T extends string | number | null>({ label, value, options, onChange }: { label?: string; value: T; options: { value: T; label: string; color?: string }[]; onChange: (v: T) => void }) {
  const c = useColors();
  return <View style={{ gap: 6 }}>{label && <Text style={{ color: c.muted, fontSize: 12, fontWeight: '600' }}>{label}</Text>}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{options.map((o) => <Chip key={String(o.value)} label={o.label} color={o.color} active={o.value === value} onPress={() => onChange(o.value)} />)}</View></View>;
}
export function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const c = useColors();
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 }}><View style={{ flex: 1 }}><T>{label}</T>{hint && <T muted style={{ fontSize: 12 }}>{hint}</T>}</View>
    <Switch value={value} onValueChange={onChange} trackColor={{ true: c.primary, false: c.border }} thumbColor="#fff" /></View>;
}
export function H({ children, style }: { children: ReactNode; style?: object }) { const c = useColors(); return <Text style={[{ color: c.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.3 }, style]}>{children}</Text>; }
export function H2({ children, right }: { children: ReactNode; right?: ReactNode }) { const c = useColors(); return <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}><Text style={{ color: c.text, fontSize: 17, fontWeight: '700', flex: 1 }}>{children}</Text>{right}</View>; }
export function T({ children, muted, style, bold, numberOfLines }: { children: ReactNode; muted?: boolean; style?: object; bold?: boolean; numberOfLines?: number }) { const c = useColors(); return <Text numberOfLines={numberOfLines} style={[{ color: muted ? c.muted : c.text, fontSize: 14, fontWeight: bold ? '600' : '400' }, style]}>{children}</Text>; }
export function Center({ children }: { children: ReactNode }) { return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }}>{children}</View>; }
export function Loading() { const c = useColors(); return <Center><ActivityIndicator color={c.primary} size="large" /></Center>; }
export function Badge({ label, tone = 'default' }: { label: string; tone?: 'default' | 'success' | 'danger' | 'warning' | 'primary' }) {
  const c = useColors(); const col = { default: c.muted, success: c.success, danger: c.danger, warning: c.warning, primary: c.primary }[tone];
  return <View style={{ backgroundColor: col + '22', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, alignSelf: 'flex-start' }}><Text style={{ color: col, fontSize: 11, fontWeight: '700' }}>{label}</Text></View>;
}
export function Bar({ value, color, height = 8 }: { value: number; color?: string; height?: number }) {
  const c = useColors(); const v = Math.max(0, Math.min(1, value || 0));
  const col = color ?? (v >= 1 ? c.danger : v >= 0.8 ? c.warning : c.primary);
  return <View style={{ height, backgroundColor: c.input, borderRadius: height, overflow: 'hidden' }}><View style={{ width: `${v * 100}%`, height, backgroundColor: col, borderRadius: height }} /></View>;
}
export function Stat({ label, value, tone, sub }: { label: string; value: string; tone?: string; sub?: string }) {
  const c = useColors();
  return <Card style={{ flex: 1, padding: 14, minWidth: 140 }}><T muted style={{ fontSize: 12 }}>{label}</T><Text style={{ color: tone ?? c.text, fontSize: 19, fontWeight: '800', marginTop: 4 }} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>{sub && <T muted style={{ fontSize: 11, marginTop: 2 }}>{sub}</T>}</Card>;
}
export function Row({ title, sub, right, rightSub, onPress, dot, icon }: { title: string; sub?: string; right?: ReactNode; rightSub?: string; onPress?: () => void; dot?: string; icon?: string }) {
  const c = useColors();
  return <Pressable onPress={onPress} android_ripple={{ color: c.primarySoft }} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 4, gap: 12 }}>
    {(dot || icon) && <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: (dot ?? c.primary) + '22', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: dot ?? c.primary, fontSize: 16 }}>{icon ?? '●'}</Text></View>}
    <View style={{ flex: 1 }}><T bold numberOfLines={1}>{title}</T>{sub ? <T muted style={{ fontSize: 12 }} numberOfLines={1}>{sub}</T> : null}</View>
    <View style={{ alignItems: 'flex-end' }}>{typeof right === 'string' ? <T bold>{right}</T> : right}{rightSub ? <T muted style={{ fontSize: 11 }}>{rightSub}</T> : null}</View>
  </Pressable>;
}
export const Sep = () => { const c = useColors(); return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />; };
export function Empty({ icon = '📭', title, body, action }: { icon?: string; title: string; body?: string; action?: ReactNode }) {
  return <View style={{ alignItems: 'center', padding: 28, gap: 8 }}><Text style={{ fontSize: 36 }}>{icon}</Text><T bold style={{ fontSize: 16, textAlign: 'center' }}>{title}</T>{body && <T muted style={{ textAlign: 'center' }}>{body}</T>}{action}</View>;
}
/** Screen scaffold: title bar with optional back + actions, pull-to-refresh scroll body. */
export function Screen({ title, back, actions, children, onRefresh, scroll = true, fab }: { title: string; back?: () => void; actions?: ReactNode; children: ReactNode; onRefresh?: () => void; scroll?: boolean; fab?: { label: string; onPress: () => void } }) {
  const c = useColors(); const [r, setR] = useState(false);
  return <View style={{ flex: 1, backgroundColor: c.bg }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, gap: 8 }}>
      {back && <Pressable onPress={back} hitSlop={12} style={{ paddingRight: 6 }}><Text style={{ color: c.text, fontSize: 26 }}>‹</Text></Pressable>}
      <H style={{ flex: 1, fontSize: back ? 20 : 26 }}>{title}</H>{actions}
    </View>
    {scroll ? <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 12, paddingBottom: fab ? 96 : 32 }} keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={r} colors={[c.primary]} onRefresh={async () => { setR(true); await onRefresh(); setR(false); }} /> : undefined}>{children}</ScrollView> : <View style={{ flex: 1 }}>{children}</View>}
    {fab && <Pressable onPress={fab.onPress} style={({ pressed }) => ({ position: 'absolute', right: 18, bottom: 18, backgroundColor: c.primary, borderRadius: 18, paddingHorizontal: 20, paddingVertical: 15, elevation: 6, shadowColor: c.primary, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, opacity: pressed ? 0.85 : 1 })}><Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>＋ {fab.label}</Text></Pressable>}
  </View>;
}
/** Bottom sheet modal for forms. */
export function Sheet({ open, title, onClose, children, footer }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const c = useColors(); const ins = useSafeAreaInsets();
  return <Modal visible={open} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0008' }}>
      <Pressable style={{ flex: 1 }} onPress={onClose} />
      <View style={{ backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '92%', paddingBottom: ins.bottom + 12 }}>
        <View style={{ alignItems: 'center', paddingTop: 8 }}><View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: c.border }} /></View>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10 }}><T bold style={{ fontSize: 18, flex: 1 }}>{title}</T><Pressable onPress={onClose} hitSlop={12}><Text style={{ color: c.muted, fontSize: 22 }}>✕</Text></Pressable></View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, gap: 14, paddingBottom: 12 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        {footer && <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 8 }}>{footer}</View>}
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}
export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const c = useColors();
  return <View style={{ flexDirection: 'row', backgroundColor: c.input, borderRadius: 12, padding: 3 }}>{options.map((o) => <Pressable key={o.value} onPress={() => onChange(o.value)} style={{ flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: value === o.value ? c.card : 'transparent', alignItems: 'center' }}>
    <Text style={{ color: value === o.value ? c.text : c.muted, fontWeight: '600', fontSize: 13 }}>{o.label}</Text></Pressable>)}</View>;
}
