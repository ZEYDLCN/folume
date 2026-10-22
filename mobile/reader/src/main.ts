import type { Block, Document } from '../../src/core/types';
import { buildXrefIndex } from '../../src/core/xref';
import type {
  Anchor,
  HighlightView,
  HostMessage,
  InitMessage,
  ReaderMode,
  ReaderSettings,
  ReaderStrings,
  TermView,
} from '../../src/reader/protocol';
import { clamp, el, post, rectOf } from './dom';
import { offsetWithin, paintHighlights, textRoot } from './highlights';
import { markTerms } from './inline';
import { InkLayer } from './inkLayer';
import { renderBlock, renderBook, renderOriginal, type RenderCtx } from './render';
import { CSS } from './styles';

interface State {
  doc: Document | null;
  byId: Map<string, Block>;
  pageBlocks: Map<number, string[]>;
  settings: ReaderSettings | null;
  strings: ReaderStrings | null;
  mode: ReaderMode;
  bookmarks: Set<string>;
  highlights: HighlightView[];
  assets: Map<string, string>;
  requested: Set<string>;
  selectedBlock: string | null;
  originalBlock: string | null;
  lastProgressAt: number;
  lastAnchor: string | null;
  xrefs: Map<string, string>;
  terms: TermView[];
  /** where the reader was before following a link, newest last */
  back: { id: string; offset: number }[];
}

const state: State = {
  doc: null,
  byId: new Map(),
  pageBlocks: new Map(),
  settings: null,
  strings: null,
  mode: 'book',
  bookmarks: new Set(),
  highlights: [],
  assets: new Map(),
  requested: new Set(),
  selectedBlock: null,
  originalBlock: null,
  lastProgressAt: 0,
  lastAnchor: null,
  xrefs: new Map(),
  terms: [],
  back: [],
};

const ink = new InkLayer({
  dims: (page) => pageWidthHeight(page),
  changed: (page, strokes) => post({ type: 'ink-changed', page, strokes }),
});
let io: IntersectionObserver | null = null;
let sheet: HTMLElement | null = null;
let pill: HTMLElement | null = null;
let backPill: HTMLElement | null = null;

// ---------------------------------------------------------------------------------------- helpers

const rootEl = () => document.getElementById('root') as HTMLElement;
const bookEl = () => document.getElementById('book');
const origEl = () => document.getElementById('orig');
const ctx = (): RenderCtx => ({
  doc: state.doc as Document,
  byId: state.byId,
  strings: state.strings as ReaderStrings,
  settings: state.settings as ReaderSettings,
  bookmarks: state.bookmarks,
  xrefs: state.xrefs,
});

function blockEl(id: string): HTMLElement | null {
  return document.getElementById(id);
}

/** Block ids that are rendered inside another block (captions of floats) resolve to that block. */
function visibleId(id: string): string {
  const b = state.byId.get(id);
  if (b?.type === 'caption' && b.caption_for) return b.caption_for;
  return id;
}

function pageOf(id: string): number {
  return state.byId.get(id)?.source[0].page ?? 1;
}

function pageWidthHeight(page: number): { w: number; h: number } {
  const p = state.doc?.pages.find((x) => x.number === page);
  return { w: p?.width ?? 612, h: p?.height ?? 792 };
}

// ---------------------------------------------------------------------------------------- assets

function setSrc(img: HTMLImageElement, uri: string): void {
  if (img.getAttribute('src') !== uri) img.src = uri;
  img.parentElement?.classList.remove('loading');
}

function loadAsset(img: HTMLImageElement): void {
  const path = img.dataset.asset;
  if (!path) return;
  const cached = state.assets.get(path);
  if (cached) {
    setSrc(img, cached);
  } else if (!state.requested.has(path)) {
    state.requested.add(path);
    post({ type: 'asset-request', path });
  }
}

function receiveAsset(path: string, uri: string): void {
  state.assets.set(path, uri);
  document.querySelectorAll<HTMLImageElement>('img[data-asset]').forEach((img) => {
    if (img.dataset.asset === path && (img.src === '' || img.parentElement?.classList.contains('loading'))) setSrc(img, uri);
  });
}

