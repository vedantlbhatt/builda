"""Where the tokens went, and whether anything came of it.

`analysis/profile.py` answers "how do you build". This answers the question people
actually ask out loud: **that session cost a lot, what caused it, and did it produce
anything?**

The unit is a SEGMENT: the span from one human prompt to the next. A segment is what a
person remembers ("I asked it to fix the checkout flow and it churned for forty minutes"),
and it is the only boundary a cost can be honestly attributed to. Within a segment the
agent's turns are not separable by intent, so this module does not pretend they are.

Four rules carried from CLAUDE.md, because breaking any of them produces a plausible
wrong number rather than a crash:

1. **Usage is deduplicated on the message id.** Claude Code writes one JSONL record per
   content block and repeats the identical `usage` object on each. Summing records
   inflates by 1.878x (44,419 records carry usage; 22,887 distinct ids exist). Only the
   first record for an id is counted. Codex dedupes on `response_id`, Gemini on the
   message id (a message is appended again every time it changes).

2. **Root transcripts only, and the helpers' own tokens are NOT in any number here.**
   Subagent sidecars carry tokens the parent's `Task` result is supposed to report in
   aggregate, so reading them double counts. But MEASURED on the live transcript
   (2026-09-13): this Claude Code version's async `Agent` results carry no `totalTokens`,
   so a fan out's cost is in no burn number at all. What a turn that dispatched helpers
   can be blamed for is its OWN tokens (`Segment.attribution`), never the helpers'.

3. **A harness that does not record usage gets a refusal, never a zero.** Cursor writes
   `{0, 0}` on all 14,565 message rows; usage is accounted server side. Reporting 0
   tokens would be a claim about the session instead of a fact about Cursor. A harness
   whose counts this module does not read yet (outside `USAGE_READERS`) is refused with
   THAT reason, not told it writes none: Cline and opencode both do.

4. **A cause is blamed for the tokens it can claim, not for the segment it sat in.**
   MEASURED on the live transcript: a 9.1M token spike listed subagent_fanout (4),
   error_loop (4) and context_replay (93% of the segment), and the sentence read the first
   cause and blamed "4 helper agents" for a cost that was re-reading the conversation.

5. **"Nothing was written" is proven, never assumed.** A segment with no visible work
   that ran a script, a build or a helper agent is `unreadable`, not barren: the digest
   cannot see what those write. MEASURED on the real corpus, calling them barren put 31.5%
   of all tokens under "nothing was written" where 2.9% can be shown to be (the
   measurement sits above `_READ_ONLY_PROGRAMS`).

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
from typing import Callable, Iterable, Mapping, Sequence

from . import digest, patterns

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

#: Tools that dispatch a subagent. Named per harness because a denylist would wave through
#: the next one.
TASK_TOOLS = frozenset({"Task", "Agent", "dispatch_agent", "subagent", "spawn_agent"})

#: The bars `Segment.causes()` names a cause at. Named here so `live` (`needs_you` counts
#: errors beyond the error loop's bar) and `vocab` (a title's "Explored" rule) import them
#: rather than restate the literals (they did, pinned by tests to stay equal). Each is an
#: UNMEASURED JUDGEMENT CALL carried over from the burn patch as handed over: three failing
#: results, three copies of one call, four writes to one file, eight reads, and a segment
#: seven tenths cache reads.
ERROR_LOOP_MIN_ERRORS = 3
REPEATED_CALL_MIN = 3
FILE_CHURN_MIN_WRITES = 4
INVESTIGATED_MIN_READS = 8
CONTEXT_REPLAY_MIN_SHARE = 0.7

#: The harnesses whose token counts `load_turns` reads. Every other harness gets `[]` and a
#: refusal that names the gap in THIS module ("does not read ... yet"), because Cline and
#: opencode do write counts to disk and "this harness writes none" would be false for them.
USAGE_READERS = frozenset({"claude_code", "codex", "gemini"})

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
    """One assistant message (a Codex response, a Gemini message), counted once."""

    ts: float
    msg_id: str
    model: str | None
    input_tokens: int
    output_tokens: int
    cache_create: int
    cache_read: int
    tools: list[str] = dataclasses.field(default_factory=list)
    #: The ids of the calls this turn issued: Claude Code `tool_use.id`, Codex `call_id`,
    #: Gemini `toolCalls[].id`. The same ids the digest stamps on `Ev.tool_id`, which is
    #: what lets a cause claim the turns that issued its calls.
    tool_ids: list[str] = dataclasses.field(default_factory=list)
    #: The part of `cache_create` written with the ONE HOUR cache lifetime (Claude Code's
    #: `usage.cache_creation.ephemeral_1h_input_tokens`); the rest of it was written with
    #: five minutes. 0 when the usage carries no breakdown, the rule
    #: `capture.sessions.token_ledger` applies to the upload's `cache_w5m` / `cache_w1h`, so
    #: a price and a cache lifetime read off a turn agree with the stored buckets. Codex and
    #: Gemini write no such split: 0 (`analysis/calls.py` reads it).
    cache_create_1h: int = 0

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


def _int(v) -> int:
    """A token count as an int, 0 when the field is absent or not a number. Absence of ONE
    bucket is a zero in that bucket; absence of every count is caught by `records_usage`."""
    return int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else 0


def load_turns(path: pathlib.Path) -> list[Turn]:
    """Assistant turns from one root transcript, usage deduplicated per message.

    Dispatches on `digest.detect_harness`, the one place a harness is recognised. Returns
    [] for a harness outside `USAGE_READERS` and for a transcript that carries no usage at
    all; the caller must treat that as absent, not zero (rule 3 in the module docstring).
    """
    path = pathlib.Path(path)
    harness = digest.detect_harness(path)
    if harness == "claude_code":
        return _claude_turns(path)
    if harness == "codex":
        return _codex_turns(path)
    if harness == "gemini":
        return _gemini_turns(path)
    return []


def _claude_turns(path: pathlib.Path) -> list[Turn]:
    """Claude Code: the first record of each `message.id` carries the usage; the tool
    calls ride on every record of the message and are gathered from all of them."""
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
                if not isinstance(r, dict):
                    continue
                if (r.get("type") or r.get("role")) != "assistant":
                    continue
                ts = digest._ts(r.get("timestamp"))
                if ts is None:
                    continue
                msg = r.get("message")
                if not isinstance(msg, dict):
                    continue
                mid = msg.get("id") or r.get("requestId")
                if not mid:
                    continue
                mid = str(mid)
                usage = msg.get("usage") if isinstance(msg.get("usage"), dict) else {}
                if mid not in by_id:
                    split = usage.get("cache_creation")
                    by_id[mid] = Turn(
                        ts=ts,
                        msg_id=mid,
                        model=msg.get("model"),
                        input_tokens=_int(usage.get("input_tokens")),
                        output_tokens=_int(usage.get("output_tokens")),
                        cache_create=_int(usage.get("cache_creation_input_tokens")),
                        cache_read=_int(usage.get("cache_read_input_tokens")),
                        cache_create_1h=_int(split.get("ephemeral_1h_input_tokens"))
                        if isinstance(split, dict)
                        else 0,
                    )
                    order.append(mid)
                turn = by_id[mid]
                content = msg.get("content")
                for b in content if isinstance(content, list) else []:
                    if not isinstance(b, dict) or b.get("type") != "tool_use":
                        continue
                    tid = b.get("id")
                    if tid is not None and str(tid) in turn.tool_ids:
                        continue  # the same block written twice is one call
                    name = b.get("name")
                    if name:
                        turn.tools.append(str(name))
                    if tid is not None:
                        turn.tool_ids.append(str(tid))
    except OSError:
        return []
    turns = [by_id[m] for m in order]
    turns.sort(key=lambda t: t.ts)
    return turns


#: Codex response items that are a tool call, and the tool name `codex._derive` gives each
#: (a `local_shell_call` has no name field; the loader calls it `shell`).
_CODEX_CALLS = ("function_call", "custom_tool_call", "local_shell_call")


def _codex_turns(path: pathlib.Path, counters: collections.Counter | None = None) -> list[Turn]:
    """Codex: one Turn per `token_usage_record`, deduped on `payload.response_id`.

    The field mapping (codex.py docstring, VERIFIED on 0.153.4): `input_tokens` INCLUDES
    `cached_input_tokens` and `output_tokens` includes the reasoning tokens, so
    `total_tokens == input_tokens + output_tokens` on 6 of 6 records of
    `spec/fixtures/codex/real_tools_mock_model.jsonl`. That cache WRITES also sit inside
    `input_tokens` is ASSUMED: they are zero in every fixture. So the fresh input is
    input minus both, and `Turn.total == total_tokens`. A record where it does not is
    counted in `counters["total_mismatch"]`, never raised and never corrected.

    The calls (`function_call`, `custom_tool_call`, `local_shell_call`) seen since the
    previous usage record are that response's calls: the writer puts the call item before
    the usage record of the response that issued it.

    A rollout with NO usage record (an older writer) falls back to `event_msg/token_count`
    events, reading `info.last_token_usage` only when `info.total_token_usage.total_tokens`
    strictly grew: an unchanged `info` is a rate limit refresh (codex.py docstring), and
    reading it would count the same response twice. Those turns get ids `tc0`, `tc1`, ...
    """
    from . import codex

    counters = counters if counters is not None else collections.Counter()
    try:
        scan = codex.scan(path)
    except OSError:
        return []
    recs = sorted(scan.records, key=lambda t: (t[0], t[1]))
    use_records = any(r.get("type") == "token_usage_record" for _, _, r in recs)
    counters["basis_token_usage_record" if use_records else "basis_token_count_fallback"] += 1

    model: str | None = None
    names: list[str] = []
    ids: list[str] = []
    by_id: dict[str, Turn] = {}
    order: list[str] = []
    grown = 0  # the largest `total_token_usage.total_tokens` seen, for the fallback

    def _turn(ts: float, mid: str, u: dict) -> None:
        cached = _int(u.get("cached_input_tokens"))
        written = _int(u.get("cache_write_input_tokens"))
        raw_input = _int(u.get("input_tokens"))
        if raw_input < cached + written:
            counters["input_below_cached"] += 1
        turn = Turn(
            ts=ts,
            msg_id=mid,
            model=model,
            input_tokens=max(0, raw_input - cached - written),
            output_tokens=_int(u.get("output_tokens")),
            cache_create=written,
            cache_read=cached,
            tools=list(names),
            tool_ids=list(ids),
        )
        stated = u.get("total_tokens")
        if isinstance(stated, int) and not isinstance(stated, bool) and stated != turn.total:
            counters["total_mismatch"] += 1
        by_id[mid] = turn
        order.append(mid)

    for ts, i, r in recs:
        t = r.get("type")
        p = r.get("payload")
        if not isinstance(p, dict):
            continue
        pt = p.get("type")
        if t == "turn_context":
            if isinstance(p.get("model"), str):
                model = p["model"]
        elif t == "response_item" and pt in _CODEX_CALLS:
            if pt == "local_shell_call":
                name, cid = "shell", p.get("call_id") or p.get("id")
            else:
                name = p.get("name") if isinstance(p.get("name"), str) else "tool"
                cid = p.get("call_id")
            names.append(name)
            if cid is not None:
                ids.append(str(cid))
        elif use_records and t == "token_usage_record":
            u = p.get("usage")
            if not isinstance(u, dict):
                counters["usage_record_without_usage"] += 1
                continue
            rid = p.get("response_id")
            if not rid:
                counters["usage_record_without_response_id"] += 1
                rid = f"line{i}"
            rid = str(rid)
            if rid in by_id:
                # The same response recorded twice: its usage is counted once, and any
                # call written in between belongs to it, as on a Claude Code message.
                counters["usage_record_duplicate"] += 1
                by_id[rid].tools.extend(names)
                by_id[rid].tool_ids.extend(ids)
            else:
                _turn(ts, rid, u)
            names, ids = [], []
        elif not use_records and t == "event_msg" and pt == "token_count":
            info = p.get("info")
            if not isinstance(info, dict):
                continue
            cumulative = info.get("total_token_usage")
            total = cumulative.get("total_tokens") if isinstance(cumulative, dict) else None
            if not isinstance(total, int) or isinstance(total, bool):
                counters["token_count_without_total"] += 1
                continue
            if total <= grown:
                counters["token_count_unchanged"] += 1
                continue
            grown = total
            last = info.get("last_token_usage")
            if not isinstance(last, dict):
                counters["token_count_without_last_usage"] += 1
                continue
            _turn(ts, f"tc{len(order)}", last)
            names, ids = [], []
    if names:
        counters["calls_after_last_usage"] += len(names)
    turns = [by_id[m] for m in order]
    turns.sort(key=lambda t: t.ts)
    return turns


def _gemini_turns(path: pathlib.Path, counters: collections.Counter | None = None) -> list[Turn]:
    """Gemini: one Turn per `gemini` message that carries a `tokens` dict.

    `gemini.scan` keeps one record per message id (later copies win, rewinds applied), so
    the per-line overcount (a message is appended again on every update) is gone before
    this reads anything. The mapping is ASSUMED from the Gemini API's usage metadata and
    consistent with `spec/fixtures/gemini/synthetic_session.jsonl` (12,110 = 12,000 + 30 +
    80, with 8,000 of the input cached): `input` includes `cached`, `total` is `input +
    output + thoughts + tool`. The repository holds no token carrying recording from the
    real writer, so a mismatch is counted in `counters["total_mismatch"]`, not raised.

    A message with no timestamp takes the session start, the same rule `gemini._derive`
    applies to its events, so a turn and the text it produced land in the same segment.
    """
    from . import gemini

    counters = counters if counters is not None else collections.Counter()
    try:
        scan = gemini.scan(path)
    except OSError:
        return []
    started = scan.meta.get("started_at")
    fallback = digest._ts(started) if isinstance(started, str) else None
    turns: list[Turn] = []
    for msg in scan.messages:
        if msg.get("type") != "gemini":
            continue
        tok = msg.get("tokens")
        if not isinstance(tok, dict):
            continue  # no counts on this message: absent, not zero
        raw = msg.get("timestamp")
        ts = digest._ts(raw) if isinstance(raw, str) else None
        if ts is None:
            counters["message_no_timestamp"] += 1
            ts = fallback
            if ts is None:
                counters["message_dropped_no_timestamp"] += 1
                continue
        calls = msg.get("toolCalls") if isinstance(msg.get("toolCalls"), list) else []
        calls = [c for c in calls if isinstance(c, dict)]
        cached = _int(tok.get("cached"))
        raw_input = _int(tok.get("input"))
        if raw_input < cached:
            counters["input_below_cached"] += 1
        turn = Turn(
            ts=ts,
            msg_id=str(msg.get("id")),
            model=msg.get("model") if isinstance(msg.get("model"), str) else None,
            input_tokens=max(0, raw_input - cached) + _int(tok.get("tool")),
            output_tokens=_int(tok.get("output")) + _int(tok.get("thoughts")),
            cache_create=0,
            cache_read=cached,
            tools=[c["name"] if isinstance(c.get("name"), str) else "tool" for c in calls],
            tool_ids=[str(c["id"]) for c in calls if c.get("id") is not None],
        )
        stated = tok.get("total")
        if isinstance(stated, int) and not isinstance(stated, bool) and stated != turn.total:
            counters["total_mismatch"] += 1
        turns.append(turn)
    turns.sort(key=lambda t: t.ts)
    return turns


def records_usage(turns: Sequence[Turn]) -> bool:
    """Whether this harness wrote token counts at all. Cursor does not."""
    return any(t.total > 0 for t in turns)


def files_record_usage(
    paths: Iterable[pathlib.Path | str],
    *,
    loader: Callable[[pathlib.Path], Sequence[Turn]] | None = None,
) -> bool:
    """Whether a sitting's FILES record token counts, whatever its own window holds. A window
    with no counted call in files that record them made no call; it is not a transcript
    without counts, and saying so is a claim about the file that is false (FOUND IN REVIEW,
    2026-09-13: `91d520d9` held four `<synthetic>` records in its window and its files 2,343
    counted calls). The one definition: `calls.session_calls` and `session_report`'s callers
    both ask it."""
    load = loader or load_turns
    return any(records_usage(load(pathlib.Path(p))) for p in paths)


def turns_for_window(
    paths: Iterable[pathlib.Path | str],
    start: float,
    end: float,
    *,
    loader: Callable[[pathlib.Path], Sequence[Turn]] = load_turns,
) -> list[Turn]:
    """Every turn from `paths` with `start <= ts <= end`, in time order, each message once.

    Each path is deduplicated on message id by its loader, and then ACROSS the paths too:
    the first path (in the order given) to carry a message id keeps it. A path listed
    twice is read once. `loader` is where a caller walking a whole corpus passes a memoised
    `load_turns`, so a transcript that several sessions share is parsed once.

    Across paths because a resumed session's new transcript BEGINS WITH A COPY of the old
    one's records (the same `uuid`, timestamp, `message.id` and usage under a new
    `sessionId`), and the sessionizer pools both files into one sitting. The ledger's
    `(source_id, message.id)` rule, applied per file, counted every copied message twice.
    FOUND IN REVIEW, MEASURED on `~/.builder-overnight/corpus` (2026-09-13): 5 of 158
    counted sittings, three of them exactly 2x (one reported 8,234,650 tokens where its
    distinct messages carry 4,117,325; its 168 records hold 81 distinct uuids), and the
    corpus burn total 25,528,872 tokens high. A message id is the API's own id for one
    response, so two files carrying it carry one response. `capture.sessions.token_ledger`
    summed per source and doubled the same sittings; it keys on the message id across the
    sitting now, the rule this function reads.
    """
    out: list[Turn] = []
    seen: set[str] = set()
    for p in dict.fromkeys(pathlib.Path(x) for x in paths):
        for t in loader(p):
            if not (start <= t.ts <= end) or t.msg_id in seen:
                continue
            seen.add(t.msg_id)
            out.append(t)
    out.sort(key=lambda t: t.ts)
    return out


# --------------------------------------------------------------------------
# segments
# --------------------------------------------------------------------------


def _is_write(e: digest.Ev) -> bool:
    """A tool call that changed a file this module can name: `patterns._touched`, the one
    rule `live` reads too. An edit tool, a call the digest credited with lines (a heredoc),
    and a `sed -i`, which names its file and no count ("the file was touched", CLAUDE.md).

    `sed -i` used to be left out here, so a stretch whose only change was one read as
    unreadable while `live`'s map drew the same file as edited and its sentence said
    "Finished" with nothing changed (FOUND IN REVIEW, 2026-09-13). A call the harness
    answered with an error changed nothing and is taken out by `Segment.files_touched`
    (`failed_calls`), not here: this is the call's shape."""
    return patterns._touched(e)


