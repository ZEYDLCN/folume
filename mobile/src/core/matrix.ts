/**
 * The literature matrix: one row per paper, one column per question ("Problem", "Method", "Results"…).
 * The reader writes the cells; for a starting point the paper's own sentence that best answers a column can be offered,
 * with the page it came from. Nothing is ever worded by the app: a suggestion is a sentence of the paper, verbatim.
 */
import type { DocIndex } from './docModel';
import { searchIndex } from './retrieval/context';
import { tokenize } from './retrieval/tokenize';
import { splitSentences } from './speech';
import type { Block } from './types';

export interface MatrixColumn {
  id: string;
  name: string;
}

/** What the editing helpers need of a project. */
export interface MatrixShape {
  paperIds: string[];
  columns: MatrixColumn[];
  /** `${docId}|${columnId}` -> what the reader wrote */
  cells: Record<string, string>;
}

export type ColumnKind = 'problem' | 'method' | 'data' | 'results' | 'limitations' | 'other';

const KIND_WORDS: [Exclude<ColumnKind, 'other'>, RegExp][] = [
  ['limitations', /limitation|weakness|shortcoming|threats?|future work|s[ıi]n[ıi]rl[ıi]l[ıi]k|k[ıi]s[ıi]t|zay[ıi]f/i],
  ['problem', /problem|research question|motivation|\baim\b|\bgoal\b|objective of|sorun|ama[çc]|hedef|ara[şs]t[ıi]rma sorusu/i],
  ['method', /method|approach|model|architecture|technique|algorithm|y[öo]ntem|yakla[şs][ıi]m|mimari|algoritma/i],
  ['data', /data|corpus|corpora|sample|participants?|benchmark|veri|[öo]rneklem|kat[ıi]l[ıi]mc[ıi]/i],
  ['results', /result|finding|outcome|performance|accuracy|contribution|sonu[çc]|bulgu|katk[ıi]|ba[şs]ar[ıi]/i],
];

export function columnKind(name: string): ColumnKind {
  for (const [kind, re] of KIND_WORDS) if (re.test(name)) return kind;
  return 'other';
}

export interface CellSuggestion {
  /** a sentence of the paper, exactly as it is written there */
  text: string;
  blockId: string;
  page: number;
}

interface Profile {
  /** sections whose title makes a sentence more likely to answer, with how much */
  sections: [RegExp, number][];
  /** wording that makes a sentence likely to answer, with how much (each counts once) */
  cues: [RegExp, number][];
}

const PROFILES: Record<Exclude<ColumnKind, 'other'>, Profile> = {
  problem: {
    sections: [[/abstract|introduction|background|motivation/i, 2]],
    cues: [
      [/\bwe (study|address|investigate|tackle|consider|examine|focus on|ask)\b/i, 3],
      [/\b(problem|challenge|bottleneck|poorly understood|open question)\b/i, 2],
      [/\b(addresses|motivat\w+|aim|goal)\b/i, 2],
    ],
  },
  method: {
    sections: [
      [/method|approach|model|architecture|proposed|framework|technique|algorithm/i, 2],
      [/abstract|introduction/i, 1],
    ],
    cues: [
      [/\b(we|this paper|this work) (introduce|propose|present|develop|devise|design)\w*\b/i, 5],
      [/\bwe (define|use|optimi[sz]e|train|build|compute|apply|employ)\b/i, 2],
      [/\b(our (method|approach|model|algorithm|framework)|architecture|algorithm|objective)\b/i, 1],
    ],
  },
  data: {
    sections: [
      [/data|experiment|setup|evaluation|materials|participants/i, 2],
      [/abstract|introduction/i, 1],
    ],
    cues: [
      [/\b(data ?sets?|benchmarks?|corpus|corpora|samples?|participants|collected|annotated|trained on|evaluat\w+ on|fine-?tun\w+ on)\b/i, 3],
      [/\bOn [A-Z][\w-]*,/, 2],
      [/\b[A-Z][A-Za-z]+-?\d{2,}\b/, 2],
    ],
  },
  results: {
    sections: [
      [/result|experiment|evaluation|findings/i, 2],
      [/abstract|conclusion/i, 1],
    ],
    cues: [
      [/\d+(\.\d+)?\s?%/, 3],
      [/\b(outperform\w*|improv\w+|achiev\w+|reduc\w+|faster|accuracy|f1|perplexity|state[- ]of[- ]the[- ]art)\b/i, 2],
      [/\b(we find|we show|results show|shows? that)\b/i, 1],
    ],
  },
  limitations: {
    sections: [[/limitation|discussion|conclusion|future/i, 2]],
    cues: [
      [/\blimitations?\b/i, 5],
      [/\bfuture work\b/i, 3],
      [/\b(however|cannot|fails?|sensitiv\w+|restricted|assum\w+|only)\b/i, 1],
    ],
  },
};

