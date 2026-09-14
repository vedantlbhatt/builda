"""What a person could DO differently, with the two numbers that say why.

`profile.py` measures the corpus: how much, how fast, how often. This module asks the
only question that is worth a paragraph on somebody's profile, which is **what would you
change tomorrow**. Every finding here compares two groups of that person's own sessions
and reports the gap, so each sentence carries its own evidence AND its consequence:

    "Sessions where your first message ran past 200 characters ended in a commit 8 of 9
     times. The ones where you dived straight in: 2 of 7."

THREE RULES, and the first two are the ones a finding usually fails.

1. A FINDING NAMES A COST OR A MOVE. "Your later prompts are shorter than your first"
   is a true sentence with nothing on the other end of it; nobody can act on it and
   nobody asked. The same measurement becomes useful the moment it is attached to
   whether the session shipped. If a comparison cannot be finished with "so it cost
   you X" or "so do Y", it does not belong here.

2. NO WORD THE READER WOULD HAVE TO LOOK UP. Not "steer rate", not "front-loading",
   not "autonomy score 0.361". Say "you had to take the wheel back" and "you let it
   run". Every internal metric name in this file stays in `left`/`right`, where a
   screen can show the working, and out of `text`, which a person reads.

3. BOTH SIDES BIG ENOUGH, GAP BIG ENOUGH, OR SAY NOTHING. `MIN_GROUP = 5` observations
   a side and `MIN_LIFT = 1.4` (or `MIN_SHARE_GAP = 0.15` points). Below either bar the
   finding is dropped, not softened. A sentence that says "you slightly prefer" about
   three sessions against four reads as insight and is noise.

Everything here needs PROMPT TEXT, the tool results around it and the timings between,
so it runs on a machine that has the transcripts. The server never sees prompt wording
(privacy/upload-contract.json) and cannot compute a single one of these.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
import re
from collections.abc import Sequence

from . import plain

#: Both sides of a comparison need this many observations. Five is not a lot; it is the
#: point below which one different session swings the whole ratio.
MIN_GROUP = 5

#: A ratio under this is not a pattern, it is two numbers that happen to differ. 1.4 is a
#: judgement call and is labelled as one: it is roughly where a difference stops being
#: explicable by one unusual session in a corpus of ten.
MIN_LIFT = 1.4

#: Share comparisons use points rather than a ratio: 2% against 1% is a 2x lift and means
#: nothing.
MIN_SHARE_GAP = 0.15

#: `short_prompt_share` in profile.py uses the same cut, so the two agree about what a
#: short prompt is.
SHORT_PROMPT_WORDS = 10

#: A stretch of tool calls with nothing to show for it. Below this it is the agent
#: reading the code before it edits, which is work. MEASURED on a 17-session corpus: the
#: median run between two file writes is 4 tool calls, p90 is 18, and the longest is 130.
#: 25 sits above the ninetieth percentile of normal work and well under the outliers.
SPIN_TOOL_CALLS = 25

#: Consecutive failing tool results before it stops being a fix and starts being a loop.
STUCK_FAILURES = 4

#: A file written this many times in one sitting is being fought with.
REWORK_WRITES = 4

#: The local hour a late session starts after (or before 04:00, the day boundary).
NIGHT_FROM = 22
DAY_BOUNDARY_HOUR = 4

#: Running the tests, imported rather than re-written: three regexes that drift produce
#: three different answers to "how often do you test" and no way to tell which is right.
from .quality import TEST_CMD as _TEST_CMD
#: And committing, the digest's one pattern (`git -c k=v commit` included), for the same reason.
from .digest import COMMIT_CMD as _COMMIT_CMD


@dataclasses.dataclass(frozen=True)
class Finding:
    """One comparison, with the sentence and both sides of it."""

    id: str
    #: Second person, plain, numbers inline, and it names a cost or a move. This is the
    #: only field a person reads.
    text: str
    #: The two groups, so a screen can show the working and a test can check the sentence.
    #: Internal metric names live HERE, never in `text`.
    left: dict
    right: dict
    #: How many times bigger the left side is. 1.0 means no difference.
    lift: float
    basis: str


@dataclasses.dataclass(frozen=True)
class SessionEvents:
    """One session's digest events plus what the sessionizer decided about it."""

    session_id: str
    started_at: float
    ended_at: float
    active_seconds: float
    attended_seconds: float
    tz_offset_minutes: int
    events: Sequence  # analysis.digest.Ev
    #: Output tokens for this sitting, from the authoritative LEDGER, or None when the
    #: caller does not have it. Never summed off the events: `Ev.tok_out` is set only on
    #: the assistant records that happen to carry usage, and MEASURED on this corpus it
    #: reports 39,487 output tokens for 21 hours of work, which is off by orders of
    #: magnitude. Absent is a refusal; zero would be a lie.
    output_tokens: int | None = None
    #: What this sitting would have cost at API list prices, or None when the tokens or
    #: the model are unknown. NOT a bill: most people running these tools are on a
    #: subscription (analysis/pricing.py).
    cost_usd: float | None = None
    #: The model that wrote at least `DOMINANT_SHARE` of the output, when there is one.
    #: None for a genuinely mixed sitting, whose commits belong to no single model.
    dominant_model: str | None = None


