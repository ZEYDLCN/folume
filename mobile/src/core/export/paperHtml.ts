/** The paper as XHTML: the same markup fills the standalone HTML file and the chapters of an EPUB. */
import { bytesToBase64, mimeForPath } from '../base64';
import { safeExternalUrl } from '../links';
import type { Block, Document, Span } from '../types';
import { htmlCss } from './paperCss';
import {
  DEFAULT_PAPER_OPTIONS, EN_EXPORT_STRINGS, anchor, esc, listMarker, mergeSpans, omittedOf, planPaper, sameLetters, titleOf,
  type Entry, type PaperOptions, type Plan,
} from './paperShared';

export interface HtmlContext {
  doc: Document;
  plan: Plan;
  options: PaperOptions;
  /** where an image is written in the output, or null when it is not included */
  imageSrc(path: string): string | null;
  /** the link target for a block id (a fragment in one file, `chapter.xhtml#id` across chapters) */
  href(id: string): string;
  epub: boolean;
  /** every word this export adds around the paper's own text */
  chrome: string[];
  images: Set<string>;
}

const strings = (c: HtmlContext) => c.options.strings ?? EN_EXPORT_STRINGS;

function inline(spans: Span[], fallback: string, c: HtmlContext): string {
  if (!spans.length) return esc(fallback);
  return mergeSpans(spans)
    .map((s) => {
      let h = esc(s.text);
      if (s.mono) h = `<code>${h}</code>`;
      if (s.italic) h = `<em>${h}</em>`;
      if (s.bold) h = `<strong>${h}</strong>`;
      if (s.sub) h = `<sub>${h}</sub>`;
      if (s.sup) h = `<sup>${h}</sup>`;
      if (s.math) h = `<span class="m">${h}</span>`;
      const target = s.cite.find((id) => c.plan.byId.has(id));
      if (target) return `<a class="cite" href="${esc(c.href(target))}">${h}</a>`;
      const url = s.link ? safeExternalUrl(s.link) : null;
      return url ? `<a class="link" href="${esc(url)}">${h}</a>` : h;
    })
    .join('');
}

const body = (b: Block, c: HtmlContext) => inline(b.spans, b.text, c);

function figtext(b: Block, label: string, c: HtmlContext): string {
  if (!b.inner_text) return '';
  c.chrome.push(label);
  return `<details class="figtext"><summary>${esc(label)}</summary><pre>${esc(b.inner_text)}</pre></details>`;
}

function image(path: string, alt: string, c: HtmlContext): string {
  const src = c.options.images ? c.imageSrc(path) : null;
  if (!src) return '';
  c.images.add(path);
  return `<img src="${esc(src)}" alt="${esc(alt)}"/>`;
}

function caption(cap: Block | null, c: HtmlContext): string {
  return cap ? `<figcaption id="${anchor(cap.id)}">${body(cap, c)}</figcaption>` : '';
}

function tableHtml(b: Block, cap: Block | null, c: HtmlContext): string {
  const t = b.table;
  const id = anchor(b.id);
  if (t) {
    const row = (cells: string[], head: boolean) => {
      const tag = head ? 'th' : 'td';
      const cell = (x: string) => `<${tag}${!head && /^[-+−]?[\d.,]+%?$/.test(x.trim()) ? ' class="num"' : ''}>${esc(x)}</${tag}>`;
      return `<tr>${cells.map(cell).join('')}</tr>`;
    };
    const headRows = t.rows.slice(0, t.header_rows).map((r) => row(r, true)).join('');
    const bodyRows = t.rows.slice(t.header_rows).map((r) => row(r, false)).join('');
    // the cells are the table's text; if the converter kept any letter outside them, it stays reachable too
    const extra = b.inner_text && !sameLetters(t.rows.map((r) => r.join(' ')).join(' '), b.inner_text) ? figtext(b, strings(c).tableText, c) : '';
    return `<figure class="tbl" id="${id}">${caption(cap, c)}<div class="tblwrap"><table>${headRows ? `<thead>${headRows}</thead>` : ''}<tbody>${bodyRows}</tbody></table></div>${extra}</figure>`;
  }
  const img = b.asset ? image(b.asset.path, '', c) : '';
  const text = b.inner_text
    ? img
      ? figtext(b, strings(c).tableText, c)
      : `<pre class="tabletext">${esc(b.inner_text)}</pre>`
    : '';
  return `<figure class="tbl" id="${id}">${caption(cap, c)}${img}${text}</figure>`;
}

