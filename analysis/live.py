"""One running session: what it is doing, whether it is working, and whether it needs you.

`burn.py` answers questions about a session that ended. This answers the ones a person has
while an agent is still running, which is the whole of mission control
(docs/approved-roadmap.md, Part 2): what is it doing right now, in a sentence; is this going
to work (converging, circling or lost); how long runs like this take on this repository; which
of its choices were hard to undo; and, across every running session, which one needs you
first.

The contract is `docs/overnight-engine.md` section 3. Four rules from CLAUDE.md shape it,
because breaking any of them produces a plausible wrong sentence rather than a crash:

1. **A tool with no result for a long time is idle, never waiting on you.** A permission
   prompt and a long test run look identical in a transcript. The only thing that means "the
   agent handed the turn back" is the harness saying so (`stop_reason == "end_turn"`), and
   without it (every loader but Claude Code's) a long silence after assistant text.
2. **Absent is not zero, and a refusal carries its reason.** The ETA refuses below ten
   similar finished sessions and says how many it had. A verdict no rule supports is None
   with the counts that were checked, never a softened guess.
3. **One rule, one function.** Circling is `burn.Segment.causes()` and
   `feedback._worst_failure_run` on the recent window, not a fork of either; a checkpoint is
   `patterns._checkpoint`; a test run is `quality.TEST_CMD`; a write is `patterns._wrote`; a
   changed file `patterns._touched`; Claude Code's own file `patterns.harness_event`; a
   failed call `burn.failed_calls`; a role is `plain.role_of`; the heredoc rule is
   `digest._command_lines` and the separator rule `digest.split_simple`.
4. **WIRE and LOCAL never mix.** Ids, counts, enums, seconds and salted hashes may travel.
   Paths, file names, commands and package names stay on this machine (`names`, `detail`,
   and any `sentence(names=True)`), and `wire()` drops them.
"""

from __future__ import annotations

import collections
import copy
import hashlib
import hmac
import posixpath
import re
import statistics
import types
from collections.abc import Iterable, Mapping, Sequence
from typing import TYPE_CHECKING

from capture.reference import mb as _mb

from . import burn, digest, feedback, patterns, plain, quality

if TYPE_CHECKING:  # pragma: no cover
    import pathlib

    from capture import discover, sessions

    from . import profile

# ------------------------------------------------------------------------------ constants

#: MEASURED: record gap p98 is 63 s (CLAUDE.md groundtruth table). Used ONLY when the loader
#: could not read `stop_reason`: assistant text followed by this much silence is the turn
#: handed back, where anything shorter is the agent between two thoughts.
WAITING_MIN_SEC = 63

#: MEASURED: record gap p90 is 13 s. A tool result this old with nothing after it is the
#: agent composing its next step, not the tool still running.
THINKING_MIN_SEC = 13

#: MEASURED: record gap p99 is 171 s. A silence longer than 180 s is not the agent's cadence.
IDLE_SEC = 180

#: The stop reasons that hand the turn back. `end_turn` is the model's own. `stop_sequence`
#: is what Claude Code stamps on the `<synthetic>` message it writes when a turn is cut off.
#: MEASURED on this machine (the corpus plus `~/.claude/projects/-Users-vedantbhatt`,
#: 2026-09-13): 19 `stop_sequence` records, every one `<synthetic>` ("API Error: 529
#: Overloaded", "Your computer went to sleep mid-response", "You've hit your session limit",
#: "No response requested."), 12 of them answered by the person (9 typed prompts, 3 queued
#: ones), 3 by a task notification. Reading only `end_turn`
#: called those turns "Thinking about the next step" and then "No new output". Only
#: `end_turn` can be `done`: a turn the harness cut off did not finish.
TURN_ENDED_STOPS = frozenset({"end_turn", "stop_sequence"})

#: Tools whose every call runs in the background and reports back later, through a task
#: notification the digest never sees. MEASURED on `~/.claude/projects` (2026-09-13): every
#: successful `Workflow` result reads "Workflow launched in background" and every successful
#: `Monitor` result "Monitor started (task ...)". Only `_verdict` reads it, as the lower bound
#: on work still out when the caller could not supply `background` (see `background_tasks`).
BACKGROUND_TOOLS = frozenset({"Workflow", "Monitor"})

#: UNMEASURED JUDGEMENT CALL: below eight tool calls in the current segment every verdict is
#: `starting`. The window is half the segment, and four calls is too few to compare.
VERDICT_MIN_TOOL_CALLS = 8

#: UNMEASURED JUDGEMENT CALL: three distinct files modified with nothing read first.
#: For Claude Code it is reachable only through an unguarded modification, which is
#: `sed -i`: `GUARDED_EDIT_TOOLS` covers every one of its edit tools. MEASURED (FOUND IN
#: REVIEW, 2026-09-13): a replay at every tenth tool call over the corpus, 1,061 cut points,
#: gave `lost` 0 times and at most 2 blind edits. It stays for the harnesses that edit
#: through `replace` and `replace_in_file`.
LOST_MIN_BLIND_FILES = 3

#: UNMEASURED JUDGEMENT CALL: a quartile over fewer than ten sessions is one session.
ETA_MIN_SESSIONS = 10

#: The failing results `burn.Segment.causes()` needs before it names `error_loop`, read
#: from burn rather than restated. Only `needs_you` reads it, to count errors beyond the
#: rule's own bar.
ERROR_LOOP_MIN_ERRORS = burn.ERROR_LOOP_MIN_ERRORS

#: The shortest salt the map hashes paths under (`live_state(salt=...)`): 16 bytes as hex.
#: A salt anyone can guess makes a wire file id a dictionary lookup away from its path,
#: so an empty or short one is a caller bug and raises. `__main__._map_salt` writes 32
#: random bytes (FOUND IN REVIEW, 2026-09-13: the salt was derived from the raw machine
#: identifier, which the uploaded `machine_id` lets a server test guesses against).
SALT_MIN_CHARS = 32

#: The widest tau the boundary fit can return (`measure_boundaries.TAU_MAX`, 3600 s), so the
#: mtime prefilter can never drop a transcript whose session the sessionizer calls live.
LIVE_MTIME_SEC = _mb.TAU_MAX

#: The brief (a time lapse is at most 600 frames) and the roadmap ("three or four a session
#: rather than three hundred").
MAX_FRAMES = 600
MAX_DECISIONS = 4

#: The window: the last `W` tool calls of the current segment, `W = min(SPIN_TOOL_CALLS,
#: calls // 2)`. 25 is `patterns.SPIN_TOOL_CALLS`, reused because a stretch that long with no
#: checkpoint is already a spin by that measurement (median run between checkpoints 4 calls,
#: p90 18).
WINDOW_MAX_CALLS = patterns.SPIN_TOOL_CALLS

ACTIVITY_KINDS = (
    "reading",
    "editing",
    "testing",
    "running",
    "searching",
    "delegating",
    "waiting_on_you",
    "thinking",
    "idle",
)
VERDICT_STATES = ("starting", "converging", "circling", "lost", "waiting", "done")
EVIDENCE_KEYS = (
    "window_calls",
    "errors_now",
    "errors_before",
    "new_files",
    "checkpoints",
    "repeats",
    "churn_writes",
    "fail_run",
    "blind_edits",
    # Beyond the contract's nine (docs/overnight-engine.md, "Deviations (live)"): the numbers
    # the sentence and needs_you read, so the phone can render the same words from the wire.
    "stuck_s",
    "files_changed",
    "commits",
    # Background tasks still out when the turn ended: the exact count when the caller read
    # the transcript (`background_tasks`), else the digest's lower bound. 0 while running.
    "background",
)
NEEDS_YOU_REASONS = (
    "waiting_for_input",
    "circling",
    "lost",
    "error_loop",
    "idle",
    "finished_unreviewed",
    "waiting_on_background",
    "running_fine",
)

#: The verdict basis for a turn handed back cleanly while work the session launched into
#: the background is still out: the agent is waiting on its own job, and Claude Code wakes
#: it when the job reports back. Not the person's turn (`needs_you`, `sentence`).
#:
#: MEASURED on `~/.claude/projects` (2026-09-13): 595 turns ended (`end_turn`) with
#: background work out. Where anything came next, the job's own notification came first 281
#: times and the person 134 (workflows 54 to 2, background shell jobs 497 to 132 by task),
#: and the person's words were mostly a nudge while the job ran ("status?", "keep going
#: dont stop until all 10 are done"), not an answer the agent was waiting for. Only launches
#: inside the sitting count (`background_tasks`): a job launched in an earlier sitting and
#: still running is missed, which reads as waiting on you, the louder claim.
BACKGROUND_BASIS = "turn_ended_background_out"
DECISION_KINDS = (
    "force_pushed",
    "deleted_test",
    "weakened_test",
    "skipped_hook",
    "reverted_changes",
    "abandoned_plan",
    "changed_schema",
    "removed_dependency",
    "added_dependency",
    "switched_approach",
)
FRAME_KINDS = ("read", "edit", "fail")

ETA_BASIS = "finished_sessions_same_repo_that_ran_at_least_this_long"

#: Non shell tools that search rather than read or run (`_activity_of`).
SEARCH_TOOLS = frozenset(
    {
        "Grep",
        "Glob",
        "WebSearch",
        "WebFetch",
        "grep_search",
        "glob",
        "google_web_search",
        "web_fetch",
        "list_directory",
        "LS",
    }
)

#: Tools that change a file that already exists. `lost` reads these, never a creation.
MODIFY_TOOLS = frozenset({"Edit", "MultiEdit", "NotebookEdit", "replace", "replace_in_file"})

#: Modifications Claude Code refuses on a file the conversation has not read ("You must use
#: your Read tool at least once in the conversation before editing"), so one it ACCEPTED was
#: read by the harness's own record. They count as modified and are never blind.
#:
#: MEASURED on the corpus: the harness answered "File has not been read yet" zero times,
#: and "File has been modified since read" once, so it tracks what was read. Every one of the
#: ten `lost` verdicts inspected rested on such edits, and in every one the file had been
#: read where the digest cannot look: through the shell, or in an earlier sitting of the same
#: conversation (the sessionizer cuts one conversation into sittings; the agent's context does
#: not). Counting them reported the parser's blind spot as the agent's.
GUARDED_EDIT_TOOLS = frozenset({"Edit", "MultiEdit", "NotebookEdit", "Write"})

_SEARCH_CMD = re.compile(r"^\s*(grep|rg|find|fd|ag|ack)\b|\|\s*grep\b")
_READ_CMD = re.compile(r"^\s*(cat|head|tail|less|bat|wc|sed -n)\b")

_SCHEMA_NAME = re.compile(r"^schema\.|\.(prisma|graphql|proto)$")


#: In repository worktrees, allowlisted by path shape. MEASURED on this machine's corpus: 3 of
#: 57 root transcripts ran in one, under `.claude/worktrees/<name>/` (Claude Code's own) or
#: `.worktrees/task/<name>/`. Without the strip one file carries a different id in the
#: worktree than in the checkout it came from, and three extra levels of depth.
_IN_REPO_WORKTREE = re.compile(r"^(?:\.claude/worktrees/[^/]+|\.worktrees/task/[^/]+)/")

