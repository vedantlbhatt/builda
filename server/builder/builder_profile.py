"""The builder profile: one person, read as an aggregate of their session analyses.

docs/analysis.md draws the line this module lives on. A session analysis is one model's
reading of one digest, scored per session so that a profile "can be an honest aggregate
rather than one run's impression" — and it says outright that a profile is never a single
run. So the profile is null below `MIN_SESSIONS`, and every number in it says how many
sessions it stands on.

Dimension means and trends are computed in SQL over `session_analysis.body`
(`jsonb_array_elements` on the dimensions list); the categorical parts — archetype,
build-style modes, tags, decision patterns — are counted in Python from the same rows,
because a mode with a tie-break is clearer in six lines of Python than in a window
function nobody will re-read.

Windowing is by the session's `started_at`, not the analysis's `generated_at`: the
question is "how have I been building lately", and a re-run analysis of an old session
does not make that session recent. Live snapshots are excluded, like every other
aggregate on the profile; a live checkpoint analysis describes work in progress.

`corpus_metrics` below is the OTHER half of the profile and shares nothing with the
first: no model wrote any of it. It reads the stored sessions and their stats, hands
them to `analysis/profile.py` as `SessionFact`s, and returns the metric set, the ranked
one-line facts and the archetype the rules chose. Two consequences worth stating:

  * it does NOT need an analysis, so it lights up on the third SESSION rather than the
    third analysed session, and
  * the server cannot see prompt text, interrupts, per-tool names or commit times, so the
    metrics that rest on those come back null with a reason instead of a number. The
    reasons travel to the phone in `sample.missing`; a blank metric with no explanation
    is how a user concludes the product is broken.
"""

from __future__ import annotations

import dataclasses
import json
import pathlib
import sys
from collections import Counter

from sqlalchemy import text

from . import quotes as quote_store

#: docs/analysis.md: never compute an archetype from one run. Three is the smallest count
#: at which "most common" and "the other one" are different things.
MIN_SESSIONS = 3

DEFAULT_WINDOW_DAYS = 90
MAX_WINDOW_DAYS = 365

#: Enough tags to be a cloud, few enough to fit one line on the phone.
TOP_TAGS = 8
TOP_PATTERNS = 5

BUILD_STYLE_KEYS = ("planning", "iteration", "steering", "verification", "scope_control")

#: The window in SQL, shared by both queries so they cannot drift apart. Final and
#: visible, like the profile's totals; started inside the window.
_WINDOW = """
    FROM sessions s JOIN session_analysis a ON a.session_id = s.id
    WHERE s.user_id = :u AND s.state = 'final' AND s.visible
      AND s.started_at > now() - make_interval(days => :days)
"""


def builder_profile(db, user_id: str, window_days: int) -> tuple[dict | None, int]:
    """Returns (profile or None, sessions_analysed).

    The count travels separately so the phone can say "2 of 3 sessions analysed" instead
    of showing an empty card with no explanation.
    """
    bodies = [
        r.body
        for r in db.execute(
            text(f"SELECT a.body {_WINDOW} ORDER BY s.started_at DESC, s.id"),
            {"u": user_id, "days": window_days},
        ).all()
    ]
    n = len(bodies)
    if n < MIN_SESSIONS:
        return None, n

    # Per dimension: mean, count, and trend = mean over the most recent half minus mean
    # over the older half, in points. Halves are by session order; with an odd count the
    # median session goes to the older half (rn * 2 <= total is the recent half), so the
    # recent half is never larger than what it is compared against.
    dims = db.execute(
        text(
            f"""
            WITH analysed AS (
              SELECT a.body,
                     ROW_NUMBER() OVER (ORDER BY s.started_at DESC, s.id) AS rn,
                     COUNT(*) OVER () AS total
              {_WINDOW}
            )
            SELECT d->>'dimension' AS dimension,
                   AVG(CAST(d->>'score' AS numeric)) AS mean,
                   COUNT(*) AS n,
                   AVG(CASE WHEN rn * 2 <= total THEN CAST(d->>'score' AS numeric) END)
                     - AVG(CASE WHEN rn * 2 > total THEN CAST(d->>'score' AS numeric) END)
                     AS trend
            FROM analysed, jsonb_array_elements(body->'dimensions') AS d
            GROUP BY d->>'dimension'
            ORDER BY d->>'dimension'
            """
        ),
        {"u": user_id, "days": window_days},
    ).all()

    profile = {
        "window_days": window_days,
        "sessions_analysed": n,
        "confidence_mean": _mean([b.get("confidence") for b in bodies], 3),
        "dimensions": {
            d.dimension: {
                "mean": _rounded(float(d.mean), 1),
                "sessions": int(d.n),
                "trend": _rounded(float(d.trend), 1) if d.trend is not None else None,
            }
            for d in dims
        },
        "archetype": _archetype(bodies),
        "build_style": _build_style(bodies),
        "prompting": _prompting(bodies),
        "tags": _tags(bodies),
        "decision_patterns": _decision_patterns(bodies),
    }
    return profile, n


