"""Stars and releases: following a project, and what its owner says about it (0037).

builder/releases.py holds the enums, the shapes and the rules; 0037 holds the policies, which decide
every read (a route that forgot a check would leak nothing, only misreport). The routes:

    POST   /v1/users/{handle}/projects/{key}/star        star a public project (idempotent)
    DELETE /v1/users/{handle}/projects/{key}/star        take the star back (idempotent)
    GET    /v1/users/{handle}/projects                   their public projects and latest releases
    GET    /v1/me/stars                                  the projects I starred
    PUT    /v1/projects/{key}/releases/draft             the Mac drafts (or replaces the one draft)
    GET    /v1/me/releases?status=&project_key=          my own releases
    GET    /v1/releases/following?before=&before_id=     releases of what I starred and who I follow
    GET    /v1/releases/{id}                             one release I may read
    PATCH  /v1/releases/{id}                             edit a draft or a published release
    POST   /v1/releases/{id}:publish                     the phone publishes a draft
    POST   /v1/releases/{id}:dismiss                     the phone dismisses a draft
    GET    /v1/projects/{key}/release-settings           one project's settings (defaults if none)
    PUT    /v1/projects/{key}/release-settings           the phone changes them
    GET    /v1/me/release-settings                       every stored project's (the Mac reads this)

WHO. Publishing, dismissing, editing, starring and every setting are a PERSON'S (`current_person`:
the phone or the desktop app), the rule the drop and demo request routes follow: the Mac and paired
machines draft and read. `drafts_to_phone` is the switch that lets the Mac draft at all, so a
machine that could flip it would have both halves; it is the phone's.

A refusal is a code in `detail`, never a sentence: `bad_key`, `bad_cursor`, `bad_status`,
`not_found`, `not_yours`, `own_project`, `drafts_off`, `empty_title`, `empty_highlight`,
`trailer_version_needs_trailer`, `nothing_to_change`, `not_draft`, `not_editable`,
`project_not_public`, `names_a_repository`.
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator
from sqlalchemy import text

from .. import project_media as pm
from .. import releases as rel
from ..auth import CurrentDevice, current_device, current_person
from ..db import db_session
from . import push

router = APIRouter(prefix="/v1", tags=["releases"])
log = logging.getLogger("builder.releases")

Highlight = Annotated[str, Field(max_length=rel.HIGHLIGHT_MAX)]


def _one_of(values: tuple[str, ...]):
    def check(v):
        if v is not None and v not in values:
            raise ValueError(f"one of {list(values)}")
        return v

    return check


class DraftIn(BaseModel):
    """What the Mac drafts. Its words are the owner's to change before anything is published."""

    model_config = ConfigDict(extra="forbid")

    title: str = Field(max_length=rel.TITLE_MAX)
    notes: str = Field(default="", max_length=rel.NOTES_MAX)
    highlights: list[Highlight] = Field(default_factory=list, max_length=rel.HIGHLIGHTS_MAX)
    commits: int | None = Field(default=None, ge=0, le=1_000_000)
    trigger: str
    has_trailer: StrictBool = False
    trailer_version: int | None = Field(default=None, ge=1, le=1000)

    check_trigger = field_validator("trigger")(_one_of(rel.TRIGGERS))


class ReleasePatch(BaseModel):
    """What the owner changes; a field left out stays as it is."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, max_length=rel.TITLE_MAX)
    notes: str | None = Field(default=None, max_length=rel.NOTES_MAX)
    highlights: list[Highlight] | None = Field(default=None, max_length=rel.HIGHLIGHTS_MAX)
    visibility: str | None = None

    check_visibility = field_validator("visibility")(_one_of(rel.VISIBILITIES))


class SettingsIn(BaseModel):
    """A project's release settings; a field left out stays as it is (or its default)."""

    model_config = ConfigDict(extra="forbid")

    every_commits: int | None = Field(
        default=None, ge=rel.EVERY_COMMITS[0], le=rel.EVERY_COMMITS[1]
    )
    cadence: str | None = None
    on_shipped: StrictBool | None = None
    drafts_to_phone: StrictBool | None = None

    check_cadence = field_validator("cadence")(_one_of(rel.CADENCES))


# ------------------------------------------------------------------------------ helpers


def _key(key: str) -> str:
    if not pm.PROJECT_KEY.match(key):
        raise HTTPException(422, "bad_key")
    return key


def _uuid(value: str) -> str:
    try:
        return str(uuid.UUID(value))
    except (ValueError, AttributeError, TypeError) as e:
        raise HTTPException(404, "not_found") from e


