"""Developer tool: convert a PDF into a bundle directory (document.json + all image assets).

    python -m folume.tools.export_bundle paper.pdf out_dir
"""

from __future__ import annotations

import sys
from pathlib import Path

from folume.parsing.pipeline import parse_pdf


def main(argv: list[str]) -> int:
    pdf, out = Path(argv[1]), Path(argv[2])
    result = parse_pdf(pdf.read_bytes(), pdf.name)
    out.mkdir(parents=True, exist_ok=True)
    (out / "document.json").write_text(result.document.model_dump_json(), encoding="utf-8")
    for rel, blob in result.assets.items():
        target = out / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(blob)
    q = result.document.quality
    print(f"{pdf.name}: {len(result.document.blocks)} blocks, grade={q.grade}, coverage={q.ledger.coverage} -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
