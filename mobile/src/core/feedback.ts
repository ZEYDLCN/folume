/** A small file the reader can send to the developers when the conversion got a block wrong. Nothing leaves the device by itself. */
import { zipStore } from './export/zip';
import type { Document } from './types';


export interface FeedbackInput {
  doc: Document;
  blockId: string;
  note: string;
  appVersion: string;
  /** the picture of the page the block is on, if it is to be included */
  pageImage?: Uint8Array | null;
  now?: Date;
}

const brief = (b: Document['blocks'][number] | undefined) => (b ? { id: b.id, type: b.type, text: b.text.slice(0, 80) } : null);

export function buildFeedbackBundle(input: FeedbackInput): { filename: string; bytes: Uint8Array } {
  const { doc, blockId } = input;
  const at = doc.blocks.findIndex((b) => b.id === blockId);
  if (at < 0) throw new Error('block not found in this paper');
  const block = doc.blocks[at];
  const pageNo = block.source[0]?.page ?? 1;
  const page = doc.pages.find((p) => p.number === pageNo);
  const when = input.now ?? new Date();
  const q = doc.quality;
  const report = {
    format: 'folume-feedback',
    version: 1,
    createdAt: when.toISOString(),
    appVersion: input.appVersion,
    note: input.note,
    paper: { id: doc.id, schema_version: doc.schema_version, parser: doc.parser, page_count: doc.pages.length, producer: doc.source.producer },
    page: page ? { number: page.number, width: page.width, height: page.height } : { number: pageNo },
    block,
    before: brief(doc.blocks[at - 1]),
    after: brief(doc.blocks[at + 1]),
    quality: {
      grade: q.grade,
      score: q.score,
      completeness: q.completeness,
      page: q.pages.find((p) => p.page === pageNo) ?? null,
      issues: q.issues,
    },
  };
  const entries = [{ name: 'report.json', data: JSON.stringify(report, null, 1) }] as { name: string; data: string | Uint8Array }[];
  if (input.pageImage) entries.push({ name: `page-${pageNo}.jpg`, data: input.pageImage });
  return { filename: `folume-feedback-${doc.id.slice(0, 8)}-${blockId}.zip`, bytes: zipStore(entries, when) };
}
