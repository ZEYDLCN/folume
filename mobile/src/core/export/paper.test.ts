/**
 * The exports must carry every letter and digit of the document, in every format.
 *
 * The check does not trust the exporters: HTML and EPUB are read back with an XML parser (so they must be well formed),
 * Markdown is rendered by markdown-it, and the letters found are compared with the document's own text. What an
 * export adds around the paper (labels of collapsed figure text, the removed-text heading) is declared in `chrome`
 * and must account for every extra letter.
 */
import { DOMParser } from '@xmldom/xmldom';
import MarkdownIt from 'markdown-it';

import { blockFullText } from '../completeness';
import type { Document } from '../types';
import { acmGraph, clone, ieeeMl, mlCompanion } from '@/testing/fixtures';

import { exportPaper, slugify, TR_EXPORT_STRINGS, type PaperFormat, type PaperOptions } from './paper';
import { buildEpub } from './paperEpub';
import { buildHtml } from './paperHtml';
import { buildMarkdown, buildText } from './paperMarkdown';
import { unzip } from './zip';

const DOCS: [string, Document][] = [['ieee_ml', ieeeMl], ['acm_graph', acmGraph], ['ml_companion', mlCompanion]];
const NOW = new Date(Date.UTC(2026, 9, 21, 12, 0, 0));
const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
const JPG = Uint8Array.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70]);

// ------------------------------------------------------------------------------------------------------- helpers

type Letters = Map<string, number>;

function letters(text: string): Letters {
  const m: Letters = new Map();
  for (const ch of text.normalize('NFKC')) if (/[\p{L}\p{N}]/u.test(ch)) m.set(ch, (m.get(ch) ?? 0) + 1);
  return m;
}

function plus(a: Letters, b: Letters): Letters {
  const out = new Map(a);
  for (const [k, v] of b) out.set(k, (out.get(k) ?? 0) + v);
  return out;
}

/** a minus b, keeping only what is left over */
function minus(a: Letters, b: Letters): Letters {
  const out: Letters = new Map();
  for (const [k, v] of a) if (v > (b.get(k) ?? 0)) out.set(k, v - (b.get(k) ?? 0));
  return out;
}

const show = (m: Letters) => [...m].map(([k, v]) => `${k}×${v}`).join(' ');

function expected(doc: Document, appendix: boolean): Letters {
  const parts = doc.blocks.map(blockFullText);
  if (appendix) parts.push(...doc.quality.omitted.map((o) => o.text || o.preview));
  return letters(parts.join('\n'));
}

function strictXml(xml: string, name = 'document'): Document | any {
  const problems: string[] = [];
  const handler = (level: string) => (msg: string) => problems.push(`${level}: ${msg}`);
  const dom = new DOMParser({ errorHandler: { warning: handler('warning'), error: handler('error'), fatalError: handler('fatal') } })
    .parseFromString(xml, 'application/xhtml+xml');
  if (problems.length) throw new Error(`${name} is not well formed XML: ${problems.slice(0, 3).join(' | ')}`);
  return dom;
}

/** The text a reader of an XHTML file gets: text nodes of the body, plus the alternative text of images. */
function xmlBodyText(xml: string, name?: string): string {
  const dom = strictXml(xml, name);
  const body = dom.getElementsByTagName('body')[0];
  const out: string[] = [];
  const walk = (n: any) => {
    if (n.nodeType === 3 || n.nodeType === 4) out.push(n.data);
    else if (n.nodeType === 1) {
      if (n.tagName === 'img') out.push(` ${n.getAttribute('alt') ?? ''} `);
      for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
      if (/^(p|div|h[1-6]|li|figure|figcaption|pre|summary|td|th|aside|section)$/.test(n.tagName)) out.push('\n');
    }
  };
  walk(body);
  return out.join('');
}

const md = new MarkdownIt({ html: true });
function markdownText(source: string): string {
  const html = md.render(source);
  const withAlt = html.replace(/<img[^>]*alt="([^"]*)"[^>]*>/g, ' $1 ');
  return withAlt
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function assetsOf(doc: Document): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const b of doc.blocks) if (b.asset) out.set(b.asset.path, b.asset.path.endsWith('.jpg') ? JPG : PNG);
  return out;
}

