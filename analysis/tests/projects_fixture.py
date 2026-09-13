"""Every sentence `analysis/projects.py` words, reached at least once, from wire shaped input.

Two readers: `scripts/gen_copy.py`, which renders these cases into
`spec/fixtures/projects/sentences.json` so the phone's port (`mobile/src/projects/model.ts`)
is pinned to Python's words, and `test_projects.py`, which holds each input to the spec's
own keys (a case the spec cannot carry would pin the phone to a shape that never arrives)
and checks every comparison metric, stage rule, momentum state and refusal code is here.

The keys are made up and 64 hex long, like a real `repo_hash`; the labels are what the
phone would pass for them (a public name, or the owner's own label).
"""

from __future__ import annotations

import dataclasses
import datetime as dt
import hashlib
import types

from analysis import agents as ag
from analysis import contributions as co
from analysis import corpus as cp
from analysis import languages as lang
from analysis import patterns as pat
from analysis import pricing
from analysis import profile as pf
from analysis import projects as pj
from analysis import quality as q_mod
from analysis import trends as tr
from analysis.tests import corpus_fixture as cf

T0, DAY = cf.T0, cf.DAY

A, B, C = "a" * 64, "b" * 64, "c" * 64


# ------------------------------------------------------ a two project corpus, by hand
NAMES = ("zebraride", "builder")
CHECKOUT = {"zebraride": "/w/zebrapath-ride", "builder": "/w/builder"}


def key(name: str) -> str:
    return hashlib.sha256(name.encode()).hexdigest()


def stub(name: str | None, sid: str, harness: str = "claude_code", root: str | None = None):
    """What `corpus.repository` and `projects.build` read off a kept sitting: its repository
    (hash, display name, checkout), its harness and its client session id."""
    repo = (
        None
        if name is None
        else types.SimpleNamespace(
            hash=key(name), display_name=name, common_root=root or CHECKOUT[name], identity=f"github.com/me/{name}"
        )
    )
    return types.SimpleNamespace(repo=repo, harness=harness, client_session_id=sid)


def priced(f: pf.SessionFact, k: int = 1) -> pf.SessionFact:
    """A fact with the ledger's buckets, one model, and burn split three ways."""
    return dataclasses.replace(
        f,
        tokens=pricing.Tokens(input=1_000 * k, output=2_000 * k, cache_read=50_000 * k, cache_w1h=7_000 * k),
        output_tokens_by_model={"claude-opus-5": 2_000 * k},
        burn_tokens=60_000 * k,
        barren_tokens=6_000 * k,
        unreadable_tokens=3_000 * k,
        barren_causes={"context_replay": (5_000 * k, 1)},
    )


def span(aid: str, start: float, seconds: float = 120.0, kind: str = "general-purpose") -> ag.AgentSpan:
    return ag.AgentSpan(
        agent_id=aid, agent_type=kind, asked="zebracorn brief", started_at=start, ended_at=start + seconds,
        records=3, tool_calls=2, landed=1, failures=0,
    )  # fmt: skip


def hand_cut(
    sittings: list[tuple],
    *,
    now: float,
    commits: dict[str, list[tuple[float, str]]] | None = None,
    spans: list[tuple[ag.AgentSpan, str]] = (),
    deps: dict[str, tuple[str, ...]] | None = None,
    checkout: dict[str, str] | None = None,
    price: bool = True,
) -> cp.Corpus:
    """A `corpus.Corpus` as `corpus.cut` would leave it, built by hand: each sitting with its
    project name (None: unresolved) and, as a third item, its checkout when not the name's
    usual one; commits by checkout, each claimed once by `profile.attribute_commits` (the
    cut's own rule); agents with the sitting that sent them."""
    where = {**CHECKOUT, **(checkout or {})}
    facts, sessions = cf.corpus(*[s[0] for s in sittings])
    roots = [(s[2] if len(s) > 2 else where[s[1]]) if s[1] else None for s in sittings]
    facts = [dataclasses.replace(f, repo=r) for f, r in zip(facts, roots, strict=True)]
    if price:
        facts = [priced(f, i + 1) for i, f in enumerate(facts)]
    by_root = {r: tuple(sorted((commits or {}).get(r, ()), key=lambda x: -x[0])) for r in sorted({r for r in roots if r})}

    def lister(root, since, until):
        return [(f"{root}:{ts}:{s}", ts) for ts, s in by_root.get(root, ()) if since <= ts <= until]

    facts = pf.attribute_commits(facts, roots, lister)
    kept = [stub(s[1], f.session_id, root=r) for s, f, r in zip(sittings, facts, roots, strict=True)]
    log = [(ts, s) for r in sorted(by_root) for ts, s in by_root[r]]
    deps = deps or {}
    return cp.Corpus(
        facts=facts,
        sessions=sessions,
        kept=kept,
        roots=roots,
        fanout=cp.fanout_over([sp for sp, _ in spans]),
        contributions=cp.split_commits([ts for ts, _ in log], facts, now),
        commit_subjects=[s for _, s in log if s.strip()],
        dependencies=[d for r in sorted(by_root) for d in deps.get(r, ())],
        now=now,
        tz=dt.UTC,
        commits=tuple(log),
        dependencies_by_root={r: deps.get(r, ()) for r in by_root},
        commits_by_root=by_root,
        agent_sittings={sp: sid for sp, sid in spans},
    )


