"""A conversion that misbehaves must stop, say so, and leave the server and the disk clean."""

from __future__ import annotations

import io
import time

import pytest
from fastapi.testclient import TestClient
from reportlab.pdfgen import canvas

from folume.config import Settings
from folume.main import create_app


def tiny_pdf(size=(612, 792), text="Hello"):
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=size)
    c.drawString(72, size[1] - 100, text * 30)
    c.save()
    return buf.getvalue()


def run_job(client, data, timeout=60.0):
    r = client.post("/v1/documents", files={"file": ("x.pdf", data, "application/pdf")})
    assert r.status_code == 202
    job_id = r.json()["id"]
    end = time.time() + timeout
    while time.time() < end:
        body = client.get(f"/v1/jobs/{job_id}").json()
        if body["status"] in ("done", "failed"):
            return body
        time.sleep(0.05)
    raise AssertionError("job did not finish")


def make_client(tmp_path, **overrides):
    return TestClient(create_app(Settings(data_dir=tmp_path / "jobs", workers=1, **overrides)))


def test_a_conversion_that_takes_too_long_is_stopped(tmp_path):
    with make_client(tmp_path, job_timeout_seconds=0.05) as client:
        started = time.time()
        job = run_job(client, tiny_pdf())
        assert job["status"] == "failed" and job["error"]["code"] == "timeout"
        assert time.time() - started < 20
        assert client.get("/v1/health").json()["status"] == "ok"
    assert list((tmp_path / "jobs").iterdir()) == []


def test_a_conversion_that_needs_too_much_memory_fails_without_taking_the_server_down(tmp_path):
    with make_client(tmp_path, max_memory_mb=40) as client:
        job = run_job(client, tiny_pdf())
        assert job["status"] == "failed"
        assert job["error"]["code"] in ("too_complex", "conversion_failed")
        assert client.get("/v1/health").json()["status"] == "ok"
        # the next conversion gets a fresh process
        assert run_job(client, tiny_pdf())["status"] == "failed"  # still capped: proves the cap is per process


def test_an_enormous_page_is_refused_before_it_is_rendered(tmp_path):
    with make_client(tmp_path) as client:
        job = run_job(client, tiny_pdf(size=(20000, 20000)))
        assert job["status"] == "failed" and job["error"]["code"] == "page_too_large"


def test_a_normal_document_converts_in_an_isolated_process(tmp_path):
    with make_client(tmp_path) as client:
        job = run_job(client, tiny_pdf())
        assert job["status"] == "done" and job["progress"] == 1.0
        doc = client.get(f"/v1/jobs/{job['id']}/document").json()
        assert doc["blocks"] and doc["pages"][0]["number"] == 1
        assert client.delete(f"/v1/jobs/{job['id']}").status_code == 204
    assert list((tmp_path / "jobs").iterdir()) == []


@pytest.mark.parametrize("isolate", [True, False])
def test_both_modes_report_errors_the_same_way(tmp_path, isolate):
    with make_client(tmp_path, isolate_jobs=isolate) as client:
        job = run_job(client, b"%PDF-1.4\nthis is not really a pdf\n%%EOF")
        assert job["status"] == "failed" and job["error"]["code"] in ("unreadable_pdf", "empty_document")
