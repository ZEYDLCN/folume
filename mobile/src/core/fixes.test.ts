import type { BlockFix } from '@/data/userdata';
import { clone, ieeeMl } from '@/testing/fixtures';

import { documentText } from './completeness';
import { applyFixes } from './fixes';

const fix = (id: string, over: Partial<BlockFix> = {}): BlockFix => ({ id, docId: 'd', text: null, type: null, hidden: false, mergePrev: false, updatedAt: 1, ...over });
const paragraphs = ieeeMl.blocks.filter((b) => b.type === 'paragraph' && !b.prefix);

describe('applyFixes', () => {
  it('changes nothing without corrections, and never touches the original document', () => {
    expect(applyFixes(ieeeMl, [])).toBe(ieeeMl);
    const before = JSON.stringify(ieeeMl);
    applyFixes(ieeeMl, [fix(paragraphs[0].id, { text: 'changed' })]);
    expect(JSON.stringify(ieeeMl)).toBe(before);
  });

  it('replaces the text of a block with plain text and keeps where it came from', () => {
    const b = paragraphs[0];
    const out = applyFixes(ieeeMl, [fix(b.id, { text: 'Corrected sentence one. Two.' })]);
    const nb = out.blocks.find((x) => x.id === b.id)!;
    expect(nb.text).toBe('Corrected sentence one. Two.');
    expect(nb.spans.map((s) => s.text).join('')).toBe('Corrected sentence one. Two.');
    expect(nb.source).toEqual(b.source);
    expect(out.blocks).toHaveLength(ieeeMl.blocks.length);
  });

  it('turns a paragraph into a heading that shows up in the contents, and a heading into a paragraph', () => {
    const b = paragraphs[2];
    const out = applyFixes(ieeeMl, [fix(b.id, { type: 'heading' })]);
    const nb = out.blocks.find((x) => x.id === b.id)!;
    expect(nb.type).toBe('heading');
    expect(nb.level).toBe(2);
    expect(out.sections.some((s) => s.block_id === b.id && s.title === b.text)).toBe(true);
    const h = ieeeMl.blocks.find((x) => x.type === 'heading')!;
    const back = applyFixes(ieeeMl, [fix(h.id, { type: 'paragraph' })]);
    expect(back.blocks.find((x) => x.id === h.id)!.type).toBe('paragraph');
    expect(back.sections.some((s) => s.block_id === h.id)).toBe(false);
  });

  it('hides a block', () => {
    const b = paragraphs[1];
    const out = applyFixes(ieeeMl, [fix(b.id, { hidden: true })]);
    expect(out.blocks.some((x) => x.id === b.id)).toBe(false);
    expect(out.blocks).toHaveLength(ieeeMl.blocks.length - 1);
  });

  it('joins a block to the one before it: text, spans and source regions', () => {
    const a = paragraphs[3];
    const b = ieeeMl.blocks[ieeeMl.blocks.indexOf(a) + 1];
    expect(b.type).toBe('paragraph'); // fixture layout the test relies on
    const out = applyFixes(ieeeMl, [fix(b.id, { mergePrev: true })]);
    const merged = out.blocks.find((x) => x.id === a.id)!;
    expect(merged.text).toBe(`${a.text} ${b.text}`);
    expect(merged.spans.map((s) => s.text).join('')).toBe(`${a.spans.map((s) => s.text).join('')} ${b.spans.map((s) => s.text).join('')}`);
    expect(merged.source).toEqual([...a.source, ...b.source]);
    expect(out.blocks.some((x) => x.id === b.id)).toBe(false);
  });

  it('joins a hyphenated line end without a space', () => {
    const doc = clone(ieeeMl);
    const a = doc.blocks.find((x) => x.id === paragraphs[3].id)!;
    a.spans = [{ ...a.spans[0], text: 'a routing-' }];
    a.text = 'a routing-';
    const b = doc.blocks[doc.blocks.indexOf(a) + 1];
    const out = applyFixes(doc, [fix(b.id, { mergePrev: true })]);
    expect(out.blocks.find((x) => x.id === a.id)!.text.startsWith('a routing-')).toBe(true);
    expect(out.blocks.find((x) => x.id === a.id)!.text.startsWith('a routing- ')).toBe(false);
  });

  it('keeps every letter when only the type or the join changes', () => {
    const b = ieeeMl.blocks[ieeeMl.blocks.indexOf(paragraphs[3]) + 1];
    const out = applyFixes(ieeeMl, [fix(paragraphs[2].id, { type: 'heading' }), fix(b.id, { mergePrev: true })]);
    const letters = (t: string) => [...t.normalize('NFKC')].filter((c) => /[\p{L}\p{N}]/u.test(c)).sort().join('');
    expect(letters(documentText(out))).toBe(letters(documentText(ieeeMl)));
  });

  it('ignores corrections for blocks that are not in the paper, and a merge with nothing before it', () => {
    const first = ieeeMl.blocks[0];
    const out = applyFixes(ieeeMl, [fix('nope', { text: 'x' }), fix(first.id, { mergePrev: true })]);
    expect(out.blocks).toHaveLength(ieeeMl.blocks.length);
  });

  it('does not merge into something that is not text (a figure, an equation)', () => {
    const eq = ieeeMl.blocks.find((x) => x.type === 'equation')!;
    const next = ieeeMl.blocks[ieeeMl.blocks.indexOf(eq) + 1];
    const out = applyFixes(ieeeMl, [fix(next.id, { mergePrev: true })]);
    expect(out.blocks.some((x) => x.id === next.id)).toBe(true);
  });
});
