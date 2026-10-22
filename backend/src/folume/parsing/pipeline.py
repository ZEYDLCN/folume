"""End-to-end PDF → Document conversion."""

from __future__ import annotations

import hashlib
import logging
import os
import re
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from statistics import median

from pypdfium2 import PdfiumError

from .. import __version__
from ..model import (
    Asset,
    Block,
    Document,
    DocumentQuality,
    Metadata,
    OmittedRegion,
    PageInfo,
    PageQuality,
    ParserInfo,
    QualityFlag,
    QualityIssue,
    Section,
    SourceInfo,
    SourceRegion,
    Span,
    TextLedger,
)
from .audit import audit_pages, letters
from .equations import detect_equations
from .furniture import detect_furniture
from .layout import PageLayout, analyze_page, reading_order
from .lines import build_fragments
from .ocr import ocr_available, ocr_pages
from .raw import extract_pages
from .refs import CitationIndex, link_citations, parse_reference
from .regions import Region, detect_caption_tables, detect_figures, detect_ruled_tables
from .render import Renderer
from .structure import (
    ACK_HEADINGS,
    REFERENCE_HEADINGS,
    RUN_IN_ABSTRACT,
    RUN_IN_KEYWORDS,
    Builder,
    Line,
    PageStream,
    PBlock,
    block_style_cleanup,
    line_bbox_regions,
    line_spans,
    spans_for_lines,
    text_of,
    to_model_spans,
)
from .tables import extract_table
from .textutil import Vocabulary, garbled_ratio, guess_language, has_garbled
from .types import Char, Fragment, expand, fragment_text, inside_fraction, union

Progress = Callable[[str, float], None]
log = logging.getLogger(__name__)


MAX_PAGE_POINTS = 3000  # 41.7 in
OCR_SCORE_CAP = 0.84  # just under the "good" grade


class ParseError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class ParseOptions:
    max_pages: int = 300
    page_image_scale: float = 2.0
    crop_scale: float = 3.0
    ocr: bool = False  # read a scanned PDF (no text layer) with OCR instead of calling it unsupported
    ocr_max_pages: int = 60  # OCR is slow: a longer scan is refused


@dataclass
class ParseResult:
    document: Document
    assets: dict[str, bytes] = field(default_factory=dict)


def _has_text_layer(pages) -> bool:
    return sum(len(p.chars) for p in pages) >= 20 * len(pages)


def _after_ocr(report: Progress) -> Progress:
    """Progress of the stages after OCR: reading the pages took the share of the bar up to 0.85, they fill the rest."""
    return lambda stage, fraction: report(stage, 0.85 + 0.15 * (fraction - 0.45) / 0.55)


def estimate_body_size(pages) -> float:
    counts: Counter[float] = Counter()
    for p in pages:
        for c in p.chars:
            if c.upright and not c.math and not c.text.isspace():
                counts[round(c.size, 1)] += 1
    return counts.most_common(1)[0][0] if counts else 10.0


def parse_pdf(data: bytes, filename: str = "document.pdf", options: ParseOptions | None = None,
              progress: Progress | None = None) -> ParseResult:
    opts = options or ParseOptions()
    report = progress or (lambda stage, frac: None)
    if not data.lstrip()[:1024].startswith(b"%PDF"):
        raise ParseError("not_a_pdf", "The file is not a PDF document")
    report("extract", 0.02)
    try:
        pages, info = extract_pages(data, opts.max_pages + 1)
    except Exception as exc:  # pdfminer raises many exception types for broken files
        raise ParseError("unreadable_pdf", f"The PDF could not be read: {type(exc).__name__}") from exc
    if not pages:
        raise ParseError("empty_document", "The PDF has no pages")
    if len(pages) > opts.max_pages:
        raise ParseError("too_many_pages", f"The PDF has more than {opts.max_pages} pages")
    if any(max(p.width, p.height) > MAX_PAGE_POINTS for p in pages):
        # rendering an enormous page would use gigabytes of memory; papers are A4/Letter, posters rarely exceed this
        raise ParseError("page_too_large", "A page is larger than this converter supports")
    report("extract", 0.3)
    if opts.ocr and not _has_text_layer(pages) and ocr_available() and len(pages) > opts.ocr_max_pages:
        # reading a page takes seconds: say so before spending any of them
        raise ParseError("ocr_too_many_pages",
                         f"This scanned PDF has {len(pages)} pages; OCR is limited to {opts.ocr_max_pages} pages here")

    sha = hashlib.sha256(data).hexdigest()
    try:
        renderer = Renderer(data)
    except PdfiumError as exc:
        raise ParseError("unreadable_pdf", f"The PDF could not be rendered: {exc}") from exc
    try:
        return _convert(data, filename, sha, pages, info, renderer, opts, report)
    except PdfiumError as exc:  # a page the renderer cannot load (damaged content stream)
        raise ParseError("unreadable_pdf", f"The PDF could not be rendered: {exc}") from exc
    finally:
        renderer.close()


