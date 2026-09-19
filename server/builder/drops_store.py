"""The SQL behind the drops routes. Every query runs as the viewer, under RLS (0028).

Kept apart from `routes/drops.py` for the reason `live_store.py` is kept apart from its
routes: the interesting rules here are about what a write is ALLOWED to move, and a test that
has to spin up a request to check one is a test nobody writes.

THE RULE THIS MODULE EXISTS TO HOLD. A move leaves `offered` only through `start_move`, which
is called only by the tap route, and it re enters `offered` from nowhere. `apply_resolution`
REPLACES a drop's moves, so a re resolution of the same link cannot resurrect a move somebody
declined or double start one that is already running: moves that are not `offered` are kept and
only the untouched ones are rewritten.
"""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

#: The board's page. A person with more drops than this pages; the request does not grow.
BOARD_LIMIT = 200
#: How many drops one Mac takes per poll. Small on purpose: each one costs a model call, and a
#: crash halfway through a batch of twenty leaves twenty rows in `resolving`.
CLAIM_LIMIT = 3
#: A drop stuck in `resolving` for longer than this was claimed by a Mac that went away.
#: MEASURED: resolve plus plan is 15 to 40 s on this corpus, so ten minutes is fifteen times
#: the slowest observed run and nothing legitimate is still working at it.
STALE_CLAIM_MINUTES = 10

DROP_COLUMNS = """
  d.id, d.url, d.platform, d.status, d.kind, d.title, d.summary, d.thumbnail_url,
  d.refusal, d.resolution, d.created_at, d.resolved_at, d.archived_at
"""
MOVE_COLUMNS = """
  m.id, m.drop_id, m.position, m.move_kind, m.status, m.title, m.intent, m.evidence,
  m.target, m.effort, m.source, m.verification, m.adjustment, m.repo_key, m.session_id,
  m.run_uuid, m.outcome, m.queued_at, m.started_at, m.finished_at
"""


def _row(r: Any) -> dict:
    d = dict(r._mapping)
    for k, v in list(d.items()):
        if hasattr(v, "isoformat"):
            d[k] = v.isoformat()
        elif hasattr(v, "hex") and k.endswith("id"):
            d[k] = str(v)
    return d


# --------------------------------------------------------------------------- create
def create_drop(
    db: Session, user_id: str, *, url: str, platform: str, shared_text: str | None
) -> dict:
    """Insert, or return the drop this link already is.

    ON CONFLICT DO UPDATE rather than DO NOTHING: `DO NOTHING` returns no row, so the route
    would have to SELECT again and a concurrent delete between the two is a 500 on a share.
    The update is deliberately almost nothing: an existing drop keeps its resolution and its
    moves, and re sharing a reel does not re plan it. It does un archive it, because tapping
    share on something you archived is a person asking for it back.
    """
    r = db.execute(
        text(
            """
            INSERT INTO drops (user_id, url, platform, shared_text)
            VALUES (:uid, :url, :plat, :txt)
            ON CONFLICT (user_id, url) DO UPDATE
              SET archived_at = NULL,
                  status = CASE WHEN drops.status = 'archived' THEN 'waiting' ELSE drops.status END,
                  shared_text = COALESCE(drops.shared_text, EXCLUDED.shared_text)
            RETURNING """
            + DROP_COLUMNS.replace("d.", "")
            + """, (xmax = 0) AS created
            """
        ),
        {"uid": user_id, "url": url, "plat": platform, "txt": shared_text or None},
    ).one()
    return _row(r)


# ---------------------------------------------------------------------------- read
def board(
    db: Session, user_id: str, *, include_archived: bool = False
) -> tuple[list[dict], list[dict]]:
    drops = [
        _row(r)
        for r in db.execute(
            text(
                f"""
                SELECT {DROP_COLUMNS} FROM drops d
                WHERE d.user_id = :uid AND (:arch OR d.archived_at IS NULL)
                ORDER BY d.created_at DESC
                LIMIT {BOARD_LIMIT}
                """
            ),
            {"uid": user_id, "arch": include_archived},
        )
    ]
    if not drops:
        return [], []
    ids = [d["id"] for d in drops]
    moves = [
        _row(r)
        for r in db.execute(
            text(
                f"""
                SELECT {MOVE_COLUMNS} FROM drop_moves m
                WHERE m.user_id = :uid AND m.drop_id = ANY(:ids)
                ORDER BY m.drop_id, m.position
                """
            ),
            {"uid": user_id, "ids": ids},
        )
    ]
    return drops, moves


