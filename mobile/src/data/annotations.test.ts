import { notesToMarkdown } from '@/core/export/markdown';
import { ieeeMl, mlCompanion } from '@/testing/fixtures';

import { AnnotationRepo, toHighlightViews } from './annotations';
import { MemoryKV } from './kv';
import { LibraryRepo } from './library';
import { MemoryBlobStore } from './blobs';
import { QuizRepo } from './quiz';

function annotations() {
  let t = 100;
  let n = 0;
  const kv = new MemoryKV();
  return { kv, repo: new AnnotationRepo(kv, () => ++t, () => `a${++n}`) };
}

const base = { docId: ieeeMl.id, blockId: 'b0010', start: 3, end: 12, quote: 'sparse routing', color: 'yellow', page: 2 };

describe('AnnotationRepo', () => {
  it('stores annotations per paper and sorts them in reading order', async () => {
    const { repo } = annotations();
    await repo.add({ ...base, page: 3, blockId: 'b0030' });
    await repo.add({ ...base, page: 1, blockId: 'b0002' });
    await repo.add({ ...base, docId: mlCompanion.id });
    expect((await repo.list(ieeeMl.id)).map((a) => a.page)).toEqual([1, 3]);
    expect(await repo.listAll()).toHaveLength(3);
  });

  it('defaults to a user-authored, tag-less note and keeps AI origin explicit', async () => {
    const { repo } = annotations();
    const mine = await repo.add(base);
    const ai = await repo.add({ ...base, start: 20, end: 30, note: 'summary', origin: 'ai' });
    expect(mine).toMatchObject({ origin: 'user', note: '', tags: [] });
    expect(ai.origin).toBe('ai');
  });

  it('updates and removes without touching other records', async () => {
    const { repo } = annotations();
    const a = await repo.add(base);
    const b = await repo.add({ ...base, start: 30, end: 40 });
    const updated = await repo.update(ieeeMl.id, a.id, { note: 'check eq. 3' });
    expect(updated?.note).toBe('check eq. 3');
    expect(updated?.updatedAt).toBeGreaterThan(a.updatedAt);
    expect(await repo.update(ieeeMl.id, 'missing', { note: 'x' })).toBeNull();
    await repo.remove(ieeeMl.id, a.id);
    expect((await repo.list(ieeeMl.id)).map((x) => x.id)).toEqual([b.id]);
  });

  it('does not lose writes that race', async () => {
    const { repo } = annotations();
    await Promise.all(Array.from({ length: 12 }, (_, i) => repo.add({ ...base, start: i, end: i + 1 })));
    expect(await repo.list(ieeeMl.id)).toHaveLength(12);
  });
});

describe('toHighlightViews', () => {
  it('paints ranges only and marks the ones that carry a note', async () => {
    const { repo } = annotations();
    const ranged = await repo.add({ ...base, note: 'why?' });
    await repo.add({ ...base, start: 5, end: 5, note: 'whole block' });
    const views = toHighlightViews(await repo.list(ieeeMl.id));
    expect(views).toEqual([{ id: ranged.id, blockId: 'b0010', start: 3, end: 12, color: 'yellow', hasNote: true }]);
  });
});

describe('QuizRepo', () => {
  const item = (correct: boolean) => ({
    qid: 'q1',
    type: 'cloze' as const,
    prompt: 'p',
    answer: 'a',
    explanation: 'e',
    concept: null,
    correct,
    blockIds: ['b0001'],
  });

  it('counts correct answers and returns the newest result first', async () => {
    let t = 1;
    const repo = new QuizRepo(new MemoryKV(), () => ++t);
    await repo.add({ docId: ieeeMl.id, sectionId: 's1', sectionTitle: 'Intro', mode: 'local', items: [item(true), item(false)] });
    await repo.add({ docId: ieeeMl.id, sectionId: 's2', sectionTitle: 'Method', mode: 'ai', items: [item(true)] });
    const list = await repo.list(ieeeMl.id);
    expect(list.map((r) => [r.sectionId, r.correct])).toEqual([['s2', 1], ['s1', 1]]);
    expect(await repo.listAll()).toHaveLength(2);
  });
});

describe('notesToMarkdown', () => {
  it('groups by paper, keeps page + quote, and labels AI text as not the authors', async () => {
    const { repo } = annotations();
    const kv = new MemoryKV();
    const library = new LibraryRepo(kv, new MemoryBlobStore(), () => 1);
    await library.addDocument(ieeeMl, 1, true);
    await library.addDocument(mlCompanion, 1, true);
    await repo.add({ ...base, note: 'my view\nsecond line' });
    await repo.add({ ...base, start: 20, end: 30, quote: 'two\n  lines', note: 'generated', origin: 'ai', page: 3 });
    const md = notesToMarkdown(await library.list(), await repo.listAll());
    expect(md).toContain(`## ${ieeeMl.metadata.title}`);
    expect(md).not.toContain(`## ${mlCompanion.metadata.title}`);
    expect(md).toContain('> sparse routing\n> — p. 2');
    expect(md).toContain('> two lines');
    expect(md).toContain('**AI-generated note**');
    expect(md).toContain('my view\n  second line');
    expect(md).not.toMatch(/\n{3,}/);
  });

  it('says so when there is nothing to export', () => {
    expect(notesToMarkdown([], [])).toContain('No notes yet');
  });
});
