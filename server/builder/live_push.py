"""ActivityKit pushes for a running session's Live Activity (docs/overnight-integration.md 3.6).

Two halves, kept apart on purpose.

THE CARD (`content_state` and the helpers above it) is pure: no database, no FastAPI, no
clock, and nothing outside the standard library and `analysis/` (every other import is
inside the function that needs it), so `scripts/gen_live_fixtures.py` can import it on the
bare Python CI's `make gen` runs on, with no server behind it. It is the
Python half of `mobile/src/live/surface.ts toState` for a session the server holds a live
state for, and it returns exactly the keys of `BuilderSessionAttributes.ContentState`
(mobile/modules/builder-live/ios/BuilderSessionAttributes.swift), which `test_live_push.py`
reads out of the Swift file. Python is the reference (the integration doc, section 0, rule
4): `spec/fixtures/live/content_state.json` holds the phone's half to the same values, as
strip conformance holds the Mac's. Every sentence is `analysis.live.sentence` over the WIRE
state, never `names=True` and never `session_live.names`, so no file name can reach a Lock
Screen, whatever the account's File names switch says.

THE DECISION (`plan`) runs inside the upload transaction, per activity token of every
session whose live row was written or deleted, and `send_after_commit` sends after the
commit, exactly as completion banners go through `notify.plan` and `routes/sync.send_pending`:
a push failure can never roll back an upload, and a crash between commit and send loses a
push rather than doubling one. The rules, each tested:

  * A push goes out only when the card's phase or trajectory moves (`last_phase`,
    `last_trajectory` on the token row). Everything else the card shows is drawn from dates
    it already holds (`sinceEpoch`, `etaEpoch`), which is why no duration is ever in its
    sentence.
  * Priority 10 with an alert only on a move INTO needsYou, and only while that entry is
    news (the backfill horizon, `notify.is_news`); every other push is priority 5.
  * NEVER BOTH: a session with an activity is told it needs you by the activity's alert; the
    ordinary needs you banner (`notify.KIND_NEEDS_YOU`) is only for a session with none,
    once per entry (`session_live.alerted_phase`), and one entry is one alert across both.
  * Final, or a turn the engine called done (finished, not looked at yet): `event: "end"`
    with the finished card (`toState` of the row), dismissed at once while another session
    still runs and after DISMISS_AFTER_SECONDS otherwise, then the token row is forgotten.
    The phone's planner ends a card on the same phase (`surface.planSync`), so a card the
    server moves and one the phone moves finish the same way.
  * Push to start tokens are stored and never sent in this pass: a start needs an alert, and
    a card for every running session is the noise mission control exists to remove.
"""

from __future__ import annotations

import copy
import dataclasses
import datetime as dt
import logging
import math
import pathlib
import re
import sys
import time
from collections.abc import Iterable, Mapping, Sequence

log = logging.getLogger("builder.live_push")

_ROOT = pathlib.Path(__file__).resolve().parents[2]

# ------------------------------------------------------------------------------ constants
# Each restates a constant of `mobile/src/live/surface.ts` (or the Swift struct), because
# the two halves of one card must agree on it; `test_live_push.py` reads every one of them
# out of the TypeScript source, so an edit to either side alone is a failing test.

#: `surface.ts SENTENCE_MAX`: ActivityKit shows the sentence on two lines, under 90.
SENTENCE_MAX = 89
#: `surface.ts STALE_SECONDS` (= `format.ts TEMPO_STALE_SECONDS`): past this the card says
#: "Not updating" rather than showing old work as current.
STALE_SECONDS = 900
#: `surface.ts DISMISS_AFTER_SECONDS`: the HIG's 15 to 30 minutes for an ended activity.
DISMISS_AFTER_SECONDS = 1200
#: `surface.ts RELEVANCE_*`: needs you wins the Dynamic Island; a finished card sorts last.
RELEVANCE_NEEDS_YOU = 100
RELEVANCE_DEFAULT = 50
RELEVANCE_DONE = 0
#: `surface.ts PRIVATE_REPO` and `REPO_MAX`: the repo a card names for a private session.
PRIVATE_REPO = "private repo"
REPO_MAX = 60
#: `surface.ts BACKGROUND_REASON`: the agent waits on its own background job, not on you.
BACKGROUND_REASON = "waiting_on_background"
#: `surface.ts PAYLOAD_LIMIT_BYTES`, which is also APNs' own limit on a `liveactivity` push.
PAYLOAD_LIMIT_BYTES = 4096

