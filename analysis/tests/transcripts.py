"""Claude Code transcripts built by code, for the live engine's tests and fixtures.

docs/overnight-engine.md section 6: no checked in transcripts, so none can drift from the
code that builds it, and the real corpus stays out of git. Every record here is the shape
Claude Code writes and `digest.load_claude_code_events` reads: a typed prompt, assistant
messages with `stop_reason`, `usage` and a unique `message.id`, `tool_use` blocks, and
`tool_result` blocks whose `toolUseResult` carries an Edit's `structuredPatch` or a Write's
created `content`. A scenario is read back through the REAL parser and the REAL cut
(`capture.sessions.sessionize_sources`, then `analysis.live.session_state`), which is the
path the hook channel and `capture sync --live` take, so a scenario that reaches its verdict
here reaches it from bytes.

    records -> write_transcript -> capture cut -> live.session_state -> live.wire

Used by `tests/test_live.py` (every scenario reaches its verdict through the parser),
`capture/tests` (a transcript with usage, prompts and writes to cut), and
`scripts/gen_live_fixtures.py` (the Live Activity's two halves, pinned). Times are seconds
from `T0`; ids are deterministic, so a fixture built from a scenario is byte stable.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
import json
import pathlib
import tempfile

#: 2026-09-01 09:00:00 UTC. Every offset below is seconds from it.
T0 = dt.datetime(2026, 9, 1, 9, 0, tzinfo=dt.UTC).timestamp()

#: The native session id every scenario is written under (the file name).
SID = "8f7c2a4e-0000-4000-8000-0000000000f1"

#: A working directory that resolves to no repository, so a scenario never depends on the
#: machine it runs on: the ETA refuses `repo_unresolved`, and the map's base is the common
#: directory of the paths it touches.
CWD = "/nonexistent/repo"

#: `analysis.live.SALT_MIN_CHARS` or longer. A test's salt, never a machine's: fixtures
#: built with it are stable, and it is in no payload anybody uploads.
SALT = "transcripts-salt-0123456789abcdef-0123456789abcdef"

#: What each assistant message carries unless a builder says otherwise. Ten fresh input
#: tokens, five out, a hundred read from cache: small, nonzero, and the same every time.
USAGE = {
    "input_tokens": 10,
    "output_tokens": 5,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 100,
}


def iso(s: float) -> str:
    """`T0 + s` as Claude Code stamps it."""
    return (
        dt.datetime.fromtimestamp(T0 + s, dt.UTC)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


# ------------------------------------------------------------------------------ records


def prompt(t: float, text: str, source: str = "typed") -> dict:
    """A prompt the person sent. `source` "typed" is the terminal; "sdk" with
    `origin.kind == "human"` is Claude Code on the web or the phone (CLAUDE.md)."""
    r = {
        "type": "user",
        "timestamp": iso(t),
        "promptSource": source,
        "message": {"role": "user", "content": [{"type": "text", "text": text}]},
    }
    if source == "sdk":
        r["origin"] = {"kind": "human"}
    return r


def interrupt(t: float) -> dict:
    """The person pressed Escape: Claude Code writes this text and stops."""
    return {
        "type": "user",
        "timestamp": iso(t),
        "message": {"role": "user", "content": [{"type": "text", "text": "[Request interrupted by user]"}]},
    }


def say(t: float, mid: str, text: str, stop: str = "end_turn", usage: dict | None = None) -> dict:
    """Assistant text. `stop` "end_turn" hands the turn back; "tool_use" does not."""
    return _assistant(t, mid, [{"type": "text", "text": text}], stop, usage)


def calls(t: float, mid: str, tools: list[tuple[str, str, dict]], usage: dict | None = None) -> dict:
    """One assistant message issuing `[(tool_use id, tool name, input)]`."""
    blocks = [{"type": "tool_use", "id": tid, "name": name, "input": inp} for tid, name, inp in tools]
    return _assistant(t, mid, blocks, "tool_use", usage)


def _assistant(t: float, mid: str, blocks: list, stop: str, usage: dict | None) -> dict:
    return {
        "type": "assistant",
        "timestamp": iso(t),
        "message": {
            "id": mid,
            "role": "assistant",
            "model": "claude-opus-5",
            "stop_reason": stop,
            "usage": dict(USAGE if usage is None else usage),
            "content": blocks,
        },
    }


def result(t: float, tid: str, content: str, is_error: bool = False, tur: dict | None = None) -> dict:
    """A tool's answer. `tur` is the `toolUseResult` Claude Code writes beside it: an Edit's
    `{"structuredPatch": [...]}`, a Write's `{"type": "create", "content": ...}`."""
    r = {
        "type": "user",
        "timestamp": iso(t),
        "message": {
            "role": "user",
            "content": [{"type": "tool_result", "tool_use_id": tid, "content": content, "is_error": is_error}],
        },
    }
    if tur is not None:
        r["toolUseResult"] = tur
    return r


