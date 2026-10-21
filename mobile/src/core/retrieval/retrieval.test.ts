import { indexDocument } from '@/core/docModel';
import { ieeeMl } from '@/testing/fixtures';

import { Bm25Index } from './bm25';
import { buildContext, mentionPattern, searchIndex, totalChars } from './context';
import { stem, tokenize } from './tokenize';

const idx = indexDocument(ieeeMl);
const byText = (frag: string) => ieeeMl.blocks.find((b) => b.type === 'paragraph' && b.text.includes(frag))!;

describe('tokenize', () => {
  it('lowercases, drops stopwords and adds adjacent-pair tokens', () => {
    expect(tokenize('The Gradient Descent method is used', true)).toEqual(['gradient', 'descent', 'method', 'gradient_descent', 'descent_method']);
    expect(tokenize('bu çalışma için önemli', false)).toEqual(['çalışma', 'önemli']);
  });

  it('stems plurals and common verb forms', () => {
    expect(stem('experts')).toBe('expert');
    expect(stem('routing')).toBe('rout');
    expect(stem('studies')).toBe('study');
    expect(stem('class')).toBe('class');
  });
});

describe('Bm25Index', () => {
  const docs = [
    { id: 'a', text: 'Sparse routing reduces memory because only a few experts are active.' },
    { id: 'b', text: 'We evaluate perplexity on WikiText and report accuracy for translation.' },
    { id: 'c', text: 'The gating network chooses which experts receive each token.' },
  ];
  const bm = new Bm25Index(docs);

  it('ranks the passage that matches the query best', () => {
    expect(bm.search('how many experts are active', 3)[0].id).toBe('a');
    expect(bm.search('perplexity wikitext', 3)[0].id).toBe('b');
  });

  it('returns nothing for unrelated queries and honours boosts', () => {
    expect(bm.search('quantum chromodynamics')).toEqual([]);
    const plain = bm.search('experts', 3).map((h) => h.id);
    const boosted = bm.search('experts', 3, (id) => (id === 'c' ? 5 : 1)).map((h) => h.id);
    expect(boosted[0]).toBe('c');
    expect(plain).toHaveLength(2);
  });

  it('prefers phrase matches', () => {
    const b = new Bm25Index([
      { id: 'x', text: 'gradient of the loss and descent into valleys' },
      { id: 'y', text: 'we use gradient descent to train the model' },
    ]);
    expect(b.search('gradient descent')[0].id).toBe('y');
  });
});

describe('buildContext', () => {
  it('puts the selection first and numbers passages p1..pn', () => {
    const para = byText('We optimize the objective');
    const ctx = buildContext(idx, { blockId: para.id, text: 'soft constraint' });
    expect(ctx[0]).toMatchObject({ id: 'p1', kind: 'selection', blockId: para.id, text: 'soft constraint' });
    expect(ctx.map((p) => p.id)).toEqual(ctx.map((_, i) => `p${i + 1}`));
    expect(new Set(ctx.map((p) => p.blockId + p.kind)).size).toBe(ctx.length);
    expect(ctx.some((p) => p.kind === 'abstract')).toBe(true);
    expect(ctx[0].label).toMatch(/B Training Objective|Training Objective/);
  });

  it('keeps the surrounding paragraph when only a phrase was selected', () => {
    const para = byText('We optimize the objective');
    const ctx = buildContext(idx, { blockId: para.id, text: 'soft constraint' });
    expect(ctx[1]).toMatchObject({ kind: 'context', blockId: para.id });
    expect(ctx[1].text.length).toBeGreaterThan(200);
    // selecting the whole paragraph does not duplicate it
    const whole = buildContext(idx, { blockId: para.id, text: para.text });
    expect(whole.filter((p) => p.blockId === para.id)).toHaveLength(1);
  });

  it('adds the neighbouring paragraphs of the same section and the best matches elsewhere', () => {
    const para = byText('We optimize the objective');
    const ctx = buildContext(idx, { blockId: para.id });
    const order = idx.order.get(para.id)!;
    const ids = ctx.map((p) => p.blockId);
    expect(ids).toContain(ieeeMl.blocks[order + 1].id);
    expect(ctx.some((p) => p.kind === 'retrieved')).toBe(true);
    expect(ctx.length).toBeLessThanOrEqual(8);
  });

  it('for an equation, adds the paragraphs around it and those that mention its number', () => {
    const eq = ieeeMl.blocks.find((b) => b.type === 'equation' && b.number === '(3)')!;
    const ctx = buildContext(idx, { blockId: eq.id });
    expect(ctx[0].kind).toBe('equation');
    expect(ctx[0].text).toContain('(3)');
    const texts = ctx.map((p) => p.text).join(' ');
    expect(texts).toMatch(/Eq\. \(3\)/); // a paragraph that refers to the equation
    const next = ieeeMl.blocks[idx.order.get(eq.id)! + 1];
    expect(ctx.map((p) => p.blockId)).toContain(next.id); // the "where ..." sentence
  });

  it('for a figure, uses the caption and the paragraphs that discuss it', () => {
    const fig = ieeeMl.blocks.find((b) => b.type === 'figure')!;
    const ctx = buildContext(idx, { blockId: fig.id });
    expect(ctx[0]).toMatchObject({ kind: 'caption' });
    expect(ctx[0].text).toMatch(/^Fig\. 1\./);
    expect(ctx.some((p) => /Fig\. 1 shows/.test(p.text))).toBe(true);
  });

  it('for a table, includes the cell text so numbers can be explained', () => {
    const tab = ieeeMl.blocks.find((b) => b.type === 'table')!;
    const ctx = buildContext(idx, { blockId: tab.id });
    expect(ctx[0].text).toContain('Model | Top-1 Accuracy');
  });

  it('follows in-text references to figures and tables', () => {
    const para = byText('Fig. 1 shows that the gap');
    const ctx = buildContext(idx, { blockId: para.id });
    expect(ctx.some((p) => p.kind === 'caption' && /^Fig\. 1\./.test(p.text))).toBe(true);
  });

  it('respects the passage and character budgets', () => {
    const para = byText('We optimize the objective');
    const small = buildContext(idx, { blockId: para.id }, { maxPassages: 3, budgetChars: 1500 });
    expect(small.length).toBeLessThanOrEqual(3);
    expect(totalChars(small)).toBeLessThanOrEqual(1500);
    expect(buildContext(idx, { blockId: para.id }, { maxPassages: 99 }).length).toBeLessThanOrEqual(14);
  });

  it('uses the question to retrieve relevant passages', () => {
    const para = byText('We optimize the objective');
    const ctx = buildContext(idx, { blockId: para.id, text: 'objective' }, { question: 'how is perplexity measured on WikiText' });
    expect(ctx.map((p) => p.text).join(' ')).toMatch(/perplexity/i);
  });

  it('returns nothing for an unknown block and builds the search index once per document', () => {
    expect(buildContext(idx, { blockId: 'nope' })).toEqual([]);
    expect(searchIndex(idx)).toBe(searchIndex(idx));
    expect(searchIndex(idx).size).toBeGreaterThan(20);
  });
});

describe('mentionPattern', () => {
  it('matches the ways papers refer to floats and equations', () => {
    const eq = ieeeMl.blocks.find((b) => b.type === 'equation' && b.number === '(2)')!;
    const re = mentionPattern(eq)!;
    expect(re.test('as given in Eq. (2) above')).toBe(true);
    expect(re.test('see (2)')).toBe(true);
    expect(re.test('see Eq. (3)')).toBe(false);
  });
});
