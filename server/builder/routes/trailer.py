"""The director: the owner's notes on a project's trailer, from the phone to their Mac and back.

spec/trailer.v1.json is the shape of everything here (`NoteIn`, `NoteFinish`, `Change`, the codes);
0035 is the table; builder/trailer_notes.py is the rest of the store. The flow is the demo request's
(routes/shipkit.py), which is the pattern this copies:

    POST   /v1/projects/{key}/trailer/notes   {body}      the phone (a person's app, never the Mac)
    GET    /v1/projects/{key}/trailer/notes?limit=30      newest first
    POST   /v1/trailer/notes:claim                         the Mac takes up to 5, once each
    POST   /v1/trailer/notes/{id}:finish      NoteFinish   done with a version, or failed with why
    DELETE /v1/trailer/notes/{id}                          the phone takes back one nobody claimed

A refusal is a code in `detail`, never a sentence: `bad_key`, `not_found`, `empty_note`,
`too_many_notes`, `not_finishable`, `done_needs_version`, `done_has_refusal`,
`failed_needs_refusal`, `failed_has_version`, `failed_has_changes`, `not_claimed`, `not_queued`.
A project that is not the caller's is a 404 (`project_media.held`, the kit routes' rule), and every
row is owner only under RLS (0035), so a route that forgot a check would leak nothing.
"""

from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text

from .. import project_media as pm
from .. import trailer_notes as tn
from ..auth import CurrentDevice, current_device, current_person
from ..db import db_session
from ..trailer_spec import NoteFinish, NoteIn

router = APIRouter(prefix="/v1", tags=["trailer"])


def _key(key: str) -> str:
    if not pm.PROJECT_KEY.match(key):
        raise HTTPException(422, "bad_key")
    return key


def _uuid(value: str) -> str:
    try:
        return str(uuid.UUID(value))
    except (ValueError, AttributeError, TypeError) as e:
        raise HTTPException(404, "not_found") from e


@router.post("/projects/{key}/trailer/notes", status_code=201)
def send_note(key: str, body: NoteIn, device: CurrentDevice = Depends(current_person)):
    """A note in the owner's words, for their Mac. `current_person`: the phone or the desktop app,
    never the Mac or a paired machine, because a note makes the Mac run claude over the project and
    that is only ever a person's ask. At most `WAITING_MAX` waiting a project (409)."""
    uid = str(device.user_id)
    _key(key)
    words = body.body.strip()
    if not words:
        raise HTTPException(422, "empty_note")
    with db_session(viewer_id=uid) as db:
        # One writer at a time for this person, so two notes sent at once cannot both see four
        # waiting and make six (the kit presign's lock).
        db.execute(text("SELECT id FROM users WHERE id = CAST(:u AS uuid) FOR UPDATE"), {"u": uid})
        if not pm.held(db, uid, key):
            raise HTTPException(404, "not_found")
        waiting = db.execute(
            text(
                "SELECT count(*) FROM trailer_notes WHERE user_id = CAST(:u AS uuid) "
                "AND project_key = :k AND status IN ('queued', 'claimed')"
            ),
            {"u": uid, "k": key},
        ).scalar()
        if waiting >= tn.WAITING_MAX:
            raise HTTPException(409, "too_many_notes")
        row = db.execute(
            text(
                f"""
                INSERT INTO trailer_notes (user_id, project_key, body)
                VALUES (CAST(:u AS uuid), :k, :b) RETURNING {tn.COLUMNS}
                """
            ),
            {"u": uid, "k": key, "b": words},
        ).one()
    return {"note": tn.item(row)}


@router.get("/projects/{key}/trailer/notes")
def list_notes(
    key: str,
    limit: int = Query(tn.LIST_DEFAULT, ge=1, le=tn.LIST_MAX),
    device: CurrentDevice = Depends(current_device),
):
    """The project's notes, newest first, with each one's answer: the chat on the project page."""
    uid = str(device.user_id)
    _key(key)
    with db_session(viewer_id=uid) as db:
        rows = db.execute(
            text(
                f"SELECT {tn.COLUMNS} FROM trailer_notes WHERE user_id = CAST(:u AS uuid) "
                "AND project_key = :k ORDER BY created_at DESC, id DESC LIMIT :n"
            ),
            {"u": uid, "k": key, "n": limit},
        ).all()
        if not rows and not pm.held(db, uid, key):
            raise HTTPException(404, "not_found")
    return {"notes": [tn.item(r) for r in rows]}


