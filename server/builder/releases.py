"""Stars and releases on the server (0037): the one definition of a release's enums and bounds,
what a release looks like to its owner and to everybody else, the private name check, the push, and
the sweep. The routes are routes/releases.py.

WHAT A STRANGER MAY LEARN ABOUT A PROJECT. Its name and its key only while it is public
(`project_is_public`: the owner marked the repository public on the phone, and the profile's name
rule gives it a name). A project key is the repository's HMAC under ONE pepper, the same for
everybody who works in that repository, so a private project's key handed to a follower links it to
the same repository's public project wherever that appears, and a dictionary of public origins
reverses it. So a release of a private project reaches its readers with `project_key: null` and
`name: null`, and its star count is null (never zero: nobody counted).

A RELEASE NEVER NAMES A PRIVATE REPOSITORY. At publish, and on any edit of a published release's
words, the title, the notes and every highlight are held against the names the SERVER knows for the
project while it is not public: `repos.public_name` for its key (an upload in public mode set it,
the owner's Mac or somebody else's, and the owner has not marked it public on the phone). A private
repository whose name never reached the server cannot be checked here: refusing it is the drafting
Mac's job, as it is for a kit's captions (docs/ship-kit.md), and the owner reads every draft first.
"""

from __future__ import annotations

import logging
import re

from sqlalchemy import text

from .notify import APP_SCHEME

log = logging.getLogger("builder.releases")

# 0037's CHECK lists, and the door's: test_releases.py holds the migration to these.
STATUSES = ("draft", "published", "dismissed")
TRIGGERS = ("commits", "shipped", "cadence", "asked")
VISIBILITIES = ("followers", "public")
CADENCES = ("none", "weekly", "biweekly")
TITLE_MAX = 80
NOTES_MAX = 1200
HIGHLIGHTS_MAX = 5
HIGHLIGHT_MAX = 120
EVERY_COMMITS = (3, 200)
#: What a project's settings are before its owner changes any.
DEFAULT_SETTINGS = {
    "every_commits": 10,
    "cadence": "none",
    "on_shipped": True,
    "drafts_to_phone": False,
}

#: The following feed's page, and the most the owner's own list returns.
FEED_PAGE = 30
MINE_MAX = 50

#: The words a release's push says when the owner has neither a display name nor a handle.
SOMEONE = "A builder"
KIND_RELEASE = "release"

COLUMNS = (
    "r.id, r.owner_id, r.project_key, r.status, r.title, r.notes, r.highlights, r.commits, "
    "r.trigger, r.has_trailer, r.trailer_version, r.visibility, r.created_at, r.updated_at, "
    "r.published_at"
)
#: What every read of a release also asks, AS THE VIEWER: the name and the stars only as the
#: functions answer them (the owner always; anyone else only while the project is public).
DERIVED = (
    "project_is_public(r.owner_id, r.project_key) AS public, "
    "project_public_name(r.owner_id, r.project_key) AS name, "
    "star_count(r.owner_id, r.project_key) AS stars"
)


def _at(v) -> str | None:
    return v.isoformat() if v is not None else None


def mine(r) -> dict:
    """A release as its owner reads it: everything, the draft's trigger and trailer included."""
    return {
        "id": str(r.id),
        "project_key": r.project_key,
        "name": r.name,
        "status": r.status,
        "title": r.title,
        "notes": r.notes,
        "highlights": r.highlights,
        "commits": r.commits,
        "trigger": r.trigger,
        "has_trailer": r.has_trailer,
        "trailer_version": r.trailer_version,
        "visibility": r.visibility,
        "created_at": _at(r.created_at),
        "updated_at": _at(r.updated_at),
        "published_at": _at(r.published_at),
        "stars": r.stars,
    }


def theirs(r) -> dict:
    """A published release as a follower or a stargazer reads it. The key, the name and the
    stars only while the project is public (the module docstring)."""
    public = bool(r.public)
    return {
        "id": str(r.id),
        "owner_handle": r.handle,
        "owner_display_name": r.display_name,
        "project_key": r.project_key if public else None,
        "name": r.name if public else None,
        "title": r.title,
        "notes": r.notes,
        "highlights": r.highlights,
        "commits": r.commits,
        "has_trailer": r.has_trailer,
        "published_at": _at(r.published_at),
        "stars": r.stars if public else None,
    }


