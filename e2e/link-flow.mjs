// Adding a paper from a link, end to end: web build + real API + a local "publisher" site.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assert, check, done, here, launch, shots } from './lib.mjs';
import { serve } from './serve.mjs';

const API_OPEN = 8768; // allowed to fetch from private addresses (the local test site)
const API_STRICT = 8769; // default: refuses them
const SITE = 8790;
const WEB = 8084;
const tmp = mkdtempSync(path.join(tmpdir(), 'folume-e2e-'));
const python = path.join(here, '../backend/.venv/bin/python');
const dist = path.join(here, '../mobile/dist');
const pdf = readFileSync(path.join(here, '../backend/tests/.generated/ieee_ml.pdf'));

// a tiny publisher: a PDF, a redirect, a landing page that points to its PDF, and a page with no PDF at all
const site = createServer((req, res) => {
  const route = req.url.split('?')[0];
  const send = (status, type, body, extra = {}) => {
    res.writeHead(status, { 'content-type': type, ...extra });
    res.end(body);
  };
  if (route === '/paper.pdf') return send(200, 'application/pdf', pdf);
  if (route === '/go') return send(302, 'text/plain', '', { location: '/paper.pdf' });
  if (route === '/landing') {
    return send(200, 'text/html', `<html><head><meta name="citation_pdf_url" content="/paper.pdf"></head><body>Abstract page</body></html>`);
  }
  if (route === '/notpdf') return send(200, 'text/html', '<html><body>Just a page.</body></html>');
  return send(404, 'text/plain', 'nope');
});
await new Promise((r) => site.listen(SITE, r));

const start = (port, extra) =>
  spawn(python, ['-m', 'uvicorn', 'folume.main:app', '--port', String(port)], {
    cwd: path.join(here, '../backend'),
    env: { ...process.env, FOLUME_DATA_DIR: path.join(tmp, `jobs${port}`), FOLUME_CORS_ORIGINS: `http://localhost:${WEB}`, ...extra },
    stdio: 'ignore',
  });
const apiOpen = start(API_OPEN, { FOLUME_ALLOW_PRIVATE_URLS: '1' });
const apiStrict = start(API_STRICT, {});
const web = await serve(dist, WEB);
for (const port of [API_OPEN, API_STRICT]) {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/v1/health`)).ok) break;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
}

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const shot = (n) => page.screenshot({ path: path.join(shots, `link-${n}.png`) });
const frame = () => page.frameLocator('[data-testid=reader-frame]');
const useServer = async (port) => {
  await page.getByTestId('open-settings').click();
  await page.getByTestId('server-url').fill(`http://localhost:${port}`);
  await page.getByTestId('server-url').blur();
  await page.getByTestId('screen-back').click();
};
const openLinkSheet = async () => {
  await page.getByTestId('import-link-button').click();
  await page.getByTestId('link-sheet').waitFor();
};
const importLink = async (url) => {
  await openLinkSheet();
  await page.getByTestId('link-input').fill(url);
  await page.getByTestId('link-go').click();
};

console.log('adding a paper from a link (web build + real API + local site)');
await page.goto(`http://localhost:${WEB}/`);
await page.getByTestId('import-link-button').waitFor({ timeout: 15000 });
await useServer(API_OPEN);

