"""Document model v1: the single contract between parser, API and the mobile app.

Coordinates are PDF points (1/72 inch) with the origin at the **top-left** of the page,
so ``(x0, top, x1, bottom)`` matches what pdfplumber reports and what screens expect.

Every block carries ``source`` regions so the reader can always return to the original page
(README principle: *source first*). Anything the converter is unsure about is expressed as
``flags`` instead of being silently dropped (*do not hide gaps*).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

SCHEMA_VERSION = 1

# (x0, top, x1, bottom) in PDF points, origin top-left.
Rect = tuple[float, float, float, float]

BlockType = Literal[
    "title",
    "authors",
    "heading",
    "paragraph",
    "list_item",
    "figure",
    "table",
    "equation",
    "caption",
    "footnote",
    "reference",
    "code",
]

SectionKind = Literal["front", "abstract", "body", "acknowledgments", "references", "appendix"]

Severity = Literal["info", "warning", "error"]

FlagCode = Literal[
    # content that is shown, but not as faithful text
    "formula_image_only",  # display equation shown as image; text is only an approximation
    "inline_math_approximate",  # math fragments inside text are approximate Unicode
    "table_structure_uncertain",  # table cells could not be recovered reliably; image shown
    "table_image_only",  # table detected, no cell structure attempted/available
    "figure_text_folded",  # text inside a figure is part of the image, not of the flow
    # content that may be wrong
    "text_garbled",  # undecodable glyphs / replacement characters present
    "reading_order_uncertain",  # page layout could not be determined reliably
    "heading_uncertain",  # heading level/role is a guess
    "caption_unlinked",  # caption found but no figure/table matched it
    "reference_unparsed",  # bibliography entry could not be split reliably
    # document level
    "no_text_layer",  # scanned PDF: no extractable text (OCR is out of scope)
    "low_text_coverage",  # ledger could not account for enough of the text layer
    "rotated_text_skipped",  # rotated text exists and was not converted
    "text_recovered",  # characters the layout analysis could not place; shown here so no text is lost
]


class Model(BaseModel):
    # the API always serializes defaults, so clients can rely on those fields being present
    model_config = ConfigDict(extra="forbid", json_schema_serialization_defaults_required=True)


class SourceRegion(Model):
    page: int = Field(ge=1, description="1-based page number")
    bbox: Rect


class QualityFlag(Model):
    code: FlagCode
    severity: Severity
    message: str = Field(description="Short English fallback; the UI localizes from `code`")


class Span(Model):
    """Inline run of text inside a block."""

    text: str
    bold: bool = False
    italic: bool = False
    sup: bool = False
    sub: bool = False
    mono: bool = False
    math: bool = False  # inline math; `text` is an approximation
    cite: list[str] = Field(default_factory=list, description="Reference block ids this span cites")
    link: str | None = None


class Asset(Model):
    path: str = Field(description="Path relative to the document root, e.g. figures/f0003.png")
    kind: Literal["figure", "table", "equation"]
    page: int = Field(ge=1)
    bbox: Rect = Field(description="Region of the page this image shows")
    width: int = Field(gt=0, description="Image width in pixels")
    height: int = Field(gt=0, description="Image height in pixels")
    transparent: bool = Field(
        default=False, description="True for single-colour glyph images that can be tinted"
    )


class TableData(Model):
    rows: list[list[str]]
    header_rows: int = 0


class ReferenceInfo(Model):
    """Best-effort bibliographic fields parsed from a reference entry."""

    label: str | None = None  # "[12]" or "12"
    first_author: str | None = None
    year: int | None = None
    title: str | None = None
    doi: str | None = None
    url: str | None = None


class Block(Model):
    id: str
    type: BlockType
    text: str = Field(default="", description="Plain text; for figures/tables the caption is a separate block")
    spans: list[Span] = Field(default_factory=list)
    level: int | None = Field(default=None, description="Heading level (1 = top)")
    number: str | None = Field(
        default=None, description="Heading number, list marker, equation number or caption label"
    )
    section_id: str | None = None
    source: list[SourceRegion] = Field(min_length=1)
    confidence: float = Field(ge=0, le=1)
    flags: list[QualityFlag] = Field(default_factory=list)
    asset: Asset | None = None
    table: TableData | None = None
    caption_id: str | None = Field(default=None, description="figure/table -> its caption block")
    caption_for: str | None = Field(default=None, description="caption -> its figure/table block")
    reference: ReferenceInfo | None = None
    latex: str | None = Field(default=None, description="Reserved; engines that can emit LaTeX fill it")
    prefix: str | None = Field(
        default=None,
        description="Text the PDF showed in front of this block that was moved out of `text`: a heading number, "
        "a reference label, a footnote marker, a run-in 'Abstract—'. `prefix + text` is what the PDF said.",
    )
    inner_text: str | None = Field(
        default=None,
        description="Text layer inside a figure or table (labels, axis ticks, cells), top to bottom; the image shows it, "
        "this keeps it selectable and searchable so no character of the PDF is lost",
    )


class Section(Model):
    id: str
    title: str
    number: str | None = None
    level: int = Field(ge=1)
    kind: SectionKind = "body"
    block_id: str | None = Field(default=None, description="Heading block of this section")
    parent_id: str | None = None
    start_page: int = Field(ge=1)


class PageInfo(Model):
    number: int = Field(ge=1)
    width: float
    height: float
    image: str = Field(description="Rendered page image, relative path")
    image_width: int
    image_height: int


class SourceInfo(Model):
    filename: str
    sha256: str
    size_bytes: int
    page_count: int
    producer: str | None = None


class ParserInfo(Model):
    name: str
    version: str
    created_at: str = Field(description="UTC ISO-8601 timestamp")


class Metadata(Model):
    title: str | None = None
    authors: list[str] = Field(default_factory=list)
    abstract: str | None = None
    doi: str | None = None
    arxiv_id: str | None = None
    year: int | None = None
    keywords: list[str] = Field(default_factory=list)
    language: str | None = Field(default=None, description="ISO 639-1 guess, e.g. en")


class PageQuality(Model):
    page: int
    layout: Literal["single_column", "two_column", "unknown"]
    confidence: float = Field(ge=0, le=1)
    char_count: int
    notes: list[str] = Field(default_factory=list)


OmitReason = Literal[
    "running_header",
    "running_footer",
    "page_number",
    "rotated_text",
    "outside_page",
    "unclassified",
]


class OmittedRegion(Model):
    """Text deliberately kept out of the reading flow, listed so nothing disappears silently."""

    page: int
    bbox: Rect
    reason: OmitReason
    char_count: int
    preview: str
    text: str = Field(default="", description="The complete omitted text (`preview` is its start)")


class TextLedger(Model):
    """Accounting of every character of the PDF text layer."""

    total_chars: int
    in_blocks: int
    in_figures: int = Field(description="Characters folded into figure images")
    in_tables: int = Field(description="Characters folded into table images/cells")
    omitted: int = Field(description="Characters listed in `omitted` regions")
    unaccounted: int
    coverage: float = Field(ge=0, le=1, description="(total - unaccounted) / total")


class QualityIssue(Model):
    page: int | None = None
    block_id: str | None = None
    flag: QualityFlag


class CompletenessProblem(Model):
    """Where letters were lost or invented: the block (or just the page) and the letters concerned."""

    block_id: str | None = None
    page: int = Field(ge=1)
    missing: str = Field(default="", description="Letters/digits of the PDF text that are not in the block (shortened)")
    extra: str = Field(default="", description="Letters/digits in the block that the PDF does not have (shortened)")


class Completeness(Model):
    """Letter-by-letter comparison of the PDF text layer with the converted document.

    Counts letters and digits (Unicode NFKC, case kept; hyphens, spaces and punctuation are layout, not content).
    `complete` is true when nothing is missing and nothing was invented.
    """

    complete: bool
    letters_in_pdf: int
    in_text: int = Field(description="Letters in reading text: paragraphs, headings, lists, captions, references, ...")
    in_equations: int
    in_tables: int
    in_figures: int
    omitted: int = Field(description="Running headers/footers, page numbers, stamps: kept out of the flow but listed in full")
    duplicates: int = Field(description="Overprinted copies of the same glyph (fake bold): one copy is read")
    hidden: int = Field(description="Invisible text smaller than half a point")
    recovered: int = Field(description="Letters the layout analysis could not place; shown in flagged blocks")
    missing: int
    extra: int
    problems: list[CompletenessProblem] = Field(default_factory=list)


class DocumentQuality(Model):
    score: float = Field(ge=0, le=1)
    grade: Literal["good", "fair", "poor", "unsupported"]
    ledger: TextLedger
    pages: list[PageQuality]
    omitted: list[OmittedRegion] = Field(default_factory=list)
    issues: list[QualityIssue] = Field(default_factory=list)
    counts: dict[str, int] = Field(default_factory=dict)
    completeness: Completeness | None = Field(
        default=None, description="Null only for documents without a text layer (nothing to compare)"
    )


class Document(Model):
    schema_version: int = SCHEMA_VERSION
    id: str = Field(description="First 16 hex chars of the PDF sha256")
    source: SourceInfo
    parser: ParserInfo
    metadata: Metadata
    pages: list[PageInfo]
    sections: list[Section] = Field(default_factory=list)
    blocks: list[Block]
    quality: DocumentQuality
    image_scale: float = Field(description="Page image pixels per PDF point")
    body_font_size: float = Field(
        default=10.0, gt=0, description="Dominant body text size in PDF points; lets readers scale math images"
    )
