"""One running session: the sentence, the verdict, the ETA, the decisions and the order.

Every case is built from digest events at hand chosen second offsets, so each number below
can be recomputed with a pencil. The cases that matter most are the ones that guard against
a plausible wrong sentence:

* a tool that has not answered for a long time is `idle`, never `waiting_on_you` (a
  permission prompt and a long test run look the same in a transcript),
* a turn is handed back only when the harness says so (`end_turn`), or, for a loader that
  cannot tell, after assistant text and a silence of `WAITING_MIN_SEC`,
* `lost` never fires for a harness that reads through the shell, and a creation is never a
  blind edit,
* the ETA refuses below ten similar sessions and says how many it had,
* nothing a person typed, no path and no command reaches `wire()`.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
import hashlib
import hmac
import itertools
import json
import os
import pathlib
import tempfile
import time
import unittest
import uuid

from analysis import burn, digest, live, plain
from analysis.digest import Ev
from analysis.profile import SessionFact
from capture.tests import spec_walk

LIVE_SPEC = json.loads((spec_walk.ROOT / "spec" / "live.v1.json").read_text())
HEX = __import__("re").compile(r"^[0-9a-f]{16}$")

#: 2026-09-01 09:00:00 UTC. Every offset below is seconds from it.
T0 = dt.datetime(2026, 9, 1, 9, 0, tzinfo=dt.UTC).timestamp()
REPO = "/repo"
#: `live.SALT_MIN_CHARS` or longer: a short salt is a caller bug and raises.
SALT = "test-salt-0123456789abcdef-0123456789abcdef"


def fid(rel: str, salt: str = SALT) -> str:
    """The contract's id, written out by hand: HMAC-SHA256 keyed by the salt over the
    relative path, the first 16 hex characters."""
    return hmac.new(salt.encode(), rel.encode(), hashlib.sha256).hexdigest()[:16]


class Sess:
    """A session's digest events, in the shapes `digest.load_claude_code_events` writes."""

    def __init__(self) -> None:
        self.evs: list[Ev] = []
        self._tid = itertools.count(1)

    def _add(self, e: Ev) -> Ev:
        self.evs.append(e)
        return e

    def prompt(self, t: float, text: str = "keep going") -> Ev:
        return self._add(Ev(0, T0 + t, "prompt", text))

    def interrupt(self, t: float) -> Ev:
        return self._add(Ev(0, T0 + t, "interrupt", ""))

    def say(self, t: float, text: str = "ok", stop: str | None = "end_turn") -> Ev:
        return self._add(Ev(0, T0 + t, "assistant", text, stop_reason=stop))

    def call(
        self,
        t: float,
        tool: str,
        text: str = "",
        *,
        path: str | None = None,
        added: int | None = None,
        removed: int | None = None,
        ok: float | None = None,
        fail: float | None = None,
    ) -> Ev:
        tid = f"toolu_{next(self._tid):03d}"
        at = ok if ok is not None else fail
        e = self._add(
            Ev(
                0,
                T0 + t,
                "tool",
                text,
                tool=tool,
                path=path,
                added=added,
                removed=removed,
                tool_id=tid,
                result_ts=None if at is None else T0 + at,
                stop_reason="tool_use",
            )
        )
        if fail is not None:
            self._add(
                Ev(0, T0 + fail, "result_error", "Error: it failed", tool=tool, path=path, ok=False, tool_id=tid)
            )
        return e

    # The digest writes a Read, Write or Edit call's text as its path.
    def read(self, t: float, path: str, *, fail: float | None = None) -> Ev:
        if fail is not None:
            return self.call(t, "Read", path, path=path, fail=fail)
        return self.call(t, "Read", path, path=path, ok=t + 1)

    def edit(self, t: float, path: str, added: int = 1, removed: int = 1, *, fail: float | None = None) -> Ev:
        if fail is not None:  # a failed edit carries no line delta
            return self.call(t, "Edit", path, path=path, fail=fail)
        return self.call(t, "Edit", path, path=path, added=added, removed=removed, ok=t + 1)

    def write(self, t: float, path: str, added: int = 10, removed: int = 0) -> Ev:
        return self.call(t, "Write", path, path=path, added=added, removed=removed, ok=t + 1)

    def bash(self, t: float, cmd: str, *, ok: float | None = None, fail: float | None = None, pending: bool = False) -> Ev:
        if not pending and ok is None and fail is None:
            ok = t + 1
        return self.call(t, "Bash", cmd, ok=ok, fail=fail)

    def sed(self, t: float, path: str, *, fail: float | None = None) -> Ev:
        """`sed -i`: the digest names the path and credits no lines."""
        if fail is not None:
            return self.call(t, "Bash", f"sed -i 's/old/new/' {path}", path=path, fail=fail)
        return self.call(t, "Bash", f"sed -i 's/old/new/' {path}", path=path, ok=t + 1)

    def heredoc(self, t: float, path: str, body: list[str]) -> Ev:
        cmd = " ⏎ ".join([f"cat > {path} <<'EOF'", *body, "EOF"])
        return self.call(t, "Bash", cmd, path=path, added=len(body), removed=0, ok=t + 1)

    def events(self, until: float | None = None) -> list[Ev]:
        """Time sorted and numbered; `until` cuts the session as it looked at that offset,
        with any result that had not arrived yet taken back off its call."""
        evs = sorted(self.evs, key=lambda e: e.ts)
        if until is not None:
            cut = T0 + until
            evs = [dataclasses.replace(e) for e in evs if e.ts <= cut]
            for e in evs:
                if e.result_ts is not None and e.result_ts > cut:
                    e.result_ts = None
        for i, e in enumerate(evs):
            e.n = i
        return evs


def run(sess: Sess, now: float, history=(), *, until: float | None = None, **kw) -> dict:
    kw.setdefault("salt", SALT)
    kw.setdefault("repo", REPO)
    kw.setdefault("active_seconds", 600.0)
    kw.setdefault("session_id", "sess-1")
    events = sess.events(until=now if until is None else until)
    return live.live_state(events, [], T0 + now, None if history is None else list(history), **kw)


# ------------------------------------------------------------------------------ scenarios
# Each returns (session, now). The expected numbers are worked out in the test that uses it.


def starting():
    s = Sess()
    s.prompt(0)
    for i in range(7):
        s.read(10 + 10 * i, f"/repo/src/m{i}.py")
    return s, 75


def converging():
    s = Sess()
    s.prompt(0)
    s.read(10, "/repo/src/a.py")
    s.bash(20, "pytest -q", fail=21)
    s.edit(30, "/repo/src/a.py")
    s.bash(40, "pytest -q", fail=41)
    s.edit(50, "/repo/src/a.py")
    # the window: the last five calls
    s.bash(60, "pytest -q", fail=61)
    s.write(70, "/repo/src/b.py", added=5)
    s.edit(80, "/repo/src/a.py")
    s.bash(90, "pytest -q")
    s.read(100, "/repo/src/c.py")
    return s, 106


def circling_failures():
    s = Sess()
    s.prompt(0)
    for i, name in enumerate("abcd"):
        s.read(10 + 10 * i, f"/repo/src/{name}.py")
    for i, k in enumerate(("one", "two", "three", "four")):
        s.bash(100 + 60 * i, f"pytest -k {k}", fail=101 + 60 * i)
    return s, 290


def circling_churn():
    s = Sess()
    s.prompt(0)
    for i, name in enumerate("abcdef"):
        s.read(10 + 5 * i, f"/repo/src/{name}.py")
    s.edit(100, "/repo/src/a.py")
    s.bash(110, "python3 -m pytest -x", fail=111)
    s.write(120, "/repo/src/a.py", added=4, removed=3)
    s.bash(130, "npm test", fail=131)
    s.edit(140, "/repo/src/a.py")
    s.write(150, "/repo/src/a.py", added=2, removed=2)
    return s, 155


def circling_repeat():
    s = Sess()
    s.prompt(0)
    for i, name in enumerate("abcde"):
        s.read(10 + 10 * i, f"/repo/src/{name}.py")
    s.bash(100, "npm run build", ok=110)
    s.read(120, "/repo/src/x.py")
    s.bash(130, "npm run build", ok=140)
    s.read(150, "/repo/src/y.py")
    s.bash(160, "npm run build", ok=170)
    return s, 175


def lost():
    """Three files changed by `sed -i` that nothing read, named or wrote first."""
    s = Sess()
    s.prompt(0)
    s.read(10, "/repo/src/a.py")
    s.bash(20, "ls")
    s.bash(30, "git status")
    s.call(40, "Grep", "foo", ok=41)
    s.sed(50, "src/p.py")
    s.sed(60, "src/q.py")
    s.sed(70, "src/r.py")
    s.bash(80, "echo hi")
    return s, 85


def blind_codex_like():
    """The `lost` session without a single Read: it reads through the shell."""
    s = Sess()
    s.prompt(0)
    s.bash(10, "cat src/a.py")
    s.bash(20, "ls")
    s.bash(30, "git status")
    s.call(40, "Grep", "foo", ok=41)
    s.sed(50, "src/p.py")
    s.sed(60, "src/q.py")
    s.sed(70, "src/r.py")
    s.bash(80, "echo hi")
    return s, 85


def waiting_question():
    s = Sess()
    s.prompt(0)
    s.read(10, "/repo/src/a.py")
    s.edit(20, "/repo/src/a.py")
    s.bash(30, "pytest -q", ok=40)
    s.say(50, "Tests pass. Should I also update the docs?")
    return s, 170


def done_after_commit():
    s = Sess()
    s.prompt(0)
    s.read(10, "/repo/src/a.py")
    s.edit(20, "/repo/src/a.py")
    s.edit(30, "/repo/src/b.py")
    s.bash(40, "pytest -q", ok=45)
    s.bash(50, 'git commit -m "wire the thing"')
    s.say(60, "All done, both files updated.")
    return s, 360


def pending_long_tool():
    s = Sess()
    s.prompt(0)
    s.say(2, "Running the suite.", stop="tool_use")
    s.bash(5, "pytest -q", pending=True)
    return s, 605


def error_loop():
    s = Sess()
    s.prompt(0)
    for i, name in enumerate("abcde"):
        s.read(10 + 10 * i, f"/repo/src/{name}.py")
    s.bash(100, "make lint", fail=101)
    s.read(110, "/repo/src/f.py")
    s.bash(120, "make check", fail=121)
    s.read(130, "/repo/src/g.py")
    s.bash(140, "make verify", fail=141)
    return s, 150


SCENARIOS = {
    "starting": starting,
    "converging": converging,
    "circling_failures": circling_failures,
    "circling_churn": circling_churn,
    "circling_repeat": circling_repeat,
    "lost": lost,
    "blind_codex_like": blind_codex_like,
    "waiting_question": waiting_question,
    "done_after_commit": done_after_commit,
    "pending_long_tool": pending_long_tool,
    "error_loop": error_loop,
}


def scenario_states(names: bool = False) -> dict[str, dict]:
    out = {}
    for name, build in SCENARIOS.items():
        s, now = build()
        out[name] = run(s, now, names=names)
    return out


# ------------------------------------------------------------------------------ shape


class Shape(unittest.TestCase):
    KEYS = {
        "session_id",
        "computed_at",
        "activity",
        "sentence",
        "verdict",
        "eta",
        "decisions",
        "needs_you",
        "map",
        "timelapse",
        "sample",
    }

    def test_top_level_keys_and_names_only_on_request(self):
        s, now = converging()
        self.assertEqual(set(run(s, now)), self.KEYS)
        self.assertEqual(set(run(s, now, names=True)), self.KEYS | {"names"})

    def test_every_evidence_key_is_an_integer_in_every_scenario(self):
        for name, st in scenario_states().items():
            ev = st["verdict"]["evidence"]
            self.assertEqual(tuple(ev), live.EVIDENCE_KEYS, name)
            for k, v in ev.items():
                self.assertIsInstance(v, int, f"{name}.{k}")

    def test_enums_hold(self):
        for name, st in scenario_states().items():
            self.assertIn(st["activity"]["kind"], live.ACTIVITY_KINDS, name)
            self.assertIn(st["activity"]["role"], plain.ROLES, name)
            self.assertIn(st["verdict"]["state"], (*live.VERDICT_STATES, None), name)
            self.assertIn(st["needs_you"]["reason"], live.NEEDS_YOU_REASONS, name)
            for d in st["decisions"]:
                self.assertIn(d["kind"], live.DECISION_KINDS)
            for frame in st["timelapse"]:
                self.assertIn(frame[2], live.FRAME_KINDS)

    def test_a_refused_verdict_is_none_with_the_counts_it_checked(self):
        st = run(*blind_codex_like())
        self.assertIsNone(st["verdict"]["state"])
        self.assertIsNone(st["verdict"]["basis"])
        # `sed -i` credits no lines, so it is not a checkpoint (`patterns._checkpoint`).
        self.assertEqual(st["verdict"]["reason"], "no rule fired: 4 calls, 0 errors, 0 checkpoints")

    def test_an_answered_verdict_carries_no_reason(self):
        for name, st in scenario_states().items():
            if st["verdict"]["state"] is not None:
                self.assertIsNone(st["verdict"]["reason"], name)
                self.assertIsNotNone(st["verdict"]["basis"], name)

    def test_no_events_is_said_as_such(self):
        st = live.live_state([], [], T0, [], salt=SALT)
        self.assertIsNone(st["activity"])
        self.assertIsNone(st["verdict"]["state"])
        self.assertEqual(st["verdict"]["reason"], "the session has no events yet")
        self.assertEqual(st["sentence"], "Nothing has happened yet")
        self.assertEqual(st["map"], {"files": []})
        self.assertEqual(st["timelapse"], [])
        self.assertEqual(st["sample"], {"events": 0, "tool_calls": 0, "segments": 0, "tokens": None})

    def test_sample_counts_and_tokens_only_when_the_harness_wrote_them(self):
        s, now = converging()
        st = run(s, now)
        self.assertEqual(st["sample"]["events"], 14)  # prompt, 10 calls, 3 errors
        self.assertEqual(st["sample"]["tool_calls"], 10)
        self.assertEqual(st["sample"]["segments"], 1)
        self.assertIsNone(st["sample"]["tokens"])
        turns = [
            burn.Turn(ts=T0 + 1, msg_id="m1", model="x", input_tokens=10, output_tokens=5, cache_create=0, cache_read=100),
            burn.Turn(ts=T0 + 2, msg_id="m2", model="x", input_tokens=1, output_tokens=2, cache_create=3, cache_read=4),
        ]
        st = live.live_state(s.events(now), turns, T0 + now, [], salt=SALT, repo=REPO)
        self.assertEqual(st["sample"]["tokens"], 115 + 10)
        # A harness that writes {0, 0} wrote nothing: absent, not zero (CLAUDE.md, Cursor).
        zero = [burn.Turn(ts=T0 + 1, msg_id="m", model="x", input_tokens=0, output_tokens=0, cache_create=0, cache_read=0)]
        st = live.live_state(s.events(now), zero, T0 + now, [], salt=SALT, repo=REPO)
        self.assertIsNone(st["sample"]["tokens"])


