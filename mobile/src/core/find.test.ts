import { clone, ieeeMl } from '@/testing/fixtures';

import { findInDocument, foldForSearch } from './find';

const renderedText = (b: { spans: { text: string }[]; text: string }) => (b.spans.length ? b.spans.map((s) => s.text).join('') : b.text);

describe('foldForSearch', () => {
  it('ignores case, accents, ligatures and Turkish dotted and dotless i', () => {
    expect(foldForSearch('ÇIĞLIK İstanbul ışık ﬁnd Ünal').text).toBe('ciglik istanbul isik find unal');
    expect(foldForSearch('a   b\n c').text).toBe('a b c');
  });

  it('maps every folded character back to the original text', () => {
    const f = foldForSearch('ﬁnd  İx');
    expect(f.text).toBe('find ix');
    // 'fi' both come from the ligature at 0; the double space is one space; İ is one character
    expect(f.map.slice(0, 4)).toEqual([0, 0, 1, 2]);
    expect(f.text.length).toBe(f.map.length);
  });
});

describe('findInDocument', () => {
  it('finds every occurrence in reading order, with the page and the words around it', () => {
    const { hits, total } = findInDocument(ieeeMl, 'expert gating');
    expect(total).toBeGreaterThan(5);
    expect(hits.length).toBe(total);
    const order = new Map(ieeeMl.blocks.map((b, i) => [b.id, i]));
    for (let i = 1; i < hits.length; i++) expect(order.get(hits[i].blockId)! >= order.get(hits[i - 1].blockId)!).toBe(true);
    for (const h of hits) {
      expect(h.page).toBeGreaterThanOrEqual(1);
      expect(h.match.toLowerCase()).toBe('expert gating');
      expect(h.before.length + h.after.length).toBeGreaterThan(0);
    }
  });

  it('gives offsets that point at the match inside the text the reader draws', () => {
    const { hits } = findInDocument(ieeeMl, 'Expert Gating');
    const inline = hits.filter((h) => h.range);
    expect(inline.length).toBeGreaterThan(3);
    for (const h of inline) {
      const block = ieeeMl.blocks.find((b) => b.id === h.blockId)!;
      expect(renderedText(block).slice(h.range!.start, h.range!.end).toLowerCase()).toBe('expert gating');
    }
  });

  it('matches without caring about case, accents or extra spaces', () => {
    expect(findInDocument(ieeeMl, 'EXPERT   gating').total).toBe(findInDocument(ieeeMl, 'expert gating').total);
    const doc = clone(ieeeMl);
    const p = doc.blocks.find((b) => b.type === 'paragraph' && !b.prefix)!;
    p.spans = [{ ...p.spans[0], text: 'Café Ünal ﬁnder İstanbul ışık' }];
    p.text = p.spans[0].text;
    for (const q of ['cafe unal', 'finder', 'istanbul', 'ISIK']) {
      const r = findInDocument(doc, q);
      expect(r.hits.some((h) => h.blockId === p.id)).toBe(true);
    }
    const hit = findInDocument(doc, 'finder').hits.find((h) => h.blockId === p.id)!;
    expect(p.text.slice(hit.range!.start, hit.range!.end)).toBe('ﬁnder'); // the ligature, not two letters
  });

  it('also looks inside figures, tables and the removed page text, and says where the match cannot be drawn', () => {
    const fig = ieeeMl.blocks.find((b) => b.type === 'figure' && b.inner_text)!;
    const word = (fig.inner_text as string).split(/\s+/).find((w) => w.length >= 5 && /^[A-Za-z]+$/.test(w))!;
    const r = findInDocument(ieeeMl, word);
    const hit = r.hits.find((h) => h.blockId === fig.id)!;
    expect(hit).toBeDefined();
    expect(hit.range).toBeNull(); // the text is inside a picture's collapsed text, not drawn inline
    const omitted = ieeeMl.quality.omitted.find((o) => /[A-Za-z]{5,}/.test(o.text))!;
    const w = /[A-Za-z]{5,}/.exec(omitted.text)![0];
    expect(findInDocument(ieeeMl, w).hits.some((h) => h.removed && h.page === omitted.page)).toBe(true);
  });

  it('needs at least two characters, caps the list, and reports the real total', () => {
    expect(findInDocument(ieeeMl, '').hits).toEqual([]);
    expect(findInDocument(ieeeMl, ' a ').hits).toEqual([]);
    const capped = findInDocument(ieeeMl, 'the', { limit: 5 });
    expect(capped.hits).toHaveLength(5);
    expect(capped.total).toBeGreaterThan(5);
  });

  it('treats the query as plain text, never as a pattern', () => {
    expect(findInDocument(ieeeMl, '.*').total).toBe(0);
    expect(findInDocument(ieeeMl, '(').total).toBe(0);
    expect(findInDocument(ieeeMl, '[9]').total).toBeGreaterThan(0); // a citation written as in the paper
  });

  it('is fast on a long paper', () => {
    const big = clone(ieeeMl);
    for (let k = 1; k < 40; k++) for (const b of ieeeMl.blocks) big.blocks.push({ ...clone(b), id: `${b.id}-${k}` });
    const t0 = Date.now();
    const r = findInDocument(big, 'gating', { limit: 50 });
    expect(Date.now() - t0).toBeLessThan(500);
    expect(r.total).toBeGreaterThan(300);
  });
});
