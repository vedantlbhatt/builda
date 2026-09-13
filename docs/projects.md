# Projects: the report, asked of one repository at a time

`CLAUDE.md` overrides this page. The owner, 2026-09-13: "have a projects section too where users can keep track of their behaviours for each
project. Right now it's for their overall profile or per session, but I want a breakdown of their project stats too". This page is the brainstorm,
the metric list, the wire, the server and the phone's contract for it. The engine is `analysis/projects.py`; the phone's screens are another agent's,
built from section 6.

MEASURED 2026-09-13 on `~/.builder-overnight/corpus` (57 root transcripts, 160 counted final sittings, two repositories: RideGT, whose origin is
`gt-transit`, and builder) and on `~/.claude/projects` (359 sittings, 13 repositories) where a threshold needed a wider sample.

## 0. The rules this block holds, and the one decision behind all of them

**A project's blocks are the report's blocks over a smaller cut.** `corpus.repository(cut, key)` narrows a cut to the sittings of one repository, as
`corpus.window(cut, days)` narrows it to a window, and the project's numbers are then the SAME functions the report calls: `profile.corpus_profile`,
`wrapped.wrapped`, `report_blocks.money_block`, `burn_block`, `stack_block`, `quality.summary`, `languages.split`, `vocab.stack`, `trends.compare`.
`analysis/tests/test_projects.py OneFunctionEach` holds it as an equivalence, not a docstring: project A's money, burn, stack, cards, commit graph,
quality, languages and agents over a cut holding A and B are exactly the report's own blocks over a cut holding only A. Only three rules are new,
because they have no corpus twin: the lifecycle stage, the comparisons across projects, and the cost of a commit.

1. **Two scopes, never mixed.** Every project carries `history` (every sitting the machine holds in that repository, however old) and `window` (the
   report's `window_days`, cut by `corpus.window`, null when the project had no sitting in it). The block repeats `window_days` and says how far
   history reaches (`history_first_at`). A screen says which scope a number is: the stage, the streak and "last session" are history; the time, the
   cards, the money and the comparisons are the window.
2. **A project is its key.** `corpus.repo_key`: the repository's salted hash (`RepoIdentity.hash`, HMAC under the global pepper), the full 64 hex
   `repo_hash` every session upload already carries. The door types it `Sha256Hex`, so no name can pass where a key goes. A private repository's name
   never leaves the machine; the server adds a PUBLIC repository's name beside the key from the `repos` row every session reads its `repo_name` from.
3. **Numbers, ids, enums and clocks only.** No string field anywhere in the block (`test_report.py test_the_v2_blocks_carry_only_enums_numbers_and_clocks`
   now walks it: 33 objects). Every refusal is an enum code with `n` and `needed`; the phone words it from `generated/copy.ts`.
4. **Absent is not zero.** No commit read is `commits: null`, not an empty graph; a project with nothing in the window is `window: null`, not a block
   of zeroes; a comparison two projects cannot support is refused with a code, never a ratio over nothing.
5. **Every threshold is measured or labelled** (section 2). **No dash** in any template: `plain.has_dash` in the module's tests, in `gen_copy.py`,
   and in the phone's tests.

## 1. Brainstorm: what the engine can honestly say about a project

What the data holds per sitting: two clocks (attended, autonomous), the digest's events (prompts with text, interrupts, tool calls, writes with line
counts, shell commands cut at 160 characters, errors), the ledger's five token buckets and the model mix, `git log` over every local branch of the
repository's common root, burn segments and their causes, subagent sidecars, the manifests. What a project is: every sitting whose dominant `cwd`
resolved to one repository identity (worktrees fold into the common root; `--git-common-dir`, CLAUDE.md).

