"""ActivityKit pushes for a demo you asked for from the phone (docs/demo-island.md).

A demo takes minutes on the Mac, and you do not wait on the kit screen for it: you tap "Request a
demo", go back to what you were doing, and want to post the moment the kit is up. The phone
starts the card itself at the tap (the app is in front, so no push-to-start is needed); this
module MOVES it on the transitions the Mac causes while the app is likely away: the Mac claiming
the request (filming), finishing it (ready, or failed with the kit screen's words), and a kit
arriving for a demo the Mac had made and kept (made, then ready).

DONE IS NOT THE SAME AS UP. `capture demo watch` without `--publish-requests` (the default) makes
the demo and the kit, keeps them on the Mac and finishes the request `done`. A card that said "the
kit is up" with a Share button then would open a screen with nothing new on it. So a done request
is `ready` only when a kit for its project was published at or after the Mac took it (the phone's
`shipkit/model.kitFromRequest`, the same rule the kit screen and the in-app island read), and
`made` otherwise; a kit published later (`kit --publish` by hand) moves every card of the project
still at `made` to `ready` (`after_publish`, from the kit's publish route).

Two halves, kept apart for `drop_push.py`'s reason.

THE CARD (`content_state` and everything above `plan_updates`) is pure: standard library and the
generated spec only, no database and no clock, so `test_demo_island.py` holds it to the Swift
struct it must fill (read out of BuilderDemoAttributes.swift) and to
`spec/fixtures/demos/activity_state.json`, which the phone's half (`mobile/src/live/demoState.ts
demoState`) is held to as well. Where a request stands is the phone's `demoStepFor` (the rule the
in-app island reads) renamed for the card, `PHASE_OF_STATUS` here; the fixture holds the two.

THE DECISION (`plan_updates`, `plan_ends`, `plan_cancel`) reads the tokens under the owner's RLS
and records what each card was last told, and `send` delivers AFTER the demos route's transaction
has committed, as `drop_push` does: a push failure can never roll back what the Mac stored, and a
crash between the two loses a push rather than doubling one. The rules, each tested:

  * A card only moves FORWARD (`RANK`): asked, filming, made, then ready or failed. A second
    claim or a finish replayed is not news and is not sent; made sits BELOW ready so a publish
    after the finish can still move the card.
  * Only the request's owner's tokens are ever read, by user id AND under their RLS.
  * The answer (ready or failed) carries the alert, priority 10: it is the moment the person
    asked to hear about. Filming is quiet, priority 5, and so is made (MADE_IS_QUIET says why).
  * The server never ends a card on an answer: iOS takes an ended card out of the Dynamic Island
    at once, which would hide "the kit is up" as it lands. An answer that has been up for
    ANSWER_HOLD_SECONDS is ended by the Mac's next claim poll (`plan_ends`), and its token
    forgotten; the phone ends one sooner whenever it is in front.
  * A request taken back has nothing left to show: its cards are ended at once (`plan_cancel`),
    which is not an answer landing, so there is nothing for the end to hide.
  * No APNs key (a laptop): nothing is sent, one log line says so, and the decision is still
    recorded, so turning the key on later does not replay old transitions.
"""

from __future__ import annotations

import dataclasses
import json
import logging
import math
from collections.abc import Iterable, Mapping, Sequence
from datetime import UTC, datetime, timedelta

from .shipkit_spec import REQUEST_REFUSAL_SENTENCES

log = logging.getLogger("builder.demo_push")

#: `BuilderDemoAttributes.ContentState`, in declaration order. A push must carry exactly these
#: keys; `test_demo_island.py` reads the Swift file and holds this tuple to it.
CONTENT_STATE_KEYS = ("phase", "sinceEpoch", "failure", "updatedEpoch")
#: `BuilderDemoAttributes`' own fields, fixed for the life of the card. The phone sets them when
#: it starts the card; the server never sends them (it never starts one), and the tuple is here so
#: the tests hold all three sides to one list.
ATTRIBUTE_KEYS = ("requestId", "projectKey", "title", "hue")

