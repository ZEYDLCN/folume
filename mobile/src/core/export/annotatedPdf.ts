/**
 * An annotated copy of a paper as a PDF: the pages exactly as the original showed them (their pictures, unchanged),
 * with the reader's highlights, notes and pencil strokes as real PDF annotations on top, and the paper's sections as a
 * table of contents. The original file is never touched. Because the pages are pictures, this copy is for reading and
 * marking up, not for searching; highlight positions are line-accurate estimates (the converter keeps one box per
 * block, not one per word) and every quote and note is also kept as text in the annotation.
 */
import type { Annotation } from '@/data/annotations';
import { HIGHLIGHT_COLORS } from '@/data/annotations';
import type { InkPage } from '@/data/userdata';
import { titleOf } from '../docModel';
import type { Block, Document } from '../types';

export interface AnnotatedPdfInput {
  doc: Document;
  /** the JPEG of each page, by page number (1-based) */
  pageImages: Map<number, Uint8Array>;
  annotations: Annotation[];
  ink: InkPage[];
  when?: Date;
}

export interface AnnotatedPdfSummary {
  pages: number;
  highlights: number;
  /** sticky notes on whole blocks */
  notes: number;
  strokes: number;
  /** marks whose block is no longer in the paper, or that carry nothing */
  skipped: number;
  /** pages whose picture was not available: kept as blank pages */
  missingPages: number;
}

// ------------------------------------------------------------------------------------------------- small helpers

const enc = new TextEncoder();

/** A number as PDF writes it: no exponent, at most 3 decimals. */
const n = (x: number): string => {
  const s = Number(x.toFixed(3)).toString();
  return s === '-0' ? '0' : s;
};

/** Text as a PDF string: a plain literal when it is ASCII, UTF-16 with a byte-order mark otherwise, so no letter is lost. */
export function pdfText(text: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e\n\r\t]*$/.test(text)) {
    return `(${text.replace(/[\\()]/g, (c) => `\\${c}`).replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')})`;
  }
  let hex = 'FEFF';
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
  return `<${hex}>`;
}

const pdfDate = (d: Date): string => {
  const p = (v: number, w = 2) => String(v).padStart(w, '0');
  return `(D:${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z)`;
};

export interface Colour {
  rgb: [number, number, number];
  alpha: number;
}

const FALLBACK = HIGHLIGHT_COLORS[0];

/** CSS colours (`#rgb`, `#rrggbb`, `rgb()`, `rgba()`) and the names of the highlight palette. */
export function parseColor(value: string): Colour {
  const v = value.trim().toLowerCase();
  const named = HIGHLIGHT_COLORS.find((h) => h.name === v);
  if (named) return parseColor(named.value);
  let m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) return { rgb: [...m[1]].map((h) => parseInt(h + h, 16) / 255) as Colour['rgb'], alpha: 1 };
  m = /^#([0-9a-f]{6})$/.exec(v);
  if (m) return { rgb: [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16) / 255) as Colour['rgb'], alpha: 1 };
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v);
  if (m) return { rgb: [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255], alpha: m[4] === undefined ? 1 : Number(m[4]) };
  return parseColor(FALLBACK.name);
}

const rgbOps = (c: Colour['rgb']) => c.map(n).join(' ');

/** Width, height and colour components of a JPEG, read from its header without decoding it. */
export function jpegInfo(bytes: Uint8Array): { width: number; height: number; components: number } {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('not a JPEG');
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (i + 10 > bytes.length) break;
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8], components: bytes[i + 9] };
    }
    i += 2 + length;
  }
  throw new Error('no frame header in JPEG');
}

// ---------------------------------------------------------------------------------------------- highlight places

