import { notesToMarkdown } from '@/core/export/markdown';
import { sectionBlocks, indexDocument } from '@/core/docModel';
import { AnnotationRepo, toHighlightViews } from '@/data/annotations';
import { MemoryKV } from '@/data/kv';
import type { LibraryEntry } from '@/data/library';
import { ieeeMl } from '@/testing/fixtures';

import { clozeQuestions, sentences } from './cloze';

const entry = (over: Partial<LibraryEntry> = {}): LibraryEntry => ({
  id: 'doc1', title: 'Sparse Routing', authors: ['Quinn Rossi', 'Deniz Cohen'], filename: 'a.pdf', pageCount: 3, addedAt: 1,
  lastOpenedAt: null, grade: 'good', score: 1, percent: 0, sizeBytes: 1, year: 2024, doi: '10.1/abc', language: 'en',
  tags: [], hasOriginalPdf: true, ...over,
});

describe('AnnotationRepo', () => {
  let t = 100;
  const make = () => new AnnotationRepo(new MemoryKV(), () => ++t, (() => { let n = 0; return () => `a${++n}`; })());
  const base = { docId: 'doc1', blockId: 'b0010', start: 3, end: 20, quote: 'some quoted text', color: 'rgba(1,2,3,.4)', page: 2 };

  it('adds, updates and removes annotations', async () => {
    const repo = make();
    const a = await repo.add(base);
    expect(a).toMatchObject({ id: 'a1', note: '', origin: 'user', tags: [] });
    const updated = await repo.update('doc1', a.id, { note: 'why?' });
    expect(updated?.note).toBe('why?');
    expect(updated!.updatedAt).toBeGreaterThan(a.updatedAt);
    expect(await repo.update('doc1', 'missing', { note: 'x' })).toBeNull();
    await repo.remove('doc1', a.id);
    expect(await repo.list('doc1')).toEqual([]);
  });

  it('orders by page and position and lists across papers', async () => {
    const repo = make();
    await repo.add({ ...base, page: 3, blockId: 'b0030' });
    await repo.add({ ...base, page: 1, blockId: 'b0001' });
    await repo.add({ ...base, docId: 'doc2', page: 2 });
    expect((await repo.list('doc1')).map((a) => a.page)).toEqual([1, 3]);
    expect(await repo.listAll()).toHaveLength(3);
  });

  it('keeps AI-written notes labelled and serializes concurrent writes', async () => {
    const repo = make();
    await Promise.all([repo.add({ ...base, note: 'from the model', origin: 'ai' }), repo.add(base), repo.add(base)]);
    const items = await repo.list('doc1');
    expect(items).toHaveLength(3);
    expect(items.find((a) => a.note)?.origin).toBe('ai');
  });

  it('paints only ranges, never block-level notes', async () => {
    const repo = make();
    await repo.add(base);
    await repo.add({ ...base, start: 0, end: 0, quote: '', note: 'whole block' });
    const views = toHighlightViews(await repo.list('doc1'));
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ blockId: 'b0010', start: 3, end: 20, hasNote: false });
  });
});

describe('notesToMarkdown', () => {
  const ann = (over = {}) => ({ id: 'x', docId: 'doc1', blockId: 'b1', start: 0, end: 5, quote: 'Sparse   routing\nsaves memory', color: '', note: '', origin: 'user' as const, tags: [], page: 2, createdAt: 1, updatedAt: 1, ...over });

  it('lists quotes with pages, notes, and labels AI text as not the authors', () => {
    const md = notesToMarkdown([entry()], [ann({ note: 'check this' }), ann({ page: 3, note: 'Because only k experts run.', origin: 'ai' })]);
    expect(md).toContain('## Sparse Routing');
    expect(md).toContain('_Quinn Rossi, Deniz Cohen · 2024 · doi:10.1/abc_');
    expect(md).toContain('> Sparse routing saves memory\n> — p. 2');
    expect(md).toContain('check this');
    expect(md).toContain("**AI-generated note** (not the authors' text)");
    expect(md.indexOf('p. 2')).toBeLessThan(md.indexOf('p. 3'));
  });

  it('skips papers without notes and handles an empty library', () => {
    expect(notesToMarkdown([entry(), entry({ id: 'doc9', title: 'Other' })], [ann()])).not.toContain('Other');
    expect(notesToMarkdown([], [])).toContain('No notes yet');
  });
});

describe('clozeQuestions', () => {
  const method = ieeeMl.sections.find((s) => s.title === 'METHOD')!;
  const idx = indexDocument(ieeeMl);
  const passages = sectionBlocks(idx, method.id).filter((b) => b.type === 'paragraph').map((b, i) => ({ id: `p${i + 1}`, text: b.text }));

  it('splits sentences without breaking on abbreviations inside words', () => {
    expect(sentences('We define X. Then we show Y. (Next) Z holds.')).toHaveLength(3);
  });

  it('builds deterministic cloze questions with a blank, four choices and a cited source', () => {
    const a = clozeQuestions(passages, 3);
    expect(a).toEqual(clozeQuestions(passages, 3));
    expect(a.length).toBeGreaterThan(0);
    for (const q of a) {
      expect(q.type).toBe('cloze');
      expect(q.prompt).toContain('_____');
      expect(q.choices).toHaveLength(4);
      expect(q.choices).toContain(q.answer);
      expect(q.prompt.toLowerCase()).not.toContain(q.answer);
      expect(q.explanation.toLowerCase()).toContain(q.answer);
      expect(passages.map((p) => p.id)).toContain(q.cites[0]);
    }
    expect(new Set(a.map((q) => q.answer)).size).toBe(a.length);
  });

  it('returns nothing when there is too little text', () => {
    expect(clozeQuestions([{ id: 'p1', text: 'Too short.' }], 3)).toEqual([]);
  });
});
