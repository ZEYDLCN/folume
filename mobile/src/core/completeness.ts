import type { Block, Document } from './types';

/** Letters and digits of `text` (Unicode NFKC, case kept): the unit in which the converter proves completeness. */
export function letterCount(text: string): number {
  let n = 0;
  for (const ch of text.normalize('NFKC')) if (/[\p{L}\p{N}]/u.test(ch)) n += 1;
  return n;
}

/** Everything the PDF said inside one block: the prefix moved out of `text`, the text, and the text inside an image. */
export function blockFullText(b: Block): string {
  return [b.prefix, b.text, b.inner_text].filter((x): x is string => !!x).join(' ');
}

/** All text of a document as the converter's audit sees it, headers and footers included. */
export function documentText(doc: Document): string {
  return [...doc.blocks.map(blockFullText), ...doc.quality.omitted.map((o) => o.text || o.preview)].join('\n');
}

export function documentLetterCount(doc: Document): number {
  return letterCount(documentText(doc));
}

export type Verdict =
  | { kind: 'complete'; letters: number }
  | { kind: 'recovered'; letters: number; recovered: number }
  | { kind: 'incomplete'; letters: number; missing: number; extra: number }
  | { kind: 'unavailable' };

/** The plain answer to "is every letter of the PDF in this document?" for the report and the reader. */
export function completenessVerdict(doc: Document): Verdict {
  const c = doc.quality.completeness;
  if (!c || doc.quality.grade === 'unsupported') return { kind: 'unavailable' };
  if (!c.complete) return { kind: 'incomplete', letters: c.letters_in_pdf, missing: c.missing, extra: c.extra };
  if (c.recovered > 0) return { kind: 'recovered', letters: c.letters_in_pdf, recovered: c.recovered };
  return { kind: 'complete', letters: c.letters_in_pdf };
}