function observeImages(): void {
  io?.disconnect();
  io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        loadAsset(e.target as HTMLImageElement);
        io?.unobserve(e.target);
      }
    },
    { rootMargin: '1600px 0px' },
  );
  document.querySelectorAll<HTMLImageElement>('img[data-asset]').forEach((img) => io?.observe(img));
}

// ---------------------------------------------------------------------------------------- settings

/** The paged flow only applies to the converted view; the original pages always scroll. */
const paged = (): boolean => state.mode === 'book' && state.settings?.flow === 'paged';

function syncClasses(): void {
  const s = state.settings;
  if (!s) return;
  document.body.className = [
    `t-${s.theme}`,
    `m-${s.margin}`,
    `l-${s.layout}`,
    s.fontFamily === 'sans' ? 'sans' : '',
    s.fontFamily === 'hyperlegible' ? 'ff-hyper' : '',
    s.fontFamily === 'dyslexic' ? 'ff-dys' : '',
    s.ruler ? 'ruler-on' : '',
    s.justify ? 'justify' : '',
    paged() ? 'f-paged' : '',
    state.mode === 'original' ? 'original' : '',
  ]
    .filter(Boolean)
    .join(' ');
  document.documentElement.classList.toggle('f-paged', paged());
}

/** Two translucent bands above and below a clear window in the middle of the screen. */
function ensureRuler(on: boolean): void {
  let ruler = document.getElementById('ruler');
  if (!on) {
    ruler?.remove();
    return;
  }
  if (ruler) return;
  ruler = el('div', null, { id: 'ruler', 'aria-hidden': 'true' }, el('div', 'rb top'), el('div', 'rb bottom'));
  document.body.append(ruler);
}

function applySettings(s: ReaderSettings): void {
  const prev = state.settings;
  state.settings = s;
  syncClasses();
  const root = document.documentElement.style;
  root.setProperty('--fs', `${s.fontSize}px`);
  root.setProperty('--lh', String(s.lineHeight));
  root.setProperty('--ls', `${s.letterSpacing ?? 0}em`);
  root.setProperty('--ws', `${s.wordSpacing ?? 0}em`);
  ensureRuler(s.ruler);
  const bodyPt = state.doc?.body_font_size ?? 10;
  root.setProperty('--k', (s.fontSize / bodyPt).toFixed(4));
  if (prev && prev.showNotes !== s.showNotes) rerender();
}

// ---------------------------------------------------------------------------------------- navigation

// -- paged flow: the book is a row of columns, one screen per `clientWidth`

const screenWidth = (): number => Math.max(1, bookEl()?.clientWidth ?? window.innerWidth);
const screenCount = (): number => {
  const b = bookEl();
  return b ? Math.max(1, Math.ceil((b.scrollWidth - 2) / screenWidth())) : 1;
};
const screenIndex = (): number => Math.min(screenCount() - 1, Math.max(0, Math.round((bookEl()?.scrollLeft ?? 0) / screenWidth())));

function turnPage(dir: 'next' | 'prev' | 'first' | 'last'): void {
  const book = bookEl();
  if (!book || !paged()) return;
  const count = screenCount();
  const to = dir === 'first' ? 0 : dir === 'last' ? count - 1 : Math.min(count - 1, Math.max(0, screenIndex() + (dir === 'next' ? 1 : -1)));
  book.scrollTo({ left: to * screenWidth(), behavior: 'smooth' });
}

let settleTimer: number | undefined;
/** After a swipe the position rests on a whole screen. */
function settleScreen(): void {
  window.clearTimeout(settleTimer);
  settleTimer = window.setTimeout(() => {
    const book = bookEl();
    if (!book || !paged()) return;
    const target = screenIndex() * screenWidth();
    if (Math.abs(book.scrollLeft - target) > 1) book.scrollTo({ left: target, behavior: 'smooth' });
    else reportProgress(true);
  }, 140);
}

