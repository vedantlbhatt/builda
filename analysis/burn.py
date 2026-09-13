"""Where the tokens went, and whether anything came of it.

`analysis/profile.py` answers "how do you build". This answers the question people
actually ask out loud: **that session cost a lot, what caused it, and did it produce
anything?**

The unit is a SEGMENT: the span from one human prompt to the next. A segment is what a
person remembers ("I asked it to fix the checkout flow and it churned for forty minutes"),
and it is the only boundary a cost can be honestly attributed to. Within a segment the
agent's turns are not separable by intent, so this module does not pretend they are.

Three rules carried from CLAUDE.md, because breaking any of them produces a plausible
wrong number rather than a crash:

1. **Usage is deduplicated on `message.id`.** Claude Code writes one JSONL record per
   content block and repeats the identical `usage` object on each. Summing records
   inflates by 1.878x (44,419 records carry usage; 22,887 distinct ids exist). Only the
   first record for an id is counted.

2. **Root transcripts only, and that is what makes fan-out visible.** Subagent sidecars
   carry tokens the parent's `Task` tool result already reports in aggregate. Reading the
   sidecars double counts; reading only the root attributes the whole fan-out to the turn
   that spawned it, which is exactly where a person wants the blame.

3. **A harness that does not record usage gets a refusal, never a zero.** Cursor writes
   `{0, 0}` on all 14,565 message rows; usage is accounted server side. Reporting 0
   tokens would be a claim about the session instead of a fact about Cursor.

Work attribution rides on `analysis.digest`, not on a second parser. The lesson that cost
an hour (CLAUDE.md, "Two counters for one number"): a session in a shell-first permission
mode wrote every file with `cat > path <<'EOF'` and made zero Edit/Write calls, so a
naive edit-tool count read +0 on a session that added 1,300 lines. `digest.load_events`
already credits heredoc and `sed -i` writes, so this module asks it rather than
re-deriving.

    python -m analysis burn <transcript.jsonl>
    python -m analysis burn <transcript.jsonl> --json
"""

from __future__ import annotations

import collections
import dataclasses
import json
import pathlib
import re
import statistics
from typing import Iterable, Mapping, Sequence

from . import digest

#: A segment is a spike when its cost is at least this multiple of the session's median
#: segment cost. MEASURED on the container corpus: at 2.0 the top quartile of segments all
#: qualify and the word stops meaning anything; at 4.0 a session with two bad segments
#: reports neither, because the median rises to meet them. 3.0 is the value at which the
#: segments a human would point at are the segments that get flagged.
SPIKE_MULTIPLE = 3.0

#: A session needs this many segments before "median segment cost" is a number rather than
#: an accident. Below it, spikes are not reported at all: with three segments the median IS
#: one of the segments, and every session would report a spike or none depending on parity.
MIN_SEGMENTS_FOR_SPIKES = 5

#: Tools that dispatch a subagent. The parent's tool RESULT carries the whole fan-out's
#: aggregated usage, so a `Task` call is both the cause of a spike and the place its cost
#: lands. Named per harness because a denylist would wave through the next one.
TASK_TOOLS = frozenset({"Task", "Agent", "dispatch_agent", "subagent", "spawn_agent"})

#: A test run, by the shell text. Deliberately the same list `digest.stats` uses: two
#: definitions of "ran the tests" is the same bug as a wrong number.
_TEST_RE = re.compile(
    r"\b(pytest|bun test|npm test|swift test|jest|cargo test|go test|make test)\b"
)


# --------------------------------------------------------------------------
# turns: usage, deduplicated
# --------------------------------------------------------------------------


@dataclasses.dataclass
class Turn:
    """One assistant message, counted once."""

    ts: float
    msg_id: str
    model: str | None
    input_tokens: int
    output_tokens: int
    cache_create: int
    cache_read: int
    tools: list[str] = dataclasses.field(default_factory=list)

    @property
    def total(self) -> int:
        """Every token the turn moved. Cache reads are cheaper, not free, and they are the
        thing most people are surprised by, so they are counted and also reported alone."""
        return self.input_tokens + self.output_tokens + self.cache_create + self.cache_read

    @property
    def fresh(self) -> int:
        """Tokens that were not served from cache. The part a long session cannot blame on
        conversation length alone."""
        return self.input_tokens + self.output_tokens + self.cache_create


