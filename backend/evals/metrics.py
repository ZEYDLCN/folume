"""Compare a parsed Document against synthetic ground truth.

Metrics map to the README's success criteria:
  * conversion integrity  -> text recall/precision, type recall (figures/tables/equations/headings)
  * return-to-source      -> IoU of each block's source regions with the true location
  * reading efficiency    -> reading-order score (proxy: no reordering of content)
"""

from __future__ import annotations

import re
from collections import Counter
from statistics import mean

from folume.model import Block, Document

TEXT_TYPES = {"paragraph", "list_item", "heading", "caption", "footnote", "reference", "title", "authors", "code"}
COMPAT = {
    "paragraph": {"paragraph", "list_item"},
    "list_item": {"list_item", "paragraph"},
    "heading": {"heading"},
    "caption": {"caption"},
    "footnote": {"footnote"},
    "reference": {"reference"},
    "title": {"title"},
    "authors": {"authors"},
    "code": {"code"},
}
TOKEN = re.compile(r"[a-z0-9]+")


def tokens(text: str) -> list[str]:
    return TOKEN.findall(text.lower())


def truth_tokens(t: dict) -> list[str]:
    """Ground-truth tokens as the reading view should show them (labels live in `number`)."""
    text = t["text"]
    if t["type"] == "reference":
        text = re.sub(r"^\s*\[\d+\]\s*", "", text)
    if t["type"] == "footnote":
        text = re.sub(r"^\s*\d+\s*", "", text)
    return tokens(text)


def block_tokens(b: Block, include_math: bool = False) -> list[str]:
    text = " ".join(s.text for s in b.spans if include_math or not s.math) if b.spans else b.text
    return tokens(text)


def f1(a: list[str], b: list[str]) -> float:
    if not a or not b:
        return 0.0
    ca, cb = Counter(a), Counter(b)
    common = sum((ca & cb).values())
    if common == 0:
        return 0.0
    p, r = common / len(b), common / len(a)
    return 2 * p * r / (p + r)


def iou(a, b) -> float:
    w = min(a[2], b[2]) - max(a[0], b[0])
    h = min(a[3], b[3]) - max(a[1], b[1])
    if w <= 0 or h <= 0:
        return 0.0
    inter = w * h
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def containment(parsed, truth, slack: float = 3.0) -> float:
    """Fraction of the parsed box that lies inside the (slightly grown) true box."""
    t = (truth[0] - slack, truth[1] - slack, truth[2] + slack, truth[3] + slack)
    w = min(parsed[2], t[2]) - max(parsed[0], t[0])
    h = min(parsed[3], t[3]) - max(parsed[1], t[1])
    area = (parsed[2] - parsed[0]) * (parsed[3] - parsed[1])
    return (w * h) / area if w > 0 and h > 0 and area > 0 else 0.0


def lis_length(seq: list[int]) -> int:
    tails: list[int] = []
    for v in seq:
        lo, hi = 0, len(tails)
        while lo < hi:
            mid = (lo + hi) // 2
            if tails[mid] < v:
                lo = mid + 1
            else:
                hi = mid
        if lo == len(tails):
            tails.append(v)
        else:
            tails[lo] = v
    return len(tails)


def _norm_num(n: str | None) -> str:
    return (n or "").strip().rstrip(".").lower()


