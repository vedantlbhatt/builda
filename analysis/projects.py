"""PROJECTS: the report's own blocks, asked of one repository at a time.

docs/projects.md is the design and the metric list; this module is its engine. The owner's
question: the profile describes a person and the session card one sitting, and neither
says how somebody builds EACH project, which ones they work on most, or where a project is
in its life. Everything here is a reading of the one corpus cut (`corpus.cut`), narrowed
to one repository by `corpus.repository` and to the report's window by `corpus.window`,
and then handed to the SAME functions the corpus profile uses: `profile.corpus_profile`,
`wrapped.wrapped`, `report_blocks`, `quality.summary`, `languages.split`, `vocab.stack`,
`trends.compare`. No project number is computed a second way. The only rules written here
are the ones that have no corpus twin: the lifecycle stage, the comparisons across
projects, and the cost of a commit.

TWO SCOPES, AND EACH NUMBER SAYS WHICH. A report window is a question (CLAUDE.md, the
window rule), so every project carries two objects and never mixes them:

  * `history`: every sitting this machine holds in that repository, however old. The
    lifecycle stage and the streak need it: a project nobody touched for six weeks is not
    in a 30 day window at all, and "dormant" is the whole point of saying so.
  * `window`: the report's window only (`window_days`), exactly as `corpus.window` cuts it
    for the rest of the report. Null when the project had no sitting in it.

PRIVACY. A project travels as its KEY, the repository's salted hash (`corpus.repo_key`,
the `repo_hash` every session upload already carries). Its name is LOCAL: the name of a
repository you have not marked public never leaves the machine, and the server puts a
public repository's name beside the key when it serves the block, from the same `repos`
row every session reads its name from. Inside the block every field is an enum, a number,
a clock or a key: no string a person reads, and every refusal an enum code the phone words.

NULL IS NOT ZERO. A project with no commit read has `commits` null, never a graph of
nothing; a comparison two projects cannot support is refused with a code, never a ratio
over nothing.

WEEK BY WEEK. The phone draws where the hours went week by week (its rivers and its rank
race), so the block carries one week axis (`weeks`: the last `WEEKS` ISO weeks, never
before the machine's first sitting, each with the days of it history covers) and every
project's sittings on it (`history.weeks`), from the same narrowed cut `history` reads. A
week with no sitting in a project is a measured 0 there; a week history does not reach is
not on the axis at all. The order of the projects within a week is the phone's to draw
(`projects/model.ts weeklyRanks`), from these numbers alone: a server that drops an
excluded project leaves the others' weeks untouched, and a rank written here would keep
the dropped project's place.
"""

from __future__ import annotations

import collections
import dataclasses
import datetime as dt
from collections.abc import Mapping, Sequence

from . import contributions as co
from . import corpus as cp
from . import languages as lang
from . import patterns as pat
from . import profile as pf
from . import quality as q_mod
from . import report_blocks as rb
from . import trends as tr
from . import vocab
from . import wrapped as wr

# ------------------------------------------------------------------------------ caps
#: Projects the block carries, most attended time in the window first. The same cap
#: `GET /v1/profile` puts on its project list (`LIMIT 20`), so the two lists can be read
#: side by side; `projects_total` says how many there were, so the cap is never silent.
#: MEASURED on `~/.claude/projects` (2026-09-13): 13 repositories over 359 sittings.
MAX_PROJECTS = 20

#: The Wrapped cards a project carries, in `wrapped.CARD_IDS` order. The three cards that
#: read the WORDS of prompts (go to prompt, crash out, cryptic prompt) are the person's,
#: not the project's, and two of them are LOCAL (`wrapped.LOCAL_CARDS`); the other twelve
#: are asked of the project's sittings exactly as the report asks them of every sitting.
PROJECT_CARDS: tuple[str, ...] = tuple(
    c for c in wr.CARD_IDS if c not in ("go_to_prompt", "crash_out", "cryptic_prompt")
)

# ------------------------------------------------------------------ the lifecycle stage
#: The four stages, in the order a project lives through them.
STAGES: tuple[str, ...] = ("starting", "active", "winding_down", "dormant")

#: Which rule decided the stage, in the order the rules run (`_stage`). The phone words
#: the stage from this, so "winding down" can say whether it is the silence or the cadence.
STAGE_RULES: tuple[str, ...] = (
    "quiet_two_weeks",
    "quiet_a_week",
    "cadence_halved",
    "new_this_fortnight",
    "steady",
)
STAGE_OF_RULE: dict[str, str] = {
    "quiet_two_weeks": "dormant",
    "quiet_a_week": "winding_down",
    "cadence_halved": "winding_down",
    "new_this_fortnight": "starting",
    "steady": "active",
}

#: Days since the last sitting at which a project is dormant. UNMEASURED JUDGEMENT CALL,
#: set beside a measurement: over the 70 gaps between consecutive days built inside one
#: repository on `~/.claude/projects` (13 repositories, 359 sittings, 2026-09-13) the
#: median is 1 day, p90 4, p95 6 and the longest 14 (builder, which came back after it).
#: So dormant is "longer than any break but one on this machine", a description of the
#: silence and never a prediction: the copy says how long, not that it is over.
DORMANT_AFTER_DAYS = 14

#: Days since the last sitting at which a project is winding down. UNMEASURED JUDGEMENT
#: CALL past the same measurement's p95 (6 days): a silence longer than 95 in 100 of the
#: breaks after which work on a project resumed.
WINDING_AFTER_DAYS = 7

