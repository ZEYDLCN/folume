"""Fetch a paper from a link: arXiv, DOI and publisher pages, with a fetcher that cannot be turned against the server.

A conversion server that downloads whatever address it is given is a request-forgery tool unless it is careful, so:

* only http(s), no credentials in the address, no more than a few redirects, a size and a time limit;
* every host is resolved here, every resolved address must be public (not loopback, private, link-local, carrier
  grade NAT, multicast, reserved; IPv4 inside IPv6 forms are unwrapped), and the connection is made to exactly the
  address that was checked, so a second lookup cannot answer differently;
* the same checks apply to every redirect hop;
* errors never repeat the address back.
"""

from __future__ import annotations

import html
import ipaddress
import re
import socket
import time
from collections.abc import Callable
from dataclasses import dataclass
from urllib.parse import unquote, urljoin, urlsplit

import httpx

from . import __version__

MAX_URL_LENGTH = 2048
USER_AGENT = f"Folume/{__version__} (+personal paper reader; fetches one paper when its owner asks)"

_ARXIV_NEW = r"\d{4}\.\d{4,5}(?:v\d+)?"
_ARXIV_OLD = r"[a-z\-]+(?:\.[A-Z]{2})?/\d{7}(?:v\d+)?"
_ARXIV_ID = re.compile(rf"^(?:{_ARXIV_NEW}|{_ARXIV_OLD})$")
_DOI = re.compile(r"^10\.\d{4,9}/\S+$")
_ARXIV_DOI = re.compile(r"^10\.48550/arxiv\.(.+)$", re.I)
_BARE_HOST = re.compile(r"^(?:[a-z0-9\-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#].*)?$", re.I)


class InvalidSource(ValueError):
    """The text is not something that can be fetched."""


class FetchError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class FetchResult:
    data: bytes
    filename: str


# ------------------------------------------------------------------------------------------------ what a link means


def _arxiv(identifier: str) -> str:
    return f"https://arxiv.org/pdf/{identifier}"


def resolve_source(raw: str) -> list[str]:
    """Turn what a reader pasted (page link, PDF link, arXiv id, DOI) into candidate addresses of the PDF, best first."""
    text = re.sub(r"^(arxiv|doi)\s*:\s*", lambda m: m.group(1).lower() + ":", (raw or "").strip(), flags=re.I)
    if not text or len(text) > MAX_URL_LENGTH or re.search(r"[\s\x00-\x1f\x7f]", text):
        raise InvalidSource("empty or malformed")
    bare = re.sub(r"^(?:arxiv|doi):", "", text, flags=re.I)
    if _ARXIV_ID.match(bare):
        return [_arxiv(bare)]
    if _DOI.match(bare):
        m = _ARXIV_DOI.match(bare)
        return [_arxiv(m.group(1)), f"https://doi.org/{bare}"] if m else [f"https://doi.org/{bare}"]
    if "://" not in text:
        if text.lower().startswith(("javascript:", "data:", "file:", "mailto:", "tel:")) or not _BARE_HOST.match(text):
            raise InvalidSource("not a link")
        text = f"https://{text}"
    parts = urlsplit(text)
    if parts.scheme.lower() not in ("http", "https") or not parts.hostname or "@" in parts.netloc:
        raise InvalidSource("unsupported address")
    host = parts.hostname.lower()
    path = unquote(parts.path)
    if host in ("arxiv.org", "www.arxiv.org", "export.arxiv.org"):
        m = re.match(r"^/(?:abs|pdf)/(.+?)(?:\.pdf)?/?$", path)
        if m and _ARXIV_ID.match(m.group(1)):
            return [_arxiv(m.group(1))]
    if host in ("doi.org", "dx.doi.org", "www.doi.org"):
        doi = path.lstrip("/")
        if _DOI.match(doi):
            m = _ARXIV_DOI.match(doi)
            return [_arxiv(m.group(1)), f"https://doi.org/{doi}"] if m else [f"https://doi.org/{doi}"]
    if host in ("openreview.net", "www.openreview.net") and path == "/forum":
        from urllib.parse import parse_qs  # noqa: PLC0415

        ids = parse_qs(parts.query).get("id")
        if ids:
            return [f"https://openreview.net/pdf?id={ids[0]}"]
    if host == "aclanthology.org":
        m = re.match(r"^/([A-Za-z0-9.\-]+?)/?$", path)
        if m and not m.group(1).endswith(".pdf"):
            return [f"https://aclanthology.org/{m.group(1)}.pdf"]
    if (host.endswith(("biorxiv.org", "medrxiv.org")) and path.startswith("/content/10.1101/") and "." in path
            and not path.endswith((".pdf", ".full"))):
        return [f"https://{parts.hostname}{parts.path}.full.pdf"]
    return [parts.geturl()]