_FRAME_PRIORITY = {"edit": 3, "fail": 2, "read": 1}


# ------------------------------------------------------------------------------ paths


def _norm(path: str) -> str:
    p = posixpath.normpath(str(path).replace("\\", "/"))
    return p


def _under(path: str, base: str) -> bool:
    return path == base or path.startswith(base.rstrip("/") + "/")


def _hash(salt: str, rel: str) -> str:
    """A wire file id: HMAC-SHA256 keyed by the salt, over the relative path, 16 hex
    characters. Keyed rather than `sha1(salt + path)` so the id is a MAC of the path
    under a secret, never a hash anyone holding a guess of the salt's inputs can build."""
    return hmac.new(salt.encode(), rel.encode(), hashlib.sha256).hexdigest()[:16]


class _Paths:
    """Every path in the session, made relative once, hashed once.

    `base` is the checkout a path is under: `root` (the worktree the session works in, when
    the caller knows it) or `repo` (the repository's common root), with an in repository
    worktree prefix stripped; else the common directory of every absolute path under
    neither. A path that is not absolute cannot be placed and keeps its own spelling, with
    depth None.

    Claude Code's own files (`patterns.harness_path`: the scratchpad, memory notes,
    background task output) are never part of the codebase: they take no part in choosing
    the base and are never placed in it.

    MEASURED on the live transcript (2026-09-13): the session works in `builder-overnight`,
    a worktree BESIDE the repository (`repo` is `.../projects/builder`), and also wrote the
    scratchpad and memory notes, so the common directory was `/` and `CLAUDE.md`, `brief.md`
    and `PROGRESS.md`, all at the checkout's root, sat at depth 5 under ids no checkout
    would produce (the 00:20 cut). Without the harness files the base is
    still `.../projects` whenever the session also reads a sibling folder (`design-refs`, 4
    events), which files `brief.md` at depth 1 as `builder-overnight/brief.md`. Only the
    caller can name the worktree (`worktree_root`), so `root` is how it says so.
    """

    def __init__(
        self, events: Sequence[digest.Ev], repo: str | None, salt: str, root: str | None = None
    ):
        self.salt = salt
        self.repo = _norm(repo) if repo else None
        # Most specific first: a worktree nested inside the repository is under both.
        self.checkouts = sorted(
            {_norm(c) for c in (root, repo) if c}, key=lambda c: -len(c)
        )
        raw = {_norm(e.path) for e in events if e.path}
        outside = [
            p
            for p in raw
            if p.startswith("/") and self._checkout(p) is None and not patterns.harness_path(p)
        ]
        self.base: str | None = None
        if outside:
            # Directories, not files: the common path of one file is the file itself, and a
            # file cannot be the base of anything.
            self.base = posixpath.commonpath([posixpath.dirname(p) for p in outside])
        self._rel: dict[str, tuple[str, int | None]] = {}

    def _checkout(self, p: str) -> str | None:
        return next((c for c in self.checkouts if _under(p, c)), None)

    def rel(self, path: str) -> tuple[str, int | None]:
        """(relative path, directory depth or None outside the base)."""
        hit = self._rel.get(path)
        if hit is not None:
            return hit
        p = _norm(path)
        checkout = self._checkout(p)
        if checkout is not None:
            rel = _IN_REPO_WORKTREE.sub("", posixpath.relpath(p, checkout), count=1)
            out: tuple[str, int | None] = (rel, rel.count("/"))
        elif (
            p.startswith("/")
            and self.base is not None
            and _under(p, self.base)
            and not patterns.harness_path(p)
        ):
            rel = posixpath.relpath(p, self.base)
            out = (rel, rel.count("/"))
        else:
            out = (p, None)
        self._rel[path] = out
        return out

    def id(self, path: str) -> str:
        return _hash(self.salt, self.rel(path)[0])

    def dir_id(self, path: str) -> str | None:
        """The salted id of the file's directory, or None at the base (spec/live.v1.json:
        "null at the base"). A hash of the empty string would be an id that names no
        directory, which a reader could only take for one."""
        rel = self.rel(path)[0]
        d = posixpath.dirname(rel)
        return None if d in ("", ".") else _hash(self.salt, d)

    def role(self, path: str) -> str:
        """`plain.role_of` over the RELATIVE path, so a parent folder of the checkout named
        `test` or `docs` cannot make every file in it a test or a doc."""
        return plain.role_of(self.rel(path)[0])


# ------------------------------------------------------------------------------ small rules


def _is_shell(e: digest.Ev) -> bool:
    return e.kind == "tool" and e.tool in digest.SHELL_TOOLS


def _command_lines(text: str | None) -> list[str]:
    """The command lines of a shell event, heredoc bodies skipped (`digest.shell_lines`:
    a body is data, and this parser once read documentation as a file write)."""
    return digest.shell_lines(text)


def _simple_commands(text: str | None) -> list[str]:
    """Every simple command of a shell event, split where the SHELL splits
    (`digest.split_simple`: quote aware, so a separator inside a commit message is data)."""
    return [part for line in _command_lines(text) for part in digest.split_simple(line)]


#: Words in front of the program that are not it: prefixes that run what follows, and the
#: keywords that open a condition or a loop body (`until curl -sf ...` runs curl).
_PREFIX_WORDS = frozenset(
    "sudo env time nohup exec while until if then do else elif ! { (".split()
)

#: Package runners whose first word after their own flags is the program (`npx jest`,
#: `bunx tsc`): the wrappers `vocab._AT_START` strips for its detectors. MEASURED on the
#: corpus's 9,139 shell calls (FOUND IN REVIEW, 2026-09-13): the named sentence would have
#: said "Running npx" 236 times, "Running nice" 20, "Running timeout" 14, "Running bunx" 3.
_RUNNERS = frozenset({"npx", "bunx", "pnpx"})

#: `NAME=value` in front of a program.
_ASSIGNMENT = re.compile(r"^[A-Za-z_]\w*=")


def _strip_wrappers(toks: list[str]) -> list[str]:
    """Drop the package runners (`_RUNNERS`, with their flags), `timeout [flags] DURATION`
    and `nice [-n N | -N]` from the front of a simple command's words."""
    while toks:
        head = toks[0]
        if head in _RUNNERS:
            toks = toks[1:]
            while toks and toks[0].startswith("-"):
                toks = toks[1:]
            continue
        if head == "timeout":
            toks = toks[1:]
            while toks and toks[0].startswith("-"):
                toks = toks[1:]
            toks = toks[1:]  # the duration
            continue
        if head == "nice":
            toks = toks[1:]
            if toks and toks[0] == "-n":
                toks = toks[2:]
            elif toks and re.match(r"^-\d+$", toks[0]):
                toks = toks[1:]
            continue
        break
    return toks


def _tokens(part: str) -> list[str]:
    """One simple command's words as the shell reads them: a quoted argument is ONE word,
    its quotes gone. The digest cuts commands mid quote (`…[+N]`), and then everything from
    the unbalanced quote on is dropped: it is an argument whose end is gone, never words of
    the command."""
    import shlex

    try:
        return shlex.split(part, posix=True)
    except ValueError:
        kept = re.sub(r"'[^']*'|\"(?:\\.|[^\"\\])*\"", " ", part)
        kept = re.split(r"['\"]", kept, maxsplit=1)[0]
        return kept.split()


def _argv(part: str) -> tuple[list[str], list[str]]:
    """(the `NAME=value` words in front, the program and its arguments) of one simple
    command, past `sudo`, `env`, `time`, `nohup`, `exec`, the runners and `timeout`."""
    toks = _tokens(part)
    assigns: list[str] = []
    while toks:
        if _ASSIGNMENT.match(toks[0]):
            assigns.append(toks[0])
            toks = toks[1:]
        elif toks[0] in ("sudo", "env", "time", "nohup", "exec"):
            toks = toks[1:]
        else:
            stripped = _strip_wrappers(toks)
            if stripped == toks:
                break
            toks = stripped
    return assigns, toks

#: A simple command that runs no program of its own: a loop or `case` header, a shell
#: setting, a directory change, a condition, a block's closing word. Skipped whole.
_NOT_A_PROGRAM = frozenset(
    (
        "cd pushd popd for case select function export source . set unset local declare "
        "readonly alias trap shopt done fi esac } ) true false : [ [[ test"
    ).split()
)

#: `echo` and `printf` print a label (`echo "=== tests ==="; pytest`); the program is the
#: command after them when there is one, as `vocab` reads them.
_LABEL_WORDS = frozenset({"echo", "printf"})

#: `VAR=$(prog ...`: the program is inside the substitution.
_SUBST_ASSIGN = re.compile(r"^[A-Za-z_]\w*=\$\((.*)$")


def _unreadable(token: str) -> bool:
    """A token the digest cut (`…[+N]`) or masked (`[redacted]`): it names nothing."""
    return "…[+" in token or "[redacted]" in token


def _command_word(text: str | None) -> str | None:
    """The program a shell command runs, or None when the text cannot say. LOCAL.

    The first word of the first simple command that runs a program: past `VAR=value`,
    `sudo`, `env`, `time`, `nohup`, `exec`, the keywords that open a condition or a loop
    body, and the runners and wrappers (`npx`, `bunx`, `timeout N`, `nice`,
    `_strip_wrappers`); skipping `cd`, `export`, `source`, loop headers and an `echo` label
    when a command follows it; reading the program inside `VAR=$(prog ...)`. A token the
    digest cut or masked stops the search: the program is gone, and naming the fragment
    would print it.

    MEASURED on the corpus replay (584 cut points, 2026-09-13): the named sentence read
    "Running for" 15 times, "Running echo" 13, "Running export" 3, "Running until" 2,
    "Running printf" 2, "Running [redacted]" 2, "Running source" 1, "Running edits" 1 (for
    `E=$(gplay edits create ...)`) and three fragments such as "Running c…[+840]".
    """
    label: str | None = None
    for part in _simple_commands(text):
        toks = part.split()
        while toks:
            sub = _SUBST_ASSIGN.match(toks[0])
            if sub is not None:
                inner = sub.group(1).strip("'\"")
                toks = [inner, *toks[1:]] if inner else toks[1:]
                break
            if re.match(r"^[A-Za-z_]\w*=", toks[0]) or toks[0] in _PREFIX_WORDS:
                toks.pop(0)
                continue
            break
        toks = _strip_wrappers(toks)
        if not toks:
            continue
        if _unreadable(toks[0]):
            return None
        head = toks[0].strip("'\"()")
        if not head or head in _NOT_A_PROGRAM:
            continue
        word = posixpath.basename(head)
        if not word:
            continue
        if word in _LABEL_WORDS:
            label = label or word
            continue
        return word
    return label


#: `burn.failed_calls`, the one rule for "this call did not do what it says".
_failed_calls = burn.failed_calls


def _modified(e: digest.Ev) -> bool:
    """Changed a file that already existed. Creations never count (`lost`)."""
    if e.kind != "tool" or not e.path:
        return False
    if e.tool in MODIFY_TOOLS:
        return True
    if e.tool in digest.SHELL_TOOLS and e.added is None:
        return True  # `sed -i`: a path and no count (digest._bash_file_effect)
    return e.tool == "Write" and (e.removed or 0) > 0