def load_turns(path: pathlib.Path) -> list[Turn]:
    """Assistant turns from one root transcript, usage deduplicated on `message.id`.

    Returns [] when the transcript carries no usage at all; the caller must treat that as
    absent, not zero (rule 3 in the module docstring).
    """
    by_id: dict[str, Turn] = {}
    order: list[str] = []
    try:
        with path.open("rb") as f:
            for line in f:
                if not line.endswith(b"\n"):
                    break  # a partial trailing line is never consumed
                try:
                    r = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if (r.get("type") or r.get("role")) != "assistant":
                    continue
                ts = digest._ts(r.get("timestamp"))
                if ts is None:
                    continue
                msg = r.get("message") or {}
                mid = msg.get("id") or r.get("requestId")
                if not mid:
                    continue
                usage = msg.get("usage") or {}
                if mid not in by_id:
                    by_id[mid] = Turn(
                        ts=ts,
                        msg_id=str(mid),
                        model=msg.get("model"),
                        input_tokens=int(usage.get("input_tokens") or 0),
                        output_tokens=int(usage.get("output_tokens") or 0),
                        cache_create=int(usage.get("cache_creation_input_tokens") or 0),
                        cache_read=int(usage.get("cache_read_input_tokens") or 0),
                    )
                    order.append(str(mid))
                # Tool calls ride on every record for the message, not just the first.
                turn = by_id[str(mid)]
                for b in msg.get("content") or []:
                    if isinstance(b, dict) and b.get("type") == "tool_use":
                        name = b.get("name")
                        if name:
                            turn.tools.append(str(name))
    except OSError:
        return []
    turns = [by_id[m] for m in order]
    turns.sort(key=lambda t: t.ts)
    return turns


def records_usage(turns: Sequence[Turn]) -> bool:
    """Whether this harness wrote token counts at all. Cursor does not."""
    return any(t.total > 0 for t in turns)


# --------------------------------------------------------------------------
# segments
# --------------------------------------------------------------------------


