// Drives the built reader runtime in Chromium with a phone viewport and real backend output.
import path from 'node:path';
import { assert, check, done, launch, loadBundle, openReader, shots } from './lib.mjs';

const browser = await launch();
const bundle = loadBundle('ieee_ml');
const doc = bundle.doc;
const lastProgress = (events) => [...events].reverse().find((e) => e.type === 'progress');

console.log('reader runtime');

await check('renders every block type and loads images lazily', async () => {
  const r = await openReader(browser, bundle);
  await r.waitFor(async () => (await r.events()).some((e) => e.type === 'ready'), 'ready event');
  // nothing near the top of page 1 needs an image yet: images are requested only when close to the viewport
  assert(!(await r.events()).some((e) => e.type === 'asset-request' && e.path.startsWith('pages/')), 'page images requested early');
  await r.host({ type: 'goto', blockId: doc.blocks.find((b) => b.type === 'figure').id });
  const counts = await r.page.evaluate(() => ({
    headings: document.querySelectorAll('#book .h').length,
    paras: document.querySelectorAll('#book .blk-paragraph').length,
    eqs: document.querySelectorAll('#book .eq').length,
    figs: document.querySelectorAll('#book .fig').length,
    tables: document.querySelectorAll('#book .tbl').length,
    refs: document.querySelectorAll('#book .ref').length,
    seps: document.querySelectorAll('#book .pgsep').length,
  }));
  assert(counts.headings === doc.blocks.filter((b) => b.type === 'heading').length, `headings ${counts.headings}`);
  assert(counts.eqs === 3 && counts.figs === 2 && counts.tables === 1 && counts.refs === 14, JSON.stringify(counts));
  assert(counts.seps === 3, `page separators ${counts.seps}`);
  await r.waitFor(async () => (await r.events()).some((e) => e.type === 'asset-request'), 'asset requests');
  await r.waitFor(() => r.page.evaluate(() => [...document.querySelectorAll('#book img')].some((i) => i.naturalWidth > 0)), 'a decoded image');
  assert(r.errors.length === 0, r.errors.join('; '));
  await r.page.screenshot({ path: path.join(shots, 'book-page1-light.png') });
  await r.close();
});

await check('captions are shown with their figure and table, not twice', async () => {
  const r = await openReader(browser, bundle);
  const n = await r.page.evaluate(() => ({
    caps: document.querySelectorAll('#book figcaption').length,
    standalone: document.querySelectorAll('#book .cap').length,
  }));
  assert(n.caps === 3 && n.standalone === 0, JSON.stringify(n));
  await r.close();
});

await check('text inside figures and tables stays reachable as real, selectable text', async () => {
  const r = await openReader(browser, bundle);
  const figs = doc.blocks.filter((b) => b.type === 'figure' && b.inner_text);
  assert(figs.length === 2, `fixture should have two figures with text, has ${figs.length}`);
  const found = await r.page.evaluate(() =>
    [...document.querySelectorAll('#book .fig details.figtext')].map((d) => ({
      summary: d.querySelector('summary')?.textContent,
      text: d.querySelector('.figtext-body')?.textContent,
      open: d.open,
    })),
  );
  assert(found.length === 2, `figure text blocks: ${found.length}`);
  assert(found.every((f) => !f.open), 'collapsed by default, so the reading flow stays clean');
  assert(found[0].text === figs[0].inner_text, 'the text is exactly the PDF text layer of the figure');
  assert(found[0].summary.length > 3, 'labelled');
  // opened, it can be selected like any other text
  const selectable = await r.page.evaluate(() => {
    const d = document.querySelector('#book .fig details.figtext');
    d.open = true;
    const body = d.querySelector('.figtext-body');
    return getComputedStyle(body).userSelect !== 'none';
  });
  assert(selectable, 'figure text is selectable');
  await r.close();
});

await check('tapping a citation shows the reference and can jump to it', async () => {
  const r = await openReader(browser, bundle);
  await r.page.evaluate(() => document.querySelector('a.cite').click());
  const text = await r.waitFor(() => r.page.evaluate(() => document.querySelector('.sheet .rt')?.textContent), 'citation sheet');
  assert(/Nature Methods|Proc\.|J\. Mach/.test(text), text);
  const y0 = await r.page.evaluate(() => scrollY);
  await r.page.locator('.sheet button', { hasText: 'Kaynakçaya git' }).click();
  await r.waitFor(async () => (await r.page.evaluate(() => scrollY)) > y0 + 500, 'scroll to reference');
  assert(await r.page.evaluate(() => !!document.querySelector('.pill.back')), 'following a reference leaves a way back');
  assert(await r.page.evaluate(() => !document.querySelector('.sheet')), 'sheet closed');
  await r.close();
});