# ------------------------------------------------------------------ small measurements


def _local_hour(ts: float, tz_offset_minutes: int) -> int:
    return (dt.datetime.fromtimestamp(ts, dt.UTC) + dt.timedelta(minutes=tz_offset_minutes)).hour


def _pct(x: float) -> str:
    return plain.pct(x)


def _lift(a: float, b: float) -> float:
    return plain.rounded(a / b, 2) if b > 0 else 0.0


def _mins(seconds: float) -> str:
    m = plain.rounded(seconds / 60)
    if m < 60:
        return f"{m} minute{'' if m == 1 else 's'}"
    return f"{m // 60}h {m % 60:02d}m"


def _wrote(e) -> bool:
    """Did this tool call put lines into a file? Edit and Write, and a shell heredoc.

    A shell write counts because it is most of the work: MEASURED on this repository's
    corpus, 2,452 of 2,458 attributable lines came through the shell (CLAUDE.md). `sed -i`
    names a path and returns no count, so it is a touch and not a magnitude.
    """
    from . import digest as dg

    return e.kind == "tool" and (
        e.tool in dg.EDIT_TOOLS or (e.tool in dg.SHELL_TOOLS and e.added is not None)
    )


def _committed(e) -> bool:
    from . import digest as dg

    return e.kind == "tool" and (
        e.tool in dg.COMMIT_TOOLS or (e.tool in dg.SHELL_TOOLS and bool(_COMMIT_CMD.search(e.text)))
    )


def _tested(e) -> bool:
    from . import digest as dg

    return e.kind == "tool" and e.tool in dg.SHELL_TOOLS and bool(_TEST_CMD.search(e.text or ""))


def _touched(e) -> bool:
    """Did this tool call change a file it NAMES? The one answer to "which files did this
    change" that `burn` (`Segment.files_touched`, the file churn rule), `live` (the map,
    the time lapse, "Finished, with N files changed") and `vocab` read.

    `_wrote` with a path, or a shell call the digest gave a path and no line count, which
    is `sed -i` (`digest._bash_file_effect`: "the file was touched, the magnitude is not in
    the command", CLAUDE.md). Whether it succeeded is the caller's to check: this is the
    SHAPE of the call, and a failed one changed nothing.

    FOUND IN REVIEW (2026-09-13): four functions answered this and disagreed on `sed -i`.
    The map drew a `sed -i` file as edited (MEASURED, 23 of 1,335 corpus map rows were
    files changed only that way), `live` said "Finished" with 0 files changed about the
    same turn, and `burn` called the stretch unreadable.
    """
    from . import digest as dg

    return bool(
        e.kind == "tool"
        and e.path
        and (_wrote(e) or (e.tool in dg.SHELL_TOOLS and e.added is None))
    )


# ------------------------------------------------------------- the project, and the harness


def rooted_path(path: str) -> str:
    """Lowercased posix path, rooted, so a `*/name` glob also matches a top level file and
    a relative path compares like an absolute one."""
    p = path.replace("\\", "/").lower()
    return p if p.startswith("/") else "/" + p


#: Claude Code's own state: under the home directory its memory notes, background job
#: scratch and plans, and its per session temp directory (`/tmp/claude-<uid>/`, which macOS
#: spells `/private/tmp/...`), home of the scratchpad and of background task output. A path
#: there is the harness's file, not the project's: its directory NAMES are the harness's
#: words, and what is written there never ships. MEASURED on the corpus: every one of the
#: 48 events that unlocked `queue` through the design's `*/jobs/*` glob was under
#: `~/.claude/jobs/`; titles counted these files as the session's work, and 25 of 157
#: titles change without them ("Edited eleven docs" was eleven scratchpad `.txt` files,
#: "Refactored seven files across five modules" had three memory notes among its seven,
#: "Shipped changes to seven source files" six scripts under `~/.claude/jobs/`); and HTML
#: was on the stack for 21 sessions where 10 had only written HTML into the scratchpad,
#: the pages an agent renders for itself. Anchored at the home directory and at `/tmp`, so
#: a repository's own `.claude/worktrees/` (six of RideGT's project directories) is still
#: the project.
_HARNESS_STATE = re.compile(
    r"^/(users|home)/[^/]+/\.claude/|^/root/\.claude/|^/~/\.claude/|^/(private/)?tmp/claude-\d+/"
)

