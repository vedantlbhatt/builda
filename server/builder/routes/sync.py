import base64
import json
import logging
import math
from typing import NamedTuple

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from .. import live_push, live_store, notify
from ..auth import CurrentDevice, current_uploader
from ..contract import SessionUpload
from ..db import db_session
from ..strip import COLUMNS, non_idle_seconds
from . import push

router = APIRouter(prefix="/v1/sync", tags=["sync"])
log = logging.getLogger("builder.sync")

#: Mirrors `Tuning.notableMinActiveSec` (1200 s). The Mac's rule is
#: `unattended = presence_count == 0 && active_seconds >= notableMinActiveSec`; below the
#: floor nothing downstream reads the flag, so the server only pins it above it.
NOTABLE_MIN_ACTIVE_SEC = 1200

#: A live snapshot younger than this is exempt from the strip-vs-active tolerance. The
#: strip has 1024 columns over the session span, so at 300 s that is 0.3 s per column and
#: a session that has done one thing so far is mostly one bucket; the 25% tolerance is
#: calibrated for finished sessions and rejects nearly every honest first snapshot.
LIVE_STRIP_GRACE_SEC = 300

#: The prompt gate (`sanity_gate`) compares typed prompts to tool calls only from this many
#: calls up. MEASURED 2026-09-13 on `~/.builder-overnight/corpus` (158 counted sessions,
#: after capture bucketed every tool call, docs/overnight-integration.md 5.1): four sessions
#: had more typed prompts than tool calls, and all four are real short conversations read
#: against the raw JSONL (6 prompts to 2 calls, 5 to 2, 4 to 2, 2 to 1), which the gate
#: rejected as a broken prompt filter. The bug it exists for counts every tool result as a
#: prompt, so it lifts EVERY session with a typed prompt above its tool count: from 3 calls up
#: the gate still catches it on 110 of the corpus's 115 sessions with a typed prompt, so a
#: regressed client is as loud as before, and the sittings under 3 calls (6 of 158) are the
#: ones whose prompts could honestly outnumber their calls. UNMEASURED JUDGEMENT CALL beyond
#: that: a broken client's 1 and 2 call sessions pass with a prompt count off by at most the
#: calls they made.
PROMPT_GATE_MIN_TOOL_CALLS = 3


class BatchRequest(BaseModel):
    sessions: list[SessionUpload]


class BatchResponse(BaseModel):
    accepted: int
    unchanged: int
    rejected: list[dict]


