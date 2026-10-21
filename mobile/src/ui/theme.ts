import { useColorScheme } from 'react-native';

import { useSettings } from '@/state/settings';

export interface Colors {
  bg: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  accentText: string;
  danger: string;
  warn: string;
  warnBg: string;
  ok: string;
  scrim: string;
}

export const lightColors: Colors = {
  bg: '#f6f5f1',
  surface: '#ffffff',
  surfaceAlt: '#efede7',
  text: '#1c1b19',
  muted: '#6b675f',
  border: '#dedad0',
  accent: '#2457d6',
  accentText: '#ffffff',
  danger: '#b3261e',
  warn: '#b45309',
  warnBg: '#fff4e0',
  ok: '#2e7d32',
  scrim: 'rgba(0,0,0,0.4)',
};

export const darkColors: Colors = {
  bg: '#101114',
  surface: '#1a1c20',
  surfaceAlt: '#24272c',
  text: '#e6e6e8',
  muted: '#9a9ba1',
  border: '#2f3238',
  accent: '#8ab4ff',
  accentText: '#0b1020',
  danger: '#f2b8b5',
  warn: '#f0a35e',
  warnBg: '#2c241a',
  ok: '#7fd18b',
  scrim: 'rgba(0,0,0,0.6)',
};

export function useColors(): Colors {
  const pref = useSettings((s) => s.appTheme);
  const system = useColorScheme();
  const dark = pref === 'dark' || (pref === 'system' && system === 'dark');
  return dark ? darkColors : lightColors;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 18, pill: 999 };