def _convert(data, filename, sha, pages, info, renderer: Renderer, opts: ParseOptions,
             report: Progress) -> ParseResult:
    assets: dict[str, bytes] = {}
    page_infos: list[PageInfo] = []
    for p in pages:
        jpg, w, h = renderer.page_jpeg(p.number, opts.page_image_scale)
        path = f"pages/p{p.number:03d}.jpg"
        assets[path] = jpg
        page_infos.append(PageInfo(number=p.number, width=p.width, height=p.height, image=path,
                                   image_width=w, image_height=h))
    report("render", 0.45)

    doc_flags: list[QualityFlag] = []
    source = SourceInfo(filename=os.path.basename(filename) or "document.pdf", sha256=sha, size_bytes=len(data),
                        page_count=info.get("page_count") or len(pages), producer=info.get("producer"))
    parser = ParserInfo(name="folume-pdfplumber", version=__version__,
                        created_at=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"))
    doc_id = sha[:16]

    ocr_used = False
    no_text = ""  # why a PDF without a text layer stays unsupported
    if not _has_text_layer(pages):
        if not opts.ocr:
            no_text = "OCR is switched off on this server; the operator can switch it on (FOLUME_OCR=1)."
        elif not ocr_available():
            no_text = "OCR is switched on, but its engine is not installed on this server (the `ocr` extra)."
        else:
            try:
                read = ocr_pages(data, lambda done, total: report("ocr", 0.45 + 0.4 * done / total))
            except (PdfiumError, MemoryError):
                raise  # handled like any other unreadable or too large document
            except Exception as exc:  # the engine failed on this document
                log.exception("OCR failed")
                raise ParseError("ocr_failed", f"The scanned PDF could not be read by OCR: {type(exc).__name__}") from exc
            if _has_text_layer(read):
                pages, ocr_used = read, True
                doc_flags.append(QualityFlag(
                    code="ocr_text", severity="warning",
                    message="The text was recognised from the page images by OCR and may contain mistakes"))
                report = _after_ocr(report)
            else:
                no_text = "OCR recognised no text on its pages."

    if no_text:
        total_chars = sum(len(p.chars) for p in pages)
        flag = QualityFlag(code="no_text_layer", severity="error",
                           message=f"No extractable text layer (scanned PDF). {no_text}")
        quality = DocumentQuality(
            score=0.0, grade="unsupported",
            ledger=TextLedger(total_chars=total_chars, in_blocks=0, in_figures=0, in_tables=0, omitted=0,
                              unaccounted=total_chars, coverage=0.0 if total_chars else 1.0),
            pages=[PageQuality(page=p.number, layout="unknown", confidence=0.0, char_count=len(p.chars),
                               notes=["no text layer"]) for p in pages],
            issues=[QualityIssue(flag=flag)], counts={"blocks": 0},
            # nothing can be called complete when the PDF has no text layer to compare with
            completeness=audit_pages(pages, [], []).model_copy(update={"complete": False}))
        doc = Document(id=doc_id, source=source, parser=parser, metadata=Metadata(title=info.get("title")),
                       pages=page_infos, sections=[], blocks=[], quality=quality, image_scale=opts.page_image_scale)
        return ParseResult(doc, assets)

    body_size = estimate_body_size(pages)
    frags_by_page: dict[int, list[Fragment]] = {}
    rotated_by_page: dict[int, list[Char]] = {}
    for p in pages:
        fr, rot = build_fragments(p)
        frags_by_page[p.number] = fr
        rotated_by_page[p.number] = rot
    furniture = detect_furniture(pages, frags_by_page, body_size)
    furn_ids = {id(f.fragment) for f in furniture}
    for f in furniture:
        for c in f.fragment.chars:
            c.status = "omitted"
    report("layout", 0.55)

    # --- per-page regions (a page that cannot be analysed degrades to plain text, flagged below)
    page_regions: dict[int, list[Region]] = {}
    free_by_page: dict[int, list[Fragment]] = {}
    degraded: set[int] = set()
    for p in pages:
        free = [f for f in frags_by_page[p.number] if id(f) not in furn_ids]
        try:
            claimed: set[int] = set()
            tables = detect_ruled_tables(p, free)
            for t in tables:
                claimed.update(id(f) for f in t.fragments)
            tables += detect_caption_tables(p, free, claimed)
            table_boxes = [t.bbox for t in tables]
            figures = detect_figures(p, free, rotated_by_page[p.number], claimed, table_boxes, body_size)
            for g in figures:
                g.fragments = [f for f in g.fragments if id(f) not in claimed]
                claimed.update(id(f) for f in g.fragments)
            page_regions[p.number] = tables + figures
            free_by_page[p.number] = [f for f in free if id(f) not in claimed]
        except Exception:
            log.exception("region detection failed on page %s", p.number)
            degraded.add(p.number)
            page_regions[p.number] = []
            free_by_page[p.number] = free

    # --- layouts (second pass reuses the dominant gutter for sparse pages)
    layouts: dict[int, PageLayout] = {}
    for p in pages:
        try:
            layouts[p.number] = analyze_page(free_by_page[p.number], p.width)
        except Exception:
            log.exception("layout analysis failed on page %s", p.number)
            degraded.add(p.number)
            layouts[p.number] = PageLayout("unknown", 0.2, None, [], ["page analysis failed"])
    prior = _modal_gutter(layouts)
    for p in pages:
        if layouts[p.number].kind != "two_column" and prior is not None:
            layouts[p.number] = analyze_page(free_by_page[p.number], p.width, prior=prior)

    streams: list[PageStream] = []
    omitted_chars_rotated: list[tuple[int, Char]] = []
    for p in pages:
        layout = layouts[p.number]
        rem = free_by_page[p.number]
        try:
            eqs = detect_equations(p.number, rem, layout, body_size) if p.number not in degraded else []
        except Exception:
            log.exception("equation detection failed on page %s", p.number)
            layout = PageLayout("unknown", 0.2, None, layout.columns, ["page analysis failed"])
            layouts[p.number] = layout
            eqs = []
        eq_ids = {id(f) for e in eqs for f in e.fragments}
        text_frags = [f for f in rem if id(f) not in eq_ids]
        regions = page_regions[p.number] + eqs
        folded = {id(c) for r in page_regions[p.number] for c in r.chars}
        for c in rotated_by_page[p.number]:
            if id(c) not in folded:
                c.status = "omitted"
                omitted_chars_rotated.append((p.number, c))
        text_w = _text_width(layout, p.width)

        def eff_bbox(it, layout=layout, text_w=text_w):
            b = it.bbox
            if isinstance(it, Region) and layout.kind == "two_column" and (b[2] - b[0]) <= 0.65 * text_w:
                cx = (b[0] + b[2]) / 2
                return (cx, b[1], cx, b[3])
            return b

        ordered = reading_order(text_frags + regions, layout, eff_bbox, lambda it: False)
        occupied = [r.bbox for r in regions]
        fn_rules = [r for r in p.rules if r.horizontal and r.length >= 15
                    and not any(inside_fraction(r.bbox, expand(b, 3)) > 0.8 for b in occupied)]
        streams.append(PageStream(p, layout, ordered, [f for f in furniture if f.fragment.page == p.number],
                                  fn_rules))
    report("structure", 0.65)

    vocab = Vocabulary()
    builder = Builder(streams, body_size, vocab)
    flow = builder.run()
    report("structure", 0.75)

    blocks, sections, assets_extra, keywords = _to_model(flow, streams, renderer, opts, vocab)
    blocks = _recover_unplaced(pages, blocks)
    assets.update(assets_extra)
    report("render", 0.92)

    # --- accounting
    quality = _quality(pages, streams, blocks, doc_flags, furniture, omitted_chars_rotated, layouts, ocr=ocr_used)
    metadata = _metadata(blocks, sections, info, furniture, omitted_chars_rotated, keywords)
    doc = Document(id=doc_id, source=source, parser=parser, metadata=metadata, pages=page_infos,
                   sections=sections, blocks=blocks, quality=quality, image_scale=opts.page_image_scale,
                   body_font_size=round(body_size, 2))
    report("done", 1.0)
    return ParseResult(doc, assets)


def _text_width(layout: PageLayout, page_width: float) -> float:
    if not layout.columns:
        return page_width
    return max(c[1] for c in layout.columns) - min(c[0] for c in layout.columns)


def _modal_gutter(layouts: dict[int, PageLayout]) -> tuple[float, float] | None:
    gutters = [lay.gutter for lay in layouts.values() if lay.kind == "two_column" and lay.confidence >= 0.8 and lay.gutter]
    if not gutters:
        return None
    mid = sorted(g[0] + g[1] for g in gutters)[len(gutters) // 2] / 2
    best = min(gutters, key=lambda g: abs((g[0] + g[1]) / 2 - mid))
    return best


# ---- PBlock -> model ---------------------------------------------------------------------------------


def _region_text(reg: Region) -> str:
    """The text layer inside a figure or table region, rows top to bottom (rotated labels last)."""
    rows: list[list[Fragment]] = []
    for f in sorted(reg.fragments, key=lambda f: (f.baseline, f.x0)):
        if rows and abs(rows[-1][0].baseline - f.baseline) <= 3:
            rows[-1].append(f)
        else:
            rows.append([f])
    lines = [" ".join(f.text for f in sorted(r, key=lambda f: f.x0)).strip() for r in rows]
    if reg.chars:
        lines.append(rotated_text(reg.chars).strip())
    return "\n".join(x for x in lines if x)


def _approx_equation_text(reg: Region) -> tuple[str, str]:
    """Best-effort linear text of an equation, rows top to bottom, with `_`/`^` for scripts.

    Returns the text and the equation number row that was moved out of it (the number lives in `Block.number`)."""
    rows: list[list[Fragment]] = []
    for f in sorted(reg.fragments, key=lambda f: (f.baseline, f.x0)):
        if rows and abs(rows[-1][0].baseline - f.baseline) <= 3:
            rows[-1].append(f)
        else:
            rows.append([f])
    parts = []
    removed: list[str] = []
    for r in rows:
        chars = [c for f in r for c in f.chars]
        if reg.number and "".join(c.text for c in chars) == reg.number.replace(" ", ""):
            removed.append("".join(c.text for c in chars))
            continue  # the equation number lives in `Block.number`
        ln = Line(page=reg.page, column=0, chars=chars, bbox=union([f.bbox for f in r]),
                  baseline=median(f.baseline for f in r), size=max(f.size for f in r), fragments=r)
        parts.append(text_of(line_spans(ln)))
    return re.sub(r"\s+", " ", " ".join(parts)).strip(), " ".join(removed)


def rotated_text(chars: list[Char]) -> str:
    """Join rotated characters (content-stream order) inserting spaces at wide gaps."""
    out: list[str] = []
    prev: Char | None = None
    for c in chars:
        if prev is not None:
            dx = abs((c.x0 + c.x1) / 2 - (prev.x0 + prev.x1) / 2)
            dy = abs((c.top + c.bottom) / 2 - (prev.top + prev.bottom) / 2)
            if dy > dx:
                gap = dy - ((c.bottom - c.top) + (prev.bottom - prev.top)) / 2
            else:
                gap = dx - ((c.x1 - c.x0) + (prev.x1 - prev.x0)) / 2
            if gap > 0.16 * max(c.size, prev.size):
                out.append(" ")
        out.append(c.text)
        prev = c
    return "".join(out)


def _heading_levels(heads: list[PBlock]) -> None:
    """Assign `level` to heading PBlocks from numbering, falling back to typographic rank."""
    unnumbered_styles = sorted({(round(h.extra.get("size", 0), 1), bool(h.extra.get("bold")))
                                for h in heads if not h.extra.get("numbered")}, reverse=True)
    saw_level1 = False
    numbered_exist = any(h.extra.get("numbered") for h in heads)
    for h in heads:
        num = (h.extra.get("number") or "").strip()
        title = (h.extra.get("title") or "").lower()
        if num:
            if re.fullmatch(r"[IVX]+", num):
                level = 1
            elif re.fullmatch(r"\d+(\.\d+)*", num):
                level = num.count(".") + 1
            elif re.fullmatch(r"[A-Z]", num):
                level = 2 if saw_level1 else 1
            elif re.fullmatch(r"[A-Z](\.\d+)+", num):
                level = num.count(".") + 1
            else:
                level = 1
            if num.lower().startswith("appendix"):
                level = 1
        elif title.strip(" .:") in {"abstract", "introduction", "references", "bibliography", "conclusion",
                                    "conclusions", "acknowledgments", "acknowledgements", "appendix", "related work"} \
                or (numbered_exist and not h.extra.get("weak")):
            level = 1
        else:
            key = (round(h.extra.get("size", 0), 1), bool(h.extra.get("bold")))
            rank = unnumbered_styles.index(key) if key in unnumbered_styles else 0
            level = min(3, 1 + rank)
            if h.extra.get("weak"):
                h.flag("heading_uncertain", "info", "Heading level/role inferred from typography only")
                h.confidence = min(h.confidence, 0.65)
        if level == 1:
            saw_level1 = True
        h.level = level


def _to_model(flow: list[PBlock], streams: list[PageStream], renderer: Renderer, opts: ParseOptions,
              vocab: Vocabulary) -> tuple[list[Block], list[Section], dict[str, bytes], list[str]]:
    assets: dict[str, bytes] = {}
    keywords: list[str] = []
    heads = [b for b in flow if b.type == "heading"]
    _heading_levels(heads)
    counters = {"figure": 0, "table": 0, "equation": 0}
    blocks: list[Block] = []
    sections: list[Section] = []
    pb_to_id: dict[int, str] = {}
    in_refs = False
    in_appendix = False
    kind = "front"
    section_id: str | None = None
    stack: list[Section] = []
    tables_rules = {s.page.number: s.page.rules for s in streams}
    flow_ids: dict[int, int] = {}

    for idx, pb in enumerate(flow):
        bid = f"b{idx + 1:04d}"
        pb_to_id[id(pb)] = bid
        flow_ids[id(pb)] = idx

    def mark(chars: list[Char], status: str) -> None:
        for c in chars:
            c.status = status

    for pb in flow:
        bid = pb_to_id[id(pb)]
        flags: list[QualityFlag] = [QualityFlag(code=c, severity=s, message=m) for c, s, m in pb.flags]
        confidence = pb.confidence
        spans: list[Span] = []
        text = ""
        asset: Asset | None = None
        table = None
        level = None
        number = pb.number
        prefix = ""
        inner_text: str | None = None
        source: list[SourceRegion]
        btype = pb.type

        if pb.type in ("figure", "table", "equation"):
            reg = pb.regions[0]
            source = [SourceRegion(page=reg.page, bbox=_r(reg.bbox))]
            counters[pb.type] += 1
            n = counters[pb.type]
            sub = {"figure": "figures/f", "table": "tables/t", "equation": "equations/e"}[pb.type]
            crop_bbox = reg.bbox
            if pb.type == "equation" and reg.number:
                # the number is shown beside the image (Block.number), so keep it out of the picture
                body = [f.bbox for f in reg.fragments if f.text.strip() != reg.number]
                if body:
                    crop_bbox = union(body)
            png, w, h, box = renderer.crop_png(reg.page, crop_bbox, scale=opts.crop_scale,
                                               transparent=pb.type == "equation")
            path = f"{sub}{n:04d}.png"
            assets[path] = png
            asset = Asset(path=path, kind=pb.type, page=reg.page, bbox=_r(box), width=w, height=h,
                          transparent=pb.type == "equation")
            folded = [c for f in reg.fragments for c in f.chars] + list(reg.chars)
            if pb.type in ("figure", "table"):
                inner_text = _region_text(reg) or None
            if pb.type == "figure":
                mark(folded, "figure")
                if folded:
                    flags.append(QualityFlag(code="figure_text_folded", severity="info",
                                             message="Text inside the figure is shown as part of the image"))
                confidence = reg.confidence
            elif pb.type == "table":
                mark(folded, "table")
                tdata, tconf = extract_table(reg, tables_rules.get(reg.page, []))
                # cells are only trusted when they hold exactly the letters of the table region
                complete_cells = tdata is not None and letters(" ".join(c for r in tdata.rows for c in r)) == letters(
                    inner_text or "")
                if tdata is not None and tconf >= 0.75 and complete_cells:
                    table = tdata
                    confidence = tconf
                else:
                    flags.append(QualityFlag(code="table_structure_uncertain", severity="warning",
                                             message="Table cells could not be recovered reliably; the image is shown"))
                    confidence = min(0.5, tconf)
            else:
                mark(folded, "equation")
                text, removed = _approx_equation_text(reg)
                prefix = removed
                number = reg.number
                flags.append(QualityFlag(code="formula_image_only", severity="info",
                                         message="Equation is shown as its original image; text is approximate"))
                confidence = 0.75
        else:
            lines = pb.lines
            source_regions = line_bbox_regions(lines)
            source = [SourceRegion(page=p, bbox=_r(b)) for p, b in source_regions]
            for ln in lines:
                mark(ln.chars, "block")
            if pb.type == "heading":
                title = pb.extra.get("title", "")
                text = title
                spans = [Span(text=title)]
                level = pb.level
                number = pb.extra.get("number")
                prefix = number or ""
                # the heading's own characters include the number: it is part of what the PDF said
            elif pb.type == "code":
                text = "\n".join(ln.plain for ln in lines)
                spans = [Span(text=text, mono=True)]
            else:
                sd = spans_for_lines(lines, vocab)
                if pb.type not in ("title", "authors", "caption") or pb.type in ("title", "authors"):
                    sd = block_style_cleanup(sd)
                spans = to_model_spans(sd)
                text = _math_text(spans)
                if has_garbled(text):
                    flags.append(QualityFlag(code="text_garbled", severity="warning",
                                             message="Some glyphs could not be decoded"))
                    confidence = min(confidence, 0.5 if garbled_ratio(text) > 0.05 else 0.7)
                if any(s.math for s in spans) and pb.type in ("paragraph", "list_item"):
                    flags.append(QualityFlag(code="inline_math_approximate", severity="info",
                                             message="Inline math is shown as approximate text"))
                    confidence = min(confidence, 0.9)
            if pb.type == "caption":
                number = pb.label
            if pb.type == "footnote":
                marker = re.match(r"^\s*(\d{1,2}|[*†‡§¶])\s*", text)
                if marker and len(text) > marker.end():
                    number = marker.group(1)
                    spans, _, prefix = _strip_prefix(spans, re.compile(r"^\s*(?:\d{1,2}|[*†‡§¶])\s*"))
                    text = _math_text(spans)
            if pb.type == "list_item" and number and len(text) > len(number):
                # the marker is shown in front of the item by the reader: keep it out of the text, in the prefix
                cut_spans, cut_text, cut = _strip_prefix(spans, re.compile(r"^\s*" + re.escape(number) + r"\s*"))
                if cut and cut_text.strip():
                    spans, text, prefix = cut_spans, _math_text(cut_spans), cut
            if pb.type == "reference":
                confidence = 0.9

        # --- sections
        if pb.type == "heading":
            title_l = (pb.extra.get("title") or "").lower().strip(" .:")
            if pb.level == 1 or not stack:
                in_appendix = in_appendix or (in_refs and title_l not in REFERENCE_HEADINGS)
            if title_l in REFERENCE_HEADINGS:
                kind, in_refs = "references", True
            elif title_l.startswith("abstract"):
                kind, in_refs = "abstract", False
            elif title_l in ACK_HEADINGS:
                kind, in_refs = "acknowledgments", False
            elif title_l.startswith("appendix") or in_appendix:
                kind, in_refs = "appendix", False
            elif pb.level == 1:
                kind, in_refs = "body", False
            sec = Section(id=f"s{len(sections) + 1}", title=pb.extra.get("title", ""), number=pb.extra.get("number"),
                          level=pb.level or 1, kind=kind, block_id=bid, start_page=pb.page)
            while stack and stack[-1].level >= sec.level:
                stack.pop()
            sec.parent_id = stack[-1].id if stack else None
            stack.append(sec)
            sections.append(sec)
            section_id = sec.id
        elif pb.type == "paragraph" and kind == "front" and spans and RUN_IN_ABSTRACT.match(text):
            spans, text, prefix = _strip_prefix(spans, RUN_IN_ABSTRACT)
            kind = "abstract"
            sec = Section(id=f"s{len(sections) + 1}", title="Abstract", level=1, kind="abstract", block_id=bid,
                          start_page=pb.page)
            sections.append(sec)
            stack = [sec]
            section_id = sec.id
        elif pb.type == "paragraph" and kind == "abstract" and spans and RUN_IN_KEYWORDS.match(text):
            m = RUN_IN_KEYWORDS.match(text)
            keywords = [k.strip(" .") for k in re.split(r"[,;·]", text[m.end():]) if k.strip(" .")]

        info = None
        if pb.type == "reference":
            info = parse_reference(text)
            if info.label is None and info.year is None:
                flags.append(QualityFlag(code="reference_unparsed", severity="info",
                                         message="Bibliography entry could not be parsed into fields"))
                confidence = min(confidence, 0.6)
            number = f"[{info.label}]" if info.label else None
            label = re.match(r"^\s*\[\d+\]\s*", text)
            if label:
                prefix = label.group(0).strip()
            text = re.sub(r"^\s*\[\d+\]\s*", "", text)
            if spans:
                spans, _, _ = _strip_prefix(spans, re.compile(r"^\s*\[\d+\]\s*"))

        blocks.append(Block(
            id=bid, type=btype, text=text, spans=spans, level=level, number=number, section_id=section_id,
            source=source, confidence=round(confidence, 3), flags=flags, asset=asset, table=table,
            reference=info, prefix=prefix or None, inner_text=inner_text,
        ))

    # caption links
    for idx, pb in enumerate(flow):
        if pb.type == "caption" and pb.caption_for is not None:
            blocks[idx].caption_for = pb_to_id[id(pb.caption_for)]
        if pb.type in ("figure", "table") and pb.caption is not None:
            blocks[idx].caption_id = pb_to_id[id(pb.caption)]

    # citation linking
    index = CitationIndex([b for b in blocks if b.type == "reference"])
    for b in blocks:
        if b.type in ("paragraph", "list_item", "caption", "footnote") and b.spans:
            b.spans = link_citations(b.spans, index)

    return blocks, sections, assets, keywords


def _recover_unplaced(pages, blocks: list[Block]) -> list[Block]:
    """Characters that never reached a block (the layout analysis lost them) come back as flagged text.

    One block per page, put after the last block of that page, so the reader still shows every character and
    says plainly that this text sits out of order.
    """
    out = list(blocks)
    for p in pages:
        stray = [c for c in p.chars if c.status is None]
        if not any(c.text.strip() for c in stray):
            continue
        rows: list[list[Char]] = []
        for c in sorted(stray, key=lambda c: (c.baseline, c.x0)):
            if rows and abs(rows[-1][-1].baseline - c.baseline) <= max(1.0, 0.5 * c.size):
                rows[-1].append(c)
            else:
                rows.append([c])
        text = " ".join(fragment_text(sorted(r, key=lambda c: c.x0)).strip() for r in rows).strip()
        for c in stray:
            c.status = "recovered"
        if not text:
            continue
        box = union([c.bbox for c in stray if c.text.strip()])
        block = Block(
            id=f"r{p.number:03d}", type="paragraph", text=text, spans=[Span(text=text)],
            source=[SourceRegion(page=p.number, bbox=_r(box))], confidence=0.4,
            flags=[QualityFlag(code="text_recovered", severity="warning",
                               message="Text the layout analysis could not place; shown here so no text is lost")],
        )
        at = max((i for i, b in enumerate(out) if b.source[0].page <= p.number), default=-1) + 1
        out.insert(at, block)
    return out


def _math_text(spans: list[Span]) -> str:
    """Block text of a span list: sub- and superscript math carries a `_` or `^` marker, like everywhere else."""
    return "".join(("_" + s.text if s.math and s.sub else "^" + s.text if s.math and s.sup else s.text) for s in spans)


def _strip_prefix(spans: list[Span], pattern: re.Pattern) -> tuple[list[Span], str, str]:
    """Cut a matching prefix off the spans; returns the remaining spans, their text and the removed prefix."""
    text = "".join(s.text for s in spans)
    m = pattern.match(text)
    if not m:
        return spans, text, ""
    cut = m.end()
    out: list[Span] = []
    pos = 0
    for s in spans:
        end = pos + len(s.text)
        if end <= cut:
            pos = end
            continue
        if pos < cut:
            out.append(s.model_copy(update={"text": s.text[cut - pos:]}))
        else:
            out.append(s)
        pos = end
    return out, "".join(s.text for s in out), text[:cut].strip()


def _r(b) -> tuple[float, float, float, float]:
    return (round(b[0], 2), round(b[1], 2), round(b[2], 2), round(b[3], 2))


# ---- quality -------------------------------------------------------------------------------------------


def _quality(pages, streams: list[PageStream], blocks: list[Block], doc_flags: list[QualityFlag], furniture,
             rotated: list[tuple[int, Char]], layouts: dict[int, PageLayout], ocr: bool = False) -> DocumentQuality:
    all_chars = [c for p in pages for c in p.chars if not c.text.isspace()]
    tally = Counter(c.status or "unaccounted" for c in all_chars)
    total = len(all_chars)
    unaccounted = tally.get("unaccounted", 0)
    ledger = TextLedger(
        total_chars=total, in_blocks=tally.get("block", 0) + tally.get("equation", 0) + tally.get("recovered", 0),
        in_figures=tally.get("figure", 0),
        in_tables=tally.get("table", 0), omitted=tally.get("omitted", 0), unaccounted=unaccounted,
        coverage=round((total - unaccounted) / total, 4) if total else 1.0,
    )
    omitted: list[OmittedRegion] = []
    for f in furniture:
        fr = f.fragment
        omitted.append(OmittedRegion(page=fr.page, bbox=_r(fr.bbox), reason=f.reason,
                                     char_count=sum(1 for c in fr.chars if not c.text.isspace()),
                                     preview=fr.text[:80], text=fr.text))
    by_page: dict[int, list[Char]] = {}
    for pno, c in rotated:
        by_page.setdefault(pno, []).append(c)
    texts = {pno: rotated_text(cs) for pno, cs in by_page.items()}
    repeated = {t for t, n in Counter(re.sub(r"\d+", "#", v) for v in texts.values()).items() if n >= 2}
    rotated_total = 0  # rotated text that is not a repeating stamp/watermark
    for pno, cs in by_page.items():
        omitted.append(OmittedRegion(page=pno, bbox=_r(union([c.bbox for c in cs])), reason="rotated_text",
                                     char_count=len(cs), preview=texts[pno][:80], text=texts[pno]))
        if re.sub(r"\d+", "#", texts[pno]) not in repeated:
            rotated_total += len(cs)

    issues: list[QualityIssue] = [QualityIssue(flag=f) for f in doc_flags]
    if rotated_total:
        severity = "warning" if rotated_total > 120 else "info"
        issues.append(QualityIssue(flag=QualityFlag(
            code="rotated_text_skipped", severity=severity,
            message=f"{rotated_total} characters of rotated text were left out of the reading flow")))
    if ledger.coverage < 0.99:
        issues.append(QualityIssue(flag=QualityFlag(
            code="low_text_coverage", severity="warning",
            message=f"{unaccounted} of {total} characters could not be placed in the reading flow")))
    completeness = audit_pages(pages, blocks, omitted, source="ocr" if ocr else "text_layer")
    if not completeness.complete:
        what = "recognised" if ocr else "PDF"
        issues.append(QualityIssue(flag=QualityFlag(
            code="low_text_coverage", severity="warning",
            message=f"{completeness.missing} letters or digits of the {what} text are missing from the document "
                    f"and {completeness.extra} are not in the {what} text")))
    page_quality: list[PageQuality] = []
    for p in pages:
        lay = layouts[p.number]
        notes = list(lay.notes)
        if ocr and p.ocr_confidence is not None:
            notes.append(f"recognised by OCR, mean confidence {p.ocr_confidence:.2f}")
        page_quality.append(PageQuality(page=p.number, layout=lay.kind, confidence=round(lay.confidence, 3),
                                        char_count=len(p.chars), notes=notes))
        if lay.kind == "unknown" or lay.confidence < 0.5:
            issues.append(QualityIssue(page=p.number, flag=QualityFlag(
                code="reading_order_uncertain", severity="warning",
                message="Page layout could not be determined reliably; reading order may be wrong")))
    uncertain_pages = {i.page for i in issues if i.flag.code == "reading_order_uncertain"}
    for b in blocks:
        for f in b.flags:
            if f.severity != "info" or f.code in ("formula_image_only",):
                issues.append(QualityIssue(page=b.source[0].page, block_id=b.id, flag=f))
        if b.source[0].page in uncertain_pages:
            b.flags.append(QualityFlag(code="reading_order_uncertain", severity="warning",
                                       message="Reading order of this page may be wrong"))
            b.confidence = min(b.confidence, 0.6)
    weights = [(max(len(b.text), 20), b.confidence) for b in blocks]
    wsum = sum(w for w, _ in weights) or 1
    mean_conf = sum(w * c for w, c in weights) / wsum
    page_conf = sum(pq.confidence for pq in page_quality) / max(len(page_quality), 1)
    score = round(max(0.0, min(1.0, ledger.coverage * (0.6 * mean_conf + 0.4 * min(1.0, page_conf + 0.1)))), 3)
    if ocr:
        # recognised text is never as sure as a text layer: weigh by what the engine says about itself, and stay below "good"
        read = sum(len(p.chars) for p in pages) or 1
        recognised = sum((p.ocr_confidence or 0.0) * len(p.chars) for p in pages) / read
        score = round(min(score * recognised, OCR_SCORE_CAP), 3)
    grade = "good" if score >= 0.85 else "fair" if score >= 0.65 else "poor"
    counts = Counter(b.type for b in blocks)
    counts_d = {k: int(v) for k, v in counts.items()}
    counts_d["blocks"] = len(blocks)
    counts_d["flagged_blocks"] = sum(1 for b in blocks if any(f.severity != "info" for f in b.flags))
    return DocumentQuality(score=score, grade=grade, ledger=ledger, pages=page_quality, omitted=omitted,
                           issues=issues, counts=counts_d, completeness=completeness, ocr=ocr)


# ---- metadata ---------------------------------------------------------------------------------------------

_AFFIL = re.compile(r"univers|institut|department|dept\.|laborator|school|college|research|inc\.|corp|@|"
                    r"faculty|center|centre|academy|hospital|lab\b", re.I)
_PERSON = re.compile(r"[A-Z][\w.\-']+(?: [A-Z][\w.\-']+){1,3}")


def _looks_like_people(author: str | None) -> bool:
    """The PDF Author field is often a software name or an account ("python-docx", "Microsoft Office User"):
    only trust it when every part reads like a personal name."""
    if not author:
        return False
    parts = [a.strip() for a in re.split(r";|,|\band\b", author) if a.strip()]
    junk = re.compile(r"microsoft|office|word|admin|user|latex|pdf|docx?|unknown|author|owner|computer|windows", re.I)
    return bool(parts) and all(_PERSON.fullmatch(p) and not junk.search(p) for p in parts)


_DOI = re.compile(r"\b(10\.\d{4,9}/[^\s\"<>]+)", re.I)
_ARXIV = re.compile(r"arXiv:\s*(\d{4}\.\d{4,5})(?:v\d+)?", re.I)


def _metadata(blocks: list[Block], sections: list[Section], info: dict, furniture, rotated,
              keywords: list[str]) -> Metadata:
    md = Metadata()
    title_block = next((b for b in blocks if b.type == "title"), None)
    md.title = (title_block.text.strip() if title_block else None) or info.get("title")
    authors: list[str] = []
    for b in blocks:
        if b.type != "authors":
            continue
        for line in re.split(r"\n|;", b.text):
            # "Name, Institute, University" on one line: keep the parts that are names, drop the affiliation
            for part in re.split(r",|\band\b|&|∗|\*|†", line):
                name = re.sub(r"[\d†∗*]+$", "", part).strip()
                if not _AFFIL.search(name) and re.fullmatch(r"[A-Z][\w.\-']+(?: [A-Z][\w.\-']+){1,3}", name):
                    authors.append(name)
    md.authors = list(dict.fromkeys(authors))
    if not md.authors and _looks_like_people(info.get("author")):
        md.authors = [a.strip() for a in re.split(r";|,|\band\b", info["author"]) if a.strip()]
    abstract_sec = next((s for s in sections if s.kind == "abstract"), None)
    if abstract_sec is not None:
        start = next((i for i, b in enumerate(blocks) if b.id == abstract_sec.block_id), None)
        if start is not None:
            first = blocks[start]
            if first.type == "heading":
                nxt = next((b for b in blocks[start + 1:] if b.type == "paragraph"), None)
                md.abstract = nxt.text if nxt else None
            else:
                md.abstract = first.text
    md.keywords = keywords
    page1 = " ".join(b.text for b in blocks if b.source[0].page == 1)
    stamps = " ".join(f.fragment.text for f in furniture) + " " + page1
    rot = {}
    for pno, c in rotated:
        rot.setdefault(pno, []).append(c)
    rot_text = " ".join(rotated_text(cs) for cs in rot.values())
    m = _DOI.search(page1) or _DOI.search(stamps)
    if m:
        md.doi = m.group(1).rstrip(".,;)")
    a = _ARXIV.search(page1) or _ARXIV.search(rot_text)
    if a:
        md.arxiv_id = a.group(1)
        md.year = 2000 + int(a.group(1)[:2])
    if md.year is None:
        y = re.search(r"(?:©|copyright|published|accepted|received)[^.\n]{0,40}?\b((?:19|20)\d{2})\b", page1, re.I)
        if y:
            md.year = int(y.group(1))
    body = " ".join(b.text for b in blocks if b.type == "paragraph")
    md.language = guess_language(body)
    return md
