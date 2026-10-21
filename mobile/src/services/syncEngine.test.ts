import { ieeeMl } from '@/testing/fixtures';
import { sha256Hex } from '@/core/sha256';
import { AnnotationRepo } from '@/data/annotations';
import { MemoryBlobStore } from '@/data/blobs';
import { CardRepo } from '@/data/cards';
import { MemoryKV } from '@/data/kv';
import { LibraryRepo } from '@/data/library';
import { Mutex } from '@/data/mutex';
import { RecordStore } from '@/data/records';

import type { SyncPullResponse, SyncWireRecord } from './api';
import { SyncEngine, type SyncTransport } from './syncEngine';

/** Same contract as the backend: newest write wins per record, every accepted change gets a sequence number. */
class FakeSyncServer implements SyncTransport {
  rows = new Map<string, SyncWireRecord & { seq: number }>();
  seq = 0;
  pushes = 0;
  failNext = false;

  async syncPull(_ns: string, since: number, limit = 200): Promise<SyncPullResponse> {
    this.guard();
    const all = [...this.rows.values()].filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq);
    const page = all.slice(0, limit);
    return { records: page, next: page.length ? page[page.length - 1].seq : since, has_more: all.length > limit };
  }

  async syncPush(_ns: string, records: SyncWireRecord[]) {
    this.guard();
    this.pushes += 1;
    let accepted = 0;
    for (const r of records) {
      const have = this.rows.get(r.key);
      if (have && have.updated_at >= r.updated_at) continue;
      this.rows.set(r.key, { ...r, data: r.deleted ? null : JSON.parse(JSON.stringify(r.data)), seq: ++this.seq });
      accepted += 1;
    }
    return { accepted, ignored: records.length - accepted, seq: this.seq };
  }

  private guard() {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('network down');
    }
  }
}

const NS = sha256Hex('shared sync key');

function device(start: number, server: FakeSyncServer) {
  let t = start;
  const now = () => ++t;
  const kv = new MemoryKV();
  const mutex = new Mutex();
  let n = 0;
  const records = new RecordStore(kv, mutex);
  return {
    now,
    set clock(v: number) {
      t = v;
    },
    kv,
    library: new LibraryRepo(kv, new MemoryBlobStore(), now, mutex),
    annotations: new AnnotationRepo(kv, now, () => `a${start}_${++n}`, mutex),
    cards: new CardRepo(kv, now, mutex),
    engine: new SyncEngine(records, kv, server, now),
  };
}

const note = (text: string) => ({ docId: ieeeMl.id, blockId: 'b0010', start: 1, end: 5, quote: 'quote', color: 'yellow', page: 1, note: text });

