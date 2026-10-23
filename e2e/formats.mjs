// Reading formats of the reader runtime: Book, Magazine, paged flow. Real Chromium, real backend output.
import path from 'node:path';
import { SETTINGS, assert, check, done, inflate, launch, loadBundle, openReader, shots, timeOpen } from './lib.mjs';

const browser = await launch();
const bundle = loadBundle('ieee_ml');
const doc = bundle.doc;
const PHONE = { width: 390, height: 844 };
const TABLET = { width: 900, height: 700 };
const lastProgress = (events) => [...events].reverse().find((e) => e.type === 'progress');

/** What the reading view shows for every block, in order: the same for every format or something was lost. */
const blockTexts = (r) =>
  r.page.evaluate(() => [...document.querySelectorAll('#book [data-b]')].map((n) => [n.id, (n.querySelector('.bt') ?? n).textContent]));

console.log('reading formats');

await check('every format shows exactly the text of the document, block by block', async () => {
  const textBlocks = doc.blocks.filter((b) => b.spans.length && ['paragraph', 'heading', 'list_item', 'footnote', 'reference', 'title'].includes(b.type));
  const reference = new Map();
  for (const [layout, flow, viewport] of [['book', 'scroll', PHONE], ['magazine', 'scroll', TABLET], ['book', 'paged', PHONE], ['magazine', 'paged', TABLET]]) {
    const r = await openReader(browser, bundle, { settings: { layout, flow } }, viewport);
    const texts = await blockTexts(r);
    assert(texts.length >= doc.blocks.filter((b) => !(b.caption_for)).length * 0.9, `${layout}/${flow}: blocks rendered ${texts.length}`);
    const byId = new Map(texts);
    for (const b of textBlocks) {
      const expected = b.spans.map((s) => s.text).join('');
      assert(byId.get(b.id) === expected, `${layout}/${flow}: block ${b.id} differs\n  got:      ${JSON.stringify(byId.get(b.id))?.slice(0, 120)}\n  expected: ${JSON.stringify(expected).slice(0, 120)}`);
    }
    reference.set(`${layout}/${flow}`, JSON.stringify(texts));
    await r.close();
  }
  assert(new Set(reference.values()).size === 1, 'the four format combinations render identical block text');
});

await check('a list item draws its marker once, and a paper converted before that fix does not show it twice', async () => {
  const r = await openReader(browser, bundle, {}, PHONE);
  const items = await r.page.evaluate(() => [...document.querySelectorAll('#book .li')].map((n) => n.innerText.replace(/\s+/g, ' ').trim()));
  assert(items.length === 3 && items.every((t) => /^• [A-Za-z]/.test(t)), JSON.stringify(items));
  await r.close();
  const old = JSON.parse(JSON.stringify(doc));
  for (const b of old.blocks) if (b.type === 'list_item') { b.text = `${b.number} ${b.text}`; b.spans = [{ ...b.spans[0], text: b.text }]; b.prefix = null; }
  const r2 = await openReader(browser, { ...bundle, doc: old }, {}, PHONE);
  const oldItems = await r2.page.evaluate(() => [...document.querySelectorAll('#book .li')].map((n) => n.innerText.replace(/\s+/g, ' ').trim()));
  assert(oldItems.every((t) => /^• [A-Za-z]/.test(t)), JSON.stringify(oldItems));
  await r2.close();
});