def sanity_gate(p: SessionUpload) -> str | None:
    """Reject payloads that are internally inconsistent.

    Every one of these catches a specific client bug that would otherwise arrive as
    plausible data and be believed forever. The server cannot recompute these numbers —
    it never sees a transcript — so consistency between them is the only leverage it has.
    """
    span = (p.ended_at - p.started_at).total_seconds()

    # Active time cannot exceed elapsed. The client extends `ended_at` by the trailing
    # gap credit precisely so this holds; a violation means its arithmetic regressed.
    if p.active_seconds > span + 1:
        return f"active_seconds {p.active_seconds} exceeds span {span:.0f}"

    # `still_running` IS the live upload (docs/session-boundaries.md). A final session
    # that says it is still running, or a live one that claims an end, is a client that
    # set one of the two fields and forgot the other.
    if (p.state == "live") != (p.end_reason == "still_running"):
        return f"state={p.state!r} does not agree with end_reason={p.end_reason!r}"

    # The two clocks must sum to the headline. They are computed from the same gap walk
    # on the client, so anything beyond a rounding second means one of them was taken
    # from a different event set than the other.
    split = p.attended_seconds + p.autonomous_seconds
    if abs(split - p.active_seconds) > 1:
        return (
            f"attended_seconds {p.attended_seconds} + autonomous_seconds "
            f"{p.autonomous_seconds} = {split}, but active_seconds is {p.active_seconds}"
        )

    # `unattended` is derived, not observed, and the server can check the derivation.
    # Zero presence over a notable span with unattended=false is the 5h40m robot about to
    # become a personal record again; unattended=true with a presence signal is a real
    # sitting being denied its notification.
    if p.presence_count == 0 and p.active_seconds >= NOTABLE_MIN_ACTIVE_SEC and not p.unattended:
        return (
            f"presence_count is 0 over {p.active_seconds}s of active time but unattended is false"
        )
    if p.presence_count > 0 and p.unattended:
        return f"unattended is true with presence_count {p.presence_count}"

    # MEASURED ratio is roughly 16 tool calls per typed prompt. More prompts than tool
    # calls means the prompt filter broke — most likely counting every `type: "user"`
    # record, which inflates by ~13x. That bug counts every tool RESULT as a prompt, so it
    # puts the prompt count above the tool count on every session with a typed prompt in it;
    # the gate reads that only from PROMPT_GATE_MIN_TOOL_CALLS up, where a real sitting almost
    # never has more prompts than calls (see the constant for the measurement).
    total_tools = sum(p.tool_calls.values()) if p.tool_calls else 0
    if p.human_prompt_count > total_tools >= PROMPT_GATE_MIN_TOOL_CALLS:
        return f"human_prompt_count {p.human_prompt_count} exceeds tool_calls {total_tools}"

    # The 1.878x content-block overcount, arriving without a deduplication basis.
    if p.token_dedupe == "none" and p.tokens_reported:
        return "tokens reported with token_dedupe='none'"

    # Tokens must be absent rather than zero when the harness does not report them.
    # Cursor writes {0,0} locally; a stored 0 would read as "used no tokens".
    if not p.tokens_reported and p.tokens is not None:
        return "tokens present but tokens_reported is false"

    # The strip must agree with the session it describes. A strip built from a different
    # event set is the single hardest client bug to notice by eye.
    try:
        cols = base64.b64decode(p.strip_columns, validate=True)
    except Exception:
        return "strip_columns is not valid base64"
    if len(cols) != COLUMNS:
        return f"strip_columns is {len(cols)} bytes, expected {COLUMNS}"
    if any(b >> 4 for b in cols):
        return "strip_columns has non-zero reserved bits"

    strip_active = non_idle_seconds(cols, span)
    young_live = p.state == "live" and p.active_seconds < LIVE_STRIP_GRACE_SEC
    if (
        not young_live
        and p.active_seconds > 0
        and abs(strip_active - p.active_seconds) > 0.25 * p.active_seconds
    ):
        return (
            f"strip disagrees with active_seconds: strip says {strip_active:.0f}, "
            f"payload says {p.active_seconds}"
        )

    # Titles and repo names are public-repo-only fields. Their mere presence on an
    # anonymous session means the client's mode allowlist was not applied.
    if p.repo_name is None and p.title is not None:
        return "title present without repo_name (anonymous sessions carry neither)"

    # v4 `live` describes a RUNNING session (docs/overnight-integration.md 2.3). On a final
    # payload it is a client that forgot to drop it, and storing it would bring back the
    # row the final exists to delete: a finished session reading "Running your tests".
    if p.live is not None and p.state != "live":
        return f"live present on a {p.state} payload (a live state exists only while it runs)"
    # Names label the files of a live map; without the map they label nothing the phone
    # can show, and they are still file names on the server.
    if p.live_names is not None and p.live is None:
        return "live_names present without live"
    # A basename, never a path: the spec caps the length (120) and this is the rest of
    # the promise. The name itself is not echoed back; a rejection reason is logged.
    if p.live_names is not None and any(
        sep in n.name for n in p.live_names.files for sep in ("/", "\\", "\x00")
    ):
        return "live_names carries a path separator or NUL (basenames only)"
    # A name labels a row of the live map (`analysis.live.wire_names` keeps only those). One
    # whose id is on no row labels nothing the phone can show and is still a file name
    # stored on the server, the same reason names without the map are refused. Neither id
    # nor name is echoed back.
    if p.live_names is not None and p.live is not None:
        mapped = {f.id for f in p.live.map.files} if p.live.map is not None else set()
        if any(n.id not in mapped for n in p.live_names.files):
            return "live_names names a file the live map does not carry"

    # A title is its verb and its object, or the reason there is none (v4 `title_ids.reason`,
    # FOUND IN THE ADVERSARIAL REVIEW 2026-09-13). A refusal that also names a verb still
    # renders a title on the phone, and half a title renders nothing without saying why:
    # either is a client that set one half and forgot the other.
    t = p.title_ids
    if t is not None:
        titled = t.verb is not None and t.object is not None
        bare = t.verb is None and t.object is None
        if not ((t.reason is None and titled) or (t.reason is not None and bare)):
            return "title_ids must carry a verb and an object, or a reason and neither"

    if p.call_tokens is not None:
        return call_tokens_gate(p.call_tokens, p.burn)

    return None


#: `call_tokens.points` holds at most this many points, the contract's `max_items` (pinned to it
#: by server/tests/test_contract.py): a session with more calls sums them, `per_point` to a point,
#: and `per_point` is then exactly ceil(calls / 240) (`analysis/calls.py` MAX_POINTS).
CALL_POINTS_MAX = 240

#: The cache lifetimes a call's writes can name: five minutes and an hour
#: (`analysis/calls.py` FIVE_MINUTES_SEC, ONE_HOUR_SEC; pinned by server/tests/test_contract.py).
CALL_LIFETIMES = (300, 3600)


