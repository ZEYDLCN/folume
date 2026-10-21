"""Declarative description of a synthetic paper and its typographic template."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Para:
    text: str  # may contain $math$, <i>/<b> and {cite:N} placeholders
    footnote: str | None = None


@dataclass
class Heading:
    text: str
    level: int = 1


@dataclass
class Equation:
    expr: str


@dataclass
class Figure:
    kind: str  # line | bar | raster | mixed
    caption: str
    wide: bool = False
    height: float = 120.0


@dataclass
class Table:
    header: list[str]
    rows: list[list[str]]
    caption: str
    style: str = "booktabs"  # booktabs | grid
    wide: bool = False


@dataclass
class Bullets:
    items: list[str]
    ordered: bool = False


@dataclass
class Code:
    lines: list[str]


@dataclass
class Ref:
    authors: list[tuple[str, str]]  # (first, last)
    title: str
    venue: str
    year: int
    pages: str = ""


@dataclass
class Paper:
    id: str
    title: str
    authors: list[tuple[str, str]]  # (name, affiliation)
    abstract: str
    keywords: list[str]
    body: list
    references: list[Ref]
    template: str = "ieee"
    short_title: str = ""
    stamp: str | None = None
    doi: str | None = None


@dataclass
class Template:
    name: str
    page: tuple[float, float] = (612, 792)
    margins: tuple[float, float, float, float] = (54, 54, 54, 60)  # left, right, top, bottom
    columns: int = 2
    gutter: float = 18
    body_size: float = 10
    leading: float = 12
    title_size: float = 20
    numbering: str = "roman"  # roman | arabic
    heading_sans: bool = False
    heading_upper: bool = True
    heading1_center: bool = True
    abstract_mode: str = "run_in"  # run_in | block
    fig_label: str = "Fig. {n}."
    table_label: str = "TABLE {r}"
    table_two_line: bool = True
    cite_style: str = "numeric"  # numeric | author_year
    page_numbers: bool = True
    alternate_header: bool = False
    first_page_header: bool = False
    hyphenate: bool = True
    extras: dict = field(default_factory=dict)


TEMPLATES: dict[str, Template] = {
    "ieee": Template(name="ieee"),
    "acm": Template(
        name="acm",
        margins=(54, 54, 60, 66),
        gutter=22,
        body_size=9.5,
        leading=11.5,
        title_size=18,
        numbering="arabic",
        heading_sans=True,
        heading1_center=False,
        abstract_mode="block",
        fig_label="Figure {n}:",
        table_label="Table {n}:",
        table_two_line=False,
        cite_style="author_year",
        alternate_header=True,
    ),
    "arxiv": Template(
        name="arxiv",
        margins=(72, 72, 72, 72),
        columns=1,
        gutter=0,
        body_size=11,
        leading=13.6,
        title_size=18,
        numbering="arabic",
        heading_upper=False,
        heading1_center=False,
        abstract_mode="block",
        fig_label="Figure {n}:",
        table_label="Table {n}:",
        table_two_line=False,
    ),
}