await check('goto a block scrolls to it and progress reports the same block', async () => {
  const r = await openReader(browser, bundle);
  const target = doc.blocks.find((b) => b.type === 'heading' && b.text === 'EXPERIMENTS').id;
  await r.host({ type: 'goto', blockId: target, flash: true });
  const p = await r.waitFor(async () => {
    const e = lastProgress(await r.events());
    return e && e.blockId === target ? e : null;
  }, 'progress at target');
  assert(p.page === 2 && p.percent > 20, JSON.stringify(p));
  await r.close();
});

await check('restoring an anchor and changing the font size keeps the reading position', async () => {
  const mid = doc.blocks.find((b) => b.type === 'paragraph' && b.source[0].page === 2).id;
  const r = await openReader(browser, bundle, { anchor: { blockId: mid, offset: 0.3 } });
  const first = await r.waitFor(async () => (await r.events()).filter((e) => e.type === 'progress').at(-1), 'initial progress');
  assert(first.blockId === mid, `restored at ${first.blockId}, wanted ${mid}`);
  await r.host({ type: 'settings', settings: { theme: 'sepia', fontFamily: 'sans', fontSize: 26, lineHeight: 1.8, margin: 'wide', justify: true, showNotes: false } });
  await r.page.waitForTimeout(400);
  await r.page.evaluate(() => window.dispatchEvent(new Event('scroll')));
  const after = await r.waitFor(async () => {
    const e = lastProgress(await r.events());
    return e && e.blockId === mid ? e : null;
  }, 'same block after font change');
  assert(after.blockId === mid, 'lost position');
  const styles = await r.page.evaluate(() => ({ cls: document.body.className, fs: getComputedStyle(document.body).fontSize }));
  assert(styles.cls.includes('t-sepia') && styles.cls.includes('justify') && styles.fs === '26px', JSON.stringify(styles));
  await r.page.screenshot({ path: path.join(shots, 'book-sepia-large.png') });
  await r.close();
});

await check('dark theme tints equation images to the text colour', async () => {
  const eq = doc.blocks.find((b) => b.type === 'equation');
  const r = await openReader(browser, bundle, { settings: { theme: 'dark' }, focus: { blockId: eq.id } });
  await r.waitFor(() => r.page.evaluate((id) => document.querySelector(`#${id} img`)?.naturalWidth > 0, eq.id), 'equation image');
  const filter = await r.page.evaluate((id) => getComputedStyle(document.querySelector(`#${id} img`)).filter, eq.id);
  assert(filter.includes('invert'), `filter ${filter}`);
  await r.page.waitForTimeout(500);
  await r.page.screenshot({ path: path.join(shots, 'book-dark-equation.png') });
  await r.close();
});

await check('equation images are scaled to the reader font size', async () => {
  const eq = doc.blocks.find((b) => b.type === 'equation');
  const r = await openReader(browser, bundle, { focus: { blockId: eq.id }, viewport: { width: 900, height: 700 } }, { width: 900, height: 700 });
  const w = await r.page.evaluate((id) => document.querySelector(`#${id} img`).getBoundingClientRect().width, eq.id);
  const pt = eq.asset.bbox[2] - eq.asset.bbox[0];
  const expected = pt * (18 / doc.body_font_size);
  assert(Math.abs(w - expected) < 3, `width ${w}, expected ~${expected}`);
  await r.close();
});

await check('tables show structured cells and can switch to the original image', async () => {
  const tab = doc.blocks.find((b) => b.type === 'table');
  const r = await openReader(browser, bundle, { focus: { blockId: tab.id } });
  const cells = await r.page.evaluate(() => [...document.querySelectorAll('#book table tr')].map((tr) => [...tr.children].map((c) => c.textContent)));
  assert(cells[0][0] === 'Model' && cells.length === 5, JSON.stringify(cells[0]));
  await r.page.click('button[data-view=image]');
  assert(await r.page.evaluate(() => document.querySelector('.tblwrap').style.display === 'none'), 'table hidden');
  await r.waitFor(() => r.page.evaluate(() => document.querySelector('.tbl .imgwrap img')?.naturalWidth > 0), 'table image');
  await r.page.screenshot({ path: path.join(shots, 'book-table-image.png') });
  await r.close();
});

