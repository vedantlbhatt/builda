"""Drops: share in, resolve, offer, tap, run. docs/drops.md.

WHO MAY CALL WHAT. Every route is on `current_device`: the phone shares and taps, a paired Mac
resolves and runs. A capture key is refused by prefix, as on every route but the write only
sync routes: a key is the credential of a headless container, and a container has no browser to
read a public page with, no `claude` to plan with, and no business starting work on somebody's
machine. Keeping keys to their own routes keeps "a leaked key writes what a container with the
transcripts writes, and nothing else" true.

THE ONE RULE THIS FILE ENFORCES THAT NOTHING ELSE CAN. A move is inert until a person taps it.
There is no route that queues a move in bulk, no query parameter that auto starts, and no
setting anywhere that turns one on. `POST .../moves/{id}:start` is one move, by id, and it
moves a row out of `offered` only if it is still in `offered`. A caption that a model turned
into a convincing move still has to get past a human thumb.

THE URL IS NEVER FETCHED BY THIS SERVER. It is validated as a URL, stored as text, and handed
back to the Mac that will read it. A server that fetched a link a stranger composed would be a
request forgery primitive with an authentication header attached.
"""

from __future__ import annotations

import contextlib
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from .. import drop_push, drops_notify
from .. import drops_store as store
from ..auth import CurrentDevice, current_device
from ..db import db_session
from ..drops_spec import DropResolution
from .push import send_drop

router = APIRouter(prefix="/v1", tags=["drops"])

#: The same door drops/urls.py holds on the Mac, restated here because the Mac is not the only
#: thing that can POST: the check that a stored URL is https and bounded has to live on the
#: side that owns the column. The NORMALISATION is the client's (one rule, in one language);
#: the VALIDATION is the server's, and a link that arrives unnormalised is accepted as it is
#: rather than rewritten by a second implementation that could differ.
_URL = re.compile(r"^https://[^\s/@]+\.[^\s/@]+(/[^\s]*)?$")
_REPO_KEY = re.compile(r"^[0-9a-f]{64}$")
_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


class DropIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str = Field(min_length=8, max_length=500)
    platform: str = Field(min_length=1, max_length=20)
    #: Whatever the share sheet carried besides the link. Stored until the resolution uses it,
    #: then set to NULL (0028). Capped here as well as in the column: a 422 is a better answer
    #: than a constraint violation rendered as a 500.
    shared_text: str | None = Field(default=None, max_length=1000)


class StartIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: What the person typed before starting it. Theirs, so it travels and is stored.
    adjustment: str | None = Field(default=None, max_length=500)
    #: Which repository an `existing_repo` move points at: the salted key, never a name.
    repo_key: str | None = Field(default=None, max_length=64)


class FinishIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str
    outcome: str | None = Field(default=None, max_length=300)
    #: The Claude Code run's own id, not a Builda session's (0029). The session for it does not
    #: exist yet when this is written, and may never.
    run_uuid: str | None = Field(default=None, max_length=36)


class RefusalIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    refusal: str


def _uid(device: CurrentDevice) -> str:
    return str(device.user_id)


@router.post("/drops", status_code=201)
def share(body: DropIn, device: CurrentDevice = Depends(current_device)):
    """The share sheet's route. Idempotent on (user, url): the same reel twice is one card."""
    from ..drops_spec import ANALYSIS_ENUM_VALUES

    if not _URL.match(body.url):
        raise HTTPException(422, "url must be https and look like a link")
    if body.platform not in ANALYSIS_ENUM_VALUES["platform"]:
        raise HTTPException(422, f"platform must be one of {ANALYSIS_ENUM_VALUES['platform']}")
    uid = _uid(device)
    with db_session(viewer_id=uid) as db:
        row = store.create_drop(
            db, uid, url=body.url, platform=body.platform, shared_text=body.shared_text
        )
    created = row.pop("created", True)
    # After the commit: the island's card for a reel you are still scrolling past
    # (docs/drop-island.md). Only for a drop this share made; never fails the share.
    drop_push.after_share(uid, row, created=bool(created))
    return {"drop": row, "created": bool(created)}


