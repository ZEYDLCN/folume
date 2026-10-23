/** Converting a paper to the format the reader wants: EPUB, a web page, Markdown, plain text. All on the device. */
import { documentLetterCount } from '../completeness';
import type { Document } from '../types';
import { buildEpub } from './paperEpub';
import { buildHtml } from './paperHtml';
import { buildMarkdown, buildText } from './paperMarkdown';
import {
  DEFAULT_PAPER_OPTIONS, MIME, slugify, titleOf, type PaperFile, type PaperFormat, type PaperOptions,
} from './paperShared';
import { documentTables, tablesToXlsx } from './table';
import { zipStore } from './zip';

export type AssetLoader = (path: string) => Promise<Uint8Array | null>;
export { DEFAULT_PAPER_OPTIONS, EN_EXPORT_STRINGS, TR_EXPORT_STRINGS, slugify } from './paperShared';
export type { ExportStrings, PaperFile, PaperFormat, PaperLayout, PaperOptions, PaperTheme } from './paperShared';

export interface PaperExport extends PaperFile {
  /** every word the export added around the paper's own text (labels of collapsed figure text, the removed-text section) */
  chrome: string[];
}

/** The image files a document refers to, read once. A missing file is skipped: the text of the figure is kept anyway. */
async function loadAssets(doc: Document, load: AssetLoader): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  for (const b of doc.blocks) {
    if (b.asset && !out.has(b.asset.path)) {
      const bytes = await load(b.asset.path);
      if (bytes) out.set(b.asset.path, bytes);
    }
  }
  return out;
}

export async function exportPaper(
  doc: Document,
  format: PaperFormat,
  options: Partial<PaperOptions>,
  load: AssetLoader,
): Promise<PaperExport> {
  const opts: PaperOptions = { ...DEFAULT_PAPER_OPTIONS, ...options };
  const stem = slugify(titleOf(doc));
  const enc = new TextEncoder();
  const needsImages = opts.images && format !== 'text' && format !== 'xlsx';
  const assets = needsImages ? await loadAssets(doc, load) : new Map<string, Uint8Array>();
  const summary = (images: number) => ({ blocks: doc.blocks.length, images, letters: documentLetterCount(doc) });
  switch (format) {
    case 'epub': {
      const r = buildEpub(doc, assets, opts);
      return { filename: `${stem}.epub`, mime: MIME.epub, bytes: r.bytes, summary: summary(r.images), chrome: r.chrome };
    }
    case 'html': {
      const r = buildHtml(doc, assets, opts);
      return { filename: `${stem}.html`, mime: MIME.html, bytes: enc.encode(r.html), summary: summary(r.images), chrome: r.chrome };
    }
    case 'markdown': {
      const r = buildMarkdown(doc, assets, opts);
      if (r.images.size === 0) {
        return { filename: `${stem}.md`, mime: MIME.markdown, bytes: enc.encode(r.markdown), summary: summary(0), chrome: r.chrome };
      }
      const zip = zipStore(
        [{ name: `${stem}.md`, data: r.markdown }, ...[...r.images].map(([name, data]) => ({ name, data }))],
        opts.now,
      );
      return { filename: `${stem}.zip`, mime: 'application/zip', bytes: zip, summary: summary(r.images.size), chrome: r.chrome };
    }
    case 'xlsx': {
      const tables = documentTables(doc);
      if (!tables.length) throw new Error('no_tables');
      return { filename: `${stem}-tables.xlsx`, mime: MIME.xlsx, bytes: tablesToXlsx(tables, opts.now), summary: { blocks: tables.length, images: 0, letters: documentLetterCount(doc) }, chrome: [] };
    }
    case 'text': {
      const r = buildText(doc, opts);
      return { filename: `${stem}.txt`, mime: MIME.text, bytes: enc.encode(r.text), summary: summary(0), chrome: r.chrome };
    }
  }
}
