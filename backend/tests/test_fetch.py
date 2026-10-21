"""Importing a paper from a link: arXiv/DOI/publisher resolution, a fetcher that cannot be turned against the
server's own network, and the API on top of it."""

from __future__ import annotations

import http.server
import socket
import threading
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from folume.config import Settings
from folume.fetch import Fetcher, FetchError, InvalidSource, address_allowed, resolve_source
from folume.main import create_app

PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n" + b"x" * 200


# ----------------------------------------------------------------------------------------- what a link means


@pytest.mark.parametrize(
    ("raw", "first"),
    [
        ("https://arxiv.org/abs/2401.01234", "https://arxiv.org/pdf/2401.01234"),
        ("https://arxiv.org/abs/2401.01234v2", "https://arxiv.org/pdf/2401.01234v2"),
        ("http://arxiv.org/pdf/2401.01234.pdf", "https://arxiv.org/pdf/2401.01234"),
        ("arxiv.org/abs/2401.01234", "https://arxiv.org/pdf/2401.01234"),
        ("arXiv:2401.01234", "https://arxiv.org/pdf/2401.01234"),
        ("2401.01234", "https://arxiv.org/pdf/2401.01234"),
        ("2401.01234v3", "https://arxiv.org/pdf/2401.01234v3"),
        ("https://arxiv.org/abs/hep-th/9901001", "https://arxiv.org/pdf/hep-th/9901001"),
        ("hep-th/9901001", "https://arxiv.org/pdf/hep-th/9901001"),
        ("https://export.arxiv.org/abs/2401.01234", "https://arxiv.org/pdf/2401.01234"),
        ("doi:10.48550/arXiv.2401.01234", "https://arxiv.org/pdf/2401.01234"),
        ("10.1145/3292500.3330701", "https://doi.org/10.1145/3292500.3330701"),
        ("https://doi.org/10.1109/5.771073", "https://doi.org/10.1109/5.771073"),
        ("https://dx.doi.org/10.1109/5.771073", "https://doi.org/10.1109/5.771073"),
        ("DOI: 10.1109/5.771073", "https://doi.org/10.1109/5.771073"),
        ("https://openreview.net/forum?id=ABC123", "https://openreview.net/pdf?id=ABC123"),
        ("https://aclanthology.org/2020.acl-main.1/", "https://aclanthology.org/2020.acl-main.1.pdf"),
        ("https://example.org/papers/a.pdf", "https://example.org/papers/a.pdf"),
        ("example.org/papers/a.pdf", "https://example.org/papers/a.pdf"),
        ("  https://example.org/a.pdf?x=1&y=2  ", "https://example.org/a.pdf?x=1&y=2"),
        ("https://www.biorxiv.org/content/10.1101/2024.01.01.123456v1", "https://www.biorxiv.org/content/10.1101/2024.01.01.123456v1.full.pdf"),
    ],
)
def test_a_link_becomes_the_address_of_the_pdf(raw, first):
    assert resolve_source(raw)[0] == first


def test_an_arxiv_doi_has_a_fallback_through_the_doi_resolver():
    assert resolve_source("10.48550/arXiv.2401.01234")[-1] == "https://doi.org/10.48550/arXiv.2401.01234"


@pytest.mark.parametrize(
    "raw",
    ["", "   ", "not a link at all", "ftp://example.org/a.pdf", "javascript:alert(1)", "file:///etc/passwd",
     "data:application/pdf;base64,AAAA", "https://", "http://user:secret@example.org/a.pdf", "https://exa mple.org/a.pdf",
     "x" * 3000, "https://example.org/\nSet-Cookie: x"],
)
def test_things_that_are_not_links_are_refused(raw):
    with pytest.raises(InvalidSource):
        resolve_source(raw)


# -------------------------------------------------------------------------------------- which hosts may be fetched