await check('original view: switching shows the source region and a way back', async () => {
  const para = doc.blocks.find((b) => b.type === 'paragraph' && b.source[0].page === 2);
  const r = await openReader(browser, bundle);
  await r.host({ type: 'mode', mode: 'original', blockId: para.id });
  const ev = await r.waitFor(async () => (await r.events()).find((e) => e.type === 'mode-changed'), 'mode-changed');
  assert(ev.mode === 'original' && ev.blockId === para.id, JSON.stringify(ev));
  assert(await r.page.evaluate(() => document.body.classList.contains('original')), 'body class');
  const hl = await r.page.evaluate(() => [...document.querySelectorAll('.pg .hl')].map((h) => h.closest('.pg').dataset.page));
  assert(hl.length === para.source.length && hl.every((p) => Number(p) === 2), `regions ${hl}`);
  await r.waitFor(() => r.page.evaluate(() => document.querySelector('.pg[data-page="2"] img')?.naturalWidth > 0), 'page image');
  await r.page.waitForTimeout(300);
  await r.page.screenshot({ path: path.join(shots, 'original-highlight.png') });
  // back to the book at the same block
  await r.page.click('.pill');
  await r.waitFor(async () => !(await r.page.evaluate(() => document.body.classList.contains('original'))), 'book mode');
  const p = await r.waitFor(async () => {
    const e = lastProgress(await r.events());
    return e && e.blockId === para.id ? e : null;
  }, 'progress at the block again');
  assert(p.blockId === para.id, 'did not return to block');
  await r.close();
});

await check('original view: tapping a page region identifies the block', async () => {
  const eq = doc.blocks.find((b) => b.type === 'equation');
  const r = await openReader(browser, bundle, { mode: 'original', focus: { blockId: eq.id, page: eq.source[0].page } });
  await r.waitFor(() => r.page.evaluate((p) => document.querySelector(`.pg[data-page="${p}"] img`)?.naturalWidth > 0, eq.source[0].page), 'page image');
  const [x0, y0, x1, y1] = eq.source[0].bbox;
  const pos = await r.page.evaluate(({ page, cx, cy, w, h }) => {
    const img = document.querySelector(`.pg[data-page="${page}"] img`);
    img.scrollIntoView();
    const rect = img.getBoundingClientRect();
    return { x: rect.left + (cx / w) * rect.width, y: rect.top + (cy / h) * rect.height };
  }, { page: eq.source[0].page, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: doc.pages[1].width, h: doc.pages[1].height });
  await r.page.mouse.click(pos.x, pos.y);
  const ev = await r.waitFor(async () => (await r.events()).filter((e) => e.type === 'original-tap' && e.blockId === eq.id).at(-1), 'original-tap on equation');
  assert(ev.blockId === eq.id, JSON.stringify(ev));
  await r.close();
});

await check('selecting text reports block-relative offsets and highlights paint over them', async () => {
  const para = doc.blocks.find((b) => b.type === 'paragraph' && b.text.length > 200 && !b.spans.some((s) => s.cite.length));
  const r = await openReader(browser, bundle, { focus: { blockId: para.id } });
  await r.page.evaluate((id) => {
    const root = document.querySelector(`#${id} .bt`);
    const node = root.firstChild;
    const range = document.createRange();
    range.setStart(node, 10);
    range.setEnd(node, 40);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }, para.id);
  const ev = await r.waitFor(async () => (await r.events()).find((e) => e.type === 'selection'), 'selection event');
  assert(ev.blockId === para.id && ev.start === 10 && ev.end === 40, JSON.stringify(ev));
  const expected = para.spans.map((s) => s.text).join('').slice(10, 40);
  assert(ev.text === expected, `text ${ev.text}`);
  await r.host({ type: 'highlights', items: [{ id: 'h1', blockId: para.id, start: 10, end: 40, color: '#ffe58a', hasNote: true }] });
  const painted = await r.page.evaluate(() => [...document.querySelectorAll('mark.hl')].map((m) => m.textContent).join(''));
  assert(painted === expected, `painted ${painted}`);
  await r.host({ type: 'highlights', items: [] });
  assert(await r.page.evaluate(() => document.querySelectorAll('mark.hl').length === 0), 'highlights cleared');
  await r.page.screenshot({ path: path.join(shots, 'book-selection.png') });
  await r.close();
});

