// Full app flow in Chromium: real backend, exported web build, phone viewport.
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assert, check, done, here, launch, shots } from './lib.mjs';
import { serve } from './serve.mjs';

const API = 8765;
const WEB = 8081;
const dataDir = mkdtempSync(path.join(tmpdir(), 'folume-e2e-'));
const python = path.join(here, '../backend/.venv/bin/python');
const pdf = path.join(here, '../backend/tests/.generated/ieee_ml.pdf');
const dist = path.join(here, '../mobile/dist');

assert(existsSync(dist), 'run `npm run export:web` in mobile/ first');
const api = spawn(python, ['-m', 'uvicorn', 'folume.main:app', '--port', String(API)], {
  cwd: path.join(here, '../backend'),
  env: { ...process.env, FOLUME_DATA_DIR: dataDir, FOLUME_CORS_ORIGINS: `http://localhost:${WEB}` },
  stdio: 'ignore',
});
const web = await serve(dist, WEB);
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`http://localhost:${API}/v1/health`)).ok) break;
  } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'tr-TR' });
// headless Chromium has no voices: a stand-in that records what would be said and "finishes" each sentence shortly after
await context.addInitScript(() => {
  window.__spoken = [];
  window.__cancels = 0;
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: {
      getVoices: () => [],
      cancel() { window.__cancels += 1; clearTimeout(window.__speechTimer); },
      speak(u) { window.__spoken.push({ text: u.text, rate: u.rate, lang: u.lang }); window.__speechTimer = setTimeout(() => u.onend && u.onend(), 300); },
    },
  });
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept());
const frame = () => page.frameLocator('[data-testid=reader-frame]');
const shot = (name) => page.screenshot({ path: path.join(shots, `app-${name}.png`) });

console.log('app flow (web build + real API)');
await page.goto(`http://localhost:${WEB}/`);

await check('shows the empty library with the product promise', async () => {
  await page.getByText('İlk makalenle başla').waitFor({ timeout: 15000 });
  assert(await page.getByText('Her paragraf orijinal PDF konumuna bağlı kalır').count() === 1, 'promise missing');
  await shot('01-empty-library');
});

let paperId = '';
await check('imports a PDF through the picker, converts on the server and opens the reader', async () => {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('import-button').click()]);
  await chooser.setFiles(pdf);
  await page.getByTestId('import-status').waitFor({ timeout: 10000 });
  await shot('02-importing');
  await page.waitForURL(/\/reader\//, { timeout: 90000 });
  paperId = page.url().split('/reader/')[1].split('?')[0];
  await frame().locator('#book .h').first().waitFor({ timeout: 20000 });
  const heading = await frame().locator('#book .h').first().textContent();
  assert(/INTRODUCTION/i.test(heading), heading);
  assert((await page.getByTestId('reader-position').textContent()).includes('Sayfa 1 / 3'), 'position label');
  await shot('03-reader');
});

await check('the server keeps nothing after the import', async () => {
  await new Promise((r) => setTimeout(r, 500));
  assert(readdirSync(dataDir).length === 0, `job directories left: ${readdirSync(dataDir)}`);
  const caps = await (await fetch(`http://localhost:${API}/v1/capabilities`)).json();
  assert(caps.uploads_persisted === false, 'uploads_persisted');
});

await check('images load lazily from local storage into the reader', async () => {
  await frame().locator('#book .fig img').first().scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    const f = document.querySelector('[data-testid=reader-frame]');
    const imgs = [...f.contentDocument.querySelectorAll('#book img')];
    return imgs.some((i) => i.naturalWidth > 0);
  }, null, { timeout: 15000 });
});

await check('contents sheet jumps to a section', async () => {
  await page.getByTestId('open-contents').click();
  await page.getByTestId('contents-list').waitFor();
  await shot('04-contents');
  await page.getByText('EXPERIMENTS').first().click();
  await page.waitForFunction(() => document.querySelector('[data-testid=reader-position]')?.textContent?.includes('2 / 3'), null, { timeout: 10000 });
});

