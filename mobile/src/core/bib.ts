/** Reading lists from other tools: BibTeX (Zotero, Mendeley, Google Scholar), RIS and CSL-JSON. */

export interface BibItem {
  title: string;
  authors: string[];
  year: number | null;
  doi: string | null;
  arxivId: string | null;
  url: string | null;
}

// ------------------------------------------------------------------------------------------------- text cleaning

const ACCENTS: Record<string, string> = { '"': '̈', "'": '́', '`': '̀', '^': '̂', '~': '̃', c: '̧', v: '̌', u: '̆', H: '̋', '.': '̇', r: '̊', k: '̨' };
const SPECIAL: Record<string, string> = { ss: 'ß', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', o: 'ø', O: 'Ø', aa: 'å', AA: 'Å', l: 'ł', L: 'Ł', i: 'ı', j: 'ȷ' };

/** LaTeX in a field value: accents ({\"o}), escapes (\&), braces that only protect capitals, simple commands (\emph{x}). */
function unlatex(raw: string): string {
  let s = raw;
  // \"o, \"{o}, {\"o}, \c{s}, \c s ...
  s = s.replace(/\\(["'`^~.])\s*\{?(\\?[A-Za-z])\}?/g, (_m, a: string, ch: string) => (ch.startsWith('\\') ? `\\${a}${ch}` : ch + ACCENTS[a]));
  s = s.replace(/\\([cvuHrk])\s*\{([A-Za-z])\}|\\([cvuHrk])\s+([A-Za-z])/g, (_m, a1: string, c1: string, a2: string, c2: string) => (c1 ?? c2) + ACCENTS[a1 ?? a2]);
  s = s.replace(/\\(ss|ae|AE|oe|OE|aa|AA|o|O|l|L|i|j)(?![A-Za-z])\s*/g, (_m, k: string) => SPECIAL[k]);
  s = s.replace(/\\([&%$#_{}])/g, '$1');
  s = s.replace(/\\(?:emph|textit|textbf|textrm|texttt|mathrm|mathit|text)\s*\{([^{}]*)\}/g, '$1');
  s = s.replace(/\\[A-Za-z]+\s*/g, '');
  s = s.replace(/[{}]/g, '');
  return s.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** "Last, First" and "First Last" both become "First Last"; a corporate name in braces stays whole. */
function personName(raw: string): string {
  const name = unlatex(raw);
  if (!name.includes(',')) return name;
  const [family, ...rest] = name.split(',');
  return `${rest.join(',').trim()} ${family.trim()}`.trim();
}

const arxivFrom = (text: string | null | undefined): string | null => {
  if (!text) return null;
  const m = /arxiv\.org\/(?:abs|pdf)\/([^\s?#]+?)(?:\.pdf)?(?:$|[?#\s])/i.exec(text) ?? /^(?:arxiv:)?\s*(\d{4}\.\d{4,5}(?:v\d+)?)\s*$/i.exec(text);
  return m ? m[1] : null;
};

const doiFrom = (text: string | null | undefined): string | null => {
  const m = /(10\.\d{4,9}\/[^\s"<>{}]+)/.exec(text ?? '');
  return m ? m[1].replace(/[.,;)]+$/, '') : null;
};

const yearFrom = (text: string | null | undefined): number | null => {
  const m = /\b(1[5-9]\d\d|20\d\d)\b/.exec(text ?? '');
  return m ? Number(m[1]) : null;
};

// ---------------------------------------------------------------------------------------------------- BibTeX

/** Reads the value of a field starting at `i` (after the `=`): {braced}, "quoted" or a bare word. Returns the value and the next index. */
function readValue(s: string, i: number): [string, number] | null {
  while (i < s.length && /\s/.test(s[i])) i++;
  if (s[i] === '{') {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      if (s[j] === '\\') j++;
      else if (s[j] === '{') depth++;
      else if (s[j] === '}' && --depth === 0) return [s.slice(i + 1, j), j + 1];
    }
    return null;
  }
  if (s[i] === '"') {
    for (let j = i + 1; j < s.length; j++) {
      if (s[j] === '\\') j++;
      else if (s[j] === '"') return [s.slice(i + 1, j), j + 1];
    }
    return null;
  }
  const m = /^[^,\s}]+/.exec(s.slice(i));
  return m ? [m[0], i + m[0].length] : null;
}

export function parseBibTeX(text: string): BibItem[] {
  const out: BibItem[] = [];
  const re = /@([A-Za-z]+)\s*[{(]/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const type = m[1].toLowerCase();
    if (type === 'string' || type === 'comment' || type === 'preamble') continue;
    let i = m.index + m[0].length;
    const comma = text.indexOf(',', i);
    if (comma < 0) break;
    i = comma + 1;
    const fields: Record<string, string> = {};
    for (;;) {
      const f = /^\s*([A-Za-z][A-Za-z0-9_-]*)\s*=/.exec(text.slice(i));
      if (!f) break;
      const v = readValue(text, i + f[0].length);
      if (!v) {
        i = text.length;
        fields.__broken = '1';
        break;
      }
      fields[f[1].toLowerCase()] = v[0];
      i = v[1];
      const next = /^\s*,?/.exec(text.slice(i));
      i += next ? next[0].length : 0;
    }
    if (fields.__broken || !fields.title) continue;
    const authors = (fields.author ?? fields.editor ?? '')
      .split(/\s+and\s+/i)
      .map((a) => a.trim())
      .filter(Boolean)
      .map(personName);
    out.push({
      title: unlatex(fields.title),
      authors,
      year: yearFrom(fields.year) ?? yearFrom(fields.date),
      doi: doiFrom(fields.doi) ?? doiFrom(fields.url),
      arxivId: arxivFrom(fields.eprint) ?? arxivFrom(fields.arxivid) ?? arxivFrom(fields.url),
      url: fields.url ? fields.url.trim() : null,
    });
    re.lastIndex = Math.max(re.lastIndex, i);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------- RIS

export function parseRis(text: string): BibItem[] {
  const out: BibItem[] = [];
  let cur: { title?: string; authors: string[]; year?: number | null; doi?: string | null; url?: string | null } | null = null;
  const flush = () => {
    if (cur?.title) {
      out.push({ title: cur.title, authors: cur.authors, year: cur.year ?? null, doi: cur.doi ?? doiFrom(cur.url), arxivId: arxivFrom(cur.url), url: cur.url ?? null });
    }
    cur = null;
  };
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9])\s{2}-\s?(.*)$/.exec(line);
    if (!m) continue;
    const [, tag, value] = m;
    if (tag === 'TY') {
      flush();
      cur = { authors: [] };
    } else if (!cur) continue;
    else if (tag === 'ER') flush();
    else if (tag === 'TI' || tag === 'T1') cur.title ??= unlatex(value);
    else if (tag === 'AU' || tag === 'A1') cur.authors.push(personName(value));
    else if (tag === 'PY' || tag === 'Y1') cur.year ??= yearFrom(value);
    else if (tag === 'DO') cur.doi = doiFrom(value);
    else if (tag === 'UR') cur.url ??= value.trim();
  }
  flush();
  return out;
}

// -------------------------------------------------------------------------------------------------- CSL-JSON

export function parseCslJson(text: string): BibItem[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: BibItem[] = [];
  for (const r of data) {
    if (typeof r !== 'object' || r === null) continue;
    const o = r as Record<string, unknown>;
    if (typeof o.title !== 'string' || !o.title.trim()) continue;
    const people = Array.isArray(o.author) ? o.author : [];
    const parts = (o.issued as { 'date-parts'?: unknown[][] } | undefined)?.['date-parts']?.[0];
    const url = typeof o.URL === 'string' ? o.URL : null;
    out.push({
      title: o.title.replace(/\s+/g, ' ').trim(),
      authors: people
        .map((p) => {
          const a = p as { family?: string; given?: string; literal?: string };
          return a.literal ?? [a.given, a.family].filter(Boolean).join(' ');
        })
        .filter(Boolean),
      year: typeof parts?.[0] === 'number' ? (parts[0] as number) : null,
      doi: typeof o.DOI === 'string' ? doiFrom(o.DOI) : doiFrom(url),
      arxivId: arxivFrom(url),
      url,
    });
  }
  return out;
}

export type BibFormat = 'bibtex' | 'ris' | 'csl' | 'unknown';

/** Works out the format of a bibliography file from its content and reads it. */
export function parseBibliography(text: string): { format: BibFormat; items: BibItem[] } {
  const t = text.trimStart();
  if (t.startsWith('[') || t.startsWith('{')) {
    const items = parseCslJson(text);
    return { format: items.length ? 'csl' : 'unknown', items };
  }
  if (/^TY {2}- /m.test(text)) return { format: 'ris', items: parseRis(text) };
  if (/@[A-Za-z]+\s*[{(]/.test(text)) {
    const items = parseBibTeX(text);
    return { format: items.length ? 'bibtex' : 'unknown', items };
  }
  return { format: 'unknown', items: [] };
}
