"""Parser behaviour against synthetic papers with known structure (see synth/ and evals/)."""

from __future__ import annotations

import io

import pytest
from evals.metrics import evaluate
from PIL import Image

from folume.model import Document
from folume.parsing.pipeline import ParseError, ParseOptions, parse_pdf
from folume.parsing.textutil import (
    Vocabulary,
    garbled_ratio,
    guess_language,
    has_garbled,
    join_hyphenated,
)

NAMES = ["ieee_ml", "acm_graph", "arxiv_bio", "ieee_math", "ml_companion"]


@pytest.mark.parametrize("name", NAMES)
def test_quality_against_ground_truth(corpus, name):
    p = corpus[name]
    m = evaluate(p.doc, p.truth)
    assert m["text_recall"] >= 0.995, m
    assert m["text_precision"] >= 0.995, m
    assert m["reading_order"] >= 0.99, m
    assert m["source_overlap_mean"] >= 0.95 and m["source_page_accuracy"] == 1.0, m
    assert all(v == 1.0 for v in m["type_recall"].values()), m
    assert m["heading_number_level_accuracy"] >= 0.95, m
    assert m["citation_recall"] >= 0.98 and m["citation_precision"] >= 0.98, m
    assert m["table_cell_accuracy"] >= 0.98, m
    assert m["furniture_excluded"], m


@pytest.mark.parametrize("name", NAMES)
def test_ledger_accounts_for_every_character(corpus, name):
    """README: 'sessizce içerik atlamaz' — every character of the text layer is placed or listed."""
    led = corpus[name].doc.quality.ledger
    assert led.unaccounted == 0 and led.coverage == 1.0
    assert led.total_chars == led.in_blocks + led.in_figures + led.in_tables + led.omitted


@pytest.mark.parametrize("name", NAMES)
def test_document_roundtrips_through_the_schema(corpus, name):
    doc = corpus[name].doc
    again = Document.model_validate_json(doc.model_dump_json())
    assert again == doc


@pytest.mark.parametrize("name", NAMES)
def test_every_block_has_a_source_inside_its_page(corpus, name):
    doc = corpus[name].doc
    pages = {p.number: p for p in doc.pages}
    assert doc.blocks
    for b in doc.blocks:
        assert b.source, b.id
        for s in b.source:
            page = pages[s.page]
            x0, top, x1, bottom = s.bbox
            assert -1 <= x0 < x1 <= page.width + 1 and -1 <= top < bottom <= page.height + 1, (b.id, s)


@pytest.mark.parametrize("name", NAMES)
def test_assets_exist_and_match_their_declared_size(corpus, name):
    res = corpus[name].result
    for p in res.document.pages:
        img = Image.open(io.BytesIO(res.assets[p.image]))
        assert (img.width, img.height) == (p.image_width, p.image_height)
        assert abs(p.image_width / p.width - res.document.image_scale) < 0.01
    for b in res.document.blocks:
        if b.asset:
            img = Image.open(io.BytesIO(res.assets[b.asset.path]))
            assert (img.width, img.height) == (b.asset.width, b.asset.height)
            if b.type == "equation":
                assert b.asset.transparent and img.mode == "RGBA"


def test_scanned_pdf_is_declared_unsupported_instead_of_silently_empty(scanned_pdf):
    doc = parse_pdf(scanned_pdf.read_bytes(), "scan.pdf").document
    assert doc.quality.grade == "unsupported"
    assert any(i.flag.code == "no_text_layer" and i.flag.severity == "error" for i in doc.quality.issues)
    assert doc.blocks == [] and len(doc.pages) == 2  # pages are still viewable in the original view


def test_rejects_non_pdf_and_enforces_page_limit(corpus):
    with pytest.raises(ParseError) as e:
        parse_pdf(b"hello world")
    assert e.value.code == "not_a_pdf"
    with pytest.raises(ParseError) as e:
        parse_pdf(b"%PDF-1.4\nthis is not really a pdf")
    assert e.value.code == "unreadable_pdf"
    with pytest.raises(ParseError) as e:
        parse_pdf(corpus["ieee_ml"].pdf.read_bytes(), options=ParseOptions(max_pages=2))
    assert e.value.code == "too_many_pages"


def test_running_headers_and_page_numbers_are_listed_not_silently_dropped(corpus):
    q = corpus["arxiv_bio"].doc.quality
    reasons = {o.reason for o in q.omitted}
    assert {"running_header", "page_number", "rotated_text"} <= reasons
    assert any("arXiv" in o.preview for o in q.omitted if o.reason == "rotated_text")
    assert not any(i.flag.severity == "warning" and i.flag.code == "rotated_text_skipped" for i in q.issues)


