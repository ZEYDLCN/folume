"""Following new papers on arXiv: the Atom feed is read by a parser that refuses entity tricks, fetched only from
arXiv's API through the guarded fetcher, cached, and spaced out as arXiv asks."""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

from folume.config import Settings
from folume.feed import FeedError, FeedService, build_url, parse_atom
from folume.fetch import Fetcher
from folume.main import create_app

ATOM = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"
      xmlns:arxiv="http://arxiv.org/schemas/atom">
  <title>ArXiv Query: search_query=cat:cs.LG</title>
  <opensearch:totalResults>3</opensearch:totalResults>
  <entry>
    <id>http://arxiv.org/abs/2401.01234v2</id>
    <updated>2024-01-05T10:00:00Z</updated>
    <published>2024-01-03T09:30:00Z</published>
    <title>Sparse Routing
  for Efficient   Transformers</title>
    <summary>  We study routing.
  It is sparse. </summary>
    <author><name>Quinn Rossi</name></author>
    <author><name>Deniz Cohen</name></author>
    <arxiv:comment>12 pages, 3 figures</arxiv:comment>
    <arxiv:doi>10.1000/xyz123</arxiv:doi>
    <link href="http://arxiv.org/abs/2401.01234v2" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/2401.01234v2" rel="related" type="application/pdf"/>
    <arxiv:primary_category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
    <category term="stat.ML" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/hep-th/9901001v1</id>
    <updated>2024-01-04T10:00:00Z</updated>
    <published>2024-01-04T10:00:00Z</published>
    <title>An old-style identifier</title>
    <summary>Short.</summary>
    <author><name>Ada Lovelace</name></author>
    <link href="http://arxiv.org/abs/hep-th/9901001v1" rel="alternate" type="text/html"/>
    <arxiv:primary_category term="hep-th" scheme="http://arxiv.org/schemas/atom"/>
    <category term="hep-th" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>
"""

ERROR_ATOM = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry><id>http://arxiv.org/api/errors#incorrect_id_format_for_1234</id><title>Error</title>
  <summary>incorrect id format</summary></entry>
</feed>
"""


# -------------------------------------------------------------------------------------------------- parsing


def test_an_entry_becomes_a_paper_with_clean_text():
    first, second = parse_atom(ATOM.encode())
    assert first == {
        "id": "2401.01234",
        "version": 2,
        "title": "Sparse Routing for Efficient Transformers",
        "authors": ["Quinn Rossi", "Deniz Cohen"],
        "summary": "We study routing. It is sparse.",
        "published": "2024-01-03T09:30:00Z",
        "updated": "2024-01-05T10:00:00Z",
        "primary_category": "cs.LG",
        "categories": ["cs.LG", "stat.ML"],
        "abs_url": "https://arxiv.org/abs/2401.01234",
        "pdf_url": "https://arxiv.org/pdf/2401.01234",
        "doi": "10.1000/xyz123",
        "comment": "12 pages, 3 figures",
    }
    assert second["id"] == "hep-th/9901001" and second["doi"] is None and second["comment"] is None
    assert second["abs_url"] == "https://arxiv.org/abs/hep-th/9901001"


def test_an_empty_feed_is_an_empty_list():
    assert parse_atom(b'<feed xmlns="http://www.w3.org/2005/Atom"></feed>') == []


@pytest.mark.parametrize(
    "evil",
    [
        b'<?xml version="1.0"?><!DOCTYPE feed [<!ENTITY a "x">]><feed xmlns="http://www.w3.org/2005/Atom">&a;</feed>',
        b'<!DOCTYPE feed SYSTEM "http://example.org/x.dtd"><feed xmlns="http://www.w3.org/2005/Atom"/>',
        b'<?xml version="1.0"?><!doctype feed><feed xmlns="http://www.w3.org/2005/Atom"/>',
        b'<feed xmlns="http://www.w3.org/2005/Atom"><!ENTITY x "y"></feed>',
    ],
)
def test_entity_declarations_are_refused_before_anything_is_expanded(evil):
    with pytest.raises(FeedError) as e:
        parse_atom(evil)
    assert e.value.code == "bad_feed"


