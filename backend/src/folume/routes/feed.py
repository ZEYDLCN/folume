"""Following new papers: `GET /v1/feed/arxiv`."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request

from ..feed import FeedError

router = APIRouter()

_STATUS = {"bad_query": 422, "bad_feed": 502, "feed_failed": 502}


@router.get("/feed/arxiv")
def arxiv_feed(
    request: Request,
    category: str | None = Query(default=None, max_length=40, description="An arXiv category such as cs.LG"),
    q: str | None = Query(default=None, max_length=300, description="Keywords"),
    limit: int = Query(default=20),
) -> dict:
    if not request.app.state.settings.feed:
        raise HTTPException(status_code=404, detail={"code": "feed_disabled", "message": "Following arXiv is turned off on this server"})
    try:
        return request.app.state.feed.get(category, q, limit)
    except FeedError as exc:
        status = _STATUS.get(exc.code, 502)
        # a failure says what went wrong in general terms; it never repeats an address
        raise HTTPException(status_code=status, detail={"code": exc.code, "message": exc.message}) from None
