"""The conversion must not lose a single letter or digit of the PDF's text layer.

Three checks, from cheap to independent:
  * the converter audits itself (`quality.completeness`) and its accounting must add up;
  * the text of the finished document is compared with what a *different* PDF engine (pdfium) reads from the file;
  * a damaged result is detected: removing text from a document makes the audit report it.
"""

from __future__ import annotations

import re
from collections import Counter

import pypdfium2 as pdfium
import pytest
from synth.docx_paper import generate as lo_generate
from synth.docx_paper import soffice_available
from synth.html_paper import available as chrome_available
from synth.html_paper import generate as chrome_generate

from folume.parsing.audit import document_letters, document_text, letters
from folume.parsing.pipeline import parse_pdf

SYNTH = ["ieee_ml", "acm_graph", "arxiv_bio", "ieee_math", "ml_companion"]
PRODUCERS = ["ieee_ml", "acm_graph", "arxiv_bio"]


def pdfium_letters(data: bytes) -> Counter:
    """Letters and digits as read by pdfium, an engine that shares no code with the converter."""
    out: Counter = Counter()
    pdf = pdfium.PdfDocument(data)
    for i in range(len(pdf)):
        text = pdf[i].get_textpage().get_text_range()
        out += letters(text)
    pdf.close()
    return out


@pytest.fixture(scope="module")
def producer_docs(tmp_path_factory):
    """Documents from LibreOffice and Chromium, when those tools exist."""
    out = {}
    d = tmp_path_factory.mktemp("complete")
    if soffice_available():
        for n in PRODUCERS:
            pdf, _ = lo_generate(n, d)
            out[f"lo:{n}"] = (pdf.read_bytes(), parse_pdf(pdf.read_bytes(), pdf.name).document)
    if chrome_available():
        for n in PRODUCERS:
            pdf, _ = chrome_generate(n, d)
            out[f"chrome:{n}"] = (pdf.read_bytes(), parse_pdf(pdf.read_bytes(), pdf.name).document)
    return out


# --------------------------------------------------------------------------------------------- the unit of count


def test_letters_ignores_layout_and_punctuation_but_keeps_every_letter_and_digit():
    assert letters("ﬁnd-\nings, 10%") == Counter("findings10")  # ligature, hyphen, newline, punctuation
    assert letters("x² + µ") == Counter({"x": 1, "2": 1, "μ": 1})  # compatibility forms fold the same way on both sides
    assert letters("AaA")["A"] == 2 and letters("AaA")["a"] == 1  # case is kept: a capital is not a lower-case letter
    assert letters("") == Counter()


# ------------------------------------------------------------------------------------------ the converter's audit


@pytest.mark.parametrize("name", SYNTH)
def test_audit_finds_every_letter_of_the_synthetic_papers(corpus, name):
    c = corpus[name].doc.quality.completeness
    assert c.complete, c.problems
    assert c.missing == 0 and c.extra == 0 and c.problems == []
    assert c.letters_in_pdf > 5000


@pytest.mark.parametrize("name", SYNTH)
def test_audit_accounting_adds_up(corpus, name):
    c = corpus[name].doc.quality.completeness
    parts = c.in_text + c.in_equations + c.in_tables + c.in_figures + c.omitted + c.duplicates + c.hidden + c.recovered
    assert parts == c.letters_in_pdf
    assert c.in_text > 0.7 * c.letters_in_pdf


def test_audit_holds_for_papers_typeset_by_other_producers(producer_docs):
    if not producer_docs:
        pytest.skip("neither LibreOffice nor Chromium is available")
    for name, (_, doc) in producer_docs.items():
        c = doc.quality.completeness
        assert c.complete and c.missing == 0 and c.extra == 0, (name, c.problems[:3])


def test_a_scanned_pdf_is_not_called_complete(scanned_pdf):
    doc = parse_pdf(scanned_pdf.read_bytes(), "s.pdf").document
    assert not doc.quality.completeness.complete
    assert doc.quality.completeness.letters_in_pdf == 0 or doc.quality.grade == "unsupported"


# ------------------------------------------------------------- an independent engine reads the same letters


@pytest.mark.parametrize("name", SYNTH)
def test_a_different_pdf_engine_finds_no_letter_the_document_lacks(corpus, name):
    ref = pdfium_letters(corpus[name].pdf.read_bytes())
    got = document_letters(corpus[name].doc)
    missing = ref - got
    # pdfium also reads overprinted duplicates; those are counted by the audit, not lost
    assert sum(missing.values()) <= corpus[name].doc.quality.completeness.duplicates, dict(missing.most_common(10))
    assert sum((got - ref).values()) <= 0.002 * sum(ref.values())


def test_a_different_pdf_engine_agrees_for_other_producers(producer_docs):
    if not producer_docs:
        pytest.skip("neither LibreOffice nor Chromium is available")
    for name, (data, doc) in producer_docs.items():
        ref = pdfium_letters(data)
        got = document_letters(doc)
        missing = sum((ref - got).values())
        assert missing <= doc.quality.completeness.duplicates + 0.002 * sum(ref.values()), (name, (ref - got).most_common(8))


