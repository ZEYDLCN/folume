"""Write the JSON Schema of the document model (source of truth for the TypeScript types)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from folume.model import Document

DEFAULT_PATH = Path(__file__).resolve().parents[3] / "schema" / "document.schema.json"


def render() -> str:
    return json.dumps(Document.model_json_schema(), indent=2, sort_keys=True) + "\n"


def main(argv: list[str]) -> int:
    target = Path(argv[1]) if len(argv) > 1 else DEFAULT_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(render(), encoding="utf-8")
    print(f"wrote {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