await check('readable fonts, letter and word spacing and the reading ruler change only how the text looks', async () => {
  const r = await openReader(browser, bundle, {}, PHONE);
  const texts = () => blockTexts(r).then((t) => JSON.stringify(t));
  const before = await texts();
  await r.host({ type: 'settings', settings: { ...SETTINGS, fontFamily: 'hyperlegible', letterSpacing: 0.1, wordSpacing: 0.2, ruler: true } });
  await r.page.waitForTimeout(300);
  const facts = await r.page.evaluate(async () => {
    await document.fonts.load("16px 'Atkinson Hyperlegible'");
    await document.fonts.load("16px 'Atkinson Hyperlegible'", 'ğşı İ');
    const cs = getComputedStyle(document.querySelector('#book p'));
    const ruler = document.getElementById('ruler');
    return {
      family: cs.fontFamily, letter: parseFloat(cs.letterSpacing), word: parseFloat(cs.wordSpacing), fs: parseFloat(getComputedStyle(document.body).fontSize),
      loaded: document.fonts.check("16px 'Atkinson Hyperlegible'"), turkish: document.fonts.check("16px 'Atkinson Hyperlegible'", 'ğşıİ'),
      ruler: !!ruler, rulerEvents: ruler && getComputedStyle(ruler).pointerEvents, rulerBands: ruler ? ruler.querySelectorAll('.rb').length : 0,
    };
  });
  assert(/Atkinson/.test(facts.family), `font family ${facts.family}`);
  assert(facts.loaded && facts.turkish, `Atkinson loaded ${facts.loaded}, Turkish glyphs ${facts.turkish}`);
  assert(Math.abs(facts.letter - 0.1 * facts.fs) < 0.2 && Math.abs(facts.word - 0.2 * facts.fs) < 0.3, `spacing ${facts.letter}px / ${facts.word}px at ${facts.fs}px`);
  assert(facts.ruler && facts.rulerEvents === 'none' && facts.rulerBands === 2, 'ruler: two bands that let touches through');
  assert((await texts()) === before, 'the words are the same in another font');
  await r.page.screenshot({ path: path.join(shots, 'fmt-hyperlegible-ruler.png') });
  await r.host({ type: 'settings', settings: { ...SETTINGS, fontFamily: 'dyslexic', ruler: false } });
  await r.page.waitForTimeout(300);
  const dys = await r.page.evaluate(async () => { await document.fonts.load("16px 'OpenDyslexic'"); return [getComputedStyle(document.querySelector('#book p')).fontFamily, document.fonts.check("16px 'OpenDyslexic'"), !!document.getElementById('ruler')]; });
  assert(/OpenDyslexic/.test(dys[0]) && dys[1] === true && dys[2] === false, JSON.stringify(dys));
  assert((await texts()) === before, 'text after the second font');
  await r.close();
});

await check('Magazine: a masthead, section kickers, drop caps, and columns when there is room', async () => {
  const wide = await openReader(browser, bundle, { settings: { layout: 'magazine' } }, TABLET);
  const facts = await wide.page.evaluate(() => {
    const cs = (sel) => { const n = document.querySelector(sel); return n ? getComputedStyle(n) : null; };
    const base = parseFloat(getComputedStyle(document.body).fontSize);
    return {
      cls: document.body.className,
      columns: getComputedStyle(document.querySelector('#book')).columnCount,
      titleScale: parseFloat(cs('#book .title').fontSize) / base,
      titleSpan: cs('#book .title').columnSpan,
      headSpan: cs('#book h2.h').columnSpan,
      headCaps: cs('#book h2.h').textTransform,
      figSpan: cs('#book .fig').columnSpan,
      leads: document.querySelectorAll('#book .lead').length,
      level1: document.querySelectorAll('#book h2.h').length,
      dropCap: getComputedStyle(document.querySelector('#book .lead'), '::first-letter').float,
    };
  });
  assert(facts.cls.includes('l-magazine'), facts.cls);
  assert(facts.columns === '2', `columns on a wide screen: ${facts.columns}`);
  assert(facts.titleScale >= 1.9, `title scale ${facts.titleScale}`);
  assert(facts.titleSpan === 'all' && facts.headSpan === 'all' && facts.figSpan === 'all', JSON.stringify(facts));
  assert(facts.headCaps === 'uppercase', 'kicker-style headings');
  assert(facts.leads >= 3 && facts.leads <= facts.level1 + 1, `lead paragraphs ${facts.leads} for ${facts.level1} sections`);
  assert(facts.dropCap === 'left', `drop cap ${facts.dropCap}`);
  await wide.page.screenshot({ path: path.join(shots, 'format-magazine-wide.png') });
  await wide.close();

  const phone = await openReader(browser, bundle, { settings: { layout: 'magazine' } }, PHONE);
  const columns = await phone.page.evaluate(() => getComputedStyle(document.querySelector('#book')).columnCount);
  assert(columns === 'auto', `one column on a phone: ${columns}`);
  await phone.page.screenshot({ path: path.join(shots, 'format-magazine-phone.png') });
  await phone.close();
});