describe('SyncEngine', () => {
  it('two devices converge on the same notes without either losing work', async () => {
    const server = new FakeSyncServer();
    const phone = device(1_000, server);
    const tablet = device(2_000, server);
    await phone.annotations.add(note('from phone'));
    await phone.engine.run(NS);
    await tablet.annotations.add(note('from tablet'));
    const report = await tablet.engine.run(NS);
    expect(report).toMatchObject({ pulled: 1, applied: 1, pushed: 1 });
    await phone.engine.run(NS);
    const texts = async (d: ReturnType<typeof device>) => (await d.annotations.list(ieeeMl.id)).map((a) => a.note).sort();
    expect(await texts(phone)).toEqual(['from phone', 'from tablet']);
    expect(await texts(tablet)).toEqual(['from phone', 'from tablet']);
  });

  it('does not push anything twice and does not echo what it just pulled', async () => {
    const server = new FakeSyncServer();
    const a = device(1_000, server);
    const b = device(2_000, server);
    await a.annotations.add(note('one'));
    expect((await a.engine.run(NS)).pushed).toBe(1);
    expect(await a.engine.run(NS)).toMatchObject({ pushed: 0, applied: 0 });
    const first = await b.engine.run(NS);
    expect(first).toMatchObject({ applied: 1, pushed: 0 });
    expect(server.pushes).toBe(1);
  });

  it('when both edit the same note, the later edit wins on both devices', async () => {
    const server = new FakeSyncServer();
    const a = device(1_000, server);
    const b = device(1_000, server);
    const made = await a.annotations.add(note('draft'));
    await a.engine.run(NS);
    await b.engine.run(NS);
    a.clock = 50_000;
    b.clock = 60_000;
    await a.annotations.update(ieeeMl.id, made.id, { note: 'edit on a' });
    await b.annotations.update(ieeeMl.id, made.id, { note: 'edit on b (later)' });
    await a.engine.run(NS);
    await b.engine.run(NS);
    await a.engine.run(NS);
    expect((await a.annotations.list(ieeeMl.id))[0].note).toBe('edit on b (later)');
    expect((await b.annotations.list(ieeeMl.id))[0].note).toBe('edit on b (later)');
  });

  it('carries deletions to the other device', async () => {
    const server = new FakeSyncServer();
    const a = device(1_000, server);
    const b = device(2_000, server);
    const made = await a.annotations.add(note('temporary'));
    await a.engine.run(NS);
    await b.engine.run(NS);
    expect(await b.annotations.list(ieeeMl.id)).toHaveLength(1);
    a.clock = 90_000;
    await a.annotations.remove(ieeeMl.id, made.id);
    await a.engine.run(NS);
    await b.engine.run(NS);
    expect(await b.annotations.list(ieeeMl.id)).toEqual([]);
    await a.engine.run(NS);
    expect(await a.annotations.list(ieeeMl.id)).toEqual([]);
  });

  it('syncs review cards and keeps their schedule', async () => {
    const server = new FakeSyncServer();
    const a = device(1_000, server);
    const b = device(2_000, server);
    await a.cards.add([{ docId: ieeeMl.id, kind: 'quiz', front: 'why?', back: 'because', blockIds: ['b1'], page: 2 }]);
    const [card] = await a.cards.list(ieeeMl.id);
    await a.cards.grade(ieeeMl.id, card.id, 'good');
    await a.engine.run(NS);
    await b.engine.run(NS);
    expect((await b.cards.list(ieeeMl.id))[0]).toMatchObject({ front: 'why?', reps: 1, interval: 1, page: 2 });
  });

  it('pages through large changes', async () => {
    const server = new FakeSyncServer();
    const a = device(1_000, server);
    const b = device(2_000, server);
    for (let i = 0; i < 450; i++) await a.annotations.add({ ...note(`n${i}`), start: i, end: i + 1 });
    expect((await a.engine.run(NS)).pushed).toBe(450);
    expect((await b.engine.run(NS)).pulled).toBe(450);
    expect(await b.annotations.list(ieeeMl.id)).toHaveLength(450);
  });

  it('a failed sync loses nothing and the next one finishes the job', async () => {
    const server = new FakeSyncServer();
    const a = device(1_000, server);
    await a.annotations.add(note('keep me'));
    server.failNext = true;
    await expect(a.engine.run(NS)).rejects.toThrow('network down');
    expect(await a.annotations.list(ieeeMl.id)).toHaveLength(1);
    expect((await a.engine.run(NS)).pushed).toBe(1);
    expect(server.rows.size).toBe(1);
  });

  it('remembers when it last synced and can start over', async () => {
    const server = new FakeSyncServer();
    const a = device(1_000, server);
    expect((await a.engine.meta(NS)).lastSyncAt).toBeNull();
    const { at } = await a.engine.run(NS);
    expect((await a.engine.meta(NS)).lastSyncAt).toBe(at);
    await a.engine.reset(NS);
    expect((await a.engine.meta(NS)).lastSyncAt).toBeNull();
  });

  it('ignores records from the server that do not look like ours', async () => {
    const server = new FakeSyncServer();
    server.rows.set('ann/doc/x', { key: 'ann/doc/x', updated_at: 5, deleted: false, data: { evil: true }, seq: 1 });
    server.seq = 1;
    const a = device(1_000, server);
    expect(await a.engine.run(NS)).toMatchObject({ pulled: 1, applied: 0 });
    expect(await a.annotations.listAll()).toEqual([]);
  });
});
