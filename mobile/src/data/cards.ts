import { dueQueue, newCard, review, statsOf, type Card, type Grade, type ReviewStats } from '@/core/learning/srs';

import type { KeyValueStore } from './kv';
import { KEY } from './kv';
import { Mutex, sharedMutex } from './mutex';
import { markDeleted } from './tombstones';

export const cardsKey = (docId: string) => `${KEY.docPrefix(docId)}cards`;
export const cardRecordKey = (docId: string, id: string) => `card/${docId}/${id}`;

export type NewCardInput = Pick<Card, 'docId' | 'kind' | 'front' | 'back' | 'blockIds' | 'page'>;

/** Review cards per paper. A card that already exists keeps its schedule when the same question is added again. */
export class CardRepo {
  constructor(
    private readonly kv: KeyValueStore,
    private readonly now: () => number = Date.now,
    private readonly mutex: Mutex = sharedMutex,
  ) {}

  async list(docId: string): Promise<Card[]> {
    return (await this.kv.get<Card[]>(cardsKey(docId))) ?? [];
  }

  async listAll(): Promise<Card[]> {
    const out: Card[] = [];
    for (const k of await this.kv.keys('folume:v1:doc:')) {
      if (k.endsWith(':cards')) out.push(...((await this.kv.get<Card[]>(k)) ?? []));
    }
    return out;
  }

  /** Adds cards that are not there yet; returns how many were new. */
  add(inputs: NewCardInput[]): Promise<number> {
    return this.mutex.run(async () => {
      let added = 0;
      const byDoc = new Map<string, NewCardInput[]>();
      for (const i of inputs) byDoc.set(i.docId, [...(byDoc.get(i.docId) ?? []), i]);
      for (const [docId, list] of byDoc) {
        const cards = (await this.kv.get<Card[]>(cardsKey(docId))) ?? [];
        const have = new Set(cards.map((c) => c.id));
        for (const input of list) {
          const card = newCard(input, this.now());
          if (have.has(card.id)) continue;
          have.add(card.id);
          cards.push(card);
          added += 1;
        }
        await this.kv.set(cardsKey(docId), cards);
      }
      return added;
    });
  }

  grade(docId: string, id: string, grade: Grade): Promise<Card | null> {
    return this.mutex.run(async () => {
      const cards = (await this.kv.get<Card[]>(cardsKey(docId))) ?? [];
      const i = cards.findIndex((c) => c.id === id);
      if (i < 0) return null;
      cards[i] = review(cards[i], grade, this.now());
      await this.kv.set(cardsKey(docId), cards);
      return cards[i];
    });
  }

  setSuspended(docId: string, id: string, suspended: boolean): Promise<void> {
    return this.mutex.run(async () => {
      const cards = (await this.kv.get<Card[]>(cardsKey(docId))) ?? [];
      await this.kv.set(
        cardsKey(docId),
        cards.map((c) => (c.id === id ? { ...c, suspended, updatedAt: this.now() } : c)),
      );
    });
  }

  remove(docId: string, id: string): Promise<void> {
    return this.mutex.run(async () => {
      const cards = (await this.kv.get<Card[]>(cardsKey(docId))) ?? [];
      await this.kv.set(cardsKey(docId), cards.filter((c) => c.id !== id));
      await markDeleted(this.kv, cardRecordKey(docId, id), this.now());
    });
  }

  async due(limit = 50): Promise<Card[]> {
    return dueQueue(await this.listAll(), this.now(), { limit });
  }

  async stats(): Promise<ReviewStats> {
    return statsOf(await this.listAll(), this.now());
  }
}
