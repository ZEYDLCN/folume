/** The reader's own corrections laid over what the converter produced. The stored paper is never changed. */
import type { BlockFix } from '@/data/userdata';

import type { Block, Document, Section } from './types';

const TEXTUAL = new Set<Block['type']>(['paragraph', 'list_item', 'heading', 'caption', 'footnote', 'title', 'authors', 'reference']);

const plain = (text: string) => [{ text, bold: false, italic: false, link: null, math: false, mono: false, sub: false, sup: false, cite: [] as string[] }];
const spansText = (b: Block) => (b.spans.length ? b.spans.map((s) => s.text).join('') : b.text);

/** A copy of `doc` with the corrections applied: replaced text, changed types, hidden blocks, joined blocks. */
export function applyFixes(doc: Document, fixes: BlockFix[]): Document {
  const byId = new Map(fixes.map((f) => [f.id, f]));
  if (!doc.blocks.some((b) => byId.has(b.id))) return doc;
  const blocks: Block[] = [];
  const sections: Section[] = doc.sections.map((s) => ({ ...s }));
  for (const original of doc.blocks) {
    const f = byId.get(original.id);
    if (!f) {
      blocks.push(original);
      continue;
    }
    if (f.hidden) continue;
    let b: Block = { ...original };
    if (f.text !== null) b = { ...b, text: f.text, spans: plain(f.text) };
    if (f.type !== null && f.type !== b.type) {
      b = { ...b, type: f.type };
      if (f.type === 'heading') {
        b.level = b.level ?? 2;
        if (!sections.some((s) => s.block_id === b.id)) {
          sections.push({ id: `fx-${b.id}`, title: b.text, number: null, level: b.level, kind: 'body', block_id: b.id, parent_id: null, start_page: b.source[0]?.page ?? 1 });
        }
      } else if (original.type === 'heading') {
        const at = sections.findIndex((s) => s.block_id === b.id);
        if (at >= 0) sections.splice(at, 1);
      }
    }
    const prev = blocks[blocks.length - 1];
    if (f.mergePrev && prev && TEXTUAL.has(prev.type) && TEXTUAL.has(b.type)) {
      const head = spansText(prev);
      const glue = /[-‐‑–]$/.test(head) ? '' : ' ';
      const tail = spansText(b);
      blocks[blocks.length - 1] = {
        ...prev,
        text: `${prev.text}${glue}${b.text}`,
        spans: [...(prev.spans.length ? prev.spans : plain(prev.text)), ...(glue ? plain(' ') : []), ...(b.spans.length ? b.spans : plain(tail))],
        source: [...prev.source, ...b.source],
      };
      continue;
    }
    blocks.push(b);
  }
  return { ...doc, blocks, sections };
}