#: A `cd` and its target, quoted or not, wherever a simple command can start.
_CD = re.compile(r"(?:^|[\s;&|(])cd\s+([\"']?)([^\s\"';&|)]+)\1")


def harness_path(path: str | None) -> bool:
    """Is this path Claude Code's own state rather than the project's (`_HARNESS_STATE`)?"""
    return bool(path) and bool(_HARNESS_STATE.match(rooted_path(path)))


def harness_event(e) -> bool:
    """Is this tool event's file Claude Code's own rather than the project's?

    THE one rule, read by every count of project work: `vocab` (titles, the stack),
    `profile.session_fact_from_events` (agent lines), `wrapped` (the kind of work card) and
    `live` (the map, the time lapse, files changed). Moved here from `vocab`, where it was
    written, because "what counts as project work belongs with `_wrote`"
    (docs/overnight-engine.md, Deviations (vocab)).

    An absolute path says so itself (`harness_path`). A shell call's path (a heredoc write,
    a `sed -i`) is RELATIVE when the agent worked from its current directory (`cat >
    part1.html <<'EOF'`), and then it is the harness's when every directory the command
    `cd`s into, as far as the digest kept the command, is. MEASURED on the corpus: of 303
    relative shell writes, 142 were in commands whose only `cd`s went into Claude Code's
    state, 128 in commands whose `cd`s went only elsewhere, none into both, and 33 had no
    `cd` at all (kept as the project's: nothing says otherwise). With the absolute paths
    already out, the 142 still changed 17 titles: "Built out seven source files" was seven
    parts of an HTML page assembled in the scratchpad, in a session whose project gained
    one test file.

    MEASURED on the corpus with this rule applied to the wrapped "How much did you ship?"
    card (2026-09-13): 13,663 of its 64,747 lines were written into Claude Code's own
    files, 21% of the number, which `live`'s absolute path only rule also missed.
    """
    from . import digest as dg

    if not e.path:
        return False
    if harness_path(e.path):
        return True
    if e.path.startswith(("/", "~", "\\")) or re.match(r"^[A-Za-z]:", e.path):
        return False
    if e.tool not in dg.SHELL_TOOLS:
        return False
    targets = [m.group(2) for m in _CD.finditer(dg.shell_text(e.text))]
    return bool(targets) and all(harness_path(t) for t in targets)


def project_write(e) -> bool:
    """Lines put into a PROJECT file: `_wrote`, and not into Claude Code's own
    (`harness_event`). What "agent lines" counts on every corpus surface."""
    return _wrote(e) and not harness_event(e)


def distinct_events(events: Sequence) -> list:
    """Each event once, in order.

    A resumed session's new transcript begins with a copy of the old one's records (the
    same `uuid` and timestamp under a new `sessionId`), and the sessionizer pools both
    files, so a copied tool call reaches the session twice. A tool call and its result are
    keyed on the call id, which names one call; an event of another kind (a prompt, a
    compaction) on its kind, time, text and path. A call or result with NO id is never
    merged: Aider stamps every call in a turn with the turn's time, so two identical
    `pytest` runs in one turn would look like one copied twice.

    MEASURED on the corpus: 153 `tool_use` ids sit in two root transcripts, and every one
    of them reached a counted session twice, in 5 of 157 sessions. One title said it had
    read 254 tool calls where there were 140, and the glossary counted 41 `ssh` calls where
    there were 33. The same copies carried 907 agent lines and 5 prompts into the corpus
    totals (FOUND IN REVIEW, 2026-09-13), which is why the corpus cut applies it once, to
    every sitting, before anything is counted (`__main__._corpus_facts`).
    """
    seen: set = set()
    out = []
    for e in events:
        if e.tool_id:
            key = (e.kind, e.tool_id)
        elif e.kind in ("tool", "result_error"):
            out.append(e)
            continue
        else:
            key = (e.kind, e.ts, e.text, e.path)
        if key in seen:
            continue
        seen.add(key)
        out.append(e)
    return out


def _lines_added(s: SessionEvents) -> int:
    """Lines put into PROJECT files (`project_write`), the lines "landed" in a finding:
    a scratchpad page the agent rendered for itself landed nothing."""
    return sum(e.added or 0 for e in s.events if project_write(e))


def _commits(s: SessionEvents) -> int:
    return sum(1 for e in s.events if _committed(e))


def _first_prompt(s: SessionEvents):
    return next((e for e in s.events if e.kind == "prompt" and e.text), None)


def findings(sessions: Sequence[SessionEvents]) -> list[Finding]:
    """Every comparison that cleared all three bars, most striking first."""
    out: list[Finding] = []
    for fn in (
        _what_a_shipping_session_looks_like,
        _the_spin,
        _stuck_in_a_loop,
        _fighting_one_file,
        _when_the_work_lands,
        _short_prompts_get_corrected,
        _verification_habit,
        _what_the_quiet_sessions_cost,
        _the_cheaper_model_shipped,
    ):
        found = fn(sessions)
        if found is not None:
            out.append(found)
    out.sort(key=lambda f: -abs(f.lift - 1.0))
    return out


