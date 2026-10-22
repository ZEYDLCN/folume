"""Following new papers on arXiv.

arXiv publishes an Atom feed of its listings. This reads it for the app: a category and/or keywords in, the newest
papers out. The server only ever contacts arXiv's API (never an address chosen by the caller), through the same guarded
fetcher as link import; the feed is parsed by code that refuses entity declarations; answers are kept for a while and
requests are spaced out, because arXiv asks API users to cache and to wait a few seconds between calls.
"""

from __future__ import annotations

import re
import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from urllib.parse import urlencode
from xml.etree import ElementTree as ET

from .fetch import _ARXIV_NEW, _ARXIV_OLD, Fetcher, FetchError

API = "https://export.arxiv.org/api/query"
MAX_FEED_BYTES = 2 * 1024 * 1024
MAX_RESULTS = 50
MAX_KEYWORDS = 200

_ATOM = "{http://www.w3.org/2005/Atom}"
_ARXIV = "{http://arxiv.org/schemas/atom}"
_CATEGORY = re.compile(r"^[A-Za-z][A-Za-z\-]{0,19}(?:\.[A-Za-z\-]{1,19})?$")
_ID = re.compile(rf"^(?:{_ARXIV_NEW}|{_ARXIV_OLD})$")
_ABS = re.compile(r"^https?://(?:www\.)?arxiv\.org/abs/(?P<id>.+?)(?:v(?P<v>\d+))?$")
_DOI = re.compile(r"^10\.\d{4,9}/\S+$")
_DECLARATION = re.compile(rb"<!\s*(?:doctype|entity)", re.I)


class FeedError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


# ------------------------------------------------------------------------------------------------------- the query


def _terms(keywords: str) -> str:
    """Words only: whatever could end or extend the quoted phrase (quotes, operators, separators) is dropped."""
    words = re.findall(r"[\w\-]+", keywords, flags=re.UNICODE)
    return " ".join(w for w in words if w.strip("-_"))


def build_url(category: str | None, keywords: str | None, limit: int) -> str:
    parts: list[str] = []
    if category:
        if not _CATEGORY.fullmatch(category):
            raise FeedError("bad_query", "That is not an arXiv category such as cs.LG")
        parts.append(f"cat:{category}")
    if keywords and keywords.strip():
        if len(keywords) > MAX_KEYWORDS:
            raise FeedError("bad_query", "The keywords are too long")
        words = _terms(keywords)
        if not words:
            raise FeedError("bad_query", "The keywords contain no words")
        parts.append(f'all:"{words}"')
    if not parts:
        raise FeedError("bad_query", "Give a category or keywords")
    query = {
        "search_query": " AND ".join(parts),
        "sortBy": "submittedDate",
        "sortOrder": "descending",
        "max_results": str(max(1, min(MAX_RESULTS, int(limit)))),
    }
    return f"{API}?{urlencode(query)}"


# ------------------------------------------------------------------------------------------------------- parsing


def _text(node: ET.Element | None) -> str:
    return re.sub(r"\s+", " ", node.text or "").strip() if node is not None and node.text else ""


def parse_atom(data: bytes) -> list[dict]:
    """The papers of an arXiv Atom feed. Nothing is made up: an entry without a valid arXiv id is left out."""
    head = data[:4]
    if b"\x00" in data[:64] or head[:2] in (b"\xff\xfe", b"\xfe\xff") or _DECLARATION.search(data):
        raise FeedError("bad_feed", "The feed is not in a form that can be read safely")
    try:
        root = ET.fromstring(data)
    except ET.ParseError as exc:
        raise FeedError("bad_feed", "The feed could not be read") from exc
    if root.tag != f"{_ATOM}feed":
        raise FeedError("bad_feed", "That is not an Atom feed")
    items: list[dict] = []
    for entry in root.findall(f"{_ATOM}entry"):
        ident = _text(entry.find(f"{_ATOM}id"))
        if "/api/errors" in ident:
            raise FeedError("bad_query", "arXiv did not accept the query")
        m = _ABS.match(ident)
        if not m or not _ID.fullmatch(m.group("id")):
            continue
        arxiv_id = m.group("id")
        categories = [
            c.get("term", "") for c in entry.findall(f"{_ATOM}category") if _CATEGORY.fullmatch(c.get("term", ""))
        ]
        primary = entry.find(f"{_ARXIV}primary_category")
        primary_term = primary.get("term", "") if primary is not None else ""
        doi = _text(entry.find(f"{_ARXIV}doi"))
        items.append({
            "id": arxiv_id,
            "version": int(m.group("v")) if m.group("v") else None,
            "title": _text(entry.find(f"{_ATOM}title")),
            "authors": [n for n in (_text(a.find(f"{_ATOM}name")) for a in entry.findall(f"{_ATOM}author")) if n],
            "summary": _text(entry.find(f"{_ATOM}summary")),
            "published": _text(entry.find(f"{_ATOM}published")),
            "updated": _text(entry.find(f"{_ATOM}updated")),
            "primary_category": primary_term if _CATEGORY.fullmatch(primary_term) else (categories[0] if categories else None),
            "categories": categories,
            "abs_url": f"https://arxiv.org/abs/{arxiv_id}",
            "pdf_url": f"https://arxiv.org/pdf/{arxiv_id}",
            "doi": doi if _DOI.fullmatch(doi) else None,
            "comment": _text(entry.find(f"{_ARXIV}comment")) or None,
        })
    return items


# ------------------------------------------------------------------------------------------------------ service


class FeedService:
    def __init__(
        self,
        fetcher: Fetcher,
        *,
        ttl: float = 900.0,
        min_interval: float = 3.0,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
        max_cached: int = 64,
    ):
        self.fetcher = fetcher
        self.ttl = ttl
        self.min_interval = min_interval
        self.clock = clock
        self.sleep = sleep
        self.max_cached = max_cached
        self._lock = threading.Lock()
        self._cache: OrderedDict[tuple[str, str, int], tuple[float, list[dict]]] = OrderedDict()
        self._last_request: float | None = None

    def get(self, category: str | None, keywords: str | None, limit: int) -> dict:
        url = build_url(category, keywords, limit)  # validates before anything is looked up
        key = (category or "", _terms(keywords or "").lower(), max(1, min(MAX_RESULTS, int(limit))))
        with self._lock:
            hit = self._cache.get(key)
            if hit and self.clock() - hit[0] < self.ttl:
                self._cache.move_to_end(key)
                return {"source": "arxiv", "items": hit[1], "cached": True, "stale": False}
            if self._last_request is not None:
                wait = self.min_interval - (self.clock() - self._last_request)
                if wait > 0:
                    self.sleep(min(wait, self.min_interval))
            self._last_request = self.clock()
            try:
                _, _, body = self.fetcher.get_bytes(url, MAX_FEED_BYTES)
                items = parse_atom(body)
            except (FetchError, FeedError) as exc:
                if hit:
                    return {"source": "arxiv", "items": hit[1], "cached": True, "stale": True}
                if isinstance(exc, FeedError) and exc.code == "bad_query":
                    raise
                raise FeedError("feed_failed", "arXiv could not be reached just now") from exc
            self._cache[key] = (self.clock(), items)
            self._cache.move_to_end(key)
            while len(self._cache) > self.max_cached:
                self._cache.popitem(last=False)
            return {"source": "arxiv", "items": items, "cached": False, "stale": False}