def patch(path: str, added: int, removed: int) -> dict:
    """An Edit's `toolUseResult`: one hunk with `added` new lines and `removed` old ones."""
    lines = [f"-old {i}" for i in range(removed)] + [f"+new {i}" for i in range(added)]
    return {"filePath": path, "structuredPatch": [{"oldStart": 1, "lines": lines}]}


def created(path: str, lines: int) -> dict:
    """A Write's `toolUseResult` for a new file of `lines` lines."""
    return {"type": "create", "filePath": path, "content": "".join(f"line {i}\n" for i in range(lines))}


def write_transcript(
    records: list[dict],
    root: pathlib.Path | None = None,
    *,
    project: str = "-nonexistent-repo",
    sid: str = SID,
    cwd: str = CWD,
) -> pathlib.Path:
    """`records` as `<root>/<project>/<sid>.jsonl`, each chained to the one before it
    (`parentUuid`), with deterministic uuids, the session id and the working directory.
    `root` defaults to a new temporary directory the caller owns."""
    root = pathlib.Path(tempfile.mkdtemp(prefix="transcripts-")) if root is None else pathlib.Path(root)
    d = root / project
    d.mkdir(parents=True, exist_ok=True)
    path = d / f"{sid}.jsonl"
    parent = None
    lines = []
    for i, r in enumerate(records):
        u = f"{sid[:24]}{i:012d}"
        lines.append(json.dumps({"uuid": u, "parentUuid": parent, "sessionId": sid, "cwd": cwd, **r}) + "\n")
        parent = u
    path.write_text("".join(lines))
    return path


# ------------------------------------------------------------------------------ building


class Builder:
    """A scenario's records in file order, with the calls a scenario is made of."""

    def __init__(self) -> None:
        self.records: list[dict] = []
        self._n = 0

    def _ids(self) -> tuple[str, str]:
        self._n += 1
        return f"msg_{self._n:03d}", f"toolu_{self._n:03d}"

    def prompt(self, t: float, text: str = "keep going") -> Builder:
        self.records.append(prompt(t, text))
        return self

    def say(self, t: float, text: str, stop: str = "end_turn") -> Builder:
        self.records.append(say(t, self._ids()[0], text, stop))
        return self

    def call(self, t: float, name: str, inp: dict, *, ok: float | None = None, fail: float | None = None,
             out: str = "done", tur: dict | None = None) -> str:
        """One call and, unless it is still pending (neither `ok` nor `fail`), its answer."""
        mid, tid = self._ids()
        self.records.append(calls(t, mid, [(tid, name, inp)]))
        if fail is not None:
            self.records.append(result(fail, tid, "Error: exit code 1", is_error=True))
        elif ok is not None:
            self.records.append(result(ok, tid, out, tur=tur))
        return tid

    def read(self, t: float, path: str) -> str:
        return self.call(t, "Read", {"file_path": path}, ok=t + 1, out="contents")

    def edit(self, t: float, path: str, added: int = 1, removed: int = 1, *, fail: float | None = None) -> str:
        inp = {"file_path": path, "old_string": "old", "new_string": "new"}
        if fail is not None:
            return self.call(t, "Edit", inp, fail=fail)
        return self.call(t, "Edit", inp, ok=t + 1, tur=patch(path, added, removed))

    def rewrite(self, t: float, path: str, added: int, removed: int) -> str:
        """A Write over a file that exists: Claude Code answers with a patch."""
        return self.call(t, "Write", {"file_path": path, "content": "x"}, ok=t + 1, tur=patch(path, added, removed))

    def create(self, t: float, path: str, lines: int = 10) -> str:
        return self.call(t, "Write", {"file_path": path, "content": "x"}, ok=t + 1, tur=created(path, lines))

    def bash(self, t: float, cmd: str, *, ok: float | None = None, fail: float | None = None,
             pending: bool = False) -> str:
        if not pending and ok is None and fail is None:
            ok = t + 1
        return self.call(t, "Bash", {"command": cmd}, ok=ok, fail=fail)