#: `apns-priority`. 10 lights the screen and spends the activity's update budget, so it is
#: kept for the one moment that deserves it (the orchestrator's rule, section 3.6).
PRIORITY_NEEDS_YOU = 10
PRIORITY_TICK = 5

#: How long APNs may hold an `end` for a phone that is offline. Apple's documented ceiling
#: on a running Live Activity (eight hours, then the system ends it), not a measurement: an
#: end that arrives late still takes down a card that would otherwise claim to run.
END_EXPIRATION_SECONDS = 8 * 3600

#: `BuilderSessionAttributes.ContentState`, in declaration order. An APNs push must carry
#: exactly these keys, and `test_live_push.py` holds this tuple to the Swift file.
CONTENT_STATE_KEYS = (
    "phase",
    "sentence",
    "progress",
    "filesChanged",
    "etaEpoch",
    "sinceEpoch",
    "endedEpoch",
    "trajectory",
    "creature",
    "linesAdded",
    "linesRemoved",
    "commits",
    "runningCount",
    "updatedEpoch",
)

#: The live spec's `phase`, `trajectory` and `creature` enums (spec/live.v1.json, which
#: `test_contract.py` pins to the Swift bridge types). Restated rather than imported from
#: the generated `live_spec.py`, because that imports pydantic and this module must import
#: with the standard library alone: CI's `make gen` runs `scripts/gen_live_fixtures.py` on a
#: bare Python. `test_live_push.py` holds each tuple to the generated table, both ways. A
#: creature outside the list is drawn as Bit, as `normalizeCreature` does.
PHASES = ("working", "needsYou", "done", "stalled")
TRAJECTORIES = ("converging", "circling", "lost", "none")
CREATURES = ("crab", "octopus", "dog", "cat", "owl", "fox", "whale", "bee", "bit")

#: `LivePush.kind`: an ActivityKit update or end to one token, or the ordinary banner.
KIND_ACTIVITY = "activity"
KIND_BANNER = "banner"


class NoLiveState(ValueError):
    """A running session with no live state has no card the server may push. The phone draws
    one from its own presence line (`format.livePresenceLine`); the server never does."""


# ------------------------------------------------------------------------------ the engine


def _engine():
    """`analysis.live`: every sentence on a card is its `sentence()`, never a second copy.
    Imported lazily and from the repository root, as `hook_ingest` and `builder_profile` do,
    so this module still imports on a server image without `analysis/`."""
    try:
        from analysis import live
    except ImportError:
        root = str(_ROOT)
        if root not in sys.path:
            sys.path.insert(0, root)
        from analysis import live
    return live


def engine_available() -> bool:
    try:
        _engine()
    except ImportError:  # pragma: no cover - deployment shape, not logic
        return False
    return True


def render(state: Mapping) -> str:
    """The engine's one sentence for a wire state, `names=False` always."""
    return _engine().sentence(state, names=False)


# ------------------------------------------------------------------------------ numbers


def _num(x) -> bool:
    """`surface.ts isNum`: a finite number, and a bool is not one."""
    return isinstance(x, int | float) and not isinstance(x, bool) and math.isfinite(x)


def js_round(x: float) -> int:
    """JavaScript's `Math.round`: a half rounds UP (toward +infinity), where Python's `round`
    goes to the even neighbour. The card's numbers must be the phone's to the second, and
    `floor(x + 0.5)` is not it either (0.49999999999999994 + 0.5 is exactly 1.0)."""
    f = math.floor(x)
    return int(f + 1 if x - f >= 0.5 else f)