def _archetype(bodies: list[dict]) -> dict:
    """The modal non-null archetype and the whole distribution.

    `share` is out of the sessions that HAD an archetype, and `with_archetype` says how
    many that was: a session under about fifteen minutes gets none (docs/analysis.md),
    and diluting the share with those would make a person look less like anything.
    """
    counts = Counter(b["archetype"] for b in bodies if b.get("archetype") is not None)
    total = sum(counts.values())
    modal, modal_n = _mode(counts)
    return {
        "modal": modal,
        "share": _rounded(modal_n / total, 3) if total else None,
        "with_archetype": total,
        "distribution": dict(_ranked(counts)),
    }


def _build_style(bodies: list[dict]) -> dict:
    out = {}
    for key in BUILD_STYLE_KEYS:
        values = [b["build_style"][key] for b in bodies if b.get("build_style", {}).get(key)]
        counts = Counter(values)
        mode, mode_n = _mode(counts)
        out[key] = {
            "mode": mode,
            "share": _rounded(mode_n / len(values), 3) if values else None,
            "distribution": dict(_ranked(counts)),
        }
    return out


def _prompting(bodies: list[dict]) -> dict:
    ps = [b["prompting"] for b in bodies if b.get("prompting")]
    return {
        "specificity_mean": _mean([p.get("specificity") for p in ps], 1),
        "correction_share_mean": _mean([p.get("correction_share") for p in ps], 3),
        "question_share_mean": _mean([p.get("question_share") for p in ps], 3),
        "tone_distribution": dict(_ranked(Counter(p["tone"] for p in ps if p.get("tone")))),
    }


def _tags(bodies: list[dict]) -> list[dict]:
    # A tag counts once per session however many times a model repeats it.
    counts = Counter(t for b in bodies for t in set(b.get("tags") or []))
    return [{"tag": t, "sessions": c} for t, c in _ranked(counts)[:TOP_TAGS]]


def _decision_patterns(bodies: list[dict]) -> list[dict]:
    """The most frequent `pattern` strings, case-folded, each with one verbatim excerpt.

    Bodies arrive newest first, so the example and the display casing are the most
    recent time the model named the move.
    """
    counts: Counter[str] = Counter()
    first_seen: dict[str, tuple[str, str]] = {}
    for b in bodies:
        for dp in b.get("decision_patterns") or []:
            pattern = (dp.get("pattern") or "").strip()
            if not pattern:
                continue
            key = pattern.casefold()
            counts[key] += 1
            first_seen.setdefault(key, (pattern, dp.get("prompt_excerpt") or ""))
    return [
        {"pattern": first_seen[k][0], "sessions": c, "example": first_seen[k][1]}
        for k, c in _ranked(counts)[:TOP_PATTERNS]
    ]


def _ranked(counts: Counter) -> list[tuple]:
    """Most common first; ties broken by name so two pulls agree on the order."""
    return sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))


def _mode(counts: Counter) -> tuple[str | None, int]:
    ranked = _ranked(counts)
    return ranked[0] if ranked else (None, 0)


def _mean(values: list, digits: int) -> float | None:
    xs = [float(v) for v in values if v is not None]
    return _rounded(sum(xs) / len(xs), digits) if xs else None


# ------------------------------------------------------------------- corpus metrics
#: `analysis/` lives at the repository root, next to `server/`. The repo-root Dockerfile
#: copies it into the image; the older server-only image does not have it, and the hook
#: channel already handles that shape the same way (`hook_ingest._capture`). Imported
#: lazily so a server without it still boots and still serves the rest of the profile.
_ANALYSIS_ROOT = pathlib.Path(__file__).resolve().parents[2]


class MetricsUnavailable(RuntimeError):
    """`analysis/profile.py` is not deployed on this server."""


