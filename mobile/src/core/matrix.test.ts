import { indexDocument } from '@/core/docModel';
import { acmGraph, ieeeMl, mlCompanion } from '@/testing/fixtures';

import {
  addColumn,
  addPaper,
  columnKind,
  matrixMarkdown,
  matrixProgress,
  matrixRows,
  removeColumn,
  removePaper,
  renameColumn,
  setCell,
  suggestCell,
  withPage,
  type MatrixShape,
} from './matrix';

const ieee = indexDocument(ieeeMl);

const empty = (): MatrixShape => ({
  paperIds: [],
  columns: [
    { id: 'c1', name: 'Problem' },
    { id: 'c2', name: 'Method' },
  ],
  cells: {},
});

describe('columnKind', () => {
  it('recognises the usual column names in English and Turkish', () => {
    expect(columnKind('Problem')).toBe('problem');
    expect(columnKind('Research question')).toBe('problem');
    expect(columnKind('Method')).toBe('method');
    expect(columnKind('Yöntem')).toBe('method');
    expect(columnKind('Dataset')).toBe('data');
    expect(columnKind('Veri')).toBe('data');
    expect(columnKind('Results')).toBe('results');
    expect(columnKind('Bulgular')).toBe('results');
    expect(columnKind('Limitations')).toBe('limitations');
    expect(columnKind('Sınırlılıklar')).toBe('limitations');
    expect(columnKind('Sample size')).toBe('data');
    expect(columnKind('Random seeds')).toBe('other');
  });
});

describe('suggestCell', () => {
  const blockOf = (id: string) => ieee.byId.get(id)!;

  it('only ever offers words the paper has, with the block and page they came from', () => {
    for (const column of ['Problem', 'Method', 'Dataset', 'Results', 'Limitations']) {
      const s = suggestCell(ieee, column);
      expect(s).not.toBeNull();
      const block = blockOf(s!.blockId);
      expect(block.text).toContain(s!.text);
      expect(s!.page).toBe(block.source[0].page);
    }
  });

  it('limitations come from the paper’s own statement of them', () => {
    const s = suggestCell(ieee, 'Limitations')!;
    expect(s.text).toMatch(/limitation of expert gating/i);
    expect(s.page).toBeGreaterThanOrEqual(2);
  });

  it('results are the sentence with a measured outcome', () => {
    const s = suggestCell(ieee, 'Results')!;
    expect(s.text).toMatch(/\d+%/);
  });

  it('the method is what the authors say they introduce or propose', () => {
    const s = suggestCell(ieee, 'Method')!;
    expect(s.text).toMatch(/introduce|propose|present/i);
    expect(s.text).toMatch(/expert gating/i);
  });

  it('data names a dataset', () => {
    expect(suggestCell(ieee, 'Dataset')!.text).toMatch(/WikiText-103/);
  });

  it('the problem is what the paper studies or addresses', () => {
    expect(suggestCell(ieee, 'Problem')!.text).toMatch(/study|problem|address/i);
  });

  it('works on the other papers too', () => {
    expect(suggestCell(indexDocument(acmGraph), 'Method')!.text).toMatch(/streaming modularity/i);
    expect(suggestCell(indexDocument(mlCompanion), 'Dataset')!.text).toMatch(/C4|WikiText-103/);
  });

  it('an unknown column is answered from the words of its name, or left empty', () => {
    const s = suggestCell(ieee, 'Random seeds')!;
    expect(s.text).toMatch(/seeds/i);
    expect(suggestCell(ieee, 'Zebra crossings')).toBeNull();
    expect(suggestCell(ieee, '   ')).toBeNull();
  });

  it('keeps a suggestion short enough to sit in a table cell', () => {
    for (const column of ['Problem', 'Method', 'Dataset', 'Results', 'Limitations', 'Random seeds']) {
      expect(suggestCell(ieee, column)!.text.length).toBeLessThanOrEqual(320);
    }
  });

  it('is the same every time', () => {
    expect(suggestCell(ieee, 'Results')).toEqual(suggestCell(ieee, 'Results'));
  });
});

describe('withPage', () => {
  it('puts the page after the text so a reader can go and check', () => {
    expect(withPage({ text: 'It works.', page: 4, blockId: 'b1' })).toBe('It works. (p. 4)');
  });
});

