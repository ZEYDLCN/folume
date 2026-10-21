"""A third producer for the synthetic papers: HTML with CSS columns and MathML, printed by Chromium.

Chromium positions text its own way, lays real MathML out with its math engine, and (unless told not to) stamps its
default page header and footer (title, date, file path, page x/y) on every page, which is exactly the kind of running
text a reader app meets in the wild. Used by an optional test that is skipped when Chromium or pandoc is missing:

    python -m synth.html_paper out_dir [name]
"""

from __future__ import annotations

import base64
import html
import io
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from .corpus import SPECS
from .docx_paper import _picture
from .spec import Bullets, Code, Equation, Figure, Heading, Paper, Para, Table
from .textgen import build_paper

CHROMIUM_CANDIDATES = [
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    "chromium",
    "chromium-browser",
    "google-chrome",
]

CSS = """
@page { size: 8.5in 11in; margin: 0.9in 0.75in 0.9in 0.75in; }
body { font: 10pt/1.28 'FreeSerif', 'Liberation Serif', serif; margin: 0; }
.title { text-align: center; font-size: 20pt; font-weight: bold; margin: 0 0 8pt; }
.author { text-align: center; margin: 0; }
.abstract { margin: 10pt 1cm 4pt; text-align: justify; }
.keywords { margin: 0 1cm 8pt; }
.cols { column-count: 2; column-gap: 0.65cm; text-align: justify; }
h2 { font-size: 11pt; text-transform: uppercase; margin: 10pt 0 4pt; break-after: avoid; }
h3 { font-size: 10pt; margin: 8pt 0 3pt; break-after: avoid; }
p { margin: 0 0 4pt; text-indent: 0.4cm; }
ul.b { margin: 0 0 4pt 0.5cm; padding: 0; list-style: none; text-align: left; }
.eq { display: flex; justify-content: space-between; align-items: center; margin: 5pt 0; break-inside: avoid; }
.eq math { margin-left: 1cm; }
figure { margin: 6pt 0; break-inside: avoid; text-align: center; }
figure img { width: 7.6cm; }
figcaption, .tcap { font-size: 8.5pt; margin-top: 2pt; }
.tcap { text-align: center; text-transform: uppercase; font-size: 8pt; }
table { border-collapse: collapse; width: 100%; font-size: 8pt; margin: 2pt 0 8pt; break-inside: avoid; }
th, td { border: 0.5pt solid #000; padding: 2pt 3pt; text-align: center; }
pre { font: 7.5pt/1.2 'DejaVu Sans Mono', monospace; margin: 4pt 0; break-inside: avoid; text-align: left; }
.ref { margin: 0 0 3pt 0.8cm; text-indent: -0.8cm; font-size: 8pt; text-align: left; }
"""


def chromium_path() -> str | None:
    for c in CHROMIUM_CANDIDATES:
        found = shutil.which(c) or (c if Path(c).exists() else None)
        if found:
            return found
    return None


def available() -> bool:
    return chromium_path() is not None and shutil.which("pandoc") is not None


def mathml(expr: str, display: bool = False) -> str:
    """LaTeX math to MathML with pandoc."""
    src = f"$${expr}$$" if display else f"${expr}$"
    out = subprocess.run(["pandoc", "-f", "latex", "-t", "html", "--mathml"], input=src, capture_output=True, text=True,
                         check=True, timeout=30).stdout
    m = re.search(r"<math.*</math>", out, re.S)
    return m.group(0) if m else html.escape(expr)


def _inline(text: str) -> str:
    text = re.sub(r"\{cite:([\d,]+)\}", lambda m: "[" + ", ".join(m.group(1).split(",")) + "]", text)
    parts = re.split(r"(\$[^$]*\$)", text)
    out = []
    for part in parts:
        if part.startswith("$") and part.endswith("$") and len(part) > 2:
            out.append(mathml(part[1:-1]))
        else:
            # keep <i>/<b>, escape everything else
            out.append(re.sub(r"<(?!/?[ib]>)", "&lt;", part).replace("&", "&amp;").replace("&amp;lt;", "&lt;"))
    return "".join(out)


def _png_uri(kind: str) -> str:
    buf: io.BytesIO = _picture(kind, False)
    return "data:image/png;base64," + base64.b64encode(buf.read()).decode()