await check('Paged: the paper becomes screens you turn; nothing is clipped or left out', async () => {
  const r = await openReader(browser, bundle, { settings: { flow: 'paged' } }, PHONE);
  await r.waitFor(async () => (await r.events()).some((e) => e.type === 'ready'), 'ready');
  const info = await r.page.evaluate(() => {
    const b = document.querySelector('#book');
    return { cls: document.body.className, sw: b.scrollWidth, cw: b.clientWidth, overflowY: getComputedStyle(b).overflowY, winScroll: document.documentElement.scrollHeight };
  });
  assert(info.cls.includes('f-paged'), info.cls);
  assert(info.sw >= 4 * info.cw, `several screens: ${info.sw / info.cw}`);
  assert(info.winScroll <= 844 + 2, `the page itself does not scroll: ${info.winScroll}`);
  const pages = Math.round(info.sw / info.cw);
  const seen = new Set();
  for (let i = 0; i < pages; i++) {
    const ids = await r.page.evaluate(() => {
      const b = document.querySelector('#book');
      const br = b.getBoundingClientRect();
      return [...document.querySelectorAll('#book [data-b]')]
        .filter((n) => [...n.getClientRects()].some((q) => q.right > br.left + 2 && q.left < br.right - 2 && q.bottom > br.top && q.top < br.bottom))
        .map((n) => n.id);
    });
    ids.forEach((x) => seen.add(x));
    await r.host({ type: 'page', dir: 'next' });
    await r.page.waitForTimeout(420);
  }
  const all = await r.page.evaluate(() => [...document.querySelectorAll('#book [data-b]')].map((n) => n.id));
  const missing = all.filter((id) => !seen.has(id));
  assert(missing.length === 0, `blocks that were never on a screen: ${missing.join(',')}`);
  await r.close();
});

await check('Paged: turning pages by message, tap zone, and keyboard; the position is reported', async () => {
  const r = await openReader(browser, bundle, { flow: 'paged', settings: { flow: 'paged' } }, PHONE);
  await r.waitFor(async () => lastProgress(await r.events()), 'first progress');
  const first = lastProgress(await r.events());
  assert(first.view && first.view.index === 1 && first.view.count >= 4, JSON.stringify(first));
  await r.host({ type: 'page', dir: 'next' });
  const second = await r.waitFor(async () => { const p = lastProgress(await r.events()); return p?.view?.index === 2 ? p : null; }, 'page 2');
  assert(second.percent > first.percent && second.blockId !== first.blockId, JSON.stringify(second));
  // tap in the right-hand zone turns forward, in the left-hand zone turns back
  await r.page.mouse.click(PHONE.width - 20, 300);
  await r.waitFor(async () => lastProgress(await r.events())?.view?.index === 3, 'page 3 by tap');
  await r.page.mouse.click(15, 300);
  await r.waitFor(async () => lastProgress(await r.events())?.view?.index === 2, 'page 2 by tap');
  await r.page.keyboard.press('ArrowRight');
  await r.waitFor(async () => lastProgress(await r.events())?.view?.index === 3, 'page 3 by key');
  await r.page.keyboard.press('Home');
  await r.waitFor(async () => lastProgress(await r.events())?.view?.index === 1, 'first page by key');
  await r.page.keyboard.press('End');
  const last = await r.waitFor(async () => { const p = lastProgress(await r.events()); return p?.view && p.view.index === p.view.count ? p : null; }, 'last page');
  assert(last.percent > 99, `percent at the end ${last.percent}`);
  await r.host({ type: 'page', dir: 'next' });
  await r.page.waitForTimeout(400);
  assert(lastProgress(await r.events()).view.index === last.view.count, 'cannot turn past the end');
  await r.close();
});

