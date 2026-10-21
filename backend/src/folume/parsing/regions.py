"""Non-flow regions: figures (raster + vector clusters) and tables (ruled or caption-anchored)."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .types import (
    Bbox,
    Char,
    Fragment,
    RawPage,
    Rule,
    expand,
    inside_fraction,
    union,
)

CAPTION_RE = re.compile(
    r"^\s*(?P<label>(?:fig(?:ure)?s?\.?|table|tab\.|scheme|algorithm|listing)\s*"
    r"(?P<num>[A-Z]?\d+(?:\.\d+)?|[IVXLC]+)(?P<sep>\s*[.:|—–-]|\s))",
    re.I,
)


@dataclass(eq=False)
class Region:
    kind: str  # figure | table | equation
    page: int
    bbox: Bbox
    fragments: list[Fragment] = field(default_factory=list)
    chars: list[Char] = field(default_factory=list)  # rotated chars folded in
    confidence: float = 0.8
    ruled: bool = False  # tables: detected from rules
    notes: list[str] = field(default_factory=list)
    number: str | None = None


# ---- tables ------------------------------------------------------------------------------------


def _group_rules(rules: list[Rule], page: RawPage) -> list[list[Rule]]:
    hs = sorted(
        (r for r in rules if r.horizontal and r.length >= 40
         and r.bbox[1] > 0.075 * page.height and r.bbox[3] < 0.925 * page.height),
        key=lambda r: r.bbox[1],
    )
    groups: list[list[Rule]] = []
    for r in hs:
        placed = False
        for g in groups:
            last = g[-1]
            same_x = abs(last.bbox[0] - r.bbox[0]) <= 6 and abs(last.bbox[2] - r.bbox[2]) <= 6
            if same_x and r.bbox[1] - last.bbox[1] <= 260:
                g.append(r)
                placed = True
                break
        if not placed:
            groups.append([r])
    return [g for g in groups if len(g) >= 2]


def detect_ruled_tables(page: RawPage, frags: list[Fragment]) -> list[Region]:
    regions: list[Region] = []
    for g in _group_rules(page.rules, page):
        x0 = min(r.bbox[0] for r in g)
        x1 = max(r.bbox[2] for r in g)
        top = g[0].bbox[1]
        bottom = g[-1].bbox[3]
        if bottom - top > 0.65 * page.height:
            continue
        verticals = [r for r in page.rules if not r.horizontal
                     and r.bbox[1] >= top - 3 and r.bbox[3] <= bottom + 3 and x0 - 3 <= r.bbox[0] <= x1 + 3]
        bbox = (x0, top, x1, bottom)
        if verticals:
            bbox = union([bbox] + [r.bbox for r in verticals])
        inside = [f for f in frags if inside_fraction(f.bbox, expand(bbox, 2)) >= 0.7]
        if len(inside) < 2:
            continue
        tb = union([bbox] + [f.bbox for f in inside])
        regions.append(Region("table", page.number, tb, fragments=inside, ruled=True, confidence=0.85))
    return regions


def detect_caption_tables(page: RawPage, frags: list[Fragment], claimed: set[int]) -> list[Region]:
    """Borderless tables: aligned multi-fragment rows right below (or above) a 'Table N' caption."""
    out: list[Region] = []
    free = [f for f in frags if id(f) not in claimed]
    rows = _rows(free)
    for i, row in enumerate(rows):
        first = min(row, key=lambda f: f.x0)
        if not re.match(r"^\s*(table|tab\.)\s*[\dIVX]+", first.text, re.I):
            continue
        cap_bottom = max(f.bottom for f in row)
        body: list[list[Fragment]] = []
        for nxt in rows[i + 1:]:
            multi = len(nxt) >= 2
            wide_single = len(nxt) == 1 and nxt[0].width > 0.7 * page.width * 0.5 and len(nxt[0].text) > 45
            if wide_single or (body and nxt[0].top - body[-1][0].bottom > 22):
                break
            if CAPTION_RE.match(nxt[0].text):
                break
            if multi or len(nxt[0].text) < 30:
                body.append(nxt)
            else:
                break
        multi_rows = [r for r in body if len(r) >= 2]
        if len(body) >= 3 and len(multi_rows) >= max(2, int(0.6 * len(body))):
            fl = [f for r in body for f in r]
            bbox = union([f.bbox for f in fl])
            if bbox[1] - cap_bottom < 30:
                out.append(Region("table", page.number, bbox, fragments=fl, ruled=False, confidence=0.5,
                                  notes=["borderless"]))
                claimed.update(id(f) for f in fl)
    return out


def _rows(frags: list[Fragment]) -> list[list[Fragment]]:
    rows: list[list[Fragment]] = []
    for f in sorted(frags, key=lambda f: (f.baseline, f.x0)):
        if rows and abs(rows[-1][0].baseline - f.baseline) <= 1.5:
            rows[-1].append(f)
        else:
            rows.append([f])
    return [sorted(r, key=lambda f: f.x0) for r in rows]


# ---- figures -------------------------------------------------------------------------------------


def _clusters(boxes: list[Bbox], gap: float) -> list[list[Bbox]]:
    parent = list(range(len(boxes)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    ex = [expand(b, gap / 2) for b in boxes]
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            a, b = ex[i], ex[j]
            if a[0] <= b[2] and b[0] <= a[2] and a[1] <= b[3] and b[1] <= a[3]:
                parent[find(i)] = find(j)
    groups: dict[int, list[Bbox]] = {}
    for i, b in enumerate(boxes):
        groups.setdefault(find(i), []).append(b)
    return list(groups.values())


def detect_figures(page: RawPage, frags: list[Fragment], rotated: list[Char], claimed: set[int],
                   table_boxes: list[Bbox], body_size: float) -> list[Region]:
    h = page.height
    prims: list[Bbox] = [b for b in page.images + page.graphics if b[1] > 0.04 * h and b[3] < 0.96 * h]
    for r in page.rules:
        if r.bbox[1] <= 0.075 * h or r.bbox[3] >= 0.925 * h:
            continue
        if any(inside_fraction(r.bbox, expand(tb, 3)) > 0.8 for tb in table_boxes):
            continue
        prims.append(r.bbox)
    if not prims:
        return []
    regions: list[Region] = []
    for cl in _clusters(prims, 6.0):
        bbox = union(cl)
        has_image = any(inside_fraction(b, bbox) > 0.9 and (b[2] - b[0]) > 20 and (b[3] - b[1]) > 20
                        for b in page.images if bbox[0] - 1 <= b[0] and b[2] <= bbox[2] + 1)
        w, hh = bbox[2] - bbox[0], bbox[3] - bbox[1]
        if not has_image and (w < 36 or hh < 30 or len(cl) < 3):
            continue
        if w * hh > 0.7 * page.width * h:
            continue
        regions.append(Region("figure", page.number, bbox, confidence=0.9 if has_image or len(cl) >= 8 else 0.7))
    regions = _merge_panels(regions)
    free = [f for f in frags if id(f) not in claimed]
    for reg in regions:
        _absorb_text(reg, free, rotated, body_size)
    # guard: a framed box full of body text (algorithm, listing) is not a figure
    keep: list[Region] = []
    for reg in regions:
        long_lines = [f for f in reg.fragments if len(f.text) >= 45 and abs(f.size - body_size) < 1.0]
        if len(long_lines) >= 4 and not any(im for im in page.images if inside_fraction(im, reg.bbox) > 0.5):
            for f in reg.fragments:
                claimed.discard(id(f))
            continue
        keep.append(reg)
    return keep


def _merge_panels(regions: list[Region]) -> list[Region]:
    merged = True
    while merged:
        merged = False
        for i in range(len(regions)):
            for j in range(i + 1, len(regions)):
                a, b = regions[i].bbox, regions[j].bbox
                hgap = max(a[0], b[0]) - min(a[2], b[2])
                vgap = max(a[1], b[1]) - min(a[3], b[3])
                v_overlap = min(a[3], b[3]) - max(a[1], b[1])
                h_overlap = min(a[2], b[2]) - max(a[0], b[0])
                side = hgap <= 14 and v_overlap > 0.5 * min(a[3] - a[1], b[3] - b[1])
                stacked = vgap <= 10 and h_overlap > 0.5 * min(a[2] - a[0], b[2] - b[0])
                if side or stacked:
                    regions[i] = Region("figure", regions[i].page, union([a, b]),
                                        confidence=min(regions[i].confidence, regions[j].confidence))
                    del regions[j]
                    merged = True
                    break
            if merged:
                break
    return regions


def _gap(a: Bbox, b: Bbox) -> float:
    dx = max(a[0] - b[2], b[0] - a[2], 0.0)
    dy = max(a[1] - b[3], b[1] - a[3], 0.0)
    return (dx * dx + dy * dy) ** 0.5


def _absorb_text(reg: Region, free: list[Fragment], rotated: list[Char], body_size: float) -> None:
    """Grow the figure box over axis labels/legends: small, short, non-caption text close by."""
    changed = True
    taken: set[int] = set()
    while changed:
        changed = False
        for f in free:
            if id(f) in taken:
                continue
            inside = inside_fraction(f.bbox, expand(reg.bbox, 2)) >= 0.5
            near = _gap(f.bbox, reg.bbox) <= 14
            if not (inside or near):
                continue
            if CAPTION_RE.match(f.text):
                continue
            small_and_short = (f.size <= body_size * 0.95 and len(f.text) <= 40) or len(f.text) <= 12
            if inside or small_and_short:
                taken.add(id(f))
                reg.fragments.append(f)
                nb = union([reg.bbox, f.bbox])
                if nb != reg.bbox:
                    reg.bbox = nb
                    changed = True
    for c in rotated:
        if _gap(c.bbox, reg.bbox) <= 14:
            reg.chars.append(c)
            reg.bbox = union([reg.bbox, c.bbox])