@router.get("/drops")
def board(
    archived: bool = Query(default=False, description="include archived drops"),
    device: CurrentDevice = Depends(current_device),
):
    """The whole board in one request.

    Drops and moves come back as two flat lists rather than nested, so the phone can diff each
    independently: a move whose status changed must not redraw the card it belongs to.
    """
    uid = _uid(device)
    with db_session(viewer_id=uid) as db:
        drops, moves = store.board(db, uid, include_archived=archived)
    return {"drops": drops, "moves": moves}


@router.get("/drops/{drop_id}")
def one(drop_id: str, device: CurrentDevice = Depends(current_device)):
    uid = _uid(device)
    with db_session(viewer_id=uid) as db:
        drop = store.get_drop(db, uid, drop_id)
        if not drop:
            raise HTTPException(404, "no such drop")
        return {"drop": drop, "moves": store.moves_of(db, uid, drop_id)}


@router.post("/drops:claim")
def claim(
    limit: int = Query(default=store.CLAIM_LIMIT, ge=1, le=10),
    device: CurrentDevice = Depends(current_device),
):
    """The Mac's poll: take unread drops and mark them `resolving`.

    A POST, not a GET, because it MOVES rows. A GET that mutates is a GET a proxy will replay.
    """
    uid = _uid(device)
    with db_session(viewer_id=uid) as db:
        claimed = store.claim_waiting(db, uid, limit=limit)
    # The card says "reading" now: the Mac has it.
    drop_push.after_transition(uid, [d["id"] for d in claimed])
    return {"drops": claimed}


@router.put("/drops/{drop_id}/resolution")
def put_resolution(
    drop_id: str, body: DropResolution, device: CurrentDevice = Depends(current_device)
):
    """What the Mac read and planned. The door is the generated Pydantic model, which forbids
    an undeclared field at every level and enforces the plan-or-refusal rule."""
    uid = _uid(device)
    payload = body.model_dump(mode="json")
    with db_session(viewer_id=uid) as db:
        before = store.get_drop(db, uid, drop_id)
        if not before:
            raise HTTPException(404, "no such drop")
        out = store.apply_resolution(db, uid, drop_id, payload)
        after = store.get_drop(db, uid, drop_id)
    # AFTER the transaction commits, for notify.py's reason: a push failure must never roll back
    # what was stored, and a crash between the two loses a banner rather than doubling one.
    island = drop_push.after_transition(uid, [drop_id])
    if not any(p.alerts for p in island):
        # One moment, one alert: when the island's card already said it (and lit the screen),
        # the banner that would pull you out of the app you are in is not sent as well.
        _tell_them_it_was_read(uid, drop_id, before, after or {}, out["moves"])
    return out


def _tell_them_it_was_read(uid: str, drop_id: str, before: dict, after: dict, moves: int) -> None:
    """One banner the first time a drop is read, and never again.

    A re-resolution moved the content, not the fact that the link has been read
    (`drops_notify.is_first_read`), and a bulk re-read would otherwise fire a burst of banners for
    links somebody shared days ago.
    """
    if not drops_notify.is_first_read(bool(before.get("resolution")), bool(before.get("refusal"))):
        return
    title, body = drops_notify.compose_read(
        title=after.get("title"), kind=after.get("kind"), refusal=after.get("refusal"), moves=moves
    )
    with contextlib.suppress(Exception):
        send_drop(uid, title, body, drop_id, drops_notify.KIND_DROP_READ)


@router.put("/drops/{drop_id}/refusal")
def put_refusal(drop_id: str, body: RefusalIn, device: CurrentDevice = Depends(current_device)):
    """A link the Mac could not read at all: no source block, just the code."""
    from ..drops_spec import ANALYSIS_ENUM_VALUES

    if body.refusal not in ANALYSIS_ENUM_VALUES["drop_refusal"]:
        raise HTTPException(422, "refusal must be one of the spec's codes")
    uid = _uid(device)
    with db_session(viewer_id=uid) as db:
        before = store.get_drop(db, uid, drop_id)
        if not before:
            raise HTTPException(404, "no such drop")
        store.mark_refused(db, uid, drop_id, body.refusal)
        after = store.get_drop(db, uid, drop_id)
    island = drop_push.after_transition(uid, [drop_id])
    if not any(p.alerts for p in island):
        _tell_them_it_was_read(uid, drop_id, before, after or {}, 0)
    return {"status": "refused", "refusal": body.refusal}


