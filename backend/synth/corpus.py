"""Named synthetic corpus + CLI: ``python -m synth.corpus out_dir``."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from .engine import Typesetter
from .textgen import build_paper

# name -> kwargs for build_paper (kept deterministic: same name, same PDF)
SPECS: dict[str, dict] = {
    "ieee_ml": dict(template="ieee", topic="ml", seed=11, sections=5, figures=2, tables=1, equations=3),
    "acm_graph": dict(template="acm", topic="graph", seed=23, figures=2, tables=2, equations=2, footnotes=2,
                      wide_table=True, wide_figure=True),
    "arxiv_bio": dict(template="arxiv", topic="bio", seed=37, figures=2, tables=1, equations=2,
                      stamp="arXiv:2403.01234v2 [cs.LG] 12 Mar 2024", code=True),
    "ieee_math": dict(template="ieee", topic="ml", seed=41, figures=1, tables=0, equations=5, title_index=1),
    "ml_companion": dict(template="ieee", topic="ml", seed=53, figures=1, tables=1, equations=2, title_index=2),
}


def generate(name: str, out_dir: Path) -> tuple[Path, Path]:
    kwargs = dict(SPECS[name])
    paper = build_paper(name, **kwargs)
    pdf = out_dir / f"{name}.pdf"
    ts = Typesetter(paper, str(pdf))
    ts.build()
    truth = {
        "id": name,
        "template": paper.template,
        "pages": ts.page,
        "title": paper.title,
        "authors": [a for a, _ in paper.authors],
        "keywords": paper.keywords,
        "items": [{k: v for k, v in e.items() if k != "_id"} | {"id": e["_id"]} for e in ts.truth],
        "omitted": ts.omitted,
        "references": [
            {"index": i, "first_author": r.authors[0][1], "year": r.year, "title": r.title}
            for i, r in enumerate(paper.references, 1)
        ],
    }
    truth_path = out_dir / f"{name}.truth.json"
    truth_path.write_text(json.dumps(truth, indent=1, ensure_ascii=False), encoding="utf-8")
    return pdf, truth_path


def generate_scanned(source_pdf: Path, out_pdf: Path) -> Path:
    """Rasterize a page and re-embed it as an image-only PDF (no text layer)."""
    import io

    import pypdfium2 as pdfium
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas

    doc = pdfium.PdfDocument(str(source_pdf))
    c = canvas.Canvas(str(out_pdf), pagesize=(612, 792))
    for i in range(min(2, len(doc))):
        img = doc[i].render(scale=1.5).to_pil().convert("L")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        c.drawImage(ImageReader(buf), 0, 0, width=612, height=792)
        c.showPage()
    c.save()
    return out_pdf


def main(argv: list[str]) -> int:
    out = Path(argv[1] if len(argv) > 1 else "tests/.generated")
    out.mkdir(parents=True, exist_ok=True)
    for name in SPECS:
        pdf, _ = generate(name, out)
        print("wrote", pdf)
    generate_scanned(out / "ieee_ml.pdf", out / "scanned.pdf")
    print("wrote", out / "scanned.pdf")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