def ride(sid: str, start: float, *, attended: float = 1800.0, autonomous: float = 0.0, prompts: int = 3, tests: int = 1) -> cf.Sitting:
    """A zebraride sitting: prompts, a corrective one, edits, test runs and a commit call."""
    s = cf.Sitting(sid, start, attended=attended, autonomous=autonomous)
    for j in range(prompts):
        s.prompt(20 * j, "no, use the zebracorn parser instead" if j == 1 else f"add step {j} to zebracorn")
        s.edit(20 * j + 5, f"/w/zebrapath-ride/src/zebrapath_{j}.py", 40)
        s.tool(20 * j + 8, "ls")
    for t in range(tests):
        s.tool(100 + t, "pytest -q")
    return s


def build(sid: str, start: float, *, attended: float = 1800.0) -> cf.Sitting:
    s = cf.Sitting(sid, start, attended=attended)
    s.prompt(0, "wire the zebracorn schema").edit(5, "/w/builder/server/app.py", 80).tool(9, "pytest")
    s.prompt(30, "thanks").tool(35, "ls")
    return s


NOW = T0 + 20 * DAY


def two_projects(**kw) -> cp.Corpus:
    """Six zebraride sittings a day apart, five builder sittings interleaved, one home
    directory sitting, commits in both checkouts and agents from both."""
    sittings = [(ride(f"r{i}", T0 + i * DAY, autonomous=600.0 * i), "zebraride") for i in range(6)]
    sittings += [(build(f"b{i}", T0 + i * DAY + 6 * 3600), "builder") for i in range(5)]
    sittings += [(cf.Sitting("h0", T0 + 2 * DAY + 3 * 3600).prompt(0, "what time is it").tool(5, "date").tool(6, "ls"), None)]
    commits = two_projects_commits()
    spans = [
        (span("r-agent", T0 + 30), "r0"),
        (span("r-agent-2", T0 + 40), "r0"),
        (span("b-agent", T0 + 6 * 3600 + 20), "b0"),
    ]
    deps = {CHECKOUT["zebraride"]: ("react", "zebrapath-kit"), CHECKOUT["builder"]: ("fastapi",)}
    base = dict(now=NOW, commits=commits, spans=spans, deps=deps)
    base.update(kw)
    return hand_cut(sittings, **base)


def two_projects_commits() -> dict:
    """The commits `two_projects` puts in each checkout."""
    return {
        CHECKOUT["zebraride"]: [
            (T0 + 60, "fix: zebrasubject parser"),
            (T0 + DAY + 60, "feat: zebrasubject step"),
            (T0 + 2 * DAY + 60, "feat: zebrasubject more"),
            (T0 + 9 * DAY, "zebrasubject alone on a quiet day"),
            # While only a builder sitting runs: nothing in zebraride was in the room.
            (T0 + 3 * DAY + 6 * 3600 + 60, "zebrasubject during builder"),
        ],
        CHECKOUT["builder"]: [(T0 + 6 * 3600 + 60, "build: zebrasubject schema")],
    }




