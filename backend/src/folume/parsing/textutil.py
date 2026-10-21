"""Text helpers: dehyphenation with a document vocabulary, sentence ends, garbled-text detection."""

from __future__ import annotations

import re
from collections import Counter

TERMINAL = ".?!:;"
CLOSERS = "\"'”’)]}»"
_WORD = re.compile(r"[A-Za-zÀ-ɏ]+(?:-[A-Za-zÀ-ɏ]+)*")
_GARBLED = re.compile(r"\(cid:\d+\)|�|[-]")


# Words that, before a line-break hyphen, almost always belong to a real compound ("self-supervised").
_KEEP_PREFIXES = {"self", "well", "state", "end", "high", "low", "real", "large", "small", "long", "short",
                  "fine", "one", "two", "three", "per", "non"}


class Vocabulary:
    """Words that appear intact (not split across a line break) somewhere in the document."""

    def __init__(self) -> None:
        self.words: Counter[str] = Counter()

    def add_line(self, text: str) -> None:
        tokens = text.split()
        if tokens and tokens[-1].endswith("-"):
            tokens = tokens[:-1]
        for tok in tokens:
            for w in _WORD.findall(tok):
                self.words[w.lower()] += 1

    def __contains__(self, word: str) -> bool:
        return word.lower() in self.words


def ends_sentence(text: str) -> bool:
    t = text.rstrip()
    while t and t[-1] in CLOSERS:
        t = t[:-1]
    return bool(t) and t[-1] in TERMINAL


def join_hyphenated(prev: str, nxt: str, vocab: Vocabulary | None) -> tuple[str, bool]:
    """Join two consecutive lines. Returns (text of prev w/o trailing hyphen or with space, joined)."""
    prev = prev.rstrip()
    nxt = nxt.lstrip()
    if not (prev.endswith("-") and len(prev) > 1 and prev[-2].isalpha() and nxt[:1].isalpha()):
        return prev + " ", False
    head = re.search(r"([A-Za-zÀ-ɏ]+(?:-[A-Za-zÀ-ɏ]+)*)-$", prev)
    tail = re.match(r"[A-Za-zÀ-ɏ]+(?:-[A-Za-zÀ-ɏ]+)*", nxt)
    if not head or not tail:
        return prev + " ", False
    a, b = head.group(1), tail.group(0)
    if nxt[0].isupper():
        return prev, True  # keep hyphen: compound with a proper noun, e.g. "Cauchy-Schwarz"
    hyph, joined = f"{a}-{b}", f"{a}{b}"
    # evidence from the document itself beats any heuristic
    if vocab is not None:
        if hyph in vocab and joined not in vocab:
            return prev, True
        if joined in vocab:
            return prev[:-1], True
    last = a.rsplit("-", 1)[-1].lower()
    if "-" in a or len(last) == 1 or last in _KEEP_PREFIXES:
        return prev, True  # "state-of-" + "the-art", "x-" + "axis": the hyphen is real
    return prev[:-1], True  # ordinary soft hyphenation: "repre-" + "sentation"


def garbled_ratio(text: str) -> float:
    if not text:
        return 0.0
    bad = sum(len(m.group(0)) for m in _GARBLED.finditer(text))
    return min(1.0, bad / max(len(text), 1))


def has_garbled(text: str) -> bool:
    return bool(_GARBLED.search(text))


_STOP = {
    "en": ["the", "of", "and", "to", "in", "is", "that", "for", "with", "as", "on", "we", "by", "this", "are", "from", "an", "be", "at", "which", "our", "can", "it", "or", "not", "has", "have", "using", "results", "method"],
    "tr": ["ve", "bir", "bu", "için", "ile", "da", "de", "olarak", "daha", "çok", "gibi", "olan", "en", "kadar", "sonra", "ancak", "ise", "ya", "veya", "bunu", "yöntem", "sonuçlar", "çalışma"],
    "de": ["der", "die", "und", "das", "ist", "nicht", "ein", "mit", "für", "auf", "den", "von", "zu", "wir", "eine", "sich", "auch", "werden"],
    "fr": ["le", "la", "les", "des", "et", "est", "pour", "dans", "que", "une", "nous", "avec", "sur", "par", "pas", "plus", "cette", "sont"],
    "es": ["el", "la", "los", "las", "de", "que", "y", "en", "un", "una", "para", "con", "por", "se", "del", "como", "más", "este", "nuestro"],
}


def guess_language(text: str) -> str | None:
    words = re.findall(r"[a-zA-ZÀ-ɏ]+", text.lower())
    if len(words) < 30:
        return None
    counts = Counter(words)
    scores = {lang: sum(counts[w] for w in set(sw)) / len(words) for lang, sw in _STOP.items()}
    lang, best = max(scores.items(), key=lambda kv: kv[1])
    return lang if best > 0.08 else None
