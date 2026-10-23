import type { Annotation } from '@/data/annotations';
import type { LibraryEntry } from '@/data/library';
import type { Card } from '@/core/learning/srs';

import { unzip } from './zip';
import { ankiTsv, noteFileName, obsidianVault, obsidianZip, readwiseCsv, type NotebookPaper } from './notebooks';

const entry = (id: string, over: Partial<LibraryEntry> = {}): LibraryEntry => ({
  id,
  title: `Paper ${id}`,
  authors: ['Quinn Rossi', 'Deniz Cohen'],
  filename: `${id}.pdf`,
  pageCount: 5,
  addedAt: 1,
  lastOpenedAt: null,
  grade: 'good',
  score: 0.9,
  percent: 0,
  sizeBytes: 1,
  year: 2024,
  doi: '10.1000/xyz123',
  language: 'en',
  tags: ['reading-group', 'to cite'],
  hasOriginalPdf: true,
  ...over,
});

const note = (id: string, docId: string, over: Partial<Annotation> = {}): Annotation => ({
  id,
  docId,
  blockId: 'b1',
  start: 0,
  end: 5,
  quote: 'Expert gating removes the need for manual tuning.',
  color: 'yellow',
  note: '',
  origin: 'user',
  tags: [],
  page: 3,
  createdAt: Date.UTC(2026, 0, 5, 10, 30, 0),
  updatedAt: Date.UTC(2026, 0, 5, 10, 30, 0),
  ...over,
});

const card = (id: string, docId: string, over: Partial<Card> = {}): Card => ({
  id,
  docId,
  kind: 'concept',
  front: 'What is “expert gating”?',
  back: 'A learned router.\nSecond line with\ttab.',
  blockIds: ['b1'],
  page: 2,
  ease: 2.5,
  interval: 0,
  reps: 0,
  lapses: 0,
  due: 0,
  createdAt: 1,
  updatedAt: 1,
  lastReviewedAt: null,
  suspended: false,
  ...over,
});

const paper = (id: string, over: Partial<NotebookPaper> = {}): NotebookPaper => ({
  entry: entry(id),
  annotations: [note(`n-${id}`, id)],
  cards: [],
  related: [],
  ...over,
});

describe('noteFileName', () => {
  it('keeps letters of any language and drops what file systems or links cannot hold', () => {
    const used = new Set<string>();
    expect(noteFileName('Sparse Routing: for “Efficient” Transformers?', used)).toBe('Sparse Routing for “Efficient” Transformers');
    expect(noteFileName('Çocuklar için şiir / öğrenme [1] #2 ^a', used)).toBe('Çocuklar için şiir öğrenme 1 2 a');
    expect(noteFileName('   ', used)).toBe('Untitled');
  });

  it('makes names unique, ignoring case, and never too long', () => {
    const used = new Set<string>();
    expect(noteFileName('Same', used)).toBe('Same');
    expect(noteFileName('same', used)).toBe('same (2)');
    expect(noteFileName('SAME', used)).toBe('SAME (3)');
    expect(noteFileName('x'.repeat(300), used).length).toBeLessThanOrEqual(100);
  });
});