def _before(value: str | None) -> datetime | None:
    if value is None:
        return None
    # A `+` pasted into a query string unencoded arrives as a space (routes/social.py `_before`).
    value = re.sub(r" (\d{2}:\d{2})$", r"+\1", value.strip())
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as e:
        raise HTTPException(422, "bad_cursor") from e
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _title(value: str) -> str:
    out = value.strip()
    if not out:
        raise HTTPException(422, "empty_title")
    return out


def _highlights(values: list[str]) -> list[str]:
    out = [v.strip() for v in values]
    if any(not v for v in out):
        raise HTTPException(422, "empty_highlight")
    return out


def _user(db, handle: str):
    row = db.execute(
        text("SELECT id, handle, display_name FROM users WHERE handle = :h AND deleted_at IS NULL"),
        {"h": handle},
    ).first()
    if row is None:
        raise HTTPException(404, "not_found")
    return row


_SELECT = f"""
    SELECT {rel.COLUMNS}, {rel.DERIVED}, u.handle, u.display_name
    FROM releases r JOIN users u ON u.id = r.owner_id
"""


def _release(db, rid: str, *, lock: bool = False):
    """One release, as the viewer may read it (RLS: theirs, or `can_view_release`)."""
    return db.execute(
        text(f"{_SELECT} WHERE r.id = CAST(:r AS uuid){' FOR UPDATE OF r' if lock else ''}"),
        {"r": rid},
    ).first()


def _own(db, rid: str, uid: str, *, lock: bool = False):
    """The release, when it is the caller's: 404 when they cannot see it, 403 when they can and
    it is somebody else's (routes/social.py `_owned_post`)."""
    # Read first, THEN lock: `FOR UPDATE` applies the UPDATE policy too, which filters a release
    # the caller may read and does not own to nothing, a 404 where the answer is a 403.
    r = _release(db, rid)
    if r is None:
        raise HTTPException(404, "not_found")
    if str(r.owner_id) != uid:
        raise HTTPException(403, "not_yours")
    return _release(db, rid, lock=True) if lock else r


def _latest(db, pairs: list[tuple[str, str]]) -> dict[tuple[str, str], dict]:
    """The newest published release the viewer may read, per (owner, project)."""
    if not pairs:
        return {}
    rows = db.execute(
        text(
            """
            SELECT DISTINCT ON (r.owner_id, r.project_key)
                   r.id, r.owner_id, r.project_key, r.title, r.published_at
            FROM releases r
            JOIN unnest(CAST(:o AS uuid[]), CAST(:k AS text[])) AS p(owner_id, project_key)
              ON p.owner_id = r.owner_id AND p.project_key = r.project_key
            WHERE r.status = 'published'
            ORDER BY r.owner_id, r.project_key, r.published_at DESC, r.id DESC
            """
        ),
        {"o": [o for o, _ in pairs], "k": [k for _, k in pairs]},
    ).all()
    return {(str(r.owner_id), r.project_key): rel.latest(r) for r in rows}


def _starrable(db, owner_id, key: str) -> bool:
    return bool(
        db.execute(
            text("SELECT project_starrable(CAST(:o AS uuid), :k)"), {"o": str(owner_id), "k": key}
        ).scalar()
    )


def _stars(db, owner_id, key: str) -> int | None:
    return db.execute(
        text("SELECT star_count(CAST(:o AS uuid), :k)"), {"o": str(owner_id), "k": key}
    ).scalar()


def send_release_pushes(audience: list[str], title: str, body: str, release_id: str) -> None:
    """After the publish has committed, best effort: a banner to each reader the database named
    once (`claim_release_audience`). A failure is logged and never retried: a crash between the
    commit and here loses a banner rather than doubling one (notify.py's rule)."""
    for user_id in audience:
        try:
            push.send_release(user_id, title, body, release_id)
        except Exception:  # noqa: BLE001 - logged; one reader's phone must not stop the rest
            log.exception("release push for %s failed; not retried", release_id)


# ------------------------------------------------------------------------------ stars


