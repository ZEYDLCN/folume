import type { LibraryEntry } from '@/data/library';
import type { WantItem } from '@/data/userdata';

import { CATEGORY_SUGGESTIONS, feedToWant, isNew, newestPublished, shelfOf, type FeedPaper } from './feed';

const paper = (over: Partial<FeedPaper> = {}): FeedPaper => ({
  id: '2401.01234',
  version: 2,
  title: 'Sparse Routing for Efficient Transformers',
  authors: ['Quinn Rossi', 'Deniz Cohen'],
  summary: 'We study routing.',
  published: '2024-01-03T09:30:00Z',
  updated: '2024-01-05T10:00:00Z',
  primary_category: 'cs.LG',
  categories: ['cs.LG', 'stat.ML'],
  abs_url: 'https://arxiv.org/abs/2401.01234',
  pdf_url: 'https://arxiv.org/pdf/2401.01234',
  doi: null,
  comment: null,
  ...over,
});

describe('isNew', () => {
  it('is new when it came out after the newest paper the reader has looked at', () => {
    const seen = Date.parse('2024-01-03T09:30:00Z');
    expect(isNew(paper(), seen)).toBe(false);
    expect(isNew(paper({ published: '2024-01-03T09:30:01Z' }), seen)).toBe(true);
    expect(isNew(paper(), 0)).toBe(true);
  });
  it('a date nobody can read is not new', () => {
    expect(isNew(paper({ published: 'last week' }), 0)).toBe(false);
  });
});

describe('newestPublished', () => {
  it('is the latest publication time, or 0 for nothing', () => {
    expect(newestPublished([paper(), paper({ id: 'b', published: '2024-02-01T00:00:00Z' }), paper({ id: 'c', published: 'junk' })])).toBe(Date.parse('2024-02-01T00:00:00Z'));
    expect(newestPublished([])).toBe(0);
  });
});

describe('feedToWant', () => {
  it('keeps what arXiv said and nothing else', () => {
    expect(feedToWant(paper({ doi: '10.1000/xyz123', published: '2024-01-03T09:30:00Z' }))).toEqual({
      title: 'Sparse Routing for Efficient Transformers',
      authors: ['Quinn Rossi', 'Deniz Cohen'],
      year: 2024,
      doi: '10.1000/xyz123',
      arxivId: '2401.01234',
      url: 'https://arxiv.org/abs/2401.01234',
      source: 'feed',
    });
  });
  it('has no year when the date is unreadable', () => {
    expect(feedToWant(paper({ published: '' })).year).toBeNull();
  });
});

describe('shelfOf', () => {
  const entry = (over: Partial<LibraryEntry>): LibraryEntry =>
    ({ id: 'd1', title: 'Other', authors: [], doi: null, arxivId: null, ...over }) as LibraryEntry;
  const want = (over: Partial<WantItem>): WantItem =>
    ({ id: 'w1', title: 'Other', authors: [], year: null, doi: null, arxivId: null, url: null, note: '', source: 'manual', state: 'todo', addedAt: 1, updatedAt: 1, ...over }) as WantItem;

  it('says where a paper already is: the library first, then the reading list', () => {
    expect(shelfOf(paper(), [entry({ arxivId: '2401.01234v1' })], [])).toBe('library');
    expect(shelfOf(paper({ doi: '10.1000/XYZ' }), [entry({ doi: '10.1000/xyz' })], [])).toBe('library');
    expect(shelfOf(paper(), [], [want({ arxivId: '2401.01234' })])).toBe('want');
    expect(shelfOf(paper(), [entry({ arxivId: '2401.01234' })], [want({ arxivId: '2401.01234' })])).toBe('library');
    expect(shelfOf(paper(), [entry({})], [want({})])).toBeNull();
  });
  it('matches an old-style identifier too, whatever the version', () => {
    expect(shelfOf(paper({ id: 'hep-th/9901001' }), [entry({ arxivId: 'hep-th/9901001v2' })], [])).toBe('library');
  });
});

describe('CATEGORY_SUGGESTIONS', () => {
  it('are arXiv category codes the server accepts', () => {
    for (const [code] of CATEGORY_SUGGESTIONS) expect(code).toMatch(/^[A-Za-z][A-Za-z-]{0,19}(\.[A-Za-z-]{1,19})?$/);
    expect(CATEGORY_SUGGESTIONS.map(([c]) => c)).toEqual(expect.arrayContaining(['cs.LG', 'cs.CL', 'cs.CV']));
  });
});