await check('Paged: going to a block, restoring a saved position and changing the type size keep you in place', async () => {
  const target = doc.blocks.find((b) => b.type === 'heading' && /EXPERIMENTS/i.test(b.text));
  const r = await openReader(browser, bundle, { settings: { flow: 'paged' }, anchor: { blockId: target.id, offset: 0 } }, PHONE);
  const onScreen = (id) => r.page.evaluate((x) => {
    const br = document.querySelector('#book').getBoundingClientRect();
    return [...document.getElementById(x).getClientRects()].some((q) => q.right > br.left + 2 && q.left < br.right - 2);
  }, id);
  await r.waitFor(() => onScreen(target.id), 'restored anchor on screen');
  await r.host({ type: 'settings', settings: { theme: 'paper', fontFamily: 'serif', fontSize: 26, lineHeight: 1.6, margin: 'normal', justify: false, showNotes: false, layout: 'book', flow: 'paged' } });
  await r.waitFor(() => onScreen(target.id), 'still on screen after a bigger type size');
  const other = doc.blocks.find((b) => b.type === 'heading' && /DISCUSSION/i.test(b.text));
  await r.host({ type: 'goto', blockId: other.id });
  await r.waitFor(() => onScreen(other.id), 'goto reaches the block');
  await r.close();
});

await check('Switching between scroll and paged, and between Book and Magazine, keeps the reading position', async () => {
  const target = doc.blocks.find((b) => b.type === 'heading' && /RELATED WORK/i.test(b.text));
  const r = await openReader(browser, bundle, { anchor: { blockId: target.id, offset: 0 } }, PHONE);
  const settings = { theme: 'paper', fontFamily: 'serif', fontSize: 18, lineHeight: 1.6, margin: 'normal', justify: false, showNotes: false };
  const visible = (id) => r.page.evaluate((x) => {
    const rects = [...document.getElementById(x).getClientRects()];
    const b = document.querySelector('#book').getBoundingClientRect();
    return document.body.classList.contains('f-paged')
      ? rects.some((q) => q.right > b.left + 2 && q.left < b.right - 2)
      : rects.some((q) => q.bottom > 0 && q.top < window.innerHeight);
  }, id);
  await r.waitFor(async () => lastProgress(await r.events()), 'first position');
  for (const [layout, flow] of [['book', 'paged'], ['magazine', 'paged'], ['magazine', 'scroll'], ['book', 'scroll'], ['magazine', 'paged'], ['book', 'paged']]) {
    const before = lastProgress(await r.events()).blockId;
    const count = (await r.events()).filter((e) => e.type === 'progress').length;
    await r.host({ type: 'settings', settings: { ...settings, layout, flow } });
    await r.waitFor(async () => (await r.events()).filter((e) => e.type === 'progress').length > count, `${layout}/${flow} reports its position`);
    await r.waitFor(() => visible(before), `${layout}/${flow}: the block that was being read (${before}) is still in view`);
  }
  await r.close();
});

await check('Selecting text still works on a paged screen', async () => {
  const r = await openReader(browser, bundle, { settings: { flow: 'paged' } }, PHONE);
  await r.host({ type: 'goto', blockId: doc.blocks.find((b) => b.type === 'paragraph').id });
  await r.page.evaluate(() => {
    const el = document.querySelector('#book .blk-paragraph .bt');
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
    const range = document.createRange();
    range.setStart(w, 0);
    range.setEnd(w, 30);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  const e = await r.waitFor(async () => (await r.events()).find((x) => x.type === 'selection'), 'selection event');
  assert(e.text.length === 30 && e.start === 0 && e.end === 30, JSON.stringify(e));
  await r.close();
});

await check('a 90-page paper (1,700 blocks) shows its first screen and jumps to the end quickly, in every flow', async () => {
  const big = inflate(doc, 30);
  for (const flow of ['scroll', 'paged']) {
    const t = await timeOpen(browser, big, { flow });
    console.log(`      ${t.blocks} blocks, ${flow}: first position after ${t.first} ms, jump to the end ${t.jump} ms, ${t.nodes} nodes`);
    // about ten times what a laptop needs, so a slow machine passes and an accidental O(n^2) does not
    assert(t.first < 2500, `${flow}: first position took ${t.first} ms`);
    assert(t.jump < 1500, `${flow}: jump took ${t.jump} ms`);
  }
});

await check('Original view is untouched by the paged flow', async () => {
  const r = await openReader(browser, bundle, { settings: { flow: 'paged' }, mode: 'original' }, PHONE);
  const info = await r.page.evaluate(() => ({ cls: document.body.className, scrollable: document.documentElement.scrollHeight > window.innerHeight * 2 }));
  assert(info.cls.includes('original') && !info.cls.includes('f-paged'), info.cls);
  assert(info.scrollable, 'the original pages scroll vertically');
  await r.close();
});

await browser.close();
done();
