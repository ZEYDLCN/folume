"""Optional OCR for scanned PDFs: recognised text lines become the characters the rest of the pipeline reads.

The engine is RapidOCR (Apache-2.0, ONNX models bundled in the wheel), installed with the `ocr` extra. Each page is
rendered with pdfium and the engine returns one quad and one string per text line. A line is spread over its box as one
`Char` per letter, in PDF points with the origin at the top-left, like the text layer of any other PDF; layout analysis,
structure and the completeness audit then work as they always do. Nothing in here knows about blocks.
"""

from __future__ import annotations

import re
import threading
from collections.abc import Callable
from functools import lru_cache

import pypdfium2 as pdfium

from .raw import normalize_text
from .structure import KNOWN_HEADINGS
from .types import Char, RawPage

OCR_DPI = 200  # below ~150 dpi the small print of a paper stops being recognised
MAX_SIDE_PX = 3500  # a poster is read at a lower resolution rather than allocating gigabytes
SIZE_SHARE = 0.8  # font size as a share of the line box height (the box also holds ascenders, descenders, margin)
BASELINE_SHARE = 0.2  # distance from the bottom of the box up to the baseline, as a share of the box height
FONT = "ocr"

# one conversion at a time per process: the engine is shared, and it already uses every core
_lock = threading.Lock()


@lru_cache(maxsize=1)
def _engine():
    from rapidocr_onnxruntime import RapidOCR  # noqa: PLC0415 (optional extra, heavy import)

    return RapidOCR()


@lru_cache(maxsize=1)
def ocr_available() -> bool:
    """True when the engine (the `ocr` extra) can be imported, native libraries included."""
    try:
        import rapidocr_onnxruntime  # noqa: F401, PLC0415
    except Exception:  # not installed, or a library it needs (OpenCV's, onnxruntime's) is missing
        return False
    return True


_HEADING_NUMBER = re.compile(r"^(?P<num>[IVX]{1,5}\.|\d{1,2}(?:\.\d{1,2}){0,3}\.)(?=[A-Z])")
_RUN_IN_ABSTRACT = re.compile(r"^(?P<word>ABSTRACT|Abstract)(?=[A-Z][a-z])")
_COMPACT_HEADINGS = {h.replace(" ", ""): h.split() for h in KNOWN_HEADINGS if " " in h}


def repair_line(text: str) -> str:
    """Put back what the default models habitually leave out of a line; structure analysis needs it to find headings.

    They drop the space after a heading number and the spaces inside upper-case lines ("II.RELATEDWORK") and the dash
    that follows a run-in "Abstract". Only spaces and that one dash are added: no letter or digit is touched."""
    text = _RUN_IN_ABSTRACT.sub(lambda m: m.group("word") + "\u2014", text)
    number = _HEADING_NUMBER.match(text)
    head, rest = (text[:number.end()] + " ", text[number.end():]) if number else ("", text)
    words = _COMPACT_HEADINGS.get(rest.lower())
    if words:  # "RELATEDWORK": the words of a known heading, cut where that heading has its spaces
        cuts, start = [], 0
        for w in words:
            cuts.append(rest[start:start + len(w)])
            start += len(w)
        rest = " ".join(cuts)
    return head + rest


def line_chars(quad, text: str, page: int, sx: float, sy: float) -> list[Char]:
    """One recognised line as characters. The box width is shared evenly by all characters, spaces included, so a
    gap between words stays a gap between letters, which is what line building and the reading text rely on.

    `quad` is the four corners in pixels; `sx`/`sy` turn pixels into points. A slightly skewed line gives a tilted quad:
    its upright box is taken from the means of the two upper, the two lower, the two left and the two right corners."""
    xs = sorted(p[0] for p in quad)
    ys = sorted(p[1] for p in quad)
    x0, x1 = (xs[0] + xs[1]) / 2 * sx, (xs[2] + xs[3]) / 2 * sx
    top, bottom = (ys[0] + ys[1]) / 2 * sy, (ys[2] + ys[3]) / 2 * sy
    height = bottom - top
    text = repair_line(re.sub(r"\s+", " ", text).strip())
    if not text or height <= 0.5 or x1 <= x0:
        return []
    slot = (x1 - x0) / len(text)
    size = SIZE_SHARE * height
    chars: list[Char] = []
    for i, raw in enumerate(text):
        ch = normalize_text(raw)
        if not ch or ch.isspace():
            continue
        chars.append(Char(text=ch, x0=x0 + i * slot, x1=x0 + (i + 1) * slot, top=top, bottom=bottom, size=size,
                          baseline=bottom - BASELINE_SHARE * height, font=FONT, page=page))
    return chars