# ------------------------------------------------------------------- what ships, and why


def _what_a_shipping_session_looks_like(sessions: Sequence[SessionEvents]) -> Finding | None:
    """Sessions that produced a commit against sessions that did not, on the one thing
    the person controls before the session starts: how much they said up front.

    This is the finding the whole module exists for. It uses the same measurement as "your
    opening prompt is longer than the rest", which on its own is a fact with nothing on the
    end of it, and attaches it to whether the sitting ended with anything landing. Same
    number, and now there is something to do with it.
    """
    openers = [(_first_prompt(s), s) for s in sessions]
    openers = [(f, s) for f, s in openers if f is not None]
    if len(openers) < MIN_GROUP * 2:
        return None
    # Split by RANK, not against a threshold: this person's own longer half of openings
    # against their own shorter half. A threshold ("over 200 characters") is a number from
    # nowhere, and a threshold at the median puts every session on one side the moment the
    # lengths are bimodal, which they are: FOUND BY RUNNING IT, a corpus of six long
    # openers and six one-word ones produced a "with brief" group of zero.
    #
    # Requiring a follow-up prompt as well was worse still: 13 of 18 sessions in the
    # reference corpus have exactly one prompt, so the comparison had five observations to
    # split and could never clear the bar.
    order = sorted(openers, key=lambda pair: len(pair[0].text))
    half = len(order) // 2
    without = [_commits(s) > 0 for _, s in order[:half]]
    with_brief = [_commits(s) > 0 for _, s in order[len(order) - half :]]
    if len(with_brief) < MIN_GROUP or len(without) < MIN_GROUP:
        return None
    a, b = sum(with_brief) / len(with_brief), sum(without) / len(without)
    if a - b < MIN_SHARE_GAP:
        return None
    return Finding(
        id="what_a_shipping_session_looks_like",
        text=(
            f"When you spell the job out before starting, it lands. Of the "
            f"{len(with_brief)} sessions you opened with the most detail, "
            f"{sum(with_brief)} ended with a commit. Of the {len(without)} you opened "
            f"shortest, {sum(without)} did. Same person, different first message."
        ),
        left={
            "group": "the half of your sessions opened with the most detail",
            "n": len(with_brief),
            "shipped": sum(with_brief),
            "share": plain.rounded(a, 3),
        },
        right={
            "group": "the half opened shortest",
            "n": len(without),
            "shipped": sum(without),
            "share": plain.rounded(b, 3),
        },
        lift=_lift(a, b),
        basis="first_prompt_length_vs_commits",
    )


# ------------------------------------------------------------------------- going nowhere


def _checkpoint(e) -> bool:
    """Did this tool call produce something a person would count as progress?

    A file written, a commit, or a test run. All three, not just the write, because the
    write is the one this parser sees least reliably: a shell heredoc is caught, but an
    edit made by a script the agent wrote (`python3 - <<PY`) is a Bash call with no line
    count anywhere in it. Counting only writes would turn every such session into one long
    stretch of "nothing happened", which is a statement about the parser dressed up as a
    statement about the person.
    """
    return _wrote(e) or _committed(e) or _tested(e)


#: A corpus with fewer checkpoints than this per tool call cannot support the spin finding:
#: the gaps between them are measuring what the parser could see, not what the person did.
#: MEASURED on this container's corpus: 111 checkpoints in 1,259 tool calls, 1 in 11.
MIN_CHECKPOINT_DENSITY = 1 / 20


def _could_have_changed_something(e) -> bool:
    """A tool call that ends a stretch of "nothing written, tested or committed": a
    checkpoint, a file it names and changed with no count (`_touched`, a `sed -i`), or a
    call that could have changed a file the digest cannot see (`burn._could_write_unseen`,
    the rule that makes burn's stretches unreadable rather than barren: a `python3 - <<PY`
    script, a build, a helper agent). Proven nothing, or not said.

    A shell call is judged on its WHOLE command, which its loader read (`Ev.reads_only`),
    never on the 160 characters the digest keeps: FOUND IN REVIEW (2026-09-14), judging the
    kept text refused every cut command, 10,313 of the 14,100 shell calls under
    ~/.claude/projects, so one read only `cd … && grep … | head -40 && git log …` with an
    absolute path ended any stretch it sat in and the note fired on 0 of 368 sittings.
    """
    from . import burn

    return _checkpoint(e) or _touched(e) or burn._could_write_unseen(e)


