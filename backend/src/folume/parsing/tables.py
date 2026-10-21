"""Table cell recovery from aligned text fragments. Returns a confidence so callers can fall back
to the table image (and say so) when the structure is not trustworthy."""

from __future__ import annotations

from collections import Counter

from ..model import TableData
from .regions import Region
from .types import Fragment, Rule, union


def _resplit(frags: list[Fragment]) -> list[Fragment]:
    """Cells in tables are closer together than text columns: split at gaps wider than ~0.4 em."""
    out: list[Fragment] = []
    for f in frags:
        chars = sorted(f.chars, key=lambda c: c.x0)
        limit = max(3.0, 0.4 * f.size)
        group = [chars[0]]
        for c in chars[1:]:
            if c.x0 - group[-1].x1 > limit:
                out.append(_frag(f, group))
                group = [c]
            else:
                group.append(c)
        out.append(_frag(f, group))
    return out


def _frag(src: Fragment, chars) -> Fragment:
    return Fragment(page=src.page, chars=chars, bbox=union([c.bbox for c in chars]), baseline=src.baseline,
                    size=src.size)


def _rows(frags: list[Fragment]) -> list[list[Fragment]]:
    rows: list[list[Fragment]] = []
    for f in sorted(frags, key=lambda f: (f.baseline, f.x0)):
        if rows and abs(rows[-1][0].baseline - f.baseline) <= 2.0:
            rows[-1].append(f)
        else:
            rows.append([f])
    return [sorted(r, key=lambda f: f.x0) for r in rows]


def extract_table(reg: Region, rules: list[Rule]) -> tuple[TableData | None, float]:
    rows = _rows(_resplit(reg.fragments))
    if len(rows) < 2:
        return None, 0.2
    counts = Counter(len(r) for r in rows)
    ncols, _ = max(counts.items(), key=lambda kv: (kv[1], kv[0]))
    if ncols < 2:
        return None, 0.3
    ref_rows = [r for r in rows if len(r) == ncols]
    # Header text is often wider than its (right-aligned) data column, so derive the column
    # ranges from the data rows and map rows that have one fragment per column by position.
    range_rows = ref_rows[1:] if len(ref_rows) >= 3 else ref_rows
    ranges = [(min(r[k].x0 for r in range_rows), max(r[k].x1 for r in range_rows)) for k in range(ncols)]
    # column ranges must not overlap each other, otherwise the alignment is ambiguous
    for a, b in zip(ranges, ranges[1:], strict=False):
        if b[0] < a[1] - 1:
            return None, 0.35

    cells: list[list[str]] = []
    spanning = 0
    overfull = 0
    for r in rows:
        row = [""] * ncols
        if len(r) > ncols:
            overfull += 1
        if len(r) == ncols:
            row = [f.text.strip() for f in r]
            cells.append(row)
            continue
        for f in r:
            overlaps = [max(0.0, min(f.x1, hi) - max(f.x0, lo)) for lo, hi in ranges]
            best = max(range(ncols), key=lambda k: overlaps[k])
            if sum(1 for o in overlaps if o > 0.3 * f.width) > 1:
                spanning += 1
            if overlaps[best] <= 0:  # fell between columns: nearest by centre
                cx = (f.x0 + f.x1) / 2
                best = min(range(ncols), key=lambda k: abs(cx - (ranges[k][0] + ranges[k][1]) / 2))
            row[best] = (row[best] + " " + f.text).strip()
        cells.append(row)

    full = sum(1 for r in rows if len(r) == ncols) / len(rows)
    confidence = 0.95 * full - 0.15 * (spanning > 0) - 0.15 * (overfull > 0)
    if not reg.ruled:
        confidence = min(confidence, 0.6)
    header_rows = 0
    first_bottom = max(f.bottom for f in rows[0])
    second_top = min(f.top for f in rows[1])
    x0, _, x1, _ = reg.bbox
    inner_rule = any(
        r.horizontal and first_bottom - 2 <= r.bbox[1] <= second_top + 2 and (r.bbox[2] - r.bbox[0]) >= 0.5 * (x1 - x0)
        for r in rules
    )
    bold_first = sum(f.bold_ratio for f in rows[0]) / len(rows[0]) >= 0.8
    if inner_rule or bold_first:
        header_rows = 1
    return TableData(rows=cells, header_rows=header_rows), max(0.0, min(1.0, confidence))
