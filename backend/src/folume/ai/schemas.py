"""Request/response contracts of the AI gateway.

The client sends only the passages the reader approved; the gateway never sees the whole paper.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_PASSAGES = 14
MAX_PASSAGE_CHARS = 4000
MAX_TOTAL_CHARS = 24000
MAX_IMAGES = 3
MAX_IMAGE_B64 = 3_500_000  # ~2.6 MB of PNG/JPEG

Task = Literal[
    "explain", "why_matters", "define_term", "explain_formula", "explain_figure", "simplify", "translate", "ask"
]
Level = Literal["beginner", "intermediate", "expert"]
PassageKind = Literal["selection", "context", "retrieved", "caption", "equation", "abstract", "section"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Passage(Strict):
    id: str = Field(pattern=r"^p\d{1,3}$", description="Short id the model cites, e.g. p3")
    text: str = Field(min_length=1, max_length=MAX_PASSAGE_CHARS)
    kind: PassageKind = "context"
    label: str | None = Field(default=None, max_length=120, description="e.g. 'Section 3.1, p. 4'")


class ImageRef(Strict):
    passage_id: str = Field(pattern=r"^p\d{1,3}$")
    mime: Literal["image/png", "image/jpeg"]
    data_b64: str = Field(max_length=MAX_IMAGE_B64)
    role: Literal["figure", "equation", "table"]


class PaperInfo(Strict):
    title: str = Field(default="", max_length=300)
    abstract: str | None = Field(default=None, max_length=3000)


class ExplainRequest(Strict):
    task: Task
    passages: list[Passage] = Field(min_length=1, max_length=MAX_PASSAGES)
    selection_id: str = Field(pattern=r"^p\d{1,3}$", description="Which passage the reader selected")
    question: str | None = Field(default=None, max_length=600)
    language: str = Field(default="tr", pattern=r"^[a-z]{2}$")
    target_language: str | None = Field(default=None, pattern=r"^[a-z]{2}$", description="for translate")
    level: Level = "intermediate"
    paper: PaperInfo = Field(default_factory=PaperInfo)
    images: list[ImageRef] = Field(default_factory=list, max_length=MAX_IMAGES)

    @field_validator("passages")
    @classmethod
    def _bounded(cls, v: list[Passage]) -> list[Passage]:
        if sum(len(p.text) for p in v) > MAX_TOTAL_CHARS:
            raise ValueError("passages exceed the total size limit")
        if len({p.id for p in v}) != len(v):
            raise ValueError("passage ids must be unique")
        return v


class Segment(Strict):
    text: str
    cites: list[str] = Field(default_factory=list, description="Passage ids that support this segment")
    quote: str | None = Field(default=None, description="Exact text from a cited passage, if the model quoted")
    grounded: bool = Field(description="True when at least one valid citation backs the segment")
    quote_verified: bool | None = None


class ExplainResponse(Strict):
    answer: list[Segment]
    mode: Literal["llm", "extractive"]
    provider: str
    model: str | None = None
    ungrounded_ratio: float = Field(ge=0, le=1)
    needs_more_context: bool = False
    notices: list[str] = Field(default_factory=list)


class QuizRequest(Strict):
    section_title: str = Field(max_length=200)
    passages: list[Passage] = Field(min_length=1, max_length=MAX_PASSAGES)
    count: int = Field(default=4, ge=1, le=8)
    language: str = Field(default="tr", pattern=r"^[a-z]{2}$")
    level: Level = "intermediate"
    paper: PaperInfo = Field(default_factory=PaperInfo)

    @field_validator("passages")
    @classmethod
    def _bounded(cls, v: list[Passage]) -> list[Passage]:
        if sum(len(p.text) for p in v) > MAX_TOTAL_CHARS:
            raise ValueError("passages exceed the total size limit")
        return v


QuestionType = Literal["mcq", "truefalse", "short", "cloze"]


class Question(Strict):
    id: str
    type: QuestionType
    prompt: str
    choices: list[str] = Field(default_factory=list)
    answer: str = Field(description="For mcq/truefalse/cloze: the correct choice text; for short: a model answer")
    explanation: str = ""
    cites: list[str] = Field(default_factory=list)
    concept: str | None = None


class QuizResponse(Strict):
    questions: list[Question]
    mode: Literal["llm", "extractive"]
    provider: str
    notices: list[str] = Field(default_factory=list)


class CompareRequest(Strict):
    concept: str = Field(max_length=200)
    a: list[Passage] = Field(min_length=1, max_length=6)
    b: list[Passage] = Field(min_length=1, max_length=6)
    title_a: str = Field(default="", max_length=300)
    title_b: str = Field(default="", max_length=300)
    language: str = Field(default="tr", pattern=r"^[a-z]{2}$")


class CompareResponse(Strict):
    relation: Literal["common", "complementary", "contradictory", "unrelated", "unknown"]
    summary: list[Segment]
    mode: Literal["llm", "extractive"]
    provider: str
    notices: list[str] = Field(default_factory=list)


class AiStatus(Strict):
    enabled: bool
    mode: Literal["llm", "extractive"]
    provider: str
    model: str | None
    vision: bool
    limits: dict[str, int]
