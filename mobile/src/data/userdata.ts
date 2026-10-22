import type { Block } from '@/core/types';

import type { KeyValueStore } from './kv';
import { KEY } from './kv';
import { Mutex, sharedMutex } from './mutex';
import { markDeleted } from './tombstones';

// -------------------------------------------------------------------------------------------------- corrections

/** A correction the reader made to what the converter produced for one block. The PDF-side data is never touched. */
export interface BlockFix {
  /** the block's id */
  id: string;
  docId: string;
  /** replacement text (plain: formatting of the block is dropped), or null to keep the converter's */
  text: string | null;
  /** another block type, or null to keep it */
  type: Block['type'] | null;
  /** do not show this block */
  hidden: boolean;
  /** show this block's text as the end of the block before it */
  mergePrev: boolean;
  updatedAt: number;
}

export const fixKey = (docId: string) => `${KEY.docPrefix(docId)}fix`;
export const fixRecordKey = (docId: string, id: string) => `fix/${docId}/${id}`;

// ---------------------------------------------------------------------------------------------------- ink notes

export interface Stroke {
  /** colour */
  c: string;
  /** width as a fraction of the page width */
  w: number;
  /** points as fractions of the page width and height */
  p: [number, number][];
}

/** Hand-drawn notes on one page of the original. */
export interface InkPage {
  id: string;
  docId: string;
  page: number;
  strokes: Stroke[];
  updatedAt: number;
}

export const inkKey = (docId: string) => `${KEY.docPrefix(docId)}ink`;
export const inkRecordKey = (docId: string, page: number) => `ink/${docId}/${page}`;

// ---------------------------------------------------------------------------------------------------- projects

export interface MatrixColumn {
  id: string;
  name: string;
}

