/** What every export format has in common: which blocks appear in which order, how text is made safe, and the file names. */
import { letterCount } from '../completeness';
import type { Block, Document, Section, Span } from '../types';

export type PaperFormat = 'epub' | 'html' | 'markdown' | 'text' | 'xlsx';
export type PaperLayout = 'book' | 'magazine';
export type PaperTheme = 'paper' | 'sepia' | 'dark' | 'black';

export interface PaperOptions {
  /** Book: one measure, quiet headings. Magazine: masthead, section kickers, drop caps, columns when there is room. */
  layout: PaperLayout;
  /** Colours of the standalone HTML file (an EPUB takes the colours of the reading app). */
  theme: PaperTheme;
  fontFamily: 'serif' | 'sans';
  /** Include the figure, table and equation images. Without them the text of every figure is still kept. */
  images: boolean;
  /** List the page headers, footers and page numbers that are not part of the reading text, at the end. */
  appendix: boolean;
  /** Fixed in tests so output is reproducible. */
  now?: Date;
  strings?: ExportStrings;
}

export const DEFAULT_PAPER_OPTIONS: PaperOptions = {
  layout: 'book',
  theme: 'paper',
  fontFamily: 'serif',
  images: true,
  appendix: true,
};

/** Words the exports add around the paper's own text. Kept separate so a test can account for every one of them. */
export interface ExportStrings {
  figureText: string;
  tableText: string;
  removedTitle: string;
  removedIntro: string;
  contents: string;
  page: string;
}

export const EN_EXPORT_STRINGS: ExportStrings = {
  figureText: 'Text inside the figure',
  tableText: 'Text of the table',
  removedTitle: 'Removed from the reading text',
  removedIntro: 'Running headers, footers and page numbers of the PDF. They are kept here so that no character of the PDF text is lost.',
  contents: 'Contents',
  page: 'Page',
};

export const TR_EXPORT_STRINGS: ExportStrings = {
  figureText: 'Şekil içindeki yazı',
  tableText: 'Tablo metni',
  removedTitle: 'Okuma metninden çıkarılanlar',
  removedIntro: "PDF'in üst bilgi, alt bilgi ve sayfa numaraları. PDF metninin hiçbir karakteri kaybolmasın diye burada saklanır.",
  contents: 'İçindekiler',
  page: 'Sayfa',
};

export interface PaperFile {
  filename: string;
  mime: string;
  bytes: Uint8Array;
  /** What went into the file: shown to the reader after the export. */
  summary: { blocks: number; images: number; letters: number };
}

export const MIME: Record<PaperFormat, string> = {
  epub: 'application/epub+zip',
  html: 'text/html',
  markdown: 'text/markdown',
  text: 'text/plain',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

// ----------------------------------------------------------------------------------------------------- text safety

/** XML 1.0 cannot carry most control characters or lone surrogates; none of them is a letter or a digit. */
export function xmlSafe(s: string): string {
  // eslint-disable-next-line no-control-regex
  let out = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
  if (/[\uD800-\uDFFF]/.test(out)) {
    out = out.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
  }
  return out;
}

export function esc(s: string): string {
  return xmlSafe(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A block id as an XML id (letters first, no odd characters). */
export function anchor(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9_.-]/g, '_');
  return /^[A-Za-z_]/.test(safe) ? safe : `b${safe}`;
}

const TRANSLITERATION: Record<string, string> = { ı: 'i', İ: 'I', ş: 's', Ş: 'S', ğ: 'g', Ğ: 'G', ç: 'c', Ç: 'C', ö: 'o', Ö: 'O', ü: 'u', Ü: 'U', ß: 'ss', æ: 'ae', ø: 'o', ł: 'l' };

/** A file name stem from the title: ASCII, no spaces, never empty. */
export function slugify(title: string, fallback = 'paper'): string {
  const mapped = [...title].map((c) => TRANSLITERATION[c] ?? c).join('');
  const slug = mapped
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug || fallback;
}

/** Spans that look the same are written as one, so `**a****b**` never appears. */
export function mergeSpans(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of spans) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.bold === s.bold && prev.italic === s.italic && prev.mono === s.mono && prev.sub === s.sub &&
      prev.sup === s.sup && prev.math === s.math && prev.link === s.link && prev.cite.join() === s.cite.join()
    ) {
      out[out.length - 1] = { ...prev, text: prev.text + s.text };
    } else out.push({ ...s });
  }
  return out;
}

