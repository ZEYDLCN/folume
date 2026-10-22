"""Optional OCR: a scanned PDF (no text layer) can be converted when the operator switches OCR on.

Tests that run the real engine need the `ocr` extra (rapidocr-onnxruntime) and are skipped without it. The others run
everywhere: with OCR off or the engine missing nothing changes, and a stand-in engine checks the wiring (geometry,
flags, grade, completeness) without recognising anything.
"""

from __future__ import annotations

import io
import re
import time
from collections import Counter

import pypdfium2 as pdfium
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from tests.ocr_child import hangs_on_a_page, reads_pages_slowly

from folume import jobs as jobs_module
from folume.config import Settings
from folume.main import create_app
from folume.model import Document
from folume.parsing import ocr as ocr_module
from folume.parsing import pipeline
from folume.parsing.ocr import (
    OCR_DPI,
    line_chars,
    ocr_available,
    ocr_pages,
    repair_line,
    steady_sizes,
)
from folume.parsing.pipeline import ParseError, ParseOptions, parse_pdf
from folume.parsing.raw import extract_pages
from folume.parsing.types import Char, RawPage

SCAN_PAGES = 2
READING_TYPES = {"title", "authors", "heading", "paragraph", "list_item", "caption", "footnote", "reference"}
RECALL_MIN = 0.90  # the default models read this paper at ~0.95 (word recall); the rest is margin for other builds


def image_pdf(images: list[Image.Image], dpi: float = OCR_DPI) -> bytes:
    """An image-only PDF: what a flatbed scanner produces (no text layer, one raster per page)."""
    buf = io.BytesIO()
    images[0].save(buf, format="PDF", save_all=True, append_images=images[1:], resolution=dpi)
    return buf.getvalue()


def words(text: str) -> list[str]:
    return re.findall(r"[^\W_]+", text.casefold())


def reading_words(doc: Document, pages: int) -> list[str]:
    return [w for b in doc.blocks if b.type in READING_TYPES and b.source[0].page <= pages for w in words(b.text)]


def letters_of(text: str) -> str:
    return "".join(c for c in text if c.isalnum())


def recall(truth: list[str], got: list[str]) -> float:
    have = Counter(got)
    return sum(min(n, have[w]) for w, n in Counter(truth).items()) / len(truth)


@pytest.fixture(scope="module")
def scan_pdf(corpus) -> bytes:
    """The first pages of the synthetic IEEE paper, photographed at 200 dpi and saved without their text."""
    src = pdfium.PdfDocument(str(corpus["ieee_ml"].pdf))
    pages = [src[i].render(scale=OCR_DPI / 72).to_pil().convert("L") for i in range(SCAN_PAGES)]
    return image_pdf(pages)


@pytest.fixture(scope="module")
def engine():
    if not ocr_available():  # not installed, or a native library it needs is missing
        pytest.skip("the OCR engine (the `ocr` extra) cannot be loaded here")


@pytest.fixture(scope="module")
def ocr_run(engine, scan_pdf):
    started = time.perf_counter()
    result = parse_pdf(scan_pdf, "scan.pdf", ParseOptions(ocr=True))
    return result.document, time.perf_counter() - started


# --------------------------------------------------------------------------- with the real engine


def test_a_scanned_pdf_is_converted_when_ocr_is_on(ocr_run):
    doc, seconds = ocr_run
    q = doc.quality
    assert q.grade != "unsupported" and doc.blocks and len(doc.pages) == SCAN_PAGES
    assert q.ocr is True
    assert not any(i.flag.code == "no_text_layer" for i in q.issues)
    print(f"\nOCR: {seconds:.1f} s for {SCAN_PAGES} pages = {seconds / SCAN_PAGES:.1f} s/page, "
          f"{len(doc.blocks)} blocks, grade {q.grade} score {q.score}")


def test_ocr_text_is_flagged_and_never_graded_good(ocr_run):
    doc, _ = ocr_run
    flags = [i.flag for i in doc.quality.issues if i.flag.code == "ocr_text"]
    assert len(flags) == 1 and flags[0].severity == "warning" and "OCR" in flags[0].message
    assert doc.quality.grade in ("fair", "poor") and doc.quality.score < 0.85


