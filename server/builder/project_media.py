"""Project demos on the server (docs/demos.md): the door, the file backend's upload tokens,
what a row looks like to the phone, and the sweeps that take a demo away.

The routes are routes/media.py. Four rules shape this module.

THE DOOR IS TWO HALVES, as it is for quotes. `media_spec.py` (generated from the contract's
`project_media` section, `extra="forbid"`) is the shape: a presign that carries anything the
section does not declare (the commit a demo was taken at, a file name, the manifest's
`taken_at`) is a 422 before any of this runs. `presign_refusal` is the rest: a content type of
the kind it claims and inside its size cap, a video with a length and an image without one, a
poster only on a video, and a label of plain words.

A PROJECT MUST BE YOURS. `held` is the rule the project page answers by (routes/sessions.py
`project`): a repository this account has a session in, or a key in its own stored report,
and never one it excluded. So a key typed from nowhere cannot collect files, and an excluded
repository, which has NOTHING on the server, cannot start having something.

AN OBJECT IS DELETED AFTER ITS ROW. Every sweep deletes rows inside the caller's transaction
and returns the object keys; the caller deletes the objects once that transaction has
committed (`delete_objects`). The other order leaves rows that name objects already gone,
which the phone draws as broken images; this one can leave an object no row names, which
nobody can read (every read goes through a row) and which sits under
`project-media/<user id>/` for a sweep by prefix.

THE FILE BACKEND'S UPLOAD URL IS A TOKEN, NOT A BEARER. A presigned S3 URL is the bucket's
capability; the local stack's equivalent is `PUT /v1/media-upload/<token>`, a JWT signed with
the API's own key for ONE object: its row, its key, its content type and its size, for
`UPLOAD_URL_SECONDS`. Its audience is `UPLOAD_AUDIENCE`, so it is never an access token (the
access token verifier refuses any token with an audience) and an access token is never an
upload token (this verifier requires one). Single use is the store's: the route creates the
file exclusively, so a token that has uploaded once can never write again.
"""

from __future__ import annotations

import logging
import re
import secrets
import uuid
from datetime import UTC, datetime, timedelta

import jwt
from fastapi import HTTPException
from sqlalchemy import text

from . import objectstore
from .builder_profile import _report_keys, builder_report, excluded_keys
from .media_spec import (
    MEDIA_CAPS,
    MEDIA_CONTENT_TYPES,
    MEDIA_LABEL_PATTERN,
    MEDIA_LABEL_RULE,
    MEDIA_MAX_LENGTHS,
    ProjectMediaPresign,
)
from .settings import settings

log = logging.getLogger("builder.project_media")

#: How long a presigned GET (production) stays good. As long as an access token lives
#: (`access_token_ttl_seconds`, 900), so a link to a demo never outlives the credential that
#: fetched it by more than one token's life, and long enough for the phone to open a video
#: the list returned and play it through. PRIVACY.md reads this number from here.
READ_URL_SECONDS = 900

#: How long an upload URL stays good, either backend: the post photos' 15 minutes
#: (routes/social.py), which is 40 MiB at 0.36 Mb/s, slower than any uplink a Mac on a
#: network has. A URL the Mac never used is dead after that; its row is swept by the next
#: publish of the project or deleted with the project's demo.
UPLOAD_URL_SECONDS = 900

UPLOAD_AUDIENCE = "builder-media-upload"

#: A project key in a demo route: the repository's salted hash, whole. The 12 character
#: prefix the old profile lists is refused rather than resolved, because a prefix that
#: matches two of a person's projects would publish into whichever came first.
PROJECT_KEY = re.compile(r"^[0-9a-f]{64}$")

#: The extension an object key gets, per content type. The type is also signed into an S3
#: upload and checked against the file's first bytes at commit (`looks_like`).
EXTENSIONS = {"image/png": "png", "image/jpeg": "jpg", "video/mp4": "mp4"}

_LABEL = re.compile(MEDIA_LABEL_PATTERN)


# ------------------------------------------------------------------------------- the door


