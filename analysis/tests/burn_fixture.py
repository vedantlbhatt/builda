"""Sessions shaped like real ones, built in memory, for the burn summary's parity fixture.

`scripts/gen_copy.py` runs `burn.session_report` over each scenario below and writes the
upload's `burn` block (`burn.session_wire`) beside the sentences `burn.explain` says about
the same report into `spec/fixtures/burn/session.json`, so the phone's port of the plain
English session summary (`mobile/src/copy/burn.ts explainBurn`) is pinned to Python the way
strip conformance is: one set of numbers, two languages, the same words.

No transcript is checked in (docs/overnight-engine.md 6): every scenario is events and turns
built here. Each is modelled on a shape MEASURED on the real corpus or on the live
transcript (docs/overnight-engine.md 5.1 and "Deviations (fixes)"), and a few are there only
because they are where a port goes wrong: a share at a half (0.125 is "13%": a tie rounds UP,
`plain.half_up`, where Python's `:.0%` said 12%), a token count at a half (`12.5k` is "13k"),
a share under 1% and one over 99%, and every verdict and refusal the summary can say.
"""

from __future__ import annotations

import dataclasses
import datetime as dt

from analysis import burn
from analysis.digest import Ev

#: 2026-09-01 15:00 UTC, the wrapped fixtures' clock.
T0 = dt.datetime(2026, 9, 1, 15, 0, tzinfo=dt.UTC).timestamp()


@dataclasses.dataclass
class Burnable:
    """One session: events and turns at offsets from `T0`, and the harness that wrote it."""

    name: str
    harness: str = "claude_code"
    events: list = dataclasses.field(default_factory=list)
    turns: list = dataclasses.field(default_factory=list)
    _calls: int = 0

    def _ev(self, at: float, kind: str, text: str = "", **kw) -> Burnable:
        self.events.append(Ev(len(self.events), T0 + at, kind, text, **kw))
        return self

    def prompt(self, at: float, text: str = "keep going") -> Burnable:
        return self._ev(at, "prompt", text)

    def say(self, at: float, text: str = "Done.") -> Burnable:
        return self._ev(at, "assistant", text)

    def turn(self, at: float, *, fresh: int = 0, cache: int = 0, out: int = 0, calls=()) -> Burnable:
        """One assistant message: `fresh` input tokens, `cache` read from cache, `out`
        written, and the ids of the calls it issued."""
        self.turns.append(
            burn.Turn(
                ts=T0 + at,
                msg_id=f"{self.name}:{at}",
                model="claude-opus-5",
                input_tokens=fresh,
                output_tokens=out,
                cache_create=0,
                cache_read=cache,
                tools=[],
                tool_ids=list(calls),
            )
        )
        return self

    def call(self, at: float, tool: str, text: str = "", **kw) -> str:
        """A tool call; returns its id so a turn can claim it."""
        self._calls += 1
        tid = f"c{self._calls}"
        self._ev(at, "tool", text, tool=tool, tool_id=tid, **kw)
        return tid

    def fail(self, at: float, tid: str, text: str = "Error: exit 1") -> Burnable:
        return self._ev(at, "result_error", text, ok=False, tool_id=tid)

    def compaction(self, at: float) -> Burnable:
        return self._ev(at, "compaction", "summary")

    def report(self) -> dict:
        return burn.session_report(self.events, self.turns, harness=self.harness)


def _quiet_stretch(s: Burnable, at: float, *, fresh: int, cache: int, path: str, added: int) -> None:
    """A stretch that asked for a change and made it: one edit, one turn."""
    s.prompt(at, "make the next change")
    tid = s.call(at + 5, "Edit", path, path=path, added=added, removed=0)
    s.turn(at + 4, fresh=fresh, cache=cache, calls=[tid])
    s.say(at + 10)