#: A project whose first sitting is this recent is starting. UNMEASURED JUDGEMENT CALL:
#: two weeks, the span the cadence rule below needs before "the fortnight before" exists.
STARTING_WITHIN_DAYS = 14

#: The cadence rule compares the days built in the last `CADENCE_DAYS` with the days built
#: in the `CADENCE_DAYS` before, and calls it winding down when the recent count is under
#: half the earlier one. UNMEASURED JUDGEMENT CALL, both numbers.
CADENCE_DAYS = 14
#: ...and only when the earlier fortnight had this many days built, so "half" is a fall and
#: not one day against two. UNMEASURED JUDGEMENT CALL.
CADENCE_MIN_PRIOR_DAYS = 4

# ------------------------------------------------------------------------ momentum
#: Momentum is the last `MOMENTUM_DAYS` against the `MOMENTUM_DAYS` before, attended
#: seconds, through `trends.compare`: its session floor (`trends.MIN_SESSIONS` a side) and
#: its noise floor (`trends.MIN_MOVE`), so a project's week is judged by the rule the
#: report's month is. The copy says "week", so a test pins this to 7.
MOMENTUM_DAYS = 7
MOMENTUM_METRIC = "attended_hours"
MOMENTUM_REFUSALS: tuple[str, ...] = ("below_session_floor", "nothing_before")

# --------------------------------------------------------------------------- weeks
#: ISO weeks the weekly series carries, the current one included (`_week_axis`). UNMEASURED
#: JUDGEMENT CALL: a quarter of a year, which a phone draws at about 30 points a week; the
#: corpus docs/projects.md measures reaches five. A week is Monday to Monday on the LOCAL day
#: cut at 04:00 (`profile.local_day`, the one day rule), and a sitting belongs to the week of
#: the day it started, the way `_momentum` windows by the start. Weeks before the machine's
#: first sitting are not carried at all (absent, never zero), so a young history is a shorter
#: series and not one padded with weeks nobody measured.
WEEKS = 12

# --------------------------------------------------------------------- comparisons
#: Every comparison across projects, in the order the block carries them: the metric, how
#: a value is said (`says`: `share` by `burn._share_words`, `number` by `profile._n`, `usd`
#: by the phone's `dollars`), how it is compared (`kind`: `ratio` is high over low against
#: `patterns.MIN_LIFT`; `share` is high less low against `patterns.MIN_SHARE_GAP`, because
#: 2% against 1% is a 2x lift and means nothing), a title for the phone, and the sentence
#: templates. `times` is said by `times_words` ("twice", "3.4 times"); `none` is the ratio's
#: form when the low project's value is a measured 0. Every value is read from a block the
#: project already carries, never recomputed (`_window`).
#:
#: `floor: "yes"` marks a metric that is only ever a LOWER BOUND on the machine, and a
#: comparison of two floors is refused (`floors_only`): each project's floor falls short by
#: its own amount, so their ratio is a ratio of two unknown shortfalls. MEASURED on
#: `~/.builder-overnight/corpus` over the 30 day window (2026-09-13, docs/projects.md):
#: `test_runs_per_hour` reads test commands off the digest's cut command text, and 44 of
#: builder's 66 test commands survive the cut against 338 of RideGT's 718, so the floors'
#: ratio said builder tests 2.1 times as often where the full commands say 1.5; and
#: `code_velocity` cannot see an edit a script makes (`profile.py`: "a LOWER BOUND"), and
#: 26% of builder's shell calls run a script against 31% of RideGT's.
COMPARISONS: dict[str, dict[str, str]] = {
    "steer_rate": {
        "says": "share",
        "kind": "ratio",
        "label": "How often you take the wheel back",
        "times": "You take the wheel back {times} as often in {high} as in {low}.",
        "none": "You take the wheel back in {high}, and not once in {low}.",
    },
    "autonomy_score": {
        "says": "share",
        "kind": "share",
        "label": "Time the agent runs without you",
        "share": "{high} runs without you more: {high_share} of its time, against {low_share} in {low}.",
    },
    "test_runs_per_hour": {
        "says": "number",
        "kind": "ratio",
        "floor": "yes",
        "label": "How often you run the tests",
    },
    "tool_calls_per_prompt": {
        "says": "number",
        "kind": "ratio",
        "label": "Tool calls for each prompt",
        "times": "Each prompt sets off {times} as many tool calls in {high} as in {low}.",
        "none": "Prompts in {high} set off tool calls, and prompts in {low} set off none.",
    },
    "prompts_per_session": {
        "says": "number",
        "kind": "ratio",
        "label": "Prompts a session",
        "times": "You send {times} as many prompts a session in {high} as in {low}.",
        "none": "You send prompts in {high}, and sessions in {low} had none.",
    },
    "code_velocity": {
        "says": "number",
        "kind": "ratio",
        "floor": "yes",
        "label": "Lines an hour",
    },
    "usd_per_active_hour": {
        "says": "usd",
        "kind": "ratio",
        "label": "Cost an hour at API list prices",
        "times": "An hour of {high} costs {times} what an hour of {low} does, at API list prices.",
    },
    "first_try_rate": {
        "says": "share",
        "kind": "share",
        "label": "Tests already green",
        "share": "Tests are already green more often in {high}: {high_share} of runs, against {low_share} in {low}.",
    },
    "ships_rate": {
        "says": "share",
        "kind": "share",
        "label": "Sessions that end with a commit",
        "share": "Sessions in {high} end with a commit more often: {high_share}, against {low_share} in {low}.",
    },
    "night_share": {
        "says": "share",
        "kind": "share",
        "label": "Work between 10pm and 4am",
        "share": "More of {high} happens between 10pm and 4am: {high_share} of its time, against {low_share} in {low}.",
    },
}
COMPARISON_METRICS: tuple[str, ...] = tuple(COMPARISONS)