#: The card's phases. The CHECK in the newest migration that writes it (0033) is this list, both
#: ways (the test reads it).
PHASES = ("asked", "filming", "made", "ready", "failed")
#: A request status to the card's phase: `demoStepFor` on the phone (queued waiting, claimed
#: filming, done ready, failed failed) with `waiting` named `asked` for the card. Done is `ready`
#: here and becomes `made` in `content_state` when no kit came of it. Cancelled, and anything this
#: build does not know, has no card.
PHASE_OF_STATUS = {
    "queued": "asked",
    "claimed": "filming",
    "done": "ready",
    "failed": "failed",
}
#: How far along a phase is. A push goes out only to a card that is behind it. Made is below
#: ready, so a kit published after the finish moves the card on; ready and failed are both final.
RANK = {"asked": 0, "filming": 1, "made": 2, "ready": 3, "failed": 3}

#: Asked and not picked up by then, the card says so. The worker looks every 30 s
#: (`capture/shipkit/cli.py --every`), and this is the in-app island's own give up
#: (`src/island/model.ts DEMO_FOR_MS`), so the two islands stop at the same moment.
ASKED_STALE_SECONDS = 30 * 60
#: The worker's three ceilings end to end (`capture/shipkit/watch.py`: the capture 60 min, the
#: build post 5, the kit 20). Past them the worker has finished the request one way or the other,
#: so a card still filming means the Mac went quiet.
FILMING_STALE_SECONDS = 85 * 60
#: How long an answer stays in the island while Builda stays closed, and its stale date: the
#: drop card's answer hold (`drop_push.ANSWER_HOLD_SECONDS`), so every answer in the island leaves
#: on one clock. Nothing forces it shorter (Share opens the app and needs no token), and nothing
#: true all day belongs there (docs/motion.md), so it does not stay longer.
ANSWER_STALE_SECONDS = 15 * 60
ANSWER_HOLD_SECONDS = ANSWER_STALE_SECONDS

#: docs/motion.md PRIORITY: a demo (50 in the app) sits under a reel being read (60) and a run
#: that needs you (100), over a session merely running (50 on the Lock Screen's scale).
RELEVANCE = 55

#: `apns-priority`: 10 lights the screen and spends the card's budget, so only the answer uses it.
PRIORITY_ALERT = 10
PRIORITY_QUIET = 5

KIND_UPDATE = "update"
KIND_END = "end"
#: `drop_push.END_EXPIRATION_SECONDS`'s reason: an end that arrives late still takes down a card
#: that would otherwise sit there.
END_EXPIRATION_SECONDS = 8 * 3600

#: The alert an answer carries: the in-app island's words for a kit that is up
#: (`Island.tsx DemoContent`), and for a failure the card's own heading with the kit screen's line.
READY_ALERT = {"title": "The kit is up", "body": "Tap to share it anywhere."}
FAILED_TITLE = "No kit this time"

#: Made carries NO alert. An alert lights the screen and expands the island, which is the card's
#: budget for "you can act on this now, here"; made asks you to act somewhere else (publish on the
#: Mac), and the ready that follows a publish is the moment worth waking the phone for. Spending
#: the alert on made would make that one the second alert for the same demo. The card still moves
#: (the light goes grey, the ear says "made"), and the in-app island says it in words when you open
#: Builda.
MADE_IS_QUIET = True


# ------------------------------------------------------------------------------ the card


def js_round(x: float) -> int:
    """`Math.round`, as `drop_push.js_round`: the phone's epochs to the second."""
    f = math.floor(x)
    return int(f + 1 if x - f >= 0.5 else f)


def phase_of(status: str | None) -> str | None:
    """The card's phase for a request status; None for one no card shows (cancelled)."""
    return PHASE_OF_STATUS.get(status or "")


def _epoch(value) -> float | None:
    """A request's `created_at` as the routes hold it (a datetime) or send it (isoformat)."""
    if isinstance(value, datetime):
        return value.timestamp()
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value).timestamp()
        except ValueError:
            return None
    return None


_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)


def _ms(value) -> int | None:
    """A time as whole milliseconds, truncated, the precision `Date.parse` reads an ISO string at:
    so a kit published in the same millisecond as the claim counts on both sides alike. Integer
    arithmetic on the datetime, because a float of seconds since 1970 carries only about a tenth
    of a microsecond and the case that matters is the last microsecond before a millisecond."""
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value)
        except ValueError:
            return None
    if not isinstance(value, datetime) or value.tzinfo is None:
        return None
    return (value - _EPOCH) // timedelta(milliseconds=1)