describe('obsidianVault', () => {
  const files = obsidianVault([paper('a', { related: [{ title: 'Paper b', terms: ['Large Language Model'] }] }), paper('b')]);
  const byPath = new Map(files.map((f) => [f.path, f.content]));

  it('has one note per paper and an index, inside one folder', () => {
    expect([...byPath.keys()].sort()).toEqual(['Folume/Index.md', 'Folume/Paper a.md', 'Folume/Paper b.md']);
  });

  it('starts a paper’s note with properties Obsidian can search and filter by', () => {
    const md = byPath.get('Folume/Paper a.md')!;
    expect(md.startsWith('---\n')).toBe(true);
    const head = md.split('\n---\n')[0];
    expect(head).toContain('title: "Paper a"');
    expect(head).toContain('authors: ["Quinn Rossi", "Deniz Cohen"]');
    expect(head).toContain('year: 2024');
    expect(head).toContain('doi: "10.1000/xyz123"');
    expect(head).toContain('tags: ["reading-group", "to-cite", "folume"]');
    expect(head).toContain('source: "folume"');
  });

  it('quotes passages with their page, and keeps the reader’s notes apart from AI text', () => {
    const f = obsidianVault([
      paper('a', {
        annotations: [
          note('1', 'a', { note: 'Why this matters.' }),
          note('2', 'a', { page: 4, quote: 'Second quote.', note: 'Model words', origin: 'ai' }),
          note('3', 'a', { page: 1, quote: 'First quote.', note: 'From a friend', origin: 'shared', author: 'Ada' }),
        ],
      }),
    ]).find((x) => x.path === 'Folume/Paper a.md')!.content;
    const first = f.indexOf('> First quote.');
    const second = f.indexOf('> Expert gating removes');
    const third = f.indexOf('> Second quote.');
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(second);
    expect(second).toBeLessThan(third);
    expect(f).toContain('> — p. 3');
    expect(f).toContain('Why this matters.');
    expect(f).toContain("**AI-generated note** (not the authors' text):");
    expect(f).toContain('**Note from Ada:**');
  });

  it('links related papers as wiki links with the concepts they share', () => {
    const md = byPath.get('Folume/Paper a.md')!;
    expect(md).toContain('## Related papers');
    expect(md).toContain('- [[Paper b]] — Large Language Model');
  });

  it('lists review cards as question and answer', () => {
    const f = obsidianVault([paper('a', { cards: [card('c1', 'a')] })]).find((x) => x.path === 'Folume/Paper a.md')!.content;
    expect(f).toContain('## Review cards');
    expect(f).toContain('**Q:** What is “expert gating”?');
    expect(f).toContain('**A:** A learned router.');
    expect(f).toContain('(p. 2)');
  });

  it('indexes every paper as a link', () => {
    const idx = byPath.get('Folume/Index.md')!;
    expect(idx).toContain('- [[Paper a]]');
    expect(idx).toContain('- [[Paper b]]');
  });

  it('survives papers with the same title and titles with odd characters', () => {
    const f = obsidianVault([paper('a', { entry: entry('a', { title: 'A/B: "C"' }) }), paper('b', { entry: entry('b', { title: 'A/B: "C"' }) })]);
    const names = f.map((x) => x.path).filter((p) => p !== 'Folume/Index.md');
    expect(new Set(names).size).toBe(2);
    for (const n of names) expect(n).not.toMatch(/[:"?*<>|\\]|\/.*\//);
  });

  it('escapes what would break the properties block', () => {
    const f = obsidianVault([paper('a', { entry: entry('a', { title: 'He said "hi"\nthen left', authors: ['A "B" C'] }) })]).find((x) => x.path.endsWith('.md') && !x.path.endsWith('Index.md'))!.content;
    expect(f).toContain('title: "He said \\"hi\\" then left"');
    expect(f).toContain('authors: ["A \\"B\\" C"]');
  });

  it('is a ZIP that holds the same files', () => {
    const entries = unzip(obsidianZip(files));
    expect([...entries.keys()].sort()).toEqual(files.map((f) => f.path).sort());
    expect(new TextDecoder().decode(entries.get('Folume/Paper a.md')!)).toBe(byPath.get('Folume/Paper a.md'));
  });
});

describe('ankiTsv', () => {
  const entries = [entry('a'), entry('b', { tags: [] })];
  const out = ankiTsv([card('c1', 'a'), card('c2', 'b', { suspended: true }), card('c3', 'zzz')], entries);
  const lines = out.split('\n');

  it('starts with the directives Anki reads', () => {
    expect(lines.slice(0, 4)).toEqual(['#separator:tab', '#html:true', '#guid column:1', '#tags column:4']);
  });

  it('writes one row per card: stable id, front, back with its source, tags', () => {
    const rows = lines.slice(4).filter(Boolean);
    expect(rows).toHaveLength(3);
    const cols = rows[0].split('\t');
    expect(cols).toHaveLength(4);
    expect(cols[0]).toBe('folume-c1');
    expect(cols[1]).toBe('What is “expert gating”?');
    expect(cols[2]).toBe('A learned router.<br>Second line with tab.<br><br><i>Paper a, p. 2</i>');
    expect(cols[3]).toBe('folume reading-group to_cite');
  });

  it('puts markup-like words in as text, not as HTML', () => {
    const t = ankiTsv([card('c1', 'a', { front: 'Is x < y & z > w?', back: '<b>no</b>' })], entries).split('\n')[4].split('\t');
    expect(t[1]).toBe('Is x &lt; y &amp; z &gt; w?');
    expect(t[2]).toContain('&lt;b&gt;no&lt;/b&gt;');
  });

  it('keeps a card whose paper is gone, without inventing a source', () => {
    const cols = lines[6].split('\t');
    expect(cols[2]).not.toContain('<i>');
    expect(cols[3]).toBe('folume');
  });

  it('has no stray tabs or line breaks inside a field', () => {
    for (const row of lines.slice(4).filter(Boolean)) expect(row.split('\t')).toHaveLength(4);
  });
});

describe('readwiseCsv', () => {
  const entries = [entry('a'), entry('b', { doi: null, arxivId: '1706.03762' }), entry('c', { doi: null })];

  it('has the columns Readwise imports', () => {
    const csv = readwiseCsv(entries, [note('1', 'a')]);
    expect(csv.split('\r\n')[0]).toBe('Highlight,Title,Author,URL,Note,Location,Date');
  });

  it('writes a row per highlight with title, authors, link, note, page and date', () => {
    const csv = readwiseCsv(entries, [note('1', 'a', { note: 'Because, commas "quoted"' })]);
    const row = csv.split('\r\n')[1];
    expect(row).toBe('Expert gating removes the need for manual tuning.,Paper a,Quinn Rossi; Deniz Cohen,https://doi.org/10.1000/xyz123,"Because, commas ""quoted""",3,2026-01-05 10:30:00');
  });

  it('links to arXiv when there is no DOI, and to nothing when there is neither', () => {
    const rows = readwiseCsv(entries, [note('1', 'b'), note('2', 'c')]).split('\r\n');
    expect(rows[1]).toContain('https://arxiv.org/abs/1706.03762');
    expect(rows[2].split(',')[3]).toBe('');
  });

  it('leaves out marks without a quote, and papers that are gone', () => {
    const csv = readwiseCsv(entries, [note('1', 'a', { quote: '' }), note('2', 'zzz')]);
    expect(csv.trim().split('\r\n')).toHaveLength(1);
  });

  it('labels AI notes so they are not taken for the reader’s own', () => {
    const csv = readwiseCsv(entries, [note('1', 'a', { note: 'Machine words', origin: 'ai' })]);
    expect(csv).toContain('AI-generated: Machine words');
  });

  it('keeps a spreadsheet from running a note as a formula', () => {
    const csv = readwiseCsv(entries, [note('1', 'a', { note: '=HYPERLINK("http://x")' })]);
    expect(csv).toContain("'=HYPERLINK");
  });
});