# ------------------------------------------------------------------------------ activity


class Activity(unittest.TestCase):
    def test_end_turn_is_waiting_on_you(self):
        st = run(*waiting_question())
        self.assertEqual(st["activity"]["kind"], "waiting_on_you")
        self.assertEqual(st["activity"]["since_s"], 120)  # 170 - 50, from the handing back

    def test_a_pending_tool_is_idle_never_waiting_on_you(self):
        s, _ = pending_long_tool()
        at_179 = run(s, 5 + 179)["activity"]
        self.assertEqual((at_179["kind"], at_179["role"], at_179["since_s"]), ("testing", "test", 179))
        at_180 = run(s, 5 + 180)["activity"]
        self.assertEqual((at_180["kind"], at_180["since_s"]), ("idle", 180))
        an_hour = run(s, 5 + 3600)
        self.assertEqual(an_hour["activity"]["kind"], "idle")
        self.assertEqual(an_hour["sentence"], "No new output for 60 minutes")
        self.assertNotEqual(an_hour["verdict"]["state"], "waiting")

    def test_without_stop_reason_the_turn_ends_on_silence_after_text(self):
        s = Sess()
        s.prompt(0)
        s.read(10, "/repo/src/a.py")
        s.say(20, "Here is what I found.", stop=None)
        self.assertEqual(run(s, 20 + 62)["activity"]["kind"], "thinking")
        st = run(s, 20 + live.WAITING_MIN_SEC)
        self.assertEqual(st["activity"]["kind"], "waiting_on_you")
        self.assertEqual(st["activity"]["since_s"], 63)

    def test_text_that_says_a_tool_is_coming_never_ends_the_turn(self):
        s = Sess()
        s.prompt(0)
        s.read(10, "/repo/src/a.py")
        s.say(20, "Now the tests.", stop="tool_use")
        self.assertEqual(run(s, 20 + 120)["activity"]["kind"], "thinking")

    def test_an_end_turn_followed_by_a_prompt_is_over(self):
        s = Sess()
        s.prompt(0)
        s.say(5, "Done.")
        s.prompt(60, "now the docs")
        s.read(70, "/repo/docs/guide.md")
        st = run(s, 75)
        self.assertEqual((st["activity"]["kind"], st["activity"]["role"]), ("reading", "docs"))

    def test_an_interrupt_hands_the_turn_back(self):
        s = Sess()
        s.prompt(0)
        s.bash(5, "pytest -q", fail=8)
        s.interrupt(9)
        st = run(s, 21)
        self.assertEqual((st["activity"]["kind"], st["activity"]["since_s"]), ("waiting_on_you", 12))
        self.assertEqual(st["verdict"]["state"], "waiting")

    def test_a_prompt_last_is_thinking(self):
        s = Sess()
        s.prompt(0)
        s.read(10, "/repo/src/a.py")
        s.prompt(30, "and the other one")
        st = run(s, 40)
        self.assertEqual((st["activity"]["kind"], st["activity"]["since_s"]), ("thinking", 10))
        self.assertEqual(st["sentence"], "Thinking about the next step")

    def test_a_result_older_than_the_thinking_gap_is_thinking(self):
        s = Sess()
        s.prompt(0)
        s.bash(10, "npm run build", ok=100)
        self.assertEqual(run(s, 100 + 12)["activity"]["kind"], "running")
        st = run(s, 100 + live.THINKING_MIN_SEC)
        self.assertEqual((st["activity"]["kind"], st["activity"]["since_s"]), ("thinking", 13))

    def test_a_result_is_output_so_a_long_command_that_just_finished_is_not_idle(self):
        s = Sess()
        s.prompt(0)
        s.bash(10, "npm run build", ok=300)
        # 303 s after the call, 13 s after its result: the result is the last output.
        st = run(s, 300 + live.THINKING_MIN_SEC)
        self.assertEqual((st["activity"]["kind"], st["activity"]["since_s"]), ("thinking", 13))
        self.assertEqual(run(s, 300 + live.IDLE_SEC - 1)["activity"]["kind"], "thinking")
        st = run(s, 300 + live.IDLE_SEC)
        self.assertEqual((st["activity"]["kind"], st["activity"]["since_s"]), ("idle", 180))

    def test_since_is_the_start_of_the_trailing_run_of_one_kind_and_role(self):
        s = Sess()
        s.prompt(0)
        s.read(10, "/repo/tests/test_a.py")
        s.read(20, "/repo/src/a.py")
        s.read(30, "/repo/src/b.py")
        s.read(40, "/repo/src/c.py")
        st = run(s, 45)
        a = st["activity"]
        self.assertEqual((a["kind"], a["role"], a["since_s"], a["files"], a["calls"]), ("reading", "source", 25, 3, 3))
        self.assertEqual(st["sentence"], "Reading the source code")

    def test_every_tool_shape_maps_to_its_activity(self):
        paths = live._Paths([], REPO, SALT)
        cases = [
            (Ev(0, T0, "tool", "look", tool="Task"), ("delegating", "unknown")),
            (Ev(0, T0, "tool", "look", tool="Agent"), ("delegating", "unknown")),
            (Ev(0, T0, "tool", "x", tool="Read", path="/repo/tests/test_a.py"), ("reading", "test")),
            (Ev(0, T0, "tool", "x", tool="Edit", path="/repo/src/a.py"), ("editing", "source")),
            (Ev(0, T0, "tool", "cat > a.md <<'EOF'", tool="Bash", path="/repo/a.md", added=3), ("editing", "docs")),
            (Ev(0, T0, "tool", "pytest -q", tool="Bash"), ("testing", "test")),
            (Ev(0, T0, "tool", "cd /repo && npm test", tool="Bash"), ("testing", "test")),
            # the digest names the sed's file; the call is still a test run
            (Ev(0, T0, "tool", "sed -i 's/x/y/' src/a.py && pytest", tool="Bash", path="src/a.py"), ("testing", "test")),
            (Ev(0, T0, "tool", "grep -rn foo .", tool="Bash"), ("searching", "unknown")),
            (Ev(0, T0, "tool", "rg foo", tool="Bash"), ("searching", "unknown")),
            (Ev(0, T0, "tool", "ls src | grep foo", tool="Bash"), ("searching", "unknown")),
            (Ev(0, T0, "tool", "find . -name x", tool="Bash"), ("searching", "unknown")),
            (Ev(0, T0, "tool", "cat README.md", tool="Bash"), ("reading", "unknown")),
            (Ev(0, T0, "tool", "sed -n 1,20p a.py", tool="Bash"), ("reading", "unknown")),
            (Ev(0, T0, "tool", "wc -l a.py", tool="Bash"), ("reading", "unknown")),
            (Ev(0, T0, "tool", "npm run build", tool="Bash"), ("running", "unknown")),
            (Ev(0, T0, "tool", "foo", tool="Grep"), ("searching", "unknown")),
            (Ev(0, T0, "tool", "**/*.py", tool="Glob"), ("searching", "unknown")),
            (Ev(0, T0, "tool", "https://x", tool="WebFetch"), ("searching", "unknown")),
            (Ev(0, T0, "tool", "{}", tool="mcp__posthog__exec"), ("running", "unknown")),
            (Ev(0, T0, "tool", "", tool="TodoWrite"), ("running", "unknown")),
        ]
        for e, want in cases:
            self.assertEqual(live._activity_of(e, paths), want, e.text or e.tool)


class Attempts(unittest.TestCase):
    """Writes to one file since the later of its last read and the last test run."""

    def session(self):
        s = Sess()
        s.prompt(0)
        s.read(10, "/repo/src/f.py")
        s.edit(20, "/repo/src/f.py")
        s.edit(30, "/repo/src/f.py")
        s.bash(40, "pytest -q", fail=41)
        s.edit(50, "/repo/src/f.py")
        s.edit(60, "/repo/src/f.py")
        s.edit(70, "/repo/src/other.py")
        s.read(80, "/repo/src/f.py")
        s.edit(90, "/repo/src/f.py")
        return s

    def test_attempts_reset_at_a_read_and_at_a_test_run(self):
        s = self.session()
        got = {}
        for cut in (22, 32, 52, 62, 72, 92):
            st = run(s, cut)
            got[cut] = (st["activity"]["attempt"], st["sentence"])
        self.assertEqual(
            got,
            {
                22: (1, "Editing a source file"),
                32: (2, "Rewriting a source file, second attempt"),
                52: (1, "Editing a source file"),
                62: (2, "Rewriting a source file, second attempt"),
                72: (1, "Editing two source files"),
                92: (1, "Editing a source file"),
            },
        )

    def test_attempt_is_zero_outside_editing(self):
        for name, st in scenario_states().items():
            if st["activity"]["kind"] != "editing":
                self.assertEqual(st["activity"]["attempt"], 0, name)

    def test_the_named_variant_names_the_file(self):
        st = run(self.session(), 32, names=True)
        self.assertEqual(live.sentence(st, names=True), "Rewriting f.py, second attempt")
        self.assertEqual(live.sentence(st), "Rewriting a source file, second attempt")


# ------------------------------------------------------------------------------ verdict


