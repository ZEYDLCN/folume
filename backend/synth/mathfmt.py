"""A tiny TeX-subset math typesetter for synthetic papers.

Supports: letters (italic), digits/operators (roman), ``\\alpha``-style symbols, ``^``/``_``
(with or without braces), ``\\frac{a}{b}``, ``\\sum``/``\\prod``/``\\int`` with limits,
``\\sqrt{x}``, ``\\mathrm{...}`` and a few relations. Display math is drawn on a reportlab
canvas as separate text objects, like real typeset PDFs (so fractions produce several lines).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from xml.sax.saxutils import escape

from reportlab.pdfbase import pdfmetrics

from . import fonts

SYMBOLS = {
    "alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ", "epsilon": "ε", "theta": "θ",
    "lambda": "λ", "mu": "μ", "pi": "π", "sigma": "σ", "tau": "τ", "phi": "φ", "omega": "ω",
    "eta": "η", "rho": "ρ", "Sigma": "Σ", "Delta": "Δ", "Theta": "Θ", "Omega": "Ω",
    "nabla": "∇", "partial": "∂", "cdot": "·", "times": "×", "leq": "≤", "geq": "≥",
    "approx": "≈", "in": "∈", "mid": "|", "infty": "∞", "to": "→", "ell": "ℓ", "neq": "≠",
    "sum": "∑", "prod": "∏", "int": "∫",
}
BIG = {"sum", "prod", "int"}
BINARY = set("=+−-×·≤≥≈≠∈→")
GREEK_LOWER = set("αβγδεθλμπστφωηρℓ")


@dataclass
class Box:
    """A laid out piece of math: draws itself relative to a baseline origin."""

    width: float
    ascent: float
    descent: float
    ops: list = field(default_factory=list)  # (dx, dy_up, kind, payload)

    def shift(self, dx: float, dy: float) -> list:
        return [(x + dx, y + dy, k, p) for x, y, k, p in self.ops]


def _sw(text: str, font: str, size: float) -> float:
    return pdfmetrics.stringWidth(text, font, size)


def _text(text: str, font: str, size: float) -> Box:
    return Box(_sw(text, font, size), size * 0.72, size * 0.22, [(0, 0, "text", (text, font, size))])


def _hcat(boxes: list[Box]) -> Box:
    x = 0.0
    ops: list = []
    asc = desc = 0.0
    for b in boxes:
        ops += b.shift(x, 0)
        x += b.width
        asc = max(asc, b.ascent)
        desc = max(desc, b.descent)
    return Box(x, asc, desc, ops)


class _Parser:
    def __init__(self, src: str, size: float):
        self.s = src
        self.i = 0
        self.size = size

    def peek(self) -> str:
        return self.s[self.i] if self.i < len(self.s) else ""

    def eat(self) -> str:
        ch = self.s[self.i]
        self.i += 1
        return ch

    def ws(self) -> None:
        while self.peek() == " ":
            self.i += 1

    def group_or_atom(self) -> str:
        """Return raw source of the next atom or {group}."""
        self.ws()
        if self.peek() == "{":
            depth, start = 0, self.i + 1
            while True:
                ch = self.eat()
                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        return self.s[start : self.i - 1]
        if self.peek() == "\\":
            self.eat()
            m = re.match(r"[A-Za-z]+", self.s[self.i :])
            name = m.group(0) if m else self.eat()
            self.i += len(name) if m else 0
            return "\\" + name
        return self.eat()

    def sequence(self, size: float) -> Box:
        boxes: list[Box] = []
        while self.i < len(self.s):
            self.ws()
            if self.i >= len(self.s):
                break
            boxes.append(self.term(size))
        return _hcat(boxes)

    def term(self, size: float) -> Box:
        self.ws()
        ch = self.peek()
        base: Box
        if ch == "\\":
            self.eat()
            m = re.match(r"[A-Za-z]+", self.s[self.i :])
            name = m.group(0) if m else self.eat()
            if m:
                self.i += len(name)
            base = self.command(name, size)
        elif ch == "{":
            base = _Parser(self.group_or_atom(), size).sequence(size)
        else:
            base = self.char_box(self.eat(), size)
        # scripts
        sup = sub = None
        while True:
            self.ws()
            if self.peek() == "^":
                self.eat()
                sup = _Parser(self.group_or_atom(), size * 0.7).sequence(size * 0.7)
            elif self.peek() == "_":
                self.eat()
                sub = _Parser(self.group_or_atom(), size * 0.7).sequence(size * 0.7)
            else:
                break
        if sup is None and sub is None:
            return base
        return self.attach(base, sup, sub, size, limits=getattr(base, "_big", False))

    def attach(self, base: Box, sup: Box | None, sub: Box | None, size: float, limits: bool) -> Box:
        if limits:
            w = max(base.width, sup.width if sup else 0, sub.width if sub else 0)
            ops = base.shift((w - base.width) / 2, 0)
            asc, desc = base.ascent, base.descent
            if sup:
                dy = base.ascent + sup.descent + size * 0.12
                ops += sup.shift((w - sup.width) / 2, dy)
                asc = dy + sup.ascent
            if sub:
                dy = -(base.descent + sub.ascent + size * 0.12)
                ops += sub.shift((w - sub.width) / 2, dy)
                desc = -dy + sub.descent
            return Box(w, asc, desc, ops)
        w = base.width + max(sup.width if sup else 0, sub.width if sub else 0)
        ops = list(base.ops)
        asc, desc = base.ascent, base.descent
        if sup:
            ops += sup.shift(base.width, size * 0.38)
            asc = max(asc, size * 0.38 + sup.ascent)
        if sub:
            ops += sub.shift(base.width, -size * 0.22)
            desc = max(desc, size * 0.22 + sub.descent)
        return Box(w, asc, desc, ops)

    def char_box(self, ch: str, size: float) -> Box:
        if ch.isalpha() and ch.isascii() or ch in GREEK_LOWER:
            return _text(ch, fonts.MATH_I, size)
        if ch in BINARY:
            pad = size * 0.25
            inner = _text("−" if ch == "-" else ch, fonts.MATH, size)
            return Box(inner.width + 2 * pad, inner.ascent, inner.descent, inner.shift(pad, 0))
        return _text(ch, fonts.MATH, size)

    def command(self, name: str, size: float) -> Box:
        if name == "frac":
            num = _Parser(self.group_or_atom(), size * 0.8).sequence(size * 0.8)
            den = _Parser(self.group_or_atom(), size * 0.8).sequence(size * 0.8)
            w = max(num.width, den.width) + size * 0.3
            bar_y = size * 0.3
            ops = num.shift((w - num.width) / 2, bar_y + num.descent + size * 0.18)
            ops += den.shift((w - den.width) / 2, bar_y - den.ascent - size * 0.18)
            ops.append((0, bar_y, "rule", (w, 0.5)))
            asc = bar_y + num.descent + size * 0.18 + num.ascent
            desc = den.ascent + size * 0.18 + den.descent - bar_y
            return Box(w, asc, max(desc, 0), ops)
        if name == "sqrt":
            inner = _Parser(self.group_or_atom(), size).sequence(size)
            root = _text("√", fonts.MATH, size)
            ops = root.shift(0, 0) + inner.shift(root.width, 0)
            ops.append((root.width, inner.ascent + 1.5, "rule", (inner.width, 0.5)))
            return Box(root.width + inner.width, inner.ascent + 2, inner.descent, ops)
        if name == "mathrm":
            return _text(self.group_or_atom(), fonts.MATH, size)
        if name in BIG:
            b = _text(SYMBOLS[name], fonts.MATH, size * 1.5)
            b._big = True  # type: ignore[attr-defined]
            return b
        if name in SYMBOLS:
            return self.char_box(SYMBOLS[name], size)
        if name in {"exp", "log", "max", "min", "softmax", "argmax", "sin", "cos"}:
            b = _text(name, fonts.MATH, size)
            return Box(b.width + size * 0.15, b.ascent, b.descent, b.ops)
        if name == "|":
            return _text("‖", fonts.MATH, size)
        raise ValueError(f"unsupported TeX command \\{name}")


def layout(expr: str, size: float = 10.5) -> Box:
    return _Parser(expr.replace("\\|", "\\|"), size).sequence(size)


def draw_display(c, box: Box, x: float, y_base: float, page_h: float) -> tuple[float, float, float, float]:
    """Draw `box` with its origin at (x, y_base measured from top). Returns bbox (x0,top,x1,bottom)."""
    for dx, dy, kind, payload in box.ops:
        px, py = x + dx, page_h - (y_base - dy)
        if kind == "text":
            text, font, size = payload
            c.setFont(font, size)
            c.drawString(px, py, text)
        else:
            width, thick = payload
            c.setLineWidth(thick)
            c.line(px, py, px + width, py)
    return (x, y_base - box.ascent, x + box.width, y_base + box.descent)


# ---- inline math ------------------------------------------------------------------------------

_INLINE = re.compile(r"\$([^$]+)\$")


def _inline_markup(src: str) -> str:
    out: list[str] = []
    i = 0

    def run(font: str, text: str) -> str:
        return f'<font name="{font}">{escape(text)}</font>'

    while i < len(src):
        ch = src[i]
        if ch in "_^":
            tag = "sub" if ch == "_" else "super"
            i += 1
            if i < len(src) and src[i] == "{":
                j = src.index("}", i)
                inner = src[i + 1 : j]
                i = j + 1
            else:
                inner, i = src[i], i + 1
            out.append(f"<{tag}>{_inline_markup(inner)}</{tag}>")
        elif ch == "\\":
            m = re.match(r"\\([A-Za-z]+)", src[i:])
            name = m.group(1)
            i += m.end()
            sym = SYMBOLS.get(name, name)
            out.append(run(fonts.MATH_I if sym in GREEK_LOWER else fonts.MATH, sym))
        elif ch.isalpha() and ch.isascii():
            out.append(run(fonts.MATH_I, ch))
            i += 1
        else:
            out.append(run(fonts.MATH, "−" if ch == "-" else ch))
            i += 1
    return "".join(out)


def inline(text: str) -> tuple[str, str]:
    """Return (reportlab markup, plain text with math removed) for text containing $...$ spans."""
    markup = _INLINE.sub(lambda m: _inline_markup(m.group(1)), _escape_outside_math(text))
    plain = re.sub(r"\s+", " ", _INLINE.sub(" ", text)).strip()
    plain = re.sub(r"<[^>]+>", "", plain)
    return markup, plain


def _escape_outside_math(text: str) -> str:
    """Escape &,<,> in text outside $..$ while keeping our own <b>/<i> tags usable."""
    parts = re.split(r"(\$[^$]+\$)", text)
    return "".join(p if p.startswith("$") else p.replace("&", "&amp;") for p in parts)
