/** Hand-drawn notes on the pages of the original: strokes as fractions of the page, drawn as SVG over the page image. */
import type { InkStroke } from '../../src/reader/protocol';

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** Adds a point if it moved at least `minDist` (a fraction of the page) from the last one. */
export function appendPoint(points: [number, number][], p: [number, number], minDist: number): boolean {
  const q: [number, number] = [round4(p[0]), round4(p[1])];
  const last = points[points.length - 1];
  if (last && Math.hypot(q[0] - last[0], q[1] - last[1]) < minDist) return false;
  points.push(q);
  return true;
}

/** The `points` attribute of a polyline in a drawing space `width` by `height`. */
export function pointsAttr(points: [number, number][], width: number, height: number): string {
  const pts = points.map(([x, y]) => `${+(x * width).toFixed(2)},${+(y * height).toFixed(2)}`);
  if (pts.length === 1) pts.push(`${+(points[0][0] * width + 0.1).toFixed(2)},${+(points[0][1] * height).toFixed(2)}`);
  return pts.join(' ');
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Is (x, y), both fractions of the page, within `reach` (a fraction of the page width) of the stroke? `aspect` is height / width. */
export function strokeHit(stroke: InkStroke, x: number, y: number, aspect: number, reach: number): boolean {
  const pts = stroke.p;
  if (!pts.length) return false;
  const px = x;
  const py = y * aspect;
  if (pts.length === 1) return Math.hypot(px - pts[0][0], py - pts[0][1] * aspect) <= reach;
  for (let i = 1; i < pts.length; i++) {
    if (distToSegment(px, py, pts[i - 1][0], pts[i - 1][1] * aspect, pts[i][0], pts[i][1] * aspect) <= reach) return true;
  }
  return false;
}
