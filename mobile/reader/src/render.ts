import type { Asset, Block, Document, Span } from '../../src/core/types';
import type { ReaderSettings, ReaderStrings } from '../../src/reader/protocol';
import { el } from './dom';

export interface RenderCtx {
  doc: Document;
  byId: Map<string, Block>;
  strings: ReaderStrings;
  settings: ReaderSettings;
  bookmarks: Set<string>;
}

const hasWarning = (b: Block) => b.flags.some((f) => f.severity !== 'info');

function spanNode(s: Span): Node {
  let node: Node = document.createTextNode(s.text);
  if (s.mono) node = el('code', null, null, node);
  if (s.italic) node = el('em', null, null, node);
  if (s.bold) node = el('strong', null, null, node);
  if (s.sub) node = el('sub', null, null, node);
  if (s.sup) node = el('sup', null, null, node);
  if (s.math) node = el('span', 'm', null, node);
  return node;
}

/** Inline content of a block; citations become tappable links to reference blocks. */
export function renderSpans(spans: Span[], fallback: string): Node[] {
  if (!spans.length) return [document.createTextNode(fallback)];
  return spans.map((s) => {
    const inner = spanNode(s);
    if (s.cite.length) return el('a', 'cite', { 'data-refs': s.cite.join(' ') }, inner);
    if (s.link) return el('a', 'link', { 'data-href': s.link }, inner);
    return inner;
  });
}

function textBox(b: Block, tag: 'span' | 'div' = 'span'): HTMLElement {
  return el(tag, 'bt', null, ...renderSpans(b.spans, b.text));
}

function image(asset: Asset, className?: string): HTMLImageElement {
  return el('img', className, { 'data-asset': asset.path, width: asset.width, height: asset.height, alt: '' });
}

function imgWrap(asset: Asset, strings: ReaderStrings, tint = false): HTMLElement {
  const wrap = el('div', 'imgwrap loading', {
    'data-loading': strings.loading,
    style: `aspect-ratio:${asset.width}/${asset.height}`,
    'data-zoom': '1',
  });
  wrap.append(image(asset, tint ? 'tint' : undefined));
  return wrap;
}

function decorate(node: HTMLElement, b: Block, ctx: RenderCtx): HTMLElement {
  if (ctx.bookmarks.has(b.id)) node.classList.add('bm');
  if (hasWarning(b)) {
    node.classList.add('warn');
    node.append(el('button', 'flagdot', { 'data-flag': b.id, 'aria-label': ctx.strings.conversion_warning }, '!'));
  } else if (ctx.settings.showNotes && b.flags.length) {
    node.classList.add('note-info');
    node.append(el('button', 'flagdot info', { 'data-flag': b.id, 'aria-label': ctx.strings.conversion_note }, 'i'));
  }
  return node;
}

function base(b: Block, tag: keyof HTMLElementTagNameMap, cls: string): HTMLElement {
  return el(tag, `blk ${cls}`, { id: b.id, 'data-b': b.id, 'data-page': b.source[0].page });
}

function caption(ctx: RenderCtx, id: string | null): HTMLElement | null {
  const cap = id ? ctx.byId.get(id) : undefined;
  return cap ? el('figcaption', null, { 'data-cap': cap.id }, textBox(cap)) : null;
}

/** The PDF's own text inside a figure or table: collapsed, selectable, so no character lives only in a picture. */
function innerText(b: Block, ctx: RenderCtx, label: string): HTMLElement | null {
  if (!b.inner_text) return null;
  return el('details', 'figtext', null, el('summary', null, null, label), el('pre', 'figtext-body', null, b.inner_text));
}

