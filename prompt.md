go to builder in projects and paste this in planzz.md: 

# The approved roadmap

Everything on this page was chosen deliberately, and the things at the bottom were
rejected just as deliberately. Read the rejections first: most of what looks obvious in
this product category has already been tried by someone with more money, and the evidence
is in `claude/round2-the-stuck-moment.md` and `claude/round3-the-bad-day-problem.md` in
the Builda project.

The three rules that govern every item below:

1. **A plausible wrong number is worse than a crash.** Every value carries the basis it
   was computed from, the sample it rests on, and a reason when it is absent. Nothing is
   estimated, defaulted or filled in. This is `CLAUDE.md`'s rule and it applies to the UI
   as hard as it applies to the parsers: a chart that draws a zero where the harness wrote
   nothing is the same bug as a wrong number.
2. **No dashes in any string a person reads.** `docs/analysis.md` enforces it three ways.
   New surfaces get a test that enforces it a fourth.
3. **The UI is a feature, not polish.** "It looks vibe coded" is a bug report. If a screen
   cannot be shipped looking finished, it does not ship.

---

## Part 1. What happened after a session ended

The engine already knows this. These are views on data that exists.

### 1.1 Burn forensics — SHIPPED (`analysis/burn.py`, branch `claude/burn-forensics`)

`python -m analysis burn <transcript>` attributes cost to segments (one human prompt to
the next) and names what drove each: subagent fan-out, error loops, repeated calls, file
churn, context replay, compaction, or pure investigation. Every segment carries whether it
produced work, so a spike that wrote nothing is reported as exactly that.

The headline output is the sentence a person actually wants:

> The most expensive stretch cost 433k tokens because it split the work across 9 helper
> agents, and each one re-sends the whole setup before it starts, and nothing was written.

**Still to do:**

- surface `burn_report` on the recap card and the session screen
- a `barren_token_share` rollup in `analysis/profile.py`, so the corpus can say "a fifth
  of your month went into stretches that changed nothing"
- Codex and Gemini adapters for `load_turns`; today it reads Claude Code usage shapes only
  and every other harness falls to the refusal path, which is correct but thin

### 1.2 The money view

Cost in dollars beside cost in tokens, and lines shipped beside both. Green for added, red
for removed, the way a diff reads. Accepted as gimmicky and kept anyway: it is the first
thing a person looks at and it costs nothing to be accurate about.

Constraint: pricing is per model and changes. It lives in one generated file with the date
it was read, or it becomes a plausible wrong number within a quarter.

### 1.3 The five dimensions and the archetype

Already built (`spec/analysis.v1.json`, `analysis/profile.py`). This is the part people
came for, so it gets a real screen rather than a field on a card.

Two corrections to make while touching it:

- **Five of ten `BASELINES` are anchored on Paxel's landing-page example copy**
  (steer_rate 0.4, planning_ratio 2.4, code_velocity 487/h, autonomy 0.82,
  avg_prompt_chars 156). Those are marketing examples, not measurements, and the repo's
  own standard says every constant carries the measurement it came from. Label them the
  way `short_prompt_share` and `tool_diversity` already label themselves, or replace them
  with figures from the reference corpus.
- Paxel's real internal axis names are `execution_leverage`, `steering`,
  `engineering_quality`, `product_thinking`, `planning`, and the first was renamed
  mid-development from "Throughput" specifically to stop rewarding raw velocity. Worth
  knowing, because `code_velocity` is a headline fact here.

### 1.4 The plain-English summary

Every session gets a paragraph a non-technical person can read. Not the analysis. Not the
dimensions. What happened, in the words someone would use out loud.

`analysis/burn.explain()` is the pattern: short sentences, a number in each, and never a
scolding. The worst thing this product can do is tell someone who had a bad afternoon that
they had a bad afternoon.

### 1.5 Vocabulary (the part that makes people feel technical)

Strava never taught anyone to run. It handed casual joggers the language of athletes:
splits, cadence, threshold pace, segments, PRs. Nobody sat through a lesson; the words were
attached to their own runs until they started using them.

Do the same thing.

- **Session titles in engineer voice.** "Debugged a race condition in the checkout flow",
  not "fixed a bug". Derived from the session analysis, which already has a `headline`.
- **Terms unlock by encounter.** Your agent ran a migration, so the word *migration* now
  exists in your glossary with one line of what it means. You earn the vocabulary by
  having it happen to you.
- **A stack page**, the way Strava has a gear list. Postgres, row level security,
  webhooks, worker queues. The things your project is made of, discovered from the
  transcript.
- **A glossary that fills in over months.** A collection mechanic, which is one of the few
  retention mechanisms with evidence behind it (Letterboxd, Untappd).

This also quietly fixes the bad-day problem. "Four hours on a race condition" reads as
engineering. "Got nothing done" does not. Same session.

---

## Part 2. What is happening right now

Everything here needs the live path. Check `Packages/BuilderKit/Sources/BuilderIngest/`
and the hook channel (`docs/hooks-capture.md`) before designing any of it.

**Know what you are competing with.** Anthropic shipped Remote Control (GA August 2026):
the phone answers permission prompts, shows a git diff pane, changes model and effort, and
`claude remote-control --capacity 32 --spawn worktree` runs 32 concurrent sessions with a
device card per machine. Cursor shipped a native iOS app with Live Activities tracking
eight agents. Codex is in the ChatGPT app. **Do not build remote control.** Build the
things those surfaces do not do, which is all analysis.

### 2.1 Mission control

The one live surface worth building. A grid of running sessions, two tiles per row, each
tile showing what that session is doing right now. The mascot sits bottom right. A tile is
a session, not a machine.

The product is not the grid, it is **the order**. With five agents running, the scarce
resource is the person. The tiles sort by who needs you most, and the empty state is the
reward: nothing needs you, go away.

Ranking has to beat a person's own guess or the grid is noise and they go back to terminal
tabs. That is testable against the existing corpus before any UI is drawn.

### 2.2 One sentence, always current

Per tile and per session: what it is doing, in English, updating as it works.

> Rewriting the auth middleware, third attempt.
> Reading your test suite to figure out how sessions get mocked.
> Stuck on the same failing import for six minutes.

For a Cowork user running a 40-minute file job this is the entire product.

### 2.3 Converging, circling, or lost

One verdict per session. The question every person with a running agent has is *is this
going to work*, and nothing answers it today.

Computable from the live stream: error rate trending down with new files entering scope is
converging; same file, same test, same failure is circling; edits to files never read is
lost. The detection logic is the same shape as `analysis/burn.Segment.causes()` and should
share it rather than fork it.

### 2.4 ETA

"22 minutes in. Runs like this on this repo have taken about 40." Built from the corpus of
finished sessions the engine already has. Nobody has put a time remaining on an agent run.

Feasibility is genuinely open. The honest first version refuses to show a number until
there are enough similar finished sessions to build a distribution, and says so.

### 2.5 The decision feed

Agents make real choices and they scroll past at 3am. Surface them as they happen, one
card each, three or four a session rather than three hundred.

> Chose Redis over in-memory caching.
> Abandoned the plan from your prompt and started over.
> Deleted the failing test instead of fixing it.

`decision_patterns` in `spec/analysis.v1.json` is the post-hoc version of this and the
vocabulary already exists. The live version cycles through the activity view.

### 2.6 Live Activity and a home screen widget

The run visible on the lock screen and in the Dynamic Island without opening anything. A
ring that fills, the current sentence under it, the file count ticking. Plus a home screen
widget for the same thing at a glance.

This is the thing people show their friends, so it is also the thing that must not look
vibe coded.

### 2.7 The codebase map

The repo drawn as a shape. Files glow as the agent reads them, go hot as it edits them,
fade as it moves on. Wandering looks like wandering. Circling looks like a tight knot of
three files pulsing.

Strava's best visual is the map of where you ran. This is the map of where the agent went,
and every coordinate is already in the transcript.

### 2.8 Time-lapse

When a session ends, replay it in fifteen seconds. The map lighting up, the knot where it
got stuck, the burst at the end.

This is the shareable artifact, not a stat card. It is also the item most at risk of
looking cheap, so it ships last and only when it looks right.

---

## Part 3. Hard requirements

- **UI quality gates the ship.** Every screen in Part 2 is judged on whether it looks
  designed. A correct screen that looks generated does not ship.
- **No dashes**, enforced by a test on every new user-facing string.
- **The privacy contract does not move.** `privacy/upload-contract.json` stays the only
  definition of what leaves the machine. Anthropic ships this same per-user record to the
  employer with a leaderboard, free with the seat, and withholds it from the person who
  generated it. That asymmetry is the positioning: this record is yours, and it is the
  only one that is.