@router.post("/users/{handle}/projects/{key}/star")
def star(handle: str, key: str, device: CurrentDevice = Depends(current_person)):
    """Star somebody's public project, to read its releases. Idempotent. 404 unless the project
    is public, theirs, and theirs to be seen (`project_starrable`)."""
    uid = str(device.user_id)
    _key(key)
    with db_session(viewer_id=uid) as db:
        owner = _user(db, handle)
        if str(owner.id) == uid:
            raise HTTPException(422, "own_project")
        if not _starrable(db, owner.id, key):
            raise HTTPException(404, "not_found")
        db.execute(
            text(
                "INSERT INTO project_stars (user_id, owner_id, project_key) "
                "VALUES (CAST(:u AS uuid), :o, :k) ON CONFLICT DO NOTHING"
            ),
            {"u": uid, "o": owner.id, "k": key},
        )
        stars = _stars(db, owner.id, key)
    return {"key": key, "starred": True, "stars": stars}


@router.delete("/users/{handle}/projects/{key}/star")
def unstar(handle: str, key: str, device: CurrentDevice = Depends(current_person)):
    """Take a star back. Idempotent on a starrable project; a star of yours on a project that has
    since gone private is taken back too (it is your row), and anything else is a 404."""
    uid = str(device.user_id)
    _key(key)
    with db_session(viewer_id=uid) as db:
        owner = _user(db, handle)
        if str(owner.id) == uid:
            raise HTTPException(422, "own_project")
        gone = db.execute(
            text(
                "DELETE FROM project_stars WHERE user_id = CAST(:u AS uuid) AND owner_id = :o "
                "AND project_key = :k RETURNING 1"
            ),
            {"u": uid, "o": owner.id, "k": key},
        ).first()
        if gone is None and not _starrable(db, owner.id, key):
            raise HTTPException(404, "not_found")
        stars = _stars(db, owner.id, key)
    return {"key": key, "starred": False, "stars": stars}


@router.get("/users/{handle}/projects")
def their_projects(handle: str, device: CurrentDevice = Depends(current_device)):
    """A person's public projects, as the public profile shows them: to anyone when the profile is
    public, to accepted followers when it is not, always to themselves. Most starred first."""
    uid = str(device.user_id)
    with db_session(viewer_id=uid) as db:
        owner = _user(db, handle)
        rows = db.execute(
            text(
                """
                SELECT p.project_key, p.name, star_count(CAST(:o AS uuid), p.project_key) AS stars,
                       EXISTS (SELECT 1 FROM project_stars s
                               WHERE s.user_id = CAST(:u AS uuid) AND s.owner_id = CAST(:o AS uuid)
                                 AND s.project_key = p.project_key) AS starred
                FROM public_projects(CAST(:o AS uuid)) p
                """
            ),
            {"o": str(owner.id), "u": uid},
        ).all()
        latest = _latest(db, [(str(owner.id), r.project_key) for r in rows])
    projects = sorted(rows, key=lambda r: (-(r.stars or 0), r.name, r.project_key))
    return {
        "projects": [
            {
                "key": r.project_key,
                "name": r.name,
                "stars": r.stars,
                "starred": bool(r.starred),
                "latest_release": latest.get((str(owner.id), r.project_key)),
            }
            for r in projects
        ]
    }


@router.get("/me/stars")
def my_stars(device: CurrentDevice = Depends(current_device)):
    """The projects I starred that are public now, newest star first. A star on a project that has
    gone private is dormant and not listed: it grants nothing until the project is public again."""
    uid = str(device.user_id)
    with db_session(viewer_id=uid) as db:
        rows = db.execute(
            text(
                """
                SELECT s.owner_id, s.project_key, u.handle, u.display_name,
                       project_public_name(s.owner_id, s.project_key) AS name,
                       star_count(s.owner_id, s.project_key) AS stars
                FROM project_stars s
                JOIN users u ON u.id = s.owner_id AND u.deleted_at IS NULL
                WHERE s.user_id = CAST(:u AS uuid) AND project_is_public(s.owner_id, s.project_key)
                ORDER BY s.created_at DESC, s.project_key
                """
            ),
            {"u": uid},
        ).all()
        latest = _latest(db, [(str(r.owner_id), r.project_key) for r in rows])
    return {
        "projects": [
            {
                "owner_handle": r.handle,
                "owner_display_name": r.display_name,
                "key": r.project_key,
                "name": r.name,
                "stars": r.stars,
                "latest_release": latest.get((str(r.owner_id), r.project_key)),
            }
            for r in rows
        ]
    }


# ------------------------------------------------------------------------------ releases


