import type { Annotation } from '@/data/annotations';
import type { InkPage } from '@/data/userdata';
import { ieeeMl } from '@/testing/fixtures';
import { JPEG_GRAY, JPEG_RGB } from '@/testing/tinyJpeg';
import type { Block } from '../types';

import { readFileSync } from 'fs';
import { join } from 'path';

import { annotatedPdf, highlightRects, HIGHLIGHTER_WIDTH, jpegInfo, parseColor, pdfText, type AnnotatedPdfInput } from './annotatedPdf';

// ---------------------------------------------------------------------------------------------- a tiny PDF reader

const latin1 = (b: Uint8Array) => Array.from(b, (x) => String.fromCharCode(x)).join('');

interface Obj {
  num: number;
  body: string;
  /** bytes between `stream` and `endstream`, when there is a stream */
  stream: string | null;
}

/** Reads back what the writer wrote, checking the cross-reference table on the way. */
function readPdf(bytes: Uint8Array) {
  const s = latin1(bytes);
  expect(s.startsWith('%PDF-1.7\n')).toBe(true);
  expect(s.endsWith('%%EOF\n')).toBe(true);
  const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(s)![1]);
  expect(s.slice(start, start + 5)).toBe('xref\n');
  const head = /^xref\n0 (\d+)\n/.exec(s.slice(start))!;
  const size = Number(head[1]);
  const table = s.slice(start + head[0].length, start + head[0].length + size * 20);
  expect(table.slice(0, 20)).toBe('0000000000 65535 f \n');
  const objs = new Map<number, Obj>();
  for (let i = 1; i < size; i++) {
    const row = table.slice(i * 20, i * 20 + 20);
    expect(row).toMatch(/^\d{10} 00000 n \n$/);
    const at = Number(row.slice(0, 10));
    expect(s.slice(at, at + `${i} 0 obj\n`.length)).toBe(`${i} 0 obj\n`);
    const end = s.indexOf('\nendobj\n', at);
    expect(end).toBeGreaterThan(at);
    const inner = s.slice(at + `${i} 0 obj\n`.length, end);
    const sm = /\nstream\n/.exec(inner);
    if (sm) {
      const body = inner.slice(0, sm.index);
      const data = inner.slice(sm.index + sm[0].length);
      expect(data.endsWith('\nendstream')).toBe(true);
      const stream = data.slice(0, -'\nendstream'.length);
      expect(Number(/\/Length (\d+)/.exec(body)![1])).toBe(stream.length);
      objs.set(i, { num: i, body, stream });
    } else {
      objs.set(i, { num: i, body: inner, stream: null });
    }
  }
  const trailer = /trailer\n<<(.*?)>>\nstartxref/s.exec(s)![1];
  expect(Number(/\/Size (\d+)/.exec(trailer)![1])).toBe(size);
  const root = Number(/\/Root (\d+) 0 R/.exec(trailer)![1]);
  const info = Number(/\/Info (\d+) 0 R/.exec(trailer)![1]);
  const all = [...objs.values()];
  const withType = (type: string) => all.filter((o) => new RegExp(`/Type /${type}\\b`).test(o.body));
  const sub = (sub: string) => all.filter((o) => new RegExp(`/Subtype /${sub}\\b`).test(o.body) && /\/Type \/Annot/.test(o.body));
  const ref = (n: number) => objs.get(n)!;
  return { s, objs, root: ref(root), info: ref(info), all, withType, sub, ref };
}

const nums = (text: string) => text.trim().split(/\s+/).map(Number);
const arrayOf = (body: string, key: string): number[] => nums(new RegExp(`/${key} \\[([^\\]]*)\\]`).exec(body)![1]);
const decodeHexText = (hex: string): string => {
  const raw = hex.match(/../g)!.map((h) => parseInt(h, 16));
  expect(raw.slice(0, 2)).toEqual([0xfe, 0xff]);
  let out = '';
  for (let i = 2; i < raw.length; i += 2) out += String.fromCharCode((raw[i] << 8) | raw[i + 1]);
  return out;
};

// ------------------------------------------------------------------------------------------------------ fixtures

const para = ieeeMl.blocks.find((b) => b.type === 'paragraph' && b.text.length > 300 && b.source[0].page === 1)!;
const figure = ieeeMl.blocks.find((b) => b.type === 'figure')!;