def _kind_of(e: digest.Ev) -> str:
    """The activity a tool call is, first match (docs/overnight-engine.md 3.2)."""
    t = e.tool
    if t in burn.TASK_TOOLS:
        return "delegating"
    if t in digest.READ_TOOLS:
        return "reading"
    if patterns._wrote(e) or t in digest.EDIT_TOOLS:
        return "editing"
    if t in digest.SHELL_TOOLS:
        text = e.text or ""
        if quality.TEST_CMD.search(text):
            return "testing"
        if _SEARCH_CMD.search(text):
            return "searching"
        if _READ_CMD.search(text):
            return "reading"
        return "running"
    if t in SEARCH_TOOLS:
        return "searching"
    return "running"


def _activity_of(e: digest.Ev, paths: _Paths) -> tuple[str, str]:
    """(kind, role) of one tool call. The role is `test` for a test run, the file's for a call
    with a path, else `unknown`.

    A test run is `test` even when its line also names a file: the digest gives
    `sed -i 's/x/y/' src/a.py && pytest` the path `src/a.py`, and "Running the source code"
    would describe the sed rather than the tests.
    """
    kind = _kind_of(e)
    if kind == "testing":
        return kind, "test"
    if e.path:
        return kind, paths.role(e.path)
    return kind, "unknown"


def _secs(x: float) -> int:
    return int(plain.rounded(max(0.0, x)))


def _last_output_ts(events: Sequence[digest.Ev]) -> float:
    """When the transcript last moved: the latest event, or the latest tool RESULT, which
    arrives without an event of its own when it succeeds. Without the second half a five
    minute test run reads as five minutes of silence the moment it passes."""
    ts = max(e.ts for e in events)
    results = [e.result_ts for e in events if e.kind == "tool" and e.result_ts is not None]
    return max([ts, *results])


# ------------------------------------------------------------------------------ activity


def _turn_ended(events: Sequence[digest.Ev], now: float) -> digest.Ev | None:
    """The event that handed the turn back to the person, or None (3.2 rule 1).

    An interrupt as the last event counts too: Claude Code stops after one and waits for the
    next prompt, and the literal rules would call that "thinking" (a stale tool result) when
    nothing is running at all.
    """
    last = events[-1]
    if last.kind == "interrupt":
        return last
    idx = next((i for i in range(len(events) - 1, -1, -1) if events[i].kind == "assistant"), None)
    if idx is None:
        return None
    a = events[idx]
    if a.stop_reason in TURN_ENDED_STOPS:
        if any(e.kind in ("tool", "prompt") for e in events[idx + 1 :]):
            return None
        return a
    if a.stop_reason is None and last is a and now - a.ts >= WAITING_MIN_SEC:
        return a
    return None


def _blank_activity(kind: str, since: float) -> dict:
    return {
        "kind": kind,
        "role": "unknown",
        "attempt": 0,
        "since_s": _secs(since),
        "files": 0,
        "calls": 0,
        "file_id": None,
    }


def _attempt(seg_events: Sequence[digest.Ev], last_tool: digest.Ev) -> int:
    """Writes to the target file since the later of its last read and the last test run."""
    target = last_tool.path
    if not target:
        return 0
    idx = next(i for i, e in enumerate(seg_events) if e is last_tool)
    after = -1
    for i, e in enumerate(seg_events[:idx]):
        if e.kind == "tool" and (
            (e.tool in digest.READ_TOOLS and e.path == target) or patterns._tested(e)
        ):
            after = i
    return sum(1 for e in seg_events[after + 1 : idx + 1] if patterns._wrote(e) and e.path == target)


def _activity(
    events: Sequence[digest.Ev], seg_events: Sequence[digest.Ev], now: float, paths: _Paths
) -> tuple[dict | None, digest.Ev | None]:
    """(activity, the event that ended the turn when it did)."""
    if not events:
        return None, None
    began = _turn_ended(events, now)
    if began is not None:
        return _blank_activity("waiting_on_you", now - began.ts), began
    last_out = _last_output_ts(events)
    if now - last_out >= IDLE_SEC:
        return _blank_activity("idle", now - last_out), None
    last = events[-1]
    if last.kind == "prompt":
        return _blank_activity("thinking", now - last.ts), None
    last_tool = next((e for e in reversed(seg_events) if e.kind == "tool"), None)
    if last_tool is None:
        # Nothing has run since the prompt: the agent is composing. The rules above already
        # took every case in which the harness said the turn was over.
        return _blank_activity("thinking", now - last.ts), None
    if last_tool.result_ts is not None and now - last_tool.result_ts >= THINKING_MIN_SEC:
        return _blank_activity("thinking", now - last_tool.result_ts), None

    kind, role = _activity_of(last_tool, paths)
    # The run ends AT the last tool and walks back from it. FOUND BY RUNNING IT on the
    # corpus: walking back from the end of the segment met an interrupt that came after the
    # last tool (a tool, the interrupt, then assistant text) and returned an empty run.
    end = next(i for i in range(len(seg_events) - 1, -1, -1) if seg_events[i] is last_tool)
    run: list[digest.Ev] = [last_tool]
    for e in reversed(seg_events[:end]):
        if e.kind in ("prompt", "interrupt"):
            break
        if e.kind != "tool":
            continue
        if _activity_of(e, paths) != (kind, role):
            break
        run.append(e)
    run.reverse()
    files = {paths.id(e.path) for e in run if e.path}
    return {
        "kind": kind,
        "role": role,
        "attempt": _attempt(seg_events, last_tool) if kind == "editing" else 0,
        "since_s": _secs(now - run[0].ts),
        "files": len(files),
        "calls": len(run),
        "file_id": paths.id(last_tool.path) if last_tool.path else None,
    }, None


# ------------------------------------------------------------------------------ verdict