# ----------------------------------------------------------- the pieces the reader can show for everything else


@pytest.mark.parametrize("name", SYNTH)
def test_text_inside_figures_tables_and_omitted_regions_is_kept(corpus, name):
    doc = corpus[name].doc
    for b in doc.blocks:
        if b.type == "figure" and "figure_text_folded" in {f.code for f in b.flags}:
            assert b.inner_text and b.inner_text.strip(), b.id
        if b.type == "table":
            assert b.inner_text and b.inner_text.strip(), b.id
    assert doc.quality.omitted
    assert all(o.text.strip() for o in doc.quality.omitted)


@pytest.mark.parametrize("name", SYNTH)
def test_table_cells_hold_exactly_the_letters_of_the_table(corpus, name):
    for b in corpus[name].doc.blocks:
        if b.type == "table" and b.table is not None:
            cells = Counter()
            for row in b.table.rows:
                for cell in row:
                    cells += letters(cell)
            assert cells == letters(b.inner_text or ""), b.id


def test_removed_text_strips_the_prefix_but_not_the_letters(corpus):
    doc = corpus["ieee_ml"].doc
    headings = [b for b in doc.blocks if b.type == "heading" and b.number]
    assert headings and all(b.prefix and b.number.strip() in b.prefix for b in headings)
    refs = [b for b in doc.blocks if b.type == "reference"]
    assert refs and all(b.prefix for b in refs)
    # the prefix really is the heading number: its digits or numerals are in it
    assert all(letters(b.number) <= letters(b.prefix) for b in headings)


def test_a_list_marker_is_kept_out_of_the_item_text_but_not_lost(corpus):
    """The reader draws the marker itself, so the text must not start with it a second time."""
    items = [b for b in corpus["ieee_ml"].doc.blocks if b.type == "list_item"]
    assert items
    for b in items:
        assert b.number and b.prefix == b.number, (b.id, b.number, b.prefix)
        assert not b.text.startswith(b.number) and b.text.strip(), b.text[:30]
        assert b.spans and "".join(s.text for s in b.spans) == b.text.replace("_", "").replace("^", "")


# ------------------------------------------------------------------------------- damage is detected, not hidden


def test_the_audit_reports_a_block_that_was_lost(corpus):
    from folume.parsing.audit import audit_document

    doc = corpus["ieee_ml"].doc.model_copy(deep=True)
    victim = next(b for b in doc.blocks if b.type == "paragraph" and len(b.text) > 200)
    victim.text = victim.text[: len(victim.text) // 2]
    result = audit_document(corpus["ieee_ml"].pdf.read_bytes(), doc)
    assert not result.complete
    assert result.missing >= 50
    assert result.problems and result.problems[0].page >= 1


def test_the_audit_reports_extra_text_too(corpus):
    from folume.parsing.audit import audit_document

    doc = corpus["ieee_ml"].doc.model_copy(deep=True)
    next(b for b in doc.blocks if b.type == "paragraph").text += " invented sentence"
    result = audit_document(corpus["ieee_ml"].pdf.read_bytes(), doc)
    assert not result.complete and result.extra >= 15


# --------------------------------------------- characters the layout engine could not place are put back, flagged


def test_unplaced_characters_are_recovered_in_a_flagged_block(corpus, monkeypatch):
    """If a line is dropped on its way to a block, its characters come back as text instead of vanishing."""
    from folume.parsing import structure

    original = structure.Builder.run
    dropped = {}

    def lossy(self):
        flow = original(self)
        for b in flow:
            if b.type == "paragraph" and len(b.lines) >= 3 and "line" not in dropped:
                dropped["line"] = b.lines.pop(1)  # a whole line goes missing
        return flow

    monkeypatch.setattr(structure.Builder, "run", lossy)
    doc = parse_pdf(corpus["ieee_ml"].pdf.read_bytes(), "x.pdf").document
    c = doc.quality.completeness
    assert c.recovered > 20 and c.complete and c.missing == 0
    recovered = [b for b in doc.blocks if any(f.code == "text_recovered" for f in b.flags)]
    assert recovered and all(b.type == "paragraph" for b in recovered)
    lost_letters = letters(dropped["line"].plain)
    assert lost_letters - letters(" ".join(b.text for b in recovered)) == Counter()


# --------------------------------------------------------------------------------------- the shape of the result


@pytest.mark.parametrize("name", ["ieee_ml"])
def test_document_text_composes_prefix_text_and_inner_text(corpus, name):
    doc = corpus[name].doc
    text = document_text(doc)
    assert doc.metadata.title in text
    first_figure = next(b for b in doc.blocks if b.type == "figure" and b.inner_text)
    assert first_figure.inner_text.split()[0] in text
    assert re.search(r"\bINTRODUCTION\b", text)
    # a round trip through the public JSON keeps the audit
    again = type(doc).model_validate_json(doc.model_dump_json())
    assert again.quality.completeness == doc.quality.completeness
