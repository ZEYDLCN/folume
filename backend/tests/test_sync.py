from __future__ import annotations

import hashlib

import pytest
from fastapi.testclient import TestClient

from folume.config import Settings
from folume.main import create_app
from folume.sync_store import MAX_FUTURE_SKEW_MS, SyncStore

NS = hashlib.sha256(b"my sync key").hexdigest()
OTHER = hashlib.sha256(b"someone else").hexdigest()


@pytest.fixture()
def client(tmp_path):
    settings = Settings(data_dir=tmp_path / "jobs", sync_enabled=True, sync_db=tmp_path / "sync.sqlite3")
    with TestClient(create_app(settings)) as c:
        yield c


def rec(key, updated_at, data=None, deleted=False):
    return {"key": key, "updated_at": updated_at, "deleted": deleted, "data": data if not deleted else None}


def push(client, records, ns=NS, **kw):
    return client.put(f"/v1/sync/{ns}/records", json={"records": records}, **kw)


def test_sync_is_off_unless_enabled(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path / "jobs"))) as c:
        assert c.get("/v1/capabilities").json()["sync"]["enabled"] is False
        r = c.get(f"/v1/sync/{NS}")
        assert r.status_code == 404 and r.json()["error"]["code"] == "sync_disabled"


def test_push_then_pull_roundtrip(client):
    assert client.get("/v1/capabilities").json()["sync"]["enabled"] is True
    r = push(client, [rec("ann/doc1/a1", 100, {"note": "x", "ünï": "çödé"}), rec("state/doc1", 200, {"percent": 5})])
    assert r.json() == {"accepted": 2, "ignored": 0, "seq": 2}
    got = client.get(f"/v1/sync/{NS}/records").json()
    assert [x["key"] for x in got["records"]] == ["ann/doc1/a1", "state/doc1"]
    assert got["records"][0]["data"] == {"note": "x", "ünï": "çödé"}
    assert got["has_more"] is False and got["next"] == 2
    assert client.get(f"/v1/sync/{NS}").json() == {"records": 2, "seq": 2}


def test_newest_write_wins_and_old_writes_are_ignored(client):
    push(client, [rec("state/d", 100, {"v": 1})])
    assert push(client, [rec("state/d", 300, {"v": 3})]).json()["accepted"] == 1
    late = push(client, [rec("state/d", 200, {"v": 2})]).json()
    assert late["accepted"] == 0 and late["ignored"] == 1
    assert push(client, [rec("state/d", 300, {"v": "tie"})]).json()["ignored"] == 1  # a tie keeps what the server has
    assert client.get(f"/v1/sync/{NS}/records").json()["records"][0]["data"] == {"v": 3}


def test_pull_only_returns_what_changed_since_the_cursor(client):
    push(client, [rec("ann/d/a", 1, {"n": 1}), rec("ann/d/b", 1, {"n": 1})])
    first = client.get(f"/v1/sync/{NS}/records").json()
    push(client, [rec("ann/d/b", 2, {"n": 2})])
    again = client.get(f"/v1/sync/{NS}/records", params={"since": first["next"]}).json()
    assert [(r["key"], r["data"]) for r in again["records"]] == [("ann/d/b", {"n": 2})]


def test_pagination(client):
    push(client, [rec(f"ann/d/a{i}", i + 1, {"i": i}) for i in range(5)])
    page = client.get(f"/v1/sync/{NS}/records", params={"limit": 2}).json()
    assert len(page["records"]) == 2 and page["has_more"] is True
    rest = client.get(f"/v1/sync/{NS}/records", params={"since": page["next"], "limit": 10}).json()
    assert len(rest["records"]) == 3 and rest["has_more"] is False


def test_deletions_propagate_as_tombstones_and_drop_content(client):
    push(client, [rec("ann/d/a", 1, {"secret": "note"})])
    push(client, [rec("ann/d/a", 2, deleted=True)])
    got = client.get(f"/v1/sync/{NS}/records").json()["records"]
    assert got[0]["deleted"] is True and got[0]["data"] is None
    assert push(client, [rec("ann/d/a", 1, {"secret": "back"})]).json()["ignored"] == 1  # an old edit cannot resurrect it
    assert client.get(f"/v1/sync/{NS}").json()["records"] == 0


def test_namespaces_are_isolated_and_erasable(client):
    push(client, [rec("state/d", 1, {"a": 1})])
    assert client.get(f"/v1/sync/{OTHER}/records").json()["records"] == []
    assert client.delete(f"/v1/sync/{NS}").json() == {"deleted": 1}
    assert client.get(f"/v1/sync/{NS}/records").json()["records"] == []


def test_input_is_validated_without_echoing_content(client):
    assert client.get("/v1/sync/not-a-hash/records").status_code == 422
    bad_key = push(client, [rec("../../etc/passwd", 1, {"x": "PRIVATE-NOTE"})])
    assert bad_key.status_code == 422 and "PRIVATE-NOTE" not in bad_key.text
    too_big = push(client, [rec("state/d", 1, {"blob": "x" * 300_000})])
    assert too_big.status_code == 413
    many = push(client, [rec(f"ann/d/a{i}", 1, {}) for i in range(501)])
    assert many.status_code == 422
    extra = client.put(f"/v1/sync/{NS}/records", json={"records": [{**rec("state/d", 1, {}), "x": "SECRET"}]})
    assert extra.status_code == 422 and "SECRET" not in extra.text


def test_a_wrong_client_clock_cannot_win_forever(tmp_path):
    store = SyncStore(tmp_path / "s.sqlite3")
    now = 1_000_000
    far_future = now + 10 * 24 * 3600 * 1000
    store.push(NS, [{"key": "state/d", "updated_at": far_future, "deleted": False, "data": '{"v":"future"}'}], now_ms=now)
    rows, _, _ = store.pull(NS, 0, 10)
    assert rows[0]["updated_at"] == now + MAX_FUTURE_SKEW_MS
    # a correct clock a little later overrides it
    later = now + MAX_FUTURE_SKEW_MS + 1
    res = store.push(NS, [{"key": "state/d", "updated_at": later, "deleted": False, "data": '{"v":"real"}'}], now_ms=later)
    assert res.accepted == 1
    store.close()


def test_api_key_protects_sync_when_configured(tmp_path):
    settings = Settings(data_dir=tmp_path / "jobs", api_key="k", sync_enabled=True, sync_db=tmp_path / "s.sqlite3")
    with TestClient(create_app(settings)) as c:
        assert c.get(f"/v1/sync/{NS}").status_code == 401
        assert c.get(f"/v1/sync/{NS}", headers={"X-API-Key": "k"}).status_code == 200
