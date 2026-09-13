"""The quotes document: up to three of a person's prompts, verbatim, for the Wrapped cards.

THE SECOND OPT-IN EXCEPTION of contract v4 (`quotes`, docs/overnight-integration.md 2.4):
the one place a prompt's own words are stored. Two switches, both off by default, and
both must say yes before anything arrives: the phone's Settings row ("Quote my prompts on
my cards", `privacy_prefs.quotes`) and `python -m capture report --quotes` on the machine,
which is never persisted. Turning the phone's switch off deletes what was stored IN THE
SAME TRANSACTION; a switch that only hid them would be a display preference, and the
promise is that they are gone.

The door has three locks, in order:

  1. `quotes_spec.QuotesUpload` (generated): `extra="forbid"` at every level, a known card,
     at most three quotes, each at most 160 characters.
  2. `quotes_gate`: the machine's own filters, run a third time on the text as it arrived
     (`digest.mask` must leave it unchanged, `wrapped.quotable` must pass it: no slash
     command, no identifier shaped token such as a pasted account id, no paste) and the
     rule the quote cards pick by (`wrapped._private`: no secret word, no home directory
     path, no credentials in a URL, no pasted error, nobody else's words). The functions are
     imported, never restated: one rule, one function. A server without `analysis/` cannot
     run them, so it stores nothing and says so (503).
  3. `sessions_not_held`: every quote names the session it was sent in, and that session
     must be one this account has uploaded. A quote from a session the server does not hold
     (an excluded repository's, whose sessions are deleted) has no business here.

Owner only (RLS on `builder_quotes`, 0021), read by `GET /v1/profile/builder` for its owner
alone, and joined by no social query.
"""

from __future__ import annotations

import json
import pathlib
import sys

from sqlalchemy import text

from . import live_store
from .quotes_spec import QuotesUpload

_ROOT = pathlib.Path(__file__).resolve().parents[2]

#: The 409 when the account has the switch off. It names the switch, because the person
#: reading it is at a terminal and the switch is on the phone (capture prints it as it is).
QUOTES_OFF = "quotes are off for this account; turn on Settings, Quote my prompts"
#: The 503 when the filters cannot run here. Nothing is stored without them.
ENGINE_MISSING = "this server cannot check quotes (analysis is not deployed), so none were stored"


class EngineUnavailable(RuntimeError):
    """`analysis/` is not importable on this server image."""


def _filters():
    """`(digest.mask, wrapped.quotable, wrapped._private)` from the deployed engine, imported
    lazily from the repository root as `builder_profile` does."""
    try:
        from analysis import digest, wrapped
    except ImportError:
        root = str(_ROOT)
        if root not in sys.path:
            sys.path.insert(0, root)
        try:
            from analysis import digest, wrapped
        except ImportError as e:  # pragma: no cover - deployment shape, not logic
            raise EngineUnavailable(str(e)) from e
    return digest.mask, wrapped.quotable, wrapped._private


def quotes_gate(doc: QuotesUpload) -> str | None:
    """Why this document may not be stored, or None. Raises `EngineUnavailable`.

    The reason names the quote by position and the rule it failed, and never echoes the
    text: a refusal is logged and printed, and the text is what must not travel."""
    mask, quotable, private = _filters()
    for i, q in enumerate(doc.quotes, start=1):
        if mask(q.text) != q.text:
            return f"quote {i} ({q.card}) carries something the mask removes"
        if not quotable(q.text):
            return (
                f"quote {i} ({q.card}) is not quotable: empty, a slash command, already "
                "masked, an identifier shaped token or a paste"
            )
        if private(q.text):
            return (
                f"quote {i} ({q.card}) carries a secret word, a home path, credentials in a "
                "URL, a pasted error or somebody else's words"
            )
    return None


def sessions_not_held(db, user_id: str, doc: QuotesUpload) -> list[int]:
    """1 based positions of the quotes whose `client_session_id` this account has not
    uploaded. Empty when every quote's session is on the server."""
    ids = sorted({q.client_session_id for q in doc.quotes})
    if not ids:
        return []
    held = {
        r.client_session_id
        for r in db.execute(
            text(
                "SELECT client_session_id FROM sessions "
                "WHERE user_id = :u AND client_session_id = ANY(CAST(:ids AS text[]))"
            ),
            {"u": user_id, "ids": ids},
        )
    }
    return [i for i, q in enumerate(doc.quotes, start=1) if q.client_session_id not in held]


def quotes_on_for_update(db, user_id: str) -> bool:
    """The switch, read with the row LOCKED until the caller's transaction ends.

    The lock is the whole point. Without it a store racing the phone's "off" can check the
    switch, lose the race to the off (which deletes and commits), and then write a quote
    into an account whose switch is off. With it the off waits for the store and then
    deletes what it stored, or the store waits for the off and sees it."""
    live_store.prefs(db, user_id)  # the row, both off, on first use
    return bool(
        db.execute(
            text("SELECT quotes FROM privacy_prefs WHERE user_id = :u FOR UPDATE"),
            {"u": user_id},
        ).scalar()
    )


def put_quotes(db, user_id: str, doc: dict) -> None:
    """Replace this person's quotes with `doc`, which the caller has gated. One row, no
    history: the cards quote the corpus as it stands."""
    db.execute(
        text(
            """
            INSERT INTO builder_quotes (user_id, quotes_version, generated_at, body)
            VALUES (:u, :v, :g, CAST(:b AS jsonb))
            ON CONFLICT (user_id) DO UPDATE SET
              quotes_version = EXCLUDED.quotes_version,
              generated_at = EXCLUDED.generated_at,
              body = EXCLUDED.body,
              updated_at = now()
            """
        ),
        {"u": user_id, "v": doc["quotes_version"], "g": doc["generated_at"], "b": json.dumps(doc)},
    )


def delete_quotes(db, user_id: str) -> int:
    """Forget every stored quote. How many rows went (0 or 1): a measured count."""
    return db.execute(
        text("DELETE FROM builder_quotes WHERE user_id = :u"), {"u": user_id}
    ).rowcount


def set_quotes(db, user_id: str, on: bool) -> int:
    """Turn Quote my prompts on or off. OFF deletes every stored quote in the same
    transaction, after the switch row is updated (and so locked), and returns how many were
    deleted; ON returns 0 and stores nothing, because the machine must still say yes."""
    live_store.prefs(db, user_id)
    db.execute(
        text("UPDATE privacy_prefs SET quotes = :on, updated_at = now() WHERE user_id = :u"),
        {"u": user_id, "on": on},
    )
    return 0 if on else delete_quotes(db, user_id)