function topBlockPaged(): { id: string; offset: number } | null {
  const book = bookEl();
  if (!book) return null;
  const els = Array.from(book.querySelectorAll<HTMLElement>('[data-b]'));
  if (!els.length) return null;
  const left = book.getBoundingClientRect().left + 2;
  const lastRight = (e: HTMLElement) => {
    const rects = e.getClientRects();
    return rects.length ? rects[rects.length - 1].right : -Infinity;
  };
  // the first block with a part that reaches into the visible screen (blocks run in column order)
  let lo = 0;
  let hi = els.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lastRight(els[mid]) <= left) lo = mid + 1;
    else hi = mid;
  }
  return { id: els[lo].id, offset: 0 };
}

function topBlock(): { id: string; offset: number } | null {
  if (paged()) return topBlockPaged();
  const els = Array.from(document.querySelectorAll<HTMLElement>('#book [data-b]'));
  if (!els.length) return null;
  let lo = 0;
  let hi = els.length - 1;
  const probe = 12;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (els[mid].getBoundingClientRect().bottom <= probe) lo = mid + 1;
    else hi = mid;
  }
  const r = els[lo].getBoundingClientRect();
  return { id: els[lo].id, offset: clamp((probe - r.top) / Math.max(r.height, 1), 0, 1) };
}

function visiblePage(): number {
  const pages = Array.from(document.querySelectorAll<HTMLElement>('#orig .pg'));
  const mid = window.innerHeight / 2;
  for (const pg of pages) {
    const r = pg.getBoundingClientRect();
    if (r.top <= mid && r.bottom >= mid) return Number(pg.dataset.page);
  }
  const first = pages.find((pg) => pg.getBoundingClientRect().bottom > 0);
  return first ? Number(first.dataset.page) : 1;
}

function scrollToEl(node: HTMLElement, offset = 0): void {
  const r = node.getBoundingClientRect();
  window.scrollTo({ top: Math.max(0, r.top + window.scrollY + offset * r.height - 10), behavior: 'auto' });
}

function flash(node: HTMLElement | null): void {
  if (!node) return;
  node.classList.remove('flash');
  void node.offsetWidth; // restart the animation
  node.classList.add('flash');
  setTimeout(() => node.classList.remove('flash'), 2000);
}

function gotoBlock(id: string, offset = 0, doFlash = false): void {
  const target = blockEl(visibleId(id));
  if (!target) return;
  const book = bookEl();
  if (paged() && book) {
    const rect = target.getClientRects()[0];
    if (rect) {
      const x = rect.left - book.getBoundingClientRect().left + book.scrollLeft;
      book.scrollTo({ left: Math.floor(x / screenWidth()) * screenWidth(), behavior: 'auto' });
    }
    if (doFlash) flash(target);
    return;
  }
  scrollToEl(target, offset);
  if (doFlash) flash(target);
}

/** Brings a painted highlight into view if it is not already where the eye is. */
function reveal(id: string): void {
  const mark = document.querySelector<HTMLElement>(`mark.hl[data-h="${id}"]`);
  if (!mark) return;
  const r = mark.getBoundingClientRect();
  const book = bookEl();
  if (paged() && book) {
    const x = r.left - book.getBoundingClientRect().left + book.scrollLeft;
    const to = Math.floor(x / screenWidth()) * screenWidth();
    if (Math.abs(book.scrollLeft - to) > 1) book.scrollTo({ left: to, behavior: 'auto' });
    return;
  }
  const h = window.innerHeight;
  if (r.top < h * 0.12 || r.bottom > h * 0.72) window.scrollTo({ top: Math.max(0, r.top + window.scrollY - h * 0.28), behavior: 'smooth' });
}

function gotoPage(page: number): void {
  const pg = document.querySelector<HTMLElement>(`#orig .pg[data-page="${page}"]`);
  if (pg) scrollToEl(pg);
}

let progressTimer: number | undefined;