class Verdict(unittest.TestCase):
    def test_every_scenario(self):
        want = {
            "starting": ("starting", "segment_tool_calls"),
            "converging": ("converging", "error_rate_down_and_new_files"),
            "circling_failures": ("circling", "consecutive_failures"),
            "circling_churn": ("circling", "causes:file_churn_with_failures"),
            "circling_repeat": ("circling", "causes:repeated_call"),
            "lost": ("lost", "edits_to_unread_files"),
            "blind_codex_like": (None, None),
            "waiting_question": ("waiting", "turn_ended"),
            "done_after_commit": ("done", "turn_ended"),
            "pending_long_tool": ("starting", "segment_tool_calls"),
            "error_loop": (None, None),
        }
        got = {n: (st["verdict"]["state"], st["verdict"]["basis"]) for n, st in scenario_states().items()}
        self.assertEqual(got, want)

    def test_starting_ends_at_eight_calls(self):
        s, _ = starting()
        s.read(80, "/repo/src/m7.py")
        self.assertNotEqual(run(s, 85)["verdict"]["state"], "starting")

    def test_converging_evidence_by_hand(self):
        st = run(*converging())
        self.assertEqual(
            st["verdict"]["evidence"],
            {
                "window_calls": 5,
                "errors_now": 1,
                "errors_before": 2,
                "new_files": 2,  # b.py and c.py; a.py was touched before the window
                "checkpoints": 4,  # the failed and passing test runs, the write, the edit
                "repeats": 2,
                "churn_writes": 1,
                "fail_run": 1,
                "blind_edits": 0,
                "stuck_s": 0,
                "files_changed": 2,
                "commits": 0,
                "background": 0,
            },
        )

    def test_no_errors_before_means_the_error_rate_cannot_be_falling(self):
        s = Sess()
        s.prompt(0)
        for i in range(5):
            s.read(10 + 10 * i, f"/repo/src/r{i}.py")
        for i in range(5):
            s.write(100 + 10 * i, f"/repo/src/n{i}.py")
        st = run(s, 145)
        self.assertIsNone(st["verdict"]["state"])
        self.assertEqual(st["verdict"]["reason"], "no rule fired: 5 calls, 0 errors, 5 checkpoints")

    def test_consecutive_failures_by_hand(self):
        st = run(*circling_failures())
        ev = st["verdict"]["evidence"]
        self.assertEqual((ev["fail_run"], ev["errors_now"], ev["window_calls"]), (4, 4, 4))
        self.assertEqual(ev["stuck_s"], 190)  # 290 - 100, the run's first failing call
        self.assertEqual(st["sentence"], "Stuck on the same failing command for three minutes")
        self.assertEqual(
            live.sentence(run(*circling_failures(), names=True), names=True),
            "Stuck on the same failing pytest command for three minutes",
        )

    def test_churn_with_failures_by_hand(self):
        st = run(*circling_churn())
        ev = st["verdict"]["evidence"]
        # `repeats` counts only calls whose input the digest kept: the two different commands.
        self.assertEqual((ev["churn_writes"], ev["errors_now"], ev["repeats"]), (4, 2, 1))
        self.assertEqual(ev["stuck_s"], 55)  # 155 - 100, the first write in the window
        self.assertEqual(st["verdict"]["file_id"], fid("src/a.py"))
        self.assertEqual(st["sentence"], "Going back and forth on a source file, fourth pass")
        self.assertEqual(
            live.sentence(run(*circling_churn(), names=True), names=True),
            "Going back and forth on a.py, fourth pass",
        )
        # Under the verdict the activity is still counted: two writes since the last test.
        self.assertEqual(st["activity"]["attempt"], 2)

    def test_churn_without_failures_is_not_circling(self):
        s = Sess()
        s.prompt(0)
        for i, name in enumerate("abcdef"):
            s.read(10 + 5 * i, f"/repo/src/{name}.py")
        s.edit(100, "/repo/src/a.py")
        s.bash(110, "python3 -m pytest -x")
        s.write(120, "/repo/src/a.py", added=4, removed=3)
        s.bash(130, "npm test")
        s.edit(140, "/repo/src/a.py")
        s.write(150, "/repo/src/a.py", added=2, removed=2)
        self.assertNotEqual(run(s, 155)["verdict"]["state"], "circling")

    def test_repeated_call_by_hand(self):
        st = run(*circling_repeat())
        ev = st["verdict"]["evidence"]
        self.assertEqual((ev["repeats"], ev["stuck_s"]), (3, 75))  # 175 - 100
        self.assertEqual(st["sentence"], "Running the same step over and over, three times")

    def test_a_call_the_digest_kept_only_the_path_of_is_not_a_repeat(self):
        """Three edits to one file are three different edits; the digest keeps the path only.
        MEASURED: 111 of 130 repeated_call verdicts on the corpus were exactly this."""
        for tool in ("Edit", "Read", "TodoWrite"):
            s = Sess()
            s.prompt(0)
            for i, name in enumerate("abcde"):
                s.read(10 + i, f"/repo/src/{name}.py")
            for i in range(3):
                if tool == "Edit":
                    s.edit(100 + 20 * i, "/repo/src/a.py")
                elif tool == "Read":
                    s.read(100 + 20 * i, "/repo/src/big.py")
                else:
                    s.call(100 + 20 * i, "TodoWrite", "", ok=101 + 20 * i)
                s.bash(110 + 20 * i, f"echo step {i}")
            st = run(s, 200)
            self.assertNotEqual(st["verdict"]["basis"], "causes:repeated_call", tool)

    def test_a_repeated_search_is_a_repeat(self):
        s = Sess()
        s.prompt(0)
        for i in range(10):
            s.read(10 + i, f"/repo/src/r{i}.py")
        for i in range(3):  # 16 calls, so the window is the last 8 and holds all three
            s.call(100 + 20 * i, "Grep", "handleRetry", ok=101 + 20 * i)
            s.read(110 + 20 * i, f"/repo/src/n{i}.py")
        st = run(s, 200)
        self.assertEqual((st["verdict"]["basis"], st["verdict"]["evidence"]["repeats"]), ("causes:repeated_call", 3))

    def test_lost_by_hand(self):
        st = run(*lost())
        ev = st["verdict"]["evidence"]
        self.assertEqual((ev["blind_edits"], ev["new_files"], ev["checkpoints"]), (3, 3, 0))
        self.assertEqual(st["sentence"], "Editing three files it has not read yet")

    def test_lost_never_fires_for_a_harness_that_reads_through_the_shell(self):
        st = run(*blind_codex_like())
        self.assertEqual(st["verdict"]["evidence"]["blind_edits"], 0)
        self.assertNotEqual(st["verdict"]["state"], "lost")

    def unread(self, modify) -> dict:
        """Three files nothing read, then changed by `modify(s, t, path)`."""
        s = Sess()
        s.prompt(0)
        s.read(10, "/repo/src/a.py")
        s.bash(20, "ls")
        s.bash(30, "git status")
        s.bash(40, "git diff --stat")
        for i, name in enumerate("pqr"):
            modify(s, 50 + 10 * i, name)
        s.bash(80, "echo hi")
        return run(s, 85)

    def test_an_edit_the_harness_accepted_is_never_blind(self):
        """Claude Code refuses an Edit or an overwriting Write on a file the conversation has
        not read, so one it accepted was read (MEASURED: 0 refusals, 10 of 10 inspected corpus
        `lost` verdicts read elsewhere). They still count as modified."""
        for tool in ("Edit", "MultiEdit", "NotebookEdit"):
            st = self.unread(lambda s, t, n, tool=tool: s.call(t, tool, f"/repo/src/{n}.py", path=f"/repo/src/{n}.py", added=1, removed=1, ok=t + 1))
            self.assertEqual(st["verdict"]["evidence"]["blind_edits"], 0, tool)
            self.assertNotEqual(st["verdict"]["state"], "lost", tool)
        st = self.unread(lambda s, t, n: s.write(t, f"/repo/src/{n}.py", added=3, removed=2))
        self.assertEqual(st["verdict"]["evidence"]["blind_edits"], 0)

    def test_unguarded_modifications_can_be_blind(self):
        st = self.unread(lambda s, t, n: s.sed(t, f"src/{n}.py"))
        self.assertEqual((st["verdict"]["state"], st["verdict"]["evidence"]["blind_edits"]), ("lost", 3))
        st = self.unread(lambda s, t, n: s.call(t, "replace_in_file", f"/repo/src/{n}.py", path=f"/repo/src/{n}.py", ok=t + 1))
        self.assertEqual((st["verdict"]["state"], st["verdict"]["evidence"]["blind_edits"]), ("lost", 3))

    def test_a_file_read_under_another_spelling_is_not_blind(self):
        s = Sess()
        s.prompt(0)
        for i, name in enumerate("pqr"):
            s.read(10 + i, f"/repo/src/{name}.py")
        s.bash(20, "ls")
        for i, name in enumerate("pqr"):
            s.sed(50 + 10 * i, f"src/{name}.py")
        s.bash(80, "echo hi")
        self.assertEqual(run(s, 85)["verdict"]["evidence"]["blind_edits"], 0)

    def test_a_file_the_shell_named_first_is_not_blind(self):
        """MEASURED: the inspected corpus `lost` verdicts edited files read through the shell."""
        s = Sess()
        s.prompt(0)
        s.read(10, "/repo/src/a.py")
        s.bash(20, "sed -n '1,80p' src/p.py")
        s.bash(30, "grep -n retry src/q.py src/r.py")
        s.bash(40, "git status")
        s.sed(50, "src/p.py")
        s.sed(60, "src/q.py")
        s.sed(70, "src/r.py")
        s.bash(80, "echo hi")
        st = run(s, 85)
        self.assertEqual(st["verdict"]["evidence"]["blind_edits"], 0)
        self.assertNotEqual(st["verdict"]["state"], "lost")
        # A name inside a longer name is not the file.
        self.assertFalse(live._names_file("cat src/pp.py src/p.pyc", "/repo/src/p.py"))
        self.assertTrue(live._names_file("cat src/p.py:12", "/repo/src/p.py"))

    def test_creations_are_never_blind(self):
        st = self.unread(lambda s, t, n: s.write(t, f"/repo/src/{n}.py"))
        self.assertEqual(st["verdict"]["evidence"]["blind_edits"], 0)
        self.assertNotEqual(st["verdict"]["state"], "lost")
        st = self.unread(lambda s, t, n: s.heredoc(t, f"/repo/src/{n}.py", ["x = 1"]))
        self.assertEqual(st["verdict"]["evidence"]["blind_edits"], 0)

    def test_a_failed_modification_modified_nothing(self):
        def modify(s, t, n):
            if n == "p":
                s.sed(t, f"src/{n}.py", fail=t + 1)
            else:
                s.sed(t, f"src/{n}.py")

        st = self.unread(modify)
        self.assertEqual(st["verdict"]["evidence"]["blind_edits"], 2)
        self.assertNotEqual(st["verdict"]["state"], "lost")

    def test_lost_needs_blind_files_to_be_at_least_half_of_the_modified(self):
        s = Sess()
        s.prompt(0)
        for i, name in enumerate("wxyz"):
            s.read(1 + i, f"/repo/src/{name}.py")
        for i in range(8):
            s.bash(10 + i, f"echo {i}")
        # the window: three blind by `sed -i`, four edited after a read
        for i, name in enumerate(("p", "q", "r")):
            s.sed(100 + i * 10, f"src/{name}.py")
        for i, name in enumerate("wxyz"):
            s.edit(130 + i * 10, f"/repo/src/{name}.py")
        st = run(s, 175)
        self.assertEqual(st["verdict"]["evidence"]["blind_edits"], 3)
        self.assertNotEqual(st["verdict"]["state"], "lost")  # 3 of 7: under half

    def test_done_needs_work_a_clean_last_checkpoint_and_no_question(self):
        self.assertEqual(run(*done_after_commit())["verdict"]["state"], "done")
        self.assertEqual(run(*waiting_question())["verdict"]["state"], "waiting")

        s = Sess()  # the last test run failed
        s.prompt(0)
        s.edit(10, "/repo/src/a.py")
        s.bash(20, "pytest -q", fail=21)
        s.say(30, "The tests fail on an import I cannot fix.")
        self.assertEqual(run(s, 40)["verdict"]["state"], "waiting")

        s = Sess()  # nothing was written
        s.prompt(0)
        s.read(10, "/repo/src/a.py")
        s.say(20, "It reads fine to me.")
        self.assertEqual(run(s, 40)["verdict"]["state"], "waiting")

    def test_a_cut_closing_message_cannot_show_it_is_not_a_question(self):
        s = Sess()
        s.prompt(0)
        s.edit(10, "/repo/src/a.py")
        s.say(20, "I changed the handler and the retry" + "…[+900]")
        self.assertEqual(run(s, 40)["verdict"]["state"], "waiting")

    def test_done_with_only_a_commit(self):
        s = Sess()
        s.prompt(0)
        s.bash(10, "git commit -am wip")
        s.say(20, "Committed.")
        st = run(s, 30)
        self.assertEqual((st["verdict"]["state"], st["sentence"]), ("done", "Finished, with a commit"))

    def test_done_sentence_counts_files(self):
        self.assertEqual(run(*done_after_commit())["sentence"], "Finished, with two files changed")


# ------------------------------------------------------------------------------ sentence


def mk(kind=None, role="unknown", *, attempt=0, since=0, files=0, calls=0, file_id=None, verdict=None,
       basis=None, ev=None, v_file=None, rows=(), names=None) -> dict:
    evidence = dict.fromkeys(live.EVIDENCE_KEYS, 0)
    evidence.update(ev or {})
    st = {
        "activity": None
        if kind is None
        else {"kind": kind, "role": role, "attempt": attempt, "since_s": since, "files": files, "calls": calls, "file_id": file_id},
        "verdict": {"state": verdict, "evidence": evidence, "basis": basis, "reason": None, "file_id": v_file},
        "map": {"files": [{"id": i, "role": r} for i, r in rows]},
    }
    if names is not None:
        st["names"] = names
    return st


class Sentence(unittest.TestCase):
    def test_the_table_exactly(self):
        cases = [
            (mk(verdict="circling", basis="consecutive_failures", ev={"stuck_s": 360}), "Stuck on the same failing command for six minutes"),
            (mk(verdict="circling", basis="consecutive_failures", ev={"stuck_s": 59}), "Stuck on the same failing command"),
            (mk(verdict="circling", basis="consecutive_failures", ev={"stuck_s": 60}), "Stuck on the same failing command for one minute"),
            (mk(verdict="circling", basis="causes:file_churn_with_failures", ev={"churn_writes": 4}, v_file="f1", rows=[("f1", "test")]),
             "Going back and forth on a test file, fourth pass"),
            (mk(verdict="circling", basis="causes:repeated_call", ev={"repeats": 3}), "Running the same step over and over, three times"),
            (mk(verdict="lost", basis="edits_to_unread_files", ev={"blind_edits": 4}), "Editing four files it has not read yet"),
            (mk(verdict="done", ev={"files_changed": 1}), "Finished, with one file changed"),
            (mk(verdict="done", ev={"files_changed": 2, "commits": 1}), "Finished, with two files changed"),
            (mk(verdict="done", ev={"commits": 1}), "Finished, with a commit"),
            (mk("waiting_on_you", since=30), "Waiting on you"),
            (mk("waiting_on_you", since=60), "Waiting on you for one minute"),
            (mk("waiting_on_you", since=300), "Waiting on you for five minutes"),
            (mk("reading", "test", files=1), "Reading a test file"),
            (mk("reading", "test", files=2), "Reading two test files"),
            (mk("reading", "test", files=3), "Reading your test suite"),
            (mk("reading", "unknown", files=0), "Reading a file"),
            (mk("editing", "source", files=1, attempt=3), "Rewriting a source file, third attempt"),
            (mk("editing", "source", files=1, attempt=1), "Editing a source file"),
            (mk("editing", "source", files=2, attempt=1), "Editing two source files"),
            (mk("testing", "test"), "Running your test suite"),
            (mk("running"), "Running a command"),
            (mk("searching"), "Searching the codebase"),
            (mk("delegating", calls=2), "Handing work to two helper agents"),
            (mk("delegating", calls=1), "Handing work to one helper agent"),
            (mk("thinking"), "Thinking about the next step"),
            (mk("idle", since=240), "No new output for four minutes"),
            (mk(), "Nothing has happened yet"),
        ]
        for st, want in cases:
            self.assertEqual(live.sentence(st), want)

    def test_the_verdict_speaks_before_the_activity(self):
        st = mk("editing", "source", files=1, attempt=4, verdict="lost", ev={"blind_edits": 3})
        self.assertEqual(live.sentence(st), "Editing three files it has not read yet")
        st = mk("editing", "source", files=1, attempt=4, verdict="converging")
        self.assertEqual(live.sentence(st), "Rewriting a source file, fourth attempt")

    def test_names_swap_the_noun_for_the_file_and_the_command_for_its_program(self):
        nm = {"files": {"f1": "src/auth.py"}, "command": "npm", "failing_command": "pytest"}
        self.assertEqual(live.sentence(mk("editing", "source", files=1, attempt=3, file_id="f1", names=nm), names=True),
                         "Rewriting auth.py, third attempt")
        self.assertEqual(live.sentence(mk("reading", "source", files=1, file_id="f1", names=nm), names=True), "Reading auth.py")
        self.assertEqual(live.sentence(mk("running", names=nm), names=True), "Running npm")
        self.assertEqual(live.sentence(mk("testing", "test", names=nm), names=True), "Running npm")
        # Several files have no single name: the role noun stays.
        self.assertEqual(live.sentence(mk("reading", "source", files=3, file_id="f1", names=nm), names=True), "Reading the source code")

    def test_names_true_without_names_is_the_plain_sentence_exactly(self):
        for kind in live.ACTIVITY_KINDS:
            st = mk(kind, "source", files=1, attempt=2, since=120, calls=2, file_id="f1")
            self.assertEqual(live.sentence(st, names=True), live.sentence(st))

    def test_the_command_word_skips_cd_and_assignments(self):
        self.assertEqual(live._command_word("cd /repo && npm run build"), "npm")
        self.assertEqual(live._command_word("FOO=1 BAR=2 python3 -m pytest"), "python3")
        self.assertEqual(live._command_word("/usr/local/bin/bun test"), "bun")
        self.assertEqual(live._command_word("python3 - <<'PY' ⏎ import os ⏎ PY"), "python3")
        self.assertIsNone(live._command_word("cd /repo"))

    def test_no_basename_in_any_plain_sentence(self):
        for name, st in scenario_states(names=True).items():
            text = live.sentence(st)
            self.assertEqual(text, st["sentence"], name)
            for rel in st["names"]["files"].values():
                self.assertNotIn(pathlib.PurePosixPath(rel).name, text, name)

    def test_the_named_sentence_is_never_stored(self):
        for name, st in scenario_states(names=True).items():
            self.assertEqual(st["sentence"], live.sentence(st, names=False), name)


# ------------------------------------------------------------------------------ eta


def fact(i: int, secs: float, *, repo: str | None = REPO, unattended: bool = False) -> SessionFact:
    return SessionFact(
        session_id=f"h{i}",
        started_at=T0 - 86_400 + i,
        ended_at=T0 - 86_400 + i + secs,
        active_seconds=secs,
        attended_seconds=0.0 if unattended else secs,
        autonomous_seconds=secs if unattended else 0.0,
        repo=repo,
        unattended=unattended,
    )


def eta(history, *, elapsed=150.0, repo=REPO, unattended=False) -> dict:
    s, now = converging()
    return run(s, now, history, repo=repo, active_seconds=elapsed, unattended=unattended)["eta"]


