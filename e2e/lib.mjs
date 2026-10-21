import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const shots = path.join(here, 'out/shots');
mkdirSync(shots, { recursive: true });

export const STRINGS = {
  page: 'Sayfa', tap_to_zoom: 'Büyütmek için dokun', show_in_book: "Book View'da göster", show_original: 'Orijinali göster',
  table: 'Tablo', table_image: 'Orijinal görüntü', table_uncertain: 'Tablo yapısı güvenilir değil; orijinal görüntü gösteriliyor',
  citation: 'Atıf', go_to_reference: 'Kaynakçaya git', conversion_warning: 'Dönüşüm uyarısı', conversion_note: 'Dönüşüm notu',
  bookmark: 'Yer imi', close: 'Kapat', equation: 'Denklem', figure: 'Şekil', loading: 'Yükleniyor…',
  empty_unsupported: 'Bu PDF taranmış görünüyor.', footnote: 'Dipnot', original_pages: 'Orijinal sayfalar',
  figure_text: 'Şekil içindeki yazı', table_text: 'Tablo metni',
};

export const SETTINGS = {
  theme: 'paper', fontFamily: 'serif', fontSize: 18, lineHeight: 1.6, margin: 'normal', justify: false, showNotes: false,
  layout: 'book', flow: 'scroll',
};

export async function launch() {
  return chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
    args: ['--no-sandbox'],
  });
}

export function loadBundle(name) {
  const dir = path.join(here, 'out', name);
  return { dir, doc: JSON.parse(readFileSync(path.join(dir, 'document.json'), 'utf8')) };
}

/** Opens the reader runtime in a phone-sized page and answers its asset requests from disk. */
export async function openReader(browser, bundle, init = {}, viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    window.__events = [];
    window.ReactNativeWebView = { postMessage: (s) => window.__events.push(JSON.parse(s)) };
  });
  const html = readFileSync(path.join(here, '../mobile/reader/dist/reader.html'), 'utf8');
  await page.route('http://reader.test/**', (route) => route.fulfill({ body: html, contentType: 'text/html' }));
  await page.goto('http://reader.test/');
  let served = 0;
  // answer asset requests like the React Native host does
  await page.exposeFunction('__readAsset', (p) => {
    served += 1;
    const bytes = readFileSync(path.join(bundle.dir, p));
    const mime = p.endsWith('.png') ? 'image/png' : 'image/jpeg';
    return `data:${mime};base64,${bytes.toString('base64')}`;
  });
  await page.evaluate(() => {
    const orig = window.ReactNativeWebView.postMessage;
    window.ReactNativeWebView.postMessage = (s) => {
      orig(s);
      const e = JSON.parse(s);
      if (e.type === 'asset-request') window.__readAsset(e.path).then((uri) => window.__host({ type: 'asset', path: e.path, uri }));
    };
  });
  const host = (msg) => page.evaluate((m) => window.__host(m), msg);
  await host({
    type: 'init', doc: bundle.doc, settings: { ...SETTINGS, ...(init.settings || {}) }, mode: init.mode || 'book',
    anchor: init.anchor ?? null, bookmarks: init.bookmarks || [], highlights: init.highlights || [], strings: STRINGS,
    focus: init.focus ?? null,
  });
  const events = () => page.evaluate(() => window.__events);
  const waitFor = async (pred, what, timeout = 8000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = await pred();
      if (v) return v;
      await page.waitForTimeout(50);
    }
    throw new Error(`timed out waiting for ${what}`);
  };
  return { page, host, events, waitFor, errors, served: () => served, close: () => context.close() };
}

let failures = 0;
export async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures += 1;
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}
export function done() {
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
}
export function assert(cond, message) {
  if (!cond) throw new Error(message);
}
