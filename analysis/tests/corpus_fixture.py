"""A corpus built in memory: parallel `SessionFact` and `SessionEvents` lists, one `Sitting`
at a time, through `profile.session_fact_from_events` (the builder `analysis/corpus.py`
uses), so a fixture can never drift from the code that reads it and the real corpus stays
out of git (docs/overnight-engine.md 6).

Sentinel words are planted in prompts (`zebracorn`), paths (`zebrapath`) and commit subjects
(`zebrasubject`) so a privacy split can be checked by searching for them.

Two readers: the wrapped tests (`test_wrapped.py`, which re-exports everything here), and
`scripts/gen_copy.py`, which renders the scenarios below into
`spec/fixtures/wrapped/cards.json` so the phone's port of every card sentence is pinned to
Python's. `scenarios()` is that list: one corpus that answers all fifteen cards, and the
corpora that reach every refusal code at least once.
"""

from __future__ import annotations

import dataclasses
import datetime as dt

from analysis import agents as ag
from analysis import contributions as co
from analysis import patterns as pat
from analysis import profile as pf
from analysis.digest import Ev

#: 2026-09-01 15:00 UTC, a Tuesday afternoon: local day 2026-09-01 at offset 0, and nowhere
#: near the night window, so no fixture here leans night owl by accident.
T0 = dt.datetime(2026, 9, 1, 15, 0, tzinfo=dt.UTC).timestamp()
DAY = 86400.0
D0 = dt.date(2026, 9, 1)

SENTINELS = ("zebracorn", "zebrapath", "zebrasubject")


def day(k: int) -> dt.date:
    return D0 + dt.timedelta(days=k)


# ------------------------------------------------------------------ the corpus builder
class Sitting:
    """One synthetic session: events at offsets from its start, and its two clocks."""

    def __init__(
        self,
        sid: str,
        start: float = T0,
        *,
        attended: float = 1800.0,
        autonomous: float = 0.0,
        unattended: bool = False,
        tz: int = 0,
        end: float | None = None,
    ):
        self.sid = sid
        self.start = start
        self.attended = attended
        self.autonomous = autonomous
        self.unattended = unattended
        self.tz = tz
        self.end = end
        self.events: list[Ev] = []

    def _add(self, offset: float, kind: str, text: str = "", **kw) -> Sitting:
        self.events.append(Ev(0, self.start + offset, kind, text, **kw))
        return self

    def prompt(self, offset: float, text: str) -> Sitting:
        return self._add(offset, "prompt", text)

    def tool(self, offset: float, text: str = "ls", tool: str = "Bash", **kw) -> Sitting:
        return self._add(offset, "tool", text, tool=tool, **kw)

    def edit(self, offset: float, path: str, added: int, tool: str = "Edit") -> Sitting:
        return self._add(offset, "tool", "", tool=tool, path=path, added=added, removed=0)

    def error(self, offset: float, text: str = "Error: boom") -> Sitting:
        return self._add(offset, "result_error", text, ok=False)

    def interrupt(self, offset: float) -> Sitting:
        return self._add(offset, "interrupt")

    def build(self) -> tuple[pf.SessionFact, pat.SessionEvents]:
        ordered = sorted(self.events, key=lambda e: e.ts)
        evs = [dataclasses.replace(e, n=i) for i, e in enumerate(ordered)]
        ended = self.end
        if ended is None:
            ended = max(
                self.start + self.attended + self.autonomous, evs[-1].ts if evs else self.start
            )
        fact = pf.session_fact_from_events(
            session_id=self.sid,
            events=evs,
            started_at=self.start,
            ended_at=ended,
            attended_seconds=self.attended,
            autonomous_seconds=self.autonomous,
            tz_offset_minutes=self.tz,
            unattended=self.unattended,
        )
        sess = pat.SessionEvents(
            session_id=self.sid,
            started_at=self.start,
            ended_at=ended,
            active_seconds=self.attended + self.autonomous,
            attended_seconds=self.attended,
            tz_offset_minutes=self.tz,
            events=evs,
        )
        return fact, sess


