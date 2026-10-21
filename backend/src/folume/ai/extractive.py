"""Answers without a language model: the reader is shown the relevant source passages, never invented text.

This is the 'AI is optional' path (README principle 3) and also the safety net when a provider is down.
"""

from __future__ import annotations

import random
import re

from .schemas import ExplainRequest, Passage, Question, QuizRequest, Segment

_DEFINES = re.compile(
    r"\b(we define|is defined as|are defined as|denotes?|refers? to|is called|are called|we call|known as|"
    r"is the .{0,60} of|stands for|abbreviated)\b",
    re.I,
)
_WORD = re.compile(r"[A-Za-zÀ-ɏ][\w\-]+")
_STOP = frozenset(["the", "of", "and", "to", "in", "is", "that", "for", "with", "as", "on", "we", "by", "this", "are", "from", "an", "be", "at", "which", "our", "can", "it", "or", "not", "has", "have", "using", "these", "their", "its", "such", "than", "then", "there", "where", "when", "what", "each", "also", "into", "over", "under", "between"])


def sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+(?=[A-ZÀ-Ý(\[“\"])", text.strip())
    return [p.strip() for p in parts if p.strip()]


def explain_extractive(req: ExplainRequest) -> list[Segment]:
    """Selected passage first, then the passages that were retrieved for it, each cited as itself."""
    order = sorted(req.passages, key=lambda p: (p.id != req.selection_id, p.kind != "caption"))
    segs: list[Segment] = []
    for p in order[:5]:
        text = p.text
        if req.task == "define_term":
            term = next((s for s in sentences(text) if _DEFINES.search(s)), None)
            if term is None and p.id != req.selection_id:
                continue
            text = term or text
        segs.append(Segment(text=text if len(text) <= 700 else text[:697] + "…", cites=[p.id], grounded=True))
    return segs


def _terms(text: str) -> list[str]:
    ranked: dict[str, int] = {}
    for w in _WORD.findall(text):
        lw = w.lower()
        if lw in _STOP or len(lw) < 5:
            continue
        ranked[lw] = ranked.get(lw, 0) + 1
    return [w for w, _ in sorted(ranked.items(), key=lambda kv: (-kv[1], kv[0]))]


def quiz_extractive(req: QuizRequest) -> list[Question]:
    """Cloze questions: a defining or key sentence with its key term blanked out, plus distractors from the
    same section. Deterministic for a given input."""
    rng = random.Random(sum(len(p.text) for p in req.passages))
    pool: list[str] = []
    for p in req.passages:
        pool += _terms(p.text)[:6]
    pool = list(dict.fromkeys(pool))
    candidates: list[tuple[int, str, Passage, str]] = []
    for p in req.passages:
        for s in sentences(p.text):
            if len(s) < 50 or len(s) > 320:
                continue
            terms = [t for t in _terms(s) if t in s.lower()]
            if not terms:
                continue
            score = 3 if _DEFINES.search(s) else 1
            candidates.append((score, s, p, terms[0]))
    candidates.sort(key=lambda c: -c[0])
    questions: list[Question] = []
    used_terms: set[str] = set()
    for _score, sentence, passage, term in candidates:
        if len(questions) >= req.count:
            break
        if term in used_terms:
            continue
        distractors = [t for t in pool if t != term and abs(len(t) - len(term)) < 8]
        rng.shuffle(distractors)
        if len(distractors) < 3:
            continue
        match = re.search(re.escape(term), sentence, re.I)
        if match is None:
            continue
        blank = sentence[: match.start()] + "_____" + sentence[match.end():]
        choices = [term, *distractors[:3]]
        rng.shuffle(choices)
        used_terms.add(term)
        questions.append(Question(
            id=f"q{len(questions) + 1}", type="cloze", prompt=blank, choices=choices, answer=term,
            explanation=sentence, cites=[passage.id], concept=term))
    return questions
