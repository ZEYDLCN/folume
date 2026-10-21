"""Write the JSON Schemas of the public contracts (source of truth for the TypeScript types)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from pydantic.json_schema import models_json_schema

from folume.ai import schemas as ai
from folume.model import Document

SCHEMA_DIR = Path(__file__).resolve().parents[3] / "schema"
DEFAULT_PATH = SCHEMA_DIR / "document.schema.json"
AI_PATH = SCHEMA_DIR / "ai.schema.json"

AI_MODELS = [
    ai.ExplainRequest, ai.ExplainResponse, ai.QuizRequest, ai.QuizResponse, ai.CompareRequest,
    ai.CompareResponse, ai.AiStatus,
]


def render() -> str:
    return json.dumps(Document.model_json_schema(mode="serialization"), indent=2, sort_keys=True) + "\n"


def render_ai() -> str:
    """One schema holding every AI request/response under `$defs` (requests validated, responses serialized)."""
    pairs = [(m, "validation" if m.__name__.endswith("Request") else "serialization") for m in AI_MODELS]
    _, defs = models_json_schema(pairs, ref_template="#/$defs/{model}")
    return json.dumps(defs, indent=2, sort_keys=True) + "\n"


def main(argv: list[str]) -> int:
    SCHEMA_DIR.mkdir(parents=True, exist_ok=True)
    DEFAULT_PATH.write_text(render(), encoding="utf-8")
    AI_PATH.write_text(render_ai(), encoding="utf-8")
    print(f"wrote {DEFAULT_PATH} and {AI_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
