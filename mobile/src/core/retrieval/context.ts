import type { DocIndex } from '../docModel';
import type { Block } from '../types';
import { Bm25Index } from './bm25';

export type PassageKind = 'selection' | 'context' | 'retrieved' | 'caption' | 'equation' | 'abstract' | 'section';

/** A piece of the paper that may be sent to the AI gateway; `blockId` lets answers link back to the source. */
export interface ContextPassage {
  id: string;
  blockId: string;
  kind: PassageKind;
  text: string;
  label: string;
  page: number;
}

export interface ContextOptions {
  maxPassages?: number;
  budgetChars?: number;
  question?: string;
}

export interface Selection {
  blockId: string;
  /** the selected text; defaults to the whole block */
  text?: string;
}

const SEARCHABLE = new Set(['paragraph', 'list_item', 'caption', 'footnote']);
const MAX_PASSAGE = 1400;
const MAX_SELECTION = 3500;
const cache = new WeakMap<DocIndex, Bm25Index>();

export function searchIndex(index: DocIndex): Bm25Index {
  let idx = cache.get(index);
  if (!idx) {
    idx = new Bm25Index(
      index.doc.blocks.filter((b) => SEARCHABLE.has(b.type) && b.text.length > 20).map((b) => ({ id: b.id, text: b.text })),
    );
    cache.set(index, idx);
  }
  return idx;
}

