"""Ship kits on the server (docs/ship-kit.md): the door for a kit file, where its object lives, how
the phone reads one, and the sweeps that take a kit away. The routes are routes/shipkit.py.

The rules are project_media.py's, applied to a set with more kinds of file, and it borrows every
piece of that module that is the same rule rather than writing a second one: the upload tokens
(one object, its type, its size, single use), the read URL lifetime, the label rule, and `held`
(a project is yours when one of your sessions is in it or your report names it, and never when
you excluded it).

WHAT IS DIFFERENT. A kit holds up to four videos (one per format), a GIF, stills, framed stills,
before and after pairs and App Store sets (spec/shipkit.v1.json `caps`), so it has a table of its
own and a PREFIX of its own, `ship-kit/<user>/<project>/`: the demo sweep keeps what
`project_media` rows name under `project-media/`, this sweep keeps what `ship_kit_media` rows
name under `ship-kit/`, and neither can take the other's objects for orphans.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import text

from . import objectstore
from . import project_media as pm
from .shipkit_spec import SHIPKIT_CAPS, KitPresign

log = logging.getLogger("builder.ship_kit")

EXTENSIONS = {"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "video/mp4": "mp4"}
PREFIX = "ship-kit/"
#: The slots each content type may fill.
SLOT_TYPES = {
    "video/mp4": {"video_vertical", "video_feed", "video_landscape", "video_square"},
    "image/gif": {"loop"},
    "image/png": {"still", "framed_still", "before_after", "app_store_iphone", "app_store_ipad"},
    "image/jpeg": {"still", "framed_still", "before_after"},
}
#: How many files a slot may hold in one publish.
SLOT_CAPS = {
    "video_vertical": 1,
    "video_feed": 1,
    "video_landscape": 1,
    "video_square": 1,
    "loop": SHIPKIT_CAPS["loops"],
    "still": SHIPKIT_CAPS["stills"],
    "framed_still": SHIPKIT_CAPS["framed_stills"],
    "before_after": SHIPKIT_CAPS["before_after"],
    "app_store_iphone": SHIPKIT_CAPS["app_store_each"],
    "app_store_ipad": SHIPKIT_CAPS["app_store_each"],
}


def size_cap(content_type: str) -> int:
    if content_type == "video/mp4":
        return SHIPKIT_CAPS["video_bytes"]
    if content_type == "image/gif":
        return SHIPKIT_CAPS["gif_bytes"]
    return SHIPKIT_CAPS["image_bytes"]


def presign_refusal(doc: KitPresign) -> tuple[int, str] | None:
    """(status, reason) when this kit file may not be signed, else None: its type fits its slot,
    its size its cap, a video has a length and nothing else does, a label only on a picture and
    held to the demo channel's rule, and the numbers inside their bounds."""
    if doc.slot not in SLOT_TYPES[doc.content_type]:
        return 422, f"a {doc.slot} is not {doc.content_type}"
    cap = size_cap(doc.content_type)
    if doc.bytes > cap:
        return (
            413,
            f"a {doc.content_type} file of a kit is at most {cap} bytes; this one is {doc.bytes}",
        )
    if doc.bytes < 1:
        return 422, "a file has at least one byte"
    for side in (doc.width, doc.height):
        if not 1 <= side <= SHIPKIT_CAPS["pixels"]:
            return 422, f"a side is 1 to {SHIPKIT_CAPS['pixels']} pixels"
    if not 0 <= doc.position <= 63:
        return 422, "a position is 0 to 63"
    if doc.content_type == "video/mp4":
        if doc.duration_ms is None or not 1 <= doc.duration_ms <= SHIPKIT_CAPS["video_ms"]:
            return 422, f"a video needs duration_ms, 1 to {SHIPKIT_CAPS['video_ms']}"
        if doc.label is not None:
            return 422, "a video carries no label"
    elif doc.duration_ms is not None:
        return 422, "only a video has duration_ms"
    if doc.label is not None:
        refused = pm.label_refusal(doc.label)
        if refused:
            return 422, refused
    return None


def looks_like(content_type: str, head: bytes | None) -> bool:
    """`project_media.looks_like`, and a GIF's own signature for the loop."""
    if content_type == "image/gif":
        return bool(head) and head[:6] in (b"GIF87a", b"GIF89a")
    return pm.looks_like(content_type, head)