/** Throttled with a trailing call: the position where scrolling stops is always the one reported. */
function reportProgress(force = false): void {
  const now = Date.now();
  const wait = 250 - (now - state.lastProgressAt);
  if (!force && wait > 0) {
    window.clearTimeout(progressTimer);
    progressTimer = window.setTimeout(() => reportProgress(true), wait);
    return;
  }
  window.clearTimeout(progressTimer);
  state.lastProgressAt = now;
  const book = bookEl();
  const isPaged = paged() && book;
  const max = isPaged ? Math.max(1, (book as HTMLElement).scrollWidth - (book as HTMLElement).clientWidth) : Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  const percent = clamp(((isPaged ? (book as HTMLElement).scrollLeft : window.scrollY) / max) * 100, 0, 100);
  if (state.mode === 'book') {
    const top = topBlock();
    if (top) {
      state.lastAnchor = top.id;
      post({
        type: 'progress', blockId: top.id, offset: top.offset, percent, page: pageOf(top.id),
        ...(isPaged ? { view: { index: screenIndex() + 1, count: screenCount() } } : {}),
      });
    }
  } else {
    post({ type: 'original-tap', blockId: state.originalBlock, page: visiblePage() });
  }
}

// ---------------------------------------------------------------------------------------- original view

function clearRegions(): void {
  document.querySelectorAll('.pg .hl').forEach((n) => n.remove());
}

function showRegions(blockId: string | null): void {
  clearRegions();
  state.originalBlock = blockId;
  if (!blockId) return;
  const b = state.byId.get(blockId);
  if (!b) return;
  for (const src of b.source) {
    const pg = document.querySelector<HTMLElement>(`#orig .pg[data-page="${src.page}"]`);
    if (!pg) continue;
    const { w, h } = pageWidthHeight(src.page);
    const [x0, y0, x1, y1] = src.bbox;
    const hl = el('div', 'hl');
    hl.style.cssText = `left:${(x0 / w) * 100}%;top:${(y0 / h) * 100}%;width:${((x1 - x0) / w) * 100}%;height:${((y1 - y0) / h) * 100}%`;
    pg.append(hl);
  }
}

function blockAtPoint(page: number, x: number, y: number): string | null {
  let best: string | null = null;
  let bestArea = Infinity;
  for (const id of state.pageBlocks.get(page) ?? []) {
    const b = state.byId.get(id);
    if (!b) continue;
    for (const src of b.source) {
      if (src.page !== page) continue;
      const [x0, y0, x1, y1] = src.bbox;
      const slack = 3;
      if (x >= x0 - slack && x <= x1 + slack && y >= y0 - slack && y <= y1 + slack) {
        const area = (x1 - x0) * (y1 - y0);
        if (area < bestArea) {
          best = id;
          bestArea = area;
        }
      }
    }
  }
  return best;
}

function showPill(blockId: string): void {
  pill?.remove();
  pill = el('button', 'pill', null, state.strings?.show_in_book ?? '');
  pill.addEventListener('click', () => setMode('book', blockId));
  document.body.append(pill);
}

function hidePill(): void {
  pill?.remove();
  pill = null;
}

function onOriginalTap(e: MouseEvent): void {
  if (ink.tool !== 'off') return; // the pen is down on the page, not asking which block it is
  const target = e.target as HTMLElement;
  const pg = target.closest<HTMLElement>('.pg');
  if (!pg) return;
  const img = pg.querySelector('img');
  if (!img) return;
  const page = Number(pg.dataset.page);
  const r = img.getBoundingClientRect();
  const { w, h } = pageWidthHeight(page);
  const id = blockAtPoint(page, ((e.clientX - r.left) / r.width) * w, ((e.clientY - r.top) / r.height) * h);
  showRegions(id);
  if (id) showPill(id);
  else hidePill();
  post({ type: 'original-tap', blockId: id, page });
}

// ---------------------------------------------------------------------------------------- mode

