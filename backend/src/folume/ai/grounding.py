"""Turns model output into validated, source-grounded segments.

The model may only cite passages it was given. Unknown ids are dropped; a segment without a valid citation is
marked ungrounded so the UI can show it as 'not from the paper'. Verbatim quotes are checked against the cited
passage text.
"""

from __future__ import annotations

import json
import re
from typing import Any

from .schemas import Passage, Segment

_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.I)


def parse_json(raw: str) -> Any:
    text = _FENCE.sub("", raw.strip())
    try:
        return json.loads(text)
    except ValueError:
        start, end = text.find("{"), text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start : end + 1])
        raise


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


def ground_segments(items: list[dict], passages: list[Passage]) -> list[Segment]:
    by_id = {p.id: p for p in passages}
    out: list[Segment] = []
    for it in items:
        text = str(it.get("text", "")).strip()
        if not text:
            continue
        cites: list[str] = []
        for c in it.get("cites") or []:
            if isinstance(c, str) and c in by_id and c not in cites:
                cites.append(c)
        quote = it.get("quote") if isinstance(it.get("quote"), str) and it.get("quote").strip() else None
        verified = None
        if quote is not None:
            verified = any(_norm(quote) in _norm(by_id[c].text) for c in cites)
            if not verified:
                quote = None  # an unverifiable "quotation" is dropped rather than shown as the author's words
        out.append(Segment(text=text, cites=cites, quote=quote, grounded=bool(cites), quote_verified=verified))
    return out


def ungrounded_ratio(segments: list[Segment]) -> float:
    if not segments:
        return 1.0
    return round(sum(1 for s in segments if not s.grounded) / len(segments), 3)
