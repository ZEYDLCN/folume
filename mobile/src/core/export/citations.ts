import type { Block, Document } from '@/core/types';

/** What a bibliography entry needs; every field is whatever the PDF actually told us. */
export interface CitationSource {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  doi: string | null;
  arxivId: string | null;
}

export const citationSourceOf = (doc: Document): CitationSource => ({
  id: doc.id,
  title: doc.metadata.title?.trim() || doc.source.filename.replace(/\.pdf$/i, ''),
  authors: doc.metadata.authors,
  year: doc.metadata.year,
  doi: doc.metadata.doi,
  arxivId: doc.metadata.arxiv_id,
});

// ---------------------------------------------------------------------------------------------- names

const PARTICLES = new Set(['van', 'von', 'der', 'den', 'de', 'del', 'della', 'di', 'da', 'dos', 'du', 'la', 'le', 'bin', 'ibn', 'al', 'el']);

export interface Person {
  family: string;
  given: string;
}

/** "Ada Lovelace" and "Lovelace, Ada" both become {family: Lovelace, given: Ada}; particles stay with the family name. */
export function parseName(raw: string): Person {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name.includes(',')) {
    const [family, ...rest] = name.split(',');
    return { family: family.trim(), given: rest.join(',').trim() };
  }
  const parts = name.split(' ');
  if (parts.length === 1) return { family: parts[0], given: '' };
  let i = parts.length - 1;
  while (i > 1 && PARTICLES.has(parts[i - 1].toLowerCase())) i--;
  return { family: parts.slice(i).join(' '), given: parts.slice(0, i).join(' ') };
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'I')
    .replace(/ß/g, 'ss')
    .replace(/[øØ]/g, 'o')
    .replace(/[łŁ]/g, 'l');

// -------------------------------------------------------------------------------------------- BibTeX

const BIBTEX_ESCAPES: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '&': '\\&',
  '%': '\\%',
  $: '\\$',
  '#': '\\#',
  _: '\\_',
  '{': '\\{',
  '}': '\\}',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
};

export const bibtexEscape = (s: string): string => s.replace(/[\\&%$#_{}~^]/g, (c) => BIBTEX_ESCAPES[c]);

const STOP_TITLE = new Set(['a', 'an', 'the', 'on', 'of', 'for', 'to', 'in', 'and', 'with']);

/** `lovelace2023sparse`; unique within a batch (a, b, c… appended on clashes). */
export function citeKeys(items: CitationSource[]): Map<string, string> {
  const used = new Map<string, number>();
  const keys = new Map<string, string>();
  for (const it of items) {
    const family = fold(parseName(it.authors[0] ?? '').family).toLowerCase().replace(/[^a-z0-9]/g, '');
    const word = fold(it.title)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .find((w) => w.length > 2 && !STOP_TITLE.has(w));
    const base = `${family || 'anon'}${it.year ?? ''}${word ?? ''}` || 'ref';
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    keys.set(it.id, n === 0 ? base : `${base}${String.fromCharCode(96 + n)}`);
  }
  return keys;
}

export function toBibtex(items: CitationSource[]): string {
  const keys = citeKeys(items);
  return items
    .map((it) => {
      const fields: [string, string][] = [['title', `{${bibtexEscape(it.title)}}`]];
      if (it.authors.length) {
        const people = it.authors.map((a) => {
          const p = parseName(a);
          return p.given ? `${bibtexEscape(p.family)}, ${bibtexEscape(p.given)}` : bibtexEscape(p.family);
        });
        fields.unshift(['author', people.join(' and ')]);
      }
      if (it.year) fields.push(['year', String(it.year)]);
      if (it.doi) fields.push(['doi', bibtexEscape(it.doi)]);
      if (it.arxivId) fields.push(['eprint', bibtexEscape(it.arxivId)], ['archivePrefix', 'arXiv']);
      // the PDF does not say where it was published, so no journal/booktitle is invented
      const body = fields.map(([k, v]) => `  ${k} = {${v}}`).join(',\n');
      return `@misc{${keys.get(it.id)},\n${body}\n}`;
    })
    .join('\n\n')
    .concat(items.length ? '\n' : '');
}

// ------------------------------------------------------------------------------------------------ RIS

export function toRis(items: CitationSource[]): string {
  const clean = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();
  return items
    .map((it) => {
      const lines = ['TY  - GEN', `TI  - ${clean(it.title)}`];
      for (const a of it.authors) {
        const p = parseName(a);
        lines.push(`AU  - ${p.given ? `${clean(p.family)}, ${clean(p.given)}` : clean(p.family)}`);
      }
      if (it.year) lines.push(`PY  - ${it.year}`);
      if (it.doi) lines.push(`DO  - ${it.doi}`, `UR  - https://doi.org/${it.doi}`);
      else if (it.arxivId) lines.push(`UR  - https://arxiv.org/abs/${it.arxivId}`);
      lines.push('ER  - ');
      return lines.join('\r\n');
    })
    .join('\r\n')
    .concat(items.length ? '\r\n' : '');
}

// -------------------------------------------------------------------------------------------- CSL-JSON

export function toCslJson(items: CitationSource[]): string {
  const keys = citeKeys(items);
  const csl = items.map((it) => {
    const entry: Record<string, unknown> = {
      id: keys.get(it.id),
      type: 'article',
      title: it.title,
      author: it.authors.map((a) => {
        const p = parseName(a);
        return p.given ? { family: p.family, given: p.given } : { literal: p.family };
      }),
    };
    if (it.year) entry.issued = { 'date-parts': [[it.year]] };
    if (it.doi) entry.DOI = it.doi;
    if (it.arxivId) entry.URL = `https://arxiv.org/abs/${it.arxivId}`;
    return entry;
  });
  return `${JSON.stringify(csl, null, 2)}\n`;
}

// --------------------------------------------------------------------------- a paper's own reference list

/**
 * The bibliography of one paper as BibTeX. Fields come from best-effort parsing of the reference text, so each
 * entry keeps the original text in `note` and says it was parsed automatically.
 */
export function referencesToBibtex(doc: Document): string {
  const refs = doc.blocks.filter((b): b is Block => b.type === 'reference');
  const used = new Set<string>();
  const entries = refs.map((b, i) => {
    const info = b.reference;
    const label = (info?.label ?? b.number ?? String(i + 1)).replace(/[^A-Za-z0-9]/g, '');
    const family = fold(info?.first_author ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    let key = `${family || 'ref'}${info?.year ?? ''}_${label}`;
    while (used.has(key)) key += 'x';
    used.add(key);
    const fields: [string, string][] = [];
    if (info?.first_author) fields.push(['author', `${bibtexEscape(info.first_author)} and others`]);
    if (info?.title) fields.push(['title', `{${bibtexEscape(info.title)}}`]);
    if (info?.year) fields.push(['year', String(info.year)]);
    if (info?.doi) fields.push(['doi', bibtexEscape(info.doi)]);
    if (info?.url) fields.push(['url', bibtexEscape(info.url)]);
    fields.push(['note', `Parsed automatically, verify against the PDF: ${bibtexEscape(b.text.replace(/\s+/g, ' ').trim())}`]);
    return `@misc{${key},\n${fields.map(([k, v]) => `  ${k} = {${v}}`).join(',\n')}\n}`;
  });
  return entries.join('\n\n').concat(entries.length ? '\n' : '');
}