def steady_sizes(pages: list[RawPage]) -> None:
    """Snap the font sizes of the lines to a few steady values.

    A line box is as tall as the ink in it (brackets and descenders make it taller, a line of lower-case letters without
    ascenders shorter), so the sizes of one body of text scatter by ten percent or more. Structure analysis reads sizes
    relative to the body text (a heading is bigger, a caption smaller), so that scatter would turn lines into headings.
    Sizes close to the body size become exactly the body size; every other size joins the group of the largest size
    within fifteen percent of it, so a heading or a footnote is steady too."""
    weights: dict[float, int] = {}
    for p in pages:
        for c in p.chars:
            weights[c.size] = weights.get(c.size, 0) + 1
    if not weights:
        return
    ordered = sorted(weights)
    half, seen = sum(weights.values()) / 2, 0
    body = ordered[-1]
    for size in ordered:  # the weighted median is the body text: most of a paper is body text
        seen += weights[size]
        if seen >= half:
            body = size
            break
    snapped: dict[float, float] = {}
    for size in ordered:
        if body * 0.87 <= size <= body * 1.15:
            snapped[size] = body
    anchor = 0.0  # the largest size of the group being filled
    for size in ordered[::-1]:
        if size in snapped:
            continue
        if not anchor or anchor / size > 1.15:
            anchor = size
        snapped[size] = anchor
    for p in pages:
        for c in p.chars:
            c.size = snapped[c.size]


def _render(page, scale: float):
    """The page as a contiguous BGR array (what the engine takes; OpenCV copies a strided view on every call)."""
    import numpy as np  # noqa: PLC0415 (comes with the `ocr` extra, not with the base install)

    image = page.render(scale=scale).to_pil().convert("RGB")
    return np.ascontiguousarray(np.asarray(image)[:, :, ::-1])


def _read_page(engine, pdf, index: int) -> RawPage:
    page = pdf[index]
    try:
        width, height = (float(v) for v in page.get_size())
        arr = _render(page, min(OCR_DPI / 72, MAX_SIDE_PX / max(width, height)))
    finally:
        page.close()
    sx, sy = width / arr.shape[1], height / arr.shape[0]
    with _lock:
        lines, _ = engine(arr)
    chars: list[Char] = []
    weight = confidence = 0.0
    for quad, text, score in lines or []:
        got = line_chars(quad, text, index + 1, sx, sy)
        chars += got
        try:
            confidence += float(score) * len(got)
        except (TypeError, ValueError):
            confidence += 0.5 * len(got)
        weight += len(got)
    return RawPage(number=index + 1, width=width, height=height, chars=chars,
                   ocr_confidence=round(confidence / weight, 4) if weight else None)


def ocr_pages(data: bytes, progress: Callable[[int, int], None] | None = None) -> list[RawPage]:
    """Read every page of a PDF with OCR. The result has the shape `extract_pages` gives for a PDF with a text layer
    (no rules, figures or font information: only characters), so the rest of the pipeline can take it as it is."""
    engine = _engine()
    pdf = pdfium.PdfDocument(data)
    try:
        total = len(pdf)
        pages: list[RawPage] = []
        for i in range(total):
            pages.append(_read_page(engine, pdf, i))
            if progress:
                progress(i + 1, total)
        steady_sizes(pages)
        return pages
    finally:
        pdf.close()
