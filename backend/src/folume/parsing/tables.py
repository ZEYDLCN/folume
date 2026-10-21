"""Table cell recovery from aligned text fragments. Returns a confidence so callers can fall back
to the table image (and say so) when the structure is not trustworthy."""

from __future__ import annotations

from collections import Counter

from ..model import TableData
from .regions import Region
from .types import Char, Fragment, Rule, fragment_text, union


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


def _clusters(values: list[float], tol: float = 2.5) -> list[float]:
    out: list[list[float]] = []
    for v in sorted(values):
        if out and v - out[-1][-1] <= tol:
            out[-1].append(v)
        else:
            out.append([v])
    return [sum(c) / len(c) for c in out]


def _cell_text(chars: list[Char]) -> str:
    """Text of one cell: lines top to bottom, a hyphen at a line end joins the words."""
    lines: list[list[Char]] = []
    for c in sorted(chars, key=lambda c: (c.baseline, c.x0)):
        if lines and abs(lines[-1][0].baseline - c.baseline) <= 2.0:
            lines[-1].append(c)
        else:
            lines.append([c])
    text = ""
    for ln in lines:
        part = fragment_text(ln).strip()
        if not part:
            continue
        text = text[:-1] + part if text.endswith("-") and part[:1].islower() else f"{text} {part}".strip()
    return text


def _grid_table(reg: Region, rules: list[Rule]) -> tuple[TableData | None, float]:
    """A table drawn with a full grid of lines: the lines are the cells, wrapped text included."""
    x0, y0, x1, y1 = reg.bbox
    pad = 4.0
    near = [r for r in rules if r.bbox[0] >= x0 - pad and r.bbox[2] <= x1 + pad and r.bbox[1] >= y0 - pad
            and r.bbox[3] <= y1 + pad]
    hs = [r for r in near if r.horizontal and r.length >= 0.6 * (x1 - x0)]
    vs = [r for r in near if not r.horizontal and r.length >= 0.6 * (y1 - y0)]
    ys = _clusters([(r.bbox[1] + r.bbox[3]) / 2 for r in hs])
    xs = _clusters([(r.bbox[0] + r.bbox[2]) / 2 for r in vs])
    if len(ys) < 3 or len(xs) < 3:
        return None, 0.0
    # a regular grid: every vertical line spans the whole table (no merged cells), and the lines enclose the text
    top, bottom, left, right = ys[0], ys[-1], xs[0], xs[-1]
    if any(r.bbox[1] > top + 3 or r.bbox[3] < bottom - 3 for r in vs if left - 2 <= (r.bbox[0] + r.bbox[2]) / 2 <= right + 2):
        return None, 0.0
    chars = [c for f in reg.fragments for c in f.chars] + list(reg.chars)
    cells: dict[tuple[int, int], list[Char]] = {}
    outside = 0
    for c in chars:
        cx, cy = (c.x0 + c.x1) / 2, (c.top + c.bottom) / 2
        if not (left <= cx <= right and top <= cy <= bottom):
            outside += 1
            continue
        col = max(i for i, x in enumerate(xs[:-1]) if x <= cx) if cx >= xs[0] else 0
        row = max(i for i, y in enumerate(ys[:-1]) if y <= cy) if cy >= ys[0] else 0
        cells.setdefault((row, col), []).append(c)
    if not chars or outside > 0.05 * len(chars):
        return None, 0.0
    nrows, ncols = len(ys) - 1, len(xs) - 1
    grid = [[_cell_text(cells.get((r, c), [])) for c in range(ncols)] for r in range(nrows)]
    # a doubled outer rule leaves an empty band at the edge of the grid
    while grid and not any(grid[0]):
        grid.pop(0)
        ys.pop(0)
    while grid and not any(grid[-1]):
        grid.pop()
        ys.pop()
    if len(grid) < 2:
        return None, 0.0
    nrows = len(grid)
    filled = sum(1 for row in grid for cell in row if cell) / (nrows * ncols)
    if filled < 0.5:
        return None, 0.0
    first = [c for c in chars if top <= (c.top + c.bottom) / 2 <= ys[1]]
    header = 1 if first and sum(1 for c in first if c.bold) / len(first) >= 0.8 else 0
    return TableData(rows=grid, header_rows=header), 0.95 if filled > 0.8 else 0.8


def extract_table(reg: Region, rules: list[Rule]) -> tuple[TableData | None, float]:
    grid = _grid_table(reg, rules)
    if grid[0] is not None:
        return grid
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
