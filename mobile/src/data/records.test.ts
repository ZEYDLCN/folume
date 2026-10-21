import { newCard, review } from '@/core/learning/srs';
import { parseBackup, parseRecordKey, type SyncRecord } from '@/core/sync/records';
import { ieeeMl, mlCompanion } from '@/testing/fixtures';

import { AnnotationRepo } from './annotations';
import { createBackup, restoreBackup } from './backup';
import { MemoryBlobStore } from './blobs';
import { CardRepo } from './cards';
import { MemoryKV } from './kv';
import { LibraryRepo } from './library';
import { Mutex } from './mutex';
import { QuizRepo } from './quiz';
import { RecordStore } from './records';

/** One device: its own storage and clock, sharing nothing with the others. */
function device(start: number) {
  let t = start;
  const now = () => ++t;
  const kv = new MemoryKV();
  const mutex = new Mutex();
  let n = 0;
  const id = (p: string) => `${p}${start}x${++n}`;
  return {
    kv,
    now,
    set clock(v: number) {
      t = v;
    },
    library: new LibraryRepo(kv, new MemoryBlobStore(), now, mutex),
    annotations: new AnnotationRepo(kv, now, () => id('a'), mutex),
    cards: new CardRepo(kv, now, mutex),
    quizzes: new QuizRepo(kv, now),
    records: new RecordStore(kv, mutex),
  };
}

const ann = (docId: string, over: Record<string, unknown> = {}) => ({
  docId,
  blockId: 'b0010',
  start: 1,
  end: 9,
  quote: 'sparse routing',
  color: 'yellow',
  page: 2,
  note: 'mine',
  ...over,
});

describe('record keys', () => {
  it('accepts only the shapes the stores write', () => {
    expect(parseRecordKey('ann/abc123/a1')).toEqual({ kind: 'ann', docId: 'abc123', id: 'a1' });
    expect(parseRecordKey('state/abc123')).toEqual({ kind: 'state', docId: 'abc123', id: null });
    expect(parseRecordKey('state/abc/extra')).toBeNull();
    expect(parseRecordKey('ann/abc')).toBeNull();
    expect(parseRecordKey('../etc/passwd')).toBeNull();
    expect(parseRecordKey('evil/abc')).toBeNull();
  });
});