function renderTable(b: Block, ctx: RenderCtx): HTMLElement {
  const fig = base(b, 'figure', 'tbl');
  const cap = caption(ctx, b.caption_id);
  if (cap) fig.append(cap);
  const uncertain = b.table === null || b.flags.some((f) => f.code.startsWith('table_'));
  if (b.table && b.asset) {
    const data = b.table;
    const wrap = el('div', 'tblwrap');
    const table = el('table');
    data.rows.forEach((row, ri) => {
      const tr = el('tr');
      row.forEach((cell, ci) => {
        const isHead = ri < data.header_rows;
        const numeric = /^[-+−]?[\d.,]+%?$/.test(cell.trim());
        tr.append(el(isHead ? 'th' : 'td', !isHead && ci > 0 && numeric ? 'num' : null, null, cell));
      });
      table.append(tr);
    });
    wrap.append(table);
    const img = imgWrap(b.asset, ctx.strings);
    img.style.display = 'none';
    const bar = el('div', 'tbar', null,
      el('button', 'on', { 'data-view': 'table' }, ctx.strings.table),
      el('button', null, { 'data-view': 'image' }, ctx.strings.table_image));
    fig.append(bar, wrap, img);
  } else if (b.asset) {
    fig.append(imgWrap(b.asset, ctx.strings));
    if (uncertain) fig.append(el('div', 'chip', null, ctx.strings.table_uncertain));
    // an image-only table keeps its text reachable
    const text = innerText(b, ctx, ctx.strings.table_text);
    if (text) fig.append(text);
  }
  return decorate(fig, b, ctx);
}

export function renderBlock(b: Block, ctx: RenderCtx): HTMLElement | null {
  switch (b.type) {
    case 'title': {
      const h = base(b, 'h1', 'title');
      h.append(textBox(b));
      return decorate(h, b, ctx);
    }
    case 'authors': {
      const p = base(b, 'p', 'authors');
      p.append(textBox(b));
      return decorate(p, b, ctx);
    }
    case 'heading': {
      const tag = b.level === 1 || b.level === null ? 'h2' : b.level === 2 ? 'h3' : 'h4';
      const h = base(b, tag, 'h');
      if (b.number) h.append(el('span', 'hn', null, b.number));
      h.append(el('span', 'bt', null, b.text));
      return decorate(h, b, ctx);
    }
    case 'paragraph': {
      const p = base(b, 'p', 'blk-paragraph');
      p.append(textBox(b));
      return decorate(p, b, ctx);
    }
    case 'list_item': {
      const li = base(b, 'div', 'li');
      // the marker is drawn here; a paper converted earlier still has it at the start of the text, so it is not drawn twice
      const own = !b.prefix && !!b.number && b.text.startsWith(b.number);
      if (!own) li.append(el('span', 'mk', null, b.prefix || b.number || '•'));
      li.append(textBox(b, 'div'));
      li.lastElementChild?.classList.add('lt');
      return decorate(li, b, ctx);
    }
    case 'figure': {
      const fig = base(b, 'figure', 'fig');
      if (b.asset) fig.append(imgWrap(b.asset, ctx.strings));
      const text = innerText(b, ctx, ctx.strings.figure_text);
      if (text) fig.append(text);
      const cap = caption(ctx, b.caption_id);
      if (cap) fig.append(cap);
      return decorate(fig, b, ctx);
    }
    case 'table':
      return renderTable(b, ctx);
    case 'equation': {
      const eq = base(b, 'div', 'eq');
      if (b.asset) {
        const scroll = el('div', 'eqscroll', { 'data-zoom': '1' });
        const img = image(b.asset, b.asset.transparent ? 'tint' : undefined);
        const wPt = b.asset.bbox[2] - b.asset.bbox[0];
        img.style.width = `calc(var(--k) * ${wPt.toFixed(2)}px)`;
        img.style.aspectRatio = `${b.asset.width}/${b.asset.height}`;
        scroll.append(img);
        eq.append(scroll);
      } else {
        eq.append(el('div', 'eqscroll', null, b.text));
      }
      if (b.number) eq.append(el('span', 'eqn', null, b.number));
      return decorate(eq, b, ctx);
    }
    case 'caption': {
      if (b.caption_for && ctx.byId.has(b.caption_for)) return null; // shown with its figure/table
      const p = base(b, 'p', 'cap');
      p.append(textBox(b));
      return decorate(p, b, ctx);
    }
    case 'footnote': {
      const fn = base(b, 'aside', 'fn');
      if (b.number) fn.append(el('span', 'fnm', null, b.number));
      fn.append(textBox(b));
      return decorate(fn, b, ctx);
    }
    case 'reference': {
      const r = base(b, 'div', 'ref');
      r.append(el('span', 'rl', null, b.number ?? ''), textBox(b, 'div'));
      r.lastElementChild?.classList.add('rt');
      return decorate(r, b, ctx);
    }
    case 'code': {
      const pre = base(b, 'pre', 'code');
      pre.append(el('span', 'bt', null, b.text));
      return decorate(pre, b, ctx);
    }
    default:
      return null;
  }
}