def test_garbage_and_arxiv_error_entries_are_reported_not_shown_as_papers():
    for bad in (b"not xml at all", b"<feed", b"", b"<html></html>"):
        with pytest.raises(FeedError):
            parse_atom(bad)
    with pytest.raises(FeedError) as e:
        parse_atom(ERROR_ATOM.encode())
    assert e.value.code == "bad_query"


def test_an_entry_without_an_arxiv_id_is_left_out_rather_than_made_up():
    odd = ATOM.replace("http://arxiv.org/abs/2401.01234v2</id>", "http://example.org/not-arxiv</id>", 1)
    assert [p["id"] for p in parse_atom(odd.encode())] == ["hep-th/9901001"]


# ------------------------------------------------------------------------------------------------ the query


def test_the_address_is_arxivs_api_with_a_category_and_keywords():
    url = build_url("cs.LG", "sparse routing", 20)
    assert url.startswith("https://export.arxiv.org/api/query?")
    q = httpx.URL(url).params
    assert q["search_query"] == 'cat:cs.LG AND all:"sparse routing"'
    assert q["sortBy"] == "submittedDate" and q["sortOrder"] == "descending" and q["max_results"] == "20"


def test_either_a_category_or_keywords_is_enough():
    assert httpx.URL(build_url("cs.CL", None, 5)).params["search_query"] == "cat:cs.CL"
    assert httpx.URL(build_url(None, "graph neural", 5)).params["search_query"] == 'all:"graph neural"'


@pytest.mark.parametrize("category", ["cs.LG; rm -rf", "cs.LG&max_results=1000", "../x", "cs LG", "a" * 40, "cs.LG\n"])
def test_a_category_cannot_smuggle_in_other_query_parts(category):
    with pytest.raises(FeedError) as e:
        build_url(category, None, 10)
    assert e.value.code == "bad_query"


def test_keywords_are_reduced_to_words_and_cannot_break_the_phrase():
    q = httpx.URL(build_url(None, 'x" OR all:"y & z+ö', 10)).params["search_query"]
    assert q.count('"') == 2 and "&" not in q and "+" not in q
    assert "ö" in q
    with pytest.raises(FeedError):
        build_url(None, '"" ;; ', 10)
    with pytest.raises(FeedError):
        build_url(None, None, 10)
    with pytest.raises(FeedError):
        build_url(None, "x" * 300, 10)


def test_the_operator_can_point_the_server_at_a_mirror():
    url = build_url("cs.LG", None, 5, base="https://mirror.example.org/api/query")
    assert url.startswith("https://mirror.example.org/api/query?")
    assert Settings.from_env({"FOLUME_FEED_URL": "http://127.0.0.1:9/api/query"}).feed_url == "http://127.0.0.1:9/api/query"
    assert Settings.from_env({}).feed_url == "https://export.arxiv.org/api/query"


def test_the_number_of_results_is_kept_within_bounds():
    assert httpx.URL(build_url("cs.LG", None, 0)).params["max_results"] == "1"
    assert httpx.URL(build_url("cs.LG", None, 10_000)).params["max_results"] == "50"


# --------------------------------------------------------------------------------- fetching, caching, spacing


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0
        self.slept: list[float] = []

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds


