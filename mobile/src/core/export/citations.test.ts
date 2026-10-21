import { ieeeMl } from '@/testing/fixtures';
import { sha256Hex } from '@/core/sha256';

import { bibtexEscape, citationSourceOf, citeKeys, parseName, referencesToBibtex, toBibtex, toCslJson, toRis, type CitationSource } from './citations';

const paper: CitationSource = {
  id: 'p1',
  title: 'Sparse Routing & Efficient Transformers: 100% Faster',
  authors: ['Quinn Rossi', 'Deniz Çelik', 'van der Berg, Anna'],
  year: 2024,
  doi: '10.1234/abc_def',
  arxivId: '2401.01234',
};

describe('names', () => {
  it('splits given and family names, keeping particles with the family name', () => {
    expect(parseName('Ada Lovelace')).toEqual({ family: 'Lovelace', given: 'Ada' });
    expect(parseName('Lovelace, Ada')).toEqual({ family: 'Lovelace', given: 'Ada' });
    expect(parseName('Ludwig van der Waals')).toEqual({ family: 'van der Waals', given: 'Ludwig' });
    expect(parseName('Plato')).toEqual({ family: 'Plato', given: '' });
  });
});

describe('BibTeX', () => {
  it('escapes characters that break LaTeX', () => {
    expect(bibtexEscape('50% of A&B_c #1 {x}')).toBe('50\\% of A\\&B\\_c \\#1 \\{x\\}');
  });

  it('writes only what the PDF told us and does not invent a venue', () => {
    const out = toBibtex([paper]);
    expect(out).toContain('@misc{rossi2024sparse,');
    expect(out).toContain('author = {Rossi, Quinn and Çelik, Deniz and van der Berg, Anna}');
    expect(out).toContain('title = {{Sparse Routing \\& Efficient Transformers: 100\\% Faster}}');
    expect(out).toContain('doi = {10.1234/abc\\_def}');
    expect(out).toContain('eprint = {2401.01234}');
    expect(out).not.toMatch(/journal|booktitle|publisher/);
    const bare = toBibtex([{ id: 'x', title: 'Untitled draft', authors: [], year: null, doi: null, arxivId: null }]);
    expect(bare).not.toMatch(/author|year|doi/);
  });

  it('makes unique, ASCII keys', () => {
    const keys = citeKeys([paper, { ...paper, id: 'p2' }, { ...paper, id: 'p3', authors: ['Łukasz Ñandú'] }]);
    expect([...keys.values()]).toEqual(['rossi2024sparse', 'rossi2024sparsea', 'nandu2024sparse']);
  });

  it('exports an empty library as an empty file', () => {
    expect(toBibtex([])).toBe('');
  });
});

describe('RIS and CSL-JSON', () => {
  it('writes RIS records with CRLF line ends', () => {
    const ris = toRis([paper]);
    expect(ris).toContain('TY  - GEN\r\nTI  - Sparse Routing & Efficient Transformers: 100% Faster\r\n');
    expect(ris).toContain('AU  - Rossi, Quinn\r\n');
    expect(ris).toContain('DO  - 10.1234/abc_def');
    expect(ris.trimEnd().endsWith('ER  -')).toBe(true);
  });

  it('writes valid CSL-JSON', () => {
    const csl = JSON.parse(toCslJson([paper]));
    expect(csl[0]).toMatchObject({
      id: 'rossi2024sparse',
      type: 'article',
      DOI: '10.1234/abc_def',
      issued: { 'date-parts': [[2024]] },
    });
    expect(csl[0].author[2]).toEqual({ family: 'van der Berg', given: 'Anna' });
  });
});

describe('a paper’s own references', () => {
  it('exports its bibliography and marks every entry as machine-parsed', () => {
    const out = referencesToBibtex(ieeeMl);
    const refs = ieeeMl.blocks.filter((b) => b.type === 'reference');
    expect(refs.length).toBeGreaterThan(3);
    expect(out.match(/^@misc\{/gm)).toHaveLength(refs.length);
    expect(out.match(/verify against the PDF/g)).toHaveLength(refs.length);
    expect(new Set(out.match(/^@misc\{([^,]+),/gm)).size).toBe(refs.length);
  });

  it('builds a source from a document', () => {
    expect(citationSourceOf(ieeeMl)).toMatchObject({ id: ieeeMl.id, title: 'Sparse Routing for Efficient Transformers' });
  });
});

describe('sha256', () => {
  it('matches the standard test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
    expect(sha256Hex('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  });

  it('hashes non-ASCII text as UTF-8', () => {
    expect(sha256Hex('çay')).toHaveLength(64);
    expect(sha256Hex('çay')).not.toBe(sha256Hex('cay'));
  });
});