def test_completeness_of_ocr_text_says_where_the_text_came_from(ocr_run):
    doc, _ = ocr_run
    c = doc.quality.completeness
    assert c.source == "ocr" and c.letters_in_pdf > 1000
    # the audit compares the document with what the engine read: it cannot vouch for the engine
    assert c.missing + c.extra < 0.02 * c.letters_in_pdf


def test_ocr_recovers_most_words_of_the_original(corpus, ocr_run):
    doc, _ = ocr_run
    truth = reading_words(corpus["ieee_ml"].doc, SCAN_PAGES)
    got = reading_words(doc, SCAN_PAGES)
    r, precision = recall(truth, got), recall(got, truth)
    print(f"\nword recall {r:.3f}, word precision {precision:.3f} ({len(truth)} true words, {len(got)} read)")
    assert r >= RECALL_MIN


def test_ocr_keeps_the_document_structure(ocr_run):
    doc, _ = ocr_run
    types = Counter(b.type for b in doc.blocks)
    assert types["paragraph"] >= 5 and types["heading"] >= 2
    title = next((b for b in doc.blocks if b.type == "title"), None)
    assert title is not None and "Sparse Routing" in title.text
    # reading order: the first page's blocks come before the second page's
    pages = [b.source[0].page for b in doc.blocks]
    assert pages == sorted(pages)


def test_a_scanned_pdf_converts_through_an_api_job_when_ocr_is_on(engine, scan_pdf, tmp_path):
    """The conversion runs in its own process under the memory limit: the engine has to fit in it."""
    with TestClient(create_app(Settings(data_dir=tmp_path / "jobs", ocr=True))) as c:
        job = c.post("/v1/documents", files={"file": ("scan.pdf", scan_pdf, "application/pdf")}).json()
        end = time.time() + 300
        status = c.get(f"/v1/jobs/{job['id']}").json()
        while status["status"] not in ("done", "failed") and time.time() < end:
            time.sleep(0.2)
            status = c.get(f"/v1/jobs/{job['id']}").json()
        assert status["status"] == "done", status
        doc = Document.model_validate_json(c.get(f"/v1/jobs/{job['id']}/document").content)
        assert doc.quality.ocr and doc.blocks and doc.quality.completeness.source == "ocr"


def _timed_job(tmp_path, monkeypatch, child, timeout: float) -> tuple[dict, float]:
    monkeypatch.setattr(jobs_module, "_convert_in_child", child)
    with TestClient(create_app(Settings(data_dir=tmp_path / "jobs", workers=1, job_timeout_seconds=timeout))) as c:
        started = time.time()
        job = c.post("/v1/documents", files={"file": ("x.pdf", b"%PDF-1.4\n", "application/pdf")}).json()
        status = c.get(f"/v1/jobs/{job['id']}").json()
        while status["status"] not in ("done", "failed") and time.time() - started < 30:
            time.sleep(0.05)
            status = c.get(f"/v1/jobs/{job['id']}").json()
        return status, time.time() - started


def test_the_time_limit_of_a_scan_is_per_page(tmp_path, monkeypatch):
    """Five pages of 0.4 s each: two seconds in all, under a limit of one second per page."""
    status, took = _timed_job(tmp_path, monkeypatch, reads_pages_slowly, timeout=1.0)
    assert status["status"] == "done" and took > 1.0


def test_a_page_that_never_finishes_still_times_out(tmp_path, monkeypatch):
    status, took = _timed_job(tmp_path, monkeypatch, hangs_on_a_page, timeout=1.0)
    assert status["status"] == "failed" and status["error"]["code"] == "timeout" and took < 15


# --------------------------------------------------------------------------- nothing changes without OCR


