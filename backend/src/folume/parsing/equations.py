"""Display equations: isolated math-font lines grown over fraction parts, limits and the number."""

from __future__ import annotations

import re

from .layout import SPAN, PageLayout
from .regions import CAPTION_RE, Region
from .types import Fragment, expand, union

EQ_NUMBER = re.compile(r"^\(\s*\d+(?:\.\d+)?[a-z]?\s*\)$")


def _text_letters(f: Fragment) -> int:
    """Letters set in a non-math font: three letters like 'exp' are operators, long words are prose."""
    return sum(1 for c in f.chars if c.text.isalpha() and not c.math)


def _col_extent(layout: PageLayout, col: int, frag: Fragment) -> tuple[float, float]:
    if layout.kind == "two_column" and col in (0, 1) and len(layout.columns) == 2:
        return layout.columns[col]
    if layout.columns:
        return layout.columns[0]
    return frag.x0, frag.x1


def detect_equations(page_no: int, free: list[Fragment], layout: PageLayout, body_size: float) -> list[Region]:
    numbers = [f for f in free if EQ_NUMBER.match(f.text.strip())]
    seeds: list[Fragment] = []
    for f in free:
        if EQ_NUMBER.match(f.text.strip()) or CAPTION_RE.match(f.text):
            continue
        if len(f.text) > 200:
            continue
        col = layout.column_of(f.bbox)
        c0, c1 = _col_extent(layout, col, f)
        col_w = max(c1 - c0, 1.0)
        has_number = any(abs(n.baseline - f.baseline) <= 0.7 * f.size + 2 and n.x0 >= f.x1 for n in numbers)
        right_bound = min([n.x0 for n in numbers if abs(n.baseline - f.baseline) <= 0.7 * f.size + 2 and n.x0 >= f.x1]
                          or [c1])
        ml, mr = f.x0 - c0, right_bound - f.x1
        centered = ml >= 0.05 * col_w and mr >= 0.05 * col_w and abs(ml - mr) <= 0.3 * col_w
        if f.math_ratio >= 0.45 and (centered or has_number or (f.math_ratio >= 0.8 and len(f.text) <= 120)) or has_number and (f.math_ratio >= 0.2 or "=" in f.text) and f.width < 0.85 * col_w:
            seeds.append(f)
    used: set[int] = set()
    regions: list[Region] = []
    for seed in sorted(seeds, key=lambda f: (f.top, f.x0)):
        if id(seed) in used:
            continue
        members = [seed]
        bbox = seed.bbox
        used.add(id(seed))
        grew = True
        while grew:
            grew = False
            size = max(m.size for m in members)
            for g in free:
                if id(g) in used or CAPTION_RE.match(g.text):
                    continue
                is_number = bool(EQ_NUMBER.match(g.text.strip()))
                if is_number:
                    in_span = bbox[1] - 0.3 * size <= g.baseline <= bbox[3] + 0.3 * size
                    ok = in_span and g.x0 >= bbox[2] - 1
                else:
                    v_near = g.top <= bbox[3] + 0.9 * size and g.bottom >= bbox[1] - 0.9 * size
                    h_near = g.x0 <= bbox[2] + 0.6 * size and g.x1 >= bbox[0] - 0.6 * size
                    short = len(g.text) <= 40 and _text_letters(g) < 5
                    eq_like = g.math_ratio >= 0.25 or len(g.text) <= 6 or g.size <= 0.95 * size
                    same_col = layout.column_of(g.bbox) in (layout.column_of(seed.bbox), SPAN)
                    ok = v_near and h_near and short and eq_like and same_col
                if ok:
                    members.append(g)
                    used.add(id(g))
                    bbox = union([bbox, g.bbox])
                    grew = True
        number = None
        for m in members:
            if EQ_NUMBER.match(m.text.strip()):
                number = m.text.strip()
        regions.append(Region("equation", page_no, expand(bbox, 0.5), fragments=members, confidence=0.7,
                              number=number))
    return regions
