/** The drawing side of ink notes: an SVG over each original page, pointer events, undo. Geometry lives in ink.ts. */
import type { InkPageView, InkStroke, InkTool } from '../../src/reader/protocol';
import { appendPoint, pointsAttr, strokeHit } from './ink';

type Op = { page: number; kind: 'add'; stroke: InkStroke } | { page: number; kind: 'erase'; removed: { at: number; stroke: InkStroke }[] };

const SVG = 'http://www.w3.org/2000/svg';
const WIDTH = 1000;
const PEN_WIDTH = 0.004;
const HIGHLIGHTER_WIDTH = 0.02;
const ERASER_REACH = 0.012;

export interface InkHost {
  /** pages' width and height in points */
  dims(page: number): { w: number; h: number };
  changed(page: number, strokes: InkStroke[]): void;
}

export class InkLayer {
  tool: InkTool = 'off';
  color = '#c2512f';
  private pages = new Map<number, InkStroke[]>();
  private ops: Op[] = [];
  private drawing: { page: number; stroke: InkStroke; line: SVGPolylineElement; img: HTMLElement; id: number } | null = null;

  constructor(private readonly host: InkHost) {}

  load(views: InkPageView[]): void {
    this.pages = new Map(views.map((v) => [v.page, v.strokes.map((s) => ({ ...s, p: s.p.map(([x, y]) => [x, y] as [number, number]) }))]));
    this.ops = [];
  }

  /** (Re)creates the drawing layer on every page of the original that is on screen. Call after the original is rendered. */
  mount(root: HTMLElement): void {
    root.querySelectorAll<HTMLElement>('.pg').forEach((pg) => {
      pg.querySelector('svg.ink')?.remove();
      const page = Number(pg.dataset.page);
      const { w, h } = this.host.dims(page);
      const svg = document.createElementNS(SVG, 'svg');
      svg.setAttribute('class', 'ink');
      svg.setAttribute('viewBox', `0 0 ${WIDTH} ${(WIDTH * h) / w}`);
      svg.setAttribute('preserveAspectRatio', 'none');
      pg.append(svg);
      this.paint(page, svg);
    });
    if (!root.dataset.inkBound) {
      root.dataset.inkBound = '1';
      root.addEventListener('pointerdown', (e) => this.down(e));
      root.addEventListener('pointermove', (e) => this.move(e));
      root.addEventListener('pointerup', (e) => this.up(e));
      root.addEventListener('pointercancel', (e) => this.up(e));
    }
    root.classList.toggle('ink-on', this.tool !== 'off');
  }

  setTool(tool: InkTool, color: string): void {
    this.tool = tool;
    this.color = color;
    document.getElementById('orig')?.classList.toggle('ink-on', tool !== 'off');
  }

  private svgOf(page: number): SVGSVGElement | null {
    return document.querySelector<SVGSVGElement>(`#orig .pg[data-page="${page}"] svg.ink`);
  }

  private line(stroke: InkStroke, height: number): SVGPolylineElement {
    const l = document.createElementNS(SVG, 'polyline');
    const highlighter = stroke.w >= HIGHLIGHTER_WIDTH;
    l.setAttribute('points', pointsAttr(stroke.p, WIDTH, height));
    l.setAttribute('fill', 'none');
    l.setAttribute('stroke', stroke.c);
    l.setAttribute('stroke-width', String(stroke.w * WIDTH));
    l.setAttribute('stroke-linecap', highlighter ? 'butt' : 'round');
    l.setAttribute('stroke-linejoin', 'round');
    if (highlighter) l.setAttribute('style', 'mix-blend-mode:multiply');
    return l;
  }

  private paint(page: number, svg: SVGSVGElement | null = this.svgOf(page)): void {
    if (!svg) return;
    svg.replaceChildren();
    const { w, h } = this.host.dims(page);
    for (const s of this.pages.get(page) ?? []) svg.append(this.line(s, (WIDTH * h) / w));
  }

  private point(e: PointerEvent, img: HTMLElement): [number, number] {
    const r = img.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  }

  private down(e: PointerEvent): void {
    if (this.tool === 'off') return;
    const pg = (e.target as Element).closest<HTMLElement>('.pg');
    const img = pg?.querySelector<HTMLElement>('img');
    if (!pg || !img) return;
    e.preventDefault();
    pg.setPointerCapture?.(e.pointerId);
    const page = Number(pg.dataset.page);
    const p = this.point(e, img);
    if (this.tool === 'eraser') {
      this.erase(page, p, img);
      this.drawing = { page, stroke: { c: '', w: 0, p: [] }, line: null as never, img, id: e.pointerId };
      return;
    }
    const { w, h } = this.host.dims(page);
    const stroke: InkStroke = { c: this.color, w: this.tool === 'highlighter' ? HIGHLIGHTER_WIDTH : PEN_WIDTH, p: [] };
    appendPoint(stroke.p, p, 0);
    const line = this.line(stroke, (WIDTH * h) / w);
    this.svgOf(page)?.append(line);
    this.drawing = { page, stroke, line, img, id: e.pointerId };
  }

  private move(e: PointerEvent): void {
    const d = this.drawing;
    if (!d || e.pointerId !== d.id) return;
    e.preventDefault();
    const p = this.point(e, d.img);
    if (this.tool === 'eraser') return this.erase(d.page, p, d.img);
    if (appendPoint(d.stroke.p, p, this.tool === 'highlighter' ? 0.004 : 0.0015)) {
      const { w, h } = this.host.dims(d.page);
      d.line.setAttribute('points', pointsAttr(d.stroke.p, WIDTH, (WIDTH * h) / w));
    }
  }

  private up(e: PointerEvent): void {
    const d = this.drawing;
    if (!d || e.pointerId !== d.id) return;
    this.drawing = null;
    if (this.tool === 'eraser') return;
    const list = this.pages.get(d.page) ?? [];
    list.push(d.stroke);
    this.pages.set(d.page, list);
    this.ops.push({ page: d.page, kind: 'add', stroke: d.stroke });
    this.host.changed(d.page, list);
  }

  private erase(page: number, [x, y]: [number, number], img: HTMLElement): void {
    const list = this.pages.get(page) ?? [];
    const r = img.getBoundingClientRect();
    const aspect = r.height / r.width;
    const removed: { at: number; stroke: InkStroke }[] = [];
    const keep = list.filter((s, at) => {
      const hit = strokeHit(s, x, y, aspect, ERASER_REACH);
      if (hit) removed.push({ at, stroke: s });
      return !hit;
    });
    if (!removed.length) return;
    this.pages.set(page, keep);
    this.ops.push({ page, kind: 'erase', removed });
    this.paint(page);
    this.host.changed(page, keep);
  }

  undo(): void {
    const op = this.ops.pop();
    if (!op) return;
    const list = this.pages.get(op.page) ?? [];
    if (op.kind === 'add') list.splice(list.lastIndexOf(op.stroke), 1);
    else for (const { at, stroke } of [...op.removed].sort((a, b) => a.at - b.at)) list.splice(at, 0, stroke);
    this.pages.set(op.page, list);
    this.paint(op.page);
    this.host.changed(op.page, list);
  }
}