def object_key(user_id: str, project_key: str, media_id: str, content_type: str) -> str:
    """`ship-kit/<user>/<project>/<media id>.<ext>`, built here from values the server made or
    validated, so it always fits `objectstore._SEGMENT`."""
    ext = EXTENSIONS[content_type]
    return f"{PREFIX}{uuid.UUID(user_id)}/{project_key}/{uuid.UUID(media_id).hex}.{ext}"


def prefix_of(user_id: str, project_key: str | None = None) -> str:
    out = f"{PREFIX}{uuid.UUID(user_id)}/"
    return out + f"{project_key}/" if project_key else out


def read_url(media_id, key: str) -> str | None:
    """Where the phone reads a kit file: `/v1/kit-media/<id>` with the bearer on the local
    stack, a presigned GET good for `project_media.READ_URL_SECONDS` in production."""
    kind = objectstore.media_backend()
    if kind == "file":
        return f"/v1/kit-media/{media_id}"
    if kind == "s3":
        return objectstore.presign_get(key, pm.READ_URL_SECONDS, store=objectstore.media_store())
    return None


def item(r) -> dict:
    return {
        "id": str(r.id),
        "slot": r.slot,
        "content_type": r.content_type,
        "width": r.width,
        "height": r.height,
        "duration_ms": r.duration_ms,
        "bytes": r.bytes,
        "position": r.position,
        "label": r.label,
        "url": read_url(r.id, r.object_key),
    }


# ------------------------------------------------------------------------ the sweeps


def forget_project(db, user_id: str, project_key: str) -> tuple[int, list[str]]:
    """Every kit row of one project, and its requests; returns (kit files, object keys)."""
    rows = db.execute(
        text(
            "DELETE FROM ship_kit_media WHERE user_id = CAST(:u AS uuid) AND project_key = :k "
            "RETURNING object_key"
        ),
        {"u": user_id, "k": project_key},
    ).all()
    db.execute(
        text("DELETE FROM ship_kits WHERE user_id = CAST(:u AS uuid) AND project_key = :k"),
        {"u": user_id, "k": project_key},
    )
    db.execute(
        text("DELETE FROM demo_requests WHERE user_id = CAST(:u AS uuid) AND project_key = :k"),
        {"u": user_id, "k": project_key},
    )
    return len(rows), [r.object_key for r in rows]


def account_objects(db, user_id: str) -> tuple[int, list[str]]:
    rows = db.execute(
        text("SELECT object_key FROM ship_kit_media WHERE user_id = CAST(:u AS uuid)"),
        {"u": user_id},
    ).all()
    return len(rows), [r.object_key for r in rows]


def kept_keys(rows, now: datetime) -> set[str]:
    """`project_media.kept_keys`'s rule over kit rows: a committed row's object, and a pending
    row's while its publish may still be running."""
    from datetime import timedelta

    cutoff = now - timedelta(seconds=pm.PENDING_GRACE_SECONDS)
    return {r.object_key for r in rows if r.committed or r.created_at > cutoff}


def sweep(user_id: str, project_key: str | None = None, *, now: datetime | None = None) -> int:
    """Delete every object under this person's kit prefix (or one project's) that no kit row
    keeps; how many went. As the person, after the caller's transaction (project_media.sweep)."""
    from .db import db_session

    prefix = prefix_of(user_id, project_key)
    try:
        listed = objectstore.media_list(prefix)
    except Exception:  # noqa: BLE001 - logged; the answer does not wait on the bucket
        log.exception("could not list %s for a sweep", prefix)
        return 0
    if not listed:
        return 0
    clause = " AND project_key = :k" if project_key else ""
    with db_session(viewer_id=user_id) as db:
        rows = db.execute(
            text(
                "SELECT object_key, committed, created_at FROM ship_kit_media "
                f"WHERE user_id = CAST(:u AS uuid){clause}"
            ),
            {"u": user_id, "k": project_key},
        ).all()
    keep = kept_keys(rows, now or datetime.now(UTC))
    return pm.delete_objects([k for k in listed if k not in keep])
