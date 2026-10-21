import type { DocIndex } from '@/core/docModel';
import type { Block } from '@/core/types';
import { stem } from '@/core/retrieval/tokenize';

export type ConceptSource = 'abbreviation' | 'defined' | 'emphasis' | 'keyword' | 'heading' | 'frequent';

export interface ConceptDefinition {
  text: string;
  blockId: string;
  page: number;
  kind: 'abbreviation' | 'definition';
}

/** A term the paper itself introduces, defines or keeps returning to. */
export interface Concept {
  /** normalized form used to recognise the same concept in another paper */
  key: string;
  term: string;
  aliases: string[];
  definition: ConceptDefinition | null;
  /** blocks that mention it, in reading order (capped) */
  blockIds: string[];
  count: number;
  score: number;
  sources: ConceptSource[];
}

const TEXT_TYPES = new Set<Block['type']>(['paragraph', 'list_item', 'heading', 'caption', 'footnote']);

const SMALL = new Set('of and for the from in on with to a an at by via over under'.split(' '));

// words that never make a concept on their own, nor start/end a phrase
const WEAK = new Set(
  (
    'the a an of and or for to in on at by with from as is are was were be been being it its this that these those ' +
    'we our us they their them he she his her which who whom whose what when where while whereas than then thus hence ' +
    'also not no nor but yet so if such each every both either neither any all some most more less many much few ' +
    'can could may might must shall should will would do does did done has have had having very only just ' +
    'however therefore moreover furthermore instead rather again further here there into onto upon about above below ' +
    'between among across along against during before after since until via per one two three four five'
  ).split(' '),
);

const GENERIC = new Set(
  (
    'paper papers approach approaches method methods result results work works section sections figure figures table ' +
    'tables fig eq equation equations show shows shown propose proposed present presented introduce introduced novel ' +
    'new study studies based using used use ingredient case cases way ways kind number numbers example examples ' +
    'future related prior previous recent large small high higher low lower good better best key main general ' +
    'standard simple efficient extensive thorough formal setting settings problem problems analysis experiment ' +
    'experiments experimental evaluation discussion conclusion conclusions introduction abstract appendix reference ' +
    'references et al'
  ).split(' '),
);

const SECTION_TITLES = new Set(
  (
    'abstract introduction related work background preliminaries method methods methodology approach experiments ' +
    'experimental setup results discussion conclusion conclusions future work acknowledgments acknowledgements ' +
    'references appendix limitations overview evaluation'
  ).split(' '),
);

const LY_OK = new Set('anomaly assembly family supply reply monopoly'.split(' '));

/** Phrases picked only because they repeat must read like noun phrases: no adverbs, no trailing participles. */
function nounPhraseLike(words: string[]): boolean {
  const lower = words.map((w) => w.toLowerCase());
  if (lower.some((w) => w.length >= 6 && w.endsWith('ly') && !LY_OK.has(w))) return false;
  const last = lower[lower.length - 1];
  return !(last.length > 4 && last.endsWith('ed'));
}

const wordsOf = (text: string): string[] => text.match(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu) ?? [];

