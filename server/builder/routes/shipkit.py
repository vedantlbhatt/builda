"""The phone asks for a demo; the Mac claims the ask; the Mac publishes a kit; the phone reads it.

docs/ship-kit.md. Every route is on `current_device` (the phone's token or the paired Mac's; a
capture key is refused, as on the demo routes, for their reason: a headless container cannot
film anything, and a publish replaces). Every row is owner only under RLS (0030), and a project
that is not the caller's is a 404 (`project_media.held`).

REQUESTS, one live per project (a partial unique index): `POST /v1/demos/requests` answers the
live one when there is one, so a second tap is the same request, never a second simulator on a
Mac that already runs out of memory with two. `:claim` moves the oldest queued ones to claimed
in one statement with `FOR UPDATE SKIP LOCKED`, the drops runner's shape, so two Macs never film
one request. `:finish` ends a claimed one `done` or `failed` with a code from the spec.

A KIT IS A SET, like a demo (routes/media.py): presign each file under the publish's id, upload,
commit each, then PUT the document. The document arriving when nothing of its publish is left
uncommitted is what makes the kit the one shown, and it deletes the project's older kits in the
same transaction, their objects after it; a document for a publish with a file still pending is
a 409 and changes nothing.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from .. import objectstore, ship_kit
from .. import project_media as pm
from ..auth import CurrentDevice, current_device
from ..builder_profile import excluded_keys
from ..db import db_session
from ..shipkit_spec import (
    PLATFORM_LIMITS,
    SHIPKIT_VERSION,
    DemoRequestFinish,
    DemoRequestIn,
    KitDocument,
    KitPresign,
)

router = APIRouter(prefix="/v1", tags=["shipkit"])

#: Requests one claim takes: the Mac films one at a time, and a handful queued is a morning.
CLAIM_MAX = 5
#: Requests the phone's list returns, newest first.
LIST_MAX = 20
HEAD_BYTES = 16

_REQ_COLUMNS = "id, project_key, status, refusal, hue, created_at, claimed_at, finished_at"
_KIT_COLUMNS = (
    "id, slot, object_key, content_type, width, height, duration_ms, bytes, "
    "position, label, committed, created_at"
)


def _key(key: str) -> str:
    if not pm.PROJECT_KEY.match(key):
        raise HTTPException(422, "a project key is the repository's 64 lowercase hex characters")
    return key


def _uuid(value: str) -> str:
    try:
        return str(uuid.UUID(value))
    except (ValueError, AttributeError, TypeError) as e:
        raise HTTPException(404, "not found") from e


def _req(r) -> dict:
    return {
        "id": str(r.id),
        "project_key": r.project_key,
        "status": r.status,
        "refusal": r.refusal,
        "hue": r.hue,
        "created_at": r.created_at.isoformat(),
        "claimed_at": r.claimed_at.isoformat() if r.claimed_at else None,
        "finished_at": r.finished_at.isoformat() if r.finished_at else None,
    }


# ------------------------------------------------------------------------ requests


@router.post("/demos/requests", status_code=201)
def request_demo(body: DemoRequestIn, device: CurrentDevice = Depends(current_device)):
    """Ask the Mac for a demo of one of your projects. The live request is answered when there
    is one (200), a new one otherwise (201)."""
    uid = str(device.user_id)
    with db_session(viewer_id=uid) as db:
        if not pm.held(db, uid, body.project_key):
            raise HTTPException(404, "no project of yours has that key")
        live = db.execute(
            text(
                f"SELECT {_REQ_COLUMNS} FROM demo_requests WHERE user_id = CAST(:u AS uuid) "
                "AND project_key = :k AND status IN ('queued', 'claimed')"
            ),
            {"u": uid, "k": body.project_key},
        ).first()
        if live is not None:
            from fastapi.responses import JSONResponse

            return JSONResponse({"request": _req(live), "existing": True}, status_code=200)
        try:
            row = db.execute(
                text(
                    f"""
                    INSERT INTO demo_requests (user_id, project_key, hue)
                    VALUES (CAST(:u AS uuid), :k, :h) RETURNING {_REQ_COLUMNS}
                    """
                ),
                {"u": uid, "k": body.project_key, "h": body.hue},
            ).one()
        except IntegrityError as e:  # a racing second tap: the index kept it to one
            raise HTTPException(409, "a demo of this project was just asked for") from e
    return {"request": _req(row), "existing": False}


@router.get("/demos/requests")
def list_requests(
    project_key: str | None = Query(None),
    status: str | None = Query(None),
    device: CurrentDevice = Depends(current_device),
):
    """Your requests, newest first: one project's (the kit screen's button), or all of them."""
    uid = str(device.user_id)
    clauses = ["user_id = CAST(:u AS uuid)"]
    params: dict = {"u": uid, "n": LIST_MAX}
    if project_key is not None:
        clauses.append("project_key = :k")
        params["k"] = _key(project_key)
    if status is not None:
        if status not in ("queued", "claimed", "done", "failed", "cancelled"):
            raise HTTPException(422, "status is queued, claimed, done, failed or cancelled")
        clauses.append("status = :s")
        params["s"] = status
    with db_session(viewer_id=uid) as db:
        rows = db.execute(
            text(
                f"SELECT {_REQ_COLUMNS} FROM demo_requests WHERE {' AND '.join(clauses)} "
                "ORDER BY created_at DESC LIMIT :n"
            ),
            params,
        ).all()
    return {"requests": [_req(r) for r in rows]}


@router.post("/demos/requests:claim")
def claim_requests(device: CurrentDevice = Depends(current_device)):
    """The Mac takes the oldest queued requests (at most `CLAIM_MAX`), each exactly once."""
    uid = str(device.user_id)
    with db_session(viewer_id=uid) as db:
        rows = db.execute(
            text(
                f"""
                UPDATE demo_requests SET status = 'claimed', claimed_at = now(),
                  claimed_by = CAST(:d AS uuid)
                WHERE id IN (
                  SELECT id FROM demo_requests
                  WHERE user_id = CAST(:u AS uuid) AND status = 'queued'
                  ORDER BY created_at LIMIT :n FOR UPDATE SKIP LOCKED)
                RETURNING {_REQ_COLUMNS}
                """
            ),
            {"u": uid, "d": str(device.device_id), "n": CLAIM_MAX},
        ).all()
    return {"requests": [_req(r) for r in sorted(rows, key=lambda r: r.created_at)]}


@router.post("/demos/requests/{request_id}:finish")
def finish_request(
    request_id: str, body: DemoRequestFinish, device: CurrentDevice = Depends(current_device)
):
    """A claimed request ends: `done`, or `failed` with its code. Nothing else finishes one."""
    uid = str(device.user_id)
    rid = _uuid(request_id)
    if body.status not in ("done", "failed"):
        raise HTTPException(422, "a request finishes done or failed")
    if (body.status == "failed") != (body.refusal is not None):
        raise HTTPException(422, "a failed request says why (refusal), and a done one does not")
    with db_session(viewer_id=uid) as db:
        row = db.execute(
            text(
                f"""
                UPDATE demo_requests SET status = :s, refusal = :r, finished_at = now()
                WHERE id = CAST(:id AS uuid) AND user_id = CAST(:u AS uuid) AND status = 'claimed'
                RETURNING {_REQ_COLUMNS}
                """
            ),
            {"s": body.status, "r": body.refusal, "id": rid, "u": uid},
        ).first()
        if row is None:
            exists = db.execute(
                text(
                    "SELECT status FROM demo_requests WHERE id = CAST(:id AS uuid) AND user_id "
                    "= CAST(:u AS uuid)"
                ),
                {"id": rid, "u": uid},
            ).first()
    if row is None:
        if exists is None:
            raise HTTPException(404, "not found")
        raise HTTPException(409, f"this request is {exists.status}, not claimed")
    return {"request": _req(row)}


@router.delete("/demos/requests/{request_id}")
def cancel_request(request_id: str, device: CurrentDevice = Depends(current_device)):
    """The phone takes back a request that has not ended."""
    uid = str(device.user_id)
    rid = _uuid(request_id)
    with db_session(viewer_id=uid) as db:
        row = db.execute(
            text(
                f"""
                UPDATE demo_requests SET status = 'cancelled', finished_at = now()
                WHERE id = CAST(:id AS uuid) AND user_id = CAST(:u AS uuid)
                  AND status IN ('queued', 'claimed')
                RETURNING {_REQ_COLUMNS}
                """
            ),
            {"id": rid, "u": uid},
        ).first()
    if row is None:
        raise HTTPException(404, "no request of yours is waiting with that id")
    return {"request": _req(row)}


# ------------------------------------------------------------------------ the kit


def _backend() -> str:
    kind = objectstore.media_backend()
    if kind is None:
        raise HTTPException(503, "demo storage is not configured on this server (MEDIA_STORE_*)")
    return kind


@router.post("/projects/{key}/kit:presign")
def presign_kit(key: str, body: KitPresign, device: CurrentDevice = Depends(current_device)):
    """Where one kit file goes; its row is written now, uncommitted."""
    uid = str(device.user_id)
    _key(key)
    refused = ship_kit.presign_refusal(body)
    if refused is not None:
        raise HTTPException(*refused)
    kind = _backend()
    media_id = str(uuid.uuid4())
    okey = ship_kit.object_key(uid, key, media_id, body.content_type)
    with db_session(viewer_id=uid) as db:
        db.execute(text("SELECT id FROM users WHERE id = CAST(:u AS uuid) FOR UPDATE"), {"u": uid})
        if not pm.held(db, uid, key):
            raise HTTPException(404, "no project of yours has that key")
        n = db.execute(
            text(
                "SELECT count(*) FROM ship_kit_media WHERE user_id = CAST(:u AS uuid) AND "
                "project_key = :k "
                "AND publish_id = :p AND slot = :s"
            ),
            {"u": uid, "k": key, "p": body.publish_id, "s": body.slot},
        ).scalar()
        if n >= ship_kit.SLOT_CAPS[body.slot]:
            raise HTTPException(
                409, f"a kit holds at most {ship_kit.SLOT_CAPS[body.slot]} of {body.slot}"
            )
        try:
            db.execute(
                text(
                    """
                    INSERT INTO ship_kit_media (id, user_id, project_key, publish_id, slot,
                      object_key, content_type,
                      width, height, duration_ms, bytes, position, label)
                    VALUES (CAST(:id AS uuid), CAST(:u AS uuid), :k, :p, :s, :o, :ct, :w, :h,
                      :d, :n, :pos, :l)
                    """
                ),
                {"id": media_id, "u": uid, "k": key, "p": body.publish_id, "s": body.slot,
                 "o": okey,
                 "ct": body.content_type, "w": body.width, "h": body.height, "d": body.duration_ms,
                 "n": body.bytes, "pos": body.position, "l": body.label},
            )  # fmt: skip
        except IntegrityError as e:
            raise HTTPException(
                409, f"this kit already has a {body.slot} at position {body.position}"
            ) from e
    expires = pm.upload_seconds(body.bytes)
    headers = {"Content-Type": body.content_type, "Content-Length": str(body.bytes)}
    if kind == "file":
        token = pm.upload_token(uid, media_id, okey, body.content_type, body.bytes, expires=expires)
        url = f"/v1/media-upload/{token}"
    else:
        url = objectstore.presign_put(
            okey,
            body.content_type,
            expires,
            content_length=body.bytes,
            store=objectstore.media_store(),
        )
    return {
        "media_id": media_id,
        "upload_url": url,
        "method": "PUT",
        "headers": headers,
        "expires_in": expires,
    }


@router.post("/projects/{key}/kit/{media_id}:commit")
def commit_kit_file(key: str, media_id: str, device: CurrentDevice = Depends(current_device)):
    """The file is in the store at its declared size and starts like its type: mark it."""
    uid = str(device.user_id)
    _key(key)
    mid = _uuid(media_id)
    _backend()
    with db_session(viewer_id=uid) as db:
        row = db.execute(
            text(
                f"SELECT {_KIT_COLUMNS} FROM ship_kit_media WHERE id = CAST(:m AS uuid) "
                "AND project_key = :k AND user_id = CAST(:u AS uuid)"
            ),
            {"m": mid, "k": key, "u": uid},
        ).first()
    if row is None:
        raise HTTPException(404, "not found")
    if not row.committed:
        try:
            size = objectstore.media_stat(row.object_key)
            head = objectstore.media_head_bytes(row.object_key, HEAD_BYTES) if size else None
        except OSError as e:
            raise HTTPException(503, f"the object store did not answer: {e}") from e
        if size is None:
            raise HTTPException(409, "nothing has been uploaded for this file yet")
        if size != row.bytes:
            raise HTTPException(409, f"the file is {size} bytes; its presign said {row.bytes}")
        if not ship_kit.looks_like(row.content_type, head):
            raise HTTPException(409, f"the file does not start like {row.content_type}")
        with db_session(viewer_id=uid) as db:
            db.execute(
                text(
                    "UPDATE ship_kit_media SET committed = true, committed_at = now() WHERE id "
                    "= CAST(:m AS uuid) AND NOT committed"
                ),
                {"m": mid},
            )
    return {"id": mid, "committed": True}


@router.put("/projects/{key}/kit")
def put_kit(key: str, body: KitDocument, device: CurrentDevice = Depends(current_device)):
    """The kit's document, which makes its publish the kit shown once nothing of it is pending,
    and deletes the project's older kits in the same transaction."""
    uid = str(device.user_id)
    _key(key)
    if body.shipkit_version != SHIPKIT_VERSION:
        raise HTTPException(422, f"shipkit_version is {SHIPKIT_VERSION}")
    for c in body.captions:
        if len(c.text) > PLATFORM_LIMITS[c.platform]:
            raise HTTPException(
                422, f"the {c.platform} caption is over {PLATFORM_LIMITS[c.platform]} characters"
            )
        if c.thread and c.platform != "x":
            raise HTTPException(422, "only the x caption has a thread")
    platforms = [c.platform for c in body.captions]
    if len(platforms) != len(set(platforms)):
        raise HTTPException(422, "one caption per platform")
    replaced: list[str] = []
    with db_session(viewer_id=uid) as db:
        db.execute(text("SELECT id FROM users WHERE id = CAST(:u AS uuid) FOR UPDATE"), {"u": uid})
        if not pm.held(db, uid, key):
            raise HTTPException(404, "no project of yours has that key")
        files = db.execute(
            text(
                "SELECT committed FROM ship_kit_media WHERE user_id = CAST(:u AS uuid) AND "
                "project_key = :k AND publish_id = :p"
            ),
            {"u": uid, "k": key, "p": body.publish_id},
        ).all()
        if not files:
            raise HTTPException(409, "this publish has no files")
        pending = sum(1 for f in files if not f.committed)
        if pending:
            raise HTTPException(409, f"{pending} file(s) of this publish are not committed yet")
        db.execute(
            text(
                "DELETE FROM ship_kits WHERE user_id = CAST(:u AS uuid) AND project_key = :k "
                "AND publish_id = :p"
            ),
            {"u": uid, "k": key, "p": body.publish_id},
        )
        db.execute(
            text(
                "INSERT INTO ship_kits (user_id, project_key, publish_id, document) VALUES "
                "(CAST(:u AS uuid), :k, :p, CAST(:d AS jsonb))"
            ),
            {"u": uid, "k": key, "p": body.publish_id, "d": body.model_dump_json()},
        )
        replaced = [
            r.object_key
            for r in db.execute(
                text(
                    "DELETE FROM ship_kit_media WHERE user_id = CAST(:u AS uuid) AND "
                    "project_key = :k "
                    "AND publish_id <> :p RETURNING object_key"
                ),
                {"u": uid, "k": key, "p": body.publish_id},
            ).all()
        ]
        db.execute(
            text(
                "DELETE FROM ship_kits WHERE user_id = CAST(:u AS uuid) AND project_key = :k "
                "AND publish_id <> :p"
            ),
            {"u": uid, "k": key, "p": body.publish_id},
        )
    if replaced:
        pm.delete_objects(replaced)
        ship_kit.sweep(uid, key)
    return {"publish_id": body.publish_id, "files": len(files), "replaced": len(replaced)}


