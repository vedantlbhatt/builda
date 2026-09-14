"""Project demos: presign, upload (the local stack), commit, list, preview, read, delete.

docs/demos.md, "The API". The Mac publishes (`python -m capture demo --publish`,
capture/demo_publish.py) and the phone reads; both are the same person, and nobody else ever
gets anything: every row is owner only under RLS (0026), and a project that is not the
caller's is a 404, as the other owner routes answer.

WHO MAY CALL WHAT. Every route here is on `current_device`: a device token, the phone's
(Sign in with Apple or Google) or a paired Mac's (the device flow `capture pair` walks, whose
refresh token capture already rotates). A capture key is refused by prefix, as on every route
but the write only sync routes (`auth.current_uploader`). That is a decision, not an
omission: a key is the credential of a headless container, which has no simulator, no
display and no Vision check to make or vet a demo with; demo bytes are opaque images the
server cannot validate the way it validates a session's numbers; and a publish REPLACES, so a
key that could publish could delete the demo a person had. Keeping keys to their write only
routes keeps the rule "a leaked key writes what a container with the transcripts writes, and
nothing else" true.

A PUBLISH IS A SET. The Mac mints `publish_id` for one run, presigns each file under it right
before uploading it (so an upload URL lives only as long as that file's upload,
`project_media.upload_seconds`), and commits every file once all are uploaded. Rows start
uncommitted; a commit checks the object is in the store at the declared size and starts like
its type, then marks the row. The list and the preview show
only a publish with nothing left uncommitted (`_SHOWN`), and the commit that completes one
deletes the project's rows of every OTHER publish, with their objects: publishing replaces,
and the phone never shows half of the new set beside the old one. A presign for a new publish
drops any earlier publish that has not finished, whole, so a project holds at most the set it
shows and one set in flight; and only the commit that completes a set replaces anything, so
a retried commit can never wipe a newer publish.
The caps (8 images, 1 video) count the rows of one publish, committed or not, so a full set
refuses the next presign; the one video is also a unique index.

THE BYTES LIVE IN THE DEMOS STORE, a private bucket of their own (`objectstore.media_store`,
`MEDIA_STORE_*`), never the posts bucket, whose public base would serve a demo to anyone who
cut a presigned GET down to its path. Every deletion here ends with `project_media.sweep` of
the project's prefix, for the uploads that land through a URL that outlived its row.
"""

from __future__ import annotations

import os
import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from starlette.concurrency import run_in_threadpool

from .. import objectstore
from .. import project_media as pm
from ..auth import CurrentDevice, current_device
from ..builder_profile import excluded_keys
from ..db import db_session
from ..media_spec import MEDIA_CAPS, ProjectMediaPresign

router = APIRouter(prefix="/v1", tags=["media"])

#: Projects one preview may ask about. The Projects tab draws one door per project; a
#: person with more than this many projects pages the tab, not the request.
PREVIEW_KEYS_MAX = 50
#: Stills per project in the preview: the fanned stack on each door (docs/demos.md).
PREVIEW_STILLS = 3
#: The first bytes a commit reads to check a file is the type it was presigned as.
HEAD_BYTES = 16

_UNCONFIGURED = (
    "demo storage is not configured on this server: set MEDIA_STORE_ENDPOINT to "
    "file:///an/absolute/dir for the local stack, or to an S3 endpoint with "
    "MEDIA_STORE_BUCKET (a private bucket, never the posts bucket), MEDIA_STORE_KEY and "
    "MEDIA_STORE_SECRET"
)

#: The columns every read selects.
_COLUMNS = (
    "id, publish_id, kind, object_key, content_type, width, height, duration_ms, bytes, "
    "position, label, source, poster_object_key, poster_content_type, poster_bytes, committed"
)
#: Videos first, then stills by position (docs/demos.md).
_ORDER = "ORDER BY (kind = 'video') DESC, position, created_at, id"
#: What the phone sees of a project (alias `m`): committed rows of a publish with nothing
#: left uncommitted. While a new publish is part way through its commits, the one it will
#: replace is still whole and still what shows; the moment the new one completes, the commit
#: deletes the old in the same transaction, so two complete sets never coexist. Reads only
#: this table, under the same owner policy, so it sees exactly the caller's own rows.
_SHOWN = """
    m.committed AND NOT EXISTS (
      SELECT 1 FROM project_media q
      WHERE q.user_id = m.user_id AND q.project_key = m.project_key
        AND q.publish_id = m.publish_id AND NOT q.committed)
"""


