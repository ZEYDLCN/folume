import { indexDocument } from '@/core/docModel';
import { acmGraph, ieeeMl, mlCompanion } from '@/testing/fixtures';

import { connect, relatedPapers, type PaperConcepts } from './connections';
import { extractConcepts, matchAbbreviation, normalizeTerm } from './concepts';
import { LibrarySearch, makeSnippet } from './search';

const concepts = (doc: typeof ieeeMl): PaperConcepts => ({
  docId: doc.id,
  title: doc.metadata.title ?? '',
  concepts: extractConcepts(indexDocument(doc)),
});

describe('abbreviations', () => {
  it('pairs an abbreviation with the words whose initials spell it', () => {
    expect(matchAbbreviation('LLM', ['a', 'Large', 'Language', 'Model'])).toBe('Large Language Model');
    expect(matchAbbreviation('BERT', ['called', 'Bidirectional', 'Encoder', 'Representations', 'from', 'Transformers'])).toBe(
      'Bidirectional Encoder Representations from Transformers',
    );
    expect(matchAbbreviation('SGD', ['stochastic', 'gradient', 'descent'])).toBe('stochastic gradient descent');
  });

  it('does not invent expansions', () => {
    expect(matchAbbreviation('LLM', ['we', 'train', 'a', 'model'])).toBeNull();
    expect(matchAbbreviation('X', ['anything'])).toBeNull();
    expect(matchAbbreviation('CNN', ['the', 'network', 'in', 'Table'])).toBeNull();
  });
});

describe('normalizeTerm', () => {
  it('treats plural, hyphen and case differences as the same concept', () => {
    expect(normalizeTerm('Feed-forward layers')).toBe(normalizeTerm('feed forward layer'));
    expect(normalizeTerm('Gradient Descent')).toBe(normalizeTerm('gradient descent'));
  });
});

describe('extractConcepts', () => {
  const ieee = extractConcepts(indexDocument(ieeeMl));
  const byTerm = (term: string) => ieee.find((c) => c.term.toLowerCase() === term);

  it('finds defined abbreviations with the sentence that defines them', () => {
    const llm = byTerm('large language model');
    expect(llm?.aliases).toEqual(['LLM']);
    expect(llm?.definition?.kind).toBe('abbreviation');
    expect(llm?.definition?.text).toContain('Large Language Model (LLM)');
    expect(llm?.definition?.page).toBeGreaterThanOrEqual(1);
  });

  it('finds terms the authors define explicitly', () => {
    const term = byTerm('regularization term');
    expect(term?.sources).toContain('defined');
    expect(term?.definition?.text).toMatch(/^We define the regularization term as/);
  });

  it('uses keywords and emphasised terms, and every concept points at real blocks', () => {
    expect(byTerm('expert gating')?.sources).toContain('keyword');
    expect(byTerm('positional encoding')?.sources).toContain('emphasis');
    const index = indexDocument(ieeeMl);
    for (const c of ieee) {
      expect(c.blockIds.length).toBeGreaterThan(0);
      for (const id of c.blockIds) expect(index.byId.has(id)).toBe(true);
      if (c.definition) expect(index.byId.has(c.definition.blockId)).toBe(true);
    }
  });

  it('ranks defined concepts above merely frequent phrases and leaves out filler', () => {
    const rank = (t: string) => ieee.findIndex((c) => c.term.toLowerCase() === t);
    expect(rank('regularization term')).toBeLessThan(rank('batch size'));
    const terms = ieee.map((c) => c.term.toLowerCase());
    expect(terms).not.toContain('relied heavily');
    expect(terms).not.toContain('previously assumed');
    expect(terms).not.toContain('remains poorly understood');
  });

  it('is deterministic and bounded', () => {
    expect(extractConcepts(indexDocument(ieeeMl))).toEqual(ieee);
    expect(extractConcepts(indexDocument(ieeeMl), { max: 5 })).toHaveLength(5);
  });
});

