import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useSettings } from '@/state/settings';
import { useColors, darkColors } from '@/ui/theme';

export default function RootLayout() {
  const loaded = useSettings((s) => s.loaded);
  const load = useSettings((s) => s.load);
  const c = useColors();
  useEffect(() => {
    void load();
  }, [load]);

  if (!loaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }
  return (
    <>
      <StatusBar style={c === darkColors ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }} />
    </>
  );
}
