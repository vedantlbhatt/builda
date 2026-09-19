"""ActivityKit pushes for a reel you shared: the drop's Live Activity (docs/drop-island.md).

You share a reel from Instagram and you are still in Instagram. A banner would pull you out; the
Dynamic Island lets you keep scrolling and see the answer land (docs/motion.md, the island
table). This module is the server's half of that: it STARTS the card by push when a drop is
created (so a share the extension sent itself shows up in the island with Builda not running),
and MOVES it on each status transition the Mac causes: reading, planned, refused, and a move
started.

Two halves, kept apart for `live_push.py`'s reason.

THE CARD (`content_state` and everything above `plan_start`) is pure: standard library only, no
database and no clock, so `test_drop_island.py` holds it to the Swift struct it must fill (read
out of BuilderDropAttributes.swift) and to `spec/fixtures/drops/activity_state.json`, which the
phone's half (`mobile/src/live/dropActivity.ts dropState`) is held to as well. A key the struct
lacks is dropped by ActivityKit without a word; a rule computed differently on the two sides
flickers between two answers every time a push lands.

THE DECISION (`plan_start`, `plan_updates`) reads the tokens under the owner's RLS and records
what each card was last told, and `send` delivers AFTER the drops route's transaction has
committed, as `notify.py` and `live_push.py` do: a push failure can never roll back what the Mac
stored, and a crash between the two loses a push rather than doubling one. The rules, each
tested:

  * A card only moves FORWARD (`RANK`): sent, reading, an answer, started. A claim retried
    after a stale lease, or a second resolution of a planned drop, is not news and is not sent.
  * A start goes out only for a drop this share CREATED: sharing the same reel again is the
    card you already have (`drops_store.create_drop`), not a second island.
  * Only the drop's owner's tokens are ever read, by user id AND under their RLS, so a drop is
    never pushed to anybody who did not share it.
  * The answer (planned or refused) carries the alert, priority 10, and when that alert was
    delivered the ordinary "it was read" banner is not sent: one moment, one alert, the rule
    `live_push` keeps for needs you. Reading and started are quiet, priority 5.
  * No APNs key (a laptop): nothing is sent, one log line says so, and the decision is still
    recorded, so turning the key on later does not replay old transitions.
"""

from __future__ import annotations

import dataclasses
import json
import logging
import math
from collections.abc import Iterable, Mapping, Sequence
from urllib.parse import urlsplit

log = logging.getLogger("builder.drop_push")

#: The Swift type's NAME. A push-to-start names the ActivityAttributes it starts, and ActivityKit
#: matches it by this string, so a rename on the phone is a start that silently never arrives.
ATTRIBUTES_TYPE = "BuilderDropAttributes"

#: `BuilderDropAttributes.ContentState`, in declaration order. A push must carry exactly these
#: keys; `test_drop_island.py` reads the Swift file and holds this tuple to it.
CONTENT_STATE_KEYS = (
    "phase",
    "title",
    "moves",
    "firstMoveTitle",
    "firstMoveId",
    "kind",
    "updatedEpoch",
)
#: `BuilderDropAttributes`' own fields, fixed for the life of the card.
ATTRIBUTE_KEYS = ("dropId", "host", "platform")

#: The card's phases. The first four are a drop status (`PHASE_OF_STATUS`); `started` is a move
#: a person started. The CHECK in 0031 is this list, both ways (the test reads it).
PHASES = ("sent", "reading", "planned", "refused", "started")
PHASE_OF_STATUS = {
    "waiting": "sent",
    "resolving": "reading",
    "planned": "planned",
    "refused": "refused",
}
#: How far along a phase is. A push goes out only to a card that is behind it.
RANK = {"sent": 0, "reading": 1, "planned": 2, "refused": 2, "started": 3}

#: `drop_moves.target` of a move that runs in one of YOUR repositories. It cannot be started until
#: you say which (`MoveRow.tsx needsRepo`), so the island never offers Start for it.
NEEDS_A_REPO = "existing_repo"

