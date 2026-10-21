"""PDF upload and conversion-job endpoints."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response

from .. import __version__
from ..jobs import JobManager, QueueFull

router = APIRouter()
CHUNK = 1024 * 1024


def _jobs(request: Request) -> JobManager:
    return request.app.state.jobs


def _not_found() -> HTTPException:
    return HTTPException(status_code=404, detail={"code": "job_not_found", "message": "Unknown or expired job"})


@router.get("/capabilities")
def capabilities(request: Request) -> dict:
    s = request.app.state.settings
    return {
        "version": __version__,
        "parser": {"name": "folume-pdfplumber", "scanned_pdf_ocr": False},
        "limits": {"max_upload_mb": s.max_upload_mb, "max_pages": s.max_pages},
        "retention_seconds": s.job_ttl_seconds,
        "uploads_persisted": False,
        "ai": {"enabled": bool(s.llm_base_url and s.llm_model), "vision": s.llm_vision},
        "sync": {"enabled": s.sync_enabled},
    }


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