class Eta(unittest.TestCase):
    TWELVE = [fact(i, 60.0 * (i + 1)) for i in range(12)]  # 1 to 12 minutes

    def test_the_survivor_quartiles_by_hand(self):
        got = eta(self.TWELVE, elapsed=150.0)
        # Survivors: 180, 240, ..., 720 (ten). Inclusive quartiles: 315, 450, 585.
        self.assertEqual(
            got,
            {
                "elapsed_s": 150,
                "typical_s": 450,
                "p25_s": 315,
                "p75_s": 585,
                "remaining_s": 300,
                "n": 10,
                "needed": live.ETA_MIN_SESSIONS,
                "unattended": False,
                "basis": live.ETA_BASIS,
                "reason": None,
                "code": None,
            },
        )

    def test_refuses_below_ten_sessions_on_this_repository(self):
        got = eta(self.TWELVE[:9])
        self.assertEqual(got["reason"], "9 finished sessions on this repository, 10 needed")
        self.assertEqual(got["n"], 9)
        for k in ("typical_s", "p25_s", "p75_s", "remaining_s"):
            self.assertIsNone(got[k])
        self.assertEqual(eta(self.TWELVE[:1])["reason"], "1 finished session on this repository, 10 needed")

    def test_refuses_when_too_few_ran_this_long(self):
        got = eta(self.TWELVE, elapsed=200.0)  # 240..720 survive: nine
        self.assertEqual(got["reason"], "9 finished sessions on this repository ran at least 3 minutes, 10 needed")
        self.assertEqual(got["n"], 9)
        self.assertIsNone(got["remaining_s"])

    def test_refuses_without_a_repository(self):
        got = eta(self.TWELVE, repo=None)
        self.assertEqual(got["reason"], "the repository this session runs in could not be resolved")
        self.assertIsNone(got["n"])

    def test_refuses_without_the_active_clock(self):
        s, now = converging()
        got = run(s, now, self.TWELVE, active_seconds=None)["eta"]
        self.assertEqual(got["reason"], "the active time of this session was not supplied")
        self.assertIsNone(got["elapsed_s"])

    def test_other_repositories_and_the_other_clock_do_not_count(self):
        mixed = [fact(i, 60.0 * (i + 1), repo="/elsewhere") for i in range(12)]
        mixed += [fact(100 + i, 60.0 * (i + 1), unattended=True) for i in range(12)]
        self.assertEqual(eta(mixed)["reason"], "0 finished sessions on this repository, 10 needed")
        got = eta(mixed, unattended=True)
        self.assertEqual(got["n"], 10)
        self.assertEqual(eta(mixed[:15], unattended=True)["reason"], "3 finished unattended runs on this repository, 10 needed")

    def test_remaining_is_never_negative(self):
        long = [fact(i, 1000.0) for i in range(10)]
        self.assertEqual(eta(long, elapsed=1000.0)["remaining_s"], 0)


# ------------------------------------------------------------------------------ decisions


def decisions(sess: Sess, now: float = 1000, names: bool = False) -> list[dict]:
    return run(sess, now, names=names)["decisions"]


def kinds(sess: Sess) -> list[str]:
    return [d["kind"] for d in decisions(sess)]


def one_command(cmd: str, **kw) -> Sess:
    s = Sess()
    s.prompt(0)
    s.bash(10, cmd, **kw)
    return s


class Decisions(unittest.TestCase):
    def test_shell_rules(self):
        cases = {
            "git push --force origin main": ["force_pushed"],
            "git push -f": ["force_pushed"],
            "git push --force-with-lease origin feat": ["force_pushed"],
            "git push origin main": [],
            "rm tests/test_old.py": ["deleted_test"],
            "git rm -r __tests__": ["deleted_test"],
            "rm -rf build": [],
            "rm notes.txt && pytest tests/": [],
            "git commit --no-verify -m wip": ["skipped_hook"],
            "HUSKY=0 git push": ["skipped_hook"],
            "git checkout -- src/a.py": ["reverted_changes"],
            "git checkout .": ["reverted_changes"],
            "git restore src/a.py": ["reverted_changes"],
            "git reset --hard HEAD~1": ["reverted_changes"],
            "git revert abc123": ["reverted_changes"],
            "git clean -fd": ["reverted_changes"],
            "git checkout main": [],
            "git restore --staged src/a.py": [],  # unstages, throws nothing away
            "git restore --staged --worktree src/a.py": ["reverted_changes"],
            "npm uninstall lodash": ["removed_dependency"],
            "pip uninstall -y requests": ["removed_dependency"],
            "poetry remove httpx": ["removed_dependency"],
            "npm install redis": ["added_dependency"],
            "bun add zod": ["added_dependency"],
            "pip install requests": ["added_dependency"],
            "uv add httpx": ["added_dependency"],
            "go get github.com/x/y": ["added_dependency"],
            "cargo add serde": ["added_dependency"],
            "gem install rails": ["added_dependency"],
            "pip install -r requirements.txt": [],
            "pip install -e .": [],
            "npm install": [],
            "npm i -D typescript": [],
            "timeout=900 bun install 2>&1 | tail -15": [],  # MEASURED on the corpus
            "npm i axios@^1.19.0 2>&1 | tail -5": ["added_dependency"],
        }
        for cmd, want in cases.items():
            self.assertEqual(kinds(one_command(cmd)), want, cmd)

    def test_words_inside_quotes_or_after_echo_decide_nothing(self):
        """FOUND IN REVIEW: the rules searched whole lines split by a quote blind regex, so a
        commit message or an echo label became a decision. MEASURED on the corpus's 8,467
        successful shell calls: the same 20 decisions both ways, plus `pip install
        "posthog"`, which the old regex missed because the package was quoted."""
        cases = {
            'git commit -m "docs: never git push --force to main"': [],
            'git commit -m "cleanup; rm tests/test_old.py next time"': [],
            'echo "next: npm install redis"': [],
            "printf 'git reset --hard\\n'": [],
            'git commit -m "skip with --no-verify when stuck"': [],
            # The real thing beside the quoted one still counts.
            'echo "pushing" && git push --force': ["force_pushed"],
            "sudo npm install redis": ["added_dependency"],
            "python3 -m pip install httpx": ["added_dependency"],
            'pip install "posthog" 2>&1 | tail -3': ["added_dependency"],
            "cd app && git -C sub reset --hard": ["reverted_changes"],
            "export HUSKY=0 && git commit -m x": ["skipped_hook"],
            # A command the digest cut mid quote: the unbalanced tail is an argument.
            'git commit -m "never git push --force…[+30]': [],
        }
        for cmd, want in cases.items():
            self.assertEqual(kinds(one_command(cmd)), want, cmd)

    def test_a_package_url_is_no_name(self):
        """FOUND IN REVIEW: `--names` printed "Added https://deploy:<password>@registry...",
        userinfo the mask misses when the host has no dot. The decision stands; the detail
        is None, and the wire never had it."""
        for cmd in (
            "npm install https://deploy:hunterpass@registry:4873/acme-billing-1.0.0.tgz",
            "pip install git+https://github.com/x/y.git",
            "npm install deploy:hunterpass@registry/acme",
        ):
            with self.subTest(cmd=cmd):
                d = decisions(one_command(cmd), names=True)
                self.assertEqual([(x["kind"], x["detail"]) for x in d], [("added_dependency", None)])
                self.assertEqual(live.decision_sentence(d[0], names=True), "Added a dependency.")
        d = decisions(one_command("npm install @scope/pkg"), names=True)
        self.assertEqual(d[0]["detail"], "@scope/pkg")

    def test_a_failed_command_did_not_do_it(self):
        self.assertEqual(kinds(one_command("git push --force", fail=11)), [])
        self.assertEqual(kinds(one_command("npm install redis", fail=11)), [])

    def test_a_heredoc_body_is_data(self):
        s = Sess()
        s.prompt(0)
        s.heredoc(10, "/repo/docs/rules.md", ["never git push --force", "and never git reset --hard"])
        self.assertEqual(kinds(s), [])

    def test_weakened_test(self):
        s = Sess()
        s.prompt(0)
        s.bash(10, "pytest -q", fail=11)
        s.edit(20, "/repo/tests/test_a.py", added=1, removed=6)
        self.assertEqual(kinds(s), ["weakened_test"])
        self.assertEqual(decisions(s, names=True)[0]["detail"], "test_a.py")

    def test_weakened_test_needs_a_failure_first_and_no_source_fix_between(self):
        s = Sess()  # the tests passed
        s.prompt(0)
        s.bash(10, "pytest -q")
        s.edit(20, "/repo/tests/test_a.py", added=1, removed=6)
        self.assertEqual(kinds(s), [])

        s = Sess()  # a source fix came between
        s.prompt(0)
        s.bash(10, "pytest -q", fail=11)
        s.edit(15, "/repo/src/a.py")
        s.edit(20, "/repo/tests/test_a.py", added=1, removed=6)
        self.assertEqual(kinds(s), [])

        s = Sess()  # the test grew
        s.prompt(0)
        s.bash(10, "pytest -q", fail=11)
        s.edit(20, "/repo/tests/test_a.py", added=6, removed=1)
        self.assertEqual(kinds(s), [])

    def test_changed_schema(self):
        for path, want in (
            ("/repo/db/migrations/001_init.sql", ["changed_schema"]),
            ("/repo/prisma/schema.prisma", ["changed_schema"]),
            ("/repo/src/api.graphql", ["changed_schema"]),
            ("/repo/proto/rides.proto", ["changed_schema"]),
            ("/repo/src/myschema.ts", []),
        ):
            s = Sess()
            s.prompt(0)
            s.edit(10, path)
            self.assertEqual(kinds(s), want, path)
        s = Sess()
        s.prompt(0)
        s.edit(10, "/repo/db/migrations/001_init.sql", fail=11)
        self.assertEqual(kinds(s), [])

    def test_abandoned_plan_is_a_second_plan_after_work_in_one_segment(self):
        s = Sess()
        s.prompt(0)
        s.call(5, "ExitPlanMode", ok=6)
        s.edit(10, "/repo/src/a.py")
        s.call(20, "ExitPlanMode", ok=21)
        self.assertEqual(kinds(s), ["abandoned_plan"])

        s = Sess()  # nothing written between
        s.prompt(0)
        s.call(5, "ExitPlanMode", ok=6)
        s.call(20, "ExitPlanMode", ok=21)
        self.assertEqual(kinds(s), [])

        s = Sess()  # the second plan answers a new prompt
        s.prompt(0)
        s.call(5, "ExitPlanMode", ok=6)
        s.edit(10, "/repo/src/a.py")
        s.prompt(15, "now the next feature")
        s.call(20, "ExitPlanMode", ok=21)
        self.assertEqual(kinds(s), [])

    def test_switched_approach(self):
        s = Sess()
        s.prompt(0)
        s.edit(10, "/repo/src/a.py")
        s.bash(20, "git checkout -b plan-b")
        self.assertEqual(kinds(s), ["switched_approach"])

        s = Sess()  # a branch before any work is just starting
        s.prompt(0)
        s.bash(5, "git switch -c feat")
        s.edit(10, "/repo/src/a.py")
        self.assertEqual(kinds(s), [])

        s = Sess()  # threw it away and wrote somewhere else
        s.prompt(0)
        s.write(10, "/repo/src/a.py")
        s.bash(20, "git reset --hard")
        s.write(30, "/repo/src/b.py")
        self.assertEqual(kinds(s), ["reverted_changes", "switched_approach"])

        s = Sess()  # threw it away and rewrote the same file
        s.prompt(0)
        s.write(10, "/repo/src/a.py")
        s.bash(20, "git reset --hard")
        s.write(30, "/repo/src/a.py")
        self.assertEqual(kinds(s), ["reverted_changes"])

    def test_one_entry_per_kind_with_the_count_and_the_first_event(self):
        s = Sess()
        s.prompt(0)
        s.bash(10, "git push --force")
        s.bash(20, "git push -f origin main")
        got = decisions(s)
        self.assertEqual(len(got), 1)
        self.assertEqual(got[0]["evidence"], {"event_n": 1, "count": 2})
        self.assertEqual(got[0]["ts"], T0 + 10)

    def test_the_cap_keeps_the_hardest_to_undo(self):
        s = Sess()
        s.prompt(0)
        s.call(1, "ExitPlanMode", ok=2)
        s.write(3, "/repo/src/a.py")
        s.call(4, "ExitPlanMode", ok=5)                       # abandoned_plan
        s.bash(6, "npm install redis")                        # added_dependency
        s.bash(7, "npm uninstall lodash")                     # removed_dependency
        s.edit(8, "/repo/db/migrations/002_x.sql")            # changed_schema
        s.bash(9, "git checkout -b other")                    # switched_approach
        s.bash(10, "git reset --hard")                        # reverted_changes
        s.bash(11, "pytest -q", fail=12)
        s.edit(13, "/repo/tests/test_a.py", added=0, removed=4)  # weakened_test
        s.bash(14, "git commit --no-verify -m x")             # skipped_hook
        s.bash(15, "rm tests/test_b.py")                      # deleted_test
        s.bash(16, "git push --force")                        # force_pushed
        every = [d["kind"] for d in live._decisions(s.events(), burn.segments(s.events(), []), live._Paths(s.events(), REPO, SALT), live._failed_calls(s.events()), False)]
        self.assertEqual(len(every), live.MAX_DECISIONS)
        self.assertEqual(every, list(live.DECISION_KINDS[: live.MAX_DECISIONS]))

    def test_detail_is_local_and_only_with_names(self):
        s = one_command("npm install redis")
        self.assertNotIn("detail", decisions(s)[0])
        d = decisions(s, names=True)[0]
        self.assertEqual(d["detail"], "redis")
        self.assertEqual(live.decision_sentence(d, names=True), "Added redis.")
        self.assertEqual(live.decision_sentence(d), "Added a dependency.")
        self.assertEqual(decisions(one_command("pip uninstall -y requests"), names=True)[0]["detail"], "requests")
        self.assertEqual(decisions(one_command("rm tests/test_old.py"), names=True)[0]["detail"], "test_old.py")
        self.assertIsNone(decisions(one_command("git push --force"), names=True)[0]["detail"])

    def test_every_kind_has_a_sentence(self):
        self.assertEqual(set(live.DECISION_SENTENCES), set(live.DECISION_KINDS))


# ------------------------------------------------------------------------------ needs you