function setMode(mode: ReaderMode, blockId?: string): void {
  if (!state.doc) return;
  if (mode === 'original') {
    const top = state.mode === 'book' ? topBlock() : null;
    const id = blockId ?? top?.id ?? null;
    state.mode = 'original';
    syncClasses();
    hidePill();
    updateBackPill();
    const page = id ? pageOf(id) : 1;
    gotoPage(page);
    showRegions(id);
    if (id) showPill(id);
    post({ type: 'mode-changed', mode, blockId: id });
  } else {
    let id = blockId ?? state.originalBlock;
    if (!id) {
      const page = state.mode === 'original' ? visiblePage() : 1;
      id = firstBlockOnPage(page);
    }
    state.mode = 'book';
    syncClasses();
    hidePill();
    updateBackPill();
    if (id) gotoBlock(id, 0, true);
    post({ type: 'mode-changed', mode, blockId: id });
    reportProgress(true);
  }
}

function firstBlockOnPage(page: number): string | null {
  const total = state.doc?.pages.length ?? 0;
  for (let p = page; p <= total; p++) {
    const ids = state.pageBlocks.get(p);
    if (ids?.length) return ids[0];
  }
  return null;
}

// ---------------------------------------------------------------------------------------- popovers

function closeSheet(): void {
  sheet?.remove();
  sheet = null;
}

function updateBackPill(): void {
  backPill?.remove();
  backPill = null;
  if (!state.back.length || state.mode !== 'book') return;
  backPill = el('button', 'pill back', null, `↩ ${state.strings?.back ?? ''}`);
  backPill.addEventListener('click', () => {
    const to = state.back.pop();
    if (to) gotoBlock(to.id, to.offset);
    updateBackPill();
    reportProgress(true);
  });
  document.body.append(backPill);
}

/** Jumps to a block the reader followed a link to, remembering where it came from so "Back" can return. */
function follow(id: string): void {
  const here = topBlock();
  if (here && state.back[state.back.length - 1]?.id !== here.id) state.back.push(here);
  if (state.back.length > 20) state.back.shift();
  gotoBlock(id, 0, true);
  updateBackPill();
}

function sheetWith(...children: (Node | null)[]): HTMLElement {
  closeSheet();
  sheet = el('div', 'sheet', null);
  for (const c of children) if (c) sheet.append(c);
  document.body.append(sheet);
  return sheet;
}

function sheetActions(buttons: [string, () => void][]): HTMLElement {
  const bar = el('div', 'actions', null);
  for (const [label, run] of buttons) {
    const b = el('button', null, null, label);
    b.addEventListener('click', run);
    bar.append(b);
  }
  return bar;
}

function showCitation(refIds: string[]): void {
  const strings = state.strings as ReaderStrings;
  const items: HTMLElement[] = [];
  for (const id of refIds) {
    const b = state.byId.get(id);
    if (b) items.push(el('div', 'ref', null, el('span', 'rl', null, b.number ?? ''), el('div', 'rt', null, b.text)));
  }
  const first = refIds[0];
  const info = state.byId.get(first)?.reference;
  const buttons: [string, () => void][] = [];
  if (first) buttons.push([strings.go_to_reference, () => { closeSheet(); follow(first); }]);
  if (info?.doi) buttons.push([strings.open_doi, () => post({ type: 'link', url: `https://doi.org/${info.doi}` })]);
  if (info && (info.doi || info.url)) {
    buttons.push([strings.add_to_library, () => { closeSheet(); post({ type: 'import-ref', doi: info.doi, url: info.url, title: info.title }); }]);
  }
  buttons.push([strings.close, closeSheet]);
  sheetWith(...items, sheetActions(buttons));
}

