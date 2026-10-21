"""Papers printed by Chromium from HTML with CSS columns and MathML, including its default page header and footer.

Skipped when Chromium or pandoc is missing. A third producer next to the reportlab corpus and the LibreOffice papers.
"""

from __future__ import annotations

import os
import re
from statistics import mean

import pytest
from evals.metrics import f1, tokens
from synth.docx_paper import plain_text
from synth.html_paper import available, generate
from synth.spec import Equation, Figure, Heading, Para, Table

from folume.parsing.pipeline import parse_pdf

# CI machines carry other tool versions and fonts than the ones these layouts were checked with, so there the tests
# are opt-in (FOLUME_PRODUCER_TESTS=1); on a developer machine they run whenever the tool is installed.
pytestmark = pytest.mark.skipif(
    not available() or (bool(os.environ.get("CI")) and not os.environ.get("FOLUME_PRODUCER_TESTS")),
    reason="Chromium or pandoc is not installed (or CI without FOLUME_PRODUCER_TESTS=1)",
)

NAMES = ["ieee_ml", "acm_graph", "arxiv_bio"]


@pytest.fixture(scope="module")
def papers(tmp_path_factory):
    out = tmp_path_factory.mktemp("chrome")
    parsed = {}
    for name in NAMES:
        pdf, paper = generate(name, out)
        parsed[name] = (paper, parse_pdf(pdf.read_bytes(), pdf.name).document)
    return parsed


@pytest.mark.parametrize("name", NAMES)
def test_front_matter_and_structure(papers, name):
    paper, doc = papers[name]
    assert doc.metadata.title == paper.title
    assert doc.metadata.authors == [a for a, _ in paper.authors]
    assert [b.text.lower() for b in doc.blocks if b.type == "heading"] == [
        h.text.lower() for h in paper.body if isinstance(h, Heading)
    ]
    assert doc.quality.ledger.coverage >= 0.98


@pytest.mark.parametrize("name", NAMES)
def test_text_is_complete_and_the_browser_header_and_footer_stay_out(papers, name):
    paper, doc = papers[name]
    truth = [plain_text(p.text) for p in paper.body if isinstance(p, Para)]
    body = [b for b in doc.blocks if b.type == "paragraph"]
    scores = [max(f1(tokens(t), tokens(b.text)) for b in body) for t in truth]
    assert min(scores) >= 0.9, f"paragraph not recovered: {truth[scores.index(min(scores))][:80]}"
    assert mean(scores) >= 0.97
    everything = " ".join(b.text for b in doc.blocks)
    assert "file://" not in everything and not re.search(r"\b\d{1,2}/\d{1,2}/\d{2,4}\b", everything)
    assert not any(re.fullmatch(r"\d{1,2}\s*/\s*\d{1,2}", b.text.strip()) for b in doc.blocks)
    assert doc.quality.omitted, "the printed header and footer are listed as omitted, not silently dropped"


@pytest.mark.parametrize("name", NAMES)
def test_math_tables_and_figures(papers, name):
    paper, doc = papers[name]
    assert sum(b.type == "equation" for b in doc.blocks) == sum(isinstance(i, Equation) for i in paper.body)
    assert all(b.asset is not None and b.asset.kind == "equation" for b in doc.blocks if b.type == "equation")
    tables = [b for b in doc.blocks if b.type == "table"]
    truth = [t for t in paper.body if isinstance(t, Table)]
    assert len(tables) == len(truth)
    squash = lambda s: re.sub(r"[\s-]+", "", str(s)).lower()  # noqa: E731
    for t, b in zip(truth, tables, strict=True):
        assert b.table is not None and [squash(c) for c in b.table.rows[0]] == [squash(c) for c in t.header]
        assert [[squash(c) for c in r] for r in b.table.rows[1:]] == [[squash(c) for c in r] for r in t.rows]
    figs = [b for b in doc.blocks if b.type == "figure"]
    assert len(figs) == sum(isinstance(i, Figure) for i in paper.body) and all(f.caption_id for f in figs)
