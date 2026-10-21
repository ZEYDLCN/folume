from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from folume.config import Settings
from folume.main import create_app
from folume.model import Document


@pytest.fixture()
def settings(tmp_path):
    return Settings(data_dir=tmp_path / "jobs", workers=2, job_ttl_seconds=3600)


@pytest.fixture()
def client(settings):
    with TestClient(create_app(settings)) as c:
        yield c


def wait_done(client, job_id, timeout=60.0, headers=None):
    end = time.time() + timeout
    while time.time() < end:
        r = client.get(f"/v1/jobs/{job_id}", headers=headers)
        if r.json()["status"] in ("done", "failed"):
            return r.json()
        time.sleep(0.05)
    raise AssertionError("job did not finish")


def upload(client, pdf_path, headers=None):
    with open(pdf_path, "rb") as f:
        return client.post("/v1/documents", files={"file": (pdf_path.name, f, "application/pdf")}, headers=headers)


def test_health_and_capabilities(client):
    assert client.get("/v1/health").json()["status"] == "ok"
    caps = client.get("/v1/capabilities").json()
    assert caps["uploads_persisted"] is False and caps["parser"]["scanned_pdf_ocr"] is False
    assert caps["ai"]["enabled"] is False and caps["limits"]["max_pages"] == 300


def test_upload_convert_download_delete(client, corpus):
    pdf = corpus["ieee_ml"].pdf
    r = upload(client, pdf)
    assert r.status_code == 202
    job = r.json()
    status = wait_done(client, job["id"])
    assert status["status"] == "done" and status["progress"] == 1.0

    doc = Document.model_validate_json(client.get(f"/v1/jobs/{job['id']}/document").content)
    assert doc.source.filename == "ieee_ml.pdf" and len(doc.pages) == 3
    page = client.get(f"/v1/jobs/{job['id']}/assets/{doc.pages[0].image}")
    assert page.status_code == 200 and page.headers["content-type"] == "image/jpeg"
    fig = next(b for b in doc.blocks if b.type == "figure")
    assert client.get(f"/v1/jobs/{job['id']}/assets/{fig.asset.path}").headers["content-type"] == "image/png"

    assert client.delete(f"/v1/jobs/{job['id']}").status_code == 204
    assert client.get(f"/v1/jobs/{job['id']}").status_code == 404
    assert client.get(f"/v1/jobs/{job['id']}/document").status_code == 404


def test_job_files_are_removed_from_disk_on_delete(client, corpus, settings):
    job = upload(client, corpus["ieee_ml"].pdf).json()
    wait_done(client, job["id"])
    assert (settings.data_dir / job["id"] / "document.json").exists()
    client.delete(f"/v1/jobs/{job['id']}")
    assert not (settings.data_dir / job["id"]).exists()


def test_uploaded_pdf_is_never_written_to_disk(client, corpus, settings):
    job = upload(client, corpus["ieee_ml"].pdf).json()
    wait_done(client, job["id"])
    assert not list(settings.data_dir.rglob("*.pdf"))


def test_expired_jobs_are_swept_and_their_files_deleted(client, corpus, settings):
    job = upload(client, corpus["ieee_ml"].pdf).json()
    wait_done(client, job["id"])
    assert (settings.data_dir / job["id"]).exists()
    client.app.state.jobs.jobs[job["id"]].expires = 0  # the TTL elapsed
    assert client.get(f"/v1/jobs/{job['id']}").status_code == 404
    assert not (settings.data_dir / job["id"]).exists()


def test_rejects_non_pdf_and_oversized_uploads(client, tmp_path, corpus):
    bad = tmp_path / "x.pdf"
    bad.write_bytes(b"not a pdf at all")
    assert upload(client, bad).status_code == 415
    small = Settings(data_dir=tmp_path / "j2", max_upload_mb=0)
    with TestClient(create_app(small)) as c:
        r = upload(c, corpus["ieee_ml"].pdf)
        assert r.status_code == 413 and r.json()["error"]["code"] == "file_too_large"


def test_conversion_errors_are_reported_without_leaking_content(client, tmp_path):
    broken = tmp_path / "broken.pdf"
    broken.write_bytes(b"%PDF-1.4\nSECRET-CONTENT this is not a real pdf")
    job = upload(client, broken).json()
    status = wait_done(client, job["id"])
    assert status["status"] == "failed" and status["error"]["code"] == "unreadable_pdf"
    assert "SECRET" not in str(status)


def test_page_limit_is_enforced(corpus, tmp_path):
    s = Settings(data_dir=tmp_path / "jobs", max_pages=2)
    with TestClient(create_app(s)) as c:
        job = upload(c, corpus["ieee_ml"].pdf).json()
        status = wait_done(c, job["id"])
        assert status["status"] == "failed" and status["error"]["code"] == "too_many_pages"


def test_scanned_pdf_converts_but_is_unsupported(client, scanned_pdf):
    job = upload(client, scanned_pdf).json()
    assert wait_done(client, job["id"])["status"] == "done"
    doc = Document.model_validate_json(client.get(f"/v1/jobs/{job['id']}/document").content)
    assert doc.quality.grade == "unsupported" and doc.blocks == []


def test_api_key_is_enforced_when_configured(corpus, tmp_path):
    s = Settings(data_dir=tmp_path / "jobs", api_key="s3cret")
    with TestClient(create_app(s)) as c:
        assert c.get("/v1/health").status_code == 200  # liveness stays open
        assert c.get("/v1/capabilities").status_code == 401
        assert upload(c, corpus["ieee_ml"].pdf).status_code == 401
        assert upload(c, corpus["ieee_ml"].pdf, headers={"X-API-Key": "wrong"}).status_code == 401
        ok = upload(c, corpus["ieee_ml"].pdf, headers={"X-API-Key": "s3cret"})
        assert ok.status_code == 202
        wait_done(c, ok.json()["id"], headers={"X-API-Key": "s3cret"})


def test_asset_path_traversal_is_blocked(client, corpus):
    job = upload(client, corpus["ieee_ml"].pdf).json()
    wait_done(client, job["id"])
    for evil in ["../../etc/passwd", "..%2f..%2fetc%2fpasswd", "pages/../../../x"]:
        r = client.get(f"/v1/jobs/{job['id']}/assets/{evil}")
        assert r.status_code == 404


def test_queue_limit_returns_429(corpus, tmp_path, monkeypatch):
    import threading

    import folume.jobs as jobs_module

    release = threading.Event()
    real = jobs_module.parse_pdf
    monkeypatch.setattr(jobs_module, "parse_pdf", lambda *a, **k: (release.wait(10), real(*a, **k))[1])
    s = Settings(data_dir=tmp_path / "jobs", workers=1, max_queued_jobs=1)
    with TestClient(create_app(s)) as c:
        first = upload(c, corpus["ieee_ml"].pdf)
        second = upload(c, corpus["ieee_ml"].pdf)
        assert first.status_code == 202
        assert second.status_code == 429 and second.json()["error"]["code"] == "busy"
        release.set()
        wait_done(c, first.json()["id"])


def test_orphaned_job_directories_are_purged_on_start(tmp_path):
    d = tmp_path / "jobs" / "leftover"
    d.mkdir(parents=True)
    (d / "document.json").write_text("{}")
    create_app(Settings(data_dir=tmp_path / "jobs"))
    assert not d.exists()