@router.get("/projects/{key}/kit")
def get_kit(key: str, device: CurrentDevice = Depends(current_device)):
    """The project's kit for the phone: its document and every file with a read URL, or
    `{kit: null}` for a project of yours with none. 404 for a project that is not yours."""
    uid = str(device.user_id)
    _key(key)
    with db_session(viewer_id=uid) as db:
        if excluded_keys(db, uid, {key}):
            raise HTTPException(404, "not found")
        kit = db.execute(
            text(
                "SELECT publish_id, document, created_at FROM ship_kits WHERE user_id = "
                "CAST(:u AS uuid) AND project_key = :k ORDER BY created_at DESC LIMIT 1"
            ),
            {"u": uid, "k": key},
        ).first()
        if kit is None:
            if not pm.held(db, uid, key):
                raise HTTPException(404, "not found")
            return {"kit": None}
        rows = db.execute(
            text(
                f"SELECT {_KIT_COLUMNS} FROM ship_kit_media "
                "WHERE user_id = CAST(:u AS uuid) AND project_key = :k "
                "AND publish_id = :p AND committed ORDER BY slot, position"
            ),
            {"u": uid, "k": key, "p": kit.publish_id},
        ).all()
    return {
        "kit": {
            "document": kit.document,
            "published_at": kit.created_at.isoformat(),
            "files": [ship_kit.item(r) for r in rows],
        }
    }


