import { normalizeTerm, type Concept, type ConceptDefinition } from './concepts';

export interface PaperConcepts {
  docId: string;
  title: string;
  concepts: Concept[];
}

/**
 * How two papers relate through one concept, judged only from what the papers themselves say:
 *  - `common`: both use it
 *  - `complementary`: only one of them defines it, so the other can be read with that definition
 *  - `both_define`: both define it; whether the definitions agree is for the reader (or optional AI) to judge
 */
export type Relation = 'common' | 'complementary' | 'both_define';

export interface ConceptRef {
  term: string;
  definition: ConceptDefinition | null;
  blockId: string | null;
  count: number;
}

export interface SharedConcept {
  key: string;
  term: string;
  relation: Relation;
  a: ConceptRef;
  b: ConceptRef;
  /** product of the two concepts' scores: how prominent it is in both */
  weight: number;
}

export interface Connection {
  a: string;
  b: string;
  /** 0..1, cosine-like overlap of the two papers' concept weights */
  score: number;
  shared: SharedConcept[];
}

const refOf = (c: Concept): ConceptRef => ({
  term: c.term,
  definition: c.definition,
  blockId: c.definition?.blockId ?? c.blockIds[0] ?? null,
  count: c.count,
});

/** Every spelling under which a concept can be recognised elsewhere ("Large Language Model", "LLM"). */
const matchKeys = (c: Concept): string[] => [c.key, ...c.aliases.map(normalizeTerm)].filter(Boolean);

function relation(a: Concept, b: Concept): Relation {
  if (a.definition && b.definition) return 'both_define';
  if (a.definition || b.definition) return 'complementary';
  return 'common';
}

export function connect(a: PaperConcepts, b: PaperConcepts): Connection | null {
  const byKey = new Map<string, Concept>();
  for (const c of b.concepts) for (const k of matchKeys(c)) if (!byKey.has(k)) byKey.set(k, c);
  const used = new Set<Concept>();
  const shared: SharedConcept[] = [];
  for (const ca of a.concepts) {
    const cb = matchKeys(ca)
      .map((k) => byKey.get(k))
      .find((c): c is Concept => !!c && !used.has(c));
    if (!cb) continue;
    used.add(cb);
    shared.push({
      key: ca.key,
      term: ca.term.length >= cb.term.length && ca.aliases.length >= cb.aliases.length ? ca.term : cb.term,
      relation: relation(ca, cb),
      a: refOf(ca),
      b: refOf(cb),
      weight: Math.round(ca.score * cb.score * 100) / 100,
    });
  }
  if (!shared.length) return null;
  shared.sort((x, y) => y.weight - x.weight || x.term.localeCompare(y.term));
  const sum = (cs: Concept[]) => cs.reduce((t, c) => t + c.score, 0);
  // Bhattacharyya coefficient of the two score distributions: 1 when the papers are about the same things
  const overlap = shared.reduce((t, s) => t + Math.sqrt(s.weight), 0);
  const score = overlap / Math.sqrt(Math.max(sum(a.concepts), 1) * Math.max(sum(b.concepts), 1));
  return { a: a.docId, b: b.docId, score: Math.round(Math.min(1, score) * 1000) / 1000, shared };
}

/** Papers connected to `docId`, strongest first. */
export function relatedPapers(docId: string, papers: PaperConcepts[], opts: { minShared?: number } = {}): Connection[] {
  const me = papers.find((p) => p.docId === docId);
  if (!me) return [];
  const out: Connection[] = [];
  for (const other of papers) {
    if (other.docId === docId) continue;
    const c = connect(me, other);
    if (c && c.shared.length >= (opts.minShared ?? 1)) out.push(c);
  }
  return out.sort((x, y) => y.score - x.score || y.shared.length - x.shared.length || x.b.localeCompare(y.b));
}
