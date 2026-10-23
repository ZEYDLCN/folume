import { darkColors, lightColors, type Colors } from './palette';

function luminance(hex: string): number {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe.each([['light', lightColors], ['dark', darkColors]] as [string, Colors][])('%s palette', (_name, c) => {
  it('keeps reading text readable (WCAG AA, 4.5:1) on every surface it is drawn on', () => {
    for (const ground of [c.bg, c.surface, c.surfaceAlt]) {
      expect(contrast(c.text, ground)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.muted, ground)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps button labels readable on the accent, and header text on the terracotta panel', () => {
    expect(contrast(c.accentText, c.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.brandText, c.brand)).toBeGreaterThanOrEqual(3); // large serif title and icons
    expect(contrast(c.accent, c.surface)).toBeGreaterThanOrEqual(3); // accent used as a label or progress colour
  });
});
