"""Trailer notes on the server (0035, spec/trailer.v1.json): what a note looks like to the phone and
to the Mac, how many may wait, and the sweep that takes a project's notes away.

The routes are routes/trailer.py. The life of a note is a demo request's (routes/shipkit.py), row
for row, because it is the same conversation: the phone asks, the owner's Mac claims the ask with
`FOR UPDATE SKIP LOCKED` so two Macs never answer one note, and the Mac finishes it `done` with the
new version and what changed, or `failed` with a refusal code. Both answers are codes; the phone
says them in the spec's words.
"""

from __future__ import annotations

from sqlalchemy import text

from .drops_store import STALE_CLAIM_MINUTES

#: Notes one claim takes. The Mac cuts one version at a time, and five waiting is an evening.
CLAIM_MAX = 5
#: Notes a project may have waiting (queued or claimed) at once. A sixth is a 409 rather than a
#: queue the Mac would work through long after the owner stopped caring about the first.
WAITING_MAX = 5
#: The phone's chat: the newest notes first, this many unless it asks for fewer or more.
LIST_DEFAULT = 30
LIST_MAX = 100

COLUMNS = (
    "id, project_key, body, status, created_at, claimed_at, finished_at, from_version, "
    "to_version, changes, refusal, source"
)


def item(r) -> dict:
    """One note as the phone's chat draws it."""
    return {
        "id": str(r.id),
        "body": r.body,
        "status": r.status,
        "created_at": r.created_at.isoformat(),
        "finished_at": r.finished_at.isoformat() if r.finished_at else None,
        "from_version": r.from_version,
        "to_version": r.to_version,
        "changes": r.changes,
        "refusal": r.refusal,
        "source": r.source,
    }


def claimed(r) -> dict:
    """One note as the Mac takes it: which project, the owner's words, when."""
    return {
        "id": str(r.id),
        "project_key": r.project_key,
        "body": r.body,
        "created_at": r.created_at.isoformat(),
    }


def claim(db, user_id: str, device_id: str, *, limit: int = CLAIM_MAX) -> list:
    """The Mac takes the oldest waiting notes, each exactly once, in one statement.

    Waiting is `queued`, or `claimed` longer than `STALE_CLAIM_MINUTES` ago (the drops claim's one
    number, imported rather than written twice): the Mac that took it closed its lid mid note, and
    a note must not be stranded by that. The clock is the CLAIM's, never the note's (0034: a note
    sent while the Mac slept would otherwise be claimable again seconds after it was first taken).
    `FOR UPDATE SKIP LOCKED` is what makes two Macs on one account safe: the second steps over the
    rows the first holds. Oldest first."""
    rows = db.execute(
        text(
            f"""
            UPDATE trailer_notes SET status = 'claimed', claimed_at = now(),
              claimed_by = CAST(:d AS uuid)
            WHERE id IN (
              SELECT id FROM trailer_notes
              WHERE user_id = CAST(:u AS uuid)
                AND (status = 'queued'
                     OR (status = 'claimed'
                         AND claimed_at < now() - interval '{STALE_CLAIM_MINUTES} minutes'))
              ORDER BY created_at LIMIT :n FOR UPDATE SKIP LOCKED)
            RETURNING {COLUMNS}
            """
        ),
        {"u": user_id, "d": device_id, "n": limit},
    ).all()
    return sorted(rows, key=lambda r: r.created_at)


def forget_project(db, user_id: str, project_key: str) -> int:
    """Every note on one project, whatever its status; how many went. For the exclusion sweep
    (routes/privacy.py): an excluded repository has nothing on the server, and a note is the
    owner's words about it."""
    rows = db.execute(
        text(
            "DELETE FROM trailer_notes WHERE user_id = CAST(:u AS uuid) AND project_key = :k "
            "RETURNING id"
        ),
        {"u": user_id, "k": project_key},
    ).all()
    return len(rows)