| question the owner asked | what answers it | what it cannot say |
|---|---|---|
| what are my most worked on projects | rank by attended time in the window, `share_of_attended`, history hours | time you spent outside an agent session |
| how do I build THIS project | the archetype rules run per project (six scores), steer rate, autonomy, tests an hour, first try green, time back to green, prompts a session, tool calls a prompt, subagents, deep sessions, peak hour: the twelve Wrapped cards that are about the work, asked of the project's sittings | anything read from prompt WORDS (go to prompt, crash out, cryptic prompt stay the person's, and two are LOCAL) |
| what did it ship | lines added and removed, commits split by whether a sitting of THIS project was running, a daily commit series, the kind of work card | commits made in sittings this machine never saw read as "alone" (the corpus's reach, CLAUDE.md) |
| what did it cost | list price dollars (not a bill), dollars an hour, dollars a commit over the same sittings, the share spent in sittings that ended with no commit, the barren share and its causes, the model split | a bill: most people are on a subscription |
| what is it made of | languages by agent lines, the stack catalog items with their evidence, the harness mix, the model mix | a manifest string (matched against the catalog and dropped) |
| where is it in its life | a stage from cadence (starting, active, winding down, dormant), days since the last sitting, the week against the week before, the streak | a prediction: dormant describes the silence, never that it is over |
| how do my projects compare | one sentence per metric, highest against lowest, backed by two numbers, each project needing `patterns.MIN_GROUP` sittings and the gap `patterns.MIN_LIFT` or `MIN_SHARE_GAP` | a ratio of two floors (section 2.5) |

Rejected, with the reason: per project TRENDS over the full metric set (the corpus trends need four sittings a side in two 30 day windows, and a
project rarely has them; the week's momentum is the answerable form); a "health score" (a verdict nobody could overrule, the coverage block's rule);
per project prompt text or file names (LOCAL, never on the wire); a per project "cost per line" (lines are a floor whose shortfall differs by project,
section 2.5).

## 2. The metric list

`W` = WIRE (ids, numbers, enums, clocks, the key), `L` = LOCAL (read on the machine to compute, never sent). Scope `H` = history, `Win` = window.
"Floor" is the minimum sample below which the number is null with its code.

### 2.1 Identity and scope

| field | computation | class | scope | refusal |
|---|---|---|---|---|
| `key` | `corpus.repo_key(sitting)` = `RepoIdentity.hash` | W | both | a sitting whose repo did not resolve belongs to no project: counted in `unresolved` |
| name | `RepoIdentity.display_name` (origin's last segment) | L | printer only | the server serves `project_names[key]` only for a public repository the viewer has a session in |
| `rank` | block order: window attended seconds desc, then no window by `days_since_last`, then key | W | Win | |
| `projects_total`, `history_sessions`, `history_first_at` | counts over the whole cut | W | H | |
| `unresolved` | sittings with no repository, window and history | W | both | |

### 2.2 Time (`history` and `window`)

| field | computation | class | scope | refusal, floor |
|---|---|---|---|---|
| `sessions`, `first_at`, `last_at`, `active_days`, `spans_days` | `profile.corpus_profile(...)["sample"]` over the project's facts (`first_at` the first start, `last_at` the last END) | W | H and Win | |
| `active_seconds`, `attended_seconds` ("hours with you there"), `autonomous_seconds` | sums of the two clocks (`SessionFact`) | W | H and Win | |
| `share_of_attended` ("share of your month") | project attended / attended of EVERY counted sitting in the window, unresolved included | W | Win | null when that total is 0 |
| `longest_streak_days` | `profile.metrics.longest_streak_days` (attended days only: an unattended run never extends a streak) | W | H | null with no attended sitting |
| `current_streak_days` | `contributions._streaks(attended_days, today)[1]` (yesterday still counts) | W | H | null with no attended sitting |
| `days_since_last`, `age_days` | local days (04:00 boundary, `profile.local_day`, the zone's offset at the cut's clock) from the last start and the first start to today | W | H | |
| `clock.peak_hour` | `profile.metrics.peak_hour` (active seconds spread by span) | W | Win | `below_active_floor`: under `MIN_ACTIVE_SEC_FOR_SHARES` (3600 s) |
| `momentum` | attended seconds, last 7 days against the 7 before, by the sitting's start, judged by `trends.compare` (its floor `trends.MIN_SESSIONS` = 4 a side, its noise bar `MIN_MOVE` = 0.15) | W | H | `below_session_floor` (needed 4), `nothing_before` (0 attended before) |

### 2.3 How you build this project (window)

| field | computation | class | refusal, floor |
|---|---|---|---|
| `cards` | `wrapped.wrapped(project facts, sessions, profile, contributions, fanout, subjects)` then `report_blocks.wrapped_card`, the twelve `PROJECT_CARDS`: builder_type (the archetype rules per project), shipped, work_style (autonomy, median prompts, steer), longest_session, agents_at_once (subagents, peak), streak, change_course (steer rate), prompt_length, deep_sessions (deep vs short), time_put_in, prompts_per_session (tool calls a prompt), kind_of_work | W (numbers); the card sentences are rendered on each side | each card's own codes and floors (`wrapped.REFUSALS`), unchanged |
| `scores` | `profile.archetype(...)["scores"]`: all six rules (planning ratio, lines an hour, test runs an hour, night share, autonomy, steer rate) with value, threshold, score | W | a rule whose metric is null scores null |
| `quality` | `report._quality` = `quality.summary`: runs, passed, failed, first try rate, time to green; the words replaced by codes | W | `below_run_floor` (`quality.MIN_RUNS` = 5), `no_recovery` (nothing failed then passed inside one sitting) |
| `agents` | `report._agents` over the project's own agents (`corpus.agent_owners`: an agent is its dispatching sitting's) | W | null when none ran |
| `harnesses` | sittings and active seconds per contract `harness` value (`corpus.harness_of`) | W | |

Prompt text (the steer rate's correction markers, prompt length) and command text (test runs) are read, as L, and only counts travel.

### 2.4 Shipping, money, stack (window)

| field | computation | class | refusal, floor |
|---|---|---|---|
| `commits` | `corpus.repository`'s split: every commit `git log --branches` holds in the project's checkouts in the window, each once, ASSISTED only when a sitting of THIS repository (or the 30 minutes before one, `LOOKBACK_SEC`) held it; days as the local day at 00:00Z | W (counts, days); subjects L | null when no commit was read |
| `money` | `report_blocks.money_block(profile, facts)`: list price dollars, dollars an active hour, the sittings that ended with no commit (`MIN_SESSIONS_FOR_SHARE` = 8), the five token buckets, lines added and removed, the model split | W | `tokens_not_reported`, `model_not_in_price_table`; the no commit share null under 8 sittings |
| `usd_per_commit` | `money.usd` over `sum(commit_count)` of the SAME sittings (each commit claimed once, `profile.attribute_commits`), the per model rule | W | `no_price`, `unpriced_sessions`, `commits_not_from_git`, `below_commit_floor` (`contributions.MIN_COMMITS` = 5) |
| `burn` | `report_blocks.burn_block(profile)`: barren share, tokens, the causes (the top burn causes) | W | `burn_refusal` codes, `MIN_SESSIONS` = 3 |
| `languages` | `languages.split` by agent lines, each as its `language` enum | W (names from the table; files a count) | `below_line_floor` (`languages.MIN_LINES` = 200) |
| `stack` | `report_blocks.stack_block(vocab.wire(vocab.stack(sessions, dependencies=the checkouts' manifests)))`: frameworks, databases, infra, testing, tooling, services, languages | W (catalog ids); manifest strings L | `no_evidence` |

### 2.5 Comparisons across projects (window)

One entry per metric in `projects.COMPARISON_METRICS`, in that order, answered or refused. Among the projects that qualify (at least
`patterns.MIN_GROUP` = 5 sittings in the window AND the metric answered by its own floor), the highest against the lowest (ties by rank). A rate
answers at `high / low >= patterns.MIN_LIFT` (1.4, a labelled judgement call in `patterns.py`); a share at `high - low >= patterns.MIN_SHARE_GAP`
(0.15 points, because 2% against 1% is a 2x lift and means nothing). The findings module's own bars, reused.

| metric | value read from | kind, said as |
|---|---|---|
| `steer_rate` | `profile.metrics.steer_rate` (the change course card's value) | ratio, a share |
| `autonomy_score` | `profile.metrics.autonomy_score` | share |
| `test_runs_per_hour` | `profile.metrics.test_runs_per_hour` | FLOOR, always refused `floors_only` |
| `tool_calls_per_prompt` | the prompts per session card's `tool_calls_per_prompt` | ratio |
| `prompts_per_session` | the prompts per session card's value | ratio |
| `code_velocity` | `profile.metrics.code_velocity` | FLOOR, always refused `floors_only` |
| `usd_per_active_hour` | `money.usd_per_active_hour` | ratio, dollars |
| `first_try_rate` | `quality.first_try_rate` | share |
| `ships_rate` | `profile.metrics.ships_rate` (8 sittings) | share |
| `night_share` | `profile.metrics.night_share` | share |

Refusals: `fewer_than_two_projects` (n qualifying, needed 5); `within_noise` (both values still travel); `floors_only` (both values travel as "at
least", no ratio, no gap). A measured 0 qualifies only where the sentence has a form for it ("and not once in builder").

**Why two metrics can never be compared (FOUND BY THE HAND CHECK, section 7).** `test_runs_per_hour` counts test commands in the digest's cut command
text: 44 of builder's 66 test commands survive the cut against 338 of RideGT's 718 over the same window, so the floors' ratio read "builder tests 2.1
times as often" where the full commands say 1.5. `code_velocity` cannot see an edit a script makes (`profile.py`, "a LOWER BOUND"), and 26% of
builder's shell calls run a script against 31% of RideGT's. Two floors that fall short by different amounts cannot be divided; both floors still show.

### 2.6 The lifecycle stage (history; THRESHOLDS ARE JUDGEMENT CALLS)

Dates only, no floor ("the first session was today" is true of one sitting). First rule that fires, on local days at 04:00:

| rule (`stage_rule`) | fires when | stage |
|---|---|---|
| `quiet_two_weeks` | `days_since_last >= DORMANT_AFTER_DAYS` (14) | dormant |
| `quiet_a_week` | `days_since_last >= WINDING_AFTER_DAYS` (7) | winding_down |
| `cadence_halved` | days built in the last 14 under half the 14 before, and the 14 before had at least `CADENCE_MIN_PRIOR_DAYS` (4) | winding_down |
| `new_this_fortnight` | first sitting under `STARTING_WITHIN_DAYS` (14) ago | starting |
| `steady` | otherwise | active |

MEASURED context, `~/.claude/projects` (13 repositories, 359 sittings): the 70 gaps between consecutive days built inside one repository have median
1 day, p90 4, p95 6, longest 14 (builder, which came back after it). So "a week" is past 95 in 100 breaks after which work resumed, and "two weeks"
is the longest break anything on this machine came back from. Dormant describes the silence, never a prediction: the copy says how long.

## 3. The wire (`spec/report.v1.json`, version 3)

One nullable block, `projects`, appended after `stack`; a version 1 or 2 document still validates (`REPORT_VERSION = 3`, `report.V3_BLOCKS`). Eleven
new enums: `project_stage`, `project_stage_rule`, `momentum_refusal`, `clock_refusal`, `quality_refusal`, `language_refusal`, `cost_refusal`,
`comparison_metric`, `comparison_refusal`, and two copies of a table pinned both ways by tests: `language` (every name `languages.EXTENSIONS` and
`BY_NAME` give, plus `other`) and `harness` (the upload contract's). Objects:

```text
ReportProjects        window_days | history_sessions | history_first_at? | projects_total | projects: [ReportProject] max 20
                      unresolved: ReportProjectsUnresolved | comparisons: [ReportProjectComparison] max 10
ReportProject         key: sha256hex | rank | history: ReportProjectHistory | window: ReportProjectWindow?
ReportProjectHistory  sessions first_at last_at active_days spans_days active_seconds attended_seconds autonomous_seconds
                      longest_streak_days? current_streak_days? days_since_last age_days days_built_recent days_built_before
                      stage stage_rule momentum: ReportProjectMomentum
ReportProjectMomentum days sessions sessions_before attended_seconds attended_seconds_before direction? move? reason? needed?
ReportProjectWindow   sessions first_at last_at active_days active_seconds attended_seconds autonomous_seconds share_of_attended?
                      clock: ReportProjectClock | cards: [ReportWrappedCard] max 12 | scores: [ReportArchetypeScore] max 6
                      quality: ReportProjectQuality | languages: ReportProjectLanguages | commits: ReportProjectCommits?
                      money: ReportMoney | usd_per_commit: ReportProjectCostPerCommit | burn: ReportBurn | stack: ReportStack
                      agents: ReportAgents? | harnesses: [ReportProjectHarness] max 8
ReportProjectComparison metric high? low? high_value? low_value? high_sessions? low_sessions? ratio? gap? projects needed? reason?
```

The real block the local API serves (`GET /v1/profile/builder` `report.projects`, 2026-09-13T20:51:03Z, after `scripts/overnight_stack.sh restart`
and `sync`), the cards, stack items and commit days cut for length:

```json
{"window_days": 30, "history_sessions": 160, "history_first_at": "2026-08-12T00:44:30Z", "projects_total": 2,
 "unresolved": {"sessions": 0, "active_seconds": 0, "attended_seconds": 0, "history_sessions": 0},
 "projects": [
  {"key": "b093f92080ab6e13cc2d5fd8187c4da6f1c946f7c9f38d5182dd5ce6c6c46275", "rank": 1,
   "history": {"sessions": 155, "first_at": "2026-08-12T00:44:30Z", "last_at": "2026-09-13T16:36:43Z", "active_days": 28, "spans_days": 34,
     "active_seconds": 292290, "attended_seconds": 255143, "autonomous_seconds": 37147, "longest_streak_days": 11, "current_streak_days": 3,
     "days_since_last": 0, "age_days": 33, "days_built_recent": 8, "days_built_before": 14, "stage": "active", "stage_rule": "steady",
     "momentum": {"days": 7, "sessions": 43, "sessions_before": 5, "attended_seconds": 29988, "attended_seconds_before": 5842,
       "direction": "up", "move": 4.134, "reason": null, "needed": null}},
   "window": {"sessions": 137, "first_at": "2026-08-14T21:05:58Z", "last_at": "2026-09-13T16:36:43Z", "active_days": 25, "active_seconds": 252282, "attended_seconds": 218157,
     "autonomous_seconds": 34125, "share_of_attended": 0.941,
     "clock": {"peak_hour": 17, "reason": null, "active_minutes": 4204, "needed_minutes": null},
     "cards": [{"id": "builder_type", "value": null, "value_id": "quality_guardian", "unit": "archetype", "basis": "archetype_rules", "n": 137,
       "reason": null, "extras": {"confidence": 0.61, "metric": "test_runs_per_hour", "metric_value": 4.87, "metric_lower_bound": true, "...": null}}, "... 11 more"],
     "scores": [{"name": "quality_guardian", "metric": "test_runs_per_hour", "value": 4.87, "threshold": 3.0, "score": 0.812}, "... 5 more"],
     "quality": {"runs": 338, "passed": 270, "failed": 68, "first_try_rate": 0.799,
       "time_to_green": {"n": 41, "median_seconds": 41, "worst_seconds": 3568, "median_attempts": 2}, "reason": null, "needed": null},
     "languages": {"lines": 29773, "generated_lines_excluded": 0, "languages": [{"language": "Python", "lines": 21712, "files": 213, "share": 0.729}, "..."],
       "reason": null, "needed": null},
     "commits": {"assisted": 330, "alone": 16, "active_days": 25, "longest_streak": 18, "current_streak": 2, "days": ["... 25 days"]},
     "money": {"usd": 2387.73, "basis": "anthropic_api_list_price", "usd_per_active_hour": 34.13, "usd_without_a_commit": 149.03,
       "share_without_a_commit": 0.062, "lines_added": 29773, "lines_removed": 1579,
       "by_model": [{"model": "claude-opus-5", "usd": 2135.35}, {"model": "claude-fable-5", "usd": 241.41}, {"model": "claude-fable-5-1", "usd": 10.98}], "...": "..."},
     "usd_per_commit": {"usd": 7.24, "commits": 330, "unpriced_sessions": 0, "reason": null, "needed": null},
     "burn": {"share": 0.03, "barren_tokens": 104727775, "tokens": 3503956726, "causes": [{"cause": "context_replay", "share": 0.94}], "...": "..."},
     "stack": {"items": ["python, javascript, html, shell, expo, react, react_native, nextjs, fastapi, tailwind, ... 41 items"], "...": "..."},
     "agents": {"agents": 36, "produced": 35, "max_concurrent": 9, "parallelism": 2.1, "...": "..."},
     "harnesses": [{"harness": "claude_code", "sessions": 137, "active_seconds": 252282}]}},
  {"key": "03624fb1c6e2...", "rank": 2,
   "history": {"sessions": 5, "days_since_last": 13, "stage": "winding_down", "stage_rule": "quiet_a_week",
     "momentum": {"sessions": 0, "sessions_before": 1, "direction": null, "reason": "below_session_floor", "needed": 4, "...": "..."}, "...": "..."},
   "window": {"sessions": 5, "attended_seconds": 13611, "share_of_attended": 0.059, "clock": {"peak_hour": 10},
     "quality": {"runs": 44, "first_try_rate": 0.909}, "commits": {"assisted": 15, "alone": 145},
     "money": {"usd": 161.53, "usd_per_active_hour": 38.26, "usd_without_a_commit": null}, "usd_per_commit": {"usd": 10.77, "commits": 15},
     "burn": {"share": 0.002}, "agents": {"agents": 3, "max_concurrent": 3}, "...": "..."}}],
 "comparisons": [
  {"metric": "steer_rate", "high": "b093...", "low": "0362...", "high_value": 0.422, "low_value": 0.385, "ratio": 1.1, "reason": "within_noise"},
  {"metric": "autonomy_score", "high_value": 0.135, "low_value": 0.104, "gap": 0.031, "reason": "within_noise"},
  {"metric": "test_runs_per_hour", "high": "0362...", "high_value": 10.42, "low_value": 4.87, "ratio": null, "gap": null, "reason": "floors_only"},
  {"metric": "tool_calls_per_prompt", "high": "0362...", "low": "b093...", "high_value": 46.2, "low_value": 11.2, "ratio": 4.13, "high_sessions": 5, "low_sessions": 137, "reason": null},
  {"metric": "prompts_per_session", "high": "b093...", "low": "0362...", "high_value": 6.9, "low_value": 2.6, "ratio": 2.65, "reason": null},
  {"metric": "code_velocity", "high_value": 4261.8, "low_value": 424.9, "reason": "floors_only"},
  {"metric": "usd_per_active_hour", "high_value": 38.26, "low_value": 34.13, "ratio": 1.12, "reason": "within_noise"},
  {"metric": "first_try_rate", "high_value": 0.909, "low_value": 0.799, "gap": 0.11, "reason": "within_noise"},
  {"metric": "ships_rate", "projects": 1, "needed": 5, "reason": "fewer_than_two_projects"},
  {"metric": "night_share", "high": "0362...", "low": "b093...", "high_value": 0.469, "low_value": 0.217, "gap": 0.252, "reason": null}]}
```

`project_names` beside it is `{}`: capture uploads anonymously, so neither repository has a public name, exactly as their sessions show none.

## 4. Where it is computed and served

- **Machine.** `report.from_corpus` adds `doc["projects"] = projects.block(everything, window_days)` over the WHOLE cut (history needs every sitting;
  each project's window half is `corpus.window` of its own narrowed cut). `corpus.cut` now keeps the commit log per checkout (`commits_by_root`) and
  which sitting dispatched each agent (`agent_sittings`, from `agent_owners`, the membership rule `fanout_of` counts by), both narrowed by `window`.
  `python -m capture report` uploads it unchanged. MEASURED cost over the 160 sittings: 0.83 s for the block, inside a 2.63 s
  report, on a 16.3 s cut.
- **CLI.** `python -m analysis projects [ROOT] [--days N] [--json] [--wire]`: the human printer (names, which stay on the machine), the LOCAL result,
  or exactly the uploaded block.
- **Server.** `PUT /v1/profile/report` validates it through the generated door and drops, before storing, any project in a repository the account
  excluded (`builder_profile.without_projects`, `excluded_keys` through `session_repo_excluded`). `GET /v1/profile/builder` serves `report` with the
  same filter again and `project_names`: `repos.public_name` for keys the viewer has a session in, never for a private repository.
  `POST /v1/repos/visibility` with `excluded` rewrites the stored report too (`forget_project`): "an excluded repository has NOTHING on the server".
  `GET /v1/projects/{key}` (12 to 64 hex; a prefix naming two is a 409, an unknown or excluded key a 404) returns `{key, name, window_days,
  generated_at, project, comparisons, project_names, sessions}`, the sessions being the viewer's final visible ones in that repository, newest first,
  at most 50: one request for a project page.

## 5. Privacy

What leaves: the key (already on every session upload), counts, seconds, clocks, enum values, catalog ids, the language names from a fixed table. What
never leaves: the name of a repository not marked public, paths, file names, prompt words, commit subjects, command text, manifest strings.
`test_projects.py WhatMayTravel` plants sentinels in prompts, paths, subjects and a manifest, and checks every string in the block is an enum value, a
clock or a 64 hex key; the door refuses a name where a key goes (`test_projects_route.py`); `capture/tests/test_report_projects.py` holds the report's
key to the `repo_hash` capture's own session payloads carry for the same transcript, and neither the repository's name nor its path in the report.

## 6. The phone (for the agent building the screens)

- `src/data/api.ts`: `BuilderProfileResponse.project_names?: Record<string, string>`, `ProjectSlice`, `Api.project(key)`.
- `src/projects/model.ts` (pure, `bun test`): `projectsView(report.projects, project_names, nicknames)` gives the list (`rows` in block order with
  `label`, `stageLabel`, `stageSentence`, `lastSession`, `momentum`, `history` and `window` summaries; `hidden`; `unresolved`; `comparisons` with
  `title`, `sentence`, `answered` and the two sides' values); `projectDetail(block, key, names, nicknames)` gives one page (the cards through the
  deck's own `renderCards`, peak hour or its refusal, tests, languages, the commit series as local `YYYY-MM-DD` days, money lines through
  `copy/money.ts`, burn through `copy/burn.ts`, stack names, harnesses, agents, the comparisons naming it). Every window section is null when the
  window is.
- Labels: public name, else the owner's own label for it (`nicknames`, which the phone stores locally and never uploads), else `Private project` and
  six characters of the key. Offer "name this project" on `label.source === 'private'`.
- Copy: `generated/copy.ts` `PROJECT_*` tables, generated from `analysis/projects.py`; `spec/fixtures/projects/sentences.json` pins every sentence
  and `block.json` is a whole block for screen tests.
- Say the scope: "the last 30 days" only over window numbers (and only when the report's coverage holds, the existing rule); the stage and the
  streak are about all of the project's history. A comparison refusal is copy too, never an empty row.

## 7. Verified on the real corpus

Recomputed by a script that imports nothing from the engine (raw JSONL, `git log`, list prices), against the served block's clock:

| number | by hand | engine |
|---|---|---|
| builder: first sitting | 2026-08-16T01:07:09Z | same |
| builder: commits in the window, assisted | 160, 15 | 160, 15 |
| builder: typed prompts, interrupts in the window | 13, 2 | 13, 2 |
| builder: dollars at list prices | $161.53 | $161.53 |
| builder: days since last, days built in the last 14 and the 14 before | 13, 1, 1 | 13, 1, 1 |
| RideGT: commits in the window, assisted | 346, 330 | 346, 330 |
| RideGT: typed prompts, interrupts | 767, 123 | 767, 123 |
| RideGT: dollars at list prices (each message at its own model) | $2,387.83 | $2,387.73 |
| RideGT: the same, priced by output share as `pricing.split_by_model` does | $2,387.73 | $2,387.73 |
| RideGT: days since last, recent, before | 0, 8, 14 | 0, 8, 14 |
| shares of attended time | 0.941, 0.059 | 0.941, 0.059 |

The first hand pass disagreed on RideGT's prompts (724), interrupts (125) and dollars ($2,392.82): it assigned records to sittings by time alone, and
RideGT runs in five transcript directories at once. Assigned by directory, as the sessionizer pools, they agree; the last $0.10 is the price module's
stated rule for the 2 sittings that used two models. The hand pass is also what found the floors in 2.5.

Findings, the last 30 days: RideGT is 94% of the time with you there (60.6 of 64.4 hours), active (sessions on 8 of the last 14 days, 43 sittings
this week against 5 the week before, up 413%), a quality guardian at 4.9 test runs an hour (a floor), steering 42% of prompts, 6.9 prompts a session
and 11.2 tool calls a prompt, $2,388 at list prices ($34.13 an hour, $7.24 a commit over 330), 330 of 346 commits with a sitting running. builder is
6% (3.8 hours over 5 sittings), winding down (no session for 13 days), 2.6 prompts a session and 46.2 tool calls a prompt, $162 ($38.26 an hour,
$10.77 a commit over 15), and 145 of its 160 commits in the window read "alone" because they were made in sittings outside this corpus, the corpus's
reach and not the rule's (CLAUDE.md). Comparisons answered: 4.1 times the tool calls a prompt in builder, 2.6 times the prompts a session in RideGT,
more of builder between 10pm and 4am (47% against 22%). Refused: steer, autonomy, dollars an hour and first try green are close; ships rate has one
project with 8 sittings; test runs and lines an hour are floors.

## Deviations and recorded, not fixed

- **`test_runs_per_hour` in `profile.py` has its own regex**, not `quality.TEST_CMD` ("THE ONE DEFINITION" by its own docstring), and both read the
  digest's cut command text. RECORDED: the profile's copy lacks the `(?<![\w/.-])` guard. Not changed here: it moves the corpus profile.
- **`code_velocity`'s basis does not say it is a floor** (`project_edit_tools_and_credited_shell_writes`), though `profile.py` says it is one; so the
  velocity archetype sentence never says "at least". The comparisons mark it a floor themselves (`COMPARISONS` `floor`). A basis rename moves the
  wrapped basis enum: a spec change for its owner.
- **The corpus commit graph counts a commit twice when one repository is cloned into two directories** the transcripts ran in (it concatenates the
  checkouts' logs); a project deduplicates on (time, subject). MEASURED: every repository here resolved to one checkout.
- **After the server drops an excluded project, the others' `share_of_attended` add up to under 1**: the machine divided by attended time that
  included it. The machine side's exclusion (`BUILDER_CAPTURE_EXCLUDE`) never reads the repository at all.
- **The report's corpus level blocks still include a repository the phone excluded** when the machine that sent the report did not know. The projects
  block is filtered; the others cannot be recomputed on the server.