#: A card the Mac has not answered by then says "waiting for your Mac" (the board's own words):
#: resolve and plan are 15 to 40 s (`drops_store.STALE_CLAIM_MINUTES`), so ten minutes means
#: the Mac is asleep, not slow.
READING_STALE_SECONDS = 600
#: An answer's Start button uses the phone's mirrored access token, which lives fifteen minutes
#: (`settings.access_token_ttl_seconds`, 900). Past that the card stops offering a button that
#: would fail and says to open Builda instead.
ANSWER_STALE_SECONDS = 900

#: docs/motion.md PRIORITY: a reel being read (60) sits under a run that needs you (100, which
#: `live_push.RELEVANCE_NEEDS_YOU` gives) and over a session merely running (50).
RELEVANCE = 60
RELEVANCE_STARTED = 20

#: `apns-priority`: 10 lights the screen and spends the card's budget, so only the start (which
#: must carry an alert) and the answer use it.
PRIORITY_ALERT = 10
PRIORITY_QUIET = 5

KIND_START = "start"
KIND_UPDATE = "update"


# ------------------------------------------------------------------------------ the card


def js_round(x: float) -> int:
    """`Math.round`, as `live_push.js_round`: the phone's `updatedEpoch` to the second."""
    f = math.floor(x)
    return int(f + 1 if x - f >= 0.5 else f)


def host_of(url: str) -> str:
    """Where it came from, as a person reads it: `new URL(url).host` without a leading `www.`,
    which is what `src/live/dropActivity.ts dropHost` and the in-app island say."""
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    port = parts.port
    if port is not None and not (
        (parts.scheme == "https" and port == 443) or (parts.scheme == "http" and port == 80)
    ):
        host = f"{host}:{port}"
    return host.removeprefix("www.")


def attributes(drop: Mapping) -> dict:
    return {
        "dropId": str(drop["id"]),
        "host": host_of(drop["url"]),
        "platform": drop["platform"],
    }


def phase_of(status: str | None) -> str | None:
    """The card's phase for a drop status; None for one no card shows (archived)."""
    return PHASE_OF_STATUS.get(status or "")


def _offered(moves: Sequence[Mapping]) -> list[Mapping]:
    return sorted((m for m in moves if m.get("status") == "offered"), key=lambda m: m["position"])


def content_state(
    drop: Mapping,
    moves: Sequence[Mapping],
    *,
    now: float,
    phase: str | None = None,
    started_move_id: str | None = None,
) -> dict | None:
    """The card's ContentState: `dropActivity.ts dropState`, in Python, and the reference.

    `drop` is the row as the drops routes return it (`status`, `title`, `kind`); `moves` its
    moves (`id`, `position`, `status`, `title`, `target`). `phase` overrides the one the status
    gives; `started_move_id` makes it `started` with that move as the first. None for a drop no
    card shows. Before an answer the card knows nothing but where it stands, so title, kind and
    the moves are all absent then, never a guess."""
    if started_move_id is not None:
        phase = "started"
    phase = phase or phase_of(drop.get("status"))
    if phase not in PHASES:
        return None
    state = {
        "phase": phase,
        "title": None,
        "moves": 0,
        "firstMoveTitle": None,
        "firstMoveId": None,
        "kind": None,
        "updatedEpoch": js_round(now),
    }
    if phase in ("sent", "reading"):
        return state
    state["title"] = drop.get("title") or None
    state["kind"] = drop.get("kind") or None
    if phase == "refused":
        return state
    offered = _offered(moves)
    state["moves"] = len(offered)
    if phase == "started":
        move = next((m for m in moves if str(m["id"]) == str(started_move_id)), None)
        if move is not None:
            state["firstMoveTitle"] = move["title"]
            state["firstMoveId"] = str(move["id"])
        return state
    if offered:
        first = offered[0]
        state["firstMoveTitle"] = first["title"]
        # The island cannot pick one of your repositories, so it is not handed the id to start
        # one with: the card says to open Builda instead (`DropDisplay.opensToStart`).
        state["firstMoveId"] = None if first.get("target") == NEEDS_A_REPO else str(first["id"])
    return state


def stale_after(phase: str) -> int:
    return READING_STALE_SECONDS if phase in ("sent", "reading") else ANSWER_STALE_SECONDS