def test_a_scanned_pdf_stays_unsupported_when_ocr_is_off(scanned_pdf):
    doc = parse_pdf(scanned_pdf.read_bytes(), "scan.pdf").document
    assert doc.quality.grade == "unsupported" and doc.blocks == []
    assert doc.quality.ocr is False and doc.quality.completeness.source == "text_layer"
    flag = next(i.flag for i in doc.quality.issues if i.flag.code == "no_text_layer")
    assert flag.severity == "error" and "OCR" in flag.message and "operator" in flag.message


def test_a_missing_engine_leaves_the_scanned_pdf_unsupported(scanned_pdf, monkeypatch):
    monkeypatch.setattr(pipeline, "ocr_available", lambda: False)
    doc = parse_pdf(scanned_pdf.read_bytes(), "scan.pdf", ParseOptions(ocr=True)).document
    assert doc.quality.grade == "unsupported" and doc.quality.ocr is False
    flag = next(i.flag for i in doc.quality.issues if i.flag.code == "no_text_layer")
    assert "not installed" in flag.message


def test_ocr_is_never_used_on_a_pdf_with_a_text_layer(corpus, monkeypatch):
    def boom(*a, **k):
        raise AssertionError("OCR must not run on a PDF that has text")

    monkeypatch.setattr(pipeline, "ocr_available", lambda: True)
    monkeypatch.setattr(pipeline, "ocr_pages", boom)
    doc = parse_pdf(corpus["ieee_ml"].pdf.read_bytes(), "p.pdf", ParseOptions(ocr=True, ocr_max_pages=1)).document
    assert doc.quality.ocr is False and doc.quality.completeness.source == "text_layer"
    assert doc.quality.grade != "unsupported" and not any(i.flag.code == "ocr_text" for i in doc.quality.issues)


def test_ocr_refuses_a_scan_with_too_many_pages(scanned_pdf, monkeypatch):
    monkeypatch.setattr(pipeline, "ocr_available", lambda: True)
    monkeypatch.setattr(pipeline, "ocr_pages", lambda *a, **k: pytest.fail("the page limit comes before any OCR"))
    with pytest.raises(ParseError) as e:
        parse_pdf(scanned_pdf.read_bytes(), "scan.pdf", ParseOptions(ocr=True, ocr_max_pages=1))
    assert e.value.code == "ocr_too_many_pages" and "1" in e.value.message


def test_capabilities_report_whether_ocr_can_run(tmp_path, monkeypatch):
    def caps(**kw) -> dict:
        with TestClient(create_app(Settings(data_dir=tmp_path / "jobs", **kw))) as c:
            return c.get("/v1/capabilities").json()

    monkeypatch.setattr("folume.routes.documents.ocr_available", lambda: True)
    assert caps()["ocr"] is False and caps()["parser"]["scanned_pdf_ocr"] is False
    on = caps(ocr=True, ocr_max_pages=12)
    assert on["ocr"] is True and on["parser"]["scanned_pdf_ocr"] is True and on["limits"]["ocr_max_pages"] == 12
    monkeypatch.setattr("folume.routes.documents.ocr_available", lambda: False)
    assert caps(ocr=True)["ocr"] is False  # switched on, but the engine is not installed


def test_ocr_settings_come_from_the_environment():
    assert Settings.from_env({}).ocr is False and Settings.from_env({}).ocr_max_pages == 60
    s = Settings.from_env({"FOLUME_OCR": "1", "FOLUME_OCR_MAX_PAGES": "25"})
    assert s.ocr is True and s.ocr_max_pages == 25


# --------------------------------------------------------------------------- the wiring, with a stand-in engine

PX = OCR_DPI / 72  # pixels per point of the 612 x 792 page images below
CANNED = [  # (text, x0, y0, height): a title and two paragraphs, as a text-line detector reports them
    ("A Study of Sparse Routing", 480, 200, 62),
    ("Recent progress in question answering has relied heavily on large models.", 150, 400, 30),
    ("We study how a small router can choose which expert reads each token and", 150, 432, 30),
    ("show that the choice is stable across seeds, datasets and model sizes.", 150, 464, 30),
    ("Our experiments cover translation, summarization and classification.", 190, 528, 30),
    ("The router is trained jointly with the experts and adds almost no cost.", 150, 560, 30),
    ("We release the code and the trained checkpoints for every experiment.", 150, 592, 30),
]