def service(handler, clock: Clock | None = None, **kw) -> tuple[FeedService, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def wrapped(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    clock = clock or Clock()
    fetcher = Fetcher(resolver=lambda host: ["151.101.1.1"], transport=httpx.MockTransport(wrapped))
    return FeedService(fetcher, clock=clock, sleep=clock.sleep, **kw), seen


def ok(_: httpx.Request) -> httpx.Response:
    return httpx.Response(200, content=ATOM.encode(), headers={"content-type": "application/atom+xml"})


def test_papers_are_fetched_from_arxiv_only_and_returned_newest_first():
    svc, seen = service(ok)
    out = svc.get("cs.LG", None, 20)
    assert [p["id"] for p in out["items"]] == ["2401.01234", "hep-th/9901001"]
    assert out["cached"] is False
    assert len(seen) == 1 and seen[0].url.host == "151.101.1.1" and seen[0].headers["Host"] == "export.arxiv.org"
    assert "Folume/" in seen[0].headers["User-Agent"]


def test_the_same_question_is_answered_from_memory_for_a_while():
    clock = Clock()
    svc, seen = service(ok, clock, ttl=900)
    svc.get("cs.LG", None, 20)
    again = svc.get("cs.LG", None, 20)
    assert again["cached"] is True and len(seen) == 1
    assert svc.get("cs.LG", "sparse", 20)["cached"] is False
    clock.now += 901
    assert svc.get("cs.LG", None, 20)["cached"] is False


def test_asking_arxiv_again_too_soon_waits_instead_of_hammering_it():
    clock = Clock()
    svc, _ = service(ok, clock, min_interval=3.0)
    svc.get("cs.LG", None, 20)
    svc.get("cs.CL", None, 20)
    assert clock.slept and 2.9 < clock.slept[0] <= 3.0


def test_a_failing_arxiv_is_reported_and_an_older_answer_is_still_given():
    clock = Clock()
    state = {"fail": False}

    def handler(r):
        return httpx.Response(503) if state["fail"] else ok(r)

    svc, _ = service(handler, clock, ttl=10)
    svc.get("cs.LG", None, 20)
    clock.now += 60
    state["fail"] = True
    stale = svc.get("cs.LG", None, 20)
    assert stale["cached"] is True and stale["stale"] is True and len(stale["items"]) == 2
    with pytest.raises(FeedError) as e:
        svc.get("cs.CV", None, 20)
    assert e.value.code == "feed_failed"


def test_a_private_address_is_never_contacted():
    fetcher = Fetcher(resolver=lambda host: ["10.0.0.5"], transport=httpx.MockTransport(lambda r: httpx.Response(200)))
    clock = Clock()
    with pytest.raises(FeedError) as e:
        FeedService(fetcher, clock=clock, sleep=clock.sleep).get("cs.LG", None, 5)
    assert e.value.code == "feed_failed"


def test_an_oversized_answer_is_cut_off():
    def big(_):
        return httpx.Response(200, content=b"<feed>" + b"x" * 3_000_000)

    svc, _ = service(big)
    with pytest.raises(FeedError):
        svc.get("cs.LG", None, 5)


# -------------------------------------------------------------------------------------------------------- API


def api(handler, **settings) -> TestClient:
    fetcher = Fetcher(resolver=lambda host: ["151.101.1.1"], transport=httpx.MockTransport(handler))
    clock = Clock()
    app = create_app(
        Settings(**settings),
        feed=FeedService(fetcher, clock=clock, sleep=clock.sleep),
    )
    return TestClient(app)


def test_the_feed_endpoint_returns_papers():
    with api(ok) as c:
        r = c.get("/v1/feed/arxiv", params={"category": "cs.LG", "limit": 5})
        assert r.status_code == 200
        body = r.json()
        assert [p["id"] for p in body["items"]] == ["2401.01234", "hep-th/9901001"]
        assert body["source"] == "arxiv"


def test_the_endpoint_needs_a_category_or_keywords_and_refuses_odd_ones():
    with api(ok) as c:
        assert c.get("/v1/feed/arxiv").status_code == 422
        bad = c.get("/v1/feed/arxiv", params={"category": "cs.LG&x=1"})
        assert bad.status_code == 422 and bad.json()["error"]["code"] == "bad_query"
        assert c.get("/v1/feed/arxiv", params={"category": "cs.LG", "limit": "many"}).status_code == 422


def test_an_unreachable_arxiv_is_a_502_that_does_not_echo_addresses():
    with api(lambda r: httpx.Response(500)) as c:
        r = c.get("/v1/feed/arxiv", params={"category": "cs.LG"})
        assert r.status_code == 502 and r.json()["error"]["code"] == "feed_failed"
        assert "arxiv.org" not in r.text


def test_it_can_be_switched_off_and_is_announced_in_the_capabilities():
    with api(ok) as c:
        assert c.get("/v1/capabilities").json()["feed"] is True
    with api(ok, feed=False) as c:
        assert c.get("/v1/capabilities").json()["feed"] is False
        r = c.get("/v1/feed/arxiv", params={"category": "cs.LG"})
        assert r.status_code == 404 and r.json()["error"]["code"] == "feed_disabled"


def test_it_is_behind_the_api_key_like_everything_else():
    with api(ok, api_key="s3cret") as c:
        assert c.get("/v1/feed/arxiv", params={"category": "cs.LG"}).status_code == 401
        assert c.get("/v1/feed/arxiv", params={"category": "cs.LG"}, headers={"X-API-Key": "s3cret"}).status_code == 200