await check('highlights across inline formatting wrap each text node and keep offsets stable', async () => {
  const para = doc.blocks.find((b) => b.type === 'paragraph' && b.spans.some((s) => s.math) && b.spans.length > 4);
  const r = await openReader(browser, bundle, { focus: { blockId: para.id } });
  const full = para.spans.map((s) => s.text).join('');
  await r.host({ type: 'highlights', items: [{ id: 'h2', blockId: para.id, start: 0, end: full.length, color: '#9fd', hasNote: false }] });
  const painted = await r.page.evaluate((id) => document.querySelector(`#${id} .bt`).textContent, para.id);
  assert(painted === full, 'text changed by painting');
  assert(await r.page.evaluate(() => document.querySelectorAll('mark.hl').length > 1), 'expected several marks');
  await r.close();
});

await check('bookmarks and conversion warnings are drawn', async () => {
  const para = doc.blocks.find((b) => b.type === 'paragraph');
  const r = await openReader(browser, bundle, { bookmarks: [para.id] });
  assert(await r.page.evaluate((id) => document.getElementById(id).classList.contains('bm'), para.id), 'bookmark class');
  await r.host({ type: 'bookmarks', ids: [] });
  assert(await r.page.evaluate((id) => !document.getElementById(id).classList.contains('bm'), para.id), 'bookmark removed');
  const warned = structuredClone(doc);
  warned.blocks.find((b) => b.id === para.id).flags = [{ code: 'text_garbled', severity: 'warning', message: 'x' }];
  const r2 = await openReader(browser, { ...bundle, doc: warned });
  await r2.page.click(`#${para.id} .flagdot`);
  const ev = await r2.waitFor(async () => (await r2.events()).find((e) => e.type === 'flags'), 'flags event');
  assert(ev.blockId === para.id, 'flag event');
  await r.close();
  await r2.close();
});

await check('block taps select the block and notify the host; a second tap clears', async () => {
  const para = doc.blocks.find((b) => b.type === 'paragraph');
  const r = await openReader(browser, bundle, { focus: { blockId: para.id } });
  await r.page.evaluate((id) => document.querySelector(`#${id} .bt`).click(), para.id);
  const ev = await r.waitFor(async () => (await r.events()).find((e) => e.type === 'block-tap'), 'block-tap');
  assert(ev.blockId === para.id && ev.rect.width > 0, JSON.stringify(ev));
  await r.page.evaluate((id) => document.querySelector(`#${id} .bt`).click(), para.id);
  await r.waitFor(async () => (await r.events()).some((e) => e.type === 'selection-clear'), 'selection-clear');
  await r.close();
});

await check('"Fig. 1", "Table I" and "Eq. (3)" in the text open a preview of what they name, and Back returns', async () => {
  const r = await openReader(browser, bundle);
  const keys = await r.page.evaluate(() => [...document.querySelectorAll('#book a.xref')].map((a) => a.dataset.x));
  for (const k of ['fig:1', 'fig:2', 'tab:1', 'eq:3']) assert(keys.includes(k), `link for ${k} in ${keys}`);
  // the text itself is untouched: links add elements, never characters
  const same = await r.page.evaluate((d) => d.blocks.filter((b) => b.type === 'paragraph').every((b) => (document.getElementById(b.id)?.querySelector('.bt')?.textContent ?? '') === (b.spans.length ? b.spans.map((s) => s.text).join('') : b.text)), doc);
  assert(same, 'paragraph text changed');
  const figure = doc.blocks.find((b) => b.type === 'figure' && b.number === '1');
  // scroll somewhere that is not the figure, then follow the link
  await r.host({ type: 'goto', blockId: doc.blocks.find((b) => b.type === 'paragraph' && /Fig\. 1/.test(b.text)).id });
  await r.page.waitForTimeout(400);
  const before = await r.page.evaluate(() => window.scrollY);
  await r.page.locator('#book a.xref[data-x="fig:1"]').first().click();
  await r.page.locator('.sheet .xpreview figure').waitFor();
  assert((await r.page.locator('.sheet .xpreview img').count()) === 1, 'figure image in the preview');
  assert((await r.page.evaluate((id) => document.querySelectorAll(`[id="${id}"]`).length, figure.id)) === 1, 'the preview must not duplicate the block id');
  assert((await r.page.locator('.sheet .xpreview figcaption').textContent()).includes('Fig. 1'), 'caption shown');
  await r.page.locator('.sheet button', { hasText: 'Oraya git' }).click();
  await r.page.waitForTimeout(500);
  const moved = await r.page.evaluate(() => window.scrollY);
  assert(Math.abs(moved - before) > 100, `did not move (${before} -> ${moved})`);
  await r.page.locator('.pill.back').waitFor();
  assert((await r.page.locator('.pill.back').textContent()).includes('Geri'), 'back pill label');
  await r.page.locator('.pill.back').click();
  await r.page.waitForTimeout(500);
  const back = await r.page.evaluate(() => window.scrollY);
  assert(Math.abs(back - before) < 40, `back is at ${back}, was ${before}`);
  assert((await r.page.locator('.pill.back').count()) === 0, 'the back pill goes away once used');
  // a table and an equation preview too
  await r.page.locator('#book a.xref[data-x="tab:1"]').first().click();
  await r.page.locator('.sheet .xpreview table').waitFor();
  await r.page.locator('.sheet button', { hasText: 'Kapat' }).click();
  await r.page.locator('#book a.xref[data-x="eq:3"]').first().click();
  await r.page.locator('.sheet .xpreview .eq').waitFor();
  await r.page.screenshot({ path: path.join(shots, 'rt-xref-equation.png') });
  await r.close();
});

