from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import pytest
from synth.corpus import SPECS, generate, generate_scanned

from folume.parsing.pipeline import ParseResult, parse_pdf


@dataclass
class Parsed:
    name: str
    pdf: Path
    truth: dict
    result: ParseResult

    @property
    def doc(self):
        return self.result.document


@pytest.fixture(scope="session")
def corpus_dir(tmp_path_factory) -> Path:
    return tmp_path_factory.mktemp("corpus")


@pytest.fixture(scope="session")
def corpus(corpus_dir) -> dict[str, Parsed]:
    out: dict[str, Parsed] = {}
    for name in SPECS:
        pdf, truth_path = generate(name, corpus_dir)
        out[name] = Parsed(name, pdf, json.loads(truth_path.read_text()), parse_pdf(pdf.read_bytes(), pdf.name))
    return out


@pytest.fixture(scope="session")
def scanned_pdf(corpus_dir, corpus) -> Path:
    return generate_scanned(corpus["ieee_ml"].pdf, corpus_dir / "scanned.pdf")