def start_payload(drop: Mapping, state: Mapping, *, now: float) -> dict:
    """A push-to-start (iOS 17.2+): the type by name, its fixed attributes, the first state.

    ActivityKit shows a pushed start only with an `alert`, so it has one: the step the card
    is at and where the post came from, no sound. `input-push-token` asks the system for the
    new card's update token (iOS 18), which the phone's module hands back through
    `POST /v1/push/drop-activity`; a system that does not know the key ignores it and hands
    the token over anyway on the wake it gives the app."""
    at = js_round(now)
    attrs = attributes(drop)
    return {
        "aps": {
            "timestamp": at,
            "event": KIND_START,
            "content-state": dict(state),
            "attributes-type": ATTRIBUTES_TYPE,
            "attributes": attrs,
            "alert": {"title": "Sent to your Mac", "body": attrs["host"]},
            "stale-date": at + stale_after(state["phase"]),
            "relevance-score": RELEVANCE,
            "input-push-token": 1,
        }
    }


def update_payload(state: Mapping, *, now: float, alert: Mapping | None = None) -> dict:
    at = js_round(now)
    aps: dict = {
        "timestamp": at,
        "event": KIND_UPDATE,
        "content-state": dict(state),
        "stale-date": at + stale_after(state["phase"]),
        "relevance-score": RELEVANCE_STARTED if state["phase"] == "started" else RELEVANCE,
    }
    if alert is not None:
        aps["alert"] = dict(alert)
    return {"aps": aps}


def answer_alert(drop: Mapping, state: Mapping) -> dict | None:
    """The alert an answer carries: the read banner's own words (`drops_notify.compose_read`),
    so the island and the banner it replaces say the same thing."""
    if state["phase"] not in ("planned", "refused"):
        return None
    from . import drops_notify

    title, body = drops_notify.compose_read(
        title=drop.get("title"),
        kind=drop.get("kind"),
        refusal=drop.get("refusal"),
        moves=state["moves"],
    )
    return {"title": title, "body": body}


# ------------------------------------------------------------------------------ the decision


@dataclasses.dataclass(frozen=True)
class Target:
    id: str
    user_id: str
    token: str
    environment: str


@dataclasses.dataclass(frozen=True)
class DropPush:
    target: Target
    drop_id: str
    event: str
    payload: dict
    priority: int
    #: `apns-expiration`: the card's stale date. A move APNs could not deliver before the card
    #: would have gone stale is not worth delivering after.
    expiration: int

    @property
    def alerts(self) -> bool:
        return "alert" in self.payload["aps"]


def plan_start(db, user_id: str, drop: Mapping, *, now: float) -> list[DropPush]:
    """A push-to-start to every one of the owner's push-to-start tokens, for a drop just shared."""
    from sqlalchemy import text

    state = content_state(drop, [], now=now, phase="sent")
    if state is None:
        return []
    rows = db.execute(
        text(
            "SELECT id, token, environment FROM drop_activity_tokens "
            "WHERE user_id = :u AND kind = 'push_to_start' ORDER BY created_at, id"
        ),
        {"u": user_id},
    ).all()
    payload = start_payload(drop, state, now=now)
    return [
        DropPush(
            target=Target(str(r.id), user_id, r.token, r.environment),
            drop_id=str(drop["id"]),
            event=KIND_START,
            payload=payload,
            priority=PRIORITY_ALERT,
            expiration=payload["aps"]["stale-date"],
        )
        for r in rows
    ]


