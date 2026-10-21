/** The paper as Markdown (CommonMark + GFM tables) and as plain text. */
import { safeExternalUrl } from '../links';
import type { Block, Document, Span } from '../types';
import {
  DEFAULT_PAPER_OPTIONS, EN_EXPORT_STRINGS, anchor, listMarker, mergeSpans, omittedOf, planPaper, sameLetters, titleOf, xmlSafe,
  type PaperOptions, type Plan,
} from './paperShared';

const BULLETS = /^[•●◦▪‣∙·\-–*]$/;
const oneLine = (s: string) => xmlSafe(s).replace(/\s+/g, ' ').trim();

/** Backslash-escapes every character Markdown could read as syntax. Backslashes are never letters, so nothing is lost. */
function mdText(s: string): string {
  return oneLine(s).replace(/[\\`*_{}[\]<>|~$&]/g, '\\$&');
}

/** A line that starts like a heading, quote, bullet or numbered list must not become one. */
function lineStart(s: string): string {
  return s.replace(/^(\s*)([#>+-])/, '$1\\$2').replace(/^(\s*\d+)([.)])/, '$1\\$2');
}

function wrap(mark: string, text: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
  return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : text;
}

function mdSpans(spans: Span[], fallback: string, plan: Plan): string {
  if (!spans.length) return mdText(fallback);
  return mergeSpans(spans)
    .map((s) => {
      let t = mdText(s.text);
      if (s.mono) {
        const raw = oneLine(s.text);
        const fence = '`'.repeat(Math.max(...[...raw.matchAll(/`+/g)].map((m) => m[0].length), 0) + 1);
        t = `${fence}${raw.startsWith('`') || raw.endsWith('`') ? ` ${raw} ` : raw}${fence}`;
      }
      if (s.sub) t = `<sub>${t}</sub>`;
      if (s.sup) t = `<sup>${t}</sup>`;
      if (s.italic || s.math) t = wrap('*', t);
      if (s.bold) t = wrap('**', t);
      const target = s.cite.find((id) => plan.byId.has(id));
      if (target) return `[${t}](#${anchor(target)})`;
      const url = s.link ? safeExternalUrl(s.link) : null;
      return url ? `[${t}](${url.replace(/[()\s]/g, (c) => encodeURIComponent(c))})` : t;
    })
    .join('');
}

function fence(content: string): string {
  const longest = Math.max(...[...content.matchAll(/`+/g)].map((m) => m[0].length), 0);
  const f = '`'.repeat(Math.max(3, longest + 1));
  return `${f}\n${xmlSafe(content)}\n${f}`;
}

export interface MarkdownBuild {
  markdown: string;
  /** image files to put next to the Markdown, keyed by the relative path the Markdown uses */
  images: Map<string, Uint8Array>;
  chrome: string[];
}

export function buildMarkdown(doc: Document, assets: Map<string, Uint8Array>, options: Partial<PaperOptions> = {}): MarkdownBuild {
  const opts: PaperOptions = { ...DEFAULT_PAPER_OPTIONS, ...options };
  const s = opts.strings ?? EN_EXPORT_STRINGS;
  const plan = planPaper(doc);
  const chrome: string[] = [];
  const images = new Map<string, Uint8Array>();
  const out: string[] = [];
  const imagePath = (path: string): string | null => {
    const bytes = opts.images ? assets.get(path) : undefined;
    if (!bytes) return null;
    const rel = `images/${path.replace(/[^A-Za-z0-9._-]+/g, '-')}`;
    images.set(rel, bytes);
    return rel;
  };
  const alt = (t: string) => oneLine(t).replace(/[\\[\]]/g, '\\$&');
  const details = (b: Block, label: string) => {
    if (!b.inner_text) return;
    chrome.push(label);
    out.push(`<details><summary>${label.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</summary>\n\n${fence(b.inner_text)}\n\n</details>`);
  };
  const quote = (b: Block | null) => {
    if (b) out.push(`> ${mdSpans(b.spans, b.text, plan)}`);
  };
  let list = false;
  for (const e of plan.entries) {
    const b = e.block;
    if (e.page !== null) out.push(`<!-- page ${e.page} -->`);
    if (b.type !== 'list_item') list = false;
    const text = mdSpans(b.spans, b.text, plan);
    switch (b.type) {
      case 'title':
        out.push(`# ${text}`);
        break;
      case 'authors':
        out.push(text);
        break;
      case 'heading': {
        const hashes = b.level === 1 || b.level === null ? '##' : b.level === 2 ? '###' : '####';
        out.push(`${hashes} ${b.prefix ? `${mdText(b.prefix)} ` : ''}${mdText(b.text)}`);
        break;
      }
      case 'paragraph':
        out.push(lineStart(`${b.prefix ? `**${mdText(b.prefix)}** ` : ''}${text}`));
        break;
      case 'list_item': {
        const marker = listMarker(b);
        const label = marker && !BULLETS.test(marker) ? `${mdText(marker)} ` : '';
        out.push(`${list ? '\u0000' : ''}- ${label}${text}`);
        list = true;
        break;
      }
      case 'figure': {
        const src = b.asset ? imagePath(b.asset.path) : null;
        if (src) out.push(`![](${src})`);
        details(b, s.figureText);
        quote(e.caption);
        break;
      }
      case 'table': {
        const t = b.table;
        if (t && t.rows.length) {
          quote(e.caption);
          const cell = (x: string) => mdText(x) || ' ';
          const width = Math.max(...t.rows.map((r) => r.length));
          const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => cell(r[i] ?? '')).join(' | ')} |`;
          const rows = [line(t.rows[0]), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`, ...t.rows.slice(1).map(line)];
          out.push(rows.join('\n'));
          if (b.inner_text && !sameLetters(t.rows.map((r) => r.join(' ')).join(' '), b.inner_text)) details(b, s.tableText);
        } else {
          quote(e.caption);
          const src = b.asset ? imagePath(b.asset.path) : null;
          if (src) out.push(`![](${src})`);
          if (b.inner_text) {
            if (src) details(b, s.tableText);
            else out.push(fence(b.inner_text));
          }
        }
        break;
      }
      case 'equation': {
        const src = b.asset ? imagePath(b.asset.path) : null;
        out.push(src ? `![${alt(b.text)}](${src})` : lineStart(wrap('*', mdText(b.text))));
        break;
      }
      case 'caption':
        quote(b);
        break;
      case 'footnote':
        out.push(`> ${b.prefix ? `**${mdText(b.prefix)}** ` : ''}${text}`);
        break;
      case 'reference':
        out.push(`<a id="${anchor(b.id)}"></a>${b.prefix ? `${mdText(b.prefix)} ` : ''}${text}`);
        break;
      case 'code':
        out.push(fence(b.text));
        break;
      default:
        break;
    }
  }
  if (opts.appendix) {
    const items = omittedOf(doc);
    if (items.length) {
      chrome.push(s.removedTitle, s.removedIntro);
      out.push(`## ${mdText(s.removedTitle)}`, mdText(s.removedIntro));
      for (const o of items) out.push(`<!-- page ${o.page} -->\n${lineStart(mdText(o.text))}`);
    }
  }
  // list items stay together: a marker joins a line to the previous item without a blank line
  const markdown = out.join('\n\n').replace(/\n\n\u0000/g, '\n') + '\n';
  return { markdown, images, chrome };
}