def call_tokens_gate(c, burn=None) -> str | None:
    """`call_tokens` (0025) is a chart or the reason there is none, never both and never half.

    The phone labels every bar "calls a to b" from `per_point` and `calls`, and says "call N"
    of a rewrite, so a point count that disagrees with the calls it claims to cover mislabels
    every bar of the chart, and a rewrite past the last call points at a bar that is not there.
    The server cannot recompute any of it (it never sees a transcript), so, as for the other
    blocks, the consistency of the numbers is the only check it has.

    FOUND IN REVIEW (2026-09-13), each accepted before: `too_few_calls` with 500 calls, a
    negative `away_seconds` or `written`, a rewrite with no cache lifetime or back sooner than
    the lifetime, `calls_needed` 0, and a dollar figure of Infinity, which passed this gate and
    then failed the jsonb insert as a 500 for the whole batch. And the points now have to add up
    to the tokens `burn` counts for the same window, in the same payload: both are
    `burn.turns_for_window` over one sitting, and they agree to the token on every session
    uploaded so far (the review recomputed all 160 from the raw JSONL)."""
    dollars = (c.usd_cache_read, c.usd_cache_write, c.usd_input, c.usd_output)
    if c.calls_needed < 1:
        return "call_tokens.calls_needed must be at least 1"
    if c.reason is not None:
        answered = (c.per_point, c.points, c.lifetime_seconds, c.rewrites, c.rewrite_calls)
        if any(x is not None for x in (*answered, *dollars, c.price_reason)):
            return "call_tokens carries a refusal and a chart: one or the other"
        if c.reason == "no_token_counts":
            ok = c.calls is None
            return None if ok else "call_tokens.calls is null exactly when nothing was counted"
        if c.calls is None or not 0 <= c.calls < c.calls_needed:
            return (
                f"call_tokens refuses too_few_calls with {c.calls} calls, "
                f"where a chart needs {c.calls_needed}"
            )
        return None
    if None in (c.calls, c.per_point, c.points, c.rewrites, c.rewrite_calls):
        return "call_tokens answers without its calls, points or rewrites"
    if c.calls < c.calls_needed:
        return f"call_tokens draws {c.calls} calls, where a chart needs {c.calls_needed}"
    per = max(1, -(-c.calls // CALL_POINTS_MAX))
    if c.per_point != per or len(c.points) != -(-c.calls // per):
        return (
            f"call_tokens has {len(c.points)} points for {c.calls} calls at {c.per_point} a point"
        )
    counts = [v for x in c.points for v in (x.at, x.cache_read, x.cache_write, x.input, x.output)]
    ordered = all(a.at <= b.at for a, b in zip(c.points, c.points[1:], strict=False))
    if any(v < 0 for v in counts) or not ordered:
        return "call_tokens has a negative count or points out of time order"
    if c.lifetime_seconds is not None and c.lifetime_seconds not in CALL_LIFETIMES:
        return f"call_tokens.lifetime_seconds {c.lifetime_seconds} is not a cache lifetime"
    if not len(c.rewrites) <= c.rewrite_calls <= c.calls:
        return "call_tokens counts more rewrites than it lists calls, or lists more than it counts"
    if c.rewrites and c.lifetime_seconds is None:
        return "call_tokens names a rewrite with no cache lifetime to have outlived"
    calls = [r.call for r in c.rewrites]
    if calls != sorted(set(calls)):
        return "call_tokens lists a rewrite twice or out of call order"
    for r in c.rewrites:
        if not 1 <= r.call <= c.calls:
            return "call_tokens names a rewrite outside its own calls"
        if r.away_seconds <= c.lifetime_seconds:
            return "call_tokens names a rewrite back sooner than the cache expires"
        if not 0 <= r.written <= c.points[(r.call - 1) // c.per_point].cache_write:
            return "call_tokens names a rewrite that wrote more than its own point did"
    finite = all(d is not None and math.isfinite(d) and d >= 0 for d in dollars)
    priced = finite and c.price_reason is None
    refused = c.price_reason is not None and all(d is None for d in dollars)
    if not (priced or refused):
        return "call_tokens must carry four finite dollar figures, or a price_reason and none"
    if burn is not None and burn.tokens is not None:
        drawn = sum(x.cache_read + x.cache_write + x.input + x.output for x in c.points)
        if drawn != burn.tokens:
            return f"call_tokens draws {drawn} tokens where burn counts {burn.tokens}"
    return None


class Stored(NamedTuple):
    """What `store_payloads` did, for the route that called it."""

    accepted: int
    unchanged: int
    rejected: list[dict]
    #: Completion banners, decided and recorded inside the transaction (notify.plan).
    pending: list[notify.PendingPush]
    #: Live Activity pushes for every session whose live row was written or deleted
    #: (live_push.plan). Sent after commit with `live_push.send_after_commit`.
    live_pushes: list[live_push.LivePush]


@router.post("/sessions:batch", response_model=BatchResponse)
def upload_batch(body: BatchRequest, device: CurrentDevice = Depends(current_uploader)):
    """Idempotent bulk upsert.

    Authenticated by `current_uploader`: a device token or a capture key. This route and
    `/known` are the only two that accept a key (`docs/cloud-capture.md`, threat model).

    Sized for a first-run backfill in a handful of requests — the whole corpus on the
    reference machine is 557 sessions, roughly three chunks — and for a single session
    arriving fifteen minutes after work stops.

    `content_hash` makes a repeat free: re-uploading an unchanged session touches nothing
    and reports `unchanged`, so a client that loses its sync state and replays everything
    costs bandwidth rather than correctness.

    Completion pushes are decided and RECORDED inside the transaction (notify.plan) and
    sent only after it commits. The order is the point: a push failure — APNs down, a
    bad token, a bug in the HTTP client — can never roll back an upload, and a request
    that dies between commit and send loses a banner rather than storing a session
    twice. Failures are logged, not raised; the Mac's sync must not retry a whole batch
    because a phone was unreachable.
    """
    if len(body.sessions) > 250:
        raise HTTPException(413, "at most 250 sessions per batch")

    with db_session(viewer_id=str(device.user_id)) as db:
        stored = store_payloads(db, device, body.sessions)
        db.execute(
            text("UPDATE devices SET last_seen_at = now() WHERE id = :d"),
            {"d": str(device.device_id)},
        )

    send_pending(device, stored.pending)
    send_live_pushes(stored.live_pushes)
    return BatchResponse(
        accepted=stored.accepted, unchanged=stored.unchanged, rejected=stored.rejected
    )


#: The rejection when a payload carries basenames the account has not allowed
#: (docs/overnight-integration.md 2.3). The client that sent them is told why, so a
#: `capture sync --live --live-names` against an account with File names off says so.
LIVE_NAMES_OFF = "live_names sent while file names are off for this account"

#: The rejection for a session in a repository the account excluded. Excluding deletes what
#: is stored (routes/privacy.py `set_visibility`); this keeps the next upload from any
#: machine, the hook channel's included, from putting it back. Said to the client, which
#: prints it (`capture sync`, the watcher's "rejected" line).
REPO_EXCLUDED = "this repository is excluded for this account, so nothing from it is stored"


def _repo_excluded(db, user_id: str, repo_hash: str | None) -> bool:
    """`session_repo_excluded` (0004), the one function the RLS policies and the social
    routes ask: SECURITY DEFINER, so it reads `repo_visibility` whoever the viewer is.

    Asked by HASH, before `_upsert_repo`, so an excluded repository's upload writes nothing
    at all: not the session, and not the `public_name` the upsert would otherwise refresh
    on the shared `repos` row. A repository with no row cannot have been excluded (the
    visibility row references it)."""
    if not repo_hash:
        return False
    return bool(
        db.execute(
            text(
                "SELECT session_repo_excluded(CAST(:u AS uuid), r.id) FROM repos r "
                "WHERE r.repo_hash = :h"
            ),
            {"u": user_id, "h": repo_hash},
        ).scalar()
    )


def store_payloads(db, device: CurrentDevice, payloads: list[SessionUpload]) -> Stored:
    """The per-session upsert, shared by the batch route and the hook channel
    (routes/ingest.py) so a session reaches the same tables by the same rules whichever
    way its transcript arrived. Runs inside the caller's transaction.

    The live row (session_live, 0020) follows the session: written when a live payload
    carries a `live` block, deleted when the session arrives final, left alone by a live
    payload without one. It is refreshed even when the content hash is unchanged, because
    the hash is taken WITHOUT `live`: the block moves with the clock (idle minutes, the
    ETA's elapsed time), not with the transcript's bytes.
    """
    user_id = str(device.user_id)
    accepted = 0
    unchanged = 0
    rejected: list[dict] = []
    pending: list[notify.PendingPush] = []
    live_changed: list[str] = []
    prefs: live_store.Prefs | None = None  # read once, and only if a payload needs it
    for p in payloads:
        if (reason := sanity_gate(p)) is not None:
            rejected.append({"client_session_id": p.client_session_id, "reason": reason})
            continue
        if p.live_names is not None:
            # Read under a share lock: the phone's "off" (routes/privacy.py) updates this row
            # and clears every stored name in one transaction, so a store racing it either
            # waits for it and sees off, or holds it off until the names are written and then
            # cleared. Unlocked, a store that read "on" just before could write names after
            # the clear (recorded by the push package; the quotes route locks the same way).
            prefs = prefs or live_store.prefs(db, user_id, lock=True)
            if not prefs.live_names:
                rejected.append(
                    {"client_session_id": p.client_session_id, "reason": LIVE_NAMES_OFF}
                )
                continue

        # `state` rides along so the notification decision can tell a live row
        # becoming final (news) from a final row being refreshed (not news).
        existing = db.execute(
            text(
                "SELECT id, content_hash, state FROM sessions "
                "WHERE user_id = :u AND client_session_id = :c"
            ),
            {"u": user_id, "c": p.client_session_id},
        ).first()

        if existing and existing.content_hash == p.content_hash:
            if _store_live(db, existing.id, user_id, p) or _went_final(existing, p):
                live_changed.append(str(existing.id))
            unchanged += 1
            continue

        if _repo_excluded(db, user_id, p.repo_hash):
            # FOUND IN THE ADVERSARIAL REVIEW (2026-09-13): the exclusion sweep deleted the
            # sessions and the next upload recreated them, the live row and its pushes.
            rejected.append({"client_session_id": p.client_session_id, "reason": REPO_EXCLUDED})
            continue
        repo_id = _upsert_repo(db, p)
        session_id = _upsert_session(db, device, p, repo_id, existing)
        _upsert_strip(db, session_id, p)
        _upsert_stats(db, session_id, p)
        _upsert_analysis(db, session_id, p)
        if _store_live(db, session_id, user_id, p) or _went_final(existing, p):
            live_changed.append(str(session_id))
        if (push_plan := notify.plan(db, session_id, p, existing)) is not None:
            pending.append(push_plan)
        accepted += 1
    live_pushes = live_push.plan(db, user_id, live_changed) if live_changed else []
    return Stored(accepted, unchanged, rejected, pending, live_pushes)


def _went_final(existing, p: SessionUpload) -> bool:
    """A running session arriving final. Its Live Activity is owed an `end` on THIS upload,
    whether or not a producer ever gave it a live row: the Mac app sends none, so its final
    deletes nothing and, before this, the end waited for some other live row of the account
    to move (FOUND IN INTEGRATION, recorded by the push package, 2026-09-13)."""
    return p.state == "final" and existing is not None and existing.state == "live"


def _store_live(db, session_id, user_id: str, p: SessionUpload) -> bool:
    """Keep session_live in step with the session. True when its row was written or
    deleted, which is what `live_push.plan` needs to hear about.

    Final: the row goes (the gate has already refused `live` on a final payload). Live
    with a block: the row is replaced. Live without one, which is the Mac app and any
    producer that does not compute it: the row is left alone, as `analysis` is, because
    nothing must not mean "delete what another producer measured".
    """
    if p.state == "final":
        return live_store.delete(db, session_id)
    if p.live is None:
        return False
    live_store.upsert(
        db,
        session_id=session_id,
        user_id=user_id,
        body=p.live.model_dump(mode="json"),
        names=p.live_names.model_dump(mode="json") if p.live_names is not None else None,
        source=live_store.source_for(p.client_version),
    )
    return True


def send_live_pushes(pushes: list[live_push.LivePush]) -> None:
    """After commit, best effort, exactly as `send_pending`: an APNs failure can never roll
    back an upload. Called through the module attribute so a test can replace it."""
    if not pushes:
        return
    try:
        live_push.send_after_commit(pushes)
    except Exception:
        log.exception("%d live activity pushes failed; not retried", len(pushes))


def send_pending(device: CurrentDevice, pending: list[notify.PendingPush]) -> None:
    """After commit. Best-effort: a push failure can never roll back an upload. Called
    through the module attribute rather than an imported name so a test can replace it
    at `push.send_session_finished`."""
    for n in pending:
        try:
            push.send_session_finished(
                str(device.user_id), n.title, n.body, n.session_id, unattended=n.unattended
            )
        except Exception:
            log.exception("push for session %s (%s) failed; not retried", n.session_id, n.kind)


def _upsert_repo(db, p: SessionUpload):
    if not p.repo_hash:
        return None
    row = db.execute(
        text(
            """
            INSERT INTO repos (repo_hash, pepper_version, repo_id_basis, public_name)
            VALUES (:h, :pv, :basis, :name)
            ON CONFLICT (repo_hash) DO UPDATE
              SET public_name = COALESCE(EXCLUDED.public_name, repos.public_name)
            RETURNING id
            """
        ),
        {
            "h": p.repo_hash,
            "pv": p.repo_pepper_version,
            "basis": p.repo_id_basis,
            "name": p.repo_name,
        },
    ).one()
    return row.id


def _upsert_session(db, device: CurrentDevice, p: SessionUpload, repo_id, existing):
    """Insert or replace in place.

    The local day is the Mac's day, not the calendar's. `Tuning.dayBoundaryHour = 4`:
    a session that starts at 01:30 local belongs to the evening before, because that is
    how the person will describe it and because a late night landing alone on a new date
    manufactures a streak break. The server used to take the plain calendar date, so any
    session started between midnight and four disagreed with the menu bar about which day
    it was — three definitions of "day" is exactly what the Tuning comment warns against.
    `local_date` and `local_dow` both carry the four-hour shift; `local_hour` does NOT,
    because it is a clock reading (a 01:30 start is hour 1, not hour 21) and shifting it
    would store a plausible wrong number that no consumer would ever question.

    ON CONFLICT refreshes everything a later upload can legitimately change. A `live`
    snapshot becomes `final` in place; a `day_boundary` cut moves `started_at` to 04:00,
    and with it the local date; a re-sync from a re-paired Mac moves `device_id`.
    `harness` is not in the list — a session cannot change which tool wrote it.
    """
    row = db.execute(
        text(
            """
            INSERT INTO sessions (
              user_id, device_id, client_session_id, content_hash,
              sessionizer_version, active_calc_version, harness, repo_id,
              started_at, ended_at, active_seconds, idle_seconds, tz_offset_minutes,
              attended_seconds, autonomous_seconds, presence_count, end_reason,
              local_date, local_hour, local_dow,
              state, visible, notable, unattended, time_quality, timeline_fidelity,
              title, title_source, title_ids, agent_observed_at
            ) VALUES (
              :user_id, :device_id, :csid, :chash,
              :sv, :acv, :harness, :repo_id,
              :started, :ended, :active, :idle, :tz,
              :attended, :autonomous, :presence, :end_reason,
              -- local wall clock, then the 4 am day boundary (see the docstring)
              ((:started AT TIME ZONE 'UTC' + make_interval(mins => :tz))
                 - interval '4 hours')::date,
              EXTRACT(hour FROM
                (:started AT TIME ZONE 'UTC' + make_interval(mins => :tz)))::smallint,
              EXTRACT(isodow FROM
                ((:started AT TIME ZONE 'UTC' + make_interval(mins => :tz))
                   - interval '4 hours'))::smallint - 1,
              :state, :visible, :notable, :unattended, :tq, :fidelity,
              :title, :title_source, CAST(:title_ids AS jsonb), :observed
            )
            ON CONFLICT (user_id, client_session_id) DO UPDATE SET
              content_hash = EXCLUDED.content_hash,
              device_id = EXCLUDED.device_id,
              sessionizer_version = EXCLUDED.sessionizer_version,
              active_calc_version = EXCLUDED.active_calc_version,
              repo_id = EXCLUDED.repo_id,
              started_at = EXCLUDED.started_at,
              ended_at = EXCLUDED.ended_at,
              active_seconds = EXCLUDED.active_seconds,
              idle_seconds = EXCLUDED.idle_seconds,
              tz_offset_minutes = EXCLUDED.tz_offset_minutes,
              attended_seconds = EXCLUDED.attended_seconds,
              autonomous_seconds = EXCLUDED.autonomous_seconds,
              presence_count = EXCLUDED.presence_count,
              end_reason = EXCLUDED.end_reason,
              local_date = EXCLUDED.local_date,
              local_hour = EXCLUDED.local_hour,
              local_dow = EXCLUDED.local_dow,
              state = EXCLUDED.state,
              visible = EXCLUDED.visible,
              notable = EXCLUDED.notable,
              unattended = EXCLUDED.unattended,
              time_quality = EXCLUDED.time_quality,
              timeline_fidelity = EXCLUDED.timeline_fidelity,
              title = EXCLUDED.title,
              title_source = EXCLUDED.title_source,
              -- COALESCE, as `feedback` and `analysis` (0023): a client that does not
              -- compute a title (the Mac) sends null and must not erase the one another
              -- client did. A REFUSAL is not null: it is a document with `reason` set and
              -- no verb, and like a burn refusal it replaces a stale title (the live cut's,
              -- after the final cut refused one).
              title_ids = COALESCE(EXCLUDED.title_ids, sessions.title_ids),
              agent_observed_at = EXCLUDED.agent_observed_at,
              updated_at = now()
            RETURNING id
            """
        ),
        {
            "user_id": str(device.user_id),
            "device_id": str(device.device_id),
            "csid": p.client_session_id,
            "chash": p.content_hash,
            "sv": p.sessionizer_version,
            "acv": p.active_calc_version,
            "harness": p.harness,
            "repo_id": repo_id,
            "started": p.started_at,
            "ended": p.ended_at,
            "active": p.active_seconds,
            "idle": p.idle_seconds,
            "tz": p.tz_offset_minutes,
            "attended": p.attended_seconds,
            "autonomous": p.autonomous_seconds,
            "presence": p.presence_count,
            "end_reason": p.end_reason,
            "state": p.state,
            "visible": p.visible,
            "notable": p.notable,
            # From the payload, checked against presence_count by the gate. v1 hardcoded
            # False here, which is how an autonomous run could become a record.
            "unattended": p.unattended,
            "tq": p.time_quality,
            "fidelity": p.timeline_fidelity,
            "title": p.title,
            "title_source": p.title_source,
            "title_ids": (
                json.dumps(p.title_ids.model_dump(mode="json")) if p.title_ids is not None else None
            ),
            "observed": p.agent_observed_at,
        },
    ).one()
    return row.id


def _upsert_strip(db, session_id, p: SessionUpload):
    db.execute(
        text(
            """
            INSERT INTO session_strips (session_id, spec_version, t0_ms, t1_ms, cols, marks)
            VALUES (:sid, 1, :t0, :t1, :cols, CAST(:marks AS jsonb))
            ON CONFLICT (session_id) DO UPDATE SET
              t0_ms = EXCLUDED.t0_ms, t1_ms = EXCLUDED.t1_ms,
              cols = EXCLUDED.cols, marks = EXCLUDED.marks
            """
        ),
        {
            "sid": session_id,
            "t0": int(p.started_at.timestamp() * 1000),
            "t1": int(p.ended_at.timestamp() * 1000),
            "cols": base64.b64decode(p.strip_columns),
            "marks": json.dumps([[m.ms, m.k] for m in p.strip_marks]),
        },
    )


def _upsert_stats(db, session_id, p: SessionUpload):
    t = p.tokens
    db.execute(
        text(
            """
            INSERT INTO session_stats (
              session_id, tokens_reported, tok_in, tok_out, tok_cache_read,
              tok_cache_w5m, tok_cache_w1h, abandoned_branch_tokens,
              token_dedupe, token_scope, token_coverage, models, model_state, tool_calls,
              human_prompt_count, prompt_count_basis, files_touched, files_created,
              lines_added_agent, lines_removed_agent, commit_count, commit_insertions,
              commit_deletions, human_edit_events, agent_line_bucket, attrib_confidence,
              feedback, burn, call_tokens
            ) VALUES (
              :sid, :reported, :tin, :tout, :tcr, :tw5, :tw1, :abandoned,
              :dedupe, :scope, :coverage, CAST(:models AS jsonb), :model_state,
              CAST(:tools AS jsonb),
              :prompts, :basis, :files, :created, :added, :removed,
              :commits, :ins, :del, :human_edits, :bucket, :confidence,
              CAST(:feedback AS jsonb), CAST(:burn AS jsonb), CAST(:call_tokens AS jsonb)
            )
            ON CONFLICT (session_id) DO UPDATE SET
              tokens_reported = EXCLUDED.tokens_reported,
              tok_in = EXCLUDED.tok_in, tok_out = EXCLUDED.tok_out,
              tok_cache_read = EXCLUDED.tok_cache_read,
              tok_cache_w5m = EXCLUDED.tok_cache_w5m, tok_cache_w1h = EXCLUDED.tok_cache_w1h,
              abandoned_branch_tokens = EXCLUDED.abandoned_branch_tokens,
              token_dedupe = EXCLUDED.token_dedupe, token_scope = EXCLUDED.token_scope,
              token_coverage = EXCLUDED.token_coverage, models = EXCLUDED.models,
              model_state = EXCLUDED.model_state, tool_calls = EXCLUDED.tool_calls,
              human_prompt_count = EXCLUDED.human_prompt_count,
              prompt_count_basis = EXCLUDED.prompt_count_basis,
              files_touched = EXCLUDED.files_touched, files_created = EXCLUDED.files_created,
              lines_added_agent = EXCLUDED.lines_added_agent,
              lines_removed_agent = EXCLUDED.lines_removed_agent,
              commit_count = EXCLUDED.commit_count,
              commit_insertions = EXCLUDED.commit_insertions,
              commit_deletions = EXCLUDED.commit_deletions,
              human_edit_events = EXCLUDED.human_edit_events,
              agent_line_bucket = EXCLUDED.agent_line_bucket,
              attrib_confidence = EXCLUDED.attrib_confidence,
              -- COALESCE, not EXCLUDED, exactly as `analysis` is handled. A client that
              -- does not compute feedback sends nothing, and nothing must not mean
              -- "delete what another client measured".
              -- EXCEPT from a producer that computed `burn`: burn and feedback are built in
              -- one pass by the same `analysis` package (capture.sessions.build_payload:
              -- `_feedback` and `session_burn_of` both import it, and the Mac computes
              -- neither), so its null is "nothing worth saying", not "not computed". A
              -- final session's events do not change, but the RULES do: FOUND IN THE
              -- DEFECTS PASS (2026-09-14), 60256e3a kept "3 stretches with nothing
              -- written, tested or committed, 3h 09m" of a 3h 12m sitting that landed 13
              -- commits after a corrected re-upload had no note for it.
              feedback = CASE WHEN EXCLUDED.burn IS NOT NULL THEN EXCLUDED.feedback
                              ELSE COALESCE(EXCLUDED.feedback, session_stats.feedback) END,
              -- The same rule for `burn` (0023). Null on the wire means the producer
              -- did not compute it; a refusal is a document with `reason` set, and it
              -- does replace what was stored.
              burn = COALESCE(EXCLUDED.burn, session_stats.burn),
              -- And for `call_tokens` (0025), burn's rule for burn's reason.
              call_tokens = COALESCE(EXCLUDED.call_tokens, session_stats.call_tokens)
            """
        ),
        {
            "sid": session_id,
            "reported": p.tokens_reported,
            "tin": t.input if t else None,
            "tout": t.output if t else None,
            "tcr": t.cache_read if t else None,
            "tw5": t.cache_w5m if t else None,
            "tw1": t.cache_w1h if t else None,
            "abandoned": p.abandoned_branch_tokens,
            "dedupe": p.token_dedupe,
            "scope": p.token_scope,
            "coverage": p.token_coverage,
            "models": json.dumps([m.model_dump() for m in p.models]),
            "model_state": p.model_state,
            "tools": json.dumps(p.tool_calls),
            "prompts": p.human_prompt_count,
            "basis": p.prompt_count_basis,
            "files": p.files_touched,
            "created": p.files_created,
            "added": p.lines_added_agent,
            "removed": p.lines_removed_agent,
            "commits": p.commit_count,
            "ins": p.commit_insertions,
            "del": p.commit_deletions,
            "human_edits": p.human_edit_events,
            "bucket": p.agent_line_bucket,
            "confidence": p.attrib_confidence,
            "feedback": (json.dumps([n.model_dump() for n in p.feedback]) if p.feedback else None),
            "burn": json.dumps(p.burn.model_dump(mode="json")) if p.burn is not None else None,
            "call_tokens": (
                json.dumps(p.call_tokens.model_dump(mode="json"))
                if p.call_tokens is not None
                else None
            ),
        },
    )


def _upsert_analysis(db, session_id, p: SessionUpload):
    """Store the model-written analysis, if the payload carries one.

    A payload WITHOUT an analysis leaves any stored one alone. The field is opt-in and
    omitted from the wire when off, so its absence means "nothing to say this time" — an
    agent whose user turned analysis upload off does not retract what it already sent by
    resyncing, and a live checkpoint that arrived with an analysis is not wiped by the next
    60-second snapshot that did not run one. Deletion is a separate, explicit action.
    """
    a = p.analysis
    if a is None:
        return
    db.execute(
        text(
            """
            INSERT INTO session_analysis (
              session_id, analysis_version, model, generated_at, digest_hash, body
            ) VALUES (
              :sid, :version, :model, :generated_at, :digest_hash, CAST(:body AS jsonb)
            )
            ON CONFLICT (session_id) DO UPDATE SET
              analysis_version = EXCLUDED.analysis_version,
              model = EXCLUDED.model,
              generated_at = EXCLUDED.generated_at,
              digest_hash = EXCLUDED.digest_hash,
              body = EXCLUDED.body,
              updated_at = now()
            """
        ),
        {
            "sid": session_id,
            "version": a.analysis_version,
            "model": a.model,
            "generated_at": a.generated_at,
            "digest_hash": a.digest_hash,
            # mode="json" so generated_at is an ISO string inside the document too, and
            # the phone reads the same bytes whichever path they arrive by.
            "body": json.dumps(a.model_dump(mode="json")),
        },
    )


@router.get("/known")
def known_hashes(device: CurrentDevice = Depends(current_uploader)):
    """Content hashes the server already has, so the client can skip unchanged sessions.

    Turns a replay of the whole history into one small request plus nothing.
    """
    with db_session(viewer_id=str(device.user_id)) as db:
        rows = db.execute(
            text("SELECT client_session_id, content_hash FROM sessions WHERE user_id = :u"),
            {"u": str(device.user_id)},
        ).all()
    return {"known": {r.client_session_id: r.content_hash for r in rows}}