def corpus(*sittings: Sitting) -> tuple[list[pf.SessionFact], list[pat.SessionEvents]]:
    pairs = [s.build() for s in sittings]
    return [f for f, _ in pairs], [s for _, s in pairs]


def contributions_on(days: dict[dt.date, tuple[int, int]]) -> co.Contributions:
    """A commit graph: {day: (assisted, alone)}."""
    rows = tuple(co.Day(day=d, assisted=a, alone=b) for d, (a, b) in sorted(days.items()))
    return co.Contributions(
        days=rows,
        assisted=sum(r.assisted for r in rows),
        alone=sum(r.alone for r in rows),
        active_days=len(rows),
        longest_streak=0,
        current_streak=0,
    )


def fan(max_concurrent: int, agents: int) -> ag.Fanout:
    return ag.Fanout(
        agents=agents,
        max_concurrent=max_concurrent,
        agent_seconds=0.0,
        wall_seconds=0.0,
        busy_seconds=0.0,
        by_type={},
        spans=(),
    )


def attended_trio(prompts: tuple[int, int, int] = (2, 2, 2), attended=(1800.0, 1800.0, 1800.0)):
    """Three attended sittings a day apart, each with `k` plain prompts and a tool after each."""
    out = []
    for i, (k, secs) in enumerate(zip(prompts, attended, strict=True)):
        s = Sitting(f"t{i}", T0 + i * DAY, attended=secs)
        for j in range(k):
            s.prompt(10 * j, f"add step {j} to the page").tool(10 * j + 5, "ls")
        out.append(s)
    return out


# ------------------------------------------------------------------ the rich corpus
#: Twelve fixes and nine features among 35 subjects: 21 labelled, exactly 60%.
RICH_SUBJECTS = (
    ["fix: zebrasubject crash"] * 12
    + ["feat: add zebrasubject"] * 9
    + ["Zebrasubject tidy up notes"] * 14
)
RICH_COMMITS = {day(0): (2, 1), day(1): (1, 0), day(3): (0, 2)}


def rich() -> list[Sitting]:
    """Four sittings a day apart, three attended, where every card answers.

    Hand counts, used throughout:
      lines   A 120 + 40 + 60, B 30 + 20, C 15 = 285 (source 225, test 40, docs 20)
      clocks  active 4500 + 1800 + 3600 + 7200 = 17100 s (4.75 h), autonomous 10200 s,
              attended 3900 + 1800 + 1200 = 6900 s (1.9 h)
      prompts 9 with text (A 5, B 2, C 2), 8 quotable (C's `/compact` is a slash command)
      tools   A 9, B 3, C 2, D 2 = 16; the attended A, B and C hold 14, so 1.6 tool
              calls a prompt over the sessions the prompt card counts
    """
    a = (
        Sitting("a", T0, attended=3900.0, autonomous=600.0)
        .prompt(0, "run zebracorn tests")
        .edit(10, "/repo/zebrapath/app.py", 120)
        .tool(20, "pytest -q")
        .edit(30, "/repo/tests/test_app.py", 40, tool="Write")
        .tool(40, "git commit -m wip")
        .prompt(60, "WHAT THE FUCK zebracorn is still broken???")
        .tool(70, "", tool="Read", path="/repo/zebrapath/app.py")
        .interrupt(80)
        .prompt(90, "no, use the other file")
        .edit(100, "/repo/zebrapath/util.py", 60)
        .prompt(200, "zebracorn qwrtzsdfgh")
        .tool(210, "ls")
        .tool(220, "ls -la")
        .tool(230, "cat notes")
        .prompt(300, "looks good, thanks")
    )
    b = (
        Sitting("b", T0 + DAY, attended=1800.0)
        .prompt(0, "Run zebracorn tests!")
        .edit(10, "/repo/zebrapath/app.py", 30)
        .tool(20, "pytest")
        .prompt(100, "please add a docs page for the zebracorn feature and explain it well")
        .edit(110, "/repo/docs/guide.md", 20, tool="Write")
    )
    c = (
        Sitting("c", T0 + 2 * DAY, attended=1200.0, autonomous=2400.0)
        .prompt(0, "run zebracorn tests")
        .edit(10, "/repo/zebrapath/app.py", 15)
        .tool(20, "pytest")
        .prompt(100, "/compact")
    )
    d = (
        Sitting("d", T0 + 3 * DAY, attended=0.0, autonomous=7200.0, unattended=True)
        .tool(0, "ls")
        .tool(7000, "ls")
    )
    return [a, b, c, d]