def evaluate(doc: Document, truth: dict) -> dict:
    blocks = doc.blocks
    used: set[int] = set()
    matches: dict[str, int] = {}  # truth id -> block index
    per_type: dict[str, list[int]] = {}
    source_scores: list[float] = []
    page_correct: list[bool] = []

    items = truth["items"]
    for t in items:
        ttype = t["type"]
        if ttype in TEXT_TYPES:
            ttok = truth_tokens(t)
            best, best_s = None, 0.0
            for i, b in enumerate(blocks):
                if i in used or b.type not in COMPAT[ttype]:
                    continue
                s = f1(ttok, block_tokens(b, include_math=True))
                if s > best_s:
                    best, best_s = i, s
            ok = best is not None and best_s >= 0.55
            if ok:
                used.add(best)
                matches[t["id"]] = best
            per_type.setdefault(ttype, []).append(1 if ok else 0)
        else:
            best, best_i = None, 0.0
            for i, b in enumerate(blocks):
                if i in used or b.type != ttype:
                    continue
                for tr in t["regions"]:
                    for s in b.source:
                        if s.page == tr["page"]:
                            v = iou(tr["bbox"], s.bbox)
                            if v > best_i:
                                best, best_i = i, v
            ok = best is not None and best_i >= 0.3
            if ok:
                used.add(best)
                matches[t["id"]] = best
            per_type.setdefault(ttype, []).append(1 if ok else 0)
        if t["id"] in matches:
            b = blocks[matches[t["id"]]]
            for tr in t["regions"]:
                # text boxes in the ground truth are column wide, so judge them by containment;
                # figures/tables/equations have exact boxes and are judged by IoU
                fn = containment if ttype in TEXT_TYPES else iou
                cands = [fn(s.bbox, tr["bbox"]) if fn is containment else fn(tr["bbox"], s.bbox)
                         for s in b.source if s.page == tr["page"]]
                source_scores.append(max(cands) if cands else 0.0)
                page_correct.append(bool(cands))

    # --- text recall / precision over the whole document (outside math, figures and tables)
    truth_bag: Counter[str] = Counter()
    for t in items:
        if t["type"] in TEXT_TYPES:
            truth_bag.update(truth_tokens(t))
    parsed_bag: Counter[str] = Counter()
    for b in blocks:
        if b.type in TEXT_TYPES:
            parsed_bag.update(block_tokens(b))
    common = sum((truth_bag & parsed_bag).values())
    recall = common / max(sum(truth_bag.values()), 1)
    precision = common / max(sum(parsed_bag.values()), 1)

    # --- reading order: matched blocks in truth order must be non-decreasing in the parsed order
    seq = [matches[t["id"]] for t in items if t["id"] in matches]
    order = lis_length(seq) / len(seq) if seq else 0.0

    # --- headings: number/level
    head_ok = head_n = 0
    for t in items:
        if t["type"] == "heading" and t["id"] in matches:
            b = blocks[matches[t["id"]]]
            head_n += 1
            same_number = (t.get("number") is None and b.number is None) or \
                _norm_num(t.get("number")) == _norm_num(b.number)
            if same_number and (t.get("level") is None or t["level"] == b.level):
                head_ok += 1

    # --- tables
    cell_ok = cell_n = structured = tables_n = 0
    for t in items:
        if t["type"] == "table" and t["id"] in matches:
            tables_n += 1
            b = blocks[matches[t["id"]]]
            if b.table is None:
                continue
            structured += 1
            for r_true, r_got in zip(t["rows"], b.table.rows, strict=False):
                for c_true, c_got in zip(r_true, r_got, strict=False):
                    cell_n += 1
                    cell_ok += int(str(c_true).strip() == c_got.strip())
            cell_n += abs(sum(len(r) for r in t["rows"]) - sum(len(r) for r in b.table.rows))

    # --- citations
    ref_ids = [b.id for b in blocks if b.type == "reference"]
    cite_hit = cite_total = cite_pred = 0
    for t in items:
        if t.get("cites") and t["id"] in matches:
            b = blocks[matches[t["id"]]]
            found = {ref_ids.index(c) + 1 for s in b.spans for c in s.cite if c in ref_ids}
            want = set(t["cites"])
            cite_hit += len(found & want)
            cite_total += len(want)
            cite_pred += len(found)

    # --- ledger / omissions
    omitted_ok = True  # all furniture truth is omitted from blocks
    for om in truth.get("omitted", []):
        if om["kind"] in ("running_header", "page_number") and om["text"]:
            key = tokens(om["text"])
            for b in blocks:
                if b.type in TEXT_TYPES and b.source[0].page == om["page"] and key and \
                        block_tokens(b)[: len(key)] == key and len(key) > 2 and b.type != "title":
                    omitted_ok = False

    def rate(vals: list[int]) -> float:
        return sum(vals) / len(vals) if vals else 1.0

    return {
        "id": truth["id"],
        "text_recall": round(recall, 4),
        "text_precision": round(precision, 4),
        "reading_order": round(order, 4),
        "type_recall": {k: round(rate(v), 3) for k, v in per_type.items()},
        "heading_number_level_accuracy": round(head_ok / head_n, 3) if head_n else 1.0,
        "source_overlap_mean": round(mean(source_scores), 3) if source_scores else 0.0,
        "source_page_accuracy": round(rate([int(x) for x in page_correct]), 3),
        "source_overlap_ge_05": round(rate([int(s >= 0.5) for s in source_scores]), 3),
        "table_structured_fraction": round(structured / tables_n, 3) if tables_n else 1.0,
        "table_cell_accuracy": round(cell_ok / cell_n, 3) if cell_n else 1.0,
        "citation_recall": round(cite_hit / cite_total, 3) if cite_total else 1.0,
        "citation_precision": round(cite_hit / cite_pred, 3) if cite_pred else 1.0,
        "furniture_excluded": omitted_ok,
        "coverage": doc.quality.ledger.coverage,
        "grade": doc.quality.grade,
        "unmatched": [t["id"] + ":" + t["type"] for t in items if t["id"] not in matches],
    }