def test_alternating_headers_of_short_documents_are_detected(corpus):
    q = corpus["acm_graph"].doc.quality
    previews = [o.preview for o in q.omitted if o.reason == "running_header"]
    assert len(previews) == 2  # pages 2 and 3 (page 1 has none), different text each


def test_page_layouts(corpus):
    ieee = {p.page: p.layout for p in corpus["ieee_ml"].doc.quality.pages}
    assert set(ieee.values()) == {"two_column"}
    arxiv = {p.page: p.layout for p in corpus["arxiv_bio"].doc.quality.pages}
    assert set(arxiv.values()) == {"single_column"}


def test_paragraphs_continue_across_columns_and_pages(corpus):
    doc = corpus["acm_graph"].doc
    spanning = [b for b in doc.blocks if b.type == "paragraph" and len({(s.page, round(s.bbox[0] / 100)) for s in b.source}) > 1]
    assert len(spanning) >= 3
    # a merged paragraph never ends in a dangling hyphen and has no doubled spaces
    for b in spanning:
        assert not b.text.endswith("-") and "  " not in b.text


def test_hyphenation_is_repaired_without_breaking_real_compounds(corpus):
    text = " ".join(b.text for b in corpus["ieee_ml"].doc.blocks if b.type == "paragraph")
    assert "re- quires" not in text and "re-quires" not in text
    assert "feed-forward" in text  # a real hyphen at a line end must survive


def test_join_hyphenated_unit():
    vocab = Vocabulary()
    for line in ["a self-supervised method", "the feed-forward layer", "a state-of-the-art system"]:
        vocab.add_line(line)
    assert join_hyphenated("repre-", "sentation of", vocab) == ("repre", True)
    assert join_hyphenated("a feed-", "forward layer", vocab) == ("a feed-", True)
    assert join_hyphenated("a state-of-", "the-art system", vocab) == ("a state-of-", True)
    assert join_hyphenated("self-su-", "pervised", vocab) == ("self-su", True)
    assert join_hyphenated("the x-", "axis", None) == ("the x-", True)
    assert join_hyphenated("ends here.", "Next", vocab) == ("ends here. ", False)
    assert join_hyphenated("Cauchy-", "Schwarz bound", vocab) == ("Cauchy-", True)


def test_numeric_citations_link_to_reference_blocks(corpus):
    doc = corpus["ieee_ml"].doc
    refs = {b.id: b for b in doc.blocks if b.type == "reference"}
    cited = [(s, b) for b in doc.blocks for s in b.spans if s.cite]
    assert len(refs) == 14 and len(cited) > 10
    for span, _ in cited:
        assert all(c in refs for c in span.cite)
    s, _ = cited[0]
    assert s.text.startswith("[") and refs[s.cite[0]].number == f"[{int(s.text.strip('[]').split(',')[0])}]"


def test_author_year_citations_link_to_reference_blocks(corpus):
    doc = corpus["acm_graph"].doc
    refs = {b.id: b for b in doc.blocks if b.type == "reference"}
    linked = [s for b in doc.blocks for s in b.spans if s.cite]
    assert len(linked) >= 8
    for s in linked:
        first = refs[s.cite[0]].reference
        assert first.first_author and first.first_author in s.text and str(first.year) in s.text


def test_captions_and_floats_are_linked_both_ways(corpus):
    for name in NAMES:
        by_id = {b.id: b for b in corpus[name].doc.blocks}
        for b in by_id.values():
            if b.type == "caption":
                assert b.caption_for and by_id[b.caption_for].caption_id == b.id
                assert by_id[b.caption_for].type == ("table" if b.number.lower().startswith("tab") else "figure")


def test_equations_keep_number_image_and_an_honest_flag(corpus):
    eqs = [b for b in corpus["ieee_math"].doc.blocks if b.type == "equation"]
    assert len(eqs) == 5
    assert [e.number for e in eqs] == ["(1)", "(2)", "(3)", "(4)", "(5)"]
    for e in eqs:
        assert e.asset and e.asset.kind == "equation"
        assert any(f.code == "formula_image_only" for f in e.flags)
    assert any("^" in e.text or "_" in e.text for e in eqs)  # sub/superscripts survive in the approximation
    for e in eqs:  # the number is rendered beside the picture, so the picture must not contain it
        assert e.asset.bbox[2] < e.source[0].bbox[2] - 8, (e.id, e.asset.bbox, e.source[0].bbox)