def latest(r) -> dict:
    return {"id": str(r.id), "title": r.title, "published_at": _at(r.published_at)}


def settings_item(key: str, r) -> dict:
    """A project's release settings, its stored row or the defaults (`updated_at` null)."""
    if r is None:
        return {"project_key": key, **DEFAULT_SETTINGS, "updated_at": None}
    return {
        "project_key": r.project_key,
        "every_commits": r.every_commits,
        "cadence": r.cadence,
        "on_shipped": r.on_shipped,
        "drafts_to_phone": r.drafts_to_phone,
        "updated_at": _at(r.updated_at),
    }


# ------------------------------------------------------------------ the private name check


def private_names(db, owner_id: str, key: str) -> list[str]:
    """The names the server knows for this project while it is NOT public: the repository's own
    `public_name` and its last path part (`acme/rocket` and `rocket`). Empty for a public project,
    whose name may be said, and for one whose name never reached the server."""
    row = db.execute(
        text(
            "SELECT project_is_public(CAST(:o AS uuid), :k) AS public, "
            "(SELECT public_name FROM repos WHERE repo_hash = :k) AS name"
        ),
        {"o": owner_id, "k": key},
    ).one()
    if row.public or not row.name:
        return []
    names = [row.name.strip()]
    tail = names[0].rstrip("/").rsplit("/", 1)[-1]
    if tail and tail != names[0]:
        names.append(tail)
    return [n for n in names if n]


def names_a_repository(names: list[str], texts: list[str]) -> bool:
    """Whether any of `texts` says any of `names`, as a whole word, in any case."""
    for name in names:
        pattern = re.compile(
            r"(?<![0-9A-Za-z])" + re.escape(name) + r"(?![0-9A-Za-z])", re.IGNORECASE
        )
        if any(pattern.search(t) for t in texts):
            return True
    return False


def words_of(title: str, notes: str, highlights: list[str]) -> list[str]:
    return [title, notes, *highlights]


# ------------------------------------------------------------------ the push


def release_url(release_id: str) -> str:
    """What a tap opens: the release, `builder://release/<id>`."""
    return f"{APP_SCHEME}://release/{release_id}"


def collapse_id(release_id: str) -> str:
    return f"release:{release_id}"[:63]


def push_data(release_id: str) -> dict[str, str]:
    return {"kind": KIND_RELEASE, "release_id": release_id, "url": release_url(release_id)}


def compose(display_name: str | None, handle: str | None, name: str | None, title: str) -> tuple:
    """The banner: who released what, and the release's own title. The project is named only when
    it is public (`name` is None otherwise). Plain words, no dash."""
    who = (display_name or "").strip() or (f"@{handle}" if handle else SOMEONE)
    head = f"{who} released {name}" if name else f"{who} posted a release"
    return head, title


# ------------------------------------------------------------------ the sweep


def forget_project(db, user_id: str, project_key: str) -> dict[str, int]:
    """Everything of 0037 about one repository of this account, for the exclusion sweep
    (routes/privacy.py): its releases and settings, every star on it (through the SECURITY DEFINER
    `drop_project_stars`: a star is its giver's row), and this account's own stars under the same
    key, which say which repository it follows as surely as its own project does."""
    params = {"u": user_id, "k": project_key}
    releases = db.execute(
        text(
            "DELETE FROM releases WHERE owner_id = CAST(:u AS uuid) AND project_key = :k "
            "RETURNING id"
        ),
        params,
    ).all()
    db.execute(
        text("DELETE FROM release_settings WHERE user_id = CAST(:u AS uuid) AND project_key = :k"),
        params,
    )
    on_it = db.execute(text("SELECT drop_project_stars(:k)"), params).scalar()
    given = db.execute(
        text(
            "DELETE FROM project_stars WHERE user_id = CAST(:u AS uuid) AND project_key = :k "
            "RETURNING owner_id"
        ),
        params,
    ).all()
    return {"releases": len(releases), "stars": int(on_it or 0), "stars_given": len(given)}