await check('the web app installs and receives shares: a manifest with a share target, and a link handed over by the browser opens ready to add', async () => {
  const base = `http://localhost:${WEB}`;
  const html = await (await fetch(`${base}/`)).text();
  assert(/<link rel="manifest" href="\/manifest\.webmanifest"/.test(html), 'the page links its manifest');
  assert(/serviceWorker/.test(html), 'the page registers its service worker');
  const res = await fetch(`${base}/manifest.webmanifest`);
  assert(/manifest\+json/.test(res.headers.get('content-type')), res.headers.get('content-type'));
  const manifest = await res.json();
  assert(manifest.display === 'standalone' && manifest.start_url === '/' && manifest.name === 'Folume', 'installable');
  assert(manifest.share_target.action === '/' && manifest.share_target.method === 'GET', 'share target');
  assert(JSON.stringify(manifest.share_target.params) === JSON.stringify({ title: 'title', text: 'text', url: 'url' }), 'share params');
  assert(manifest.icons.some((i) => i.sizes === '192x192') && manifest.icons.some((i) => i.sizes === '512x512') && manifest.icons.some((i) => i.purpose === 'maskable'), 'icons');
  for (const icon of manifest.icons) {
    const r = await fetch(`${base}${icon.src}`);
    assert(r.ok && r.headers.get('content-type') === 'image/png', `icon ${icon.src}`);
  }
  assert((await fetch(`${base}/sw.js`)).headers.get('content-type') === 'text/javascript', 'service worker is a script');
  // Android's share menu hands over a title and a text with the link inside it
  await page.goto(`${base}/?title=Paper&text=${encodeURIComponent('Sparse Routing for Efficient Transformers https://arxiv.org/abs/2401.01234.')}`);
  await page.getByTestId('link-sheet').waitFor({ timeout: 15000 });
  assert((await page.getByTestId('link-input').inputValue()) === 'https://arxiv.org/abs/2401.01234', await page.getByTestId('link-input').inputValue());
  assert(/arXiv 2401\.01234/.test(await page.getByTestId('link-kind').textContent()), 'recognised');
  assert(!/text=|title=/.test(page.url()), `the address is cleaned up: ${page.url()}`);
  await shot('01b-shared');
  // a plain link, as Safari and Chrome hand over a page
  await page.goto(`${base}/?url=${encodeURIComponent('https://example.org/paper.pdf')}`);
  await page.getByTestId('link-sheet').waitFor({ timeout: 15000 });
  assert((await page.getByTestId('link-input').inputValue()) === 'https://example.org/paper.pdf', 'url param');
  // the extension and the bookmarklet use ?import=; a deep link uses /import?url=
  await page.goto(`${base}/?import=${encodeURIComponent('10.1145/3292500.3330701')}`);
  await page.getByTestId('link-sheet').waitFor({ timeout: 15000 });
  assert((await page.getByTestId('link-input').inputValue()) === '10.1145/3292500.3330701', 'import param');
  await page.goto(`${base}/import?url=${encodeURIComponent('https://arxiv.org/abs/2401.01234')}`);
  await page.getByTestId('link-sheet').waitFor({ timeout: 15000 });
  assert((await page.getByTestId('link-input').inputValue()) === 'https://arxiv.org/abs/2401.01234', 'deep link');
  // something that names no paper opens the library and nothing else
  await page.goto(`${base}/?text=${encodeURIComponent('no links here at all')}`);
  await page.getByTestId('import-link-button').waitFor({ timeout: 15000 });
  assert((await page.getByTestId('link-sheet').count()) === 0, 'no dialog for nothing');
});

await check('Settings offers the bookmarklet, which opens this app with the page being read', async () => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://localhost:${WEB}` });
  await page.goto(`http://localhost:${WEB}/`);
  await page.getByTestId('open-settings').click();
  await page.getByTestId('send-settings').waitFor();
  await page.getByTestId('copy-bookmarklet').click();
  await page.getByText('Copied.').waitFor();
  const code = await page.evaluate(() => navigator.clipboard.readText());
  assert(code.startsWith('javascript:') && !code.includes('\n'), code.slice(0, 80));
  // run it as a browser would, on another page, and see what it opens
  const opened = await page.evaluate((c) => {
    let url = null;
    const fake = { open: (u) => { url = u; }, };
    new Function('window', 'location', 'encodeURIComponent', decodeURIComponent(c.slice('javascript:'.length)))(fake, { href: 'https://arxiv.org/abs/2401.01234' }, encodeURIComponent);
    return url;
  }, code);
  assert(opened === `http://localhost:${WEB}/?import=https%3A%2F%2Farxiv.org%2Fabs%2F2401.01234`, opened);
  await page.getByTestId('screen-back').click();
});