export interface PageRect {
  page: number;
  /** points, origin at the top left of the page */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Roughly how much room a character takes, relative to the square of the font size, in justified body text. */
const AREA_PER_CHAR = 0.576;
const LEADING = 1.2;

/**
 * Where the characters `start..end` of a block sit on its page(s). The converter keeps one box per block, so the
 * text is assumed to run evenly through it, line after line; the result is right to within a line or so.
 */
export function highlightRects(block: Block, start: number, end: number): PageRect[] {
  const len = block.text.length;
  if (!len) return [];
  const a = Math.max(0, Math.min(len, Math.min(start, end)));
  const b = Math.max(0, Math.min(len, Math.max(start, end)));
  if (a >= b) return [];
  const regions = block.source.filter((r) => (r.bbox[2] - r.bbox[0]) * (r.bbox[3] - r.bbox[1]) > 0);
  if (!regions.length) return [];
  const areas = regions.map((r) => (r.bbox[2] - r.bbox[0]) * (r.bbox[3] - r.bbox[1]));
  const total = areas.reduce((s, x) => s + x, 0);
  const out: PageRect[] = [];
  let from = 0;
  let acc = 0;
  regions.forEach((r, k) => {
    acc += areas[k];
    const to = k === regions.length - 1 ? len : Math.round((acc / total) * len);
    const count = to - from;
    const la = Math.max(a, from) - from;
    const lb = Math.min(b, to) - from;
    if (count > 0 && lb > la) {
      const [x, y, x2, y2] = r.bbox;
      const w = x2 - x;
      const h = y2 - y;
      const size = Math.min(18, Math.max(5, Math.sqrt((w * h) / (AREA_PER_CHAR * count))));
      const lines = Math.max(1, Math.round(h / (size * LEADING)));
      const lineH = h / lines;
      const perLine = count / lines;
      for (let j = 0; j < lines; j++) {
        const s = Math.max(la, j * perLine);
        const e = Math.min(lb, (j + 1) * perLine);
        if (e <= s) continue;
        out.push({
          page: r.page,
          x0: x + (w * (s - j * perLine)) / perLine,
          x1: x + (w * (e - j * perLine)) / perLine,
          y0: y + j * lineH,
          y1: y + (j + 1) * lineH,
        });
      }
    }
    from = to;
  });
  return out;
}

// ------------------------------------------------------------------------------------------------- the writer

class Pdf {
  private readonly objects: Uint8Array[] = [];

  /** Reserves the next object number. */
  alloc(): number {
    this.objects.push(new Uint8Array(0));
    return this.objects.length;
  }

  set(num: number, dict: string, stream?: Uint8Array | string): void {
    const parts: Uint8Array[] = [enc.encode(`${num} 0 obj\n`)];
    if (stream === undefined) {
      parts.push(enc.encode(dict));
    } else {
      const data = typeof stream === 'string' ? enc.encode(stream) : stream;
      parts.push(enc.encode(dict.replace(/>>$/, `/Length ${data.length} >>`)), enc.encode('\nstream\n'), data, enc.encode('\nendstream'));
    }
    parts.push(enc.encode('\nendobj\n'));
    this.objects[num - 1] = concat(parts);
  }

  add(dict: string, stream?: Uint8Array | string): number {
    const num = this.alloc();
    this.set(num, dict, stream);
    return num;
  }

  finish(root: number, info: number): Uint8Array {
    // the second line has bytes above 127, which tells tools this file is binary
    const chunks: Uint8Array[] = [enc.encode('%PDF-1.7\n'), new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])];
    let pos = chunks[0].length + chunks[1].length;
    const offsets: number[] = [];
    for (const o of this.objects) {
      offsets.push(pos);
      chunks.push(o);
      pos += o.length;
    }
    const rows = ['0000000000 65535 f \n', ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)];
    chunks.push(enc.encode(`xref\n0 ${this.objects.length + 1}\n${rows.join('')}trailer\n<< /Size ${this.objects.length + 1} /Root ${root} 0 R /Info ${info} 0 R >>\nstartxref\n${pos}\n%%EOF\n`));
    return concat(chunks);
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// -------------------------------------------------------------------------------------------- the annotated file

/** The reader's highlighter pen is this wide or wider, and multiplies over the page like a marker (reader/src/inkLayer.ts). */
export const HIGHLIGHTER_WIDTH = 0.02;
const NOTE_SIZE = 20;
const MARGIN = 10;

function noteText(a: Annotation): string {
  const note = a.note.trim();
  if (!note) return '';
  if (a.origin === 'ai') return `AI-generated, not the authors' text: ${note}`;
  if (a.origin === 'shared') return `${a.author || 'Shared note'}: ${note}`;
  return note;
}

