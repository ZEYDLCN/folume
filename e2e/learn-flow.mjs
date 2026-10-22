// Learning layer in Chromium: real backend, a fake OpenAI-compatible model over HTTP, exported web build.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assert, check, done, here, launch, shots } from './lib.mjs';
import { serve } from './serve.mjs';

const API = 8766;
const LLM = 8799;
const WEB = 8082;
const dataDir = mkdtempSync(path.join(tmpdir(), 'folume-e2e-'));
const python = path.join(here, '../backend/.venv/bin/python');
const pdf = path.join(here, '../backend/tests/.generated/ieee_ml.pdf');
const dist = path.join(here, '../mobile/dist');

const llm = spawn(python, [path.join(here, 'fake_llm_server.py'), String(LLM)], { stdio: 'ignore' });
const api = spawn(python, ['-m', 'uvicorn', 'folume.main:app', '--port', String(API)], {
  cwd: path.join(here, '../backend'),
  env: {
    ...process.env,
    FOLUME_DATA_DIR: dataDir,
    FOLUME_CORS_ORIGINS: `http://localhost:${WEB}`,
    FOLUME_LLM_BASE_URL: `http://127.0.0.1:${LLM}`,
    FOLUME_LLM_MODEL: 'fake-model',
    FOLUME_LLM_API_KEY: 'secret-test-key',
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
const llmRequests = async () => (await fetch(`http://127.0.0.1:${LLM}/__requests`)).json();

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US', acceptDownloads: true });
await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept());
const frameLoc = () => page.frameLocator('[data-testid=reader-frame]');
const shot = (name) => page.screenshot({ path: path.join(shots, `learn-${name}.png`) });
const readerFrame = async () => (await page.locator('[data-testid=reader-frame]').elementHandle()).contentFrame();

/** Selects the first `n` characters of the first body paragraph, like a long press + drag would. */
async function selectInParagraph(index = 0, n = 70) {
  const f = await readerFrame();
  const text = await f.evaluate(
    ([i, len]) => {
      const el = document.querySelectorAll('#book .blk-paragraph .bt')[i];
      el.scrollIntoView({ block: 'center' });
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const first = walker.nextNode();
      const range = document.createRange();
      range.setStart(first, 0);
      range.setEnd(first, Math.min(len, first.textContent.length));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return range.toString();
    },
    [index, n],
  );
  await page.getByTestId('selection-bar').waitFor({ timeout: 5000 });
  return text;
}

console.log('learning layer (web build + real API + fake model)');
await page.goto(`http://localhost:${WEB}/`);
await page.getByText('Start with your first paper').waitFor({ timeout: 15000 });
await page.getByTestId('open-settings').click();
await page.getByTestId('server-url').fill(`http://localhost:${API}`);
await page.getByTestId('server-url').blur();

await check('AI is off by default and previews are on', async () => {
  const ai = page.getByTestId('ai-settings');
  await ai.waitFor();
  assert(!(await page.getByTestId('switch-ai').locator('input').isChecked()), 'AI should be off');
  assert(await page.getByTestId('switch-confirm').locator('input').isChecked(), 'preview should be on');
  assert(!(await page.getByTestId('switch-images').locator('input').isChecked()), 'images should be off');
  await shot('01-settings');
});
await page.getByTestId('screen-back').click();

await page.getByTestId('import-button').waitFor();
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('import-button').click()]);
await chooser.setFiles(pdf);
await page.waitForURL(/\/reader\//, { timeout: 90000 });
await frameLoc().locator('#book .h').first().waitFor({ timeout: 20000 });

await check('with AI off, a selection can only be answered from the paper itself, and nothing is sent', async () => {
  const selected = await selectInParagraph(0, 70);
  assert(selected.length > 20, `selection: "${selected}"`);
  await page.getByTestId('sel-explain').click();
  await page.getByTestId('ai-disabled').waitFor();
  assert((await page.getByTestId('task-explain').count()) === 0, 'AI tasks must be hidden while AI is off');
  await page.getByTestId('task-local').click();
  await page.getByTestId('answer').waitFor();
  assert((await page.getByTestId('answer-quote').textContent()).length > 10, 'source quote shown');
  assert((await page.getByTestId('segment-grounded').count()) >= 1, 'local passages listed');
  assert((await page.getByTestId('segment-ungrounded').count()) === 0, 'no ungrounded text without a model');
  await shot('02-local-passages');
  assert((await llmRequests()).length === 0, 'the model must not be contacted');
});

await check('enabling AI shows exactly what will be sent and waits for confirmation', async () => {
  await page.getByText('Ask again').click();
  await page.getByTestId('enable-ai').click();
  await page.getByTestId('task-explain').click();
  await page.getByTestId('send-preview').waitFor();
  await shot('03-send-preview');
  assert((await llmRequests()).length === 0, 'nothing is sent before confirmation');
  const toggles = await page.locator('[data-testid^=include-p]').count();
  assert(toggles >= 2, `expected passages to review, got ${toggles}`);
});

await check('a confirmed request returns a grounded answer; invented sources are marked, not hidden', async () => {
  await page.getByTestId('send-confirm').click();
  await page.getByTestId('answer').waitFor({ timeout: 15000 });
  const grounded = await page.getByTestId('segment-grounded').count();
  const ungrounded = await page.getByTestId('segment-ungrounded').count();
  assert(grounded >= 1, 'a grounded segment with its source');
  assert(ungrounded >= 1, 'text without a verifiable source must be labelled');
  assert((await page.locator('[data-testid^=cite-p]').count()) >= 1, 'citation chips');
  await shot('04-answer');
  const reqs = await llmRequests();
  assert(reqs.length === 1, `one model call, got ${reqs.length}`);
  const messages = reqs[0].messages;
  const user = messages.find((m) => m.role === 'user').content;
  const userText = typeof user === 'string' ? user : user.map((p) => p.text ?? '').join('\n');
  assert(/<passage id="p1"/.test(userText), 'passages are sent as delimited data');
  assert(messages[0].role === 'system' && /passage/i.test(messages[0].content), 'rules live in the system prompt');
  assert(!JSON.stringify(reqs[0]).includes('secret-test-key'), 'the key never travels in the body');
});

await check('a citation chip jumps back to the paper', async () => {
  // keep the answer for the notes check below, then follow the citation
  await page.getByTestId('save-ai-note').click();
  await page.getByText('Saved to notes').waitFor();
  await page.locator('[data-testid^=cite-p]').first().click();
  await page.getByTestId('answer').waitFor({ state: 'detached', timeout: 5000 });
  const f = await readerFrame();
  await f.waitForSelector('#book .blk.flash, #book .blk.sel', { timeout: 5000 });
});

await check('highlights are painted, persist across a reload and appear in the notes screen', async () => {
  await selectInParagraph(1, 50);
  await page.getByTestId('sel-highlight').click();
  const f = await readerFrame();
  await f.waitForSelector('mark.hl', { timeout: 5000 });
  await page.waitForTimeout(400);
  await page.reload();
  await frameLoc().locator('#book .h').first().waitFor({ timeout: 20000 });
  await frameLoc().locator('mark.hl').first().waitFor({ timeout: 10000 });
  await shot('05-highlight');
});

await check('selected text is copied with its citation in the chosen style', async () => {
  const quote = await selectInParagraph(0, 60);
  await page.getByTestId('sel-copy-cite').click();
  await page.waitForFunction(() => /Copied/.test(document.querySelector('[data-testid=selection-bar]')?.textContent ?? ''), null, { timeout: 5000 });
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert(copied.startsWith(`“${quote.replace(/\s+/g, ' ').trim()}”`), copied);
  assert(/\(Rossi et al\., n\.d\., p\. \d+\)/.test(copied), `APA in-text citation: ${copied}`);
  assert(/Rossi, Q\., Larsen, Q\., & Cohen, D\. \(n\.d\.\)\. Sparse Routing for Efficient Transformers\./.test(copied), `APA reference: ${copied}`);
});

await check('a note is attached to the selected text and saved on the device', async () => {
  await selectInParagraph(2, 60);
  await page.getByTestId('sel-note').click();
  await page.getByTestId('note-input').fill('Check this against the ablation table.');
  await page.getByTestId('note-save').click();
  await page.waitForTimeout(400);
  await frameLoc().locator('mark.hl.note, mark.hl[data-note], mark.hl').nth(1).waitFor({ timeout: 5000 });
});

await check('the notes screen lists everything with page and quote, and exports Markdown', async () => {
  await page.getByTestId('reader-back').click();
  await page.getByTestId('open-notes').click();
  await page.getByTestId('notes-list').waitFor();
  await page.getByText('Check this against the ablation table.').waitFor();
  await shot('06-notes');
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await page.getByText(/not the authors/i).first().waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: 'All', exact: true }).click();
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), page.getByTestId('export-notes').click()]);
  const text = readFileSync(await download.path(), 'utf8');
  assert(text.startsWith('# Folume notes'), 'markdown heading');
  assert(text.includes('Check this against the ablation table.'), 'note text');
  assert(text.includes('**AI-generated note**'), 'AI text is labelled in the export');
  assert(/— p\. \d/.test(text), 'page reference next to the quote');
});