def _profile_module():
    try:
        import analysis.profile as ap
    except ImportError:
        root = str(_ANALYSIS_ROOT)
        if root not in sys.path:
            sys.path.insert(0, root)
        try:
            import analysis.profile as ap
        except ImportError as e:  # pragma: no cover - deployment shape, not logic
            raise MetricsUnavailable(str(e)) from e
    return ap


def _rounded(x: float, digits: int | None = None) -> float | int:
    """THE rounding rule for a number a person reads, a tie AWAY from zero off the number as
    it is written (`analysis.plain.rounded`, which the phone's `copy/numbers.ts` mirrors), so
    a dimension mean of 72.25 reads 72.3 here and on the phone alike. Python's own `round`
    sends a tie to the even digit. The server only build (`server/Dockerfile`) ships without
    `analysis/`; there it is `_half_up`, the same arithmetic, which
    `test_the_server_only_rounding_is_the_one_rule` holds to `plain.rounded`."""
    try:
        plain = _profile_module().plain
    except MetricsUnavailable:  # pragma: no cover - deployment shape, not logic
        return _half_up(x, digits)
    return plain.rounded(x, digits)


def _half_up(x: float, digits: int | None = None) -> float | int:
    """`analysis.plain.rounded` where `analysis/` is not shipped. FOUND IN REVIEW (2026-09-14):
    this fell back to Python's `round`, which sends a tie to the even digit, so the server
    only image would say 72.2 where every other surface says 72.3."""
    from decimal import ROUND_HALF_UP, Decimal

    if isinstance(x, int) and not isinstance(x, bool):
        return x
    q = Decimal(repr(float(x))).quantize(Decimal(1).scaleb(-(digits or 0)), rounding=ROUND_HALF_UP)
    return int(q) if digits is None else float(q)


def _final_rows(db, user_id: str, days: int | None, *, repo_hash: str | None = None) -> list:
    """The viewer's FINAL, VISIBLE sessions with their stats, oldest first: the one read of
    the stored corpus, shared by `corpus_metrics` and `eta_history` so the profile and the
    ETA can never disagree about which sessions exist.

    FINAL, VISIBLE is the population the hours total and the graph use, so a person cannot
    find one screen counting a session another screen ignores; `visible` is what capture's
    `is_counted` put on the wire. `days` None reads every stored session (the ETA, whose
    machine side reads every transcript on disk); `repo_hash` narrows to one repository.

    `repo_hash`, not `repo_id`, is the repository key every consumer reads: the commit
    overlap rule only needs one key per repository (repo_hash is UNIQUE in `repos`, so the
    change moves no number), and the hook channel's live state matches its ETA history on
    the payload's `repo_hash`, the one key both sides of the wire hold.
    """
    clauses = ["s.user_id = :u", "s.state = 'final'", "s.visible"]
    params: dict = {"u": user_id}
    if days is not None:
        clauses.append("s.started_at > now() - make_interval(days => :days)")
        params["days"] = days
    if repo_hash is not None:
        clauses.append("r.repo_hash = :rh")
        params["rh"] = repo_hash
    return db.execute(
        text(
            f"""
            SELECT s.id, r.repo_hash, s.started_at, s.ended_at, s.tz_offset_minutes,
                   s.active_seconds, s.attended_seconds, s.autonomous_seconds, s.unattended,
                   s.presence_count,
                   st.tool_calls, st.human_prompt_count, st.lines_added_agent,
                   st.lines_removed_agent, st.commit_count, st.models, st.tokens_reported,
                   st.tok_in, st.tok_out, st.tok_cache_read, st.tok_cache_w5m, st.tok_cache_w1h
            FROM sessions s
            LEFT JOIN session_stats st ON st.session_id = s.id
            LEFT JOIN repos r ON r.id = s.repo_id
            WHERE {" AND ".join(clauses)}
            ORDER BY s.started_at, s.id
            """
        ),
        params,
    ).all()


def corpus_metrics(db, user_id: str, window_days: int) -> dict | None:
    """Every computed metric over the viewer's own sessions in the window, or None.

    None means the module is not deployed. An EMPTY corpus is not None: it is a profile
    whose sample block says there are no sessions, which is a different thing and reads
    differently on the phone.

    The population is `_final_rows`: final, visible sessions started inside the window.
    Live rows move every minute and are excluded here too.
    """
    try:
        ap = _profile_module()
    except MetricsUnavailable:
        return None

    facts = [_session_fact(ap, r) for r in _final_rows(db, user_id, window_days)]
    return refuse_overlapping_model_commits(ap, ap.corpus_profile(facts))


