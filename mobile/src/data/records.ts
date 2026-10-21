import type { Card } from '@/core/learning/srs';
import { parseRecordKey, validRecordData, type RecordKind, type SyncRecord } from '@/core/sync/records';

import { annKey, type Annotation } from './annotations';
import { cardsKey } from './cards';
import { KEY, type KeyValueStore } from './kv';
import type { DocState, LibraryEntry, TagsRecord } from './library';
import { stateKey, tagsKey } from './library';
import { Mutex, sharedMutex } from './mutex';
import type { QuizResult } from './quiz';
import { readTombstones, TOMBSTONES_KEY } from './tombstones';

const quizKey = (docId: string) => `${KEY.docPrefix(docId)}quiz`;
const DOC_KEY = /^folume:v1:doc:([A-Za-z0-9_.-]{1,80}):(ann|state|quiz|cards|tags)$/;

export interface ApplyResult {
  applied: number;
  /** older than what is here, or identical */
  skipped: number;
  /** wrong shape or key: never written */
  invalid: number;
}

type Local = { updatedAt: number; data: unknown };

/**
 * Everything that is the reader's own (notes, progress, quiz results, review cards, tags) as keyed records,
 * and the last-writer-wins merge of such records coming from another device or from a backup file.
 * Papers and their images are not included: they are re-created from the PDF.
 */
export class RecordStore {
  constructor(
    private readonly kv: KeyValueStore,
    private readonly mutex: Mutex = sharedMutex,
  ) {}

  collect(): Promise<SyncRecord[]> {
    return this.mutex.run(async () => {
      const out: SyncRecord[] = [];
      for (const k of await this.kv.keys('folume:v1:doc:')) {
        const m = DOC_KEY.exec(k);
        if (!m) continue;
        const [, docId, suffix] = m;
        if (suffix === 'ann') {
          for (const a of (await this.kv.get<Annotation[]>(k)) ?? []) out.push(live(`ann/${docId}/${a.id}`, a.updatedAt, a));
        } else if (suffix === 'quiz') {
          for (const q of (await this.kv.get<QuizResult[]>(k)) ?? []) out.push(live(`quiz/${docId}/${q.id}`, q.at, q));
        } else if (suffix === 'cards') {
          for (const c of (await this.kv.get<Card[]>(k)) ?? []) out.push(live(`card/${docId}/${c.id}`, c.updatedAt, c));
        } else if (suffix === 'state') {
          const s = await this.kv.get<DocState>(k);
          if (s) out.push(live(`state/${docId}`, s.updatedAt, s));
        } else if (suffix === 'tags') {
          const t = await this.kv.get<TagsRecord>(k);
          if (t) out.push(live(`tags/${docId}`, t.updatedAt, t));
        }
      }
      const newest = new Map(out.map((r) => [r.key, r.updatedAt]));
      for (const [key, at] of Object.entries(await readTombstones(this.kv))) {
        if ((newest.get(key) ?? -1) < at) out.push({ key, updatedAt: at, deleted: true, data: null });
      }
      return out;
    });
  }