def label_refusal(label: str) -> str | None:
    """Why this label may not be stored, or None. The contract's `label_rule`: ASCII letters,
    digits, the space and , . ' ( ) : ? ! & only, at least one letter, no word over
    `label_word` characters. No dash of any kind and no hyphen at all: a hyphen inside a word
    is not a dash to `plain.has_dash`, but it is how a branch name, a file name, a uuid or a
    key (`sk-ant-...`) arrives, and a label says what a screen shows in words."""
    cap = MEDIA_MAX_LENGTHS["label"]
    if not label.strip():
        return "a label says what the screen shows; this one is empty"
    if len(label) > cap:
        return f"a label is at most {cap} characters; this one is {len(label)}"
    if label != label.strip() or "  " in label:
        return "a label has single spaces between words and none at either end"
    bad = sorted({ch for ch in label if not _LABEL.match(ch)})
    if bad:
        shown = " ".join(repr(ch) for ch in bad[:5])
        return f"a label is plain words ({MEDIA_LABEL_RULE}); it may not carry {shown}"
    if not any(ch.isalpha() for ch in label):
        return "a label needs at least one word"
    word = MEDIA_CAPS["label_word"]
    long = [w for w in label.split(" ") if len(w) > word]
    if long:
        return f"no word in a label is over {word} characters; {len(long[0])} reads as an id"
    return None


def article(kind: str) -> str:
    return "an image" if kind == "image" else f"a {kind}"


def presign_refusal(doc: ProjectMediaPresign) -> tuple[int, str] | None:
    """(status, reason) when this presign may not be signed, else None. 413 for a file over
    its cap, 422 for anything else. Runs after the generated model has closed the shape."""
    spec = MEDIA_CONTENT_TYPES[doc.content_type]
    if spec["kind"] != doc.kind:
        return 422, f"{doc.content_type} is {article(spec['kind'])}, not {article(doc.kind)}"
    if doc.bytes > spec["max_bytes"]:
        cap = spec["max_bytes"]
        return 413, f"a {doc.content_type} file is at most {cap} bytes; this one is {doc.bytes}"
    if doc.kind == "video":
        if doc.duration_ms is None:
            return 422, "a video needs duration_ms"
    else:
        if doc.duration_ms is not None:
            return 422, "an image has no duration_ms"
        if doc.poster is not None:
            return 422, "only a video has a poster"
    if doc.poster is not None:
        cap = MEDIA_CONTENT_TYPES[doc.poster.content_type]["max_bytes"]
        if doc.poster.bytes > cap:
            return 413, f"a poster is at most {cap} bytes; this one is {doc.poster.bytes}"
    refusal = label_refusal(doc.label)
    return None if refusal is None else (422, refusal)


def looks_like(content_type: str, head: bytes | None) -> bool:
    """Whether a file's first bytes are the type it was presigned as: the PNG signature, a
    JPEG start of image, an MP4 `ftyp` box. A type signed into the upload stops an HTML file
    arriving as an image at the bucket; this is what stops it at the local stack, and at
    commit on both."""
    if not head:
        return False
    if content_type == "image/png":
        return head.startswith(b"\x89PNG\r\n\x1a\n")
    if content_type == "image/jpeg":
        return head.startswith(b"\xff\xd8\xff")
    if content_type == "video/mp4":
        return len(head) >= 12 and head[4:8] == b"ftyp"
    return False


def object_key(
    user_id: str, project_key: str, media_id: str, content_type: str, *, poster: bool = False
) -> str:
    """`project-media/<user>/<project>/<media id>[-poster].<ext>`. Built here and nowhere
    else, from values the server made or validated, so it always fits `objectstore._SEGMENT`."""
    tail = "-poster" if poster else ""
    return (
        f"project-media/{uuid.UUID(user_id)}/{project_key}/{uuid.UUID(media_id).hex}{tail}"
        f".{EXTENSIONS[content_type]}"
    )


# --------------------------------------------------------------------------- is it yours


def held(db, user_id: str, key: str) -> bool:
    """A project this account holds and has not excluded: a repository it has a session in,
    or a key in its own stored report. Read as the viewer: `sessions` through the owner
    policy (only this account's sessions can make a key theirs), exclusion through the
    SECURITY DEFINER `session_repo_excluded` (`excluded_keys`)."""
    if excluded_keys(db, user_id, {key}):
        return False
    if key in _report_keys(builder_report(db, user_id)):
        return True
    return bool(
        db.execute(
            text(
                """
                SELECT EXISTS (
                  SELECT 1 FROM repos r JOIN sessions s ON s.repo_id = r.id
                  WHERE r.repo_hash = :k AND s.user_id = CAST(:u AS uuid))
                """
            ),
            {"k": key, "u": user_id},
        ).scalar()
    )


# ---------------------------------------------------------------------------- the phone