export function renderBook(ctx: RenderCtx): HTMLElement {
  const book = el('main', null, { id: 'book' });
  // a run-in abstract ("Abstract—We study...") has no heading block; its section carries the label
  const labels = new Map<string, string>();
  for (const s of ctx.doc.sections) if (s.kind === 'abstract' && s.block_id) labels.set(s.block_id, s.title);
  if (!ctx.doc.blocks.length) {
    book.append(el('div', 'unsupported', null, ctx.strings.empty_unsupported));
    return book;
  }
  const checks = checkpoints(ctx.doc);
  let lastPage = 0;
  let afterHeading = false; // the first paragraph of a section opens it (a drop cap in the magazine layout)
  for (const b of ctx.doc.blocks) {
    const node = renderBlock(b, ctx);
    if (!node) continue;
    if (b.type === 'heading' && (b.level ?? 1) <= 1) afterHeading = true;
    else if (afterHeading && b.type === 'paragraph') {
      node.classList.add('lead');
      afterHeading = false;
    } else if (b.type !== 'heading') afterHeading = false;
    const label = labels.get(b.id);
    if (label && b.type === 'paragraph') node.dataset.label = label;
    const page = b.source[0].page;
    if (page !== lastPage && b.type !== 'footnote') {
      book.append(el('div', 'pgsep', { 'data-page': page, 'data-first': b.id }, `${ctx.strings.page} ${page}`));
      lastPage = page;
    }
    book.append(node);
    const sectionId = checks.get(b.id);
    if (sectionId) {
      const card = el('div', 'qc', { 'data-qc': sectionId });
      card.append(
        el('div', 'qct', null, el('strong', null, null, ctx.strings.check), el('small', null, null, ctx.strings.check_hint)),
        el('button', null, { 'data-quiz': sectionId }, ctx.strings.check_start),
      );
      book.append(card);
    }
  }
  return book;
}

/** Top-level body sections with enough text get an "Understanding check" card after their last block. */
export function checkpoints(doc: Document): Map<string, string> {
  const sections = new Map(doc.sections.map((s) => [s.id, s]));
  const rootOf = (id: string | null): string | null => {
    let cur = id ? sections.get(id) : undefined;
    while (cur?.parent_id) cur = sections.get(cur.parent_id);
    return cur?.id ?? null;
  };
  const chars = new Map<string, number>();
  const last = new Map<string, string>();
  for (const b of doc.blocks) {
    const root = rootOf(b.section_id);
    if (!root) continue;
    last.set(root, b.id);
    if (b.type === 'paragraph' || b.type === 'list_item') chars.set(root, (chars.get(root) ?? 0) + b.text.length);
  }
  const out = new Map<string, string>();
  for (const [root, blockId] of last) {
    const s = sections.get(root);
    if (s && s.kind === 'body' && (chars.get(root) ?? 0) >= 700) out.set(blockId, root);
  }
  return out;
}

export function renderOriginal(ctx: RenderCtx): HTMLElement {
  const root = el('div', null, { id: 'orig' });
  for (const p of ctx.doc.pages) {
    const pg = el('div', 'pg loading', { 'data-page': p.number, style: `aspect-ratio:${p.width}/${p.height}` });
    pg.append(el('span', 'pgno', null, `${ctx.strings.page} ${p.number}`),
      el('img', null, { 'data-asset': p.image, width: p.image_width, height: p.image_height, alt: '' }));
    root.append(pg);
  }
  return root;
}