class NeedsYou(unittest.TestCase):
    def test_the_order(self):
        states = scenario_states()
        pick = {
            "waiting_question": "waiting_for_input",
            "circling_failures": "circling",
            "lost": "lost",
            "error_loop": "error_loop",
            "pending_long_tool": "idle",
            "done_after_commit": "finished_unreviewed",
            "converging": "running_fine",
        }
        for name, reason in pick.items():
            self.assertEqual(states[name]["needs_you"]["reason"], reason, name)
        ranked = live.mission_order(reversed([states[n] for n in pick]))
        self.assertEqual([s["needs_you"]["reason"] for s in ranked], list(pick.values()))

    def test_scores_by_hand(self):
        states = scenario_states()
        self.assertEqual(states["waiting_question"]["needs_you"]["score"], 82)   # 80 + 120 // 60
        self.assertEqual(states["circling_failures"]["needs_you"]["score"], 63)  # 60 + 190 // 60
        self.assertEqual(states["lost"]["needs_you"]["score"], 55)               # 55 + 5 * (3 - 3)
        self.assertEqual(states["error_loop"]["needs_you"]["score"], 50)         # 50 + 3 * (3 - 3)
        self.assertEqual(states["pending_long_tool"]["needs_you"]["score"], 45)  # 35 + 600 // 60
        self.assertEqual(states["done_after_commit"]["needs_you"]["score"], 32)  # 30 + 300 // 120
        self.assertEqual(states["converging"]["needs_you"]["score"], 5)

    def test_scores_are_clamped_and_escalate_with_time(self):
        s, _ = waiting_question()
        self.assertEqual(run(s, 50 + 3 * 3600)["needs_you"]["score"], 100)
        s, _ = pending_long_tool()
        self.assertEqual(run(s, 5 + 3 * 3600)["needs_you"]["score"], 55)

    def test_the_error_loop_bar_is_burns(self):
        def causes(errors: int) -> set[str]:
            evs = []
            for i in range(errors):
                evs.append(Ev(2 * i, T0 + i, "tool", f"cmd {i}", tool="Bash", tool_id=f"t{i}"))
                evs.append(Ev(2 * i + 1, T0 + i, "result_error", "Error: x", tool="Bash", tool_id=f"t{i}"))
            seg = burn.Segment(index=0, start_ts=T0, end_ts=T0 + errors, prompt="", events=evs)
            return {c["cause"] for c in seg.causes()}

        self.assertNotIn("error_loop", causes(live.ERROR_LOOP_MIN_ERRORS - 1))
        self.assertIn("error_loop", causes(live.ERROR_LOOP_MIN_ERRORS))

    def test_ties_go_to_the_longest_wait_then_the_id(self):
        a = {"session_id": "b", "needs_you": {"score": 40}, "activity": {"since_s": 10}}
        b = {"session_id": "a", "needs_you": {"score": 40}, "activity": {"since_s": 10}}
        c = {"session_id": "c", "needs_you": {"score": 40}, "activity": {"since_s": 99}}
        self.assertEqual([s["session_id"] for s in live.mission_order([a, b, c])], ["c", "a", "b"])


# ------------------------------------------------------------------------------ map


class Map(unittest.TestCase):
    def session(self):
        s = Sess()
        s.prompt(0)
        s.read(10, "/repo/src/a.py")
        s.edit(20, "/repo/src/a.py")
        s.read(30, "/repo/README.md")
        s.edit(40, "/repo/src/b.py", fail=41)
        return s

    def test_rows_by_hand(self):
        st = run(self.session(), 45)
        rows = {r["id"]: r for r in st["map"]["files"]}
        self.assertEqual(
            rows[fid("src/a.py")],
            {
                "id": fid("src/a.py"),
                "role": "source",
                "depth": 1,
                "dir_id": fid("src"),
                "reads": 1,
                "edits": 1,
                "last_read_ts": T0 + 10,
                "last_edit_ts": T0 + 20,
            },
        )
        readme = rows[fid("README.md")]
        # At the base the directory has no id: spec/live.v1.json says null, and a hash of
        # the empty string would be an id naming no directory.
        self.assertEqual((readme["depth"], readme["dir_id"], readme["role"]), (0, None, "docs"))
        self.assertEqual(len(rows), 3)

    def test_timelapse_by_hand(self):
        st = run(self.session(), 45)
        self.assertEqual(
            st["timelapse"],
            [
                [10, fid("src/a.py"), "read"],
                [20, fid("src/a.py"), "edit"],
                [30, fid("README.md"), "read"],
                # The Edit at 40 was answered by an error: it changed nothing, so it is a
                # failure frame and not an edit (FOUND IN REVIEW).
                [41, fid("src/b.py"), "fail"],
            ],
        )

    def test_ids_change_with_the_salt(self):
        a = run(self.session(), 45, salt="one" * 11)
        b = run(self.session(), 45, salt="two" * 11)
        self.assertTrue({r["id"] for r in a["map"]["files"]}.isdisjoint({r["id"] for r in b["map"]["files"]}))

    def test_ids_do_not_change_with_the_worktree(self):
        def ids(*paths):
            s = Sess()
            s.prompt(0)
            for i, p in enumerate(paths):
                s.read(10 + i, p)
            return {r["id"] for r in run(s, 60)["map"]["files"]}

        want = fid("src/a.py")
        self.assertIn(want, ids("/repo/src/a.py"))
        self.assertIn(want, ids("/wt/src/a.py", "/wt/docs/b.md"))  # a worktree beside the repo
        self.assertIn(want, ids("/repo/.claude/worktrees/feat/src/a.py"))
        self.assertIn(want, ids("/repo/.worktrees/task/fix-1/src/a.py"))

    def test_a_relative_path_cannot_be_placed(self):
        s = Sess()
        s.prompt(0)
        s.heredoc(10, "tests/test_x.py", ["def test(): pass"])
        row = run(s, 20)["map"]["files"][0]
        self.assertEqual((row["id"], row["depth"], row["role"], row["edits"]), (fid("tests/test_x.py"), None, "test", 1))

    def test_at_most_600_deterministic_frames_keeping_the_edit(self):
        s = Sess()
        for i in range(1200):
            s.read(i, f"/repo/src/f{i}.py")
        s.edit(600.5, "/repo/src/hot.py")
        a = run(s, 1300)["timelapse"]
        b = run(s, 1300)["timelapse"]
        self.assertEqual(a, b)
        self.assertLessEqual(len(a), live.MAX_FRAMES)
        self.assertIn([600, fid("src/hot.py"), "edit"], a)
        # Bin 0 holds offsets 0 and 1; the tie goes to the later one.
        self.assertEqual(a[0], [1, fid("src/f1.py"), "read"])
        self.assertEqual([f[0] for f in a], sorted(f[0] for f in a))

    def test_under_the_cap_every_frame_is_kept(self):
        s = Sess()
        for i in range(600):
            s.read(i, f"/repo/src/f{i}.py")
        self.assertEqual(len(run(s, 700)["timelapse"]), 600)


# ------------------------------------------------------------------------------ wire


class Wire(unittest.TestCase):
    def session(self):
        s = Sess()
        s.prompt(0, "SENTINELPROMPT please wire the sentinelword feature")
        s.read(10, "/repo/src/sentinelpath/auth.py")
        s.edit(20, "/repo/src/sentinelpath/auth.py")
        s.bash(30, "npm install sentinelpkg")
        s.heredoc(40, "/repo/src/sentinelfile.py", ["x = 1"])
        s.bash(50, "SENTINELCMD --flag", pending=True)
        return s

    def test_nothing_local_reaches_the_wire(self):
        st = run(self.session(), 55, names=True)
        self.assertIn("sentinel", json.dumps(st).lower())  # the local state does hold them
        blob = json.dumps(live.wire(st)).lower()
        self.assertNotIn("sentinel", blob)
        self.assertNotIn("auth.py", blob)
        self.assertNotIn(SALT, blob)

    def test_wire_drops_names_sentence_and_detail_and_keeps_the_rest(self):
        st = run(self.session(), 55, names=True)
        before = json.dumps(st, sort_keys=True)
        w = live.wire(st)
        self.assertEqual(
            set(w), (set(st) - {"names", "sentence", "session_id"}) | {"live_version"}
        )
        self.assertTrue(all("detail" not in d for d in w["decisions"]))
        self.assertEqual(w["verdict"]["evidence"], st["verdict"]["evidence"])
        self.assertEqual(live.sentence(w), live.sentence(st))  # the phone can render it
        self.assertIn("detail", st["decisions"][0])  # wire never mutates the local state
        self.assertEqual(json.dumps(st, sort_keys=True), before)

    # -- the spec shape (docs/overnight-integration.md 2.6, spec/live.v1.json) ------------

    def spec_errors(self, doc: dict, fields=None) -> list[str]:
        return spec_walk.errors(
            doc,
            LIVE_SPEC["fields"] if fields is None else fields,
            objects=LIVE_SPEC["objects"],
            enums=LIVE_SPEC["enums"],
            max_lengths=LIVE_SPEC["max_lengths"],
        )

    def every_state(self) -> dict[str, dict]:
        """Every scenario, the named variant, a session with no events, and one with
        no history, so each refusal and each answered branch reaches the walker."""
        out = {n: st for n, st in scenario_states().items()}
        out |= {f"{n}+names": st for n, st in scenario_states(names=True).items()}
        out["no_events"] = live.live_state([], [], T0, [], salt=SALT, repo=REPO, active_seconds=0.0)
        s, now = converging()
        out["no_history"] = run(s, now, None)
        out["eta_answered"] = run(s, now, [fact(i, 60.0 * (i + 1)) for i in range(12)], active_seconds=150.0)
        return out

    def test_wire_keys_are_the_spec_keys_at_every_level(self):
        for name, st in self.every_state().items():
            w = live.wire(st)
            self.assertEqual(self.spec_errors(w), [], name)
            self.assertEqual(list(w), [f["name"] for f in LIVE_SPEC["fields"]], name)

    def test_the_generated_door_accepts_every_wire_state(self):
        """The server's own model (`server/builder/live_spec.py`, extra forbidden at every
        level), where pydantic is installed. The walker above is the check CI runs."""
        door = spec_walk.pydantic_door("live_spec")
        if door is None:
            self.skipTest("pydantic is not installed here; the stdlib walker covers the shape")
        for name, st in self.every_state().items():
            door.LiveState.model_validate(live.wire(st))
            names = live.wire_names(st)
            if names is not None:
                door.LiveNames.model_validate(names)

    def test_the_caps_and_tables_are_the_specs(self):
        objs = {o: {f["name"]: f for f in fs} for o, fs in LIVE_SPEC["objects"].items()}
        top = {f["name"]: f for f in LIVE_SPEC["fields"]}
        self.assertEqual(live.LIVE_VERSION, LIVE_SPEC["version"])
        self.assertEqual(live.MAX_MAP_FILES, objs["LiveMap"]["files"]["max_items"])
        self.assertEqual(live.MAX_MAP_FILES, objs["LiveNames"]["files"]["max_items"])
        self.assertEqual(live.MAX_NAME_CHARS, LIVE_SPEC["max_lengths"]["name"])
        self.assertEqual(live.MAX_FRAMES, top["timelapse"]["max_items"])
        self.assertEqual(live.MAX_DECISIONS, top["decisions"]["max_items"])
        self.assertEqual(list(live.ETA_REFUSALS), LIVE_SPEC["enums"]["eta_refusal"])
        self.assertEqual(list(live.VERDICT_REFUSALS), LIVE_SPEC["enums"]["verdict_refusal"])
        self.assertEqual(list(live.EVIDENCE_KEYS), list(objs["LiveEvidence"]))
        self.assertEqual([live.ETA_BASIS], LIVE_SPEC["enums"]["eta_basis"])

    def test_wire_carries_no_path_basename_or_command(self):
        st = run(self.session(), 55, names=True)
        blob = json.dumps(live.wire(st))
        for local in ("sentinel", "SENTINEL", "auth.py", "/repo", "src/", "npm", "install", SALT):
            self.assertNotIn(local, blob)
        # Every string on the wire is an enum value, a 16 hex id, or the ISO clock.
        enum_values = {v for vs in LIVE_SPEC["enums"].values() for v in vs}

        def strings(x):
            if isinstance(x, dict):
                for v in x.values():
                    yield from strings(v)
            elif isinstance(x, list):
                for v in x:
                    yield from strings(v)
            elif isinstance(x, str):
                yield x

        w = live.wire(st)
        for text in strings(w):
            self.assertTrue(
                text in enum_values or HEX.match(text) or text == w["computed_at"], text
            )

    def test_file_ids_are_16_hex(self):
        for name, st in self.every_state().items():
            w = live.wire(st)
            ids = [w["activity"]["file_id"]] if w["activity"] else []
            ids.append(w["verdict"]["file_id"])
            for row in (w["map"] or {}).get("files", []):
                ids += [row["id"], row["dir_id"]]
            ids += [f["file_id"] for f in w["timelapse"] or []]
            for i in ids:
                self.assertTrue(i is None or HEX.match(i), (name, i))
        # A file at the base has no directory id; one below it has one.
        rows = {r["id"]: r for r in live.wire(run(Map().session(), 45))["map"]["files"]}
        self.assertIsNone(rows[fid("README.md")]["dir_id"])
        self.assertEqual(rows[fid("src/a.py")]["dir_id"], fid("src"))

    def test_frames_are_objects_and_capped_at_600(self):
        s = Sess()
        for i in range(1200):
            s.read(i, f"/repo/src/f{i}.py")
        st = run(s, 1300)
        w = live.wire(st)["timelapse"]
        self.assertLessEqual(len(w), live.MAX_FRAMES)
        self.assertEqual(w, [{"t": t, "file_id": f, "kind": k} for t, f, k in st["timelapse"]])
        self.assertTrue(all(set(f) == {"t", "file_id", "kind"} for f in w))

    def test_map_keeps_the_400_most_recent_and_counts_all(self):
        s = Sess()
        s.prompt(0)
        for i in range(450):
            s.read(1 + i, f"/repo/src/f{i:03d}.py")
        st = run(s, 460, names=True)
        self.assertEqual(len(st["map"]["files"]), 450)  # the local state keeps every row
        m = live.wire(st)["map"]
        self.assertEqual((len(m["files"]), m["files_total"]), (live.MAX_MAP_FILES, 450))
        # f000 to f049 were read first: they are the fifty cut.
        self.assertEqual(
            [r["id"] for r in m["files"]], [fid(f"src/f{i:03d}.py") for i in range(50, 450)]
        )
        names = live.wire_names(st)["files"]
        self.assertEqual([n["id"] for n in names], [r["id"] for r in m["files"]])
        # Under the cap nothing is cut and the total is the row count.
        small = live.wire(run(Map().session(), 45))["map"]
        self.assertEqual((len(small["files"]), small["files_total"]), (3, 3))

    def test_refusals_carry_codes_and_needed(self):
        states = self.every_state()
        self.assertEqual(live.wire(states["no_events"])["verdict"]["reason"], "no_events")
        rule = next(st for st in states.values() if st["verdict"]["code"] == "no_rule_fired")
        self.assertEqual(live.wire(rule)["verdict"]["reason"], "no_rule_fired")
        # Every verdict has a code exactly when it has no state, and a prose reason beside it.
        for name, st in states.items():
            v = st["verdict"]
            self.assertEqual(v["code"] is None, v["state"] is not None, name)
            self.assertEqual(v["reason"] is None, v["code"] is None, name)
        s, now = converging()
        twelve = [fact(i, 60.0 * (i + 1)) for i in range(12)]
        codes = {
            "no_active_time": run(s, now, twelve, active_seconds=None),
            "repo_unresolved": run(s, now, twelve, repo=None),
            "no_history": run(s, now, None),
            "too_few_sessions": run(s, now, twelve[:9], active_seconds=150.0),
            "too_few_survivors": run(s, now, twelve, active_seconds=200.0),
        }
        self.assertEqual(list(codes), list(live.ETA_REFUSALS))
        for code, st in codes.items():
            eta = live.wire(st)["eta"]
            self.assertEqual(eta["reason"], code)
            self.assertEqual(eta["needed"], live.ETA_MIN_SESSIONS)
            self.assertIs(eta["unattended"], False)
            self.assertIsNone(eta["remaining_s"])
            self.assertTrue(st["eta"]["reason"], "the prose reason stays in the local state")
        answered = live.wire(states["eta_answered"])["eta"]
        self.assertIsNone(answered["reason"])
        self.assertEqual((answered["n"], answered["needed"]), (10, 10))
        unattended = live.wire(run(s, now, twelve, unattended=True))["eta"]
        self.assertIs(unattended["unattended"], True)

    def test_eta_refuses_without_history_rather_than_counting_zero(self):
        s, now = converging()
        none = run(s, now, None)["eta"]
        self.assertEqual((none["code"], none["n"]), ("no_history", None))
        self.assertEqual(none["reason"], "no finished sessions were supplied to compare this one against")
        # An EMPTY history is a measurement: zero sessions were found on this repository.
        empty = run(s, now, [])["eta"]
        self.assertEqual((empty["code"], empty["n"]), ("too_few_sessions", 0))

    def test_repo_key_matches_history_by_key_not_by_path(self):
        """The server keys stored sessions by `repo_hash`; the map's paths stay relative to
        the checkout (`repo`). The ETA reads the key, the map reads the path."""
        s, now = converging()
        hashed = [fact(i, 60.0 * (i + 1), repo="a" * 64) for i in range(12)]
        by_key = run(s, now, hashed, repo=REPO, repo_key="a" * 64, active_seconds=150.0)
        self.assertEqual((by_key["eta"]["code"], by_key["eta"]["typical_s"]), (None, 450))
        by_path = run(s, now, hashed, repo=REPO, active_seconds=150.0)
        self.assertEqual((by_path["eta"]["code"], by_path["eta"]["n"]), ("too_few_sessions", 0))
        # The map is placed under `repo` either way: the key never touches a path.
        self.assertEqual(by_key["map"], by_path["map"])
        # A key and no path still answers: the server that cannot resolve a cwd can match.
        self.assertIsNone(run(s, now, hashed, repo=None, repo_key="a" * 64, active_seconds=150.0)["eta"]["code"])

    def test_wire_names_are_basenames_only(self):
        s = Sess()
        s.prompt(0)
        s.read(10, "/repo/src/deep/er/auth.py")
        s.edit(20, "/repo/src/deep/er/auth.py")
        s.read(30, "/repo/README.md")
        s.write(40, f"{SCRATCH}/probe.py")
        long_name = "x" * (live.MAX_NAME_CHARS - 2) + ".py"
        s.read(50, f"/repo/{long_name}")
        st = run(s, 60, names=True)
        got = live.wire_names(st)
        self.assertEqual(
            got,
            {"files": [{"id": fid("src/deep/er/auth.py"), "name": "auth.py"}, {"id": fid("README.md"), "name": "README.md"}]},
        )
        self.assertEqual(self.spec_errors(got, LIVE_SPEC["objects"]["LiveNames"]), [])
        self.assertNotIn("probe.py", json.dumps(got), "Claude Code's own files are on neither")
        self.assertNotIn("/", "".join(n["name"] for n in got["files"]))
        self.assertIsNone(live.wire_names(run(s, 60)), "no names were computed, so none travel")
        self.assertNotIn("names", live.wire(st))

    def test_sentence_from_the_wire_is_the_sentence(self):
        for name, st in self.every_state().items():
            if name.endswith("+names"):
                continue
            self.assertEqual(live.sentence(live.wire(st)), st["sentence"], name)


