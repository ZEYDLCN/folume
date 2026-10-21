import type { HighlightView } from '@/reader/protocol';

import type { KeyValueStore } from './kv';
import { KEY } from './kv';

export type AnnotationOrigin = 'user' | 'ai';

/** A highlight and/or note anchored to a block and a character range of its rendered text. */
export interface Annotation {
  id: string;
  docId: string;
  blockId: string;
  /** character offsets into the block's rendered text; start === end means a note on the whole block */
  start: number;
  end: number;
  /** the exact source text the annotation refers to; never replaced by AI text */
  quote: string;
  color: string;
  note: string;
  /** who wrote `note`: AI-generated text is always labelled as such */
  origin: AnnotationOrigin;
  tags: string[];
  page: number;
  createdAt: number;
  updatedAt: number;
}

export const HIGHLIGHT_COLORS = [
  { name: 'yellow', value: 'rgba(255, 214, 0, 0.38)' },
  { name: 'green', value: 'rgba(76, 200, 110, 0.38)' },
  { name: 'blue', value: 'rgba(64, 140, 255, 0.34)' },
  { name: 'pink', value: 'rgba(255, 96, 160, 0.34)' },
] as const;

const key = (docId: string) => `${KEY.docPrefix(docId)}ann`;

export class AnnotationRepo {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly kv: KeyValueStore,
    private readonly now: () => number = Date.now,
    private readonly newId: () => string = () => `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
  ) {}

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async list(docId: string): Promise<Annotation[]> {
    const items = (await this.kv.get<Annotation[]>(key(docId))) ?? [];
    return [...items].sort((a, b) => a.page - b.page || a.blockId.localeCompare(b.blockId) || a.start - b.start);
  }

  async listAll(): Promise<Annotation[]> {
    const out: Annotation[] = [];
    for (const k of await this.kv.keys('folume:v1:doc:')) {
      if (!k.endsWith(':ann')) continue;
      out.push(...((await this.kv.get<Annotation[]>(k)) ?? []));
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  add(input: Omit<Annotation, 'id' | 'createdAt' | 'updatedAt' | 'tags' | 'note' | 'origin'> & Partial<Pick<Annotation, 'note' | 'origin' | 'tags'>>): Promise<Annotation> {
    return this.serial(async () => {
      const t = this.now();
      const a: Annotation = { note: '', origin: 'user', tags: [], ...input, id: this.newId(), createdAt: t, updatedAt: t };
      await this.kv.set(key(a.docId), [...((await this.kv.get<Annotation[]>(key(a.docId))) ?? []), a]);
      return a;
    });
  }

  update(docId: string, id: string, patch: Partial<Pick<Annotation, 'note' | 'color' | 'tags' | 'origin'>>): Promise<Annotation | null> {
    return this.serial(async () => {
      const items = (await this.kv.get<Annotation[]>(key(docId))) ?? [];
      const i = items.findIndex((a) => a.id === id);
      if (i < 0) return null;
      items[i] = { ...items[i], ...patch, updatedAt: this.now() };
      await this.kv.set(key(docId), items);
      return items[i];
    });
  }

  remove(docId: string, id: string): Promise<void> {
    return this.serial(async () => {
      const items = (await this.kv.get<Annotation[]>(key(docId))) ?? [];
      await this.kv.set(key(docId), items.filter((a) => a.id !== id));
    });
  }
}

/** What the reader runtime paints: ranges only (block-level notes have nothing to paint). */
export function toHighlightViews(items: Annotation[]): HighlightView[] {
  return items
    .filter((a) => a.end > a.start)
    .map((a) => ({ id: a.id, blockId: a.blockId, start: a.start, end: a.end, color: a.color, hasNote: a.note.trim().length > 0 }));
}