/** A group of papers read for one purpose, with a literature table (papers down, questions across). */
export interface Project {
  id: string;
  name: string;
  note: string;
  paperIds: string[];
  columns: MatrixColumn[];
  /** `${docId}|${columnId}` -> what the reader wrote */
  cells: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

export const DEFAULT_COLUMNS = ['Problem', 'Method', 'Data', 'Results', 'Limitations'];
export const PROJECTS_KEY = 'folume:v1:projects';
export const projRecordKey = (id: string) => `proj/${id}`;
export const cellKey = (docId: string, columnId: string) => `${docId}|${columnId}`;

// ----------------------------------------------------------------------------------------------- reading list

/** A paper the reader wants to read: from a bibliography file, a feed or a reference list. */
export interface WantItem {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  doi: string | null;
  arxivId: string | null;
  url: string | null;
  note: string;
  source: 'bib' | 'feed' | 'ref' | 'manual';
  state: 'todo' | 'done';
  addedAt: number;
  updatedAt: number;
}

export const WANT_KEY = 'folume:v1:want';
export const wantRecordKey = (id: string) => `want/${id}`;

const norm = (s: string | null) => (s ?? '').trim().toLowerCase();

/** The same paper arrives from several places; these identify it. */
export function sameWanted(a: Pick<WantItem, 'doi' | 'arxivId' | 'url' | 'title'>, b: Pick<WantItem, 'doi' | 'arxivId' | 'url' | 'title'>): boolean {
  if (a.doi && b.doi) return norm(a.doi) === norm(b.doi);
  if (a.arxivId && b.arxivId) return norm(a.arxivId).replace(/v\d+$/, '') === norm(b.arxivId).replace(/v\d+$/, '');
  if (a.url && b.url) return norm(a.url) === norm(b.url);
  const key = (t: string) => norm(t).replace(/\W+/g, ' ').trim();
  return key(a.title) === key(b.title) && key(a.title).length > 8;
}

// -------------------------------------------------------------------------------------------------- repositories

abstract class ListRepo<T extends { id: string; updatedAt: number }> {
  constructor(
    protected readonly kv: KeyValueStore,
    protected readonly now: () => number,
    protected readonly mutex: Mutex,
  ) {}
  protected serial<R>(work: () => Promise<R>): Promise<R> {
    return this.mutex.run(work);
  }
  protected async read(key: string): Promise<T[]> {
    return (await this.kv.get<T[]>(key)) ?? [];
  }
  protected async writeItem(key: string, item: T): Promise<void> {
    const list = (await this.read(key)).filter((x) => x.id !== item.id);
    await this.kv.set(key, [...list, item]);
  }
  protected async removeItem(key: string, id: string, recordKey: string): Promise<void> {
    await this.kv.set(key, (await this.read(key)).filter((x) => x.id !== id));
    await markDeleted(this.kv, recordKey, this.now());
  }
}

export class FixRepo extends ListRepo<BlockFix> {
  constructor(kv: KeyValueStore, now: () => number = Date.now, mutex: Mutex = sharedMutex) {
    super(kv, now, mutex);
  }
  list(docId: string): Promise<BlockFix[]> {
    return this.read(fixKey(docId));
  }
  /** Saves a correction; a correction that changes nothing is removed instead. */
  set(docId: string, blockId: string, patch: Partial<Pick<BlockFix, 'text' | 'type' | 'hidden' | 'mergePrev'>>): Promise<BlockFix | null> {
    return this.serial(async () => {
      const old = (await this.read(fixKey(docId))).find((f) => f.id === blockId);
      const next: BlockFix = { id: blockId, docId, text: null, type: null, hidden: false, mergePrev: false, ...(old ?? {}), ...patch, updatedAt: this.now() };
      if (next.text === null && next.type === null && !next.hidden && !next.mergePrev) {
        if (old) await this.removeItem(fixKey(docId), blockId, fixRecordKey(docId, blockId));
        return null;
      }
      await this.writeItem(fixKey(docId), next);
      return next;
    });
  }
  remove(docId: string, blockId: string): Promise<void> {
    return this.serial(() => this.removeItem(fixKey(docId), blockId, fixRecordKey(docId, blockId)));
  }
}

export class InkRepo extends ListRepo<InkPage> {
  constructor(kv: KeyValueStore, now: () => number = Date.now, mutex: Mutex = sharedMutex) {
    super(kv, now, mutex);
  }
  list(docId: string): Promise<InkPage[]> {
    return this.read(inkKey(docId));
  }
  /** Replaces the strokes of a page; no strokes removes the page's record. */
  setPage(docId: string, page: number, strokes: Stroke[]): Promise<void> {
    return this.serial(async () => {
      if (!strokes.length) return this.removeItem(inkKey(docId), String(page), inkRecordKey(docId, page));
      await this.writeItem(inkKey(docId), { id: String(page), docId, page, strokes, updatedAt: this.now() });
    });
  }
}

export class ProjectRepo extends ListRepo<Project> {
  constructor(kv: KeyValueStore, now: () => number = Date.now, mutex: Mutex = sharedMutex, private readonly newId: () => string = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`) {
    super(kv, now, mutex);
  }
  async list(): Promise<Project[]> {
    return (await this.read(PROJECTS_KEY)).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  get(id: string): Promise<Project | null> {
    return this.read(PROJECTS_KEY).then((l) => l.find((p) => p.id === id) ?? null);
  }
  create(name: string, columns: string[] = DEFAULT_COLUMNS): Promise<Project> {
    return this.serial(async () => {
      const t = this.now();
      const p: Project = {
        id: this.newId(), name: name.trim() || 'Untitled', note: '', paperIds: [],
        columns: columns.map((c, i) => ({ id: `c${i + 1}`, name: c })), cells: {}, createdAt: t, updatedAt: t,
      };
      await this.writeItem(PROJECTS_KEY, p);
      return p;
    });
  }
  /** Applies `change` to a project and saves it; the one place a project is edited, so the timestamp is always right. */
  edit(id: string, change: (p: Project) => Project): Promise<Project | null> {
    return this.serial(async () => {
      const old = (await this.read(PROJECTS_KEY)).find((p) => p.id === id);
      if (!old) return null;
      const next = { ...change(structuredClone(old)), id, updatedAt: this.now() };
      await this.writeItem(PROJECTS_KEY, next);
      return next;
    });
  }
  remove(id: string): Promise<void> {
    return this.serial(() => this.removeItem(PROJECTS_KEY, id, projRecordKey(id)));
  }
}

export class WantRepo extends ListRepo<WantItem> {
  constructor(kv: KeyValueStore, now: () => number = Date.now, mutex: Mutex = sharedMutex, private readonly newId: () => string = () => `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`) {
    super(kv, now, mutex);
  }
  async list(): Promise<WantItem[]> {
    return (await this.read(WANT_KEY)).sort((a, b) => (a.state === b.state ? b.addedAt - a.addedAt : a.state === 'todo' ? -1 : 1));
  }
  /** Adds papers that are not on the list yet; returns how many were new. */
  add(items: Partial<WantItem>[] & { title: string }[]): Promise<{ added: number; skipped: number }> {
    return this.serial(async () => {
      const list = await this.read(WANT_KEY);
      let added = 0;
      let skipped = 0;
      for (const raw of items) {
        const t = this.now();
        const item: WantItem = {
          id: this.newId(), authors: [], year: null, doi: null, arxivId: null, url: null, note: '', source: 'manual', state: 'todo',
          addedAt: t, updatedAt: t, ...raw,
        } as WantItem;
        if (!item.title.trim() && !item.doi && !item.arxivId && !item.url) continue;
        if (list.some((x) => sameWanted(x, item))) {
          skipped += 1;
          continue;
        }
        list.push(item);
        added += 1;
      }
      await this.kv.set(WANT_KEY, list);
      return { added, skipped };
    });
  }
  setState(id: string, state: WantItem['state']): Promise<void> {
    return this.serial(async () => {
      const item = (await this.read(WANT_KEY)).find((x) => x.id === id);
      if (item) await this.writeItem(WANT_KEY, { ...item, state, updatedAt: this.now() });
    });
  }
  remove(id: string): Promise<void> {
    return this.serial(() => this.removeItem(WANT_KEY, id, wantRecordKey(id)));
  }
}
