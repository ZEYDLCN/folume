"""Turn ordered page items into semantic blocks (headings, paragraphs, lists, captions, ...)."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from statistics import median

from ..model import Span
from .furniture import Furniture
from .layout import SPAN, PageLayout
from .regions import Region
from .textutil import Vocabulary, ends_sentence, join_hyphenated
from .types import Bbox, Char, Fragment, RawPage, Rule, union

KNOWN_HEADINGS = {
    "abstract", "introduction", "background", "related work", "related works", "preliminaries", "method",
    "methods", "methodology", "approach", "model", "experiments", "experimental setup", "experimental results",
    "results", "results and discussion", "evaluation", "discussion", "conclusion", "conclusions",
    "conclusion and future work", "future work", "limitations", "acknowledgments", "acknowledgements",
    "acknowledgment", "acknowledgement", "references", "bibliography", "appendix", "appendices",
    "supplementary material", "ethics statement", "broader impact", "problem setup", "training objective",
}
REFERENCE_HEADINGS = {"references", "bibliography", "literature cited", "works cited", "reference"}
ACK_HEADINGS = {"acknowledgments", "acknowledgements", "acknowledgment", "acknowledgement"}

HEAD_NUM = re.compile(
    r"^\s*(?P<num>(?:[IVX]{1,5}\.|\d{1,2}(?:\.\d{1,2}){0,3}\.?|[A-Z](?:\.\d{1,2}){0,2}\.?|Appendix\s+[A-Z]\.?))"
    r"\s+(?P<title>\S.*)$",
    re.S,
)
CAP_STRICT = re.compile(
    r"^\s*(?P<word>fig(?:ure)?s?\.?|table|tab\.|algorithm|listing)\s*(?P<num>\d+(?:\.\d+)?|[IVXL]+)(?P<rest>.*)$",
    re.I | re.S,
)
LIST_MARK = re.compile(r"^\s*(?P<m>[•●◦▪‣∙·]|[-–*]|\(?[a-z]\)|\(?\d{1,2}\)|\d{1,2}\.|[ivx]{1,4}\.)\s+(?=\S)")
RUN_IN_ABSTRACT = re.compile(r"^\s*(abstract|summary)\s*[—–:.\-]\s*", re.I)
RUN_IN_KEYWORDS = re.compile(r"^\s*(index terms|keywords?|key words)\s*[—–:.\-]\s*", re.I)
REF_LABEL = re.compile(r"^\s*\[(\d{1,3})\]\s*|^\s*(\d{1,3})\.\s+(?=[A-Z])")


@dataclass(eq=False)
class Line:
    page: int
    column: int
    chars: list[Char]
    bbox: Bbox
    baseline: float
    size: float
    fragments: list[Fragment] = field(default_factory=list)
    col_left: float = 0.0
    col_right: float = 0.0

    @classmethod
    def from_fragment(cls, f: Fragment, column: int) -> Line:
        return cls(f.page, column, list(f.chars), f.bbox, f.baseline, f.size, [f])

    def add(self, f: Fragment) -> None:
        self.chars += f.chars
        self.fragments.append(f)
        self.bbox = union([self.bbox, f.bbox])
        self.size = max(self.size, f.size) if abs(f.size - self.size) < 0.5 else self.size

    @property
    def text(self) -> str:
        return "".join(s.text for s in line_spans(self))

    @property
    def plain(self) -> str:
        return " ".join(f.text for f in sorted(self.fragments, key=lambda f: f.x0))

    @property
    def x0(self) -> float:
        return self.bbox[0]

    @property
    def x1(self) -> float:
        return self.bbox[2]

    @property
    def width(self) -> float:
        return self.bbox[2] - self.bbox[0]

    def ratio(self, attr: str) -> float:
        ink = [c for c in self.chars if not c.text.isspace()]
        return sum(1 for c in ink if getattr(c, attr)) / len(ink) if ink else 0.0


@dataclass
class SpanDraft:
    text: str
    bold: bool = False
    italic: bool = False
    sup: bool = False
    sub: bool = False
    mono: bool = False
    math: bool = False

    def key(self) -> tuple:
        return (self.bold, self.italic, self.sup, self.sub, self.mono, self.math)


def line_spans(line: Line) -> list[SpanDraft]:
    """Style runs of one line. Sub/superscripts are detected from baseline offset and size."""
    chars = sorted((c for c in line.chars if not c.text.isspace()), key=lambda c: c.x0)
    out: list[SpanDraft] = []
    prev: Char | None = None
    prev_math = False
    main = line.size
    for ch in chars:
        dy = line.baseline - ch.baseline  # >0: above the baseline
        small = ch.size < 0.88 * main
        sup = small and dy > 0.2 * main
        sub = small and dy < -0.1 * main
        math = ch.math or ((sup or sub) and prev_math)
        d = SpanDraft(ch.text, ch.bold, ch.italic, sup, sub, ch.mono, math)
        if prev is not None and out:
            gap = ch.x0 - prev.x1
            ref = min(max(ch.size, prev.size), 14)
            if gap > 0.16 * ref and not (math and prev_math and gap < 0.45 * ref):
                # the space belongs to the preceding run unless that is a script (sub/superscript)
                if out[-1].sup or out[-1].sub:
                    d.text = " " + d.text
                else:
                    out[-1].text += " "
        if out and out[-1].key() == d.key():
            out[-1].text += d.text
        else:
            out.append(d)
        prev, prev_math = ch, math
    return out


@dataclass(eq=False)
class PBlock:
    type: str
    page: int
    lines: list[Line] = field(default_factory=list)
    regions: list[Region] = field(default_factory=list)
    spans: list[SpanDraft] = field(default_factory=list)
    level: int | None = None
    number: str | None = None
    label: str | None = None
    flags: list[tuple[str, str, str]] = field(default_factory=list)
    confidence: float = 0.95
    caption_for: PBlock | None = None
    caption: PBlock | None = None
    merged_into: PBlock | None = None
    role: str | None = None
    source: list[tuple[int, Bbox]] = field(default_factory=list)
    cites: list = field(default_factory=list)
    extra: dict = field(default_factory=dict)
    continued: bool = False
    first_line: Line | None = None
    last_line: Line | None = None
    after_object: bool = False

    def flag(self, code: str, severity: str, message: str) -> None:
        if not any(f[0] == code for f in self.flags):
            self.flags.append((code, severity, message))

    @property
    def text(self) -> str:
        return text_of(self.spans)


def text_of(spans: list[SpanDraft]) -> str:
    out = []
    for s in spans:
        if s.math and s.sub:
            out.append("_" + s.text)
        elif s.math and s.sup:
            out.append("^" + s.text)
        else:
            out.append(s.text)
    return "".join(out)


@dataclass
class PageStream:
    page: RawPage
    layout: PageLayout
    items: list  # Fragment | Region in reading order
    furniture: list[Furniture]
    footnote_rules: list[Rule]


class Builder:
    def __init__(self, streams: list[PageStream], body_size: float, vocab: Vocabulary):
        self.streams = streams
        self.body = body_size
        self.vocab = vocab
        self.blocks: list[PBlock] = []
        self.footnotes: list[tuple[PBlock, PBlock | None]] = []  # (footnote, anchor)
        self.in_references = False
        self.title_done = False
        self.front = True
        self.section_kind = "front"
        self.sizes_seen_for_headings: list[tuple[float, bool]] = []

    # ---- helpers --------------------------------------------------------------------------------
    def geometry(self, stream: PageStream, col: int) -> tuple[float, float]:
        cols = stream.layout.columns
        if stream.layout.kind == "two_column" and col in (0, 1) and len(cols) == 2:
            return cols[col]
        if stream.layout.kind == "two_column" and len(cols) == 2:
            return cols[0][0], cols[1][1]
        return cols[0] if cols else (0.0, stream.page.width)

    def lead_of(self, lines: list[Line]) -> float:
        diffs = []
        for a, b in zip(lines, lines[1:], strict=False):
            d = b.baseline - a.baseline
            if a.column == b.column and abs(a.size - self.body) < 0.8 and 0.9 * a.size < d < 2.0 * a.size:
                diffs.append(d)
        return median(diffs) if diffs else 1.2 * self.body

    def merge_fragments(self, stream: PageStream) -> list:
        out: list = []
        for it in stream.items:
            if isinstance(it, Region):
                out.append(it)
                continue
            col = stream.layout.column_of(it.bbox)
            last = out[-1] if out else None
            if (isinstance(last, Line) and last.column == col and abs(last.baseline - it.baseline) <= 1.6
                    and it.x0 >= last.bbox[0] - 1):
                last.add(it)
            else:
                out.append(Line.from_fragment(it, col))
        for it in out:
            if isinstance(it, Line):
                it.col_left, it.col_right = self.geometry(stream, it.column)
        return out

    def is_justified(self, lines: list[Line]) -> bool:
        body = [ln for ln in lines if abs(ln.size - self.body) < 0.8 and len(ln.chars) > 30]
        if len(body) < 5:
            return False
        near = sum(1 for ln in body if ln.col_right - ln.x1 <= 2.0)
        return near / len(body) >= 0.4

    # ---- classification -----------------------------------------------------------------------------
    def caption_start(self, ln: Line, near_kind: str | None) -> tuple[str, str, str] | None:
        """Return (kind, label, number) if the line starts a caption."""
        text = ln.plain
        m = CAP_STRICT.match(text)
        if not m:
            return None
        word = m.group("word").lower()
        kind = "table" if word.startswith("tab") else "figure" if word.startswith("fig") else "other"
        rest = m.group("rest")
        strict = bool(re.match(r"\s*[.:|—–\-]", rest)) or rest.strip() == ""
        # "Fig. 1 shows ..." inside a paragraph is not a caption; only accept when it sits next to a float
        if not strict and not (near_kind and near_kind == kind and ln.size <= 0.97 * self.body):
            return None
        if kind == "other" and not strict:
            return None
        label = text[: m.end("num")].strip()
        return kind, label, m.group("num")

    def heading_info(self, ln: Line, lead: float, gap_above: float | None, first_in_col: bool,
                     nxt: Line | None = None) -> dict | None:
        text = ln.plain.strip()
        if not text or len(text) > 140:
            return None
        if self.caption_start(ln, None) or RUN_IN_ABSTRACT.match(text) or RUN_IN_KEYWORDS.match(text):
            return None
        bold, italic = ln.ratio("bold"), ln.ratio("italic")
        sans = any("sans" in c.font.lower() or "helvet" in c.font.lower() or "arial" in c.font.lower()
                   for c in ln.chars[:6])
        bigger = ln.size >= 1.12 * self.body
        styled = bold >= 0.6 or bigger or sans or italic >= 0.9 or (text.isupper() and len(text) > 3)
        m = HEAD_NUM.match(text)
        lowered = re.sub(r"[\s.:]+$", "", text.lower())
        isolated = first_in_col or gap_above is None or gap_above > 1.25 * lead
        # numbered heading ("1 Introduction", "3.2 Training Objective", "IV. EXPERIMENTS", "A. Setup")
        if m and styled and len(text) <= 110 and not (text.endswith(".") and len(text) > 60):
            num, title = m.group("num"), m.group("title")
            plausible = len(title.split()) <= 14 and title[:1].isalpha()
            stray_letter = num.isalpha() and len(num) == 1 and num not in "A" and bold < 0.6 and italic < 0.9
            if plausible and not stray_letter:
                return {"number": num.rstrip("."), "title": title.strip(), "numbered": True}
        if lowered in KNOWN_HEADINGS and (styled or isolated):
            return {"number": None, "title": text.rstrip(".:"), "numbered": False}
        continues = (nxt is not None and nxt.column == ln.column and nxt.ratio("bold") >= 0.9
                     and abs(nxt.size - ln.size) < 0.5 and nxt.baseline - ln.baseline <= 1.3 * lead)
        if (bold >= 0.9 and len(text) <= 80 and not text.endswith((".", ",", ";")) and isolated and not continues
                and len(ln.fragments) == 1 and len(text.split()) <= 10 and not text[0].islower()):
            return {"number": None, "title": text, "numbered": False, "weak": True}
        if bigger and len(text) <= 80 and isolated and not text.endswith((".", ",")) and not text[0].islower():
            return {"number": None, "title": text, "numbered": False, "weak": True}
        return None

    # ---- main loop -----------------------------------------------------------------------------------
    def run(self) -> list[PBlock]:
        all_lines: list[Line] = []
        merged_streams: list[tuple[PageStream, list]] = []
        for st in self.streams:
            items = self.merge_fragments(st)
            merged_streams.append((st, items))
            all_lines += [i for i in items if isinstance(i, Line)]
        for ln in all_lines:
            self.vocab.add_line(ln.plain)
        self.justified = self.is_justified(all_lines)
        for st, items in merged_streams:
            self.process_page(st, items)
        return self.finalize()

    def process_page(self, st: PageStream, items: list) -> None:
        lines = [i for i in items if isinstance(i, Line)]
        lead_by_col = {c: self.lead_of([ln for ln in lines if ln.column == c]) for c in (0, 1, 2)}
        fn_lines = self.find_footnote_lines(st, lines)
        para: PBlock | None = None
        prev: Line | None = None
        last_body_block: PBlock | None = None
        i = 0
        n = len(items)

        def flush() -> None:
            nonlocal para, prev, last_body_block
            if para is not None:
                self.close_paragraph(para)
                last_body_block = para
            para = None
            prev = None

        def near_kind_of(idx: int) -> str | None:
            for k in (idx - 1, idx + 1, idx - 2, idx + 2):
                if 0 <= k < n and isinstance(items[k], Region) and items[k].kind in ("figure", "table"):
                    ref = items[k]
                    ln = items[idx]
                    gap = min(abs(ln.bbox[1] - ref.bbox[3]), abs(ref.bbox[1] - ln.bbox[3]))
                    if gap < 36:
                        return ref.kind
            return None

        footnote_current: PBlock | None = None
        while i < n:
            it = items[i]
            if isinstance(it, Region):
                flush()
                blk = self.object_block(it)
                self.blocks.append(blk)
                last_body_block = blk
                i += 1
                continue
            ln: Line = it
            lead = lead_by_col.get(ln.column, 1.2 * self.body)
            if id(ln) in fn_lines:
                flush()
                if footnote_current is None or self.starts_footnote(ln):
                    footnote_current = PBlock("footnote", st.page.number, lines=[ln])
                    self.footnotes.append((footnote_current, last_body_block))
                else:
                    footnote_current.lines.append(ln)
                i += 1
                continue
            footnote_current = None
            # --- title / front matter on page 1
            if st.page.number == 1 and not self.title_done and ln.size >= 1.35 * self.body and ln.baseline < 0.5 * st.page.height:
                flush()
                group = [ln]
                j = i + 1
                while j < n and isinstance(items[j], Line) and abs(items[j].size - ln.size) <= 0.6 and \
                        items[j].baseline - group[-1].baseline <= 1.8 * ln.size:
                    group.append(items[j])
                    j += 1
                blk = PBlock("title", 1, lines=group)
                self.blocks.append(blk)
                self.title_done = True
                i = j
                continue
            # --- caption
            near = near_kind_of(i)
            cap = self.caption_start(ln, near)
            if cap and para is not None and prev is not None and prev.column == ln.column \
                    and not ends_sentence(prev.plain):
                cap = None  # a reference such as "... as reported in / Table I." inside a running paragraph
            if cap:
                flush()
                group = [ln]
                j = i + 1
                while j < n and isinstance(items[j], Line) and items[j].column == ln.column \
                        and id(items[j]) not in fn_lines \
                        and abs(items[j].size - ln.size) <= 0.6 \
                        and items[j].baseline - group[-1].baseline <= 1.45 * ln.size \
                        and not self.caption_start(items[j], None) and not self.starts_with_indent(items[j], ln):
                    group.append(items[j])
                    j += 1
                blk = PBlock("caption", st.page.number, lines=group, label=cap[1], number=cap[2])
                blk.extra["kind"] = cap[0]
                self.blocks.append(blk)
                i = j
                continue
            # --- references section entries
            gap_above = (ln.baseline - prev.baseline) if prev is not None and prev.column == ln.column else None
            first_in_col = prev is None
            head = self.heading_info(ln, lead, gap_above, first_in_col,
                                     items[i + 1] if i + 1 < n and isinstance(items[i + 1], Line) else None)
            if head and head.get("weak") and (self.in_references or (self.front and self.title_done)):
                head = None  # typography alone does not make a heading among references or author lines
            if head:
                flush()
                group = [ln]
                j = i + 1
                distinct = ln.ratio("bold") >= 0.6 or ln.ratio("italic") >= 0.9 or ln.size >= 1.12 * self.body \
                    or ln.plain.isupper()
                while distinct and j < n and isinstance(items[j], Line) and items[j].column == ln.column \
                        and abs(items[j].size - ln.size) <= 0.6 \
                        and abs(items[j].ratio("bold") - ln.ratio("bold")) < 0.3 \
                        and abs(items[j].ratio("italic") - ln.ratio("italic")) < 0.3 \
                        and items[j].baseline - group[-1].baseline <= 1.5 * ln.size \
                        and not HEAD_NUM.match(items[j].plain) and len(items[j].plain) <= 80:
                    group.append(items[j])
                    j += 1
                blk = PBlock("heading", st.page.number, lines=group)
                blk.extra.update(head)
                if len(group) > 1:
                    blk.extra["title"] = " ".join(x.plain.strip() for x in group).strip()
                    if head.get("numbered"):
                        m = HEAD_NUM.match(blk.extra["title"])
                        if m:
                            blk.extra["title"] = m.group("title").strip()
                blk.extra["size"] = ln.size
                blk.extra["bold"] = ln.ratio("bold") >= 0.6
                self.blocks.append(blk)
                title = blk.extra["title"].lower().strip(" .:")
                self.in_references = title in REFERENCE_HEADINGS
                self.front = False
                i = j
                last_body_block = None
                continue
            # --- code listings: consecutive monospace lines keep their line structure
            if not self.in_references and ln.ratio("mono") >= 0.7 and len(ln.chars) >= 3:
                flush()
                group = [ln]
                j = i + 1
                while j < n and isinstance(items[j], Line) and items[j].column == ln.column \
                        and items[j].ratio("mono") >= 0.7 and items[j].baseline - group[-1].baseline <= 2.2 * ln.size:
                    group.append(items[j])
                    j += 1
                self.blocks.append(PBlock("code", st.page.number, lines=group))
                i = j
                continue
            # --- run-in abstract / keywords (IEEE style)
            text = ln.plain
            if para is None and self.front and RUN_IN_ABSTRACT.match(text):
                self.front = False
            # --- front matter authors
            if self.front and self.title_done and para is None:
                if self.looks_like_body(ln):
                    self.front = False
                else:
                    flush()
                    group = [ln]
                    j = i + 1
                    while j < n and isinstance(items[j], Line) and not self.looks_like_body(items[j]) \
                            and items[j].baseline - group[-1].baseline <= 1.5 * lead \
                            and not RUN_IN_ABSTRACT.match(items[j].plain) \
                            and not self.caption_start(items[j], None) \
                            and not KNOWN_HEADINGS.__contains__(items[j].plain.lower().strip(" .:")):
                        group.append(items[j])
                        j += 1
                    for author_line in group:
                        self.blocks.append(PBlock("authors", st.page.number, lines=[author_line]))
                    i = j
                    continue
            # --- paragraph / list / reference assembly
            if self.in_references:
                if para is None or self.starts_reference(ln, prev, lead):
                    flush()
                    para = PBlock("reference", st.page.number, lines=[ln])
                    para.first_line = para.last_line = ln
                else:
                    para.lines.append(ln)
                    para.last_line = ln
                prev = ln
                i += 1
                continue
            mark = LIST_MARK.match(text)
            is_list = bool(mark) and (ln.x0 - ln.col_left >= 0.35 * ln.size or mark.group("m") in "•●◦▪‣∙·")
            if para is None:
                para = PBlock("list_item" if is_list else "paragraph", st.page.number, lines=[ln])
                para.first_line = para.last_line = ln
                if is_list:
                    para.number = mark.group("m")
            else:
                if self.breaks_paragraph(para, prev, ln, lead, is_list):
                    flush()
                    para = PBlock("list_item" if is_list else "paragraph", st.page.number, lines=[ln])
                    para.first_line = para.last_line = ln
                    if is_list:
                        para.number = mark.group("m")
                else:
                    para.lines.append(ln)
                    para.last_line = ln
            prev = ln
            i += 1
        flush()

    def starts_with_indent(self, ln: Line, ref: Line) -> bool:
        return ln.x0 - ln.col_left > 0.7 * ln.size and ref.x0 - ref.col_left < 0.4 * ref.size

    def looks_like_body(self, ln: Line) -> bool:
        text = ln.plain
        wide = ln.width >= 0.8 * max(ln.col_right - ln.col_left, 1)
        return (len(text) >= 70 and wide and ln.size >= 0.93 * self.body) or bool(RUN_IN_ABSTRACT.match(text))

    def starts_footnote(self, ln: Line) -> bool:
        t = ln.plain.strip()
        first = [c for c in ln.chars if not c.text.isspace()][:1]
        small_first = bool(first) and first[0].size < 0.85 * ln.size
        return bool(re.match(r"^(\d{1,2}|[*†‡§¶])(\s|$)", t)) or small_first

    def starts_reference(self, ln: Line, prev: Line | None, lead: float) -> bool:
        if prev is None or prev.column != ln.column or prev.page != ln.page:
            return bool(REF_LABEL.match(ln.plain)) or (ln.x0 - ln.col_left) < 0.5 * ln.size
        if REF_LABEL.match(ln.plain):
            return True
        gap = ln.baseline - prev.baseline
        hanging = (ln.x0 - ln.col_left) < 0.5 * ln.size and (prev.x0 - ln.col_left) >= 0.5 * ln.size
        spaced = gap > 1.3 * lead
        # no labels and flush-left continuation lines: new entry only after a sentence end and a gap
        return hanging or spaced

    def breaks_paragraph(self, para: PBlock, prev: Line | None, ln: Line, lead: float, is_list: bool) -> bool:
        if prev is None or prev.column != ln.column or prev.page != ln.page:
            return True
        if is_list:
            return True
        gap = ln.baseline - prev.baseline
        if gap > 1.32 * lead:
            return True
        if para.type == "list_item":
            # continuation lines of a list item are indented like the item text
            return ln.x0 - ln.col_left < 0.3 * ln.size and prev.x1 < ln.col_right - 2.5 * ln.size and ends_sentence(prev.plain)
        indent = ln.x0 - ln.col_left
        prev_indent = prev.x0 - ln.col_left
        if indent > 0.7 * ln.size and prev_indent < 0.4 * ln.size:
            return True
        short_prev = prev.x1 < ln.col_right - 2.2 * ln.size
        if short_prev and ends_sentence(prev.plain) and (self.justified or indent > 0.3 * ln.size or gap > 1.05 * lead):
            return True
        return abs(ln.size - prev.size) > 1.0

    def close_paragraph(self, para: PBlock) -> None:
        self.blocks.append(para)

    def find_footnote_lines(self, st: PageStream, lines: list[Line]) -> set[int]:
        ids: set[int] = set()
        h = st.page.height
        for col in (0, 1, 2):
            left, right = self.geometry(st, col)
            width = max(right - left, 1)
            rules = [r for r in st.footnote_rules if left - 8 <= r.bbox[0] <= left + 8 and r.length <= 0.6 * width
                     and r.bbox[1] > 0.5 * h]
            col_lines = [ln for ln in lines if ln.column == col]
            if rules:
                cut = min(r.bbox[1] for r in rules)
                for ln in col_lines:
                    if ln.bbox[1] >= cut - 1:
                        ids.add(id(ln))
                continue
            # no rule: small text at the very bottom that starts with a footnote marker
            small = [ln for ln in col_lines if ln.size <= 0.9 * self.body and ln.baseline > 0.72 * h]
            if small and self.starts_footnote(small[0]):
                ids.update(id(ln) for ln in small if ln.baseline >= small[0].baseline - 1)
        return ids

    # ---- objects ---------------------------------------------------------------------------------------------
    def object_block(self, reg: Region) -> PBlock:
        blk = PBlock(reg.kind, reg.page, regions=[reg], number=reg.number)
        blk.source = [(reg.page, reg.bbox)]
        return blk

    # ---- finalize -----------------------------------------------------------------------------------------------
    def finalize(self) -> list[PBlock]:
        flow = self.merge_continuations(self.blocks)
        self.attach_footnotes(flow)
        self.link_captions(flow)
        return flow

    def merge_continuations(self, blocks: list[PBlock]) -> list[PBlock]:
        out: list[PBlock] = []
        last_text: PBlock | None = None
        interrupted = False  # a float/caption/footnote object sat between the two blocks
        for b in blocks:
            if b.type in ("figure", "table", "caption"):
                interrupted = True
                out.append(b)
                continue
            if b.type in ("equation", "heading", "title", "authors", "list_item", "reference"):
                interrupted = False
                out.append(b)
                if b.type != "list_item":
                    last_text = None  # equations/headings end any open paragraph; lists do not
                continue
            if b.type == "paragraph":
                if last_text is not None and self.should_merge(last_text, b, interrupted):
                    self.absorb(last_text, b)
                    b.merged_into = last_text
                    interrupted = False
                    continue
                last_text = b
                interrupted = False
            out.append(b)
        return out

    def should_merge(self, a: PBlock, b: PBlock, interrupted: bool) -> bool:
        if a.last_line is None or b.first_line is None:
            return False
        la, fb = a.last_line, b.first_line
        same_place = la.page == fb.page and la.column == fb.column
        if same_place and not interrupted:
            return False
        atext = " ".join(x.plain for x in a.lines).rstrip()
        btext = b.lines[0].plain.lstrip()
        if not atext or not btext:
            return False
        a_open = (not ends_sentence(atext)) or atext.endswith("-")
        b_cont = btext[:1].islower() or (atext.endswith("-") and btext[:1].isalpha())
        unindented = (fb.x0 - fb.col_left) < 0.7 * fb.size
        # a continuation starts at the top of its column
        return a_open and b_cont and unindented

    def absorb(self, a: PBlock, b: PBlock) -> None:
        a.lines += b.lines
        a.last_line = b.last_line
        a.continued = True
        a.extra.setdefault("joined", []).append(b)

    def attach_footnotes(self, flow: list[PBlock]) -> None:
        pos = {id(b): i for i, b in enumerate(flow)}
        inserts: list[tuple[int, int, PBlock]] = []
        for order, (fn, anchor) in enumerate(self.footnotes):
            a = anchor
            while a is not None and a.merged_into is not None:
                a = a.merged_into
            idx = pos.get(id(a)) if a is not None else None
            if idx is None:
                # fallback: after the last block of this page
                idxs = [i for i, b in enumerate(flow) if b.page == fn.page]
                idx = idxs[-1] if idxs else len(flow) - 1
            inserts.append((idx, order, fn))
        for idx, _, fn in sorted(inserts, key=lambda t: (t[0], t[1]), reverse=True):
            flow.insert(idx + 1, fn)

    def link_captions(self, flow: list[PBlock]) -> None:
        objs = [b for b in flow if b.type in ("figure", "table")]
        used: set[int] = set()
        for cap in [b for b in flow if b.type == "caption"]:
            kind = cap.extra.get("kind")
            cbox = union([x.bbox for x in cap.lines])
            best, best_d = None, 1e9
            for o in objs:
                if id(o) in used or o.type != kind or o.page != cap.page:
                    continue
                ob = o.regions[0].bbox
                h_overlap = min(cbox[2], ob[2]) - max(cbox[0], ob[0])
                if h_overlap <= 0:
                    continue
                d = min(abs(cbox[1] - ob[3]), abs(ob[1] - cbox[3]))
                if d < best_d:
                    best, best_d = o, d
            if best is not None and best_d < 80:
                used.add(id(best))
                cap.caption_for = best
                best.caption = cap
                if best.number is None:
                    best.number = cap.number
            else:
                cap.flag("caption_unlinked", "info", "Caption found but no matching figure/table")


def line_bbox_regions(lines: list[Line]) -> list[tuple[int, Bbox]]:
    """One bbox per contiguous (page, column) run of lines."""
    regions: list[tuple[int, Bbox]] = []
    cur: list[Line] = []
    for ln in lines:
        if cur and (ln.page != cur[-1].page or ln.column != cur[-1].column):
            regions.append((cur[0].page, union([x.bbox for x in cur])))
            cur = []
        cur.append(ln)
    if cur:
        regions.append((cur[0].page, union([x.bbox for x in cur])))
    return regions


def spans_for_lines(lines: list[Line], vocab: Vocabulary | None, plain_style: bool = False) -> list[SpanDraft]:
    """Concatenate line spans, repairing hyphenation and inserting single spaces between lines."""
    result: list[SpanDraft] = []
    for ln in lines:
        spans = line_spans(ln)
        if not spans:
            continue
        if result:
            prev_text = result[-1].text
            joined_prev, joined = join_hyphenated(prev_text, spans[0].text, vocab) if not result[-1].sup \
                and not spans[0].sup else (prev_text + " ", False)
            if joined or joined_prev != prev_text:
                result[-1].text = joined_prev
            else:
                result[-1].text = prev_text
        result.extend(spans)
    # merge identical neighbours
    merged: list[SpanDraft] = []
    for s in result:
        if merged and merged[-1].key() == s.key():
            merged[-1].text += s.text
        else:
            merged.append(SpanDraft(s.text, s.bold, s.italic, s.sup, s.sub, s.mono, s.math))
    if plain_style:
        for s in merged:
            s.bold = s.italic = False
    return merged


def block_style_cleanup(spans: list[SpanDraft]) -> list[SpanDraft]:
    """Drop bold/italic when (nearly) the whole block has it: that is style, not emphasis."""
    total = sum(len(s.text.strip()) for s in spans) or 1
    bold = sum(len(s.text.strip()) for s in spans if s.bold) / total
    italic = sum(len(s.text.strip()) for s in spans if s.italic) / total
    for s in spans:
        if bold >= 0.9:
            s.bold = False
        if italic >= 0.9:
            s.italic = False
    merged: list[SpanDraft] = []
    for s in spans:
        if merged and merged[-1].key() == s.key():
            merged[-1].text += s.text
        else:
            merged.append(s)
    return merged


def to_model_spans(spans: list[SpanDraft]) -> list[Span]:
    return [Span(text=s.text, bold=s.bold, italic=s.italic, sup=s.sup, sub=s.sub, mono=s.mono, math=s.math)
            for s in spans if s.text != ""]


__all__ = [
    "Builder", "PageStream", "PBlock", "Line", "SPAN", "line_bbox_regions", "spans_for_lines",
    "block_style_cleanup", "to_model_spans", "text_of", "REFERENCE_HEADINGS", "ACK_HEADINGS",
    "RUN_IN_ABSTRACT", "RUN_IN_KEYWORDS",
]
