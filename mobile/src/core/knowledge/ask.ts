/** Turns what a question found in the library into the numbered passages an answer is grounded in. */
import type { ContextPassage } from '../retrieval/context';
import type { FoundPassage } from './search';

/** The gateway accepts at most 14 passages, and labels of at most 120 characters. */
const MAX_PASSAGES = 14;
const MAX_LABEL = 120;
const MAX_CHARS = 1200;

export const joinBlockRef = (docId: string, blockId: string): string => `${docId}:${blockId}`;

export function splitBlockRef(ref: string): { docId: string | null; blockId: string } {
  const at = ref.indexOf(':');
  return at < 0 ? { docId: null, blockId: ref } : { docId: ref.slice(0, at), blockId: ref.slice(at + 1) };
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= MAX_CHARS) return flat;
  const cut = flat.slice(0, MAX_CHARS - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 1)).trimEnd()}…`;
}

function labelOf(title: string, page: number): string {
  const tail = `, p. ${page}`;
  const room = MAX_LABEL - tail.length;
  return `${title.length > room ? `${title.slice(0, room - 1)}…` : title}${tail}`;
}

/** `blockId` of each result is `docId:blockId`, so one answer can cite several papers and still link back to the right one. */
export function askPassages(found: FoundPassage[], opts: { budgetChars?: number } = {}): ContextPassage[] {
  const budget = opts.budgetChars ?? 9000;
  const out: ContextPassage[] = [];
  let used = 0;
  for (const f of found) {
    if (out.length >= MAX_PASSAGES) break;
    const text = clip(f.text);
    if (out.length && used + text.length > budget) break;
    used += text.length;
    out.push({
      id: `p${out.length + 1}`,
      blockId: joinBlockRef(f.docId, f.blockId),
      kind: 'retrieved',
      text,
      label: labelOf(f.title, f.page),
      page: f.page,
    });
  }
  return out;
}
