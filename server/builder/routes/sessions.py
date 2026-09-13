import base64
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text

from .. import live_store
from ..auth import CurrentDevice, current_device, current_uploader
from ..builder_profile import (
    DEFAULT_WINDOW_DAYS,
    MAX_WINDOW_DAYS,
    MIN_SESSIONS,
    builder_narrative,
    builder_profile,
    builder_quotes,
    builder_report,
    corpus_metrics,
    held_report,
    project_names,
    put_builder_narrative,
    put_builder_report,
)
from ..contract import ENUM_VALUES
from ..db import db_session
from ..narrative_spec import BuilderNarrative
from ..report_spec import BuilderReport

router = APIRouter(prefix="/v1", tags=["sessions"])

#: How many live snapshots a viewer can have at once, in practice. One Mac produces one
#: live session per open harness; ten is a Mac with every editor open, and the phone's
#: "right now" strip has room for about three before it scrolls.
LIVE_LIMIT = 10


def _row_to_session(r) -> dict:
    return {
        "id": str(r.id),
        "client_session_id": r.client_session_id,
        "harness": r.harness,
        "repo_name": r.public_name,
        "started_at": r.started_at.isoformat(),
        "ended_at": r.ended_at.isoformat(),
        "active_seconds": r.active_seconds,
        "idle_seconds": r.idle_seconds,
        # The two clocks (docs/session-boundaries.md). Records read attended, never active.
        "attended_seconds": r.attended_seconds,
        "autonomous_seconds": r.autonomous_seconds,
        "presence_count": r.presence_count,
        "state": r.state,
        "end_reason": r.end_reason,
        "local_date": r.local_date.isoformat(),
        "title": r.title,
        "title_source": r.title_source,
        # Contract v4 (0023): the engineer voice title as ids, `{verb, object, n, modules}`,
        # or null when no title rule fired or the producer does not compute one. On every
        # row, not only the detail, because a title is what a list shows; the phone renders
        # the words from the ids, so no word of it is stored.
        "title_ids": r.title_ids,
        "notable": r.notable,
        "unattended": r.unattended,
        "timeline_fidelity": r.timeline_fidelity,
        "is_shared": r.is_shared,
        # The VIEWER'S OWN post for this session, or null. Every query feeding this mapper
        # LEFT JOINs posts on `p.session_id = s.id AND p.user_id = <viewer>`, so a stranger
        # reading a shared session through `sessions_public` gets null even for a public
        # post they could otherwise see: the phone uses this key to offer "edit / unshare",
        # and a post it may only look at is reached from the feed, which already carries
        # its id. `posts.session_id` is UNIQUE, so the join can never multiply rows.
        "post_id": str(r.post_id) if r.post_id else None,
    }


def _live_rows(db, user_id: str) -> list[dict]:
    """The viewer's live snapshots, newest update first.

    Shared by `/sessions/live` and `/profile`, so the phone's cold-start request and its
    pull-to-refresh agree on what "right now" means. `updated_at` is included because a
    live row's `ended_at` is the last record the Mac had seen, and the phone wants to say
    "as of 40 s ago" rather than pretend the snapshot is the present.

    `live_state` is the SLIM state (`live_store.slim`: no time lapse, only the map rows
    the activity and the verdict name) or null when no producer has computed one. Mission
    control, the widget and ActivityKit read this list, and `live_names` is never on it:
    a basename that reached this route could reach a Lock Screen.
    """
    rows = db.execute(
        text(
            """
            SELECT s.*, r.public_name, p.id AS post_id, sl.body AS live_body
            FROM sessions s
            LEFT JOIN repos r ON r.id = s.repo_id
            LEFT JOIN posts p ON p.session_id = s.id AND p.user_id = CAST(:u AS uuid)
            LEFT JOIN session_live sl ON sl.session_id = s.id
            WHERE s.user_id = :u AND s.state = 'live'
            ORDER BY s.updated_at DESC LIMIT :limit
            """
        ),
        {"u": user_id, "limit": LIVE_LIMIT},
    ).all()
    return [
        {
            **_row_to_session(r),
            "updated_at": r.updated_at.isoformat(),
            "live_state": live_store.slim(r.live_body),
        }
        for r in rows
    ]