def block() -> dict:
    """The projects block of `two_projects`, as the report carries it: the phone's view
    model tests read it from `spec/fixtures/projects/block.json`."""
    return pj.block(two_projects(), 30)

LABELS = {A: "RideGT", B: "builder", C: "site"}


def comparison(metric: str, *, high=A, low=B, hv=None, lv=None, hs=40, ls=6, reason=None, projects=2) -> dict:
    """A `ReportProjectComparison`, its ratio and gap computed the way `_comparison` does."""
    rate = pj.COMPARISONS[metric]["kind"] == "ratio"
    floors = reason == "floors_only"
    ratio = round(hv / lv, 2) if rate and not floors and hv is not None and lv else None
    gap = round(hv - lv, 3) if not floors and hv is not None and lv is not None else None
    below = reason == "fewer_than_two_projects"
    return {
        "metric": metric,
        "high": None if below else high,
        "low": None if below else low,
        "high_value": None if below else hv,
        "low_value": None if below else lv,
        "high_sessions": None if below else hs,
        "low_sessions": None if below else ls,
        "ratio": None if below else ratio,
        "gap": None if below else gap,
        "projects": projects,
        "needed": pat.MIN_GROUP if below else None,
        "reason": reason,
    }


def comparison_cases() -> list[tuple[str, dict]]:
    """(name, comparison): every metric that can answer answered, every `none` form, every
    refusal, the two floors refused, a share near its ends, dollars on both sides of $100,
    and "twice"."""
    cases = [
        ("steer_twice", comparison("steer_rate", hv=0.6, lv=0.3)),
        ("steer_none", comparison("steer_rate", hv=0.42, lv=0.0)),
        ("autonomy", comparison("autonomy_score", hv=0.55, lv=0.12)),
        ("tools", comparison("tool_calls_per_prompt", hv=46.2, lv=11.1)),
        ("tools_none", comparison("tool_calls_per_prompt", hv=12.0, lv=0.0)),
        ("prompts", comparison("prompts_per_session", hv=6.9, lv=2.6)),
        ("prompts_none", comparison("prompts_per_session", hv=4.0, lv=0.0)),
        ("tests_floors", comparison("test_runs_per_hour", hv=10.42, lv=4.84, reason="floors_only")),
        ("velocity_floors", comparison("code_velocity", hv=4261.8, lv=424.9, reason="floors_only")),
        ("usd", comparison("usd_per_active_hour", hv=61.5, lv=22.1)),
        ("green", comparison("first_try_rate", hv=0.909, lv=0.6)),
        ("ships", comparison("ships_rate", hv=0.62, lv=0.2)),
        ("night", comparison("night_share", hv=0.469, lv=0.004)),
        ("night_ends", comparison("night_share", high=C, hv=0.996, lv=0.2)),
        ("steer_close", comparison("steer_rate", hv=0.419, lv=0.385, reason="within_noise")),
        ("usd_close", comparison("usd_per_active_hour", hv=138.26, lv=134.12, reason="within_noise")),
        ("usd_close_cents", comparison("usd_per_active_hour", hv=38.26, lv=34.12, reason="within_noise")),
        ("green_close", comparison("first_try_rate", hv=0.909, lv=0.799, reason="within_noise")),
        ("tools_close", comparison("tool_calls_per_prompt", hv=5.0, lv=4.2, reason="within_noise")),
        ("ships_none_qualify", comparison("ships_rate", reason="fewer_than_two_projects", projects=0)),
        ("ships_one_qualifies", comparison("ships_rate", reason="fewer_than_two_projects", projects=1)),
    ]
    return cases


def history(rule: str, *, since: int = 0, age: int = 30, recent: int = 9, prior: int = 10) -> dict:
    """The fields of a `ReportProjectHistory` the stage and last session sentences read."""
    return {
        "stage": pj.STAGE_OF_RULE[rule],
        "stage_rule": rule,
        "days_since_last": since,
        "age_days": age,
        "days_built_recent": recent,
        "days_built_before": prior,
    }


