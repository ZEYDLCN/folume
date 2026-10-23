// Knowledge workspace in Chromium: two "devices" (separate browser contexts) against one real API with sync on.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assert, check, done, here, launch, shots } from './lib.mjs';
import { serve } from './serve.mjs';

const API = 8767;
const LLM = 8798;
const ARXIV = 8799;
const WEB = 8083;
const tmp = mkdtempSync(path.join(tmpdir(), 'folume-e2e-'));
const python = path.join(here, '../backend/.venv/bin/python');
const gen = path.join(here, '../backend/tests/.generated');
const dist = path.join(here, '../mobile/dist');
const SYNC_KEY = 'correct horse battery staple';
const NAMESPACE = createHash('sha256').update(`folume-sync-v1:${SYNC_KEY}`).digest('hex');

const llm = spawn(python, [path.join(here, 'fake_llm_server.py'), String(LLM)], { stdio: 'ignore' });
const arxiv = spawn(python, [path.join(here, 'fake_arxiv_server.py'), String(ARXIV)], { stdio: 'ignore' });
const api = spawn(python, ['-m', 'uvicorn', 'folume.main:app', '--port', String(API)], {
  cwd: path.join(here, '../backend'),
  env: {
    ...process.env,
    FOLUME_DATA_DIR: path.join(tmp, 'jobs'),
    FOLUME_CORS_ORIGINS: `http://localhost:${WEB}`,
    FOLUME_LLM_BASE_URL: `http://127.0.0.1:${LLM}`,
    FOLUME_LLM_MODEL: 'fake-model',
    FOLUME_FEED_URL: `http://127.0.0.1:${ARXIV}/api/query`,
    FOLUME_ALLOW_PRIVATE_URLS: '1',
    FOLUME_SYNC_ENABLED: '1',
    FOLUME_SYNC_DB: path.join(tmp, 'sync.sqlite3'),
  },
  stdio: 'ignore',
});
const web = await serve(dist, WEB);
const up = async (url) => {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${url} did not start`);
};
await up(`http://localhost:${API}/v1/health`);
await up(`http://127.0.0.1:${LLM}/__requests`);
await up(`http://127.0.0.1:${ARXIV}/__requests`);

const browser = await launch();
const errors = [];

async function device(name) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US', acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  page.on('dialog', (d) => d.accept());
  await page.goto(`http://localhost:${WEB}/`);
  await page.getByTestId('open-settings').waitFor({ timeout: 15000 });
  await page.getByTestId('open-settings').click();
  await page.getByTestId('server-url').fill(`http://localhost:${API}`);
  await page.getByTestId('server-url').blur();
  await page.getByTestId('screen-back').click();
  const home = async () => {
    await page.goto(`http://localhost:${WEB}/`);
    await page.getByTestId('open-settings').waitFor({ timeout: 15000 });
  };
  const frame = () => page.frameLocator('[data-testid=reader-frame]');
  const readerFrame = async () => (await page.locator('[data-testid=reader-frame]').elementHandle()).contentFrame();
  const shot = (n) => page.screenshot({ path: path.join(shots, `knowledge-${name}-${n}.png`) });
  const importPdf = async (file) => {
    await page.getByTestId('import-button').waitFor();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('import-button').click()]);
    await chooser.setFiles(path.join(gen, file));
    await page.waitForURL(/\/reader\//, { timeout: 90000 });
    await frame().locator('#book .h').first().waitFor({ timeout: 20000 });
    const id = page.url().split('/reader/')[1].split('?')[0];
    await page.getByTestId('reader-back').click();
    await page.getByTestId(`paper-${id}`).waitFor();
    return id;
  };
  const selectInParagraph = async (index, n) => {
    const f = await readerFrame();
    await f.evaluate(([i, len]) => {
      const el = document.querySelectorAll('#book .blk-paragraph .bt')[i];
      el.scrollIntoView({ block: 'center' });
      const first = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
      const range = document.createRange();
      range.setStart(first, 0);
      range.setEnd(first, Math.min(len, first.textContent.length));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }, [index, n]);
    await page.getByTestId('selection-bar').waitFor({ timeout: 5000 });
  };
  const setSwitch = async (testId, on) => {
    const input = page.getByTestId(testId).locator('input');
    if ((await input.isChecked()) !== on) await page.getByTestId(testId).click();
  };
  return { context, page, home, frame, readerFrame, shot, importPdf, selectInParagraph, setSwitch };
}