export function sameLetters(a: string, b: string): boolean {
  if (letterCount(a) !== letterCount(b)) return false;
  const count = (t: string) => {
    const m = new Map<string, number>();
    for (const ch of t.normalize('NFKC')) if (/[\p{L}\p{N}]/u.test(ch)) m.set(ch, (m.get(ch) ?? 0) + 1);
    return m;
  };
  const ma = count(a);
  const mb = count(b);
  for (const [k, v] of ma) if (mb.get(k) !== v) return false;
  return true;
}

// ------------------------------------------------------------------------------------------------- reading order

export interface Entry {
  block: Block;
  /** the caption shown with a figure or table */
  caption: Block | null;
  /** the first paragraph of a top-level section: the magazine opens it with a drop cap */
  lead: boolean;
  /** set on the first block of a new page of the PDF (footnotes excluded), for page-break markers */
  page: number | null;
  chapter: number;
}

export interface Chapter {
  title: string;
  /** index of the first entry */
  start: number;
}

export interface Plan {
  entries: Entry[];
  chapters: Chapter[];
  byId: Map<string, Block>;
  chapterOf: Map<string, number>;
  pages: number[];
}

const isTopHeading = (b: Block, sections: Map<string, Section>) => {
  if (b.type !== 'heading') return false;
  const s = b.section_id ? sections.get(b.section_id) : undefined;
  return (s ? s.level : b.level ?? 1) <= 1;
};

/** The blocks of a document in reading order, with each caption attached to its figure and the chapter breaks marked. */
export function planPaper(doc: Document): Plan {
  const byId = new Map(doc.blocks.map((b) => [b.id, b]));
  const sections = new Map(doc.sections.map((s) => [s.id, s]));
  const attached = new Set<string>();
  for (const b of doc.blocks) {
    if ((b.type === 'figure' || b.type === 'table') && b.caption_id && byId.has(b.caption_id)) attached.add(b.caption_id);
  }
  const entries: Entry[] = [];
  const chapters: Chapter[] = [];
  const chapterOf = new Map<string, number>();
  const pages: number[] = [];
  let chapter = 0;
  let lastPage = 0;
  let afterHeading = false;
  for (const b of doc.blocks) {
    if (b.type === 'caption' && attached.has(b.id)) {
      chapterOf.set(b.id, chapter);
      continue;
    }
    if (!chapters.length) chapters.push({ title: '', start: 0 });
    else if (isTopHeading(b, sections) && entries.some((e) => e.block.type !== 'title' && e.block.type !== 'authors')) {
      chapters.push({ title: [b.prefix, b.text].filter(Boolean).join(' '), start: entries.length });
    }
    chapter = chapters.length - 1;
    let lead = false;
    if (isTopHeading(b, sections)) afterHeading = true;
    else if (afterHeading && b.type === 'paragraph') {
      lead = true;
      afterHeading = false;
    } else if (b.type !== 'heading') afterHeading = false;
    const page = b.source[0]?.page ?? 0;
    let mark: number | null = null;
    if (page && page !== lastPage && b.type !== 'footnote') {
      mark = page;
      lastPage = page;
      pages.push(page);
    }
    const caption = (b.type === 'figure' || b.type === 'table') && b.caption_id ? byId.get(b.caption_id) ?? null : null;
    entries.push({ block: b, caption, lead, page: mark, chapter });
    chapterOf.set(b.id, chapter);
    if (caption) chapterOf.set(caption.id, chapter);
  }
  if (chapters.length) chapters[0].title ||= titleOf(doc);
  return { entries, chapters, byId, chapterOf, pages };
}

/** The marker to draw before a list item: the one the PDF showed, unless the text still starts with it. */
export function listMarker(b: Block): string {
  if (b.prefix) return b.prefix;
  if (b.number && !b.text.startsWith(b.number)) return b.number;
  return '';
}

export function titleOf(doc: Document): string {
  return doc.metadata.title?.trim() || doc.source.filename.replace(/\.pdf$/i, '') || 'paper';
}

export function omittedOf(doc: Document): { page: number; text: string }[] {
  return doc.quality.omitted.map((o) => ({ page: o.page, text: o.text || o.preview })).filter((o) => o.text.trim());
}