def failed_calls(events: Sequence[digest.Ev]) -> set[int]:
    """`id()` of every tool call a `result_error` answered: the one rule for "this call did
    not do what it says", read by `Segment.commits`, `Segment.files_touched` and `live`.

    Paired on `tool_id` when both carry one, which is exact under parallel calls (Claude Code
    writes three results after three calls, and "the next event" pairs the error with the
    wrong one). A loader that writes no ids (Aider: `aider.py` builds its shell and error
    events without one) falls back to adjacency, the rule `quality.recoveries` and
    `feedback._worst_failure_run` use. FOUND IN REVIEW (2026-09-13): the rule was written
    twice, and the copy in `Segment.commits` paired on ids only, so an Aider `git commit`
    answered "nothing to commit" read "it made 1 commit" while `live` counted 0.
    """
    errored = {e.tool_id for e in events if e.kind == "result_error" and e.tool_id}
    seq = [e for e in events if e.kind in ("tool", "result_error")]
    out: set[int] = set()
    for i, e in enumerate(seq):
        if e.kind != "tool":
            continue
        if e.tool_id:
            if e.tool_id in errored:
                out.add(id(e))
        elif i + 1 < len(seq) and seq[i + 1].kind == "result_error" and not seq[i + 1].tool_id:
            out.add(id(e))
    return out