def _windows(seg_events: Sequence[digest.Ev]) -> tuple[list[digest.Ev], list[digest.Ev], int]:
    """(window, before, index in the segment where the window starts).

    The window is the trailing slice holding the last `W` tool calls and the `result_error`
    events among them; `before` is the `W` calls preceding it, the same way.
    """
    idx = [i for i, e in enumerate(seg_events) if e.kind == "tool"]
    w = min(WINDOW_MAX_CALLS, len(idx) // 2)
    if w == 0:
        return [], [], len(seg_events)
    start, bstart = idx[-w], idx[-2 * w]
    keep = ("tool", "result_error")
    window = [e for e in seg_events[start:] if e.kind in keep]
    before = [e for e in seg_events[bstart:start] if e.kind in keep]
    return window, before, start


def _as_session(evs: Sequence[digest.Ev]):
    return types.SimpleNamespace(events=list(evs))


def _comparable(e: digest.Ev) -> bool:
    """Did the digest keep what this call WAS, so two copies are the same step?

    A shell command, a search pattern or query, a delegation's description: yes. Edit, Write
    and Read keep only the path (three edits to one file are three different edits, and three
    reads are usually one long file paged through), and every other tool keeps a 100
    character prefix of its input or nothing at all (`digest._tool_line`).

    MEASURED on the corpus, replaying 155 finished sessions at every tenth tool call: the
    repeated call behind `causes:repeated_call` was an Edit 111 times of 130 and a Read 13
    times, so over every call the rule said "running the same step over and over" about
    ordinary editing on one sample in nine.
    """
    return (
        e.kind == "tool"
        and bool((e.text or "").strip())
        and (e.tool in digest.SHELL_TOOLS or e.tool in SEARCH_TOOLS or e.tool in burn.TASK_TOOLS)
    )


def _failure_run_start(window: Sequence[digest.Ev]) -> tuple[float | None, digest.Ev | None]:
    """(when the worst consecutive failure run began, its last failing call).

    Read off `feedback._worst_failure_run` itself rather than a second walk: the shortest
    prefix at which the worst run reaches its full length ends on that run's last failing
    call and its error, and the function's own seconds reach back to the run's first call.
    """
    best, _, _ = feedback._worst_failure_run(_as_session(window))
    if best == 0:
        return None, None
    for k in range(2, len(window) + 1):
        b, secs, _ = feedback._worst_failure_run(_as_session(window[:k]))
        if b == best:
            call = window[k - 2]
            return call.ts - secs, call
    return None, None  # pragma: no cover  (the full window reaches it by definition)


def _repeat_start(window: Sequence[digest.Ev], repeats: int) -> float | None:
    """When the most repeated call first ran: the latest suffix still holding every copy
    (`burn._max_repeat`, the rule itself, not a second signature)."""
    for j in range(len(window) - 1, -1, -1):
        if burn._max_repeat(window[j:]) >= repeats:
            return window[j].ts
    return None


def _churn_start(window: Sequence[digest.Ev], path: str, writes: int) -> float | None:
    """When the churned file was first written in the window, by `burn._churn`'s own write
    rule, over the events on that path only (so a tie with another file cannot hide it)."""
    on_path = [e for e in window if e.path == path]
    for j in range(len(on_path) - 1, -1, -1):
        if burn._churn(on_path[j:])[1] >= writes:
            return on_path[j].ts
    return None


def _question_unreadable_or_asked(events: Sequence[digest.Ev]) -> bool:
    """Does the last assistant text end in a question, or can that not be read?

    `digest` keeps the first 320 characters of assistant text and cuts the rest behind
    `…[+N]`, so a long closing message has lost its last sentence. A cut text cannot show it
    is not a question, and `done` is the stronger claim, so it stays `waiting`, which is
    true of every turn that ended.
    """
    a = next((e for e in reversed(events) if e.kind == "assistant"), None)
    if a is None:
        return False
    text = (a.text or "").rstrip()
    return digest.is_cut(text) or text.endswith("?")


def _names_file(text: str | None, path: str) -> bool:
    """Does a shell command name this file? `sed -n 1,80p src/a.py`, `cat a.py`, `grep x a.py`.

    MEASURED on the corpus (docs/overnight-engine.md, "Deviations (live)"): every `lost`
    verdict in the six sessions inspected edited files the agent had read ONLY through the
    shell, three to six commands naming each one, and Claude Code accepted the edits. A
    digest shell event carries no read path, so without this the rule reported the parser's
    blind spot as the agent's.
    """
    name = posixpath.basename(_norm(path))
    if not name or not text:
        return False
    return re.search(r"(?<![\w.\-])" + re.escape(name) + r"(?![\w.\-])", text) is not None


def _same_file(a: str, b: str) -> bool:
    """One file spelled two ways: `src/q.py` from a shell command, `/repo/src/q.py` from Read."""
    a, b = _norm(a), _norm(b)
    return a == b or a.endswith("/" + b) or b.endswith("/" + a)


def _blind_paths(
    events: Sequence[digest.Ev], window: Sequence[digest.Ev], failed: set[int]
) -> tuple[set[str], set[str]]:
    """(blind paths, modified paths) in the window. Blind: modified in the window by a tool
    the harness does not guard, and read, written or named by a shell command by nothing
    earlier in the session. A failed edit modified nothing."""
    in_window = {id(e) for e in window}
    seen: list[str] = []
    shell_texts: list[str] = []
    blind: set[str] = set()
    modified: set[str] = set()
    for e in events:
        if e.kind != "tool":
            continue
        ok = id(e) not in failed
        if e.path and ok and id(e) in in_window and _modified(e):
            modified.add(e.path)
            if (
                e.tool not in GUARDED_EDIT_TOOLS
                and not any(_same_file(e.path, p) for p in seen)
                and not any(_names_file(t, e.path) for t in shell_texts)
            ):
                blind.add(e.path)
        if e.path and ok and (e.tool in digest.READ_TOOLS or patterns._wrote(e) or _modified(e)):
            seen.append(e.path)
        if ok and _is_shell(e):
            shell_texts.append(e.text or "")
    return blind, modified


def _harness_files(events: Sequence[digest.Ev]) -> set[str]:
    """Every path in `events` that is Claude Code's own file, by `patterns.harness_event`,
    the one rule: an absolute path under its state, or a shell write relative to a
    directory the command `cd`'d into there. A result names its call's path, so a path is
    judged once, by its calls, and every event naming it follows."""
    return {
        e.path
        for e in events
        if e.path and (patterns.harness_path(e.path) or (e.kind == "tool" and patterns.harness_event(e)))
    }


def _changed_files(
    seg_events: Sequence[digest.Ev], failed: set[int], harness: set[str] | None = None
) -> set[str]:
    """The project files a segment changed, which is what "Finished, with N files changed"
    counts: `burn._is_write` (`patterns._touched`, the rule behind `Segment.files_touched`),
    minus a write an error answered (it changed nothing) and minus Claude Code's own files
    (`_harness_files`).

    MEASURED on the live transcript (2026-09-13, 00:41): "Finished, with eight files
    changed" counted two project files, two scratchpad files and four memory notes under
    `~/.claude`. On the corpus, 72 of the 882 files written in segments that produced work
    are scratchpad files, and 17 of those 246 segments wrote nothing else. FOUND IN REVIEW:
    the absolute path rule alone called `cd <scratchpad> && cat > probe.py <<'EOF'` a
    project file, the shape `vocab` measured at 142 of 303 relative shell writes.
    """
    harness = _harness_files(seg_events) if harness is None else harness
    return {
        e.path
        for e in seg_events
        if burn._is_write(e) and id(e) not in failed and e.path not in harness
    }


def _background_calls(seg_events: Sequence[digest.Ev], failed: set[int]) -> int:
    """Calls in the segment to a tool that always runs in the background (`BACKGROUND_TOOLS`).

    The lower bound on work still out when the caller could not read the transcript for
    `background_tasks`: the digest never sees the notification that says a task finished,
    so a finished one counts too, which errs toward `waiting`, the weaker claim.
    """
    return sum(
        1
        for e in seg_events
        if e.kind == "tool" and e.tool in BACKGROUND_TOOLS and id(e) not in failed
    )


def _verdict(
    events: Sequence[digest.Ev],
    seg: burn.Segment | None,
    activity: dict | None,
    ended_by: digest.Ev | None,
    now: float,
    paths: _Paths,
    failed: set[int],
    background: int | None = None,
) -> tuple[dict, list[dict], dict]:
    """(verdict, the window's causes, what the names variant needs)."""
    seg_events = list(seg.events) if seg is not None else []
    window, before, start = _windows(seg_events)
    earlier = {
        e.path for e in seg_events[:start] if e.path and e.kind in ("tool", "result_error")
    }
    # New files entering SCOPE are the codebase's: a screenshot or a probe script in the
    # scratchpad is not the work widening. MEASURED on the corpus replay: 3 of the 37
    # `converging` cut points rested only on scratchpad files entering the window.
    harness = _harness_files(events)
    touched = {e.path for e in window if e.path and e.path not in harness}
    causes = (
        burn.Segment(
            index=-1, start_ts=window[0].ts, end_ts=window[-1].ts, prompt="", events=list(window)
        ).causes()
        if window
        else []
    )
    cause_ids = {c["cause"] for c in causes}
    # The repeat rule runs on the calls whose input the digest kept (`_comparable`), through
    # the same `causes()`, so its threshold stays burn's.
    comparable = [e for e in window if _comparable(e)]
    repeated = bool(comparable) and any(
        c["cause"] == "repeated_call"
        for c in burn.Segment(
            index=-1, start_ts=comparable[0].ts, end_ts=comparable[-1].ts, prompt="", events=comparable
        ).causes()
    )
    churn_path, churn_writes = burn._churn(window)
    fail_run = feedback._worst_failure_run(_as_session(window))[0]
    has_reads = any(e.kind == "tool" and e.tool in digest.READ_TOOLS for e in events)
    blind, modified = _blind_paths(events, window, failed) if has_reads else (set(), set())

    ev = {
        "window_calls": sum(1 for e in window if e.kind == "tool"),
        "errors_now": sum(1 for e in window if e.kind == "result_error"),
        "errors_before": sum(1 for e in before if e.kind == "result_error"),
        "new_files": len(touched - earlier),
        "checkpoints": sum(1 for e in window if e.kind == "tool" and patterns._checkpoint(e)),
        "repeats": burn._max_repeat(comparable),
        "churn_writes": churn_writes,
        "fail_run": fail_run,
        "blind_edits": len(blind),
        "stuck_s": 0,
        "files_changed": len(_changed_files(seg_events, failed, harness)),
        "commits": sum(1 for e in seg_events if patterns._committed(e) and id(e) not in failed),
        "background": (
            background if background is not None else _background_calls(seg_events, failed)
        ),
    }
    local: dict = {"failing_command": None}
    verdict = {
        "state": None,
        "evidence": ev,
        "basis": None,
        "reason": None,
        "code": None,
        "file_id": None,
    }

    def fire(state: str, basis: str) -> tuple[dict, list[dict], dict]:
        verdict["state"], verdict["basis"] = state, basis
        return verdict, causes, local

    if seg is None:
        verdict["reason"] = "the session has no events yet"
        verdict["code"] = "no_events"
        return verdict, causes, local

    # 1. The turn ended. `done` is the stronger claim, so every condition below is one more
    # way the turn can have ended without the work being finished; each falls to `waiting`,
    # which is true of every turn that ended.
    if activity is not None and activity["kind"] == "waiting_on_you":
        after_cp = None
        for i, e in enumerate(seg_events):
            if e.kind == "tool" and patterns._checkpoint(e):
                after_cp = i
        clean = after_cp is not None and not any(
            e.kind == "result_error" for e in seg_events[after_cp + 1 :]
        )
        interrupted = ended_by is not None and ended_by.kind == "interrupt"
        # A turn the harness cut off (an API error, a usage limit) did not finish.
        cut_off = (
            ended_by is not None
            and ended_by.kind == "assistant"
            and ended_by.stop_reason not in (None, "end_turn")
        )
        out = ev["background"]
        asked = _question_unreadable_or_asked(seg_events)
        if (
            seg.produced_work
            and (ev["files_changed"] or ev["commits"])
            and clean
            and not interrupted
            and not cut_off
            and not out
            and not asked
        ):
            return fire("done", "turn_ended")
        # Handed back cleanly while its own background work is out: the agent is waiting on
        # its job, and Claude Code wakes it when the job reports back. FOUND IN REVIEW: this
        # read "Waiting on you" at the top of mission control (needs you 80 and up) while
        # the session was waiting on a workflow it had launched ("Waiting on the research,
        # engine and foundation workflows"). Only the EXACT count read from the transcript
        # says so (`background`): the digest's lower bound counts launches whose
        # notification it cannot see, finished ones included, and a turn waiting on a job
        # that already reported back is waiting on the person. An interrupt, a cut off
        # turn, or a closing question (or one the digest cut and cannot show is not a
        # question) is the person's turn whatever is still running.
        if background and not interrupted and not cut_off and not asked:
            return fire("waiting", BACKGROUND_BASIS)
        return fire("waiting", "turn_ended")

    # 2. Too early to say.
    if seg.tool_calls < VERDICT_MIN_TOOL_CALLS:
        return fire("starting", "segment_tool_calls")

    # 3. Circling, on the rules burn and feedback already use.
    if repeated:
        t = _repeat_start(comparable, ev["repeats"])
        ev["stuck_s"] = _secs(now - t) if t is not None else 0
        return fire("circling", "causes:repeated_call")
    if "file_churn" in cause_ids and ev["errors_now"] >= 2 and churn_path:
        t = _churn_start(window, churn_path, churn_writes)
        ev["stuck_s"] = _secs(now - t) if t is not None else 0
        verdict["file_id"] = paths.id(churn_path)
        return fire("circling", "causes:file_churn_with_failures")
    if fail_run >= patterns.STUCK_FAILURES:
        t, call = _failure_run_start(window)
        ev["stuck_s"] = _secs(now - t) if t is not None else 0
        if call is not None and _is_shell(call):
            local["failing_command"] = _command_word(call.text)
        return fire("circling", "consecutive_failures")

    # 4. Lost: edits to files nothing read. Skipped for a harness that reads through the
    # shell, where every edit would look blind (`blind_edits` is then 0).
    if has_reads and len(blind) >= LOST_MIN_BLIND_FILES and 2 * len(blind) >= len(modified):
        return fire("lost", "edits_to_unread_files")

    # 5. Converging.
    if ev["checkpoints"] >= 1 and ev["errors_now"] < ev["errors_before"] and ev["new_files"] >= 1:
        return fire("converging", "error_rate_down_and_new_files")

    verdict["reason"] = (
        f"no rule fired: {ev['window_calls']} calls, {ev['errors_now']} errors, "
        f"{ev['checkpoints']} checkpoints"
    )
    verdict["code"] = "no_rule_fired"
    return verdict, causes, local


# ------------------------------------------------------------------------------ eta


def _plural(n: int, one: str, many: str) -> str:
    return one if n == 1 else many


#: Every way the ETA can refuse, as the wire's enum (spec/live.v1.json `eta_refusal`), in
#: the order `_eta` tries them. The prose `reason` beside each is LOCAL (the CLI prints it);
#: `wire()` sends the code, and the phone writes its own sentence from it, `n` and `needed`.
ETA_REFUSALS = (
    "no_active_time",
    "repo_unresolved",
    "no_history",
    "too_few_sessions",
    "too_few_survivors",
)

#: Every way the verdict can refuse (spec/live.v1.json `verdict_refusal`).
VERDICT_REFUSALS = ("no_events", "no_rule_fired")


def _eta(
    history: Iterable[profile.SessionFact] | None,
    repo: str | None,
    unattended: bool,
    elapsed: float | None,
) -> dict:
    """The ETA, or its refusal. `repo` is the KEY history is matched on: the repository's
    common root on a machine, its salted hash on the server (`live_state(repo_key=...)`).

    `history` None is "nothing was supplied to compare against", refused as `no_history`.
    It used to be an empty list, which the rule then counted as "0 finished sessions on
    this repository", a measurement nobody took."""
    out = {
        "elapsed_s": _secs(elapsed) if elapsed is not None else None,
        "typical_s": None,
        "p25_s": None,
        "p75_s": None,
        "remaining_s": None,
        "n": None,
        "needed": ETA_MIN_SESSIONS,
        "unattended": bool(unattended),
        "basis": ETA_BASIS,
        "reason": None,
        "code": None,
    }

    def refuse(code: str, reason: str) -> dict:
        out["code"], out["reason"] = code, reason
        return out

    if elapsed is None:
        return refuse("no_active_time", "the active time of this session was not supplied")
    if repo is None:
        return refuse(
            "repo_unresolved", "the repository this session runs in could not be resolved"
        )
    if history is None:
        return refuse(
            "no_history", "no finished sessions were supplied to compare this one against"
        )
    similar = [f.active_seconds for f in history if f.repo == repo and f.unattended == unattended]
    k = len(similar)
    noun = ("unattended run", "unattended runs") if unattended else ("session", "sessions")
    if k < ETA_MIN_SESSIONS:
        out["n"] = k
        return refuse(
            "too_few_sessions",
            f"{k} finished {_plural(k, *noun)} on this repository, {ETA_MIN_SESSIONS} needed",
        )
    survivors = [d for d in similar if d >= elapsed]
    n = len(survivors)
    out["n"] = n
    if n < ETA_MIN_SESSIONS:
        return refuse(
            "too_few_survivors",
            f"{n} finished {_plural(n, *noun)} on this repository ran at least "
            f"{feedback._mins(elapsed)}, {ETA_MIN_SESSIONS} needed",
        )
    p25, typical, p75 = statistics.quantiles(survivors, n=4, method="inclusive")
    out.update(
        typical_s=_secs(typical),
        p25_s=_secs(p25),
        p75_s=_secs(p75),
        remaining_s=max(0, plain.rounded(typical - elapsed)),
    )
    return out


# ------------------------------------------------------------------------------ decisions

DECISION_SENTENCES = {
    "force_pushed": "Force pushed over the remote history.",
    "deleted_test": "Deleted a test file.",
    "weakened_test": "Cut lines from a failing test.",
    "skipped_hook": "Skipped the commit hooks.",
    "reverted_changes": "Threw away uncommitted changes.",
    "abandoned_plan": "Dropped its plan and made a new one.",
    "changed_schema": "Changed the database schema.",
    "removed_dependency": "Removed a dependency.",
    "added_dependency": "Added a dependency.",
    "switched_approach": "Started over on a different approach.",
}

#: The LOCAL variant, for the kinds whose `detail` is a file or a package.
_NAMED_DECISIONS = {
    "deleted_test": "Deleted {detail}.",
    "weakened_test": "Cut lines from {detail}.",
    "changed_schema": "Changed {detail}.",
    "removed_dependency": "Removed {detail}.",
    "added_dependency": "Added {detail}.",
}


def decision_sentence(d: Mapping, names: bool = False) -> str:
    """The CLI line for one decision. `names=True` is LOCAL: it prints the file or package."""
    if names and d.get("detail") and d["kind"] in _NAMED_DECISIONS:
        return _NAMED_DECISIONS[d["kind"]].format(detail=d["detail"])
    return DECISION_SENTENCES[d["kind"]]


#: Not a package: a redirect (`2>&1`, `>log`), a pipe or a command separator.
_NOT_A_PACKAGE = re.compile(r"^(\d*[<>]|[|&;])")

#: A package manager's verbs: (program, verb) for an install that names a package, and for
#: a removal. `pip` also runs as `python -m pip` (`_git_or_pip`).
_DEP_ADD = {
    **dict.fromkeys(("npm", "pnpm", "yarn", "bun"), frozenset({"add", "install", "i"})),
    **dict.fromkeys(("pip", "pip3"), frozenset({"install"})),
    **dict.fromkeys(("uv", "poetry", "cargo"), frozenset({"add"})),
    "go": frozenset({"get"}),
    "gem": frozenset({"install"}),
}
_DEP_REMOVE = {
    "npm": frozenset({"uninstall", "remove", "rm"}),
    **dict.fromkeys(("pnpm", "yarn", "bun", "uv", "poetry", "cargo"), frozenset({"remove"})),
    **dict.fromkeys(("pip", "pip3"), frozenset({"uninstall"})),
}

#: A token that names where a package comes from rather than which package: a URL, or one
#: with credentials in it (`user:pass@host`, which `digest.mask` misses when the host has
#: no dot). FOUND IN REVIEW: `--names` printed "Added https://deploy:<password>@registry...".
_NOT_A_NAME = re.compile(r"://|^[^/@\s]+:[^/@\s]*@")


def _program(argv: list[str]) -> tuple[str | None, list[str]]:
    """(program, arguments), with `python -m pip` read as `pip`."""
    if not argv:
        return None, []
    prog = posixpath.basename(argv[0])
    if prog in ("python", "python3") and argv[1:3] and argv[1] == "-m":
        return posixpath.basename(argv[2]), argv[3:]
    return prog, argv[1:]


def _git(args: list[str]) -> tuple[str | None, list[str]]:
    """(subcommand, its arguments) of `git`, past its global options (`-C dir`, `-c k=v`)."""
    rest = list(args)
    while rest and rest[0].startswith("-"):
        rest = rest[2:] if rest[0] in ("-C", "-c") else rest[1:]
    return (rest[0], rest[1:]) if rest else (None, [])


def _shell_decisions(part: str) -> list[tuple[str, str | None]]:
    """The decisions one simple command makes, as `(kind, detail)`.

    Read off the PROGRAM and its dequoted arguments (`_argv`), never a search of the line:
    a force push is `git push` with `--force`, not those words inside a commit message, and
    an `echo` or `printf` prints a label and decides nothing. FOUND IN REVIEW (2026-09-13):
    the line searches made `git commit -m "docs: never git push --force to main"` a force
    push, `git commit -m "cleanup; rm tests/test_old.py next time"` a deleted test and
    `echo "next: npm install redis"` an added dependency. MEASURED on the corpus's 8,467
    successful shell calls (2026-09-13), old rules against these: 16 reverts, 3 deleted
    tests and 1 added dependency both ways, and one more added dependency now, `pip install
    "posthog"`, which the old regex missed because the package was quoted.
    """
    assigns, argv = _argv(part)
    out: list[tuple[str, str | None]] = []
    if "HUSKY=0" in assigns or (argv[:1] == ["export"] and "HUSKY=0" in argv):
        out.append(("skipped_hook", None))
    prog, args = _program(argv)
    if prog is None or prog in _LABEL_WORDS:
        return out
    if prog == "git":
        sub, rest = _git(args)
        if sub == "push" and any(a == "-f" or a.startswith("--force") for a in rest):
            out.append(("force_pushed", None))
        if sub in ("commit", "push") and "--no-verify" in rest:
            out.append(("skipped_hook", None))
        if _reverts(sub, rest):
            out.append(("reverted_changes", None))
        if sub == "rm":
            tok = _test_target(rest)
            if tok is not None:
                out.append(("deleted_test", tok))
    elif prog == "rm":
        tok = _test_target(args)
        if tok is not None:
            out.append(("deleted_test", tok))
    for kind, table in (("added_dependency", _DEP_ADD), ("removed_dependency", _DEP_REMOVE)):
        verbs = table.get(prog)
        if not verbs or not args or args[0] not in verbs:
            continue
        named, pkg = _package(prog, args[1:], adding=kind == "added_dependency")
        if named:
            out.append((kind, pkg))
    return out


def _test_target(args: list[str]) -> str | None:
    """The first test file or test directory an `rm` names, or None."""
    for tok in args:
        if not tok or tok.startswith("-"):
            continue
        last = tok.rstrip("/").rsplit("/", 1)[-1]
        if last in ("tests", "__tests__") or plain.role_of(tok) == "test":
            return tok
    return None


def _package(prog: str, args: list[str], *, adding: bool) -> tuple[bool, str | None]:
    """(does it name a package, the name a person may read) for a dependency command's
    arguments after its verb.

    A command that names none is not a decision about a dependency: `bun install 2>&1`
    installs the lockfile. MEASURED: one of the two `added_dependency` hits on the corpus was
    exactly that, the redirect read as a package by the contract's `(?!-)[@\\w]`. An
    install that opens with a flag is not one either (`npm install -g x` puts a tool on the
    machine, `pip install -r requirements.txt` installs a lockfile), the rule the contract's
    regex carried and this keeps. The package's NAME is LOCAL detail; a token that is a URL
    or carries credentials (`_NOT_A_NAME`) is no name, and the decision stands without one.
    """
    if adding and prog in ("npm", "pnpm", "yarn", "bun", "pip", "pip3"):
        if not args or args[0].startswith("-"):
            return False, None
    for tok in args:
        if tok.startswith("-"):
            continue
        if _NOT_A_PACKAGE.match(tok):
            return False, None
        if _NOT_A_NAME.search(tok):
            return True, None
        return True, tok
    return False, None


def _reverts(sub: str | None, args: list[str]) -> bool:
    """`reverted_changes`: `git checkout -- <path>`, `git checkout .`, `git restore`,
    `git reset --hard`, `git revert` and `git clean -f`; except `git restore --staged`
    without `--worktree`, which only unstages and throws nothing away (MEASURED: one of the
    corpus's revert hits)."""
    if sub == "checkout":
        return bool(args) and (args[0] == "." or (args[0] == "--" and len(args) > 1))
    if sub == "restore":
        staged = any(a in ("--staged", "-S") for a in args)
        worktree = any(a in ("--worktree", "-W") for a in args)
        return not (staged and not worktree)
    if sub == "reset":
        return "--hard" in args
    if sub == "revert":
        return True
    if sub == "clean":
        return any(re.match(r"^-\w*f", a) for a in args)
    return False


def _new_branch(part: str) -> bool:
    """`git switch -c` or `git checkout -b`, read as `_shell_decisions` reads a command."""
    prog, args = _program(_argv(part)[1])
    if prog != "git":
        return False
    sub, rest = _git(args)
    return bool(rest) and ((sub == "switch" and rest[0] == "-c") or (sub == "checkout" and rest[0] == "-b"))


def _reverts_part(part: str) -> bool:
    prog, args = _program(_argv(part)[1])
    return prog == "git" and _reverts(*_git(args))


def _decisions(
    events: Sequence[digest.Ev],
    segs: Sequence[burn.Segment],
    paths: _Paths,
    failed: set[int],
    names: bool,
) -> list[dict]:
    hits: dict[str, list[tuple[digest.Ev, str | None]]] = collections.defaultdict(list)

    def ok(e: digest.Ev) -> bool:
        return id(e) not in failed

    def base(p: str) -> str:
        return posixpath.basename(_norm(p))

    # Shell rules, one SIMPLE command at a time (`_shell_decisions`), heredoc bodies
    # skipped. A failed command did not do what its text says. One call is one decision of
    # a kind, whatever it repeats.
    for e in events:
        if not _is_shell(e) or not ok(e):
            continue
        made: dict[str, str | None] = {}
        for part in _simple_commands(e.text):
            for kind, detail in _shell_decisions(part):
                if kind in made:
                    continue
                # A name the digest cut or masked still counts as the decision, but it is not
                # a name a person can read. MEASURED on the corpus: `git rm -q ...
                # backend/tests/t…` gave the detail "test_eta_…[+39]", printed as "Deleted
                # test_eta_…[+39]."
                if detail is not None and _unreadable(detail):
                    detail = None
                elif detail is not None and kind == "deleted_test":
                    detail = base(detail)
                made[kind] = detail
        for kind, detail in made.items():
            hits[kind].append((e, detail))

    # weakened_test: after a failing test run, before the next one, no source write between.
    armed = False
    for e in events:
        if e.kind != "tool":
            continue
        if patterns._tested(e):
            armed = not ok(e)
            continue
        if not (patterns._wrote(e) and e.path and ok(e)):
            continue
        role = paths.role(e.path)
        if role == "source":
            armed = False
        elif role == "test" and armed and (e.removed or 0) > (e.added or 0):
            hits["weakened_test"].append((e, base(e.path)))

    # changed_schema: a write to a migration, or to a file named like a schema.
    for e in events:
        if patterns._wrote(e) and e.path and ok(e):
            if paths.role(e.path) == "migration" or _SCHEMA_NAME.search(base(e.path)):
                hits["changed_schema"].append((e, base(e.path)))

    # Per segment: a plan dropped after work began, and starting over.
    for seg in segs:
        planned = wrote_since = wrote = False
        written: set[str] = set()
        before_revert: set[str] | None = None
        for e in seg.events:
            if e.kind != "tool":
                continue
            if e.tool == "ExitPlanMode":
                if planned and wrote_since:
                    hits["abandoned_plan"].append((e, None))
                planned = planned or ok(e)
                wrote_since = False
                continue
            if _is_shell(e) and ok(e):
                parts = _simple_commands(e.text)
                if wrote and any(_new_branch(part) for part in parts):
                    hits["switched_approach"].append((e, None))
                if written and any(_reverts_part(part) for part in parts):
                    # Only after work in this segment: with nothing written yet there is no
                    # approach here to start over from, the same condition clause (a) has.
                    before_revert = set(written)
            if patterns._wrote(e) and e.path and ok(e):
                if before_revert is not None and e.path not in before_revert:
                    hits["switched_approach"].append((e, None))
                    before_revert = None
                written.add(e.path)
                wrote = True
                wrote_since = wrote_since or planned

    out: list[dict] = []
    for kind in DECISION_KINDS:
        found = hits.get(kind)
        if not found:
            continue
        found.sort(key=lambda h: (h[0].ts, h[0].n))
        first, detail = found[0]
        row = {"kind": kind, "ts": first.ts, "evidence": {"event_n": first.n, "count": len(found)}}
        if names:
            row["detail"] = detail
        out.append(row)
    return out[:MAX_DECISIONS]


# ------------------------------------------------------------------------------ needs you


def _needs_you(verdict: Mapping, activity: Mapping | None, causes: Sequence[Mapping]) -> dict:
    """The claim is the ORDER; every constant is an UNMEASURED JUDGEMENT CALL.

    Each reason's increment counts what lies BEYOND the rule's own threshold, so a reason
    that has only just fired scores its base, and the bases are the order: waiting 80,
    circling 60, lost 55, error loop 50, idle 38 (it fires at three minutes), finished 30,
    waiting on its own background work 10, running 5. Counting from zero put a fresh `lost` at 70 (it needs three blind files) above
    a fresh `circling` at 60, and a fresh error loop at 59 above a fresh `lost`, the reverse
    of the order the contract claims (docs/overnight-engine.md, "Deviations (live)").
    """
    state = verdict.get("state")
    ev = verdict["evidence"]
    since = int(activity["since_s"]) if activity else 0
    if state == "waiting" and verdict.get("basis") == BACKGROUND_BASIS:
        # Its own job is out: below every reason that is about the person, above a session
        # that is simply running, because a turn did end and there is a message to read. A
        # point every ten minutes, up to 30, so a job that never reports back climbs.
        reason, score = "waiting_on_background", 10 + min(20, since // 600)
    elif state == "waiting":
        reason, score = "waiting_for_input", 80 + min(20, since // 60)
    elif state == "circling":
        reason, score = "circling", 60 + min(20, int(ev["stuck_s"]) // 60)
    elif state == "lost":
        beyond = max(0, int(ev["blind_edits"]) - LOST_MIN_BLIND_FILES)
        reason, score = "lost", 55 + min(20, 5 * beyond)
    elif any(c.get("cause") == "error_loop" for c in causes):
        beyond = max(0, int(ev["errors_now"]) - ERROR_LOOP_MIN_ERRORS)
        reason, score = "error_loop", 50 + min(20, 3 * beyond)
    elif activity is not None and activity["kind"] == "idle":
        reason, score = "idle", 35 + min(20, since // 60)
    elif state == "done":
        reason, score = "finished_unreviewed", 30 + min(20, since // 120)
    else:
        reason, score = "running_fine", 5
    return {"score": max(0, min(100, int(score))), "reason": reason}


def mission_order(states: Iterable[Mapping]) -> list[Mapping]:
    """Mission control's order: who needs you most, then who has waited longest, then id."""

    def key(s: Mapping):
        a = s.get("activity")
        return (-int(s["needs_you"]["score"]), -(int(a["since_s"]) if a else 0), s.get("session_id") or "")

    return sorted(states, key=key)


# ------------------------------------------------------------------------------ map


def _edited(e: digest.Ev, failed: set[int]) -> bool:
    """A call that edited a file, for the map and the time lapse: `patterns._touched` (the
    one rule `burn` and "files changed" read; a `sed -i` included) that no error answered.

    MEASURED on the corpus (157 sessions, 1,335 map rows): 23 rows were files changed only
    by `sed -i`, and each read 0 reads and 0 edits with no frame in the time lapse, a file
    the agent edited drawn as one it never touched. FOUND IN REVIEW: a rejected Edit drew an
    edit and an `edit` frame while `files_changed` said 0 (38 corpus write calls were
    answered by an error).
    """
    return patterns._touched(e) and id(e) not in failed


def _map(events: Sequence[digest.Ev], paths: _Paths, failed: set[int] | None = None) -> dict:
    """One row per file id. Two absolute paths with one relative path (a file in the checkout
    and the same file in a worktree) are one file, so they are one row.

    The map is the codebase's shape, so Claude Code's own files (`_harness_files`) are not
    on it, and not in the time lapse. MEASURED on the corpus (157 sessions): 475 of 1,335
    rows were scratchpad or `~/.claude` files, simulator screenshots and probe scripts the
    agent made for itself; on the live transcript, 10 of 27 distinct paths.
    """
    failed = _failed_calls(events) if failed is None else failed
    harness = _harness_files(events)
    rows: dict[str, dict] = {}
    for e in events:
        if not e.path or e.kind not in ("tool", "result_error") or e.path in harness:
            continue
        fid = paths.id(e.path)
        row = rows.get(fid)
        if row is None:
            rel, depth = paths.rel(e.path)
            row = rows[fid] = {
                "id": fid,
                "role": paths.role(e.path),
                "depth": depth,
                "dir_id": paths.dir_id(e.path),
                "reads": 0,
                "edits": 0,
                "last_read_ts": None,
                "last_edit_ts": None,
            }
        if e.kind == "tool" and e.tool in digest.READ_TOOLS:
            row["reads"] += 1
            row["last_read_ts"] = e.ts
        if _edited(e, failed):
            row["edits"] += 1
            row["last_edit_ts"] = e.ts
    return {"files": list(rows.values())}


def _timelapse(
    events: Sequence[digest.Ev], paths: _Paths, failed: set[int] | None = None
) -> list[list]:
    """`[[t_offset_s, file_id, kind]]`, thinned to `MAX_FRAMES` by keeping, per equal time bin,
    the frame with the highest priority (edit, then fail, then read), ties to the latest."""
    if not events:
        return []
    failed = _failed_calls(events) if failed is None else failed
    harness = _harness_files(events)
    t0 = events[0].ts
    frames: list[tuple[float, int, str, str]] = []
    for i, e in enumerate(events):
        if not e.path or e.path in harness:
            continue
        if e.kind == "tool" and e.tool in digest.READ_TOOLS:
            kind = "read"
        elif _edited(e, failed):
            kind = "edit"
        elif e.kind == "result_error":
            kind = "fail"
        else:
            continue
        frames.append((e.ts - t0, i, paths.id(e.path), kind))
    if len(frames) > MAX_FRAMES:
        lo = min(f[0] for f in frames)
        hi = max(f[0] for f in frames)
        span = hi - lo
        bins: dict[int, tuple[float, int, str, str]] = {}
        for f in frames:
            b = min(MAX_FRAMES - 1, int((f[0] - lo) / span * MAX_FRAMES)) if span > 0 else 0
            cur = bins.get(b)
            if cur is None or (_FRAME_PRIORITY[f[3]], f[0], f[1]) >= (
                _FRAME_PRIORITY[cur[3]],
                cur[0],
                cur[1],
            ):
                bins[b] = f
        frames = [bins[b] for b in sorted(bins)]
    return [[int(max(0.0, f[0])), f[2], f[3]] for f in frames]


# ------------------------------------------------------------------------------ the state


def live_state(
    events: Sequence[digest.Ev],
    turns: Sequence[burn.Turn],
    now: float,
    history: Sequence[profile.SessionFact] | None,
    *,
    salt: str,
    repo: str | None = None,
    repo_key: str | None = None,
    active_seconds: float | None = None,
    unattended: bool = False,
    session_id: str | None = None,
    names: bool = False,
    background: int | None = None,
    root: str | None = None,
) -> dict:
    """Everything this module can honestly say about one running session at `now`.

    `events` are the live cut's digest events, `turns` its usage (`burn.turns_for_window`),
    `history` the finished sessions (`eta_history`, or `__main__._corpus_facts`; None when
    the caller has none to offer, which the ETA refuses as such), `active_seconds` the live
    cut's attended plus autonomous seconds, `background` the tasks the session launched into
    the background that have not reported back by `now` (`background_tasks`, which reads
    the transcript; None when the caller could not, and the digest's lower bound is used),
    `root` the worktree the session works in (`worktree_root`). `repo` is the common root
    the map places paths under; `repo_key` is what the ETA matches `history[].repo` on,
    `repo` by default. The server keys its stored sessions by `repo_hash` while the paths
    here are relative to a checkout, so it passes the hash as the key. Pure: no I/O, no
    clock; `computed_at` is `now`.
    """
    if not isinstance(salt, str) or len(salt) < SALT_MIN_CHARS:
        raise ValueError(
            f"live_state needs a salt of at least {SALT_MIN_CHARS} characters: a short one "
            "makes every wire file id a dictionary lookup away from its path"
        )
    events = list(events)
    turns = list(turns)
    segs = burn.segments(events, turns) if events else []
    seg = segs[-1] if segs else None
    seg_events = list(seg.events) if seg is not None else []
    paths = _Paths(events, repo, salt, root)
    failed = _failed_calls(events)

    activity, ended_by = _activity(events, seg_events, now, paths)
    verdict, causes, local = _verdict(
        events, seg, activity, ended_by, now, paths, failed, background
    )
    state: dict = {
        "session_id": session_id,
        "computed_at": now,
        "activity": activity,
        "sentence": None,
        "verdict": verdict,
        "eta": _eta(
            None if history is None else list(history),
            repo_key if repo_key is not None else repo,
            unattended,
            active_seconds,
        ),
        "decisions": _decisions(events, segs, paths, failed, names),
        "needs_you": _needs_you(verdict, activity, causes),
        "map": _map(events, paths, failed),
        "timelapse": _timelapse(events, paths, failed),
        "sample": {
            "events": len(events),
            "tool_calls": sum(1 for e in events if e.kind == "tool"),
            "segments": len(segs),
            "tokens": sum(t.total for t in turns) if burn.records_usage(turns) else None,
        },
    }
    if names:
        last_tool = next((e for e in reversed(seg_events) if e.kind == "tool"), None)
        state["names"] = {
            "files": {
                paths.id(e.path): paths.rel(e.path)[0]
                for e in events
                if e.path and e.kind in ("tool", "result_error")
            },
            "command": _command_word(last_tool.text) if last_tool and _is_shell(last_tool) else None,
            "failing_command": local["failing_command"],
        }
    state["sentence"] = sentence(state)
    return state


# ------------------------------------------------------------------------------ sentence


def _minutes(m: int) -> str:
    return "one minute" if m == 1 else f"{plain.spoken(m)} minutes"


def _noun(role: str, n: int, *, collective: bool = False) -> str:
    one, many, whole = plain.ROLE_NOUN.get(role, plain.ROLE_NOUN["unknown"])
    if collective:
        return whole
    return one if n <= 1 else many.format(n=plain.spoken(n))


def _name(state: Mapping, names: bool, file_id: str | None) -> str | None:
    if not names or not file_id:
        return None
    nm = state.get("names") or {}
    rel = (nm.get("files") or {}).get(file_id)
    return posixpath.basename(rel) if rel else None


def _map_role(state: Mapping, file_id: str | None) -> str:
    for row in (state.get("map") or {}).get("files") or []:
        if row["id"] == file_id:
            return row["role"]
    return "unknown"


def sentence(state: Mapping, names: bool = False) -> str:
    """What the session is doing, in one sentence. Pure: reads only `state`.

    The verdict speaks first when it has something to say (circling, lost, done), then the
    activity. `names=True` is LOCAL: it swaps a file noun for the file's name and a command
    for the program it runs, from `state["names"]`; without that key it is the `names=False`
    sentence exactly.
    """
    names = names and bool(state.get("names"))
    nm = state.get("names") or {}
    v = state.get("verdict") or {}
    ev = v.get("evidence") or {}
    st = v.get("state")
    if st == "circling":
        basis = v.get("basis")
        if basis == "consecutive_failures":
            m = int(ev.get("stuck_s") or 0) // 60
            cmd = nm.get("failing_command") if names else None
            what = f"the same failing {cmd} command" if cmd else "the same failing command"
            return f"Stuck on {what}" + (f" for {_minutes(m)}" if m >= 1 else "")
        if basis == "causes:file_churn_with_failures":
            fid = v.get("file_id")
            noun = _name(state, names, fid) or _noun(_map_role(state, fid), 1)
            return f"Going back and forth on {noun}, {plain.ordinal(int(ev['churn_writes']))} pass"
        return f"Running the same step over and over, {plain.spoken(int(ev['repeats']))} times"
    if st == "lost":
        return f"Editing {plain.spoken(int(ev['blind_edits']))} files it has not read yet"
    if st == "done":
        files = int(ev.get("files_changed") or 0)
        if files:
            return f"Finished, with {plain.spoken(files)} {_plural(files, 'file', 'files')} changed"
        if int(ev.get("commits") or 0):
            return "Finished, with a commit"
        return "Finished"

    a = state.get("activity")
    if not a:
        return "Nothing has happened yet"
    kind, role = a["kind"], a.get("role") or "unknown"
    since_m = int(a.get("since_s") or 0) // 60
    files = int(a.get("files") or 0)
    if kind == "waiting_on_you":
        if st == "waiting" and v.get("basis") == BACKGROUND_BASIS:
            n = int(ev.get("background") or 0)
            return f"Waiting on {plain.spoken(n)} background {_plural(n, 'task', 'tasks')} it started"
        return "Waiting on you" + (f" for {_minutes(since_m)}" if since_m >= 1 else "")
    if kind == "idle":
        return "No new output" + (f" for {_minutes(since_m)}" if since_m >= 1 else "")
    if kind == "thinking":
        return "Thinking about the next step"
    if kind == "reading":
        name = _name(state, names, a.get("file_id")) if files <= 1 else None
        if name:
            return f"Reading {name}"
        return f"Reading {_noun(role, files, collective=files >= 3)}"
    if kind == "editing":
        name = _name(state, names, a.get("file_id")) if files <= 1 else None
        attempt = int(a.get("attempt") or 0)
        if attempt >= 2:
            noun = _name(state, names, a.get("file_id")) or _noun(role, 1)
            return f"Rewriting {noun}, {plain.ordinal(attempt)} attempt"
        return f"Editing {name or _noun(role, files)}"
    if kind in ("testing", "running"):
        cmd = nm.get("command") if names else None
        if cmd:
            return f"Running {cmd}"
        return f"Running {_noun(role, files, collective=True)}" if kind == "testing" else "Running a command"
    if kind == "searching":
        return "Searching the codebase"
    if kind == "delegating":
        n = int(a.get("calls") or 0)
        return f"Handing work to {plain.spoken(n)} helper {_plural(n, 'agent', 'agents')}"
    return "Running a command"


# ------------------------------------------------------------------------------ wire


#: `spec/live.v1.json` "version". The spec is not shipped in the server image (the root
#: Dockerfile copies `spec/strip.v1.json` alone), so the number is restated here and
#: `tests/test_live.py` pins it, and every cap below, to the spec.
LIVE_VERSION = 1

#: The most map rows the wire carries, the ones touched most recently. 400 is 2.8x the
#: largest number of distinct tool paths in one transcript of the corpus (MEASURED: 141, of
#: 57 root transcripts, 2026-09-13); UNMEASURED JUDGEMENT CALL beyond that. `files_total`
#: always counts every row, so a cut map says how much it cut. The spec's `LiveMap.files`
#: and `LiveNames.files` caps.
MAX_MAP_FILES = 400

#: The longest basename `live_names` carries: the contract's own cap on a name (the spec's
#: `max_lengths.name`). A longer one is left out rather than cut, because a cut name is a
#: different name.
MAX_NAME_CHARS = 120


def _iso(ts: float) -> str:
    import datetime as _dt

    return _dt.datetime.fromtimestamp(ts, _dt.UTC).isoformat(timespec="seconds").replace(
        "+00:00", "Z"
    )


def _touched_ts(row: Mapping) -> float:
    """When a map row was last read or edited; a row that was only named (a failing call,
    a search) sorts below every one that was."""
    ts = [t for t in (row.get("last_read_ts"), row.get("last_edit_ts")) if t is not None]
    return max(ts) if ts else float("-inf")


def _wire_map(state: Mapping) -> dict | None:
    m = state.get("map")
    if m is None:
        return None
    rows = list(m.get("files") or [])
    # The MAX_MAP_FILES touched most recently, kept in the state's own order (first
    # appearance), so the same state always cuts to the same rows.
    keep = sorted(range(len(rows)), key=lambda i: (-_touched_ts(rows[i]), i))[:MAX_MAP_FILES]
    return {
        "files": [copy.deepcopy(rows[i]) for i in sorted(keep)],
        "files_total": len(rows),
    }


def wire(state: Mapping) -> dict:
    """The uploadable form, exactly `spec/live.v1.json` `LiveState`.

    Dropped: `names`, `sentence`, `session_id` and every decision `detail` (LOCAL, or
    rendered, or the machine's own id; the payload carries `client_session_id`). Each prose
    refusal is replaced by its code (`reason := code`), a decision's evidence is flattened
    onto it, a frame becomes an object, the map is cut to `MAX_MAP_FILES` with `files_total`
    beside it, and `live_version` and `computed_at` (ISO, UTC) lead.

    The sentence is dropped although it is WIRE safe, as `feedback.wire` drops its text: the
    phone renders its own words from the ids and numbers, so a reworded sentence is a client
    change and not a re-upload. `sentence(wire(state)) == sentence(state)` holds for
    `names=False`, which `tests/test_live.py` pins over every scenario.
    """
    v = state["verdict"]
    eta = state["eta"]
    out = {
        "live_version": LIVE_VERSION,
        "computed_at": _iso(float(state["computed_at"])),
        "activity": copy.deepcopy(state.get("activity")),
        "verdict": {
            "state": v.get("state"),
            "basis": v.get("basis"),
            "reason": v.get("code"),
            "file_id": v.get("file_id"),
            "evidence": {k: int(v["evidence"][k]) for k in EVIDENCE_KEYS},
        },
        "eta": {
            "elapsed_s": eta.get("elapsed_s"),
            "typical_s": eta.get("typical_s"),
            "p25_s": eta.get("p25_s"),
            "p75_s": eta.get("p75_s"),
            "remaining_s": eta.get("remaining_s"),
            "n": eta.get("n"),
            "needed": eta.get("needed"),
            "unattended": eta.get("unattended"),
            "basis": eta.get("basis"),
            "reason": eta.get("code"),
        },
        "decisions": [
            {
                "kind": d["kind"],
                "ts": d["ts"],
                "event_n": int(d["evidence"]["event_n"]),
                "count": int(d["evidence"]["count"]),
            }
            for d in state.get("decisions") or []
        ][:MAX_DECISIONS],
        "needs_you": dict(state["needs_you"]),
        "map": _wire_map(state),
        "timelapse": (
            None
            if state.get("timelapse") is None
            else [{"t": int(t), "file_id": f, "kind": k} for t, f, k in state["timelapse"]][
                :MAX_FRAMES
            ]
        ),
        "sample": dict(state["sample"]),
    }
    return out


def wire_names(state: Mapping) -> dict | None:
    """The opt in `live_names` block (contract v4, spec `LiveNames`): the basename of each
    file the wire map keeps, keyed by its id, and nothing else. None unless the state was
    computed with `names=True`.

    `posixpath.basename` of the relative path, so no directory ever travels. A name that
    carries a separator or a NUL cannot be a basename (the server's gate refuses one) and is
    left out, and so is one over `MAX_NAME_CHARS`: a cut name is a different name. Rows the
    wire map cut have no name here either, and Claude Code's own files are on neither."""
    nm = state.get("names")
    if not nm:
        return None
    rel_of = nm.get("files") or {}
    wm = _wire_map(state) or {"files": []}
    out = []
    for row in wm["files"]:
        rel = rel_of.get(row["id"])
        if not rel:
            continue
        name = posixpath.basename(str(rel))
        if (
            not name
            or len(name) > MAX_NAME_CHARS
            or "/" in name
            or "\\" in name
            or "\x00" in name
        ):
            continue
        out.append({"id": row["id"], "name": name})
    return {"files": out}


def eta_history(cut: Iterable[sessions.Session]) -> list[profile.SessionFact]:
    """The finished sessions an ETA compares against, from sessions ALREADY CUT: no second
    parse, no burn, no git. `_eta` reads each fact's repository, its `unattended` flag and
    its active seconds, so that is all these carry.

    Final and counted only (`capture.sessions.is_counted`, the one definition, which
    decides `visible` on the wire): a live sitting is not a finished one, and a sitting the
    phone does not show is not one the ETA may compare against. `repo` is the common root
    (`capture.repo.RepoIdentity.common_root`), which is what `live_state(repo=...)` keys on
    on a machine; `unattended` is `presence == 0`, the definition `_corpus_facts` uses, and
    `active_seconds` attended plus autonomous, the clock `elapsed_s` is read on."""
    from capture import sessions as cap

    from . import profile as pf

    out: list[pf.SessionFact] = []
    for s in cut:
        if s.state != "final" or not cap.is_counted(s):
            continue
        out.append(
            pf.SessionFact(
                session_id=s.client_session_id,
                started_at=s.started_at,
                ended_at=s.ended_at,
                active_seconds=s.attended + s.autonomous,
                attended_seconds=s.attended,
                autonomous_seconds=s.autonomous,
                repo=s.repo.common_root if s.repo else None,
                unattended=s.presence == 0,
            )
        )
    return out


def session_state(
    session: sessions.Session,
    *,
    now: float,
    history: Sequence[profile.SessionFact] | None,
    salt: str,
    repo_key: str | None = None,
    names: bool = False,
    loader=None,
) -> dict:
    """`live_state` for one cut sitting: THE ONE PLACE a capture `Session` becomes a live
    state, for `capture sync --live`, the hook channel (`server/builder/hook_ingest.py`) and
    `python -m analysis live`, so the three cannot compute two different states from one
    transcript.

    Each event once (`patterns.distinct_events`: a resumed transcript's copy of the old
    one's records reaches the pooled sitting twice); usage from every file the sitting's
    records came from, windowed to it (`burn.turns_for_window`, `loader` a memoised
    `burn.load_turns` for a caller that walks many sittings); background work summed over
    those files, None when any cannot be read (absent, not zero); the worktree the files
    sit in (`worktree_root`). `repo_key` as `live_state` takes it."""
    import dataclasses
    import pathlib

    session = dataclasses.replace(session, events=patterns.distinct_events(session.events))
    paths = sorted({r["path"] for r in session.records})
    counts = [background_tasks(pathlib.Path(p), session.started_at, now) for p in paths]
    kw = {} if loader is None else {"loader": loader}
    return live_state(
        session.events,
        burn.turns_for_window(paths, session.started_at, now, **kw),
        now,
        history,
        salt=salt,
        repo=session.repo.common_root if session.repo else None,
        repo_key=repo_key,
        active_seconds=session.attended + session.autonomous,
        unattended=session.presence == 0,
        session_id=session.client_session_id,
        names=names,
        background=None if any(c is None for c in counts) else sum(counts),
        root=worktree_root(session),
    )


# ------------------------------------------------------------------------------ finding it


def live_transcripts(root: pathlib.Path, now: float) -> list[discover.Transcript]:
    """Root transcripts under `root` written to within `LIVE_MTIME_SEC` of `now`.

    `capture.discover.iter_root_transcripts` is the allowlist on path shape (CLAUDE.md,
    "Globbing"): a subagent sidecar is never a session of its own.
    """
    from capture import discover

    out = []
    for t in discover.iter_root_transcripts(root):
        try:
            mtime = t.path.stat().st_mtime
        except OSError:
            continue  # removed between the listing and the stat
        if now - mtime <= LIVE_MTIME_SEC:
            out.append(t)
    return out


def last_session(t: discover.Transcript, now: float, tz) -> sessions.Session | None:
    """The transcript's last session as the sessionizer cuts it at `now`, live or final,
    or None when it holds none. One parse and one cut: a caller that needs the ended
    sitting when nothing is live reads it from here rather than cutting twice.

    The cut is `capture.sessions.sessionize_sources`, the reference boundary rules, never a
    second implementation of them.
    """
    from capture import sessions as cap

    cut = cap.sessionize_sources([cap.load_source(t)], tz, now=now)
    return cut[-1] if cut else None


def current_session(t: discover.Transcript, now: float, tz) -> sessions.Session | None:
    """The transcript's last session when the sessionizer calls it live, else None."""
    last = last_session(t, now, tz)
    return last if last is not None and last.state == "live" else None


def worktree_root(session: sessions.Session) -> str | None:
    """The checkout the session's files live in, for `live_state(root=...)`.

    `git rev-parse --show-toplevel` of the working directories the session's records were
    stamped with, weighted by records, among those in the session's own repository. The
    repository's IDENTITY still comes from `--git-common-dir` (CLAUDE.md: `--show-toplevel`
    fragments one repository into one arc per worktree); this is only where its files sit,
    which is exactly what a relative path needs to name the same file in every worktree.
    None when no record's directory resolves into the session's repository.
    """
    from capture import repo as cap_repo

    if session.repo is None:
        return None
    by_cwd = collections.Counter(
        r.get("cwd") for r in session.records if isinstance(r.get("cwd"), str)
    )
    tops: collections.Counter = collections.Counter()
    for cwd, n in by_cwd.items():
        ident = cap_repo.identity_for(cwd)
        if ident is None or ident.identity != session.repo.identity:
            continue
        top = cap_repo._git(["rev-parse", "--show-toplevel"], cwd)
        if top:
            tops[top] += n
    return tops.most_common(1)[0][0] if tops else None


#: How a tool result says the call went to the background. MEASURED on `~/.claude/projects`
#: (2026-09-13): 465 Bash results "Command running in background with ID", 17 Agent results
#: "Async agent launched successfully", every Workflow result "Workflow launched in
#: background", every Monitor result "Monitor started (task ...)" and 6 forked Skill results
#: "Skill "code-review" launched (forked execution, running in the background)".
_BACKGROUND_LAUNCH = re.compile(
    r"^(?:Command running in background with ID|Async agent launched|"
    r"Workflow launched in background|Monitor started \(task |"
    r"Skill \"[^\"]*\" launched \(forked execution)"
)

#: A task notification names the call that launched it (332 on this machine).
_NOTIFIED = re.compile(r"<tool-use-id>([^<\s]+)</tool-use-id>")

#: What a task notification's text begins with, wherever Claude Code wrote it.
_NOTIFICATION_OPEN = "<task-notification>"


def _block_text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            str(b.get("text", ""))
            for b in content
            if isinstance(b, dict) and b.get("type") == "text"
        )
    return ""


def _notification_text(r: dict) -> str | None:
    """The task notification a record carries, or None.

    Claude Code writes one of three ways. Between turns, a `user` record with
    `origin.kind == "task-notification"`. When the task finishes while the agent is MID
    TURN, as a `queue-operation` record (its `content`) and an `attachment` of type
    `queued_command` (its `prompt`), and never as a `user` record. MEASURED on the corpus
    (2026-09-13): 101 notifications as `user` records against 280 `queue-operation`
    enqueues, 179 removes and 142 `queued_command` attachments; reading only the first
    shape left 91 of 98 "still out" tasks in transcripts that ended over an hour ago with
    a notification naming their call, so a sitting that ended 22 days ago printed "1 task
    still out" and "waiting for input" (FOUND IN REVIEW). A `user` record with no origin
    counts only when its text IS a notification: a compaction summary quoting one is not.
    """
    t = r.get("type")
    if t == "queue-operation":
        text = r.get("content")
    elif t == "attachment":
        att = r.get("attachment") if isinstance(r.get("attachment"), dict) else {}
        if att.get("type") != "queued_command":
            return None
        text = att.get("prompt")
    elif t == "user":
        msg = r.get("message") if isinstance(r.get("message"), dict) else {}
        text = _block_text(msg.get("content"))
        origin = r.get("origin") if isinstance(r.get("origin"), dict) else {}
        if origin.get("kind") == "task-notification":
            return text
    else:
        return None
    if not isinstance(text, str) or not text.lstrip().startswith(_NOTIFICATION_OPEN):
        return None
    return text


def background_tasks(path: pathlib.Path, start: float, now: float) -> int | None:
    """Background tasks this transcript launched in `[start, now]` that had not reported back
    by `now`: a launch is a tool result in `_BACKGROUND_LAUNCH`'s words, and it is back when
    a task notification names its `tool-use-id`, in any of the three records Claude Code
    writes one in (`_notification_text`). None when the file cannot be read: absent, not
    zero, so `live_state` keeps its lower bound.

    `live_state(background=...)` reads it so that a turn handed back while that work is
    still out is never `done`. MEASURED on this machine's corpus replay: 4 `done` verdicts,
    3 of them with background work still out ("Pods installing. Waiting on the build.", and
    two overnight runs waiting on their own jobs); on the live transcript, 3 of 3, each
    handed back while workflows it had launched were running ("Waiting on the research,
    engine and foundation workflows"). Complete lines only: the last line of a transcript
    that is being written is routinely half there.
    """
    import json

    pending: set[str] = set()
    try:
        with open(path, "rb") as f:
            for line in f:
                if not line.endswith(b"\n"):
                    break
                # Only a tool result or a notification can matter; skip the rest unparsed
                # (the corpus's largest transcript is 129 MB).
                if b"tool_result" not in line and b"task-notification" not in line:
                    continue
                try:
                    r = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(r, dict):
                    continue
                ts = digest._ts(r.get("timestamp"))
                if ts is None or ts < start or ts > now:
                    continue
                note = _notification_text(r)
                if note is not None:
                    m = _NOTIFIED.search(note)
                    if m is not None:
                        pending.discard(m.group(1))
                    continue
                if r.get("type") != "user":
                    continue
                msg = r.get("message") if isinstance(r.get("message"), dict) else {}
                content = msg.get("content")
                for b in content if isinstance(content, list) else []:
                    if not isinstance(b, dict) or b.get("type") != "tool_result":
                        continue
                    if b.get("is_error"):
                        continue  # a launch that failed started nothing
                    tid = b.get("tool_use_id")
                    if not isinstance(tid, str) or not tid:
                        # No id, nothing can ever name it back: counting it would hold the
                        # sitting "still out" forever (FOUND IN REVIEW).
                        continue
                    if _BACKGROUND_LAUNCH.match(_block_text(b.get("content")).lstrip()):
                        pending.add(tid)
    except OSError:
        return None
    return len(pending)


__all__ = [
    "ACTIVITY_KINDS",
    "BACKGROUND_TOOLS",
    "DECISION_KINDS",
    "DECISION_SENTENCES",
    "ETA_MIN_SESSIONS",
    "ETA_REFUSALS",
    "EVIDENCE_KEYS",
    "IDLE_SEC",
    "LIVE_MTIME_SEC",
    "LIVE_VERSION",
    "LOST_MIN_BLIND_FILES",
    "MAX_DECISIONS",
    "MAX_FRAMES",
    "MAX_MAP_FILES",
    "MAX_NAME_CHARS",
    "NEEDS_YOU_REASONS",
    "THINKING_MIN_SEC",
    "TURN_ENDED_STOPS",
    "VERDICT_MIN_TOOL_CALLS",
    "VERDICT_REFUSALS",
    "VERDICT_STATES",
    "WAITING_MIN_SEC",
    "background_tasks",
    "current_session",
    "decision_sentence",
    "eta_history",
    "last_session",
    "live_state",
    "live_transcripts",
    "mission_order",
    "sentence",
    "session_state",
    "wire",
    "wire_names",
    "worktree_root",
]
