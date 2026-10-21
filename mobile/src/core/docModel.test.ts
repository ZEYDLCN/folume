import { ieeeMl, acmGraph } from '@/testing/fixtures';

import {
  blockText,
  firstBlockOnPage,
  flattenOutline,
  hasWarnings,
  indexDocument,
  outline,
  readingMinutes,
  sectionBlocks,
  titleOf,
  wordCount,
} from './docModel';

describe('docModel', () => {
  const idx = indexDocument(ieeeMl);

  it('indexes blocks, sections and pages', () => {
    expect(idx.byId.size).toBe(ieeeMl.blocks.length);
    expect(idx.references).toHaveLength(14);
    expect(idx.pageBlocks.get(1)?.[0]).toBe(ieeeMl.blocks[0].id);
    expect(idx.order.get(ieeeMl.blocks[5].id)).toBe(5);
  });

  it('derives titles and reading statistics', () => {
    expect(titleOf(ieeeMl)).toBe('Sparse Routing for Efficient Transformers');
    expect(titleOf({ ...ieeeMl, metadata: { ...ieeeMl.metadata, title: null } })).toBe('ieee_ml');
    expect(wordCount(ieeeMl)).toBeGreaterThan(1000);
    expect(readingMinutes(ieeeMl)).toBeGreaterThanOrEqual(1);
  });

  it('builds a nested outline matching the section levels', () => {
    const flat = flattenOutline(outline(ieeeMl));
    expect(flat.length).toBe(ieeeMl.sections.length);
    const method = flat.find((f) => f.section.title === 'METHOD')!;
    expect(method.depth).toBe(0);
    const children = flat.filter((f) => f.section.parent_id === method.section.id);
    expect(children.map((c) => c.section.title)).toEqual(['Problem Setup', 'Training Objective']);
    expect(children.every((c) => c.depth === 1)).toBe(true);
  });

  it('returns the text of a section including its subsections', () => {
    const method = ieeeMl.sections.find((s) => s.title === 'METHOD')!;
    const blocks = sectionBlocks(idx, method.id);
    expect(blocks.some((b) => b.type === 'equation')).toBe(true);
    expect(blocks.some((b) => b.type === 'heading' && b.text === 'Problem Setup')).toBe(true);
    expect(blocks.some((b) => b.type === 'heading' && b.text === 'EXPERIMENTS')).toBe(false);
    expect(blocks[0].id).not.toBe(method.block_id); // the heading itself is excluded
  });

  it('finds the first block of a page and skips pages without content', () => {
    expect(firstBlockOnPage(idx, 2)).toBeTruthy();
    expect(idx.byId.get(firstBlockOnPage(idx, 2)!)!.source.some((s) => s.page === 2)).toBe(true);
  });

  it('uses the caption as the text of figures and tables', () => {
    const fig = ieeeMl.blocks.find((b) => b.type === 'figure')!;
    expect(blockText(idx, fig)).toMatch(/^Fig\. 1\./);
  });

  it('flags only warnings and errors as warnings', () => {
    expect(hasWarnings(ieeeMl.blocks.find((b) => b.type === 'equation')!)).toBe(false);
    const withWarning = { ...ieeeMl.blocks[0], flags: [{ code: 'text_garbled' as const, severity: 'warning' as const, message: 'x' }] };
    expect(hasWarnings(withWarning)).toBe(true);
  });

  it('works for author-year papers with footnotes', () => {
    const i = indexDocument(acmGraph);
    expect(acmGraph.blocks.filter((b) => b.type === 'footnote')).toHaveLength(2);
    expect(i.references.length).toBeGreaterThan(5);
  });
});
