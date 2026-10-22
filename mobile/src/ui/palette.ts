/** The colours of the app, as plain data (no React Native, no settings) so they can be tested. */

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
  /** the terracotta of headers and big buttons, and the cream that reads well on it */
  brand: string;
  brandText: string;
  /** the logo's navy */
  ink: string;
}

/** Warm peach and terracotta on cream; deep brown text. Accent text on white keeps a 4.6:1 contrast. */
export const lightColors: Colors = {
  bg: '#fcefe3',
  surface: '#fff9f3',
  surfaceAlt: '#f6dfcc',
  text: '#46241a',
  muted: '#7a5a4b',
  border: '#ebcfb9',
  accent: '#c2512f',
  accentText: '#ffffff',
  danger: '#b3261e',
  warn: '#b45309',
  warnBg: '#fff0d9',
  ok: '#2e7d32',
  scrim: 'rgba(40,18,10,0.45)',
  brand: '#cf6446',
  brandText: '#fff4ea',
  ink: '#141b36',
};

export const darkColors: Colors = {
  bg: '#1b1210',
  surface: '#281b17',
  surfaceAlt: '#33241f',
  text: '#f5e6da',
  muted: '#b89e90',
  border: '#463128',
  accent: '#ee8a5b',
  accentText: '#2a1208',
  danger: '#f2b8b5',
  warn: '#f0a35e',
  warnBg: '#2c241a',
  ok: '#7fd18b',
  scrim: 'rgba(0,0,0,0.6)',
  brand: '#8e3b25',
  brandText: '#ffede0',
  ink: '#0e1328',
};