// -------------------------------------------------------------------------------------------------- plain text

export interface TextBuild {
  text: string;
  chrome: string[];
}

function grid(rows: string[][]): string {
  const clean = rows.map((r) => r.map(oneLine));
  const width = Math.max(...clean.map((r) => r.length));
  const cols = Array.from({ length: width }, (_, i) => Math.min(32, Math.max(...clean.map((r) => (r[i] ?? '').length))));
  return clean.map((r) => r.map((c, i) => (i < width - 1 ? c.padEnd(cols[i]) : c)).join('  ').trimEnd()).join('\n');
}

/** Plain text: paragraphs separated by blank lines, tables as aligned columns, no markup of any kind. */
export function buildText(doc: Document, options: Partial<PaperOptions> = {}): TextBuild {
  const opts: PaperOptions = { ...DEFAULT_PAPER_OPTIONS, ...options };
  const s = opts.strings ?? EN_EXPORT_STRINGS;
  const plan = planPaper(doc);
  const chrome: string[] = [];
  const out: string[] = [];
  const join = (...p: (string | null | undefined)[]) => p.filter(Boolean).join(' ');
  const clean = (t: string) => xmlSafe(t).replace(/[ \t]+\n/g, '\n').trim();
  const inner = (b: Block, label: string) => {
    if (!b.inner_text) return;
    chrome.push(label);
    out.push(`${label}:\n${clean(b.inner_text).replace(/^/gm, '  ')}`);
  };
  let list = false;
  for (const e of plan.entries) {
    const b = e.block;
    if (b.type !== 'list_item') list = false;
    switch (b.type) {
      case 'title':
        out.push(oneLine(b.text));
        break;
      case 'heading':
        out.push(join(b.prefix, oneLine(b.text)));
        break;
      case 'list_item':
        out.push(`${list ? '\u0000' : ''}${join(listMarker(b) || '-', oneLine(b.text))}`);
        list = true;
        break;
      case 'figure':
        inner(b, s.figureText);
        if (e.caption) out.push(oneLine(e.caption.text));
        break;
      case 'table':
        if (e.caption) out.push(oneLine(e.caption.text));
        if (b.table && b.table.rows.length) {
          out.push(grid(b.table.rows));
          if (b.inner_text && !sameLetters(b.table.rows.map((r) => r.join(' ')).join(' '), b.inner_text)) inner(b, s.tableText);
        } else if (b.inner_text) inner(b, s.tableText);
        break;
      case 'equation':
        out.push(`    ${oneLine(b.text)}`);
        break;
      case 'footnote':
        out.push(`  ${join(b.prefix, oneLine(b.text))}`);
        break;
      case 'reference':
        out.push(join(b.prefix, oneLine(b.text)));
        break;
      case 'code':
        out.push(clean(b.text));
        break;
      default:
        out.push(join(b.prefix, oneLine(b.text)));
    }
  }
  if (opts.appendix) {
    const items = omittedOf(doc);
    if (items.length) {
      chrome.push(s.removedTitle, s.removedIntro);
      out.push(s.removedTitle, s.removedIntro, ...items.map((o) => oneLine(o.text)));
    }
  }
  return { text: out.join('\n\n').replace(/\n\n\u0000/g, '\n') + '\n', chrome };
}

export { titleOf };
