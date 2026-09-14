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
