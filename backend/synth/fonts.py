"""Font registration. Names mimic what real LaTeX/Word PDFs embed (e.g. STIXGeneral-Italic)."""

from __future__ import annotations

import os

import matplotlib
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

_LIB = "/usr/share/fonts/truetype/liberation/"
_MPL = os.path.join(os.path.dirname(matplotlib.__file__), "mpl-data", "fonts", "ttf")
_done = False

SERIF = "Serif"
SERIF_B = "Serif-Bold"
SERIF_I = "Serif-Italic"
SERIF_BI = "Serif-BoldItalic"
SANS = "Sans"
SANS_B = "Sans-Bold"
MONO = "Mono"
MATH = "STIXGeneral-Regular"
MATH_I = "STIXGeneral-Italic"
CM_MI = "Cmmi10"


def register() -> None:
    global _done
    if _done:
        return
    for name, path in [
        (SERIF, _LIB + "LiberationSerif-Regular.ttf"),
        (SERIF_B, _LIB + "LiberationSerif-Bold.ttf"),
        (SERIF_I, _LIB + "LiberationSerif-Italic.ttf"),
        (SERIF_BI, _LIB + "LiberationSerif-BoldItalic.ttf"),
        (SANS, _LIB + "LiberationSans-Regular.ttf"),
        (SANS_B, _LIB + "LiberationSans-Bold.ttf"),
        (MONO, _LIB + "LiberationMono-Regular.ttf"),
        (MATH, os.path.join(_MPL, "STIXGeneral.ttf")),
        (MATH_I, os.path.join(_MPL, "STIXGeneralItalic.ttf")),
        (CM_MI, os.path.join(_MPL, "cmmi10.ttf")),
    ]:
        pdfmetrics.registerFont(TTFont(name, path))
    pdfmetrics.registerFontFamily(
        SERIF, normal=SERIF, bold=SERIF_B, italic=SERIF_I, boldItalic=SERIF_BI
    )
    pdfmetrics.registerFontFamily(SANS, normal=SANS, bold=SANS_B, italic=SANS, boldItalic=SANS_B)
    _done = True
