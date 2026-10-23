import { indexDocument } from '@/core/docModel';
import { extractConcepts, type Concept } from '@/core/knowledge/concepts';
import { relatedPapers, type Connection, type PaperConcepts } from '@/core/knowledge/connections';
import { LibrarySearch, type FoundPassage, type SearchResult } from '@/core/knowledge/search';
import type { LibraryEntry, LibraryRepo } from '@/data/library';

/** Computed views over the library (search index, concepts, connections); built on demand and kept in memory. */
export class KnowledgeService {
  private searchCache: { signature: string; search: LibrarySearch } | null = null;
  private concepts = new Map<string, Concept[]>();

  constructor(private readonly library: () => LibraryRepo) {}

  private signature(entries: LibraryEntry[]): string {
    return entries.map((e) => `${e.id}:${e.addedAt}`).sort().join('|');
  }

  /** Titles, authors and tags: instant, no documents have to be loaded. */
  async papersMatching(query: string): Promise<LibraryEntry[]> {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const words = q.split(/\s+/);
    return (await this.library().list()).filter((e) => {
      const hay = `${e.title} ${e.authors.join(' ')} ${e.tags.join(' ')} ${e.year ?? ''}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }

  private async searcher(): Promise<LibrarySearch> {
    const entries = await this.library().list();
    const signature = this.signature(entries);
    if (this.searchCache?.signature !== signature) {
      const docs = (await Promise.all(entries.map((e) => this.library().loadDocument(e.id)))).filter((d) => d !== null);
      this.searchCache = { signature, search: new LibrarySearch(docs) };
    }
    return this.searchCache.search;
  }

  async search(query: string, opts: { limit?: number; docId?: string } = {}): Promise<SearchResult[]> {
    return (await this.searcher()).search(query, opts);
  }

  /** Whole blocks across the library that best answer a question; the grounding of "ask your library". */
  async passages(query: string, opts: { limit?: number; perPaper?: number; docIds?: string[] } = {}): Promise<FoundPassage[]> {
    return (await this.searcher()).passages(query, opts);
  }

  async conceptsOf(docId: string): Promise<Concept[]> {
    const cached = this.concepts.get(docId);
    if (cached) return cached;
    const doc = await this.library().loadDocument(docId);
    const list = doc ? extractConcepts(indexDocument(doc)) : [];
    this.concepts.set(docId, list);
    return list;
  }

  async papers(): Promise<PaperConcepts[]> {
    const entries = await this.library().list();
    return Promise.all(entries.map(async (e) => ({ docId: e.id, title: e.title, concepts: await this.conceptsOf(e.id) })));
  }

  async related(docId: string): Promise<Connection[]> {
    return relatedPapers(docId, await this.papers());
  }

  /** Forget cached results for a paper that was removed or re-imported. */
  forget(docId?: string): void {
    if (docId) this.concepts.delete(docId);
    else this.concepts.clear();
    this.searchCache = null;
  }
}
