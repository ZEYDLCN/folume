"""Conversion jobs: PDF bytes are processed in memory; only the result files touch the disk, in a
per-job directory that is removed when the client deletes the job or the TTL elapses."""

from __future__ import annotations

import logging
import shutil
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

from .config import Settings
from .parsing.pipeline import ParseError, ParseOptions, parse_pdf

log = logging.getLogger(__name__)


@dataclass
class Job:
    id: str
    filename: str
    created: float
    expires: float
    status: str = "queued"  # queued | processing | done | failed
    stage: str = "queued"
    fraction: float = 0.0
    error: dict | None = None
    directory: Path | None = None
    lock: threading.Lock = field(default_factory=threading.Lock)

    def public(self) -> dict:
        return {
            "id": self.id,
            "status": self.status,
            "stage": self.stage,
            "progress": round(self.fraction, 3),
            "error": self.error,
            "expires_at": int(self.expires),
        }


class QueueFull(Exception):
    pass


class JobManager:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        self._pool = ThreadPoolExecutor(max_workers=max(1, settings.workers), thread_name_prefix="folume-parse")
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        self._purge_orphans()

    # -- lifecycle --------------------------------------------------------------------------------
    def _purge_orphans(self) -> None:
        """Result directories left by a previous process are deleted: nothing outlives its TTL."""
        for child in self.settings.data_dir.iterdir():
            if child.is_dir():
                shutil.rmtree(child, ignore_errors=True)

    def shutdown(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)
        for job_id in list(self.jobs):
            self.delete(job_id)

    def submit(self, data: bytes, filename: str) -> Job:
        self.sweep()
        with self._lock:
            active = sum(1 for j in self.jobs.values() if j.status in ("queued", "processing"))
            if active >= self.settings.max_queued_jobs:
                raise QueueFull()
            now = time.time()
            job = Job(id=uuid.uuid4().hex, filename=filename, created=now, expires=now + self.settings.job_ttl_seconds)
            self.jobs[job.id] = job
        self._pool.submit(self._run, job, data)
        return job

    def get(self, job_id: str) -> Job | None:
        self.sweep()
        return self.jobs.get(job_id)

    def delete(self, job_id: str) -> bool:
        with self._lock:
            job = self.jobs.pop(job_id, None)
        if job is None:
            return False
        if job.directory is not None:
            shutil.rmtree(job.directory, ignore_errors=True)
        return True

    def sweep(self) -> None:
        now = time.time()
        for job_id, job in list(self.jobs.items()):
            if job.expires <= now and job.status in ("done", "failed"):
                self.delete(job_id)

    # -- worker ---------------------------------------------------------------------------------------
    def _progress(self, job: Job):
        def report(stage: str, fraction: float) -> None:
            job.stage, job.fraction = stage, fraction

        return report

    def _run(self, job: Job, data: bytes) -> None:
        job.status = "processing"
        try:
            opts = ParseOptions(max_pages=self.settings.max_pages)
            result = parse_pdf(data, job.filename, opts, self._progress(job))
            directory = self.settings.data_dir / job.id
            directory.mkdir(parents=True, exist_ok=True)
            for rel, blob in result.assets.items():
                target = directory / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(blob)
            (directory / "document.json").write_text(result.document.model_dump_json(), encoding="utf-8")
            job.directory = directory
            job.stage, job.fraction, job.status = "done", 1.0, "done"
            job.expires = time.time() + self.settings.job_ttl_seconds
        except ParseError as exc:
            job.error = {"code": exc.code, "message": exc.message}
            job.status = "failed"
        except Exception:
            # never log the document or its text: only that conversion failed
            log.exception("conversion failed for job %s", job.id)
            job.error = {"code": "conversion_failed", "message": "The document could not be converted"}
            job.status = "failed"
        finally:
            job.expires = time.time() + self.settings.job_ttl_seconds
