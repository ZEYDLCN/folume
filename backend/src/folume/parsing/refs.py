"""Bibliography parsing and in-text citation linking."""

from __future__ import annotations

import re

from ..model import Block, ReferenceInfo, Span

_LABEL = re.compile(r"^\s*\[(\d{1,3})\]\s*|^\s*(\d{1,3})\.\s+(?=[A-Z])")
_YEAR = re.compile(r"\b((?:19|20)\d{2})[a-z]?\b")
_DOI = re.compile(r"\b(10\.\d{4,9}/[^\s\"<>]+)", re.I)
_URL = re.compile(r"https?://[^\s\"<>]+")
_QUOTED = re.compile(r"[“\"]([^”\"]{8,200})[”\"]")


def parse_reference(text: str) -> ReferenceInfo:
    info = ReferenceInfo()
    m = _LABEL.match(text)
    body = text
    if m:
        info.label = m.group(1) or m.group(2)
        body = text[m.end():]
    years = [int(y.group(1)) for y in _YEAR.finditer(body)]
    if years:
        info.year = years[-1] if m else years[0]
    d = _DOI.search(body)
    if d:
        info.doi = d.group(1).rstrip(".,;)")
    u = _URL.search(body)
    if u:
        info.url = u.group(0).rstrip(".,;)")
    info.first_author = _first_author(body)
    q = _QUOTED.search(body)
    if q:
        info.title = q.group(1).strip(" ,.")
    else:
        parts = re.split(r"(?<=[a-z0-9\)])\.\s+(?=[A-Z])", body)
        if len(parts) >= 2 and 8 <= len(parts[1]) <= 220:
            cand = parts[1].strip(" .")
            info.title = re.sub(r"^\(?(?:19|20)\d{2}[a-z]?\)?\.?\s*", "", cand) or None
        if info.title and _YEAR.fullmatch(info.title.strip()):
            info.title = None
    return info


def _first_author(body: str) -> str | None:
    head = body.strip()
    # "Surname, A." / "Surname, A. and ..."
    m = re.match(r"^([A-Z][A-Za-zÀ-ɏ'\-]+(?: [A-Z][a-z]+)?),\s*(?:[A-Z]\.|[A-Z][a-z]+)", head)
    if m:
        return m.group(1)
    # "A. B. Surname, ..." or "Alice Surname, ..."
    m = re.match(r"^(?:[A-Z]\.\s*)+([A-Z][A-Za-zÀ-ɏ'\-]+)", head)
    if m:
        return m.group(1)
    m = re.match(r"^[A-Z][a-z]+\s+([A-Z][A-Za-zÀ-ɏ'\-]+)", head)
    if m:
        return m.group(1)
    return None


# ---- citation linking ------------------------------------------------------------------------------

_NUMERIC = re.compile(r"\[(\d{1,3}(?:\s*[,–\-]\s*\d{1,3})*)\]")
_PAREN = re.compile(r"\(([^()]*?(?:19|20)\d{2}[a-z]?[^()]*)\)")
_NARRATIVE = re.compile(r"([A-Z][A-Za-zÀ-ɏ'\-]+)(?: et al\.| and [A-Z][A-Za-zÀ-ɏ'\-]+| & [A-Z][A-Za-zÀ-ɏ'\-]+)? \(((?:19|20)\d{2})[a-z]?\)")
_AUTHOR_YEAR = re.compile(r"([A-Z][A-Za-zÀ-ɏ'\-]+)(?: et al\.?| and [A-Z][A-Za-zÀ-ɏ'\-]+| & [A-Z][A-Za-zÀ-ɏ'\-]+)?,? ((?:19|20)\d{2})[a-z]?")


def _expand(nums: str) -> list[int]:
    out: list[int] = []
    for part in re.split(r"\s*,\s*", nums):
        r = re.split(r"\s*[–\-]\s*", part)
        if len(r) == 2 and r[0].isdigit() and r[1].isdigit() and 0 < int(r[1]) - int(r[0]) < 50:
            out += list(range(int(r[0]), int(r[1]) + 1))
        else:
            out += [int(x) for x in r if x.isdigit()]
    return out


class CitationIndex:
    def __init__(self, refs: list[Block]):
        self.by_label: dict[int, str] = {}
        self.by_author_year: dict[tuple[str, int], str] = {}
        has_labels = any(b.reference and b.reference.label for b in refs)
        for i, b in enumerate(refs, 1):
            info = b.reference
            if info is None:
                continue
            if info.label and info.label.isdigit():
                self.by_label[int(info.label)] = b.id
            elif not has_labels:
                self.by_label.setdefault(i, b.id)  # unlabeled list: citations are positional
            if info.first_author and info.year:
                self.by_author_year.setdefault((info.first_author.lower(), info.year), b.id)

    def find(self, text: str) -> list[tuple[int, int, list[str]]]:
        """Return (start, end, [reference block ids]) matches in `text`."""
        hits: list[tuple[int, int, list[str]]] = []
        for m in _NUMERIC.finditer(text):
            ids = [self.by_label[n] for n in _expand(m.group(1)) if n in self.by_label]
            if ids:
                hits.append((m.start(), m.end(), ids))
        for m in _PAREN.finditer(text):
            ids: list[str] = []
            for part in m.group(1).split(";"):
                a = _AUTHOR_YEAR.search(part)
                if a:
                    rid = self.by_author_year.get((a.group(1).lower(), int(a.group(2))))
                    if rid:
                        ids.append(rid)
            if ids:
                hits.append((m.start(), m.end(), ids))
        for m in _NARRATIVE.finditer(text):
            rid = self.by_author_year.get((m.group(1).lower(), int(m.group(2))))
            if rid:
                hits.append((m.start(), m.end(), [rid]))
        hits.sort()
        merged: list[tuple[int, int, list[str]]] = []
        for h in hits:
            if merged and h[0] < merged[-1][1]:
                continue
            merged.append(h)
        return merged


def link_citations(spans: list[Span], index: CitationIndex) -> list[Span]:
    """Split spans so that citation text becomes its own span carrying `cite` ids."""
    text = "".join(s.text for s in spans)
    hits = index.find(text)
    if not hits:
        return spans
    out: list[Span] = []
    pos = 0
    hi = 0
    for s in spans:
        start, end = pos, pos + len(s.text)
        cursor = start
        while hi < len(hits) and hits[hi][0] < end:
            h_start, h_end, ids = hits[hi]
            if h_end <= start:
                hi += 1
                continue
            a, b = max(h_start, cursor), min(h_end, end)
            if a > cursor:
                out.append(s.model_copy(update={"text": text[cursor:a]}))
            if b > a:
                out.append(s.model_copy(update={"text": text[a:b], "cite": ids}))
            cursor = b
            if h_end <= end:
                hi += 1
            else:
                break
        if cursor < end:
            out.append(s.model_copy(update={"text": text[cursor:end]}))
        pos = end
    return [s for s in out if s.text]
