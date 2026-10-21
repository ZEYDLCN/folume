"""Conversion jobs: PDF bytes are processed in memory; only the result files touch the disk, in a
per-job directory that is removed when the client deletes the job or the TTL elapses."""

from __future__ import annotations

import logging
import multiprocessing
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

_CTX = multiprocessing.get_context("forkserver")
_preload_lock = threading.Lock()
_preloaded = False


def _preload() -> None:
    """The fork server imports the parser once, so each conversion process starts in milliseconds."""
    global _preloaded
    with _preload_lock:
        if not _preloaded:
            _CTX.set_forkserver_preload(["folume.parsing.pipeline"])
            _preloaded = True


def _write_result(result, directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    for rel, blob in result.assets.items():
        target = directory / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(blob)
    (directory / "document.json").write_text(result.document.model_dump_json(), encoding="utf-8")


def _convert_in_child(conn, data: bytes, filename: str, max_pages: int, directory: str, max_memory_mb: int) -> None:
    """Entry point of a conversion process: reports progress and the outcome over `conn`, writes results to disk."""
    try:
        if max_memory_mb > 0:
            try:
                import resource  # noqa: PLC0415 (POSIX only)

                limit = max_memory_mb * 1024 * 1024
                resource.setrlimit(resource.RLIMIT_AS, (limit, limit))
            except (ImportError, ValueError, OSError):
                pass
        result = parse_pdf(data, filename, ParseOptions(max_pages=max_pages), lambda stage, f: conn.send(("progress", stage, f)))
        _write_result(result, Path(directory))
        conn.send(("done",))
    except ParseError as exc:
        conn.send(("error", exc.code, exc.message))
    except MemoryError:
        conn.send(("error", "too_complex", "The document is too large or complex to convert"))
    except BaseException:  # noqa: BLE001 never log the document or its text: only that conversion failed
        log.exception("conversion failed")
        conn.send(("error", "conversion_failed", "The document could not be converted"))
    finally:
        conn.close()


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
        directory = self.settings.data_dir / job.id
        try:
            if self.settings.isolate_jobs:
                outcome = self._convert_isolated(job, data, directory)
            else:
                result = parse_pdf(data, job.filename, ParseOptions(max_pages=self.settings.max_pages),
                                   self._progress(job))
                _write_result(result, directory)
                outcome = ("done",)
        except ParseError as exc:
            outcome = ("error", exc.code, exc.message)
        except Exception:
            # never log the document or its text: only that conversion failed
            log.exception("conversion failed for job %s", job.id)
            outcome = ("error", "conversion_failed", "The document could not be converted")
        if outcome[0] == "done":
            job.directory = directory
            job.stage, job.fraction, job.status = "done", 1.0, "done"
        else:
            shutil.rmtree(directory, ignore_errors=True)
            job.error = {"code": outcome[1], "message": outcome[2]}
            job.status = "failed"
        job.expires = time.time() + self.settings.job_ttl_seconds

    def _convert_isolated(self, job: Job, data: bytes, directory: Path) -> tuple:
        _preload()
        parent, child = _CTX.Pipe(duplex=False)
        proc = _CTX.Process(
            target=_convert_in_child,
            args=(child, data, job.filename, self.settings.max_pages, str(directory), self.settings.max_memory_mb),
            daemon=True,
        )
        proc.start()
        child.close()
        deadline = time.monotonic() + self.settings.job_timeout_seconds
        outcome: tuple | None = None
        try:
            while outcome is None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    outcome = ("error", "timeout", "The document took too long to convert")
                    break
                if parent.poll(min(0.2, remaining)):
                    try:
                        msg = parent.recv()
                    except EOFError:
                        break
                    if msg[0] == "progress":
                        job.stage, job.fraction = msg[1], msg[2]
                    else:
                        outcome = msg
                elif not proc.is_alive() and not parent.poll():
                    break
        finally:
            if proc.is_alive():
                proc.kill()
            proc.join(timeout=10)
            parent.close()
        # a process that vanished without a word (killed for memory, crashed in native code)
        return outcome or ("error", "too_complex", "The document is too large or complex to convert")