def rich_kw(**over) -> dict:
    kw = {
        "contributions": contributions_on(RICH_COMMITS),
        "commit_subjects": RICH_SUBJECTS,
    }
    kw.update(over)
    return kw


# ------------------------------------------------------------------ the scenarios
@dataclasses.dataclass(frozen=True)
class Scenario:
    """One corpus and everything `wrapped.wrapped` is given beside it."""

    name: str
    facts: list[pf.SessionFact]
    sessions: list[pat.SessionEvents]
    kw: dict


def _scenario(name: str, sittings, **kw) -> Scenario:
    facts, sessions = corpus(*sittings)
    return Scenario(name, facts, sessions, kw)


def _unique_trio(k: int = 2, attended: float = 1800.0) -> list[Sitting]:
    """Three attended sittings whose prompts are all different (no go to prompt forms) and
    all longer than a cryptic candidate, so a scenario adds the short prompts it wants."""
    out = []
    for i in range(3):
        s = Sitting(f"u{i}", T0 + i * DAY, attended=attended)
        for j in range(k):
            s.prompt(
                10 * j,
                f"in sitting {i}, please take step {j} of the plan and add the next part of "
                "the settings page carefully",
            ).tool(10 * j + 5, "ls")
        out.append(s)
    return out


def scenarios() -> list[Scenario]:
    """The corpora behind `spec/fixtures/wrapped/cards.json`: every card answered at least
    once and every refusal code reached at least once (the cryptic refusal in all three of
    its forms, the kind of work refusal behind each commit label code), each built from
    sittings a person could have had. `analysis/tests/test_report_blocks.py` holds the
    coverage to that, so a new card or code without a scenario fails there."""
    no_text = []
    for i in range(3):
        s = Sitting(f"x{i}", T0 + i * DAY)
        for j in range(2):
            s.prompt(10 * j, "").tool(10 * j + 5, "ls")
        no_text.append(s)
    server_shaped = [
        dataclasses.replace(f, lines_basis=pf.LINES_ABSENT, write_events=None)
        for f in corpus(*_unique_trio())[0]
    ]
    # Short prompts with two words of four characters or more (`wrapped.CRYPTIC_MIN_TOKEN_CHARS`),
    # so each is a cryptic candidate and the card refuses by the mash rule, one and many.
    one_short = _unique_trio()
    one_short[0].prompt(40, "fix this button")
    two_short = _unique_trio()
    two_short[0].prompt(40, "fix this button")
    two_short[1].prompt(40, "ship this now")
    # Lines enough for the file role fallback (source 150, tests 60), commit subjects that
    # are prose, commit days that never meet a sitting (no streak yet), and one sitting
    # past an hour.
    by_role = _unique_trio()
    by_role[0].edit(30, "/repo/app/main.py", 150).edit(35, "/repo/tests/test_main.py", 60)
    by_role[1].attended = 4000.0
    return [
        _scenario(
            "rich: every card answered, quotes on",
            rich(),
            quotes=True,
            fanout=fan(3, 9),
            **rich_kw(),
        ),
        _scenario("nothing at all", []),
        _scenario("two sittings", attended_trio()[:2]),
        _scenario(
            "three sittings too short for any archetype metric",
            [Sitting(f"q{i}", T0 + i * DAY, attended=60.0) for i in range(3)],
        ),
        _scenario("three plain sittings", _unique_trio(), contributions=None),
        Scenario(
            "a server shaped corpus with no line counts",
            server_shaped,
            corpus(*_unique_trio())[1],
            {},
        ),
        _scenario(
            "only unattended runs, one with no events",
            [
                Sitting("r0", T0, attended=0.0, autonomous=1800.0, unattended=True).tool(0),
                Sitting("r1", T0 + DAY, attended=0.0, autonomous=1800.0, unattended=True),
            ],
        ),
        _scenario(
            "sittings that recorded no event",
            [Sitting(f"e{i}", T0 + i * DAY) for i in range(3)],
        ),
        _scenario("prompts that carry no text", no_text),
        _scenario("one short prompt", one_short),
        _scenario("two short prompts", two_short),
        _scenario(
            "commit subjects too few to label",
            _unique_trio(),
            commit_subjects=["fix: the button"] * 5 + ["tidy the notes"] * 5,
        ),
        _scenario(
            "commit subjects mostly unlabelled",
            _unique_trio(),
            commit_subjects=["fix: the button"] * 20 + ["tidy the notes"] * 30,
        ),
        _scenario(
            "lines by file role, prose commit subjects, no streak yet",
            by_role,
            commit_subjects=["tidy the notes"] * 12,
            contributions=contributions_on({day(10): (0, 2), day(12): (0, 1)}),
        ),
    ]