class StandInEngine:
    """Returns the canned lines for every page, the way RapidOCR does: [quad, text, score as a string]."""

    def __init__(self, lines=CANNED):
        self.lines = lines
        self.calls = 0

    def __call__(self, img):
        self.calls += 1
        out = []
        for text, x, y, h in self.lines:
            w = int(len(text) * h * 0.55)
            out.append([[[x, y], [x + w, y], [x + w, y + h], [x, y + h]], text, "0.93"])
        return out, [0.1, 0.0, 0.1]


@pytest.fixture()
def blank_scan() -> bytes:
    page = Image.new("L", (round(612 * PX), round(792 * PX)), 255)
    return image_pdf([page, page.copy()])


@pytest.fixture()
def stand_in(monkeypatch) -> StandInEngine:
    eng = StandInEngine()
    monkeypatch.setattr(ocr_module, "_engine", lambda: eng)
    monkeypatch.setattr(pipeline, "ocr_available", lambda: True)
    return eng


def test_ocr_pages_places_characters_in_pdf_points(blank_scan, stand_in):
    pages = ocr_pages(blank_scan)
    assert [p.number for p in pages] == [1, 2] and stand_in.calls == 2
    p = pages[0]
    assert (round(p.width), round(p.height)) == (612, 792)
    first = [c for c in p.chars if c.top < 300 / PX]  # the title line
    text = "".join(c.text for c in first)
    assert text == "AStudyofSparseRouting"  # spaces are gaps between characters, not characters
    c0, cn = first[0], first[-1]
    assert c0.x0 == pytest.approx(480 / PX, abs=0.5) and cn.x1 > c0.x0 + 100
    assert c0.top == pytest.approx(200 / PX, abs=0.5) and c0.bottom == pytest.approx(262 / PX, abs=0.5)
    assert c0.size == pytest.approx(0.8 * 62 / PX, abs=0.2)  # a share of the line box height, in points
    assert c0.top < c0.baseline <= c0.bottom and c0.font == "ocr" and c0.upright and not c0.math
    xs = [(c.x0, c.x1) for c in first]
    assert all(a[1] <= b[0] + 1e-6 for a, b in zip(xs, xs[1:], strict=False))  # left to right, no overlaps
    assert p.images == [] and p.rules == [] and p.graphics == []


def test_a_skewed_line_becomes_an_upright_box_of_the_right_height():
    quad = [[100, 100], [900, 112], [898, 142], [98, 130]]  # a line tilted by about 0.9 degrees, 30 px tall
    chars = line_chars(quad, "tilted line", 1, 0.36, 0.36)
    first, last = chars[0], chars[-1]
    assert (first.top, first.bottom) == (pytest.approx(106 * 0.36), pytest.approx(136 * 0.36))  # mean of the two edges
    assert (first.x0, last.x1) == (pytest.approx(99 * 0.36), pytest.approx(899 * 0.36))


def test_repair_line_restores_spaces_the_engine_drops_and_touches_no_letter():
    assert repair_line("II.RELATEDWORK") == "II. RELATED WORK"
    assert repair_line("III.METHOD") == "III. METHOD"
    assert repair_line("1.Introduction") == "1. Introduction"
    assert repair_line("EXPERIMENTALRESULTS") == "EXPERIMENTAL RESULTS"
    assert repair_line("AbstractWe study sparse routing") == "Abstract\u2014We study sparse routing"
    for same in ("A. Problem Setup", "3.5GHz processors are common", "Related work in routing", "Abstract Machines"):
        assert repair_line(same) == same
    for text in ("II.RELATEDWORK", "AbstractWe study", "1.Introduction"):
        assert letters_of(repair_line(text)) == letters_of(text)