@dataclasses.dataclass
class Segment:
    """One human prompt and everything the agent did before the next one."""

    index: int
    start_ts: float
    end_ts: float
    prompt: str
    turns: list[Turn] = dataclasses.field(default_factory=list)
    events: list[digest.Ev] = dataclasses.field(default_factory=list)

    # ---- cost -------------------------------------------------------------
    @property
    def tokens(self) -> int:
        return sum(t.total for t in self.turns)

    @property
    def fresh_tokens(self) -> int:
        return sum(t.fresh for t in self.turns)

    @property
    def cache_read(self) -> int:
        return sum(t.cache_read for t in self.turns)

    @property
    def output_tokens(self) -> int:
        return sum(t.output_tokens for t in self.turns)

    @property
    def seconds(self) -> float:
        return max(0.0, self.end_ts - self.start_ts)

    # ---- work -------------------------------------------------------------
    @property
    def lines_added(self) -> int:
        return sum(e.added or 0 for e in self.events if e.kind == "tool")

    @property
    def lines_removed(self) -> int:
        return sum(e.removed or 0 for e in self.events if e.kind == "tool")

    @property
    def files_touched(self) -> int:
        return len(
            {
                e.path
                for e in self.events
                if e.kind == "tool"
                and e.path
                and (e.tool in digest.EDIT_TOOLS or e.added is not None)
            }
        )

    @property
    def commits(self) -> int:
        return sum(
            1
            for e in self.events
            if e.kind == "tool"
            and (
                e.tool in digest.COMMIT_TOOLS
                or (e.tool in digest.SHELL_TOOLS and re.search(r"\bgit commit\b", e.text))
            )
        )

    @property
    def tests_run(self) -> int:
        return sum(
            1
            for e in self.events
            if e.kind == "tool" and e.tool in digest.SHELL_TOOLS and _TEST_RE.search(e.text)
        )

    @property
    def errors(self) -> int:
        return sum(1 for e in self.events if e.kind == "result_error")

    @property
    def tool_calls(self) -> int:
        return sum(1 for e in self.events if e.kind == "tool")

    @property
    def subagents(self) -> int:
        return sum(1 for e in self.events if e.kind == "tool" and e.tool in TASK_TOOLS)

    @property
    def produced_work(self) -> bool:
        """Did anything durable come out of this segment?

        Deliberately generous: a segment that edited a file counts even if the edit was
        later reverted, because this module can see the session and not the repository's
        future. The narrower claim ("and it survived") belongs to whatever watches git,
        not here. Being generous here means `barren` segments are unambiguous.
        """
        return bool(
            self.lines_added or self.lines_removed or self.files_touched or self.commits
        )

    @property
    def barren(self) -> bool:
        """Spent tokens, changed nothing. The segment people remember as wasted.

        Reading and running tests are not nothing, so a segment that only investigated is
        barren by this definition but is labelled `investigated` in the cause list rather
        than accused. The distinction matters: a person who spent 40 minutes reading is
        not in the same situation as one who spent 40 minutes failing to edit.
        """
        return self.tokens > 0 and not self.produced_work

    @property
    def cost_per_line(self) -> float | None:
        lines = self.lines_added + self.lines_removed
        return (self.tokens / lines) if lines else None

    # ---- causes -----------------------------------------------------------
    def causes(self) -> list[dict]:
        """Why this segment cost what it did, most explanatory first.

        Every entry carries the count that justifies it. A cause with no number behind it
        is a guess, and a guess in this file is the failure mode the whole module exists
        to avoid.
        """
        out: list[dict] = []

        if self.subagents:
            out.append(
                {
                    "cause": "subagent_fanout",
                    "detail": f"{self.subagents} subagent{'s' if self.subagents > 1 else ''} dispatched",
                    "n": self.subagents,
                }
            )

        if self.errors >= 3:
            out.append(
                {
                    "cause": "error_loop",
                    "detail": f"{self.errors} failing tool results",
                    "n": self.errors,
                }
            )

        repeats = _max_repeat(self.events)
        if repeats >= 3:
            out.append(
                {
                    "cause": "repeated_call",
                    "detail": f"the same tool call ran {repeats} times",
                    "n": repeats,
                }
            )

        churn_file, churn_n = _churn(self.events)
        if churn_n >= 4:
            out.append(
                {
                    "cause": "file_churn",
                    "detail": f"{pathlib.Path(churn_file).name} rewritten {churn_n} times",
                    "n": churn_n,
                }
            )

        if self.cache_read and self.tokens:
            share = self.cache_read / self.tokens
            if share >= 0.7:
                out.append(
                    {
                        "cause": "context_replay",
                        "detail": f"{share:.0%} of the cost was replaying conversation already in context",
                        "n": self.cache_read,
                    }
                )

        compactions = sum(1 for e in self.events if e.kind == "compaction")
        if compactions:
            out.append(
                {
                    "cause": "compaction",
                    "detail": f"context was compacted {compactions} time{'s' if compactions > 1 else ''}",
                    "n": compactions,
                }
            )

        reads = sum(1 for e in self.events if e.kind == "tool" and e.tool in digest.READ_TOOLS)
        if reads >= 8 and not self.produced_work:
            out.append(
                {
                    "cause": "investigated",
                    "detail": f"{reads} files read and nothing written",
                    "n": reads,
                }
            )

        return out


def _max_repeat(events: Iterable[digest.Ev]) -> int:
    sigs = collections.Counter(
        (e.tool, re.sub(r"\s+", " ", e.text).strip()[:200])
        for e in events
        if e.kind == "tool"
    )
    return max(sigs.values(), default=0)


def _churn(events: Iterable[digest.Ev]) -> tuple[str | None, int]:
    writes = collections.Counter(
        e.path
        for e in events
        if e.kind == "tool" and e.path and (e.tool in digest.EDIT_TOOLS or e.added is not None)
    )
    if not writes:
        return None, 0
    path, n = writes.most_common(1)[0]
    return path, n


def segments(events: Sequence[digest.Ev], turns: Sequence[Turn]) -> list[Segment]:
    """Cut the session at human prompts and file every turn and event into one segment.

    Work that arrives before the first typed prompt (a resumed session, a `claude -p`
    invocation, an autonomous run kicked off elsewhere) belongs to segment 0 with an empty
    prompt rather than being dropped. Dropping it was the first version's bug: an
    unattended run reported zero cost because it had no prompts at all.
    """
    prompts = [e for e in events if e.kind == "prompt"]
    bounds: list[tuple[float, str]] = [(events[0].ts if events else 0.0, "")]
    if prompts:
        if prompts[0].ts <= bounds[0][0]:
            bounds = []
        bounds += [(p.ts, p.text) for p in prompts]

    segs: list[Segment] = []
    for i, (ts, text) in enumerate(bounds):
        end = bounds[i + 1][0] if i + 1 < len(bounds) else float("inf")
        segs.append(Segment(index=i, start_ts=ts, end_ts=ts, prompt=text))
        for e in events:
            if ts <= e.ts < end:
                segs[-1].events.append(e)
        for t in turns:
            if ts <= t.ts < end:
                segs[-1].turns.append(t)
        last = max(
            [e.ts for e in segs[-1].events] + [t.ts for t in segs[-1].turns] + [ts]
        )
        segs[-1].end_ts = last
    return [s for s in segs if s.events or s.turns]