  apply(records: SyncRecord[]): Promise<ApplyResult> {
    return this.mutex.run(async () => {
      const result: ApplyResult = { applied: 0, skipped: 0, invalid: 0 };
      let tombstones = await readTombstones(this.kv);
      let tombstonesChanged = false;
      for (const rec of records) {
        const parsed = parseRecordKey(rec.key);
        if (!parsed || !Number.isFinite(rec.updatedAt) || (!rec.deleted && !validRecordData(parsed.kind, rec.data))) {
          result.invalid += 1;
          continue;
        }
        const data = rec.data as { docId?: string; id?: string } | null;
        if (!rec.deleted && ((data?.docId !== undefined && data.docId !== parsed.docId) || (parsed.id !== null && data?.id !== parsed.id))) {
          result.invalid += 1;
          continue;
        }
        const local = await this.readLocal(parsed.kind, parsed.docId, parsed.id);
        const tomb = tombstones[rec.key];
        if (rec.deleted) {
          const knownDeletion = (tomb ?? -1) >= rec.updatedAt;
          if ((local && local.updatedAt > rec.updatedAt) || (!local && knownDeletion)) {
            result.skipped += 1;
            continue;
          }
          if (local) await this.writeLocal(parsed.kind, parsed.docId, parsed.id, null);
          if (!knownDeletion) {
            tombstones = { ...tombstones, [rec.key]: rec.updatedAt };
            tombstonesChanged = true;
          }
          result.applied += 1;
          continue;
        }
        if ((tomb !== undefined && tomb >= rec.updatedAt) || (local && local.updatedAt > rec.updatedAt)) {
          result.skipped += 1;
          continue;
        }
        if (local && local.updatedAt === rec.updatedAt && JSON.stringify(local.data) === JSON.stringify(rec.data)) {
          result.skipped += 1;
          continue;
        }
        await this.writeLocal(parsed.kind, parsed.docId, parsed.id, rec.data);
        if (tomb !== undefined) {
          const { [rec.key]: _gone, ...rest } = tombstones;
          void _gone;
          tombstones = rest;
          tombstonesChanged = true;
        }
        result.applied += 1;
      }
      if (tombstonesChanged) await this.kv.set(TOMBSTONES_KEY, tombstones);
      return result;
    });
  }

  private async readLocal(kind: RecordKind, docId: string, id: string | null): Promise<Local | null> {
    switch (kind) {
      case 'ann': {
        const a = ((await this.kv.get<Annotation[]>(annKey(docId))) ?? []).find((x) => x.id === id);
        return a ? { updatedAt: a.updatedAt, data: a } : null;
      }
      case 'quiz': {
        const q = ((await this.kv.get<QuizResult[]>(quizKey(docId))) ?? []).find((x) => x.id === id);
        return q ? { updatedAt: q.at, data: q } : null;
      }
      case 'card': {
        const c = ((await this.kv.get<Card[]>(cardsKey(docId))) ?? []).find((x) => x.id === id);
        return c ? { updatedAt: c.updatedAt, data: c } : null;
      }
      case 'state': {
        const s = await this.kv.get<DocState>(stateKey(docId));
        return s ? { updatedAt: s.updatedAt, data: s } : null;
      }
      case 'tags': {
        const t = await this.kv.get<TagsRecord>(tagsKey(docId));
        return t ? { updatedAt: t.updatedAt, data: t } : null;
      }
    }
  }

  /** `data === null` removes the record. */
  private async writeLocal(kind: RecordKind, docId: string, id: string | null, data: unknown | null): Promise<void> {
    const upsert = async <T extends { id: string }>(key: string, item: T | null) => {
      const list = ((await this.kv.get<T[]>(key)) ?? []).filter((x) => x.id !== id);
      await this.kv.set(key, item ? [...list, item] : list);
    };
    switch (kind) {
      case 'ann':
        return upsert(annKey(docId), data as Annotation | null);
      case 'quiz':
        return upsert(quizKey(docId), data as QuizResult | null);
      case 'card':
        return upsert(cardsKey(docId), data as Card | null);
      case 'state': {
        if (data === null) return this.kv.remove(stateKey(docId));
        await this.kv.set(stateKey(docId), data);
        return this.patchEntry(docId, { percent: (data as DocState).percent });
      }
      case 'tags': {
        if (data === null) return this.kv.remove(tagsKey(docId));
        await this.kv.set(tagsKey(docId), data);
        const t = data as TagsRecord;
        return this.patchEntry(docId, { tags: t.tags, tagsUpdatedAt: t.updatedAt });
      }
    }
  }

  private async patchEntry(docId: string, patch: Partial<LibraryEntry>): Promise<void> {
    const entries = (await this.kv.get<LibraryEntry[]>(KEY.library)) ?? [];
    if (!entries.some((e) => e.id === docId)) return;
    await this.kv.set(KEY.library, entries.map((e) => (e.id === docId ? { ...e, ...patch } : e)));
  }
}

function live(key: string, updatedAt: number, data: unknown): SyncRecord {
  return { key, updatedAt, deleted: false, data };
}