# ------------------------------------------------------------------------------ ground truth
#
# Each case below is a wrong output found by running the module on the real corpus
# (`~/.builder-overnight/corpus`, 57 root transcripts, 584 replayed cut points) and on the
# live transcript of the overnight build session, then recounting from the raw JSONL by
# hand (2026-09-13). The docstring carries the measurement; the test pins the fix.

SCRATCH = "/private/tmp/claude-501/-Users-me-repo/8f7c2a4e-0000-4000-8000-000000000001/scratchpad"
MEMORY = "/Users/me/.claude/projects/-Users-me-repo/memory"


class GroundTruth(unittest.TestCase):
    def test_done_never_fires_while_background_work_is_out(self):
        """MEASURED: of the 4 `done` verdicts in the corpus replay, 3 were handed back with
        background work still out ("Pods installing. Waiting on the build." after a Monitor;
        two overnight runs waiting on their own jobs), and on the live transcript all 3
        ("Finished, with eight files changed" at 00:41, "nine" twice at 00:51) came while
        workflows it had launched were running: the raw transcript had 5 launches without a
        task notification at 00:41, and the closing text read "Waiting on the research,
        engine and foundation workflows"."""
        s = Sess()
        s.prompt(0)
        s.read(10, "/repo/src/a.py")
        s.edit(20, "/repo/src/a.py")
        s.call(25, "Workflow", '{"script":"export const meta = {name: \'research\'}"}', ok=26)
        s.bash(30, "pytest -q", ok=35)
        s.say(40, "Tests pass. The research workflow is still running.")
        # The digest cannot see the notification, so a Workflow call in the segment is out.
        st = run(s, 70)
        self.assertEqual((st["verdict"]["state"], st["sentence"]), ("waiting", "Waiting on you"))
        # The caller read the transcript (`background_tasks`) and nothing is out: done.
        st = run(s, 70, background=0)
        self.assertEqual((st["verdict"]["state"], st["sentence"]), ("done", "Finished, with one file changed"))
        # A background shell job the digest cannot see at all blocks it too.
        s2, now = done_after_commit()
        self.assertEqual(run(s2, now)["verdict"]["state"], "done")
        self.assertEqual(run(s2, now, background=1)["verdict"]["state"], "waiting")

    def test_a_turn_handed_back_while_its_own_job_runs_is_not_waiting_on_you(self):
        """FOUND IN REVIEW: read, edit, a passing test run, a Workflow launch, then "Waiting
        on the e2e workflow." with one background task out read "Waiting on you for six
        minutes", needs you 86, at the top of mission control above a session that was
        truly circling. Claude Code wakes the agent when its job reports back."""
        s, now = done_after_commit()
        st = run(s, now, background=2)
        self.assertEqual((st["verdict"]["state"], st["verdict"]["basis"]), ("waiting", live.BACKGROUND_BASIS))
        self.assertEqual(st["verdict"]["evidence"]["background"], 2)
        self.assertEqual(st["needs_you"], {"score": 10, "reason": "waiting_on_background"})
        self.assertEqual(st["sentence"], "Waiting on two background tasks it started")
        self.assertEqual(run(s, now, background=1)["sentence"], "Waiting on one background task it started")
        # Below a session that is circling, above one that is simply running.
        circling = run(*circling_failures())
        fine = run(*converging())
        order = live.mission_order([fine, st, circling])
        self.assertEqual([x["needs_you"]["reason"] for x in order], ["circling", "waiting_on_background", "running_fine"])
        # A job that never reports back climbs, a point every ten minutes, to 30.
        self.assertEqual(run(s, now + 3600, background=2)["needs_you"]["score"], 16)
        self.assertEqual(run(s, now + 10 * 3600, background=2)["needs_you"]["score"], 30)

    def test_the_person_still_has_the_turn_when_the_job_is_out(self):
        """A closing question, an interrupt or a turn the harness cut off is the person's
        turn whatever is still running; and the digest's own lower bound (launches whose
        notification it cannot see, finished ones included) never says the agent is waiting
        on its job."""
        s, now = waiting_question()
        self.assertEqual(run(s, now, background=1)["needs_you"]["reason"], "waiting_for_input")
        s = Sess()
        s.prompt(0)
        s.read(5, "/repo/src/a.py")
        s.edit(10, "/repo/src/a.py")
        s.bash(20, "pytest -q", ok=25)
        s.interrupt(30)
        self.assertEqual(run(s, 45, background=1)["needs_you"]["reason"], "waiting_for_input")
        s = Sess()
        s.prompt(0)
        s.edit(10, "/repo/src/a.py")
        s.call(20, "Workflow", '{"script":"x"}', ok=21)
        s.say(30, "The workflow is running.")
        st = run(s, 60)  # no `background`: the digest's lower bound
        self.assertEqual((st["verdict"]["basis"], st["needs_you"]["reason"]), ("turn_ended", "waiting_for_input"))

    def test_a_rejected_edit_is_not_an_edit_on_the_map(self):
        """FOUND IN REVIEW: `_edited` had no failure check, so an Edit the harness answered
        with an error drew an edit and an `edit` frame while `files_changed` said 0 (38
        corpus write calls were answered by an error)."""
        s = Sess()
        s.prompt(0)
        s.read(5, "/repo/src/a.py")
        s.edit(10, "/repo/src/a.py", fail=11)
        st = run(s, 20)
        row = {r["id"]: r for r in st["map"]["files"]}[fid("src/a.py")]
        self.assertEqual((row["reads"], row["edits"]), (1, 0))
        self.assertNotIn("edit", [f[2] for f in st["timelapse"]])
        self.assertEqual(st["verdict"]["evidence"]["files_changed"], 0)

    def test_a_relative_write_after_cd_into_the_scratchpad_is_not_a_project_file(self):
        """`patterns.harness_event`, the rule `vocab` measured at 142 of 303 relative shell
        writes: `cd <scratchpad> && cat > probe.py <<'EOF'` is Claude Code's own file. The
        absolute path rule alone called it a project file and the turn "Finished, with one
        file changed" (FOUND IN REVIEW)."""
        s = Sess()
        s.prompt(0)
        s.call(10, "Bash", f"cd {SCRATCH} && cat > probe.py <<'EOF' ⏎ print(1) ⏎ EOF", path="probe.py", added=1, removed=0, ok=11)
        s.bash(20, "pytest -q", ok=25)
        s.say(30, "Done.")
        st = run(s, 60)
        self.assertEqual(st["verdict"]["evidence"]["files_changed"], 0)
        self.assertEqual(st["map"]["files"], [])
        self.assertEqual(st["sentence"], "Waiting on you")

    def test_a_short_salt_is_refused(self):
        """A salt anyone can guess is a wire id a dictionary lookup away from its path."""
        s, now = converging()
        for salt in ("", "salt", "x" * (live.SALT_MIN_CHARS - 1)):
            with self.subTest(salt=salt), self.assertRaises(ValueError):
                run(s, now, salt=salt)
        self.assertIsNotNone(run(s, now, salt="x" * live.SALT_MIN_CHARS))

    def test_files_changed_counts_project_files_the_calls_changed(self):
        """MEASURED on the live transcript (00:41): "Finished, with eight files changed" was
        two project files, two scratchpad files and four memory notes under `~/.claude`. On
        the corpus, 72 of the 882 files written in segments that produced work are
        scratchpad files, and 6 of 324 `git commit` calls failed."""
        s = Sess()
        s.prompt(0)
        s.read(5, "/repo/src/a.py")
        s.edit(10, "/repo/src/a.py")
        s.write(15, f"{SCRATCH}/probe.py")
        s.write(20, f"{MEMORY}/notes.md")
        s.edit(25, "/repo/src/b.py", fail=26)  # "String to replace not found": nothing changed
        s.bash(30, 'git commit -m "wip"', fail=31)  # a failed commit is not a commit
        s.bash(40, "pytest -q", ok=45)
        s.say(50, "Done.")
        st = run(s, 80)
        ev = st["verdict"]["evidence"]
        self.assertEqual((ev["files_changed"], ev["commits"]), (1, 0))
        self.assertEqual((st["verdict"]["state"], st["sentence"]), ("done", "Finished, with one file changed"))

    def test_an_answer_worked_out_in_the_scratchpad_is_not_a_finished_change(self):
        """MEASURED: 17 of the corpus's 246 segments that produced work wrote nothing but
        scratchpad files. One was answered "Finished, with one file changed" after the
        person asked how accurate a number was and the agent ran `dwellstab.py` from the
        scratchpad; no project file changed, and the turn is an answer waiting to be read."""
        s = Sess()
        s.prompt(0, "how accurate is that really")
        s.heredoc(10, f"{SCRATCH}/dwellstab.py", ["import json", "print(1)"])
        s.bash(20, f"python3 {SCRATCH}/dwellstab.py", ok=25)
        s.say(30, "It holds up. The median shift is 2 seconds.")
        st = run(s, 60)
        self.assertEqual(st["verdict"]["evidence"]["files_changed"], 0)
        self.assertEqual((st["verdict"]["state"], st["sentence"]), ("waiting", "Waiting on you"))

    def test_harness_files_never_choose_the_base_of_the_map(self):
        """MEASURED on the live transcript (the 00:20 cut): a session in the sibling worktree
        `builder-overnight` also wrote the scratchpad and four `~/.claude` memory notes, so
        the common directory was `/` and `CLAUDE.md`, `brief.md` and `PROGRESS.md`, at the
        checkout's root, sat at depth 5 under ids no checkout of the repository produces."""
        s = Sess()
        s.prompt(0)
        s.read(10, "/wt/analysis/live.py")
        s.edit(20, "/wt/brief.md")
        s.write(30, f"{SCRATCH}/plan.md")
        s.write(40, f"{MEMORY}/MEMORY.md")
        st = run(s, 60, repo="/repo")
        rows = {r["id"]: r for r in st["map"]["files"]}
        self.assertEqual(rows[fid("analysis/live.py")]["depth"], 1)
        self.assertEqual(rows[fid("brief.md")]["depth"], 0)
        # Nor are they on the map at all (MEASURED: 475 of the corpus's 1,335 rows were
        # Claude Code's own files), or in the time lapse.
        self.assertEqual(len(rows), 2)
        self.assertEqual([f[1] for f in st["timelapse"]], [fid("analysis/live.py"), fid("brief.md")])

    def test_the_worktree_root_places_a_sibling_worktree_like_its_checkout(self):
        """MEASURED on the live transcript (the 01:51 cut): with a sibling folder read as well
        (`design-refs`, 4 events) the common directory was `.../projects`, so `brief.md` sat
        at depth 1 as `builder-overnight/brief.md` and `shots/foundation/01-tabs-you.png` at
        depth 3; with `root` they are 0 and 2. `root` is the caller's `worktree_root(session)`.
        A shell write names its file relative to the shell (`cat >> PROGRESS.md`), which is
        the checkout's own spelling once the checkout is known: one file, one row."""
        s = Sess()
        s.prompt(0)
        s.read(10, "/wt/analysis/live.py")
        s.edit(20, "/wt/PROGRESS.md")
        s.heredoc(25, "PROGRESS.md", ["# progress"])
        s.read(30, "/elsewhere/design-refs/SYNTHESIS.md")
        rows = {r["id"]: r for r in run(s, 60, repo="/repo", root="/wt")["map"]["files"]}
        self.assertEqual(rows[fid("analysis/live.py")]["depth"], 1)
        self.assertEqual((rows[fid("PROGRESS.md")]["depth"], rows[fid("PROGRESS.md")]["edits"]), (0, 2))
        self.assertEqual(len(rows), 3)  # one file, one row, whichever way it was spelled
        # The repository stays what the ETA matches history on.
        self.assertEqual(run(s, 60, repo="/repo", root="/wt")["eta"]["reason"], "0 finished sessions on this repository, 10 needed")

    def test_scratchpad_files_are_not_new_files_entering_scope(self):
        """MEASURED on the corpus replay: 3 of the 37 `converging` cut points rested only on
        scratchpad files (simulator screenshots, probe scripts) entering the window."""
        s = Sess()
        s.prompt(0)
        s.read(10, "/repo/src/a.py")
        s.bash(20, "pytest -q", fail=21)
        s.edit(30, "/repo/src/a.py")
        s.bash(40, "pytest -q", fail=41)
        s.edit(50, "/repo/src/a.py")
        s.bash(60, "pytest -q", fail=61)
        s.write(70, f"{SCRATCH}/shot1.py", added=5)
        s.edit(80, "/repo/src/a.py")
        s.bash(90, "pytest -q")
        s.read(100, f"{SCRATCH}/shot1.png")
        st = run(s, 106)
        self.assertEqual(st["verdict"]["evidence"]["new_files"], 0)
        self.assertNotEqual(st["verdict"]["state"], "converging")
        self.assertEqual(run(*converging())["verdict"]["state"], "converging")  # the same shape, in the repo

    def test_a_file_changed_by_sed_is_an_edit_on_the_map(self):
        """MEASURED on the corpus (157 sessions, 1,335 map rows): 23 rows were files changed
        only by `sed -i`, each drawn with 0 reads, 0 edits and no frame in the time lapse."""
        s = Sess()
        s.prompt(0)
        s.sed(10, "/repo/src/q.py")
        st = run(s, 20)
        row = {r["id"]: r for r in st["map"]["files"]}[fid("src/q.py")]
        self.assertEqual((row["reads"], row["edits"], row["last_edit_ts"]), (0, 1, T0 + 10))
        self.assertEqual(st["timelapse"], [[10, fid("src/q.py"), "edit"]])

    def test_a_turn_the_harness_cut_off_is_handed_back_and_never_done(self):
        """MEASURED: 19 `stop_sequence` records on this machine, every one `<synthetic>` (an API
        error, "Your computer went to sleep mid-response", "You've hit your session limit",
        "No response requested."), 12 answered by the person (9 typed, 3 queued). Only
        `end_turn` was read, so each of these turns read "Thinking about the next step",
        then "No new output"."""
        s = Sess()
        s.prompt(0)
        s.read(5, "/repo/src/a.py")
        s.edit(10, "/repo/src/a.py")
        s.bash(20, "pytest -q", ok=25)
        s.say(30, "API Error: 529 Overloaded. This is a server side issue, try again in a moment.", stop="stop_sequence")
        st = run(s, 45)
        self.assertEqual((st["activity"]["kind"], st["activity"]["since_s"]), ("waiting_on_you", 15))
        self.assertEqual((st["verdict"]["state"], st["sentence"]), ("waiting", "Waiting on you"))

    def test_the_command_word_is_a_program_or_nothing(self):
        """MEASURED on the corpus replay (584 cut points): the named sentence read "Running
        for" 15 times, "Running echo" 13, "Running export" 3, "Running until" 2, "Running
        printf" 2, "Running [redacted]" 2, "Running source" 1, "Running edits" 1 (for
        `E=$(gplay edits create ...)`), and three cut fragments such as "Running c…[+840]"."""
        cases = {
            "SP=/tmp/x; for i in $(seq 1 40); do curl -s localhost:8000; done": "curl",
            'SS=/tmp/x ⏎ until curl -sf "http://localhost:8000/health"; do sleep 2; done': "curl",
            "export ANDROID_HOME=$HOME/sdk; adb devices": "adb",
            "source .venv/bin/activate && pytest -q": "pytest",
            'cd /repo && E=$(gplay edits create --package com.x | python3 -c "x")': "gplay",
            'echo "=== tests ==="; npm test': "npm",
            "echo done": "echo",
            "if [ -f x ]; then make build; fi": "make",
            "while true; do sleep 5; done": "sleep",
            # A package runner runs the program after it (FOUND IN REVIEW: "Running npx"
            # would have been printed 236 times over the corpus).
            "(cd mobile && npx expo start)": "expo",
            "npx jest --watch": "jest",
            "timeout 900 bun install": "bun",
            "nice -n 10 make build": "make",
            "cd /repo && c…[+840]": None,
            "cd /repo ⏎ [redacted] auth print-access-token": None,
        }
        for cmd, want in cases.items():
            self.assertEqual(live._command_word(cmd), want, cmd)
        s = Sess()
        s.prompt(0)
        s.bash(10, "SP=/tmp/x; for i in $(seq 1 40); do curl -s localhost:8000; done", pending=True)
        self.assertEqual(live.sentence(run(s, 20, names=True), names=True), "Running curl")

    def test_a_cut_or_masked_name_is_no_detail(self):
        """MEASURED on the corpus: `git rm -q backend/services/eta_ml/stale_polls.py
        backend/tests/t…` gave the detail "test_eta_…[+39]", printed as "Deleted
        test_eta_…[+39]." The decision stands; the name is gone."""
        d = decisions(one_command("git rm -q backend/services/x.py backend/tests/test_eta_…[+39]"), names=True)
        self.assertEqual([(x["kind"], x["detail"]) for x in d], [("deleted_test", None)])
        self.assertEqual(live.decision_sentence(d[0], names=True), "Deleted a test file.")
        d = decisions(one_command("npm install reac…[+12]"), names=True)
        self.assertEqual([(x["kind"], x["detail"]) for x in d], [("added_dependency", None)])