function renderEntry(e: Entry, c: HtmlContext): string {
  const b = e.block;
  const id = anchor(b.id);
  switch (b.type) {
    case 'title':
      return `<h1 class="title" id="${id}">${body(b, c)}</h1>`;
    case 'authors':
      return `<p class="authors" id="${id}">${body(b, c)}</p>`;
    case 'heading': {
      const tag = b.level === 1 || b.level === null ? 'h2' : b.level === 2 ? 'h3' : 'h4';
      const label = b.prefix ? `<span class="hn">${esc(b.prefix)}</span>` : '';
      return `<${tag} class="h" id="${id}">${label}<span class="bt">${esc(b.text)}</span></${tag}>`;
    }
    case 'paragraph': {
      const abstract = c.doc.sections.some((s) => s.kind === 'abstract' && s.block_id === b.id);
      const classes = ['blk-paragraph', e.lead ? 'lead' : '', abstract ? 'abstract' : ''].filter(Boolean).join(' ');
      const label = b.prefix ? `<span class="px">${esc(b.prefix)}</span> ` : '';
      return `<p class="${classes}" id="${id}">${label}${body(b, c)}</p>`;
    }
    case 'list_item':
      return `<li id="${id}"><span class="mk">${esc(listMarker(b))}</span><div class="lt">${body(b, c)}</div></li>`;
    case 'figure': {
      const img = b.asset ? image(b.asset.path, '', c) : '';
      return `<figure class="fig" id="${id}">${img}${figtext(b, strings(c).figureText, c)}${caption(e.caption, c)}</figure>`;
    }
    case 'table':
      return tableHtml(b, e.caption, c);
    case 'equation': {
      const img = b.asset ? image(b.asset.path, b.text, c) : '';
      const num = b.number ? `<span class="eqn" data-n="${esc(b.number)}"></span>` : '';
      const content = img ? `<div class="eqbody">${img}</div>` : `<div class="eqbody"><span class="eqt">${esc(b.text)}</span></div>`;
      return `<div class="eq" id="${id}">${content}${num}</div>`;
    }
    case 'caption':
      return `<p class="cap" id="${id}">${body(b, c)}</p>`;
    case 'footnote': {
      const epubType = c.epub ? ' epub:type="footnote"' : '';
      const label = b.prefix ? `<span class="fnm">${esc(b.prefix)}</span>` : '';
      return `<aside class="fn" id="${id}"${epubType}>${label}${body(b, c)}</aside>`;
    }
    case 'reference': {
      const label = b.prefix ? esc(b.prefix) : '';
      return `<div class="ref" id="${id}"><span class="rl">${label}</span><div class="rt">${body(b, c)}</div></div>`;
    }
    case 'code':
      return `<pre class="code" id="${id}"><code>${esc(b.text)}</code></pre>`;
    default:
      return '';
  }
}

function pageMarker(page: number, c: HtmlContext): string {
  const label = `${strings(c).page} ${page}`;
  const epub = c.epub ? ' epub:type="pagebreak"' : '';
  return `<div class="pgb" id="page-${page}" role="doc-pagebreak"${epub} aria-label="${esc(label)}" data-label="${esc(label)}"></div>`;
}

/** The entries `from..to` of the plan as markup; runs of list items share one list. */
export function renderEntries(c: HtmlContext, from = 0, to = c.plan.entries.length): string {
  const out: string[] = [];
  let open = false;
  const close = () => {
    if (open) out.push('</ul>');
    open = false;
  };
  for (const e of c.plan.entries.slice(from, to)) {
    if (e.page !== null) {
      close();
      out.push(pageMarker(e.page, c));
    }
    if (e.block.type === 'list_item') {
      if (!open) out.push('<ul class="list">');
      open = true;
    } else close();
    out.push(renderEntry(e, c));
  }
  close();
  return out.join('\n');
}

/** Page headers, footers and numbers the reading text leaves out, listed so that nothing of the PDF text is lost. */
export function renderRemoved(c: HtmlContext): string {
  if (!c.options.appendix) return '';
  const items = omittedOf(c.doc);
  if (!items.length) return '';
  const s = strings(c);
  c.chrome.push(s.removedTitle, s.removedIntro);
  const rows = items.map((o) => `<p class="rm" data-label="${esc(`${s.page} ${o.page}`)}">${esc(o.text)}</p>`).join('\n');
  return `<section class="removed" id="removed"><h2 class="h">${esc(s.removedTitle)}</h2><p>${esc(s.removedIntro)}</p>\n${rows}</section>`;
}

export interface HtmlBuild {
  html: string;
  chrome: string[];
  images: number;
}

/** One self-contained HTML file: style sheet inline, images as data URIs, no scripts, no external requests. */
export function buildHtml(doc: Document, assets: Map<string, Uint8Array>, options: Partial<PaperOptions> = {}): HtmlBuild {
  const opts: PaperOptions = { ...DEFAULT_PAPER_OPTIONS, ...options };
  const plan = planPaper(doc);
  const c: HtmlContext = {
    doc, plan, options: opts, epub: false, chrome: [], images: new Set(),
    imageSrc: (path) => {
      const bytes = assets.get(path);
      return bytes ? `data:${mimeForPath(path)};base64,${bytesToBase64(bytes)}` : null;
    },
    href: (id) => `#${anchor(id)}`,
  };
  const main = renderEntries(c);
  const removed = renderRemoved(c);
  const lang = esc(doc.metadata.language || 'en');
  const authors = doc.metadata.authors.length ? `<meta name="author" content="${esc(doc.metadata.authors.join(', '))}"/>\n` : '';
  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="generator" content="Folume"/>
${authors}<title>${esc(titleOf(doc))}</title>
<style>${htmlCss(opts.theme, opts.layout, opts.fontFamily)}</style>
</head>
<body class="l-${opts.layout}">
<main>
${main}
${removed}
</main>
</body>
</html>
`;
  return { html, chrome: c.chrome, images: c.images.size };
}
