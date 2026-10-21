import { pickContinue } from './continueReading';

const entry = (id: string, over: Partial<{ percent: number; lastOpenedAt: number | null }> = {}) => ({
  id, title: id, percent: 40, lastOpenedAt: 1000, ...over,
});

describe('pickContinue', () => {
  it('offers the paper you read most recently that is not finished', () => {
    const pick = pickContinue([entry('a', { lastOpenedAt: 100 }), entry('b', { lastOpenedAt: 300 }), entry('c', { lastOpenedAt: 200 })]);
    expect(pick?.id).toBe('b');
  });

  it('skips papers never opened, barely started or already finished', () => {
    const pick = pickContinue([
      entry('new', { lastOpenedAt: null, percent: 0 }),
      entry('just-opened', { percent: 0.2, lastOpenedAt: 900 }),
      entry('done', { percent: 99, lastOpenedAt: 800 }),
      entry('reading', { percent: 12, lastOpenedAt: 100 }),
    ]);
    expect(pick?.id).toBe('reading');
  });

  it('offers nothing when there is nothing to continue', () => {
    expect(pickContinue([])).toBeNull();
    expect(pickContinue([entry('x', { percent: 100 })])).toBeNull();
  });
});