def _count(x) -> int | None:
    """`surface.ts count`: a measured count, or None for "not known" (never a 0)."""
    return max(0, js_round(x)) if _num(x) else None


def _minute_floor(seconds: float) -> int:
    """Down to the whole minute: "since 9:37" names the minute the condition began in."""
    return math.floor(seconds / 60) * 60


def _epoch(v) -> float | None:
    """Unix seconds from a datetime, an ISO string or a number; None when there is none."""
    if v is None:
        return None
    if isinstance(v, dt.datetime):
        return (v if v.tzinfo else v.replace(tzinfo=dt.UTC)).timestamp()
    if isinstance(v, str):
        try:
            d = dt.datetime.fromisoformat(v.replace("Z", "+00:00"))
        except ValueError:
            return None
        return (d if d.tzinfo else d.replace(tzinfo=dt.UTC)).timestamp()
    return float(v) if _num(v) else None


def _get(m, *keys):
    """`a?.b?.c`: None as soon as a level is missing or is not a mapping."""
    for k in keys:
        if not isinstance(m, Mapping):
            return None
        m = m.get(k)
    return m


# ------------------------------------------------------------------------------ the card


def waits_on_background(live: Mapping | None) -> bool:
    """`surface.waitsOnBackground`: the turn was handed back while a job the session started
    is still out. The agent is the one waiting, so this is never needs you."""
    return (
        _get(live, "verdict", "basis") == _engine().BACKGROUND_BASIS
        or _get(live, "needs_you", "reason") == BACKGROUND_REASON
    )


def _quiet_seconds(row: Mapping, now: float) -> int | None:
    """Seconds since the last record (`ended_at` on a live row)."""
    last = _epoch(row.get("ended_at"))
    return None if last is None else max(0, js_round(now - last))


def phase_of(row: Mapping, live: Mapping | None, now: float) -> str:
    """`surface.phaseOf`: working, needsYou, done or stalled. The engine decides when it
    spoke; without it a final row is done and a quiet live row is stalled.

    Done comes BEFORE the wait. The engine only calls a turn done while the activity is the
    wait that followed it (`waiting_on_you`), so checking the wait first read every finished
    turn as needs you: an alert and the raised hand for a session that had finished and was
    only waiting to be looked at, while mission control's tile said finished (the owner,
    2026-09-13: FINISHED, not needs you). One rule on both halves, pinned by the fixture's
    `done_after_commit` case."""
    if row.get("state") == "final":
        return "done"
    verdict = _get(live, "verdict", "state")
    kind = _get(live, "activity", "kind")
    if verdict == "done" and not waits_on_background(live):
        return "done"
    if (verdict == "waiting" or kind == "waiting_on_you") and not waits_on_background(live):
        return "needsYou"
    if kind == "idle":
        return "stalled"
    if live is not None:
        return "working"
    quiet = _quiet_seconds(row, now)
    return "stalled" if quiet is not None and quiet > STALE_SECONDS else "working"


def trajectory_of(live: Mapping | None) -> str:
    """`surface.trajectoryOf`: the verdict when it is one a caption can say, else none."""
    v = _get(live, "verdict", "state")
    return v if v in ("converging", "circling", "lost") else "none"


def _done_sentence() -> str:
    """A finished card's words when the engine's own done verdict is not there: "Finished",
    its counts left to the line under it (`surface.doneSentence`)."""
    return render({"verdict": {"state": "done", "evidence": {}}})


def _timeless(live: Mapping) -> dict:
    """The same state with every duration the sentence would speak set to zero (`since_s`,
    `stuck_s`): a Lock Screen is redrawn only when a push arrives, so "for four minutes"
    would be wrong a minute later. The card says when it began instead (`sinceEpoch`)."""
    out = copy.deepcopy(dict(live))
    if isinstance(out.get("activity"), dict):
        out["activity"]["since_s"] = 0
    v = out.get("verdict")
    if isinstance(v, dict) and isinstance(v.get("evidence"), dict):
        v["evidence"]["stuck_s"] = 0
    return out