#: Why a comparison says nothing, as the code the block carries and its words.
#: `fewer_than_two_projects`: under two projects have `patterns.MIN_GROUP` sessions in the
#: window AND the metric answered (its own floor); `n` is how many did. `within_noise`: two
#: did, and the gap is under the bar; the numbers still travel, so the phone can show them.
#: `floors_only`: two did, and the metric is a lower bound (`COMPARISONS` `floor`); both
#: floors travel, and no ratio and no gap.
COMPARISON_REFUSALS: dict[str, str | dict[str, str]] = {
    "fewer_than_two_projects": {
        "zero": "No project has {needed:session} in this window with this number yet.",
        "one": "Only one project has {needed:session} in this window with this number, so there is nothing to compare it with.",
        "other": "No two projects have {needed:session} in this window with this number yet.",
    },
    "within_noise": "{high} and {low} are close on this: {high_value} against {low_value}.",
    "floors_only": (
        "Both are only lower bounds, at least {high_value} in {high} and at least {low_value} in "
        "{low}. Either could be higher by any amount, so they cannot be compared."
    ),
}

# ------------------------------------------------------------------- the other codes
#: Why a project's number is null, as the code the block carries and its words, filled by
#: `profile.fill` with the block's own numbers (`n`, `needed`). One template per code.
PROJECT_REFUSALS: dict[str, str | dict[str, str]] = {
    # `quality`: fewer than `quality.MIN_RUNS` test runs; or runs enough, and nothing failed
    # and then passed inside one sitting (the rate answers, the time to green does not).
    "below_run_floor": "{n:test run} in this window, {needed} needed.",
    "no_recovery": "Nothing failed and then passed inside one session.",
    # `languages`: fewer attributable lines than `languages.MIN_LINES`.
    "below_line_floor": "{n:attributable line} in this window, {needed} needed.",
    # `clock`: less active time than the profile's peak hour needs.
    "below_active_floor": "{n:minute} of active time here, {needed} needed.",
    # `usd_per_commit`, in the order `_cost_per_commit` checks them.
    "no_price": "No dollar figure for this project in this window.",
    "unpriced_sessions": "{n:session} used a model with no published price, so a cost a commit would be too low.",
    "commits_not_from_git": "The commits were not counted from git log.",
    "below_commit_floor": "{n:commit} landed in these sessions, {needed} needed.",
}

#: The stage in two words, and the sentence each rule is worded with (`profile.fill`).
STAGE_DISPLAY: dict[str, str] = {
    "starting": "Starting",
    "active": "Active",
    "winding_down": "Winding down",
    "dormant": "Dormant",
}
STAGE_SENTENCES: dict[str, str | dict[str, str]] = {
    "quiet_two_weeks": "No session here for {n:day}.",
    "quiet_a_week": "No session here for {n:day}.",
    "cadence_halved": "Sessions on {n:day} of the last {cadence_days}, against {prior} the {cadence_days} before.",
    "new_this_fortnight": {
        "zero": "The first session here was today.",
        "one": "The first session here was yesterday.",
        "other": "The first session here was {n:day} ago.",
    },
    "steady": {
        "one": "A session on 1 of the last {cadence_days} days.",
        "other": "Sessions on {n} of the last {cadence_days} days.",
    },
}
LAST_SESSION: dict[str, str] = {
    "zero": "Last session today.",
    "one": "Last session yesterday.",
    "other": "Last session {n:day} ago.",
}
MOMENTUM_SENTENCES: dict[str, str | dict[str, str]] = {
    "up": "Up {move} on the week before.",
    "down": "Down {move} on the week before.",
    "steady": "About the same as the week before.",
    "below_session_floor": "Needs {needed:session} in each of the last two weeks to say which way it is going.",
    "nothing_before": "Nothing with you there the week before, so there is nothing to compare with.",
}

#: Constants a phone screen names that no block carries.
PROJECT_CONSTANTS: dict[str, int] = {
    "min_group": pat.MIN_GROUP,
    "cadence_days": CADENCE_DAYS,
    "momentum_days": MOMENTUM_DAYS,
    "dormant_after_days": DORMANT_AFTER_DAYS,
    "winding_after_days": WINDING_AFTER_DAYS,
    "max_projects": MAX_PROJECTS,
    "weeks": WEEKS,
}

#: Every refusal code a project number can carry, per the spec enum that holds it.
QUALITY_REFUSALS: tuple[str, ...] = ("below_run_floor", "no_recovery")
LANGUAGE_REFUSALS: tuple[str, ...] = ("below_line_floor",)
CLOCK_REFUSALS: tuple[str, ...] = ("below_active_floor",)
COST_REFUSALS: tuple[str, ...] = ("no_price", "unpriced_sessions", "commits_not_from_git", "below_commit_floor")


# ============================================================================ helpers
def _today(c: cp.Corpus) -> dt.date:
    """Today on the cut's clock, cut at 04:00 at the zone's offset on that instant: the one
    day rule (`profile.local_day`), never the calendar date."""
    return pf.local_day(c.now, cp._offset_minutes(c.now, c.tz))


def _seconds(facts: Sequence[pf.SessionFact], attr: str) -> int:
    return round(sum(getattr(f, attr) for f in facts))


