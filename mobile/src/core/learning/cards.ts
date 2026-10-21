import type { Concept } from '@/core/knowledge/concepts';

import type { Card } from './srs';

type NewCard = Pick<Card, 'docId' | 'kind' | 'front' | 'back' | 'blockIds' | 'page'>;

interface MissedItem {
  prompt: string;
  answer: string;
  explanation: string;
  correct: boolean;
  blockIds: string[];
}

/** Questions answered wrongly become review cards; the answer side points back at the source blocks. */
export function cardsFromMissed(docId: string, items: MissedItem[], pageOf: (blockId: string) => number): NewCard[] {
  return items
    .filter((i) => !i.correct)
    .map((i) => ({
      docId,
      kind: 'quiz' as const,
      front: i.prompt,
      back: i.explanation ? `${i.answer}\n\n${i.explanation}` : i.answer,
      blockIds: i.blockIds,
      page: i.blockIds.length ? pageOf(i.blockIds[0]) : 1,
    }));
}

/** A concept card exists only for concepts the paper defines: the back is the authors' own sentence. */
export function cardFromConcept(docId: string, concept: Concept, front: string): NewCard | null {
  const def = concept.definition;
  if (!def) return null;
  return { docId, kind: 'concept', front, back: def.text, blockIds: [def.blockId], page: def.page };
}