# ---- what the transcript cannot show ------------------------------------------------
#
# "Nothing was written" is a claim about the PARSER until it is proven about the session
# (CLAUDE.md, "Nothing happened is a claim about the parser"). The digest sees a file
# change only through an edit tool, a `cat > path <<EOF` heredoc, or a `sed -i` it can
# name. Everything else that writes, a `python3 - <<'PY'` script that rewrites a file, a
# build, a formatter, a helper agent whose edits live in its own sidecar, is invisible.
#
# MEASURED on the real corpus (2026-09-13). Before this rule, over 156 counted sessions,
# 1,309,078,925 of 4,159,567,552 segment tokens (31.5%) sat in segments called barren.
# Read back from the raw JSONL, 538,299,660 of those were in segments whose commands
# rewrote files through a script (`open(p, 'w')`, `write_text`, `json.dump`): one 7.5M
# token stretch rewrote `AdBanner.js` twice through `python3 - <<'EOF'` and was reported
# as "nothing was written". With the rule, over 157 counted sessions and 4,168,469,723
# tokens, 120,070,737 (2.9%, 263 segments) are barren and 1,192,481,138 (28.6%, 451
# segments) are UNREADABLE: no visible work, and at least one call that could have
# changed a file the digest cannot see. 2,122 of the shell calls behind that were cut at
# `digest.COMMAND_MAX` characters, so the rest of the command is not in the digest. Every
# one of the 63 shell calls left inside a barren segment was read back in full and only
# reads (`grep`, `sed -n`, `git status`, `git log`, `ls`, `wc`, `df`, `ps`).
#
# RE-MEASURED after the review (2026-09-13, 158 counted sessions), with each message counted
# once across a resumed sitting's files (`turns_for_window`) and each event once: 4,144,956,746
# segment tokens where 4,170,485,618 were counted (25,528,872 were copies), 119,827,180
# barren (2.9%) and 1,187,421,132 unreadable (28.6%).

#: Programs that cannot change a file when nothing is redirected into one. An ALLOWLIST,
#: for the reason CLAUDE.md gives for sidecar discovery: a denylist of writers waves
#: through the next one (`make`, a formatter, a build, a script nobody listed). A program
#: missing from here only makes a segment unreadable, never barren, which is the safe way
#: to be wrong. UNMEASURED JUDGEMENT CALL on the membership; the effect is measured above.
_READ_ONLY_PROGRAMS = frozenset(
    {
        "[", "[[", "ack", "ag", "awk", "base64", "basename", "cat", "cd", "cmp", "column",
        "comm", "cut", "date", "df", "diff", "dig", "dirname", "du", "echo", "egrep", "exit",
        "export", "false", "fd", "fgrep", "file", "find", "fold", "git", "grep", "head",
        "hexdump", "host", "hostname", "id", "ifconfig", "jq", "kill", "less", "ls", "lsof",
        "md5", "md5sum", "more", "netstat", "nl", "nslookup", "od", "pgrep", "ping", "pkill",
        "printenv", "printf", "ps", "pwd", "read", "readlink", "realpath", "rev", "rg", "sed",
        "seq", "sha256sum", "shasum", "sleep", "sort", "stat", "strings", "sw_vers", "tail",
        "test", "tr", "tree", "true", "type", "uname", "uniq", "unset", "uptime", "vm_stat",
        "wait", "wc", "which", "whereis", "whoami", "xxd", "curl",
    }
)

#: git subcommands that only read, and the listing forms of the ones that can also write
#: (`git branch` lists; `git branch -D x` does not). `git commit` is work the digest sees.
_READ_ONLY_GIT = frozenset(
    {
        "blame", "cat-file", "check-ignore", "count-objects", "describe", "diff", "fetch",
        "for-each-ref", "grep", "help", "log", "ls-files", "ls-remote", "ls-tree",
        "merge-base", "name-rev", "rev-list", "rev-parse", "shortlog", "show", "status",
        "version",
    }
)
_GIT_LISTING = {
    "branch": frozenset({"-a", "-r", "-v", "-vv", "--all", "--remotes", "--list", "--show-current"}),
    "remote": frozenset({"-v", "show", "get-url"}),
    "stash": frozenset({"list", "show"}),
    "tag": frozenset({"-l", "--list"}),
    "worktree": frozenset({"list"}),
    "config": frozenset({"--get", "--get-all", "--get-regexp", "--list", "-l"}),
}
#: The ones that only list when run bare. A bare `git stash` PUSHES: it rewrites the
#: working tree.
_GIT_LISTS_BARE = frozenset({"branch", "remote", "tag"})

#: Flags that turn a reading program into a writing one.
_WRITING_FLAGS = {
    "sed": re.compile(r"^(-i|--in-place)"),
    "find": re.compile(r"^-(exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)$"),
    "curl": re.compile(r"^(-\w*[oO]|--output|--remote-name\S*|-J)$"),
    "sort": re.compile(r"^(-o|--output)"),
}