def _active_between(events: Sequence, i: int, j: int) -> float:
    """Seconds of ACTIVE time from `events[i]` to `events[j]`: every gap between two events
    credited up to `ACTIVE_GAP_CAP`, the sessionizer's own rule for the session's figure
    (`measure_boundaries.ACTIVE_GAP_CAP`, 120 s), so a stretch is on the clock the page's
    duration is on. Fewer events than the sessionizer's records only merge gaps, and a
    merged gap credits no more than its parts, so a stretch can never outrun the session."""
    from capture.reference import mb

    cap = mb.ACTIVE_GAP_CAP
    total = 0.0
    for k in range(i, j):
        gap = events[k + 1].ts - events[k].ts
        if gap > 0:
            total += min(gap, cap)
    return total


def _runs_with_nothing_to_show(s: SessionEvents) -> list[tuple[int, float]]:
    """(tool calls, active seconds) for every stretch in which no call wrote, tested,
    committed or could have changed a file this parser cannot see.

    FOUND IN THE DEFECTS PASS (2026-09-14): a RideGT sitting (60256e3a) of 3h 12m active,
    +507 lines and 13 commits carried "3 stretches with nothing written, tested or
    committed, 3h 09m in total". Three rules disagreed with its own page. Its stretches were
    cut only at checkpoints, so 229 of its 324 calls that could have written unseen (a
    `python3 - <<PY` rewriting a file) counted as nothing; `git -c user.name=... commit`
    was not a commit (`digest.COMMIT_CMD`), so four of its seven commits sat inside them;
    and a stretch was WALL CLOCK from its first call to the next checkpoint, idle gaps of
    up to 15 minutes and 25 of the person's prompts included, where the page's 3h 12m is
    active time. MEASURED over the overnight corpus's 160 counted sittings: the note was on
    17 of them for 11.9 hours in all, 9 claiming over half their sitting's active time and
    one (05f4bf27) more than all of it, 2,682 s of a 1,841 s sitting.
    """
    events = s.events
    runs: list[tuple[int, float]] = []
    n, start, last = 0, None, None
    for i, e in enumerate(events):
        if e.kind != "tool":
            continue
        if _could_have_changed_something(e):
            if n and start is not None:
                runs.append((n, _active_between(events, start, i)))
            n, start, last = 0, None, i
            continue
        n += 1
        last = i
        if start is None:
            start = i
    if n and start is not None and last is not None:
        # The trailing run ends at the LAST TOOL CALL, never at the session end. Using
        # `ended_at` credits every idle second after the agent stopped to the stretch:
        # FOUND BY RUNNING IT, a sitting whose last 50 calls finished in 100 seconds and
        # whose window ran two more hours reported a two hour stretch of going nowhere.
        # The boundary rules deliberately extend `endedAt` by the trailing gap
        # (CLAUDE.md), which is right for active time and wrong for this.
        runs.append((n, _active_between(events, start, last)))
    return runs