def test_tables_recover_cells_when_reliable_and_fall_back_to_image(corpus):
    doc = corpus["ieee_ml"].doc
    tab = next(b for b in doc.blocks if b.type == "table")
    assert tab.table and tab.table.header_rows == 1 and len(tab.table.rows[0]) == 4
    assert tab.table.rows[0][0] == "Model" and tab.asset
    cap = next(b for b in doc.blocks if b.id == tab.caption_id)
    assert cap.text.upper().startswith("TABLE I")


def test_footnotes_are_separate_blocks_with_their_marker(corpus):
    doc = corpus["acm_graph"].doc
    notes = [b for b in doc.blocks if b.type == "footnote"]
    assert len(notes) == 2 and [n.number for n in notes] == ["1", "2"]
    body = " ".join(b.text for b in doc.blocks if b.type == "paragraph")
    assert not any(n.text[:30] in body for n in notes)


def test_inline_subscripts_written_with_text_rise_are_detected(corpus):
    """reportlab writes <sub> with the text-rise operator, which only the glyph box reveals."""
    spans = [s for b in corpus["ieee_ml"].doc.blocks if b.type == "paragraph" for s in b.spans]
    subs = [s for s in spans if s.sub and s.math]
    assert subs, "no math subscripts found"
    text = " ".join(b.text for b in corpus["ieee_ml"].doc.blocks if b.type == "paragraph")
    assert "x_i denote" in text and "O(n^2)" in text


def test_body_font_size_is_reported(corpus):
    assert corpus["ieee_ml"].doc.body_font_size == 10.0
    assert corpus["arxiv_bio"].doc.body_font_size == 11.0


def test_metadata(corpus):
    md = corpus["ieee_ml"].doc.metadata
    assert md.title == "Sparse Routing for Efficient Transformers"
    assert md.authors == ["Quinn Rossi", "Quinn Larsen", "Deniz Cohen"]
    assert md.abstract and md.abstract.startswith("We study")
    assert "expert gating" in md.keywords and md.language == "en"
    assert corpus["arxiv_bio"].doc.metadata.arxiv_id == "2403.01234"
    assert corpus["arxiv_bio"].doc.metadata.year == 2024


def test_sections_form_a_consistent_outline(corpus):
    doc = corpus["ieee_ml"].doc
    kinds = [s.kind for s in doc.sections]
    assert kinds[0] == "abstract" and kinds[-1] == "references"
    ids = {s.id for s in doc.sections}
    for s in doc.sections:
        assert s.parent_id is None or s.parent_id in ids
    block_ids = {b.id for b in doc.blocks}
    assert all(b.section_id in ids for b in doc.blocks if b.section_id) and all(
        s.block_id in block_ids for s in doc.sections if s.block_id)


def test_code_blocks_keep_their_lines(corpus):
    code = next(b for b in corpus["arxiv_bio"].doc.blocks if b.type == "code")
    assert code.text.splitlines()[0].startswith("for step in range") and len(code.text.splitlines()) == 5
    assert code.spans[0].mono


def test_parsing_is_deterministic(corpus):
    p = corpus["ieee_ml"]
    again = parse_pdf(p.pdf.read_bytes(), p.pdf.name).document
    a, b = p.doc.model_dump(), again.model_dump()
    a["parser"] = b["parser"] = None
    assert a == b
    assert p.doc.id == again.id


def test_a_failing_page_degrades_to_plain_text_with_a_warning(corpus, monkeypatch):
    import folume.parsing.pipeline as pipeline

    def boom(*args, **kwargs):
        raise RuntimeError("synthetic failure")

    monkeypatch.setattr(pipeline, "detect_equations", boom)
    p = corpus["ieee_ml"]
    doc = parse_pdf(p.pdf.read_bytes(), p.pdf.name).document
    assert doc.quality.ledger.coverage == 1.0 and doc.blocks
    assert any(i.flag.code == "reading_order_uncertain" for i in doc.quality.issues)


def test_garbled_text_detection():
    assert has_garbled("see (cid:123) here") and has_garbled("bad � char")
    assert not has_garbled("perfectly fine text") and garbled_ratio("(cid:1)(cid:2)") > 0.9


def test_language_guess():
    en = "the results of the method we propose are better than the baseline and we can show that it is " * 4
    tr = "bu çalışmada önerilen yöntem ile elde edilen sonuçlar bir önceki çalışma için daha iyi ve " * 4
    assert guess_language(en) == "en" and guess_language(tr) == "tr" and guess_language("short") is None
