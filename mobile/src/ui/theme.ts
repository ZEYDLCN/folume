import { Platform, useColorScheme } from 'react-native';

import { useSettings } from '@/state/settings';

import { darkColors, lightColors, type Colors } from './palette';

export { darkColors, lightColors, type Colors };

export function useColors(): Colors {
  const pref = useSettings((s) => s.appTheme);
  const system = useColorScheme();
  const dark = pref === 'dark' || (pref === 'system' && system === 'dark');
  return dark ? darkColors : lightColors;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 10, md: 14, lg: 22, xl: 30, pill: 999 };

/** Headings are set in a serif, like a printed journal; everything else stays in the system sans. */
export const serif = Platform.select({ ios: 'Georgia', android: 'serif', default: "Georgia, 'Times New Roman', serif" });