/** What "Fig. 2", "Table I" or "Eq. (3)" points at, shown without leaving the place being read. */
function showXref(key: string): void {
  const id = state.xrefs.get(key);
  const target = id ? state.byId.get(id) : null;
  if (!id || !target) return;
  const strings = state.strings as ReaderStrings;
  const node = renderBlock(target, ctx());
  const preview = el('div', 'xpreview', null);
  if (node) {
    // the copy must not take over the block's id, or finding the block in the text would find this one
    node.querySelectorAll('[id],[data-b]').forEach((n) => { n.removeAttribute('id'); n.removeAttribute('data-b'); });
    node.removeAttribute('id');
    node.removeAttribute('data-b');
    node.querySelectorAll('.flagdot').forEach((n) => n.remove());
    node.querySelectorAll<HTMLImageElement>('img[data-asset]').forEach(loadAsset);
    preview.append(node);
  }
  sheetWith(preview, sheetActions([[strings.go_to, () => { closeSheet(); follow(id); }], [strings.close, closeSheet]]));
}

function showTerm(index: number): void {
  const t = state.terms[index];
  if (!t) return;
  const strings = state.strings as ReaderStrings;
  sheetWith(
    el('div', 'termhead', null, t.term),
    el('div', 'termdef', null, t.definition),
    el('div', 'termwhere', null, strings.defined_on.replace('{n}', String(t.page))),
    sheetActions([[strings.go_to_definition, () => { closeSheet(); follow(t.blockId); }], [strings.close, closeSheet]]),
  );
}

function openZoom(img: HTMLImageElement): void {
  if (!img.src) return;
  const layer = el('div', 'zoom');
  const big = el('img', img.classList.contains('tint') ? 'tint' : null, { src: img.src });
  const close = el('button', null, { 'aria-label': state.strings?.close ?? 'close' }, '✕');
  close.addEventListener('click', (e) => {
    e.stopPropagation();
    layer.remove();
  });
  layer.append(close, big);
  document.body.append(layer);
}

// ---------------------------------------------------------------------------------------- selection / taps

function selectBlock(id: string | null): void {
  document.querySelectorAll('.blk.sel').forEach((n) => n.classList.remove('sel'));
  state.selectedBlock = id;
  if (id) blockEl(id)?.classList.add('sel');
}

function onBookClick(e: MouseEvent): void {
  const t = e.target as HTMLElement;
  if (window.getSelection()?.toString()) return; // the user is selecting text
  if (paged() && !t.closest('a,button,summary,details,mark.hl,[data-zoom]')) {
    // the outer fifths of a screen turn the page, like in an e-reader
    const x = e.clientX / window.innerWidth;
    if (x < 0.22) return turnPage('prev');
    if (x > 0.78) return turnPage('next');
  }
  const xref = t.closest<HTMLElement>('a.xref');
  if (xref?.dataset.x) {
    showXref(xref.dataset.x);
    return;
  }
  const term = t.closest<HTMLElement>('abbr.term');
  if (term?.dataset.t) {
    showTerm(Number(term.dataset.t));
    return;
  }
  const cite = t.closest<HTMLElement>('a.cite');
  if (cite) {
    showCitation((cite.dataset.refs ?? '').split(' ').filter(Boolean));
    return;
  }
  const link = t.closest<HTMLElement>('a.link');
  if (link?.dataset.href) {
    post({ type: 'link', url: link.dataset.href });
    return;
  }
  const flag = t.closest<HTMLElement>('[data-flag]');
  if (flag) {
    post({ type: 'flags', blockId: flag.dataset.flag as string });
    return;
  }
  const sep = t.closest<HTMLElement>('.pgsep');
  if (sep) {
    post({ type: 'original-tap', blockId: sep.dataset.first ?? null, page: Number(sep.dataset.page) });
    setMode('original', sep.dataset.first);
    return;
  }
  const view = t.closest<HTMLElement>('button[data-view]');
  if (view) {
    const fig = view.closest('.tbl');
    fig?.querySelectorAll('button[data-view]').forEach((b) => b.classList.toggle('on', b === view));
    const asImage = view.dataset.view === 'image';
    const wrap = fig?.querySelector<HTMLElement>('.tblwrap');
    const img = fig?.querySelector<HTMLElement>('.imgwrap');
    if (wrap) wrap.style.display = asImage ? 'none' : '';
    if (img) img.style.display = asImage ? '' : 'none';
    return;
  }
  const quiz = t.closest<HTMLElement>('[data-quiz]');
  if (quiz) {
    post({ type: 'quiz', sectionId: quiz.dataset.quiz as string });
    return;
  }
  const hl = t.closest<HTMLElement>('mark.hl');
  if (hl?.dataset.h) {
    post({ type: 'highlight-tap', id: hl.dataset.h, rect: rectOf(hl) });
    return;
  }
  const zoom = t.closest<HTMLElement>('[data-zoom]');
  const zimg = zoom?.querySelector('img');
  if (zimg && zimg.src) {
    openZoom(zimg);
    return;
  }
  closeSheet();
  const blk = t.closest<HTMLElement>('[data-b]');
  if (!blk) {
    selectBlock(null);
    post({ type: 'selection-clear' });
    return;
  }
  if (state.selectedBlock === blk.id) {
    selectBlock(null);
    post({ type: 'selection-clear' });
    return;
  }
  selectBlock(blk.id);
  post({ type: 'block-tap', blockId: blk.id, rect: rectOf(blk) });
}

