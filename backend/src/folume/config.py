"""Runtime configuration, read from environment variables (prefix FOLUME_)."""

from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass, field
from pathlib import Path


def _bool(v: str | None, default: bool = False) -> bool:
    if v is None:
        return default
    return v.strip().lower() in {"1", "true", "yes", "on"}


def _effort(v: str | None) -> str | None:
    value = (v or "").strip().lower()
    return value if value in {"none", "minimal", "low", "medium", "high"} else None


@dataclass
class Settings:
    api_key: str | None = None  # when set, every /v1 request must send X-API-Key
    max_upload_mb: int = 50
    max_pages: int = 300
    job_ttl_seconds: int = 3600  # result files are deleted after this, or right after the client deletes the job
    # each conversion runs in its own process so a hostile or pathological PDF can be stopped and cannot take
    # the server down: wall-clock limit and address-space limit (0 = unlimited)
    isolate_jobs: bool = True
    job_timeout_seconds: float = 300.0
    max_memory_mb: int = 4096
    max_queued_jobs: int = 16
    workers: int = 2
    data_dir: Path = field(default_factory=lambda: Path(tempfile.gettempdir()) / "folume-jobs")
    cors_origins: list[str] = field(default_factory=list)
    # importing a paper from a link: the server downloads it, so private networks are off limits unless allowed
    url_import: bool = True
    allow_private_urls: bool = False
    url_timeout_seconds: float = 60.0
    # following new papers on arXiv: the server asks arXiv's public API on the reader's behalf
    feed: bool = True
    feed_url: str = "https://export.arxiv.org/api/query"  # where the listings come from (a mirror, or a test server)
    # optional OCR for scanned PDFs (needs the `ocr` extra); it is slow, so a scan longer than this is refused
    ocr: bool = False
    ocr_max_pages: int = 60
    # AI gateway (all optional: without a model the gateway answers from the supplied passages only)
    llm_base_url: str | None = None
    llm_api_key: str | None = None
    llm_model: str | None = None
    llm_fallback_models: list[str] = field(default_factory=list)  # tried in order when the model above fails
    llm_vision: bool = False
    llm_timeout_seconds: float = 60.0
    # for models that think before they answer (reasoning models): more room for the answer, and less thinking
    llm_max_tokens: int = 0  # 0 = what each request asks for; otherwise the larger of the two
    llm_reasoning_effort: str | None = None  # none | minimal | low | medium | high
    ai_rate_limit_per_minute: int = 40
    # optional multi-device sync
    sync_enabled: bool = False
    sync_db: Path = field(default_factory=lambda: Path("var") / "sync.sqlite3")

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> Settings:
        e = env if env is not None else os.environ
        defaults = cls()
        return cls(
            api_key=e.get("FOLUME_API_KEY") or None,
            max_upload_mb=int(e.get("FOLUME_MAX_UPLOAD_MB", defaults.max_upload_mb)),
            max_pages=int(e.get("FOLUME_MAX_PAGES", defaults.max_pages)),
            job_ttl_seconds=int(e.get("FOLUME_JOB_TTL_SECONDS", defaults.job_ttl_seconds)),
            isolate_jobs=_bool(e.get("FOLUME_ISOLATE_JOBS"), defaults.isolate_jobs),
            job_timeout_seconds=float(e.get("FOLUME_JOB_TIMEOUT_SECONDS", defaults.job_timeout_seconds)),
            max_memory_mb=int(e.get("FOLUME_MAX_MEMORY_MB", defaults.max_memory_mb)),
            max_queued_jobs=int(e.get("FOLUME_MAX_QUEUED_JOBS", defaults.max_queued_jobs)),
            workers=int(e.get("FOLUME_WORKERS", defaults.workers)),
            data_dir=Path(e.get("FOLUME_DATA_DIR", str(defaults.data_dir))),
            cors_origins=[o.strip() for o in e.get("FOLUME_CORS_ORIGINS", "").split(",") if o.strip()],
            url_import=_bool(e.get("FOLUME_URL_IMPORT"), defaults.url_import),
            allow_private_urls=_bool(e.get("FOLUME_ALLOW_PRIVATE_URLS")),
            url_timeout_seconds=float(e.get("FOLUME_URL_TIMEOUT_SECONDS", defaults.url_timeout_seconds)),
            feed=_bool(e.get("FOLUME_FEED"), defaults.feed),
            feed_url=e.get("FOLUME_FEED_URL") or defaults.feed_url,
            ocr=_bool(e.get("FOLUME_OCR"), defaults.ocr),
            ocr_max_pages=int(e.get("FOLUME_OCR_MAX_PAGES", defaults.ocr_max_pages)),
            llm_base_url=e.get("FOLUME_LLM_BASE_URL") or None,
            llm_api_key=e.get("FOLUME_LLM_API_KEY") or None,
            llm_model=e.get("FOLUME_LLM_MODEL") or None,
            llm_fallback_models=[m.strip() for m in (e.get("FOLUME_LLM_FALLBACK_MODELS") or "").split(",") if m.strip()],
            llm_vision=_bool(e.get("FOLUME_LLM_VISION")),
            llm_timeout_seconds=float(e.get("FOLUME_LLM_TIMEOUT_SECONDS", defaults.llm_timeout_seconds)),
            llm_max_tokens=max(0, int(e.get("FOLUME_LLM_MAX_TOKENS", defaults.llm_max_tokens))),
            llm_reasoning_effort=_effort(e.get("FOLUME_LLM_REASONING_EFFORT")),
            ai_rate_limit_per_minute=int(e.get("FOLUME_AI_RATE_LIMIT", defaults.ai_rate_limit_per_minute)),
            sync_enabled=_bool(e.get("FOLUME_SYNC_ENABLED")),
            sync_db=Path(e.get("FOLUME_SYNC_DB", str(defaults.sync_db))),
        )
