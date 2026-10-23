import { appendPoint, pointsAttr, strokeHit } from './ink';

describe('appendPoint', () => {
  it('keeps points that moved far enough and drops the rest, so a stroke stays small', () => {
    const pts: [number, number][] = [[0.1, 0.1]];
    expect(appendPoint(pts, [0.1001, 0.1001], 0.002)).toBe(false);
    expect(appendPoint(pts, [0.2, 0.2], 0.002)).toBe(true);
    expect(pts).toEqual([[0.1, 0.1], [0.2, 0.2]]);
  });

  it('rounds to four decimals', () => {
    const pts: [number, number][] = [];
    appendPoint(pts, [0.123456789, 0.987654321], 0);
    expect(pts[0]).toEqual([0.1235, 0.9877]);
  });
});

describe('pointsAttr', () => {
  it('scales fractions of the page to the drawing space; a single point becomes a dot', () => {
    expect(pointsAttr([[0.1, 0.5], [0.2, 0.25]], 1000, 1400)).toBe('100,700 200,350');
    expect(pointsAttr([[0.5, 0.5]], 1000, 1400)).toBe('500,700 500.1,700');
  });
});

describe('strokeHit', () => {
  const stroke = { c: '#000', w: 0.004, p: [[0.1, 0.1], [0.5, 0.1]] as [number, number][] };

  it('is true near the line and false away from it, measured the same in x and y', () => {
    expect(strokeHit(stroke, 0.3, 0.105, 1.4, 0.01)).toBe(true);
    expect(strokeHit(stroke, 0.3, 0.2, 1.4, 0.01)).toBe(false);
    expect(strokeHit(stroke, 0.7, 0.1, 1.4, 0.01)).toBe(false); // beyond the end
    expect(strokeHit(stroke, 0.52, 0.1, 1.4, 0.03)).toBe(true); // within reach of the end
  });

  it('accounts for the page being taller than wide', () => {
    // 0.01 of the height is 0.014 of the width on a 1.4 page: not within a 0.01 reach vertically
    expect(strokeHit(stroke, 0.3, 0.11, 1.4, 0.01)).toBe(false);
    expect(strokeHit(stroke, 0.3, 0.1 + 0.005 / 1.4, 1.4, 0.01)).toBe(true);
  });

  it('hits a dot and an empty stroke never hits', () => {
    expect(strokeHit({ c: '#000', w: 0.01, p: [[0.4, 0.4]] }, 0.402, 0.4, 1, 0.01)).toBe(true);
    expect(strokeHit({ c: '#000', w: 0.01, p: [] }, 0.4, 0.4, 1, 0.5)).toBe(false);
  });
});