def kit_from_request(request: Mapping, kit_published_at) -> bool:
    """`shipkit/model.kitFromRequest`: a kit counts for a request only when it was published at or
    after the Mac took it (`claimed_at`, or `created_at` for a row that has none)."""
    published = _ms(kit_published_at)
    if published is None:
        return False
    taken = _ms(request.get("claimed_at") or request.get("created_at"))
    return taken is not None and published >= taken


def failure_words(request: Mapping) -> str | None:
    """The kit screen's sentence for a failed request's code; None for any other request."""
    if request.get("status") != "failed":
        return None
    return REQUEST_REFUSAL_SENTENCES.get(request.get("refusal") or "")


def content_state(request: Mapping, *, now: float, kit_published_at=None) -> dict | None:
    """The card's ContentState: `demoState.ts demoState`, in Python, and the reference.

    `request` is the row as the demos routes hold it (`status`, `refusal`, `created_at`,
    `claimed_at`); `kit_published_at` is when the project's shown kit was published, or None for
    no kit. None for a request no card shows."""
    phase = phase_of(request.get("status"))
    if phase is None:
        return None
    if phase == "ready" and not kit_from_request(request, kit_published_at):
        phase = "made"
    asked = _epoch(request.get("created_at"))
    return {
        "phase": phase,
        "sinceEpoch": js_round(asked if asked is not None else now),
        "failure": failure_words(request),
        "updatedEpoch": js_round(now),
    }


def stale_after(phase: str) -> int:
    """Made takes an answer's stale date: the Mac is done, and a card waiting for a publish that
    has not come in the hold is a card that has stopped being news."""
    if phase == "asked":
        return ASKED_STALE_SECONDS
    if phase == "filming":
        return FILMING_STALE_SECONDS
    return ANSWER_STALE_SECONDS


def answer_alert(state: Mapping) -> dict | None:
    if state["phase"] == "made" and MADE_IS_QUIET:
        return None
    if state["phase"] == "ready":
        return dict(READY_ALERT)
    if state["phase"] == "failed":
        # `requestView`'s failed line on the phone, word for word.
        words = state.get("failure")
        body = f"It did not work: {words}." if words else "It did not work on your Mac."
        return {"title": FAILED_TITLE, "body": body}
    return None


def update_payload(state: Mapping, *, now: float, alert: Mapping | None = None) -> dict:
    at = js_round(now)
    aps: dict = {
        "timestamp": at,
        "event": KIND_UPDATE,
        "content-state": dict(state),
        "stale-date": at + stale_after(state["phase"]),
        "relevance-score": RELEVANCE,
    }
    if alert is not None:
        aps["alert"] = dict(alert)
    return {"aps": aps}


def end_payload(state: Mapping | None, *, now: float) -> dict:
    """An `end` that takes the card down now, from the Lock Screen too (`dismissal-date` now)."""
    at = js_round(now)
    aps: dict = {"timestamp": at, "event": KIND_END, "dismissal-date": at}
    if state is not None:
        aps["content-state"] = dict(state)
    return {"aps": aps}


# ------------------------------------------------------------------------------ the decision


@dataclasses.dataclass(frozen=True)
class Target:
    id: str
    user_id: str
    token: str
    environment: str


@dataclasses.dataclass(frozen=True)
class DemoPush:
    target: Target
    request_id: str
    event: str
    payload: dict
    priority: int
    #: `apns-expiration`: the card's stale date. A move APNs could not deliver before the card
    #: would have gone stale is not worth delivering after.
    expiration: int

    @property
    def alerts(self) -> bool:
        return "alert" in self.payload["aps"]


_REQUEST_COLUMNS = "id, project_key, status, refusal, created_at, claimed_at"


def _request(db, user_id: str, request_id: str):
    from sqlalchemy import text

    return db.execute(
        text(
            f"SELECT {_REQUEST_COLUMNS} FROM demo_requests "
            "WHERE id = CAST(:id AS uuid) AND user_id = CAST(:u AS uuid)"
        ),
        {"id": request_id, "u": user_id},
    ).first()


def _row(r) -> dict:
    return {
        "status": r.status,
        "refusal": r.refusal,
        "created_at": r.created_at,
        "claimed_at": r.claimed_at,
    }


def _kit_published_at(db, user_id: str, project_key: str):
    """When the project's shown kit was published: the newest `ship_kits` row, which is exactly
    what `GET /v1/projects/{key}/kit` answers as `published_at`. None for no kit."""
    from sqlalchemy import text

    return db.execute(
        text(
            "SELECT max(created_at) FROM ship_kits "
            "WHERE user_id = CAST(:u AS uuid) AND project_key = :k"
        ),
        {"u": user_id, "k": project_key},
    ).scalar()