# ---------------------------------------------------------------------------------------------- which hosts are fine


def address_allowed(ip: str) -> bool:
    """True for addresses of the public internet only."""
    try:
        addr = ipaddress.ip_address(ip.split("%")[0])
    except ValueError:
        return False
    if isinstance(addr, ipaddress.IPv6Address):
        embedded = addr.ipv4_mapped or addr.sixtofour
        if embedded is None and addr in ipaddress.ip_network("64:ff9b::/96"):  # NAT64: the last 32 bits are an IPv4 address
            embedded = ipaddress.IPv4Address(int(addr) & 0xFFFFFFFF)
        if embedded is not None:
            return address_allowed(str(embedded))
        if addr.teredo is not None:
            return False
    return addr.is_global and not (addr.is_multicast or addr.is_loopback or addr.is_link_local or addr.is_unspecified)


def _default_resolver(host: str) -> list[str]:
    try:
        infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise FetchError("fetch_failed", "The address could not be found") from exc
    return list(dict.fromkeys(info[4][0] for info in infos))


# ---------------------------------------------------------------------------------------------------------- the fetch


_META_PDF = [
    re.compile(r"<meta[^>]+name=[\"']citation_pdf_url[\"'][^>]*content=[\"']([^\"']+)", re.I),
    re.compile(r"<meta[^>]+content=[\"']([^\"']+)[\"'][^>]*name=[\"']citation_pdf_url[\"']", re.I),
    re.compile(r"<link[^>]+type=[\"']application/pdf[\"'][^>]*href=[\"']([^\"']+)", re.I),
    re.compile(r"<link[^>]+href=[\"']([^\"']+)[\"'][^>]*type=[\"']application/pdf[\"']", re.I),
]
LANDING_LIMIT = 2 * 1024 * 1024


def _is_pdf(data: bytes) -> bool:
    return data.lstrip()[:1024].startswith(b"%PDF")


def _filename(final_url: str, disposition: str | None) -> str:
    name = ""
    if disposition:
        m = re.search(r"filename\*\s*=\s*[^']*''([^;]+)", disposition, re.I) or re.search(
            r"filename\s*=\s*\"?([^\";]+)\"?", disposition, re.I)
        if m:
            name = unquote(m.group(1)).strip()
    if not name:
        parts = urlsplit(final_url)
        last = unquote(parts.path.rstrip("/").rsplit("/", 1)[-1])
        if parts.hostname and parts.hostname.endswith("arxiv.org") and re.match(_ARXIV_NEW, last):
            name = f"arXiv-{last}.pdf"
        elif last.lower().endswith(".pdf"):
            name = last
    name = re.sub(r"[\x00-\x1f\x7f/\\]", "", name).strip(" .")[:120]
    if not name:
        return "paper.pdf"
    return name if name.lower().endswith(".pdf") else f"{name}.pdf"