let selectionTimer: number | undefined;

function onSelectionChange(): void {
  window.clearTimeout(selectionTimer);
  selectionTimer = window.setTimeout(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || state.mode !== 'book') {
      post({ type: 'selection-clear' });
      return;
    }
    const range = sel.getRangeAt(0);
    const startEl = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement) as Element | null;
    const blk = startEl?.closest<HTMLElement>('[data-b]');
    const root = blk ? textRoot(blk) : null;
    if (!blk || !root) {
      post({ type: 'selection-clear' });
      return;
    }
    const total = root.textContent?.length ?? 0;
    const start = root.contains(range.startContainer) ? offsetWithin(root, range.startContainer, range.startOffset) : 0;
    const end = root.contains(range.endContainer) ? offsetWithin(root, range.endContainer, range.endOffset) : total;
    if (end <= start) {
      post({ type: 'selection-clear' });
      return;
    }
    const text = (root.textContent ?? '').slice(start, end);
    post({ type: 'selection', blockId: blk.id, start, end, text, rect: rectOf(range) });
  }, 220);
}

// ---------------------------------------------------------------------------------------- lifecycle

function rerender(): void {
  if (!state.doc || !state.settings || !state.strings) return;
  const anchor = state.mode === 'book' ? topBlock() : null;
  closeSheet();
  hidePill();
  const root = rootEl();
  root.replaceChildren(renderBook(ctx()), renderOriginal(ctx()));
  bookEl()?.addEventListener('click', onBookClick);
  bookEl()?.addEventListener('scroll', () => {
    // paged: a position is reported when the screen has come to rest, not while it is still sliding
    if (paged()) settleScreen();
    else reportProgress();
  }, { passive: true });
  origEl()?.addEventListener('click', onOriginalTap);
  if (origEl()) ink.mount(origEl() as HTMLElement);
  observeImages();
  if (state.terms.length) markTerms(document, state.terms);
  paintHighlights(state.highlights);
  if (anchor) gotoBlock(anchor.id, anchor.offset);
  if (state.selectedBlock) selectBlock(state.selectedBlock);
}

function init(msg: InitMessage): void {
  state.doc = msg.doc;
  state.byId = new Map(msg.doc.blocks.map((b) => [b.id, b]));
  state.pageBlocks = new Map();
  for (const b of msg.doc.blocks) {
    for (const page of new Set(b.source.map((s) => s.page))) {
      const list = state.pageBlocks.get(page) ?? [];
      list.push(b.id);
      state.pageBlocks.set(page, list);
    }
  }
  state.xrefs = buildXrefIndex(msg.doc.blocks);
  state.terms = [];
  state.back = [];
  state.strings = msg.strings;
  state.mode = msg.mode;
  state.bookmarks = new Set(msg.bookmarks);
  state.highlights = msg.highlights;
  ink.load(msg.ink ?? []);
  state.selectedBlock = null;
  state.originalBlock = msg.focus?.blockId ?? null;
  document.documentElement.lang = msg.doc.metadata.language ?? 'en';
  applySettings(msg.settings);
  rerender();
  requestAnimationFrame(() => {
    if (msg.focus) {
      if (state.mode === 'original') {
        gotoPage(msg.focus.page ?? pageOf(msg.focus.blockId));
        showRegions(msg.focus.blockId);
        showPill(msg.focus.blockId);
      } else {
        gotoBlock(msg.focus.blockId, 0, true);
      }
    } else if (msg.anchor && state.mode === 'book') {
      gotoBlock(msg.anchor.blockId, msg.anchor.offset);
    }
    reportProgress(true);
  });
}

