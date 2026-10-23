"""PDF upload and conversion-job endpoints."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, ConfigDict, Field

from .. import __version__
from ..fetch import InvalidSource, resolve_source
from ..jobs import JobManager, QueueFull
from ..parsing.ocr import ocr_available

router = APIRouter()
CHUNK = 1024 * 1024


def _jobs(request: Request) -> JobManager:
    return request.app.state.jobs


def _not_found() -> HTTPException:
    return HTTPException(status_code=404, detail={"code": "job_not_found", "message": "Unknown or expired job"})


@router.get("/capabilities")
def capabilities(request: Request) -> dict:
    s = request.app.state.settings
    ocr = s.ocr and ocr_available()  # switched on and the engine can be loaded (the import only happens when it is on)
    return {
        "version": __version__,
        "parser": {"name": "folume-pdfplumber", "scanned_pdf_ocr": ocr},
        "ocr": ocr,
        "limits": {"max_upload_mb": s.max_upload_mb, "max_pages": s.max_pages, "ocr_max_pages": s.ocr_max_pages},
        "retention_seconds": s.job_ttl_seconds,
        "uploads_persisted": False,
        "ai": {"enabled": request.app.state.ai.status().enabled, "vision": request.app.state.ai.status().vision},
        "sync": {"enabled": s.sync_enabled},
        "url_import": s.url_import,
        "feed": s.feed,
    }


class UrlRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str = Field(max_length=2048, description="Page link, PDF link, arXiv id or DOI")


@router.post("/documents/from-url", status_code=202)
def import_from_url(body: UrlRequest, request: Request) -> dict:
    """Download a paper from a link and convert it, as one job. The link itself is never echoed back."""
    settings = request.app.state.settings
    if not settings.url_import:
        raise HTTPException(status_code=404, detail={"code": "url_import_disabled",
                                                     "message": "Importing from a link is not enabled on this server"})
    try:
        candidates = resolve_source(body.url)
    except InvalidSource:
        raise HTTPException(status_code=422, detail={"code": "invalid_url",
                                                     "message": "This does not look like a link to a paper"}) from None
    try:
        job = _jobs(request).submit_url(candidates)
    except QueueFull:
        raise HTTPException(status_code=429, detail={
            "code": "busy", "message": "Too many conversions in progress; try again shortly"}) from None
    return job.public()


@router.post("/documents", status_code=202)
async def upload_document(request: Request, file: UploadFile) -> dict:
    settings = request.app.state.settings
    limit = settings.max_upload_mb * 1024 * 1024
    chunks: list[bytes] = []
    size = 0
    while True:
        chunk = await file.read(CHUNK)
        if not chunk:
            break
        size += len(chunk)
        if size > limit:
            raise HTTPException(status_code=413, detail={
                "code": "file_too_large", "message": f"The file exceeds {settings.max_upload_mb} MB"})
        chunks.append(chunk)
    data = b"".join(chunks)
    if not data.lstrip()[:1024].startswith(b"%PDF"):
        raise HTTPException(status_code=415, detail={"code": "not_a_pdf", "message": "The file is not a PDF document"})
    try:
        job = _jobs(request).submit(data, Path(file.filename or "document.pdf").name)
    except QueueFull:
        raise HTTPException(status_code=429, detail={
            "code": "busy", "message": "Too many conversions in progress; try again shortly"}) from None
    return job.public()


@router.get("/jobs/{job_id}")
def job_status(job_id: str, request: Request) -> dict:
    job = _jobs(request).get(job_id)
    if job is None:
        raise _not_found()
    return job.public()


def _ready_dir(request: Request, job_id: str) -> Path:
    job = _jobs(request).get(job_id)
    if job is None:
        raise _not_found()
    if job.status != "done" or job.directory is None:
        raise HTTPException(status_code=409, detail={"code": "not_ready", "message": f"Job is {job.status}"})
    return job.directory


@router.get("/jobs/{job_id}/document")
def job_document(job_id: str, request: Request) -> FileResponse:
    return FileResponse(_ready_dir(request, job_id) / "document.json", media_type="application/json")


@router.get("/jobs/{job_id}/assets/{path:path}")
def job_asset(job_id: str, path: str, request: Request) -> FileResponse:
    root = _ready_dir(request, job_id).resolve()
    target = (root / path).resolve()
    if root not in target.parents or not target.is_file():  # also blocks ../ traversal
        raise HTTPException(status_code=404, detail={"code": "asset_not_found", "message": "No such asset"})
    media = {".jpg": "image/jpeg", ".png": "image/png"}.get(target.suffix, "application/octet-stream")
    return FileResponse(target, media_type=media, headers={"Cache-Control": "private, max-age=3600"})


@router.delete("/jobs/{job_id}", status_code=204)
def delete_job(job_id: str, request: Request) -> Response:
    if not _jobs(request).delete(job_id):
        raise _not_found()
    return Response(status_code=204)