console.log('knowledge workspace (web build + real API with sync + fake model)');
const A = await device('A');
let ieee = '';
let companion = '';

await check('device A imports two related papers', async () => {
  ieee = await A.importPdf('ieee_ml.pdf');
  companion = await A.importPdf('ml_companion.pdf');
  assert((await A.page.locator('[data-testid^=paper-]').count()) === 2, 'two papers in the library');
  await A.shot('01-library');
});

await check('the library offers to continue the paper you were in the middle of', async () => {
  const p = A.page;
  assert((await p.getByTestId('continue-card').count()) === 0, 'nothing to continue before reading');
  await p.getByTestId(`paper-${ieee}`).click();
  await A.frame().locator('#book .h').first().waitFor({ timeout: 20000 });
  await p.getByTestId('open-contents').click();
  await p.getByTestId('contents-list').waitFor();
  await p.getByText('EXPERIMENTS').first().click();
  await p.waitForFunction(() => document.querySelector('[data-testid=reader-position]')?.textContent?.includes('2 / 3'), null, { timeout: 10000 });
  await p.getByTestId('reader-back').click();
  await p.getByTestId('continue-card').waitFor({ timeout: 10000 });
  const text = await p.getByTestId('continue-card').textContent();
  assert(/Continue reading/.test(text) && /Sparse Routing/.test(text) && /\d+% read/.test(text), text);
  await A.shot('01b-continue');
  await p.getByTestId('continue-card').click();
  await A.frame().locator('#book .h').first().waitFor({ timeout: 20000 });
  await p.waitForFunction(() => document.querySelector('[data-testid=reader-position]')?.textContent?.includes('2 / 3'), null, { timeout: 10000 });
  await p.getByTestId('reader-back').click();
  await p.getByTestId(`paper-${ieee}`).waitFor();
});

await check('tags label papers and filter the library', async () => {
  const p = A.page;
  await p.getByTestId(`tags-${ieee}`).click();
  await p.getByTestId('tags-sheet').waitFor();
  await p.getByTestId('tag-input').fill('reading-group');
  await p.getByTestId('tag-add').click();
  await A.shot('02-tags-sheet');
  await p.getByTestId('tags-save').click();
  await p.getByTestId(`tag-list-${ieee}`).waitFor();
  assert((await p.getByTestId(`tag-list-${ieee}`).textContent()).includes('reading-group'), 'tag shown on the card');
  await p.getByTestId('filter-reading-group').click();
  await p.getByTestId(`paper-${ieee}`).waitFor();
  assert((await p.getByTestId(`paper-${companion}`).count()) === 0, 'other paper filtered out');
  await p.getByTestId('filter-all').click();
  await p.getByTestId(`paper-${companion}`).waitFor();
});

await check('the reading list takes a Zotero-style bibliography file, a DOI by hand, and hands a paper to "add from a link"', async () => {
  const p = A.page;
  await p.getByTestId('open-want').click();
  await p.getByTestId('want-empty').waitFor();
  const bib = path.join(tmp, 'library.bib');
  writeFileSync(bib, `@article{a, title={Attention Is {All} You Need}, author={Vaswani, Ashish and Shazeer, Noam}, year={2017}, doi={10.48550/arXiv.1706.03762}, eprint={1706.03762}}
@inproceedings{b, title={{BERT}: Pre-training of Deep Bidirectional Transformers}, author={Devlin, Jacob}, year=2019, url={https://arxiv.org/abs/1810.04805}}
@book{c, title={The Art of Computer Programming}, author={Knuth, Donald E.}, year={1968}}
`);
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.getByTestId('want-import-file').click()]);
  await chooser.setFiles(bib);
  await p.getByTestId('want-message-ok').waitFor();
  assert(/Added 3 papers; 0 were already/.test(await p.getByTestId('want-message-ok').textContent()), await p.getByTestId('want-message-ok').textContent());
  await p.getByText('Attention Is All You Need').waitFor();
  assert((await p.getByText('Ashish Vaswani').count()) >= 1, 'authors are written First Last');
  // the same file again adds nothing
  const [again] = await Promise.all([p.waitForEvent('filechooser'), p.getByTestId('want-import-file').click()]);
  await again.setFiles(bib);
  await p.waitForFunction(() => /Added 0 papers; 3 were already/.test(document.querySelector('[data-testid=want-message-ok]')?.textContent ?? ''));
  // a DOI by hand
  await p.getByTestId('want-input').fill('10.1145/3292500.3330701');
  await p.getByTestId('want-add').click();
  await p.getByText('doi:10.1145/3292500.3330701').first().waitFor();
  await A.shot('02c-reading-list');
  // hand a paper over: the library opens the link dialog with its arXiv id filled in
  const bert = p.locator('[data-testid^=want-w]').filter({ hasText: 'BERT' }).first();
  await bert.locator('[data-testid^=want-import-]').click();
  await p.getByTestId('link-sheet').waitFor();
  assert((await p.getByTestId('link-input').inputValue()) === '1810.04805', await p.getByTestId('link-input').inputValue());
  assert(/arXiv 1810\.04805/.test(await p.getByTestId('link-kind').textContent()), 'recognised as arXiv');
  await p.getByTestId('sheet-close').click();
  await p.getByTestId('open-want').click();
  // reading it can be ticked off
  await p.locator('[data-testid^=want-done-]').first().click();
  await p.getByText(/Already read \(1\)/).waitFor();
  await p.getByTestId('screen-back').click();
  await p.getByTestId('want-badge').waitFor();
});