/** Stemmed, lowercase, hyphen-insensitive form: "Feed-forward layers" and "feedforward layer" should meet. */
export function normalizeTerm(term: string): string {
  return wordsOf(term.replace(/[-‐‑–]/g, ' ').toLowerCase())
    .map((w) => stem(w.replace(/['’]s$/, '')))
    .join(' ');
}

const stripDeterminers = (s: string): string => s.replace(/^(?:the|a|an|this|our|its|their)\s+/i, '').trim();

function plausibleTerm(term: string): boolean {
  const words = wordsOf(term);
  if (words.length === 0 || words.length > 6) return false;
  if (words.every((w) => WEAK.has(w.toLowerCase()) || GENERIC.has(w.toLowerCase()))) return false;
  if (WEAK.has(words[0].toLowerCase()) || WEAK.has(words[words.length - 1].toLowerCase())) return false;
  if (words.length === 1 && words[0].length < 3) return false;
  if (/^\d/.test(words[0])) return false;
  return true;
}

// ---------------------------------------------------------------------------------- abbreviations

/** "Large Language Model" + "LLM": the abbreviation's letters must follow the initials of the words in order. */
export function matchAbbreviation(abbr: string, before: string[]): string | null {
  const letters = abbr.replace(/[^A-Za-z]/g, '').toUpperCase();
  if (letters.length < 2) return null;
  for (let take = letters.length; take <= Math.min(before.length, letters.length + 3); take++) {
    const window = before.slice(before.length - take);
    if (!window.every((w) => /^[\p{L}][\p{L}\-]*$/u.test(w))) break;
    const initials = window.map((w) => w[0].toUpperCase());
    if (initials[0] !== letters[0]) continue;
    // every abbreviation letter must be an initial, in order; skipped words must be small connectors
    let li = 0;
    let ok = true;
    for (let wi = 0; wi < window.length; wi++) {
      if (li < letters.length && initials[wi] === letters[li]) li++;
      else if (!SMALL.has(window[wi].toLowerCase())) {
        ok = false;
        break;
      }
    }
    if (ok && li === letters.length) return window.join(' ');
  }
  return null;
}

interface Candidate {
  surface: string;
  sources: Set<ConceptSource>;
  aliases: Set<string>;
  definition: ConceptDefinition | null;
  weight: number;
}

const DEFINITION_PATTERNS: RegExp[] = [
  /\b(?:we|I)\s+(?:define|call|denote|term|refer to)\s+(?:the\s+|a\s+|an\s+)?(.{3,60}?)\s+(?:as|by)\b/i,
  /^(?:the\s+|a\s+|an\s+)?(.{3,60}?)\s+(?:is|are)\s+(?:defined|called|known|referred to|termed)\s+as\b/i,
  /\b(?:known as|referred to as|so-called|termed)\s+(?:the\s+|a\s+|an\s+)?([\p{L}][\p{L}\- ]{2,40}?)(?=[,.;:)]|\s+(?:and|which|that|is|are)\b|$)/iu,
  /^(?:the\s+|a\s+|an\s+)?([\p{L}][\p{L}\- ]{2,50}?)\s+refers to\b/iu,
];

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z(])/).map((s) => s.trim()).filter(Boolean);
}

// -------------------------------------------------------------------------------------- extraction