def refuse_overlapping_model_commits(ap, profile: dict) -> dict:
    """Null each model row's `commits` and `usd_per_commit` when the corpus's commit windows
    overlap, with the reason in `commits_refusal`; the code when they do not is null.

    FOUND IN THE ADVERSARIAL REVIEW (2026-09-13): a model's commits are the SUM of the
    stored per session git log counts over the sittings it wrote most of, and two sittings
    running at once in one repository both count every commit in the overlap. The machine
    claims each commit once by its SHA before it sums (`profile.attribute_commits`); the
    server stores no SHA, so its sum is the 31% high figure CLAUDE.md measured, and the
    dollars per commit priced off it flatter every model. The test for "could two sittings
    have seen the same commit" is the one that refuses `totals.total_commits`
    (`profile._corpus_commits`, carried as `totals.commit_basis`): one rule, one function.
    The dollars are unaffected: they are priced per session and never double count."""
    refused = profile["totals"].get("commit_basis") == ap.COMMITS_OVERLAPPING
    for row in profile.get("model_costs") or []:
        if refused:
            row["commits"] = None
            row["usd_per_commit"] = None
        row["commits_refusal"] = ap.COMMITS_OVERLAPPING if refused else None
    return profile


def eta_history(db, user_id: str, *, repo_hash: str | None = None) -> list | None:
    """The finished sessions a live session's ETA compares against, as `SessionFact`s, or
    None when `analysis/` is not deployed (the ETA then refuses `no_history` rather than
    counting zero sessions).

    Only what `analysis.live._eta` reads, built the way the machine side's
    `live.eta_history` builds it from a cut: final and counted (`visible` is what
    `capture.sessions.is_counted` put on the wire), the session's clocks, `repo` as the
    repository key (the hook channel passes the payload's `repo_hash` as `repo_key`), and
    `unattended` as ZERO PRESENCE, the live side's own test (`live.session_state` passes
    `presence == 0`). The stored `sessions.unattended` is the other definition, presence 0
    over a notable span (capture.sessions.build_payload, engine doc 5.7): matching a short
    robot run against attended sittings because the stored flag was never set below
    1200 s would put it among the wrong durations.

    Every stored session, not a window: the machine side compares against every transcript
    it has, and a window here would make the same session's ETA differ by channel.
    """
    try:
        ap = _profile_module()
    except MetricsUnavailable:
        return None
    return [
        ap.SessionFact(
            session_id=str(r.id),
            started_at=r.started_at.timestamp(),
            ended_at=r.ended_at.timestamp(),
            active_seconds=r.active_seconds,
            attended_seconds=r.attended_seconds,
            autonomous_seconds=r.autonomous_seconds,
            tz_offset_minutes=r.tz_offset_minutes,
            repo=r.repo_hash,
            unattended=r.presence_count == 0,
        )
        for r in _final_rows(db, user_id, None, repo_hash=repo_hash)
    ]


def _stored_tokens(ap, r):
    """The five stored buckets as `pricing.Tokens`, or None.

    None unless the session reported tokens AND all five buckets are stored. The wire
    carries the five together (`TokenBucketsWire` requires every one) and stats_tokens_ck
    forbids buckets without `tokens_reported`, so a partial row is not something the door
    can produce; if one ever appears it is refused rather than priced with a zero standing
    in for a bucket nobody measured (Cursor's {0, 0} is exactly that trap).
    """
    buckets = (r.tok_in, r.tok_out, r.tok_cache_read, r.tok_cache_w5m, r.tok_cache_w1h)
    if not r.tokens_reported or any(b is None for b in buckets):
        return None
    return ap.pricing.Tokens(
        input=r.tok_in,
        output=r.tok_out,
        cache_read=r.tok_cache_read,
        cache_w5m=r.tok_cache_w5m,
        cache_w1h=r.tok_cache_w1h,
    )