def stage_cases() -> list[tuple[str, dict]]:
    return [
        ("dormant", history("quiet_two_weeks", since=20, recent=0, prior=3)),
        ("winding_quiet", history("quiet_a_week", since=7, recent=1, prior=6)),
        ("winding_cadence", history("cadence_halved", since=2, recent=2, prior=9)),
        ("winding_cadence_one", history("cadence_halved", since=1, recent=1, prior=4)),
        ("starting_today", history("new_this_fortnight", age=0, recent=1, prior=0)),
        ("starting_yesterday", history("new_this_fortnight", since=1, age=1, recent=1, prior=0)),
        ("starting_days", history("new_this_fortnight", since=3, age=5, recent=3, prior=0)),
        ("active", history("steady", recent=12, prior=13)),
        ("active_one", history("steady", since=1, recent=1, prior=1)),
    ]


def momentum(direction=None, move=None, reason=None, *, now=5, before=6) -> dict:
    """A `ReportProjectMomentum`."""
    return {
        "days": pj.MOMENTUM_DAYS,
        "sessions": now,
        "sessions_before": before,
        "attended_seconds": 30_000,
        "attended_seconds_before": 5_842,
        "direction": direction,
        "move": move,
        "reason": reason,
        "needed": tr.MIN_SESSIONS if reason == "below_session_floor" else None,
    }


def momentum_cases() -> list[tuple[str, dict]]:
    return [
        ("up", momentum("up", 4.134)),
        ("down", momentum("down", -0.42)),
        ("down_to_nothing", momentum("down", -1.0)),
        ("steady", momentum("steady", 0.08)),
        ("below_floor", momentum(reason="below_session_floor", now=0, before=1)),
        ("nothing_before", momentum(reason="nothing_before", now=5, before=4)),
    ]


def refusal_cases() -> list[tuple[str, str, dict]]:
    """(name, which reader, the block it reads): every `PROJECT_REFUSALS` code."""
    return [
        ("quality_floor", "quality", {"runs": 2, "reason": "below_run_floor", "needed": q_mod.MIN_RUNS}),
        ("quality_one_run", "quality", {"runs": 1, "reason": "below_run_floor", "needed": q_mod.MIN_RUNS}),
        ("quality_recovery", "quality", {"runs": 12, "reason": "no_recovery", "needed": None}),
        ("languages_floor", "languages", {"lines": 40, "reason": "below_line_floor", "needed": lang.MIN_LINES}),
        ("clock_floor", "clock", {"active_minutes": 25, "reason": "below_active_floor", "needed_minutes": 60}),
        ("cost_no_price", "cost", {"commits": 0, "unpriced_sessions": 0, "reason": "no_price", "needed": None}),
        ("cost_unpriced", "cost", {"commits": 9, "unpriced_sessions": 1, "reason": "unpriced_sessions", "needed": None}),
        ("cost_unpriced_many", "cost", {"commits": 9, "unpriced_sessions": 3, "reason": "unpriced_sessions", "needed": None}),
        ("cost_not_git", "cost", {"commits": 4, "unpriced_sessions": 0, "reason": "commits_not_from_git", "needed": None}),
        ("cost_floor", "cost", {"commits": 3, "unpriced_sessions": 0, "reason": "below_commit_floor", "needed": co.MIN_COMMITS}),
        ("cost_one_commit", "cost", {"commits": 1, "unpriced_sessions": 0, "reason": "below_commit_floor", "needed": co.MIN_COMMITS}),
    ]


READERS = {
    "quality": pj.quality_refusal,
    "languages": pj.languages_refusal,
    "clock": pj.clock_refusal,
    "cost": pj.cost_refusal,
}


def entries() -> list[dict]:
    """The fixture: each case beside the words Python says about it."""
    out: list[dict] = []
    for name, c in comparison_cases():
        out.append({"kind": "comparison", "name": name, "input": c, "labels": LABELS, "sentence": pj.comparison_sentence(c, LABELS)})
    for name, h in stage_cases():
        out.append(
            {
                "kind": "stage",
                "name": name,
                "input": h,
                "display": pj.STAGE_DISPLAY[h["stage"]],
                "sentence": pj.stage_sentence(h),
                "last": pj.last_session_sentence(h),
            }
        )
    for name, m in momentum_cases():
        out.append({"kind": "momentum", "name": name, "input": m, "sentence": pj.momentum_sentence(m)})
    for name, reader, block in refusal_cases():
        out.append({"kind": "refusal", "name": name, "reader": reader, "input": block, "sentence": READERS[reader](block)})
    return out
