import type { Annotation } from '@/data/annotations';
import type { LibraryEntry } from '@/data/library';

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Notes as Markdown, grouped by paper, every quote with its page so it can be found in the PDF again. */
export function notesToMarkdown(entries: LibraryEntry[], annotations: Annotation[]): string {
  const lines: string[] = ['# Folume notes', ''];
  const papers = entries.filter((e) => annotations.some((a) => a.docId === e.id));
  for (const paper of papers) {
    lines.push(`## ${paper.title}`);
    const meta = [paper.authors.join(', '), paper.year ? String(paper.year) : '', paper.doi ? `doi:${paper.doi}` : '']
      .filter(Boolean)
      .join(' · ');
    if (meta) lines.push(`_${meta}_`);
    lines.push('');
    const mine = annotations
      .filter((a) => a.docId === paper.id)
      .sort((a, b) => a.page - b.page || a.start - b.start);
    for (const a of mine) {
      if (a.quote) lines.push(`> ${oneLine(a.quote)}`, `> — p. ${a.page}`);
      else lines.push(`- p. ${a.page}`);
      if (a.note.trim()) {
        const text = a.note.trim().split('\n').join('\n  ');
        lines.push('', a.origin === 'ai' ? `**AI-generated note** (not the authors' text):\n  ${text}` : a.origin === 'shared' ? `**Note from ${a.author || 'someone else'}:**\n  ${text}` : text);
      }
      lines.push('');
    }
  }
  if (!papers.length) lines.push('_No notes yet._', '');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}
