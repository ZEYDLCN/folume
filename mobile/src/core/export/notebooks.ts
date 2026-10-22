/**
 * Notes, review cards and highlights in the shapes other apps import: an Obsidian vault, an Anki deck, a Readwise CSV.
 * What the authors wrote and what the reader or a model wrote stay apart, exactly as in the app.
 */
import type { Annotation } from '@/data/annotations';
import type { LibraryEntry } from '@/data/library';
import type { Card } from '../learning/srs';
import { tableToCsv } from './table';
import { zipStore } from './zip';

export interface NotebookPaper {
  entry: LibraryEntry;
  annotations: Annotation[];
  cards: Card[];
  /** other papers of the library that share concepts with this one */
  related: { title: string; terms: string[] }[];
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const MAX_NAME = 100;

/** A file name that is also safe inside a `[[wiki link]]`: letters of any language stay, path and link characters go. */
export function noteFileName(title: string, used: Set<string>): string {
  const base = oneLine(title.replace(/[\\/:*?"<>|#^[\]]+/g, ' ')).replace(/^\.+/, '').slice(0, MAX_NAME).trim() || 'Untitled';
  let candidate = base;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) {
    const suffix = ` (${n})`;
    candidate = `${base.slice(0, MAX_NAME - suffix.length).trimEnd()}${suffix}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

const yaml = (s: string) => JSON.stringify(oneLine(s));
const tagOf = (s: string) => s.trim().replace(/[^\p{L}\p{N}_/-]+/gu, '-').replace(/^-+|-+$/g, '');

function properties(e: LibraryEntry): string {
  const tags = [...new Set([...e.tags.map(tagOf).filter(Boolean), 'folume'])];
  const lines = ['---', `title: ${yaml(e.title)}`, `authors: [${e.authors.map(yaml).join(', ')}]`];
  if (e.year) lines.push(`year: ${e.year}`);
  if (e.doi) lines.push(`doi: ${yaml(e.doi)}`);
  if (e.arxivId) lines.push(`arxiv: ${yaml(e.arxivId)}`);
  lines.push(`tags: [${tags.map(yaml).join(', ')}]`, 'source: "folume"', '---');
  return lines.join('\n');
}

function noteText(a: Annotation): string {
  const text = a.note.trim().split('\n').join('\n  ');
  if (a.origin === 'ai') return `**AI-generated note** (not the authors' text):\n  ${text}`;
  if (a.origin === 'shared') return `**Note from ${a.author || 'someone else'}:**\n  ${text}`;
  return text;
}

function paperNote(p: NotebookPaper): string {
  const { entry: e } = p;
  const out = [properties(e), '', `# ${oneLine(e.title)}`, ''];
  const meta = [e.authors.join(', '), e.year ? String(e.year) : '', e.doi ? `doi:${e.doi}` : ''].filter(Boolean).join(' · ');
  if (meta) out.push(`_${meta}_`, '');
  const notes = [...p.annotations].sort((a, b) => a.page - b.page || a.start - b.start);
  if (notes.length) {
    out.push('## Highlights and notes', '');
    for (const a of notes) {
      if (a.quote) out.push(`> ${oneLine(a.quote)}`, `> — p. ${a.page}`);
      else out.push(`- p. ${a.page}`);
      if (a.note.trim()) out.push('', noteText(a));
      out.push('');
    }
  }
  if (p.related.length) {
    out.push('## Related papers', '');
    for (const r of p.related) out.push(`- [[${r.title}]]${r.terms.length ? ` — ${r.terms.join(', ')}` : ''}`);
    out.push('');
  }
  if (p.cards.length) {
    out.push('## Review cards', '');
    for (const c of p.cards) out.push(`- **Q:** ${oneLine(c.front)}`, `  **A:** ${oneLine(c.back)} (p. ${c.page})`);
    out.push('');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** One note per paper and an index, all in one folder; related papers become links Obsidian draws in its graph. */
export function obsidianVault(papers: NotebookPaper[], opts: { folder?: string } = {}): { path: string; content: string }[] {
  const folder = opts.folder ?? 'Folume';
  const used = new Set<string>(['index']);
  const names = new Map<string, string>();
  for (const p of papers) names.set(p.entry.id, noteFileName(p.entry.title, used));
  // a related paper is linked by the file name its own note got
  const byTitle = new Map(papers.map((p) => [p.entry.title, names.get(p.entry.id)!]));
  const files = papers.map((p) => ({
    path: `${folder}/${names.get(p.entry.id)}.md`,
    content: paperNote({ ...p, related: p.related.map((r) => ({ ...r, title: byTitle.get(r.title) ?? noteFileName(r.title, new Set()) })) }),
  }));
  const index = ['# Folume', '', ...papers.map((p) => `- [[${names.get(p.entry.id)}]]`), ''].join('\n');
  return [{ path: `${folder}/Index.md`, content: index }, ...files];
}

export function obsidianZip(files: { path: string; content: string }[]): Uint8Array {
  return zipStore(files.map((f) => ({ name: f.path, data: f.content })));
}

// -------------------------------------------------------------------------------------------------- Anki

const html = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const field = (s: string) => html(s.replace(/\t/g, ' ').trim()).replace(/\r?\n/g, '<br>');

/** Tab-separated text Anki imports: a stable id per card (re-importing updates instead of duplicating), front, back with its source, tags. */
export function ankiTsv(cards: Card[], entries: LibraryEntry[]): string {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const rows = cards.map((c) => {
    const e = byId.get(c.docId);
    const source = e ? `<br><br><i>${html(oneLine(`${e.title}, p. ${c.page}`))}</i>` : '';
    const tags = ['folume', ...(e?.tags ?? []).map((t) => t.trim().replace(/\s+/g, '_')).filter(Boolean)];
    return [`folume-${c.id}`, field(c.front), `${field(c.back)}${source}`, tags.join(' ')].join('\t');
  });
  return ['#separator:tab', '#html:true', '#guid column:1', '#tags column:4', ...rows, ''].join('\n');
}

// ----------------------------------------------------------------------------------------------- Readwise

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};

/** Highlights in the CSV shape Readwise's import takes. Only marks that quote the paper are included. */
export function readwiseCsv(entries: LibraryEntry[], annotations: Annotation[]): string {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const rows: string[][] = [['Highlight', 'Title', 'Author', 'URL', 'Note', 'Location', 'Date']];
  for (const a of annotations) {
    const e = byId.get(a.docId);
    if (!e || !a.quote.trim()) continue;
    const url = e.doi ? `https://doi.org/${e.doi}` : e.arxivId ? `https://arxiv.org/abs/${e.arxivId}` : '';
    const note = !a.note.trim() ? '' : a.origin === 'ai' ? `AI-generated: ${a.note.trim()}` : a.origin === 'shared' ? `Note from ${a.author || 'someone else'}: ${a.note.trim()}` : a.note.trim();
    rows.push([oneLine(a.quote), e.title, e.authors.join('; '), url, note, String(a.page), stamp(a.createdAt)]);
  }
  return tableToCsv(rows, { safe: true });
}
