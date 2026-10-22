import { parseRecordKey, validRecordData } from '@/core/sync/records';

import { createBackup, restoreBackup } from './backup';
import { MemoryBlobStore } from './blobs';
import { MemoryKV } from './kv';
import { LibraryRepo } from './library';
import { Mutex } from './mutex';
import { RecordStore } from './records';
import { FixRepo, InkRepo, ProjectRepo, sameWanted, WantRepo, cellKey } from './userdata';

function device(start: number) {
  let t = start;
  const now = () => ++t;
  const kv = new MemoryKV();
  const mutex = new Mutex();
  let n = 0;
  return {
    kv,
    now,
    fixes: new FixRepo(kv, now, mutex),
    ink: new InkRepo(kv, now, mutex),
    projects: new ProjectRepo(kv, now, mutex, () => `p${start}x${++n}`),
    want: new WantRepo(kv, now, mutex, () => `w${start}x${++n}`),
    records: new RecordStore(kv, mutex),
    library: new LibraryRepo(kv, new MemoryBlobStore(), now, mutex),
  };
}

describe('record keys of the new kinds', () => {
  it('knows paper-scoped and reader-scoped records', () => {
    expect(parseRecordKey('fix/abc123/b0010')).toEqual({ kind: 'fix', docId: 'abc123', id: 'b0010' });
    expect(parseRecordKey('ink/abc123/3')).toEqual({ kind: 'ink', docId: 'abc123', id: '3' });
    expect(parseRecordKey('proj/p1')).toEqual({ kind: 'proj', docId: null, id: 'p1' });
    expect(parseRecordKey('want/w1')).toEqual({ kind: 'want', docId: null, id: 'w1' });
    expect(parseRecordKey('fix/abc123')).toBeNull();
    expect(parseRecordKey('proj/p1/extra')).toBeNull();
    expect(parseRecordKey('proj/../x')).toBeNull();
  });

  it('checks the shape of what arrives from another device or a file', () => {
    expect(validRecordData('fix', { id: 'b1', docId: 'd', text: 'x', type: null, hidden: false, mergePrev: false, updatedAt: 1 })).toBe(true);
    expect(validRecordData('fix', { id: 'b1', docId: 'd', text: 5, type: null, hidden: false, mergePrev: false, updatedAt: 1 })).toBe(false);
    expect(validRecordData('ink', { id: '1', docId: 'd', page: 1, updatedAt: 1, strokes: [{ c: '#000', w: 0.01, p: [[0, 0]] }] })).toBe(true);
    expect(validRecordData('ink', { id: '1', docId: 'd', page: 1, updatedAt: 1, strokes: [{ c: '#000' }] })).toBe(false);
    expect(validRecordData('proj', { id: 'p', name: 'n', updatedAt: 1, paperIds: ['a'], columns: [], cells: {} })).toBe(true);
    expect(validRecordData('proj', { id: 'p', name: 'n', updatedAt: 1, paperIds: [1], columns: [], cells: {} })).toBe(false);
    expect(validRecordData('want', { id: 'w', title: 't', updatedAt: 1, state: 'todo' })).toBe(true);
    expect(validRecordData('want', { id: 'w', title: 't', updatedAt: 1, state: 'maybe' })).toBe(false);
  });
});

describe('FixRepo', () => {
  it('keeps corrections per paper and drops one that changes nothing', async () => {
    const d = device(1000);
    await d.fixes.set('doc1', 'b1', { text: 'better text' });
    await d.fixes.set('doc1', 'b2', { hidden: true });
    expect((await d.fixes.list('doc1')).map((f) => f.id).sort()).toEqual(['b1', 'b2']);
    expect(await d.fixes.list('doc2')).toEqual([]);
    expect(await d.fixes.set('doc1', 'b2', { hidden: false })).toBeNull(); // nothing left to correct
    expect((await d.fixes.list('doc1')).map((f) => f.id)).toEqual(['b1']);
  });

  it('merges a later change into the earlier one', async () => {
    const d = device(1000);
    await d.fixes.set('doc1', 'b1', { text: 'a' });
    const f = await d.fixes.set('doc1', 'b1', { type: 'heading' });
    expect(f).toMatchObject({ text: 'a', type: 'heading', hidden: false });
  });
});

describe('InkRepo', () => {
  it('replaces the strokes of a page and removes the record when the page is cleared', async () => {
    const d = device(1000);
    const stroke = { c: '#c2512f', w: 0.004, p: [[0.1, 0.1], [0.2, 0.2]] as [number, number][] };
    await d.ink.setPage('doc1', 2, [stroke]);
    await d.ink.setPage('doc1', 2, [stroke, stroke]);
    expect((await d.ink.list('doc1'))[0].strokes).toHaveLength(2);
    await d.ink.setPage('doc1', 2, []);
    expect(await d.ink.list('doc1')).toEqual([]);
  });
});