def _speaks(live: Mapping | None, phase: str) -> bool:
    """Whether the engine's state is the one to render: not when a finished row carries a
    state whose verdict was not `done` (it describes a moment before the end)."""
    return live is not None and not (phase == "done" and _get(live, "verdict", "state") != "done")


def sentence_of(row: Mapping, live: Mapping | None, phase: str, now: float) -> str:
    """`surface.sentenceOf`: the engine's sentence as it stands, durations and all, for an
    alert, which carries the moment it arrived. Raises `NoLiveState` where the phone would
    fall back to its presence line: the server never pushes a card it did not compute."""
    if _speaks(live, phase):
        return render(live)
    if phase == "done":
        return _done_sentence()
    if phase == "stalled":
        q = _quiet_seconds(row, now)
        return render({"activity": {"kind": "idle", "since_s": q if q is not None else 0}})
    raise NoLiveState("a running session with no live state has no card to push")


def surface_sentence_of(row: Mapping, live: Mapping | None, phase: str, now: float) -> str:
    """`surface.surfaceSentenceOf`: the engine's words with no duration in them."""
    if _speaks(live, phase):
        return render(_timeless(live))
    if phase == "stalled":
        return render({"activity": {"kind": "idle", "since_s": 0}})
    return sentence_of(row, live, phase, now)


def clamp_sentence(text: str) -> str:
    """`surface.clampSentence`: whitespace collapsed, cut at a word under 90 characters."""
    t = re.sub(r"\s+", " ", text).strip()
    if len(t) <= SENTENCE_MAX:
        return t
    cut = t[: SENTENCE_MAX - 1]
    space = cut.rfind(" ")
    head = cut[:space] if space > 40 else cut
    return re.sub(r"[\s,.;:]+$", "", head) + "…"


def progress_of(live: Mapping | None) -> float:
    """`surface.progressOf`: elapsed over typical, capped at 9.99; -1 when the engine
    refused an ETA, which the ring draws as a dotted track, never a guessed arc."""
    typical = _get(live, "eta", "typical_s")
    elapsed = _get(live, "eta", "elapsed_s")
    if not _num(typical) or typical <= 0 or not _num(elapsed):
        return -1.0
    return js_round(min(elapsed / typical, 9.99) * 1000) / 1000


def anchor_of(row: Mapping, live: Mapping | None, now: float) -> float:
    """The moment the engine's numbers were taken: `live.computed_at` (the integration doc,
    3.5 and 2.5). The session row's `updated_at` does not move when a heartbeat re-cuts an
    unchanged transcript (routes/sync.py skips the row on an unchanged content hash), so
    anchoring on it ages every `remaining_s` and `since_s` by however long the transcript
    has been quiet. `updated_at`, then `now`, only when the state names no time."""
    for v in (_get(live, "computed_at"), row.get("updated_at")):
        e = _epoch(v)
        if e is not None:
            return e
    return now


def eta_epoch_of(row: Mapping, live: Mapping | None, now: float) -> int | None:
    """`surface.etaEpochOf`: when a typical run like this one ends, to the minute, or None
    when the engine refused an ETA."""
    remaining = _get(live, "eta", "remaining_s")
    if not _num(remaining):
        return None
    return js_round((anchor_of(row, live, now) + max(0, remaining)) / 60) * 60


def since_epoch_of(row: Mapping, live: Mapping | None, phase: str, now: float) -> int | None:
    """`surface.sinceEpochOf`: when the condition the card names began (needs you, no new
    output, the same command failing for a minute or more, a turn the engine called done
    finishing), down to the minute, or None."""
    base = anchor_of(row, live, now)
    if phase in ("needsYou", "stalled", "done"):
        since = _get(live, "activity", "since_s")
        if _num(since):
            return _minute_floor(base - max(0, since))
        if phase == "stalled" and live is None:
            last = _epoch(row.get("ended_at"))
            return None if last is None else _minute_floor(last)
        return None
    if (
        phase == "working"
        and _get(live, "verdict", "state") == "circling"
        and _get(live, "verdict", "basis") == "consecutive_failures"
    ):
        stuck = _get(live, "verdict", "evidence", "stuck_s")
        if _num(stuck) and stuck >= 60:
            return _minute_floor(base - stuck)
    return None