def _session_fact(ap, r):
    """One stored session as a `SessionFact`, with every basis labelled.

    What the server does NOT have, and therefore never guesses:

      * prompt TEXT and interrupt counts. `human_prompt_count` is a count; the wording of
        a prompt never leaves the machine (privacy/upload-contract.json), so
        `avg_prompt_chars`, `short_prompt_share`, `planning_ratio` and `steer_rate` are
        null here and say so.
      * real tool NAMES. `tool_calls` is an allowlisted map (unknown and MCP tools bucket
        to `other` / `mcp_other`), so it is labelled as such and distinct-name diversity
        is refused rather than undercounted. It also cannot say which Bash call wrote a
        file, so `write_events` is None (unknown), not a count of the edit-tool names.
      * commit TIMES. `commit_count` is a git-log count over the session window, the same
        definition the uploader computes; the strip marks are deduped for rendering and
        are not commit timestamps.
      * per-model output TOKENS, except as shares. `models` carries
        `output_token_share` per model, so share times `tok_out` is the honest
        reconstruction, and it is exactly what the machine-side path uses too.

    What it DOES have and used to drop: the five token buckets. Passing only the output
    split left `tokens` None on every fact, so pricing skipped every session and
    `spend_usd` refused with "no session reported token counts" about sessions that all
    had (docs/overnight-integration.md 5.2). The buckets are priced by
    `analysis.pricing`, the only place a price lives; nothing is priced here.
    """
    tokens: dict[str, int] = {}
    for entry in r.models or []:
        if isinstance(entry, dict) and entry.get("model_id") and r.tok_out:
            tokens[entry["model_id"]] = _rounded(
                float(entry.get("output_token_share") or 0) * r.tok_out
            )
    extra = {}
    if "lines_removed_agent" in _fact_fields(ap):
        # Summed like `lines_added_agent` (totals.total_lines_removed) once the engine takes
        # it. Checked by name because the field lands with WP-B's profile change, and a
        # server that passed it before then would fail every profile with a TypeError.
        extra["lines_removed_agent"] = r.lines_removed_agent or 0
    return ap.SessionFact(
        session_id=str(r.id),
        started_at=r.started_at.timestamp(),
        ended_at=r.ended_at.timestamp(),
        active_seconds=r.active_seconds,
        attended_seconds=r.attended_seconds,
        autonomous_seconds=r.autonomous_seconds,
        tz_offset_minutes=r.tz_offset_minutes,
        prompt_count=r.human_prompt_count or 0,
        interrupts=None,
        tool_calls=dict(r.tool_calls or {}),
        tool_basis=ap.TOOLS_ALLOWLIST if r.tool_calls else ap.TOOLS_ABSENT,
        lines_added_agent=r.lines_added_agent or 0,
        lines_basis=ap.LINES_UPLOADED,
        # UNKNOWN, not zero. Both clients now fold shell writes (`cat > f <<'EOF'`) into
        # `lines_added_agent`, and the uploaded tool map cannot say which Bash call wrote
        # a file, so counting Edit/Write names here would report 0 writes for a session
        # that wrote 2,000 lines and refuse a rate that is real.
        write_events=None,
        commit_count=r.commit_count or 0,
        commit_basis=ap.COMMITS_GIT_LOG,
        # Which repo, so the corpus total can tell whether two overlapping sessions were
        # asking git the same question. Two agents running at once in one repository both
        # count every commit in the overlap, and the SUM of correct per-session numbers is
        # then wrong (analysis/profile.py, COMMITS_OVERLAPPING). The repo_hash, the key the
        # ETA matches on too (`_final_rows`).
        repo=r.repo_hash,
        commit_times=None,
        output_tokens_by_model=tokens,
        tokens=_stored_tokens(ap, r),
        prompts=None,
        test_runs=None,
        unattended=r.unattended,
        **extra,
    )


def _fact_fields(ap) -> frozenset[str]:
    return frozenset(f.name for f in dataclasses.fields(ap.SessionFact))


# ---------------------------------------------------------------------- narrative
def builder_narrative(db, user_id: str) -> dict | None:
    """The stored "how you work" page, or None if this person has never generated one.

    None is not an error and not an empty page: it means the machine-side step that writes
    it (`python -m analysis narrative`) has not run for this account yet, which is the
    normal state for someone who has only ever used the phone.
    """
    row = db.execute(
        text("SELECT body FROM builder_narrative WHERE user_id = :u"),
        {"u": user_id},
    ).first()
    return row.body if row else None