describe('ProjectRepo', () => {
  it('creates a project with the default questions and edits it as one unit', async () => {
    const d = device(1000);
    const p = await d.projects.create('  Thesis  ');
    expect(p.name).toBe('Thesis');
    expect(p.columns.map((c) => c.name)).toEqual(['Problem', 'Method', 'Data', 'Results', 'Limitations']);
    const edited = await d.projects.edit(p.id, (x) => ({ ...x, paperIds: ['d1', 'd2'], cells: { [cellKey('d1', 'c1')]: 'Routing is slow' } }));
    expect(edited?.paperIds).toEqual(['d1', 'd2']);
    expect(edited!.updatedAt).toBeGreaterThan(p.updatedAt);
    expect(await d.projects.edit('missing', (x) => x)).toBeNull();
    expect((await d.projects.list())[0].cells['d1|c1']).toBe('Routing is slow');
  });
});

describe('WantRepo', () => {
  it('adds a paper once however it arrives', async () => {
    const d = device(1000);
    expect(await d.want.add([{ title: 'Attention Is All You Need', doi: '10.1000/ABC' }, { title: 'Same paper again', doi: '10.1000/abc' }, { title: 'No identifiers but a long title', authors: [] }])).toEqual({ added: 2, skipped: 1 });
    expect(await d.want.add([{ title: 'no identifiers but a LONG title!' }])).toEqual({ added: 0, skipped: 1 });
    expect(await d.want.add([{ title: 'x', arxivId: '2401.01234v2' }, { title: 'y', arxivId: '2401.01234' }])).toEqual({ added: 1, skipped: 1 });
    expect(sameWanted({ doi: null, arxivId: null, url: 'https://a.org/x', title: 'a' }, { doi: null, arxivId: null, url: 'https://A.org/x', title: 'b' })).toBe(true);
  });

  it('lists what is still to read first, and remembers what is done', async () => {
    const d = device(1000);
    await d.want.add([{ title: 'first paper to read', doi: '10.1/a' }, { title: 'second paper to read', doi: '10.1/b' }]);
    const [a] = await d.want.list();
    await d.want.setState(a.id, 'done');
    const after = await d.want.list();
    expect(after[after.length - 1].id).toBe(a.id);
    expect(after[after.length - 1].state).toBe('done');
  });
});

describe('synced like everything else the reader owns', () => {
  async function filled() {
    const a = device(1000);
    await a.fixes.set('doc1', 'b1', { text: 'fixed' });
    await a.ink.setPage('doc1', 1, [{ c: '#000', w: 0.004, p: [[0.1, 0.2]] }]);
    const p = await a.projects.create('Review');
    await a.projects.edit(p.id, (x) => ({ ...x, paperIds: ['doc1'], cells: { [cellKey('doc1', 'c1')]: 'note' } }));
    await a.want.add([{ title: 'a paper to read later', doi: '10.1/z' }]);
    return a;
  }

  it('collects and applies all four kinds on another device', async () => {
    const a = await filled();
    const b = device(5000);
    const records = await a.records.collect();
    expect(records.map((r) => r.key.split('/')[0]).sort()).toEqual(['fix', 'ink', 'proj', 'want']);
    expect(await b.records.apply(records)).toMatchObject({ applied: 4, invalid: 0 });
    expect(await b.fixes.list('doc1')).toEqual(await a.fixes.list('doc1'));
    expect(await b.ink.list('doc1')).toEqual(await a.ink.list('doc1'));
    expect(await b.projects.list()).toEqual(await a.projects.list());
    expect(await b.want.list()).toEqual(await a.want.list());
    // applying the same records again changes nothing
    expect(await b.records.apply(records)).toMatchObject({ applied: 0, skipped: 4 });
  });

  it('the device that edited a project last keeps its version, and a deletion travels', async () => {
    const a = await filled();
    const b = device(5000);
    await b.records.apply(await a.records.collect());
    const id = (await a.projects.list())[0].id;
    await a.projects.edit(id, (x) => ({ ...x, name: 'Older edit' }));
    await b.projects.edit(id, (x) => ({ ...x, name: 'Newer edit' }));
    await b.records.apply(await a.records.collect()); // a's older edit must not win
    expect((await b.projects.list())[0].name).toBe('Newer edit');
    await a.records.apply(await b.records.collect());
    expect((await a.projects.list())[0].name).toBe('Newer edit');
    await b.want.remove((await b.want.list())[0].id);
    await a.records.apply(await b.records.collect());
    expect(await a.want.list()).toEqual([]);
  });

  it('is part of a backup, and papers are listed only for what belongs to a paper', async () => {
    const a = await filled();
    const text = await createBackup(a.records, a.library);
    expect(JSON.parse(text).records).toHaveLength(4);
    const b = device(9000);
    expect(await restoreBackup(b.records, text)).toMatchObject({ ok: true, applied: 4 });
    expect((await b.projects.list())[0].name).toBe('Review');
  });
});