function handle(msg: HostMessage): void {
  switch (msg.type) {
    case 'init':
      init(msg);
      break;
    case 'settings': {
      const anchor = state.mode === 'book' ? topBlock() : null;
      applySettings(msg.settings);
      // two frames: the columns (or the single column) have to be laid out before a position can be found again
      if (anchor) requestAnimationFrame(() => requestAnimationFrame(() => { gotoBlock(anchor.id, anchor.offset); reportProgress(true); }));
      break;
    }
    case 'mode':
      setMode(msg.mode, msg.blockId);
      break;
    case 'goto':
      if (state.mode !== 'book') setMode('book', msg.blockId);
      else gotoBlock(msg.blockId, msg.offset ?? 0, msg.flash ?? false);
      break;
    case 'goto-page':
      if (state.mode !== 'original') setMode('original', msg.blockId);
      gotoPage(msg.page);
      break;
    case 'page':
      turnPage(msg.dir);
      break;
    case 'asset':
      receiveAsset(msg.path, msg.uri);
      break;
    case 'bookmarks':
      state.bookmarks = new Set(msg.ids);
      document.querySelectorAll('.blk.bm').forEach((n) => n.classList.remove('bm'));
      msg.ids.forEach((id) => blockEl(visibleId(id))?.classList.add('bm'));
      break;
    case 'highlights':
      state.highlights = msg.items;
      paintHighlights(msg.items);
      break;
    case 'ink-tool':
      ink.setTool(msg.tool, msg.color);
      break;
    case 'ink-undo':
      ink.undo();
      break;
    case 'reveal':
      reveal(msg.id);
      break;
    case 'terms':
      state.terms = msg.items;
      markTerms(document, msg.items);
      paintHighlights(state.highlights);
      break;
    case 'clear-selection':
      window.getSelection()?.removeAllRanges();
      selectBlock(null);
      break;
    case 'highlight-block':
      showRegions(msg.blockId);
      break;
  }
}

function boot(): void {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  window.__host = (m) => handle(m as HostMessage);
  window.addEventListener('message', (ev) => {
    try {
      const d = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
      if (d && d.__folumeHost) handle(d.msg as HostMessage);
    } catch {
      /* not for us */
    }
  });
  window.addEventListener('scroll', () => reportProgress(), { passive: true });
  window.addEventListener('resize', () => {
    // a new width re-flows the columns: stay on the block that was being read
    if (paged() && state.lastAnchor) {
      const id = state.lastAnchor;
      requestAnimationFrame(() => { gotoBlock(id); reportProgress(true); });
    } else reportProgress();
  });
  window.addEventListener('keydown', (e) => {
    if (!paged() || e.metaKey || e.ctrlKey || e.altKey) return;
    const map: Record<string, 'next' | 'prev' | 'first' | 'last'> = {
      ArrowRight: 'next', PageDown: 'next', ' ': 'next', ArrowLeft: 'prev', PageUp: 'prev', Home: 'first', End: 'last',
    };
    const dir = map[e.key];
    if (!dir) return;
    e.preventDefault();
    turnPage(dir);
  });
  document.addEventListener('selectionchange', onSelectionChange);
  window.addEventListener('error', (e) => post({ type: 'log', level: 'error', message: String(e.message) }));
  post({ type: 'ready' });
}

export type { Anchor };
boot();