await check('changing the theme restyles the reader immediately', async () => {
  await page.getByTestId('open-typography').click();
  await page.getByTestId('theme-dark').click();
  await page.waitForFunction(() => document.querySelector('[data-testid=reader-frame]').contentDocument.body.classList.contains('t-dark'));
  await shot('05-typography-dark');
  await page.getByTestId('sheet-close').click();
  await page.waitForTimeout(500);
  await shot('06-reader-dark');
});

await check('find in paper: counts matches, steps through them and paints the one you are on', async () => {
  await page.getByTestId('open-find').click();
  await page.getByTestId('find-input').fill('expert gating');
  await page.waitForFunction(() => /^1 \/ \d+$/.test(document.querySelector('[data-testid=find-count]')?.textContent ?? ''), null, { timeout: 5000 });
  const count = Number((await page.getByTestId('find-count').textContent()).split('/')[1]);
  assert(count >= 5, `matches ${count}`);
  const painted = () => frame().locator('mark.hl').evaluateAll((marks) => marks.map((m) => m.textContent));
  await page.waitForFunction(() => document.querySelector('[data-testid=reader-frame]').contentDocument.querySelectorAll('mark.hl').length >= 1);
  assert((await painted()).every((t) => t.toLowerCase() === 'expert gating'), JSON.stringify(await painted()));
  await shot('find-1');
  await page.getByTestId('find-next').click();
  await page.waitForFunction(() => /^2 \//.test(document.querySelector('[data-testid=find-count]')?.textContent ?? ''));
  await page.getByTestId('find-prev').click();
  await page.getByTestId('find-prev').click(); // wraps around to the last match
  await page.waitForFunction((n) => document.querySelector('[data-testid=find-count]')?.textContent === `${n} / ${n}`, count);
  await page.getByTestId('find-input').fill('zzzznotthere');
  await page.waitForFunction(() => document.querySelector('[data-testid=find-count]')?.textContent === 'Eşleşme yok');
  assert((await painted()).length === 0, 'nothing painted without a match');
  await page.getByTestId('find-close').click();
  assert((await page.getByTestId('find-bar').count()) === 0, 'find bar closed');
});

await check('focus mode hides the controls, keeps the position and brings them back', async () => {
  await page.getByTestId('open-more').click();
  await page.getByTestId('more-focus').click();
  await page.getByTestId('focus-exit').waitFor();
  assert((await page.getByTestId('reader-back').count()) === 0, 'controls are hidden');
  assert(/\d+% · .*(dk kaldı|Bitti)/.test(await page.getByTestId('focus-position').textContent()), 'progress stays visible');
  await shot('focus');
  await page.getByTestId('focus-exit').click();
  await page.getByTestId('reader-back').waitFor();
  assert(/dk kaldı|Bitti/.test(await page.getByTestId('reader-position').textContent()), 'time left shown in the header');
});

await check('listening: the paper is read sentence by sentence, the sentence is marked, and the controls work', async () => {
  await page.getByTestId('open-more').click();
  await page.getByTestId('more-listen').click();
  await page.getByTestId('listen-bar').waitFor();
  const spoken = () => page.evaluate(() => window.__spoken.map((s) => s.text));
  await page.waitForFunction(() => window.__spoken.length >= 2, null, { timeout: 8000 });
  const first = (await spoken())[0];
  assert(first.length > 5 && !/\[\d+\]/.test(first), `first sentence: ${first}`);
  assert((await page.evaluate(() => window.__spoken[0].lang)) === 'en-US', 'language of the paper');
  assert(/Cümle \d+ \/ \d+/.test(await page.getByTestId('listen-count').textContent()), 'counter');
  await frame().locator('mark.hl[data-h="find:speech"]').first().waitFor({ timeout: 5000 });
  // pause: nothing more is said
  await page.getByTestId('listen-toggle').click();
  await page.waitForTimeout(150);
  const n = (await spoken()).length;
  await page.waitForTimeout(400);
  assert((await spoken()).length === n, 'paused speech must stay silent');
  // resume repeats the sentence that was interrupted, at the new speed
  await page.getByTestId('listen-rate').click();
  assert((await page.getByTestId('listen-rate').textContent()).includes('1.25'), 'speed label');
  await page.getByTestId('listen-toggle').click();
  await page.waitForFunction((k) => window.__spoken.length > k, n, { timeout: 5000 }).catch(async (e) => { throw new Error(`${e.message}\nspoken=${JSON.stringify(await page.evaluate(() => [window.__spoken.length, window.__cancels, window.__spoken.slice(-2)]))} n=${n} toggle=${await page.getByTestId('listen-toggle').getAttribute('aria-label')}`); });
  assert((await page.evaluate(() => window.__spoken[window.__spoken.length - 1].rate)) === 1.25, 'new speed is used');
  await shot('listen');
  await page.getByTestId('listen-next').click();
  await page.getByTestId('listen-close').click();
  assert((await page.getByTestId('listen-bar').count()) === 0, 'bar closed');
  await page.waitForFunction(() => document.querySelector('[data-testid=reader-frame]').contentDocument.querySelectorAll('mark.hl[data-h="find:speech"]').length === 0);
  const after = (await spoken()).length;
  await page.waitForTimeout(300);
  assert((await spoken()).length === after, 'closing stops the voice');
});

await check('tapping a block offers original + bookmark; bookmarks survive a reload', async () => {
  await frame().locator('#book .blk-paragraph .bt').first().click();
  await page.getByTestId('block-actions').waitFor();
  await page.getByTestId('action-bookmark').click();
  await page.waitForTimeout(300);
  await page.reload();
  await frame().locator('#book .h').first().waitFor({ timeout: 20000 });
  await page.waitForFunction(() => document.querySelector('[data-testid=reader-frame]').contentDocument.querySelectorAll('.blk.bm').length === 1);
  await page.getByTestId('open-contents').click();
  await page.getByText(/Yer imleri \(1\)/).click();
  await shot('07-bookmarks');
  await page.getByTestId('sheet-close').click();
});

await check('reading position is restored after leaving and reopening the paper', async () => {
  // move to a section and reload at once: the position has to be saved when the page goes away, not only after a pause
  await page.getByTestId('open-contents').click();
  await page.getByTestId('contents-list').waitFor();
  await page.getByText('EXPERIMENTS').first().click();
  await page.waitForFunction(() => document.querySelector('[data-testid=reader-position]')?.textContent?.includes('2 / 3'), null, { timeout: 10000 });
  await page.reload();
  await frame().locator('#book .h').first().waitFor({ timeout: 20000 });
  await page.waitForFunction(() => document.querySelector('[data-testid=reader-position]')?.textContent?.includes('2 / 3'), null, { timeout: 10000 });
  await page.waitForTimeout(1500); // progress is saved after a short debounce
  await page.getByTestId('reader-back').click();
  await page.getByTestId(`paper-${paperId}`).waitFor();
  const percent = await page.getByTestId(`paper-${paperId}`).textContent();
  assert(/%\d+ okundu/.test(percent), percent);
  await shot('08-library-with-progress');
  await page.getByTestId(`paper-${paperId}`).click();
  await frame().locator('#book .h').first().waitFor({ timeout: 20000 });
  await page.waitForFunction(() => document.querySelector('[data-testid=reader-position]')?.textContent?.includes('2 / 3'), null, { timeout: 10000 });
});

const readerBody = () => page.evaluate(() => document.querySelector('[data-testid=reader-frame]').contentDocument.body.className);

await check('the paper can be read as a book, as a magazine, page by page, or in the original', async () => {
  await page.getByRole('button', { name: 'Dergi', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid=reader-frame]').contentDocument.body.classList.contains('l-magazine'));
  await shot('09a-magazine');
  await page.getByTestId('open-typography').click();
  await page.getByRole('button', { name: 'Sayfa sayfa', exact: true }).click();
  await page.getByTestId('sheet-close').click();
  await page.waitForFunction(() => document.querySelector('[data-testid=reader-frame]').contentDocument.body.classList.contains('f-paged'));
  await page.waitForFunction(() => /Ekran \d+ \/ \d+/.test(document.querySelector('[data-testid=reader-position]')?.textContent ?? ''), null, { timeout: 10000 });
  await shot('09b-magazine-paged');
  // the choice is remembered
  await page.reload();
  await frame().locator('#book .h').first().waitFor({ timeout: 20000 });
  const cls = await readerBody();
  assert(cls.includes('l-magazine') && cls.includes('f-paged'), `after a reload: ${cls}`);
  await page.getByRole('button', { name: 'Kitap', exact: true }).click();
  await page.getByTestId('open-typography').click();
  await page.getByRole('button', { name: 'Kaydır', exact: true }).click();
  await page.getByTestId('sheet-close').click();
  await page.waitForFunction(() => {
    const c = document.querySelector('[data-testid=reader-frame]').contentDocument.body.classList;
    return c.contains('l-book') && !c.contains('f-paged');
  });
});

await check('Original view shows the source page and returns to the same place', async () => {
  await page.getByRole('button', { name: 'Orijinal' }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid=reader-frame]').contentDocument.body.classList.contains('original'));
  await page.waitForFunction(() => {
    const d = document.querySelector('[data-testid=reader-frame]').contentDocument;
    return [...d.querySelectorAll('#orig img')].some((i) => i.naturalWidth > 0);
  }, null, { timeout: 15000 });
  await page.waitForTimeout(400);
  await shot('09-original');
  await page.getByRole('button', { name: 'Kitap', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-testid=reader-frame]').contentDocument.body.classList.contains('original'));
});

await check('conversion report explains the ledger and what was left out', async () => {
  await page.getByTestId('open-more').click();
  await page.getByTestId('more-report').click();
  await page.getByTestId('report').waitFor();
  await page.getByText('İyi').first().waitFor();
  const complete = await page.getByTestId('completeness').textContent();
  assert(/tamamı bu belgede/.test(complete) && /eksik hiçbiri yok|hiçbiri eksik/.test(complete), `completeness card: ${complete}`);
  assert(/\d[\d.,]* harf/.test(complete), 'it says how many letters were compared');
  assert(await page.getByText('Metin defteri').count() === 1, 'ledger section');
  assert(await page.getByText('Hesaplanamayan').count() === 1, 'unaccounted row');
  assert(await page.getByText('Sayfa üst bilgisi').count() >= 1, 'omitted header listed');
  await shot('10-report');
  await page.getByTestId('screen-back').click();
});

await check('settings can test the server connection and switch the language', async () => {
  await page.getByTestId('reader-back').click();
  await page.getByTestId('open-settings').click();
  await page.getByTestId('test-connection').click();
  await page.getByTestId('connection-ok').waitFor({ timeout: 10000 });
  assert((await page.getByTestId('connection-ok').textContent()).includes('0.1.0'), 'version');
  await shot('11-settings');
  await page.getByRole('button', { name: 'English' }).click();
  await page.getByText('Conversion server').waitFor();
  await page.getByTestId('screen-back').click();
  await page.getByText('Library').first().waitFor();
});

await check('a paper can be deleted from the device', async () => {
  await page.getByTestId(`delete-${paperId}`).click();
  await page.getByText('Start with your first paper').waitFor({ timeout: 10000 });
});

await check('an unreachable server gives an actionable error', async () => {
  await page.getByTestId('open-settings').click();
  await page.getByTestId('server-url').fill('http://localhost:59999');
  await page.getByTestId('server-url').blur();
  await page.getByTestId('screen-back').click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('import-button').click()]);
  await chooser.setFiles(pdf);
  await page.getByTestId('import-error').waitFor({ timeout: 15000 });
  assert((await page.getByTestId('import-error').textContent()).includes('could not be reached'), 'message');
  await shot('12-import-error');
});

assert(errors.length === 0, `page errors: ${errors.join(' | ')}`);
await browser.close();
web.close();
api.kill();
done();