@router.put("/projects/{key}/releases/draft")
def put_draft(key: str, body: DraftIn, device: CurrentDevice = Depends(current_device)):
    """The Mac drafts a release for one of the owner's projects, or replaces the one live draft
    (its id, its visibility and when it was first drafted stay). Only while the owner has turned
    `drafts_to_phone` on for that project (403 `drafts_off`)."""
    uid = str(device.user_id)
    _key(key)
    title = _title(body.title)
    highlights = _highlights(body.highlights)
    if body.trailer_version is not None and not body.has_trailer:
        raise HTTPException(422, "trailer_version_needs_trailer")
    with db_session(viewer_id=uid) as db:
        if not pm.held(db, uid, key):
            raise HTTPException(404, "not_found")
        on = db.execute(
            text(
                "SELECT drafts_to_phone FROM release_settings WHERE user_id = CAST(:u AS uuid) "
                "AND project_key = :k"
            ),
            {"u": uid, "k": key},
        ).scalar()
        if not on:
            raise HTTPException(403, "drafts_off")
        row = db.execute(
            text(
                """
                INSERT INTO releases (owner_id, project_key, title, notes, highlights, commits,
                                      trigger, has_trailer, trailer_version)
                VALUES (CAST(:u AS uuid), :k, :t, :n, CAST(:h AS jsonb), :c, :tr, :ht, :tv)
                ON CONFLICT (owner_id, project_key) WHERE status = 'draft' DO UPDATE SET
                  title = EXCLUDED.title, notes = EXCLUDED.notes,
                  highlights = EXCLUDED.highlights, commits = EXCLUDED.commits,
                  trigger = EXCLUDED.trigger, has_trailer = EXCLUDED.has_trailer,
                  trailer_version = EXCLUDED.trailer_version, updated_at = now()
                RETURNING id, (xmax = 0) AS inserted
                """
            ),
            {
                "u": uid,
                "k": key,
                "t": title,
                "n": body.notes.strip(),
                "h": json.dumps(highlights),
                "c": body.commits,
                "tr": body.trigger,
                "ht": body.has_trailer,
                "tv": body.trailer_version,
            },
        ).one()
        out = _release(db, str(row.id))
    return {"release": rel.mine(out), "replaced": not row.inserted}


@router.get("/me/releases")
def my_releases(
    status: str | None = Query(None),
    project_key: str | None = Query(None),
    device: CurrentDevice = Depends(current_device),
):
    """My own releases, newest first: drafts and published ones unless `status` names one."""
    uid = str(device.user_id)
    clauses = ["r.owner_id = CAST(:u AS uuid)"]
    params: dict = {"u": uid, "n": rel.MINE_MAX}
    if status is None:
        clauses.append("r.status IN ('draft', 'published')")
    elif status in rel.STATUSES:
        clauses.append("r.status = :s")
        params["s"] = status
    else:
        raise HTTPException(422, "bad_status")
    if project_key is not None:
        clauses.append("r.project_key = :k")
        params["k"] = _key(project_key)
    with db_session(viewer_id=uid) as db:
        rows = db.execute(
            text(
                f"{_SELECT} WHERE {' AND '.join(clauses)} "
                "ORDER BY COALESCE(r.published_at, r.updated_at) DESC, r.id DESC LIMIT :n"
            ),
            params,
        ).all()
    return {"releases": [rel.mine(r) for r in rows]}


# Declared before `/releases/{release_id}`: a path parameter matches `[^/]+`, so without the
# ordering "following" would arrive there as an id.
@router.get("/releases/following")
def following(
    device: CurrentDevice = Depends(current_device),
    before: str | None = None,
    before_id: str | None = None,
    limit: int = Query(rel.FEED_PAGE, ge=1, le=rel.FEED_PAGE),
):
    """Published releases of the projects I starred and of the people I follow, newest first,
    keyset on (published_at, id) as the social feed is: pass back `next_before` and
    `next_before_id`. What I may read is `can_view_release`'s to say; this only scopes."""
    uid = str(device.user_id)
    clauses = [
        "r.status = 'published'",
        "r.owner_id <> CAST(:v AS uuid)",
        "u.deleted_at IS NULL",
        """(r.owner_id IN (SELECT followee_id FROM follows
                           WHERE follower_id = CAST(:v AS uuid) AND state = 'accepted')
            OR EXISTS (SELECT 1 FROM project_stars s
                       WHERE s.user_id = CAST(:v AS uuid) AND s.owner_id = r.owner_id
                         AND s.project_key = r.project_key))""",
    ]
    params: dict = {"v": uid, "n": limit}
    cursor = _before(before)
    if cursor is not None:
        params["before"] = cursor
        if before_id is not None:
            try:
                params["before_id"] = str(uuid.UUID(before_id))
            except ValueError as e:
                raise HTTPException(422, "bad_cursor") from e
            clauses.append("(r.published_at, r.id) < (:before, CAST(:before_id AS uuid))")
        else:
            clauses.append("r.published_at < :before")
    with db_session(viewer_id=uid) as db:
        rows = db.execute(
            text(
                f"{_SELECT} WHERE {' AND '.join(clauses)} "
                "ORDER BY r.published_at DESC, r.id DESC LIMIT :n"
            ),
            params,
        ).all()
    full = len(rows) == limit
    return {
        "releases": [rel.theirs(r) for r in rows],
        "next_before": rows[-1].published_at.isoformat() if full else None,
        "next_before_id": str(rows[-1].id) if full else None,
    }