- **Every number carries its basis.** See `_metric` in `analysis/profile.py` and
  `analysis/burn.py`.

---

## Part 4. Rejected, with the reason

Do not revisit these without new evidence.

| Rejected | Why |
|---|---|
| Leaderboards ranked by spend, kudos-style upvotes | Straude ranked dollars spent and has 48 users on its live leaderboard; Viberank has 1.2k. Raw spend rewards waste. Attended hours is the only bounded quantity worth ranking, and that is already the faction board. |
| A public feed, a global venue, a builder identity layer | r/ClaudeCode grew 1,377% year over year. A new venue offers less distribution than Reddit on day one by definition, and showcasing is a distribution activity. Polywork burned $13M+, Buildspace had 125,000 builders and a16z money. |
| A public gallery of sessions or workflows | Across 39 Show HN posts for Claude Code session tooling, tools to analyse *your own* sessions scored 105 and 144 points; tools to *share* sessions scored 1 to 8 with zero comments, every time. Nine teams built the supply side. |
| Learn-to-code lessons for non-technical builders | Skillsoft, who own Codecademy, told investors "AI is reducing demand for coding-related learning, creating a structural headwind." They laid off the entire Codecademy curriculum team in February 2026. Claude Code already ships Explanatory and Learning output styles free. Vocabulary (1.5) is the version that works. |
| Consecutive-day streaks | Duolingo's streak survives because the floor is a 90 second lesson. Work has no 90 second version and has guaranteed zero days. If a consistency mechanic is wanted, count weeks with N or more sessions, repairable by default. |
| Remote control of a running agent from the phone | Shipped by Anthropic (GA Aug 2026), Cursor (June 2026) and OpenAI (May 2026). Omnara, the best-funded startup in that exact wedge, pivoted out of it within twelve months. Orca is at ~60k GitHub stars, free, MIT, with native iOS and Android. |
| Security as the pitch | Across roughly 4,300 Trustpilot reviews and G2's tagged cons for Lovable, Replit, Bolt and Base44, security appears in zero user complaints. The victims of a vibe-coded breach are the app's end users, not the builder. |
| Proof of work: brag docs, performance reviews, portfolios | Six obligations checked against three bars (weekly cadence, real pain, individual pays). None clears all three. Claude Code already ships per-user PR attribution with a leaderboard to admins, free, and 32% of workers keep their AI use secret from their employer. |
| The daily memory digest / auto work journal | 142 GitHub repos for Claude Code session handoff; the most starred has 50. Thirty Show HN posts for agent memory, median 2 points. Journals work because *writing* them encodes the memory; an auto-generated log removes the encoding and delivers the artifact nobody reads. |

---

## Open items

- The Paxel report screenshot, to match the dimension screen against the real thing.
- The design source mentioned for UI generation, so Part 2 does not get hand-rolled.


and these are burn forensices: 

From 607c35a0cb89f71983fba098a23e3e39d6009b53 Mon Sep 17 00:00:00 2001
From: Claude <noreply@anthropic.com>
Date: Sun, 13 Sep 2026 03:51:07 +0000
Subject: [PATCH 1/2] Burn forensics: where the tokens went, and whether
 anything came of it

`python -m analysis burn <transcript>` attributes cost to SEGMENTS (one human prompt to
the next) and names what drove each one: subagent fan-out, error loops, repeated calls,
file churn, context replay, compaction, or pure investigation. Every segment carries
whether it produced work, so a spike that wrote nothing is reported as exactly that.

Three rules carried from CLAUDE.md, because breaking any produces a plausible wrong
number rather than a crash:

* usage is deduplicated on `message.id` (records repeat the identical usage object;
  summing them inflates 1.878x on the reference corpus)
* root transcripts only, which is also what makes fan-out visible: the parent's Task
  result carries the whole fan-out's aggregate, so cost lands on the turn that spawned it
* a harness that writes no token counts is REFUSED, never zeroed (Cursor's 14,565 rows
  are all {0, 0})

Work attribution asks `analysis.digest` rather than re-deriving it, so heredoc and
`sed -i` writes are credited the same way everywhere ("two counters for one number").

Spikes are refused below 5 segments: with three, the median IS one of the segments.
Cause shares overlap by construction and the field and the printer both say so.

`explain()` renders the report as sentences for a non-technical builder, under the
no-dashes rule from docs/analysis.md, enforced by a test.

19 new tests, 179 total in analysis/, all green.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NvBVXm6qYtH1SHZ4YCdoVU
---
 analysis/__main__.py        |  81 +++++
 analysis/burn.py            | 669 ++++++++++++++++++++++++++++++++++++
 analysis/tests/test_burn.py | 359 +++++++++++++++++++
 3 files changed, 1109 insertions(+)
 create mode 100644 analysis/burn.py
 create mode 100644 analysis/tests/test_burn.py

diff --git a/analysis/__main__.py b/analysis/__main__.py
index 7480c8f..a726ef4 100644
--- a/analysis/__main__.py
+++ b/analysis/__main__.py
@@ -32,6 +32,20 @@ def main() -> int:
     )
     pf.add_argument("path", nargs="?", default="~/.claude/projects")
     pf.add_argument("--facts-only", action="store_true")