@dataclasses.dataclass(frozen=True)
class Scenario:
    """A transcript and the moment it is read at (`now`, seconds from `T0`), with what the
    engine is built to say about it (`verdict` state, `activity` kind)."""

    name: str
    records: tuple
    now: float
    verdict: str | None
    activity: str

    def write(self, root: pathlib.Path) -> pathlib.Path:
        return write_transcript(list(self.records), root)

    def state(self, *, salt: str = SALT, history=None, names: bool = False) -> dict:
        """The live state at `now`, from the bytes: written to a temporary directory, cut
        by capture, and read by `live.session_state` inside it (it reads the file for
        usage and background tasks). `history` None refuses the ETA as `no_history`."""
        from capture import sessions as cap
        from capture.discover import Transcript

        from analysis import live

        with tempfile.TemporaryDirectory(prefix="scenario-") as tmp:
            path = self.write(pathlib.Path(tmp))
            src = cap.load_source(Transcript(path.parent.name, path))
            cut = cap.sessionize_sources([src], dt.UTC, now=T0 + self.now)
            if not cut or cut[-1].state != "live":
                raise AssertionError(f"scenario {self.name} is not live at its own now")
            return live.session_state(cut[-1], now=T0 + self.now, history=history, salt=salt, names=names)


def _scenario(name: str, b: Builder, now: float, verdict: str | None, activity: str) -> Scenario:
    return Scenario(name, tuple(b.records), now, verdict, activity)


# ------------------------------------------------------------------------------ scenarios
# The in memory twins in tests/test_live.py work their numbers out by hand; these are the
# same sittings as bytes.


def starting() -> Scenario:
    """Seven reads: below `VERDICT_MIN_TOOL_CALLS`, so too early to say."""
    b = Builder().prompt(0, "look around the auth module")
    for i in range(7):
        b.read(10 + 10 * i, f"{CWD}/src/m{i}.py")
    return _scenario("starting", b, 75, "starting", "reading")


def converging() -> Scenario:
    """The window's errors fall (two failing test runs before, one in it), a checkpoint,
    and two files new to the stretch."""
    b = Builder().prompt(0, "make the tests pass")
    b.read(10, f"{CWD}/src/a.py")
    b.bash(20, "pytest -q", fail=21)
    b.edit(30, f"{CWD}/src/a.py")
    b.bash(40, "pytest -q", fail=41)
    b.edit(50, f"{CWD}/src/a.py")
    b.bash(60, "pytest -q", fail=61)
    b.create(70, f"{CWD}/src/b.py", 5)
    b.edit(80, f"{CWD}/src/a.py")
    b.bash(90, "pytest -q", ok=91)
    b.read(100, f"{CWD}/src/c.py")
    return _scenario("converging", b, 106, "converging", "reading")


def circling_failures() -> Scenario:
    """Four failing test runs in a row after four reads."""
    b = Builder().prompt(0, "fix the flaky test")
    for i, name in enumerate("abcd"):
        b.read(10 + 10 * i, f"{CWD}/src/{name}.py")
    for i, k in enumerate(("one", "two", "three", "four")):
        b.bash(100 + 60 * i, f"pytest -k {k}", fail=101 + 60 * i)
    return _scenario("circling_failures", b, 290, "circling", "testing")


def circling_churn() -> Scenario:
    """One file written four times in the window, with two failing test runs between."""
    b = Builder().prompt(0, "get a.py right")
    for i, name in enumerate("abcdef"):
        b.read(10 + 5 * i, f"{CWD}/src/{name}.py")
    b.edit(100, f"{CWD}/src/a.py")
    b.bash(110, "python3 -m pytest -x", fail=111)
    b.rewrite(120, f"{CWD}/src/a.py", 4, 3)
    b.bash(130, "npm test", fail=131)
    b.edit(140, f"{CWD}/src/a.py")
    b.rewrite(150, f"{CWD}/src/a.py", 2, 2)
    return _scenario("circling_churn", b, 155, "circling", "editing")


def lost() -> Scenario:
    """Three files changed by `sed -i` that nothing read, named or wrote first."""
    b = Builder().prompt(0, "rename the helper everywhere")
    b.read(10, f"{CWD}/src/a.py")
    b.bash(20, "ls")
    b.bash(30, "git status")
    b.call(40, "Grep", {"pattern": "foo"}, ok=41)
    b.bash(50, "sed -i 's/old/new/' src/p.py")
    b.bash(60, "sed -i 's/old/new/' src/q.py")
    b.bash(70, "sed -i 's/old/new/' src/r.py")
    b.bash(80, "echo hi")
    return _scenario("lost", b, 85, "lost", "running")