def _key(key: str) -> str:
    if not pm.PROJECT_KEY.match(key):
        raise HTTPException(422, "a project key is the repository's 64 lowercase hex characters")
    return key


def _media_id(value: str) -> str:
    try:
        return str(uuid.UUID(value))
    except (ValueError, AttributeError, TypeError) as e:
        raise HTTPException(404, "not found") from e


def _backend() -> str:
    kind = objectstore.media_backend()
    if kind is None:
        raise HTTPException(503, _UNCONFIGURED)
    return kind


def _lock_person(db, uid: str) -> None:
    """Presigns and commits for one person run one at a time. Two presigns racing on a set
    with seven stills would both count seven and both insert (the capture key cap's reason,
    auth.create_capture_key); `users` has no RLS and 0003 grants the UPDATE a row lock needs."""
    db.execute(text("SELECT id FROM users WHERE id = CAST(:u AS uuid) FOR UPDATE"), {"u": uid})


def _upload(
    kind: str, uid: str, media_id: str, key: str, content_type: str, n: int, expires: int
) -> dict:
    headers = {"Content-Type": content_type, "Content-Length": str(n)}
    if kind == "file":
        token = pm.upload_token(uid, media_id, key, content_type, n, expires=expires)
        url = f"/v1/media-upload/{token}"
    else:
        url = objectstore.presign_put(
            key, content_type, expires, content_length=n, store=objectstore.media_store()
        )
    return {"upload_url": url, "method": "PUT", "headers": headers, "expires_in": expires}


# ----------------------------------------------------------------------------- preview
# Declared before any `/projects/{key}...` route, and this router is included before the
# sessions router (main.py): a path parameter matches `[^/]+`, so otherwise `media:preview`
# arrives at `GET /v1/projects/{key}` as a key and is refused as one.


@router.get("/projects/media:preview")
def preview(
    keys: str = Query(..., description="comma separated project keys"),
    device: CurrentDevice = Depends(current_device),
):
    """Up to three committed stills of each project, for the Projects tab. Every key asked
    about comes back, with [] when the caller has no demo there: a key that is somebody
    else's project reads exactly like a project of the caller's with no demo, because the
    caller's own rows are all that is ever read."""
    uid = str(device.user_id)
    asked = list(dict.fromkeys(k.strip() for k in keys.split(",") if k.strip()))
    if not asked:
        raise HTTPException(422, "send at least one project key")
    if len(asked) > PREVIEW_KEYS_MAX:
        raise HTTPException(422, f"at most {PREVIEW_KEYS_MAX} projects per preview")
    for k in asked:
        _key(k)
    with db_session(viewer_id=uid) as db:
        # The sweep deletes an excluded project's rows; the read leaves them out too, so
        # nothing about an excluded repository waits behind a filter or a race.
        gone = excluded_keys(db, uid, set(asked))
        rows = db.execute(
            text(
                f"""
                SELECT project_key, {_COLUMNS} FROM (
                  SELECT m.*, row_number() OVER (
                           PARTITION BY m.project_key ORDER BY m.position, m.created_at, m.id
                         ) AS nth
                  FROM project_media m
                  WHERE m.user_id = CAST(:u AS uuid) AND m.project_key = ANY(:keys)
                    AND m.kind = 'image' AND {_SHOWN}
                ) shown
                WHERE nth <= :n
                ORDER BY project_key, position, created_at, id
                """
            ),
            {"u": uid, "keys": [k for k in asked if k not in gone], "n": PREVIEW_STILLS},
        ).all()
    out: dict[str, list] = {k: [] for k in asked}
    for r in rows:
        out[r.project_key].append(pm.item(r))
    return {"projects": out}


# ----------------------------------------------------------------------------- publish


