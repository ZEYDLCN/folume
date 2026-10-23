// Renders the Folume mark (mobile/assets/brand/*.svg) to the icon files Expo needs. Run: node brand-assets.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { launch, here } from './lib.mjs';

const brand = path.join(here, '../mobile/assets/brand');
const assets = path.join(here, '../mobile/assets');
const NAVY = '#141B36';
const mark = readFileSync(path.join(brand, 'folume-mark.svg'), 'utf8');
const mono = readFileSync(path.join(brand, 'folume-mark-mono.svg'), 'utf8');
const inner = (svg) => svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

/** The mark centred on a square canvas, `scale` times its natural 512 px size. */
const canvas = (size, body, scale, bg) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  ${bg ? `<rect width="${size}" height="${size}" fill="${bg}"/>` : ''}
  <g transform="translate(${(size - 512 * scale) / 2} ${(size - 512 * scale) / 2 - 8 * scale}) scale(${scale})">${body}</g></svg>`;

const jobs = [
  // iOS app icon: full bleed, the system rounds it
  ['icon.png', 1024, canvas(1024, inner(mark), 1.75, NAVY), false],
  // Android adaptive icon: mark inside the central safe zone on a plain background
  ['android-icon-foreground.png', 1024, canvas(1024, inner(mark), 1.5), true],
  ['android-icon-background.png', 1024, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="${NAVY}"/></svg>`, false],
  ['android-icon-monochrome.png', 1024, canvas(1024, inner(mono), 1.5), true],
  ['splash-icon.png', 1024, canvas(1024, inner(mark), 1.6), true],
  ['favicon.png', 64, canvas(64, inner(mark), 0.16, NAVY), false],
  ['brand/folume-icon.png', 1024, canvas(1024, inner(mark), 1.75, NAVY), false],
];

const browser = await launch();
for (const [name, size, svg, transparent] of jobs) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.screenshot({ path: path.join(assets, name), omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
  console.log(`wrote assets/${name}`);
}
writeFileSync(path.join(brand, 'folume-icon.svg'), canvas(1024, inner(mark), 1.75, NAVY));
await browser.close();