@router.post("/drops/{drop_id}/moves/{move_id}:start")
def start(
    drop_id: str, move_id: str, body: StartIn, device: CurrentDevice = Depends(current_device)
):
    """A person tapped it. THE ONLY WAY A MOVE IS EVER QUEUED."""
    if body.repo_key is not None and not _REPO_KEY.match(body.repo_key):
        raise HTTPException(422, "repo_key is the 64 character salted key, never a name")
    uid = _uid(device)
    with db_session(viewer_id=uid) as db:
        move = store.start_move(
            db, uid, move_id, adjustment=body.adjustment, repo_key=body.repo_key
        )
        if move is None:
            # Either it is not theirs, or it has already left `offered`. Both answer 409 with
            # the row when there is one, so a double tap is visibly a no op and not an error.
            current = next(
                (m for m in store.moves_of(db, uid, drop_id) if m["id"] == move_id), None
            )
            if current is None:
                raise HTTPException(404, "no such move")
            raise HTTPException(409, f"move is already {current['status']}")
    # Whoever tapped it (the board, or the island's own Start), the card says it started.
    drop_push.after_transition(uid, [move["drop_id"]], started_move_id=move_id)
    return {"move": move}


@router.post("/drops/{drop_id}/moves/{move_id}:decline")
def decline(drop_id: str, move_id: str, device: CurrentDevice = Depends(current_device)):
    uid = _uid(device)
    with db_session(viewer_id=uid) as db:
        move = store.decline_move(db, uid, move_id)
        if move is None:
            raise HTTPException(404, "no such move, or it has already started")
        return {"move": move}


@router.post("/drops/moves:claim")
def claim_moves(
    limit: int = Query(default=2, ge=1, le=5), device: CurrentDevice = Depends(current_device)
):
    """The runner's poll: take queued moves and mark them `running`."""
    uid = _uid(device)
    with db_session(viewer_id=uid) as db:
        return {"moves": store.claim_queued(db, uid, limit=limit)}


@router.post("/drops/moves/{move_id}:finish")
def finish(move_id: str, body: FinishIn, device: CurrentDevice = Depends(current_device)):
    """The runner says how it went, and which run it was."""
    if body.status not in ("done", "failed"):
        raise HTTPException(422, "status is done or failed")
    if body.run_uuid is not None and not _UUID.match(body.run_uuid):
        raise HTTPException(422, "run_uuid is a uuid")
    uid = _uid(device)
    with db_session(viewer_id=uid) as db:
        move = store.finish_move(
            db,
            uid,
            move_id,
            status=body.status,
            outcome=body.outcome,
            run_uuid=body.run_uuid,
        )
        if move is None:
            raise HTTPException(409, "no such move, or it was not running")
        # Cheap, and the only moment anything is likely to have changed.
        store.link_session(db, uid)
    # The payoff, and the one banner worth interrupting somebody for. Outside the transaction,
    # like the read banner.
    title, body_text = drops_notify.compose_finished(
        title=move["title"], outcome=move["outcome"], ok=body.status == "done"
    )
    with contextlib.suppress(Exception):
        send_drop(uid, title, body_text, move["drop_id"], drops_notify.KIND_DROP_DONE)
    return {"move": move}


@router.post("/drops/{drop_id}:archive")
def archive(
    drop_id: str,
    on: bool = Query(default=True),
    device: CurrentDevice = Depends(current_device),
):
    uid = _uid(device)
    with db_session(viewer_id=uid) as db:
        if not store.archive(db, uid, drop_id, on=on):
            raise HTTPException(404, "no such drop")
    return {"archived": on}


@router.delete("/drops/{drop_id}", status_code=204)
def remove(drop_id: str, device: CurrentDevice = Depends(current_device)):
    """Gone, with its moves (0028 cascades). Deleting a drop whose move is running does not
    stop the run on the Mac; the run is a Claude Code session and stopping it is done there."""
    uid = _uid(device)
    with db_session(viewer_id=uid) as db:
        if not store.delete_drop(db, uid, drop_id):
            raise HTTPException(404, "no such drop")
    return None
