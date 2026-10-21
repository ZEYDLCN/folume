"""Raw extraction: characters with font info and drawing primitives, via pdfplumber (MIT)."""

from __future__ import annotations

import io
import re
import unicodedata
from collections import Counter

import pdfplumber

from .types import Char, RawPage, Rule

_SUBSET = re.compile(r"^[A-Z]{6}\+")
_BOLD = re.compile(
    r"bold|black|heavy|semibold|demi|medi(?:um)?(?![a-z])|cmbx|cmb10|nimbusrom.*medi|[-_,]b(?:d|i)?$|_r[bi]b?$|[-_]bd",
    re.I,
)
_ITALIC = re.compile(r"italic|oblique|ital(?![a-z])|cmti|cmsl|[-_,]b?i$|_r[bi]i$|[-_]it(?![a-z])", re.I)
_MONO = re.compile(r"mono|courier|consolas|typewriter|cmtt|lmmono|menlo|inconsolata", re.I)

# Fonts that are only ever used for mathematics.
_MATH_STRONG = re.compile(
    r"cmmi|cmsy|cmex|cmmib|msam|msbm|eufm|eusm|rsfs|mathematicalpi|mathpi|cambria\s?math|latinmodern-?math|"
    r"lmmath|stixmath|stixsize|stixvar|stixnonunicode|xits.*math|txmi|txsy|txex|newtxmi|newtxsy|mtmi|mtsy|"
    r"mtex|mtextra|mathtime|libertinusmath|asanamath|dejavumath|^symbol|symbolmt|lmmi|lmsy|rmsy|rmmi",
    re.I,
)
# Fonts that are math only when they are a small minority of the document's characters.
_MATH_WEAK = re.compile(r"stixgeneral|cmr\d|cmsy|sfrm|wasy|lasy", re.I)
_WEAK_SHARE_LIMIT = 0.15

_LIGATURES = {"ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st"}


def clean_font_name(name: str) -> str:
    return _SUBSET.sub("", name or "")


def font_traits(name: str) -> tuple[bool, bool, bool]:
    n = clean_font_name(name)
    return bool(_BOLD.search(n)), bool(_ITALIC.search(n)), bool(_MONO.search(n))


def normalize_text(text: str) -> str:
    """Per-character normalization: ligatures, soft hyphens, exotic spaces."""
    if text in _LIGATURES:
        return _LIGATURES[text]
    if text == "­":
        return ""
    if text in "      ":
        return " "
    if len(text) == 1 and unicodedata.category(text) == "Cc":
        return ""
    return text


def extract_pages(data: bytes, max_pages: int | None = None) -> tuple[list[RawPage], dict]:
    """Return raw pages and PDF info (producer/title)."""
    pages: list[RawPage] = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        info = {}
        meta = pdf.metadata or {}
        info["producer"] = _s(meta.get("Producer"))
        info["title"] = _s(meta.get("Title"))
        info["author"] = _s(meta.get("Author"))
        info["page_count"] = len(pdf.pages)
        for idx, page in enumerate(pdf.pages, 1):
            if max_pages is not None and idx > max_pages:
                break
            pages.append(_extract_page(page, idx))
            page.flush_cache()
    classify_math_fonts(pages)
    derive_baselines(pages)
    return pages, info


def _s(v) -> str | None:
    if v is None:
        return None
    v = str(v).strip()
    return v or None


def _extract_page(page, number: int) -> RawPage:
    height = float(page.height)
    raw = RawPage(number=number, width=float(page.width), height=height, chars=[],
                  rotation=int(getattr(page, "rotation", 0) or 0))
    last: Char | None = None
    for c in page.chars:
        text = normalize_text(c.get("text", ""))
        if text == "":
            continue
        size = float(c.get("size") or 0) or float(c.get("height") or 0)
        if size <= 0.5:
            continue
        matrix = c.get("matrix") or (1, 0, 0, 1, 0, 0)
        baseline = height - float(matrix[5]) if c.get("upright", True) else float(c["bottom"])
        bold, italic, mono = font_traits(c.get("fontname", ""))
        ch = Char(
            text=text, x0=float(c["x0"]), x1=float(c["x1"]), top=float(c["top"]), bottom=float(c["bottom"]),
            size=size, baseline=baseline, font=clean_font_name(c.get("fontname", "")),
            bold=bold, italic=italic, mono=mono, upright=bool(c.get("upright", True)), page=number,
        )
        # drop exact duplicates (fake-bold overprint)
        if last is not None and last.text == ch.text and abs(last.x0 - ch.x0) < 0.5 and abs(last.top - ch.top) < 0.5:
            continue
        raw.chars.append(ch)
        last = ch
    _collect_graphics(page, raw)
    return raw