# ------------------------------------------------------------------------------ no dashes


class NoDashes(unittest.TestCase):
    """Every string this module can put in front of a person, through `plain.has_dash`."""

    def assertClean(self, text: str, where: str = ""):
        self.assertIsInstance(text, str)
        self.assertFalse(plain.has_dash(text), f"{where}: {text!r}")

    def test_every_sentence_template(self):
        nm = {"files": {"f1": "src/auth.py"}, "command": "npm", "failing_command": "pytest"}
        for kind, role, files, attempt, since, calls, names in itertools.product(
            live.ACTIVITY_KINDS, plain.ROLES, (0, 1, 2, 3, 21), (0, 2, 11), (0, 59, 60, 3600), (0, 1, 25), (None, nm)
        ):
            st = mk(kind, role, files=files, attempt=attempt, since=since, calls=calls, file_id="f1", names=names)
            self.assertClean(live.sentence(st), kind)
            self.assertClean(live.sentence(st, names=True), kind)
        for basis in ("consecutive_failures", "causes:file_churn_with_failures", "causes:repeated_call"):
            for n in (0, 1, 4, 11, 30):
                ev = {"stuck_s": n * 60, "churn_writes": n, "repeats": n}
                for role in plain.ROLES:
                    st = mk(verdict="circling", basis=basis, ev=ev, v_file="f1", rows=[("f1", role)], names=nm)
                    self.assertClean(live.sentence(st), basis)
                    self.assertClean(live.sentence(st, names=True), basis)
        for n in (0, 1, 3, 25):
            self.assertClean(live.sentence(mk(verdict="lost", ev={"blind_edits": n})))
            self.assertClean(live.sentence(mk(verdict="done", ev={"files_changed": n, "commits": n})))
        self.assertClean(live.sentence(mk()))

    def test_every_scenario_sentence_and_reason(self):
        for name, st in itertools.chain(scenario_states().items(), scenario_states(names=True).items()):
            self.assertClean(st["sentence"], name)
            self.assertClean(live.sentence(st, names=True), name)
            if st["verdict"]["reason"]:
                self.assertClean(st["verdict"]["reason"], name)

    def test_every_decision_sentence(self):
        for kind in live.DECISION_KINDS:
            self.assertClean(live.decision_sentence({"kind": kind}), kind)
            self.assertClean(live.decision_sentence({"kind": kind, "detail": "redis"}, names=True), kind)

    def test_every_eta_reason(self):
        facts = [fact(i, 60.0 * (i + 1)) for i in range(12)]
        reasons = [
            eta(facts, repo=None)["reason"],
            eta(facts[:9])["reason"],
            eta(facts[:1])["reason"],
            eta(facts[:3], unattended=True)["reason"],
            eta(facts, elapsed=200.0)["reason"],
            eta(facts, elapsed=4000.0)["reason"],
            run(*converging(), active_seconds=None)["eta"]["reason"],
        ]
        for r in reasons:
            self.assertClean(r)
        self.assertEqual(eta(facts, elapsed=4000.0)["reason"], "0 finished sessions on this repository ran at least 1h 07m, 10 needed")


# ------------------------------------------------------------------------------ the parser, end to end
#
# The pieces above take the digest's word for `stop_reason` and `result_ts`. These write a
# real Claude Code transcript and read it back through `digest.load_claude_code_events`,
# so a loader that stopped stamping either field would fail here, not in front of a person.

SID = "8f7c2a4e-0000-4000-8000-000000000001"


def _iso(t: float) -> str:
    return dt.datetime.fromtimestamp(T0 + t, dt.UTC).isoformat().replace("+00:00", "Z")


class Transcript:
    def __init__(self, cwd: str = "/nonexistent/repo") -> None:
        self.records: list[dict] = []
        self.cwd = cwd
        self._parent: str | None = None

    def _rec(self, t: float, body: dict) -> None:
        u = str(uuid.uuid4())
        self.records.append(
            {"uuid": u, "parentUuid": self._parent, "sessionId": SID, "cwd": self.cwd, "timestamp": _iso(t), **body}
        )
        self._parent = u

    def prompt(self, t: float, text: str) -> None:
        self._rec(t, {"type": "user", "promptSource": "typed", "message": {"role": "user", "content": [{"type": "text", "text": text}]}})

    def calls(self, t: float, mid: str, calls: list[tuple[str, str, dict]]) -> None:
        blocks = [{"type": "tool_use", "id": tid, "name": name, "input": inp} for tid, name, inp in calls]
        self._assistant(t, mid, blocks, "tool_use")

    def say(self, t: float, mid: str, text: str, stop: str = "end_turn") -> None:
        self._assistant(t, mid, [{"type": "text", "text": text}], stop)

    def _assistant(self, t: float, mid: str, blocks: list, stop: str) -> None:
        usage = {"input_tokens": 10, "output_tokens": 5, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 100}
        self._rec(t, {"type": "assistant", "message": {"id": mid, "role": "assistant", "model": "claude-opus-5", "stop_reason": stop, "usage": usage, "content": blocks}})

    def result(self, t: float, tid: str, content: str, is_error: bool = False) -> None:
        block = {"type": "tool_result", "tool_use_id": tid, "content": content, "is_error": is_error}
        self._rec(t, {"type": "user", "message": {"role": "user", "content": [block]}})

    def write(self, root: pathlib.Path, project: str = "-nonexistent-repo") -> pathlib.Path:
        d = root / project
        d.mkdir(parents=True, exist_ok=True)
        path = d / f"{SID}.jsonl"
        path.write_text("".join(json.dumps(r) + "\n" for r in self.records))
        return path