@router.get("/sessions")
def list_sessions(
    device: CurrentDevice = Depends(current_device),
    limit: int = Query(50, le=200),
    before: str | None = None,
    notable_only: bool = True,
    state: str = Query("final"),
    include_live: bool = False,
):
    """Reverse-chronological, keyset-paginated.

    Keyset rather than OFFSET: the phone scrolls while the Mac is still syncing, and an
    offset-paginated list under concurrent insertion silently skips and repeats rows.

    Final only by default. A live row is a moving target — its `started_at` can shift on a
    day-boundary cut and its `ended_at` moves every minute — which is the wrong thing to
    paginate over; `include_live` folds them in for the one screen that wants both.
    """
    if state not in ENUM_VALUES["state"]:
        raise HTTPException(422, f"state must be one of {ENUM_VALUES['state']}")

    clauses = ["s.user_id = :u"]
    params: dict = {"u": str(device.user_id), "limit": limit, "state": state}
    if include_live:
        clauses.append("(s.state = CAST(:state AS sess_state) OR s.state = 'live')")
    else:
        clauses.append("s.state = CAST(:state AS sess_state)")
    if notable_only:
        clauses.append("s.notable")
    if before:
        clauses.append("s.started_at < :before")
        params["before"] = before

    with db_session(viewer_id=str(device.user_id)) as db:
        rows = db.execute(
            text(
                f"""
                SELECT s.*, r.public_name, p.id AS post_id
                FROM sessions s
                LEFT JOIN repos r ON r.id = s.repo_id
                LEFT JOIN posts p ON p.session_id = s.id AND p.user_id = CAST(:u AS uuid)
                WHERE {" AND ".join(clauses)}
                ORDER BY s.started_at DESC LIMIT :limit
                """
            ),
            params,
        ).all()

    return {
        "sessions": [_row_to_session(r) for r in rows],
        "next_before": rows[-1].started_at.isoformat() if len(rows) == limit else None,
    }


# Declared BEFORE `/sessions/{session_id}`: FastAPI matches routes in order, and a path
# parameter would otherwise swallow the literal "live" and hand it to a uuid comparison.
@router.get("/sessions/live")
def live_sessions(device: CurrentDevice = Depends(current_device)):
    """What the Mac is doing right now, per open session."""
    with db_session(viewer_id=str(device.user_id)) as db:
        live = _live_rows(db, str(device.user_id))
    return {"sessions": live}