await check('following a topic on arXiv lists its newest papers, marks the ones not seen before, and hands them to the reading list or the library', async () => {
  const p = A.page;
  const asked = async () => (await (await fetch(`http://127.0.0.1:${ARXIV}/__requests`)).json());
  await p.getByTestId('open-feed').click();
  await p.getByTestId('feed-none').waitFor();
  await p.getByTestId('feed-suggest-cs.LG').click();
  assert((await p.getByTestId('feed-category').inputValue()) === 'cs.LG', 'a suggestion fills the category');
  await p.getByTestId('feed-follow').click();
  await p.getByTestId('feed-results').waitFor({ timeout: 20000 });
  assert((await p.locator('[data-testid^=feed-paper-]').count()) === 3, 'three papers');
  assert(/3 new papers/.test(await p.getByTestId('feed-new-count').textContent()), 'all three are new the first time');
  assert((await asked()).at(-1) === 'cat:cs.LG', `the server asked arXiv for ${(await asked()).at(-1)}`);
  // BERT is already on the reading list (from the bibliography file); the others are not
  const bert = p.getByTestId('feed-paper-1810_04805');
  assert(/On your reading list/.test(await bert.textContent()), 'known to the reading list');
  assert((await p.getByTestId('feed-want-1810_04805').count()) === 0, 'no second copy offered');
  await A.shot('02e-feed');
  await p.getByTestId('feed-want-2401_01234').click();
  await p.getByTestId('feed-notice').waitFor();
  assert(/Added to your reading list/.test(await p.getByTestId('feed-notice').textContent()), 'added');
  assert(/On your reading list/.test(await p.getByTestId('feed-paper-2401_01234').textContent()), 'now on the list');
  // a second topic, by keywords
  await p.getByTestId('feed-keywords').fill('sparse routing');
  await p.getByTestId('feed-follow').click();
  await p.waitForFunction(() => document.querySelectorAll('[data-testid^=feed-sub-]').length === 2);
  await p.getByTestId('feed-results').waitFor({ timeout: 20000 });
  assert((await asked()).at(-1) === 'all:"sparse routing"', `keywords query: ${(await asked()).at(-1)}`);
  // what was shown counts as seen: nothing is "new" the next time
  await p.getByTestId('screen-back').click();
  await p.getByTestId('open-feed').click();
  await p.getByTestId('feed-results').waitFor({ timeout: 20000 });
  assert((await p.getByTestId('feed-new-count').count()) === 0, 'nothing new the second time');
  assert((await p.getByText('New', { exact: true }).count()) === 0, 'no New badges');
  // hand a paper to the library: the link dialog opens with its arXiv id
  await p.getByTestId('feed-import-hep_th_9901001').click();
  await p.getByTestId('link-sheet').waitFor();
  assert((await p.getByTestId('link-input').inputValue()) === 'hep-th/9901001', await p.getByTestId('link-input').inputValue());
  await p.getByTestId('sheet-close').click();
  // stop following
  await p.getByTestId('open-feed').click();
  await p.locator('[data-testid^=feed-unfollow-]').first().click();
  await p.locator('[data-testid^=feed-unfollow-]').first().click();
  await p.getByTestId('feed-none').waitFor();
  await p.getByTestId('screen-back').click();
});