def _the_spin(sessions: Sequence[SessionEvents]) -> Finding | None:
    """The longest the agent ran without changing anything, and what that cost in total.

    This is the one number that tells a person WHEN to interrupt. A long hands-off run
    that is writing code is the product working; a long hands-off run that is reading,
    grepping and re-reading is the agent circling, and the person is the only one who can
    see it happening.
    """
    calls = sum(1 for s in sessions for e in s.events if e.kind == "tool")
    checkpoints = sum(1 for s in sessions for e in s.events if e.kind == "tool" and _checkpoint(e))
    if not calls or checkpoints / calls < MIN_CHECKPOINT_DENSITY:
        # Refused, not estimated. See MIN_CHECKPOINT_DENSITY: below this the gaps are the
        # parser's blind spots and the finding would report them as the person's wasted time.
        return None
    all_runs = [(run, s) for s in sessions for run in _runs_with_nothing_to_show(s)]
    if len(all_runs) < MIN_GROUP:
        return None
    spins = [(calls, secs) for (calls, secs), _ in all_runs if calls >= SPIN_TOOL_CALLS]
    if not spins:
        return None
    ordinary = [calls for (calls, _), _ in all_runs if calls < SPIN_TOOL_CALLS]
    if len(ordinary) < MIN_GROUP:
        return None
    worst_calls, worst_secs = max(spins)
    typical = sorted(ordinary)[len(ordinary) // 2]
    lost = sum(secs for _, secs in spins)
    return Finding(
        id="the_spin",
        text=(
            f"{len(spins)} time{'' if len(spins) == 1 else 's'} the agent ran a long way "
            f"with nothing to show: no file written, no test, no commit. The worst was "
            f"{worst_calls} tool calls over {_mins(worst_secs)}, against {typical} calls "
            f"in a normal stretch between two of them. Those runs cost you {_mins(lost)} in "
            f"total, and they are the ones worth cutting short."
        ),
        left={
            "group": f"runs of {SPIN_TOOL_CALLS}+ calls with no write, test or commit",
            "n": len(spins),
            "worst_tool_calls": worst_calls,
            "worst_seconds": plain.rounded(worst_secs),
            "total_seconds": plain.rounded(lost),
        },
        right={
            "group": "an ordinary stretch between two checkpoints",
            "n": len(ordinary),
            "median_tool_calls": typical,
        },
        lift=_lift(worst_calls, max(typical, 1)),
        basis="tool_calls_between_checkpoints",
    )


def _stuck_in_a_loop(sessions: Sequence[SessionEvents]) -> Finding | None:
    """Consecutive failing tool results: the agent trying the same thing again."""
    loops, longest, longest_secs = [], 0, 0.0
    total_calls = 0
    for s in sessions:
        # A failure is a `result_error` event sitting where the call's result belongs, NOT
        # a flag on the call itself. Walking both kinds and testing `ok` counts the call as
        # a success and its own error as a separate failure, so a run never reaches two and
        # this finder silently never fires. FOUND BY RUNNING IT on a corpus with 128 errors
        # and 0 reported loops.
        seq = [e for e in s.events if e.kind in ("tool", "result_error")]
        run, start = 0, None
        i = 0
        while i < len(seq):
            e = seq[i]
            if e.kind != "tool":
                i += 1
                continue
            total_calls += 1
            failed = i + 1 < len(seq) and seq[i + 1].kind == "result_error"
            if failed:
                run += 1
                if start is None:
                    start = e.ts
                if run > longest:
                    longest, longest_secs = run, e.ts - start
                i += 2
                continue
            if run >= STUCK_FAILURES and start is not None:
                loops.append((run, e.ts - start))
            run, start = 0, None
            i += 1
        if run >= STUCK_FAILURES and start is not None:
            loops.append((run, s.ended_at - start))
    if total_calls < MIN_GROUP or not loops:
        return None
    lost = sum(secs for _, secs in loops)
    return Finding(
        id="stuck_in_a_loop",
        text=(
            f"{len(loops)} time{'' if len(loops) == 1 else 's'} it failed "
            f"{STUCK_FAILURES} or more times in a row before anything changed. The worst "
            f"run was {longest} failures over {_mins(longest_secs)}. That is not debugging, "
            f"it is a loop, and stepping in with the actual error is faster than watching "
            f"it try again."
        ),
        left={
            "group": f"runs of {STUCK_FAILURES}+ consecutive failures",
            "n": len(loops),
            "longest_run": longest,
            "total_seconds": plain.rounded(lost),
        },
        right={"group": "tool calls in the corpus", "n": total_calls},
        lift=_lift(len(loops) * STUCK_FAILURES, max(total_calls / 100, 1)),
        basis="consecutive_failed_tool_results",
    )


def _fighting_one_file(sessions: Sequence[SessionEvents]) -> Finding | None:
    """The file that got rewritten most in one sitting, and how long that took."""
    worst = None  # (writes, seconds, name, session_id)
    fought = once = 0
    for s in sessions:
        seen: dict[str, list[float]] = {}
        for e in s.events:
            if _wrote(e) and e.path:
                seen.setdefault(e.path, []).append(e.ts)
        for path, times in seen.items():
            if len(times) >= REWORK_WRITES:
                fought += 1
                span = max(times) - min(times)
                if worst is None or len(times) > worst[0]:
                    worst = (len(times), span, path.rsplit("/", 1)[-1], s.session_id)
            else:
                once += 1
    total = fought + once
    if total < MIN_GROUP or worst is None:
        return None
    share = fought / total
    return Finding(
        id="fighting_one_file",
        text=(
            f"{worst[2]} was rewritten {worst[0]} times in one sitting, over "
            f"{_mins(worst[1])}. Across the corpus {fought} of {total} files you touch get "
            f"{REWORK_WRITES} or more passes in the same session. A file on its fourth "
            f"rewrite usually needs a decision from you, not another attempt."
        ),
        left={
            "group": f"files written {REWORK_WRITES}+ times in one session",
            "n": total,
            "count": fought,
            "share": plain.rounded(share, 3),
            "worst_file_writes": worst[0],
            "worst_file_seconds": plain.rounded(worst[1]),
        },
        right={"group": "files written fewer times", "n": total, "count": once},
        lift=_lift(worst[0], REWORK_WRITES - 1),
        basis="write_counts_per_path_per_session",
    )


# ---------------------------------------------------------------------- when it goes well


def _when_the_work_lands(sessions: Sequence[SessionEvents]) -> Finding | None:
    """Lines landed per hour, late sessions against daylight ones.

    "Your late sessions run longer" is a fact about your calendar. "Your late sessions
    produce a third as much per hour" is a fact about whether to have them.
    """
    late, day = [], []
    for s in sessions:
        if s.active_seconds < 300:
            continue
        rate = _lines_added(s) / (s.active_seconds / 3600)
        h = _local_hour(s.started_at, s.tz_offset_minutes)
        (late if h >= NIGHT_FROM or h < DAY_BOUNDARY_HOUR else day).append(rate)
    if len(late) < MIN_GROUP or len(day) < MIN_GROUP:
        return None
    la, da = sum(late) / len(late), sum(day) / len(day)
    lift = _lift(la, da)
    if MIN_LIFT > lift > 1 / MIN_LIFT:
        return None
    better = lift >= 1
    return Finding(
        id="when_the_work_lands",
        text=(
            f"Starting after {NIGHT_FROM}:00 is your "
            f"{'best' if better else 'most expensive'} hour for hour: those "
            f"{len(late)} sessions landed {plain.rounded(la)} lines an hour against {plain.rounded(da)} "
            f"for the {len(day)} you started in daylight."
            + (
                ""
                if better
                else " The late ones are not cheaper, they are the same hours for less."
            )
        ),
        left={
            "group": f"started after {NIGHT_FROM}:00",
            "n": len(late),
            "lines_per_active_hour": plain.rounded(la, 1),
        },
        right={
            "group": "started in daylight",
            "n": len(day),
            "lines_per_active_hour": plain.rounded(da, 1),
        },
        lift=lift,
        basis="lines_added_per_active_hour_by_start_hour",
    )


# -------------------------------------------------------------------------- how you steer


def _was_corrected(session: SessionEvents, index: int) -> bool:
    """Did the human's NEXT act push back on what the agent did with this prompt?

    An interrupt or a corrective next prompt both count, and the first of the two to
    arrive decides it: a redirect typed after an interrupt is the same act of steering, not
    a second one (`profile.corpus_profile` counts it the same way).
    """
    from .profile import is_corrective

    for e in session.events[index + 1 :]:
        if e.kind == "interrupt":
            return True
        if e.kind == "prompt":
            return bool(e.text) and is_corrective(e.text)
    return False


def _short_prompts_get_corrected(sessions: Sequence[SessionEvents]) -> Finding | None:
    """One-line prompts against fuller ones, by whether the next thing you did was undo it."""
    short, long = [], []
    for s in sessions:
        for i, e in enumerate(s.events):
            if e.kind != "prompt" or not e.text:
                continue
            (short if len(e.text.split()) < SHORT_PROMPT_WORDS else long).append((s, i))
    if len(short) < MIN_GROUP or len(long) < MIN_GROUP:
        return None
    sc = sum(1 for s, i in short if _was_corrected(s, i))
    lc = sum(1 for s, i in long if _was_corrected(s, i))
    ss, ls = sc / len(short), lc / len(long)
    if ss - ls < MIN_SHARE_GAP:
        return None
    return Finding(
        id="short_prompts_get_corrected",
        text=(
            f"Your one-line instructions are the ones you end up taking back. "
            f"{sc} of your {len(short)} prompts under {SHORT_PROMPT_WORDS} words were "
            f"followed by you stopping it or correcting it, against {lc} of {len(long)} "
            f"of your fuller ones. Every one of those is a round trip you paid for twice."
        ),
        left={
            "group": f"under {SHORT_PROMPT_WORDS} words",
            "n": len(short),
            "corrected": sc,
            "share": plain.rounded(ss, 3),
        },
        right={
            "group": f"{SHORT_PROMPT_WORDS} words or more",
            "n": len(long),
            "corrected": lc,
            "share": plain.rounded(ls, 3),
        },
        lift=_lift(ss, ls),
        basis="prompt_text_and_the_next_human_act",
    )


def _verification_habit(sessions: Sequence[SessionEvents]) -> Finding | None:
    """Whether a burst of edits gets tested before you move on to the next thing."""
    tested, untested = 0, 0
    for s in sessions:
        pending = False
        for e in s.events:
            if e.kind != "tool":
                continue
            if _wrote(e):
                pending = True
            elif _tested(e) and pending:
                tested += 1
                pending = False
        if pending:
            untested += 1
    total = tested + untested
    if total < MIN_GROUP:
        return None
    share = tested / total
    good = share >= 0.5
    return Finding(
        id="verification_habit",
        text=(
            f"You run a test after {_pct(share)} of your editing runs "
            f"({tested} of {total})."
            + (
                " That is the habit that keeps a long autonomous run from quietly going "
                "wrong, and it is the strongest thing in your profile."
                if good
                else " The other runs end with code you have not seen fail, which is where "
                "a long autonomous stretch turns into rework."
            )
        ),
        left={
            "group": "edit bursts that ended in a test",
            "n": total,
            "count": tested,
            "share": plain.rounded(share, 3),
        },
        right={"group": "edit bursts that did not", "n": total, "count": untested},
        lift=_lift(share, 1 - share) if share < 1 else float(total),
        basis="test_commands_after_writes",
    )


def _what_the_quiet_sessions_cost(sessions: Sequence[SessionEvents]) -> Finding | None:
    """What the sittings that ended with no commit would have cost at list prices.

    IN DOLLARS, NOT TOKENS, and the switch changed the answer. MEASURED on the reference
    corpus: the sessions that shipped nothing were 23% of the output TOKENS and 1% of the
    money, because the quiet ones were cheap Sonnet sittings and the expensive Opus ones
    all shipped. The token version was a true sentence pointing the wrong way; a person
    who read it would have gone looking for waste that was not there.

    Both halves are reliably visible: `git commit` is in the command text, and the cost
    comes from the ledger through the one price table (analysis/pricing.py). A session
    with no cost is dropped, never counted as free.
    """
    quiet, shipped = 0.0, 0.0
    n_quiet, n_shipped = 0, 0
    for s in sessions:
        if s.cost_usd is None:
            continue
        if _commits(s) > 0:
            shipped += s.cost_usd
            n_shipped += 1
        else:
            quiet += s.cost_usd
            n_quiet += 1
    total = quiet + shipped
    if n_quiet < MIN_GROUP or n_shipped < MIN_GROUP or total <= 0:
        return None
    share = quiet / total
    if share < MIN_SHARE_GAP:
        return None
    from . import pricing

    return Finding(
        id="what_the_quiet_sessions_cost",
        text=(
            f"{n_quiet} of your sessions ended without a single commit and would have "
            f"cost {pricing.money(quiet)} on the API, {_pct(share)} of everything you ran. "
            f"The {n_shipped} that did ship cost {pricing.money(shipped)} and left "
            f"something behind."
        ),
        left={
            "group": "sessions that ended with no commit",
            "n": n_quiet,
            "usd": plain.rounded(quiet, 2),
            "share_of_spend": plain.rounded(share, 3),
        },
        right={
            "group": "sessions that ended with a commit",
            "n": n_shipped,
            "usd": plain.rounded(shipped, 2),
        },
        lift=_lift(share, 1 - share) if share < 1 else float(n_quiet),
        basis="list_price_by_commit_outcome",
    )


def _the_cheaper_model_shipped(sessions: Sequence[SessionEvents]) -> Finding | None:
    """The model that cost the least per commit, against the one that cost the most.

    The one comparison in this module a stranger can use. It only fires on sittings ONE
    model wrote most of, because a session's commits belong to the session and splitting
    them by output share would hand a commit to whichever model wrote the test log.
    """
    from . import pricing

    rows: dict[str, dict] = {}
    for s in sessions:
        if s.cost_usd is None or not s.dominant_model:
            continue
        row = rows.setdefault(pricing.family(s.dominant_model), {"usd": 0.0, "commits": 0, "n": 0})
        row["usd"] += s.cost_usd
        row["commits"] += _commits(s)
        row["n"] += 1

    ranked = [
        (name, r["usd"] / r["commits"], r)
        for name, r in rows.items()
        if r["n"] >= MIN_GROUP and r["commits"] > 0
    ]
    if len(ranked) < 2:
        return None
    ranked.sort(key=lambda x: x[1])
    (cheap, cheap_rate, cheap_row), (dear, dear_rate, dear_row) = ranked[0], ranked[-1]
    if _lift(dear_rate, cheap_rate) < MIN_LIFT:
        return None
    return Finding(
        id="the_cheaper_model_shipped",
        text=(
            f"{cheap} landed a commit for {pricing.money(cheap_rate)} of API usage. "
            f"{dear} cost {pricing.money(dear_rate)} for the same thing, "
            f"{_lift(dear_rate, cheap_rate)}x more. That is "
            f"{cheap_row['commits']} commits over {cheap_row['n']} sittings against "
            f"{dear_row['commits']} over {dear_row['n']}."
        ),
        left={
            "group": f"sittings {cheap} wrote most of",
            "n": cheap_row["n"],
            "usd": plain.rounded(cheap_row["usd"], 2),
            "commits": cheap_row["commits"],
            "usd_per_commit": plain.rounded(cheap_rate, 2),
        },
        right={
            "group": f"sittings {dear} wrote most of",
            "n": dear_row["n"],
            "usd": plain.rounded(dear_row["usd"], 2),
            "commits": dear_row["commits"],
            "usd_per_commit": plain.rounded(dear_rate, 2),
        },
        lift=_lift(dear_rate, cheap_rate),
        basis="list_price_per_commit_by_dominant_model",
    )


__all__ = ["Finding", "SessionEvents", "findings", "MIN_GROUP", "MIN_LIFT", "MIN_SHARE_GAP"]
