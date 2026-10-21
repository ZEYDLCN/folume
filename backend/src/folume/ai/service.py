"""Orchestrates explain / quiz / compare: prompt -> provider -> validation -> grounded response.

Degrades instead of failing: when the model is missing, unreachable or answers nonsense, the reader still gets the
relevant source passages (clearly marked as such). Request content is never logged.
"""

from __future__ import annotations

import logging

from ..config import Settings
from . import prompts
from .extractive import explain_extractive, quiz_extractive
from .grounding import ground_segments, parse_json, ungrounded_ratio
from .providers import LLMProvider, ProviderError
from .schemas import (
    MAX_IMAGES,
    MAX_PASSAGES,
    MAX_TOTAL_CHARS,
    AiStatus,
    CompareRequest,
    CompareResponse,
    ExplainRequest,
    ExplainResponse,
    Passage,
    Question,
    QuizRequest,
    QuizResponse,
    Segment,
)

log = logging.getLogger(__name__)
RETRY_NUDGE = "Your previous reply was not valid JSON. Reply with ONLY the JSON object described in the rules."


class NotAvailable(Exception):
    """The requested feature needs a language model but none is usable."""


class AiService:
    def __init__(self, settings: Settings, provider: LLMProvider | None):
        self.settings = settings
        self.provider = provider

    def status(self) -> AiStatus:
        p = self.provider
        return AiStatus(
            enabled=p is not None,
            mode="llm" if p else "extractive",
            provider=p.name if p else "none",
            model=p.model if p else None,
            vision=bool(p and p.vision),
            limits={"max_passages": MAX_PASSAGES, "max_total_chars": MAX_TOTAL_CHARS, "max_images": MAX_IMAGES},
        )

    async def _json(self, messages: list[dict], images=None, max_tokens: int = 1200) -> dict:
        assert self.provider is not None
        raw = await self.provider.complete(messages, images, max_tokens=max_tokens)
        try:
            data = parse_json(raw)
        except ValueError:
            retry = [*messages, {"role": "assistant", "content": raw[:2000]}, {"role": "user", "content": RETRY_NUDGE}]
            raw = await self.provider.complete(retry, None, max_tokens=max_tokens)
            try:
                data = parse_json(raw)
            except ValueError:
                raise ProviderError("model did not return JSON") from None
        if not isinstance(data, dict):
            raise ProviderError("model returned a non-object")
        return data

    # ---- explain ---------------------------------------------------------------------------------
    async def explain(self, req: ExplainRequest) -> ExplainResponse:
        if req.selection_id not in {p.id for p in req.passages}:
            raise ValueError("selection_id must refer to one of the passages")
        if self.provider is None:
            if req.task == "translate":
                raise NotAvailable("translation needs an AI model")
            segs = explain_extractive(req)
            return ExplainResponse(answer=segs, mode="extractive", provider="none", model=None,
                                   ungrounded_ratio=0.0, notices=["ai_disabled"])
        notices: list[str] = []
        images = [im for im in req.images if im.passage_id in {p.id for p in req.passages}]
        if images and not self.provider.vision:
            notices.append("images_ignored")
            images = []
        try:
            data = await self._json(prompts.explain_messages(req), images or None)
            segments = ground_segments(list(data.get("segments") or []), req.passages)
            if not segments:
                raise ProviderError("empty answer")
        except ProviderError as exc:
            log.warning("explain fell back to passages: %s", exc)
            if req.task == "translate":
                raise NotAvailable("the AI model could not translate this passage") from None
            segs = explain_extractive(req)
            return ExplainResponse(answer=segs, mode="extractive", provider="none", model=None,
                                   ungrounded_ratio=0.0, notices=["ai_unavailable", *notices])
        ratio = ungrounded_ratio(segments)
        if req.task != "translate" and ratio == 1.0:
            notices.append("no_citations")
        return ExplainResponse(answer=segments, mode="llm", provider=self.provider.name, model=self.provider.model,
                               ungrounded_ratio=ratio, needs_more_context=bool(data.get("needs_more_context")),
                               notices=notices)

    # ---- quiz -------------------------------------------------------------------------------------
    def _valid_questions(self, items: list[dict], passages: list[Passage]) -> list[Question]:
        ids = {p.id for p in passages}
        out: list[Question] = []
        for it in items:
            qtype = it.get("type")
            prompt = str(it.get("prompt", "")).strip()
            answer = str(it.get("answer", "")).strip()
            choices = [str(c).strip() for c in it.get("choices") or [] if str(c).strip()]
            cites = [c for c in (it.get("cites") or []) if isinstance(c, str) and c in ids]
            if qtype not in ("mcq", "truefalse", "short") or not prompt or not answer or not cites:
                continue  # every question must be answerable from, and point to, the paper
            if qtype == "mcq":
                if len(choices) < 2 or answer.lower() not in [c.lower() for c in choices]:
                    continue
                answer = next(c for c in choices if c.lower() == answer.lower())
            elif qtype == "truefalse":
                choices = ["True", "False"]
                if answer.lower() not in ("true", "false"):
                    continue
                answer = answer.capitalize()
            else:
                choices = []
            out.append(Question(id=f"q{len(out) + 1}", type=qtype, prompt=prompt, choices=choices, answer=answer,
                                explanation=str(it.get("explanation", "")).strip(), cites=cites,
                                concept=(str(it["concept"]).strip() or None) if it.get("concept") else None))
        return out

    async def quiz(self, req: QuizRequest) -> QuizResponse:
        if self.provider is not None:
            try:
                data = await self._json(prompts.quiz_messages(req), None, max_tokens=1800)
                questions = self._valid_questions(list(data.get("questions") or []), req.passages)[: req.count]
                if questions:
                    return QuizResponse(questions=questions, mode="llm", provider=self.provider.name)
            except ProviderError as exc:
                log.warning("quiz fell back to cloze questions: %s", exc)
            notices = ["ai_unavailable"]
        else:
            notices = ["ai_disabled"]
        qs = quiz_extractive(req)
        if not qs:
            notices.append("too_little_text")
        return QuizResponse(questions=qs, mode="extractive", provider="none", notices=notices)

    # ---- compare ------------------------------------------------------------------------------------
    async def compare(self, req: CompareRequest) -> CompareResponse:
        passages = [*req.a, *req.b]
        if len({p.id for p in passages}) != len(passages):
            raise ValueError("passage ids must be unique across both papers")
        if self.provider is None:
            segs = [Segment(text=p.text[:400], cites=[p.id], grounded=True) for p in passages[:4]]
            return CompareResponse(relation="unknown", summary=segs, mode="extractive", provider="none",
                                   notices=["ai_disabled"])
        try:
            data = await self._json(prompts.compare_messages(req), None)
            segments = ground_segments(list(data.get("segments") or []), passages)
            relation = data.get("relation")
            if relation not in ("common", "complementary", "contradictory", "unrelated", "unknown") or not segments:
                raise ProviderError("invalid comparison")
        except ProviderError:
            segs = [Segment(text=p.text[:400], cites=[p.id], grounded=True) for p in passages[:4]]
            return CompareResponse(relation="unknown", summary=segs, mode="extractive", provider="none",
                                   notices=["ai_unavailable"])
        notices = []
        if relation == "contradictory" and any(not s.grounded for s in segments):
            notices.append("contradiction_partly_ungrounded")
        return CompareResponse(relation=relation, summary=segments, mode="llm", provider=self.provider.name,
                               notices=notices)