def put_builder_narrative(db, user_id: str, doc: dict) -> None:
    """Replace this person's narrative with `doc`, which the caller has already validated.

    One row per user, upserted: a narrative describes the corpus as it stands, and keeping
    the one it replaced would only let a screen show a description of a corpus that no
    longer exists. `invented_numbers_dropped` is lifted out of the body into its own column
    for one reason: a row where it is not zero is one somebody should read, and finding
    those has to be a WHERE clause rather than a full scan of the prose.
    """
    db.execute(
        text(
            """
            INSERT INTO builder_narrative
              (user_id, narrative_version, model, generated_at, invented_numbers_dropped, body)
            VALUES (:u, :v, :m, :g, :d, CAST(:b AS jsonb))
            ON CONFLICT (user_id) DO UPDATE SET
              narrative_version = EXCLUDED.narrative_version,
              model = EXCLUDED.model,
              generated_at = EXCLUDED.generated_at,
              invented_numbers_dropped = EXCLUDED.invented_numbers_dropped,
              body = EXCLUDED.body,
              updated_at = now()
            """
        ),
        {
            "u": user_id,
            "v": doc["narrative_version"],
            "m": doc.get("model"),
            "g": doc["generated_at"],
            "d": doc.get("invented_numbers_dropped", 0),
            "b": json.dumps(doc),
        },
    )


# ------------------------------------------------------------------------- quotes
def builder_quotes(db, user_id: str) -> dict | None:
    """The stored quotes document (contract v4 `quotes`, 0021), or None.

    The second opt-in exception: up to three prompts, verbatim, for the Wrapped cards that
    quote you. None unless the account has Quote my prompts ON and a document is stored.
    Turning the switch off deletes the row in the same transaction; the read checks the
    switch as well, so a row that somehow outlived it still shows nothing. Owner only by
    RLS on both tables, and read by this route alone: no social query joins it.

    Only the quotes whose sessions are still on the server (`quotes.held_only`), and None
    when none is. FOUND IN THE ADVERSARIAL REVIEW (2026-09-13): a quote typed in an
    excluded repository was served after the repository's sessions were deleted.
    """
    row = db.execute(
        text(
            """
            SELECT q.body FROM builder_quotes q
            JOIN privacy_prefs pp ON pp.user_id = q.user_id AND pp.quotes
            WHERE q.user_id = :u
            """
        ),
        {"u": user_id},
    ).first()
    return quote_store.held_only(db, user_id, row.body) if row else None


# ------------------------------------------------------------------------- report
def builder_report(db, user_id: str) -> dict | None:
    """The stored measured report, or None if this account's machine has never sent one.

    None is the normal state for somebody who has only ever used the phone, and it is not
    the same thing as an empty report: `corpus_metrics` still fills the profile from the
    stored sessions. What is missing without this row is everything the wire cannot carry
    — subagents, shell commands, prompt shape, commit times — and the phone says so rather
    than drawing empty cards.
    """
    row = db.execute(
        text("SELECT body FROM builder_report WHERE user_id = :u"),
        {"u": user_id},
    ).first()
    return row.body if row else None


def without_projects(report: dict, keys: set[str]) -> dict:
    """`report` with the projects keyed by `keys` taken out of its `projects` block, and
    every comparison that names one of them. Pure, so the three places that must apply it
    (the store, the read, the exclusion sweep) apply one rule.

    What else moves with them, so the block still adds up: `projects_total` and
    `history_sessions` lose the dropped projects' own counts, and the rest are ranked again
    from 1. What cannot move: each remaining `share_of_attended` was divided by the attended
    time of every sitting the machine read, an excluded repository's included, so after a
    drop the shares add up to less than 1. RECORDED, not recomputable here: the server holds
    none of the transcripts. The machine side's exclusion (`BUILDER_CAPTURE_EXCLUDE`) never
    reads the repository at all.
    """
    block = report.get("projects")
    if not block or not keys:
        return report
    gone = [p for p in block["projects"] if p["key"] in keys]
    if not gone and not any(
        c.get("high") in keys or c.get("low") in keys for c in block["comparisons"]
    ):
        return report
    kept = [
        {**p, "rank": rank}
        for rank, p in enumerate((p for p in block["projects"] if p["key"] not in keys), 1)
    ]
    block = {
        **block,
        "projects": kept,
        "projects_total": max(0, block["projects_total"] - len(gone)),
        "history_sessions": max(
            0, block["history_sessions"] - sum(p["history"]["sessions"] for p in gone)
        ),
        "comparisons": [
            c
            for c in block["comparisons"]
            if c.get("high") not in keys and c.get("low") not in keys
        ],
    }
    return {**report, "projects": block}