describe('RecordStore', () => {
  it('collects notes, progress, quiz results, cards and tags as records', async () => {
    const d = device(1000);
    await d.library.addDocument(ieeeMl, 1, true);
    await d.annotations.add(ann(ieeeMl.id));
    await d.library.saveState(ieeeMl.id, { percent: 40 });
    await d.library.setTags(ieeeMl.id, ['to-read', ' to-read ', 'ml']);
    await d.cards.add([{ docId: ieeeMl.id, kind: 'quiz', front: 'q', back: 'a', blockIds: ['b0001'], page: 1 }]);
    await d.quizzes.add({ docId: ieeeMl.id, sectionId: 's1', sectionTitle: 'Intro', mode: 'local', items: [] });
    const kinds = (await d.records.collect()).map((r) => parseRecordKey(r.key)?.kind).sort();
    expect(kinds).toEqual(['ann', 'card', 'quiz', 'state', 'tags']);
    expect((await d.library.get(ieeeMl.id))?.tags).toEqual(['to-read', 'ml']);
  });

  it('keeps the newest version of a record and ignores older or identical ones', async () => {
    const a = device(1000);
    const b = device(5000);
    const made = await a.annotations.add(ann(ieeeMl.id));
    const [rec] = await a.records.collect();
    expect(await b.records.apply([rec])).toEqual({ applied: 1, skipped: 0, invalid: 0 });
    expect(await b.records.apply([rec])).toEqual({ applied: 0, skipped: 1, invalid: 0 });
    await b.annotations.update(ieeeMl.id, made.id, { note: 'edited later on b' });
    const older = await b.records.apply([{ ...rec, updatedAt: rec.updatedAt - 1, data: { ...(rec.data as object), note: 'stale' } }]);
    expect(older.skipped).toBe(1);
    expect((await b.annotations.list(ieeeMl.id))[0].note).toBe('edited later on b');
  });

  it('propagates deletions and does not let an old copy resurrect a deleted note', async () => {
    const a = device(1000);
    const b = device(1000);
    const made = await a.annotations.add(ann(ieeeMl.id));
    const [rec] = await a.records.collect();
    await b.records.apply([rec]);
    await a.annotations.remove(ieeeMl.id, made.id);
    const afterDelete = await a.records.collect();
    expect(afterDelete).toEqual([expect.objectContaining({ key: rec.key, deleted: true, data: null })]);
    expect((await b.records.apply(afterDelete)).applied).toBe(1);
    expect(await b.annotations.list(ieeeMl.id)).toEqual([]);
    // an old device pushes the stale live copy again: it must stay deleted
    expect((await b.records.apply([rec])).skipped).toBe(1);
    expect(await b.annotations.list(ieeeMl.id)).toEqual([]);
    // a newer edit made after the deletion wins (the note was recreated elsewhere)
    const revived = { ...rec, updatedAt: afterDelete[0].updatedAt + 10 };
    expect((await b.records.apply([revived])).applied).toBe(1);
    expect(await b.annotations.list(ieeeMl.id)).toHaveLength(1);
  });

  it('a newer local edit survives an older remote deletion', async () => {
    const a = device(1000);
    const made = await a.annotations.add(ann(ieeeMl.id));
    const [rec] = await a.records.collect();
    const res = await a.records.apply([{ key: rec.key, updatedAt: made.updatedAt - 5, deleted: true, data: null }]);
    expect(res.skipped).toBe(1);
    expect(await a.annotations.list(ieeeMl.id)).toHaveLength(1);
  });

  it('merges per-paper state and tags and updates the library entry', async () => {
    const a = device(1000);
    const b = device(1000);
    await a.library.addDocument(ieeeMl, 1, true);
    await b.library.addDocument(ieeeMl, 1, true);
    await a.library.saveState(ieeeMl.id, { percent: 73, anchor: { blockId: 'b0020', offset: 0.1 } });
    await a.library.setTags(ieeeMl.id, ['reading-group']);
    await b.records.apply(await a.records.collect());
    expect((await b.library.get(ieeeMl.id))?.percent).toBe(73);
    expect((await b.library.get(ieeeMl.id))?.tags).toEqual(['reading-group']);
    expect((await b.library.getState(ieeeMl.id)).anchor?.blockId).toBe('b0020');
  });

  it('keeps tags for a paper that is not on the device yet and applies them when it is imported', async () => {
    const a = device(1000);
    const b = device(1000);
    await a.library.addDocument(ieeeMl, 1, true);
    await a.library.setTags(ieeeMl.id, ['later']);
    await b.records.apply(await a.records.collect());
    expect(await b.library.get(ieeeMl.id)).toBeNull();
    const entry = await b.library.addDocument(ieeeMl, 1, true);
    expect(entry.tags).toEqual(['later']);
  });

  it('merges review progress: the device that reviewed last wins', async () => {
    const a = device(1000);
    const b = device(1000);
    await a.cards.add([{ docId: ieeeMl.id, kind: 'quiz', front: 'q', back: 'a', blockIds: [], page: 1 }]);
    await b.records.apply(await a.records.collect());
    const [card] = await b.cards.list(ieeeMl.id);
    b.clock = 9_000_000;
    await b.cards.grade(ieeeMl.id, card.id, 'good');
    await a.records.apply(await b.records.collect());
    const [synced] = await a.cards.list(ieeeMl.id);
    expect(synced).toMatchObject({ reps: 1, interval: 1 });
  });

  it('rejects records with the wrong shape or a key that does not match their content', async () => {
    const d = device(1000);
    const good = await (async () => {
      await d.annotations.add(ann(ieeeMl.id));
      return (await d.records.collect())[0];
    })();
    const e = device(1000);
    const bad: SyncRecord[] = [
      { key: 'ann/not/a/valid/key', updatedAt: 1, deleted: false, data: good.data },
      { key: good.key, updatedAt: 1, deleted: false, data: { note: 'missing fields' } },
      { key: good.key, updatedAt: Number.NaN, deleted: false, data: good.data },
      { key: `ann/${mlCompanion.id}/${(good.data as { id: string }).id}`, updatedAt: 1, deleted: false, data: good.data },
      { key: 'ann/doc/other-id', updatedAt: 1, deleted: false, data: { ...(good.data as object), docId: 'doc' } },
    ];
    expect(await e.records.apply(bad)).toEqual({ applied: 0, skipped: 0, invalid: 5 });
    expect(await e.records.collect()).toEqual([]);
  });
});