+    bn = sub.add_parser(
+        "burn",
+        help="where the tokens went in one transcript, and whether anything came of it",
+    )
+    bn.add_argument("transcript")
+    bn.add_argument("--start")
+    bn.add_argument("--end")
+    bn.add_argument("--json", action="store_true")
+    bn.add_argument(
+        "--spike",
+        type=float,
+        default=None,
+        help="a segment is a spike at this multiple of the median segment cost",
+    )
     pr = sub.add_parser("probe", help="read-only shape report over a file or directory")
     pr.add_argument(
         "path",
@@ -62,6 +76,21 @@ def main() -> int:
         pb.run(pathlib.Path(a.path).expanduser(), as_json=a.json)
         return 0

+    if a.cmd == "burn":
+        from . import burn as bn_mod
+
+        rep = bn_mod.burn_report(
+            pathlib.Path(a.transcript).expanduser(),
+            start=_ts(a.start),
+            end=_ts(a.end),
+            spike_multiple=a.spike or bn_mod.SPIKE_MULTIPLE,
+        )
+        if a.json:
+            print(json.dumps(rep, indent=1, default=str))
+            return 0
+        _print_burn(rep)
+        return 0
+
     path = pathlib.Path(a.transcript).expanduser()
     meta = {"repo": a.repo} if a.repo else {}

@@ -89,6 +118,58 @@ def main() -> int:
     return 0


+def _print_burn(rep: dict) -> None:
+    """The burn report as a person reads it. Numbers first, sentences last."""
+    from . import burn as bn_mod
+
+    t = rep["totals"]
+    print()
+    if not rep["harness_records_usage"]:
+        print("  This harness writes no token counts to disk. Cost cannot be attributed.")
+    else:
+        print(f"  tokens            {t['tokens']['value']:,}")
+        cr = t["cache_read_share"]["value"]
+        if cr is not None:
+            print(f"  context replay    {cr:.0%} of it")
+        tpl = t["tokens_per_line"]["value"]
+        if tpl is not None:
+            print(f"  tokens per line   {tpl:,.0f}")
+        bs = t["barren_token_share"]["value"]
+        if bs is not None:
+            print(f"  spent on nothing  {bs:.0%}")
+    print(f"  lines             +{t['lines_added']['value']} / -{t['lines_removed']['value']}")
+    print(f"  segments          {rep['sample']['segments']}")
+    for m in rep["sample"]["missing"]:
+        print(f"  refused           {m}")
+
+    if rep["causes"]:
+        print()
+        print("  WHERE IT WENT  (a segment can have several causes, so these overlap)")
+        for c in rep["causes"][:6]:
+            share = f"{c['share_of_session']:.0%}" if c.get("share_of_session") is not None else "  ?"
+            print(f"    {share:>5}  {c['cause']:<18} {c['segments']} segment(s)")
+
+    if rep["spikes"]:
+        print()
+        print("  SPIKES")
+        for row in rep["spikes"][:5]:
+            mult = row["multiple_of_median"]
+            flag = "nothing written" if row["barren"] else f"+{row['lines_added']} lines"
+            print(f"\n    {row['tokens']:>9,} tokens  ({mult}x median)  {flag}")
+            if row["prompt"]:
+                print(f"      you asked: {row['prompt'][:88]}")
+            for c in row["causes"][:3]:
+                print(f"      - {c['detail']}")
+
+    sentences = bn_mod.explain(rep)
+    if sentences:
+        print()
+        print("  IN PLAIN TERMS")
+        for line in sentences:
+            print(f"    {line}")
+    print()
+
+
 def _corpus_facts(root: pathlib.Path) -> list:
     """Sessionize a whole `~/.claude/projects` tree and turn each session into facts.

diff --git a/analysis/burn.py b/analysis/burn.py
new file mode 100644
index 0000000..9d9f048
--- /dev/null
+++ b/analysis/burn.py
@@ -0,0 +1,669 @@
+"""Where the tokens went, and whether anything came of it.
+
+`analysis/profile.py` answers "how do you build". This answers the question people
+actually ask out loud: **that session cost a lot, what caused it, and did it produce
+anything?**
+
+The unit is a SEGMENT: the span from one human prompt to the next. A segment is what a
+person remembers ("I asked it to fix the checkout flow and it churned for forty minutes"),
+and it is the only boundary a cost can be honestly attributed to. Within a segment the
+agent's turns are not separable by intent, so this module does not pretend they are.
+
+Three rules carried from CLAUDE.md, because breaking any of them produces a plausible
+wrong number rather than a crash:
+
+1. **Usage is deduplicated on `message.id`.** Claude Code writes one JSONL record per
+   content block and repeats the identical `usage` object on each. Summing records
+   inflates by 1.878x (44,419 records carry usage; 22,887 distinct ids exist). Only the
+   first record for an id is counted.
+
+2. **Root transcripts only, and that is what makes fan-out visible.** Subagent sidecars
+   carry tokens the parent's `Task` tool result already reports in aggregate. Reading the
+   sidecars double counts; reading only the root attributes the whole fan-out to the turn
+   that spawned it, which is exactly where a person wants the blame.
+
+3. **A harness that does not record usage gets a refusal, never a zero.** Cursor writes
+   `{0, 0}` on all 14,565 message rows; usage is accounted server side. Reporting 0
+   tokens would be a claim about the session instead of a fact about Cursor.
+
+Work attribution rides on `analysis.digest`, not on a second parser. The lesson that cost
+an hour (CLAUDE.md, "Two counters for one number"): a session in a shell-first permission
+mode wrote every file with `cat > path <<'EOF'` and made zero Edit/Write calls, so a
+naive edit-tool count read +0 on a session that added 1,300 lines. `digest.load_events`
+already credits heredoc and `sed -i` writes, so this module asks it rather than
+re-deriving.
+
+    python -m analysis burn <transcript.jsonl>
+    python -m analysis burn <transcript.jsonl> --json
+"""
+
+from __future__ import annotations
+
+import collections
+import dataclasses
+import json
+import pathlib
+import re
+import statistics
+from typing import Iterable, Mapping, Sequence
+
+from . import digest
+
+#: A segment is a spike when its cost is at least this multiple of the session's median
+#: segment cost. MEASURED on the container corpus: at 2.0 the top quartile of segments all
+#: qualify and the word stops meaning anything; at 4.0 a session with two bad segments
+#: reports neither, because the median rises to meet them. 3.0 is the value at which the
+#: segments a human would point at are the segments that get flagged.
+SPIKE_MULTIPLE = 3.0
+
+#: A session needs this many segments before "median segment cost" is a number rather than
+#: an accident. Below it, spikes are not reported at all: with three segments the median IS
+#: one of the segments, and every session would report a spike or none depending on parity.
+MIN_SEGMENTS_FOR_SPIKES = 5
+
+#: Tools that dispatch a subagent. The parent's tool RESULT carries the whole fan-out's
+#: aggregated usage, so a `Task` call is both the cause of a spike and the place its cost
+#: lands. Named per harness because a denylist would wave through the next one.
+TASK_TOOLS = frozenset({"Task", "Agent", "dispatch_agent", "subagent", "spawn_agent"})
+
+#: A test run, by the shell text. Deliberately the same list `digest.stats` uses: two
+#: definitions of "ran the tests" is the same bug as a wrong number.
+_TEST_RE = re.compile(
+    r"\b(pytest|bun test|npm test|swift test|jest|cargo test|go test|make test)\b"
+)
+
+
+# --------------------------------------------------------------------------
+# turns: usage, deduplicated
+# --------------------------------------------------------------------------
+
+
+@dataclasses.dataclass
+class Turn:
+    """One assistant message, counted once."""
+
+    ts: float
+    msg_id: str
+    model: str | None
+    input_tokens: int
+    output_tokens: int
+    cache_create: int
+    cache_read: int
+    tools: list[str] = dataclasses.field(default_factory=list)
+
+    @property
+    def total(self) -> int:
+        """Every token the turn moved. Cache reads are cheaper, not free, and they are the
+        thing most people are surprised by, so they are counted and also reported alone."""
+        return self.input_tokens + self.output_tokens + self.cache_create + self.cache_read
+
+    @property
+    def fresh(self) -> int:
+        """Tokens that were not served from cache. The part a long session cannot blame on
+        conversation length alone."""
+        return self.input_tokens + self.output_tokens + self.cache_create
+
+
+def load_turns(path: pathlib.Path) -> list[Turn]:
+    """Assistant turns from one root transcript, usage deduplicated on `message.id`.
+
+    Returns [] when the transcript carries no usage at all; the caller must treat that as
+    absent, not zero (rule 3 in the module docstring).
+    """
+    by_id: dict[str, Turn] = {}
+    order: list[str] = []
+    try:
+        with path.open("rb") as f:
+            for line in f:
+                if not line.endswith(b"\n"):
+                    break  # a partial trailing line is never consumed
+                try:
+                    r = json.loads(line)
+                except json.JSONDecodeError:
+                    continue
+                if (r.get("type") or r.get("role")) != "assistant":
+                    continue
+                ts = digest._ts(r.get("timestamp"))
+                if ts is None:
+                    continue
+                msg = r.get("message") or {}
+                mid = msg.get("id") or r.get("requestId")
+                if not mid:
+                    continue
+                usage = msg.get("usage") or {}
+                if mid not in by_id:
+                    by_id[mid] = Turn(
+                        ts=ts,
+                        msg_id=str(mid),
+                        model=msg.get("model"),
+                        input_tokens=int(usage.get("input_tokens") or 0),
+                        output_tokens=int(usage.get("output_tokens") or 0),
+                        cache_create=int(usage.get("cache_creation_input_tokens") or 0),
+                        cache_read=int(usage.get("cache_read_input_tokens") or 0),
+                    )
+                    order.append(str(mid))
+                # Tool calls ride on every record for the message, not just the first.
+                turn = by_id[str(mid)]
+                for b in msg.get("content") or []:
+                    if isinstance(b, dict) and b.get("type") == "tool_use":
+                        name = b.get("name")
+                        if name:
+                            turn.tools.append(str(name))
+    except OSError:
+        return []
+    turns = [by_id[m] for m in order]
+    turns.sort(key=lambda t: t.ts)
+    return turns
+
+
+def records_usage(turns: Sequence[Turn]) -> bool:
+    """Whether this harness wrote token counts at all. Cursor does not."""
+    return any(t.total > 0 for t in turns)
+
+
+# --------------------------------------------------------------------------
+# segments
+# --------------------------------------------------------------------------
+
+
+@dataclasses.dataclass
+class Segment:
+    """One human prompt and everything the agent did before the next one."""
+
+    index: int
+    start_ts: float
+    end_ts: float
+    prompt: str
+    turns: list[Turn] = dataclasses.field(default_factory=list)
+    events: list[digest.Ev] = dataclasses.field(default_factory=list)
+
+    # ---- cost -------------------------------------------------------------
+    @property
+    def tokens(self) -> int:
+        return sum(t.total for t in self.turns)
+
+    @property
+    def fresh_tokens(self) -> int:
+        return sum(t.fresh for t in self.turns)
+
+    @property
+    def cache_read(self) -> int:
+        return sum(t.cache_read for t in self.turns)
+
+    @property
+    def output_tokens(self) -> int:
+        return sum(t.output_tokens for t in self.turns)
+
+    @property
+    def seconds(self) -> float:
+        return max(0.0, self.end_ts - self.start_ts)
+
+    # ---- work -------------------------------------------------------------
+    @property
+    def lines_added(self) -> int:
+        return sum(e.added or 0 for e in self.events if e.kind == "tool")
+
+    @property
+    def lines_removed(self) -> int:
+        return sum(e.removed or 0 for e in self.events if e.kind == "tool")
+
+    @property
+    def files_touched(self) -> int:
+        return len(
+            {
+                e.path
+                for e in self.events
+                if e.kind == "tool"
+                and e.path
+                and (e.tool in digest.EDIT_TOOLS or e.added is not None)
+            }
+        )
+
+    @property
+    def commits(self) -> int:
+        return sum(
+            1
+            for e in self.events
+            if e.kind == "tool"
+            and (
+                e.tool in digest.COMMIT_TOOLS
+                or (e.tool in digest.SHELL_TOOLS and re.search(r"\bgit commit\b", e.text))
+            )
+        )
+
+    @property
+    def tests_run(self) -> int:
+        return sum(
+            1
+            for e in self.events
+            if e.kind == "tool" and e.tool in digest.SHELL_TOOLS and _TEST_RE.search(e.text)
+        )
+
+    @property
+    def errors(self) -> int:
+        return sum(1 for e in self.events if e.kind == "result_error")
+
+    @property
+    def tool_calls(self) -> int:
+        return sum(1 for e in self.events if e.kind == "tool")
+
+    @property
+    def subagents(self) -> int:
+        return sum(1 for e in self.events if e.kind == "tool" and e.tool in TASK_TOOLS)
+
+    @property
+    def produced_work(self) -> bool:
+        """Did anything durable come out of this segment?
+
+        Deliberately generous: a segment that edited a file counts even if the edit was
+        later reverted, because this module can see the session and not the repository's
+        future. The narrower claim ("and it survived") belongs to whatever watches git,
+        not here. Being generous here means `barren` segments are unambiguous.
+        """
+        return bool(
+            self.lines_added or self.lines_removed or self.files_touched or self.commits
+        )
+
+    @property
+    def barren(self) -> bool:
+        """Spent tokens, changed nothing. The segment people remember as wasted.
+
+        Reading and running tests are not nothing, so a segment that only investigated is
+        barren by this definition but is labelled `investigated` in the cause list rather
+        than accused. The distinction matters: a person who spent 40 minutes reading is
+        not in the same situation as one who spent 40 minutes failing to edit.
+        """
+        return self.tokens > 0 and not self.produced_work
+
+    @property
+    def cost_per_line(self) -> float | None:
+        lines = self.lines_added + self.lines_removed
+        return (self.tokens / lines) if lines else None
+
+    # ---- causes -----------------------------------------------------------
+    def causes(self) -> list[dict]:
+        """Why this segment cost what it did, most explanatory first.
+
+        Every entry carries the count that justifies it. A cause with no number behind it
+        is a guess, and a guess in this file is the failure mode the whole module exists
+        to avoid.
+        """
+        out: list[dict] = []
+
+        if self.subagents:
+            out.append(
+                {
+                    "cause": "subagent_fanout",
+                    "detail": f"{self.subagents} subagent{'s' if self.subagents > 1 else ''} dispatched",
+                    "n": self.subagents,
+                }
+            )
+
+        if self.errors >= 3:
+            out.append(
+                {
+                    "cause": "error_loop",
+                    "detail": f"{self.errors} failing tool results",
+                    "n": self.errors,
+                }
+            )
+
+        repeats = _max_repeat(self.events)
+        if repeats >= 3:
+            out.append(
+                {
+                    "cause": "repeated_call",
+                    "detail": f"the same tool call ran {repeats} times",
+                    "n": repeats,
+                }
+            )
+
+        churn_file, churn_n = _churn(self.events)
+        if churn_n >= 4:
+            out.append(
+                {
+                    "cause": "file_churn",
+                    "detail": f"{pathlib.Path(churn_file).name} rewritten {churn_n} times",
+                    "n": churn_n,
+                }
+            )
+
+        if self.cache_read and self.tokens:
+            share = self.cache_read / self.tokens
+            if share >= 0.7:
+                out.append(
+                    {
+                        "cause": "context_replay",
+                        "detail": f"{share:.0%} of the cost was replaying conversation already in context",
+                        "n": self.cache_read,
+                    }
+                )
+
+        compactions = sum(1 for e in self.events if e.kind == "compaction")
+        if compactions:
+            out.append(
+                {
+                    "cause": "compaction",
+                    "detail": f"context was compacted {compactions} time{'s' if compactions > 1 else ''}",
+                    "n": compactions,
+                }
+            )
+
+        reads = sum(1 for e in self.events if e.kind == "tool" and e.tool in digest.READ_TOOLS)
+        if reads >= 8 and not self.produced_work:
+            out.append(
+                {
+                    "cause": "investigated",
+                    "detail": f"{reads} files read and nothing written",
+                    "n": reads,
+                }
+            )
+
+        return out
+
+
+def _max_repeat(events: Iterable[digest.Ev]) -> int:
+    sigs = collections.Counter(
+        (e.tool, re.sub(r"\s+", " ", e.text).strip()[:200])
+        for e in events
+        if e.kind == "tool"
+    )
+    return max(sigs.values(), default=0)
+
+
+def _churn(events: Iterable[digest.Ev]) -> tuple[str | None, int]:
+    writes = collections.Counter(
+        e.path
+        for e in events
+        if e.kind == "tool" and e.path and (e.tool in digest.EDIT_TOOLS or e.added is not None)
+    )
+    if not writes:
+        return None, 0
+    path, n = writes.most_common(1)[0]
+    return path, n
+
+
+def segments(events: Sequence[digest.Ev], turns: Sequence[Turn]) -> list[Segment]:
+    """Cut the session at human prompts and file every turn and event into one segment.
+
+    Work that arrives before the first typed prompt (a resumed session, a `claude -p`
+    invocation, an autonomous run kicked off elsewhere) belongs to segment 0 with an empty
+    prompt rather than being dropped. Dropping it was the first version's bug: an
+    unattended run reported zero cost because it had no prompts at all.
+    """
+    prompts = [e for e in events if e.kind == "prompt"]
+    bounds: list[tuple[float, str]] = [(events[0].ts if events else 0.0, "")]
+    if prompts:
+        if prompts[0].ts <= bounds[0][0]:
+            bounds = []
+        bounds += [(p.ts, p.text) for p in prompts]
+
+    segs: list[Segment] = []
+    for i, (ts, text) in enumerate(bounds):
+        end = bounds[i + 1][0] if i + 1 < len(bounds) else float("inf")
+        segs.append(Segment(index=i, start_ts=ts, end_ts=ts, prompt=text))
+        for e in events:
+            if ts <= e.ts < end:
+                segs[-1].events.append(e)
+        for t in turns:
+            if ts <= t.ts < end:
+                segs[-1].turns.append(t)
+        last = max(
+            [e.ts for e in segs[-1].events] + [t.ts for t in segs[-1].turns] + [ts]
+        )
+        segs[-1].end_ts = last
+    return [s for s in segs if s.events or s.turns]
+
+
+# --------------------------------------------------------------------------
+# report
+# --------------------------------------------------------------------------
+
+
+def _metric(value, unit: str, n: int, basis: str, reason: str | None = None, **extra) -> dict:
+    """Same shape `analysis/profile.py` uses: a value never travels without its basis, its
+    sample, and the reason it is missing when it is."""
+    d = {"value": value, "unit": unit, "n": n, "basis": basis}
+    if reason:
+        d["reason"] = reason
+    d.update(extra)
+    return d
+
+
+def _round(x, digits: int):
+    return None if x is None else round(x, digits)
+
+
+def burn_report(
+    path: pathlib.Path,
+    *,
+    start: float | None = None,
+    end: float | None = None,
+    spike_multiple: float = SPIKE_MULTIPLE,
+) -> dict:
+    """Everything this module can honestly say about one transcript's cost."""
+    events = digest.load_events(path, start, end)
+    turns = load_turns(path)
+
+    if not events:
+        return {
+            "harness_records_usage": False,
+            "sample": {"segments": 0, "missing": ["the transcript held no readable events"]},
+            "totals": {},
+            "segments": [],
+            "spikes": [],
+            "barren": [],
+        }
+
+    has_usage = records_usage(turns)
+    segs = segments(events, turns)
+    missing: list[str] = []
+
+    if not has_usage:
+        missing.append(
+            "this harness does not write token counts to disk, so cost cannot be attributed"
+        )
+
+    total_tokens = sum(s.tokens for s in segs)
+    total_added = sum(s.lines_added for s in segs)
+    total_removed = sum(s.lines_removed for s in segs)
+    total_cache = sum(s.cache_read for s in segs)
+
+    # ---- spikes -----------------------------------------------------------
+    spikes: list[dict] = []
+    costs = [s.tokens for s in segs if s.tokens > 0]
+    median_cost = statistics.median(costs) if costs else 0
+    if not has_usage:
+        pass  # refused above
+    elif len(segs) < MIN_SEGMENTS_FOR_SPIKES:
+        missing.append(
+            f"fewer than {MIN_SEGMENTS_FOR_SPIKES} segments, so a median segment cost would "
+            "be an accident rather than a baseline"
+        )
+    else:
+        for s in segs:
+            if median_cost and s.tokens >= median_cost * spike_multiple:
+                spikes.append(_segment_row(s, median_cost))
+        spikes.sort(key=lambda r: -r["tokens"])
+
+    # ---- barren spend -----------------------------------------------------
+    barren = [_segment_row(s, median_cost) for s in segs if has_usage and s.barren]
+    barren.sort(key=lambda r: -r["tokens"])
+    barren_tokens = sum(r["tokens"] for r in barren)
+
+    # ---- cause rollup -----------------------------------------------------
+    by_cause: dict[str, dict] = {}
+    for s in segs:
+        for c in s.causes():
+            row = by_cause.setdefault(
+                c["cause"], {"cause": c["cause"], "segments": 0, "tokens": 0}
+            )
+            row["segments"] += 1
+            row["tokens"] += s.tokens
+    # A segment can carry several causes, so these shares OVERLAP and do not sum to 1.
+    # The field is named for what it is; the printer says so too.
+    causes = sorted(by_cause.values(), key=lambda r: -r["tokens"])
+    for c in causes:
+        c["share_of_session"] = _round(c["tokens"] / total_tokens, 3) if total_tokens else None
+
+    return {
+        "harness_records_usage": has_usage,
+        "sample": {
+            "segments": len(segs),
+            "turns": len(turns),
+            "events": len(events),
+            "missing": missing,
+        },
+        "totals": {
+            "tokens": _metric(
+                total_tokens if has_usage else None,
+                "tokens",
+                len(turns),
+                "assistant messages, deduplicated on message.id",
+                None if has_usage else "this harness writes no token counts",
+            ),
+            "cache_read_share": _metric(
+                _round(total_cache / total_tokens, 3) if has_usage and total_tokens else None,
+                "fraction",
+                len(turns),
+                "cache_read_input_tokens over all counted tokens",
+                None if has_usage and total_tokens else "no token counts to divide",
+            ),
+            "lines_added": _metric(
+                total_added,
+                "lines",
+                len(events),
+                "edit-tool deltas plus credited shell writes (heredoc, sed -i)",
+            ),
+            "lines_removed": _metric(
+                total_removed,
+                "lines",
+                len(events),
+                "edit-tool deltas plus credited shell writes",
+            ),
+            "tokens_per_line": _metric(
+                _round(total_tokens / (total_added + total_removed), 1)
+                if has_usage and (total_added + total_removed)
+                else None,
+                "tokens/line",
+                len(segs),
+                "counted tokens over lines changed",
+                None
+                if has_usage and (total_added + total_removed)
+                else "no lines changed, or no token counts",
+            ),
+            "barren_token_share": _metric(
+                _round(barren_tokens / total_tokens, 3) if has_usage and total_tokens else None,
+                "fraction",
+                len(barren),
+                "tokens in segments that changed nothing, over all counted tokens",
+                None if has_usage and total_tokens else "no token counts to divide",
+            ),
+        },
+        "causes": causes,
+        "spikes": spikes,
+        "barren": barren,
+        "segments": [_segment_row(s, median_cost) for s in segs],
+        "median_segment_tokens": median_cost if has_usage else None,
+    }
+
+
+def _segment_row(s: Segment, median_cost: float) -> dict:
+    return {
+        "index": s.index,
+        "started_at": s.start_ts,
+        "seconds": _round(s.seconds, 1),
+        "prompt": s.prompt[:160],
+        "tokens": s.tokens,
+        "output_tokens": s.output_tokens,
+        "cache_read": s.cache_read,
+        "multiple_of_median": _round(s.tokens / median_cost, 1) if median_cost else None,
+        "tool_calls": s.tool_calls,
+        "errors": s.errors,
+        "subagents": s.subagents,
+        "lines_added": s.lines_added,
+        "lines_removed": s.lines_removed,
+        "files_touched": s.files_touched,
+        "commits": s.commits,
+        "tests_run": s.tests_run,
+        "produced_work": s.produced_work,
+        "barren": s.barren,
+        "cost_per_line": _round(s.cost_per_line, 1),
+        "causes": s.causes(),
+    }
+
+
+# --------------------------------------------------------------------------
+# plain language
+# --------------------------------------------------------------------------
+
+#: One sentence per cause, written for someone who has never read a stack trace. The rule
+#: from docs/analysis.md holds here: no dashes in any string a person reads.
+_CAUSE_SENTENCES = {
+    "subagent_fanout": "it split the work across {n} helper agents, and each one re-sends the whole setup before it starts",
+    "error_loop": "it hit {n} errors in a row and kept retrying",
+    "repeated_call": "it ran the same command {n} times without the result changing",
+    "file_churn": "it rewrote the same file {n} times",
+    "context_replay": "most of the cost was re-reading the conversation so far, which grows every turn",
+    "compaction": "the conversation got too long and had to be summarised, which costs a turn of its own",
+    "investigated": "it read {n} files and did not change anything, so this was research rather than building",
+}
+
+
+def explain(report: Mapping) -> list[str]:
+    """The report as sentences a non-technical builder can act on.
+
+    Deliberately short and deliberately not a scolding: the worst thing this module could
+    do is tell someone who had a bad afternoon that they had a bad afternoon. Where a
+    segment spent a lot and produced nothing, the sentence says what it was doing, not
+    that it failed.
+    """
+    lines: list[str] = []
+    if not report.get("harness_records_usage"):
+        return ["This tool does not record token counts on your machine, so cost cannot be shown."]
+
+    total = report["totals"]["tokens"]["value"] or 0
+    added = report["totals"]["lines_added"]["value"] or 0
+    removed = report["totals"]["lines_removed"]["value"] or 0
+    lines.append(
+        f"This session used {_human(total)} tokens and changed {added} lines "
+        f"(and removed {removed})."
+    )
+
+    share = report["totals"]["cache_read_share"]["value"]
+    if share is not None and share >= 0.7:
+        lines.append(
+            f"{share:.0%} of that was the conversation re-reading itself, which is normal "
+            "in a long session and is the main reason cost climbs the longer you go."
+        )
+
+    barren_share = report["totals"]["barren_token_share"]["value"]
+    if barren_share is not None and barren_share >= 0.2:
+        lines.append(
+            f"About {barren_share:.0%} went into stretches where nothing was written. "
+            "That is not always wasted, but it is where to look first."
+        )
+
+    for row in report.get("spikes", [])[:3]:
+        causes = row.get("causes") or []
+        if not causes:
+            continue
+        c = causes[0]
+        sentence = _CAUSE_SENTENCES.get(c["cause"])
+        if not sentence:
+            continue
+        what = sentence.format(n=c.get("n"))
+        cost = _human(row["tokens"])
+        verdict = "and nothing was written" if row["barren"] else f"and wrote {row['lines_added']} lines"
+        lines.append(f"The most expensive stretch cost {cost} tokens because {what}, {verdict}.")
+        break
+
+    return lines
+
+
+def _human(n: int) -> str:
+    if n >= 1_000_000:
+        return f"{n / 1_000_000:.1f}M"
+    if n >= 1_000:
+        return f"{n / 1_000:.0f}k"
+    return str(n)
diff --git a/analysis/tests/test_burn.py b/analysis/tests/test_burn.py
new file mode 100644
index 0000000..0937b0f
--- /dev/null
+++ b/analysis/tests/test_burn.py
@@ -0,0 +1,359 @@
+"""Burn forensics: the dedup rule, the refusals, and the attribution of a spike.
+
+Every case is one a person could recompute by hand from the records in the test. The
+three that matter most are the ones that protect against a plausible wrong number:
+
+* usage repeated across a message's content blocks must be counted ONCE (1.878x is the
+  measured inflation if it is not),
+* a harness that writes no token counts must be refused, never reported as zero,
+* a session with too few segments must refuse to name a spike rather than let the median
+  be one of the three segments it is comparing against.
+"""
+
+from __future__ import annotations
+
+import datetime as dt
+import json
+import pathlib
+import tempfile
+import unittest
+
+from analysis import burn
+from analysis.digest import Ev
+
+#: 2026-09-01 09:00:00 UTC. Every timestamp below is an offset from it.
+T0 = dt.datetime(2026, 9, 1, 9, 0, tzinfo=dt.UTC)
+
+
+def iso(offset_s: float) -> str:
+    return (T0 + dt.timedelta(seconds=offset_s)).isoformat().replace("+00:00", "Z")
+
+
+def user_prompt(offset_s: float, text: str) -> dict:
+    return {
+        "type": "user",
+        "timestamp": iso(offset_s),
+        "message": {"role": "user", "content": [{"type": "text", "text": text}]},
+        "promptSource": "typed",
+    }
+
+
+def assistant(
+    offset_s: float,
+    mid: str,
+    *,
+    usage: dict | None = None,
+    blocks: list | None = None,
+    model: str = "claude-opus-5",
+) -> dict:
+    return {
+        "type": "assistant",
+        "timestamp": iso(offset_s),
+        "message": {
+            "role": "assistant",
+            "id": mid,
+            "model": model,
+            "usage": usage or {},
+            "content": blocks or [{"type": "text", "text": "ok"}],
+        },
+    }
+
+
+def tool_use(tid: str, name: str, inp: dict) -> dict:
+    return {"type": "tool_use", "id": tid, "name": name, "input": inp}
+
+
+def tool_result(offset_s: float, tid: str, content: str, is_error: bool = False) -> dict:
+    return {
+        "type": "user",
+        "timestamp": iso(offset_s),
+        "message": {
+            "role": "user",
+            "content": [
+                {
+                    "type": "tool_result",
+                    "tool_use_id": tid,
+                    "content": content,
+                    "is_error": is_error,
+                }
+            ],
+        },
+    }
+
+
+def write_transcript(records: list[dict]) -> pathlib.Path:
+    fd = tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False)
+    for r in records:
+        fd.write(json.dumps(r) + "\n")
+    fd.close()
+    return pathlib.Path(fd.name)
+
+
+USAGE = {
+    "input_tokens": 1000,
+    "output_tokens": 200,
+    "cache_creation_input_tokens": 50,
+    "cache_read_input_tokens": 8000,
+}
+
+
+class UsageDeduplication(unittest.TestCase):
+    """Claude Code repeats the identical `usage` object on every content-block record for
+    one message. Summing records inflates by 1.878x on the reference corpus."""
+
+    def test_one_message_written_as_three_records_is_counted_once(self):
+        path = write_transcript(
+            [
+                user_prompt(0, "go"),
+                assistant(1, "msg_a", usage=USAGE, blocks=[{"type": "text", "text": "one"}]),
+                assistant(
+                    1, "msg_a", usage=USAGE, blocks=[tool_use("t1", "Read", {"file_path": "/a.py"})]
+                ),
+                assistant(
+                    1, "msg_a", usage=USAGE, blocks=[tool_use("t2", "Read", {"file_path": "/b.py"})]
+                ),
+            ]
+        )
+        turns = burn.load_turns(path)
+        self.assertEqual(len(turns), 1)
+        self.assertEqual(turns[0].total, 1000 + 200 + 50 + 8000)
+
+    def test_tool_calls_from_every_record_of_the_message_are_kept(self):
+        """Usage is deduplicated; the tool calls are not. They are different records of one
+        message and each carries a distinct call."""
+        path = write_transcript(
+            [
+                user_prompt(0, "go"),
+                assistant(1, "msg_a", usage=USAGE, blocks=[tool_use("t1", "Read", {})]),
+                assistant(1, "msg_a", usage=USAGE, blocks=[tool_use("t2", "Task", {})]),
+            ]
+        )
+        turns = burn.load_turns(path)
+        self.assertEqual(len(turns), 1)
+        self.assertEqual(sorted(turns[0].tools), ["Read", "Task"])
+
+    def test_distinct_message_ids_are_summed(self):
+        path = write_transcript(
+            [
+                user_prompt(0, "go"),
+                assistant(1, "msg_a", usage=USAGE),
+                assistant(2, "msg_b", usage=USAGE),
+            ]
+        )
+        turns = burn.load_turns(path)
+        self.assertEqual(len(turns), 2)
+        self.assertEqual(sum(t.total for t in turns), 2 * (1000 + 200 + 50 + 8000))
+
+
+class Refusals(unittest.TestCase):
+    """A number that is absent must say so. Reporting zero would be a claim about the
+    session instead of a fact about the harness."""
+
+    def test_a_harness_with_no_token_counts_is_refused_not_zeroed(self):
+        """Cursor writes {0, 0} on all 14,565 message rows; usage is accounted server side."""
+        path = write_transcript(
+            [
+                user_prompt(0, "go"),
+                assistant(1, "msg_a", usage={"input_tokens": 0, "output_tokens": 0}),
+                assistant(2, "msg_b", usage={"input_tokens": 0, "output_tokens": 0}),
+            ]
+        )
+        rep = burn.burn_report(path)
+        self.assertFalse(rep["harness_records_usage"])
+        self.assertIsNone(rep["totals"]["tokens"]["value"])
+        self.assertIn("reason", rep["totals"]["tokens"])
+        self.assertTrue(any("token counts" in m for m in rep["sample"]["missing"]))
+
+    def test_too_few_segments_refuses_to_name_a_spike(self):
+        """With three segments the median IS one of them, so every session would report a
+        spike or none depending on parity."""
+        recs = [user_prompt(0, "first")]
+        for i in range(3):
+            recs.append(user_prompt(i * 10 + 1, f"prompt {i}"))
+            recs.append(assistant(i * 10 + 2, f"m{i}", usage=USAGE))
+        path = write_transcript(recs)
+        rep = burn.burn_report(path)
+        self.assertEqual(rep["spikes"], [])
+        self.assertTrue(any("fewer than" in m for m in rep["sample"]["missing"]))
+
+    def test_tokens_per_line_refuses_when_no_lines_changed(self):
+        path = write_transcript(
+            [user_prompt(0, "just look around"), assistant(1, "m0", usage=USAGE)]
+        )
+        rep = burn.burn_report(path)
+        self.assertIsNone(rep["totals"]["tokens_per_line"]["value"])
+        self.assertIn("reason", rep["totals"]["tokens_per_line"])
+
+
+class Segmentation(unittest.TestCase):
+    def test_work_before_the_first_prompt_is_not_dropped(self):
+        """A resumed session, a `claude -p` run or an autonomous kickoff has agent work
+        before any typed prompt. The first version dropped it and reported zero cost on
+        every unattended run."""
+        path = write_transcript(
+            [
+                assistant(0, "m0", usage=USAGE),
+                assistant(5, "m1", usage=USAGE),
+            ]
+        )
+        rep = burn.burn_report(path)
+        self.assertGreaterEqual(rep["sample"]["segments"], 1)
+        self.assertEqual(rep["totals"]["tokens"]["value"], 2 * (1000 + 200 + 50 + 8000))
+
+    def test_each_prompt_opens_a_segment(self):
+        recs = []
+        for i in range(4):
+            recs.append(user_prompt(i * 100, f"task {i}"))
+            recs.append(assistant(i * 100 + 1, f"m{i}", usage=USAGE))
+        path = write_transcript(recs)
+        rep = burn.burn_report(path)
+        self.assertEqual(rep["sample"]["segments"], 4)
+        self.assertEqual(rep["segments"][2]["prompt"], "task 2")
+
+
+class SpikesAndCauses(unittest.TestCase):
+    def _corpus(self, *, heavy_usage: dict, heavy_blocks: list, heavy_extra=()) -> dict:
+        """Six cheap segments and one expensive one, so the median is well defined."""
+        cheap = {
+            "input_tokens": 100,
+            "output_tokens": 20,
+            "cache_creation_input_tokens": 0,
+            "cache_read_input_tokens": 100,
+        }
+        recs: list[dict] = []
+        for i in range(6):
+            recs.append(user_prompt(i * 100, f"small task {i}"))
+            recs.append(assistant(i * 100 + 1, f"c{i}", usage=cheap))
+        recs.append(user_prompt(1000, "the expensive one"))
+        recs.append(assistant(1001, "heavy", usage=heavy_usage, blocks=heavy_blocks))
+        recs.extend(heavy_extra)
+        return burn.burn_report(write_transcript(recs))
+
+    def test_a_subagent_fanout_is_named_as_the_cause(self):
+        rep = self._corpus(
+            heavy_usage={
+                "input_tokens": 200_000,
+                "output_tokens": 5_000,
+                "cache_creation_input_tokens": 0,
+                "cache_read_input_tokens": 0,
+            },
+            heavy_blocks=[tool_use(f"t{i}", "Task", {"prompt": "go"}) for i in range(7)],
+        )
+        self.assertTrue(rep["spikes"], "the expensive segment should be a spike")
+        top = rep["spikes"][0]
+        self.assertEqual(top["subagents"], 7)
+        self.assertEqual(top["causes"][0]["cause"], "subagent_fanout")
+        self.assertEqual(top["causes"][0]["n"], 7)
+
+    def test_a_spike_that_wrote_nothing_is_marked_barren(self):
+        rep = self._corpus(
+            heavy_usage={
+                "input_tokens": 200_000,
+                "output_tokens": 5_000,
+                "cache_creation_input_tokens": 0,
+                "cache_read_input_tokens": 0,
+            },
+            heavy_blocks=[tool_use("t0", "Task", {"prompt": "go"})],
+        )
+        top = rep["spikes"][0]
+        self.assertTrue(top["barren"])
+        self.assertFalse(top["produced_work"])
+        self.assertGreater(rep["totals"]["barren_token_share"]["value"], 0.5)
+
+    def test_context_replay_is_named_when_most_of_the_cost_is_cache_reads(self):
+        rep = self._corpus(
+            heavy_usage={
+                "input_tokens": 1_000,
+                "output_tokens": 500,
+                "cache_creation_input_tokens": 0,
+                "cache_read_input_tokens": 300_000,
+            },
+            heavy_blocks=[{"type": "text", "text": "thinking about it"}],
+        )
+        top = rep["spikes"][0]
+        kinds = [c["cause"] for c in top["causes"]]
+        self.assertIn("context_replay", kinds)
+
+    def test_an_error_loop_is_named(self):
+        extra = [tool_result(1002 + i, f"e{i}", "Error: ENOENT no such file", True) for i in range(4)]
+        rep = self._corpus(
+            heavy_usage={
+                "input_tokens": 200_000,
+                "output_tokens": 5_000,
+                "cache_creation_input_tokens": 0,
+                "cache_read_input_tokens": 0,
+            },
+            heavy_blocks=[tool_use(f"e{i}", "Bash", {"command": "npm test"}) for i in range(4)],
+            heavy_extra=extra,
+        )
+        top = rep["spikes"][0]
+        kinds = [c["cause"] for c in top["causes"]]
+        self.assertIn("error_loop", kinds)
+        self.assertIn("repeated_call", kinds)
+
+
+class PlainLanguage(unittest.TestCase):
+    """docs/analysis.md: no dashes in any string a person reads. The rule is absolute."""
+
+    def test_no_dashes_in_any_sentence(self):
+        for template in burn._CAUSE_SENTENCES.values():
+            self.assertNotIn("—", template)
+            self.assertNotIn("–", template)
+
+    def test_a_refused_harness_says_so_in_one_sentence(self):
+        path = write_transcript(
+            [user_prompt(0, "go"), assistant(1, "m", usage={"input_tokens": 0})]
+        )
+        lines = burn.explain(burn.burn_report(path))
+        self.assertEqual(len(lines), 1)
+        self.assertIn("does not record token counts", lines[0])
+
+    def test_the_summary_names_tokens_and_lines(self):
+        path = write_transcript(
+            [
+                user_prompt(0, "go"),
+                assistant(1, "m", usage=USAGE),
+            ]
+        )
+        lines = burn.explain(burn.burn_report(path))
+        self.assertTrue(any("tokens" in line and "lines" in line for line in lines))
+
+    def test_every_sentence_is_free_of_dashes_on_a_real_report(self):
+        recs = []
+        for i in range(6):
+            recs.append(user_prompt(i * 100, f"task {i}"))
+            recs.append(assistant(i * 100 + 1, f"m{i}", usage=USAGE))
+        path = write_transcript(recs)
+        for line in burn.explain(burn.burn_report(path)):
+            self.assertNotIn("—", line)
+            self.assertNotIn("–", line)
+
+
+class EmptyAndBroken(unittest.TestCase):
+    def test_an_empty_transcript_does_not_raise(self):
+        path = write_transcript([])
+        rep = burn.burn_report(path)
+        self.assertEqual(rep["sample"]["segments"], 0)
+
+    def test_a_partial_trailing_line_is_never_consumed(self):
+        """Transcripts are appended to while being read; the last line is routinely half
+        written."""
+        fd = tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False)
+        fd.write(json.dumps(user_prompt(0, "go")) + "\n")
+        fd.write(json.dumps(assistant(1, "m0", usage=USAGE)) + "\n")
+        fd.write('{"type": "assistant", "message": {"id": "m1", "usa')  # no newline
+        fd.close()
+        turns = burn.load_turns(pathlib.Path(fd.name))
+        self.assertEqual(len(turns), 1)
+
+    def test_a_malformed_line_in_the_middle_is_skipped(self):
+        fd = tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False)
+        fd.write(json.dumps(user_prompt(0, "go")) + "\n")
+        fd.write("{not json at all\n")
+        fd.write(json.dumps(assistant(1, "m0", usage=USAGE)) + "\n")
+        fd.close()
+        self.assertEqual(len(burn.load_turns(pathlib.Path(fd.name))), 1)
+
+
+if __name__ == "__main__":
+    unittest.main()
--
2.43.0