await check('terms the paper defines are underlined and explained, without changing the text', async () => {
  const r = await openReader(browser, bundle);
  const textOf = () => r.page.evaluate(() => [...document.querySelectorAll('#book [data-b]')].map((n) => n.textContent).join('\n'));
  const before = await textOf();
  const host = doc.blocks.find((b) => b.type === 'paragraph' && /expert gating/i.test(b.text));
  await r.host({ type: 'terms', items: [{ term: 'expert gating', definition: 'A routing rule that picks one expert per token.', blockId: host.id, page: 1 }, { term: 'WTP', definition: 'never appears', blockId: host.id, page: 1 }] });
  await r.page.locator('#book abbr.term').first().waitFor();
  assert((await r.page.locator('#book abbr.term').count()) >= 3, 'occurrences underlined');
  assert((await textOf()) === before, 'terms must not change any character');
  await r.page.locator('#book abbr.term').first().click();
  assert((await r.page.locator('.sheet .termhead').textContent()).toLowerCase() === 'expert gating', 'term title');
  assert((await r.page.locator('.sheet .termdef').textContent()).includes('routing rule'), 'definition');
  assert((await r.page.locator('.sheet .termwhere').textContent()).includes('Sayfa 1'), 'where it is defined');
  await r.page.locator('.sheet button', { hasText: 'Kapat' }).click();
  // highlights still paint across the underlined words, and the text stays whole
  await r.host({ type: 'highlights', items: [{ id: 'h1', blockId: host.id, start: 0, end: 40, color: '#ffe58a', hasNote: false }] });
  await r.page.locator('mark.hl').first().waitFor();
  assert((await textOf()) === before, 'text after painting a highlight');
  await r.close();
});

await check('a reference offers its DOI and adding it to the library', async () => {
  const withDoi = structuredClone(doc);
  const ref = withDoi.blocks.find((b) => b.type === 'reference');
  ref.reference = { ...(ref.reference ?? {}), doi: '10.1000/abc123', url: null, title: ref.text.slice(0, 30), label: null, first_author: null, year: null };
  const r = await openReader(browser, { ...bundle, doc: withDoi });
  const cite = await r.page.evaluate((id) => !!document.querySelector(`#book a.cite[data-refs~="${id}"]`), ref.id);
  assert(cite, 'a paragraph cites that reference');
  await r.page.locator(`#book a.cite[data-refs~="${ref.id}"]`).first().click();
  await r.page.locator('.sheet button', { hasText: "DOI'yi aç" }).click();
  await r.page.locator(`#book a.cite[data-refs~="${ref.id}"]`).first().click();
  await r.page.locator('.sheet button', { hasText: 'Kütüphaneye ekle' }).click();
  const events = await r.events();
  assert(events.some((e) => e.type === 'link' && e.url === 'https://doi.org/10.1000/abc123'), 'link event');
  assert(events.some((e) => e.type === 'import-ref' && e.doi === '10.1000/abc123'), 'import-ref event');
  await r.close();
});

await check('a scanned (unsupported) document explains itself instead of showing a blank page', async () => {
  const empty = structuredClone(doc);
  empty.blocks = [];
  empty.sections = [];
  const r = await openReader(browser, { ...bundle, doc: empty });
  const txt = await r.page.evaluate(() => document.querySelector('.unsupported')?.textContent);
  assert(txt && txt.includes('taranmış'), `text ${txt}`);
  await r.close();
});

await browser.close();
done();
