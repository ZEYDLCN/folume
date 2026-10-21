"""Papers typeset by LibreOffice, a producer unrelated to the one that wrote the synthetic corpus.

Skipped when LibreOffice is not installed. Ground truth comes from the same paper description the DOCX is built from.
"""

from __future__ import annotations

import re
from statistics import mean

import pytest
from evals.metrics import f1, tokens
from synth.docx_paper import generate, plain_text, soffice_available
from synth.spec import Figure, Heading, Para, Table

from folume.parsing.pipeline import parse_pdf

pytestmark = pytest.mark.skipif(not soffice_available(), reason="LibreOffice is not installed")

NAMES = ["ieee_ml", "acm_graph", "arxiv_bio"]


@pytest.fixture(scope="module")
def papers(tmp_path_factory):
    out = tmp_path_factory.mktemp("lo")
    parsed = {}
    for name in NAMES:
        pdf, paper = generate(name, out)
        parsed[name] = (paper, parse_pdf(pdf.read_bytes(), pdf.name).document)
    return parsed


@pytest.mark.parametrize("name", NAMES)
def test_metadata_and_front_matter(papers, name):
    paper, doc = papers[name]
    assert doc.metadata.title == paper.title
    assert doc.metadata.authors == [a for a, _ in paper.authors]
    assert doc.metadata.abstract and doc.metadata.abstract.startswith(paper.abstract[:60])
    assert doc.quality.grade == "good" and doc.quality.ledger.coverage >= 0.98


@pytest.mark.parametrize("name", NAMES)
def test_headings_come_out_in_order(papers, name):
    paper, doc = papers[name]
    truth = [h.text.lower() for h in paper.body if isinstance(h, Heading)]
    got = [b.text.lower() for b in doc.blocks if b.type == "heading"]
    assert got == truth


@pytest.mark.parametrize("name", NAMES)
def test_text_is_complete_and_furniture_stays_out(papers, name):
    paper, doc = papers[name]
    truth = [plain_text(p.text) for p in paper.body if isinstance(p, Para)]
    body = [b for b in doc.blocks if b.type == "paragraph"]
    # every paragraph of the source is found, whole, as one block (no split sentences, no merged paragraphs)
    for t in truth:
        best = max((f1(tokens(t), tokens(b.text)) for b in body), default=0.0)
        assert best >= 0.9, f"paragraph not recovered: {t[:80]}"
    assert mean(max(f1(tokens(t), tokens(b.text)) for b in body) for t in truth) >= 0.97
    # running header and page numbers are not part of the text
    assert not any(paper.short_title and paper.short_title in b.text for b in doc.blocks if b.type == "paragraph")
    assert not any(re.fullmatch(r"\d{1,2}", b.text.strip()) for b in doc.blocks if b.type in ("paragraph", "heading"))
    assert min(len(b.text) for b in body) >= 25, "a stray fragment became its own paragraph"


@pytest.mark.parametrize("name", NAMES)
def test_tables_keep_their_cells(papers, name):
    paper, doc = papers[name]
    truth = [t for t in paper.body if isinstance(t, Table)]
    got = [b for b in doc.blocks if b.type == "table"]
    assert len(got) == len(truth)
    squash = lambda s: re.sub(r"[\s-]+", "", str(s)).lower()  # noqa: E731
    for t, b in zip(truth, got, strict=True):
        assert b.table is not None, "table fell back to an image"
        assert [squash(c) for c in b.table.rows[0]] == [squash(c) for c in t.header]
        want = [[squash(c) for c in r] for r in t.rows]
        have = [[squash(c) for c in r] for r in b.table.rows[1:]]
        assert have == want
        assert b.caption_id is not None


@pytest.mark.parametrize("name", NAMES)
def test_figures_citations_and_references(papers, name):
    paper, doc = papers[name]
    figs = [b for b in doc.blocks if b.type == "figure"]
    assert len(figs) == sum(isinstance(f, Figure) for f in paper.body)
    assert all(f.caption_id for f in figs)
    refs = [b for b in doc.blocks if b.type == "reference"]
    assert len(refs) == len(paper.references)
    marks = sum(len(re.findall(r"\[\d+(?:, \d+)*\]", b.text)) for b in doc.blocks if b.type == "paragraph")
    linked = sum(1 for b in doc.blocks if b.type == "paragraph" for s in b.spans if s.cite)
    assert marks > 5 and linked >= 0.9 * marks