await check('search finds text across papers and opens the paper at that block', async () => {
  const p = A.page;
  await p.getByTestId('open-search').click();
  await p.getByTestId('search-input').fill('contrastive pretraining');
  await p.getByTestId('search-hit').first().waitFor({ timeout: 10000 });
  const first = await p.getByTestId('search-hit').first().textContent();
  assert(/Learning Compact Representations/.test(first), `top hit should be from the companion paper: ${first.slice(0, 120)}`);
  await A.shot('03-search');
  await p.getByTestId('search-hit').first().click();
  await p.waitForURL(/\/reader\/.+block=b\d+/, { timeout: 10000 });
  await A.frame().locator('#book .h').first().waitFor({ timeout: 20000 });
  await p.getByTestId('reader-back').click();
  await p.getByTestId('search-input').waitFor();
  await p.getByTestId('search-input').fill('zzzzqqq');
  await p.getByTestId('search-empty').waitFor({ timeout: 10000 });
  await p.getByTestId('screen-back').click();
});

await check('a project holds a table of papers: cells are filled with the papers’ own sentences and pages, and the table exports', async () => {
  const p = A.page;
  await p.getByTestId('open-projects').click();
  await p.getByTestId('projects-empty').waitFor();
  await p.getByTestId('project-new-name').fill('Sparse models review');
  await p.getByTestId('project-create').click();
  await p.getByTestId('project-empty').waitFor();
  await p.getByTestId('project-add-papers').click();
  await p.getByTestId(`project-pick-${ieee}`).click();
  await p.getByTestId(`project-pick-${companion}`).click();
  await p.getByTestId('sheet-close').click();
  await p.getByTestId(`project-paper-${ieee}`).waitFor();
  await p.getByTestId('project-suggest-all').click();
  await p.getByTestId('project-notice').waitFor();
  assert(/Filled \d+ cells/.test(await p.getByTestId('project-notice').textContent()), await p.getByTestId('project-notice').textContent());
  const results = await p.getByTestId(`cell-${ieee}-c4`).inputValue();
  assert(/\d+%/.test(results) && /\(p\. \d+\)$/.test(results), `results cell: ${results}`);
  const limits = await p.getByTestId(`cell-${ieee}-c5`).inputValue();
  assert(/limitation of expert gating/i.test(limits), `limitations cell: ${limits}`);
  // every filled cell is a sentence of the paper itself
  const doc = JSON.parse(readFileSync(path.join(here, 'out/ieee_ml/document.json'), 'utf8'));
  const all = doc.blocks.map((b) => b.text).join('\n');
  for (const c of ['c1', 'c2', 'c3', 'c4', 'c5']) {
    const v = await p.getByTestId(`cell-${ieee}-${c}`).inputValue();
    assert(v === '' || all.includes(v.replace(/ \(p\. \d+\)$/, '')), `cell ${c} is not from the paper: ${v}`);
  }
  // writing by hand, and a column of one's own
  await p.getByTestId(`cell-${companion}-c1`).fill('My own note');
  await p.getByTestId(`cell-${companion}-c1`).blur();
  await p.getByTestId('project-columns').click();
  await p.getByTestId('column-new').fill('Random seeds');
  await p.getByTestId('column-add').click();
  await p.getByTestId('sheet-close').click();
  await p.getByTestId(`cell-suggest-${ieee}-c6`).click();
  await p.waitForFunction((id) => /seeds/i.test(document.querySelector(`[data-testid="cell-${id}-c6"]`)?.value ?? ''), ieee);
  await A.shot('02d-project');
  // the table leaves as CSV and Excel
  await p.getByTestId('project-export').click();
  const [csv] = await Promise.all([p.waitForEvent('download'), p.getByTestId('project-export-csv').click()]);
  const text = readFileSync(await csv.path(), 'utf8').replace(/^﻿/, '');
  const lines = text.split('\r\n');
  assert(lines[0] === 'Paper,Authors,Year,Problem,Method,Data,Results,Limitations,Random seeds', lines[0]);
  assert(text.includes('Sparse Routing for Efficient Transformers') && text.includes('My own note'), text.slice(0, 300));
  await p.getByTestId('project-export').click();
  const [xlsx] = await Promise.all([p.waitForEvent('download'), p.getByTestId('project-export-xlsx').click()]);
  const bytes = readFileSync(await xlsx.path());
  assert(bytes.subarray(0, 2).toString() === 'PK' && bytes.includes('xl/worksheets/sheet1.xml') && bytes.includes('My own note'), 'a workbook with the cell');
  // it is still there after leaving
  await p.getByTestId('project-back').click();
  const card = p.locator('[data-testid^=project-p]').filter({ hasText: '2 papers' }).first();
  await card.waitFor({ timeout: 10000 });
  await card.click();
  await p.getByTestId(`cell-${companion}-c1`).waitFor();
  assert((await p.getByTestId(`cell-${companion}-c1`).inputValue()) === 'My own note', 'the cell is kept');
  await p.getByTestId('project-delete').click();
  await p.getByTestId('projects-empty').waitFor();
  await p.getByTestId('screen-back').click();
});

