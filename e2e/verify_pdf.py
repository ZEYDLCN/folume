"""Opens the annotated PDF the app exported with tools that share no code with it (pdfium, poppler) and checks it.

    verify_pdf.py <annotated.pdf> <marks.json> <document.json>

marks.json describes what the reader marked: {"highlight": {blockId, start, end, note}, "ink": {page, color, width, points}}.
It checks that the file opens without complaint, has the paper's pages and size, bookmarks for its sections, a highlight
annotation whose note reads back letter for letter, a pencil annotation, and, by drawing the pages with and without their
annotations, that the marks land where the reader put them: the highlight inside the box of the block it was made in,
and the pencil stroke along the path that was drawn.
"""

from __future__ import annotations

import ctypes
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
import pypdfium2 as pdfium
import pypdfium2.raw as raw

SCALE = 2
SUBTYPES = {1: "Text", 9: "Highlight", 15: "Ink"}


def annotations(page: pdfium.PdfPage) -> list[tuple[str, str]]:
    found = []
    for i in range(raw.FPDFPage_GetAnnotCount(page.raw)):
        annot = raw.FPDFPage_GetAnnot(page.raw, i)
        try:
            kind = SUBTYPES.get(raw.FPDFAnnot_GetSubtype(annot), str(raw.FPDFAnnot_GetSubtype(annot)))
            need = raw.FPDFAnnot_GetStringValue(annot, b"Contents", None, 0)
            text = ""
            if need > 2:
                buf = (ctypes.c_ushort * (need // 2))()
                raw.FPDFAnnot_GetStringValue(annot, b"Contents", ctypes.cast(buf, ctypes.POINTER(raw.FPDF_WCHAR)), need)
                text = bytes(buf)[: need - 2].decode("utf-16le")
            found.append((kind, text))
        finally:
            raw.FPDFPage_CloseAnnot(annot)
    return found


def changed(page: pdfium.PdfPage) -> tuple[np.ndarray, np.ndarray]:
    """The pixels annotations change on a page, and the colours they changed them to."""
    with_marks = page.render(scale=SCALE, draw_annots=True).to_numpy()
    without = page.render(scale=SCALE, draw_annots=False).to_numpy()
    mask = np.any(with_marks != without, axis=2)
    return mask, with_marks


def box(mask: np.ndarray) -> tuple[float, float, float, float]:
    ys, xs = np.nonzero(mask)
    return xs.min() / SCALE, ys.min() / SCALE, (xs.max() + 1) / SCALE, (ys.max() + 1) / SCALE


def main() -> int:
    pdf_path, marks_path, doc_path = (Path(a) for a in sys.argv[1:4])
    marks = json.loads(marks_path.read_text())
    doc = json.loads(doc_path.read_text())
    problems: list[str] = []

    # poppler reads it without a single complaint
    info = subprocess.run(["pdfinfo", str(pdf_path)], capture_output=True, text=True)
    if info.returncode != 0 or info.stderr.strip():
        problems.append(f"pdfinfo: {info.stderr.strip() or info.returncode}")
    render = subprocess.run(["pdftoppm", "-r", "30", "-png", str(pdf_path), "/tmp/folume-verify-pdf"], capture_output=True, text=True)
    if render.returncode != 0 or render.stderr.strip():
        problems.append(f"pdftoppm: {render.stderr.strip()[:200]}")
    if not re.search(rf"^Pages:\s+{len(doc['pages'])}$", info.stdout, re.M):
        problems.append(f"pdfinfo pages: {info.stdout}")

    pdf = pdfium.PdfDocument(str(pdf_path))
    if len(pdf) != len(doc["pages"]):
        problems.append(f"{len(pdf)} pages, expected {len(doc['pages'])}")
    for i, spec in enumerate(doc["pages"]):
        w, h = pdf[i].get_size()
        if abs(w - spec["width"]) > 0.01 or abs(h - spec["height"]) > 0.01:
            problems.append(f"page {i + 1} is {w}x{h}, expected {spec['width']}x{spec['height']}")

    toc = [(item.get_title(), item.get_dest().get_index() + 1) for item in pdf.get_toc()]
    want = [(s["title"], s["start_page"]) for s in doc["sections"] if s["title"].strip()]
    if toc != want:
        problems.append(f"bookmarks differ:\n        got  {toc}\n        want {want}")

    # the highlight
    hl = marks["highlight"]
    block = next(b for b in doc["blocks"] if b["id"] == hl["blockId"])
    region = block["source"][0]
    page_no = region["page"]
    found = annotations(pdf[page_no - 1])
    kinds = [k for k, _ in found]
    if kinds.count("Highlight") != 1:
        problems.append(f"page {page_no} annotations: {kinds}")
    notes = [t for k, t in found if k == "Highlight"]
    if not notes or hl["note"] not in notes[0]:
        problems.append(f"note did not read back: {notes!r} (wanted {hl['note']!r})")
    mask, shown = changed(pdf[page_no - 1])
    if not mask.any():
        problems.append("the highlight changes no pixel of the page")
    else:
        x0, y0, x1, y1 = box(mask)
        bx0, by0, bx1, by1 = region["bbox"]
        slack = 2.5
        if x0 < bx0 - slack or x1 > bx1 + slack or y0 < by0 - slack or y1 > by1 + slack:
            problems.append(f"highlight {x0:.1f},{y0:.1f},{x1:.1f},{y1:.1f} leaves its block {region['bbox']}")
        share = (hl["end"] - hl["start"]) / max(1, len(block["text"]))
        height = by1 - by0
        if hl["start"] == 0 and abs(y0 - by0) > 14:
            problems.append(f"the highlight starts {y0 - by0:.1f}pt below the top of the block it began at")
        # the converter keeps one box per block, so the place is right to within a line (about 16pt)
        if not (share * height * 0.4 <= y1 - y0 + 16 and y1 - y0 <= max(16.0, (share * 2.2 + 0.2) * height)):
            problems.append(f"the highlight is {y1 - y0:.0f}pt tall in a block {height:.0f}pt tall, for {share:.0%} of its text")
        pix = shown[mask]
        b, g, r = pix[:, 0].mean(), pix[:, 1].mean(), pix[:, 2].mean()
        if not (r > 200 and g > 180 and b < r - 20):
            problems.append(f"the highlight is not yellow: rgb({r:.0f},{g:.0f},{b:.0f})")

    # the pencil
    ink = marks["ink"]
    page = pdf[ink["page"] - 1]
    kinds = [k for k, _ in annotations(page)]
    if "Ink" not in kinds:
        problems.append(f"page {ink['page']} annotations: {kinds}")
    mask, shown = changed(page)
    if not mask.any():
        problems.append("the pencil changes no pixel of the page")
    else:
        w, h = page.get_size()
        xs = [p[0] * w for p in ink["points"]]
        ys = [p[1] * h for p in ink["points"]]
        pad = ink["width"] * w / 2 + 2
        x0, y0, x1, y1 = box(mask)
        if abs(x0 - min(xs)) > pad or abs(x1 - max(xs)) > pad or abs(y0 - min(ys)) > pad or abs(y1 - max(ys)) > pad:
            problems.append(f"pencil {x0:.1f},{y0:.1f},{x1:.1f},{y1:.1f} is not along {min(xs):.1f},{min(ys):.1f},{max(xs):.1f},{max(ys):.1f}")
        want_rgb = tuple(int(ink["color"][i : i + 2], 16) for i in (1, 3, 5))
        pix = shown[mask]
        got = (pix[:, 2].mean(), pix[:, 1].mean(), pix[:, 0].mean())
        if max(abs(a - b) for a, b in zip(got, want_rgb)) > 45:
            problems.append(f"pencil colour rgb{tuple(round(c) for c in got)}, wanted {want_rgb}")

    print(("ok  " if not problems else "FAIL") + f" {pdf_path.name}: {len(pdf)} pages, {len(toc)} bookmarks, highlight and pencil drawn where they were made")
    for p in problems:
        print("      " + p)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