def get_drop(db: Session, user_id: str, drop_id: str) -> dict | None:
    r = db.execute(
        text(f"SELECT {DROP_COLUMNS} FROM drops d WHERE d.user_id = :uid AND d.id = :id"),
        {"uid": user_id, "id": drop_id},
    ).first()
    return _row(r) if r else None


def moves_of(db: Session, user_id: str, drop_id: str) -> list[dict]:
    return [
        _row(r)
        for r in db.execute(
            text(
                f"SELECT {MOVE_COLUMNS} FROM drop_moves m "
                "WHERE m.user_id = :uid AND m.drop_id = :id ORDER BY m.position"
            ),
            {"uid": user_id, "id": drop_id},
        )
    ]


# --------------------------------------------------------------------------- claim
def claim_waiting(db: Session, user_id: str, *, limit: int = CLAIM_LIMIT) -> list[dict]:
    """Take up to `limit` unread drops and mark them `resolving`, atomically.

    `FOR UPDATE SKIP LOCKED` is what makes two Macs on one account safe: the second one steps
    over the rows the first is holding instead of blocking on them or, worse, resolving the
    same link twice and paying for two plans. A row CLAIMED longer than STALE_CLAIM_MINUTES ago
    and still `resolving` is taken back, because a Mac that closed its lid mid claim must not
    strand a drop forever. From the claim, not the share (0034): a drop shared an hour before any
    Mac woke was otherwise claimable again seconds after it was first taken.
    """
    rows = db.execute(
        text(
            f"""
            WITH claimable AS (
              SELECT d.id FROM drops d
              WHERE d.user_id = :uid AND d.archived_at IS NULL
                AND (d.status = 'waiting'
                     OR (d.status = 'resolving'
                         AND COALESCE(d.claimed_at, d.created_at)
                             < now() - interval '{STALE_CLAIM_MINUTES} minutes'))
              ORDER BY d.created_at
              LIMIT :lim
              FOR UPDATE SKIP LOCKED
            )
            UPDATE drops d SET status = 'resolving', claimed_at = now()
            FROM claimable c WHERE d.id = c.id
            RETURNING d.id, d.url, d.platform, d.shared_text, d.created_at
            """
        ),
        {"uid": user_id, "lim": limit},
    ).all()
    return [_row(r) for r in rows]


# ---------------------------------------------------------------------- resolution
def apply_resolution(db: Session, user_id: str, drop_id: str, resolution: dict) -> dict:
    """Store what the Mac read and planned, and rewrite the offered moves.

    The caption is NOT stored: `resolution["source"]` carries its length and nothing else, and
    `shared_text` is set to NULL here because it has now been used for the only thing it was
    kept for.
    """
    plan = resolution.get("plan")
    src = resolution.get("source") or {}
    refusal = resolution.get("refusal")
    status = "planned" if plan else "refused"
    kind = (plan or {}).get("kind")
    db.execute(
        text(
            """
            UPDATE drops SET
              status = :status, kind = :kind, title = :title, summary = :summary,
              thumbnail_url = :thumb, refusal = :refusal, resolution = CAST(:res AS jsonb),
              resolved_at = now(), shared_text = NULL
            WHERE user_id = :uid AND id = :id
            """
        ),
        {
            "uid": user_id,
            "id": drop_id,
            "status": status,
            "kind": kind,
            "title": (plan or {}).get("title"),
            "summary": (plan or {}).get("summary"),
            "thumb": src.get("thumbnail_url"),
            "refusal": refusal,
            "res": json.dumps(resolution),
        },
    )
    # Only the moves nobody has touched are replaced. A declined move stays declined and a
    # running one keeps running: a second resolution is new information about the link, not
    # permission to undo what a person already decided.
    db.execute(
        text(
            "DELETE FROM drop_moves WHERE user_id = :uid AND drop_id = :id AND status = 'offered'"
        ),
        {"uid": user_id, "id": drop_id},
    )
    taken = {
        r[0]
        for r in db.execute(
            text("SELECT position FROM drop_moves WHERE user_id = :uid AND drop_id = :id"),
            {"uid": user_id, "id": drop_id},
        )
    }
    for i, m in enumerate((plan or {}).get("moves") or []):
        if i in taken:
            continue
        db.execute(
            text(
                """
                INSERT INTO drop_moves
                  (drop_id, user_id, position, move_kind, title, intent, evidence, target,
                   effort, source, verification)
                VALUES (:did, :uid, :pos, :kind, :title, :intent, :ev, :target, :effort,
                        CAST(:src AS jsonb), CAST(:ver AS jsonb))
                """
            ),
            {
                "did": drop_id,
                "uid": user_id,
                "pos": i,
                "kind": m["move_kind"],
                "title": m["title"],
                "intent": m["intent"],
                "ev": m["evidence"],
                "target": m["target"],
                "effort": m["effort"],
                "src": json.dumps(m["source"]) if m.get("source") else None,
                "ver": json.dumps(m["verification"]) if m.get("verification") else None,
            },
        )
    return {"status": status, "moves": len((plan or {}).get("moves") or [])}