#: Writes a program can make from INSIDE its own script: awk's `print > "f"`, a pipe out
#: or `system()`, and sed's `w file` command.
_WRITES_INSIDE = {
    "awk": re.compile(r">|system\s*\(|\|\s*[\"']"),
    "sed": re.compile(r"(^|[\s;{}/'\"])[wW]\s+\S"),
}

#: Shell words that are not the program: a keyword before it, an assignment, a wrapper.
_SHELL_KEYWORDS = frozenset({"do", "then", "else", "elif", "if", "while", "until", "!", "time", "{", "}"})
_SHELL_NOOPS = frozenset({"done", "fi", "for"})
_ASSIGNMENT = re.compile(r"^[A-Za-z_]\w*=")

#: Redirections that write no file: into /dev/null, one descriptor onto another, and the
#: here string and heredoc openers (the body is skipped by `digest._command_lines`).
_HARMLESS_REDIRECT = re.compile(r"[&\d]?>{1,2}\s*/dev/null\b|\d?>&\d|&>\s*/dev/null\b|<<<|<<-?\s*['\"]?\w+['\"]?")

#: Tools that are not a shell and cannot change a file. Everything outside this set and
#: the edit tools could have: a helper agent (its edits are in a sidecar this module never
#: reads, CLAUDE.md "Globbing"), an MCP tool, a worktree being created.
_NON_WRITING_TOOLS = digest.READ_TOOLS | frozenset(
    {
        "Grep", "Glob", "LS", "WebSearch", "WebFetch", "ToolSearch", "TodoWrite", "TodoRead",
        "AskUserQuestion", "ExitPlanMode", "EnterPlanMode", "SendUserFile", "ListAgents",
        "Monitor", "BashOutput", "KillShell", "KillBash", "TaskOutput", "TaskStop",
        "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "Skill", "grep_search",
        "search_file_content", "glob", "list_directory", "google_web_search", "web_fetch",
        "list_files", "search_files", "grep", "list", "webfetch",
    }
)


def _split_commands(line: str) -> list[str] | None:
    """One command line cut into the simple commands it RUNS, or None when it writes a
    file through a redirection.

    Quote aware: a separator or a `>` inside quotes is data. A command substitution (`$(`,
    a backtick) runs even inside double quotes, so it is cut out there too; what follows
    its close is the outer command's argument (`cat $(ls)/x`, `"a $(b) c"`), which is data
    and not a program, up to the next separator.
    """
    line = _HARMLESS_REDIRECT.sub(" ", line)
    out: list[str] = []
    buf: list[str] = []
    data = False  # the buffer continues an argument after a substitution closed
    quote: str | None = None
    tick = False  # inside a backtick substitution
    i, n = 0, len(line)

    def cut(next_is_data: bool) -> None:
        nonlocal buf, data
        if not data:
            out.append("".join(buf))
        buf, data = [], next_is_data

    while i < n:
        c = line[i]
        if quote == "'":
            # Kept in the command, so a flag or a program text (`awk '{print > "f"}'`) can
            # still be read; never a separator.
            quote = None if c == "'" else quote
            buf.append(c)
            i += 1
            continue
        if c == "\\" and i + 1 < n:
            buf.append(line[i : i + 2])
            i += 2
            continue
        if c == "$" and i + 1 < n and line[i + 1] == "(":
            cut(False)
            i += 2
            continue
        if c == "`":
            tick = not tick
            cut(not tick)
            i += 1
            continue
        if c == ")":
            cut(True)
            i += 1
            continue
        if quote == '"':
            quote = None if c == '"' else quote
            buf.append(c)
            i += 1
            continue
        if c in "'\"":
            quote = c
            buf.append(c)
            i += 1
            continue
        if c == ">":
            return None  # a file is written: the harmless forms were removed above
        if c in ";|&(":
            cut(False)
            i += 2 if (i + 1 < n and line[i + 1] == c and c in "|&") else 1
            continue
        buf.append(c)
        i += 1
    cut(False)
    return [s.strip() for s in out if s.strip()]


def _simple_reads(command: str) -> bool:
    """Whether one simple command can only read."""
    words = command.split()
    while words and (words[0] in _SHELL_KEYWORDS or _ASSIGNMENT.match(words[0])):
        words = words[1:]
    if words and words[0] == "env":
        words = [w for w in words[1:] if not _ASSIGNMENT.match(w)]
    if words and words[0] == "timeout":
        words = words[2:]
    if not words or words[0] in _SHELL_NOOPS or words[0].startswith("#"):
        return True
    prog = words[0].rsplit("/", 1)[-1]
    if prog not in _READ_ONLY_PROGRAMS:
        return False
    flags = _WRITING_FLAGS.get(prog)
    if flags is not None and any(flags.match(w.strip("'\"")) for w in words[1:]):
        return False
    inside = _WRITES_INSIDE.get(prog)
    if inside is not None and inside.search(" ".join(words[1:])):
        return False
    if prog != "git":
        return True
    rest = words[1:]
    while rest and rest[0].startswith("-"):
        rest = rest[2:] if rest[0] in ("-C", "-c") else rest[1:]
    if not rest:
        return True
    sub, args = rest[0], rest[1:]
    if sub in _READ_ONLY_GIT:
        return True
    listing = _GIT_LISTING.get(sub)
    if listing is None or (not args and sub not in _GIT_LISTS_BARE):
        return False
    return all(a in listing for a in args)


def _shell_reads_only(text: str) -> bool:
    """Whether a shell call, as the digest kept it, can only have read.

    `Ev.text` is the command with newlines written ` ⏎ ` and cut at `digest.COMMAND_MAX`
    characters; a cut command hides its tail and is never read only. Heredoc bodies are
    skipped through `digest._command_lines`, the one function that knows where they end.
    """
    if not text or digest.is_cut(text):
        return False
    for line in digest.shell_lines(text):
        commands = _split_commands(line)
        if commands is None or not all(_simple_reads(c) for c in commands):
            return False
    return True


