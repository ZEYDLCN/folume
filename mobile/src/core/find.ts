/** Finding words inside one paper. Plain text matching that ignores case, accents, ligatures and spacing. */
import type { Document } from './types';

export interface Folded {
  text: string;
  /** for each folded character, the index of the original character it came from */
  map: number[];
}

const TURKISH_I: Record<string, string> = { ı: 'i', İ: 'i', I: 'i' };

/** Lower-cases, strips accents and compatibility forms, collapses white space; remembers where each character came from. */
export function foldForSearch(s: string): Folded {
  let text = '';
  const map: number[] = [];
  let i = 0;
  let space = false;
  for (const ch of s) {
    const at = i;
    i += ch.length;
    if (/\s/u.test(ch)) {
      if (!space && text.length) {
        text += ' ';
        map.push(at);
      }
      space = true;
      continue;
    }
    space = false;
    const base = TURKISH_I[ch] ?? ch;
    const folded = base.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
    for (const f of folded) {
      text += f;
      for (let k = 0; k < f.length; k++) map.push(at);
    }
  }
  return { text: text.endsWith(' ') ? text.slice(0, -1) : text, map: text.endsWith(' ') ? map.slice(0, -1) : map };
}

export interface FindHit {
  blockId: string;
  page: number;
  /** offsets into the text the reader draws for this block; null when the match is not in drawn text */
  range: { start: number; end: number } | null;
  before: string;
  match: string;
  after: string;
  /** the match is in page text the reading view leaves out (a header, footer or page number) */
  removed: boolean;
}

export interface FindResult {
  hits: FindHit[];
  total: number;
}

const CONTEXT = 36;
const rendered = (b: { spans: { text: string }[]; text: string }) => (b.spans.length ? b.spans.map((s) => s.text).join('') : b.text);
const oneLine = (s: string) => s.replace(/\s+/g, ' ');

function scan(
  source: string,
  needle: string,
  push: (start: number, end: number, source: string) => void,
): void {
  const f = foldForSearch(source);
  let from = 0;
  for (;;) {
    const at = f.text.indexOf(needle, from);
    if (at < 0) return;
    const start = f.map[at];
    const last = f.map[at + needle.length - 1];
    // the match ends after the whole original character the last folded character came from
    const end = last + (source.codePointAt(last)! > 0xffff ? 2 : 1);
    push(start, end, source);
    from = at + Math.max(needle.length, 1);
  }
}

/** All matches of `query` in a paper, in reading order (headers and footers last). */
export function findInDocument(doc: Document, query: string, opts: { limit?: number } = {}): FindResult {
  const needle = foldForSearch(query).text;
  const limit = opts.limit ?? 200;
  if (needle.replace(/\s/g, '').length < 2) return { hits: [], total: 0 };
  const hits: FindHit[] = [];
  let total = 0;
  const add = (blockId: string, page: number, range: FindHit['range'], source: string, start: number, end: number, removed = false) => {
    total += 1;
    if (hits.length >= limit) return;
    hits.push({
      blockId,
      page,
      range,
      before: oneLine(source.slice(Math.max(0, start - CONTEXT), start)).trimStart(),
      match: oneLine(source.slice(start, end)),
      after: oneLine(source.slice(end, end + CONTEXT)).trimEnd(),
      removed,
    });
  };
  for (const b of doc.blocks) {
    const page = b.source[0]?.page ?? 1;
    const drawn = b.type === 'figure' || b.type === 'table' ? '' : rendered(b);
    if (drawn) scan(drawn, needle, (s, e, src) => add(b.id, page, { start: s, end: e }, src, s, e));
    for (const extra of [b.prefix, b.type === 'table' && b.table ? b.table.rows.map((r) => r.join(' ')).join('\n') : b.inner_text]) {
      if (extra) scan(extra, needle, (s, e, src) => add(b.id, page, null, src, s, e));
    }
  }
  for (const o of doc.quality.omitted) {
    const text = o.text || o.preview;
    if (text) scan(text, needle, (s, e, src) => add(`omitted:${o.page}`, o.page, null, src, s, e, true));
  }
  return { hits, total };
}