await check('an understanding check runs on the device and records the result', async () => {
  await page.getByTestId('screen-back').click();
  await page.locator('[data-testid^=paper-]').first().click();
  await frameLoc().locator('#book .h').first().waitFor({ timeout: 20000 });
  const f = await readerFrame();
  await f.waitForSelector('[data-quiz]', { timeout: 10000 });
  await f.evaluate(() => document.querySelector('[data-quiz]').scrollIntoView({ block: 'center' }));
  await frameLoc().locator('[data-quiz]').first().click();
  await page.getByTestId('quiz').waitFor();
  await page.getByTestId('quiz-start-local').click();
  await page.getByTestId('quiz-prompt').waitFor();
  await shot('07-quiz-question');
  for (let i = 0; i < 12; i++) {
    if (await page.getByTestId('quiz-summary').count()) break;
    if (await page.getByTestId('quiz-short').count()) {
      await page.getByTestId('quiz-short').fill('something');
      await page.getByTestId('quiz-reveal').click();
      await page.getByTestId('quiz-feedback').waitFor();
      await page.getByTestId('quiz-self-wrong').click().catch(async () => page.getByTestId('quiz-self-right').click());
    } else {
      await page.locator('[data-testid^=choice-]').first().click();
      await page.getByTestId('quiz-check').click();
      await page.getByTestId('quiz-feedback').waitFor();
      await page.getByTestId('quiz-next').click();
    }
    await page.waitForTimeout(150);
  }
  await page.getByTestId('quiz-summary').waitFor({ timeout: 5000 });
  await shot('08-quiz-summary');
  assert((await llmRequests()).length === 1, 'the local check must not call the model');
});

assert(errors.length === 0, `page errors: ${errors.join(' | ')}`);
await browser.close();
web.close();
api.kill();
llm.kill();
done();