# --------------------------------------------------------------------------
# report
# --------------------------------------------------------------------------


def _metric(value, unit: str, n: int, basis: str, reason: str | None = None, **extra) -> dict:
    """Same shape `analysis/profile.py` uses: a value never travels without its basis, its
    sample, and the reason it is missing when it is."""
    d = {"value": value, "unit": unit, "n": n, "basis": basis}
    if reason:
        d["reason"] = reason
    d.update(extra)
    return d


def _round(x, digits: int):
    return None if x is None else round(x, digits)


def burn_report(
    path: pathlib.Path,
    *,
    start: float | None = None,
    end: float | None = None,
    spike_multiple: float = SPIKE_MULTIPLE,
) -> dict:
    """Everything this module can honestly say about one transcript's cost."""
    events = digest.load_events(path, start, end)
    turns = load_turns(path)

    if not events:
        return {
            "harness_records_usage": False,
            "sample": {"segments": 0, "missing": ["the transcript held no readable events"]},
            "totals": {},
            "segments": [],
            "spikes": [],
            "barren": [],
        }

    has_usage = records_usage(turns)
    segs = segments(events, turns)
    missing: list[str] = []

    if not has_usage:
        missing.append(
            "this harness does not write token counts to disk, so cost cannot be attributed"
        )

    total_tokens = sum(s.tokens for s in segs)
    total_added = sum(s.lines_added for s in segs)
    total_removed = sum(s.lines_removed for s in segs)
    total_cache = sum(s.cache_read for s in segs)

    # ---- spikes -----------------------------------------------------------
    spikes: list[dict] = []
    costs = [s.tokens for s in segs if s.tokens > 0]
    median_cost = statistics.median(costs) if costs else 0
    if not has_usage:
        pass  # refused above
    elif len(segs) < MIN_SEGMENTS_FOR_SPIKES:
        missing.append(
            f"fewer than {MIN_SEGMENTS_FOR_SPIKES} segments, so a median segment cost would "
            "be an accident rather than a baseline"
        )
    else:
        for s in segs:
            if median_cost and s.tokens >= median_cost * spike_multiple:
                spikes.append(_segment_row(s, median_cost))
        spikes.sort(key=lambda r: -r["tokens"])

    # ---- barren spend -----------------------------------------------------
    barren = [_segment_row(s, median_cost) for s in segs if has_usage and s.barren]
    barren.sort(key=lambda r: -r["tokens"])
    barren_tokens = sum(r["tokens"] for r in barren)

    # ---- cause rollup -----------------------------------------------------
    by_cause: dict[str, dict] = {}
    for s in segs:
        for c in s.causes():
            row = by_cause.setdefault(
                c["cause"], {"cause": c["cause"], "segments": 0, "tokens": 0}
            )
            row["segments"] += 1
            row["tokens"] += s.tokens
    # A segment can carry several causes, so these shares OVERLAP and do not sum to 1.
    # The field is named for what it is; the printer says so too.
    causes = sorted(by_cause.values(), key=lambda r: -r["tokens"])
    for c in causes:
        c["share_of_session"] = _round(c["tokens"] / total_tokens, 3) if total_tokens else None

    return {
        "harness_records_usage": has_usage,
        "sample": {
            "segments": len(segs),
            "turns": len(turns),
            "events": len(events),
            "missing": missing,
        },
        "totals": {
            "tokens": _metric(
                total_tokens if has_usage else None,
                "tokens",
                len(turns),
                "assistant messages, deduplicated on message.id",
                None if has_usage else "this harness writes no token counts",
            ),
            "cache_read_share": _metric(
                _round(total_cache / total_tokens, 3) if has_usage and total_tokens else None,
                "fraction",
                len(turns),
                "cache_read_input_tokens over all counted tokens",
                None if has_usage and total_tokens else "no token counts to divide",
            ),
            "lines_added": _metric(
                total_added,
                "lines",
                len(events),
                "edit-tool deltas plus credited shell writes (heredoc, sed -i)",
            ),
            "lines_removed": _metric(
                total_removed,
                "lines",
                len(events),
                "edit-tool deltas plus credited shell writes",
            ),
            "tokens_per_line": _metric(
                _round(total_tokens / (total_added + total_removed), 1)
                if has_usage and (total_added + total_removed)
                else None,
                "tokens/line",
                len(segs),
                "counted tokens over lines changed",
                None
                if has_usage and (total_added + total_removed)
                else "no lines changed, or no token counts",
            ),
            "barren_token_share": _metric(
                _round(barren_tokens / total_tokens, 3) if has_usage and total_tokens else None,
                "fraction",
                len(barren),
                "tokens in segments that changed nothing, over all counted tokens",
                None if has_usage and total_tokens else "no token counts to divide",
            ),
        },
        "causes": causes,
        "spikes": spikes,
        "barren": barren,
        "segments": [_segment_row(s, median_cost) for s in segs],
        "median_segment_tokens": median_cost if has_usage else None,
    }