@router.get("/sessions/{session_id}")
def get_session(session_id: str, device: CurrentDevice = Depends(current_device)):
    uid = str(device.user_id)
    with db_session(viewer_id=uid) as db:
        # The posts join is filtered to the VIEWER's post, not the session owner's. RLS on
        # `posts` would already hide a private post from a stranger, but relying on it
        # would hand a follower or a public reader the id of someone else's post under a
        # key the phone treats as "mine"; the explicit predicate makes the meaning of the
        # field independent of how the policies happen to be written.
        row = db.execute(
            text(
                """
                SELECT s.*, r.public_name, p.id AS post_id
                FROM sessions s
                LEFT JOIN repos r ON r.id = s.repo_id
                LEFT JOIN posts p ON p.session_id = s.id AND p.user_id = CAST(:u AS uuid)
                WHERE s.id = :id
                """
            ),
            {"id": session_id, "u": uid},
        ).first()
        if row is None:
            raise HTTPException(404, "not found")

        strip = db.execute(
            text("SELECT cols, marks, t0_ms, t1_ms FROM session_strips WHERE session_id = :id"),
            {"id": session_id},
        ).first()
        stats = db.execute(
            text("SELECT * FROM session_stats WHERE session_id = :id"), {"id": session_id}
        ).first()
        # Read under the same viewer as the session row, so RLS on session_analysis is what
        # decides whether a shared session's analysis travels with it.
        analysis = db.execute(
            text("SELECT body FROM session_analysis WHERE session_id = :id"), {"id": session_id}
        ).first()
        # Owner only (0020): a stranger reading a shared session gets no row from either
        # query, whatever this code does with the result.
        live = db.execute(
            text("SELECT body, names FROM session_live WHERE session_id = :id"),
            {"id": session_id},
        ).first()
        names_on = bool(
            live is not None
            and live.names is not None
            and db.execute(
                text("SELECT live_names FROM privacy_prefs WHERE user_id = :u"),
                {"u": str(row.user_id)},
            ).scalar()
        )

    out = _row_to_session(row)
    if strip:
        out["strip"] = {
            # base64 on the wire: the phone decodes it with the generated TypeScript
            # decoder, which reads the same 2-bit layout as the Swift one.
            "cols": base64.b64encode(strip.cols).decode(),
            "marks": strip.marks,
            "t0_ms": strip.t0_ms,
            "t1_ms": strip.t1_ms,
        }
    if stats:
        out["stats"] = {
            "tokens_reported": stats.tokens_reported,
            "tok_in": stats.tok_in,
            "tok_out": stats.tok_out,
            "tok_cache_read": stats.tok_cache_read,
            "tok_cache_w5m": stats.tok_cache_w5m,
            "tok_cache_w1h": stats.tok_cache_w1h,
            "models": stats.models,
            "model_state": stats.model_state,
            "human_prompt_count": stats.human_prompt_count,
            "prompt_count_basis": stats.prompt_count_basis,
            "files_touched": stats.files_touched,
            "lines_added_agent": stats.lines_added_agent,
            # Stored since 0002 and never served: the Live Activity's `linesRemoved` and
            # the money view read it (docs/overnight-integration.md 5.4).
            "lines_removed_agent": stats.lines_removed_agent,
            "commit_count": stats.commit_count,
            "agent_line_bucket": stats.agent_line_bucket,
            "attrib_confidence": stats.attrib_confidence,
        }
    # Null, never absent, and never [] standing in for null: the phone tells "this sitting
    # had nothing worth saying" from "an older server does not know the key" by whether
    # the key is there at all. Stored on session_stats (0019); the SENTENCE is not stored
    # because it is not uploaded — the client writes it from the id.
    out["feedback"] = (stats.feedback if stats else None) or None
    # Null, never absent: the phone distinguishes "no analysis for this session" from an
    # older server that does not know the key.
    out["analysis"] = analysis.body if analysis else None
    # Contract v4 (0023). Where this sitting's tokens went, as numbers and enums; the
    # session screen writes the sentences. Null when no producer computed it, and a
    # refusal is the document's own `reason`, never a missing key or a zero.
    out["burn"] = stats.burn if stats else None
    # The FULL live state, time lapse and whole map included, while the session runs;
    # null once it is final (the row is deleted then; the state check is the second lock).
    out["live_state"] = live.body if live is not None and row.state == "live" else None
    # Opt in basenames for the session screen, and only here: null unless the account
    # has File names on AND names are stored. Never on the live list, a push or a share.
    out["live_names"] = live.names if names_on and row.state == "live" else None
    return out


#: `window_days` for the builder profile, shared by both routes below.
WindowDays = Query(DEFAULT_WINDOW_DAYS, ge=1, le=MAX_WINDOW_DAYS)