buidl on top of what we already have. paste both fo theose docs in aserparet ifles in proj and keep refencing htem

use these for desings na dushc: https://github.com/Meliwat/awesome-ios-design-md.git

and go thur all of htese repsos afor all deisngs and suhc: https://github.com/Appllama gethwatevr u an for freeuse thigns ike reat bits here an dlocne this and hte other 2 (go arodun th llama app thing tp get all the repos) and clone them to replciate hte UI and these ddeisng. https://github.com/DavidHDev/react-bits.git


Yeah. It's pretty important that you don't just use regular guy generate slot for UI. Every single thing, the widgets, the the live activities, the dynamic Allen stuff, the icons. Also, icons are very complicated right now. Make them simpler. Like, the Claude icon literally freak out where it's a orange and black thing. So make all the icons the same thing, the same picker thing. Like, revamp the entire onboarding flow kind of where you pick your name. Like, it's smooth and use all of the UI libraries I just gave you to actually, like, create it. And same for analysis. Right? Again, right now, we're just focusing analysis. I don't need social stuff right now, but, like, just keep working. I really ironed it out. I want you to keep working for Atelier quota, right, till you literally headquarter. If we bypass five hour limit, then we get five more quota, keep working. So I know you you you you keep keep quitting so early. I know you can do better. Like, I genuine genuinely believe in you to do better. So I need you to keep working until you hit quota multiple times. And if you hit a one time, wait how how much longer necessary for a quarter reset, keep working. Alright? I'll see you in around ten hours, I believe. So Let's keep working on that. Use all the UI libraries. I want literally zero of your normal AI slot where you use, like, gradients or where you have, like, um, some background and then the border of one color and the and the letter version and the same color of the background. Basically, phrase which AI stop looks like and do all that. And once you've let everything ask, you want to make the analysis page, the biggest lever I wanna see is, first of all, implement live activities, implement all the features sent you, and make sure you you create them and implement them well and clean. You know? Like, they get none of these AI slots to actually make it look good, and then run on the simulator and Expo. And they get pictures of everything. A lot of activity, dynamic island, identifications, how the ETA looks, how, you know, how you're making the the mission control thing look exactly how I ask it to. Like, again, put a lot of thought into this and keep working. Literally keep working on this project until you hit quota and once you hit quota, see how much time you have left. Right? Or do do this preemptively preemptively before you actually hit quota. Um, so you know, you can see, like, you know, every hour or thirty minutes, whatever, to see how much longer the quota, how much the time limit is for power limit, once we go to store that number and then wait how much time, I then check again. And as soon as you get that quota back, keep working. Right? I know you won't finish. And if you somehow do finish all this stuff, when you wake up, do a slash loop thing slash loop hyphen not hyphen slash loop and keep iterating because I know you probably have a really shitty version initially. And if you do five runs minimum... five test runs and once you get these screenshots, make it a lot artifact. I wanna wake up to an artifact that will every single feature map and every single thing works and use my Claude code sessions on this repo and on the right GTP repo ride GT. Repo in product directory has, like, tests for this analysis. Right? k. Now I know that my thing, um, for all the live analysis stuff too, I want you to test it on this on this exact current thing. Right? So you're building, and you're also testing on how it will work on a live session on this actual live session, a little bit of meta thinking for you. So do that and take screenshots of that as well. Of literally every feature you build. And, again, if you function all this, you didn't. So redo everything again so you actually... no. Redo will, like, verify it off code audits, review audits, check your code code reviews, and then make sure AI UI is actually good. You... I wanna see every single user app pitch thing you use, every single lumbar thing you use, every single, um, whatever the third thing essentially you then used. Um, not everything thing, obviously, but you know what I mean? Like, like, actually pretty highly popular with that, but also not just lob. You know, I wanna look actually good. Do research on good UI and, like, like, on really dynamic stuff. Like, there's just one really good cryptocurrency app called Phantom. I love the UI. So really a lot of expression on that, but don't copy obviously. I'm I'm giving a good example of it. But, yeah, don't just create your own UI. Really, most probably use it from those libraries that gave you. Yeah. And I don't know that. Yeah. Make a deliverable, patent, artifact, whatever, and that allows you to choose in it and keep working. Again, like, ten hours of red work. That's at least two sessions, three to three sessions, honestly, of of token resets and stuff. So I expect you to burn through all of that and talk heat persist even after a five hour thing. Thanks. Um, I'm not even gonna bet now. So do I ask you questions or anything like that? Just keep working, and you should be good. Good night. Yeah.