def mark_refused(db: Session, user_id: str, drop_id: str, refusal: str) -> None:
    db.execute(
        text(
            """
            UPDATE drops SET status = 'refused', refusal = :r, resolved_at = now(),
                             shared_text = NULL
            WHERE user_id = :uid AND id = :id
            """
        ),
        {"uid": user_id, "id": drop_id, "r": refusal},
    )


# --------------------------------------------------------------------------- moves
def start_move(
    db: Session, user_id: str, move_id: str, *, adjustment: str | None, repo_key: str | None
) -> dict | None:
    """offered -> queued, or failed -> queued. The ONLY way a move is ever queued.

    The WHERE clause carries the status, so a double tap queues once and the second request comes
    back as "already queued" rather than as a second run of the same work.

    FAILED IS STARTABLE AGAIN, by the same tap (2026-09-19). A run that failed said why ("that
    checkout has uncommitted work; commit or stash it first") and then left the person no way to
    act on it short of sharing the reel again. The last run's words, times and ids are cleared,
    so the card says what THIS run is doing; that run's session, if capture uploaded one, is
    still a session like any other.
    """
    r = db.execute(
        text(
            f"""
            UPDATE drop_moves SET status = 'queued', queued_at = now(),
                                  adjustment = :adj, repo_key = COALESCE(:repo, repo_key),
                                  outcome = NULL, started_at = NULL, finished_at = NULL,
                                  run_uuid = NULL, session_id = NULL
            WHERE user_id = :uid AND id = :id AND status IN ('offered', 'failed')
            RETURNING {MOVE_COLUMNS.replace("m.", "")}
            """
        ),
        {"uid": user_id, "id": move_id, "adj": adjustment, "repo": repo_key},
    ).first()
    return _row(r) if r else None


def decline_move(db: Session, user_id: str, move_id: str) -> dict | None:
    r = db.execute(
        text(
            f"""
            UPDATE drop_moves SET status = 'declined'
            WHERE user_id = :uid AND id = :id AND status IN ('offered', 'queued')
            RETURNING {MOVE_COLUMNS.replace("m.", "")}
            """
        ),
        {"uid": user_id, "id": move_id},
    ).first()
    return _row(r) if r else None


def claim_queued(db: Session, user_id: str, *, limit: int = 2) -> list[dict]:
    """The runner takes queued moves. Same SKIP LOCKED rule as `claim_waiting`."""
    rows = db.execute(
        text(
            """
            WITH claimable AS (
              SELECT m.id FROM drop_moves m
              WHERE m.user_id = :uid AND m.status = 'queued'
              ORDER BY m.queued_at
              LIMIT :lim
              FOR UPDATE SKIP LOCKED
            )
            UPDATE drop_moves m SET status = 'running', started_at = now()
            FROM claimable c, drops d
            WHERE m.id = c.id AND d.id = m.drop_id
            -- The DROP's own title and kind travel with the move. The runner needs the thing
            -- the post was ABOUT (a dish, a skill) and a move carries only what to do about it:
            -- MEASURED, a `card` move handed its own `intent` as the dish searched for "Find the
            -- full ingredients list and step by step method for this one pan garlic butter
            -- shrimp pasta" and came back with nothing, where the title alone finds it.
            RETURNING m.id, m.drop_id, m.move_kind, m.title, m.intent, m.evidence, m.target,
                      m.effort, m.source, m.adjustment, m.repo_key,
                      d.title AS drop_title, d.kind AS drop_kind, d.url AS drop_url
            """
        ),
        {"uid": user_id, "lim": limit},
    ).all()
    return [_row(r) for r in rows]