def read_url(media_id, key: str | None, *, poster: bool = False) -> str | None:
    """Where the phone reads a file: relative to the API in development (`/v1/media/<id>`,
    fetched with the bearer), a presigned GET good for `READ_URL_SECONDS` in production."""
    if key is None:
        return None
    kind = objectstore.backend()
    if kind == "file":
        return f"/v1/media/{media_id}" + ("/poster" if poster else "")
    if kind == "s3":
        return objectstore.presign_get(key, READ_URL_SECONDS)
    return None


def item(r) -> dict:
    """One file as the list and the preview serve it (docs/demos.md, "The API")."""
    return {
        "id": str(r.id),
        "kind": r.kind,
        "content_type": r.content_type,
        "width": r.width,
        "height": r.height,
        "duration_ms": r.duration_ms,
        "position": r.position,
        "label": r.label,
        "source": r.source,
        "url": read_url(r.id, r.object_key),
        "poster_url": read_url(r.id, r.poster_object_key, poster=True),
    }


# --------------------------------------------------------------------------- the sweeps


def object_keys_of(rows) -> list[str]:
    out: list[str] = []
    for r in rows:
        out.append(r.object_key)
        if r.poster_object_key:
            out.append(r.poster_object_key)
    return out


def forget_project(db, user_id: str, project_key: str) -> tuple[int, list[str]]:
    """Delete every row of one project's demo, committed or not. Returns (rows, object keys);
    the caller deletes the objects after its transaction commits."""
    rows = db.execute(
        text(
            """
            DELETE FROM project_media
            WHERE user_id = CAST(:u AS uuid) AND project_key = :k
            RETURNING object_key, poster_object_key
            """
        ),
        {"u": user_id, "k": project_key},
    ).all()
    return len(rows), object_keys_of(rows)


def account_objects(db, user_id: str) -> tuple[int, list[str]]:
    """Every object this account's demos hold, read before the account goes (the rows then
    cascade from `users`)."""
    rows = db.execute(
        text(
            "SELECT object_key, poster_object_key FROM project_media "
            "WHERE user_id = CAST(:u AS uuid)"
        ),
        {"u": user_id},
    ).all()
    return len(rows), object_keys_of(rows)


def delete_objects(keys: list[str]) -> int:
    """Delete these objects from the store; how many went. A failure is logged and skipped:
    the rows are already gone, so the object is unreadable, and one stuck delete must not keep
    the rest of a person's files, or their account deletion, from finishing."""
    n = 0
    for key in keys:
        try:
            objectstore.delete(key)
            n += 1
        except Exception:  # noqa: BLE001 - logged, and the sweep goes on
            log.exception("could not delete demo object %s", key)
    return n


# ------------------------------------------------------------------------ upload tokens


def upload_token(
    user_id: str, media_id: str, key: str, content_type: str, n: int, *, now: datetime | None = None
) -> str:
    """The file backend's upload URL token for ONE object (the module docstring)."""
    now = now or datetime.now(UTC)
    payload = {
        "aud": UPLOAD_AUDIENCE,
        "sub": user_id,
        "mid": media_id,
        "key": key,
        "ct": content_type,
        "n": int(n),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=UPLOAD_URL_SECONDS)).timestamp()),
        "jti": secrets.token_urlsafe(9),
    }
    return jwt.encode(payload, settings().jwt_private_key, algorithm="EdDSA")


def read_upload_token(token: str) -> dict:
    """The claims of a valid upload token, or a 401. Both signing keys, as access tokens:
    a rotation in the middle of a publish must not strand the files already presigned."""
    invalid = HTTPException(
        401, "this upload link is not valid: expired, or not one this server made"
    )
    for key in (settings().jwt_private_key, settings().jwt_private_key_next):
        if not key:
            continue
        try:
            claims = jwt.decode(
                token,
                key,
                algorithms=["EdDSA"],
                audience=UPLOAD_AUDIENCE,
                options={"require": ["exp", "aud", "sub"]},
            )
        except jwt.PyJWTError:
            continue
        try:
            uuid.UUID(str(claims["sub"]))
            uuid.UUID(str(claims["mid"]))
            ok = (
                isinstance(claims["key"], str)
                and claims["ct"] in MEDIA_CONTENT_TYPES
                and isinstance(claims["n"], int)
                and claims["n"] > 0
            )
        except (KeyError, ValueError, TypeError):
            ok = False
        if not ok:
            raise invalid
        return claims
    raise invalid
