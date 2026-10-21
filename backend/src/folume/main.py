"""FastAPI application factory."""

from __future__ import annotations

import hmac
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import __version__
from .ai.providers import LLMProvider, build_provider
from .ai.service import AiService
from .config import Settings
from .jobs import JobManager
from .sync_store import SyncStore


def create_app(settings: Settings | None = None, *, llm_provider: LLMProvider | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    jobs = JobManager(settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield
        jobs.shutdown()
        if app.state.sync is not None:
            app.state.sync.close()

    app = FastAPI(title="Folume API", version=__version__, lifespan=lifespan)
    app.state.settings = settings
    app.state.jobs = jobs
    app.state.ai = AiService(settings, llm_provider or build_provider(settings))
    app.state.sync = SyncStore(settings.sync_db) if settings.sync_enabled else None

    if settings.cors_origins:
        app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"],
                           allow_headers=["*"])

    def require_key(x_api_key: str | None = Header(default=None)) -> None:
        if settings.api_key is None:
            return
        if x_api_key is None or not hmac.compare_digest(x_api_key, settings.api_key):
            raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Invalid API key"})

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_, exc: RequestValidationError):
        # report which fields are wrong, never the submitted values (they may be paper text)
        fields = [{"field": ".".join(str(p) for p in e["loc"]), "problem": e["type"]} for e in exc.errors()]
        return JSONResponse(status_code=422, content={"error": {
            "code": "invalid_request", "message": "The request is not valid", "fields": fields}})

    @app.exception_handler(HTTPException)
    async def http_error(_, exc: HTTPException):
        detail = exc.detail if isinstance(exc.detail, dict) else {"code": "error", "message": str(exc.detail)}
        return JSONResponse(status_code=exc.status_code, content={"error": detail})

    from .routes import ai, documents, sync  # noqa: PLC0415 (routes read the app state)
    from .routes.ai import RateLimiter  # noqa: PLC0415

    app.state.ai_limiter = RateLimiter(limit=settings.ai_rate_limit_per_minute)
    guarded = [Depends(require_key)]
    app.include_router(documents.router, prefix="/v1", dependencies=guarded)
    app.include_router(ai.router, prefix="/v1", dependencies=guarded)
    app.include_router(sync.router, prefix="/v1", dependencies=guarded)

    @app.get("/v1/health")
    def health() -> dict:
        return {"status": "ok", "version": __version__}

    return app


_app: FastAPI | None = None


def __getattr__(name: str):
    """`uvicorn folume.main:app` builds the application lazily, so importing the module is side-effect free."""
    global _app
    if name == "app":
        if _app is None:
            _app = create_app()
        return _app
    raise AttributeError(name)
