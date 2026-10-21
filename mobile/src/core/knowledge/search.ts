import type { Document } from '@/core/types';
import { Bm25Index } from '@/core/retrieval/bm25';
import { stem } from '@/core/retrieval/tokenize';

const SEARCHABLE = new Set(['paragraph', 'list_item', 'heading', 'caption', 'footnote', 'title', 'authors', 'code']);

export interface SearchResult {
  docId: string;
  blockId: string;
  page: number;
  title: string;
  /** nearest heading, to tell where in the paper the hit is */
  section: string | null;
  snippet: string;
  /** [start, end) ranges inside `snippet` that matched the query */
  ranges: [number, number][];
  score: number;
}

interface Entry {
  docId: string;
  blockId: string;
  page: number;
  text: string;
  section: string | null;
  kind: string;
}

/** Full-text search over every paper on the device (blocks are the unit; hits point back at the block and page). */
export class LibrarySearch {
  private readonly index: Bm25Index;
  private readonly entries = new Map<string, Entry>();
  private readonly titles = new Map<string, string>();

  constructor(docs: Document[]) {
    const items: { id: string; text: string }[] = [];
    for (const doc of docs) {
      this.titles.set(doc.id, doc.metadata.title?.trim() || doc.source.filename.replace(/\.pdf$/i, ''));
      let section: string | null = null;
      for (const b of doc.blocks) {
        if (b.type === 'heading') section = b.text.trim();
        if (!SEARCHABLE.has(b.type) || !b.text.trim()) continue;
        const id = `${doc.id}:${b.id}`;
        this.entries.set(id, { docId: doc.id, blockId: b.id, page: b.source[0].page, text: b.text, section, kind: b.type });
        items.push({ id, text: b.text });
      }
    }
    this.index = new Bm25Index(items);
  }

  get size(): number {
    return this.entries.size;
  }

  search(query: string, opts: { limit?: number; docId?: string } = {}): SearchResult[] {
    const q = query.trim();
    if (q.length < 2) return [];
    const boost = (id: string) => {
      const e = this.entries.get(id);
      return e?.kind === 'heading' || e?.kind === 'title' ? 1.4 : 1;
    };
    const hits = this.index.search(q, (opts.limit ?? 30) * (opts.docId ? 50 : 1), boost);
    const out: SearchResult[] = [];
    for (const h of hits) {
      const e = this.entries.get(h.id);
      if (!e || (opts.docId && e.docId !== opts.docId)) continue;
      const { snippet, ranges } = makeSnippet(e.text, q);
      out.push({ docId: e.docId, blockId: e.blockId, page: e.page, title: this.titles.get(e.docId) ?? '', section: e.section, snippet, ranges, score: h.score });
      if (out.length >= (opts.limit ?? 30)) break;
    }
    return out;
  }
}

const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}\-']*/gu) ?? [];

/** A window around the first match, with the matched word ranges, so the list can show why a block was found. */
export function makeSnippet(text: string, query: string, width = 170): { snippet: string; ranges: [number, number][] } {
  const wanted = new Set(words(query).map(stem));
  const found: [number, number][] = [];
  for (const m of text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}\-']*/gu)) {
    const w = m[0].toLowerCase().replace(/^[-']+|[-']+$/g, '');
    if (wanted.has(stem(w))) found.push([m.index, m.index + m[0].length]);
  }
  if (!found.length) return { snippet: text.slice(0, width) + (text.length > width ? '…' : ''), ranges: [] };
  const first = found[0][0];
  let start = Math.max(0, first - Math.floor(width / 3));
  if (start > 0) {
    const space = text.indexOf(' ', start);
    if (space > -1 && space < first) start = space + 1;
  }
  const end = Math.min(text.length, start + width);
  const prefix = start > 0 ? '…' : '';
  const snippet = prefix + text.slice(start, end) + (end < text.length ? '…' : '');
  const ranges = found
    .filter(([s, e]) => s >= start && e <= end)
    .map(([s, e]) => [s - start + prefix.length, e - start + prefix.length] as [number, number]);
  return { snippet, ranges };
}