class EndToEnd(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def state(self, path: pathlib.Path, now: float) -> dict:
        events = digest.load_claude_code_events(path)
        return live.live_state(events, burn.load_turns(path), T0 + now, [], salt=SALT)

    def test_end_turn_read_from_the_transcript(self):
        t = Transcript()
        t.prompt(0, "look at a.py")
        t.calls(5, "m1", [("toolu_1", "Read", {"file_path": "/nonexistent/repo/a.py"})])
        t.result(6, "toolu_1", "print('hi')")
        t.say(10, "m2", "It prints hi.")
        path = t.write(self.root)
        st = self.state(path, 40)  # 30 s after: under WAITING_MIN_SEC, so only stop_reason can tell
        self.assertEqual((st["activity"]["kind"], st["activity"]["since_s"]), ("waiting_on_you", 30))
        self.assertEqual(st["sample"]["tokens"], 230)

    def test_a_pending_tool_read_from_the_transcript_is_idle(self):
        t = Transcript()
        t.prompt(0, "run the tests")
        t.calls(5, "m1", [("toolu_1", "Bash", {"command": "pytest -q"})])
        path = t.write(self.root)
        self.assertEqual(self.state(path, 5 + 179)["activity"]["kind"], "testing")
        self.assertEqual(self.state(path, 5 + 180)["activity"]["kind"], "idle")

    def test_a_result_time_read_from_the_transcript(self):
        t = Transcript()
        t.prompt(0, "build it")
        t.calls(5, "m1", [("toolu_1", "Bash", {"command": "npm run build"})])
        t.result(100, "toolu_1", "built")
        path = t.write(self.root)
        # Without `result_ts` the call at +5 would still read as running 115 s later.
        st = self.state(path, 120)
        self.assertEqual((st["activity"]["kind"], st["activity"]["since_s"]), ("thinking", 20))

    def test_parallel_results_pair_on_the_tool_id(self):
        t = Transcript()
        t.prompt(0, "go")
        t.calls(5, "m1", [("toolu_1", "Bash", {"command": "git push --force"}), ("toolu_2", "Bash", {"command": "ls"})])
        t.result(6, "toolu_1", "Error: rejected", is_error=True)
        t.result(6, "toolu_2", "a b c")
        path = t.write(self.root)
        # Adjacency would pin the error on `ls` and report a force push that was rejected.
        self.assertEqual(self.state(path, 20)["decisions"], [])

    def test_live_transcripts_is_the_allowlist_filtered_by_age(self):
        now = time.time()
        fresh = Transcript().write(self.root, "-p-one")
        old = self.root / "-p-one" / "11111111-1111-4111-8111-111111111111.jsonl"
        old.write_text("")
        os.utime(old, (now - live.LIVE_MTIME_SEC - 1, now - live.LIVE_MTIME_SEC - 1))
        edge = self.root / "-p-two" / "22222222-2222-4222-8222-222222222222.jsonl"
        edge.parent.mkdir()
        edge.write_text("")
        os.utime(edge, (now - live.LIVE_MTIME_SEC, now - live.LIVE_MTIME_SEC))
        sidecar = self.root / "-p-one" / SID / "subagents" / "agent-1.jsonl"
        sidecar.parent.mkdir(parents=True)
        sidecar.write_text("")
        got = sorted(t.path for t in live.live_transcripts(self.root, now))
        self.assertEqual(got, sorted([fresh, edge]))

    def test_background_tasks_are_launches_not_yet_reported_back(self):
        """The raw signal behind `live_state(background=...)`. MEASURED on the live
        transcript at 00:41: 8 background launches (3 async agents, 3 workflows, one more
        agent, one `brew install` in the background) and 3 task notifications, so 5 out,
        which `background_tasks` returns."""
        t = Transcript()
        t.prompt(0, "go")
        t.calls(
            5,
            "m1",
            [
                ("toolu_w", "Workflow", {"script": "export const meta = {}"}),
                ("toolu_a", "Agent", {"description": "map the app", "run_in_background": True}),
                ("toolu_b", "Bash", {"command": "npm run dev", "run_in_background": True}),
                ("toolu_x", "Bash", {"command": "ls"}),
                ("toolu_f", "Workflow", {"script": "broken"}),
            ],
        )
        t.result(6, "toolu_w", "Workflow launched in background. Task ID: w1 Summary: research")
        t.result(6, "toolu_a", [{"type": "text", "text": "Async agent launched successfully.\nagentId: a1"}])
        t.result(6, "toolu_b", "Command running in background with ID: b1. Output is being written to: /tmp/b1")
        t.result(6, "toolu_x", "a b c")
        t.result(6, "toolu_f", "Workflow launched in background. Task ID: w2", is_error=True)
        t.say(8, "m2", "Three things are running.")
        t._rec(
            100,
            {
                "type": "user",
                "promptSource": "system",
                "origin": {"kind": "task-notification"},
                "message": {
                    "role": "user",
                    "content": "<task-notification>\n<task-id>a1</task-id>\n<tool-use-id>toolu_a</tool-use-id>\n<status>completed</status>\n</task-notification>",
                },
            },
        )
        path = t.write(self.root)
        self.assertEqual(live.background_tasks(path, T0, T0 + 50), 3)
        self.assertEqual(live.background_tasks(path, T0, T0 + 200), 2)
        self.assertEqual(live.background_tasks(path, T0 + 7, T0 + 200), 0)  # launched before the window
        self.assertIsNone(live.background_tasks(self.root / "missing.jsonl", T0, T0 + 50))  # absent, not zero
        # 82 s after the closing text: handed back by `end_turn`, or by the silence rule
        # for a loader that does not stamp it, with three tasks still out.
        events = digest.load_claude_code_events(path)
        bg = live.background_tasks(path, T0, T0 + 90)
        self.assertEqual(bg, 3)
        st = live.live_state(events, burn.load_turns(path), T0 + 90, [], salt=SALT, background=bg)
        self.assertEqual((st["activity"]["kind"], st["verdict"]["state"]), ("waiting_on_you", "waiting"))

    def _launched(self) -> "Transcript":
        """A Bash call launched into the background at +5 (result at +6), then text."""
        t = Transcript()
        t.prompt(0, "go")
        t.calls(5, "m1", [("toolu_b", "Bash", {"command": "npm test", "run_in_background": True})])
        t.result(6, "toolu_b", "Command running in background with ID: b1. Output is being written to: /tmp/b1")
        t.say(8, "m2", "Running the tests in the background.")
        return t

    @staticmethod
    def _note(tid: str) -> str:
        return f"<task-notification>\n<task-id>b1</task-id>\n<tool-use-id>{tid}</tool-use-id>\n<status>completed</status>\n</task-notification>"

    def test_a_notification_delivered_mid_turn_brings_the_task_back(self):
        """When a task finishes while the agent is MID TURN, Claude Code writes the
        notification as a `queue-operation` record and a `queued_command` attachment, never
        as a `user` record. MEASURED on the corpus: 101 notifications as `user` records
        against 280 enqueues, 179 removes and 142 attachments; 91 of 98 "still out" tasks in
        transcripts over an hour old had a notification in one of those shapes (FOUND IN
        REVIEW: a sitting that ended 22 days ago printed "1 task still out")."""
        for shape in ("enqueue", "remove", "attachment", "user_no_origin"):
            with self.subTest(shape=shape):
                t = self._launched()
                note = self._note("toolu_b")
                if shape in ("enqueue", "remove"):
                    t.records.append({"type": "queue-operation", "operation": shape, "timestamp": _iso(30), "sessionId": SID, "content": note})
                elif shape == "attachment":
                    t._rec(30, {"type": "attachment", "attachment": {"type": "queued_command", "prompt": note, "commandMode": "task-notification"}})
                else:
                    t._rec(30, {"type": "user", "message": {"role": "user", "content": note}})
                path = t.write(self.root)
                self.assertEqual(live.background_tasks(path, T0, T0 + 20), 1)
                self.assertEqual(live.background_tasks(path, T0, T0 + 60), 0)

    def test_a_quoted_notification_is_not_one(self):
        """A compaction summary that quotes a notification is not the task reporting back."""
        t = self._launched()
        t._rec(30, {"type": "user", "message": {"role": "user", "content": "This session is being continued. Earlier: " + self._note("toolu_b")}})
        self.assertEqual(live.background_tasks(t.write(self.root), T0, T0 + 60), 1)

    def test_a_launch_with_no_call_id_is_not_counted_forever(self):
        """FOUND IN REVIEW: a launch result with no `tool_use_id` added "None" to the pending
        set, which no notification can name, so the sitting was "still out" for good."""
        t = Transcript()
        t.prompt(0, "go")
        t._rec(6, {"type": "user", "message": {"role": "user", "content": [{"type": "tool_result", "content": "Command running in background with ID: b1"}]}})
        self.assertEqual(live.background_tasks(t.write(self.root), T0, T0 + 60), 0)

    def test_a_complete_notification_with_no_newline_is_not_read_yet(self):
        """The guard, reached: the last record is whole JSON with no newline, so the JSON
        decoder cannot be what skips it (FOUND IN REVIEW: the guard survived deletion)."""
        t = self._launched()
        path = t.write(self.root)
        with path.open("a") as f:
            f.write(json.dumps({"type": "queue-operation", "operation": "enqueue", "timestamp": _iso(30), "sessionId": SID, "content": self._note("toolu_b")}))
        self.assertEqual(live.background_tasks(path, T0, T0 + 60), 1)
        with path.open("a") as f:
            f.write("\n")
        self.assertEqual(live.background_tasks(path, T0, T0 + 60), 0)

    def test_worktree_root_is_the_checkout_the_records_ran_in(self):
        """`git rev-parse --show-toplevel` of the session's working directories, for a
        worktree beside the repository (MEASURED: this overnight session works in
        `builder-overnight`, a worktree of `builder` that sits next to it)."""
        import subprocess
        import types

        from capture import repo as cap_repo

        main = self.root / "main"
        main.mkdir()
        who = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"}
        for args in (
            ["init", "-q"],
            ["commit", "-q", "--allow-empty", "-m", "init"],
            ["worktree", "add", "-q", str(self.root / "wt")],
        ):
            subprocess.run(["git", *args], cwd=main, check=True, env={**os.environ, **who}, capture_output=True)
        wt = self.root / "wt"
        ident = cap_repo.identity_for(str(wt))
        self.assertIsNotNone(ident)
        session = types.SimpleNamespace(repo=ident, records=[{"cwd": str(wt)}] * 3 + [{"cwd": str(self.root)}])
        self.assertEqual(os.path.realpath(live.worktree_root(session)), os.path.realpath(wt))
        self.assertEqual(os.path.realpath(ident.common_root), os.path.realpath(main))  # the ETA's key
        self.assertIsNone(live.worktree_root(types.SimpleNamespace(repo=None, records=[])))

    def test_current_session_is_the_live_cut_or_nothing(self):
        from capture import discover

        t = Transcript()
        t.prompt(0, "go")
        t.calls(5, "m1", [("toolu_1", "Read", {"file_path": "/nonexistent/repo/a.py"})])
        t.result(6, "toolu_1", "x")
        t.say(10, "m2", "Read it.")
        t.write(self.root)
        [tr] = discover.iter_root_transcripts(self.root)
        tz = dt.UTC
        sess = live.current_session(tr, T0 + 60, tz)
        self.assertIsNotNone(sess)
        self.assertEqual(sess.state, "live")
        st = live.live_state(
            sess.events,
            burn.load_turns(tr.path),
            T0 + 60,
            [],
            salt=SALT,
            repo=sess.repo.common_root if sess.repo else None,
            active_seconds=sess.attended + sess.autonomous,
            unattended=sess.presence == 0,
            session_id=sess.client_session_id,
        )
        self.assertEqual(st["activity"]["kind"], "waiting_on_you")
        self.assertEqual(st["eta"]["reason"], "the repository this session runs in could not be resolved")
        self.assertIsNone(live.current_session(tr, T0 + 10 + 7200, tz))

    # -- the producer half (docs/overnight-integration.md 3.1 and 3.2) ---------------------

    def sittings(self, now: float):
        """Two transcripts cut by the capture pipeline at `now`: one finished long ago in a
        real git repository (four meaningful events, so it counts), one still running."""
        import subprocess

        from capture import discover
        from capture import sessions as cap

        repo = self.root / "repo"
        repo.mkdir()
        subprocess.run(["git", "init", "-q", str(repo)], check=True)
        subprocess.run(
            ["git", "-C", str(repo), "remote", "add", "origin", "https://github.com/me/app.git"],
            check=True,
        )
        projects = self.root / "projects"
        old = Transcript(cwd=str(repo))
        old.prompt(0, "fix it")
        for i in range(3):
            old.calls(10 + 10 * i, f"o{i}", [(f"toolu_o{i}", "Read", {"file_path": f"{repo}/a{i}.py"})])
            old.result(11 + 10 * i, f"toolu_o{i}", "x")
        old.say(60, "o9", "Done.")
        old.write(projects, "-old")
        running = Transcript(cwd=str(repo))
        running.prompt(now - T0 - 50, "and now this")
        running.calls(now - T0 - 40, "r1", [("toolu_r1", "Read", {"file_path": f"{repo}/b.py"})])
        running.result(now - T0 - 39, "toolu_r1", "y")
        for r in running.records:
            r["sessionId"] = "8f7c2a4e-0000-4000-8000-000000000002"
        running.write(projects, "-running")
        sources = [cap.load_source(t) for t in discover.iter_root_transcripts(projects)]
        return cap.sessionize_sources(sources, dt.UTC, now=now), repo

    def test_eta_history_is_the_final_counted_sessions_and_nothing_else(self):
        now = T0 + 5 * 86_400
        cut, repo = self.sittings(now)
        self.assertEqual(sorted(s.state for s in cut), ["final", "live"])
        [fact] = live.eta_history(cut)
        old = next(s for s in cut if s.state == "final")
        self.assertEqual(fact.session_id, old.client_session_id)
        self.assertEqual(os.path.realpath(fact.repo), os.path.realpath(repo))
        self.assertEqual(fact.repo, old.repo.common_root)
        self.assertEqual(fact.active_seconds, old.attended + old.autonomous)
        self.assertIs(fact.unattended, old.presence == 0)
        # A sitting below the counted floor is not one the phone shows, so not history.
        import dataclasses as dc

        tiny = dc.replace(old, events=old.events[:1], attended=10.0, autonomous=0.0)
        self.assertEqual(live.eta_history([tiny]), [])

    def test_session_state_is_the_one_computation_the_cli_makes(self):
        """`session_state` is what capture sync, the hook channel and `python -m analysis
        live` all call. Until the CLI calls it too, this pins the two to one answer."""
        from analysis import __main__ as cli
        from capture import discover

        now = T0 + 5 * 86_400
        cut, _ = self.sittings(now)
        live_one = next(s for s in cut if s.state == "live")
        history = live.eta_history(cut)
        st = live.session_state(live_one, now=now, history=history, salt=SALT)
        t = discover.Transcript(project_dir="-running", path=pathlib.Path(live_one.records[0]["path"]))
        self.assertEqual(st, cli._live_entry(t, live_one, history, SALT, now, names=False)["state"])
        self.assertEqual(st["eta"]["code"], "too_few_sessions")
        self.assertEqual(st["eta"]["n"], 1)
        self.assertEqual(st["computed_at"], now)
        self.assertEqual(Wire().spec_errors(live.wire(st)), [])
        # The server's key: history keyed by a hash the paths know nothing about.
        keyed = [dataclasses.replace(f, repo="b" * 64) for f in history]
        by_key = live.session_state(live_one, now=now, history=keyed, salt=SALT, repo_key="b" * 64)
        self.assertEqual((by_key["eta"]["code"], by_key["eta"]["n"]), ("too_few_sessions", 1))
        self.assertEqual(by_key["map"], st["map"])


class FromBytes(unittest.TestCase):
    """`tests/transcripts.py`: each scenario written as a Claude Code transcript and read
    back through the parser, the capture cut and `live.session_state`, the path the hook
    channel and `capture sync --live` take. The in memory twins above work the numbers out
    by hand; these prove the bytes reach the same verdicts."""

    def test_every_scenario_reaches_its_verdict_through_the_parser(self):
        from analysis.tests import transcripts as tr

        for name, build in tr.SCENARIOS.items():
            sc = build()
            st = sc.state()
            self.assertEqual(st["verdict"]["state"], sc.verdict, name)
            self.assertEqual(st["activity"]["kind"], sc.activity, name)
            self.assertIsNotNone(st["sample"]["tokens"], f"{name}: every message carries usage")
            self.assertEqual(Wire().spec_errors(live.wire(st)), [], name)
            self.assertEqual(st["eta"]["code"], "repo_unresolved", name)

    def test_every_scenario_is_one_the_fixture_generator_names(self):
        import importlib.util

        from analysis.tests import transcripts as tr

        spec = importlib.util.spec_from_file_location("gen_live_fixtures", spec_walk.ROOT / "scripts" / "gen_live_fixtures.py")
        gen = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gen)
        self.assertEqual(sorted(gen.SCENARIOS), sorted(tr.SCENARIOS))

    def test_decisions_all_makes_every_decision_and_the_wire_keeps_the_hardest_four(self):
        from analysis.tests import transcripts as tr

        st = tr.decisions_all().state()
        self.assertEqual([d["kind"] for d in st["decisions"]], list(live.DECISION_KINDS[: live.MAX_DECISIONS]))
        saved = live.MAX_DECISIONS
        try:
            live.MAX_DECISIONS = len(live.DECISION_KINDS)
            every = tr.decisions_all().state()
        finally:
            live.MAX_DECISIONS = saved
        self.assertEqual([d["kind"] for d in every["decisions"]], list(live.DECISION_KINDS))

    def test_a_scenario_is_byte_stable(self):
        from analysis.tests import transcripts as tr

        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            one = tr.converging().write(pathlib.Path(a)).read_bytes()
            two = tr.converging().write(pathlib.Path(b)).read_bytes()
        self.assertEqual(one, two)
        self.assertEqual(live.wire(tr.converging().state()), live.wire(tr.converging().state()))


if __name__ == "__main__":
    unittest.main()
