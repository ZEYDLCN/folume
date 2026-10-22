/** Following new papers: what the server's arXiv feed returns, and how it meets the library and the reading list. */
import type { LibraryEntry } from '@/data/library';
import type { WantItem } from '@/data/userdata';

export interface FeedPaper {
  /** arXiv id without the version */
  id: string;
  version: number | null;
  title: string;
  authors: string[];
  summary: string;
  published: string;
  updated: string;
  primary_category: string | null;
  categories: string[];
  abs_url: string;
  pdf_url: string;
  doi: string | null;
  comment: string | null;
}

export interface FeedResponse {
  source: 'arxiv';
  items: FeedPaper[];
  cached: boolean;
  stale: boolean;
}

const time = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
};

/** Newer than the newest paper the reader has looked at. */
export const isNew = (p: FeedPaper, seenUpTo: number): boolean => time(p.published) > seenUpTo;

export const newestPublished = (papers: FeedPaper[]): number => papers.reduce((m, p) => Math.max(m, time(p.published)), 0);

/** A paper for the reading list, with only what arXiv said. */
export function feedToWant(p: FeedPaper): Partial<WantItem> & { title: string } {
  const t = time(p.published);
  return {
    title: p.title,
    authors: p.authors,
    year: t ? new Date(t).getUTCFullYear() : null,
    doi: p.doi,
    arxivId: p.id,
    url: p.abs_url,
    source: 'feed',
  };
}

const bare = (id: string | null | undefined) => (id ?? '').toLowerCase().replace(/v\d+$/, '');

/** Where a paper already is, so it is not offered twice: the library, the reading list, or nowhere. */
export function shelfOf(p: FeedPaper, library: LibraryEntry[], want: WantItem[]): 'library' | 'want' | null {
  const doi = (p.doi ?? '').toLowerCase();
  const same = (x: { arxivId?: string | null; doi: string | null }) => bare(x.arxivId) === bare(p.id) || (!!doi && (x.doi ?? '').toLowerCase() === doi);
  if (library.some((e) => same({ arxivId: e.arxivId, doi: e.doi }))) return 'library';
  if (want.some((w) => same(w))) return 'want';
  return null;
}

/** Categories to start from: code and what it covers. Any arXiv category can be typed. */
export const CATEGORY_SUGGESTIONS: [string, string][] = [
  ['cs.LG', 'Machine learning'],
  ['cs.CL', 'Computation and language'],
  ['cs.CV', 'Computer vision'],
  ['cs.AI', 'Artificial intelligence'],
  ['stat.ML', 'Statistics: machine learning'],
  ['cs.RO', 'Robotics'],
  ['cs.CR', 'Cryptography and security'],
  ['q-bio.NC', 'Neurons and cognition'],
  ['physics.comp-ph', 'Computational physics'],
  ['econ.GN', 'General economics'],
];
