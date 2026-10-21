"""Run the parser over the synthetic corpus and print/write the metrics.

    python -m evals.run [--out evals/out] [--corpus DIR]
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

from synth.corpus import SPECS, generate

from evals.metrics import evaluate
from folume.parsing.pipeline import parse_pdf

KEYS = ["text_recall", "text_precision", "reading_order", "source_overlap_mean", "source_overlap_ge_05",
        "citation_recall", "table_cell_accuracy", "coverage"]


def run(out: Path | None = None) -> list[dict]:
    results = []
    with tempfile.TemporaryDirectory() as tmp:
        for name in SPECS:
            pdf, truth_path = generate(name, Path(tmp))
            doc = parse_pdf(pdf.read_bytes(), pdf.name).document
            results.append(evaluate(doc, json.loads(truth_path.read_text())))
    if out is not None:
        out.mkdir(parents=True, exist_ok=True)
        (out / "metrics.json").write_text(json.dumps(results, indent=1))
    return results


def main(argv: list[str]) -> int:
    out = Path(argv[argv.index("--out") + 1]) if "--out" in argv else None
    results = run(out)
    print(f"{'document':<14}" + "".join(f"{k[:11]:>12}" for k in KEYS))
    for r in results:
        print(f"{r['id']:<14}" + "".join(f"{r[k]:>12.3f}" for k in KEYS))
        miss = {k: v for k, v in r["type_recall"].items() if v < 1.0}
        if miss or r["unmatched"]:
            print(f"   type_recall<1: {miss}  unmatched: {r['unmatched'][:8]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