def files_changed_of(live: Mapping | None) -> int:
    """`surface.filesChangedOf`: the engine's map rows with an edit (a file it only read is
    not one), or -1 when nothing counted them.

    Also -1 when the map was CUT (`files_total` above the rows sent): the slim list body
    keeps only the one or two rows the sentence names, and a count over those is a
    plausible wrong number ("1 file changed" of fourteen). Absent, not a lower bound."""
    m = _get(live, "map")
    rows = m.get("files") if isinstance(m, Mapping) else None
    if not isinstance(rows, list) or any(not _num(_get(r, "edits")) for r in rows):
        return -1
    total = m.get("files_total")
    if _num(total) and total > len(rows):
        return -1
    return sum(1 for r in rows if r["edits"] > 0)


def normalize_creature(creature: str | None) -> str:
    """`surface.normalizeCreature`: one of the spec's creatures, else Bit."""
    return creature if creature in CREATURES else "bit"


def content_state(
    row: Mapping,
    stats: Mapping | None,
    live: Mapping | None,
    *,
    creature: str | None,
    running_count: int,
    now: float,
) -> dict:
    """The Live Activity's ContentState for one session: `surface.toState`, in Python.

    `row` is the session as the phone's `SessionDetail` has it (`state`, `ended_at`,
    `updated_at`); `stats` its `lines_added_agent`, `lines_removed_agent` and `commit_count`
    (None, or a missing key, is "not known" and stays None); `live` the stored WIRE state
    (spec/live.v1.json) or None for a final row; `running_count` the sessions running with
    no card of their own; `now` Unix seconds. Pure. Raises `NoLiveState` for a running row
    without a state, where the phone would draw its presence line instead."""
    phase = phase_of(row, live, now)
    stats = stats or {}
    ended = _epoch(row.get("ended_at")) if phase == "done" and row.get("state") == "final" else None
    return {
        "phase": phase,
        "sentence": clamp_sentence(surface_sentence_of(row, live, phase, now)),
        "progress": progress_of(live),
        "filesChanged": files_changed_of(live),
        "etaEpoch": None if phase == "done" else eta_epoch_of(row, live, now),
        "sinceEpoch": since_epoch_of(row, live, phase, now),
        "endedEpoch": None if ended is None else js_round(ended),
        "trajectory": trajectory_of(live),
        "creature": normalize_creature(creature),
        "linesAdded": _count(stats.get("lines_added_agent")),
        "linesRemoved": _count(stats.get("lines_removed_agent")),
        "commits": _count(stats.get("commit_count")),
        "runningCount": max(0, int(running_count)),
        "updatedEpoch": js_round(now),
    }


def relevance_of(state: Mapping, live: Mapping | None) -> int:
    """`surface.relevanceOf`: 100 for needs you (it wins the Dynamic Island), 0 for a
    finished card, else the engine's needs you score capped at 99, else 50."""
    if state["phase"] == "needsYou":
        return RELEVANCE_NEEDS_YOU
    if state["phase"] == "done":
        return RELEVANCE_DONE
    score = _get(live, "needs_you", "score")
    if not _num(score):
        return RELEVANCE_DEFAULT
    return max(0, min(RELEVANCE_NEEDS_YOU - 1, js_round(score)))


def repo_of(row: Mapping) -> str:
    """`surface.toAttrs().repo`: the public repo name, else "private repo", cut to 60."""
    name = row.get("repo_name")
    return (name if name is not None else PRIVATE_REPO)[:REPO_MAX]


def alert_for(row: Mapping, spoken: str) -> dict:
    """`surface.alertFor`: "{repo} needs you" over the engine's sentence as it stands. The
    sound is the one the phone's own activity alert plays (`AlertConfiguration(sound:
    .default)` in BuilderLiveModule.swift)."""
    return {"title": f"{repo_of(row)} needs you", "body": spoken, "sound": "default"}


