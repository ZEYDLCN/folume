/** Spaced repetition (SM-2) for the things a reader got wrong or wants to keep. */

export type CardKind = 'quiz' | 'concept' | 'note';
export type Grade = 'again' | 'hard' | 'good' | 'easy';

export const DAY_MS = 24 * 60 * 60 * 1000;
const LEARNING_STEP_MS = 10 * 60 * 1000;

export interface Card {
  id: string;
  docId: string;
  kind: CardKind;
  front: string;
  back: string;
  /** where the answer lives in the paper, so a card can always send the reader back to the source */
  blockIds: string[];
  page: number;
  /** SM-2 ease factor (>= 1.3) */
  ease: number;
  /** current interval in days */
  interval: number;
  /** consecutive successful reviews */
  reps: number;
  lapses: number;
  due: number;
  createdAt: number;
  updatedAt: number;
  lastReviewedAt: number | null;
  suspended: boolean;
}

const QUALITY: Record<Grade, number> = { again: 1, hard: 3, good: 4, easy: 5 };

export function newCard(
  input: Pick<Card, 'docId' | 'kind' | 'front' | 'back' | 'blockIds' | 'page'> & { id?: string },
  now: number,
): Card {
  return {
    id: input.id ?? cardId(input.docId, input.kind, input.front),
    docId: input.docId,
    kind: input.kind,
    front: input.front,
    back: input.back,
    blockIds: input.blockIds,
    page: input.page,
    ease: 2.5,
    interval: 0,
    reps: 0,
    lapses: 0,
    due: now,
    createdAt: now,
    updatedAt: now,
    lastReviewedAt: null,
    suspended: false,
  };
}

/** Stable id so the same missed question never produces two cards. */
export function cardId(docId: string, kind: CardKind, front: string): string {
  let h = 0x811c9dc5;
  const s = `${kind}\u0000${front.trim().toLowerCase().replace(/\s+/g, ' ')}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${kind[0]}${h.toString(36)}${s.length.toString(36)}`;
}

/** SM-2 with a 10 minute relearning step for lapses. */
export function review(card: Card, grade: Grade, now: number): Card {
  const q = QUALITY[grade];
  let { ease, interval, reps, lapses } = card;
  ease = Math.max(1.3, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  let due: number;
  if (q < 3) {
    reps = 0;
    interval = 0;
    lapses += 1;
    due = now + LEARNING_STEP_MS;
  } else {
    const first = reps === 0;
    if (first) interval = 1;
    else if (reps === 1) interval = 6;
    else interval = Math.round(interval * ease);
    if (grade === 'hard') interval = Math.max(1, Math.round(interval * 0.85));
    // a first "easy" has no previous interval to stretch, so it skips ahead a few days instead
    if (grade === 'easy') interval = first ? 4 : Math.round(interval * 1.3);
    reps += 1;
    due = now + interval * DAY_MS;
  }
  return { ...card, ease: Math.round(ease * 1000) / 1000, interval, reps, lapses, due, updatedAt: now, lastReviewedAt: now };
}

/** What each answer button would schedule, to label the buttons ("10 min", "1 day", "6 days"...). */
export function previewIntervals(card: Card, now: number): Record<Grade, number> {
  const out = {} as Record<Grade, number>;
  for (const g of ['again', 'hard', 'good', 'easy'] as const) out[g] = review(card, g, now).due - now;
  return out;
}

export function isDue(card: Card, now: number): boolean {
  return !card.suspended && card.due <= now;
}

export interface ReviewStats {
  due: number;
  fresh: number;
  learned: number;
  total: number;
}

export function statsOf(cards: Card[], now: number): ReviewStats {
  const active = cards.filter((c) => !c.suspended);
  return {
    due: active.filter((c) => c.due <= now).length,
    fresh: active.filter((c) => c.lastReviewedAt === null).length,
    learned: active.filter((c) => c.reps >= 2).length,
    total: active.length,
  };
}

/** Today's queue: overdue first (longest overdue first), then new cards, a few at a time. */
export function dueQueue(cards: Card[], now: number, opts: { newLimit?: number; limit?: number } = {}): Card[] {
  const due = cards.filter((c) => isDue(c, now));
  const seen = due.filter((c) => c.lastReviewedAt !== null).sort((a, b) => a.due - b.due);
  const fresh = due.filter((c) => c.lastReviewedAt === null).sort((a, b) => a.createdAt - b.createdAt).slice(0, opts.newLimit ?? 10);
  return [...seen, ...fresh].slice(0, opts.limit ?? 50);
}