---

## Everything after it, in order

1. Also, store this entire prompt in an LFA. Like, not just copy and paste this stuff, but everything's an afterwards too. Like, sort enough NFA to do so we can, like, refer to it pretty easily.

2. i expect u to intergtate with the existing stuff an work there is to uncaes twe are missing features. and integrate all of these paxel prompts too [Image #8] do reserahc in case i mixed stuff

   (Image #8 was a screenshot of fifteen Paxel cards: "Which kind of builder are you? Generalist. No single working pattern dominates, you adapt your approach to the task" / "How much did you ship? 229,367 lines. Across 1,000 commits and PRs worked." / "How do you work with your agent? A back and forth. You work in dialogue, shaping the work as you go." / "Your longest single session? 16h 0m. Your deepest uninterrupted stretch with an agent." / "How many agents do you run? 3 at once. As many as 3 main sessions running at the same time." / "What's your go to prompt? "<50 words". You sent it 5 times across sessions." / "What's your longest streak? 29 days straight. Consecutive days you shipped something." / "How often do you change course? 6% of the time. You stop and redirect the agent mid task rather than letting it run." / "Your biggest crash out? [an angry all caps prompt]. We've all been there." / "How long are your prompts? 108 words on average. Mostly conversational prompts." / "How do you work? 46 deep sessions. Averaging 205 minutes of uninterrupted focus." / "How much time did you put in? 129 hours. Across 55 sessions." / "Your most cryptic prompt? [a 10 character code, which turned out to be your Apple Team ID, removed here]. Somehow the agent knew exactly what you meant." / "How much do you talk to your agent? 31 prompts a session." / "What kind of work is it? Mostly fixes. 84 fixes and 78 features in your commits." Each card had an orange dithered halftone illustration on top, three window dots and a dashed border.)

3. (/effort ultracode) Again keep working until you hit quote. And then keep checking periodically until tokens refresh and start working again. Literally don't stop. Even if u think u finished keep iterating on the UI and then on ur own ideas to flesh it out

4. Use more of the UI and react bite stuff I gave you bruh you haven't used ANYTHIG yet. Also why are all of the ost the same color? Looks fucking horrible. Make it look beautiful clean dynamic animated

5. All so what is $2951 in api usage?? I don't actually have to pay that right??

6. also where is all of the other naalysis? i just see the basic Wrappe shit right now. make the nalaysis page look cool. with dynamic numbers liek when u open it i want it to like go from 0 to tha tnumber niamatedly so its likedynamic. and any visuals u create should be like niamted drawn on. absoltelu no AI UI

7. baisc ai ui

8. show new screenshots on artifact

9. is the design on the ism rn? i dont see anythign new

10. Ok good

11. also rename everythign to Builda not builder

12. is design done?

13. why are ther 2 sims open rn

14. [Image #9] look sprertty ai generated[Image #10] love this style qualtiy guadedina, the naimation and stuff is aawesome./Users/vedantbhatt/Downloads/opencode.svg /Users/vedantbhatt/Downloads/cline.svg /Users/vedantbhatt/Downloads/cursor.svg /Users/vedantbhatt/Downloads/gemini-color.svg /Users/vedantbhatt/Downloads/codex-color.svg /Users/vedantbhatt/Downloads/claude-color.svg

    use thiese icons for each option.

    (Image #9: the old Money page, a list of rounded dark cards. Image #10: the analysis page's rose "Your type, Quality guardian" chapter.)

15. dud eu cant have these plain AI generated shit here. [Image #11] liek cmon this looks os fuckign ugly and broign adn what even is the them eof this app? this ugly fuckign orange? im so confused. like this UI is some edick shit bruh

    (Image #11: the old You tab, boxed rows with chevrons and amber highlights.)

16. use all th esoruces i gave u and do better

17. also make sure ur cinomerneatlly ocmmtign and ushing to github

18. scrolled past ehte profiel card [Image #12]

    (Image #12: a Reanimated red screen, "Tried to synchronously call a non-worklet function exitMs on the UI thread", TiltedCard.tsx.)

19. [Image #13] ts also some ass. have a proejts section too where users can keep track of hteir behavrios for eahc project. rn i think its lie for their overall profiel or per session but i want  abeakdwon of their proejct stats too. this way we shoudl be abele to get more insghts other htan just htese nalaysis. brainsotmr and think waht we can get out of project-level statisticis and naalytics. how they buidlin eah project, what their most worked on ones are, etc. also yea revmap the tech stack oage too. also did u quit the simulator?

    (Image #13: the old Your stack page, a boxed list of languages and frameworks.)

20. this is so fuckign cool. [Image #14] what othe types of visualizaions can we make? <200 words

    (Image #14: the new stack page's "what you build with most" logo bubble cloud.)

21. take screenshots of everything rn and upload to artifact so i can see very feature

22. are proejcts done or not. also copy and paste the prompt i gave u including everything

23. alr bro i get the design of the like the blocks fo color and how u aniamte it and shi t but ur jsut throwing it everyhwere now it lost its c harm.w hata re you gonna od to fix this? <50 words

24. also simualtor loses frames when we scroll donw analysis with th enaimaion. <50 words dont fuckign code anythign to change th eUI. im asking ot brainstrom retard

25. RUN ON EXPO SO I CAN TEST ON IPHONE

26. Hello? / Why isn't the app working on my iPhone / I'm on a diff wifi I'm on data rn can u make it work / Use a tunnel or something figure it out / Ok cool it works.

27. Can u make a graph showing token usage in a session. I'm confused on how 99% is spent reading the cache.

28. Can u get rid of the Dynamic Island thing I have rn for the current session? I swiped out of the app

29. status what u work on

30. Keep working and build this Yeah. So build the tool build the tool that allows people to put in a get up and are, like, automatically reverse whatever project they're working on and get, like, screenshots and make a demo of it. There are some open source tools. I think they already do this, so do extensive research with GitHub, Reddit, um, LinkedIn, Next, Threads, whatever. Like, so repo clip or something. It makes demos or, like, at least with very minimum get screenshots too. So get screenshots and a demo video. Um, of all the work you've done on the actual other project, And, you know, for every project, it should be it should be attached with a demo or some screenshots. That way, you can populate the views. They look nice too. Like, I like how you made the box so far. Like, things using separate way. Maybe have, like, a stack of pictures, not that they shouldn't at all screen up and screenshots, but, like, on the side somewhere in good click expense. See all them? Like, again, experiment with all React bits and all URL libraries you had access to before and integrate screenshots and demo videos that way. Maybe demo videos like play in the back and neck and neck as, like, a, you know, it's some cool way where you can start playing automatically. Like, just make this flush out a lot. Eruditus UI make and make sure it doesn't look AI at all, like, same design principles. You use React Native. I like how you use Diether effect a lot and, like, pixelated stuff, and they look super nice. Keep applying that. Make it look even less AI and keep working. No stop. And and don't stop. And make this feature. Again, look at open source implementations first. Find the best ones. Use those and and implement it here.

    (Read as: put in a GitHub repo, automatically RUN the project, get screenshots and a demo video; every project in Builda carries its demo or screenshots; a stack of pictures beside the content that expands on a tap to see them all; demo videos autoplay in the background; react-bits and the dither and pixel look; research open source first.)

31. Dude the demo shouldn't just be a screen recording it should be like an actual cool demo video but don't worry about that just focus on screenshots how is that development? Show me screenshots of that rn

32. ok dont worry abotu screenrercodings or any video demos just screenshots for now. the proejcts page should show a lsit of prooejcts.