def rich_corpus(**over):
    """`rich()` as a whole `corpus.Corpus`, with everything the report's blocks read beside
    the events: the ledger's five token buckets and the model on every fact, burn split into
    barren, unreadable and the causes that claimed the barren part, the commit graph and
    subjects, a subagent fan out, and one manifest name that is a sentinel (a dependency
    string never leaves the machine). The clock is ten days after the first sitting."""
    from analysis import corpus as cp
    from analysis import pricing

    facts, sessions = corpus(*rich())
    filled = []
    for i, f in enumerate(facts):
        k = i + 1
        burn_tokens = 60_000 * k
        filled.append(
            dataclasses.replace(
                f,
                tokens=pricing.Tokens(
                    input=1_000 * k, output=2_000 * k, cache_read=50_000 * k, cache_w5m=0,
                    cache_w1h=7_000 * k,
                ),  # fmt: skip
                output_tokens_by_model={"claude-opus-5": 2_000 * k},
                commit_basis=pf.COMMITS_GIT_LOG,
                commit_count=1 if i % 2 == 0 else 0,
                burn_tokens=burn_tokens,
                barren_tokens=6_000 * k,
                unreadable_tokens=3_000 * k,
                barren_causes={"context_replay": (5_000 * k, 1), "investigated": (500 * k, 1)},
            )
        )
    kw = {
        "facts": filled,
        "sessions": sessions,
        "kept": [],
        "roots": [None] * len(filled),
        "fanout": fan(3, 9),
        "contributions": contributions_on(RICH_COMMITS),
        "commit_subjects": list(RICH_SUBJECTS),
        "dependencies": ["react", "zebrapath-kit"],
        "now": T0 + 10 * DAY,
        "tz": dt.UTC,
    }
    kw.update(over)
    return cp.Corpus(**kw)


__all__ = [
    "D0",
    "DAY",
    "RICH_COMMITS",
    "RICH_SUBJECTS",
    "SENTINELS",
    "Scenario",
    "Sitting",
    "T0",
    "attended_trio",
    "contributions_on",
    "corpus",
    "day",
    "fan",
    "rich",
    "rich_corpus",
    "rich_kw",
    "scenarios",
]