class Fetcher:
    def __init__(self, *, allow_private: bool = False, max_bytes: int = 50 * 1024 * 1024, timeout: float = 60.0,
                 max_redirects: int = 5, resolver: Callable[[str], list[str]] | None = None,
                 transport: httpx.BaseTransport | None = None):
        self.allow_private = allow_private
        self.max_bytes = max_bytes
        self.timeout = timeout
        self.max_redirects = max_redirects
        self.resolver = resolver or _default_resolver
        self.transport = transport

    # -- public ----------------------------------------------------------------------------------------
    def fetch_any(self, candidates: list[str]) -> FetchResult:
        first: FetchError | None = None
        for url in candidates:
            try:
                return self.fetch(url)
            except FetchError as exc:
                if exc.code == "url_not_allowed":
                    raise
                first = first or exc
        raise first or FetchError("fetch_failed", "Nothing to fetch")

    def fetch(self, url: str) -> FetchResult:
        deadline = time.monotonic() + self.timeout
        final_url, ctype, body, disposition = self._get(url, deadline, self.max_bytes)
        if _is_pdf(body):
            return FetchResult(body, _filename(final_url, disposition))
        if "html" in ctype.lower() or body.lstrip()[:1].startswith(b"<"):
            target = self._pdf_from_landing(final_url, body)
            if target:
                url2, _, body2, disp2 = self._get(target, deadline, self.max_bytes)
                if _is_pdf(body2):
                    return FetchResult(body2, _filename(url2, disp2))
        raise FetchError("not_a_pdf", "The link did not lead to a PDF. Open the paper's page and copy its “PDF” link.")

    def get_bytes(self, url: str, limit: int) -> tuple[str, str, bytes]:
        """Any public page (not only a PDF) up to `limit` bytes, through the same checks: (final address, type, body)."""
        final_url, ctype, body, _ = self._get(url, time.monotonic() + self.timeout, limit)
        return final_url, ctype, body

    # -- internals -------------------------------------------------------------------------------------
    @staticmethod
    def _pdf_from_landing(base: str, body: bytes) -> str | None:
        page = body[:LANDING_LIMIT].decode("utf-8", errors="ignore")
        for pattern in _META_PDF:
            m = pattern.search(page)
            if m:
                return urljoin(base, html.unescape(m.group(1)).strip())
        return None

    def _check_host(self, host: str) -> str:
        """Returns the address to connect to; refuses anything that is not on the public internet."""
        if self.allow_private:
            return self.resolver(host)[0] if not _is_ip(host) else host
        ips = [host] if _is_ip(host) else self.resolver(host)
        if not ips or not all(address_allowed(ip) for ip in ips):
            raise FetchError("url_not_allowed", "This address is not allowed")
        return ips[0]

    def _get(self, url: str, deadline: float, limit: int) -> tuple[str, str, bytes, str | None]:
        current = url
        with httpx.Client(transport=self.transport, timeout=httpx.Timeout(self.timeout), follow_redirects=False,
                          headers={"User-Agent": USER_AGENT, "Accept": "application/pdf,text/html;q=0.8,*/*;q=0.5"}) as client:
            for _ in range(self.max_redirects + 1):
                parts = httpx.URL(current)
                if parts.scheme not in ("http", "https") or not parts.host or parts.userinfo:
                    raise FetchError("url_not_allowed", "This address is not allowed")
                ip = self._check_host(parts.host)
                host_header = parts.host if parts.port is None else f"{parts.host}:{parts.port}"
                pinned = parts.copy_with(host=ip)
                extensions = {"sni_hostname": parts.host} if parts.scheme == "https" else {}
                try:
                    with client.stream("GET", pinned, headers={"Host": host_header}, extensions=extensions) as resp:
                        if resp.status_code in (301, 302, 303, 307, 308):
                            location = resp.headers.get("location")
                            if not location:
                                raise FetchError("fetch_failed", "The server redirected without saying where")
                            current = urljoin(current, location)
                            continue
                        if resp.status_code >= 400:
                            raise FetchError("fetch_failed", f"The server answered {resp.status_code}")
                        declared = resp.headers.get("content-length")
                        if declared and declared.isdigit() and int(declared) > limit:
                            raise FetchError("file_too_large", "The file is larger than allowed")
                        chunks: list[bytes] = []
                        size = 0
                        for chunk in resp.iter_bytes(64 * 1024):
                            size += len(chunk)
                            if size > limit:
                                raise FetchError("file_too_large", "The file is larger than allowed")
                            if time.monotonic() > deadline:
                                raise FetchError("timeout", "The download took too long")
                            chunks.append(chunk)
                        return current, resp.headers.get("content-type", ""), b"".join(chunks), resp.headers.get(
                            "content-disposition")
                except httpx.TimeoutException as exc:
                    raise FetchError("timeout", "The server did not answer in time") from exc
                except httpx.HTTPError as exc:
                    raise FetchError("fetch_failed", "The server could not be reached") from exc
            raise FetchError("fetch_failed", "Too many redirects")


def _is_ip(host: str) -> bool:
    try:
        ipaddress.ip_address(host.strip("[]"))
        return True
    except ValueError:
        return False