def finish_move(
    db: Session,
    user_id: str,
    move_id: str,
    *,
    status: str,
    outcome: str | None,
    run_uuid: str | None,
) -> dict | None:
    """The runner says how it went, and which run it was.

    `run_uuid` is NOT the session id (0029): a Claude Code run becomes a Builda session only once
    capture has uploaded the transcript, which is later and may be never. Writing it into
    `session_id` was a foreign key violation and a 500 with the work already done.
    """
    if status not in ("done", "failed"):
        raise ValueError(f"finish_move takes done or failed, not {status!r}")
    r = db.execute(
        text(
            f"""
            UPDATE drop_moves SET status = :st, finished_at = now(), outcome = :out,
                                  run_uuid = COALESCE(CAST(:run AS uuid), run_uuid)
            WHERE user_id = :uid AND id = :id AND status = 'running'
            RETURNING {MOVE_COLUMNS.replace("m.", "")}
            """
        ),
        {"uid": user_id, "id": move_id, "st": status, "out": outcome, "run": run_uuid},
    ).first()
    return _row(r) if r else None


def link_session(db: Session, user_id: str) -> int:
    """Point every finished move at the Builda session its run became, where there is one.

    The join is `sessions.client_session_id`, which capture derives from the transcript, against
    nothing this table holds; so until that link exists this walks the moves with a `run_uuid` and
    no `session_id` and finds a session of the same account that started inside the move's own
    window. It is deliberately conservative: one candidate or none, never a guess between two.
    """
    r = db.execute(
        text(
            """
            WITH candidate AS (
              SELECT m.id AS move_id,
                     (SELECT s.id FROM sessions s
                       WHERE s.user_id = m.user_id
                         AND s.started_at BETWEEN m.started_at - interval '2 minutes'
                                              AND COALESCE(m.finished_at, now())
                       LIMIT 2) AS session_id,
                     (SELECT count(*) FROM sessions s
                       WHERE s.user_id = m.user_id
                         AND s.started_at BETWEEN m.started_at - interval '2 minutes'
                                              AND COALESCE(m.finished_at, now())) AS n
              FROM drop_moves m
              WHERE m.user_id = :uid AND m.run_uuid IS NOT NULL AND m.session_id IS NULL
                AND m.started_at IS NOT NULL
            )
            UPDATE drop_moves m SET session_id = c.session_id
            FROM candidate c
            WHERE m.id = c.move_id AND c.n = 1 AND c.session_id IS NOT NULL
            RETURNING m.id
            """
        ),
        {"uid": user_id},
    ).all()
    return len(r)


# ------------------------------------------------------------------------- archive
def archive(db: Session, user_id: str, drop_id: str, *, on: bool) -> bool:
    r = db.execute(
        text(
            """
            UPDATE drops SET archived_at = CASE WHEN :on THEN now() ELSE NULL END,
                             status = CASE WHEN :on THEN 'archived'
                                           WHEN resolution IS NOT NULL THEN 'planned'
                                           WHEN refusal IS NOT NULL THEN 'refused'
                                           ELSE 'waiting' END
            WHERE user_id = :uid AND id = :id
            RETURNING id
            """
        ),
        {"uid": user_id, "id": drop_id, "on": on},
    ).first()
    return r is not None


def delete_drop(db: Session, user_id: str, drop_id: str) -> bool:
    r = db.execute(
        text("DELETE FROM drops WHERE user_id = :uid AND id = :id RETURNING id"),
        {"uid": user_id, "id": drop_id},
    ).first()
    return r is not None
