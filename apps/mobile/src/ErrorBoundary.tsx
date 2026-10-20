import { Component, type ReactNode } from 'react';
import { ScrollView, Text, View, Pressable } from 'react-native';

/** Any render error shows its text (to screenshot/copy) instead of a blank or closing app. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    const e = this.state.error; if (!e) return this.props.children;
    return <View style={{ flex: 1, padding: 20, paddingTop: 48, backgroundColor: '#fff' }}>
      <Text style={{ fontSize: 20, fontWeight: '700', color: '#111' }}>Something went wrong</Text>
      <Text style={{ marginVertical: 8, color: '#444' }}>Please send a screenshot of this text.</Text>
      <Pressable onPress={() => this.setState({ error: null })} style={{ alignSelf: 'flex-start', backgroundColor: '#6366f1', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, marginBottom: 10 }}><Text style={{ color: '#fff' }}>Try again</Text></Pressable>
      <ScrollView><Text selectable style={{ fontSize: 11, color: '#111' }}>{String(e?.message ?? e)}{'\n\n'}{e?.stack ?? ''}</Text></ScrollView>
    </View>;
  }
}