def _state(db, user_id: str, r, *, now: float) -> dict | None:
    """The card for a request row, asking `ship_kits` only when the answer depends on it."""
    kit = _kit_published_at(db, user_id, r.project_key) if r.status == "done" else None
    return content_state(_row(r), now=now, kit_published_at=kit)


def plan_updates(db, user_id: str, request_ids: Iterable[str], *, now: float) -> list[DemoPush]:
    """An update to every card of these requests that is behind where its request now is,
    RECORDED on the token row (`shown_phase`) in the caller's transaction."""
    from sqlalchemy import text

    ids = sorted({str(r) for r in request_ids})
    if not ids:
        return []
    tokens = db.execute(
        text(
            """
            SELECT id, request_id, token, environment, shown_phase FROM demo_activity_tokens
            WHERE user_id = :u AND request_id = ANY(CAST(:ids AS uuid[]))
            ORDER BY created_at, id
            FOR UPDATE
            """
        ),
        {"u": user_id, "ids": ids},
    ).all()
    by_request: dict[str, list] = {}
    for t in tokens:
        by_request.setdefault(str(t.request_id), []).append(t)

    pushes: list[DemoPush] = []
    for request_id, toks in by_request.items():
        r = _request(db, user_id, request_id)
        if r is None:
            continue
        state = _state(db, user_id, r, now=now)
        if state is None:
            continue
        phase = state["phase"]
        alert = answer_alert(state)
        for t in toks:
            if RANK[phase] <= RANK.get(t.shown_phase or "", -1):
                continue
            payload = update_payload(state, now=now, alert=alert)
            pushes.append(
                DemoPush(
                    target=Target(str(t.id), user_id, t.token, t.environment),
                    request_id=request_id,
                    event=KIND_UPDATE,
                    payload=payload,
                    priority=PRIORITY_ALERT if alert else PRIORITY_QUIET,
                    expiration=payload["aps"]["stale-date"],
                )
            )
            db.execute(
                text(
                    "UPDATE demo_activity_tokens SET shown_phase = :p, last_pushed_at = now() "
                    "WHERE id = :i"
                ),
                {"p": phase, "i": str(t.id)},
            )
    return pushes


def _ends(db, user_id: str, rows, *, now: float) -> list[DemoPush]:
    """An end to each token row, and the rows forgotten: a push to an ended card is dropped by
    ActivityKit, and nothing should try."""
    from sqlalchemy import text

    pushes: list[DemoPush] = []
    for t in rows:
        r = _request(db, user_id, str(t.request_id))
        state = _state(db, user_id, r, now=now) if r is not None else None
        pushes.append(
            DemoPush(
                target=Target(str(t.id), user_id, t.token, t.environment),
                request_id=str(t.request_id),
                event=KIND_END,
                payload=end_payload(state, now=now),
                priority=PRIORITY_QUIET,
                expiration=js_round(now) + END_EXPIRATION_SECONDS,
            )
        )
    if rows:
        db.execute(
            text("DELETE FROM demo_activity_tokens WHERE id = ANY(CAST(:ids AS uuid[]))"),
            {"ids": [str(t.id) for t in rows]},
        )
    return pushes


def plan_ends(db, user_id: str, *, now: float) -> list[DemoPush]:
    """An `end` to every card whose answer has been up for ANSWER_HOLD_SECONDS. Made counts: a
    publish moves it to ready and restarts the hold (`last_pushed_at`), and one that never comes
    should not keep "made" in the island all day."""
    from sqlalchemy import text

    rows = db.execute(
        text(
            """
            SELECT id, request_id, token, environment FROM demo_activity_tokens
            WHERE user_id = :u AND shown_phase IN ('made', 'ready', 'failed')
              AND last_pushed_at < now() - make_interval(secs => :hold)
            ORDER BY created_at, id
            FOR UPDATE
            """
        ),
        {"u": user_id, "hold": ANSWER_HOLD_SECONDS},
    ).all()
    return _ends(db, user_id, rows, now=now)


