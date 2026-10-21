"""Internal geometry/text types of the parsing pipeline (not part of the public document model)."""

from __future__ import annotations

from dataclasses import dataclass, field

Bbox = tuple[float, float, float, float]  # x0, top, x1, bottom (PDF points, top-left origin)


def union(boxes: list[Bbox]) -> Bbox:
    return (
        min(b[0] for b in boxes),
        min(b[1] for b in boxes),
        max(b[2] for b in boxes),
        max(b[3] for b in boxes),
    )


def overlap_area(a: Bbox, b: Bbox) -> float:
    w = min(a[2], b[2]) - max(a[0], b[0])
    h = min(a[3], b[3]) - max(a[1], b[1])
    return w * h if w > 0 and h > 0 else 0.0


def area(b: Bbox) -> float:
    return max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])


def inside_fraction(inner: Bbox, outer: Bbox) -> float:
    """Fraction of `inner`'s area that lies inside `outer`."""
    a = area(inner)
    if a <= 0:
        # degenerate (e.g. a thin line): use the 1-D overlap along the longer side
        w = min(inner[2], outer[2]) - max(inner[0], outer[0])
        h = min(inner[3], outer[3]) - max(inner[1], outer[1])
        if inner[2] - inner[0] >= inner[3] - inner[1]:
            return max(0.0, w) / max(inner[2] - inner[0], 1e-6) if h >= -0.5 else 0.0
        return max(0.0, h) / max(inner[3] - inner[1], 1e-6) if w >= -0.5 else 0.0
    return overlap_area(inner, outer) / a


def expand(b: Bbox, dx: float, dy: float | None = None) -> Bbox:
    dy = dx if dy is None else dy
    return (b[0] - dx, b[1] - dy, b[2] + dx, b[3] + dy)


@dataclass(eq=False)
class Char:
    text: str
    x0: float
    x1: float
    top: float
    bottom: float
    size: float
    baseline: float
    font: str
    bold: bool = False
    italic: bool = False
    mono: bool = False
    math: bool = False
    upright: bool = True
    page: int = 0
    # accounting: None until the char is placed somewhere ("block", "figure", "table", "omitted")
    status: str | None = None

    @property
    def bbox(self) -> Bbox:
        return (self.x0, self.top, self.x1, self.bottom)


@dataclass(eq=False)
class Fragment:
    """Characters sharing a baseline with no large horizontal gap (a line, or part of one)."""

    page: int
    chars: list[Char]
    bbox: Bbox
    baseline: float
    size: float  # dominant font size
    column: int = -1  # assigned later: -1 unknown, 0 left, 1 right, 2 spanning
    kind: str = "text"  # text | omitted

    @property
    def text(self) -> str:
        return fragment_text(self.chars)

    @property
    def x0(self) -> float:
        return self.bbox[0]

    @property
    def x1(self) -> float:
        return self.bbox[2]

    @property
    def top(self) -> float:
        return self.bbox[1]

    @property
    def bottom(self) -> float:
        return self.bbox[3]

    @property
    def width(self) -> float:
        return self.bbox[2] - self.bbox[0]

    @property
    def math_ratio(self) -> float:
        ink = [c for c in self.chars if not c.text.isspace()]
        if not ink:
            return 0.0
        return sum(1 for c in ink if c.math) / len(ink)

    @property
    def bold_ratio(self) -> float:
        ink = [c for c in self.chars if not c.text.isspace()]
        return sum(1 for c in ink if c.bold) / len(ink) if ink else 0.0

    @property
    def italic_ratio(self) -> float:
        ink = [c for c in self.chars if not c.text.isspace()]
        return sum(1 for c in ink if c.italic) / len(ink) if ink else 0.0


def fragment_text(chars: list[Char]) -> str:
    """Join chars of one line into text, inferring spaces from horizontal gaps."""
    out: list[str] = []
    prev: Char | None = None
    for ch in sorted(chars, key=lambda c: (c.x0, c.top)):
        if prev is not None and not ch.text.isspace() and not prev.text.isspace():
            gap = ch.x0 - prev.x1
            ref = min(max(ch.size, prev.size), 14) if max(ch.size, prev.size) > 0 else 10
            if gap > 0.16 * ref:
                out.append(" ")
        out.append(ch.text)
        prev = ch
    return "".join(out)


@dataclass
class Rule:
    """A straight horizontal/vertical stroke or thin filled rect."""

    bbox: Bbox
    horizontal: bool

    @property
    def length(self) -> float:
        return (self.bbox[2] - self.bbox[0]) if self.horizontal else (self.bbox[3] - self.bbox[1])


@dataclass
class RawPage:
    number: int
    width: float
    height: float
    chars: list[Char]
    rules: list[Rule] = field(default_factory=list)
    graphics: list[Bbox] = field(default_factory=list)  # non-rule paths, filled rects
    images: list[Bbox] = field(default_factory=list)
    rotation: int = 0