def build_html(paper: Paper) -> str:
    n_head = n_fig = n_tab = n_eq = 0
    sub = 0
    body: list[str] = []
    for item in paper.body:
        if isinstance(item, Heading):
            if item.level == 1:
                n_head += 1
                sub = 0
                body.append(f"<h2>{n_head}&nbsp; {html.escape(item.text)}</h2>")
            else:
                sub += 1
                body.append(f"<h3>{n_head}.{sub}&nbsp; {html.escape(item.text)}</h3>")
        elif isinstance(item, Para):
            body.append(f"<p>{_inline(item.text)}</p>")
        elif isinstance(item, Bullets):
            marks = [f"{i}. " if item.ordered else "• " for i in range(1, len(item.items) + 1)]
            lis = "".join(f"<li>{m}{_inline(t)}</li>" for m, t in zip(marks, item.items, strict=True))
            body.append(f"<ul class='b'>{lis}</ul>")
        elif isinstance(item, Equation):
            n_eq += 1
            body.append(f"<div class='eq'><span></span>{mathml(item.expr, True)}<span>({n_eq})</span></div>")
        elif isinstance(item, Figure):
            n_fig += 1
            cap = re.sub(r"<[^>]+>", "", item.caption)
            body.append(f"<figure><img src='{_png_uri(item.kind)}'><figcaption>Fig. {n_fig}. {html.escape(cap)}</figcaption></figure>")
        elif isinstance(item, Table):
            n_tab += 1
            head = "".join(f"<th>{html.escape(h)}</th>" for h in item.header)
            rows = "".join("<tr>" + "".join(f"<td>{html.escape(str(c))}</td>" for c in r) + "</tr>" for r in item.rows)
            body.append(f"<div class='tcap'>Table {n_tab}. {html.escape(item.caption)}</div>"
                        f"<table><tr>{head}</tr>{rows}</table>")
        elif isinstance(item, Code):
            body.append("<pre>" + html.escape("\n".join(item.lines)) + "</pre>")
    refs = []
    if not any(isinstance(i, Heading) and i.text.lower().startswith("reference") for i in paper.body):
        refs.append("<h2>References</h2>")
    for i, r in enumerate(paper.references, 1):
        names = ", ".join(f"{f[0]}. {last}" for f, last in r.authors)
        pages = f", pp. {r.pages}" if r.pages else ""
        refs.append(f"<div class='ref'>[{i}] {html.escape(names)}, “{html.escape(r.title)},” {html.escape(r.venue)}{pages}, {r.year}.</div>")
    authors = "".join(f"<p class='author'><b>{html.escape(n)}</b>, {html.escape(a)}</p>" for n, a in paper.authors)
    return (
        f"<!doctype html><html><head><meta charset='utf-8'><title>{html.escape(paper.title)}</title>"
        f"<style>{CSS}</style></head><body>"
        f"<div class='title'>{html.escape(paper.title)}</div>{authors}"
        f"<p class='abstract'><b>Abstract—</b>{html.escape(paper.abstract)}</p>"
        f"<p class='keywords'><i>Keywords:</i> {html.escape(', '.join(paper.keywords))}</p>"
        f"<div class='cols'>{''.join(body)}{''.join(refs)}</div></body></html>"
    )


def to_pdf(html_path: Path, pdf_path: Path, header_footer: bool = True) -> None:
    exe = chromium_path()
    assert exe, "Chromium not found"
    with tempfile.TemporaryDirectory() as profile:
        args = [exe, "--headless=new", "--no-sandbox", "--disable-gpu", f"--user-data-dir={profile}",
                f"--print-to-pdf={pdf_path}", html_path.resolve().as_uri()]
        if not header_footer:
            args.insert(-1, "--no-pdf-header-footer")
        subprocess.run(args, check=True, capture_output=True, timeout=120)


def generate(name: str, out_dir: Path, header_footer: bool = True) -> tuple[Path, Paper]:
    paper = build_paper(name, **SPECS[name])
    out_dir.mkdir(parents=True, exist_ok=True)
    html_path = out_dir / f"{name}_chrome.html"
    html_path.write_text(build_html(paper), encoding="utf-8")
    pdf = out_dir / f"{name}_chrome.pdf"
    to_pdf(html_path, pdf, header_footer)
    return pdf, paper


def main(argv: list[str]) -> int:
    out = Path(argv[1])
    for n in argv[2:] or ["ieee_ml"]:
        print(generate(n, out)[0])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