const authorOf = (a: Annotation): string => (a.origin === 'ai' ? 'AI' : a.origin === 'shared' ? a.author || 'Shared' : 'Folume');

/** Pre-blends a highlight colour with the white of the page, so it can be multiplied over the text without an opacity setting. */
const lightened = ({ rgb, alpha }: Colour): Colour['rgb'] => rgb.map((c) => 1 - alpha + alpha * c) as Colour['rgb'];

export function annotatedPdf(input: AnnotatedPdfInput): { bytes: Uint8Array; summary: AnnotatedPdfSummary } {
  const { doc } = input;
  const when = input.when ?? new Date();
  const available = doc.pages.filter((p) => input.pageImages.has(p.number));
  if (!available.length) throw new Error('no_page_images');

  const pdf = new Pdf();
  const catalog = pdf.alloc();
  const pagesRoot = pdf.alloc();
  const info = pdf.alloc();
  const summary: AnnotatedPdfSummary = { pages: doc.pages.length, highlights: 0, notes: 0, strokes: 0, skipped: 0, missingPages: 0 };

  const pageNums = doc.pages.map(() => pdf.alloc());
  const pageNumberOf = new Map(doc.pages.map((p, i) => [p.number, i]));
  const annots = new Map<number, number[]>();
  const attach = (page: number, obj: number) => {
    const list = annots.get(page) ?? [];
    list.push(obj);
    annots.set(page, list);
  };
  const pageSize = (page: number) => {
    const p = doc.pages[pageNumberOf.get(page)!];
    return { w: p.width, h: p.height };
  };
  const byId = new Map(doc.blocks.map((b) => [b.id, b]));

  // highlights and sticky notes
  for (const a of input.annotations) {
    const block = byId.get(a.blockId);
    if (!block || !block.source.length) {
      summary.skipped += 1;
      continue;
    }
    const text = noteText(a);
    if (a.start === a.end) {
      // a note on the whole block: a sticky note in the margin beside it
      const region = block.source[0];
      if (!text || !pageNumberOf.has(region.page)) {
        summary.skipped += 1;
        continue;
      }
      const { w, h } = pageSize(region.page);
      const x1 = w - MARGIN;
      const x0 = x1 - NOTE_SIZE;
      const y1 = Math.min(h, h - region.bbox[1]);
      const y0 = Math.max(0, y1 - NOTE_SIZE);
      const rect = `[${n(x0)} ${n(y0)} ${n(x1)} ${n(y1)}]`;
      const ap = pdf.add(
        `<< /Type /XObject /Subtype /Form /BBox ${rect} /Resources << >> >>`,
        `1 0.92 0.35 rg ${n(x0)} ${n(y0)} ${NOTE_SIZE} ${NOTE_SIZE} re f\n0.45 0.33 0 RG 1 w ${n(x0 + 0.5)} ${n(y0 + 0.5)} ${NOTE_SIZE - 1} ${NOTE_SIZE - 1} re S\n${n(x0 + 4)} ${n(y0 + 14)} m ${n(x1 - 4)} ${n(y0 + 14)} l ${n(x0 + 4)} ${n(y0 + 10)} m ${n(x1 - 4)} ${n(y0 + 10)} l ${n(x0 + 4)} ${n(y0 + 6)} m ${n(x1 - 9)} ${n(y0 + 6)} l S`,
      );
      attach(
        region.page,
        pdf.add(
          `<< /Type /Annot /Subtype /Text /Name /Comment /Rect ${rect} /Contents ${pdfText(text)} /T ${pdfText(authorOf(a))} /NM ${pdfText(a.id)} /M ${pdfDate(new Date(a.updatedAt))} /C [1 0.92 0.35] /F 28 /AP << /N ${ap} 0 R >> >>`,
        ),
      );
      summary.notes += 1;
      continue;
    }
    const rects = highlightRects(block, a.start, a.end);
    if (!rects.length) {
      summary.skipped += 1;
      continue;
    }
    const colour = parseColor(a.color);
    const fill = lightened(colour);
    const pages = [...new Set(rects.map((r) => r.page))].filter((p) => pageNumberOf.has(p));
    pages.forEach((page, k) => {
      const mine = rects.filter((r) => r.page === page);
      const { h } = pageSize(page);
      // PDF puts the origin at the bottom left
      const flipped = mine.map((r) => ({ x0: r.x0, x1: r.x1, y0: h - r.y1, y1: h - r.y0 }));
      const box = {
        x0: Math.min(...flipped.map((r) => r.x0)),
        y0: Math.min(...flipped.map((r) => r.y0)),
        x1: Math.max(...flipped.map((r) => r.x1)),
        y1: Math.max(...flipped.map((r) => r.y1)),
      };
      const rect = `[${n(box.x0)} ${n(box.y0)} ${n(box.x1)} ${n(box.y1)}]`;
      // top-left, top-right, bottom-left, bottom-right of each line: the order viewers actually read
      const quads = flipped.map((r) => `${n(r.x0)} ${n(r.y1)} ${n(r.x1)} ${n(r.y1)} ${n(r.x0)} ${n(r.y0)} ${n(r.x1)} ${n(r.y0)}`).join(' ');
      const ap = pdf.add(
        `<< /Type /XObject /Subtype /Form /BBox ${rect} /Resources << /ExtGState << /G0 << /BM /Multiply >> >> >> >>`,
        `/G0 gs ${rgbOps(fill)} rg\n${flipped.map((r) => `${n(r.x0)} ${n(r.y0)} ${n(r.x1 - r.x0)} ${n(r.y1 - r.y0)} re`).join('\n')}\nf`,
      );
      const contents = k === 0 && text ? ` /Contents ${pdfText(text)}` : '';
      attach(
        page,
        pdf.add(
          `<< /Type /Annot /Subtype /Highlight /Rect ${rect} /QuadPoints [${quads}] /C [${rgbOps(colour.rgb)}] /Subj (Highlight)${contents} /T ${pdfText(authorOf(a))} /NM ${pdfText(`${a.id}-${page}`)} /M ${pdfDate(new Date(a.updatedAt))} /F 4 /AP << /N ${ap} 0 R >> >>`,
        ),
      );
    });
    summary.highlights += 1;
  }

  // pencil strokes
  for (const page of input.ink) {
    if (!pageNumberOf.has(page.page)) continue;
    const { w, h } = pageSize(page.page);
    for (const stroke of page.strokes) {
      if (!stroke.p.length) continue;
      const colour = parseColor(stroke.c);
      const width = Math.max(0.2, stroke.w * w);
      const pts = stroke.p.map(([x, y]) => [x * w, h - y * h] as const);
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const pad = width / 2 + 0.5;
      const rect = `[${n(Math.max(0, Math.min(...xs) - pad))} ${n(Math.max(0, Math.min(...ys) - pad))} ${n(Math.min(w, Math.max(...xs) + pad))} ${n(Math.min(h, Math.max(...ys) + pad))}]`;
      const path = pts.length === 1 ? `${n(pts[0][0])} ${n(pts[0][1])} m ${n(pts[0][0])} ${n(pts[0][1])} l` : pts.map((p, i) => `${n(p[0])} ${n(p[1])} ${i === 0 ? 'm' : 'l'}`).join(' ');
      const marker = stroke.w >= HIGHLIGHTER_WIDTH;
      const ap = pdf.add(
        `<< /Type /XObject /Subtype /Form /BBox ${rect} /Resources ${marker ? '<< /ExtGState << /G0 << /BM /Multiply >> >> >>' : '<< >>'} >>`,
        `${marker ? '/G0 gs ' : ''}${rgbOps(colour.rgb)} RG ${n(width)} w ${marker ? 0 : 1} J 1 j\n${path} S`,
      );
      attach(
        page.page,
        pdf.add(
          `<< /Type /Annot /Subtype /Ink /Rect ${rect} /InkList [[${pts.map((p) => `${n(p[0])} ${n(p[1])}`).join(' ')}]] /C [${rgbOps(colour.rgb)}] /BS << /W ${n(width)} /S /S >> /Subj (Ink) /T (Folume) /M ${pdfDate(new Date(page.updatedAt))} /F 4 /AP << /N ${ap} 0 R >> >>`,
        ),
      );
      summary.strokes += 1;
    }
  }

  // pages
  doc.pages.forEach((p, i) => {
    const jpeg = input.pageImages.get(p.number);
    let image: number | null = null;
    if (jpeg) {
      try {
        const info = jpegInfo(jpeg);
        if (info.components === 1 || info.components === 3) {
          image = pdf.add(
            `<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace /${info.components === 1 ? 'DeviceGray' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode >>`,
            jpeg,
          );
        }
      } catch {
        image = null;
      }
    }
    if (image === null) summary.missingPages += 1;
    const content = pdf.add('<< >>', image === null ? 'q Q' : `q\n${n(p.width)} 0 0 ${n(p.height)} 0 0 cm\n/Im0 Do\nQ`);
    const list = annots.get(p.number);
    pdf.set(
      pageNums[i],
      `<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 ${n(p.width)} ${n(p.height)}] /Resources << ${image === null ? '' : `/XObject << /Im0 ${image} 0 R >>`} >> /Contents ${content} 0 R${list ? ` /Annots [${list.map((o) => `${o} 0 R`).join(' ')}]` : ''} >>`,
    );
  });
  pdf.set(pagesRoot, `<< /Type /Pages /Kids [${pageNums.map((p) => `${p} 0 R`).join(' ')}] /Count ${pageNums.length} >>`);

  // table of contents from the paper's sections
  const outlines = outlineOf(pdf, doc, pageNums, pageNumberOf);

  pdf.set(
    catalog,
    `<< /Type /Catalog /Pages ${pagesRoot} 0 R${outlines === null ? '' : ` /Outlines ${outlines} 0 R /PageMode /UseOutlines`}${doc.metadata.language ? ` /Lang ${pdfText(doc.metadata.language)}` : ''} >>`,
  );
  const authors = doc.metadata.authors.join(', ');
  pdf.set(
    info,
    `<< /Title ${pdfText(titleOf(doc))}${authors ? ` /Author ${pdfText(authors)}` : ''} /Subject ${pdfText('Annotated copy of the pages of the paper')} /Creator (Folume) /Producer (Folume) /CreationDate ${pdfDate(when)} /ModDate ${pdfDate(when)} >>`,
  );
  return { bytes: pdf.finish(catalog, info), summary };
}