@router.delete("/projects/{key}/kit")
def delete_kit(key: str, device: CurrentDevice = Depends(current_device)):
    """Every file and the document of this project's kit, then the prefix swept."""
    uid = str(device.user_id)
    _key(key)
    with db_session(viewer_id=uid) as db:
        rows = db.execute(
            text(
                "DELETE FROM ship_kit_media WHERE user_id = CAST(:u AS uuid) AND project_key = "
                ":k RETURNING object_key"
            ),
            {"u": uid, "k": key},
        ).all()
        db.execute(
            text("DELETE FROM ship_kits WHERE user_id = CAST(:u AS uuid) AND project_key = :k"),
            {"u": uid, "k": key},
        )
        if not rows and not pm.held(db, uid, key):
            raise HTTPException(404, "not found")
    pm.delete_objects([r.object_key for r in rows])
    ship_kit.sweep(uid, key)
    return {"deleted": len(rows)}


@router.get("/kit-media/{media_id}")
def read_kit_media(media_id: str, device: CurrentDevice = Depends(current_device)):
    """The local stack's read of a kit file, streamed to its owner's bearer (ranges work)."""
    uid = str(device.user_id)
    mid = _uuid(media_id)
    if _backend() != "file":
        raise HTTPException(404, "read this file through the url the kit returned")
    with db_session(viewer_id=uid) as db:
        row = db.execute(
            text(
                "SELECT object_key, content_type FROM ship_kit_media WHERE id = CAST(:m AS "
                "uuid) AND user_id = CAST(:u AS uuid) AND committed"
            ),
            {"m": mid, "u": uid},
        ).first()
    if row is None:
        raise HTTPException(404, "not found")
    path = objectstore.file_path(row.object_key)
    if not path.is_file():
        raise HTTPException(404, "not found")
    return FileResponse(
        path,
        media_type=row.content_type,
        headers={"Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff"},
    )