@pytest.mark.parametrize(
    "ip",
    ["127.0.0.1", "127.1.2.3", "10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
     "0.0.0.0", "100.64.0.1", "224.0.0.1", "255.255.255.255", "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1",
     "::ffff:127.0.0.1", "::ffff:10.0.0.1", "64:ff9b::7f00:1", "2002:7f00:1::1"],
)
def test_private_and_special_addresses_are_never_fetched(ip):
    assert not address_allowed(ip)


@pytest.mark.parametrize("ip", ["93.184.216.34", "8.8.8.8", "151.101.1.69", "2606:2800:220:1:248:1893:25c8:1946"])
def test_public_addresses_are_allowed(ip):
    assert address_allowed(ip)


def test_a_name_that_resolves_to_a_private_address_is_blocked():
    fetcher = Fetcher(resolver=lambda host: ["10.0.0.5"], transport=httpx.MockTransport(lambda r: httpx.Response(200)))
    with pytest.raises(FetchError) as e:
        fetcher.fetch("https://papers.example/a.pdf")
    assert e.value.code == "url_not_allowed"


def test_one_private_address_among_public_ones_is_enough_to_refuse():
    fetcher = Fetcher(resolver=lambda host: ["93.184.216.34", "127.0.0.1"], transport=httpx.MockTransport(lambda r: httpx.Response(200)))
    with pytest.raises(FetchError) as e:
        fetcher.fetch("https://papers.example/a.pdf")
    assert e.value.code == "url_not_allowed"


def test_the_connection_goes_to_the_address_that_was_checked_not_to_a_second_lookup():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["ip"], seen["host"], seen["sni"] = request.url.host, request.headers["host"], request.extensions.get("sni_hostname")
        return httpx.Response(200, content=PDF, headers={"content-type": "application/pdf"})

    fetcher = Fetcher(resolver=lambda host: ["93.184.216.34"], transport=httpx.MockTransport(handler))
    res = fetcher.fetch("https://papers.example/a.pdf")
    assert res.data.startswith(b"%PDF")
    assert seen == {"ip": "93.184.216.34", "host": "papers.example", "sni": "papers.example"}


def test_a_redirect_to_a_private_address_is_caught():
    hosts = {"papers.example": ["93.184.216.34"], "inside.example": ["10.1.1.1"]}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.headers["host"] == "papers.example":
            return httpx.Response(302, headers={"location": "https://inside.example/secret.pdf"})
        raise AssertionError("the private host must not be contacted")

    fetcher = Fetcher(resolver=lambda host: hosts[host], transport=httpx.MockTransport(handler))
    with pytest.raises(FetchError) as e:
        fetcher.fetch("https://papers.example/a.pdf")
    assert e.value.code == "url_not_allowed"


def test_redirects_to_other_schemes_or_in_endless_loops_are_stopped():
    def to_file(request):
        return httpx.Response(302, headers={"location": "file:///etc/passwd"})

    f = Fetcher(resolver=lambda h: ["93.184.216.34"], transport=httpx.MockTransport(to_file))
    with pytest.raises(FetchError) as e:
        f.fetch("https://papers.example/a.pdf")
    assert e.value.code == "url_not_allowed"

    def loop(request):
        return httpx.Response(302, headers={"location": "https://papers.example/again"})

    g = Fetcher(resolver=lambda h: ["93.184.216.34"], transport=httpx.MockTransport(loop), max_redirects=4)
    with pytest.raises(FetchError) as e2:
        g.fetch("https://papers.example/a.pdf")
    assert e2.value.code == "fetch_failed" and "redirect" in e2.value.message.lower()


# -------------------------------------------------------------------------- fetching from a real (local) server


class _Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):  # keep test output quiet
        pass

    def do_GET(self):  # noqa: N802
        routes = self.server.routes  # type: ignore[attr-defined]
        handler = routes.get(self.path.split("?")[0])
        if handler is None:
            self.send_response(404)
            self.end_headers()
            return
        handler(self)


def _serve(routes):
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    server.routes = routes  # type: ignore[attr-defined]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}"


