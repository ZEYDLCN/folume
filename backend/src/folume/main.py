"""FastAPI application factory."""

from __future__ import annotations

import hmac
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import __version__
from .config import Settings
from .jobs import JobManager


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    jobs = JobManager(settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield
        jobs.shutdown()

    app = FastAPI(title="Folume API", version=__version__, lifespan=lifespan)
    app.state.settings = settings
    app.state.jobs = jobs

    if settings.cors_origins:
        app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"],
                           allow_headers=["*"])

    def require_key(x_api_key: str | None = Header(default=None)) -> None:
        if settings.api_key is None:
            return
        if x_api_key is None or not hmac.compare_digest(x_api_key, settings.api_key):
            raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Invalid API key"})

    @app.exception_handler(HTTPException)
    async def http_error(_, exc: HTTPException):
        detail = exc.detail if isinstance(exc.detail, dict) else {"code": "error", "message": str(exc.detail)}
        return JSONResponse(status_code=exc.status_code, content={"error": detail})

    from .routes import documents  # noqa: PLC0415 (routes read the app state)

    guarded = [Depends(require_key)]
    app.include_router(documents.router, prefix="/v1", dependencies=guarded)

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