def _could_write_unseen(e: digest.Ev) -> bool:
    """A call that could have changed a file without the digest seeing it: a shell command
    that is not provably read only (and not a write the digest already named), an edit
    tool the digest could not name a file for, or any tool outside `_NON_WRITING_TOOLS`.

    The edit tool case is MEASURED on this machine's real Codex rollout
    (`rollout-2026-03-28T00-38-20`, 2026-03-28): the writer wraps every `apply_patch`
    output as `{"output": "Success. ..."}`, the loader reads all 52 successful patches
    (4,153 added lines, counted by hand) as failures and names no path, and burn called 22
    of its 39 segments barren. A patch call is an attempt to write, never proof of none.
    """
    if e.kind != "tool" or e.tool in digest.COMMIT_TOOLS:
        return False
    if e.tool in digest.EDIT_TOOLS:
        return not _is_write(e)
    if e.tool in digest.SHELL_TOOLS:
        return not _is_write(e) and not _shell_reads_only(e.text)
    return e.tool not in _NON_WRITING_TOOLS


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
        """Files a call changed (`_is_write`) that the harness did not answer with an error
        (`failed_calls`): a rejected Edit changed nothing, and `live` already said so."""
        failed = failed_calls(self.events)
        return len({e.path for e in self.events if _is_write(e) and id(e) not in failed})

    @property
    def commits(self) -> int:
        """Commit calls the harness did not answer with an error (`failed_calls`). A
        refused `git commit` made no commit. MEASURED on the real corpus (2026-09-13): 148
        visible `git commit` calls, 2 answered by an error, and one stretch's only work was
        one of those ("Changes not staged for commit", exit 1), which read "it made 1
        commit"."""
        failed = failed_calls(self.events)
        return sum(
            1 for e in self.events if patterns._committed(e) and id(e) not in failed
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
        not here. Being generous here, and refusing to judge what the digest cannot see
        (`unreadable`), is what makes `barren` segments unambiguous.
        """
        return bool(
            self.lines_added or self.lines_removed or self.files_touched or self.commits
        )

    @property
    def unreadable_calls(self) -> int:
        """Calls that could have changed a file the digest cannot see (`_could_write_unseen`)."""
        return sum(1 for e in self.events if _could_write_unseen(e))

    @property
    def unreadable(self) -> bool:
        """Spent tokens with no visible work, but ran something that could have changed a
        file this transcript does not show. Neither barren nor productive: absent, not
        zero (see the measurement above `_READ_ONLY_PROGRAMS`)."""
        return self.tokens > 0 and not self.produced_work and self.unreadable_calls > 0

    @property
    def barren(self) -> bool:
        """Spent tokens, changed nothing. The segment people remember as wasted.

        Reading is not nothing, so a segment that only investigated is barren by this
        definition but is labelled `investigated` in the cause list rather than accused.
        The distinction matters: a person who spent 40 minutes reading is not in the same
        situation as one who spent 40 minutes failing to edit. (A test run can write
        snapshots and caches, so a segment that ran one is unreadable, not barren.)

        Only a segment whose every call is one the digest can see through is barren. One
        that ran a script, a build or a helper agent and shows no work is `unreadable`:
        MEASURED, calling those barren put 31.5% of the corpus's tokens under "nothing was
        written" where 2.9% can be shown to be.
        """
        return self.tokens > 0 and not self.produced_work and not self.unreadable_calls

    @property
    def cost_per_line(self) -> float | None:
        lines = self.lines_added + self.lines_removed
        return (self.tokens / lines) if lines else None

    # ---- causes -----------------------------------------------------------
    def _detected(self) -> list[dict]:
        """The causes present in this segment, most explanatory first, without tokens.

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

        if self.errors >= ERROR_LOOP_MIN_ERRORS:
            out.append(
                {
                    "cause": "error_loop",
                    "detail": f"{self.errors} failing tool results",
                    "n": self.errors,
                }
            )

        sig, repeats = _top_repeat(self.events)
        if repeats >= REPEATED_CALL_MIN:
            out.append(
                {
                    "cause": "repeated_call",
                    "detail": f"the same tool call ran {repeats} times",
                    "n": repeats,
                    # Which tool repeated, so a sentence can say "command" only when it
                    # was one. MEASURED on the real corpus (940 segments, 2026-09-13):
                    # this cause fired in 41, and in 38 the repeated call was an Edit or a
                    # Read whose digest text is just the path; 1 was a shell command.
                    "tool": sig[0] if sig else None,
                }
            )

        churn_file, churn_n = _churn(self.events)
        if churn_n >= FILE_CHURN_MIN_WRITES:
            out.append(
                {
                    "cause": "file_churn",
                    "detail": f"{pathlib.Path(churn_file).name} rewritten {churn_n} times",
                    "n": churn_n,
                }
            )

        if self.cache_read and self.tokens:
            share = self.cache_read / self.tokens
            if share >= CONTEXT_REPLAY_MIN_SHARE:
                out.append(
                    {
                        "cause": "context_replay",
                        # `_share_words`, as the spike sentence says it: `:.0%` printed
                        # "100% of the cost was replaying" above "over 99% of it
                        # re-reading" about one 159,754,580 token stretch (FOUND IN
                        # REVIEW, 5 corpus transcripts).
                        "detail": f"{_share_words(share)} of the cost was replaying "
                        "conversation already in context",
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
        # "and nothing written" must be provable: a segment that also ran a script is
        # unreadable, not a pure read (see `barren`).
        if reads >= INVESTIGATED_MIN_READS and not self.produced_work and not self.unreadable_calls:
            out.append(
                {
                    "cause": "investigated",
                    "detail": f"{reads} files read and nothing written",
                    "n": reads,
                }
            )

        return out

    def attribution(self) -> dict[str, int]:
        """Per present cause, the tokens it can claim out of `self.tokens`.

        A claim is always a set of this segment's own turns, so it can never exceed the
        segment and never includes a helper agent's tokens (module docstring, rule 2).
        Claims OVERLAP: a turn that dispatched a helper and whose call then failed is
        claimed by both `subagent_fanout` and `error_loop`.

        * context_replay: every cache read in the segment;
        * compaction: the fresh tokens of the first turn at or after each compaction;
        * subagent_fanout: fresh tokens of the turns that issued a `TASK_TOOLS` call;
        * error_loop: fresh tokens of the turns that issued a call answered by an error;
        * repeated_call: fresh tokens of the turns that issued the second and later
          copies of the most repeated call;
        * file_churn: fresh tokens of the turns that issued the second and later writes
          to the most rewritten file;
        * investigated: fresh tokens of the turns that issued a read.
        """
        present = [c["cause"] for c in self._detected()]
        tools = [e for e in self.events if e.kind == "tool"]
        out: dict[str, int] = {}
        for cause in present:
            if cause == "context_replay":
                out[cause] = self.cache_read
            elif cause == "compaction":
                ordered = sorted(self.turns, key=lambda t: t.ts)
                claimed: set[int] = set()
                for c in (e for e in self.events if e.kind == "compaction"):
                    first = next((i for i, t in enumerate(ordered) if t.ts >= c.ts), None)
                    if first is not None:
                        claimed.add(first)
                out[cause] = sum(ordered[i].fresh for i in claimed)
            elif cause == "subagent_fanout":
                out[cause] = self._fresh_of({e.tool_id for e in tools if e.tool in TASK_TOOLS})
            elif cause == "error_loop":
                out[cause] = self._fresh_of(
                    {e.tool_id for e in self.events if e.kind == "result_error"}
                )
            elif cause == "repeated_call":
                sig, _ = _top_repeat(self.events)
                copies = [e for e in tools if _signature(e) == sig]
                out[cause] = self._fresh_of({e.tool_id for e in copies[1:]})
            elif cause == "file_churn":
                path, _ = _churn(self.events)
                writes = [e for e in self.events if _is_write(e) and e.path == path]
                out[cause] = self._fresh_of({e.tool_id for e in writes[1:]})
            elif cause == "investigated":
                out[cause] = self._fresh_of(
                    {e.tool_id for e in tools if e.tool in digest.READ_TOOLS}
                )
        return out

    def _fresh_of(self, call_ids: set[str | None]) -> int:
        """Fresh tokens of the turns that issued any of `call_ids`, each turn once."""
        ids = {i for i in call_ids if i}
        return sum(t.fresh for t in self.turns if ids.intersection(t.tool_ids))

    def causes(self) -> list[dict]:
        """Why this segment cost what it did, most explanatory first.

        Each entry is `{cause, detail, n, tokens, share}`: `tokens` is what the cause can
        claim (`attribution`) and `share` that over the segment's tokens, 3 dp. Both are
        None when the segment carries no tokens at all, because a claim of 0 out of
        nothing would read as "this cost nothing" rather than "this was not counted".
        """
        claims = self.attribution()
        total = self.tokens
        out = []
        for c in self._detected():
            tokens = claims.get(c["cause"]) if total else None
            out.append(
                {
                    **c,
                    "tokens": tokens,
                    "share": round(tokens / total, 3) if tokens is not None else None,
                }
            )
        return out

    def dominant_cause(self) -> dict | None:
        """The cause entry claiming the most tokens, ties to list order. None when no cause
        claims a single token: naming one that claims nothing would blame a cost on
        something that is not in the number."""
        return _dominant(self.causes())


def _dominant(causes: Sequence[dict]) -> dict | None:
    best: dict | None = None
    for c in causes:
        if not c.get("tokens"):
            continue
        if best is None or c["tokens"] > best["tokens"]:
            best = c
    return best


def _signature(e: digest.Ev) -> tuple[str | None, str]:
    """What makes two tool calls "the same call": the tool and its whitespace-normalised
    text, cut at 200 characters."""
    return (e.tool, re.sub(r"\s+", " ", e.text).strip()[:200])


def _top_repeat(events: Iterable[digest.Ev]) -> tuple[tuple[str | None, str] | None, int]:
    """(the most repeated call signature, how many times). Ties go to the one seen first."""
    sigs = collections.Counter(_signature(e) for e in events if e.kind == "tool")
    if not sigs:
        return None, 0
    return sigs.most_common(1)[0]


def _max_repeat(events: Iterable[digest.Ev]) -> int:
    return _top_repeat(events)[1]


def _churn(events: Iterable[digest.Ev]) -> tuple[str | None, int]:
    writes = collections.Counter(e.path for e in events if _is_write(e))
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

    Segment 0 opens at the first thing RECORDED, a turn or an event, never at the first
    event alone. A turn's time is its message's FIRST record, which is often a thinking
    block written a second or three before the text or tool call the digest turns into an
    event, so a window that opens mid conversation starts with a turn older than every
    event. MEASURED on the real corpus (2026-09-13, 156 counted sessions): opening at the
    first event dropped 20 turns, 8,902,171 tokens, from every segment and every total,
    and one session lost 762,339 of its 3,052,559 (25%).
    """
    prompts = [e for e in events if e.kind == "prompt"]
    first = min((x.ts for x in (*events, *turns)), default=0.0)
    bounds: list[tuple[float, str]] = [(first, "")]
    if prompts:
        if prompts[0].ts <= first:
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


def session_burn_detail(events: Sequence[digest.Ev], turns: Sequence[Turn]) -> dict | None:
    """`{tokens, barren, unreadable, causes}` for one session: tokens inside segments, the
    part in barren segments, the part in unreadable ones (`Segment.unreadable`), which is
    neither barren nor productive, and `causes`, `{cause: (tokens, segments)}` summed from
    `Segment.attribution` over the BARREN segments only: what each cause can claim of the
    tokens that changed nothing, and in how many of those segments it appeared. Claims
    overlap (rule 4), so the causes' tokens never sum to `barren`, and each is at most it.

    None unless the turns carry usage (`records_usage`): a session whose harness wrote no
    counts has no share to contribute, and zeros would pull a corpus share toward zero.
    Also None with no events, because without them there is nothing to cut segments at,
    and every token would land in one segment that "changed nothing", which would be a
    claim about the parser rather than the session.
    """
    if not events or not records_usage(turns):
        return None
    segs = segments(events, turns)
    causes: dict[str, tuple[int, int]] = {}
    for s in segs:
        if not s.barren:
            continue
        for cause, claimed in s.attribution().items():
            tokens, n = causes.get(cause, (0, 0))
            causes[cause] = (tokens + claimed, n + 1)
    return {
        "tokens": sum(s.tokens for s in segs),
        "barren": sum(s.tokens for s in segs if s.barren),
        "unreadable": sum(s.tokens for s in segs if s.unreadable),
        "causes": causes,
    }


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


def _usage_refusal(harness: str) -> str:
    """Why cost cannot be attributed, naming the right party: this module, or the file.

    Never "this harness writes no counts" for a harness in `USAGE_READERS`: Codex and
    Gemini do, and a rollout killed before its first response (both real writer fixtures,
    `spec/fixtures/codex/real_first_records.jsonl` and its Gemini twin) simply has none
    yet. The claim is about the transcript, which is the thing that was read.
    """
    if harness not in USAGE_READERS:
        return f"burn forensics does not read {harness} token counts yet"
    return "this transcript does not record token counts, so cost cannot be attributed"


def burn_report(
    path: pathlib.Path,
    *,
    start: float | None = None,
    end: float | None = None,
    spike_multiple: float = SPIKE_MULTIPLE,
) -> dict:
    """Everything this module can honestly say about one transcript's cost.

    `start` and `end` window the turns exactly as they window the events. Before, only the
    events were windowed, so every turn after `end` was filed into the last segment and
    reported as its cost.
    """
    path = pathlib.Path(path)
    harness = digest.detect_harness(path)
    events = digest.load_events(path, start, end)
    turns = [
        t
        for t in load_turns(path)
        if (start is None or t.ts >= start) and (end is None or t.ts <= end)
    ]
    return session_report(events, turns, harness=harness, spike_multiple=spike_multiple)


def session_report(
    events: Sequence[digest.Ev],
    turns: Sequence[Turn],
    *,
    harness: str,
    spike_multiple: float = SPIKE_MULTIPLE,
    files_record_usage: bool | None = None,
) -> dict:
    """`burn_report` over events and turns already in hand: one sitting of a pooled corpus,
    whose records came from several files (`turns_for_window` over every one of them), or
    the hook channel's in memory cut. The same report, so `explain` and `session_wire` read
    one shape whichever way the session was loaded. `harness` is what wrote the session
    (`digest.detect_harness`, or the capture pool's): it decides which refusal is true.

    `files_record_usage` is `files_record_usage(paths)` when the caller has the files: a window
    with no counts in files that record them is `nothing_inside_segments`, never
    `no_token_counts`. None keeps the window's own answer (a caller with no files).
    """
    has_usage = bool(events) and (records_usage(turns) or files_record_usage is True)
    segs = segments(events, turns) if events else []
    missing: list[str] = []

    if not events:
        missing.append("the transcript held no readable events")
    elif not has_usage:
        missing.append(_usage_refusal(harness))
    no_usage = "the transcript held no readable events" if not events else _usage_refusal(harness)

    total_tokens = sum(s.tokens for s in segs)
    total_added = sum(s.lines_added for s in segs)
    total_removed = sum(s.lines_removed for s in segs)
    total_cache = sum(s.cache_read for s in segs)
    failed = failed_calls(events)
    total_files = len({e.path for e in events if _is_write(e) and id(e) not in failed})

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
                spikes.append(_segment_row(s, median_cost, has_usage))
        spikes.sort(key=lambda r: -r["tokens"])

    # ---- barren spend, and the spend this transcript cannot judge ---------
    barren = [_segment_row(s, median_cost, has_usage) for s in segs if has_usage and s.barren]
    barren.sort(key=lambda r: -r["tokens"])
    barren_tokens = sum(r["tokens"] for r in barren)
    unreadable = [s for s in segs if has_usage and s.unreadable]
    unreadable_tokens = sum(s.tokens for s in unreadable)

    # ---- cause rollup -----------------------------------------------------
    by_cause: dict[str, dict] = {}
    for s in segs:
        for c in s.causes():
            row = by_cause.setdefault(
                c["cause"],
                {"cause": c["cause"], "segments": 0, "tokens": 0, "attributed_tokens": 0},
            )
            row["segments"] += 1
            row["tokens"] += s.tokens
            row["attributed_tokens"] += c["tokens"] or 0
    # `tokens` is every token in a segment that carried the cause, so these shares
    # OVERLAP and do not sum to 1; the field is named for what it is and the printer says
    # so. `attributed_tokens` is only what the cause itself can claim (rule 4), which is
    # the number to quote when saying what a cause cost.
    causes = sorted(by_cause.values(), key=lambda r: -r["tokens"])
    for c in causes:
        c["share_of_session"] = _round(c["tokens"] / total_tokens, 3) if total_tokens else None
        if not has_usage:
            # Without counts a segment's 0 tokens is "not recorded", not "cost nothing".
            c["tokens"] = None
            c["attributed_tokens"] = None
        c["attributed_share"] = (
            _round(c["attributed_tokens"] / total_tokens, 3)
            if has_usage and total_tokens
            else None
        )

    lines_reason = None if events else "the transcript held no readable events"
    return {
        "harness": harness,
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
                None if has_usage else no_usage,
            ),
            "cache_read_share": _metric(
                _round(total_cache / total_tokens, 3) if has_usage and total_tokens else None,
                "fraction",
                len(turns),
                "cache_read_input_tokens over all counted tokens",
                None if has_usage and total_tokens else "no token counts to divide",
                # The integer the share was divided from, so a sentence can round once.
                cache_read_tokens=total_cache if has_usage else None,
            ),
            "lines_added": _metric(
                total_added if events else None,
                "lines",
                len(events),
                # `sed -i` names a file and no count, so it adds no lines here.
                "edit-tool deltas plus credited shell writes (heredoc)",
                lines_reason,
            ),
            "lines_removed": _metric(
                total_removed if events else None,
                "lines",
                len(events),
                "edit-tool deltas plus credited shell writes",
                lines_reason,
            ),
            # Distinct files across the whole transcript, so a file changed in two
            # segments is one file (the segment rows count per segment).
            "files_touched": _metric(
                total_files if events else None,
                "files",
                len(events),
                "files a call named and changed, less the calls an error answered",
                lines_reason,
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
                barren_tokens=barren_tokens if has_usage else None,
            ),
            "unreadable_token_share": _metric(
                _round(unreadable_tokens / total_tokens, 3) if has_usage and total_tokens else None,
                "fraction",
                len(unreadable),
                "tokens in segments with no visible work whose scripts, builds or helper "
                "agents could have changed files this transcript does not show, over all "
                "counted tokens",
                None if has_usage and total_tokens else "no token counts to divide",
                unreadable_tokens=unreadable_tokens if has_usage else None,
            ),
        },
        "causes": causes,
        "spikes": spikes,
        "barren": barren,
        "segments": [_segment_row(s, median_cost, has_usage) for s in segs],
        "median_segment_tokens": median_cost if has_usage else None,
    }


# --------------------------------------------------------------------------
# the wire: one session's burn as numbers and enums
# --------------------------------------------------------------------------

#: Why a session's burn is refused, as the code the upload carries
#: (privacy/upload-contract.json `burn.reason`, the `burn_refusal` enum). Three facts, three
#: codes: nothing to cut segments at (no events); a transcript that records no usage (a
#: harness this module does not read yet is the same code, and the phone names the tool
#: from the session's `harness`, as `explain` does); usage recorded, and none of it inside
#: a segment. The fourth value of the enum, `below_session_floor`, is the corpus block's
#: (`profile.BARREN_CODES`) and never a session's. Pinned to the spec enum by
#: `analysis/tests/test_report_blocks.py`.
REFUSE_NOT_SEGMENTED = "not_segmented"
REFUSE_NO_COUNTS = "no_token_counts"
REFUSE_NOTHING_INSIDE = "nothing_inside_segments"
SESSION_REFUSALS: tuple[str, ...] = (REFUSE_NO_COUNTS, REFUSE_NOTHING_INSIDE, REFUSE_NOT_SEGMENTED)

#: At most this many costly stretches and this many causes a stretch travel on the wire
#: (the contract's `max_items`): the summary names one stretch and one cause, and the
#: session screen lists a few. Pinned to the contract by the test that pins the enums.
WIRE_MAX_SPIKES = 3
WIRE_MAX_CAUSES = 3


def session_refusal(report: Mapping) -> str | None:
    """The code for why `report` (`session_report`, `burn_report`) has no tokens, or None."""
    if not report["sample"]["events"]:
        return REFUSE_NOT_SEGMENTED
    if not report["harness_records_usage"]:
        return REFUSE_NO_COUNTS
    if not report["totals"]["tokens"]["value"]:
        return REFUSE_NOTHING_INSIDE
    return None


def _share_of(tokens: int | None, total: int) -> float | None:
    """A share left UNROUNDED, so whoever says it rounds once (`_unrounded`)."""
    return tokens / total if isinstance(tokens, int) and total else None


def _wire_cause(c: Mapping) -> dict:
    return {
        "cause": c["cause"],
        "n": int(c["n"]),
        "tokens": c.get("tokens"),
        # Only a repeat is said by what repeated: "the same command" is true of a shell
        # call alone (`_repeat_kind`, `_REPEAT_SENTENCES`).
        "repeat": _repeat_kind(c.get("tool")) if c["cause"] == "repeated_call" else None,
    }


def _wire_causes(causes: Sequence[Mapping]) -> list[dict]:
    """The causes claiming the most tokens, most first, ties in burn's own order (a stable
    sort), so `[0]` is `_dominant` whenever any cause claims a token."""
    ranked = sorted(causes, key=lambda c: -(c.get("tokens") or 0))
    return [_wire_cause(c) for c in ranked[:WIRE_MAX_CAUSES]]


def session_wire(report: Mapping) -> dict:
    """One session's burn as the upload carries it (privacy/upload-contract.json `burn`,
    `SessionBurn`): counts, shares, enums and at most three costly stretches. No prompt, no
    path, no command, no file name and no tool name: the phone writes every sentence, and
    `spec/fixtures/burn/session.json` pins its sentences to `explain` over the same report.

    Absent is null, never 0 (CLAUDE.md): the token fields and the shares are null exactly
    when `reason` is set; the work counts are null only when the window held no events;
    `spikes` is null when no stretch can be named (a refusal, or fewer than
    `MIN_SEGMENTS_FOR_SPIKES` segments, where a median would be an accident) and `[]` only
    when enough segments were measured and none cleared the bar.
    """
    reason = session_refusal(report)
    t = report["totals"]
    total = t["tokens"]["value"] if reason is None else None
    segs = report.get("segments") or []
    has_events = bool(report["sample"]["events"])
    enough = report["sample"]["segments"] >= MIN_SEGMENTS_FOR_SPIKES
    spikes = None
    if reason is None and enough:
        spikes = [
            {
                "tokens": row["tokens"],
                "multiple": row["multiple_of_median"],
                "barren": row["barren"],
                "lines_added": row["lines_added"],
                "lines_removed": row["lines_removed"],
                "seconds": int(row["seconds"] or 0),
                "causes": _wire_causes(row["causes"]),
                "files_changed": row["files_touched"],
                "commits": row["commits"],
                "unreadable": row["unreadable"],
            }
            for row in (report.get("spikes") or [])[:WIRE_MAX_SPIKES]
        ]
    return {
        "tokens": total,
        "cache_read_share": _share_of(t["cache_read_share"].get("cache_read_tokens"), total)
        if total
        else None,
        "barren_share": _share_of(t["barren_token_share"].get("barren_tokens"), total)
        if total
        else None,
        "unreadable_share": _share_of(
            (t.get("unreadable_token_share") or {}).get("unreadable_tokens"), total
        )
        if total
        else None,
        "segments": report["sample"]["segments"],
        "lines_added": t["lines_added"]["value"] if has_events else None,
        "lines_removed": t["lines_removed"]["value"] if has_events else None,
        "files_changed": t["files_touched"]["value"] if has_events else None,
        "commits": sum(r.get("commits") or 0 for r in segs) if has_events else None,
        "reason": reason,
        "spikes": spikes,
        "spikes_needed": MIN_SEGMENTS_FOR_SPIKES,
    }


def _segment_row(s: Segment, median_cost: float, has_usage: bool = True) -> dict:
    """One segment as the report carries it. Without token counts its token fields are
    None: a row reading `tokens: 0` would say the stretch cost nothing, when the harness
    simply recorded nothing (module docstring, rule 3)."""
    causes = s.causes()
    return {
        "index": s.index,
        "started_at": s.start_ts,
        "seconds": _round(s.seconds, 1),
        "prompt": s.prompt[:160],
        "tokens": s.tokens if has_usage else None,
        "output_tokens": s.output_tokens if has_usage else None,
        "cache_read": s.cache_read if has_usage else None,
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
        "unreadable": s.unreadable,
        "unreadable_calls": s.unreadable_calls,
        "cost_per_line": _round(s.cost_per_line, 1) if has_usage else None,
        "causes": causes,
        "dominant": _dominant(causes),
    }


# --------------------------------------------------------------------------
# plain language
# --------------------------------------------------------------------------

#: The phrase each cause contributes to "The most expensive stretch cost {cost} tokens,
#: {share} of it {phrase}, and {verdict}." Written for someone who has never read a stack
#: trace. The rule from docs/analysis.md holds here: no dashes in any string a person reads.
_CAUSE_SENTENCES = {
    "context_replay": "re-reading the conversation so far",
    "subagent_fanout": "on the turns that handed work to {n} helper agents",
    "error_loop": "on {n} failing tool calls and the retries after them",
    "repeated_call": "on running the same command {n} times",
    "file_churn": "on rewriting the same file {n} times",
    "compaction": "on rebuilding the context after it was summarised",
    "investigated": "on reading {n} files",
}

#: The same phrases where the count is exactly one. Only a fan out can be one: the other
#: counted causes start at 3 (errors, repeats), 4 (rewrites) or 8 (reads).
_CAUSE_SENTENCES_ONE = {
    "subagent_fanout": "on the turn that handed work to {n} helper agent",
}

#: `repeated_call` by the tool that repeated. "The same command" is true only of a shell
#: call; an Edit's signature is its path, so three of them are three edits to one file,
#: not one edit made three times (see the measurement on the cause itself).
_REPEAT_SENTENCES = {
    "shell": _CAUSE_SENTENCES["repeated_call"],
    "edit": "on editing the same file {n} times",
    "read": "on reading the same file {n} times",
    "other": "on making the same tool call {n} times",
}


def _repeat_kind(tool: str | None) -> str:
    if tool in digest.SHELL_TOOLS:
        return "shell"
    if tool in digest.EDIT_TOOLS:
        return "edit"
    if tool in digest.READ_TOOLS:
        return "read"
    return "other"


def _phrase(cause: Mapping) -> str | None:
    n = cause.get("n")
    name = cause["cause"]
    if name == "repeated_call":
        template = _REPEAT_SENTENCES[_repeat_kind(cause.get("tool"))]
    else:
        template = (_CAUSE_SENTENCES_ONE if n == 1 else _CAUSE_SENTENCES).get(
            name, _CAUSE_SENTENCES.get(name)
        )
    return template.format(n=f"{n:,}" if isinstance(n, int) else n) if template else None


def _share_words(share: float) -> str:
    """A share as a person says it. A positive share that rounds to 0% is "under 1%": a
    zero is printed only when it was measured. The mirror holds at the top: a share short
    of all of it that rounds to 100% is "over 99%". MEASURED on the real corpus
    (2026-09-13): 5 of 32 spike sentences said "100% of it re-reading the conversation"
    where the share was 99.5% to 99.8%; the largest left 371,256 of 159,754,580 tokens
    that were not re-reading at all."""
    if 0 < share < 0.005:
        return "under 1%"
    if 0.995 <= share < 1:
        return "over 99%"
    return f"{share:.0%}"


def _count(n: int, noun: str) -> str:
    return f"{n:,} {noun}{'' if n == 1 else 's'}"


#: What an `unreadable` stretch produced, said without claiming either way. No number: the
#: count of files it changed is exactly what the transcript does not hold.
UNREADABLE_VERDICT = "whether it changed any file cannot be read from this transcript"


def _verdict(row: Mapping) -> str:
    """What the stretch produced, never a number it does not have. A segment that removed
    lines, or touched a file with no line count (an edit whose result carried no patch), or
    only committed, has produced work and did not "write 0 lines". A segment whose work ran
    through a script or a helper agent is `unreadable` and is never told it wrote nothing."""
    if row["barren"]:
        return "nothing was written"
    if row["lines_added"]:
        return f"it wrote {_count(row['lines_added'], 'line')}"
    if row["lines_removed"]:
        return f"it removed {_count(row['lines_removed'], 'line')}"
    if row["files_touched"]:
        return f"it changed {_count(row['files_touched'], 'file')}"
    if row["commits"]:
        return f"it made {_count(row['commits'], 'commit')}"
    if row.get("unreadable"):
        return UNREADABLE_VERDICT
    return "nothing was written"


def explain(report: Mapping) -> list[str]:
    """The report as sentences a non-technical builder can act on.

    Deliberately short and deliberately not a scolding: the worst thing this module could
    do is tell someone who had a bad afternoon that they had a bad afternoon. Where a
    segment spent a lot and produced nothing, the sentence says what it was doing, not
    that it failed.
    """
    lines: list[str] = []
    if not report.get("sample", {}).get("events"):
        return ["Nothing in this transcript could be read yet, so there is no cost to show."]
    if not report.get("harness_records_usage"):
        if report.get("harness", "claude_code") not in USAGE_READERS:
            return ["Cost is not shown for this tool yet."]
        return ["This transcript does not record token counts, so cost cannot be shown."]

    totals = report["totals"]
    total = totals["tokens"]["value"] or 0
    lines.append(f"This session used {_human(total)} tokens{_work_clause(report)}.")

    share = _unrounded(totals["cache_read_share"], "cache_read_tokens", total)
    if share is not None and share >= CONTEXT_REPLAY_MIN_SHARE:
        said = _share_words(share)
        lines.append(
            f"{said[0].upper()}{said[1:]} of that was the conversation re-reading itself, "
            "which is normal in a long session and is the main reason cost climbs the "
            "longer you go."
        )

    barren_share = _unrounded(totals["barren_token_share"], "barren_tokens", total)
    if barren_share is not None and barren_share >= SAY_SHARE_AT:
        lines.append(
            f"{_about(barren_share)} went into stretches where nothing was written. "
            "That is not always wasted, but it is where to look first."
        )

    unreadable = totals.get("unreadable_token_share")
    unreadable_share = _unrounded(unreadable, "unreadable_tokens", total) if unreadable else None
    if unreadable_share is not None and unreadable_share >= SAY_SHARE_AT:
        lines.append(
            f"{_about(unreadable_share)} went into stretches whose commands or helper "
            "agents may have changed files this transcript does not show."
        )

    # Only the most expensive spike may be called "the most expensive stretch". The first
    # version walked down the list to the first spike with a cause, which printed the
    # second spike's cost under the first one's name.
    spikes = report.get("spikes") or []
    if spikes:
        row = spikes[0]
        cost = _human(row["tokens"])
        dominant = row.get("dominant")
        phrase = _phrase(dominant) if dominant else None
        if phrase and dominant.get("tokens") and row["tokens"]:
            # From the unrounded claim, so this sentence and the cause's own `detail`
            # ("95% of the cost was replaying ...") can never print two different numbers
            # for one quantity: `share` is already rounded to 3 dp, and rounding twice
            # turned 0.9451 into 94% beside a 95%.
            share = dominant["tokens"] / row["tokens"]
            lines.append(
                f"The most expensive stretch cost {cost} tokens, "
                f"{_share_words(share)} of it {phrase}, and {_verdict(row)}."
            )
        else:
            lines.append(f"The most expensive stretch cost {cost} tokens, and {_verdict(row)}.")

    return lines


def _about(share: float) -> str:
    """A share opening a sentence: "About 40%", and never "About 100%" or "About 0%" for
    a share that is short of all or more than none (`_share_words` says "over 99%" and
    "under 1%", which need no "about"). FOUND IN REVIEW: a 0.996 share read "About 100%
    went into stretches where nothing was written" under a numbers block saying "over
    99%"."""
    said = _share_words(share)
    if said.startswith(("under", "over")):
        return said[0].upper() + said[1:]
    return f"About {said}"


def _work_clause(report: Mapping) -> str:
    """What the session did to files, for the first sentence of `explain`, from the rules
    `_verdict` uses for one stretch: never a line count the digest does not have.

    "changed 0 lines (and removed 0)" was printed for transcripts whose work the digest
    cannot see (an unreadable share up to all of it) and beside "it made 4 commits", and
    "changed 0 lines (and removed 40)" for a session that only removed lines, which says
    both things at once (FOUND IN REVIEW, 17 corpus transcripts). Now: the lines it added
    and removed when either is counted; else the files or commits the segments show; else,
    when a segment ran something the transcript cannot see into, that it cannot say; and
    "nothing was written" only when no segment did (each proven barren, `_verdict`).
    """
    t = report["totals"]
    added = t["lines_added"]["value"] or 0
    removed = t["lines_removed"]["value"] or 0
    segs = report.get("segments") or []
    if added or removed:
        return f", added {_count(added, 'line')} and removed {removed:,}"
    files = (t.get("files_touched") or {}).get("value") or 0
    commits = sum(r.get("commits") or 0 for r in segs)
    if files:
        return f" and changed {_count(files, 'file')} with no line count"
    if commits:
        return f" and made {_count(commits, 'commit')}"
    if any(r.get("unreadable") for r in segs):
        return ", and whether it changed any file cannot be read from this transcript"
    return ", and nothing was written"


#: A share worth a sentence of its own in `explain`. UNMEASURED JUDGEMENT CALL: the bar the
#: barren sentence has always used, now named so the unreadable one uses the same.
SAY_SHARE_AT = 0.2


def _unrounded(metric: Mapping, tokens_key: str, total: int) -> float | None:
    """A share from the integers it was divided from, so a sentence rounds ONCE. The
    report's `value` is already rounded to 3 dp, and rounding it again printed 96% for the
    live transcript's cache reads, 20,054,958 of 21,009,013 tokens, which is 95%."""
    value = metric.get("value")
    tokens = metric.get(tokens_key)
    if value is None:
        return None
    if isinstance(tokens, int) and total:
        return tokens / total
    return value


def _human(n: int) -> str:
    """A token count as a person says it. 999,500 is "1.0M", never "1000k", and the millions
    are grouped like every other number: 3,766,512,000 is "3,766.5M". FOUND IN THE FINAL
    CAPTURE (2026-09-13): the CLI wrote "3766.5M" where the phone wrote "3,766.5M" for the
    same count; one grouping rule now, so the two agree to the byte
    (`mobile/src/copy/numbers.ts human`, pinned by `__tests__/copyNumbers.test.ts`)."""
    if n >= 1_000_000 or round(n / 1_000) >= 1_000:
        return f"{n / 1_000_000:,.1f}M"
    if n >= 1_000:
        return f"{n / 1_000:.0f}k"
    return str(n)