export function sectionLabel(index: DocIndex, b: Block): string {
  const s = b.section_id ? index.sectionById.get(b.section_id) : undefined;
  const name = s ? `${s.number ? `${s.number} ` : ''}${s.title}`.trim() : '';
  const page = `p. ${b.source[0].page}`;
  return name ? `${name}, ${page}` : page;
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/** Regexes that find in-text mentions of a figure, table or equation ("Fig. 2", "Table I", "Eq. (3)"). */
export function mentionPattern(b: Block): RegExp | null {
  const raw = (b.number ?? '').replace(/[().:\s]/g, '');
  if (!raw) return null;
  const n = raw.replace(/^(fig(ure)?|table|tab|eq)\.?/i, '');
  if (!n) return null;
  if (b.type === 'equation') return new RegExp(`\\(${n}\\)|\\beq(?:uation)?s?\\.?\\s*\\(?${n}\\)?`, 'i');
  if (b.type === 'figure') return new RegExp(`\\bfig(?:ure)?s?\\.?\\s*${n}\\b`, 'i');
  if (b.type === 'table') return new RegExp(`\\btab(?:le)?s?\\.?\\s*${n}\\b`, 'i');
  return null;
}

function numberOf(b: Block, index: DocIndex): string {
  // figures/tables carry the label in their caption ("Fig. 2." / "TABLE I")
  const cap = b.caption_id ? index.byId.get(b.caption_id) : undefined;
  return (b.number && b.type === 'equation' ? b.number : (cap?.number ?? b.number ?? '')) as string;
}

function tableText(b: Block): string {
  return b.table ? b.table.rows.map((r) => r.join(' | ')).join('\n') : '';
}

export function buildContext(
  index: DocIndex,
  selection: Selection,
  opts: ContextOptions = {},
): ContextPassage[] {
  const maxPassages = Math.min(opts.maxPassages ?? 8, 14);
  const budget = opts.budgetChars ?? 12000;
  const block = index.byId.get(selection.blockId);
  if (!block) return [];
  const out: Omit<ContextPassage, 'id'>[] = [];
  const used = new Set<string>();
  let chars = 0;

  const add = (b: Block, kind: PassageKind, text: string, max = MAX_PASSAGE): boolean => {
    const t = clip(text, max);
    if (!t || used.has(`${b.id}:${kind}`) || out.length >= maxPassages || chars + t.length > budget) return false;
    used.add(`${b.id}:${kind}`);
    used.add(b.id);
    chars += t.length;
    out.push({ blockId: b.id, kind, text: t, label: sectionLabel(index, b), page: b.source[0].page });
    return true;
  };

  // 1. what the reader selected
  let selText = selection.text ?? block.text;
  let selKind: PassageKind = 'selection';
  if (block.type === 'figure' || block.type === 'table') {
    const cap = block.caption_id ? index.byId.get(block.caption_id) : undefined;
    selText = [cap?.text ?? '', tableText(block)].filter(Boolean).join('\n');
    selKind = 'caption';
  } else if (block.type === 'equation') {
    selText = `${block.text}${block.number ? `   ${block.number}` : ''}`;
    selKind = 'equation';
  }
  add(block, selKind, selText, MAX_SELECTION);
  // a term or phrase means little alone: keep the paragraph it was selected from as context
  if (selKind === 'selection' && selection.text && clip(selection.text, 1e9) !== clip(block.text, 1e9)) {
    add(block, 'context', block.text);
  }

  // 2. the paper in a nutshell
  const abstractSec = index.doc.sections.find((s) => s.kind === 'abstract');
  const abstractBlock = abstractSec?.block_id
    ? index.doc.blocks.slice(index.order.get(abstractSec.block_id) ?? 0).find((b) => b.type === 'paragraph')
    : undefined;
  if (abstractBlock && abstractBlock.id !== block.id && index.doc.metadata.abstract) {
    add(abstractBlock, 'abstract', index.doc.metadata.abstract, 700);
  }

  // 3. mentions: the discussion of a figure/table/equation, or the objects this text points to
  const own = block.type === 'equation' || block.type === 'figure' || block.type === 'table' ? mentionPattern({ ...block, number: numberOf(block, index) }) : null;
  const order = index.order.get(block.id) ?? 0;
  if (own) {
    for (const b of index.doc.blocks) {
      if ((b.type === 'paragraph' || b.type === 'list_item') && own.test(b.text)) add(b, 'context', b.text);
    }
  }
  if (block.type === 'equation') {
    // the sentence after display math ("where x is ...") defines the symbols
    for (const off of [1, -1]) {
      const nb = index.doc.blocks[order + off];
      if (nb && nb.type === 'paragraph') add(nb, 'context', nb.text);
    }
  }
  const text = selection.text ?? block.text;
  for (const m of text.matchAll(/\b(fig(?:ure)?s?|table|tab|eq(?:uation)?s?)\.?\s*\(?([0-9]+|[IVX]+)\)?/gi)) {
    const kind = m[1].toLowerCase().startsWith('fig') ? 'figure' : m[1].toLowerCase().startsWith('t') ? 'table' : 'equation';
    const target = index.doc.blocks.find((b) => {
      if (b.type !== kind) return false;
      const num = numberOf(b, index).replace(/[().:\s]/g, '').replace(/^(fig(ure)?|table|tab|eq)\.?/i, '');
      return num.toLowerCase() === m[2].toLowerCase();
    });
    if (!target) continue;
    const cap = target.caption_id ? index.byId.get(target.caption_id) : undefined;
    if (cap) add(cap, 'caption', cap.text);
    else if (target.type === 'equation') add(target, 'equation', target.text);
  }

  // 4. neighbours in the same section
  if (block.type === 'paragraph' || block.type === 'list_item') {
    for (const off of [-1, 1]) {
      const nb = index.doc.blocks[order + off];
      if (nb && nb.type === 'paragraph' && nb.section_id === block.section_id) add(nb, 'context', nb.text);
    }
  }

  // 5. the best matches elsewhere in the paper (same section counts for a little more)
  const query = `${selText} ${opts.question ?? ''}`;
  const hits = searchIndex(index).search(query, 12, (id) => (index.byId.get(id)?.section_id === block.section_id ? 1.25 : 1));
  for (const h of hits) {
    const b = index.byId.get(h.id);
    if (b && !used.has(b.id)) add(b, b.type === 'caption' ? 'caption' : 'retrieved', b.text);
  }

  return out.map((p, i) => ({ ...p, id: `p${i + 1}` }));
}

export function totalChars(passages: ContextPassage[]): number {
  return passages.reduce((a, p) => a + p.text.length, 0);
}