@router.post("/projects/{key}/media:presign")
def presign(key: str, body: ProjectMediaPresign, device: CurrentDevice = Depends(current_device)):
    """Where one file of a publish goes. The row is written now, uncommitted, so the upload
    URL names a row that exists and the caps count it; nothing is visible until the commit.
    `poster` on a video presigns its still frame onto the same row."""
    uid = str(device.user_id)
    _key(key)
    refused = pm.presign_refusal(body)
    if refused is not None:
        raise HTTPException(*refused)
    kind = _backend()
    media_id = str(uuid.uuid4())
    okey = pm.object_key(uid, key, media_id, body.content_type)
    pkey = (
        pm.object_key(uid, key, media_id, body.poster.content_type, poster=True)
        if body.poster
        else None
    )
    with db_session(viewer_id=uid) as db:
        _lock_person(db, uid)
        if not pm.held(db, uid, key):
            raise HTTPException(404, "no project of yours has that key")
        # At most one set in flight: an earlier publish that never finished is dropped WHOLE,
        # its committed files with its pending ones. Dropping only the pending ones would leave
        # its committed half with nothing pending, which `_SHOWN` reads as a complete set, and
        # the phone would draw half of an abandoned publish beside the demo it never replaced.
        # (The EXISTS reads the table as the statement began, so every row of it goes.)
        stale = db.execute(
            text(
                """
                DELETE FROM project_media m
                WHERE m.user_id = CAST(:u AS uuid) AND m.project_key = :k
                  AND m.publish_id <> :p
                  AND EXISTS (
                    SELECT 1 FROM project_media q
                    WHERE q.user_id = m.user_id AND q.project_key = m.project_key
                      AND q.publish_id = m.publish_id AND NOT q.committed)
                RETURNING m.object_key, m.poster_object_key
                """
            ),
            {"u": uid, "k": key, "p": body.publish_id},
        ).all()
        have = dict(
            db.execute(
                text(
                    """
                    SELECT kind, count(*) FROM project_media
                    WHERE user_id = CAST(:u AS uuid) AND project_key = :k AND publish_id = :p
                    GROUP BY kind
                    """
                ),
                {"u": uid, "k": key, "p": body.publish_id},
            ).all()
        )
        if body.kind == "image" and have.get("image", 0) >= MEDIA_CAPS["images"]:
            raise HTTPException(409, f"a demo holds at most {MEDIA_CAPS['images']} images")
        if body.kind == "video" and have.get("video", 0) >= MEDIA_CAPS["videos"]:
            raise HTTPException(409, "a demo holds one video")
        try:
            db.execute(
                text(
                    """
                    INSERT INTO project_media
                      (id, user_id, project_key, publish_id, kind, object_key, content_type,
                       width, height, duration_ms, bytes, position, label, source,
                       poster_object_key, poster_content_type, poster_bytes)
                    VALUES
                      (CAST(:id AS uuid), CAST(:u AS uuid), :k, :p, :kind, :okey, :ct,
                       :w, :h, :d, :n, :pos, :label, :source, :pkey, :pct, :pn)
                    """
                ),
                {
                    "id": media_id,
                    "u": uid,
                    "k": key,
                    "p": body.publish_id,
                    "kind": body.kind,
                    "okey": okey,
                    "ct": body.content_type,
                    "w": body.width,
                    "h": body.height,
                    "d": body.duration_ms,
                    "n": body.bytes,
                    "pos": body.position,
                    "label": body.label,
                    "source": body.source,
                    "pkey": pkey,
                    "pct": body.poster.content_type if body.poster else None,
                    "pn": body.poster.bytes if body.poster else None,
                },
            )
        except IntegrityError as e:
            raise HTTPException(
                409, f"this publish already has {pm.article(body.kind)} at position {body.position}"
            ) from e
    pm.delete_objects(pm.object_keys_of(stale))
    # Both of a video's URLs live as long as the two uploads take together: the Mac sends
    # the video, then its poster, straight after this answer (pm.upload_seconds).
    expires = pm.upload_seconds(body.bytes + (body.poster.bytes if body.poster else 0))
    out = {
        "media_id": media_id,
        **_upload(kind, uid, media_id, okey, body.content_type, body.bytes, expires),
        "poster": None,
    }
    if body.poster is not None:
        poster = body.poster
        out["poster"] = _upload(
            kind, uid, media_id, pkey, poster.content_type, poster.bytes, expires
        )
    return out


def _object_problem(key: str, n: int, content_type: str, what: str) -> str | None:
    """Why the object at `key` is not the file the presign declared, or None."""
    try:
        size = objectstore.media_stat(key)
        head = objectstore.media_head_bytes(key, HEAD_BYTES) if size else None
    except OSError as e:
        raise HTTPException(503, f"the object store did not answer: {e}") from e
    if size is None:
        return f"nothing has been uploaded for the {what} yet"
    if size != n:
        return f"the {what} is {size} bytes; its presign said {n}"
    if not pm.looks_like(content_type, head):
        return f"the {what} does not start like {content_type}"
    return None