def _send(status=200, body=b"", ctype="application/pdf", headers=None):
    def handler(h):
        h.send_response(status)
        h.send_header("Content-Type", ctype)
        h.send_header("Content-Length", str(len(body)))
        for k, v in (headers or {}).items():
            h.send_header(k, v)
        h.end_headers()
        h.wfile.write(body)

    return handler


@pytest.fixture()
def site():
    page = b"<html><head><meta name='citation_pdf_url' content='/files/real.pdf'></head><body>Landing</body></html>"
    routes = {
        "/paper.pdf": _send(body=PDF),
        "/octet": _send(body=PDF, ctype="application/octet-stream"),
        "/lies.pdf": _send(body=b"<html>not a pdf</html>", ctype="application/pdf"),
        "/go": _send(302, headers={"Location": "/paper.pdf"}),
        "/landing": _send(body=page, ctype="text/html; charset=utf-8"),
        "/files/real.pdf": _send(body=PDF),
        "/page-without-pdf": _send(body=b"<html><body>just text</body></html>", ctype="text/html"),
        "/named": _send(body=PDF, headers={"Content-Disposition": 'attachment; filename="Great Paper.pdf"'}),
    }
    server, base = _serve(routes)
    yield base, routes
    server.shutdown()


def local_fetcher(**kw):
    return Fetcher(allow_private=True, **kw)


def test_a_pdf_link_is_downloaded_with_a_sensible_filename(site):
    base, _ = site
    res = local_fetcher().fetch(f"{base}/paper.pdf")
    assert res.data.startswith(b"%PDF") and res.filename == "paper.pdf"
    assert local_fetcher().fetch(f"{base}/named").filename == "Great Paper.pdf"


def test_a_pdf_served_as_a_generic_download_is_still_a_pdf(site):
    base, _ = site
    assert local_fetcher().fetch(f"{base}/octet").data.startswith(b"%PDF")


def test_redirects_are_followed(site):
    base, _ = site
    assert local_fetcher().fetch(f"{base}/go").data.startswith(b"%PDF")


def test_a_landing_page_leads_to_its_pdf_through_the_citation_meta_tag(site):
    base, _ = site
    res = local_fetcher().fetch(f"{base}/landing")
    assert res.data.startswith(b"%PDF") and res.filename == "real.pdf"


def test_a_page_that_is_not_a_pdf_says_so(site):
    base, _ = site
    for path in ("/page-without-pdf", "/lies.pdf"):
        with pytest.raises(FetchError) as e:
            local_fetcher().fetch(f"{base}{path}")
        assert e.value.code == "not_a_pdf"


def test_http_errors_are_reported_without_echoing_the_address(site):
    base, _ = site
    with pytest.raises(FetchError) as e:
        local_fetcher().fetch(f"{base}/missing")
    assert e.value.code == "fetch_failed" and "404" in e.value.message and base not in e.value.message


def test_a_file_over_the_limit_is_cut_off_while_downloading(site):
    base, routes = site
    routes["/big.pdf"] = _send(body=b"%PDF" + b"x" * 300_000)
    with pytest.raises(FetchError) as e:
        local_fetcher(max_bytes=100_000).fetch(f"{base}/big.pdf")
    assert e.value.code == "file_too_large"


def test_a_server_that_never_answers_times_out(site):
    base, routes = site

    def hang(h):
        time.sleep(3)

    routes["/hang"] = hang
    started = time.time()
    with pytest.raises(FetchError) as e:
        local_fetcher(timeout=0.5).fetch(f"{base}/hang")
    assert e.value.code == "timeout" and time.time() - started < 2.5


def test_the_resolver_tries_the_next_candidate(site):
    base, _ = site
    # first candidate is a 404, the second one is the paper
    res = local_fetcher().fetch_any([f"{base}/missing", f"{base}/paper.pdf"])
    assert res.data.startswith(b"%PDF")


def test_private_hosts_are_refused_by_default(site):
    base, _ = site
    with pytest.raises(FetchError) as e:
        Fetcher().fetch(f"{base}/paper.pdf")
    assert e.value.code == "url_not_allowed"
    assert socket.gethostbyname("localhost") in ("127.0.0.1", "::1")
    with pytest.raises(FetchError):
        Fetcher().fetch("http://localhost:1/a.pdf")