def update_payload(state: Mapping, *, now: float, relevance: int, alert: Mapping | None) -> dict:
    """An ActivityKit `update` push body. `stale-date` is when the card starts saying "Not
    updating"; `timestamp` lets the system drop an update older than one it already has."""
    at = js_round(now)
    aps: dict = {
        "timestamp": at,
        "event": "update",
        "content-state": dict(state),
        "stale-date": at + STALE_SECONDS,
        "relevance-score": relevance,
    }
    if alert is not None:
        aps["alert"] = dict(alert)
    return {"aps": aps}


def end_payload(state: Mapping, *, now: float, dismissal_date: int) -> dict:
    """An ActivityKit `end` push body: the finished card, and when the system takes it down."""
    return {
        "aps": {
            "timestamp": js_round(now),
            "event": "end",
            "content-state": dict(state),
            "dismissal-date": int(dismissal_date),
            "relevance-score": RELEVANCE_DONE,
        }
    }


# ------------------------------------------------------------------------------ the decision


@dataclasses.dataclass(frozen=True)
class Target:
    """The token row a push goes to, with what the transport needs to repair or forget it."""

    id: str
    user_id: str
    token: str
    environment: str


@dataclasses.dataclass(frozen=True)
class LivePush:
    """One push, decided inside the upload transaction and sent after it.

    `kind` KIND_ACTIVITY: an ActivityKit `update` or `end` (`event`) to one token (`target`),
    `payload` its whole APNs body. KIND_BANNER: the ordinary needs you banner to every
    device the person registered, for a session with no activity (`title`, `body`)."""

    kind: str
    user_id: str
    session_id: str
    priority: int
    event: str | None = None
    target: Target | None = None
    payload: dict | None = None
    title: str | None = None
    body: str | None = None
    #: `apns-expiration`, Unix seconds: the stale date for an update, END_EXPIRATION_SECONDS
    #: for an end. None for a banner, which uses the alert route's own.
    expiration: int | None = None


def entry_age(live: Mapping | None, now: float) -> float | None:
    """How long ago the current condition began, at `now`: the state's `since_s` aged by
    the seconds since it was computed (3.5). None when the state does not say."""
    since = _get(live, "activity", "since_s")
    computed = _epoch(_get(live, "computed_at"))
    if not _num(since) or computed is None:
        return None
    return since + max(0.0, now - computed)


def seed(row: Mapping | None, live: Mapping | None, now: float) -> tuple[str | None, str | None]:
    """The (phase, trajectory) a newly registered token starts from: what the phone was
    showing when it started the activity, which it drew from this same state in the
    foreground. (None, None) when the server holds no state for the session yet, so the
    first state it computes is pushed."""
    if row is None or live is None:
        return None, None
    return phase_of(row, live, now), trajectory_of(live)


def plan(db, user_id: str, changed: Iterable[str], *, now: float | None = None) -> list[LivePush]:
    """The pushes owed for `changed` (server session ids whose live row moved), decided and
    RECORDED in the caller's transaction; `send_after_commit` sends them.

    Inside a savepoint: a failure here rolls back only this bookkeeping and pushes nothing,
    so an upload can never fail on a push (the rule `notify` and `send_pending` keep). It is
    logged, loudly, and the tests call the rules below it directly."""
    ids = sorted({str(s) for s in changed})
    if not ids:
        return []
    now = time.time() if now is None else float(now)
    try:
        with db.begin_nested():
            return _plan(db, str(user_id), ids, now)
    except Exception:
        log.exception("live activity plan failed for %d sessions; nothing pushed", len(ids))
        return []