@router.get("/profile")
def profile(
    device: CurrentDevice = Depends(current_device),
    days: int = Query(119, le=400),
    window_days: int = WindowDays,
):
    """Everything the profile tab needs, in one request.

    One round trip rather than four: the phone renders this screen on cold launch over a
    cellular connection, and four sequential requests is four chances to show a spinner.

    Live rows are returned separately under `live` and excluded from every aggregate. A
    live session's numbers move every minute; folding them into the graph and the totals
    would make the profile disagree with itself between two pulls, and the phone adds
    today's live minutes to today's cell on its own.

    `builder_profile` is the aggregate of the session analyses (builder_profile.py): null
    until three analysed sessions exist, because docs/analysis.md forbids reading an
    archetype off one run. The computed corpus metrics and their ranked facts are NOT
    here: they are a second, larger object served by `/profile/builder`, which the phone
    fetches for the profile card and refreshes on its own.
    """
    uid = str(device.user_id)
    with db_session(viewer_id=uid) as db:
        graph = db.execute(
            text(
                """
                SELECT local_date, SUM(active_seconds) AS secs
                FROM sessions
                WHERE user_id = :u AND visible AND state <> 'live'
                  AND local_date > (CURRENT_DATE - make_interval(days => :days))
                GROUP BY local_date ORDER BY local_date
                """
            ),
            {"u": uid, "days": days},
        ).all()

        totals = db.execute(
            text(
                """
                SELECT COUNT(*) AS n, COALESCE(SUM(active_seconds), 0) AS secs
                FROM sessions WHERE user_id = :u AND visible AND state <> 'live'
                """
            ),
            {"u": uid},
        ).one()

        # Records rank by ATTENDED time (docs/session-boundaries.md). Ordered by active,
        # the winner in the reference corpus was a 5h40m autonomous run with zero typed
        # prompts; ordered by attended, a kickoff prompt plus eight robot hours scores
        # its attended minutes. Backed by sessions_record_idx from 0006.
        longest = db.execute(
            text(
                """
                SELECT id, attended_seconds, active_seconds, started_at FROM sessions
                WHERE user_id = :u AND notable AND NOT unattended AND state <> 'live'
                ORDER BY attended_seconds DESC LIMIT 1
                """
            ),
            {"u": uid},
        ).first()

        arcs = db.execute(
            text(
                """
                SELECT r.public_name, r.repo_hash, COUNT(*) AS n,
                       SUM(s.active_seconds) AS secs,
                       MIN(s.started_at) AS first_at, MAX(s.started_at) AS last_at
                FROM sessions s JOIN repos r ON r.id = s.repo_id
                WHERE s.user_id = :u AND s.visible AND s.state <> 'live'
                GROUP BY r.public_name, r.repo_hash
                ORDER BY secs DESC LIMIT 20
                """
            ),
            {"u": uid},
        ).all()

        attribution = db.execute(
            text(
                """
                SELECT COALESCE(SUM(st.lines_added_agent), 0) AS agent_lines,
                       COALESCE(SUM(st.human_edit_events), 0) AS human_edits,
                       COALESCE(SUM(st.human_prompt_count), 0) AS prompts,
                       COALESCE(SUM(s.attended_seconds), 0) AS attended,
                       COALESCE(SUM(s.autonomous_seconds), 0) AS autonomous
                FROM session_stats st JOIN sessions s ON s.id = st.session_id
                WHERE s.user_id = :u AND s.state <> 'live'
                """
            ),
            {"u": uid},
        ).one()

        live = _live_rows(db, uid)
        builder, _analysed = builder_profile(db, uid, window_days)

    return {
        "graph": [{"date": g.local_date.isoformat(), "active_seconds": int(g.secs)} for g in graph],
        "totals": {"sessions": totals.n, "active_seconds": int(totals.secs)},
        "longest_session": (
            {
                "id": str(longest.id),
                "attended_seconds": longest.attended_seconds,
                "active_seconds": longest.active_seconds,
                "started_at": longest.started_at.isoformat(),
            }
            if longest
            else None
        ),
        "projects": [
            {
                "name": a.public_name,
                # Anonymous repos are identified only by a prefix of their hash, which is
                # enough to group sessions in the UI and carries no name.
                "key": a.repo_hash[:12],
                "sessions": a.n,
                "active_seconds": int(a.secs),
                "first_at": a.first_at.isoformat(),
                "last_at": a.last_at.isoformat(),
            }
            for a in arcs
        ],
        # Five separately measured numbers, deliberately not combined into a percentage.
        # attended + autonomous is the split of the hours total, not a sixth statistic.
        "attribution": {
            "agent_lines": int(attribution.agent_lines),
            "human_edit_events": int(attribution.human_edits),
            "prompts": int(attribution.prompts),
            "attended_seconds": int(attribution.attended),
            "autonomous_seconds": int(attribution.autonomous),
        },
        "live": live,
        "builder_profile": builder,
    }


