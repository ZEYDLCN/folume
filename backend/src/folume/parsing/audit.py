"""Completeness audit: does the converted document hold every letter and digit of the PDF's text layer?

The unit of comparison is a letter or digit after Unicode NFKC folding, case kept. Spaces, line breaks, hyphens and
other punctuation are layout, not content: hyphen repair legitimately removes some, and a ligature glyph and the
two letters it stands for are the same text. Comparing multisets of these units cannot be satisfied by reordering
tricks, and it does not depend on how the converter reached its result.
"""

from __future__ import annotations

import unicodedata
from collections import Counter

from ..model import Block, Completeness, CompletenessProblem, Document, OmittedRegion
from .types import RawPage

TEXT_TYPES = {"title", "authors", "heading", "paragraph", "list_item", "caption", "footnote", "reference", "code"}
MAX_PROBLEMS = 20
SHOWN = 60


def letters(text: str) -> Counter:
    """Letters and digits of `text` as a multiset (NFKC, case kept)."""
    return Counter(c for c in unicodedata.normalize("NFKC", text) if c.isalnum())


def block_text(b: Block) -> str:
    """Everything the PDF said inside one block: the removed prefix, the text, and the text of an image's region."""
    return " ".join(x for x in (b.prefix, b.text, b.inner_text) if x)


def parts_text(blocks: list[Block], omitted: list[OmittedRegion]) -> str:
    return "\n".join([block_text(b) for b in blocks] + [o.text or o.preview for o in omitted])


def document_text(doc: Document) -> str:
    """All text of a document, as the audit sees it (reading text, image text, omitted headers and footers)."""
    return parts_text(doc.blocks, doc.quality.omitted)


def document_letters(doc: Document) -> Counter:
    return letters(document_text(doc))


def raw_letters(pages: list[RawPage]) -> tuple[Counter, Counter, Counter]:
    """(read, hidden, duplicate) letters of the text layer."""
    read: Counter = Counter()
    for p in pages:
        read += letters("".join(c.text for c in p.chars))
    hidden = letters("".join(p.hidden for p in pages))
    dupes = letters("".join(p.duplicates for p in pages))
    return read, hidden, dupes


def _shown(c: Counter) -> str:
    s = "".join(sorted(c.elements()))
    return s if len(s) <= SHOWN else s[:SHOWN] + "…"


def _locate(pages: list[RawPage], blocks: list[Block], omitted: list[OmittedRegion]) -> list[CompletenessProblem]:
    """Blame the diff on blocks: compare each block with the PDF characters inside its source regions."""
    boxes: dict[int, list[tuple[float, tuple, str | None]]] = {}  # page -> (area, bbox, block id | omitted marker)
    for b in blocks:
        for s in b.source:
            x0, t, x1, bt = s.bbox
            boxes.setdefault(s.page, []).append(((x1 - x0) * (bt - t), (x0 - 1, t - 1, x1 + 1, bt + 1), b.id))
    for o in omitted:
        x0, t, x1, bt = o.bbox
        boxes.setdefault(o.page, []).append(((x1 - x0) * (bt - t), (x0 - 1, t - 1, x1 + 1, bt + 1), "omitted"))
    expected: dict[str, list[str]] = {}
    outside: dict[int, list[str]] = {}
    for p in pages:
        candidates = sorted(boxes.get(p.number, []), key=lambda t: t[0])  # the tightest region claims a character
        for c in p.chars:
            cx, cy = (c.x0 + c.x1) / 2, (c.top + c.bottom) / 2
            owner = next((bid for _, (bx0, by0, bx1, by1), bid in candidates if bx0 <= cx <= bx1 and by0 <= cy <= by1), None)
            if owner is None:
                outside.setdefault(p.number, []).append(c.text)
            else:
                expected.setdefault(owner, []).append(c.text)
    problems: list[CompletenessProblem] = []
    for b in blocks:
        want = letters("".join(expected.get(b.id, [])))
        have = letters(block_text(b))
        miss, extra = want - have, have - want
        if miss or extra:
            problems.append(CompletenessProblem(block_id=b.id, page=b.source[0].page, missing=_shown(miss),
                                                extra=_shown(extra)))
    for page, chars in outside.items():
        c = letters("".join(chars))
        if c:
            problems.append(CompletenessProblem(page=page, missing=_shown(c)))
    problems.sort(key=lambda p: -(len(p.missing) + len(p.extra)))
    return problems[:MAX_PROBLEMS]


def audit_pages(pages: list[RawPage], blocks: list[Block], omitted: list[OmittedRegion]) -> Completeness:
    read, hidden, dupes = raw_letters(pages)
    reference = read + hidden + dupes
    out_text = out_eq = out_tab = out_fig = out_rec = 0
    produced: Counter = Counter()
    for b in blocks:
        n = letters(block_text(b))
        produced += n
        count = sum(n.values())
        if any(f.code == "text_recovered" for f in b.flags):
            out_rec += count
        elif b.type in TEXT_TYPES:
            out_text += count
        elif b.type == "equation":
            out_eq += count
        elif b.type == "table":
            out_tab += count
        elif b.type == "figure":
            out_fig += count
    om = letters("\n".join(o.text or o.preview for o in omitted))
    produced += om
    # hidden and overprinted copies are read once or not at all by design: they are in the PDF, not in the document
    expected = read
    missing = expected - produced
    extra = produced - expected
    n_missing, n_extra = sum(missing.values()), sum(extra.values())
    problems = _locate(pages, blocks, omitted) if (n_missing or n_extra) else []
    return Completeness(
        complete=n_missing == 0 and n_extra == 0,
        letters_in_pdf=sum(reference.values()),
        in_text=out_text, in_equations=out_eq, in_tables=out_tab, in_figures=out_fig,
        omitted=sum(om.values()), duplicates=sum(dupes.values()), hidden=sum(hidden.values()), recovered=out_rec,
        missing=n_missing, extra=n_extra, problems=problems,
    )


def audit_document(data: bytes, doc: Document) -> Completeness:
    """Audit a finished document against its PDF again, independently of the conversion run."""
    from .raw import extract_pages  # noqa: PLC0415 (heavy import, only needed here)

    pages, _ = extract_pages(data)
    return audit_pages(pages, doc.blocks, doc.quality.omitted)


__all__ = ["audit_document", "audit_pages", "block_text", "document_letters", "document_text", "letters", "raw_letters"]
