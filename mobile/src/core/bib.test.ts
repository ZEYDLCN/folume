import { parseBibliography, parseBibTeX, parseCslJson, parseRis } from './bib';

const BIB = `
% a comment line
@article{vaswani2017,
  title = {Attention Is {All} You Need},
  author = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki and Uszkoreit, Jakob},
  year = {2017},
  journal = {Advances in Neural Information Processing Systems},
  doi = {10.48550/arXiv.1706.03762},
  eprint = {1706.03762},
  archivePrefix = {arXiv},
}
@inproceedings{devlin19,
  author = "Jacob Devlin and Ming-Wei Chang and Kenton Lee",
  title = "{BERT}: Pre-training of Deep Bidirectional Transformers for Language Understanding",
  booktitle = {NAACL},
  year = 2019,
  url = {https://arxiv.org/abs/1810.04805v2},
}
@book{knuth,
  author = {Knuth, Donald E.},
  title = {The Art of Computer Programming},
  year = {1968},
}
@misc{ozturk,
  author = {{\\"O}zt{\\"u}rk, Ay{\\c{s}}e and M{\\"u}ller, J{\\"o}rg},
  title = {Sparse \\& Fast: Routing in \\emph{Transformers}},
  year = {2024},
}
@string{ignored = "x"}
@comment{ignored too}
`;

describe('parseBibTeX', () => {
  const items = parseBibTeX(BIB);

  it('reads each entry once, whatever its type, and skips comments and strings', () => {
    expect(items.map((i) => i.title)).toEqual([
      'Attention Is All You Need',
      'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding',
      'The Art of Computer Programming',
      'Sparse & Fast: Routing in Transformers',
    ]);
  });

  it('writes names as "First Last" whichever way the file has them', () => {
    expect(items[0].authors).toEqual(['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar', 'Jakob Uszkoreit']);
    expect(items[1].authors).toEqual(['Jacob Devlin', 'Ming-Wei Chang', 'Kenton Lee']);
    expect(items[2].authors).toEqual(['Donald E. Knuth']);
  });

  it('finds the DOI, the arXiv id (eprint or url) and the year, as numbers or text', () => {
    expect(items[0]).toMatchObject({ doi: '10.48550/arXiv.1706.03762', arxivId: '1706.03762', year: 2017 });
    expect(items[1]).toMatchObject({ doi: null, arxivId: '1810.04805v2', year: 2019 });
    expect(items[2]).toMatchObject({ doi: null, arxivId: null, year: 1968 });
  });

  it('turns LaTeX accents and escapes into the letters they stand for', () => {
    expect(items[3].authors).toEqual(['Ayşe Öztürk', 'Jörg Müller']);
  });

  it('does not choke on text with no entries', () => {
    expect(parseBibTeX('')).toEqual([]);
    expect(parseBibTeX('just some prose, @ here and there')).toEqual([]);
    expect(parseBibTeX('@article{broken, title = {never closed')).toEqual([]);
  });
});

describe('parseRis', () => {
  const RIS = `TY  - JOUR
TI  - Deep Residual Learning for Image Recognition
AU  - He, Kaiming
AU  - Zhang, Xiangyu
PY  - 2016/06/27
DO  - 10.1109/CVPR.2016.90
UR  - https://arxiv.org/abs/1512.03385
ER  -

TY  - CONF
T1  - Adam: A Method for Stochastic Optimization
A1  - Kingma, Diederik P.
Y1  - 2015
ER  -
`;
  it('reads titles, authors, year, DOI and links of each record', () => {
    const items = parseRis(RIS);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: 'Deep Residual Learning for Image Recognition', authors: ['Kaiming He', 'Xiangyu Zhang'], year: 2016, doi: '10.1109/CVPR.2016.90', arxivId: '1512.03385' });
    expect(items[1]).toMatchObject({ title: 'Adam: A Method for Stochastic Optimization', authors: ['Diederik P. Kingma'], year: 2015, doi: null });
  });
});

describe('parseCslJson', () => {
  it('reads what Zotero and others export', () => {
    const json = JSON.stringify([
      { type: 'article-journal', title: 'Dropout', author: [{ family: 'Srivastava', given: 'Nitish' }, { literal: 'Hinton Lab' }], issued: { 'date-parts': [[2014, 6]] }, DOI: '10.5555/2627435.2670313' },
      { title: 'Only a title is not enough? It is.' },
    ]);
    const items = parseCslJson(json);
    expect(items[0]).toMatchObject({ title: 'Dropout', authors: ['Nitish Srivastava', 'Hinton Lab'], year: 2014, doi: '10.5555/2627435.2670313' });
    expect(items).toHaveLength(2);
    expect(parseCslJson('{"not":"a list"}')).toEqual([]);
    expect(parseCslJson('nope')).toEqual([]);
  });
});

describe('parseBibliography', () => {
  it('recognises the format from the text, so the reader just picks a file', () => {
    expect(parseBibliography(BIB).format).toBe('bibtex');
    expect(parseBibliography('TY  - JOUR\nTI  - x\nER  -\n').format).toBe('ris');
    expect(parseBibliography('[{"title":"x"}]').format).toBe('csl');
    expect(parseBibliography('hello').format).toBe('unknown');
    expect(parseBibliography(BIB).items).toHaveLength(4);
  });
});