def _collect_graphics(page, raw: RawPage) -> None:
    page_area = raw.width * raw.height
    for ln in page.lines:
        x0, x1, top, bottom = float(ln["x0"]), float(ln["x1"]), float(ln["top"]), float(ln["bottom"])
        w, h = x1 - x0, bottom - top
        if h <= 1.6 and w > 1.6:
            raw.rules.append(Rule((x0, top, x1, max(bottom, top + 0.1)), True))
        elif w <= 1.6 and h > 1.6:
            raw.rules.append(Rule((x0, top, max(x1, x0 + 0.1), bottom), False))
        else:
            raw.graphics.append((x0, top, x1, bottom))
    for r in page.rects:
        x0, x1, top, bottom = float(r["x0"]), float(r["x1"]), float(r["top"]), float(r["bottom"])
        w, h = x1 - x0, bottom - top
        if w * h > 0.8 * page_area:
            continue  # page background
        if h <= 1.6 and w > 1.6:
            raw.rules.append(Rule((x0, top, x1, max(bottom, top + 0.1)), True))
        elif w <= 1.6 and h > 1.6:
            raw.rules.append(Rule((x0, top, max(x1, x0 + 0.1), bottom), False))
        elif w > 1.6 and h > 1.6:
            raw.graphics.append((x0, top, x1, bottom))
    for cv in page.curves:
        x0, x1, top, bottom = float(cv["x0"]), float(cv["x1"]), float(cv["top"]), float(cv["bottom"])
        if (x1 - x0) * (bottom - top) > 0.8 * page_area:
            continue
        raw.graphics.append((x0, top, x1, max(bottom, top + 0.1)))
    for im in page.images:
        x0, x1, top, bottom = float(im["x0"]), float(im["x1"]), float(im["top"]), float(im["bottom"])
        if (x1 - x0) > 2 and (bottom - top) > 2:
            raw.images.append((x0, top, x1, bottom))


def derive_baselines(pages: list[RawPage]) -> None:
    """Baseline from the glyph box and a per-font descent ratio.

    The text matrix misses the text-rise operator (`Ts`), which many producers use for sub/superscripts,
    while the glyph box includes it. Per font, `(matrix baseline - box bottom) / size` is stable for
    unraised text, so its median is the font's descent ratio; the true baseline is `bottom + ratio * size`.
    """
    ratios: dict[str, list[float]] = {}
    for p in pages:
        for c in p.chars:
            if c.upright and c.size > 0:
                ratios.setdefault(c.font, []).append((c.baseline - c.bottom) / c.size)
    median_ratio = {f: sorted(v)[len(v) // 2] for f, v in ratios.items()}
    overall = sorted(r for v in ratios.values() for r in v)
    fallback = overall[len(overall) // 2] if overall else -0.2
    for p in pages:
        for c in p.chars:
            if c.upright:
                c.baseline = c.bottom + median_ratio.get(c.font, fallback) * c.size


def classify_math_fonts(pages: list[RawPage]) -> None:
    """Set `Char.math` from font names; weak math fonts only count when they are rare."""
    counts: Counter[str] = Counter()
    for p in pages:
        for c in p.chars:
            counts[c.font] += 1
    total = sum(counts.values()) or 1
    math_fonts: set[str] = set()
    for font, n in counts.items():
        if _MATH_STRONG.search(font) or _MATH_WEAK.search(font) and n / total < _WEAK_SHARE_LIMIT:
            math_fonts.add(font)
    for p in pages:
        for c in p.chars:
            if c.font in math_fonts:
                c.math = True
                c.italic = c.italic or "ital" in c.font.lower()
