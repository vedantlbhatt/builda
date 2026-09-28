"""The README badge's one route, read by anyone (builder/badge.py says what it draws and why).

    GET /v1/badge/{handle}/{key}.svg

No device: a README is read by strangers and by GitHub's image proxy. So it reads the database AS
NOBODY (`db_session(viewer_id=None)`), and every rule that decides what a stranger may learn is the
database's own: `can_see_projects` (a public profile), `project_is_public` (the owner marked the
repository public and the server knows its public name), `star_count`, and of a release only its
date, through `badge_release_at` (0039): the newest that went out to everyone, on a public project.
Anything that fails any of them, an unknown handle or a malformed key included, answers the same
plain mark with a 200, so a stranger learns nothing by guessing. Cached for half an hour.
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import Response
from sqlalchemy import text

from .. import badge
from .. import project_media as pm
from ..db import db_session

router = APIRouter(prefix="/v1", tags=["badge"])

HEADERS = {"Cache-Control": "public, max-age=1800"}


def _answer(key: str | None, stars: int | None = None, released=None) -> Response:
    return Response(badge.svg(key, stars, released), media_type="image/svg+xml", headers=HEADERS)


@router.get("/badge/{handle}/{key}.svg")
def readme_badge(handle: str, key: str) -> Response:
    key = key.lower()
    if not pm.PROJECT_KEY.match(key) or len(handle) > 64:
        return _answer(None)
    with db_session(viewer_id=None) as db:
        owner = db.execute(
            text("SELECT id FROM users WHERE handle = :h AND deleted_at IS NULL"), {"h": handle}
        ).first()
        if owner is None:
            return _answer(None)
        row = db.execute(
            text(
                "SELECT can_see_projects(CAST(:o AS uuid)) AND "
                "project_is_public(CAST(:o AS uuid), :k) AS ok, "
                "star_count(CAST(:o AS uuid), :k) AS stars"
            ),
            {"o": str(owner.id), "k": key},
        ).one()
        if not row.ok:
            return _answer(None)
        released = db.execute(
            text("SELECT badge_release_at(CAST(:o AS uuid), :k)"),
            {"o": str(owner.id), "k": key},
        ).scalar()
    return _answer(key, row.stars, released)