await check('connections show shared concepts, with their relation and a way to both sources', async () => {
  const p = A.page;
  await p.getByTestId(`connections-${ieee}`).click();
  await p.getByTestId(`related-${companion}`).waitFor({ timeout: 15000 });
  const text = await p.getByTestId(`related-${companion}`).textContent();
  assert(/Large Language Model/i.test(text), `shared concept: ${text.slice(0, 200)}`);
  assert(/Both define it|Complementary|Common/.test(text), 'relation badge');
  assert((await p.getByTestId('concept').count()) >= 3, 'concepts of this paper are listed');
  await A.shot('04-connections');
});

await check('AI comparison shows what is sent first and cites passages of both papers', async () => {
  const p = A.page;
  await p.getByTestId('screen-back').click();
  await p.getByTestId('open-settings').click();
  await A.setSwitch('switch-ai', true);
  await p.getByTestId('screen-back').click();
  await p.getByTestId(`connections-${ieee}`).click();
  await p.getByTestId('compare-open').first().waitFor({ timeout: 15000 });
  await p.getByTestId('compare-open').first().click();
  await p.getByTestId('send-preview').waitFor({ timeout: 10000 });
  const before = (await (await fetch(`http://127.0.0.1:${LLM}/__requests`)).json()).length;
  assert(before === 0, 'nothing is sent before confirmation');
  await A.shot('05-compare-preview');
  await p.getByTestId('send-confirm').click();
  await p.getByTestId('compare-result').waitFor({ timeout: 15000 });
  assert((await p.getByTestId('compare-relation').textContent()).length > 5, 'relation stated');
  assert((await p.getByTestId('segment-grounded').count()) >= 1, 'grounded segment');
  await A.shot('06-compare-result');
  const reqs = await (await fetch(`http://127.0.0.1:${LLM}/__requests`)).json();
  assert(reqs.length === 1, 'exactly one model call');
  const user = reqs[0].messages.find((m) => m.role === 'user').content;
  const textSent = typeof user === 'string' ? user : user.map((x) => x.text ?? '').join('\n');
  assert(/<paper_a/.test(textSent) && /<paper_b/.test(textSent), 'both papers are delimited');
  await p.getByTestId('sheet-close').click();
});

await check('asking the library searches every paper, shows what is sent, and cites passages with their paper', async () => {
  const p = A.page;
  await p.getByTestId('screen-back').click();
  await p.getByTestId('open-ask').click();
  const count = async () => (await (await fetch(`http://127.0.0.1:${LLM}/__requests`)).json()).length;
  const before = await count();
  await p.getByTestId('ask-library-input').fill('How does contrastive pretraining improve robustness?');
  await p.getByTestId('ask-library-send').click();
  await p.getByTestId('send-preview').waitFor({ timeout: 10000 });
  assert((await count()) === before, 'nothing is sent before confirmation');
  assert(/Learning Compact Representations/.test(await p.getByTestId('send-preview').textContent()), 'the preview names the paper a passage comes from');
  await A.shot('05b-ask-preview');
  await p.getByTestId('send-confirm').click();
  await p.getByTestId('ask-result').waitFor({ timeout: 15000 });
  assert((await count()) === before + 1, 'exactly one model call');
  assert((await p.getByTestId('segment-grounded').count()) >= 1, 'a grounded sentence');
  const sent = (await (await fetch(`http://127.0.0.1:${LLM}/__requests`)).json()).at(-1).messages.find((m) => m.role === 'user').content;
  assert(/How does contrastive pretraining improve robustness\?/.test(typeof sent === 'string' ? sent : sent.map((x) => x.text ?? '').join('\n')), 'the question is sent');
  await A.shot('05c-ask-result');
  await p.locator('[data-testid^=cite-]').first().click();
  await p.waitForURL(/\/reader\/.+block=b\d+/, { timeout: 10000 });
  await A.frame().locator('#book .h').first().waitFor({ timeout: 20000 });
  await p.getByTestId('reader-back').click();
  await p.getByTestId('screen-back').click();
});

