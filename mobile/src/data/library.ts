import type { Document } from '@/core/types';

import type { BlobStore } from './blobs';
import { KEY, type KeyValueStore } from './kv';

export interface LibraryEntry {
  id: string;
  title: string;
  authors: string[];
  filename: string;
  pageCount: number;
  addedAt: number;
  lastOpenedAt: number | null;
  grade: Document['quality']['grade'];
  score: number;
  /** 0..100 reading progress */
  percent: number;
  sizeBytes: number;
  year: number | null;
  doi: string | null;
  language: string | null;
  tags: string[];
  hasOriginalPdf: boolean;
}

export interface Bookmark {
  blockId: string;
  createdAt: number;
  label?: string;
}

export interface ReadingAnchor {
  blockId: string;
  /** 0..1 position inside the block */
  offset: number;
}

/** Per-paper reading state; everything here is small and synced as plain records later. */
export interface DocState {
  percent: number;
  anchor: ReadingAnchor | null;
  bookmarks: Bookmark[];
  mode: 'book' | 'original';
  updatedAt: number;
}

export const emptyState = (now: number): DocState => ({
  percent: 0,
  anchor: null,
  bookmarks: [],
  mode: 'book',
  updatedAt: now,
});

export const docPath = (id: string) => `docs/${id}`;

/**
 * Local-first library: a compact index in the key-value store, documents and images in the blob store.
 * Mutations are serialized so concurrent saves (progress ticks, imports) never lose each other.
 */
export class LibraryRepo {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly kv: KeyValueStore,
    private readonly blobs: BlobStore,
    private readonly now: () => number = Date.now,
  ) {}

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async list(): Promise<LibraryEntry[]> {
    const entries = (await this.kv.get<LibraryEntry[]>(KEY.library)) ?? [];
    return [...entries].sort((a, b) => (b.lastOpenedAt ?? b.addedAt) - (a.lastOpenedAt ?? a.addedAt));
  }

  async get(id: string): Promise<LibraryEntry | null> {
    return (await this.list()).find((e) => e.id === id) ?? null;
  }

  /** Stores the converted document; keeps reading state when the same paper is imported again. */
  addDocument(doc: Document, sizeBytes: number, hasOriginalPdf: boolean): Promise<LibraryEntry> {
    return this.serial(async () => {
      await this.blobs.put(`${docPath(doc.id)}/document.json`, JSON.stringify(doc));
      const entries = (await this.kv.get<LibraryEntry[]>(KEY.library)) ?? [];
      const previous = entries.find((e) => e.id === doc.id);
      const entry: LibraryEntry = {
        id: doc.id,
        title: doc.metadata.title?.trim() || doc.source.filename.replace(/\.pdf$/i, ''),
        authors: doc.metadata.authors,
        filename: doc.source.filename,
        pageCount: doc.pages.length,
        addedAt: previous?.addedAt ?? this.now(),
        lastOpenedAt: previous?.lastOpenedAt ?? null,
        grade: doc.quality.grade,
        score: doc.quality.score,
        percent: previous?.percent ?? 0,
        sizeBytes,
        year: doc.metadata.year,
        doi: doc.metadata.doi,
        language: doc.metadata.language,
        tags: previous?.tags ?? [],
        hasOriginalPdf,
      };
      await this.kv.set(KEY.library, [...entries.filter((e) => e.id !== doc.id), entry]);
      return entry;
    });
  }

  async loadDocument(id: string): Promise<Document | null> {
    const text = await this.blobs.getText(`${docPath(id)}/document.json`);
    return text ? (JSON.parse(text) as Document) : null;
  }

  asset(id: string, path: string): Promise<Uint8Array | null> {
    return this.blobs.get(`${docPath(id)}/${path}`);
  }

  async getState(id: string): Promise<DocState> {
    return (await this.kv.get<DocState>(KEY.docState(id))) ?? emptyState(this.now());
  }

  saveState(id: string, patch: Partial<DocState>): Promise<DocState> {
    return this.serial(async () => {
      const state = { ...(await this.getState(id)), ...patch, updatedAt: this.now() };
      await this.kv.set(KEY.docState(id), state);
      if (patch.percent !== undefined) await this.patchEntry(id, { percent: patch.percent });
      return state;
    });
  }

  markOpened(id: string): Promise<void> {
    return this.serial(() => this.patchEntry(id, { lastOpenedAt: this.now() }));
  }

  setTags(id: string, tags: string[]): Promise<void> {
    return this.serial(() => this.patchEntry(id, { tags }));
  }

  private async patchEntry(id: string, patch: Partial<LibraryEntry>): Promise<void> {
    const entries = (await this.kv.get<LibraryEntry[]>(KEY.library)) ?? [];
    await this.kv.set(
      KEY.library,
      entries.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    );
  }

  /** Deletes the paper, its images and every record that belongs to it. */
  remove(id: string): Promise<void> {
    return this.serial(async () => {
      await this.blobs.removePrefix(docPath(id));
      for (const key of await this.kv.keys(KEY.docPrefix(id))) await this.kv.remove(key);
      const entries = (await this.kv.get<LibraryEntry[]>(KEY.library)) ?? [];
      await this.kv.set(
        KEY.library,
        entries.filter((e) => e.id !== id),
      );
    });
  }
}