@router.get("/releases/{release_id}")
def get_release(release_id: str, device: CurrentDevice = Depends(current_device)):
    """One release: the owner's whole row to its owner, the reader's shape to anyone who may read
    it (a push's tap lands here), a 404 to everyone else."""
    uid = str(device.user_id)
    rid = _uuid(release_id)
    with db_session(viewer_id=uid) as db:
        r = _release(db, rid)
    if r is None:
        raise HTTPException(404, "not_found")
    return {"release": rel.mine(r) if str(r.owner_id) == uid else rel.theirs(r)}


@router.patch("/releases/{release_id}")
def patch_release(
    release_id: str, body: ReleasePatch, device: CurrentDevice = Depends(current_person)
):
    """The owner changes a draft's or a published release's words, or who reads it. A published
    release's words are held to the private name rule again; a dismissed one is not edited."""
    uid = str(device.user_id)
    rid = _uuid(release_id)
    if all(v is None for v in body.model_dump().values()):
        raise HTTPException(422, "nothing_to_change")
    title = _title(body.title) if body.title is not None else None
    highlights = _highlights(body.highlights) if body.highlights is not None else None
    notes = body.notes.strip() if body.notes is not None else None
    with db_session(viewer_id=uid) as db:
        r = _own(db, rid, uid, lock=True)
        if r.status == "dismissed":
            raise HTTPException(409, "not_editable")
        if body.visibility == "public" and not r.public:
            raise HTTPException(422, "project_not_public")
        words = rel.words_of(
            title if title is not None else r.title,
            notes if notes is not None else r.notes,
            highlights if highlights is not None else r.highlights,
        )
        changed_words = any(v is not None for v in (title, notes, highlights))
        if (
            r.status == "published"
            and changed_words
            and rel.names_a_repository(rel.private_names(db, uid, r.project_key), words)
        ):
            raise HTTPException(422, "names_a_repository")
        db.execute(
            text(
                """
                UPDATE releases SET title = COALESCE(:t, title), notes = COALESCE(:n, notes),
                  highlights = COALESCE(CAST(:h AS jsonb), highlights),
                  visibility = COALESCE(:v, visibility), updated_at = now()
                WHERE id = CAST(:r AS uuid) AND owner_id = CAST(:u AS uuid)
                """
            ),
            {
                "t": title,
                "n": notes,
                "h": json.dumps(highlights) if highlights is not None else None,
                "v": body.visibility,
                "r": rid,
                "u": uid,
            },
        )
        out = _release(db, rid)
    return {"release": rel.mine(out)}


@router.post("/releases/{release_id}:publish")
def publish(
    release_id: str,
    background: BackgroundTasks,
    device: CurrentDevice = Depends(current_person),
):
    """A person publishes a draft: it is published now, its readers can read it, and each of them
    is told once. Never the Mac (`current_person`). The words may not name a private repository
    (422 `names_a_repository`), and a public release needs a public project (422)."""
    uid = str(device.user_id)
    rid = _uuid(release_id)
    with db_session(viewer_id=uid) as db:
        r = _own(db, rid, uid, lock=True)
        if r.status != "draft":
            raise HTTPException(409, "not_draft")
        if r.visibility == "public" and not r.public:
            raise HTTPException(422, "project_not_public")
        names = rel.private_names(db, uid, r.project_key)
        if rel.names_a_repository(names, rel.words_of(r.title, r.notes, r.highlights)):
            raise HTTPException(422, "names_a_repository")
        db.execute(
            text(
                "UPDATE releases SET status = 'published', published_at = now(), "
                "updated_at = now() WHERE id = CAST(:r AS uuid) AND status = 'draft'"
            ),
            {"r": rid},
        )
        # Who to tell, decided by the database exactly once: the release is marked notified in
        # this transaction, so a second publish (there is none: it is no longer a draft) or a
        # retried request cannot decide it again.
        audience = [
            str(x)
            for x in db.execute(
                text("SELECT claim_release_audience(CAST(:r AS uuid))"), {"r": rid}
            ).scalars()
        ]
        out = _release(db, rid)
    if audience:
        title, words = rel.compose(
            out.display_name, out.handle, out.name if out.public else None, out.title
        )
        background.add_task(send_release_pushes, audience, title, words, rid)
    return {"release": rel.mine(out)}