const MIN_LENGTH = 25;
const MAX_LENGTH = 320;
const PROSE = new Set<Block['type']>(['paragraph', 'list_item']);

function sectionWeight(index: DocIndex, block: Block, profile: Profile): number {
  let best = 0;
  let id = block.section_id;
  for (let depth = 0; id && depth < 6; depth++) {
    const section = index.sectionById.get(id);
    if (!section) break;
    const title = section.kind === 'abstract' ? 'abstract' : section.title;
    for (const [re, weight] of profile.sections) if (re.test(title)) best = Math.max(best, weight);
    id = section.parent_id;
  }
  return best;
}

function sentencesOf(block: Block): string[] {
  return splitSentences(block.text)
    .map((r) => block.text.slice(r.start, r.end))
    .filter((s) => s.length >= MIN_LENGTH && s.length <= MAX_LENGTH);
}

function proseBlocks(index: DocIndex): Block[] {
  return index.doc.blocks.filter((b) => {
    if (!PROSE.has(b.type) || !b.text.trim()) return false;
    if (/^(index terms|keywords?)\b/i.test(b.text.trim())) return false;
    const section = b.section_id ? index.sectionById.get(b.section_id) : undefined;
    return section?.kind !== 'references';
  });
}

function suggestByProfile(index: DocIndex, kind: Exclude<ColumnKind, 'other'>): CellSuggestion | null {
  const profile = PROFILES[kind];
  let best: { score: number; s: CellSuggestion } | null = null;
  for (const block of proseBlocks(index)) {
    const where = sectionWeight(index, block, profile);
    for (const text of sentencesOf(block)) {
      let cue = 0;
      for (const [re, weight] of profile.cues) if (re.test(text)) cue += weight;
      if (cue === 0) continue; // being in the right section is not enough to say anything
      const score = cue + where;
      if (!best || score > best.score) best = { score, s: { text, blockId: block.id, page: block.source[0].page } };
    }
  }
  return best?.s ?? null;
}

/** A column with its own words ("Random seeds"): the sentence that shares the most of them. */
function suggestByWords(index: DocIndex, name: string): CellSuggestion | null {
  const terms = new Set(tokenize(name, false));
  if (!terms.size) return null;
  const allowed = new Set(proseBlocks(index).map((b) => b.id));
  for (const hit of searchIndex(index).search(name, 12)) {
    if (!allowed.has(hit.id)) continue;
    const block = index.byId.get(hit.id)!;
    let best: { n: number; text: string } | null = null;
    for (const text of sentencesOf(block)) {
      const n = tokenize(text, false).filter((t) => terms.has(t)).length;
      if (n > 0 && (!best || n > best.n)) best = { n, text };
    }
    if (best) return { text: best.text, blockId: block.id, page: block.source[0].page };
  }
  return null;
}

/** The paper's own sentence that best answers a column, or null when nothing in the paper does. */
export function suggestCell(index: DocIndex, columnName: string): CellSuggestion | null {
  const name = columnName.trim();
  if (!name) return null;
  const kind = columnKind(name);
  return kind === 'other' ? suggestByWords(index, name) : suggestByProfile(index, kind);
}