/** every format as text, plus the chrome it declared */
function render(doc: Document, format: PaperFormat, options: Partial<PaperOptions>): { text: string; chrome: string[] } {
  const assets = assetsOf(doc);
  const opts = { ...options, now: NOW };
  if (format === 'html') {
    const r = buildHtml(doc, assets, opts);
    return { text: xmlBodyText(r.html, 'html'), chrome: r.chrome };
  }
  if (format === 'epub') {
    const r = buildEpub(doc, assets, opts);
    const files = unzip(r.bytes);
    const chapters = [...files.keys()].filter((n) => /OEBPS\/c\d+\.xhtml$/.test(n)).sort();
    const text = chapters.map((n) => xmlBodyText(new TextDecoder().decode(files.get(n)), n)).join('\n');
    return { text, chrome: r.chrome };
  }
  if (format === 'markdown') {
    const r = buildMarkdown(doc, assets, opts);
    return { text: markdownText(r.markdown), chrome: r.chrome };
  }
  const r = buildText(doc, opts);
  return { text: r.text, chrome: r.chrome };
}

const FORMATS: PaperFormat[] = ['html', 'epub', 'markdown', 'text'];

// ------------------------------------------------------------------------------- no letter is lost, none is invented

describe.each(DOCS)('%s: every format holds exactly the letters of the document', (_name, doc) => {
  describe.each(FORMATS)('%s', (format) => {
    it.each([true, false])('with the removed-text section = %s', (appendix) => {
      const { text, chrome } = render(doc, format, { appendix, images: true });
      const want = expected(doc, appendix);
      const got = letters(text);
      const added = letters(chrome.join('\n'));
      expect(show(minus(want, got))).toBe(''); // nothing missing
      expect(show(minus(got, plus(want, added)))).toBe(''); // nothing invented beyond the declared labels
    });
  });

  it.each(['html', 'epub', 'markdown'] as const)('%s without images still holds every letter (figure text and equation text stay)', (format) => {
    const { text, chrome } = render(doc, format, { images: false, appendix: true });
    const want = plus(expected(doc, true), letters(chrome.join('\n')));
    expect(show(minus(want, letters(text)))).toBe('');
    expect(show(minus(letters(text), want))).toBe('');
  });
});

it('the Magazine layout holds the same letters as the Book layout', () => {
  for (const format of ['html', 'epub'] as const) {
    const book = render(ieeeMl, format, { layout: 'book' });
    const magazine = render(ieeeMl, format, { layout: 'magazine' });
    expect(show(minus(letters(magazine.text), letters(book.text)))).toBe('');
    expect(show(minus(letters(book.text), letters(magazine.text)))).toBe('');
  }
});

it('a Turkish label set changes only the declared labels', () => {
  const en = render(ieeeMl, 'html', { appendix: true });
  const tr = render(ieeeMl, 'html', { appendix: true, strings: TR_EXPORT_STRINGS });
  const delta = minus(letters(tr.text), letters(en.text));
  expect(show(minus(delta, letters(tr.chrome.join('\n'))))).toBe('');
  expect(tr.chrome).toContain(TR_EXPORT_STRINGS.removedTitle);
});

// ------------------------------------------------------------------------------------------------------ the HTML file

describe('standalone HTML', () => {
  const assets = assetsOf(ieeeMl);
  const { html } = buildHtml(ieeeMl, assets, { now: NOW });

  it('is one well-formed file with no scripts and no requests to other sites', () => {
    strictXml(html, 'html');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<(?:img|link|script|iframe)[^>]+(?:src|href)="https?:/i);
    expect(html).toMatch(/<html lang="en"/);
    expect(html).toMatch(/<title>Sparse Routing for Efficient Transformers<\/title>/);
  });

  it('carries its images inside the file', () => {
    expect(html).toContain('src="data:image/png;base64,');
    // a table with readable cells is drawn from them; its picture is not repeated
    expect(html.match(/<img /g)!.length).toBe(ieeeMl.blocks.filter((b) => b.asset && !(b.type === 'table' && b.table)).length);
  });

  it('links every citation to its reference inside the file', () => {
    const dom = strictXml(html);
    const ids = new Set<string>();
    const all = dom.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) if (all[i].getAttribute('id')) ids.add(all[i].getAttribute('id'));
    const links = dom.getElementsByTagName('a');
    let cites = 0;
    for (let i = 0; i < links.length; i++) {
      const href: string = links[i].getAttribute('href');
      if (href.startsWith('#')) {
        cites += 1;
        expect(ids.has(href.slice(1))).toBe(true);
      }
    }
    expect(cites).toBeGreaterThan(3);
  });

  it('follows the chosen theme and layout', () => {
    const dark = buildHtml(ieeeMl, assets, { theme: 'dark', layout: 'magazine', fontFamily: 'sans' }).html;
    expect(dark).toContain('#17181b');
    expect(dark).toContain('class="l-magazine"');
    expect(dark).toContain('column-count:2');
    expect(html).toContain('#fcf1e5');
    expect(html).toContain('class="l-book"');
    expect(html).not.toContain('column-count');
  });

  it('marks where each page of the PDF began, without adding text', () => {
    const marks = html.match(/class="pgb"/g)!.length;
    expect(marks).toBe(ieeeMl.pages.length);
    expect(html).toMatch(/id="page-1"[^>]*role="doc-pagebreak"/);
  });

  it('keeps the removed text out of the body unless asked for', () => {
    expect(html).toContain('id="removed"');
    expect(buildHtml(ieeeMl, assets, { appendix: false }).html).not.toContain('id="removed"');
  });
});

