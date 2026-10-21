import { cardId, DAY_MS, dueQueue, isDue, newCard, previewIntervals, review, statsOf } from './srs';

const T0 = 1_700_000_000_000;
const base = { docId: 'd1', kind: 'quiz' as const, front: 'Why does it help?', back: 'Because.', blockIds: ['b1'], page: 2 };

describe('SM-2 scheduling', () => {
  it('starts due now with the default ease', () => {
    const c = newCard(base, T0);
    expect(c).toMatchObject({ ease: 2.5, interval: 0, reps: 0, due: T0, suspended: false });
    expect(isDue(c, T0)).toBe(true);
  });

  it('follows 1 day, 6 days, then grows by the ease factor', () => {
    let c = newCard(base, T0);
    c = review(c, 'good', T0);
    expect([c.interval, c.reps]).toEqual([1, 1]);
    expect(c.due).toBe(T0 + DAY_MS);
    c = review(c, 'good', c.due);
    expect(c.interval).toBe(6);
    const before = c.ease;
    c = review(c, 'good', c.due);
    expect(c.interval).toBe(Math.round(6 * before));
    expect(c.reps).toBe(3);
  });

  it('a lapse resets the streak, counts it, and brings the card back within minutes', () => {
    let c = review(review(newCard(base, T0), 'good', T0), 'good', T0);
    c = review(c, 'again', T0);
    expect(c).toMatchObject({ reps: 0, interval: 0, lapses: 1 });
    expect(c.due - T0).toBe(10 * 60 * 1000);
    expect(c.ease).toBeLessThan(2.5);
  });

  it('easy raises the ease and the interval, hard lowers the ease, and ease never drops below 1.3', () => {
    const c = review(newCard(base, T0), 'good', T0);
    expect(review(c, 'easy', T0).ease).toBeGreaterThan(c.ease);
    expect(review(c, 'hard', T0).ease).toBeLessThan(c.ease);
    let low = newCard(base, T0);
    for (let i = 0; i < 20; i++) low = review(low, 'again', T0);
    expect(low.ease).toBe(1.3);
  });

  it('previews what each button would schedule without changing the card', () => {
    const c = newCard(base, T0);
    const p = previewIntervals(c, T0);
    expect(p.again).toBe(10 * 60 * 1000);
    expect(p.good).toBe(DAY_MS);
    expect(p.easy).toBeGreaterThan(p.good);
    expect(c.reps).toBe(0);
  });
});

describe('card ids and queues', () => {
  it('gives the same question the same id so it is never added twice', () => {
    expect(cardId('d1', 'quiz', 'Why does it help?')).toBe(cardId('d1', 'quiz', '  why does   it help? '));
    expect(cardId('d1', 'quiz', 'a')).not.toBe(cardId('d1', 'quiz', 'b'));
    expect(cardId('d1', 'quiz', 'a')).not.toBe(cardId('d1', 'concept', 'a'));
  });

  it('queues overdue cards first, then a limited number of new ones, and skips suspended cards', () => {
    const cards = [
      { ...newCard({ ...base, front: 'new 1' }, T0), createdAt: T0 },
      { ...newCard({ ...base, front: 'new 2' }, T0), createdAt: T0 + 1 },
      { ...newCard({ ...base, front: 'new 3' }, T0), createdAt: T0 + 2 },
      review(newCard({ ...base, front: 'seen' }, T0), 'good', T0),
      { ...newCard({ ...base, front: 'paused' }, T0), suspended: true },
    ];
    const now = T0 + 2 * DAY_MS;
    const queue = dueQueue(cards, now, { newLimit: 2 });
    expect(queue.map((c) => c.front)).toEqual(['seen', 'new 1', 'new 2']);
  });

  it('summarises the deck', () => {
    const seen = review(review(newCard({ ...base, front: 'x' }, T0), 'good', T0), 'good', T0);
    const s = statsOf([seen, newCard({ ...base, front: 'y' }, T0)], T0 + 30 * DAY_MS);
    expect(s).toEqual({ due: 2, fresh: 1, learned: 1, total: 2 });
  });
});