def test_steady_sizes_removes_the_scatter_but_keeps_real_differences():
    def page(sizes: list[float]) -> RawPage:
        chars = [Char("a", i, i + 1, 0, 10, s, 8, "ocr") for i, s in enumerate(sizes)]
        return RawPage(1, 612, 792, chars)

    body = [8.4] * 30 + [8.8] * 25 + [9.4] * 20 + [8.1] * 10  # one body of text, boxes of different heights
    pages = [page(body + [14.0] * 5 + [13.4] * 3 + [6.5] * 4)]
    steady_sizes(pages)
    sizes = [c.size for c in pages[0].chars]
    assert set(sizes[: len(body)]) == {8.8}  # the weighted median of the body text
    assert set(sizes[len(body):]) == {14.0, 6.5}  # a heading stays bigger and a footnote smaller; each is steady


def test_a_stand_in_engine_goes_through_the_whole_pipeline(blank_scan, stand_in):
    result = parse_pdf(blank_scan, "scan.pdf", ParseOptions(ocr=True))
    doc = result.document
    q = doc.quality
    assert q.grade in ("fair", "poor") and q.ocr is True and q.completeness.source == "ocr"
    assert [i.flag.severity for i in q.issues if i.flag.code == "ocr_text"] == ["warning"]
    assert len(doc.pages) == 2 and "pages/p001.jpg" in result.assets  # the original pages stay viewable
    text = " ".join(b.text for b in doc.blocks)
    assert "Recent progress in question answering" in text and "checkpoints" in text
    para = next(b for b in doc.blocks if b.type == "paragraph")
    assert para.source[0].bbox[0] == pytest.approx(150 / PX, abs=2)  # source regions in PDF points
    assert q.completeness.complete  # nothing the engine read was lost on the way
    assert any("OCR" in n or "ocr" in n for pq in q.pages for n in pq.notes)


def test_progress_is_reported_per_page_and_never_goes_backwards(blank_scan, stand_in):
    seen: list[tuple[str, float]] = []
    parse_pdf(blank_scan, "scan.pdf", ParseOptions(ocr=True), lambda stage, f: seen.append((stage, f)))
    assert "ocr" in {s for s, _ in seen}
    fractions = [f for _, f in seen]
    assert fractions == sorted(fractions) and fractions[-1] == 1.0


def test_a_scan_the_engine_cannot_read_is_still_unsupported(blank_scan, monkeypatch):
    monkeypatch.setattr(ocr_module, "_engine", lambda: StandInEngine(lines=[]))
    monkeypatch.setattr(pipeline, "ocr_available", lambda: True)
    doc = parse_pdf(blank_scan, "scan.pdf", ParseOptions(ocr=True)).document
    assert doc.quality.grade == "unsupported" and doc.quality.ocr is False and doc.blocks == []
    assert any(i.flag.code == "no_text_layer" and "recognised no text" in i.flag.message for i in doc.quality.issues)


def test_an_engine_failure_is_reported_as_an_ocr_error(blank_scan, monkeypatch):
    def broken(img):
        raise RuntimeError("model exploded; page text must not leak")

    monkeypatch.setattr(ocr_module, "_engine", lambda: broken)
    monkeypatch.setattr(pipeline, "ocr_available", lambda: True)
    with pytest.raises(ParseError) as e:
        parse_pdf(blank_scan, "scan.pdf", ParseOptions(ocr=True))
    assert e.value.code == "ocr_failed" and "RuntimeError" in e.value.message and "leak" not in e.value.message


def test_the_engine_never_sees_a_page_larger_than_the_pixel_cap(monkeypatch):
    seen: list[tuple[int, int]] = []

    def eng(img):
        seen.append(img.shape[:2])
        return None, None

    monkeypatch.setattr(ocr_module, "_engine", lambda: eng)
    big = Image.new("L", (2000, 3000), 255)  # a poster: 2000 x 3000 points at 72 dpi
    pages = ocr_pages(image_pdf([big], dpi=72))
    assert max(seen[0]) <= ocr_module.MAX_SIDE_PX and pages[0].chars == []


def test_the_image_only_pdfs_of_these_tests_have_no_text_layer(blank_scan):
    pages, _ = extract_pages(blank_scan)
    assert len(pages) == 2 and sum(len(p.chars) for p in pages) == 0