def plan_updates(
    db,
    user_id: str,
    drop_ids: Iterable[str],
    *,
    now: float,
    started_move_id: str | None = None,
) -> list[DropPush]:
    """An update to every card of these drops that is behind where its drop now is, RECORDED on
    the token row (`last_phase`) in the caller's transaction."""
    from sqlalchemy import text

    from . import drops_store as store

    ids = sorted({str(d) for d in drop_ids})
    if not ids:
        return []
    tokens = db.execute(
        text(
            """
            SELECT id, drop_id, token, environment, last_phase FROM drop_activity_tokens
            WHERE user_id = :u AND kind = 'activity' AND drop_id = ANY(CAST(:ids AS uuid[]))
            ORDER BY created_at, id
            FOR UPDATE
            """
        ),
        {"u": user_id, "ids": ids},
    ).all()
    by_drop: dict[str, list] = {}
    for t in tokens:
        by_drop.setdefault(str(t.drop_id), []).append(t)

    pushes: list[DropPush] = []
    for drop_id, toks in by_drop.items():
        drop = store.get_drop(db, user_id, drop_id)
        if drop is None:
            continue
        moves = store.moves_of(db, user_id, drop_id)
        state = content_state(drop, moves, now=now, started_move_id=started_move_id)
        if state is None:
            continue
        phase = state["phase"]
        alert = answer_alert(drop, state)
        for t in toks:
            if RANK[phase] <= RANK.get(t.last_phase or "", -1):
                continue
            payload = update_payload(state, now=now, alert=alert)
            pushes.append(
                DropPush(
                    target=Target(str(t.id), user_id, t.token, t.environment),
                    drop_id=drop_id,
                    event=KIND_UPDATE,
                    payload=payload,
                    priority=PRIORITY_ALERT if alert else PRIORITY_QUIET,
                    expiration=payload["aps"]["stale-date"],
                )
            )
            db.execute(
                text(
                    "UPDATE drop_activity_tokens SET last_phase = :p, last_pushed_at = now() "
                    "WHERE id = :i"
                ),
                {"p": phase, "i": str(t.id)},
            )
    return pushes


# ------------------------------------------------------------------------------ the send


def send(pushes: Sequence[DropPush]) -> list[DropPush]:
    """Deliver after commit, best effort; the ones APNs took. Through the one APNs POST
    (`routes/push._deliver`, whose http2 client the tests replace), with the same
    liveactivity headers a session's card gets. A token both hosts refuse is forgotten; a token
    that answered on the other host is moved there, the `push_tokens` rule."""
    if not pushes:
        return []
    from sqlalchemy import text

    from .db import db_session
    from .routes import push as transport
    from .settings import settings

    if not settings().apns_private_key:
        log.info(
            "drop island: APNs is not configured, so %d push(es) for drop %s were not sent",
            len(pushes),
            pushes[0].drop_id,
        )
        return []
    delivered: list[DropPush] = []
    for p in pushes:
        try:
            content = json.dumps(p.payload, separators=(",", ":"), ensure_ascii=False)
            headers = transport.live_activity_headers(priority=p.priority, expiration=p.expiration)
            d = transport._deliver(p.target.token, p.target.environment, content, headers)
            if d.sent:
                delivered.append(p)
                if d.environment != p.target.environment:
                    with db_session(viewer_id=p.target.user_id) as db:
                        db.execute(
                            text("UPDATE drop_activity_tokens SET environment = :e WHERE id = :i"),
                            {"e": d.environment, "i": p.target.id},
                        )
            elif d.gone:
                with db_session(viewer_id=p.target.user_id) as db:
                    db.execute(
                        text("DELETE FROM drop_activity_tokens WHERE id = :i"), {"i": p.target.id}
                    )
        except Exception:
            log.exception("drop island %s push for drop %s failed; not retried", p.event, p.drop_id)
    return delivered


# ------------------------------------------------------------------------------ the hooks


def after_share(
    user_id: str, drop: Mapping, *, created: bool, now: float | None = None
) -> list[DropPush]:
    """`POST /v1/drops` committed. A start for a drop this share created and nobody has read."""
    import time

    from .db import db_session

    if not created or drop.get("status") != "waiting":
        return []
    now = time.time() if now is None else now
    try:
        with db_session(viewer_id=user_id) as db:
            pushes = plan_start(db, user_id, drop, now=now)
    except Exception:
        log.exception("drop island: deciding the start for drop %s failed", drop.get("id"))
        return []
    return send(pushes)


def after_transition(
    user_id: str,
    drop_ids: Iterable[str],
    *,
    started_move_id: str | None = None,
    now: float | None = None,
) -> list[DropPush]:
    """A route that may have moved these drops committed: claim, resolution, refusal, a start,
    and a card's token arriving (it may have missed a move while it had none)."""
    import time

    from .db import db_session

    now = time.time() if now is None else now
    try:
        with db_session(viewer_id=user_id) as db:
            pushes = plan_updates(db, user_id, drop_ids, now=now, started_move_id=started_move_id)
    except Exception:
        log.exception("drop island: deciding updates failed")
        return []
    return send(pushes)