/** The page goes after the text so a reader can go and check it. */
export const withPage = (s: CellSuggestion): string => `${s.text} (p. ${s.page})`;

// ------------------------------------------------------------------------------------------------ editing

const key = (docId: string, columnId: string) => `${docId}|${columnId}`;

export function addPaper<P extends MatrixShape>(p: P, docId: string): P {
  return p.paperIds.includes(docId) ? p : { ...p, paperIds: [...p.paperIds, docId] };
}

export function removePaper<P extends MatrixShape>(p: P, docId: string): P {
  const prefix = `${docId}|`;
  return {
    ...p,
    paperIds: p.paperIds.filter((id) => id !== docId),
    cells: Object.fromEntries(Object.entries(p.cells).filter(([k]) => !k.startsWith(prefix))),
  };
}

/** Writing nothing clears the cell; a cell of a column that is not there is not written. */
export function setCell<P extends MatrixShape>(p: P, docId: string, columnId: string, text: string): P {
  if (!p.columns.some((c) => c.id === columnId)) return p;
  const cells = { ...p.cells };
  const value = text.trim();
  if (value) cells[key(docId, columnId)] = value;
  else delete cells[key(docId, columnId)];
  return { ...p, cells };
}

/** Ids are never reused, so a cell written long ago cannot reappear under a new column. */
export function addColumn<P extends MatrixShape>(p: P, name: string): P {
  const clean = name.trim();
  if (!clean || p.columns.some((c) => c.name.toLowerCase() === clean.toLowerCase())) return p;
  const next = Math.max(0, ...p.columns.map((c) => Number(/^c(\d+)$/.exec(c.id)?.[1] ?? 0))) + 1;
  return { ...p, columns: [...p.columns, { id: `c${next}`, name: clean }] };
}

export function renameColumn<P extends MatrixShape>(p: P, columnId: string, name: string): P {
  const clean = name.trim();
  if (!clean) return p;
  return { ...p, columns: p.columns.map((c) => (c.id === columnId ? { ...c, name: clean } : c)) };
}

export function removeColumn<P extends MatrixShape>(p: P, columnId: string): P {
  const suffix = `|${columnId}`;
  return {
    ...p,
    columns: p.columns.filter((c) => c.id !== columnId),
    cells: Object.fromEntries(Object.entries(p.cells).filter(([k]) => !k.endsWith(suffix))),
  };
}

export function matrixProgress(p: MatrixShape): { filled: number; total: number } {
  const total = p.paperIds.length * p.columns.length;
  let filled = 0;
  for (const docId of p.paperIds) for (const c of p.columns) if (p.cells[key(docId, c.id)]?.trim()) filled += 1;
  return { filled, total };
}

// ------------------------------------------------------------------------------------------------- table

export interface MatrixPaper {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
}

export const MISSING_PAPER = '(paper no longer in the library)';

/** Header and one row per paper in the project's order; what the reader wrote is kept exactly. */
export function matrixRows(p: MatrixShape, papers: Map<string, MatrixPaper>): string[][] {
  const rows: string[][] = [['Paper', 'Authors', 'Year', ...p.columns.map((c) => c.name)]];
  for (const docId of p.paperIds) {
    const paper = papers.get(docId);
    const cells = p.columns.map((c) => p.cells[key(docId, c.id)] ?? '');
    rows.push(paper ? [paper.title, paper.authors.join('; '), paper.year === null ? '' : String(paper.year), ...cells] : [MISSING_PAPER, '', '', ...cells]);
  }
  return rows;
}

const mdCell = (s: string) => s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');

export function matrixMarkdown(title: string, rows: string[][]): string {
  const [head, ...body] = rows;
  const line = (r: string[]) => `| ${r.map(mdCell).join(' | ')} |`;
  return [`# ${title}`, '', line(head), `| ${head.map(() => '---').join(' | ')} |`, ...body.map(line), ''].join('\n');
}