await check('with AI switched off, asking lists the matching passages and sends nothing', async () => {
  const p = A.page;
  const count = async () => (await (await fetch(`http://127.0.0.1:${LLM}/__requests`)).json()).length;
  const before = await count();
  await p.getByTestId('open-settings').click();
  await A.setSwitch('switch-ai', false);
  await p.getByTestId('screen-back').click();
  await p.getByTestId('open-ask').click();
  await p.getByTestId('ask-library-input').fill('expert gating sensitivity');
  await p.getByTestId('ask-library-send').click();
  await p.getByTestId('ask-result').waitFor({ timeout: 10000 });
  assert(/switched off/.test(await p.getByTestId('ask-result').textContent()), 'says why there is no written answer');
  assert((await p.getByTestId('segment-grounded').count()) >= 1, 'matching passages are listed');
  assert((await count()) === before, 'nothing was sent');
  await p.getByTestId('ask-library-input').fill('zebra crossing xylophone');
  await p.getByTestId('ask-library-send').click();
  await p.getByTestId('ask-none').waitFor({ timeout: 10000 });
  await p.getByTestId('screen-back').click();
  await p.getByTestId('open-settings').click();
  await A.setSwitch('switch-ai', true);
  await p.getByTestId('screen-back').click();
});

await check('a defined concept becomes a review card, and the library shows what is due', async () => {
  const p = A.page;
  await p.getByTestId(`connections-${ieee}`).click();
  await p.getByTestId('concept-add-review').first().waitFor({ timeout: 15000 });
  await p.getByTestId('concept-add-review').first().click();
  await p.getByText('Added to your review list').first().waitFor();
  await p.getByTestId('screen-back').click();
  await p.getByTestId('review-badge').waitFor({ timeout: 10000 });
  assert((await p.getByTestId('review-badge').textContent()).trim() === '1', 'one card due');
});

await check('reviewing a card shows the source and schedules it', async () => {
  const p = A.page;
  await p.getByTestId('open-review').click();
  await p.getByTestId('review-card').waitFor();
  const front = await p.getByTestId('review-front').textContent();
  assert(/^What is “.+”\?$/.test(front), front);
  assert((await p.getByTestId('review-back').count()) === 0, 'answer hidden until asked');
  await p.getByTestId('review-show').click();
  const back = await p.getByTestId('review-back').textContent();
  assert(back.length > 20, 'definition shown');
  await p.getByTestId('review-source').waitFor();
  await A.shot('07-review-answer');
  assert((await p.getByTestId('grade-good').textContent()).includes('1 d'), 'Good schedules one day');
  await p.getByTestId('grade-good').click();
  await p.getByTestId('review-empty').waitFor();
  assert((await p.getByText('Done for today').count()) === 1, 'finished message');
  await p.getByTestId('screen-back').click();
  await p.getByTestId('open-review').waitFor();
  assert((await p.getByTestId('review-badge').count()) === 0, 'nothing due any more');
});

await check('missed quiz questions are added to the review list', async () => {
  const p = A.page;
  await p.getByTestId(`paper-${ieee}`).click();
  await A.frame().locator('#book .h').first().waitFor({ timeout: 20000 });
  const f = await A.readerFrame();
  await f.waitForSelector('[data-quiz]', { timeout: 10000 });
  await f.evaluate(() => document.querySelector('[data-quiz]').scrollIntoView({ block: 'center' }));
  await A.frame().locator('[data-quiz]').first().click();
  await p.getByTestId('quiz-start-local').click();
  await p.getByTestId('quiz-prompt').waitFor();
  for (let i = 0; i < 8; i++) {
    if (await p.getByTestId('quiz-summary').count()) break;
    await p.locator('[data-testid^=choice-]').first().click();
    await p.getByTestId('quiz-check').click();
    await p.getByTestId('quiz-feedback').waitFor();
    await p.getByTestId('quiz-next').click();
    await p.waitForTimeout(120);
  }
  await p.getByTestId('quiz-summary').waitFor();
  await A.shot('08-quiz-summary');
  await p.getByTestId('quiz-cards-added').waitFor({ timeout: 3000 });
  await p.getByTestId('quiz-done').click();
});

