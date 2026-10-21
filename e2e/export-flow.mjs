// Converting a paper to other formats from the app, end to end: real conversion, real downloads, read back by other tools.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assert, check, done, here, launch, shots } from './lib.mjs';
import { serve } from './serve.mjs';

const API = 8770;
const WEB = 8085;
const dataDir = mkdtempSync(path.join(tmpdir(), 'folume-e2e-'));
const python = path.join(here, '../backend/.venv/bin/python');
const pdf = path.join(here, '../backend/tests/.generated/ieee_ml.pdf');
const dist = path.join(here, '../mobile/dist');
const out = path.join(here, 'out/exports');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

assert(existsSync(dist), 'run `make e2e` (it builds the web app first)');
const api = spawn(python, ['-m', 'uvicorn', 'folume.main:app', '--port', String(API)], {
  cwd: path.join(here, '../backend'),
  env: { ...process.env, FOLUME_DATA_DIR: dataDir, FOLUME_CORS_ORIGINS: `http://localhost:${WEB}` },
  stdio: 'ignore',
});
const web = await serve(dist, WEB);
for (let i = 0; i < 80; i++) {
  try {
    if ((await fetch(`http://localhost:${API}/v1/health`)).ok) break;
  } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US', acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const frame = () => page.frameLocator('[data-testid=reader-frame]');
const manifest = [];

console.log('converting a paper to other formats (web build + real API)');
await page.goto(`http://localhost:${WEB}/`);
await page.getByTestId('import-button').waitFor({ timeout: 15000 });
await page.getByTestId('open-settings').click();
await page.getByTestId('server-url').fill(`http://localhost:${API}`);
await page.getByTestId('server-url').blur();
await page.getByTestId('screen-back').click();
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('import-button').click()]);
await chooser.setFiles(pdf);
await page.waitForURL(/\/reader\//, { timeout: 90000 });
await frame().locator('#book .h').first().waitFor({ timeout: 20000 });

const openSheet = async () => {
  await page.getByTestId('open-export').click();
  await page.getByTestId('export-sheet').waitFor();
};
const sheet = () => page.getByTestId('export-sheet');
const pick = (label) => sheet().getByRole('button', { name: label, exact: true }).click();
/** Sets a switch to the wanted state. */
const setSwitch = async (testId, want) => {
  const sw = page.getByTestId(testId);
  const on = await sw.locator('input').isChecked();
  if (on !== want) await sw.click();
  assert((await sw.locator('input').isChecked()) === want, `${testId} did not switch`);
};
const run = async (record) => {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-go').click()]);
  const file = download.suggestedFilename();
  await download.saveAs(path.join(out, file));
  await page.getByTestId('export-done').waitFor({ timeout: 10000 });
  manifest.push({ file, ...record });
  return file;
};

await check('the reader offers "Convert and share" with four formats and explains each', async () => {
  await openSheet();
  for (const f of ['EPUB book', 'Web page', 'Markdown', 'Plain text']) {
    await sheet().getByRole('button', { name: f, exact: true }).waitFor();
  }
  assert((await page.getByText('Chapters, contents and page markers', { exact: false }).count()) >= 1, 'epub hint');
  await page.screenshot({ path: path.join(shots, 'export-01-sheet.png') });
});

await check('EPUB in the Book style downloads a book named after the paper', async () => {
  const file = await run({ format: 'epub', appendix: true, layout: 'book' });
  assert(file === 'Sparse-Routing-for-Efficient-Transformers.epub', file);
  assert(/Ready: .*\.epub/.test(await page.getByTestId('export-done').textContent()), 'confirmation');
  assert(/letters and digits/.test(await page.getByTestId('export-done').textContent()), 'summary');
});

await check('EPUB in the Magazine style is a different book with the same text', async () => {
  await pick('Magazine');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-go').click()]);
  await download.saveAs(path.join(out, 'magazine.epub'));
  manifest.push({ file: 'magazine.epub', format: 'epub', appendix: true, layout: 'magazine' });
});

await check('a web page in each colour theme', async () => {
  await pick('Web page');
  await pick('Book');
  const book = await run({ format: 'html', appendix: true, layout: 'book', theme: 'paper' });
  await pick('Magazine');
  await pick('Dark');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-go').click()]);
  await download.saveAs(path.join(out, 'magazine-dark.html'));
  manifest.push({ file: 'magazine-dark.html', format: 'html', appendix: true, layout: 'magazine', theme: 'dark' });
  assert(book.endsWith('.html'), book);
});

await check('Markdown comes as a ZIP with its pictures, or as one file without them', async () => {
  await pick('Markdown');
  const zip = await run({ format: 'markdown', appendix: true });
  assert(zip.endsWith('.zip'), zip);
  await setSwitch('export-images', false);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-go').click()]);
  assert(download.suggestedFilename().endsWith('.md'), download.suggestedFilename());
  await download.saveAs(path.join(out, 'no-images.md'));
  manifest.push({ file: 'no-images.md', format: 'markdown', appendix: true });
  await setSwitch('export-images', true);
});

await check('plain text, and the removed page text can be left out', async () => {
  await pick('Plain text');
  assert((await page.getByTestId('export-images').count()) === 0, 'no picture switch for text');
  await run({ format: 'text', appendix: true });
  await setSwitch('export-appendix', false);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-go').click()]);
  await download.saveAs(path.join(out, 'no-appendix.txt'));
  manifest.push({ file: 'no-appendix.txt', format: 'text', appendix: false });
});

assert(errors.length === 0, `page errors: ${errors.join(' | ')}`);
writeFileSync(path.join(out, 'exports.json'), JSON.stringify(manifest, null, 2));
await page.getByTestId('sheet-close').click().catch(() => {});

console.log('reading the files back with other tools');
const havePandoc = spawnSync('pandoc', ['--version']).status === 0;
if (!havePandoc) console.log('  - skipped: pandoc is not installed (the packaging and browser checks below still run)');
if (havePandoc) await check('pandoc finds every letter of the PDF text in every file, and the EPUB packaging is valid', async () => {
  const docJson = path.join(here, 'out/ieee_ml/document.json');
  const r = spawnSync(python, ['-I', path.join(here, 'verify_exports.py'), out, docJson], { encoding: 'utf8', env: { ...process.env, PYTHONPATH: path.join(here, '../backend/src') } });
  console.log(r.stdout.split('\n').map((l) => `      ${l}`).join('\n').trimEnd());
  if (r.status !== 0) throw new Error(`verification failed\n${r.stderr.slice(-800)}`);
});

const files = readdirSync(out);
const viewer = await browser.newContext({ viewport: { width: 900, height: 1100 }, deviceScaleFactor: 1 });
const view = await viewer.newPage();
const viewErrors = [];
view.on('pageerror', (e) => viewErrors.push(String(e)));
view.on('console', (m) => m.type() === 'error' && viewErrors.push(m.text()));

await check('the web page opens by itself with its pictures, in columns for the magazine style', async () => {
  await view.goto(`file://${path.join(out, 'magazine-dark.html')}`);
  const facts = await view.evaluate(() => ({
    columns: getComputedStyle(document.querySelector('main')).columnCount,
    bg: getComputedStyle(document.body).backgroundColor,
    images: [...document.images].map((i) => [i.complete, i.naturalWidth]),
    overflow: document.documentElement.scrollWidth - innerWidth,
    scripts: document.scripts.length,
  }));
  assert(facts.columns === '2', `columns ${facts.columns}`);
  assert(facts.bg === 'rgb(23, 24, 27)', `background ${facts.bg}`);
  assert(facts.images.length >= 5 && facts.images.every(([ok, w]) => ok && w > 0), `images ${JSON.stringify(facts.images)}`);
  assert(facts.overflow <= 1, `horizontal overflow ${facts.overflow}`);
  assert(facts.scripts === 0, 'no scripts');
  await view.screenshot({ path: path.join(shots, 'export-02-magazine-dark.png') });
  const bookName = files.find((f) => f.endsWith('.html') && f !== 'magazine-dark.html');
  await view.setViewportSize({ width: 390, height: 844 });
  await view.goto(`file://${path.join(out, bookName)}`);
  const phone = await view.evaluate(() => ({ columns: getComputedStyle(document.querySelector('main')).columnCount, overflow: document.documentElement.scrollWidth - innerWidth }));
  assert(phone.columns === 'auto' && phone.overflow <= 1, JSON.stringify(phone));
  await view.screenshot({ path: path.join(shots, 'export-03-book.png') });
});

await check('every chapter of the EPUB is valid XHTML to a real browser, and renders', async () => {
  const unzipped = path.join(out, 'Sparse-Routing-for-Efficient-Transformers.unzipped/OEBPS');
  const chapters = readdirSync(unzipped).filter((f) => /^c\d+\.xhtml$/.test(f));
  assert(chapters.length >= 6, `${chapters.length} chapters`);
  for (const ch of chapters) {
    await view.goto(`file://${path.join(unzipped, ch)}`);
    const bad = await view.evaluate(() => document.querySelector('parsererror')?.textContent ?? null);
    assert(bad === null, `${ch}: ${bad}`);
    assert((await view.evaluate(() => document.contentType)) === 'application/xhtml+xml', `${ch} is not read as XHTML`);
  }
  await view.goto(`file://${path.join(unzipped, chapters[1])}`);
  await view.screenshot({ path: path.join(shots, 'export-04-epub-chapter.png') });
});

assert(viewErrors.length === 0, `viewer errors: ${viewErrors.join(' | ')}`);
await browser.close();
web.close();
api.kill();
done();