describe('project editing', () => {
  it('adds a paper once and keeps the order', () => {
    let p = addPaper(addPaper(empty(), 'a'), 'b');
    p = addPaper(p, 'a');
    expect(p.paperIds).toEqual(['a', 'b']);
  });

  it('removing a paper takes its cells with it and leaves the others', () => {
    let p = addPaper(addPaper(empty(), 'a'), 'b');
    p = setCell(setCell(p, 'a', 'c1', 'x'), 'b', 'c1', 'y');
    p = removePaper(p, 'a');
    expect(p.paperIds).toEqual(['b']);
    expect(p.cells).toEqual({ 'b|c1': 'y' });
  });

  it('a cell holds what was written, and writing nothing clears it', () => {
    let p = setCell(empty(), 'a', 'c1', '  Two  spaces and\nnewline ');
    expect(p.cells['a|c1']).toBe('Two  spaces and\nnewline');
    p = setCell(p, 'a', 'c1', '   ');
    expect(p.cells).toEqual({});
  });

  it('refuses a cell of a column that does not exist', () => {
    expect(setCell(empty(), 'a', 'nope', 'x').cells).toEqual({});
  });

  it('adds columns with fresh ids, even after one was removed', () => {
    let p = addColumn(empty(), 'Data');
    expect(p.columns.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    p = removeColumn(p, 'c2');
    p = addColumn(p, 'Results');
    expect(p.columns.map((c) => c.id)).toEqual(['c1', 'c3', 'c4']);
  });

  it('ignores an empty or duplicate column name', () => {
    expect(addColumn(empty(), '  ').columns).toHaveLength(2);
    expect(addColumn(empty(), 'problem').columns).toHaveLength(2);
  });

  it('removing a column removes what was written in it', () => {
    let p = setCell(setCell(addPaper(empty(), 'a'), 'a', 'c1', 'x'), 'a', 'c2', 'y');
    p = removeColumn(p, 'c1');
    expect(p.cells).toEqual({ 'a|c2': 'y' });
  });

  it('renaming keeps the cells', () => {
    let p = setCell(addPaper(empty(), 'a'), 'a', 'c1', 'x');
    p = renameColumn(p, 'c1', 'Aim');
    expect(p.columns[0]).toEqual({ id: 'c1', name: 'Aim' });
    expect(p.cells['a|c1']).toBe('x');
  });

  it('does not change what it was given', () => {
    const before = empty();
    const copy = JSON.stringify(before);
    addPaper(before, 'a');
    setCell(before, 'a', 'c1', 'x');
    addColumn(before, 'Data');
    expect(JSON.stringify(before)).toBe(copy);
  });
});

describe('the table', () => {
  const papers = new Map([
    ['a', { id: 'a', title: 'Sparse Routing', authors: ['Quinn Rossi', 'Deniz Cohen'], year: 2024 }],
    ['b', { id: 'b', title: 'Graphs, "quoted" | piped', authors: [], year: null }],
  ]);
  let p = addPaper(addPaper(empty(), 'a'), 'b');
  p = setCell(p, 'a', 'c1', 'Routing is slow (p. 1)');
  p = setCell(p, 'b', 'c2', 'Line one\nline | two');

  it('has a header and one row per paper in the project’s order, papers that are gone included', () => {
    const rows = matrixRows(addPaper(p, 'gone'), papers);
    expect(rows[0]).toEqual(['Paper', 'Authors', 'Year', 'Problem', 'Method']);
    expect(rows[1]).toEqual(['Sparse Routing', 'Quinn Rossi; Deniz Cohen', '2024', 'Routing is slow (p. 1)', '']);
    expect(rows[2]).toEqual(['Graphs, "quoted" | piped', '', '', '', 'Line one\nline | two']);
    expect(rows[3][0]).toBe('(paper no longer in the library)');
    expect(rows).toHaveLength(4);
  });

  it('writes a Markdown table that survives pipes and line breaks', () => {
    const md = matrixMarkdown('Review', matrixRows(p, papers));
    const lines = md.trim().split('\n');
    expect(lines[0]).toBe('# Review');
    expect(lines[2]).toBe('| Paper | Authors | Year | Problem | Method |');
    expect(lines[3]).toBe('| --- | --- | --- | --- | --- |');
    expect(lines[5]).toBe('| Graphs, "quoted" \\| piped |  |  |  | Line one<br>line \\| two |');
  });

  it('counts how much is filled in', () => {
    expect(matrixProgress(p)).toEqual({ filled: 2, total: 4 });
    expect(matrixProgress(empty())).toEqual({ filled: 0, total: 0 });
  });
});