def _report_keys(report: dict | None) -> set[str]:
    block = (report or {}).get("projects") or {}
    keys = {p["key"] for p in block.get("projects") or []}
    keys |= {c[k] for c in block.get("comparisons") or [] for k in ("high", "low") if c.get(k)}
    return keys


def excluded_keys(db, user_id: str, keys: set[str]) -> set[str]:
    """Which of these repository keys the account has excluded, through the one function
    the RLS policies and the upload door ask (`session_repo_excluded`, SECURITY DEFINER, so
    it reads `repo_visibility` whoever the viewer is). A key with no `repos` row cannot have
    been excluded (the visibility row references it)."""
    if not keys:
        return set()
    rows = db.execute(
        text(
            "SELECT r.repo_hash FROM repos r WHERE r.repo_hash = ANY(:k) "
            "AND session_repo_excluded(CAST(:u AS uuid), r.id)"
        ),
        {"u": user_id, "k": sorted(keys)},
    ).all()
    return {r.repo_hash for r in rows}


def project_names(db, user_id: str, keys: set[str]) -> dict[str, str]:
    """The PUBLIC name of each repository key that has one, exactly as a session gets its
    `repo_name`: `repos.public_name`, which only an upload in public mode ever sets and
    visibility `anonymous` clears, and only for a repository the viewer has a session in, so
    a key typed into a report can never fetch a name its sender does not already see. A
    private repository has no name here, ever: the phone labels it."""
    if not keys:
        return {}
    rows = db.execute(
        text(
            """
            SELECT r.repo_hash, r.public_name FROM repos r
            WHERE r.repo_hash = ANY(:k) AND r.public_name IS NOT NULL
              AND NOT session_repo_excluded(CAST(:u AS uuid), r.id)
              AND EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = :u AND s.repo_id = r.id)
            """
        ),
        {"u": user_id, "k": sorted(keys)},
    ).all()
    return {r.repo_hash: r.public_name for r in rows}


def held_report(db, user_id: str, report: dict | None) -> tuple[dict | None, dict[str, str]]:
    """The stored report as the phone may see it, and the public names of its projects:
    every project the account has excluded taken out (`without_projects`), the second lock
    behind the store and the sweep, because a repository can be excluded on the phone after
    the machine that never heard of it uploaded its report."""
    if report is None:
        return None, {}
    keys = _report_keys(report)
    held = without_projects(report, excluded_keys(db, user_id, keys))
    return held, project_names(db, user_id, _report_keys(held))


def forget_project(db, user_id: str, repo_hash: str) -> None:
    """Take one repository out of the stored report, for `POST /v1/repos/visibility` with
    `excluded`: "an excluded repository has NOTHING on the server, not a row that is
    currently filtered". The report is one JSONB row per user, so this rewrites it in place."""
    report = builder_report(db, user_id)
    if report is None:
        return
    cleaned = without_projects(report, {repo_hash})
    if cleaned is report:
        return
    db.execute(
        text(
            "UPDATE builder_report SET body = CAST(:b AS jsonb), updated_at = now() "
            "WHERE user_id = :u"
        ),
        {"u": user_id, "b": json.dumps(cleaned)},
    )


def put_builder_report(db, user_id: str, doc: dict) -> None:
    """Replace this person's report with `doc`, which the caller has already validated.

    One row per user, upserted, no history: a report describes the corpus as it stands,
    and the previous one describes a corpus that no longer exists. `window_days` is lifted
    out of the body beside `report_version` for the reason the version is: a reader
    deciding whether to recompute needs both without parsing the document.

    A project in a repository this account excluded is dropped before anything is stored
    (`without_projects`): the machine that sent it may not know the phone excluded it.
    """
    doc = without_projects(doc, excluded_keys(db, user_id, _report_keys(doc)))
    db.execute(
        text(
            """
            INSERT INTO builder_report
              (user_id, report_version, generated_at, window_days, body)
            VALUES (:u, :v, :g, :w, CAST(:b AS jsonb))
            ON CONFLICT (user_id) DO UPDATE SET
              report_version = EXCLUDED.report_version,
              generated_at = EXCLUDED.generated_at,
              window_days = EXCLUDED.window_days,
              body = EXCLUDED.body,
              updated_at = now()
            """
        ),
        {
            "u": user_id,
            "v": doc["report_version"],
            "g": doc["generated_at"],
            "w": doc["window_days"],
            "b": json.dumps(doc),
        },
    )