@router.post("/trailer/notes:claim")
def claim_notes(device: CurrentDevice = Depends(current_device)):
    """The Mac takes the oldest waiting notes (at most `CLAIM_MAX`), each exactly once, and any
    claim a Mac left more than ten minutes ago."""
    uid = str(device.user_id)
    with db_session(viewer_id=uid) as db:
        rows = tn.claim(db, uid, str(device.device_id))
    return {"notes": [tn.claimed(r) for r in rows]}


@router.post("/trailer/notes/{note_id}:finish")
def finish_note(note_id: str, body: NoteFinish, device: CurrentDevice = Depends(current_device)):
    """A claimed note ends: `done` with the version it made and what changed, or `failed` with a
    refusal code and nothing made. Nothing else finishes one, and a note ends once (409)."""
    uid = str(device.user_id)
    nid = _uuid(note_id)
    if body.status not in ("done", "failed"):
        raise HTTPException(422, "not_finishable")
    if body.status == "done":
        if body.to_version is None:
            raise HTTPException(422, "done_needs_version")
        if body.refusal is not None:
            raise HTTPException(422, "done_has_refusal")
    else:
        if body.refusal is None:
            raise HTTPException(422, "failed_needs_refusal")
        if body.to_version is not None:
            raise HTTPException(422, "failed_has_version")
        if body.changes:
            raise HTTPException(422, "failed_has_changes")
    changes = json.dumps([c.model_dump(mode="json") for c in body.changes])
    with db_session(viewer_id=uid) as db:
        row = db.execute(
            text(
                f"""
                UPDATE trailer_notes SET status = :s, finished_at = now(), from_version = :fv,
                  to_version = :tv, changes = CAST(:c AS jsonb), refusal = :r, source = :src
                WHERE id = CAST(:id AS uuid) AND user_id = CAST(:u AS uuid) AND status = 'claimed'
                RETURNING {tn.COLUMNS}
                """
            ),
            {
                "s": body.status,
                "fv": body.from_version,
                "tv": body.to_version,
                "c": changes,
                "r": body.refusal,
                "src": body.source,
                "id": nid,
                "u": uid,
            },
        ).first()
        if row is None:
            exists = db.execute(
                text(
                    "SELECT status FROM trailer_notes WHERE id = CAST(:id AS uuid) "
                    "AND user_id = CAST(:u AS uuid)"
                ),
                {"id": nid, "u": uid},
            ).first()
    if row is None:
        if exists is None:
            raise HTTPException(404, "not_found")
        raise HTTPException(409, "not_claimed")
    return {"note": tn.item(row)}


@router.delete("/trailer/notes/{note_id}")
def cancel_note(note_id: str, device: CurrentDevice = Depends(current_person)):
    """The phone takes back a note no Mac has claimed yet. Once claimed, the Mac is already cutting
    it, and the answer arrives either way (409)."""
    uid = str(device.user_id)
    nid = _uuid(note_id)
    with db_session(viewer_id=uid) as db:
        row = db.execute(
            text(
                f"""
                UPDATE trailer_notes SET status = 'cancelled', finished_at = now()
                WHERE id = CAST(:id AS uuid) AND user_id = CAST(:u AS uuid) AND status = 'queued'
                RETURNING {tn.COLUMNS}
                """
            ),
            {"id": nid, "u": uid},
        ).first()
        if row is None:
            exists = db.execute(
                text(
                    "SELECT status FROM trailer_notes WHERE id = CAST(:id AS uuid) "
                    "AND user_id = CAST(:u AS uuid)"
                ),
                {"id": nid, "u": uid},
            ).first()
    if row is None:
        if exists is None:
            raise HTTPException(404, "not_found")
        raise HTTPException(409, "not_queued")
    return {"note": tn.item(row)}
