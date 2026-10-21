/** The paper as an EPUB 3 book: one chapter per top-level section, a table of contents, page-break markers, images. */
import { sha256Hex } from '../sha256';
import type { Document } from '../types';
import { epubCss } from './paperCss';
import { renderEntries, renderRemoved, type HtmlContext } from './paperHtml';
import { DEFAULT_PAPER_OPTIONS, EN_EXPORT_STRINGS, anchor, esc, planPaper, titleOf, type PaperOptions } from './paperShared';
import { zipStore } from './zip';

export interface EpubBuild {
  bytes: Uint8Array;
  chrome: string[];
  images: number;
  chapters: number;
}

const XHTML_NS = 'xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"';
const chapterFile = (i: number) => `c${String(i + 1).padStart(3, '0')}.xhtml`;

/** A name-based identifier for the book, the same every time the same paper is exported. */
function bookId(doc: Document): string {
  const h = sha256Hex(`${doc.id}|${doc.source.sha256}`);
  const variant = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0');
  return `urn:uuid:${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

function xhtml(title: string, lang: string, layout: string, body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<html ${XHTML_NS} lang="${lang}" xml:lang="${lang}">
<head>
<meta charset="utf-8"/>
<title>${esc(title)}</title>
<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body class="l-${layout}">
${body}
</body>
</html>
`;
}

export function buildEpub(doc: Document, assets: Map<string, Uint8Array>, options: Partial<PaperOptions> = {}): EpubBuild {
  const opts: PaperOptions = { ...DEFAULT_PAPER_OPTIONS, ...options };
  const s = opts.strings ?? EN_EXPORT_STRINGS;
  const when = opts.now ?? new Date();
  const plan = planPaper(doc);
  const lang = esc(doc.metadata.language || 'en');
  const title = titleOf(doc);
  const media = new Map<string, string>(); // asset path -> file name in the book
  const imageFile = (path: string) => {
    let name = media.get(path);
    if (!name) {
      const ext = /\.([A-Za-z0-9]+)$/.exec(path)?.[1].toLowerCase() ?? 'png';
      name = `i${String(media.size + 1).padStart(3, '0')}.${ext === 'jpeg' ? 'jpg' : ext}`;
      media.set(path, name);
    }
    return name;
  };
  const c: HtmlContext = {
    doc, plan, options: opts, epub: true, chrome: [], images: new Set(),
    imageSrc: (path) => (assets.has(path) ? `images/${imageFile(path)}` : null),
    href: (id) => {
      const ch = plan.chapterOf.get(id) ?? 0;
      return `${chapterFile(ch)}#${anchor(id)}`;
    },
  };

  const chapters = plan.chapters.length ? plan.chapters : [{ title, start: 0 }];
  const files: { name: string; data: string | Uint8Array }[] = [];
  const bodies = chapters.map((ch, i) => {
    const end = i + 1 < chapters.length ? chapters[i + 1].start : plan.entries.length;
    let html = renderEntries(c, ch.start, end);
    if (i === chapters.length - 1) html += `\n${renderRemoved(c)}`;
    return { title: ch.title || title, html };
  });
  bodies.forEach((ch, i) => files.push({ name: `OEBPS/${chapterFile(i)}`, data: xhtml(ch.title, lang, opts.layout, ch.html) }));

  const pageLinks = plan.entries
    .filter((e) => e.page !== null)
    .map((e) => `<li><a href="${chapterFile(e.chapter)}#page-${e.page}">${e.page}</a></li>`)
    .join('');
  const toc = bodies.map((ch, i) => `<li><a href="${chapterFile(i)}">${esc(ch.title)}</a></li>`).join('\n');
  const nav = `<?xml version="1.0" encoding="utf-8"?>
<html ${XHTML_NS} lang="${lang}" xml:lang="${lang}">
<head><meta charset="utf-8"/><title>${esc(title)}</title></head>
<body>
<nav epub:type="toc" id="toc" role="doc-toc"><h1>${esc(s.contents)}</h1>
<ol>
${toc}
</ol></nav>
${pageLinks ? `<nav epub:type="page-list" id="page-list" hidden="hidden"><ol>${pageLinks}</ol></nav>` : ''}
</body>
</html>
`;
  files.push({ name: 'OEBPS/nav.xhtml', data: nav }, { name: 'OEBPS/style.css', data: epubCss(opts.layout) });
  for (const [path, name] of media) files.push({ name: `OEBPS/images/${name}`, data: assets.get(path)! });

  const mimeOf = (name: string) => (name.endsWith('.png') ? 'image/png' : name.endsWith('.jpg') ? 'image/jpeg' : name.endsWith('.webp') ? 'image/webp' : name.endsWith('.gif') ? 'image/gif' : 'image/svg+xml');
  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
    ...bodies.map((_, i) => `<item id="c${i + 1}" href="${chapterFile(i)}" media-type="application/xhtml+xml"/>`),
    ...[...media.values()].map((name, i) => `<item id="img${i + 1}" href="images/${name}" media-type="${mimeOf(name)}"/>`),
  ];
  const spine = bodies.map((_, i) => `<itemref idref="c${i + 1}"/>`);
  const stamp = when.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const creators = doc.metadata.authors.map((a, i) => `<dc:creator id="a${i + 1}">${esc(a)}</dc:creator>`).join('\n');
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${lang}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${bookId(doc)}</dc:identifier>
<dc:title>${esc(title)}</dc:title>
${creators}
<dc:language>${lang}</dc:language>
${doc.metadata.doi ? `<dc:source>doi:${esc(doc.metadata.doi)}</dc:source>` : ''}
<meta property="dcterms:modified">${stamp}</meta>
</metadata>
<manifest>
${manifest.join('\n')}
</manifest>
<spine>
${spine.join('\n')}
</spine>
</package>
`;
  const container = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;
  const bytes = zipStore(
    [
      { name: 'mimetype', data: 'application/epub+zip' },
      { name: 'META-INF/container.xml', data: container },
      { name: 'OEBPS/content.opf', data: opf },
      ...files,
    ],
    when,
  );
  return { bytes, chrome: c.chrome, images: media.size, chapters: bodies.length };
}
