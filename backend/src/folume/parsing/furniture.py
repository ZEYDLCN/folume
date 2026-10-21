"""Running headers/footers and page numbers: kept out of the flow but listed in the ledger."""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass

from .types import Fragment, RawPage

_PAGE_NO = re.compile(r"^(?:page\s*)?(?:\d{1,4}|[ivxlc]{1,6})(?:\s*(?:of|/)\s*\d{1,4})?$", re.I)
TOP_BAND = 0.075
BOTTOM_BAND = 0.925
MAX_LEN = 110


@dataclass
class Furniture:
    fragment: Fragment
    reason: str  # running_header | running_footer | page_number


def _key(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"\d+", "#", text.lower())).strip()


def detect_furniture(pages: list[RawPage], frags: dict[int, list[Fragment]],
                     body_size: float = 10.0) -> list[Furniture]:
    height = {p.number: p.height for p in pages}
    n_pages = len(pages)
    by_key: dict[tuple[str, str], list[tuple[int, Fragment]]] = defaultdict(list)
    out: list[Furniture] = []
    taken: set[int] = set()

    def band(f: Fragment) -> str | None:
        h = height[f.page]
        if f.bottom <= TOP_BAND * h:
            return "top"
        if f.top >= BOTTOM_BAND * h:
            return "bottom"
        return None

    for number, fl in frags.items():
        for f in fl:
            b = band(f)
            if b is None or len(f.text) > MAX_LEN:
                continue
            if _PAGE_NO.match(f.text.strip()):
                out.append(Furniture(f, "page_number"))
                taken.add(id(f))
                continue
            by_key[(b, _key(f.text))].append((number, f))

    min_pages = 2 if n_pages <= 4 else max(2, int(0.3 * n_pages))
    for (b, _), items in by_key.items():
        distinct = {p for p, _ in items}
        if len(distinct) >= min_pages:
            for _, f in items:
                out.append(Furniture(f, "running_header" if b == "top" else "running_footer"))
                taken.add(id(f))
    # Alternating or one-off headers in short documents: a small single line that sits alone in the
    # margin, clearly separated from the text block, is running furniture even without repetition.
    gap_needed = 2.0 * 1.2 * body_size
    for number, fl in frags.items():
        h = height[number]
        top_band = [f for f in fl if f.bottom <= TOP_BAND * h]
        bottom_band = [f for f in fl if f.top >= BOTTOM_BAND * h]
        inner = [f for f in fl if f not in top_band and f not in bottom_band]
        if not inner:
            continue
        first, last = min(f.top for f in inner), max(f.bottom for f in inner)
        for band, is_top in ((top_band, True), (bottom_band, False)):
            rows = {round(f.baseline) for f in band}
            if len(rows) != 1:
                continue  # more than one line: probably real content, not a header
            for f in band:
                if id(f) in taken or len(f.text) > MAX_LEN or f.size > 0.95 * body_size:
                    continue
                gap = (first - f.bottom) if is_top else (f.top - last)
                if gap >= gap_needed:
                    out.append(Furniture(f, "running_header" if is_top else "running_footer"))
                    taken.add(id(f))
    return out