@router.get("/profile/builder")
def profile_builder(device: CurrentDevice = Depends(current_device), window_days: int = WindowDays):
    """The builder profile alone, so the phone can refresh it without the whole tab.

    THREE documents under one route, and they are not the same kind of thing:

    * `builder_profile` aggregates the model-written session analyses (dimension means,
      modal archetype, build style, tags). Null until three analysed sessions exist. The
      count and the minimum travel beside it so the screen can say "2 of 3 sessions
      analysed" rather than show an empty card.
    * `corpus` is COMPUTED, never written: totals, prompt shape, planning ratio, steer
      rate, autonomy, velocity, night share, the archetype the deterministic rules chose
      with its runners up, and `facts`, the ranked one-line sentences the card shows. It
      needs no analysis at all, and every metric it cannot honestly compute is null with
      a reason in `sample.missing`. Null for the whole block means only one thing: the
      metrics module is not deployed on this server.
    * `report` is MEASURED ON THE MACHINE and uploaded: trends against the window before,
      subagent fan-out, commits split by whether an agent was in the room, time to green,
      and how often a prompt lands clean. None of it is computable here — it rests on
      sidecar transcripts, shell command text, prompt text and commit times, none of which
      the contract puts on the wire. Null until that machine has run `capture report`,
      which is the normal state for somebody who has only ever used the phone.

    Beside them, `quotes`: the opt-in prompts the Wrapped cards quote (contract v4, 0021).
    Null unless the account has Quote my prompts on and its machine sent them with
    `capture report --quotes`; this route is the only reader, and it only ever reads the
    viewer's own.

    And `project_names` (report v3, docs/projects.md): the report names a project by its
    repository KEY alone, and this is the PUBLIC name of each key that has one, read from
    the `repos` row every session reads its `repo_name` from. A private repository has no
    entry, never a placeholder, and the phone labels it. The report's projects in a
    repository the account excluded are taken out before it is served (`held_report`).
    """
    uid = str(device.user_id)
    with db_session(viewer_id=uid) as db:
        builder, analysed = builder_profile(db, uid, window_days)
        corpus = corpus_metrics(db, uid, window_days)
        narrative = builder_narrative(db, uid)
        report, names = held_report(db, uid, builder_report(db, uid))
        quotes = builder_quotes(db, uid)
    return {
        "builder_profile": builder,
        "sessions_analysed": analysed,
        "min_sessions": MIN_SESSIONS,
        "window_days": window_days,
        "corpus": corpus,
        "narrative": narrative,
        "report": report,
        "quotes": quotes,
        "project_names": names,
    }


#: A project key in a path: the repository hash the report and the sessions carry, whole
#: (64 hex) or as the 12 character prefix `GET /v1/profile` lists projects by.
PROJECT_KEY = r"^[0-9a-f]{12,64}$"
#: Sessions a project page lists, newest first. The phone's session list pages by 50.
PROJECT_SESSIONS = 50