def _segment_row(s: Segment, median_cost: float) -> dict:
    return {
        "index": s.index,
        "started_at": s.start_ts,
        "seconds": _round(s.seconds, 1),
        "prompt": s.prompt[:160],
        "tokens": s.tokens,
        "output_tokens": s.output_tokens,
        "cache_read": s.cache_read,
        "multiple_of_median": _round(s.tokens / median_cost, 1) if median_cost else None,
        "tool_calls": s.tool_calls,
        "errors": s.errors,
        "subagents": s.subagents,
        "lines_added": s.lines_added,
        "lines_removed": s.lines_removed,
        "files_touched": s.files_touched,
        "commits": s.commits,
        "tests_run": s.tests_run,
        "produced_work": s.produced_work,
        "barren": s.barren,
        "cost_per_line": _round(s.cost_per_line, 1),
        "causes": s.causes(),
    }


# --------------------------------------------------------------------------
# plain language
# --------------------------------------------------------------------------

#: One sentence per cause, written for someone who has never read a stack trace. The rule
#: from docs/analysis.md holds here: no dashes in any string a person reads.
_CAUSE_SENTENCES = {
    "subagent_fanout": "it split the work across {n} helper agents, and each one re-sends the whole setup before it starts",
    "error_loop": "it hit {n} errors in a row and kept retrying",
    "repeated_call": "it ran the same command {n} times without the result changing",
    "file_churn": "it rewrote the same file {n} times",
    "context_replay": "most of the cost was re-reading the conversation so far, which grows every turn",
    "compaction": "the conversation got too long and had to be summarised, which costs a turn of its own",
    "investigated": "it read {n} files and did not change anything, so this was research rather than building",
}


def explain(report: Mapping) -> list[str]:
    """The report as sentences a non-technical builder can act on.

    Deliberately short and deliberately not a scolding: the worst thing this module could
    do is tell someone who had a bad afternoon that they had a bad afternoon. Where a
    segment spent a lot and produced nothing, the sentence says what it was doing, not
    that it failed.
    """
    lines: list[str] = []
    if not report.get("harness_records_usage"):
        return ["This tool does not record token counts on your machine, so cost cannot be shown."]

    total = report["totals"]["tokens"]["value"] or 0
    added = report["totals"]["lines_added"]["value"] or 0
    removed = report["totals"]["lines_removed"]["value"] or 0
    lines.append(
        f"This session used {_human(total)} tokens and changed {added} lines "
        f"(and removed {removed})."
    )

    share = report["totals"]["cache_read_share"]["value"]
    if share is not None and share >= 0.7:
        lines.append(
            f"{share:.0%} of that was the conversation re-reading itself, which is normal "
            "in a long session and is the main reason cost climbs the longer you go."
        )

    barren_share = report["totals"]["barren_token_share"]["value"]
    if barren_share is not None and barren_share >= 0.2:
        lines.append(
            f"About {barren_share:.0%} went into stretches where nothing was written. "
            "That is not always wasted, but it is where to look first."
        )

    for row in report.get("spikes", [])[:3]:
        causes = row.get("causes") or []
        if not causes:
            continue
        c = causes[0]
        sentence = _CAUSE_SENTENCES.get(c["cause"])
        if not sentence:
            continue
        what = sentence.format(n=c.get("n"))
        cost = _human(row["tokens"])
        verdict = "and nothing was written" if row["barren"] else f"and wrote {row['lines_added']} lines"
        lines.append(f"The most expensive stretch cost {cost} tokens because {what}, {verdict}.")
        break

    return lines


def _human(n: int) -> str:
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n / 1_000:.0f}k"
    return str(n)