await check('a note on device A', async () => {
  const p = A.page;
  await A.frame().locator('#book .h').first().waitFor({ timeout: 20000 });
  await A.selectInParagraph(1, 60);
  await p.getByTestId('sel-note').click();
  await p.getByTestId('note-input').fill('Synced from device A');
  await p.getByTestId('note-save').click();
  await p.waitForTimeout(400);
  await p.getByTestId('reader-back').click();
});

await check('citations export as BibTeX, RIS and CSL-JSON without inventing a venue', async () => {
  const p = A.page;
  await p.getByTestId('open-settings').click();
  await p.getByTestId('open-data').click();
  await p.getByTestId('data-screen').waitFor();
  const grab = async (testId) => {
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }), p.getByTestId(testId).click()]);
    return readFileSync(await dl.path(), 'utf8');
  };
  const bib = await grab('export-bibtex');
  assert((bib.match(/^@misc\{/gm) ?? []).length === 2, 'two entries');
  assert(/title = \{\{Sparse Routing for Efficient Transformers\}\}/.test(bib), 'title');
  assert(!/journal|booktitle/.test(bib), 'no invented venue');
  const ris = await grab('export-ris');
  assert((ris.match(/^TY  - GEN/gm) ?? []).length === 2 && ris.includes('\r\n'), 'ris');
  const csl = JSON.parse(await grab('export-csl'));
  assert(csl.length === 2 && csl[0].type === 'article', 'csl');
  await A.shot('09-data');
});

await check('notes, review cards and highlights go to Obsidian, Anki and Readwise in the formats those apps import', async () => {
  const p = A.page;
  const grab = async (testId) => {
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }), p.getByTestId(testId).click()]);
    return readFileSync(await dl.path());
  };
  const vault = await grab('export-obsidian');
  assert(vault.subarray(0, 2).toString() === 'PK', 'a ZIP');
  for (const needle of ['Folume/Index.md', 'Folume/Sparse Routing for Efficient Transformers.md', 'Synced from device A', 'source: "folume"', '## Highlights and notes']) {
    assert(vault.includes(needle), `the vault has ${needle}`);
  }
  assert(vault.includes('[[Learning Compact Representations with Contrastive Pretraining]]'), 'related papers are linked');
  const anki = (await grab('export-anki')).toString('utf8').split('\n');
  assert(anki.slice(0, 4).join('|') === '#separator:tab|#html:true|#guid column:1|#tags column:4', anki.slice(0, 4).join('|'));
  const rows = anki.slice(4).filter(Boolean);
  assert(rows.length >= 1 && rows.every((r) => r.split('\t').length === 4 && r.startsWith('folume-')), `anki rows: ${rows.join(' // ').slice(0, 300)}`);
  assert(rows.some((r) => /<i>.*Sparse Routing.*, p\. \d+<\/i>/.test(r)), 'a card names its source');
  const rw = (await grab('export-readwise')).toString('utf8').split('\r\n');
  assert(rw[0] === 'Highlight,Title,Author,URL,Note,Location,Date', rw[0]);
  assert(rw.some((r) => r.includes('Synced from device A')), 'the note is in the highlights');
  await p.getByTestId('apps-ok').waitFor();
});

let backupText = '';
await check('a backup holds notes, cards and tags, and restoring it twice changes nothing', async () => {
  const p = A.page;
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }), p.getByTestId('backup-create').click()]);
  backupText = readFileSync(await dl.path(), 'utf8');
  const b = JSON.parse(backupText);
  assert(b.format === 'folume-backup' && b.version === 1, 'format');
  const kinds = new Set(b.records.map((r) => r.key.split('/')[0]));
  for (const k of ['ann', 'card', 'quiz', 'state', 'tags']) assert(kinds.has(k), `backup should contain ${k} records`);
  assert(!/apiKey|syncKey|server/i.test(backupText), 'no settings or secrets in the backup');
  const restoreOnce = async () => {
    const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.getByTestId('backup-restore').click()]);
    await chooser.setFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(backupText) });
    await p.getByTestId('restore-ok').waitFor({ timeout: 8000 });
    return p.getByTestId('restore-ok').textContent();
  };
  const msg = await restoreOnce();
  assert(/0 records restored/.test(msg), `restoring on the same device finds nothing new: ${msg}`);
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.getByTestId('backup-restore').click()]);
  await chooser.setFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"nope":true}') });
  await p.getByTestId('restore-error').waitFor({ timeout: 8000 });
  assert((await p.getByTestId('restore-error').textContent()).includes('not a Folume backup'), 'clear error');
});