# --------------------------------------------------------------------------------------------------- the API


def _wait(client, job_id, timeout=60.0, headers=None):
    end = time.time() + timeout
    while time.time() < end:
        body = client.get(f"/v1/jobs/{job_id}", headers=headers).json()
        if body["status"] in ("done", "failed"):
            return body
        time.sleep(0.1)
    raise AssertionError("job did not finish")


@pytest.fixture()
def api(tmp_path):
    settings = Settings(data_dir=tmp_path / "jobs", allow_private_urls=True)
    with TestClient(create_app(settings)) as c:
        yield c


def test_the_api_converts_a_paper_from_its_link(api, corpus):
    pdf = corpus["ieee_ml"].pdf.read_bytes()
    server, base = _serve({"/ieee_ml.pdf": _send(body=pdf)})
    try:
        r = api.post("/v1/documents/from-url", json={"url": f"{base}/ieee_ml.pdf"})
        assert r.status_code == 202
        job = _wait(api, r.json()["id"])
        assert job["status"] == "done", job
        doc = api.get(f"/v1/jobs/{job['id']}/document").json()
        assert doc["source"]["filename"] == "ieee_ml.pdf"
        assert doc["quality"]["completeness"]["complete"] is True
    finally:
        server.shutdown()


def test_the_api_reports_a_bad_link_through_the_job(api):
    server, base = _serve({"/gone": _send(404)})
    try:
        r = api.post("/v1/documents/from-url", json={"url": f"{base}/gone"})
        assert r.status_code == 202
        job = _wait(api, r.json()["id"])
        assert job["status"] == "failed" and job["error"]["code"] == "fetch_failed"
    finally:
        server.shutdown()


def test_the_api_rejects_nonsense_immediately_and_never_echoes_it(api):
    r = api.post("/v1/documents/from-url", json={"url": "javascript:alert('SECRET')"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_url" and "SECRET" not in r.text
    assert api.post("/v1/documents/from-url", json={}).status_code == 422
    assert api.post("/v1/documents/from-url", json={"url": "https://example.org/a.pdf", "x": 1}).status_code == 422


def test_the_api_refuses_internal_addresses_unless_the_operator_allows_them(tmp_path):
    settings = Settings(data_dir=tmp_path / "jobs")  # default: private networks are off limits
    with TestClient(create_app(settings)) as c:
        r = c.post("/v1/documents/from-url", json={"url": "http://169.254.169.254/latest/meta-data/"})
        assert r.status_code == 202
        job = _wait(c, r.json()["id"])
        assert job["status"] == "failed" and job["error"]["code"] == "url_not_allowed"


def test_link_import_needs_the_api_key_and_can_be_switched_off(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path / "a", api_key="k", allow_private_urls=True))) as c:
        assert c.post("/v1/documents/from-url", json={"url": "https://example.org/a.pdf"}).status_code == 401
    with TestClient(create_app(Settings(data_dir=tmp_path / "b", url_import=False))) as c:
        r = c.post("/v1/documents/from-url", json={"url": "https://example.org/a.pdf"})
        assert r.status_code == 404 and r.json()["error"]["code"] == "url_import_disabled"
        assert c.get("/v1/capabilities").json()["url_import"] is False


def test_capabilities_advertise_link_import(api):
    assert api.get("/v1/capabilities").json()["url_import"] is True


def test_stages_are_reported_while_downloading(api, corpus):
    pdf = corpus["ieee_ml"].pdf.read_bytes()

    def slow(h):
        time.sleep(0.6)
        _send(body=pdf)(h)

    server, base = _serve({"/slow.pdf": slow})
    try:
        job_id = api.post("/v1/documents/from-url", json={"url": f"{base}/slow.pdf"}).json()["id"]
        first = api.get(f"/v1/jobs/{job_id}").json()
        assert first["stage"] in ("queued", "download")
        assert _wait(api, job_id)["status"] == "done"
    finally:
        server.shutdown()

