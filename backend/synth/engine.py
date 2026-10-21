"""Page layout engine: typesets a `Paper` with reportlab and records ground truth."""

from __future__ import annotations

import io
import random
import re
import zlib
from typing import Any

import numpy as np
from PIL import Image
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph

from . import fonts, mathfmt
from .spec import (
    TEMPLATES,
    Bullets,
    Code,
    Equation,
    Figure,
    Heading,
    Paper,
    Para,
    Ref,
    Table,
)

ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"]
Bbox = tuple[float, float, float, float]


def _strip_tags(s: str) -> str:
    return re.sub(r"<[^>]+>", "", s).replace("&amp;", "&")


class Typesetter:
    def __init__(self, paper: Paper, path: str, set_info: bool = True):
        fonts.register()
        self.paper = paper
        self.t = TEMPLATES[paper.template]
        self.W, self.H = self.t.page
        ml, mr, mt, mb = self.t.margins
        self.ml, self.mr, self.mt, self.mb = ml, mr, mt, mb
        self.c = canvas.Canvas(path, pagesize=(self.W, self.H))
        if set_info:
            self.c.setTitle(paper.title)
            self.c.setAuthor(", ".join(a for a, _ in paper.authors))
        self.c.setProducer("synth")
        self.rng = random.Random(zlib.crc32(paper.id.encode()))
        self._seq = 0
        self.truth: list[dict[str, Any]] = []
        self.omitted: list[dict[str, Any]] = []
        self.page = 1
        self.col = 0
        self.sec = [0, 0, 0]
        self.fig_n = self.tab_n = self.eq_n = self.fn_n = 0
        self.after_heading = False
        self.pending_wide: list = []
        self.fn_items: list[list] = [[], []]
        self.fn_reserved = [0.0, 0.0]
        self.region_top = mt
        self.y = mt
        self._begin_page()

    # ---- geometry -----------------------------------------------------------------------
    @property
    def full_w(self) -> float:
        return self.W - self.ml - self.mr

    @property
    def col_w(self) -> float:
        n = self.t.columns
        return (self.full_w - self.t.gutter * (n - 1)) / n

    def col_x(self, col: int | None = None) -> float:
        col = self.col if col is None else col
        return self.ml + col * (self.col_w + self.t.gutter)

    def bottom(self) -> float:
        return self.H - self.mb - self.fn_reserved[self.col]

    # ---- styles -------------------------------------------------------------------------
    def style(self, **kw) -> ParagraphStyle:
        base = dict(
            fontName=fonts.SERIF,
            fontSize=self.t.body_size,
            leading=self.t.leading,
            alignment=TA_JUSTIFY,
            firstLineIndent=10 if self.t.columns == 2 else 14,
            hyphenationLang="en_GB" if self.t.hyphenate else None,
            embeddedHyphenation=1,
            spaceShrinkage=0.35 if self.t.name == "arxiv" else 0.05,  # TeX glue shrinks spaces
        )
        base.update(kw)
        return ParagraphStyle("s", **base)

    # ---- page lifecycle -------------------------------------------------------------------
    def _begin_page(self) -> None:
        c, t = self.c, self.t
        self.col = 0
        self.region_top = self.mt
        self.y = self.mt
        self.fn_items = [[], []]
        self.fn_reserved = [0.0, 0.0]
        show_header = self.page > 1 or t.first_page_header
        if show_header:
            if t.alternate_header and self.page % 2 == 0:
                text = ", ".join(a for a, _ in self.paper.authors[:2])
            else:
                text = self.paper.short_title or self.paper.title
            c.setFont(fonts.SERIF_I, 8)
            c.drawCentredString(self.W / 2, self.H - 30, text)
            self.omitted.append({"kind": "running_header", "page": self.page, "text": text})
        if self.paper.stamp:
            c.saveState()
            c.setFont(fonts.SANS_B, 9)
            c.setFillGray(0.5)
            c.translate(22, self.H / 2)
            c.rotate(90)
            c.drawCentredString(0, 0, self.paper.stamp)
            c.restoreState()
            if self.page == 1:
                self.omitted.append({"kind": "rotated_text", "page": 1, "text": self.paper.stamp})
        self.flush_wide()

    def _draw_footer(self) -> None:
        if self.t.page_numbers:
            self.c.setFont(fonts.SERIF, 9)
            self.c.drawCentredString(self.W / 2, self.mb / 2 - 2, str(self.page))
            self.omitted.append({"kind": "page_number", "page": self.page, "text": str(self.page)})

    def finish_column(self) -> None:
        items = self.fn_items[self.col]
        if items:
            y = self.H - self.mb - self.fn_reserved[self.col]
            x = self.col_x()
            self.c.setLineWidth(0.4)
            self.c.line(x, self.H - y + 2, x + self.col_w * 0.3, self.H - y + 2)
            y += 5
            for p, h, entry in items:
                p.drawOn(self.c, x, self.H - y - h)
                self._truth(entry, (x, y, x + self.col_w, y + h))
                y += h
        self.fn_items[self.col] = []
        self.fn_reserved[self.col] = 0.0

    def next_column(self) -> None:
        self.finish_column()
        if self.col + 1 < self.t.columns:
            self.col += 1
            self.y = self.region_top
        else:
            self.new_page()

    def new_page(self) -> None:
        for col in range(self.t.columns):
            if self.fn_items[col]:
                self.col = col
                self.finish_column()
        self._draw_footer()
        self.c.showPage()
        self.page += 1
        self._begin_page()

    def flush_wide(self) -> None:
        pending, self.pending_wide = self.pending_wide, []
        for kind, item in pending:
            self._draw_wide(kind, item)

    def finish(self) -> None:
        if self.pending_wide:
            self.new_page()
        for col in range(self.t.columns):
            self.col = col
            self.finish_column()
        self._draw_footer()
        self.c.showPage()
        self.c.save()

    # ---- truth ----------------------------------------------------------------------------
    def new_id(self) -> str:
        self._seq += 1
        return f"t{self._seq:04d}"

    def _truth(self, entry: dict, bbox: Bbox) -> None:
        entry = dict(entry)
        entry.setdefault("regions", [])
        entry["regions"].append({"page": self.page, "bbox": [round(v, 2) for v in bbox]})
        if entry.get("_id") and any(e.get("_id") == entry["_id"] for e in self.truth):
            existing = next(e for e in self.truth if e.get("_id") == entry["_id"])
            existing["regions"] += entry["regions"]
            return
        entry["_id"] = entry.get("_id") or self.new_id()
        self.truth.append(entry)

    # ---- text placement -----------------------------------------------------------------------
    def place_paragraph(
        self,
        markup: str,
        style: ParagraphStyle,
        entry: dict,
        footnote: tuple[Paragraph, float, dict] | None = None,
        width: float | None = None,
        x: float | None = None,
        full_width: bool = False,
        gap_after: float = 0.0,
    ) -> None:
        w = width or (self.full_w if full_width else self.col_w)
        p = Paragraph(markup, style)
        entry = dict(entry)
        entry["_id"] = self.new_id()
        placed_first = False
        for _ in range(40):
            xx = x if x is not None else (self.ml if full_width else self.col_x())
            avail = self.bottom() - self.y
            if footnote and not placed_first:
                avail -= footnote[1] + 6
            _, h = p.wrap(w, avail)
            if h <= avail:
                p.drawOn(self.c, xx, self.H - self.y - h)
                self._truth(entry, (xx, self.y, xx + w, self.y + h))
                self.y += h + gap_after
                break
            parts = p.split(w, avail) if avail > style.leading * 2 else []
            if len(parts) < 2:
                self.next_column()
                continue
            first, rest = parts[0], parts[1]
            _, h1 = first.wrap(w, avail)
            first.drawOn(self.c, xx, self.H - self.y - h1)
            self._truth(entry, (xx, self.y, xx + w, self.y + h1))
            self.y += h1
            p = rest
            placed_first = True
            if footnote:
                self._reserve_footnote(footnote)
                footnote = None
            self.next_column()
        if footnote and not placed_first:
            self._reserve_footnote(footnote)

    def _reserve_footnote(self, fn: tuple[Paragraph, float, dict]) -> None:
        p, h, entry = fn
        self.fn_items[self.col].append((p, h, entry))
        self.fn_reserved[self.col] += h + (5 if len(self.fn_items[self.col]) == 1 else 0)

    def ensure(self, height: float) -> None:
        if self.y + height > self.bottom():
            self.next_column()

    # ---- semantic items -----------------------------------------------------------------------
    def cite_text(self, ids: list[int]) -> str:
        refs = self.paper.references
        if self.t.cite_style == "author_year":
            parts = []
            for i in ids:
                r = refs[i - 1]
                last = r.authors[0][1]
                parts.append(f"{last} et al., {r.year}" if len(r.authors) > 2 else
                             f"{last} and {r.authors[1][1]}, {r.year}" if len(r.authors) == 2 else
                             f"{last}, {r.year}")
            return "(" + "; ".join(parts) + ")"
        if self.paper.template == "ieee":
            return ", ".join(f"[{i}]" for i in ids)
        return "[" + ", ".join(str(i) for i in ids) + "]"

    def resolve(self, text: str) -> tuple[str, list[int]]:
        cites: list[int] = []

        def sub(m: re.Match) -> str:
            ids = [int(x) for x in m.group(1).split(",")]
            cites.extend(ids)
            return self.cite_text(ids)

        return re.sub(r"\{cite:([\d,]+)\}", sub, text), cites

    def title_block(self) -> None:
        p, t = self.paper, self.t
        c = self.c
        st = self.style(fontName=fonts.SERIF_B, fontSize=t.title_size, leading=t.title_size * 1.2,
                        alignment=TA_CENTER, firstLineIndent=0, hyphenationLang=None)
        self.y += 6
        self.place_paragraph(escape_markup(p.title), st, {"type": "title", "text": p.title},
                             full_width=True, gap_after=10)
        names = ", ".join(a for a, _ in p.authors)
        st2 = self.style(fontSize=11, leading=13.5, alignment=TA_CENTER, firstLineIndent=0, hyphenationLang=None)
        self.place_paragraph(escape_markup(names), st2, {"type": "authors", "text": names}, full_width=True)
        affs = list(dict.fromkeys(a for _, a in p.authors))
        st3 = self.style(fontName=fonts.SERIF_I, fontSize=9, leading=11, alignment=TA_CENTER,
                         firstLineIndent=0, hyphenationLang=None)
        for aff in affs:
            self.place_paragraph(escape_markup(aff), st3, {"type": "authors", "text": aff, "affiliation": True},
                                 full_width=True)
        self.y += 8
        if t.abstract_mode == "block":
            sth = self.style(fontName=fonts.SERIF_B, fontSize=10.5, leading=13, alignment=TA_CENTER,
                             firstLineIndent=0, hyphenationLang=None)
            self.place_paragraph("Abstract", sth, {"type": "heading", "level": 1, "text": "Abstract",
                                                  "number": None, "abstract": True},
                                 width=self.full_w - 60, x=self.ml + 30, gap_after=3)
            sta = self.style(fontSize=t.body_size - 0.5, leading=t.leading - 1, firstLineIndent=0)
            m, plain = mathfmt.inline(p.abstract)
            self.place_paragraph(m, sta, {"type": "paragraph", "text": plain, "role": "abstract"},
                                 width=self.full_w - 60, x=self.ml + 30, gap_after=4)
            if p.keywords:
                kw = "Keywords: " + "; ".join(p.keywords)
                self.place_paragraph(f"<i>{escape_markup(kw)}</i>", sta,
                                     {"type": "paragraph", "text": kw, "role": "keywords"},
                                     width=self.full_w - 60, x=self.ml + 30, gap_after=6)
            self.y += 6
            c.setLineWidth(0.3)
        self.region_top = self.y
        if t.abstract_mode == "run_in":
            m, plain = mathfmt.inline(p.abstract)
            sta = self.style(fontName=fonts.SERIF_B, fontSize=t.body_size - 0.5, leading=t.leading - 1,
                             firstLineIndent=0)
            self.place_paragraph("<b><i>Abstract—</i></b>" + f"<b>{m}</b>", sta,
                                 {"type": "paragraph", "text": plain, "role": "abstract",
                                  "run_in": "Abstract"}, gap_after=4)
            if p.keywords:
                kw = ", ".join(p.keywords)
                self.place_paragraph(f"<b><i>Index Terms—</i></b><b>{escape_markup(kw)}.</b>", sta,
                                     {"type": "paragraph", "text": kw, "role": "keywords",
                                      "run_in": "Index Terms"}, gap_after=6)

    def heading(self, h: Heading) -> None:
        t = self.t
        if h.level == 1:
            self.sec[0] += 1
            self.sec[1] = self.sec[2] = 0
        elif h.level == 2:
            self.sec[1] += 1
            self.sec[2] = 0
        else:
            self.sec[2] += 1
        if t.numbering == "roman":
            number = (ROMAN[self.sec[0]] + ".") if h.level == 1 else (chr(64 + self.sec[1]) + ".")
        else:
            number = ".".join(str(n) for n in self.sec[: h.level])
        text = h.text.upper() if (h.level == 1 and t.heading_upper) else h.text
        font = fonts.SANS_B if t.heading_sans else fonts.SERIF_B
        size = {1: t.body_size + 1.5, 2: t.body_size + 0.5, 3: t.body_size}[h.level]
        if t.numbering == "roman" and h.level == 2:
            font = fonts.SERIF_I
        align = TA_CENTER if (h.level == 1 and t.heading1_center) else TA_LEFT
        label = f"{number} {text}"
        st = self.style(fontName=font, fontSize=size, leading=size * 1.25, alignment=align,
                        firstLineIndent=0, hyphenationLang=None, spaceBefore=0)
        self.y += 8 if h.level == 1 else 5
        self.ensure(size * 1.25 + t.leading * 2)
        self.place_paragraph(escape_markup(label), st,
                             {"type": "heading", "level": h.level, "text": text, "number": number},
                             gap_after=3)
        self.after_heading = True

    def paragraph(self, para: Para) -> None:
        text, cites = self.resolve(para.text)
        markup, plain = mathfmt.inline(text)
        fn = None
        if para.footnote:
            self.fn_n += 1
            marker = str(self.fn_n)
            markup = re.sub(r"\.(\s)", rf".<super>{marker}</super>\1", markup, count=1)
            fst = self.style(fontSize=8, leading=9.5, firstLineIndent=0)
            fp = Paragraph(f"<super>{marker}</super> {escape_markup(para.footnote)}", fst)
            _, fh = fp.wrap(self.col_w, 500)
            fn = (fp, fh, {"type": "footnote", "text": para.footnote, "marker": marker})
        st = self.style(firstLineIndent=0 if self.after_heading else self.style().firstLineIndent)
        self.after_heading = False
        self.place_paragraph(markup, st, {"type": "paragraph", "text": plain, "cites": cites,
                                          "has_math": "$" in text}, footnote=fn, gap_after=0)

    def bullets(self, b: Bullets) -> None:
        for i, item in enumerate(b.items, 1):
            text, cites = self.resolve(item)
            markup, plain = mathfmt.inline(text)
            marker = f"{i}." if b.ordered else "•"
            st = self.style(leftIndent=14, firstLineIndent=0, bulletIndent=2, bulletFontName=fonts.SERIF)
            p = Paragraph(markup, st, bulletText=marker)
            _, h = p.wrap(self.col_w, 500)
            self.ensure(h)
            p.drawOn(self.c, self.col_x(), self.H - self.y - h)
            self._truth({"type": "list_item", "text": plain, "number": marker, "cites": cites},
                        (self.col_x(), self.y, self.col_x() + self.col_w, self.y + h))
            self.y += h + 1.5
        self.y += 3
        self.after_heading = False

    def code(self, block: Code) -> None:
        size, lead = 8.0, 9.6
        height = lead * len(block.lines) + 6
        self.ensure(height)
        self.c.setFont(fonts.MONO, size)
        x = self.col_x() + 6
        for i, line in enumerate(block.lines):
            self.c.drawString(x, self.H - (self.y + 3 + lead * (i + 1) - 2), line)
        self._truth({"type": "code", "text": "\n".join(block.lines)},
                    (self.col_x(), self.y, self.col_x() + self.col_w, self.y + height))
        self.y += height + 4
        self.after_heading = True

    def equation(self, eq: Equation) -> None:
        self.eq_n += 1
        box = mathfmt.layout(eq.expr, self.t.body_size + 1)
        pad = 7
        total = box.ascent + box.descent + 2 * pad
        self.ensure(total)
        x = self.col_x() + (self.col_w - box.width) / 2
        base = self.y + pad + box.ascent
        bbox = mathfmt.draw_display(self.c, box, x, base, self.H)
        num = f"({self.eq_n})"
        self.c.setFont(fonts.SERIF, self.t.body_size)
        nw = pdfmetrics.stringWidth(num, fonts.SERIF, self.t.body_size)
        self.c.drawString(self.col_x() + self.col_w - nw, self.H - base, num)
        union = (min(bbox[0], self.col_x() + self.col_w - nw), bbox[1],
                 self.col_x() + self.col_w, bbox[3])
        self._truth({"type": "equation", "text": eq.expr, "number": num}, union)
        self.y += total
        self.after_heading = True  # LaTeX: text after display math continues without indent

    # ---- floats ---------------------------------------------------------------------------
    def figure(self, fig: Figure) -> None:
        if fig.wide and self.t.columns > 1:
            self.pending_wide.append(("figure", fig))
            return
        self._draw_figure(fig, wide=False)

    def table(self, tab: Table) -> None:
        if tab.wide and self.t.columns > 1:
            self.pending_wide.append(("table", tab))
            return
        self._draw_table(tab, wide=False)

    def _draw_wide(self, kind: str, item) -> None:
        saved = (self.col, self.y)
        self.col = 0
        self.y = self.region_top
        if kind == "figure":
            self._draw_figure(item, wide=True)
        else:
            self._draw_table(item, wide=True)
        self.region_top = self.y + 6
        self.y = self.region_top
        self.col = saved[0]

    def _caption_style(self) -> ParagraphStyle:
        return self.style(fontSize=self.t.body_size - 1.5, leading=self.t.leading - 1.8,
                          firstLineIndent=0, alignment=TA_JUSTIFY)

    def _draw_figure(self, fig: Figure, wide: bool) -> None:
        self.fig_n += 1
        w = self.full_w if wide else self.col_w
        label = self.t.fig_label.format(n=self.fig_n)
        cap_markup, cap_plain = mathfmt.inline(self.resolve(fig.caption)[0])
        cp = Paragraph(f"<b>{label}</b> {cap_markup}", self._caption_style())
        _, ch = cp.wrap(w, 500)
        total = fig.height + 5 + ch + 8
        if not wide:
            self.y += 4
            self.ensure(total)
        x = self.ml if wide else self.col_x()
        inner = draw_chart(self.c, fig.kind, x, self.y, w, fig.height, self.H, self.rng)
        fig_entry = {"type": "figure", "text": "", "number": str(self.fig_n), "inner_text": inner,
                     "_id": self.new_id()}
        self._truth(fig_entry, (x, self.y, x + w, self.y + fig.height))
        cy = self.y + fig.height + 5
        cp.drawOn(self.c, x, self.H - cy - ch)
        self._truth({"type": "caption", "text": f"{label} {cap_plain}", "label": label,
                     "caption_for": fig_entry["_id"]}, (x, cy, x + w, cy + ch))
        self.y = cy + ch + 8

    def _draw_table(self, tab: Table, wide: bool) -> None:
        self.tab_n += 1
        w = self.full_w if wide else self.col_w
        label = self.t.table_label.format(n=self.tab_n, r=ROMAN[self.tab_n])
        cap_markup, cap_plain = mathfmt.inline(self.resolve(tab.caption)[0])
        if self.t.table_two_line:
            cp = Paragraph(f"{label}<br/>{cap_markup.upper()}", self.style(
                fontSize=self.t.body_size - 2, leading=self.t.leading - 2.5, alignment=TA_CENTER,
                firstLineIndent=0, hyphenationLang=None))
            cap_text = f"{label} {cap_plain.upper()}"
        else:
            cp = Paragraph(f"<b>{label}</b> {cap_markup}", self._caption_style())
            cap_text = f"{label} {cap_plain}"
        _, ch = cp.wrap(w, 500)
        size, row_h = 8.0, 11.5
        ncols = len(tab.header)
        widths = [max(pdfmetrics.stringWidth(str(r[i]), fonts.SERIF, size)
                      for r in [tab.header] + tab.rows) + 12 for i in range(ncols)]
        if sum(widths) > w:
            widths = [v * w / sum(widths) for v in widths]
        tw = sum(widths)
        th = row_h * (len(tab.rows) + 1) + 6
        total = ch + 4 + th + 10
        if not wide:
            self.y += 4
            self.ensure(total)
        x = self.ml if wide else self.col_x()
        top = self.y
        cp.drawOn(self.c, x, self.H - top - ch)
        cap_entry_id = self.new_id()
        tab_entry = {"type": "table", "text": "", "number": str(self.tab_n),
                     "rows": [tab.header] + tab.rows, "style": tab.style,
                     "_id": self.new_id(), "caption_id": cap_entry_id}
        self._truth({"type": "caption", "text": cap_text, "label": label,
                     "caption_for": tab_entry["_id"], "_id": cap_entry_id}, (x, top, x + w, top + ch))
        ty = top + ch + 4
        x0 = x + (w - tw) / 2
        c = self.c
        c.setLineWidth(0.8)
        c.line(x0, self.H - ty, x0 + tw, self.H - ty)
        yy = ty + 3
        for ri, row in enumerate([tab.header] + tab.rows):
            cx = x0
            for ci, cell in enumerate(row):
                font = fonts.SERIF_B if ri == 0 else fonts.SERIF
                c.setFont(font, size)
                text = str(cell)
                if ci == 0:
                    c.drawString(cx + 4, self.H - (yy + row_h - 3.5), text)
                else:
                    c.drawRightString(cx + widths[ci] - 4, self.H - (yy + row_h - 3.5), text)
                cx += widths[ci]
            yy += row_h
            if ri == 0:
                c.setLineWidth(0.4)
                c.line(x0, self.H - (yy + 1), x0 + tw, self.H - (yy + 1))
            elif tab.style == "grid":
                c.setLineWidth(0.3)
                c.line(x0, self.H - yy, x0 + tw, self.H - yy)
        c.setLineWidth(0.8)
        c.line(x0, self.H - (yy + 3), x0 + tw, self.H - (yy + 3))
        if tab.style == "grid":
            c.setLineWidth(0.3)
            cx = x0
            for wd in [0] + widths:
                cx += wd
                c.line(cx, self.H - (ty + 3), cx, self.H - (yy + 3))
        self._truth(tab_entry, (x0, ty, x0 + tw, yy + 3))
        self.y = yy + 3 + 10

    # ---- references -------------------------------------------------------------------------
    def references(self, refs: list[Ref]) -> None:
        t = self.t
        st = self.style(fontSize=t.body_size - 1.5, leading=t.leading - 2, firstLineIndent=-16,
                        leftIndent=16, alignment=TA_LEFT if t.cite_style == "author_year" else TA_JUSTIFY)
        for i, r in enumerate(refs, 1):
            names = [f"{f[0]}. {last}" for f, last in r.authors]
            if t.cite_style == "author_year":
                nm = [f"{last}, {f[0]}." for f, last in r.authors]
                body = f"{' and '.join(nm) if len(nm) <= 2 else ', '.join(nm[:-1]) + ', and ' + nm[-1]}. " \
                       f"{r.year}. {r.title}. <i>{r.venue}</i> ({r.year}){', ' + r.pages if r.pages else ''}."
                label = ""
            else:
                author_s = ", ".join(names[:-1]) + (" and " if len(names) > 1 else "") + names[-1]
                body = f"{author_s}, “{r.title},” <i>{r.venue}</i>, {r.year}" + \
                       (f", pp. {r.pages}" if r.pages else "") + "."
                label = f"[{i}] "
            plain = _strip_tags(label + body)
            p = Paragraph(label + escape_markup(body, keep_tags=True), st)
            _, h = p.wrap(self.col_w, 500)
            self.ensure(h)
            p.drawOn(self.c, self.col_x(), self.H - self.y - h)
            self._truth({"type": "reference", "text": plain, "number": label.strip() or None,
                         "ref_index": i, "year": r.year, "first_author": r.authors[0][1]},
                        (self.col_x(), self.y, self.col_x() + self.col_w, self.y + h))
            self.y += h + 2

    # ---- build ------------------------------------------------------------------------------
    def build(self) -> None:
        p = self.paper
        self.title_block()
        for item in p.body:
            if isinstance(item, Heading):
                if item.text.lower() == "references":
                    self.heading(item)
                    self.references(p.references)
                else:
                    self.heading(item)
            elif isinstance(item, Para):
                self.paragraph(item)
            elif isinstance(item, Equation):
                self.equation(item)
            elif isinstance(item, Figure):
                self.figure(item)
            elif isinstance(item, Table):
                self.table(item)
            elif isinstance(item, Bullets):
                self.bullets(item)
            elif isinstance(item, Code):
                self.code(item)
        self.finish()