_SESSIONS = """
    SELECT s.id, s.state, s.ended_at, s.updated_at, r.public_name AS repo_name,
           st.lines_added_agent, st.lines_removed_agent, st.commit_count,
           sl.body AS live_body, sl.alerted_phase
    FROM sessions s
    LEFT JOIN repos r ON r.id = s.repo_id
    LEFT JOIN session_stats st ON st.session_id = s.id
    LEFT JOIN session_live sl ON sl.session_id = s.id
    WHERE s.user_id = :u AND s.id = ANY(CAST(:ids AS uuid[]))
    ORDER BY s.id
"""


def _plan(db, user_id: str, ids: list[str], now: float) -> list[LivePush]:
    from sqlalchemy import text

    from . import notify

    # Every activity token of a changed session, and of any session that is final now: an
    # end is owed to a card whose session finished, whichever upload finished it. (A turn the
    # engine calls done is always a change of that session's own live row, so it is in `ids`.)
    tokens = db.execute(
        text(
            """
            SELECT t.id, t.session_id, t.token, t.environment, t.creature,
                   t.last_phase, t.last_trajectory
            FROM live_activity_tokens t JOIN sessions s ON s.id = t.session_id
            WHERE t.user_id = :u AND t.kind = 'activity'
              AND (t.session_id = ANY(CAST(:ids AS uuid[])) OR s.state = 'final')
            ORDER BY t.created_at, t.id
            FOR UPDATE OF t
            """
        ),
        {"u": user_id, "ids": ids},
    ).all()
    by_session: dict[str, list] = {}
    for t in tokens:
        by_session.setdefault(str(t.session_id), []).append(t)

    # What else runs: `surface.planSync`'s `running` (phase not done) and, of those, the
    # ones with no card of their own, which every card counts as "N more running".
    others = db.execute(
        text(
            """
            SELECT s.id, s.state, s.ended_at, sl.body AS live_body,
                   EXISTS (SELECT 1 FROM live_activity_tokens t
                           WHERE t.session_id = s.id AND t.kind = 'activity') AS carded
            FROM sessions s LEFT JOIN session_live sl ON sl.session_id = s.id
            WHERE s.user_id = :u AND s.state = 'live'
            """
        ),
        {"u": user_id},
    ).all()
    running = [
        o
        for o in others
        if phase_of({"state": o.state, "ended_at": o.ended_at}, o.live_body, now) != "done"
    ]
    uncarded = sum(1 for o in running if not o.carded)

    targets = sorted(set(ids) | set(by_session))
    rows = db.execute(text(_SESSIONS), {"u": user_id, "ids": targets}).all()
    pushes: list[LivePush] = []
    for r in rows:
        sid = str(r.id)
        toks = by_session.get(sid, [])
        row = {
            "state": r.state,
            "ended_at": r.ended_at,
            "updated_at": r.updated_at,
            "repo_name": r.repo_name,
        }
        stats = {
            "lines_added_agent": r.lines_added_agent,
            "lines_removed_agent": r.lines_removed_agent,
            "commit_count": r.commit_count,
        }
        live = None if r.state == "final" else r.live_body
        if r.state == "final" or (live is not None and phase_of(row, live, now) == "done"):
            # Finished: the row went final, or the engine called the turn done while it is
            # still live. Either way the card ends as finished, as the phone's planner ends it.
            if toks:
                pushes += _ends(
                    r, row, stats, live, toks, user_id, now, others_running=bool(running)
                )
                db.execute(
                    text("DELETE FROM live_activity_tokens WHERE id = ANY(CAST(:t AS uuid[]))"),
                    {"t": [str(t.id) for t in toks]},
                )
            if r.state != "final" and r.alerted_phase is not None:
                # Out of needs you: a later entry into it is news again.
                db.execute(
                    text("UPDATE session_live SET alerted_phase = NULL WHERE session_id = :s"),
                    {"s": sid},
                )
            continue
        if live is None:
            # Running, and no producer computed a state (the Mac app): nothing to say.
            continue
        phase, trajectory = phase_of(row, live, now), trajectory_of(live)
        entry = phase == "needsYou" and r.alerted_phase != "needsYou"
        age = entry_age(live, now)
        news = entry and age is not None and notify.is_news(age)
        alerted = r.alerted_phase
        if toks:
            spoken = clamp_sentence(sentence_of(row, live, phase, now))
            for t in toks:
                if (phase, trajectory) == (t.last_phase, t.last_trajectory):
                    continue
                alert = news and t.last_phase != "needsYou"
                state = content_state(
                    row, stats, live, creature=t.creature, running_count=uncarded, now=now
                )
                payload = update_payload(
                    state,
                    now=now,
                    relevance=relevance_of(state, live),
                    alert=alert_for(row, spoken) if alert else None,
                )
                pushes.append(
                    LivePush(
                        kind=KIND_ACTIVITY,
                        user_id=user_id,
                        session_id=sid,
                        priority=PRIORITY_NEEDS_YOU if alert else PRIORITY_TICK,
                        event="update",
                        target=Target(str(t.id), user_id, t.token, t.environment),
                        payload=payload,
                        expiration=payload["aps"]["stale-date"],
                    )
                )
                db.execute(
                    text(
                        "UPDATE live_activity_tokens SET last_phase = :p, last_trajectory = :t, "
                        "last_pushed_at = now() WHERE id = :i"
                    ),
                    {"p": phase, "t": trajectory, "i": str(t.id)},
                )
            if entry:
                # The card says it (with an alert when that is news): one entry, one alert,
                # so a banner never follows if the activity ends while it still needs you.
                alerted = "needsYou"
        elif entry:
            if news:
                title, body = notify.compose_needs_you(
                    r.repo_name, clamp_sentence(sentence_of(row, live, phase, now))
                )
                pushes.append(
                    LivePush(
                        kind=KIND_BANNER,
                        user_id=user_id,
                        session_id=sid,
                        priority=PRIORITY_NEEDS_YOU,
                        title=title,
                        body=body,
                    )
                )
            # Past the horizon it is RECORDED and not sent (backfill must be silent), so a
            # later upload of the same wait cannot promote it to a banner either.
            alerted = "needsYou"
        if phase != "needsYou":
            alerted = None  # out of needs you: the next entry is news again
        if alerted != r.alerted_phase:
            db.execute(
                text("UPDATE session_live SET alerted_phase = :p WHERE session_id = :s"),
                {"p": alerted, "s": sid},
            )
    return pushes


