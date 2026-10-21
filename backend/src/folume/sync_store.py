"""Record store for optional multi-device sync.

The store is deliberately dumb: opaque JSON records addressed by ``(namespace, key)`` with a client
supplied ``updated_at``. The newest write wins (last-writer-wins per record), deletions are kept as
tombstones so they propagate, and every accepted change gets a per-namespace sequence number so devices can
ask "what changed since I last looked". It never inspects record contents and holds no PDFs.
"""

from __future__ import annotations

import re
import sqlite3
import threading
import time
from dataclasses import dataclass
from pathlib import Path

NAMESPACE_RE = re.compile(r"^[0-9a-f]{64}$")
KEY_RE = re.compile(r"^[a-z]{2,12}(?:/[A-Za-z0-9_.:\-]{1,80}){1,2}$")

MAX_RECORDS_PER_PUSH = 500
MAX_RECORD_BYTES = 256 * 1024
MAX_RECORDS_PER_NAMESPACE = 50_000
# a client with a wrong clock must not be able to win every future conflict
MAX_FUTURE_SKEW_MS = 5 * 60 * 1000


@dataclass
class PushResult:
    accepted: int
    ignored: int
    seq: int


class RecordLimitError(Exception):
    pass


class SyncStore:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self._lock = threading.Lock()
        with self._lock:
            self._db.execute("PRAGMA journal_mode=WAL")
            self._db.execute(
                "CREATE TABLE IF NOT EXISTS records ("
                " namespace TEXT NOT NULL, key TEXT NOT NULL, updated_at INTEGER NOT NULL,"
                " deleted INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL DEFAULT '', seq INTEGER NOT NULL,"
                " PRIMARY KEY (namespace, key))"
            )
            self._db.execute("CREATE INDEX IF NOT EXISTS records_seq ON records (namespace, seq)")

    def close(self) -> None:
        with self._lock:
            self._db.close()

    def push(self, namespace: str, records: list[dict], now_ms: int | None = None) -> PushResult:
        now_ms = now_ms if now_ms is not None else int(time.time() * 1000)
        accepted = ignored = 0
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                seq = self._db.execute(
                    "SELECT COALESCE(MAX(seq), 0) FROM records WHERE namespace = ?", (namespace,)
                ).fetchone()[0]
                count = self._db.execute(
                    "SELECT COUNT(*) FROM records WHERE namespace = ?", (namespace,)
                ).fetchone()[0]
                for rec in records:
                    updated_at = min(int(rec["updated_at"]), now_ms + MAX_FUTURE_SKEW_MS)
                    row = self._db.execute(
                        "SELECT updated_at FROM records WHERE namespace = ? AND key = ?", (namespace, rec["key"])
                    ).fetchone()
                    if row is not None and row[0] >= updated_at:
                        ignored += 1
                        continue
                    if row is None:
                        if count >= MAX_RECORDS_PER_NAMESPACE:
                            raise RecordLimitError
                        count += 1
                    seq += 1
                    deleted = 1 if rec["deleted"] else 0
                    self._db.execute(
                        "INSERT INTO records (namespace, key, updated_at, deleted, data, seq) VALUES (?,?,?,?,?,?)"
                        " ON CONFLICT(namespace, key) DO UPDATE SET updated_at=excluded.updated_at,"
                        " deleted=excluded.deleted, data=excluded.data, seq=excluded.seq",
                        (namespace, rec["key"], updated_at, deleted, "" if deleted else rec["data"], seq),
                    )
                    accepted += 1
                self._db.execute("COMMIT")
            except BaseException:
                self._db.execute("ROLLBACK")
                raise
        return PushResult(accepted, ignored, seq)

    def pull(self, namespace: str, since: int, limit: int) -> tuple[list[dict], int, bool]:
        """Records changed after `since`, oldest change first. Returns (records, next cursor, has_more)."""
        with self._lock:
            rows = self._db.execute(
                "SELECT key, updated_at, deleted, data, seq FROM records WHERE namespace = ? AND seq > ?"
                " ORDER BY seq LIMIT ?",
                (namespace, since, limit + 1),
            ).fetchall()
        has_more = len(rows) > limit
        rows = rows[:limit]
        records = [
            {"key": k, "updated_at": u, "deleted": bool(d), "data": data if not d else None, "seq": s}
            for k, u, d, data, s in rows
        ]
        return records, (rows[-1][4] if rows else since), has_more

    def stats(self, namespace: str) -> dict:
        with self._lock:
            n, seq = self._db.execute(
                "SELECT COUNT(*), COALESCE(MAX(seq), 0) FROM records WHERE namespace = ? AND deleted = 0", (namespace,)
            ).fetchone()
            top = self._db.execute(
                "SELECT COALESCE(MAX(seq), 0) FROM records WHERE namespace = ?", (namespace,)
            ).fetchone()[0]
        return {"records": n, "seq": max(seq, top)}

    def erase(self, namespace: str) -> int:
        with self._lock:
            cur = self._db.execute("DELETE FROM records WHERE namespace = ?", (namespace,))
            return cur.rowcount