def escape_markup(s: str, keep_tags: bool = False) -> str:
    if keep_tags:
        return re.sub(r"&(?!amp;)", "&amp;", s)
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


# ---- charts ---------------------------------------------------------------------------------------


def draw_chart(c, kind: str, x: float, y_top: float, w: float, h: float, page_h: float,
               rng: random.Random) -> list[str]:
    """Draw a figure body; returns the strings drawn as part of the figure (axis labels, legend)."""
    inner: list[str] = []
    top = page_h - y_top

    def label(txt: str, px: float, py: float, size: float = 6.5, align: str = "c", font=fonts.SANS) -> None:
        c.setFont(font, size)
        {"c": c.drawCentredString, "l": c.drawString, "r": c.drawRightString}[align](px, py, txt)
        inner.append(txt)

    if kind == "raster":
        arr = np.zeros((int(h * 2), int(w * 2), 3), dtype=np.uint8)
        gx = np.linspace(0, 1, arr.shape[1])[None, :]
        gy = np.linspace(0, 1, arr.shape[0])[:, None]
        noise = np.array([[rng.random() for _ in range(arr.shape[1] // 8 + 1)]
                          for _ in range(arr.shape[0] // 8 + 1)])
        noise = np.kron(noise, np.ones((8, 8)))[: arr.shape[0], : arr.shape[1]]
        arr[..., 0] = (255 * np.clip(gx * 0.7 + noise * 0.3, 0, 1)).astype(np.uint8)
        arr[..., 1] = (255 * np.clip(gy * 0.6 + noise * 0.4, 0, 1)).astype(np.uint8)
        arr[..., 2] = (255 * np.clip(1 - gx * 0.5 + noise * 0.2, 0, 1)).astype(np.uint8)
        buf = io.BytesIO()
        Image.fromarray(arr).save(buf, format="PNG")
        buf.seek(0)
        c.drawImage(ImageReader(buf), x, top - h, width=w, height=h)
        return inner

    pl, pb, pr, pt = 30, 20, 8, 10
    px0, px1 = x + pl, x + w - pr
    py0, py1 = top - h + pb, top - pt
    c.setLineWidth(0.6)
    c.setStrokeGray(0.1)
    c.line(px0, py0, px1, py0)
    c.line(px0, py0, px0, py1)
    for i in range(5):
        tx = px0 + (px1 - px0) * i / 4
        if kind != "bar":
            c.line(tx, py0, tx, py0 - 2)
            label(str(i * 25), tx, py0 - 9, 6)
        ty = py0 + (py1 - py0) * i / 4
        c.line(px0 - 2, ty, px0, ty)
        label(f"{i * 0.25:.2f}", px0 - 4, ty - 2, 6, "r")
    xlabel = ["Epoch", "Steps (k)", "Parameters (M)"][rng.randrange(3)] if kind != "bar" else "Model"
    label(xlabel, (px0 + px1) / 2, top - h + 3, 7)
    c.saveState()
    c.translate(x + 7, (py0 + py1) / 2)
    c.rotate(90)
    c.setFont(fonts.SANS, 7)
    ylabel = ["Accuracy", "Loss", "F1 score"][rng.randrange(3)]
    c.drawCentredString(0, 0, ylabel)
    inner.append(ylabel)
    c.restoreState()
    palette = [(0.1, 0.3, 0.8), (0.85, 0.2, 0.1), (0.1, 0.6, 0.3)]
    names = ["Baseline", "Ours", "Ablation"]
    for s in range(3 if kind != "bar" else 0):
        c.setStrokeColorRGB(*palette[s])
        c.setLineWidth(1.1)
        pts = []
        val = rng.random() * 0.4
        for i in range(21):
            val = min(0.98, max(0.02, val + (rng.random() - 0.42) * 0.08))
            pts.append((px0 + (px1 - px0) * i / 20, py0 + (py1 - py0) * val))
        p = c.beginPath()
        p.moveTo(*pts[0])
        for pt_ in pts[1:]:
            p.lineTo(*pt_)
        c.drawPath(p, stroke=1, fill=0)
        c.line(px1 - 62, py1 - 6 - s * 8, px1 - 50, py1 - 6 - s * 8)
        label(names[s], px1 - 47, py1 - 8.5 - s * 8, 6, "l")
    if kind == "bar":
        n = 5
        bw = (px1 - px0) / (n * 1.6)
        for i in range(n):
            val = 0.2 + rng.random() * 0.7
            bx = px0 + 6 + i * bw * 1.6
            c.setFillColorRGB(*palette[i % 3])
            c.rect(bx, py0, bw, (py1 - py0) * val, stroke=0, fill=1)
            c.setFillGray(0)
            label(f"M{i + 1}", bx + bw / 2, py0 - 9, 6)
    c.setFillGray(0)
    c.setStrokeGray(0)
    return inner
