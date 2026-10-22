import { acmGraph, clone, ieeeMl } from '@/testing/fixtures';

import { buildXrefIndex, findXrefs, romanToNumber, xrefKey } from './xref';

describe('romanToNumber', () => {
  it('reads roman numerals and leaves everything else alone', () => {
    expect(romanToNumber('I')).toBe(1);
    expect(romanToNumber('IV')).toBe(4);
    expect(romanToNumber('XIV')).toBe(14);
    expect(romanToNumber('MCM')).toBe(1900);
    expect(romanToNumber('ABC')).toBeNull();
    expect(romanToNumber('')).toBeNull();
  });
});

describe('xrefKey', () => {
  it('gives roman and arabic numbers the same key, and keeps letter suffixes', () => {
    expect(xrefKey('tab', 'II')).toBe('tab:2');
    expect(xrefKey('tab', '2')).toBe('tab:2');
    expect(xrefKey('fig', 'Fig. 3')).toBe('fig:3');
    expect(xrefKey('eq', '(7)')).toBe('eq:7');
    expect(xrefKey('fig', '3b')).toBe('fig:3b');
    expect(xrefKey('fig', 'A.1')).toBe('fig:a1');
  });
});

describe('findXrefs', () => {
  const kinds = (text: string) => findXrefs(text).map((m) => [m.kind, m.key, text.slice(m.start, m.end)]);

  it('finds figures, tables and equations as papers write them', () => {
    expect(kinds('as shown in Fig. 2 and Table II, and by Eq. (3).')).toEqual([
      ['fig', 'fig:2', 'Fig. 2'],
      ['tab', 'tab:2', 'Table II'],
      ['eq', 'eq:3', 'Eq. (3)'],
    ]);
    expect(kinds('see Figure 4a, Equation 5 and Tab. 1')).toEqual([
      ['fig', 'fig:4a', 'Figure 4a'],
      ['eq', 'eq:5', 'Equation 5'],
      ['tab', 'tab:1', 'Tab. 1'],
    ]);
  });

  it('links each number of a list, the first with its label', () => {
    expect(kinds('Figs. 1 and 2, then Tables 3–5')).toEqual([
      ['fig', 'fig:1', 'Figs. 1'],
      ['fig', 'fig:2', '2'],
      ['tab', 'tab:3', 'Tables 3'],
      ['tab', 'tab:5', '5'],
    ]);
  });

  it('does not invent references from ordinary words', () => {
    expect(findXrefs('the figure of merit, a table of contents, a configuration, equation solving')).toEqual([]);
    expect(findXrefs('Figure')).toEqual([]);
    expect(findXrefs('Table of results 2')).toEqual([]);
    expect(findXrefs('')).toEqual([]);
  });

  it('gives offsets that slice back to the matched text, never overlapping', () => {
    const text = 'Fig. 1, Fig. 2 and Eq. (4) and Table III.';
    const ms = findXrefs(text);
    for (let i = 1; i < ms.length; i++) expect(ms[i].start).toBeGreaterThanOrEqual(ms[i - 1].end);
    expect(ms.map((m) => text.slice(m.start, m.end))).toEqual(['Fig. 1', 'Fig. 2', 'Eq. (4)', 'Table III']);
  });
});

describe('buildXrefIndex', () => {
  it('points every figure, table and equation of a paper at its block, whichever numbering it uses', () => {
    const ieee = buildXrefIndex(ieeeMl.blocks);
    const figure1 = ieeeMl.blocks.find((b) => b.type === 'figure' && b.number === '1')!;
    expect(ieee.get('fig:1')).toBe(figure1.id);
    expect(ieee.get('tab:1')).toBe(ieeeMl.blocks.find((b) => b.type === 'table')!.id); // "TABLE I"
    expect(ieee.get('eq:3')).toBe(ieeeMl.blocks.filter((b) => b.type === 'equation')[2].id);
    const acm = buildXrefIndex(acmGraph.blocks);
    expect(acm.get('tab:2')).toBe(acmGraph.blocks.find((b) => b.type === 'table' && b.number === '2')!.id);
  });

  it('answers for every reference in the fixtures text', () => {
    for (const doc of [ieeeMl, acmGraph]) {
      const index = buildXrefIndex(doc.blocks);
      const missing: string[] = [];
      for (const b of doc.blocks) {
        if (b.type !== 'paragraph' && b.type !== 'list_item') continue;
        for (const m of findXrefs(b.text)) if (!index.has(m.key)) missing.push(m.key);
      }
      expect(missing).toEqual([]);
    }
  });

  it('falls back to the caption label when a figure has no number of its own', () => {
    const doc = clone(ieeeMl);
    const fig = doc.blocks.find((b) => b.type === 'figure')!;
    fig.number = null;
    expect(buildXrefIndex(doc.blocks).get('fig:1')).toBe(fig.id);
  });
});
