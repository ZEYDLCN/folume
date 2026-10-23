/** Notes as a small file that can be sent to a colleague who has the same paper, and merged into their copy. */
import type { Annotation } from '@/data/annotations';

import type { Document } from './types';

export const NOTES_FORMAT = 'folume-notes';
export const NOTES_VERSION = 1;
const MAX_NOTES = 2000;

export interface SharedNote {
  blockId: string;
  start: number;
  end: number;
  quote: string;
  color: string;
  note: string;
  page: number;
}

export interface NotesShare {
  format: typeof NOTES_FORMAT;
  version: number;
  createdAt: number;
  author: string;
  paper: { id: string; title: string; doi: string | null };
  annotations: SharedNote[];
}

/** The reader's own notes of one paper (what a model wrote, or what someone else shared, is not re-shared). */
export function buildNotesShare(paper: { docId: string; title: string; doi: string | null }, annotations: Annotation[], author: string, now: number = Date.now()): string {
  const share: NotesShare = {
    format: NOTES_FORMAT,
    version: NOTES_VERSION,
    createdAt: now,
    author: author.trim().slice(0, 80),
    paper: { id: paper.docId, title: paper.title, doi: paper.doi },
    annotations: annotations
      .filter((a) => a.origin === 'user' && a.docId === paper.docId)
      .map((a) => ({ blockId: a.blockId, start: a.start, end: a.end, quote: a.quote, color: a.color, note: a.note, page: a.page })),
  };
  return JSON.stringify(share, null, 1);
}

export type NotesError = 'not_json' | 'wrong_format' | 'newer_version';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string';
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function parseNotesShare(text: string): { ok: true; share: NotesShare } | { ok: false; error: NotesError } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'not_json' };
  }
  if (!isObj(raw) || raw.format !== NOTES_FORMAT || !isObj(raw.paper) || !str(raw.paper.id) || !Array.isArray(raw.annotations) || !num(raw.version)) return { ok: false, error: 'wrong_format' };
  if (raw.version > NOTES_VERSION) return { ok: false, error: 'newer_version' };
  const annotations: SharedNote[] = [];
  for (const a of raw.annotations.slice(0, MAX_NOTES)) {
    if (!isObj(a) || !str(a.blockId) || !num(a.start) || !num(a.end) || !str(a.quote) || !str(a.note) || !str(a.color) || !num(a.page)) continue;
    annotations.push({ blockId: a.blockId.slice(0, 80), start: a.start, end: a.end, quote: a.quote.slice(0, 4000), color: a.color.slice(0, 60), note: a.note.slice(0, 4000), page: a.page });
  }
  return {
    ok: true,
    share: {
      format: NOTES_FORMAT,
      version: raw.version,
      createdAt: num(raw.createdAt) ? raw.createdAt : 0,
      author: (str(raw.author) ? raw.author : '').trim().slice(0, 80),
      paper: { id: raw.paper.id, title: str(raw.paper.title) ? raw.paper.title : '', doi: str(raw.paper.doi) ? raw.paper.doi : null },
      annotations,
    },
  };
}

const rendered = (b: { spans: { text: string }[]; text: string }) => (b.spans.length ? b.spans.map((s) => s.text).join('') : b.text);

export interface ImportPlan {
  error?: 'other_paper';
  add: Omit<Annotation, 'id' | 'createdAt' | 'updatedAt'>[];
  /** already here, or for a block this paper does not have */
  skipped: number;
  /** offsets that no longer matched and were found again, or fell back to a note on the whole block */
  relocated: number;
}

/** What importing `share` into this device's copy of the paper would add. */
export function planNotesImport(doc: Document, share: NotesShare, existing: Annotation[]): ImportPlan {
  if (share.paper.id !== doc.id) return { error: 'other_paper', add: [], skipped: 0, relocated: 0 };
  const byId = new Map(doc.blocks.map((b) => [b.id, b]));
  const author = share.author || 'someone';
  const plan: ImportPlan = { add: [], skipped: 0, relocated: 0 };
  for (const n of share.annotations) {
    const block = byId.get(n.blockId);
    if (!block) {
      plan.skipped += 1;
      continue;
    }
    const text = rendered(block);
    let { start, end } = n;
    const moved = !!n.quote && text.slice(start, end) !== n.quote;
    if (moved) {
      const at = text.indexOf(n.quote);
      if (at >= 0) [start, end] = [at, at + n.quote.length];
      else [start, end] = [0, 0];
    }
    const here = existing.some((a) => a.blockId === n.blockId && a.start === start && a.end === end && a.note === n.note && a.author === author && a.origin === 'shared');
    if (here) {
      plan.skipped += 1;
      continue;
    }
    if (moved) plan.relocated += 1;
    plan.add.push({ docId: doc.id, blockId: n.blockId, start, end, quote: n.quote, color: n.color, note: n.note, origin: 'shared', author, tags: [], page: n.page });
  }
  return plan;
}