describe('backup', () => {
  it('round-trips everything the reader owns and says what the papers are', async () => {
    const a = device(1000);
    await a.library.addDocument(ieeeMl, 1, true);
    await a.annotations.add(ann(ieeeMl.id, { note: 'çok önemli ✓' }));
    await a.library.setTags(ieeeMl.id, ['x']);
    const file = await createBackup(a.records, a.library, 42);
    const parsed = parseBackup(file);
    expect(parsed.ok && parsed.backup.papers).toEqual([
      expect.objectContaining({ id: ieeeMl.id, title: 'Sparse Routing for Efficient Transformers' }),
    ]);
    const b = device(1000);
    const res = await restoreBackup(b.records, file);
    expect(res).toMatchObject({ ok: true, papers: 1, applied: 2, invalid: 0 });
    expect((await b.annotations.list(ieeeMl.id))[0].note).toBe('çok önemli ✓');
    // restoring twice changes nothing
    expect(await restoreBackup(b.records, file)).toMatchObject({ applied: 0, skipped: 2 });
  });

  it('does not touch the device when the file is not a backup', async () => {
    const d = device(1000);
    expect(await restoreBackup(d.records, 'not json')).toEqual({ ok: false, error: 'not_json' });
    expect(await restoreBackup(d.records, '{"hello":1}')).toEqual({ ok: false, error: 'wrong_format' });
    expect(await restoreBackup(d.records, JSON.stringify({ format: 'folume-backup', version: 99, records: [] }))).toEqual({
      ok: false,
      error: 'newer_version',
    });
  });

  it('drops invalid records inside an otherwise valid file', async () => {
    const d = device(1000);
    const file = JSON.stringify({ format: 'folume-backup', version: 1, createdAt: 1, papers: [], records: [{ key: 'ann/x/y', updatedAt: 1, data: {} }, 'junk'] });
    const parsed = parseBackup(file);
    expect(parsed.ok && parsed.backup.records).toEqual([]);
    expect(await restoreBackup(d.records, file)).toMatchObject({ ok: true, applied: 0 });
  });
});

describe('CardRepo', () => {
  it('adds a missed question once and keeps its schedule when it is added again', async () => {
    const d = device(1000);
    const input = { docId: ieeeMl.id, kind: 'quiz' as const, front: 'q?', back: 'a', blockIds: ['b1'], page: 1 };
    expect(await d.cards.add([input, input])).toBe(1);
    const [card] = await d.cards.list(ieeeMl.id);
    await d.cards.grade(ieeeMl.id, card.id, 'good');
    expect(await d.cards.add([input])).toBe(0);
    expect((await d.cards.list(ieeeMl.id))[0].reps).toBe(1);
  });

  it('offers due cards and counts them', async () => {
    const d = device(1000);
    await d.cards.add([
      { docId: ieeeMl.id, kind: 'quiz', front: 'one', back: 'a', blockIds: [], page: 1 },
      { docId: mlCompanion.id, kind: 'concept', front: 'two', back: 'b', blockIds: [], page: 1 },
    ]);
    expect((await d.cards.due()).map((c) => c.front).sort()).toEqual(['one', 'two']);
    const [first] = await d.cards.due();
    await d.cards.grade(first.docId, first.id, 'easy');
    expect(await d.cards.stats()).toMatchObject({ total: 2, due: 1 });
  });

  it('can suspend and delete cards, and deletions are remembered for sync', async () => {
    const d = device(1000);
    await d.cards.add([{ docId: ieeeMl.id, kind: 'quiz', front: 'one', back: 'a', blockIds: [], page: 1 }]);
    const [card] = await d.cards.list(ieeeMl.id);
    await d.cards.setSuspended(ieeeMl.id, card.id, true);
    expect(await d.cards.due()).toEqual([]);
    await d.cards.remove(ieeeMl.id, card.id);
    expect((await d.records.collect()).some((r) => r.deleted && r.key === `card/${ieeeMl.id}/${card.id}`)).toBe(true);
  });

  it('never loses a review when two happen at once', async () => {
    const d = device(1000);
    await d.cards.add([
      { docId: ieeeMl.id, kind: 'quiz', front: 'one', back: 'a', blockIds: [], page: 1 },
      { docId: ieeeMl.id, kind: 'quiz', front: 'two', back: 'b', blockIds: [], page: 1 },
    ]);
    const [x, y] = await d.cards.list(ieeeMl.id);
    await Promise.all([d.cards.grade(ieeeMl.id, x.id, 'good'), d.cards.grade(ieeeMl.id, y.id, 'good')]);
    expect((await d.cards.list(ieeeMl.id)).map((c) => c.reps)).toEqual([1, 1]);
    void newCard;
    void review;
  });
});