// ------------------------------------------------------------------------------------------------------- the EPUB file

describe('EPUB', () => {
  const doc = ieeeMl;
  const built = buildEpub(doc, assetsOf(doc), { now: NOW });
  const files = unzip(built.bytes);
  const text = (n: string) => new TextDecoder().decode(files.get(n));

  it('starts with an uncompressed mimetype, then container.xml', () => {
    expect([...files.keys()].slice(0, 2)).toEqual(['mimetype', 'META-INF/container.xml']);
    expect(text('mimetype')).toBe('application/epub+zip');
  });

  it('has a package whose manifest and spine match the files exactly', () => {
    const container = strictXml(text('META-INF/container.xml'));
    const opfPath = container.getElementsByTagName('rootfile')[0].getAttribute('full-path');
    expect(files.has(opfPath)).toBe(true);
    const opf = strictXml(text(opfPath), 'opf');
    const dir = opfPath.replace(/[^/]+$/, '');
    const items = opf.getElementsByTagName('item');
    const manifest = new Map<string, string>();
    const hrefs = new Set<string>();
    for (let i = 0; i < items.length; i++) {
      const id = items[i].getAttribute('id');
      const href = items[i].getAttribute('href');
      expect(manifest.has(id)).toBe(false);
      manifest.set(id, href);
      hrefs.add(`${dir}${href}`);
      expect(files.has(`${dir}${href}`)).toBe(true);
      expect(items[i].getAttribute('media-type')).toBeTruthy();
    }
    // every file but the three packaging files is in the manifest
    const rest = [...files.keys()].filter((n) => !['mimetype', 'META-INF/container.xml', opfPath].includes(n));
    expect(new Set(rest)).toEqual(hrefs);
    const refs = opf.getElementsByTagName('itemref');
    expect(refs.length).toBe(built.chapters);
    for (let i = 0; i < refs.length; i++) expect(manifest.has(refs[i].getAttribute('idref'))).toBe(true);
    const nav = [...Array.from({ length: items.length }, (_, i) => items[i])].filter((x) => x.getAttribute('properties') === 'nav');
    expect(nav).toHaveLength(1);
  });

  it('names the book, its authors, language, a stable identifier and the modification time', () => {
    const opf = strictXml(text('OEBPS/content.opf'));
    const first = (tag: string) => opf.getElementsByTagName(tag)[0].textContent;
    expect(first('dc:title')).toBe(doc.metadata.title);
    expect(first('dc:language')).toBe('en');
    expect(first('dc:identifier')).toMatch(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(opf.getElementsByTagName('dc:creator').length).toBe(doc.metadata.authors.length);
    expect(text('OEBPS/content.opf')).toContain('<meta property="dcterms:modified">2026-10-21T12:00:00Z</meta>');
    expect(buildEpub(doc, assetsOf(doc), { now: NOW }).bytes).toEqual(built.bytes); // reproducible
  });

  it('splits the paper into chapters at its top-level sections and lists them in the contents', () => {
    expect(built.chapters).toBeGreaterThanOrEqual(6);
    const nav = strictXml(text('OEBPS/nav.xhtml'), 'nav');
    const toc = nav.getElementsByTagName('nav')[0];
    expect(toc.getAttribute('epub:type')).toBe('toc');
    const entries = toc.getElementsByTagName('a');
    expect(entries.length).toBe(built.chapters);
    expect(entries[0].textContent).toBe(doc.metadata.title);
    const titles = Array.from({ length: entries.length }, (_, i) => entries[i].textContent as string);
    expect(titles.some((t) => /INTRODUCTION/.test(t))).toBe(true);
  });

  it('has only well-formed chapters whose links, images and ids all resolve', () => {
    const ids = new Map<string, Set<string>>();
    const chapters = [...files.keys()].filter((n) => /OEBPS\/c\d+\.xhtml$/.test(n));
    for (const n of chapters) {
      const dom = strictXml(text(n), n);
      const here = new Set<string>();
      const all = dom.getElementsByTagName('*');
      for (let i = 0; i < all.length; i++) {
        const id = all[i].getAttribute('id');
        if (id) {
          expect(here.has(id)).toBe(false);
          here.add(id);
        }
      }
      ids.set(n.replace('OEBPS/', ''), here);
    }
    for (const n of chapters) {
      const dom = strictXml(text(n));
      const links = dom.getElementsByTagName('a');
      for (let i = 0; i < links.length; i++) {
        const href: string = links[i].getAttribute('href');
        if (/^https?:|^mailto:/.test(href)) continue;
        const [file, frag] = href.split('#');
        expect(ids.has(file)).toBe(true);
        if (frag) expect(ids.get(file)!.has(frag)).toBe(true);
      }
      const imgs = dom.getElementsByTagName('img');
      for (let i = 0; i < imgs.length; i++) expect(files.has(`OEBPS/${imgs[i].getAttribute('src')}`)).toBe(true);
    }
  });

  it('adds a page list so a page of the PDF can be found again', () => {
    const nav = text('OEBPS/nav.xhtml');
    expect(nav).toContain('epub:type="page-list"');
    expect(nav.match(/#page-\d+/g)!.length).toBe(ieeeMl.pages.length);
  });

  it('leaves colours, fonts and sizes of the body to the reading app', () => {
    const css = text('OEBPS/style.css');
    expect(css).not.toMatch(/(?:^|\})\s*(?:html|body)[^{]*\{[^}]*(?:background|color:|font-family|font-size)/);
    expect(css).not.toContain('var(--');
  });

  it('has no scripts and no remote references', () => {
    for (const n of files.keys()) {
      if (!n.endsWith('.xhtml')) continue;
      expect(text(n)).not.toMatch(/<script|<iframe|<object|<embed/i);
      expect(text(n)).not.toMatch(/<(?:img|link)[^>]+(?:src|href)="https?:/i);
    }
  });

  it('names image files by their type', () => {
    const withJpeg = clone(ieeeMl);
    const fig = withJpeg.blocks.find((b) => b.type === 'figure')!;
    fig.asset!.path = 'figures/f0001.jpg';
    const r = buildEpub(withJpeg, assetsOf(withJpeg), { now: NOW });
    const names = [...unzip(r.bytes).keys()].filter((n) => n.includes('/images/'));
    expect(names.some((n) => n.endsWith('.jpg'))).toBe(true);
    expect(new TextDecoder().decode(unzip(r.bytes).get('OEBPS/content.opf'))).toContain('media-type="image/jpeg"');
  });
});

// ------------------------------------------------------------------------------------------------ Markdown and text

describe('Markdown', () => {
  const built = buildMarkdown(ieeeMl, assetsOf(ieeeMl), { now: NOW });

  it('uses headings for the title and sections, keeps the number of each section, and tables as GFM', () => {
    expect(built.markdown).toMatch(/^# Sparse Routing for Efficient Transformers$/m);
    expect(built.markdown).toMatch(/^## I INTRODUCTION$/m);
    expect(built.markdown).toMatch(/^### A Problem Setup$/m);
    expect(built.markdown).toMatch(/^\| .* \|\n\| --- /m);
  });

  it('refers to every image it needs and ships those files with it', () => {
    const refs = [...built.markdown.matchAll(/!\[[^\]]*\]\((images\/[^)]+)\)/g)].map((m) => m[1]);
    expect(refs.length).toBe(ieeeMl.blocks.filter((b) => b.asset && b.type !== 'table').length);
    for (const r of refs) expect(built.images.has(r)).toBe(true);
  });

  it('does not let paper text become Markdown syntax', () => {
    const doc = clone(ieeeMl);
    const p = doc.blocks.find((b) => b.type === 'paragraph' && !b.prefix)!;
    p.spans = [{ text: '# not a heading *star* _under_ [link](http://x) `tick` <b>tag</b> 1. no', bold: false, italic: false, link: null, math: false, mono: false, sub: false, sup: false, cite: [] }];
    p.text = p.spans[0].text;
    const html = new MarkdownIt({ html: true }).render(buildMarkdown(doc, new Map()).markdown);
    expect(html).toContain('# not a heading *star* _under_ [link](http://x) `tick` &lt;b&gt;tag&lt;/b&gt; 1. no');
  });

  it('writes a ZIP with the Markdown and its images when there are images, and a bare .md otherwise', async () => {
    const withImages = await exportPaper(ieeeMl, 'markdown', { now: NOW }, async () => PNG);
    expect(withImages.filename).toBe('Sparse-Routing-for-Efficient-Transformers.zip');
    const files = unzip(withImages.bytes);
    expect([...files.keys()].some((n) => n.endsWith('.md'))).toBe(true);
    expect([...files.keys()].filter((n) => n.startsWith('images/')).length).toBeGreaterThan(3);
    const bare = await exportPaper(ieeeMl, 'markdown', { now: NOW, images: false }, async () => PNG);
    expect(bare.filename).toMatch(/\.md$/);
    expect(bare.mime).toBe('text/markdown');
  });
});

describe('plain text', () => {
  const { text } = buildText(ieeeMl);

  it('has no markup, only paragraphs separated by blank lines', () => {
    expect(text).not.toMatch(/<[a-z]+[ >]|\*\*|^#+ /m);
    expect(text).toContain('Sparse Routing for Efficient Transformers\n\n');
    expect(text.split('\n\n').length).toBeGreaterThan(30);
  });

  it('lays a table out in aligned columns', () => {
    const lines = text.split('\n');
    const header = lines.findIndex((l) => /^Model\s+Top-1/.test(l));
    expect(header).toBeGreaterThan(0);
    const cols = lines[header].split(/\s{2,}/).length;
    expect(cols).toBeGreaterThanOrEqual(3);
    expect(lines[header + 1].split(/\s{2,}/).length).toBe(cols);
  });
});

// ------------------------------------------------------------------------------------ hostile and odd documents

describe('text that could break a format', () => {
  function hostile(): Document {
    const doc = clone(ieeeMl);
    const mk = (text: string) => ({ text, bold: false, italic: false, link: null, math: false, mono: false, sub: false, sup: false, cite: [] as string[] });
    const paras = doc.blocks.filter((b) => b.type === 'paragraph').slice(0, 5);
    const bad = [
      '<script>alert(1)</script> & "quotes" \'single\' ]]> <!-- c -->',
      'control \u0001\u0008\u000b\u000c\u001f chars and ￾ and a lone surrogate \uD800 stay out of XML',
      'html entity &lt;b&gt; &amp;amp; &#x41;',
      'back`tick ``double`` and | pipe | and \\ backslash',
      'last',
    ];
    paras.forEach((p, i) => {
      p.spans = [mk(bad[i])];
      p.text = bad[i];
    });
    paras[4].spans = [{ ...mk('click me'), link: 'javascript:alert(1)' }, mk(' and '), { ...mk('[99]'), cite: ['nope-missing'] }, mk(' and '), { ...mk('mail'), link: 'mailto:a@b.co' }];
    paras[4].text = 'click me and [99] and mail';
    doc.blocks[0].id = 'b 0"<&>';
    return doc;
  }

  const lettersWithoutSurrogate = (doc: Document) => {
    // the lone surrogate and control characters are not letters; everything else must survive
    return expected(doc, true);
  };

  it.each(FORMATS)('%s keeps every letter and stays valid', (format) => {
    const doc = hostile();
    const { text, chrome } = render(doc, format, { appendix: true });
    const want = plus(lettersWithoutSurrogate(doc), letters(chrome.join('\n')));
    expect(show(minus(want, letters(text)))).toBe('');
    expect(show(minus(letters(text), want))).toBe('');
  });

  it('never produces an active link or element', () => {
    const doc = hostile();
    const html = buildHtml(doc, new Map()).html;
    strictXml(html, 'hostile html');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="mailto:a@b.co"');
    expect(html).not.toContain('nope-missing');
    const epub = unzip(buildEpub(doc, new Map(), { now: NOW }).bytes);
    for (const [n, data] of epub) {
      if (n.endsWith('.xhtml')) {
        const x = new TextDecoder().decode(data);
        strictXml(x, n);
        expect(x).not.toMatch(/<script|javascript:/i);
      }
    }
    expect(buildMarkdown(doc, new Map()).markdown).not.toContain('javascript:');
  });
});

describe('odd inputs', () => {
  it('exports a document with no blocks', async () => {
    const empty = clone(ieeeMl);
    empty.blocks = [];
    empty.sections = [];
    empty.quality.omitted = [];
    for (const f of FORMATS) {
      const r = await exportPaper(empty, f, { now: NOW }, async () => null);
      expect(r.bytes.length).toBeGreaterThan(0);
    }
    const epub = unzip((await exportPaper(empty, 'epub', { now: NOW }, async () => null)).bytes);
    expect(epub.has('OEBPS/c001.xhtml')).toBe(true);
  });

  it('skips an image that cannot be read, and keeps the text of the figure', async () => {
    const r = await exportPaper(ieeeMl, 'html', { now: NOW }, async () => null);
    const html = new TextDecoder().decode(r.bytes);
    expect(html).not.toContain('<img');
    const fig = ieeeMl.blocks.find((b) => b.type === 'figure' && b.inner_text)!;
    expect(html).toContain((fig.inner_text as string).split('\n')[0]);
  });

  it('falls back to the file name for a title and always gives a safe file name', async () => {
    const d = clone(ieeeMl);
    d.metadata.title = null;
    d.source.filename = 'my paper.pdf';
    expect((await exportPaper(d, 'text', {}, async () => null)).filename).toBe('my-paper.txt');
    expect(slugify('Çok Başlıklı Öğrenme: Dikkat ı?')).toBe('Cok-Baslikli-Ogrenme-Dikkat-i');
    expect(slugify('???')).toBe('paper');
    expect(slugify('x'.repeat(200)).length).toBeLessThanOrEqual(60);
    expect(slugify('../../etc/passwd')).toBe('etc-passwd');
  });

  it('keeps a table whose cells lost letters readable by also giving its text', () => {
    const doc = clone(acmGraph);
    const t = doc.blocks.find((b) => b.type === 'table' && b.table)!;
    t.table!.rows[1][1] = 'x'; // a cell no longer holds what the PDF said
    const { text, chrome } = render(doc, 'html', { appendix: true });
    const want = plus(expected(doc, true), letters(chrome.join('\n')));
    expect(show(minus(want, letters(text)))).toBe(''); // the table text is there in full
  });
});

describe('exportPaper', () => {
  it('gives each format a file name, a type and a summary', async () => {
    const out = await Promise.all(FORMATS.map((f) => exportPaper(ieeeMl, f, { now: NOW }, async () => PNG)));
    expect(out.map((o) => o.filename.split('.').pop())).toEqual(['html', 'epub', 'zip', 'txt']);
    expect(out.map((o) => o.mime)).toEqual(['text/html', 'application/epub+zip', 'application/zip', 'text/plain']);
    for (const o of out) {
      expect(o.bytes.length).toBeGreaterThan(1000);
      expect(o.summary.letters).toBeGreaterThan(5000);
      expect(o.summary.blocks).toBe(ieeeMl.blocks.length);
    }
    expect(out[1].summary.images).toBeGreaterThan(3);
    expect(out[3].summary.images).toBe(0);
  });
});

describe('speed', () => {
  it('converts a 60-page-sized paper in well under a few seconds in every format', async () => {
    const big = clone(ieeeMl);
    const base = big.blocks.slice();
    for (let k = 1; k < 30; k++) {
      for (const b of base) {
        const c = clone(b);
        c.id = `${b.id}-${k}`;
        if (c.asset) c.asset.path = `${c.asset.path}.${k}`;
        big.blocks.push(c);
      }
    }
    const t0 = Date.now();
    for (const f of FORMATS) await exportPaper(big, f, { now: NOW }, async () => PNG);
    const ms = Date.now() - t0;
    expect(big.blocks.length).toBeGreaterThan(1500);
    expect(ms).toBeLessThan(5000);
  });
});