function outlineOf(pdf: Pdf, doc: Document, pageNums: number[], pageNumberOf: Map<number, number>): number | null {
  const sections = doc.sections.filter((s) => s.title.trim() && pageNumberOf.has(s.start_page));
  if (!sections.length) return null;
  interface Node {
    num: number;
    parent: number;
    children: Node[];
    title: string;
    page: number;
  }
  const root = pdf.alloc();
  const top: Node[] = [];
  const stack: { level: number; node: Node }[] = [];
  for (const s of sections) {
    const node: Node = { num: pdf.alloc(), parent: root, children: [], title: s.title.trim(), page: s.start_page };
    while (stack.length && stack[stack.length - 1].level >= s.level) stack.pop();
    const parent = stack[stack.length - 1]?.node;
    if (parent) {
      node.parent = parent.num;
      parent.children.push(node);
    } else {
      top.push(node);
    }
    stack.push({ level: s.level, node });
  }
  const count = (nodes: Node[]): number => nodes.reduce((total, x) => total + 1 + count(x.children), 0);
  const write = (nodes: Node[]) => {
    nodes.forEach((node, i) => {
      const page = pageNums[pageNumberOf.get(node.page)!];
      const height = doc.pages[pageNumberOf.get(node.page)!].height;
      const links = [
        node.children.length ? `/First ${node.children[0].num} 0 R /Last ${node.children[node.children.length - 1].num} 0 R /Count ${count(node.children)}` : '',
        i > 0 ? `/Prev ${nodes[i - 1].num} 0 R` : '',
        i < nodes.length - 1 ? `/Next ${nodes[i + 1].num} 0 R` : '',
      ]
        .filter(Boolean)
        .join(' ');
      pdf.set(node.num, `<< /Title ${pdfText(node.title)} /Parent ${node.parent} 0 R ${links} /Dest [${page} 0 R /XYZ 0 ${n(height)} null] >>`);
      write(node.children);
    });
  };
  write(top);
  pdf.set(root, `<< /Type /Outlines /First ${top[0].num} 0 R /Last ${top[top.length - 1].num} 0 R /Count ${count(top)} >>`);
  return root;
}
