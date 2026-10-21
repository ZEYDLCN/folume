"""Damaged, hostile and degenerate PDFs must end in a clear error or an honest document, never in a crash."""

from __future__ import annotations

import io
import random

import pytest
from reportlab.pdfgen import canvas

from folume.parsing.pipeline import ParseError, parse_pdf


def outcome(data: bytes):
    """Either a Document or a ParseError; anything else escaping the pipeline is a bug."""
    try:
        return parse_pdf(data, "x.pdf").document
    except ParseError as exc:
        return exc


@pytest.fixture(scope="module")
def paper(corpus):
    return corpus["ieee_ml"].pdf.read_bytes()


def test_truncated_files_fail_cleanly(paper):
    for frac in (0.02, 0.1, 0.33, 0.6, 0.9, 0.99):
        res = outcome(paper[: int(len(paper) * frac)])
        assert isinstance(res, ParseError) or res.blocks is not None


def test_corrupted_bytes_never_crash_the_parser(paper):
    rng = random.Random(1234)
    for _ in range(25):
        data = bytearray(paper)
        for _ in range(rng.choice([3, 20, 120])):
            data[rng.randrange(200, len(data))] = rng.randrange(256)
        res = outcome(bytes(data))
        assert isinstance(res, ParseError) or res.pages


def test_garbage_and_empty_input():
    for data in (b"", b"%PDF-1.7\n", b"%PDF-1.4\n" + bytes(range(256)) * 40, b"not a pdf at all"):
        assert isinstance(outcome(data), ParseError)


def test_password_protected_pdf_is_reported():
    buf = io.BytesIO()
    c = canvas.Canvas(buf, encrypt="secret")
    c.drawString(72, 700, "confidential " * 20)
    c.save()
    res = outcome(buf.getvalue())
    assert isinstance(res, ParseError)


def test_a_blank_pdf_is_flagged_not_silently_empty():
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.showPage()
    c.save()
    res = outcome(buf.getvalue())
    assert isinstance(res, ParseError) or res.quality.grade == "unsupported"


def test_odd_text_does_not_break_layout():
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(300, 300))
    c.setFont("Helvetica", 0.6)  # below the text-size floor
    c.drawString(10, 10, "tiny " * 50)
    c.setFont("Helvetica", 9)
    for i, text in enumerate(["\u0000\u0001 control", "a" * 400, "ﬁﬂ ligatures", "عربى 日本語 한국어", ""]):
        c.drawString(20, 280 - 14 * i, text)
    c.save()
    res = outcome(buf.getvalue())
    assert isinstance(res, ParseError) or res.quality.ledger.coverage >= 0.0


def test_many_tiny_pages_stay_within_limits():
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(200, 200))
    for i in range(40):
        c.drawString(10, 100, f"Page {i} body text for the converter to read.")
        c.showPage()
    c.save()
    res = outcome(buf.getvalue())
    assert not isinstance(res, ParseError) and len(res.pages) == 40