def _ends(
    r, row, stats, live, toks, user_id: str, now: float, *, others_running: bool
) -> list[LivePush]:
    """The `end` for every card of a session that finished: its row's finished card (a final
    row's, or a live row's whose turn the engine called done, with that state's sentence),
    taken down at once while another session runs (so it never sits on top of a running one)
    and after DISMISS_AFTER_SECONDS otherwise, exactly as `surface.endOptions` decides it."""
    at = js_round(now)
    dismissal = at if others_running else at + DISMISS_AFTER_SECONDS
    out = []
    for t in toks:
        state = content_state(row, stats, live, creature=t.creature, running_count=0, now=now)
        out.append(
            LivePush(
                kind=KIND_ACTIVITY,
                user_id=user_id,
                session_id=str(r.id),
                priority=PRIORITY_TICK,
                event="end",
                target=Target(str(t.id), user_id, t.token, t.environment),
                payload=end_payload(state, now=now, dismissal_date=dismissal),
                expiration=at + END_EXPIRATION_SECONDS,
            )
        )
    return out


def send_after_commit(pushes: Sequence[LivePush]) -> None:
    """Send what `plan` decided, after commit, best effort: one failure never stops the
    rest, and nothing here can reach the upload that decided them. Through the transport's
    module attributes so a test can replace them (`routes/push.py`)."""
    if not pushes:
        return
    from .routes import push as transport

    for p in pushes:
        try:
            if p.kind == KIND_ACTIVITY:
                transport.send_live_activity(
                    p.target, p.payload, priority=p.priority, expiration=p.expiration
                )
            else:
                transport.send_needs_you(p.user_id, p.title, p.body, p.session_id)
        except Exception:
            log.exception("live push %s for session %s failed; not retried", p.kind, p.session_id)
