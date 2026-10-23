import { citationSourceOf } from '@/core/export/citations';
import { ieeeMl } from '@/testing/fixtures';

import { formatQuote, type CitationStyle } from './quote';

const source = { ...citationSourceOf(ieeeMl), authors: ['Quinn Rossi', 'Deniz Cohen', 'Ada van der Berg'], year: 2024, doi: '10.1000/xyz123' };
const quote = '  Expert gating removes the   need\nfor manual tuning. ';

describe('formatQuote', () => {
  it('APA: the quote, the author-date-page citation, then the full reference', () => {
    const out = formatQuote(quote, { source, page: 3, style: 'apa' });
    expect(out).toBe(
      '“Expert gating removes the need for manual tuning.” (Rossi et al., 2024, p. 3)\n\n' +
        `Rossi, Q., Cohen, D., & van der Berg, A. (2024). ${source.title}. https://doi.org/10.1000/xyz123`,
    );
  });

  it('MLA: author and page, and a works-cited entry', () => {
    const out = formatQuote(quote, { source, page: 3, style: 'mla' });
    expect(out.split('\n\n')[0]).toBe('“Expert gating removes the need for manual tuning.” (Rossi et al. 3)');
    expect(out.split('\n\n')[1]).toBe(`Rossi, Quinn, et al. “${source.title}.” 2024, https://doi.org/10.1000/xyz123.`);
  });

  it('IEEE: a numbered citation with the page, and the numbered entry', () => {
    const out = formatQuote(quote, { source, page: 3, style: 'ieee' });
    expect(out.split('\n\n')[0]).toBe('“Expert gating removes the need for manual tuning.” [1, p. 3]');
    expect(out.split('\n\n')[1]).toBe(`[1] Q. Rossi, D. Cohen, and A. van der Berg, “${source.title},” 2024, doi: 10.1000/xyz123.`);
  });

  it('names one or two authors in full and falls back to the title without authors', () => {
    const one = formatQuote('x y', { source: { ...source, authors: ['Ada Lovelace'] }, page: 1, style: 'apa' });
    expect(one.split('\n\n')[0]).toBe('“x y” (Lovelace, 2024, p. 1)');
    const two = formatQuote('x y', { source: { ...source, authors: ['Ada Lovelace', 'Alan Turing'] }, page: 1, style: 'apa' });
    expect(two.split('\n\n')[0]).toBe('“x y” (Lovelace & Turing, 2024, p. 1)');
    const none = formatQuote('x y', { source: { ...source, authors: [], title: 'A very long title of a paper without any author' }, page: 1, style: 'apa' });
    expect(none.split('\n\n')[0]).toBe('“x y” (A very long title of a paper…, 2024, p. 1)');
  });

  it('never makes up what the paper does not say: no year is n.d., no DOI is no link', () => {
    const out = formatQuote('x', { source: { ...source, year: null, doi: null, arxivId: null }, page: 2, style: 'apa' });
    expect(out).toContain('(Rossi et al., n.d., p. 2)');
    expect(out).not.toContain('doi.org');
    expect(out.split('\n\n')[1]).toMatch(/\(n\.d\.\)\. .*\.$/);
    const arxiv = formatQuote('x', { source: { ...source, doi: null, arxivId: '2401.01234' }, page: 2, style: 'apa' });
    expect(arxiv).toContain('https://arxiv.org/abs/2401.01234');
  });

  it('keeps the quote text exactly, apart from white space', () => {
    const tricky = 'a “nested” quote, 50% & <tags> — ok';
    for (const style of ['apa', 'mla', 'ieee'] as CitationStyle[]) {
      expect(formatQuote(tricky, { source, page: 1, style })).toContain(`“${tricky}”`);
    }
  });
});
