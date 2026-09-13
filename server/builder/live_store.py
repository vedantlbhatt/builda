"""The live state's storage: one row per running session, and the owner's two switches.

docs/overnight-integration.md 3.3 and 3.4. Every function here runs inside the caller's
transaction, under the caller's viewer, so row level security (0020) decides what it can
see and write; nothing here opens a connection of its own.

The row exists exactly while its session is live. `routes/sync.py store_payloads`, the one
path the batch route and the hook channel share, calls `upsert` for a live payload that
carries a `live` block and `delete` for a final one; a live payload WITHOUT the block (the
Mac app) leaves the row alone, as an `analysis` is left alone. Nothing here computes a live
state: `analysis/live.py` does, on the machine or in `hook_ingest`, and the door
(`live_spec.LiveState`) has already validated what arrives.

`slim` is what every list reads. Ten live sessions with a 400 row map and 600 frames each
is about 600 KB every 60 s, and mission control, the widget and ActivityKit read only the
activity, the verdict, the ETA, needs you and the decisions.
"""

from __future__ import annotations

import dataclasses
import json
from collections.abc import Mapping

from sqlalchemy import text

#: `session_live.source` for a state the server computed from a hook-delivered transcript;
#: every other producer is capture (`capture sync --live`, `capture live`).
SOURCE_HOOK = "hook"
SOURCE_CAPTURE = "capture"


@dataclasses.dataclass(frozen=True)
class Prefs:
    """One person's privacy switches. `map_salt` never leaves the server: no route returns
    it, and it is what the hook channel hashes file paths under."""

    quotes: bool
    live_names: bool
    map_salt: str


def prefs(db, user_id: str, *, lock: bool = False) -> Prefs:
    """The viewer's switches, creating the row (both off, a fresh salt) on first use.
    `lock` reads the row `FOR SHARE`, held to the end of the caller's transaction, so a
    switch turned off concurrently is either seen off or waits until this transaction is done
    (`routes/sync.store_payloads` before it stores file names)."""
    row = _read_prefs(db, user_id, lock)
    if row is None:
        # ON CONFLICT: two first requests at once both try; one inserts, both read it.
        db.execute(
            text(
                "INSERT INTO privacy_prefs (user_id) VALUES (:u) ON CONFLICT (user_id) DO NOTHING"
            ),
            {"u": user_id},
        )
        row = _read_prefs(db, user_id, lock)
    return Prefs(quotes=row.quotes, live_names=row.live_names, map_salt=row.map_salt)


def _read_prefs(db, user_id: str, lock: bool = False):
    sql = "SELECT quotes, live_names, map_salt FROM privacy_prefs WHERE user_id = :u"
    return db.execute(text(sql + (" FOR SHARE" if lock else "")), {"u": user_id}).first()


def set_live_names(db, user_id: str, on: bool) -> int:
    """Turn File names on or off. OFF forgets every stored name in the same transaction
    (docs/overnight-integration.md 2.3): a switch that hides names while keeping them is a
    display preference, and the promise is that they are gone. Returns how many live rows
    had names forgotten (0 when turning on)."""
    prefs(db, user_id)
    db.execute(
        text("UPDATE privacy_prefs SET live_names = :on, updated_at = now() WHERE user_id = :u"),
        {"u": user_id, "on": on},
    )
    if on:
        return 0
    return db.execute(
        text("UPDATE session_live SET names = NULL WHERE user_id = :u AND names IS NOT NULL"),
        {"u": user_id},
    ).rowcount


def source_for(client_version: str) -> str:
    """`hook` for a payload the hook channel built, else `capture`."""
    from .hook_ingest import HOOK_CLIENT_VERSION

    return SOURCE_HOOK if client_version == HOOK_CLIENT_VERSION else SOURCE_CAPTURE


def upsert(
    db,
    *,
    session_id,
    user_id: str,
    body: Mapping,
    names: Mapping | None,
    source: str,
) -> None:
    """Replace the session's live row with the latest state.

    `names` is replaced too, never kept: the ids in a stored name list describe the map it
    was sent with, so a state that arrives without names has none. `alerted_phase` is
    live_push's and is left alone.
    """
    db.execute(
        text(
            """
            INSERT INTO session_live
              (session_id, user_id, live_version, source, computed_at, body, names)
            VALUES (:sid, :u, :v, :src, :at, CAST(:body AS jsonb), CAST(:names AS jsonb))
            ON CONFLICT (session_id) DO UPDATE SET
              live_version = EXCLUDED.live_version,
              source = EXCLUDED.source,
              computed_at = EXCLUDED.computed_at,
              body = EXCLUDED.body,
              names = EXCLUDED.names,
              updated_at = now()
            """
        ),
        {
            "sid": session_id,
            "u": user_id,
            "v": body["live_version"],
            "src": source,
            "at": body["computed_at"],
            "body": json.dumps(body),
            "names": json.dumps(names) if names is not None else None,
        },
    )


def delete(db, session_id) -> bool:
    """Forget the live row of a session that is no longer live. True when one existed."""
    return (
        db.execute(
            text("DELETE FROM session_live WHERE session_id = :sid"), {"sid": session_id}
        ).rowcount
        > 0
    )


def slim(body: Mapping | None) -> dict | None:
    """The list form of a live state: no time lapse, and of the map only the rows the
    activity and the verdict name (the sentence's role lookup reads them), with
    `files_total` kept so the phone can still say how many files the session touched.
    None stays None."""
    if body is None:
        return None
    out = dict(body)
    out["timelapse"] = None
    m = body.get("map")
    if m is not None:
        keep = {
            fid
            for fid in (
                (body.get("activity") or {}).get("file_id"),
                (body.get("verdict") or {}).get("file_id"),
            )
            if fid
        }
        out["map"] = {
            "files": [f for f in m.get("files") or [] if f.get("id") in keep],
            "files_total": m.get("files_total"),
        }
    return out
