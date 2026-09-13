"""THE BUILDER REPORT: the second of the two documents, and the one about the person.

docs/analysis-complete.md draws the line these two live on. The session card says what
just happened in one sitting. This says how somebody builds, whether it is changing, and
what they could do about it — and it is the document that has to survive being read twice
a month without going stale, because a profile nobody revisits is a signup screen.

WHAT IS IN IT, AND WHY EACH BLOCK EARNED ITS PLACE:

  trends         you against you, two equal windows. The only comparison available: there
                 is no cohort, and "top decile of what" is not a question a percentile can
                 answer for one person's coding.
  agents         how many subagents ran and how much of it was at once. Read from sidecar
                 transcripts that every other tool on this machine skips, and it never
                 contributes a token, a line or a commit to any total.
  contributions  commits split by whether an agent was in the room. The question a wall of
                 green squares cannot answer and this machine can.
  quality        the two of DORA's four questions a transcript can answer, and the module
                 that refuses the other two rather than greping `fix` out of git log.
  prompting      how often a prompt lands cleanly. A COUNT AND NOTHING ELSE.
  coverage       what all of the above actually rests on. A window is a QUESTION and
                 this is how much of it the machine could answer, which is the one thing
                 a report can get catastrophically wrong in silence.
  languages      what you actually build in, by lines the agent added. Every code stats
                 product has this and this one did not; the language NAME is all that
                 travels, and a name is not a path.

VERSION 2 appends five blocks (docs/overnight-integration.md section 1): `wrapped`, the
fifteen cards; `money`, list price dollars beside tokens and lines; `burn`, the tokens
spent in stretches that changed nothing; `vocab`, the glossary; `stack`, what the project
is made of. Inside them no field is a string: ids, enums, numbers and clocks only, and a
refusal is an enum code the phone turns into words. `build` sends all five as None, which
means only "this machine does not compute it"; `from_corpus`, the one builder both
commands call, fills them through `report_blocks.py`.

WHAT IT DELIBERATELY LEAVES OUT. `analysis/rules.py` turns recurring failures into
CLAUDE.md lines, and those lines quote ERROR TEXT, which carries paths and file names. It
stays on the machine and is written to a file there. The playbook splits PROMPTS by
whether they worked; only the two counts travel, so not one word of a prompt appears in
this document. That is the same line privacy/upload-contract.json draws everywhere else,
and it is drawn here rather than at the server because the server never sees the input.

NULL IS NOT ZERO, in every block. Each one is None when it was refused, and the refusals
carry their reason, because a person looking at an empty chart concludes the product is
broken and a person reading "5 test runs, 5 needed" concludes they should run the tests.
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Sequence

from . import languages as lang_mod
from . import playbook as pb_mod
from . import quality as q_mod
from . import trends as tr_mod

#: The window every block looks back over, and the length of EACH of the two trend
#: windows. Thirty days is one month of habit; the trend then reaches sixty days back,
#: which is why the report is not honest about somebody's first month and says so by
#: returning no trends rather than comparing a fortnight against a fortnight.
DEFAULT_WINDOW_DAYS = 30

#: The spec version. `spec/report.v1.json` is the only other place this number appears,
#: and `scripts/gen_report.py` copies it into both generated halves. Version 2 added the
#: five nullable blocks in `V2_BLOCKS`; a version 1 document still validates.
REPORT_VERSION = 2

#: The blocks version 2 appended, in spec order. Each is None until this machine computes
#: it: a null block says "not computed here", never "nothing happened", and never a zero.
V2_BLOCKS: tuple[str, ...] = ("wrapped", "money", "burn", "vocab", "stack")

#: Caps from the spec, restated where the document is BUILT rather than only where it is
#: validated. A corpus with two years of commits would otherwise produce a document the
#: server rejects with a 422 the user cannot act on, months after anyone touched this.
MAX_TRENDS = 24
MAX_AGENT_TYPES = 12
MAX_DAYS = 400
MAX_LANGUAGES = 12


def build(
    *,
    profile: dict | None = None,
    trends: Sequence = (),
    fanout=None,
    contributions=None,
    sessions: Sequence = (),
    window_days: int = DEFAULT_WINDOW_DAYS,
    generated_at: float | None = None,
) -> dict:
    """Assemble the report from what the machine already measured.

    `trends`, `fanout` and `contributions` arrive already computed, because both callers
    (`python -m analysis report` and `python -m capture report`) compute them for the
    narrative too and computing them twice is how two commands come to describe one corpus
    with two different numbers. `quality` and `prompting` are derived here, from the same
    `sessions`, because they are pure functions of the events and nothing else wants them.
    """
    ts = dt.datetime.fromtimestamp(generated_at or dt.datetime.now().timestamp(), dt.UTC)
    trimmed = list(trends)[:MAX_TRENDS]
    return {
        "report_version": REPORT_VERSION,
        "generated_at": ts.isoformat().replace("+00:00", "Z"),
        "window_days": window_days,
        "coverage": _coverage(profile, window_days),
        "trend_headline": tr_mod.headline(trimmed, window_days) if trimmed else None,
        "trends": [_trend(t) for t in trimmed],
        "agents": _agents(fanout),
        "contributions": _contributions(contributions),
        "quality": _quality(sessions),
        "prompting": _prompting(sessions),
        "languages": _languages(sessions),
        # Not computed here yet, and None says exactly that: a block of zeroes would say
        # nothing happened (docs/overnight-integration.md 1.2).
        **dict.fromkeys(V2_BLOCKS),
    }


def recent_trends(facts: Sequence, window_days: int, now: float) -> list:
    """The last `window_days` against the `window_days` before, on the cut's own clock.
    Empty when there is not enough history, which is the normal state for a first month
    and not an error.

    The two windows are always the SAME LENGTH. A window against all of history reports
    the trend of the corpus growing, and a 7 day window labelled "on last month" is a
    wrong sentence attached to a right number.
    """
    from . import profile as pf_mod

    edge, floor = now - window_days * 86400, now - 2 * window_days * 86400
    recent = [f for f in facts if f.started_at >= edge]
    earlier = [f for f in facts if floor <= f.started_at < edge]
    if not recent or not earlier:
        return []
    return tr_mod.compare(pf_mod.corpus_profile(earlier), pf_mod.corpus_profile(recent))


def from_corpus(corpus, window_days: int = DEFAULT_WINDOW_DAYS, *, quotes: bool = False) -> tuple[dict, dict | None]:
    """THE ONE BUILDER: the report over one cut (`analysis.corpus.cut`), every block, and
    with `quotes=True` the opt in quotes document beside it (None otherwise).

    `python -m analysis report` and `python -m capture report` both call this with the
    cut `corpus.cut` made, so the two cannot describe one corpus with two documents. Every
    block reads the same profile, on the cut's clock: the report's coverage, the wrapped
    cards, the money and the burn say what they rest on from one set of numbers. Nothing
    here reads a file or runs git; the cut already did.
    """
    from . import profile as pf_mod
    from . import report_blocks as rb_mod
    from . import vocab as vc_mod
    from . import wrapped as wr_mod

    c = corpus
    profile = pf_mod.corpus_profile(c.facts, now=c.now)
    doc = build(
        profile=profile,
        trends=recent_trends(c.facts, window_days, c.now),
        fanout=c.fanout,
        contributions=c.contributions,
        sessions=c.sessions,
        window_days=window_days,
        generated_at=c.now,
    )
    cards = wr_mod.wrapped(
        c.facts,
        c.sessions,
        profile=profile,
        contributions=c.contributions,
        fanout=c.fanout,
        commit_subjects=c.commit_subjects,
        quotes=quotes,
    )
    doc["wrapped"] = rb_mod.wrapped_block(wr_mod.wire(cards))
    doc["money"] = rb_mod.money_block(profile, c.facts)
    doc["burn"] = rb_mod.burn_block(profile)
    doc["vocab"] = rb_mod.vocab_block(vc_mod.wire(vc_mod.glossary(c.sessions)))
    doc["stack"] = rb_mod.stack_block(
        vc_mod.wire(vc_mod.stack(c.sessions, dependencies=c.dependencies))
    )
    return doc, (wr_mod.quotes_upload(cards, generated_at=c.now) if quotes else None)


def _coverage(profile: dict | None, window_days: int) -> dict | None:
    """What the report rests on: the window asked for, beside what was actually there.

    THE BUG THIS EXISTS FOR. Run this in a fresh container and it will answer a thirty day
    question with two days of transcripts and say nothing about the difference. I did
    exactly that and read the result out as a fact about a person who has been building
    for over a month: "109 commits, none written alone" was a statement about a container
    that had existed for two days, and there was no number anywhere in the document that
    would have caught it.

    BOTH NUMBERS, ALWAYS, AND NO VERDICT. There is no threshold here and no "partial"
    flag, because the honest thing is not a warning at some ratio somebody picked: it is
    printing what was asked for beside what was found and letting the reader see it. 30
    against 2 needs no adjective.

    `spans_days` is the calendar distance from the first sitting to the last, which is a
    different question from how many days had a sitting in them. Two sittings a month
    apart are 2 active days across 30, and reading one as the other is how this went
    wrong in the first place.
    """
    if not profile:
        return None
    sample = profile.get("sample") or {}
    return {
        "window_days": window_days,
        "spans_days": int(sample.get("spans_days") or 0),
        "active_days": int(sample.get("days") or 0),
        "sessions": int(sample.get("sessions") or 0),
        "first_at": sample.get("first_at"),
        "last_at": sample.get("last_at"),
    }


def _trend(t) -> dict:
    return {
        "metric": t.metric,
        "label": t.label,
        "before": round(float(t.before), 4),
        "now": round(float(t.now), 4),
        "move": round(float(t.move), 4),
        "direction": t.direction,
        "good": t.good,
        "sessions_before": t.sessions_before,
        "sessions_now": t.sessions_now,
    }


def _agents(fanout) -> dict | None:
    """The fan-out block, or None when this person has never delegated.

    `produced` is the number worth having beside `agents`: an agent that ran and did
    nothing at all cost tokens and returned air, and the difference between 52 agents and
    51 that produced something is the difference between a boast and a measurement. It is
    `Fanout`'s own property rather than a second count of the same thing here.
    """
    if fanout is None or not fanout.agents:
        return None
    by_type = sorted(fanout.by_type.items(), key=lambda kv: (-kv[1], kv[0]))
    return {
        "agents": fanout.agents,
        "produced": fanout.produced,
        "max_concurrent": fanout.max_concurrent,
        "agent_seconds": round(fanout.agent_seconds, 1),
        "wall_seconds": round(fanout.wall_seconds, 1),
        "busy_seconds": round(fanout.busy_seconds, 1),
        "parallelism": round(fanout.parallelism, 2),
        "by_type": [
            {"name": name, "agents": n} for name, n in by_type[:MAX_AGENT_TYPES]
        ],
    }


def _contributions(c) -> dict | None:
    """Commits by day, most recent `MAX_DAYS` of them.

    The tail is what gets dropped, not the head: a graph missing last week is a broken
    graph, and one missing the same week two years ago is a graph.
    """
    if c is None:
        return None
    days = list(c.days)[-MAX_DAYS:]
    return {
        "assisted": c.assisted,
        "alone": c.alone,
        "active_days": c.active_days,
        "longest_streak": c.longest_streak,
        "current_streak": c.current_streak,
        "days": [
            {"day": d.day.isoformat(), "assisted": d.assisted, "alone": d.alone} for d in days
        ],
    }


def _quality(sessions: Sequence) -> dict | None:
    """Time to green and first try rate, or the refusal with the count that forced it."""
    if not sessions:
        return None
    s = q_mod.summary(sessions)
    green = s.get("time_to_green")
    return {
        "runs": s["runs"],
        "passed": s.get("passed"),
        "failed": s.get("failed"),
        "first_try_rate": s.get("first_try_rate"),
        "time_to_green": (
            {
                "n": green["n"],
                "median_seconds": green["median_seconds"],
                "worst_seconds": green["worst_seconds"],
                "median_attempts": green["median_attempts"],
            }
            if green
            else None
        ),
        "reason": s.get("reason"),
    }


def _prompting(sessions: Sequence) -> dict | None:
    """How often a prompt lands cleanly. THE COUNTS ONLY.

    `playbook.attempts` carries the prompt TEXT — that is the whole point of it on the
    machine, where it prints the two piles for somebody to read. Nothing below touches
    `.text`, and this is the only function in this package that reads attempts and is
    also uploaded.
    """
    if not sessions:
        return None
    s = pb_mod.summary(pb_mod.attempts(sessions))
    return {
        "attempts": s["n"],
        "clean": s.get("worked"),
        "costly": s.get("cost"),
        "clean_share": s.get("value"),
        "reason": s.get("reason"),
    }


def _languages(sessions: Sequence) -> dict | None:
    """Lines by language, or the refusal with the count that forced it.

    The names come from a fixed table of extensions in `analysis/languages.py`; the FILES
    are a count and never a name, because paths do not leave the machine. Generated files
    are excluded by name and the excluded total is reported, since a person whose line
    count drops by three thousand after an install deserves to know where it went.
    """
    if not sessions:
        return None
    s = lang_mod.split(sessions)
    langs = s["languages"]
    return {
        "lines": s["lines"],
        "generated_lines_excluded": s["generated_lines_excluded"],
        "languages": langs[:MAX_LANGUAGES] if langs else None,
        "reason": s["reason"],
    }


__all__ = [
    "DEFAULT_WINDOW_DAYS",
    "MAX_AGENT_TYPES",
    "MAX_DAYS",
    "MAX_LANGUAGES",
    "MAX_TRENDS",
    "REPORT_VERSION",
    "V2_BLOCKS",
    "build",
    "from_corpus",
    "recent_trends",
]
