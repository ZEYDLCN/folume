import json

import pytest
from pydantic import ValidationError

from folume.model import Block, Document, SourceRegion
from folume.tools.export_schema import AI_PATH, DEFAULT_PATH, render, render_ai


def test_committed_schema_is_current():
    """The TypeScript types are generated from schema/document.schema.json; keep it in sync."""
    assert DEFAULT_PATH.read_text(encoding="utf-8") == render(), "run `make schema`"


def test_committed_ai_schema_is_current():
    assert AI_PATH.read_text(encoding="utf-8") == render_ai(), "run `make schema`"


def test_block_requires_a_source_region():
    with pytest.raises(ValidationError):
        Block(id="b1", type="paragraph", text="x", source=[], confidence=1)


def test_unknown_fields_are_rejected():
    with pytest.raises(ValidationError):
        SourceRegion(page=1, bbox=(0, 0, 1, 1), extra=1)  # type: ignore[call-arg]


def test_schema_has_expected_top_level_fields():
    schema = json.loads(render())
    assert {"id", "source", "pages", "blocks", "quality", "image_scale"} <= set(schema["properties"])
    assert Document.model_fields["schema_version"].default == 1