await check('sync is off by default; turning it on needs a key and talks only to the configured server', async () => {
  const p = A.page;
  await A.home();
  await p.getByTestId('open-settings').click();
  assert(!(await p.getByTestId('switch-sync').locator('input').isChecked()), 'off by default');
  await A.setSwitch('switch-sync', true);
  await p.getByTestId('sync-key').fill('short');
  await p.getByTestId('sync-key').blur();
  assert(await p.getByTestId('sync-now').isDisabled(), 'sync needs a long enough key');
  await p.getByTestId('sync-key').fill(SYNC_KEY);
  await p.getByTestId('sync-key').blur();
  await p.getByTestId('sync-now').click();
  await p.getByTestId('sync-ok').waitFor({ timeout: 15000 });
  await A.shot('10-sync-settings');
  const status = await (await fetch(`http://localhost:${API}/v1/sync/${NAMESPACE}`)).json();
  assert(status.records >= 5, `server should hold the records under the hashed namespace: ${JSON.stringify(status)}`);
  const raw = readFileSync(path.join(tmp, 'sync.sqlite3'));
  assert(!raw.includes(Buffer.from(SYNC_KEY)), 'the sync key itself never reaches the server');
});

const B = await device('B');
let ieeeB = '';
await check('device B syncs: notes, tags and cards arrive once the paper is imported', async () => {
  const p = B.page;
  ieeeB = await B.importPdf('ieee_ml.pdf');
  assert(ieeeB === ieee, 'same paper, same id on every device');
  await p.getByTestId('open-settings').click();
  await B.setSwitch('switch-sync', true);
  await p.getByTestId('sync-key').fill(SYNC_KEY);
  await p.getByTestId('sync-key').blur();
  await p.getByTestId('sync-now').click();
  await p.getByTestId('sync-ok').waitFor({ timeout: 15000 });
  await p.getByTestId('screen-back').click();
  await p.getByTestId(`tag-list-${ieee}`).waitFor({ timeout: 10000 });
  assert((await p.getByTestId(`tag-list-${ieee}`).textContent()).includes('reading-group'), 'tag arrived');
  await p.getByTestId('review-badge').waitFor({ timeout: 10000 });
  await B.shot('11a-library-with-synced-cards');
  await p.getByTestId('open-notes').click();
  await p.getByText('Synced from device A').waitFor({ timeout: 10000 });
  await B.shot('11-notes-on-b');
});

await check('a deletion on B reaches A', async () => {
  const pb = B.page;
  const pa = A.page;
  // remove the note from the reader on B
  await B.home();
  await pb.getByTestId(`paper-${ieee}`).click();
  await B.frame().locator('#book .h').first().waitFor({ timeout: 20000 });
  await B.frame().locator('mark.hl').first().click();
  await pb.getByTestId('note-delete').click();
  await pb.waitForTimeout(500);
  await B.home();
  await pb.getByTestId('open-settings').click();
  await pb.getByTestId('sync-now').click();
  await pb.getByTestId('sync-ok').waitFor({ timeout: 15000 });
  // A syncs and no longer has the note
  await A.home();
  await pa.getByTestId('open-settings').click();
  await pa.getByTestId('sync-now').click();
  await pa.getByTestId('sync-ok').waitFor({ timeout: 15000 });
  await A.home();
  await pa.getByTestId('open-notes').click();
  await pa.getByTestId('notes-list').waitFor();
  assert((await pa.getByText('Synced from device A').count()) === 0, 'deleted note is gone on A');
});

await check('the server can erase everything stored under the key', async () => {
  const p = A.page;
  await A.home();
  await p.getByTestId('open-settings').click();
  await p.getByTestId('sync-erase').click();
  await p.getByTestId('sync-ok').waitFor({ timeout: 10000 });
  const status = await (await fetch(`http://localhost:${API}/v1/sync/${NAMESPACE}`)).json();
  assert(status.records === 0, `records left: ${status.records}`);
});

assert(errors.length === 0, `page errors: ${errors.join(' | ')}`);
await browser.close();
web.close();
api.kill();
llm.kill();
arxiv.kill();
done();
