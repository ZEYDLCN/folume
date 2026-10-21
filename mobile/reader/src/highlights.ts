/** Painting and measuring highlights as character ranges inside a block's text container (`.bt`). */
import type { HighlightView } from '../../src/reader/protocol';

export function textRoot(blockEl: Element): HTMLElement | null {
  return blockEl.querySelector<HTMLElement>('.bt');
}

export function offsetWithin(root: Node, node: Node, offset: number): number {
  const r = document.createRange();
  r.selectNodeContents(root);
  try {
    r.setEnd(node, offset);
  } catch {
    return 0;
  }
  return r.toString().length;
}

export function wrapRange(root: HTMLElement, start: number, end: number, make: () => HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const pieces: { node: Text; from: number; to: number }[] = [];
  let pos = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    const len = t.data.length;
    const from = Math.max(start, pos) - pos;
    const to = Math.min(end, pos + len) - pos;
    if (to > from) pieces.push({ node: t, from, to });
    pos += len;
    if (pos >= end) break;
  }
  for (const { node, from, to } of pieces) {
    let target = node;
    if (from > 0) target = target.splitText(from);
    if (to - from < target.data.length) target.splitText(to - from);
    const mark = make();
    target.parentNode?.insertBefore(mark, target);
    mark.appendChild(target);
  }
}

export function clearHighlights(scope: ParentNode = document): void {
  const parents = new Set<Node>();
  scope.querySelectorAll('mark.hl').forEach((m) => {
    const parent = m.parentNode;
    if (!parent) return;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
    parents.add(parent);
  });
  parents.forEach((p) => p.normalize());
}

export function paintHighlights(items: HighlightView[]): void {
  clearHighlights();
  for (const h of items) {
    const blockEl = document.getElementById(h.blockId);
    const root = blockEl ? textRoot(blockEl) : null;
    if (!root || h.end <= h.start) continue;
    wrapRange(root, h.start, h.end, () => {
      const m = document.createElement('mark');
      m.className = h.hasNote ? 'hl note' : 'hl';
      m.dataset.h = h.id;
      m.style.background = h.color;
      return m;
    });
  }
}