def blind_codex_like() -> Scenario:
    """The `lost` sitting without a single Read: it reads through the shell, where every
    edit would look blind, so `lost` must not fire."""
    b = Builder().prompt(0, "rename the helper everywhere")
    b.bash(10, "cat src/a.py")
    b.bash(20, "ls")
    b.bash(30, "git status")
    b.call(40, "Grep", {"pattern": "foo"}, ok=41)
    b.bash(50, "sed -i 's/old/new/' src/p.py")
    b.bash(60, "sed -i 's/old/new/' src/q.py")
    b.bash(70, "sed -i 's/old/new/' src/r.py")
    b.bash(80, "echo hi")
    return _scenario("blind_codex_like", b, 85, None, "running")


def waiting_question() -> Scenario:
    """The turn handed back with a question: the person's turn, not a finished one."""
    b = Builder().prompt(0, "fix a.py")
    b.read(10, f"{CWD}/src/a.py")
    b.edit(20, f"{CWD}/src/a.py")
    b.bash(30, "pytest -q", ok=40)
    b.say(50, "Tests pass. Should I also update the docs?")
    return _scenario("waiting_question", b, 170, "waiting", "waiting_on_you")


def done_after_commit() -> Scenario:
    """Two files changed, the tests pass, a commit, and a closing line that asks nothing."""
    b = Builder().prompt(0, "wire the thing and commit")
    b.read(10, f"{CWD}/src/a.py")
    b.edit(20, f"{CWD}/src/a.py")
    b.edit(30, f"{CWD}/src/b.py")
    b.bash(40, "pytest -q", ok=45)
    b.bash(50, 'git commit -m "wire the thing"', ok=51)
    b.say(60, "All done, both files updated.")
    return _scenario("done_after_commit", b, 360, "done", "waiting_on_you")


def waiting_on_background() -> Scenario:
    """The turn handed back cleanly while two jobs it launched into the background have not
    reported back: the agent waits on its own work, not on you (`live.BACKGROUND_BASIS`,
    needs you `waiting_on_background`). The launch results are Claude Code's own words
    (`live._BACKGROUND_LAUNCH`); no task notification names either id yet."""
    b = Builder().prompt(0, "build it and run the e2e suite, tell me when both are green")
    b.read(10, f"{CWD}/src/a.py")
    b.edit(20, f"{CWD}/src/a.py")
    b.call(30, "Bash", {"command": "make build", "run_in_background": True}, ok=31,
           out="Command running in background with ID: bash_1")
    b.call(40, "Bash", {"command": "npm run e2e", "run_in_background": True}, ok=41,
           out="Command running in background with ID: bash_2")
    b.say(50, "Both jobs are running. I will look at them when they report back.")
    return _scenario("waiting_on_background", b, 170, "waiting", "waiting_on_you")


def pending_long_tool() -> Scenario:
    """A test run that has not answered for ten minutes: idle, never waiting on you (a
    permission prompt and a long test run look the same in a transcript)."""
    b = Builder().prompt(0, "run the suite")
    b.say(2, "Running the suite.", stop="tool_use")
    b.bash(5, "pytest -q", pending=True)
    return _scenario("pending_long_tool", b, 605, "starting", "idle")


def decisions_all() -> Scenario:
    """Every decision kind the engine names, once each, in one sitting. The wire keeps the
    four hardest to undo (`live.MAX_DECISIONS`, in `live.DECISION_KINDS` order)."""
    b = Builder().prompt(0, "clean this up and ship it")
    b.create(10, f"{CWD}/src/a.py", 20)
    b.call(15, "ExitPlanMode", {"plan": "first plan"}, ok=16)
    b.create(20, f"{CWD}/src/b.py", 5)
    b.call(25, "ExitPlanMode", {"plan": "second plan"}, ok=26)
    b.bash(30, "pytest -q", fail=31)
    b.rewrite(40, f"{CWD}/tests/test_a.py", 1, 5)
    b.bash(50, "pytest -q", ok=51)
    b.bash(60, "rm tests/test_old.py")
    b.bash(70, "git checkout -- src/a.py")
    b.create(80, f"{CWD}/src/c.py", 3)
    b.bash(90, "git switch -c try-two")
    b.create(100, f"{CWD}/migrations/0002_add_index.sql", 4)
    b.bash(110, "npm uninstall lodash")
    b.bash(120, "npm install redis")
    b.bash(130, 'git commit --no-verify -m "ship"', ok=131)
    b.bash(140, "git push --force origin main", ok=141)
    b.say(150, "Pushed.", stop="tool_use")
    # The window's errors fell (the failing run is before it) and new files entered it.
    return _scenario("decisions_all", b, 160, "converging", "thinking")


SCENARIOS = {
    s.__name__: s
    for s in (
        starting,
        converging,
        circling_failures,
        circling_churn,
        lost,
        waiting_question,
        waiting_on_background,
        done_after_commit,
        pending_long_tool,
        decisions_all,
        blind_codex_like,
    )
}
