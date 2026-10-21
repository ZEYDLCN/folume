"""Reads the files the app exported with tools that share no code with it, and proves no letter went missing.

    verify_exports.py <exports dir> <document.json>

Expects <exports dir>/exports.json: [{"file", "format", "appendix"}]. EPUB and HTML are read by pandoc, Markdown by
pandoc (CommonMark -> HTML -> text), plain text directly. The letters found are compared with the document the PDF
was converted to (the converter's own definition of "text of the PDF"): nothing may be missing, and the only extra
letters allowed are those of the labels the export declares it adds.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import zipfile
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree as ET

from folume.model import Document
from folume.parsing.audit import block_text, letters

EN = {
    "figure": "Text inside the figure",
    "table": "Text of the table",
    "title": "Removed from the reading text",
    "intro": "Running headers, footers and page numbers of the PDF. They are kept here so that no character of the PDF text is lost.",
}


def pandoc(src: str | bytes, frm: str, to: str = "plain") -> str:
    data = src if isinstance(src, bytes) else src.encode()
    out = subprocess.run(["pandoc", "-f", frm, "-t", to, "--wrap=none"], input=data, capture_output=True, check=True)
    return out.stdout.decode()


def expected(doc: Document, appendix: bool) -> Counter:
    parts = [block_text(b) for b in doc.blocks]
    if appendix:
        parts += [o.text or o.preview for o in doc.quality.omitted]
    return letters("\n".join(parts))


def show(c: Counter) -> str:
    return " ".join(f"{k}x{v}" for k, v in sorted(c.items()))


def compare(label: str, text: str, doc: Document, appendix: bool) -> list[str]:
    want = expected(doc, appendix)
    got = letters(text)
    allowed: Counter = Counter()
    for key in ("figure", "table", "title", "intro"):
        allowed += Counter({k: v * text.count(EN[key]) for k, v in letters(EN[key]).items()})
    missing = want - got
    extra = got - want - allowed
    problems = []
    if missing:
        problems.append(f"{label}: {sum(missing.values())} letters missing: {show(missing)[:200]}")
    if extra:
        problems.append(f"{label}: {sum(extra.values())} letters invented: {show(extra)[:200]}")
    return problems


def check_epub(path: Path) -> list[str]:
    problems = []
    with zipfile.ZipFile(path) as z:
        infos = z.infolist()
        if infos[0].filename != "mimetype" or infos[0].compress_type != zipfile.ZIP_STORED:
            problems.append("mimetype must be the first entry, stored")
        if z.read("mimetype") != b"application/epub+zip":
            problems.append("wrong mimetype content")
        bad = z.testzip()
        if bad:
            problems.append(f"damaged entry {bad}")
        container = ET.fromstring(z.read("META-INF/container.xml"))
        ns = {"c": "urn:oasis:names:tc:opendocument:xmlns:container"}
        opf_path = container.find(".//c:rootfile", ns).attrib["full-path"]
        opf = ET.fromstring(z.read(opf_path))
        base = opf_path.rsplit("/", 1)[0] + "/"
        o = {"o": "http://www.idpf.org/2007/opf"}
        manifest = {i.attrib["id"]: i.attrib["href"] for i in opf.findall(".//o:item", o)}
        names = set(z.namelist())
        for href in manifest.values():
            if base + href not in names:
                problems.append(f"manifest file missing: {href}")
        for ref in opf.findall(".//o:itemref", o):
            if ref.attrib["idref"] not in manifest:
                problems.append(f"spine item not in manifest: {ref.attrib['idref']}")
        for n in names:
            if n.endswith(".xhtml"):
                try:
                    ET.fromstring(z.read(n))
                except ET.ParseError as e:
                    problems.append(f"{n} is not well formed: {e}")
            if re.search(r"\.(png|jpg)$", n):
                magic = z.read(n)[:4]
                if magic not in (b"\x89PNG", b"\xff\xd8\xff\xe0", b"\xff\xd8\xff\xe1", b"\xff\xd8\xff\xdb"):
                    problems.append(f"{n} is not an image")
        target = path.with_suffix(".unzipped")
        shutil.rmtree(target, ignore_errors=True)
        z.extractall(target)
    return problems


def main() -> int:
    exports, docfile = Path(sys.argv[1]), Path(sys.argv[2])
    doc = Document.model_validate_json(docfile.read_text())
    entries = json.loads((exports / "exports.json").read_text())
    failed = 0
    for e in entries:
        path = exports / e["file"]
        fmt, appendix = e["format"], e["appendix"]
        problems: list[str] = []
        if fmt == "epub":
            problems += check_epub(path)
            text = pandoc(path.read_bytes(), "epub")
        elif fmt == "html":
            text = pandoc(path.read_bytes(), "html")
        elif fmt == "markdown":
            if path.suffix == ".zip":
                with zipfile.ZipFile(path) as z:
                    md = next(n for n in z.namelist() if n.endswith(".md"))
                    source = z.read(md).decode()
                    refs = re.findall(r"!\[[^\]]*\]\((images/[^)]+)\)", source)
                    problems += [f"image missing in zip: {r}" for r in refs if r not in z.namelist()]
            else:
                source = path.read_text()
            text = pandoc(pandoc(source, "gfm", "html"), "html")
        else:
            text = path.read_text()
        problems += compare(e["file"], text, doc, appendix)
        mark = "ok  " if not problems else "FAIL"
        print(f"{mark} {e['file']}: {sum(letters(text).values())} letters read back")
        for p in problems:
            print("      " + p)
        failed += bool(problems)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