describe('connections between papers', () => {
  const a = concepts(ieeeMl);
  const b = concepts(mlCompanion);
  const g = concepts(acmGraph);

  it('connects papers through shared concepts, matching an abbreviation to its long form', () => {
    const c = connect(a, b);
    expect(c).not.toBeNull();
    const terms = c!.shared.map((s) => s.term.toLowerCase());
    expect(terms).toEqual(expect.arrayContaining(['large language model', 'token representation', 'loss landscape']));
    expect(c!.score).toBeGreaterThan(0);
    expect(c!.score).toBeLessThanOrEqual(1);
  });

  it('says how the papers relate, using only what each paper defines', () => {
    const c = connect(a, b)!;
    const llm = c.shared.find((s) => s.term.toLowerCase() === 'large language model')!;
    expect(llm.relation).toBe('both_define');
    const positional = c.shared.find((s) => s.term.toLowerCase() === 'positional encoding')!;
    expect(positional.relation).toBe('complementary');
    expect(c.shared.every((s) => s.a.blockId && s.b.blockId)).toBe(true);
  });

  it('is symmetric in what it finds and ranks the closer paper first', () => {
    expect(connect(b, a)!.shared).toHaveLength(connect(a, b)!.shared.length);
    const related = relatedPapers(ieeeMl.id, [a, b, g]);
    expect(related.map((r) => r.b)[0]).toBe(mlCompanion.id);
    expect(related.every((r) => r.a === ieeeMl.id)).toBe(true);
  });

  it('returns nothing for unrelated or unknown papers', () => {
    expect(connect(a, { docId: 'x', title: 'x', concepts: [] })).toBeNull();
    expect(relatedPapers('missing', [a, b])).toEqual([]);
  });
});

describe('LibrarySearch', () => {
  const search = new LibrarySearch([ieeeMl, mlCompanion, acmGraph]);

  it('finds blocks across papers and points back at block and page', () => {
    const hits = search.search('contrastive pretraining');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].docId).toBe(mlCompanion.id);
    expect(hits[0].blockId).toMatch(/^b\d+$/);
    expect(hits[0].page).toBeGreaterThanOrEqual(1);
    expect(hits[0].title).toBe(mlCompanion.metadata.title);
  });

  it('can be limited to one paper and by count', () => {
    const only = search.search('embedding space', { docId: acmGraph.id });
    expect(only.length).toBeGreaterThan(0);
    expect(only.every((h) => h.docId === acmGraph.id)).toBe(true);
    expect(search.search('gradient descent', { limit: 3 })).toHaveLength(3);
  });

  it('matches word forms and ignores queries that are too short or match nothing', () => {
    expect(search.search('graph laplacians').length).toBeGreaterThan(0);
    expect(search.search('a')).toEqual([]);
    expect(search.search('zzzzqqq')).toEqual([]);
  });

  it('highlights exactly what matched inside the snippet', () => {
    const [hit] = search.search('streaming modularity');
    expect(hit.ranges.length).toBeGreaterThan(0);
    for (const [s, e] of hit.ranges) expect(hit.snippet.slice(s, e).toLowerCase()).toMatch(/streaming|modularity/);
  });

  it('builds readable snippets for long text', () => {
    const text = `${'filler '.repeat(60)}the needle sits here ${'tail '.repeat(60)}`;
    const { snippet, ranges } = makeSnippet(text, 'needle');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet.length).toBeLessThan(200);
    expect(snippet.slice(ranges[0][0], ranges[0][1])).toBe('needle');
  });
});

describe('LibrarySearch.passages', () => {
  const search = new LibrarySearch([ieeeMl, mlCompanion, acmGraph]);
  const blockText = (docId: string, blockId: string) => [ieeeMl, mlCompanion, acmGraph].find((d) => d.id === docId)!.blocks.find((b) => b.id === blockId)!.text;

  it('returns whole blocks of the papers, not snippets, with where they came from', () => {
    const found = search.passages('contrastive pretraining robustness', { limit: 4 });
    expect(found.length).toBeGreaterThan(0);
    for (const p of found) {
      expect(p.text).toBe(blockText(p.docId, p.blockId));
      expect(p.page).toBeGreaterThanOrEqual(1);
      expect(p.title.length).toBeGreaterThan(0);
    }
    expect(found[0].docId).toBe(mlCompanion.id);
  });

  it('does not let one paper fill the answer', () => {
    const found = search.passages('attention mechanism gradient descent embedding space', { limit: 6, perPaper: 2 });
    const perPaper = new Map<string, number>();
    for (const p of found) perPaper.set(p.docId, (perPaper.get(p.docId) ?? 0) + 1);
    expect(Math.max(...perPaper.values())).toBeLessThanOrEqual(2);
    expect(perPaper.size).toBeGreaterThanOrEqual(2);
  });

  it('leaves out headings and one-line fragments, which prove nothing', () => {
    const found = search.passages('related work introduction method experiments', { limit: 10 });
    for (const p of found) {
      expect(p.kind === 'heading' || p.kind === 'title').toBe(false);
      expect(p.text.length).toBeGreaterThanOrEqual(40);
    }
  });

  it('finds nothing for words no paper uses, and for a query that is too short', () => {
    expect(search.passages('zebra crossing xylophone')).toEqual([]);
    expect(search.passages('a')).toEqual([]);
  });

  it('can be restricted to chosen papers', () => {
    const found = search.passages('embedding space', { limit: 5, docIds: [acmGraph.id] });
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((p) => p.docId === acmGraph.id)).toBe(true);
  });
});
