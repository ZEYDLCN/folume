"""Column detection and reading order.

Strategy (a pragmatic relative of recursive XY-cut): find the vertical gutter that very few text
fragments cross; fragments crossing it (titles, wide floats, full-width paragraphs) become
"spanning" separators that cut the page into horizontal bands; inside each band the left column
is read before the right one.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .types import Bbox, Fragment

SPAN = 2


@dataclass
class PageLayout:
    kind: str  # single_column | two_column | unknown
    confidence: float
    gutter: tuple[float, float] | None = None  # x range
    columns: list[tuple[float, float]] = field(default_factory=list)  # x extents of text columns
    notes: list[str] = field(default_factory=list)

    def column_of(self, bbox: Bbox) -> int:
        if self.kind != "two_column" or self.gutter is None:
            return 0
        g_center = (self.gutter[0] + self.gutter[1]) / 2
        if bbox[2] <= g_center + 1.5:
            return 0
        if bbox[0] >= g_center - 1.5:
            return 1
        return SPAN


def _gutter_candidates(frags: list[Fragment], left: float, right: float) -> tuple[float, float, int] | None:
    width = right - left
    if width < 200 or len(frags) < 6:
        return None
    lo, hi = left + 0.3 * width, left + 0.7 * width
    step = 1.0
    xs = [lo + i * step for i in range(int((hi - lo) / step) + 1)]
    crossing = []
    for x in xs:
        crossing.append(sum(1 for f in frags if f.x0 < x - 0.5 and f.x1 > x + 0.5))
    best: tuple[int, int] | None = None  # (start_idx, end_idx) with minimal crossing and max width
    limit = max(1, int(0.2 * len(frags)))
    i = 0
    while i < len(xs):
        if crossing[i] <= limit:
            j = i
            while j + 1 < len(xs) and crossing[j + 1] <= limit:
                j += 1
            if best is None or (j - i) > (best[1] - best[0]):
                best = (i, j)
            i = j + 1
        else:
            i += 1
    if best is None:
        return None
    g0, g1 = xs[best[0]], xs[best[1]]
    return g0, g1, min(crossing[best[0] : best[1] + 1])


def analyze_page(frags: list[Fragment], page_width: float, prior: tuple[float, float] | None = None) -> PageLayout:
    body = [f for f in frags if f.width >= 6]
    if len(body) < 3:
        return PageLayout("single_column", 0.5, notes=["very little text"])
    left = min(f.x0 for f in body)
    right = max(f.x1 for f in body)
    cand = _gutter_candidates(body, left, right)
    notes: list[str] = []

    def evaluate(g0: float, g1: float, relaxed: bool = False) -> PageLayout | None:
        gc = (g0 + g1) / 2
        lefts = [f for f in body if f.x1 <= gc + 1.5]
        rights = [f for f in body if f.x0 >= gc - 1.5]
        spans = [f for f in body if f.x0 < gc - 1.5 and f.x1 > gc + 1.5]
        if relaxed:
            # the document is two-column elsewhere: a page with a nearly empty column is still two-column
            if not lefts and not rights:
                return None
            if len(lefts) + len(rights) < 0.5 * len(body):
                return None
        elif len(lefts) < 0.2 * len(body) or len(rights) < 0.2 * len(body):
            return None
        if g1 - g0 < 6:
            return None
        clean = (len(lefts) + len(rights)) / len(body)
        l_ext = (min(f.x0 for f in lefts), max(f.x1 for f in lefts)) if lefts else (left, g0)
        r_ext = (min(f.x0 for f in rights), max(f.x1 for f in rights)) if rights else (g1, right)
        # three-column check: a second large empty vertical band inside one column
        n = []
        for ext, side in ((l_ext, lefts), (r_ext, rights)):
            if not side:
                continue
            sub = _gutter_candidates(side, ext[0], ext[1])
            if sub and sub[1] - sub[0] >= 10 and sub[2] <= 0.1 * len(side):
                n.append(True)
        if n:
            notes.append("possible 3+ columns")
            return PageLayout("unknown", 0.3, (g0, g1), [l_ext, r_ext], notes)
        conf = max(0.4, min(0.98, clean + 0.05)) if len(spans) < 0.5 * len(body) else 0.5
        return PageLayout("two_column", conf, (g0, g1), [l_ext, r_ext], notes)

    if cand is not None:
        res = evaluate(cand[0], cand[1])
        if res is not None:
            return res
    if prior is not None:
        res = evaluate(*prior, relaxed=True)
        if res is not None:
            res.confidence = min(res.confidence, 0.7)
            res.notes.append("column layout inferred from other pages")
            return res
    # single column: all text lines share a left margin, mostly
    conf = 0.9
    if len(body) >= 10:
        starts = sorted(round(f.x0) for f in body)
        mode_share = max(starts.count(v) for v in set(starts)) / len(starts)
        conf = 0.95 if mode_share > 0.3 else 0.75
    return PageLayout("single_column", conf, None, [(left, right)], notes)


def reading_order(items: list, layout: PageLayout, get_bbox, is_wide) -> list:
    """Order arbitrary items (fragments/regions) for a page.

    `get_bbox(item)` returns the bbox; `is_wide(item)` says whether an item may be treated as
    spanning even if the gutter geometry is ambiguous (e.g. a full-width figure).
    """
    if layout.kind != "two_column":
        return sorted(items, key=lambda it: (get_bbox(it)[1], get_bbox(it)[0]))
    cols: dict[int, list] = {0: [], 1: [], SPAN: []}
    for it in items:
        cols[layout.column_of(get_bbox(it))].append(it)
    spans = sorted(cols[SPAN], key=lambda it: get_bbox(it)[1])
    ordered: list = []
    boundaries = [(get_bbox(s)[1], get_bbox(s)[3]) for s in spans]

    def band_of(it) -> int:
        b = get_bbox(it)
        mid = (b[1] + b[3]) / 2
        idx = 0
        for k, (top, bottom) in enumerate(boundaries):
            if mid > bottom - 1:
                idx = k + 1
            elif mid > top and mid < bottom:
                idx = k  # beside a spanning element: keep with the band above
        return idx

    for band in range(len(spans) + 1):
        for col in (0, 1):
            members = [it for it in cols[col] if band_of(it) == band]
            ordered += sorted(members, key=lambda it: (get_bbox(it)[1], get_bbox(it)[0]))
        if band < len(spans):
            ordered.append(spans[band])
    return ordered
