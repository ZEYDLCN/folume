/** "Fig. 3", "Table II", "Eq. (2)": finding these in running text and the blocks they point at. */
import type { Block } from './types';

export type XrefKind = 'fig' | 'tab' | 'eq';

export interface Xref {
  kind: XrefKind;
  /** normalised target, e.g. `tab:2` (roman and arabic numbers are the same) */
  key: string;
  /** the text to link: the label and number for the first of a list, the bare number for the rest */
  start: number;
  end: number;
}

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

export function romanToNumber(s: string): number | null {
  if (!/^[IVXLCDM]+$/.test(s)) return null;
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const v = ROMAN[s[i]];
    const next = ROMAN[s[i + 1]] ?? 0;
    total += v < next ? -v : v;
  }
  return total;
}

/** `tab:2` for "II", "2", "Table 2"; letter suffixes stay (`fig:3b`), appendix numbers lose their dot (`fig:a1`). */
export function xrefKey(kind: XrefKind, raw: string): string {
  const cleaned = raw.replace(/^\s*(?:figure|fig|table|tab|equation|eq)s?\.?/i, '').replace(/[()\s.]/g, '');
  const roman = romanToNumber(cleaned);
  return `${kind}:${roman !== null ? roman : cleaned.toLowerCase()}`;
}

const NUM = String.raw`(?:\d+[a-z]?|[IVXLC]+(?![a-z]))`;
const LABEL = new Map<string, XrefKind>([
  ['fig', 'fig'], ['figs', 'fig'], ['figure', 'fig'], ['figures', 'fig'],
  ['tab', 'tab'], ['tabs', 'tab'], ['table', 'tab'], ['tables', 'tab'],
  ['eq', 'eq'], ['eqs', 'eq'], ['equation', 'eq'], ['equations', 'eq'],
]);
const HEAD = new RegExp(String.raw`\b(Figures?|Figs?\.?|Tables?|Tabs?\.?|Equations?|Eqs?\.?)\s*(\(?)(${NUM})(\)?)`, 'gi');
const TAIL = new RegExp(String.raw`^\s*(?:,|and|&|–|-|to)\s*(\(?)(${NUM})(\)?)`, 'i');

/** Every reference to a figure, table or equation in `text`, in order, without overlaps. */
export function findXrefs(text: string): Xref[] {
  const out: Xref[] = [];
  HEAD.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HEAD.exec(text))) {
    const kind = LABEL.get(m[1].toLowerCase().replace(/\.$/, ''));
    if (!kind) continue;
    // a roman numeral must be written in capitals ("Table I"), or "table of" would never be a reference
    if (/^[ivxlc]+$/i.test(m[3]) && !/^\d/.test(m[3]) && m[3] !== m[3].toUpperCase()) continue;
    let end = m.index + m[0].length;
    out.push({ kind, key: xrefKey(kind, m[3]), start: m.index, end });
    // "Figs. 1 and 2", "Tables 3–5": the numbers that follow are references too
    for (;;) {
      const t = TAIL.exec(text.slice(end));
      if (!t || (/^[ivxlc]+$/i.test(t[2]) && !/^\d/.test(t[2]) && t[2] !== t[2].toUpperCase())) break;
      const start = end + t[0].length - t[1].length - t[2].length - t[3].length;
      end += t[0].length;
      out.push({ kind, key: xrefKey(kind, t[2]), start, end });
    }
    HEAD.lastIndex = end;
  }
  return out;
}

const CAPTION_LABEL = /^\s*(?:(Fig(?:ure)?s?|Tab(?:le)?s?)\.?)\s*(\d+[a-z]?|[IVXLC]+)\b/i;

/** For each figure, table and equation: the key a reference to it would have, and the block that holds it. */
export function buildXrefIndex(blocks: Block[]): Map<string, string> {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const index = new Map<string, string>();
  for (const b of blocks) {
    const kind: XrefKind | null = b.type === 'figure' ? 'fig' : b.type === 'table' ? 'tab' : b.type === 'equation' ? 'eq' : null;
    if (!kind) continue;
    let raw = b.number;
    if (!raw && b.caption_id) {
      const m = CAPTION_LABEL.exec(byId.get(b.caption_id)?.text ?? '');
      raw = m ? m[2] : null;
    }
    if (!raw) continue;
    const key = xrefKey(kind, raw);
    if (!index.has(key)) index.set(key, b.id);
  }
  return index;
}
