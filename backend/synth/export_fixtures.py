"""Write parsed synthetic papers as JSON fixtures for the mobile test-suite.

    python -m synth.export_fixtures ../mobile/src/__fixtures__
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

from folume.parsing.pipeline import parse_pdf

from .corpus import generate

FIXTURES = ["ieee_ml", "acm_graph", "ml_companion"]


def main(argv: list[str]) -> int:
    out = Path(argv[1])
    out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for name in FIXTURES:
            pdf, _ = generate(name, Path(tmp))
            doc = parse_pdf(pdf.read_bytes(), pdf.name).document
            doc.parser.created_at = "2025-01-01T00:00:00Z"  # keep fixtures byte-stable
            (out / f"{name}.document.json").write_text(doc.model_dump_json(), encoding="utf-8")
            print("wrote", out / f"{name}.document.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