const ann = (over: Partial<Annotation> = {}): Annotation => ({
  id: 'a1',
  docId: ieeeMl.id,
  blockId: para.id,
  start: 0,
  end: para.text.length,
  quote: para.text,
  color: 'rgba(255, 214, 0, 0.38)',
  note: '',
  origin: 'user',
  tags: [],
  page: 1,
  createdAt: Date.UTC(2026, 0, 5),
  updatedAt: Date.UTC(2026, 0, 5),
  ...over,
});

const input = (over: Partial<AnnotatedPdfInput> = {}): AnnotatedPdfInput => ({
  doc: ieeeMl,
  pageImages: new Map([
    [1, JPEG_RGB],
    [2, JPEG_GRAY],
    [3, JPEG_RGB],
  ]),
  annotations: [],
  ink: [],
  when: new Date(Date.UTC(2026, 0, 6, 12, 0, 0)),
  ...over,
});

const pageOf = (pdf: ReturnType<typeof readPdf>, n: number) => pdf.withType('Page')[n - 1];

// --------------------------------------------------------------------------------------------------------- tests

describe('jpegInfo', () => {
  it('reads size and colour components without decoding', () => {
    expect(jpegInfo(JPEG_RGB)).toEqual({ width: 8, height: 6, components: 3 });
    expect(jpegInfo(JPEG_GRAY)).toEqual({ width: 4, height: 4, components: 1 });
  });
  it('refuses what is not a JPEG', () => {
    expect(() => jpegInfo(new Uint8Array([1, 2, 3]))).toThrow();
    expect(() => jpegInfo(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toThrow();
  });
});

describe('pdfText', () => {
  it('writes plain text as a literal string and escapes what would end it', () => {
    expect(pdfText('Hello (world) \\ ok')).toBe('(Hello \\(world\\) \\\\ ok)');
    expect(pdfText('a\nb')).toBe('(a\\nb)');
  });
  it('writes anything else as UTF-16 so every letter survives', () => {
    const text = 'Güneşli bir gün: çocuklar şiir okuyup öğrendi — ığ İ 😀';
    const out = pdfText(text);
    expect(out.startsWith('<FEFF')).toBe(true);
    expect(decodeHexText(out.slice(1, -1))).toBe(text);
  });
});

describe('parseColor', () => {
  it('reads CSS colours and the names of the highlight palette', () => {
    expect(parseColor('rgba(255, 214, 0, 0.38)')).toEqual({ rgb: [1, 214 / 255, 0], alpha: 0.38 });
    expect(parseColor('#ff0000')).toEqual({ rgb: [1, 0, 0], alpha: 1 });
    expect(parseColor('#0f0')).toEqual({ rgb: [0, 1, 0], alpha: 1 });
    expect(parseColor('blue')).toEqual({ rgb: [64 / 255, 140 / 255, 1], alpha: 0.34 });
    expect(parseColor('not a colour').rgb).toEqual(parseColor('yellow').rgb);
  });
});

describe('highlightRects', () => {
  const [region] = para.source;
  const { bbox } = region;
  const whole = highlightRects(para, 0, para.text.length);

  it('covers the block’s region line by line when everything is marked', () => {
    expect(whole.length).toBeGreaterThanOrEqual(2);
    expect(Math.min(...whole.map((r) => r.x0))).toBeCloseTo(bbox[0], 1);
    expect(Math.max(...whole.map((r) => r.x1))).toBeCloseTo(bbox[2], 1);
    expect(Math.min(...whole.map((r) => r.y0))).toBeCloseTo(bbox[1], 1);
    expect(Math.max(...whole.map((r) => r.y1))).toBeCloseTo(bbox[3], 1);
    expect(whole.every((r) => r.page === region.page)).toBe(true);
  });

  it('stays inside the region and reads top to bottom', () => {
    for (const r of highlightRects(para, 40, 200)) {
      expect(r.x0).toBeGreaterThanOrEqual(bbox[0] - 0.01);
      expect(r.x1).toBeLessThanOrEqual(bbox[2] + 0.01);
      expect(r.y0).toBeGreaterThanOrEqual(bbox[1] - 0.01);
      expect(r.y1).toBeLessThanOrEqual(bbox[3] + 0.01);
      expect(r.x1).toBeGreaterThan(r.x0);
    }
    const ys = highlightRects(para, 40, 200).map((r) => r.y0);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  });

  it('marks about the share of the block that was selected', () => {
    const area = (rs: ReturnType<typeof highlightRects>) => rs.reduce((n, r) => n + (r.x1 - r.x0) * (r.y1 - r.y0), 0);
    const half = area(highlightRects(para, 0, Math.floor(para.text.length / 2)));
    expect(half / area(whole)).toBeGreaterThan(0.4);
    expect(half / area(whole)).toBeLessThan(0.6);
  });

  it('takes the ends in either order and clamps them to the text', () => {
    expect(highlightRects(para, 100, 20)).toEqual(highlightRects(para, 20, 100));
    expect(highlightRects(para, -5, para.text.length + 50)).toEqual(whole);
  });

  it('marks nothing for an empty range or an empty block', () => {
    expect(highlightRects(para, 10, 10)).toEqual([]);
    expect(highlightRects({ ...para, text: '' } as Block, 0, 5)).toEqual([]);
  });

  it('shares the text between the regions of a block that runs over a column or page', () => {
    const split = {
      ...para,
      source: [
        { page: 1, bbox: [50, 600, 300, 700] as [number, number, number, number] },
        { page: 2, bbox: [50, 60, 300, 160] as [number, number, number, number] },
      ],
    } as Block;
    const rects = highlightRects(split, 0, split.text.length);
    expect(new Set(rects.map((r) => r.page))).toEqual(new Set([1, 2]));
    const late = highlightRects(split, split.text.length - 20, split.text.length);
    expect(new Set(late.map((r) => r.page))).toEqual(new Set([2]));
  });
});

describe('annotatedPdf', () => {
  it('is a well-formed PDF with one page per page of the paper, at the paper’s size', () => {
    const { bytes, summary } = annotatedPdf(input());
    const pdf = readPdf(bytes);
    expect(pdf.root.body).toMatch(/\/Type \/Catalog/);
    const pages = pdf.withType('Page');
    expect(pages).toHaveLength(ieeeMl.pages.length);
    expect(pdf.withType('Pages')[0].body).toContain(`/Count ${ieeeMl.pages.length}`);
    expect(arrayOf(pages[0].body, 'MediaBox')).toEqual([0, 0, ieeeMl.pages[0].width, ieeeMl.pages[0].height]);
    expect(summary).toMatchObject({ pages: 3, highlights: 0, notes: 0, strokes: 0, skipped: 0, missingPages: 0 });
  });

  it('puts each page’s picture in unchanged, as the original JPEG', () => {
    const { bytes } = annotatedPdf(input());
    const pdf = readPdf(bytes);
    const images = pdf.all.filter((o) => /\/Subtype \/Image/.test(o.body));
    expect(images).toHaveLength(3);
    expect(images[0].body).toMatch(/\/Width 8\b.*\/Height 6\b|\/Height 6\b.*\/Width 8\b/s);
    expect(images[0].body).toContain('/ColorSpace /DeviceRGB');
    expect(images[0].body).toContain('/Filter /DCTDecode');
    expect(images[0].stream).toBe(latin1(JPEG_RGB));
    expect(images[1].body).toContain('/ColorSpace /DeviceGray');
    expect(images[1].stream).toBe(latin1(JPEG_GRAY));
  });

  it('draws each picture over the whole page', () => {
    const pdf = readPdf(annotatedPdf(input()).bytes);
    const contents = pdf.all.filter((o) => o.stream !== null && !/\/Subtype/.test(o.body) && /Do/.test(o.stream));
    expect(contents[0].stream).toContain(`${ieeeMl.pages[0].width} 0 0 ${ieeeMl.pages[0].height} 0 0 cm`);
    expect(contents[0].stream).toContain('/Im0 Do');
  });

  it('turns a highlight into a highlight annotation on the right page, in PDF coordinates, with an appearance', () => {
    const { bytes, summary } = annotatedPdf(input({ annotations: [ann({ note: 'Why this matters.' })] }));
    const pdf = readPdf(bytes);
    const [h] = pdf.sub('Highlight');
    expect(summary.highlights).toBe(1);
    const page = pageOf(pdf, 1);
    expect(page.body).toMatch(new RegExp(`/Annots \\[[^\\]]*\\b${h.num} 0 R`));
    const [x0, y0, x1, y1] = arrayOf(h.body, 'Rect');
    const [bx0, by0, bx1, by1] = para.source[0].bbox;
    const H = ieeeMl.pages[0].height;
    expect(x0).toBeCloseTo(bx0, 1);
    expect(x1).toBeCloseTo(bx1, 1);
    expect(y0).toBeCloseTo(H - by1, 1);
    expect(y1).toBeCloseTo(H - by0, 1);
    expect(arrayOf(h.body, 'QuadPoints').length % 8).toBe(0);
    expect(arrayOf(h.body, 'C')).toEqual([1, 0.839, 0]);
    expect(h.body).toContain('Why this matters.');
    const ap = pdf.ref(Number(/\/AP <<\s*\/N (\d+) 0 R/.exec(h.body)![1]));
    expect(ap.body).toContain('/Subtype /Form');
    expect(ap.body).toContain('/BM /Multiply');
    expect(ap.stream).toContain('1 0.939 0.62 rg');
  });

  it('keeps a Turkish note letter for letter', () => {
    const note = 'Önemli: şu çıkarım çok güzel, ığ İ';
    const pdf = readPdf(annotatedPdf(input({ annotations: [ann({ note })] })).bytes);
    const h = pdf.sub('Highlight')[0];
    expect(decodeHexText(/\/Contents <([0-9A-F]+)>/.exec(h.body)![1])).toBe(note);
  });

  it('labels a note a model wrote, and one a friend wrote', () => {
    const pdf = readPdf(
      annotatedPdf(
        input({
          annotations: [ann({ id: 'a1', note: 'Model words', origin: 'ai' }), ann({ id: 'a2', note: 'Friend words', origin: 'shared', author: 'Ada' })],
        }),
      ).bytes,
    );
    const bodies = pdf.sub('Highlight').map((h) => h.body);
    expect(bodies.some((b) => b.includes("AI-generated, not the authors' text") && b.includes('Model words'))).toBe(true);
    expect(bodies.some((b) => b.includes('Ada: Friend words'))).toBe(true);
  });

  it('puts a note on a whole block (a figure, say) as a sticky note beside it', () => {
    const { bytes, summary } = annotatedPdf(input({ annotations: [ann({ blockId: figure.id, start: 0, end: 0, quote: '', note: 'Check axis', page: figure.source[0].page })] }));
    const pdf = readPdf(bytes);
    const [t] = pdf.sub('Text');
    expect(summary.notes).toBe(1);
    expect(t.body).toContain('Check axis');
    const [x0, y0, x1, y1] = arrayOf(t.body, 'Rect');
    expect(x1 - x0).toBeGreaterThan(8);
    expect(y1 - y0).toBeGreaterThan(8);
    expect(y1).toBeLessThanOrEqual(ieeeMl.pages[figure.source[0].page - 1].height);
    expect(pdf.ref(Number(/\/AP <<\s*\/N (\d+) 0 R/.exec(t.body)![1])).stream).toBeTruthy();
  });

  it('draws pencil strokes as ink annotations with the colour, width and place the reader chose', () => {
    const ink: InkPage[] = [{ id: '2', docId: ieeeMl.id, page: 2, strokes: [{ c: '#e53935', w: 0.01, p: [[0.5, 0.25], [0.6, 0.3], [0.7, 0.2]] }], updatedAt: 1 }];
    const { bytes, summary } = annotatedPdf(input({ ink }));
    const pdf = readPdf(bytes);
    const [i] = pdf.sub('Ink');
    const { width: W, height: H } = ieeeMl.pages[1];
    expect(summary.strokes).toBe(1);
    expect(pageOf(pdf, 2).body).toContain(`${i.num} 0 R`);
    const list = nums(/\/InkList \[\s*\[([^\]]*)\]\s*\]/.exec(i.body)![1]);
    expect(list[0]).toBeCloseTo(0.5 * W, 1);
    expect(list[1]).toBeCloseTo(H - 0.25 * H, 1);
    expect(list[4]).toBeCloseTo(0.7 * W, 1);
    expect(list[5]).toBeCloseTo(H - 0.2 * H, 1);
    expect(i.body).toMatch(/\/BS << \/W 6\.12 /);
    expect(arrayOf(i.body, 'C')[0]).toBeCloseTo(0xe5 / 255, 2);
    const ap = pdf.ref(Number(/\/AP <<\s*\/N (\d+) 0 R/.exec(i.body)![1]));
    expect(ap.stream).toMatch(/RG/);
    expect(ap.stream).toMatch(/ m\b/);
    expect(ap.stream).toMatch(/ l\b/);
    expect(ap.stream).toMatch(/ S\b/);
  });

  it('draws a highlighter stroke like a marker: flat ends, multiplied over the page', () => {
    const ink: InkPage[] = [{ id: '1', docId: ieeeMl.id, page: 1, strokes: [{ c: '#ffd600', w: HIGHLIGHTER_WIDTH, p: [[0.2, 0.2], [0.6, 0.2]] }], updatedAt: 1 }];
    const pdf = readPdf(annotatedPdf(input({ ink })).bytes);
    const ap = pdf.ref(Number(/\/AP <<\s*\/N (\d+) 0 R/.exec(pdf.sub('Ink')[0].body)![1]));
    expect(ap.body).toContain('/BM /Multiply');
    expect(ap.stream).toContain(' 0 J ');
  });

  it('agrees with the reader about how wide the highlighter is', () => {
    const source = readFileSync(join(__dirname, '../../../reader/src/inkLayer.ts'), 'utf8');
    expect(Number(/const HIGHLIGHTER_WIDTH = ([\d.]+);/.exec(source)![1])).toBe(HIGHLIGHTER_WIDTH);
  });

  it('skips marks whose block is gone, and says how many', () => {
    const { summary } = annotatedPdf(input({ annotations: [ann({ blockId: 'b99999' }), ann({ id: 'a2' })] }));
    expect(summary).toMatchObject({ highlights: 1, skipped: 1 });
  });

  it('gives the paper’s sections as a table of contents that leads to their pages', () => {
    const pdf = readPdf(annotatedPdf(input()).bytes);
    expect(pdf.root.body).toMatch(/\/Outlines \d+ 0 R/);
    const items = pdf.all.filter((o) => /\/Dest \[/.test(o.body) && /\/Title/.test(o.body));
    const titled = ieeeMl.sections.filter((s) => s.kind !== 'front');
    expect(items.length).toBe(titled.length);
    const experiments = items.find((o) => o.body.includes('EXPERIMENTS'))!;
    const section = ieeeMl.sections.find((s) => s.title === 'EXPERIMENTS')!;
    const page = pdf.withType('Page')[section.start_page - 1];
    expect(experiments.body).toContain(`/Dest [${page.num} 0 R`);
    const outlines = pdf.all.find((o) => /\/Type \/Outlines/.test(o.body))!;
    expect(outlines.body).toMatch(/\/Count \d+/);
  });

  it('names the paper and its authors, and says what made the file', () => {
    const pdf = readPdf(annotatedPdf(input()).bytes);
    expect(pdf.info.body).toContain('Sparse Routing for Efficient Transformers');
    expect(pdf.info.body).toContain('/Producer (Folume)');
    expect(pdf.info.body).toContain('/CreationDate (D:20260106120000Z)');
    expect(pdf.info.body).toMatch(/\/Author /);
  });

  it('leaves a page blank, but keeps it, when its picture is missing', () => {
    const { bytes, summary } = annotatedPdf(input({ pageImages: new Map([[1, JPEG_RGB], [3, JPEG_RGB]]) }));
    const pdf = readPdf(bytes);
    expect(pdf.withType('Page')).toHaveLength(3);
    expect(pdf.all.filter((o) => /\/Subtype \/Image/.test(o.body))).toHaveLength(2);
    expect(summary.missingPages).toBe(1);
  });

  it('refuses to make a file with no page pictures at all', () => {
    expect(() => annotatedPdf(input({ pageImages: new Map() }))).toThrow('no_page_images');
  });

  it('gives the same bytes for the same input', () => {
    const a = annotatedPdf(input({ annotations: [ann({ note: 'x' })] })).bytes;
    const b = annotatedPdf(input({ annotations: [ann({ note: 'x' })] })).bytes;
    expect(latin1(a)).toBe(latin1(b));
  });
});
