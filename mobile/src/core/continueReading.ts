export interface ContinueCandidate {
  id: string;
  percent: number;
  lastOpenedAt: number | null;
}

const STARTED = 1; // percent: less than this is "just opened"
const FINISHED = 97;

/** The paper to offer on the library screen: the one read most recently that is neither barely started nor finished. */
export function pickContinue<T extends ContinueCandidate>(entries: T[]): T | null {
  let best: T | null = null;
  for (const e of entries) {
    if (e.lastOpenedAt === null || e.percent < STARTED || e.percent >= FINISHED) continue;
    if (!best || (e.lastOpenedAt ?? 0) > (best.lastOpenedAt ?? 0)) best = e;
  }
  return best;
}