@router.post("/projects/{key}/media/{media_id}:commit")
def commit(key: str, media_id: str, device: CurrentDevice = Depends(current_device)):
    """The file is there: make the row visible. Checks the object is in the store at the
    size the presign declared and starts like its type (the poster too), and is idempotent.
    When this was the last uncommitted file of its publish, the project's other sets go."""
    uid = str(device.user_id)
    _key(key)
    mid = _media_id(media_id)
    _backend()
    select = text(
        f"SELECT {_COLUMNS} FROM project_media "
        "WHERE id = CAST(:m AS uuid) AND project_key = :k AND user_id = CAST(:u AS uuid)"
    )
    params = {"m": mid, "k": key, "u": uid}
    with db_session(viewer_id=uid) as db:
        row = db.execute(select, params).first()
    if row is None:
        # Its row is gone (a newer publish, a delete): the upload this Mac just made through
        # a URL still good at the bucket is an object nothing keeps. Sweep it now, while the
        # Mac that made it is the one asking.
        pm.sweep(uid, key)
        raise HTTPException(404, "not found")
    if not row.committed:
        problem = _object_problem(row.object_key, row.bytes, row.content_type, row.kind)
        if problem is None and row.poster_object_key:
            problem = _object_problem(
                row.poster_object_key, row.poster_bytes, row.poster_content_type, "poster"
            )
        if problem is not None:
            raise HTTPException(409, problem)
    replaced: list = []
    pending = 0
    with db_session(viewer_id=uid) as db:
        _lock_person(db, uid)
        now_committed = db.execute(
            text(
                "UPDATE project_media SET committed = true, committed_at = now() "
                "WHERE id = CAST(:m AS uuid) AND NOT committed RETURNING id"
            ),
            {"m": mid},
        ).first()
        row = db.execute(select, params).first()
        if row is not None:
            pending = db.execute(
                text(
                    """
                    SELECT count(*) FROM project_media
                    WHERE user_id = CAST(:u AS uuid) AND project_key = :k
                      AND publish_id = :p AND NOT committed
                    """
                ),
                {"u": uid, "k": key, "p": row.publish_id},
            ).scalar()
            # Only the commit that COMPLETES a set replaces anything. A retried commit of a
            # file already committed (its answer lost on the way back) must not: its set may
            # be the old one a newer publish is part way through replacing.
            if pending == 0 and now_committed is not None:
                replaced = db.execute(
                    text(
                        """
                        DELETE FROM project_media
                        WHERE user_id = CAST(:u AS uuid) AND project_key = :k
                          AND publish_id <> :p
                        RETURNING object_key, poster_object_key
                        """
                    ),
                    {"u": uid, "k": key, "p": row.publish_id},
                ).all()
    if row is None:  # a newer publish or a delete took it between the two transactions
        pm.sweep(uid, key)
        raise HTTPException(404, "not found")
    if replaced:
        pm.delete_objects(pm.object_keys_of(replaced))
        # And whatever landed for the replaced sets after their rows went (a second Mac's
        # upload through a URL still good at the bucket): the prefix, swept.
        pm.sweep(uid, key)
    return {"item": pm.item(row), "pending": int(pending), "replaced": len(replaced)}


# -------------------------------------------------------------------------------- read


@router.get("/projects/{key}/media")
def list_media(key: str, device: CurrentDevice = Depends(current_device)):
    """A project's demo for its page: committed files only, the video first, then the stills
    by position. 404 for a project that is not the caller's, as `GET /v1/projects/{key}`."""
    uid = str(device.user_id)
    _key(key)
    with db_session(viewer_id=uid) as db:
        if excluded_keys(db, uid, {key}):
            raise HTTPException(404, "not found")
        rows = db.execute(
            text(
                f"SELECT {_COLUMNS} FROM project_media m "
                f"WHERE m.user_id = CAST(:u AS uuid) AND m.project_key = :k AND {_SHOWN} {_ORDER}"
            ),
            {"u": uid, "k": key},
        ).all()
        if not rows and not pm.held(db, uid, key):
            raise HTTPException(404, "not found")
    return {"items": [pm.item(r) for r in rows]}