def times_words(ratio: float) -> str:
    """A ratio as a person says it: "twice" at 2, "3.4 times" otherwise, one decimal at
    most (`profile._n`)."""
    said = pf._n(ratio)
    return "twice" if said == "2" else f"{said} times"


def _share(x: float) -> str:
    """A share as `burn._share_words` says it: "under 1%" for a positive share that rounds
    to 0, "over 99%" short of all of it. The one rule for a share near its ends."""
    from . import burn

    return burn._share_words(x)


# ============================================================================ history
def _stage(days_since_last: int, age_days: int, recent: int, prior: int) -> str:
    """The rule that decides a project's stage (`STAGE_RULES`), first match wins. Dates only:
    no floor, because "the first session was today" and "no session for three weeks" are
    true of one sitting as of a hundred."""
    if days_since_last >= DORMANT_AFTER_DAYS:
        return "quiet_two_weeks"
    if days_since_last >= WINDING_AFTER_DAYS:
        return "quiet_a_week"
    if prior >= CADENCE_MIN_PRIOR_DAYS and recent * 2 < prior:
        return "cadence_halved"
    if age_days < STARTING_WITHIN_DAYS:
        return "new_this_fortnight"
    return "steady"


def _momentum(facts: Sequence[pf.SessionFact], now: float) -> dict:
    """Attended time in the last `MOMENTUM_DAYS` against the `MOMENTUM_DAYS` before, judged
    by `trends.compare` (its session floor and its noise floor), windowed the way
    `report.recent_trends` windows: by the sitting's start, the edge on the cut's clock."""
    span = MOMENTUM_DAYS * 86400
    recent = [f for f in facts if f.started_at >= now - span]
    earlier = [f for f in facts if now - 2 * span <= f.started_at < now - span]
    a = sum(f.attended_seconds for f in earlier)
    b = sum(f.attended_seconds for f in recent)

    def as_profile(fs: Sequence, seconds: float) -> dict:
        return {"sample": {"sessions": len(fs)}, "metrics": {MOMENTUM_METRIC: {"value": seconds / 3600}}}

    found = tr.compare(as_profile(earlier, a), as_profile(recent, b), metrics=[MOMENTUM_METRIC])
    t = found[0] if found else None
    reason = None
    if t is None:
        # Why `compare` said nothing, read off the numbers it was given: a side under its
        # session floor, or nothing with you there before (a move from 0 is no ratio).
        reason = "below_session_floor" if min(len(earlier), len(recent)) < tr.MIN_SESSIONS else "nothing_before"
    return {
        "days": MOMENTUM_DAYS,
        "sessions": len(recent),
        "sessions_before": len(earlier),
        "attended_seconds": round(b),
        "attended_seconds_before": round(a),
        "direction": t.direction if t else None,
        "move": t.move if t else None,
        "reason": reason,
        "needed": tr.MIN_SESSIONS if reason == "below_session_floor" else None,
    }


def _history(sub: cp.Corpus, profile: Mapping, today: dt.date) -> dict:
    """Every sitting this machine holds in the repository, however old (`history`)."""
    facts = sub.facts
    sample = profile["sample"]
    built = sorted({f.local_day for f in facts})
    attended_days = sorted({f.local_day for f in facts if pf.is_attended(f)})
    since_last = (today - built[-1]).days
    age = (today - built[0]).days
    recent = sum(1 for d in built if 0 <= (today - d).days < CADENCE_DAYS)
    prior = sum(1 for d in built if CADENCE_DAYS <= (today - d).days < 2 * CADENCE_DAYS)
    rule = _stage(since_last, age, recent, prior)
    return {
        "sessions": len(facts),
        "first_at": sample["first_at"],
        "last_at": sample["last_at"],
        "active_days": int(sample["days"]),
        "spans_days": int(sample["spans_days"]),
        "active_seconds": _seconds(facts, "active_seconds"),
        "attended_seconds": _seconds(facts, "attended_seconds"),
        "autonomous_seconds": _seconds(facts, "autonomous_seconds"),
        # The profile's own streak: attended days in a row (an unattended run never extends
        # one), and the run still going by `contributions._streaks`'s rule (yesterday still
        # counts, because today is not over). Null when no sitting had you there.
        "longest_streak_days": profile["metrics"]["longest_streak_days"]["value"],
        "current_streak_days": co._streaks(attended_days, today)[1] if attended_days else None,
        "days_since_last": since_last,
        "age_days": age,
        "days_built_recent": recent,
        "days_built_before": prior,
        "stage": STAGE_OF_RULE[rule],
        "stage_rule": rule,
        "momentum": _momentum(facts, sub.now),
    }


# ============================================================================== weeks
def week_of(day: dt.date) -> dt.date:
    """The Monday of `day`'s ISO week. `day` is already a local day cut at 04:00
    (`profile.local_day`), so a week runs from Monday 04:00 to the next Monday 04:00."""
    return day - dt.timedelta(days=day.weekday())


