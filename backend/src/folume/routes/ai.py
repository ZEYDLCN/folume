"""AI gateway endpoints. Bodies are never logged; errors never echo content."""

from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import APIRouter, HTTPException, Request

from ..ai.schemas import (
    AiStatus,
    CompareRequest,
    CompareResponse,
    ExplainRequest,
    ExplainResponse,
    QuizRequest,
    QuizResponse,
)
from ..ai.service import AiService, NotAvailable

router = APIRouter(prefix="/ai")


class RateLimiter:
    """Sliding window per client (API key or address): protects the model budget, not a security boundary."""

    def __init__(self, limit: int, window: float = 60.0):
        self.limit, self.window = limit, window
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str) -> None:
        now = time.monotonic()
        q = self.hits[key]
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.limit:
            raise HTTPException(status_code=429, detail={"code": "rate_limited", "message": "Too many AI requests"})
        q.append(now)


def _service(request: Request) -> AiService:
    key = request.headers.get("x-api-key") or (request.client.host if request.client else "anon")
    request.app.state.ai_limiter.check(key)
    return request.app.state.ai


@router.get("/status")
def status(request: Request) -> AiStatus:
    return request.app.state.ai.status()


@router.post("/explain")
async def explain(req: ExplainRequest, request: Request) -> ExplainResponse:
    try:
        return await _service(request).explain(req)
    except ValueError:
        raise HTTPException(status_code=422, detail={"code": "invalid_request",
                                                     "message": "selection_id must refer to a passage"}) from None
    except NotAvailable as exc:
        raise HTTPException(status_code=501, detail={"code": "ai_not_available", "message": str(exc)}) from None


@router.post("/quiz")
async def quiz(req: QuizRequest, request: Request) -> QuizResponse:
    return await _service(request).quiz(req)


@router.post("/compare")
async def compare(req: CompareRequest, request: Request) -> CompareResponse:
    try:
        return await _service(request).compare(req)
    except ValueError:
        raise HTTPException(status_code=422, detail={"code": "invalid_request",
                                                     "message": "passage ids must be unique"}) from None
