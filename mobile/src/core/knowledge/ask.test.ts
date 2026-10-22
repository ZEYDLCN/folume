import { toApiPassages } from '@/ai/requests';

import { askPassages, joinBlockRef, splitBlockRef } from './ask';
import type { FoundPassage } from './search';

const found = (n: number, over: Partial<FoundPassage> = {}): FoundPassage => ({
  docId: `doc${n}`,
  blockId: `b${n}`,
  page: n,
  title: `Paper ${n}`,
  section: 'METHOD',
  kind: 'paragraph',
  text: `Passage number ${n} says something that is long enough to matter.`,
  score: 10 - n,
  ...over,
});

describe('askPassages', () => {
  it('numbers passages p1, p2… as the gateway expects and keeps the text exactly', () => {
    const out = askPassages([found(1), found(2)]);
    expect(out.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(out[1].text).toBe(found(2).text);
    expect(out.every((p) => p.kind === 'retrieved')).toBe(true);
    expect(toApiPassages(out).every((p) => /^p\d{1,3}$/.test(p.id))).toBe(true);
  });

  it('remembers which paper and block each came from, so an answer can link back', () => {
    const [p] = askPassages([found(3)]);
    expect(splitBlockRef(p.blockId)).toEqual({ docId: 'doc3', blockId: 'b3' });
    expect(p.page).toBe(3);
    expect(p.label).toBe('Paper 3, p. 3');
  });

  it('keeps a label within what the gateway accepts', () => {
    const [p] = askPassages([found(1, { title: 'A'.repeat(300) })]);
    expect(p.label.length).toBeLessThanOrEqual(120);
    expect(p.label.endsWith('p. 1')).toBe(true);
  });

  it('stops at the character budget and at the gateway’s passage limit', () => {
    const many = Array.from({ length: 30 }, (_, i) => found(i + 1));
    expect(askPassages(many)).toHaveLength(14);
    const budgeted = askPassages(many, { budgetChars: 150 });
    expect(budgeted.length).toBeGreaterThanOrEqual(1);
    expect(budgeted.reduce((n, p) => n + p.text.length, 0)).toBeLessThanOrEqual(150 + 70);
  });

  it('cuts a very long block at a word, within the limit, and says so with an ellipsis', () => {
    const long = Array.from({ length: 600 }, (_, i) => `word${i}`).join(' ');
    const [p] = askPassages([found(1, { text: long })]);
    expect(p.text.length).toBeLessThanOrEqual(1200);
    expect(p.text.endsWith('…')).toBe(true);
    expect(long.startsWith(p.text.slice(0, -1))).toBe(true);
    expect(/\bword\d+$/.test(p.text.slice(0, -1))).toBe(true);
  });

  it('collapses white space but not words', () => {
    const [p] = askPassages([found(1, { text: 'one   two\n\nthree   four five six seven eight nine ten eleven twelve' })]);
    expect(p.text).toBe('one two three four five six seven eight nine ten eleven twelve');
  });

  it('gives nothing when nothing was found', () => {
    expect(askPassages([])).toEqual([]);
  });
});

describe('block references', () => {
  it('joins and splits a paper id and a block id', () => {
    expect(splitBlockRef(joinBlockRef('abc123', 'b7'))).toEqual({ docId: 'abc123', blockId: 'b7' });
  });
  it('a bare block id has no paper', () => {
    expect(splitBlockRef('b7')).toEqual({ docId: null, blockId: 'b7' });
  });
});
