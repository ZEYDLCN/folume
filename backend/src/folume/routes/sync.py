"""Optional multi-device sync: record-based, last-writer-wins, namespace = sha256 of the user's sync key.

The server never sees the sync key itself, only its hash, and stores records exactly as the client sent
them. Request bodies are not logged and errors never echo record contents.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from ..sync_store import (
    KEY_RE,
    MAX_RECORD_BYTES,
    MAX_RECORDS_PER_PUSH,
    NAMESPACE_RE,
    RecordLimitError,
    SyncStore,
)

router = APIRouter(prefix="/sync")


class RecordIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str = Field(max_length=200)
    updated_at: int = Field(ge=0, description="Client clock, milliseconds since the epoch")
    deleted: bool = False
    data: Any = None


class PushRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    records: list[RecordIn] = Field(max_length=MAX_RECORDS_PER_PUSH)


class RecordOut(BaseModel):
    key: str
    updated_at: int
    deleted: bool
    data: Any = None
    seq: int


class PushResponse(BaseModel):
    accepted: int
    ignored: int
    seq: int


class PullResponse(BaseModel):
    records: list[RecordOut]
    next: int
    has_more: bool


class SyncStatus(BaseModel):
    records: int
    seq: int


def _store(request: Request) -> SyncStore:
    store: SyncStore | None = getattr(request.app.state, "sync", None)
    if store is None:
        raise HTTPException(status_code=404, detail={"code": "sync_disabled", "message": "Sync is not enabled"})
    return store


def _namespace(ns: str) -> str:
    if not NAMESPACE_RE.match(ns):
        raise HTTPException(status_code=422, detail={"code": "invalid_namespace",
                                                     "message": "Namespace must be 64 lowercase hex characters"})
    return ns


@router.get("/{namespace}")
def status(namespace: str, request: Request) -> SyncStatus:
    return SyncStatus(**_store(request).stats(_namespace(namespace)))


@router.put("/{namespace}/records")
def push(namespace: str, body: PushRequest, request: Request) -> PushResponse:
    store, ns = _store(request), _namespace(namespace)
    prepared: list[dict] = []
    for rec in body.records:
        if not KEY_RE.match(rec.key):
            raise HTTPException(status_code=422, detail={"code": "invalid_key", "message": "Record key is not valid"})
        text = "" if rec.deleted else json.dumps(rec.data, separators=(",", ":"), ensure_ascii=False)
        if len(text.encode()) > MAX_RECORD_BYTES:
            raise HTTPException(status_code=413, detail={"code": "record_too_large", "message": "Record is too large"})
        prepared.append({"key": rec.key, "updated_at": rec.updated_at, "deleted": rec.deleted, "data": text})
    try:
        result = store.push(ns, prepared)
    except RecordLimitError:
        raise HTTPException(status_code=507, detail={"code": "namespace_full",
                                                     "message": "Too many records for this sync key"}) from None
    return PushResponse(accepted=result.accepted, ignored=result.ignored, seq=result.seq)


@router.get("/{namespace}/records")
def pull(namespace: str, request: Request, since: int = Query(default=0, ge=0),
         limit: int = Query(default=200, ge=1, le=500)) -> PullResponse:
    records, nxt, more = _store(request).pull(_namespace(namespace), since, limit)
    out = [RecordOut(key=r["key"], updated_at=r["updated_at"], deleted=r["deleted"],
                     data=json.loads(r["data"]) if r["data"] else None, seq=r["seq"]) for r in records]
    return PullResponse(records=out, next=nxt, has_more=more)


@router.delete("/{namespace}")
def erase(namespace: str, request: Request) -> dict:
    return {"deleted": _store(request).erase(_namespace(namespace))}