@router.post("/releases/{release_id}:dismiss")
def dismiss(release_id: str, device: CurrentDevice = Depends(current_person)):
    """The owner does not want this draft. The Mac may draft again."""
    uid = str(device.user_id)
    rid = _uuid(release_id)
    with db_session(viewer_id=uid) as db:
        r = _own(db, rid, uid, lock=True)
        if r.status != "draft":
            raise HTTPException(409, "not_draft")
        db.execute(
            text(
                "UPDATE releases SET status = 'dismissed', updated_at = now() "
                "WHERE id = CAST(:r AS uuid) AND status = 'draft'"
            ),
            {"r": rid},
        )
        out = _release(db, rid)
    return {"release": rel.mine(out)}


# ------------------------------------------------------------------------------ settings

_SETTINGS = "project_key, every_commits, cadence, on_shipped, drafts_to_phone, updated_at"


@router.get("/projects/{key}/release-settings")
def get_settings(key: str, device: CurrentDevice = Depends(current_device)):
    uid = str(device.user_id)
    _key(key)
    with db_session(viewer_id=uid) as db:
        if not pm.held(db, uid, key):
            raise HTTPException(404, "not_found")
        row = db.execute(
            text(
                f"SELECT {_SETTINGS} FROM release_settings WHERE user_id = CAST(:u AS uuid) "
                "AND project_key = :k"
            ),
            {"u": uid, "k": key},
        ).first()
    return {"settings": rel.settings_item(key, row)}


@router.put("/projects/{key}/release-settings")
def put_settings(key: str, body: SettingsIn, device: CurrentDevice = Depends(current_person)):
    """The phone changes a project's settings; what it leaves out keeps its value. The Mac may not
    (`current_person`): `drafts_to_phone` is the switch that lets it draft."""
    uid = str(device.user_id)
    _key(key)
    sent = {k: v for k, v in body.model_dump().items() if v is not None}
    if not sent:
        raise HTTPException(422, "nothing_to_change")
    with db_session(viewer_id=uid) as db:
        if not pm.held(db, uid, key):
            raise HTTPException(404, "not_found")
        now = db.execute(
            text(
                f"SELECT {_SETTINGS} FROM release_settings WHERE user_id = CAST(:u AS uuid) "
                "AND project_key = :k FOR UPDATE"
            ),
            {"u": uid, "k": key},
        ).first()
        merged = {**rel.settings_item(key, now), **sent}
        row = db.execute(
            text(
                f"""
                INSERT INTO release_settings (user_id, project_key, every_commits, cadence,
                                              on_shipped, drafts_to_phone)
                VALUES (CAST(:u AS uuid), :k, :e, :c, :s, :d)
                ON CONFLICT (user_id, project_key) DO UPDATE SET
                  every_commits = EXCLUDED.every_commits, cadence = EXCLUDED.cadence,
                  on_shipped = EXCLUDED.on_shipped, drafts_to_phone = EXCLUDED.drafts_to_phone,
                  updated_at = now()
                RETURNING {_SETTINGS}
                """
            ),
            {
                "u": uid,
                "k": key,
                "e": merged["every_commits"],
                "c": merged["cadence"],
                "s": merged["on_shipped"],
                "d": merged["drafts_to_phone"],
            },
        ).one()
    return {"settings": rel.settings_item(key, row)}


@router.get("/me/release-settings")
def my_settings(device: CurrentDevice = Depends(current_device)):
    """Every project's stored settings: what the Mac reads to know when to draft, and where it may.
    A project with no row has the defaults, under which the Mac drafts nothing."""
    uid = str(device.user_id)
    with db_session(viewer_id=uid) as db:
        rows = db.execute(
            text(
                f"SELECT {_SETTINGS} FROM release_settings WHERE user_id = CAST(:u AS uuid) "
                "ORDER BY project_key"
            ),
            {"u": uid},
        ).all()
    return {"settings": [rel.settings_item(r.project_key, r) for r in rows]}
