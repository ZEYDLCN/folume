import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { runSync } from '@/services/sync';
import { useSettings } from '@/state/settings';
import { useColors, darkColors } from '@/ui/theme';

export default function RootLayout() {
  const loaded = useSettings((s) => s.loaded);
  const load = useSettings((s) => s.load);
  const c = useColors();
  useEffect(() => {
    void load();
  }, [load]);

  const syncOn = useSettings((s) => s.sync.enabled && s.syncKey.trim().length >= 8);
  useEffect(() => {
    if (!loaded || !syncOn) return;
    // optional multi-device sync: once at start and every few minutes while the app is open; failures are shown in Settings
    const tick = () => void runSync().catch(() => undefined);
    tick();
    const timer = setInterval(tick, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [loaded, syncOn]);

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