@router.get("/projects/{key}")
def project(key: str, device: CurrentDevice = Depends(current_device)):
    """One project's slice: its block from the stored report, its public name if it has
    one, the comparisons that name it, and its own sessions from the server's rows (which
    the report does not carry), so the phone's project page is one request.

    `key` is the repository's hash or the 12 character prefix `GET /v1/profile` lists. It
    resolves among the repositories this viewer has a session in and the keys in their own
    report, never anybody else's: a prefix that matches two is a 409 rather than a guess,
    and a key the account excluded is a 404, as if it had never been uploaded.
    """
    uid = str(device.user_id)
    if not re.fullmatch(PROJECT_KEY, key):
        raise HTTPException(422, "a project key is 12 to 64 lowercase hex characters")
    with db_session(viewer_id=uid) as db:
        report, _names = held_report(db, uid, builder_report(db, uid))
        block = (report or {}).get("projects") or {}
        in_report = {p["key"]: p for p in block.get("projects") or []}
        rows = db.execute(
            text(
                """
                SELECT r.repo_hash FROM repos r
                WHERE left(r.repo_hash, :n) = :k
                  AND NOT session_repo_excluded(CAST(:u AS uuid), r.id)
                  AND EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = :u AND s.repo_id = r.id)
                """
            ),
            {"u": uid, "k": key, "n": len(key)},
        ).all()
        found = {r.repo_hash for r in rows} | {k for k in in_report if k.startswith(key)}
        if not found:
            raise HTTPException(404, "not found")
        if len(found) > 1:
            raise HTTPException(
                409, "that prefix names more than one project; send more of the key"
            )
        (full,) = found
        sessions = db.execute(
            text(
                """
                SELECT s.*, r.public_name, p.id AS post_id
                FROM sessions s
                JOIN repos r ON r.id = s.repo_id
                LEFT JOIN posts p ON p.session_id = s.id AND p.user_id = CAST(:u AS uuid)
                WHERE s.user_id = :u AND r.repo_hash = :h AND s.state = 'final' AND s.visible
                ORDER BY s.started_at DESC LIMIT :limit
                """
            ),
            {"u": uid, "h": full, "limit": PROJECT_SESSIONS},
        ).all()
        comparisons = [
            c for c in block.get("comparisons") or [] if full in (c.get("high"), c.get("low"))
        ]
        names = project_names(
            db, uid, {full} | {c[k] for c in comparisons for k in ("high", "low") if c.get(k)}
        )
    return {
        "key": full,
        "name": names.get(full),
        "window_days": block.get("window_days"),
        "generated_at": (report or {}).get("generated_at") if in_report.get(full) else None,
        "project": in_report.get(full),
        "comparisons": comparisons,
        "project_names": names,
        "sessions": [_row_to_session(r) for r in sessions],
    }


@router.put("/profile/narrative")
def put_narrative(doc: BuilderNarrative, device: CurrentDevice = Depends(current_uploader)):
    """Store the "how you work" page this account's own machine wrote.

    The server cannot produce this document and does not try. It rests on prompt text and
    the events around it, which never leave the machine (privacy/upload-contract.json), so
    it is written where the transcripts are, by the user's own `claude`, under
    spec/narrative.v1.json. What arrives here is validated against the Pydantic half of
    that same spec, which is where the string bounds are actually enforced: the constrained
    decoder that produced it honours `required` and `additionalProperties` and nothing
    about lengths.

    PUT, not POST: there is one narrative per person and this replaces it. A person whose
    corpus has moved on does not want two.

    `current_uploader`, not `current_device`: a headless container holds a capture key,
    because the device flow's rotating refresh token cannot be shared by a fleet (0011),
    and this is the same write a machine with the transcripts already does when it attaches
    an `analysis` to a session. The GET side stays on `current_device`, so a leaked key can
    still read nothing at all.
    """
    uid = str(device.user_id)
    with db_session(viewer_id=uid) as db:
        put_builder_narrative(db, uid, doc.model_dump(mode="json"))
    return {"ok": True, "narrative_version": doc.narrative_version}


@router.put("/profile/report")
def put_report(doc: BuilderReport, device: CurrentDevice = Depends(current_uploader)):
    """Store the measured builder report this account's own machine computed.

    Unlike the narrative there is no model anywhere in this document's history: every
    field is a number `analysis/report.py` measured. That makes the validation MORE
    important rather than less. A model-written document arrived through a constrained
    decoder that had already enforced its shape; this one arrives from code that can grow
    a field without the spec growing it, and `extra='forbid'` on report_spec.py is the
    only thing between that and a column of values nothing on the phone can render.

    PUT, not POST: one report per person, replacing the last. `current_uploader` for the
    same reason the narrative uses it — a headless container holds a capture key — and the
    GET side stays on `current_device`, so a leaked key still reads nothing.
    """
    uid = str(device.user_id)
    with db_session(viewer_id=uid) as db:
        put_builder_report(db, uid, doc.model_dump(mode="json"))
    return {"ok": True, "report_version": doc.report_version}