def plan_cancel(db, user_id: str, request_id: str, *, now: float) -> list[DemoPush]:
    """An `end` now to every card of a request that was taken back."""
    from sqlalchemy import text

    rows = db.execute(
        text(
            """
            SELECT id, request_id, token, environment FROM demo_activity_tokens
            WHERE user_id = :u AND request_id = CAST(:r AS uuid)
            ORDER BY created_at, id
            FOR UPDATE
            """
        ),
        {"u": user_id, "r": request_id},
    ).all()
    return _ends(db, user_id, rows, now=now)


# ------------------------------------------------------------------------------ the send


def send(pushes: Sequence[DemoPush]) -> list[DemoPush]:
    """Deliver after commit, best effort; the ones APNs took. `drop_push.send`'s rule for this
    table: through the one APNs POST (`routes/push._deliver`, whose http2 client the tests
    replace) with the liveactivity headers; a token both hosts refuse is forgotten, and a token
    that answered on the other host is moved there."""
    if not pushes:
        return []
    from sqlalchemy import text

    from .db import db_session
    from .routes import push as transport
    from .settings import settings

    if not settings().apns_private_key:
        log.info(
            "demo island: APNs is not configured, so %d push(es) for request %s were not sent",
            len(pushes),
            pushes[0].request_id,
        )
        return []
    delivered: list[DemoPush] = []
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
                            text("UPDATE demo_activity_tokens SET environment = :e WHERE id = :i"),
                            {"e": d.environment, "i": p.target.id},
                        )
            elif d.gone:
                with db_session(viewer_id=p.target.user_id) as db:
                    db.execute(
                        text("DELETE FROM demo_activity_tokens WHERE id = :i"), {"i": p.target.id}
                    )
        except Exception:
            log.exception(
                "demo island %s push for request %s failed; not retried", p.event, p.request_id
            )
    return delivered


# ------------------------------------------------------------------------------ the hooks


def after_transition(
    user_id: str, request_ids: Iterable[str], *, now: float | None = None
) -> list[DemoPush]:
    """A route that may have moved these requests committed: the Mac finishing one, and a card's
    token arriving (it may have missed a move while it had none)."""
    import time

    from .db import db_session

    now = time.time() if now is None else now
    try:
        with db_session(viewer_id=user_id) as db:
            pushes = plan_updates(db, user_id, request_ids, now=now)
    except Exception:
        log.exception("demo island: deciding updates failed")
        return []
    return send(pushes)


def after_claim(
    user_id: str, claimed: Iterable[str], *, now: float | None = None
) -> list[DemoPush]:
    """The Mac's poll committed: the requests it took are being filmed, and any answer that has
    been in the island for its hold comes down. The poll is the one clock the server has."""
    import time

    from .db import db_session

    now = time.time() if now is None else now
    sent = after_transition(user_id, claimed, now=now)
    try:
        with db_session(viewer_id=user_id) as db:
            ends = plan_ends(db, user_id, now=now)
    except Exception:
        log.exception("demo island: deciding ends failed")
        return sent
    return sent + send(ends)


def after_publish(user_id: str, project_key: str, *, now: float | None = None) -> list[DemoPush]:
    """A kit's document arrived (the kit publish route committed): every card of this project's
    requests that is behind where its request now is moves, which is a card at `made` going to
    `ready` when this kit came at or after the Mac took its request. A card still filming (the
    worker publishes before it finishes) is not moved: its request is still claimed."""
    import time

    from sqlalchemy import text

    from .db import db_session

    now = time.time() if now is None else now
    try:
        with db_session(viewer_id=user_id) as db:
            ids = [
                str(r.request_id)
                for r in db.execute(
                    text(
                        "SELECT DISTINCT t.request_id FROM demo_activity_tokens t "
                        "JOIN demo_requests r ON r.id = t.request_id "
                        "WHERE t.user_id = CAST(:u AS uuid) AND r.project_key = :k"
                    ),
                    {"u": user_id, "k": project_key},
                ).all()
            ]
            pushes = plan_updates(db, user_id, ids, now=now)
    except Exception:
        log.exception("demo island: deciding the publish update for a project failed")
        return []
    return send(pushes)


def after_cancel(user_id: str, request_id: str, *, now: float | None = None) -> list[DemoPush]:
    """A request was taken back: its cards come down now, and nothing will push to them again."""
    import time

    from .db import db_session

    now = time.time() if now is None else now
    try:
        with db_session(viewer_id=user_id) as db:
            pushes = plan_cancel(db, user_id, request_id, now=now)
    except Exception:
        log.exception("demo island: deciding the end for request %s failed", request_id)
        return []
    return send(pushes)