export function extractConcepts(index: DocIndex, opts: { max?: number } = {}): Concept[] {
  const doc = index.doc;
  const candidates = new Map<string, Candidate>();
  const textBlocks = doc.blocks.filter((b) => TEXT_TYPES.has(b.type) && b.text.trim());

  const add = (surface: string, source: ConceptSource, weight: number, extra: { aliases?: string[]; definition?: ConceptDefinition } = {}): Candidate | null => {
    const clean = stripDeterminers(surface.replace(/\s+/g, ' ').replace(/^[\s"'“”‘’(]+|[\s"'“”‘’).,;:]+$/g, ''));
    if (!plausibleTerm(clean)) return null;
    const key = normalizeTerm(clean);
    if (!key) return null;
    const existing = candidates.get(key);
    if (existing) {
      existing.sources.add(source);
      existing.weight += weight;
      for (const a of extra.aliases ?? []) existing.aliases.add(a);
      if (extra.definition && !existing.definition) existing.definition = extra.definition;
      if (source === 'abbreviation' || source === 'keyword') existing.surface = clean;
      return existing;
    }
    const cand: Candidate = {
      surface: source === 'heading' ? clean.toLowerCase() : clean,
      sources: new Set([source]),
      aliases: new Set(extra.aliases ?? []),
      definition: extra.definition ?? null,
      weight,
    };
    candidates.set(key, cand);
    return cand;
  };

  for (const kw of doc.metadata.keywords) add(kw, 'keyword', 2);

  for (const b of textBlocks) {
    const page = b.source[0].page;
    if (b.type === 'heading') {
      const t = b.text.replace(/^[\dIVX.\s]+/, '').trim();
      if (!SECTION_TITLES.has(t.toLowerCase()) && wordsOf(t).length >= 2) add(t, 'heading', 1);
      continue;
    }

    // "Large Language Model (LLM)"
    for (const m of b.text.matchAll(/\(([A-Z][A-Za-z0-9]{1,9}s?)\)/g)) {
      const abbr = m[1].replace(/s$/, '');
      const before = wordsOf(b.text.slice(0, m.index)).slice(-(abbr.length + 3));
      const long = matchAbbreviation(abbr, before);
      if (!long) continue;
      const sentence = sentences(b.text).find((s) => s.includes(m[0])) ?? b.text;
      add(long, 'abbreviation', 3, {
        aliases: [abbr],
        definition: { text: sentence, blockId: b.id, page, kind: 'abbreviation' },
      });
    }

    // "We define X as ...", "X is defined as ...", "known as X"
    if (b.type === 'paragraph' || b.type === 'list_item') {
      for (const s of sentences(b.text)) {
        for (const re of DEFINITION_PATTERNS) {
          const m = re.exec(s);
          if (!m) continue;
          const term = stripDeterminers(m[1]);
          if (/^(?:it|this|that|these|those|they|we|which)\b/i.test(term)) continue;
          add(term, 'defined', 3, { definition: { text: s, blockId: b.id, page, kind: 'definition' } });
          break;
        }
      }
    }

    // terms set in italics or bold are usually the ones the authors introduce
    if (b.type === 'paragraph' || b.type === 'list_item') {
      for (const sp of b.spans) {
        if ((!sp.italic && !sp.bold) || sp.math || sp.cite.length || sp.sub || sp.sup) continue;
        const t = sp.text.trim().replace(/[:—–-]+$/, '').trim();
        if (!t || t === b.text.trim() || wordsOf(t).length > 5 || /[.!?]$/.test(t)) continue;
        add(t, 'emphasis', 2);
      }
    }
  }

  // phrases that keep coming back (2-3 words, no weak words at the edges)
  const counts = new Map<string, { surface: string; blocks: Set<string>; n: number }>();
  for (const b of textBlocks) {
    if (b.type === 'heading' || b.type === 'caption' || b.type === 'footnote') continue;
    const words = wordsOf(b.text.replace(/[-‐‑]/g, '-'));
    for (let n = 2; n <= 3; n++) {
      for (let i = 0; i + n <= words.length; i++) {
        const gram = words.slice(i, i + n);
        if (gram.some((w) => /\d/.test(w))) continue;
        const lower = gram.map((w) => w.toLowerCase());
        if (WEAK.has(lower[0]) || WEAK.has(lower[n - 1]) || lower.some((w) => w.length < 3 && !SMALL.has(w))) continue;
        if (lower.some((w, k) => k > 0 && k < n - 1 && !SMALL.has(w) && WEAK.has(w))) continue;
        if (lower.some((w) => GENERIC.has(w)) || !nounPhraseLike(gram)) continue;
        const key = lower.map(stem).join(' ');
        const e = counts.get(key) ?? { surface: lower.join(' '), blocks: new Set<string>(), n: 0 };
        e.n += 1;
        e.blocks.add(b.id);
        counts.set(key, e);
      }
    }
  }
  const frequent = [...counts.entries()].filter(([, e]) => e.n >= 4 && e.blocks.size >= 2);
  const longer = frequent.filter(([k]) => k.split(' ').length === 3);
  for (const [key, e] of frequent) {
    const isBigram = key.split(' ').length === 2;
    // a bigram that nearly always appears inside one trigram is just part of it
    if (isBigram && longer.some(([k3, e3]) => (k3.startsWith(`${key} `) || k3.endsWith(` ${key}`)) && e3.n >= 0.8 * e.n)) continue;
    add(e.surface, 'frequent', Math.min(2, Math.log2(e.n)));
  }

  // count real occurrences with the final key list
  const keys = [...candidates.keys()];
  const padded = textBlocks
    .filter((b) => b.type !== 'heading')
    .map((b) => ({ id: b.id, norm: ` ${wordsOf(b.text.replace(/[-‐‑–]/g, ' ').toLowerCase()).map((w) => stem(w.replace(/['’]s$/, ''))).join(' ')} `, text: b.text }));

  const concepts: Concept[] = [];
  for (const key of keys) {
    const c = candidates.get(key) as Candidate;
    const needle = ` ${key} `;
    const abbrRes = [...c.aliases].map((a) => new RegExp(`(?<![\\p{L}\\p{N}])${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?(?![\\p{L}\\p{N}])`, 'u'));
    const blockIds: string[] = [];
    let count = 0;
    for (const p of padded) {
      let n = p.norm.split(needle).length - 1;
      for (const re of abbrRes) n += (p.text.match(new RegExp(re.source, 'gu')) ?? []).length;
      if (n > 0) {
        count += n;
        blockIds.push(p.id);
      }
    }
    if (count === 0 && !c.definition) continue;
    const sources = [...c.sources];
    const strong = sources.some((s) => s === 'abbreviation' || s === 'defined');
    const score =
      c.weight +
      (c.definition ? 2 : 0) +
      (strong ? 1 : 0) +
      Math.log(1 + count) +
      (blockIds.length >= 3 ? 0.5 : 0);
    // a phrase that appears once and carries no signal is noise
    if (!strong && count < 2 && !sources.includes('keyword')) continue;
    concepts.push({
      key,
      term: c.surface,
      aliases: [...c.aliases],
      definition: c.definition,
      blockIds: blockIds.slice(0, 24),
      count,
      score: Math.round(score * 100) / 100,
      sources,
    });
  }
  concepts.sort((a, b) => b.score - a.score || a.term.localeCompare(b.term));
  return concepts.slice(0, opts.max ?? 40);
}
