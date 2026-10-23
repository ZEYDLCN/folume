import type { Annotation } from '@/data/annotations';
import { clone, ieeeMl } from '@/testing/fixtures';

import { buildNotesShare, parseNotesShare, planNotesImport } from './shareNotes';

const rendered = (b: { spans: { text: string }[]; text: string }) => (b.spans.length ? b.spans.map((s) => s.text).join('') : b.text);
const block = ieeeMl.blocks.find((b) => b.type === 'paragraph' && b.text.length > 120)!;
const quote = rendered(block).slice(10, 40);
const ann = (over: Partial<Annotation> = {}): Annotation => ({
  id: 'a1', docId: ieeeMl.id, blockId: block.id, start: 10, end: 40, quote, color: 'yellow', note: 'check this', origin: 'user', tags: [], page: block.source[0].page, createdAt: 1, updatedAt: 2, ...over,
});

describe('buildNotesShare / parseNotesShare', () => {
  it('writes the reader\'s own notes and says whose they are, without AI text or ids', () => {
    const text = buildNotesShare({ docId: ieeeMl.id, title: 'T', doi: null }, [ann(), ann({ id: 'a2', origin: 'ai', note: 'model said' }), ann({ id: 'a3', origin: 'shared', author: 'Bea' })], 'Ada', 1000);
    const parsed = parseNotesShare(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.share.author).toBe('Ada');
    expect(parsed.share.paper.id).toBe(ieeeMl.id);
    expect(parsed.share.annotations).toHaveLength(1); // not the AI note, not what someone else shared
    expect(parsed.share.annotations[0]).toEqual({ blockId: block.id, start: 10, end: 40, quote, color: 'yellow', note: 'check this', page: block.source[0].page });
    expect(text).not.toContain('"id": "a1"');
  });

  it('rejects what is not a notes file', () => {
    expect(parseNotesShare('not json')).toEqual({ ok: false, error: 'not_json' });
    expect(parseNotesShare('{"format":"other"}')).toEqual({ ok: false, error: 'wrong_format' });
    expect(parseNotesShare(JSON.stringify({ format: 'folume-notes', version: 99, paper: { id: 'x' }, annotations: [] }))).toEqual({ ok: false, error: 'newer_version' });
  });

  it('drops entries of the wrong shape and limits what a file can bring', () => {
    const good = { blockId: 'b1', start: 0, end: 3, quote: 'abc', color: 'red', note: '', page: 1 };
    const text = JSON.stringify({ format: 'folume-notes', version: 1, author: 'x'.repeat(500), paper: { id: 'd', title: 't', doi: null }, annotations: [good, { ...good, start: 'a' }, { ...good, note: 'n'.repeat(50000) }, null, 5] });
    const r = parseNotesShare(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.share.annotations).toHaveLength(2);
    expect(r.share.annotations[1].note.length).toBeLessThanOrEqual(4000);
    expect(r.share.author.length).toBeLessThanOrEqual(80);
  });
});

describe('planNotesImport', () => {
  const share = (annotations: object[], id = ieeeMl.id) =>
    ({ format: 'folume-notes', version: 1, createdAt: 1, author: 'Bea', paper: { id, title: 'T', doi: null }, annotations }) as never;
  const entry = { blockId: block.id, start: 10, end: 40, quote, color: 'yellow', note: 'from Bea', page: block.source[0].page };

  it('adds each note as Bea\'s, once, and skips what is already here', () => {
    const plan = planNotesImport(ieeeMl, share([entry]), []);
    expect(plan.error).toBeUndefined();
    expect(plan.add).toEqual([expect.objectContaining({ docId: ieeeMl.id, blockId: block.id, start: 10, end: 40, origin: 'shared', author: 'Bea', note: 'from Bea' })]);
    const again = planNotesImport(ieeeMl, share([entry]), [ann({ origin: 'shared', author: 'Bea', note: 'from Bea' })]);
    expect(again.add).toHaveLength(0);
    expect(again.skipped).toBe(1);
  });

  it('only fits notes of the same paper', () => {
    expect(planNotesImport(ieeeMl, share([entry], 'other-doc'), []).error).toBe('other_paper');
  });

  it('finds the quote again when the offsets no longer match, and keeps it as a note on the block when it cannot', () => {
    const moved = planNotesImport(ieeeMl, share([{ ...entry, start: 0, end: 30 }]), []);
    expect(moved.add[0].start).toBe(10);
    expect(moved.add[0].end).toBe(40);
    const lost = planNotesImport(ieeeMl, share([{ ...entry, quote: 'text that is nowhere in this block' }]), []);
    expect(lost.add[0].start).toBe(lost.add[0].end);
    expect(lost.relocated).toBe(1);
  });

  it('skips notes for blocks the paper does not have', () => {
    const plan = planNotesImport(clone(ieeeMl), share([{ ...entry, blockId: 'zzz' }]), []);
    expect(plan.add).toHaveLength(0);
    expect(plan.skipped).toBe(1);
  });
});