def _stream(media_id: str, device: CurrentDevice, *, poster: bool):
    uid = str(device.user_id)
    mid = _media_id(media_id)
    if _backend() != "file":
        raise HTTPException(404, "read this file through the url the list returned")
    with db_session(viewer_id=uid) as db:
        row = db.execute(
            text(
                f"SELECT {_COLUMNS} FROM project_media "
                "WHERE id = CAST(:m AS uuid) AND user_id = CAST(:u AS uuid) AND committed"
            ),
            {"m": mid, "u": uid},
        ).first()
    key = None if row is None else (row.poster_object_key if poster else row.object_key)
    if key is None:
        raise HTTPException(404, "not found")
    path = objectstore.file_path(key)
    if not path.is_file():
        raise HTTPException(404, "not found")
    return FileResponse(
        path,
        media_type=row.poster_content_type if poster else row.content_type,
        headers={
            "Cache-Control": "private, max-age=300",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/media/{media_id}")
def read_media(media_id: str, device: CurrentDevice = Depends(current_device)):
    """The local stack's read: the bytes, streamed from disk, to their owner's bearer only.
    Ranges work (Starlette's FileResponse), which a video player needs to seek. In
    production the list hands out presigned GETs instead, and this answers 404."""
    return _stream(media_id, device, poster=False)


@router.get("/media/{media_id}/poster")
def read_poster(media_id: str, device: CurrentDevice = Depends(current_device)):
    return _stream(media_id, device, poster=True)


# ------------------------------------------------------------------------------ upload


def _waiting(claims: dict) -> bool:
    """Is the row this token was made for still waiting for this object? A publish that was
    replaced, or a demo deleted since the presign, has no row, and its upload is refused
    rather than left on disk with nothing pointing at it."""
    with db_session(viewer_id=claims["sub"]) as db:
        return bool(
            db.execute(
                text(
                    """
                    SELECT EXISTS (
                      SELECT 1 FROM project_media
                      WHERE id = CAST(:m AS uuid) AND user_id = CAST(:u AS uuid) AND NOT committed
                        AND (object_key = :k OR poster_object_key = :k))
                    """
                ),
                {"m": claims["mid"], "u": claims["sub"], "k": claims["key"]},
            ).scalar()
        )


@router.put("/media-upload/{token}", status_code=204)
async def upload(token: str, request: Request):
    """The file backend's presigned PUT (docs/demos.md, "Storage"): the token is the grant,
    not a bearer, exactly as a presigned URL is the bucket's. It names one object, its type
    and its size (`project_media.upload_token`): the request must send that Content-Type and
    that Content-Length, the bytes must be that many and start like that type, and the file
    is created exclusively, so a token that has uploaded once never writes again."""
    root = objectstore.media_file_root()
    if root is None:
        raise HTTPException(404, "not found")
    claims = pm.read_upload_token(token)
    content_type = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    if content_type != claims["ct"]:
        said = content_type or "nothing"
        raise HTTPException(415, f"this upload is {claims['ct']}, and the request said {said}")
    length = request.headers.get("content-length")
    if length is None:
        raise HTTPException(411, "send Content-Length: the size this upload was presigned for")
    if not length.isdigit() or int(length) != claims["n"]:
        status = 413 if length.isdigit() and int(length) > claims["n"] else 400
        raise HTTPException(status, f"this upload is {claims['n']} bytes, not {length}")
    if not await run_in_threadpool(_waiting, claims):
        raise HTTPException(
            404, "nothing is waiting for this upload: the publish was replaced or deleted"
        )
    path = objectstore.file_path(claims["key"], root=root)
    if path.exists():
        raise HTTPException(409, "this upload link has been used")
    objectstore.ensure_private_dir(path.parent)
    part = path.with_name(f".{path.name}.{secrets.token_hex(6)}.part")
    written = 0
    head = b""
    try:
        with open(part, "xb") as f:
            os.chmod(part, 0o600)
            async for chunk in request.stream():
                written += len(chunk)
                if written > claims["n"]:
                    raise HTTPException(413, f"this upload is {claims['n']} bytes; more arrived")
                if len(head) < HEAD_BYTES:
                    head += chunk[: HEAD_BYTES - len(head)]
                f.write(chunk)
        if written != claims["n"]:
            raise HTTPException(400, f"this upload is {claims['n']} bytes, and {written} arrived")
        if not pm.looks_like(claims["ct"], head):
            raise HTTPException(415, f"these bytes are not {claims['ct']}")
        try:
            os.link(part, path)  # fails if the object exists: the single use, kept by the disk
        except FileExistsError as e:
            raise HTTPException(409, "this upload link has been used") from e
    finally:
        part.unlink(missing_ok=True)
    return Response(status_code=204)


# ------------------------------------------------------------------------------ delete


@router.delete("/projects/{key}/media")
def delete_media(key: str, device: CurrentDevice = Depends(current_device)):
    """Every file of this project's demo, committed or not: the rows in this transaction,
    then the objects, then the project's prefix swept for anything no row names (an upload
    through a URL that outlived its row; `project_media` module docstring). The phone's
    delete and `capture demo --delete`. Answers how many rows went."""
    uid = str(device.user_id)
    _key(key)
    with db_session(viewer_id=uid) as db:
        n, keys = pm.forget_project(db, uid, key)
        if n == 0 and not pm.held(db, uid, key):
            raise HTTPException(404, "not found")
    pm.delete_objects(keys)
    pm.sweep(uid, key)
    return {"deleted": n}
