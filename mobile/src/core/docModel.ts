import type { Block, Document, Section } from './types';

/** Lookup tables over a document, built once per opened paper. */
export interface DocIndex {
  doc: Document;
  byId: Map<string, Block>;
  order: Map<string, number>;
  sectionById: Map<string, Section>;
  /** page number -> ids of blocks that have a source region on that page, in reading order */
  pageBlocks: Map<number, string[]>;
  references: Block[];
}

export function indexDocument(doc: Document): DocIndex {
  const byId = new Map<string, Block>();
  const order = new Map<string, number>();
  const pageBlocks = new Map<number, string[]>();
  doc.blocks.forEach((b, i) => {
    byId.set(b.id, b);
    order.set(b.id, i);
    for (const page of new Set(b.source.map((s) => s.page))) {
      const list = pageBlocks.get(page) ?? [];
      list.push(b.id);
      pageBlocks.set(page, list);
    }
  });
  return {
    doc,
    byId,
    order,
    sectionById: new Map(doc.sections.map((s) => [s.id, s])),
    pageBlocks,
    references: doc.blocks.filter((b) => b.type === 'reference'),
  };
}

export function titleOf(doc: Document): string {
  return doc.metadata.title?.trim() || doc.source.filename.replace(/\.pdf$/i, '');
}

export function firstPageOf(block: Block): number {
  return block.source[0].page;
}

/** The block whose source starts earliest on a page: used when switching from the original view back. */
export function firstBlockOnPage(index: DocIndex, page: number): string | null {
  const ids = index.pageBlocks.get(page);
  if (ids?.length) return ids[0];
  // pages with only floats/furniture: continue with the next page that has content
  for (let p = page + 1; p <= index.doc.pages.length; p++) {
    const next = index.pageBlocks.get(p);
    if (next?.length) return next[0];
  }
  return null;
}

/** Plain text of a block, falling back to its caption for figures and tables. */
export function blockText(index: DocIndex, block: Block): string {
  if (block.type === 'figure' || block.type === 'table') {
    const cap = block.caption_id ? index.byId.get(block.caption_id) : undefined;
    return cap?.text ?? '';
  }
  return block.text;
}

export interface OutlineNode {
  section: Section;
  children: OutlineNode[];
}

export function outline(doc: Document): OutlineNode[] {
  const nodes = new Map<string, OutlineNode>();
  const roots: OutlineNode[] = [];
  for (const section of doc.sections) {
    const node: OutlineNode = { section, children: [] };
    nodes.set(section.id, node);
    const parent = section.parent_id ? nodes.get(section.parent_id) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}

export function flattenOutline(nodes: OutlineNode[], depth = 0): { section: Section; depth: number }[] {
  return nodes.flatMap((n) => [{ section: n.section, depth }, ...flattenOutline(n.children, depth + 1)]);
}

/** Blocks that belong to a section (child sections included), excluding the heading itself. */
export function sectionBlocks(index: DocIndex, sectionId: string): Block[] {
  const section = index.sectionById.get(sectionId);
  if (!section) return [];
  const head = section.block_id ? index.byId.get(section.block_id) : undefined;
  const first = section.block_id ? (index.order.get(section.block_id) ?? 0) : 0;
  const out: Block[] = [];
  for (let i = head?.type === 'heading' ? first + 1 : first; i < index.doc.blocks.length; i++) {
    const b = index.doc.blocks[i];
    if (b.type === 'heading') {
      const s = b.section_id ? index.sectionById.get(b.section_id) : undefined;
      if (s && s.level <= section.level) break;
    }
    out.push(b);
  }
  return out;
}

export function wordCount(doc: Document): number {
  let n = 0;
  for (const b of doc.blocks) {
    if (b.type === 'paragraph' || b.type === 'list_item') n += b.text.split(/\s+/).filter(Boolean).length;
  }
  return n;
}

export function readingMinutes(doc: Document, wordsPerMinute = 220): number {
  return Math.max(1, Math.round(wordCount(doc) / wordsPerMinute));
}

export function hasWarnings(b: Block): boolean {
  return b.flags.some((f) => f.severity !== 'info');
}
