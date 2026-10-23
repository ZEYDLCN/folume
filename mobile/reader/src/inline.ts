/** Inline links inside the paper's text: "Fig. 2" and "Table I" that open what they name, and terms the paper defines. */
import { findXrefs } from '../../src/core/xref';
import type { TermView } from '../../src/reader/protocol';

const SKIP = 'a,mark,code,abbr,pre,details,.figtext';

/** Text nodes of `root` that are plain prose: not inside links, highlights, code or collapsed figure text. */
function proseNodes(root: Element): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
}

/** Splits `node` at the given [start, end) ranges, replacing each with `make(text, i)`. */
function wrapPieces(node: Text, ranges: { start: number; end: number; i: number }[], make: (text: string, i: number) => HTMLElement): void {
  const text = node.data;
  const frag = document.createDocumentFragment();
  let pos = 0;
  for (const r of ranges) {
    if (r.start > pos) frag.append(text.slice(pos, r.start));
    frag.append(make(text.slice(r.start, r.end), r.i));
    pos = r.end;
  }
  if (pos < text.length) frag.append(text.slice(pos));
  node.replaceWith(frag);
}

/** Turns every reference to a figure, table or equation that exists in this paper into a tappable link. */
export function linkXrefs(root: Element, index: Map<string, string>): void {
  for (const node of proseNodes(root)) {
    if (!/fig|tab|eq/i.test(node.data)) continue;
    const found = findXrefs(node.data).filter((m) => index.has(m.key));
    if (!found.length) continue;
    wrapPieces(
      node,
      found.map((m, i) => ({ start: m.start, end: m.end, i })),
      (text, i) => {
        const a = document.createElement('a');
        a.className = 'xref';
        a.dataset.x = found[i].key;
        a.textContent = text;
        return a;
      },
    );
  }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BOUND = String.raw`(?<![\p{L}\p{N}])`;
const BOUND_END = String.raw`(?![\p{L}\p{N}])`;

function removeTerms(root: ParentNode): void {
  const parents = new Set<Node>();
  root.querySelectorAll('abbr.term').forEach((a) => {
    const parent = a.parentNode;
    if (!parent) return;
    while (a.firstChild) parent.insertBefore(a.firstChild, a);
    parent.removeChild(a);
    parents.add(parent);
  });
  parents.forEach((p) => p.normalize());
}

/** Underlines the paper's own defined terms and abbreviations in running text; `data-t` is the index into `items`. */
export function markTerms(root: ParentNode, items: TermView[]): void {
  removeTerms(root);
  const usable = items.map((t, i) => ({ t, i })).filter(({ t }) => t.term.trim().length >= 2 && t.term.length <= 60);
  if (!usable.length) return;
  // abbreviations ("LLM") match exactly; longer terms ("expert gating") ignore case
  const exact = usable.filter(({ t }) => !/\s/.test(t.term) && t.term === t.term.toUpperCase());
  const loose = usable.filter((u) => !exact.includes(u));
  const build = (list: typeof usable, flags: string) =>
    list.length
      ? new RegExp(`${BOUND}(${list.sort((a, b) => b.t.term.length - a.t.term.length).map(({ t }) => escapeRe(t.term.trim())).join('|')})${BOUND_END}`, flags)
      : null;
  const reExact = build(exact, 'gu');
  const reLoose = build(loose, 'giu');
  const lookup = new Map(usable.map(({ t, i }) => [t.term.trim().toLowerCase(), i]));
  root.querySelectorAll('.blk-paragraph, .li .lt, .fn, .cap').forEach((block) => {
    for (const node of proseNodes(block)) {
      const ranges: { start: number; end: number; i: number }[] = [];
      for (const re of [reExact, reLoose]) {
        if (!re) continue;
        re.lastIndex = 0;
        for (let m = re.exec(node.data); m; m = re.exec(node.data)) {
          const i = lookup.get(m[1].toLowerCase());
          if (i !== undefined) ranges.push({ start: m.index, end: m.index + m[1].length, i });
        }
      }
      if (!ranges.length) continue;
      ranges.sort((a, b) => a.start - b.start);
      // an abbreviation inside a longer term, or two terms touching: the earlier, longer match wins
      const kept = ranges.filter((r, k) => k === 0 || r.start >= ranges[k - 1].end);
      wrapPieces(node, kept, (text, i) => {
        const a = document.createElement('abbr');
        a.className = 'term';
        a.dataset.t = String(i);
        a.textContent = text;
        return a;
      });
    }
  });
}