def scenarios() -> list[Burnable]:
    out: list[Burnable] = []

    # The live transcript's shape (docs/overnight-engine.md 5.1): a 9.1M token stretch that
    # handed work to four helper agents and hit four failing calls, where 93% of the tokens
    # were the conversation re-reading itself. The summary must blame the re-reading.
    s = Burnable("replay")
    for i in range(6):
        _quiet_stretch(s, 100 * i, fresh=40_000, cache=210_000, path=f"/repo/src/m{i}.py", added=12)
    s.prompt(700, "wire the helpers in")
    helpers = [s.call(705 + i, "Task", "explore the api") for i in range(4)]
    for tid in helpers:
        s.fail(720, tid, "Error: agent timed out")
    tid = s.call(730, "Edit", "/repo/src/wire.py", path="/repo/src/wire.py", added=120, removed=8)
    s.turn(704, fresh=180_000, cache=2_900_000, calls=helpers)
    s.turn(725, fresh=250_000, cache=2_900_000)
    s.turn(729, fresh=207_000, cache=2_663_000, calls=[tid])
    s.say(740)
    out.append(s)

    # A stretch that only read twelve files: barren, labelled investigated, never accused.
    s = Burnable("reading")
    for i in range(5):
        _quiet_stretch(s, 100 * i, fresh=20_000, cache=30_000, path=f"/repo/app/v{i}.ts", added=20)
    s.prompt(600, "how does the auth flow work")
    reads = [s.call(601 + i, "Read", f"/repo/auth/f{i}.ts", path=f"/repo/auth/f{i}.ts") for i in range(12)]
    s.turn(600.5, fresh=300_000, cache=120_000, calls=reads[:6])
    s.turn(607, fresh=260_000, cache=100_000, calls=reads[6:])
    s.say(620, "It checks the session cookie first.")
    out.append(s)

    # The same shell command four times, then the fix.
    s = Burnable("repeat")
    for i in range(5):
        _quiet_stretch(s, 100 * i, fresh=15_000, cache=20_000, path=f"/repo/lib/r{i}.py", added=8)
    s.prompt(600, "the tests are flaky, find out why")
    runs = [s.call(601 + 10 * i, "Bash", "pytest -x tests/test_sync.py") for i in range(4)]
    fix = s.call(645, "Edit", "/repo/lib/sync.py", path="/repo/lib/sync.py", added=30, removed=4)
    for i, tid in enumerate(runs):
        s.turn(600.5 + 10 * i, fresh=90_000, cache=40_000, calls=[tid])
    s.turn(644, fresh=30_000, cache=40_000, calls=[fix])
    s.say(650)
    out.append(s)

    # One file edited again and again: `repeated_call` on an Edit is "editing the same
    # file", never "running the same command" (MEASURED: 38 of 41 corpus repeats).
    s = Burnable("churn")
    for i in range(5):
        _quiet_stretch(s, 100 * i, fresh=18_000, cache=25_000, path=f"/repo/ui/c{i}.tsx", added=15)
    s.prompt(600, "the button is still off by a pixel")
    edits = [
        s.call(601 + 10 * i, "Edit", "/repo/ui/Button.tsx", path="/repo/ui/Button.tsx", added=2, removed=2)
        for i in range(4)
    ]
    for i, tid in enumerate(edits):
        s.turn(600.5 + 10 * i, fresh=70_000, cache=30_000, calls=[tid])
    s.say(650)
    out.append(s)

    # A script rewrote files the digest cannot see: unreadable, never "nothing was written".
    s = Burnable("script")
    for i in range(5):
        s.prompt(100 * i, "look at the logs")
        tid = s.call(100 * i + 5, "Bash", "grep -n error server.log")
        s.turn(100 * i + 4, fresh=12_000, cache=8_000, calls=[tid])
        s.say(100 * i + 10)
    s.prompt(600, "rename the flag everywhere")
    tid = s.call(605, "Bash", "python3 - <<'PY' ⏎ import pathlib")
    s.turn(604, fresh=400_000, cache=90_000, calls=[tid])
    s.say(620)
    out.append(s)

    # One helper agent, and a share of the stretch under 1%: the turn that dispatched it
    # was cheap next to the turns that wrote.
    s = Burnable("one_helper")
    for i in range(5):
        _quiet_stretch(s, 100 * i, fresh=10_000, cache=10_000, path=f"/repo/api/h{i}.go", added=6)
    s.prompt(600, "add the export endpoint")
    helper = s.call(601, "Agent", "write the handler")
    write = s.call(640, "Write", "/repo/api/export.go", path="/repo/api/export.go", added=64, removed=0)
    s.turn(600.5, fresh=2_000, cache=0, calls=[helper])
    s.turn(639, fresh=420_000, out=60_000, cache=0, calls=[write])
    s.say(650)
    out.append(s)

    # Three stretches: too few for a median, so no stretch is called a spike. Over 99% of
    # the tokens were cache reads.
    s = Burnable("short")
    for i in range(3):
        _quiet_stretch(s, 100 * i, fresh=1_000, cache=399_000, path=f"/repo/n{i}.md", added=4)
    out.append(s)

    # Only lines removed; a `sed -i` that names a file and no count; only a commit. Each
    # verdict and work clause the summary can say without a line it does not have.
    s = Burnable("removed")
    for i in range(5):
        s.prompt(100 * i, "trim the dead code")
        tid = s.call(100 * i + 5, "Edit", f"/repo/old{i}.py", path=f"/repo/old{i}.py", added=0, removed=8)
        s.turn(100 * i + 4, fresh=10_000 + 1_000 * i, cache=5_000, calls=[tid])
    s.prompt(600, "and the big one")
    tid = s.call(605, "Edit", "/repo/legacy.py", path="/repo/legacy.py", added=0, removed=120)
    s.turn(604, fresh=160_000, cache=5_000, calls=[tid])
    out.append(s)

    s = Burnable("sed")
    for i in range(5):
        s.prompt(100 * i, "bump the version")
        tid = s.call(100 * i + 5, "Bash", f"sed -i 's/1.{i}/1.{i + 1}/' pyproject.toml", path="pyproject.toml")
        s.turn(100 * i + 4, fresh=8_000, cache=4_000, calls=[tid])
    s.prompt(600, "and the lockfile")
    tid = s.call(605, "Bash", "sed -i 's/old/new/' uv.lock", path="uv.lock")
    s.turn(604, fresh=90_000, cache=4_000, calls=[tid])
    out.append(s)

    s = Burnable("commit")
    for i in range(5):
        s.prompt(100 * i, "what changed")
        tid = s.call(100 * i + 5, "Bash", "git status")
        s.turn(100 * i + 4, fresh=9_000, cache=3_000, calls=[tid])
        s.say(100 * i + 8, "Two files.")
    s.prompt(600, "commit it")
    tid = s.call(605, "Bash", "git commit -m 'ship the export'")
    s.turn(604, fresh=70_000, cache=3_000, calls=[tid])
    out.append(s)

    # The rounding traps: 12,500 tokens is "13k" and a barren share of exactly 0.125 is "13%"
    # (a tie rounds UP, `plain.half_up`; Python's own `round` and `:.0%` said 12k and 12%).
    s = Burnable("halves")
    s.prompt(0, "write the note")
    tid = s.call(5, "Write", "/repo/NOTE.md", path="/repo/NOTE.md", added=3, removed=0)
    s.turn(4, fresh=10_937, calls=[tid])
    s.prompt(100, "what do you think")
    s.turn(104, fresh=1_563)
    s.say(110, "Looks fine.")
    out.append(s)

    # A context compaction in a stretch of 999,500 tokens, which is "1.0M" and never "1000k".
    s = Burnable("million")
    for i in range(5):
        _quiet_stretch(s, 100 * i, fresh=20_000, cache=0, path=f"/repo/k{i}.rs", added=10)
    s.prompt(600, "keep going with the parser")
    s.compaction(601)
    tid = s.call(610, "Edit", "/repo/parser.rs", path="/repo/parser.rs", added=90, removed=10)
    s.turn(602, fresh=899_500, calls=[])
    s.turn(609, fresh=100_000, calls=[tid])
    out.append(s)

    # A share at a half that is printed: 10,000 of 16,000 tokens in a stretch that wrote
    # nothing is 0.625, which is 63% on every surface (a tie rounds UP, `plain.half_up`).
    s = Burnable("half_share")
    s.prompt(0, "add the flag")
    tid = s.call(5, "Edit", "/repo/flags.py", path="/repo/flags.py", added=2, removed=0)
    s.turn(4, fresh=6_000, calls=[tid])
    s.prompt(100, "is that the right default")
    s.turn(104, fresh=10_000)
    s.say(110, "Yes.")
    out.append(s)

    # The refusals: counts not recorded; a tool burn does not read yet; nothing to read.
    s = Burnable("no_counts")
    s.prompt(0, "go")
    s.call(5, "Bash", "ls")
    s.turn(4)
    out.append(s)

    s = Burnable("not_read_yet", harness="cline")
    s.prompt(0, "go")
    s.call(5, "Bash", "ls")
    out.append(s)

    out.append(Burnable("empty"))
    return out


__all__ = ["Burnable", "T0", "scenarios"]
