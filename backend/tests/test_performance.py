"""Speed guards. The budgets are generous (several times what a laptop needs) so a slow CI machine does not trip them,
but an accidental quadratic loop or a repeated expensive call does.
"""

from __future__ import annotations

import time

import pytest

from folume.parsing.lines import build_fragments, dominant_size
from folume.parsing.pipeline import parse_pdf
from folume.parsing.types import Char, RawPage

SECONDS_PER_PAGE = 3.0  # measured: about 0.3 to 0.45 on a laptop


def _line(n: int, size: float = 10.0) -> list[Char]:
    return [
        Char(text="a" if i % 7 else " ", x0=i * 5.0, x1=i * 5.0 + 5.0, top=100.0, bottom=100.0 + size, size=size,
             baseline=100.0 + size * 0.8, font="Times")
        for i in range(n)
    ]


@pytest.mark.parametrize("name", ["ieee_ml", "acm_graph", "arxiv_bio"])
def test_a_page_converts_within_its_budget(corpus, name):
    pdf = corpus[name].pdf.read_bytes()
    pages = len(corpus[name].doc.pages)
    t0 = time.perf_counter()
    parse_pdf(pdf, f"{name}.pdf")
    per_page = (time.perf_counter() - t0) / pages
    assert per_page < SECONDS_PER_PAGE, f"{per_page:.2f}s per page"


def test_a_very_long_line_is_linear_not_quadratic():
    """One baseline with tens of thousands of characters (a minified table, a ruler) must not stall the converter."""
    page = RawPage(number=1, width=612, height=792, chars=_line(30000))
    t0 = time.perf_counter()
    fragments, _ = build_fragments(page)
    assert time.perf_counter() - t0 < 5.0
    assert sum(len(f.chars) for f in fragments) == sum(1 for c in page.chars if not c.text.isspace())


def test_dominant_size_picks_the_most_common_size_and_the_first_on_a_tie():
    chars = _line(10, 9.0) + _line(10, 12.0)
    assert dominant_size(chars) == 9.0  # equal counts: the size met first
    assert dominant_size(_line(3, 9.0) + _line(5, 12.0)) == 12.0
    assert dominant_size([]) == 10.0


def test_a_fragments_text_is_worked_out_once():
    page = RawPage(number=1, width=612, height=792, chars=_line(200))
    fragments, _ = build_fragments(page)
    f = fragments[0]
    assert f.text is f.text  # the same string object: not rebuilt on every access
