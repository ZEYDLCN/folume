/** A quote from a paper with its citation, ready to paste: the in-text citation and the full reference line. */
import { parseName, type CitationSource } from '@/core/export/citations';

export type CitationStyle = 'apa' | 'mla' | 'ieee';

const initials = (given: string) =>
  given
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((p) => `${p[0].toUpperCase()}.`)
    .join(' ');

const link = (s: CitationSource) => (s.doi ? `https://doi.org/${s.doi}` : s.arxivId ? `https://arxiv.org/abs/${s.arxivId}` : null);

function inText(style: CitationStyle, s: CitationSource, page: number): string {
  const people = s.authors.map(parseName);
  const year = s.year ?? 'n.d.';
  if (style === 'ieee') return `[1, p. ${page}]`;
  let who: string;
  if (people.length === 0) {
    const t = s.title.trim();
    who = t.length > 28 ? `${t.slice(0, 28).trimEnd()}…` : t;
  } else if (people.length === 1) who = people[0].family;
  else if (people.length === 2) who = style === 'apa' ? `${people[0].family} & ${people[1].family}` : `${people[0].family} and ${people[1].family}`;
  else who = `${people[0].family} et al.`;
  return style === 'apa' ? `(${who}, ${year}, p. ${page})` : `(${who} ${page})`;
}

function reference(style: CitationStyle, s: CitationSource): string {
  const people = s.authors.map(parseName);
  const url = link(s);
  const year = s.year ?? 'n.d.';
  if (style === 'apa') {
    const names = people.map((p) => (p.given ? `${p.family}, ${initials(p.given)}` : p.family));
    const list = names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')}, & ${names[names.length - 1]}`;
    return `${list ? `${list} ` : ''}(${year}). ${s.title}.${url ? ` ${url}` : ''}`;
  }
  if (style === 'mla') {
    let list = '';
    if (people.length === 1) list = `${people[0].family}, ${people[0].given}`.replace(/, $/, '');
    else if (people.length === 2) list = `${people[0].family}, ${people[0].given}, and ${people[1].given} ${people[1].family}`;
    else if (people.length > 2) list = `${people[0].family}, ${people[0].given}, et al.`;
    const lead = list ? (list.endsWith('.') ? `${list} ` : `${list}. `) : '';
    return `${lead}“${s.title}.” ${s.year ?? 'n.d.'}${url ? `, ${url}` : ''}.`;
  }
  const names = people.map((p) => (p.given ? `${initials(p.given)} ${p.family}` : p.family));
  const shown = names.length > 6 ? `${names[0]} et al.` : names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
  const doi = s.doi ? `, doi: ${s.doi}` : s.arxivId ? `, arXiv:${s.arxivId}` : '';
  return `[1] ${shown ? `${shown}, ` : ''}“${s.title},” ${s.year ?? 'n.d.'}${doi}.`;
}

/** `“quote” (Author, Year, p. N)` and, after a blank line, the reference entry in the same style. */
export function formatQuote(quote: string, opts: { source: CitationSource; page: number; style: CitationStyle }): string {
  const text = quote.replace(/\s+/g, ' ').trim();
  return `“${text}” ${inText(opts.style, opts.source, opts.page)}\n\n${reference(opts.style, opts.source)}`;
}
