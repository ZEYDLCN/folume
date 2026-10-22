"""Developer tool: parse a PDF, print the blocks and write page overlays showing block regions.

    python -m folume.tools.inspect_pdf paper.pdf out_dir [--text] [--ocr]

`--ocr` reads a scanned PDF (no text layer) with OCR; it needs the `ocr` extra.
"""

from __future__ import annotations

import io
import sys
from pathlib import Path

from PIL import Image, ImageDraw

from folume.parsing.pipeline import ParseOptions, parse_pdf

COLORS = {
    "title": "#d81b60", "authors": "#8e24aa", "heading": "#e53935", "paragraph": "#1e88e5", "list_item": "#00897b",
    "figure": "#fb8c00", "table": "#6d4c41", "equation": "#43a047", "caption": "#fdd835", "footnote": "#757575",
    "reference": "#3949ab", "code": "#546e7a",
}


def main(argv: list[str]) -> int:
    pdf = Path(argv[1])
    out = Path(argv[2])
    show_text = "--text" in argv
    out.mkdir(parents=True, exist_ok=True)
    res = parse_pdf(pdf.read_bytes(), pdf.name, ParseOptions(ocr="--ocr" in argv))
    doc = res.document
    q = doc.quality
    print(f"{pdf.name}: {len(doc.blocks)} blocks, {len(doc.sections)} sections, grade={q.grade} score={q.score} "
          f"coverage={q.ledger.coverage} ledger={q.ledger.model_dump()}")
    print("metadata:", doc.metadata.model_dump(exclude_none=True))
    for b in doc.blocks:
        flags = ",".join(f.code for f in b.flags)
        txt = b.text.replace("\n", " ")
        txt = txt if show_text else txt[:90]
        pages = ",".join(str(s.page) for s in b.source)
        print(f"{b.id} p{pages:<4} {b.type:<10} L{b.level or '-'} {b.number or '':<8} c={b.confidence:.2f} "
              f"{('[' + flags + '] ') if flags else ''}{txt}")
    for p in doc.pages:
        img = Image.open(io.BytesIO(res.assets[p.image])).convert("RGB")
        d = ImageDraw.Draw(img, "RGBA")
        s = doc.image_scale
        for b in doc.blocks:
            for src in b.source:
                if src.page != p.number:
                    continue
                x0, y0, x1, y1 = (v * s for v in src.bbox)
                c = COLORS.get(b.type, "#000000")
                d.rectangle([x0, y0, x1, y1], outline=c, width=2, fill=c + "22")
                d.text((x0 + 2, y0 + 1), f"{b.id}:{b.type[:4]}", fill=c)
        for o in q.omitted:
            if o.page == p.number:
                x0, y0, x1, y1 = (v * s for v in o.bbox)
                d.rectangle([x0, y0, x1, y1], outline="#9e9e9e", width=1, fill="#9e9e9e33")
        img.save(out / f"{pdf.stem}-p{p.number}.png")
    for path, data in res.assets.items():
        if not path.startswith("pages/"):
            target = out / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