await check('the dialog recognises arXiv ids, DOIs and links, and refuses nonsense before sending anything', async () => {
  await openLinkSheet();
  const input = page.getByTestId('link-input');
  await input.fill('not a link');
  await page.getByTestId('link-invalid').waitFor();
  assert(await page.getByTestId('link-go').isDisabled(), 'cannot submit nonsense');
  for (const [text, expected] of [
    ['2401.01234', 'arXiv 2401.01234'],
    ['https://arxiv.org/abs/2401.01234v2', 'arXiv 2401.01234v2'],
    ['10.1145/3292500.3330701', 'DOI 10.1145/3292500.3330701'],
    ['https://example.org/paper.pdf', 'example.org'],
  ]) {
    await input.fill(text);
    const label = await page.getByTestId('link-kind').textContent();
    assert(label.includes(expected), `${text} → ${label}`);
    assert(!(await page.getByTestId('link-go').isDisabled()), `${text} can be submitted`);
  }
  await shot('01-dialog');
  await page.getByTestId('sheet-close').click();
});

await check('a link to a PDF is downloaded by the server, converted and opened', async () => {
  await importLink(`http://localhost:${SITE}/paper.pdf`);
  await page.waitForURL(/\/reader\//, { timeout: 90000 });
  await frame().locator('#book .h').first().waitFor({ timeout: 20000 });
  assert(/INTRODUCTION/i.test(await frame().locator('#book .h').first().textContent()), 'reader shows the paper');
  await shot('02-reader');
});

await check('the report says every letter is there, and the library knows there is no stored original', async () => {
  await page.getByTestId('open-more').click();
  await page.getByTestId('more-report').click();
  await page.getByTestId('completeness').waitFor();
  assert(/All [\d,]+ letters and digits of the PDF text layer are in this document/.test(await page.getByTestId('completeness').textContent()), 'completeness verdict');
  await page.getByTestId('screen-back').click();
  await page.getByTestId('reader-back').click();
  await page.locator('[data-testid^=paper-]').first().waitFor();
});

await check('a redirect and a landing page with a PDF link both lead to the same paper, which is not added twice', async () => {
  for (const url of [`http://localhost:${SITE}/go`, `http://localhost:${SITE}/landing`]) {
    await importLink(url);
    await page.waitForURL(/\/reader\//, { timeout: 90000 });
    await frame().locator('#book .h').first().waitFor({ timeout: 20000 });
    await page.getByTestId('reader-back').click();
    await page.locator('[data-testid^=paper-]').first().waitFor();
  }
  assert((await page.locator('[data-testid^=paper-]').count()) === 1, 'the same paper is one library entry');
});

await check('a page without a PDF gives an actionable message', async () => {
  await importLink(`http://localhost:${SITE}/notpdf`);
  await page.getByTestId('import-error').waitFor({ timeout: 30000 });
  assert(/could not be downloaded from this link|not a PDF/i.test(await page.getByTestId('import-error').textContent()), 'message');
  await shot('03-error');
  await page.getByRole('button', { name: 'Close' }).click();
});

await check('a link that 404s says the download failed', async () => {
  await importLink(`http://localhost:${SITE}/missing.pdf`);
  await page.getByTestId('import-error').waitFor({ timeout: 30000 });
  assert(/downloaded/i.test(await page.getByTestId('import-error').textContent()), 'message');
  await page.getByRole('button', { name: 'Close' }).click();
});

await check('a server that is not told otherwise refuses to fetch from internal addresses', async () => {
  await useServer(API_STRICT);
  await importLink(`http://localhost:${SITE}/paper.pdf`);
  await page.getByTestId('import-error').waitFor({ timeout: 30000 });
  assert(/public internet addresses/.test(await page.getByTestId('import-error').textContent()), 'blocked message');
  await shot('04-blocked');
});

assert(errors.length === 0, `page errors: ${errors.join(' | ')}`);
await browser.close();
web.close();
site.close();
apiOpen.kill();
apiStrict.kill();
done();
