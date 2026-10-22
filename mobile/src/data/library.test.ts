import { clone, ieeeMl, mlCompanion } from '@/testing/fixtures';

import { MemoryBlobStore } from './blobs';
import { MemoryKV } from './kv';
import { LibraryRepo } from './library';

function setup() {
  let t = 1000;
  const kv = new MemoryKV();
  const blobs = new MemoryBlobStore();
  const repo = new LibraryRepo(kv, blobs, () => ++t);
  return { kv, blobs, repo };
}

describe('LibraryRepo', () => {
  it('adds documents and lists the newest first', async () => {
    const { repo } = setup();
    await repo.addDocument(ieeeMl, 1000, true);
    await repo.addDocument(mlCompanion, 2000, false);
    const list = await repo.list();
    expect(list.map((e) => e.id)).toEqual([mlCompanion.id, ieeeMl.id]);
    expect(list[1]).toMatchObject({ title: 'Sparse Routing for Efficient Transformers', pageCount: 3, hasOriginalPdf: true });
    expect((await repo.loadDocument(ieeeMl.id))?.id).toBe(ieeeMl.id);
  });

  it('remembers which papers were read by OCR, so the library can say so', async () => {
    const { repo } = setup();
    const scanned = clone(ieeeMl);
    scanned.quality.ocr = true;
    expect((await repo.addDocument(scanned, 1, true)).ocr).toBe(true);
    expect((await repo.addDocument(mlCompanion, 1, true)).ocr).toBe(false);
  });

  it('keeps reading progress when the same paper is imported again', async () => {
    const { repo } = setup();
    await repo.addDocument(ieeeMl, 1, true);
    await repo.saveState(ieeeMl.id, { percent: 42, anchor: { blockId: 'b0010', offset: 0.5 } });
    await repo.markOpened(ieeeMl.id);
    const again = await repo.addDocument(clone(ieeeMl), 1, true);
    expect(again.percent).toBe(42);
    expect(again.lastOpenedAt).not.toBeNull();
    expect((await repo.getState(ieeeMl.id)).anchor?.blockId).toBe('b0010');
    expect(await repo.list()).toHaveLength(1);
  });

  it('orders by last opened', async () => {
    const { repo } = setup();
    await repo.addDocument(ieeeMl, 1, true);
    await repo.addDocument(mlCompanion, 1, true);
    await repo.markOpened(ieeeMl.id);
    expect((await repo.list())[0].id).toBe(ieeeMl.id);
  });

  it('serializes concurrent state updates without losing any', async () => {
    const { repo } = setup();
    await repo.addDocument(ieeeMl, 1, true);
    await Promise.all([
      repo.saveState(ieeeMl.id, { percent: 10 }),
      repo.saveState(ieeeMl.id, { bookmarks: [{ blockId: 'b0003', createdAt: 5 }] }),
      repo.saveState(ieeeMl.id, { mode: 'original' }),
    ]);
    const s = await repo.getState(ieeeMl.id);
    expect(s).toMatchObject({ percent: 10, mode: 'original' });
    expect(s.bookmarks).toHaveLength(1);
    expect((await repo.get(ieeeMl.id))?.percent).toBe(10);
  });

  it('removes the paper, its files and every record that belongs to it', async () => {
    const { repo, kv, blobs } = setup();
    await repo.addDocument(ieeeMl, 1, true);
    await blobs.put(`docs/${ieeeMl.id}/pages/p001.jpg`, new Uint8Array([1]));
    await blobs.put(`docs/${mlCompanion.id}/pages/p001.jpg`, new Uint8Array([2]));
    await repo.saveState(ieeeMl.id, { percent: 5 });
    await repo.remove(ieeeMl.id);
    expect(await repo.get(ieeeMl.id)).toBeNull();
    expect([...blobs.files.keys()].filter((k) => k.includes(ieeeMl.id))).toEqual([]);
    expect(await kv.keys('folume:v1:doc:')).toEqual([]);
    expect(blobs.files.has(`docs/${mlCompanion.id}/pages/p001.jpg`)).toBe(true);
  });

  it('survives a missing document file', async () => {
    const { repo } = setup();
    expect(await repo.loadDocument('nope')).toBeNull();
    expect(await repo.getState('nope')).toMatchObject({ percent: 0, bookmarks: [] });
  });
});