def _week_axis(facts: Sequence[pf.SessionFact], today: dt.date) -> list[dt.date]:
    """The Mondays the weekly series is read on: the last `WEEKS` ISO weeks through today's,
    and never a week before the one holding the first sitting the machine has."""
    if not facts:
        return []
    this = week_of(today)
    start = max(week_of(min(f.local_day for f in facts)), this - dt.timedelta(weeks=WEEKS - 1))
    if start > this:
        return []
    return [start + dt.timedelta(weeks=i) for i in range((this - start).days // 7 + 1)]


def _week_days(week: dt.date, first: dt.date, today: dt.date) -> int:
    """Days of `week` the machine's history covers: 7, fewer in the week history starts
    and in today's, which counts today."""
    lo, hi = max(week, first), min(week + dt.timedelta(days=6), today)
    return max(0, (hi - lo).days + 1)


def _weekly(facts: Sequence[pf.SessionFact], axis: Sequence[dt.date]) -> list[dict]:
    """One project's sittings per week of `axis`, every week present. A week with no sitting
    here is a MEASURED 0: the machine holds every sitting of the weeks on the axis, and the
    axis never reaches back past the first of them."""
    at = {w: i for i, w in enumerate(axis)}
    sessions = [0] * len(axis)
    attended = [0.0] * len(axis)
    active = [0.0] * len(axis)
    for f in facts:
        i = at.get(week_of(f.local_day))
        if i is None:
            continue
        sessions[i] += 1
        attended[i] += f.attended_seconds
        active[i] += f.active_seconds
    return [
        {
            "week": rb._day_iso(w),
            "sessions": sessions[i],
            "attended_seconds": round(attended[i]),
            "active_seconds": round(active[i]),
        }
        for i, w in enumerate(axis)
    ]


def _weeks(facts: Sequence[pf.SessionFact], axis: Sequence[dt.date], today: dt.date) -> list[dict]:
    """The block's week axis: each Monday, the days of it history covers, and every counted
    sitting in it (every project, unresolved and past the cap alike), which is what a
    project's share of a week is out of."""
    if not axis:
        return []
    first = min(f.local_day for f in facts)
    every = _weekly(facts, axis)
    return [
        {"week": row["week"], "days": _week_days(w, first, today), "sessions": row["sessions"], "attended_seconds": row["attended_seconds"]}
        for w, row in zip(axis, every, strict=True)
    ]


# ============================================================================= window
def _quality(sessions: Sequence) -> dict:
    """`report._quality` (which is `quality.summary`), with its refusal in words replaced
    by the code the numbers it was decided on name."""
    from . import report as rp

    q = dict(rp._quality(sessions))
    below = q["runs"] < q_mod.MIN_RUNS
    q["reason"] = "below_run_floor" if below else ("no_recovery" if q["time_to_green"] is None else None)
    q["needed"] = q_mod.MIN_RUNS if below else None
    return q


def _languages(sessions: Sequence) -> dict:
    """`languages.split`, each language as its `language` enum value (the name the table
    gives it), and the refusal as its code."""
    s = lang.split(sessions)
    rows = s["languages"]
    return {
        "lines": s["lines"],
        "generated_lines_excluded": s["generated_lines_excluded"],
        "languages": (
            [{"language": r["name"], "lines": r["lines"], "files": r["files"], "share": r["share"]} for r in rows]
            if rows
            else None
        ),
        "reason": None if rows else "below_line_floor",
        "needed": None if rows else lang.MIN_LINES,
    }


def _commits(c: co.Contributions | None) -> dict | None:
    """The project's commit graph (`corpus.repository`'s split: assisted means a sitting in
    THIS repository was running), days as the local day at midnight UTC, the same spelling
    the money block gives `prices_read_on`. Null when no commit was read."""
    from . import report as rp

    if c is None:
        return None
    return {
        "assisted": c.assisted,
        "alone": c.alone,
        "active_days": c.active_days,
        "longest_streak": c.longest_streak,
        "current_streak": c.current_streak,
        "days": [
            {"day": rb._day_iso(d.day), "assisted": d.assisted, "alone": d.alone}
            for d in list(c.days)[-rp.MAX_DAYS :]
        ],
    }


def _clock(profile: Mapping, active_seconds: float) -> dict:
    """The profile's peak hour, or its refusal: it needs `MIN_ACTIVE_SEC_FOR_SHARES`."""
    v = profile["metrics"]["peak_hour"]["value"]
    return {
        "peak_hour": v,
        "reason": None if v is not None else "below_active_floor",
        "active_minutes": int(active_seconds // 60),
        "needed_minutes": None if v is not None else round(pf.MIN_ACTIVE_SEC_FOR_SHARES / 60),
    }


def _cost_per_commit(money: Mapping, facts: Sequence[pf.SessionFact]) -> dict:
    """Dollars at list prices over the commits the SAME sittings claimed.

    Numerator and denominator describe one set of sittings, the rule the per model dollars
    a commit follows (`profile.corpus_profile` `model_costs`): the window's priced
    dollars (`money.usd`) over `commit_count`, each commit claimed once across sittings by
    `profile.attribute_commits`. Refused in this order: no dollars; a sitting the price
    table could not price (its commits would be counted and its dollars not, so the cost
    would read low); commits not from `git log`; fewer than `contributions.MIN_COMMITS`.
    """
    commits = sum(f.commit_count for f in facts)
    reason, needed = None, None
    if money["usd"] is None:
        reason = "no_price"
    elif money["unpriced_sessions"]:
        reason = "unpriced_sessions"
    elif any(f.commit_basis != pf.COMMITS_GIT_LOG for f in facts):
        reason = "commits_not_from_git"
    elif commits < co.MIN_COMMITS:
        reason, needed = "below_commit_floor", co.MIN_COMMITS
    return {
        "usd": round(money["usd"] / commits, 2) if reason is None else None,
        "commits": commits,
        "unpriced_sessions": int(money["unpriced_sessions"]),
        "reason": reason,
        "needed": needed,
    }


def _harnesses(sub: cp.Corpus) -> list[dict]:
    """Which tools wrote the project's sittings: sittings and active seconds per contract
    `harness` value, most active time first. A hand built cut names none."""
    n: collections.Counter[str] = collections.Counter()
    secs: collections.Counter[str] = collections.Counter()
    for f, s in zip(sub.facts, sub.kept, strict=True):
        h = cp.harness_of(s)
        if h is None:
            continue
        n[h] += 1
        secs[h] += f.active_seconds
    return [
        {"harness": h, "sessions": n[h], "active_seconds": round(secs[h])}
        for h in sorted(n, key=lambda h: (-secs[h], h))
    ]


@dataclasses.dataclass
class _Local:
    """What the machine keeps about one project beside its wire block: the name, the
    checkouts, the Wrapped cards as Python words them, and the values the comparisons read.
    NEVER on the wire."""

    key: str
    name: str | None
    checkouts: list[str]
    cards: list[dict]
    values: dict[str, tuple[float | None, int]]


def _window(sub: cp.Corpus, profile: Mapping, total_attended: float) -> tuple[dict, list[dict], dict]:
    """The report's window, one repository: (the wire block, the LOCAL cards, the values
    the comparisons read)."""
    from . import report as rp

    facts = sub.facts
    sample = profile["sample"]
    m = profile["metrics"]
    result = wr.wrapped(
        facts,
        sub.sessions,
        profile=profile,
        contributions=sub.contributions,
        fanout=sub.fanout,
        commit_subjects=sub.commit_subjects,
    )
    local_cards = [c for c in result["cards"] if c["id"] in PROJECT_CARDS]
    cards = [rb.wrapped_card(c) for c in wr.wire(result)["cards"] if c["id"] in PROJECT_CARDS]
    money = rb.money_block(profile, facts)
    quality = _quality(sub.sessions)
    attended = sum(f.attended_seconds for f in facts)
    active = sum(f.active_seconds for f in facts)
    block = {
        "sessions": len(facts),
        "first_at": sample["first_at"],
        "last_at": sample["last_at"],
        "active_days": int(sample["days"]),
        "active_seconds": round(active),
        "attended_seconds": round(attended),
        "autonomous_seconds": _seconds(facts, "autonomous_seconds"),
        "share_of_attended": round(attended / total_attended, 3) if total_attended > 0 else None,
        "clock": _clock(profile, active),
        "cards": cards,
        "scores": [rb._score(s) for s in profile["archetype"]["scores"]],
        "quality": quality,
        "languages": _languages(sub.sessions),
        "commits": _commits(sub.contributions),
        "money": money,
        "usd_per_commit": _cost_per_commit(money, facts),
        "burn": rb.burn_block(profile),
        "stack": rb.stack_block(vocab.wire(vocab.stack(sub.sessions, dependencies=sub.dependencies))),
        "agents": rp._agents(sub.fanout),
        "harnesses": _harnesses(sub),
    }
    per_session = next(c for c in local_cards if c["id"] == "prompts_per_session")
    values = {
        "steer_rate": m["steer_rate"]["value"],
        "autonomy_score": m["autonomy_score"]["value"],
        "test_runs_per_hour": m["test_runs_per_hour"]["value"],
        # The card's own two numbers, over the attended sittings it counts, so a comparison
        # says the number the project's card shows (`wrapped._prompts_per_session`).
        "tool_calls_per_prompt": per_session["extras"]["tool_calls_per_prompt"],
        "prompts_per_session": per_session["value"],
        "code_velocity": m["code_velocity"]["value"],
        "usd_per_active_hour": money["usd_per_active_hour"],
        "first_try_rate": quality["first_try_rate"],
        "ships_rate": m["ships_rate"]["value"],
        "night_share": m["night_share"]["value"],
    }
    return block, local_cards, {k: (v, len(facts)) for k, v in values.items()}


# ======================================================================== comparisons
def _comparison(metric: str, rows: Sequence[tuple[str, int, float | None, int]]) -> dict:
    """One comparison across projects: the highest and the lowest of the projects that
    cleared the floor, or the refusal. `rows` are (key, rank, value, sessions in window)."""
    spec = COMPARISONS[metric]
    ratio_kind = spec["kind"] == "ratio"
    # A project qualifies with `patterns.MIN_GROUP` sessions in the window and the metric
    # answered by its own floor. A measured 0 qualifies only where the sentence has a form
    # for it ("and not once in builder"); elsewhere a 0 is a floor's leftover, never a side.
    ok = [
        (key, rank, v, n)
        for key, rank, v, n in rows
        if v is not None and n >= pat.MIN_GROUP and (v > 0 or "none" in spec or not ratio_kind)
    ]
    floor = spec.get("floor") == "yes"
    out = {
        "metric": metric,
        "high": None,
        "low": None,
        "high_value": None,
        "low_value": None,
        "high_sessions": None,
        "low_sessions": None,
        "ratio": None,
        "gap": None,
        "projects": len(ok),
        "needed": None,
        "reason": None,
    }
    if len(ok) < 2:
        out.update(reason="fewer_than_two_projects", needed=pat.MIN_GROUP)
        return out
    # Highest value first, ties by rank: the high side of a tie is the project with more of
    # your time, the low side the one with less.
    ordered = sorted(ok, key=lambda r: (-r[2], r[1]))
    hi, lo = ordered[0], ordered[-1]
    gap = hi[2] - lo[2]
    # A ratio only for a rate: a share is compared in points, and its ratio is no claim.
    ratio = hi[2] / lo[2] if ratio_kind and lo[2] > 0 else None
    out.update(
        high=hi[0],
        low=lo[0],
        high_value=hi[2],
        low_value=lo[2],
        high_sessions=hi[3],
        low_sessions=lo[3],
        ratio=round(ratio, 2) if ratio is not None and not floor else None,
        gap=round(gap, 3) if not floor else None,
    )
    if floor:
        # Two lower bounds, each short by its own amount: the numbers travel, a difference
        # between them is never stated (`COMPARISONS`, the measurement behind `floor`).
        out["reason"] = "floors_only"
        return out
    if ratio_kind:
        real = ratio is None and hi[2] > 0 or ratio is not None and ratio >= pat.MIN_LIFT
    else:
        real = gap >= pat.MIN_SHARE_GAP
    if not real:
        out["reason"] = "within_noise"
    return out


def _comparisons(entries: Sequence[tuple[str, int, dict]]) -> list[dict]:
    """Every metric of `COMPARISONS`, answered or refused, in that order. `entries` are
    (key, rank, values) for the projects with a window."""
    return [
        _comparison(metric, [(key, rank, values[metric][0], values[metric][1]) for key, rank, values in entries])
        for metric in COMPARISON_METRICS
    ]


# ============================================================================== build
def build(everything: cp.Corpus, window_days: int) -> dict:
    """The projects over one cut: `{"wire": <the report's projects block>, "projects":
    [LOCAL, one per project in the block's order], "unresolved_names": ...}`.

    `everything` is the WHOLE cut (`corpus.cut`), never a window: `history` reads every
    sitting and `window` narrows each project with `corpus.window`, the rule the rest of the
    report reads. The LOCAL half carries each project's name (`RepoIdentity.display_name`)
    and checkouts for the printer, and never reaches the wire (`wire`)."""
    today = _today(everything)
    groups: dict[str, list[int]] = collections.defaultdict(list)
    names: dict[str, str | None] = {}
    unresolved: list[int] = []
    kept = everything.kept if len(everything.kept) == len(everything.facts) else [None] * len(everything.facts)
    for i, s in enumerate(kept):
        key = cp.repo_key(s)
        if key is None:
            unresolved.append(i)
            continue
        groups[key].append(i)
        names.setdefault(key, s.repo.display_name)

    edge = everything.now - window_days * 86400
    in_window = [f for f in everything.facts if f.started_at >= edge]
    total_attended = sum(f.attended_seconds for f in in_window)
    # One week axis for every project, so the weekly series line up week for week.
    axis = _week_axis(everything.facts, today)

    built: list[tuple[str, dict, list[dict], dict, list[str]]] = []
    for key in groups:
        whole = cp.repository(everything, key)
        history = _history(whole, pf.corpus_profile(whole.facts, now=whole.now), today)
        history["weeks"] = _weekly(whole.facts, axis)
        sub = cp.window(whole, window_days)
        window, cards, values = (None, [], {})
        if sub.facts:
            window, cards, values = _window(sub, pf.corpus_profile(sub.facts, now=sub.now), total_attended)
        checkouts = sorted({r for r in whole.roots if r})
        built.append((key, {"key": key, "rank": 0, "history": history, "window": window}, cards, values, checkouts))

    # Most of your time in the window first; a project with no window after, most recent
    # last session first; the key breaks a tie, so the order is total.
    built.sort(
        key=lambda b: (
            -(b[1]["window"]["attended_seconds"] if b[1]["window"] else -1),
            b[1]["history"]["days_since_last"],
            b[0],
        )
    )
    built = built[:MAX_PROJECTS]
    for rank, b in enumerate(built, 1):
        b[1]["rank"] = rank

    comparisons = _comparisons([(b[0], b[1]["rank"], b[3]) for b in built if b[1]["window"] is not None])
    un_win = [everything.facts[i] for i in unresolved if everything.facts[i].started_at >= edge]
    wire_block = {
        "window_days": window_days,
        "history_sessions": len(everything.facts),
        "history_first_at": pf._iso(min(f.started_at for f in everything.facts)) if everything.facts else None,
        "projects_total": len(groups),
        "projects": [b[1] for b in built],
        "unresolved": {
            "sessions": len(un_win),
            "active_seconds": _seconds(un_win, "active_seconds"),
            "attended_seconds": _seconds(un_win, "attended_seconds"),
            "history_sessions": len(unresolved),
        },
        "comparisons": comparisons,
        "weeks": _weeks(everything.facts, axis, today),
        # Every counted sitting in the window, listed projects, projects past the cap and the
        # unresolved alike: what each `share_of_attended` is out of, so a screen that says "94%
        # of it" can say how much "it" is without summing a capped list.
        "window_attended_seconds": round(total_attended),
    }
    local = [
        _Local(key=b[0], name=names.get(b[0]), checkouts=b[4], cards=b[2], values=b[3]) for b in built
    ]
    return {"wire": wire_block, "projects": local}


def block(everything: cp.Corpus, window_days: int) -> dict:
    """The report's `projects` block (`ReportProjects`), what `report.from_corpus` emits."""
    return build(everything, window_days)["wire"]


def wire(result: Mapping) -> dict:
    """What may leave the machine: the block, and nothing of the LOCAL half."""
    return result["wire"]


# =============================================================================== copy
def _label(key: str, labels: Mapping[str, str]) -> str:
    return labels.get(key) or "this project"


def dollars(usd: float) -> str:
    """Dollars as the phone says them (`mobile/src/copy/money.ts` `dollars`, the one rule on
    that side): whole dollars from $100, cents below. Here so the sentences this module
    words and the phone's port of them say one figure; `spec/fixtures/projects` pins the two."""
    return f"${usd:,.0f}" if abs(usd) >= 100 else f"${usd:,.2f}"


def value_words(metric: str, v: float) -> str:
    """A compared value as the sentences say it, by the metric's `says`."""
    says = COMPARISONS[metric]["says"]
    if says == "share":
        return _share(v)
    if says == "usd":
        return dollars(v)
    return pf._n(v)


def comparison_sentence(c: Mapping, labels: Mapping[str, str]) -> str:
    """The sentence for one comparison, answered or refused, with the projects named by
    `labels` (key to the words for it: a name on the machine, on the phone a public name or
    the owner's own label). The phone's port is `mobile/src/projects/model.ts`, pinned by
    `spec/fixtures/projects/sentences.json`."""
    metric = c["metric"]
    spec = COMPARISONS[metric]
    if c["reason"] == "fewer_than_two_projects":
        return pf.fill(COMPARISON_REFUSALS["fewer_than_two_projects"], n=c["projects"], needed=c["needed"])
    high, low = _label(c["high"], labels), _label(c["low"], labels)
    if c["reason"] in ("within_noise", "floors_only"):
        return pf.fill(
            COMPARISON_REFUSALS[c["reason"]],
            high=high,
            low=low,
            high_value=value_words(metric, c["high_value"]),
            low_value=value_words(metric, c["low_value"]),
        )
    if spec["kind"] == "share":
        return pf.fill(
            spec["share"],
            high=high,
            low=low,
            high_share=value_words(metric, c["high_value"]),
            low_share=value_words(metric, c["low_value"]),
        )
    if c["ratio"] is None:
        return pf.fill(spec["none"], high=high, low=low)
    return pf.fill(spec["times"], high=high, low=low, times=times_words(c["ratio"]))


def stage_sentence(history: Mapping) -> str:
    """The stage's sentence, from the rule that decided it and the numbers it read."""
    rule = history["stage_rule"]
    if rule in ("quiet_two_weeks", "quiet_a_week"):
        n = history["days_since_last"]
    elif rule == "new_this_fortnight":
        n = history["age_days"]
    else:
        n = history["days_built_recent"]
    return pf.fill(STAGE_SENTENCES[rule], n=n, prior=history["days_built_before"], cadence_days=CADENCE_DAYS)


def last_session_sentence(history: Mapping) -> str:
    return pf.fill(LAST_SESSION, n=history["days_since_last"])


def momentum_sentence(m: Mapping) -> str:
    """The week against the week before, or why it is not said."""
    if m["reason"] is not None:
        return pf.fill(MOMENTUM_SENTENCES[m["reason"]], needed=m["needed"])
    if m["direction"] == "steady":
        return MOMENTUM_SENTENCES["steady"]
    return pf.fill(MOMENTUM_SENTENCES[m["direction"]], move=_share(abs(m["move"])))


def refusal_sentence(code: str, *, n: int | None = None, needed: int | None = None) -> str:
    """Why a project's number is null (`PROJECT_REFUSALS`)."""
    return pf.fill(PROJECT_REFUSALS[code], n=n, needed=needed)


# Each block's refusal, with the count its template names read from the block itself: one
# reader per block, so the printer and the phone's port pick the same number.
def quality_refusal(q: Mapping) -> str | None:
    return None if q["reason"] is None else refusal_sentence(q["reason"], n=q["runs"], needed=q["needed"])


def languages_refusal(lg: Mapping) -> str | None:
    return None if lg["reason"] is None else refusal_sentence(lg["reason"], n=lg["lines"], needed=lg["needed"])


def clock_refusal(c: Mapping) -> str | None:
    return None if c["reason"] is None else refusal_sentence(c["reason"], n=c["active_minutes"], needed=c["needed_minutes"])


def cost_refusal(c: Mapping) -> str | None:
    if c["reason"] is None:
        return None
    n = c["unpriced_sessions"] if c["reason"] == "unpriced_sessions" else c["commits"]
    return refusal_sentence(c["reason"], n=n, needed=c["needed"])


__all__ = [
    "CADENCE_DAYS",
    "CADENCE_MIN_PRIOR_DAYS",
    "CLOCK_REFUSALS",
    "COMPARISONS",
    "COMPARISON_METRICS",
    "COMPARISON_REFUSALS",
    "COST_REFUSALS",
    "DORMANT_AFTER_DAYS",
    "LANGUAGE_REFUSALS",
    "LAST_SESSION",
    "MAX_PROJECTS",
    "MOMENTUM_DAYS",
    "MOMENTUM_REFUSALS",
    "MOMENTUM_SENTENCES",
    "PROJECT_CARDS",
    "PROJECT_CONSTANTS",
    "PROJECT_REFUSALS",
    "QUALITY_REFUSALS",
    "STAGES",
    "STAGE_DISPLAY",
    "STAGE_OF_RULE",
    "STAGE_RULES",
    "STAGE_SENTENCES",
    "STARTING_WITHIN_DAYS",
    "WINDING_AFTER_DAYS",
    "block",
    "build",
    "clock_refusal",
    "comparison_sentence",
    "cost_refusal",
    "dollars",
    "languages_refusal",
    "quality_refusal",
    "last_session_sentence",
    "momentum_sentence",
    "refusal_sentence",
    "stage_sentence",
    "times_words",
    "value_words",
    "wire",
]
