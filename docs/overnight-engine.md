# The overnight engine: wrapped, live, vocab, and the fixes

Four implementers build from this page at the same time. `CLAUDE.md` overrides anything here. Nothing may be guessed while implementing: every open
choice is made below, with the measurement behind it or the words UNMEASURED JUDGEMENT CALL.

Measurements were taken on 2026-09-13 against the real corpus (`~/.builder-overnight/corpus`: 57 root transcripts, 153 counted final sessions, 148
RideGT and 5 builder) or the live transcript `~/.claude/projects/-Users-vedantbhatt/fa5eaa46-bdbd-4c15-a73b-8d723f98706b.jsonl`. In tables, `\|` is a
literal `|` inside a regex.

## 0. Ownership and the rules that bind all four

| owner | files | write first, because others import it |
|---|---|---|
| A | `analysis/wrapped.py`, `tests/test_wrapped.py`, `tests/corpus_fixture.py`, `agents.peak_concurrency` | `agents.peak_concurrency` |
| B | `analysis/live.py`, `analysis/plain.py`, two fields on `digest.Ev`, `tests/test_live.py`, `tests/test_plain.py`, `tests/transcripts.py` | `plain.py`, then the `Ev` fields |
| C | `analysis/vocab.py`, `tests/test_vocab.py` | nothing |
| D | `burn.py`, `profile.py`, `contributions.py` and their tests | `profile.is_attended`, `profile.longest_run` |

Nobody writes a private copy of another owner's function while waiting: that is the drift CLAUDE.md calls "a rule copied into a second module". Nobody
edits `analysis/__main__.py` (section 7 is the integrator's) or touches `mobile/`, `server/`, `spec/`, `privacy/`, `capture/`.

1. A value never travels without `basis`, `n`, and a `reason` when absent. Absent is `None`, never `0`; a zero is printed only when it was measured.
2. No dashes in any string a person reads: no em dash (U+2014), no en dash (U+2013), no spaced hyphen. Every new module tests every string it can emit
   with `plain.has_dash`.
3. One rule, one function. Every rule below names the existing function it calls.
4. **WIRE** fields are ids, integers, floats, enums, durations, timestamps, catalog names and salted hashes; they may later be declared in
   `spec/report.v1.json`. **LOCAL** fields are prompt text, paths and file names, commit subjects, command text and package names; they never leave
   the machine unless a future opt-in block in `privacy/upload-contract.json` allows it. Each module has `wire()`, which drops every LOCAL field, and
   a test that sentinel words planted in a fixture's prompts, paths and subjects appear nowhere in `json.dumps(wire(...))`.
5. Display strings, sentences and titles are rendered from ids and numbers. As with `feedback.wire`, the wire carries the id and numbers and the phone
   renders its own words, so rendered strings stay off the wire even when WIRE-safe.

## 1. Shared building blocks

### 1.1 `analysis/plain.py` (B, first edit)

```python
ROLES = ("test", "source", "config", "docs", "migration", "style", "build", "dependency", "unknown")
def role_of(path: str) -> str        # path shape only, never contents
def spoken(n: int) -> str            # 0..20 as words ("six"), digits above ("34")
def ordinal(n: int) -> str           # 1..10 as words ("third"), then "11th", "12th", "21st"
DASH = re.compile("[" + chr(0x2014) + chr(0x2013) + r"]|\s-{1,2}\s")
def has_dash(text: str) -> bool      # bool(DASH.search(text))
ROLE_NOUN: dict[str, tuple[str, str, str]]   # role -> (one, "{n} many", collective)
```

`role_of`: normalise `\` to `/`, `name` = basename, `segs` = lowercased directory parts; first match wins.
1. `dependency`: `name in languages.GENERATED_NAMES` or `name in shipped.MANIFESTS`.
2. `migration`: a seg in `{migrations, migration, migrate, alembic}`, or `name` matches `^\d{3,}[_-].+\.(sql|py|ts|js|rb)$`.
3. `test`: `name` matches `^test_.+\.py$|_test\.(py|go)$|\.(test|spec)\.[jt]sx?$|Tests?\.swift$|Test\.(java|kt)$` or a seg in `{test, tests,
   __tests__}`. Never `spec/`: this repository's `spec/` holds JSON specs.
4. `docs`: extension in `{md, mdx, rst, adoc, txt}` or a seg in `{docs, doc}`.
5. `style`: extension in `{css, scss, sass, less, styl}`.
6. `build`: `name in {Makefile, Dockerfile, CMakeLists.txt, Procfile, justfile}`, extension `gradle`, or a seg `.github`.
7. `config`: extension in `{json, yaml, yml, toml, ini, env, plist, xcconfig, conf, cfg, xml}`, `name` starting with `.`, or `name` matching
   `\.config\.[cm]?[jt]s$`.
8. `source`: `languages.language_of(path)` not None and not `"other"`.
9. `unknown`.

MEASURED over the corpus's 64,652 agent lines (generated files excluded as `languages.split` excludes them): source 65.3%, test 18.0%, docs 7.3%,
unknown 5.8%, config 2.2%, migration 0.8%, dependency 0.3%, build 0.3%. RE-MEASURED after the review (see "Deviations (review fixes)"), over the
50,177 PROJECT lines: source 69.5%, test 22.1%, docs 4.9%, config 1.7%, migration 1.1%, dependency 0.4%, build 0.3%, unknown 0.1%.

`ROLE_NOUN`: test (`a test file`, `{n} test files`, `your test suite`); source (`a source file`, `{n} source files`, `the source code`); config (`a
config file`, `{n} config files`, `the configuration`); docs (`a doc`, `{n} docs`, `the docs`); migration (`a database migration`, `{n} database
migrations`, `the migrations`); style (`a stylesheet`, `{n} stylesheets`, `the styles`); build (`the build setup`, `{n} build files`, `the build
setup`); dependency (`the dependency list`, `{n} dependency files`, `the dependencies`); unknown (`a file`, `{n} files`, `the project`). Durations for
people always come from `feedback._mins` (`under a minute`, `12 minutes`, `1h 05m`), imported.

### 1.2 Two additive fields on `digest.Ev` (B)

`result_ts: float | None = None` (on a tool Ev: when its `tool_result` arrived, ok or error) and `stop_reason: str | None = None` (on assistant and
tool Evs: the record's `message.stop_reason`). Set only in `digest.load_claude_code_events`, the one parser: keep a `dict[tool_use_id, Ev]` beside
`tool_names` and stamp the origin on both result branches. MEASURED on the live transcript: all 221 assistant records carry `stop_reason` (202
`tool_use`, 19 `end_turn`). Other loaders leave both None, meaning "cannot tell", and `live.py` falls back to timing. Neither field is read by `stats`
or `render`; B adds a test that `digest.build` text is byte identical before and after over every transcript in `spec/fixtures/live_path/`.

### 1.3 `agents.peak_concurrency(intervals: Sequence[tuple[float, float]]) -> tuple[int, float]` (A)

The sweep inside `agents.fanout`, lifted out unchanged (spans under `MIN_OVERLAP_SEC` skipped, ends sort before starts at one instant), returning
`(peak, busy_seconds)`; `fanout` calls it and `test_agents` passes untouched.

### 1.4 `profile.is_attended` and `profile.longest_run` (D, first edit)

`def is_attended(f: SessionFact) -> bool: return not f.unattended and f.attended_seconds > 0`. The `attended_seconds > 0` half makes it correct under
both definitions of `unattended` that exist today (5.7); `session_rank` switches its inline expression to it. `def longest_run(days:
Sequence[dt.date]) -> int` is the consecutive day rule, written once: today it is a loop in `corpus_profile` and another in `contributions._streaks`.
It lives in `profile` because `contributions` already imports from `profile` and the reverse would be a cycle.

## 2. `analysis/wrapped.py`: the fifteen cards (A)

```python
def wrapped(facts: Sequence[profile.SessionFact], sessions: Sequence[patterns.SessionEvents], *,
            profile: Mapping | None = None, contributions: contributions.Contributions | None = None,
            fanout: agents.Fanout | None = None, commit_subjects: Sequence[str] = (), quotes: bool = False) -> dict
def wire(result: Mapping) -> dict
CARD_IDS: tuple[str, ...]        # builder_type, shipped, work_style, longest_session, agents_at_once, go_to_prompt,
QUESTIONS: dict[str, str]        # streak, change_course, crash_out, prompt_length, deep_sessions, time_put_in,
                                 # cryptic_prompt, prompts_per_session, kind_of_work (brief.md table order)
```

`facts` and `sessions` are the parallel lists from `__main__._narrative_inputs` (zip strict). `profile` defaults to `profile.corpus_profile(facts)`.
No I/O: git, sidecars and manifests arrive precomputed.

Output `{"cards": [15], "quotes": {card_id: {"text", "session_id", "ts"}}, "sample": {...}}`. Every card has all ten keys `id, question, value, unit,
display, sentence, basis, n, reason, extras`: `reason` None when answered; on refusal `value`, `display`, `sentence` are None and `reason` is a
string; `extras` is always an object (one shape, as `profile.archetype` insists). `quotes` is `{}` unless `quotes=True`. `sample` copies `sessions,
prompts_with_text, active_hours, days, spans_days, first_at, last_at` from `profile["sample"]` and adds `attended_sessions` (count of `is_attended`).
Every answered sentence contains a digit (tested with `re.search(r"\d", s)`), so cards use digits, never `plain.spoken`. No `display` or `sentence`
ever contains prompt text: quotes live only in `quotes`, and the CLI prints one above its card under `--quotes`. `wire(result)` returns `{"cards":
[{id, value, unit, basis, n, reason, extras}], "sample"}`, dropping `question`, `display`, `sentence` and `quotes`, and keeps only `{id, n, reason}`
for `crash_out` and `cryptic_prompt`.

### 2.1 Two prompt rules shared by the four prompt cards

`_quotable(text) -> bool` is False when the text is empty, starts with `/` (a slash command), contains `[redacted]` (the digest's `mask` fired on a
secret; prompt Evs are already masked), or is pasted. Pasted: 2+ matches of `(?m)^(Traceback \(most recent call last\)|\s+at \S+ \(|\s+File ".+", line
\d+|Error:|error:|fatal:|FAILED|npm ERR!|\w+(Error|Exception): )`, or 8+ lines of which more than half contain one of `{}();=<>` or start with two
spaces. MEASURED: excludes 9 of 932 prompts. `_quote(text)` collapses whitespace and cuts at the last space before 160 characters, appending an
ellipsis: 160 is the contract's own cap on a verbatim prompt excerpt (`decision_patterns[].prompt_excerpt`), not a new number.

### 2.2 The cards

`P` is the profile dict, `m` is `P["metrics"]`, `n` is the sample the value rests on. All fields are WIRE unless a card says otherwise.

**1 `builder_type`** "Which kind of builder are you?" Value enum `architect, velocity_machine, quality_guardian, night_owl, director, skeptic,
generalist`, unit `archetype`. Reuses `P["archetype"]` (`profile.archetype`, `ARCHETYPE_RULES`). When `name` is None with reason "no archetype rule
met its threshold", value `generalist` and `closest` is the highest non-null `scores` entry (ties by name). Refuse below `profile.MIN_SESSIONS` (the
archetype's own reason) or when every score is null ("none of the six archetype metrics could be computed"). Display `Architect`, `Velocity machine`,
`Quality guardian`, `Night owl`, `Director`, `Skeptic`, `Generalist`. Sentences, `v` the winning metric: architect `{v} prompts get a plan for every
one that goes straight to work.`; velocity_machine `{v} lines an hour while the agent runs.`; quality_guardian `{v} test runs an hour, about one every
{round(60/v)} minutes.`; night_owl `{pct} of your build time lands between 10pm and 4am.`; director `{pct} of your build time runs without you.`;
skeptic `{round(v*10)} in 10 prompts stop or redirect the agent.`; generalist `No single pattern dominates. Closest is {Name},
{round(100*value/threshold)}% of the way there.` Basis `archetype_rules`, n sessions, extras `{confidence, closest: {name, value, threshold, score} |
None, runners_up}`. MEASURED: quality_guardian at 0.79, velocity_machine 0.785 beside it.

**2 `shipped`** "How much did you ship?" Value `P["totals"]["total_lines_added"]`, unit `lines`. Commits are `contributions.total` (distinct SHAs from
`capture.repo.commits_in` across every resolved repository), never `P["totals"]["total_commits"]`, which this corpus refuses
(`overlapping_session_windows`) and which is a sum of windows even when it answers. Refuse when no fact has a lines basis or the total is 0: "no agent
lines were attributed: this corpus writes files a way the line counters do not credit, and 0 would read as you wrote nothing". Display `{lines:,}
lines across {commits:,} commits`, or `{lines:,} lines` without contributions. Sentence `{assisted} of those commits landed while an agent was
working.`, or `Counted across {n} sessions from edits and shell writes.` Basis `edit_tools_and_credited_shell_writes+git_log_distinct_commits`, extras
`{commits, assisted, alone}` (None each without contributions). MEASURED: 64,652 lines.

**3 `work_style`** "How do you work with your agent?" Value enum `hand_off, dialogue, steering, one_shot`, unit `style`. First match: `hand_off` if
`m["autonomy_score"]` reaches the `director` threshold (0.5, read from `ARCHETYPE_RULES` by name); `dialogue` if the median `prompt_count` over
`is_attended` facts reaches `DIALOGUE_MIN_PROMPTS = 5` (UNMEASURED JUDGEMENT CALL; MEASURED context: median 4, mean 7.1 over 131 attended sessions);
`steering` if `m["steer_rate"]` reaches the `skeptic` threshold (0.4, by name); else `one_shot`. A rule whose metric is None is skipped. Refuse below
`profile.MIN_SESSIONS` attended sessions. Display `You hand it off.` / `A back and forth.` / `Hands on the wheel.` / `Short and direct.`; sentence
`{pct} of your build time runs without you.` / `You work in dialogue, {median} prompts a session.` / `{round(steer*10)} in 10 prompts stop or redirect
it.` / `{median} prompts a session, then it runs.` Basis `autonomy_then_prompts_then_steer`, extras `{autonomy, median_prompts, steer_rate}`.
MEASURED: autonomy 0.12, median 4, steer 0.433, so `steering`.

**4 `longest_session`** "Your longest single session?" Value `P["session_rank"][0]["attended_seconds"]`, unit `seconds`. Attended time decides records
(CLAUDE.md), so this reuses the profile's ranking. Refuse when `P["ranked_sessions"] == 0`: "no session had you present, and an unattended run cannot
hold a record". Display `feedback._mins(value)`, sentence `The longest of {ranked_sessions} sessions you were present for.` Basis
`attended_seconds_rank`, n `ranked_sessions`, extras `{active_seconds, started_at}`. MEASURED: 3h 06m, of 131.

**5 `agents_at_once`** "How many agents do you run?" Value `agents.peak_concurrency([(s.events[0].ts, s.events[-1].ts) for s in sessions if
s.events])[0]`, unit `sessions`. First to last EVENT, never `started_at` to `ended_at`: `ended_at` carries the trailing idle credit, and silence after
the agent stopped is not the agent running (the `_runs_with_nothing_to_show` fix). Refuse only with no sessions. Display `{v} at once`. Sentence
`Inside one session, up to {max_concurrent} helper agents ran at once.` when `fanout.max_concurrent >= 2`, else `Counted from first action to last
across {n} sessions.` Basis `sweep_over_first_to_last_event`, extras `{subagents_peak, subagents}` from `fanout` (`__main__._corpus_fanout`), None
each when `fanout` is None. MEASURED: 3.

**6 `go_to_prompt`** "What's your go to prompt?" Value sends, unit `sends`. Group `_quotable` texts by `_norm(t) = " ".join(re.sub(r"[^a-z0-9]+", " ",
t.lower()).split())`; a group qualifies with `GO_TO_MIN_SESSIONS = 2` distinct sessions (the brief). Rank sessions desc, sends desc, words desc, first
use asc (UNMEASURED JUDGEMENT CALL on the tie breaks). The quote is the group's most recent original text. Refuse "no prompt was sent in more than one
session", n = quotable prompts. Display `Sent {sends} times across {sessions} sessions`, sentence `{words} words you keep coming back to.` Basis
`normalized_prompt_text_across_sessions`, extras `{sessions, words}`. WIRE: value, n, extras (counts carry no wording, the line `report._prompting`
already draws). LOCAL: the quote. MEASURED: two groups tie at 4 sessions and 4 sends.

**7 `streak`** "What's your longest streak?" Value days, unit `days`. A day counts only with a commit AND an attended session: `commit_days = {d.day
for d in contributions.days if d.total}`, `attended_days = {f.local_day for f in facts if profile.is_attended(f)}`, `both = sorted(commit_days &
attended_days)`, value `profile.longest_run(both)`. An unattended run never extends a streak (CLAUDE.md; the contract's `unattended` doc). This
reports a past fact; the roadmap rejected streaks as a retention mechanic, so no current streak is shown or nudged. Refuse without contributions: "no
commit history could be read for the repositories these sessions ran in". Zero answers: display `No streak yet`, sentence `{len(commit_days)} days had
a commit, none alongside a session you were at.` Else display `{v} days straight`, sentence `{len(both)} days in all had a commit and you there.`
Basis `days_with_a_commit_and_an_attended_session`, n `len(both)`, extras `{commit_days, attended_days, both_days}`. MEASURED: 11, where the profile
says 21 (5.4).

**8 `change_course`** "How often do you change course?" Value `m["steer_rate"]["value"]`, unit `share`; refusal is the metric's own reason. Display
`{pct}% of the time`, sentence `{interrupts} interrupts and {corrective_prompts} corrections across {n} prompts.` from the metric's extras. Basis
`interrupts_and_correction_markers`. MEASURED: 43%, 151, 253, 932.

**9 `crash_out`** "Your biggest crash out?" Value score, unit `score`. Deterministic, over `_quotable` prompts:

```text
score = 3*min(profanity, 5) + 2*min(caps_words, 5) + 2*min(bang_runs, 3) + len(profile.correction_markers(text)) + 2*min(stretches, 2)
profanity  re.findall(r"\b(fuck\w*|shit\w*|damn\w*|wtf|ffs|bullshit|crap|ugh+|omg)\b", text, re.I)
caps_words words of 3+ letters, isalpha and isupper, not in ACRONYMS
bang_runs  re.findall(r"[!?]{2,}", text)          stretches  re.findall(r"([a-z])\1{3,}", text.lower())
```

`ACRONYMS` is a frozenset in the module: API URL CSS HTML JSON HTTP HTTPS SQL CLI SDK ETA AWS GCP JWT RLS EAS TODO README YAML CSV PDF MVP IOS GPU CPU
RAM UTC PST DNS SSH SSL TLS ORM CORS. Qualify at `CRASH_MIN_SCORE = 6` (UNMEASURED JUDGEMENT CALL: two separate signals; MEASURED: 117 of 923 quotable
prompts clear it; the maximum is 46 by construction). Winner: highest score, ties to the earliest. Refuse "no prompt read as a crash out", n = prompts
scored. Display `Your angriest prompt`. Sentence `Sent {feedback._mins(ts - session.started_at)} into
that session. We have all been there.` Basis `profanity_caps_punctuation_markers`. WIRE: id, n, reason only. LOCAL: value, extras `{parts}`, display,
sentence, quote; every number here is a function of which words were typed.

**10 `prompt_length`** "How long are your prompts?" Value mean `len(t.split())` over `_quotable` texts (the `digest.stats` word rule), 1 dp, unit
`words`. Label on the median: under `profile.SHORT_PROMPT_WORDS` (10) `Mostly terse.`, under `PROMPT_BRIEF_WORDS = 40` `Mostly conversational.`
(UNMEASURED JUDGEMENT CALL; MEASURED p75 32, p90 65), else `Mostly detailed briefs.` Refuse below `profile.MIN_PROMPTS` texts. Display `{v} words on
average`, sentence `{label} Half of them run {median} words or fewer.` Basis `words_per_prompt`, extras `{median}` (a length is not wording).
MEASURED: mean 30.3, median 16.

**11 `deep_sessions`** "How do you work?" Value: `is_attended` facts with `attended_seconds >= DEEP_MIN_ATTENDED_SEC = 3600`, unit `sessions`.
UNMEASURED JUDGEMENT CALL: an hour with you present; MEASURED context: attended p75 44.5 minutes, p90 83; 19 of 131 clear it, averaging 99 minutes.
Refuse below `profile.MIN_SESSIONS` attended sessions. Display `{v} deep sessions`, sentence `Averaging {avg} minutes of focus each.`; zero answers
with display `No session past an hour yet` and sentence `Your longest ran {m} minutes.` Basis `attended_sessions_over_an_hour`, extras
`{avg_minutes}`.

**12 `time_put_in`** "How much time did you put in?" Value `P["totals"]["total_hours"]`, unit `hours`, n `total_sessions`. Display `{h} hours across
{n} sessions`, sentence `{a} of those hours with you at the keyboard.` (`a` = attended seconds over 3600, 1 dp). Refuse with no sessions. Basis
`active_seconds`, extras `{attended_hours}`. MEASURED: 84.6, 153, 74.4.

**13 `cryptic_prompt`** "Your most cryptic prompt?" Value gibberish share (2 dp), unit `share`. A `_quotable` text is a candidate when its stripped
length is 4 to 80, it has 4+ alphanumerics, no token of 16+ characters (key shaped, possibly a credential), no match for `[/@=]|://|\.\w` (paths,
emails, URLs, versions), and its alphanumerics are not a hex hash (`[0-9a-fA-F]{7,40}`) or all digits. A token is gibberish when its alphanumeric core
has 4+ characters and either (a) 2+ letters, 2+ digits and 2+ letter/digit transitions, or (b) a run of 5+ letters with no `aeiouy`. Score =
characters in gibberish tokens over characters in all tokens; qualify at `CRYPTIC_MIN = 0.5` (UNMEASURED JUDGEMENT CALL). Winner: score desc, shorter,
earlier. MEASURED: one distinct 10 character text qualifies (sent in 2 sessions); a draft consonant run rule flagged a two word English question and
was dropped. Refuse "no prompt was cryptic enough", n = candidates. Display `A {len} character prompt`. Sentence: when `patterns._was_corrected(session, index)` is False, `Somehow the
agent knew. {k} tool calls followed.` (tool events before the next prompt), else `{len} characters, and it had a go anyway.` Basis
`letter_digit_interleave_and_vowelless_runs`. WIRE: id, n, reason. LOCAL: everything else.

**14 `prompts_per_session`** "How much do you talk to your agent?" Value mean `prompt_count` over `is_attended` facts, 1 dp, unit `prompts per
session`: a session nobody was at is not a conversation. Refuse below `profile.MIN_SESSIONS` attended sessions. Display `{v} prompts a session`,
sentence `{m["iteration_depth"]} tool calls for every prompt you send.`, or `Half your sessions have {median} or fewer.` when that metric is None.
Basis `prompts_over_attended_sessions`, extras `{median}`. MEASURED: 7.1, iteration depth 12.0.

**15 `kind_of_work`** "What kind of work is it?" Value enum, unit `kind`. Two bases in order; the card names the one that answered.

Basis `commit_subject_labels`, `classify_subject(s) -> str | None`: the conventional prefix
`^(feat|fix|refactor|docs|test|tests|chore|perf|style|build|ci|revert)(\([^)]*\))?!?:\s` (case insensitive; feat to feature, tests to test, ci to
build); else strip one `^[\w./]+:\s+` scope and read the first word: fix fixes fixed repair resolve patch correct to `fix`; add adds added implement
introduce build create support enable wire ship allow to `feature`; refactor rename extract simplify clean cleanup move split reorganize restructure
inline dedupe to `refactor`; document docs doc readme to `docs`; test tests to `test`; revert undo rollback to `revert`; bump upgrade to `chore`.
Gate: `KIND_MIN_SUBJECTS = 20` classified (UNMEASURED JUDGEMENT CALL: below it one commit moves a kind by five points) and `KIND_MIN_COVERAGE = 0.6`
classified share (UNMEASURED JUDGEMENT CALL: the labelled commits must be most of the work). MEASURED with a draft of this rule: RideGT 21 of 232
classify (9.1%), builder 4 of 15 (26.7%). Both refuse, correctly: this person writes subjects as prose, not labels.

Basis `lines_by_file_role`, the fallback: agent lines by `plain.role_of` over events with `patterns._wrote(e)`, `e.path`, `e.added` and
`languages.language_of(e.path)` not None (the `languages.split` filter), gated by `languages.MIN_LINES`.

Why this does not contradict `quality.py`: it refused a change failure RATE because it read "fix" as "something broke", and three of four matches were
intentional fixes. This card reads the word as the author's own label for the kind of change, which is what "fix" means in a subject, reports counts
and never a rate, and says nothing about regressions. The other objection there, that the number describes how somebody writes commit messages, is
what the coverage gate answers: below 60% labelled the count would describe writing style, so the first basis refuses and the fallback reads no
messages.

Display `Mostly {plural(kind)}.` (features, fixes, refactors, docs changes, test changes, chores, reverts, speedups for perf, style changes, build
changes); sentence `{n1} {plural1} and {n2} {plural2} in {total} commits.` Fallback display by top role: `Mostly source code.`, `Mostly tests.`,
`Mostly docs.`, `Mostly configuration.`, `Mostly database migrations.`, `Mostly styling.`, `Mostly build setup.`, `Mostly dependencies.`, `Mostly
other files.`; sentence `{p1}% of agent lines went to {role1} files, {p2}% to {role2} files.` Refuse when both gates fail, joining both reasons with `; `, the first being
"{classified} of {total} commit subjects say what kind of change they are, 60% needed". Extras `{counts: {kind: n}, classified, commits, coverage,
role_lines: {role: n}, commit_reason}`. LOCAL: the subjects, which are never emitted. MEASURED fallback: source 65.3%, tests 18.0%; after the
review, over project lines only, source 69.5%, tests 22.1%.

## 3. `analysis/live.py`: one running session (B)

```python
def live_state(events: Sequence[digest.Ev], turns: Sequence[burn.Turn], now: float,
               history: Sequence[profile.SessionFact], *, salt: str, repo: str | None = None,
               active_seconds: float | None = None, unattended: bool = False,
               session_id: str | None = None, names: bool = False) -> dict
def sentence(state: Mapping, names: bool = False) -> str
def wire(state: Mapping) -> dict
def live_transcripts(root: pathlib.Path, now: float) -> list[capture.discover.Transcript]
def current_session(t: capture.discover.Transcript, now: float, tz) -> capture.sessions.Session | None
```

Returns `{session_id, activity, sentence, verdict, eta, decisions, needs_you, map, timelapse, sample: {events, tool_calls, segments, tokens},
names?}`; `names` exists only with `names=True`; `sample.tokens` is the sum of `Turn.total`, None when `burn.records_usage` is False. The live path
covers Claude Code transcripts (what `capture.sessions.load_source` reads). The segment is `burn.segments(events, turns)[-1]`. `window` is its
trailing slice holding the last `W` tool calls (with the `result_error` events among them), `W = min(patterns.SPIN_TOOL_CALLS, calls_in_segment //
2)`; `before` is the `W` calls preceding. 25 is reused because a window that long with no checkpoint is already a spin by the patterns measurement
(median run between checkpoints 4 calls, p90 18).

### 3.1 Constants

| name | value | source |
|---|---|---|
| `WAITING_MIN_SEC` | 63 | MEASURED record gap p98 (CLAUDE.md groundtruth table); used only when `stop_reason` is None |
| `THINKING_MIN_SEC` | 13 | MEASURED record gap p90 |
| `IDLE_SEC` | 180 | MEASURED record gap p99 is 171 s; a longer gap is not the agent's cadence |
| `VERDICT_MIN_TOOL_CALLS` | 8 | UNMEASURED JUDGEMENT CALL: below it a segment is `starting` |
| `LOST_MIN_BLIND_FILES` | 3 | UNMEASURED JUDGEMENT CALL |
| `ETA_MIN_SESSIONS` | 10 | UNMEASURED JUDGEMENT CALL: a quartile over fewer is one session |
| `LIVE_MTIME_SEC` | `capture.reference.mb.TAU_MAX` (3600) | the widest tau the fit returns, so the prefilter never drops a live session |
| `MAX_FRAMES`, `MAX_DECISIONS` | 600, 4 | the brief; the roadmap's "three or four a session" |

### 3.2 `activity` `{kind, role, attempt, since_s}`

`kind` enum `reading, editing, testing, running, searching, delegating, waiting_on_you, thinking, idle`. `role` is `plain.role_of(e.path)` for an
event with a path, `test` for a test command, else `unknown`. `_activity_of(e)`, first match: tool in `burn.TASK_TOOLS` delegating; in
`digest.READ_TOOLS` reading; `patterns._wrote(e)` or tool in `digest.EDIT_TOOLS` editing; shell (`digest.SHELL_TOOLS`) matching `quality.TEST_CMD`
testing; shell matching `^\s*(grep|rg|find|fd|ag|ack)\b|\|\s*grep\b` searching; shell matching `^\s*(cat|head|tail|less|bat|wc|sed -n)\b` reading;
other shell running; tool in `{Grep, Glob, WebSearch, WebFetch, grep_search, glob, google_web_search, web_fetch, list_directory, LS}` searching; else
running.

State at `now`, first match: (1) the last assistant event has `stop_reason == "end_turn"` and no tool or prompt event follows: `waiting_on_you` (with
`stop_reason` None: the last event is assistant text and `now - ts >= WAITING_MIN_SEC`); (2) `now - last_event.ts >= IDLE_SEC`: `idle`; (3) the last
event is a prompt: `thinking`; (4) the last tool has `result_ts` and `now - result_ts >= THINKING_MIN_SEC`: `thinking`; (5) `_activity_of(last tool)`.
A tool with no result for a long time is `idle`, never `waiting_on_you`: a permission prompt and a long test run look identical in a transcript.
`attempt` (editing only, else 0): writes to the target file F in the segment after the later of the last `READ_TOOLS` read of F and the last test run.
`since_s`: `now` minus the first event of the trailing run with the same kind and role (for `waiting_on_you` and `idle`, minus the event that began
the wait).

### 3.3 `verdict` `{state, evidence, basis, reason}`

State enum `starting, converging, circling, lost, waiting, done`, or None. Evidence integers, always all present: `window_calls, errors_now,
errors_before, new_files, checkpoints, repeats, churn_writes, fail_run, blind_edits`. First match wins:

1. Turn ended (3.2 rule 1): `done` when `segment.produced_work`, no `result_error` follows the last `patterns._checkpoint` event, and the last
   assistant text does not end in `?`; else `waiting`. Basis `turn_ended`.
2. `starting` below `VERDICT_MIN_TOOL_CALLS` tool calls in the segment.
3. `circling`, sharing `burn.Segment.causes()` on `burn.Segment(index=-1, start_ts=window[0].ts, end_ts=window[-1].ts, prompt="", events=window)`: (a)
   `repeated_call` is among its causes (the same call 3+ times, `burn._max_repeat`); (b) `file_churn` is (one path written 4+ times, equal to
   `patterns.REWORK_WRITES`) and the window holds 2+ `result_error` events; or (c) `feedback._worst_failure_run` on an object whose `.events` is the
   window reaches `patterns.STUCK_FAILURES`. Basis `causes:repeated_call`, `causes:file_churn_with_failures` or `consecutive_failures`.
4. `lost`, evaluated only when the session has at least one `READ_TOOLS` event: a harness that reads through the shell (Codex) would make every edit
   look blind, so otherwise the rule is skipped with `blind_edits` 0. Blind paths are distinct paths in the window MODIFIED (Edit, MultiEdit,
   NotebookEdit, replace, replace_in_file, a shell write with `added is None`, i.e. `sed -i`, or Write with `removed > 0`) that no earlier event in
   the session read or wrote. Lost when blind paths reach `LOST_MIN_BLIND_FILES` and are at least half the modified paths in the window. Creations
   never count.
5. `converging`: a checkpoint in the window, `errors_now < errors_before` (both over `W` calls), and `new_files >= 1` (paths touched in the window and
   nowhere earlier in the segment). Basis `error_rate_down_and_new_files`.
6. None, reason `no rule fired: {window_calls} calls, {errors_now} errors, {checkpoints} checkpoints`.

### 3.4 `sentence(state, names=False)`

Pure, reads only `state`; verdict first, then activity. `N` = `plain.spoken`, `O` = `plain.ordinal`, nouns from `plain.ROLE_NOUN`.

| when | sentence |
|---|---|
| circling, consecutive failures | `Stuck on the same failing command for {N(minutes)} minutes` (from the run's first failure) |
| circling, churn / repeat | `Going back and forth on one {role} file, {O(churn_writes)} pass` / `Running the same step over and over, {N(repeats)} times` |
| lost | `Editing {N(blind)} files it has not read yet` |
| done | `Finished, with {N(files)} files changed`, or `Finished, with a commit` |
| waiting_on_you | `Waiting on you`, plus ` for {N(m)} minutes` from one minute |
| reading | `Reading {noun}`: 1 distinct file one, 2 many, 3+ collective (`Reading your test suite`) |
| editing | `Rewriting one {role} file, {O(attempt)} attempt` from attempt 2, else `Editing {one or many}` |
| testing | `Running {collective}` (`Running your test suite`) |
| running / searching / delegating | `Running a command` / `Searching the codebase` / `Handing work to {N(n)} helper agents` |
| thinking / idle | `Thinking about the next step` / `No new output for {N(m)} minutes` |

`names=True` (LOCAL) swaps the file noun for the basename (`Rewriting auth.py, third attempt`) and a command for its first word (`Running npm`) from
`state["names"]`; without that key it renders the `names=False` sentence exactly.

### 3.5 `eta` `{elapsed_s, typical_s, p25_s, p75_s, remaining_s, n, basis, reason}`

`elapsed_s` is the live cut's `active_seconds` (attended plus autonomous so far). Similar sessions: `history` facts with `f.repo == repo` and
`f.unattended == unattended`, durations `f.active_seconds` (the same clock). Survivors are durations of at least `elapsed_s`: a run already 22 minutes
in is only like runs that lasted 22 minutes. With `n = len(survivors) >= ETA_MIN_SESSIONS`: `p25, typical, p75 = statistics.quantiles(survivors, n=4,
method="inclusive")`, `remaining_s = max(0, round(typical - elapsed_s))`, basis `finished_sessions_same_repo_that_ran_at_least_this_long`. Refusals
leave the numbers None: repo None "the repository this session runs in could not be resolved"; "{k} finished sessions on this repository, 10 needed";
"{n} finished sessions on this repository ran at least {feedback._mins(elapsed)}, 10 needed". MEASURED active minutes p25/p50/p75: RideGT (148)
9.0/20.9/44.1; builder has 5 sessions, so a builder session refuses.

### 3.6 `decisions` `[{kind, ts, evidence: {event_n, count}}]`

Shell rules read `Ev.text`, which the digest cuts at 160 characters, so each is a lower bound exactly like commit counts.

| kind | rule |
|---|---|
| `force_pushed` | shell `\bgit\s+push\b.*\s(--force(-with-lease)?\|-f)\b` |
| `deleted_test` | shell `\b(git\s+)?rm\s` with a later token whose `role_of` is `test` or whose last component is `tests` or `__tests__` |
| `weakened_test` | a write to a `test` role file with `removed > added`, after a failing test run (`TEST_CMD` call then `result_error`) and before the next test run, with no `source` write between |
| `skipped_hook` | shell `\bgit\s+(commit\|push)\b.*--no-verify\b` or `\bHUSKY=0\b` |
| `reverted_changes` | shell `\bgit\s+(checkout\s+--\s\|checkout\s+\.(\s\|$)\|restore\b\|reset\s+--hard\b\|revert\b\|clean\s+-\w*f)` |
| `abandoned_plan` | a second `ExitPlanMode` call in one segment after at least one write since the first |
| `changed_schema` | a write to a `migration` role path, or a basename matching `^schema\.\|\.(prisma\|graphql\|proto)$` |
| `removed_dependency` | shell `\b(npm\s+(uninstall\|remove\|rm)\|(pnpm\|yarn\|bun)\s+remove\|pip3?\s+uninstall\|(uv\|poetry\|cargo)\s+remove)\b` |
| `added_dependency` | shell `\b(npm\|pnpm\|yarn\|bun)\s+(add\|install\|i)\s+(?!-)[@\w]\|\bpip3?\s+install\s+(?!-[re]\b)\w\|\b(uv\|poetry\|cargo)\s+add\b\|\bgo\s+get\b\|\bgem\s+install\b` |
| `switched_approach` | `git switch -c` or `git checkout -b` after a write in the segment, or a write to a path not written before a `reverted_changes` in the same segment |

One entry per kind (first occurrence; `count` = occurrences), ranked in the table's order (UNMEASURED JUDGEMENT CALL: how hard each is to undo), then
by ts, cut to `MAX_DECISIONS`. CLI sentences: `Force pushed over the remote history.`, `Deleted a test file.`, `Cut lines from a failing test.`,
`Skipped the commit hooks.`, `Threw away uncommitted changes.`, `Dropped its plan and made a new one.`, `Changed the database schema.`, `Removed a
dependency.`, `Added a dependency.`, `Started over on a different approach.` With names, `detail` (LOCAL) holds the package token or basename: `Added
redis.`

### 3.7 `needs_you` `{score, reason}`

Mission control sorts by `score` desc, then `since_s` desc, then session id. First matching reason; integers clamped to 0..100; every constant an
UNMEASURED JUDGEMENT CALL; the ordering is the claim and the tests pin it.

| reason | when | score |
|---|---|---|
| `waiting_for_input` | verdict `waiting` | `80 + min(20, since_s // 60)` |
| `circling` | verdict `circling` | `60 + min(20, stuck_s // 60)`, `stuck_s` from the run's first failure or repeat |
| `lost` | verdict `lost` | `55 + min(20, 5 * blind_edits)` |
| `error_loop` | `error_loop` among the window's causes | `50 + min(20, 3 * errors_now)` |
| `idle` | activity `idle` | `35 + min(20, since_s // 60)` |
| `finished_unreviewed` | verdict `done` | `30 + min(20, since_s // 120)` |
| `running_fine` | otherwise | `5` |

### 3.8 `map` and `timelapse`

`map.files`: one row per distinct path: `{id, role, depth, dir_id, reads, edits, last_read_ts, last_edit_ts}`. `base` is `repo` when the path is under
it, else `os.path.commonpath` of every session path. `id = hashlib.sha1(f"{salt}\0{relpath}".encode()).hexdigest()[:16]`; `dir_id` the same over the
relative dirname (`""` at the base); `depth` the relpath's directory count, None outside the base. Reads are `READ_TOOLS` events, edits
`patterns._wrote` events. Relative paths give one file one id across worktrees of a repository. `names` (LOCAL): `{id: relpath}`.

`timelapse`: `[[t_offset_s, file_id, kind]]`, kind enum `read, edit, fail`, from every read, write and path carrying `result_error`, whole seconds
from the first event. Above `MAX_FRAMES`, cut `[t_first, t_last]` into 600 equal bins and keep per bin the frame with the highest priority (edit 3,
fail 2, read 1), ties to the latest; empty bins emit nothing.

### 3.9 Finding the live session and its history

`live_transcripts`: `capture.discover.iter_root_transcripts(root)` (the allowlist on path shape, CLAUDE.md "Globbing") filtered to `now -
path.stat().st_mtime <= LIVE_MTIME_SEC`. `current_session`: `capture.sessions.sessionize_sources([capture.sessions.load_source(t)], tz, now=now)`, the
last session when `state == "live"`, else None. The caller then passes `session.events`, `burn.turns_for_window({r["path"] for r in session.records},
session.started_at, now)` (5.3), `active_seconds = session.attended + session.autonomous`, `unattended = session.presence == 0`, `repo =
session.repo.common_root if session.repo else None`, `session_id = session.client_session_id`. History is `__main__._corpus_facts(history_root)[0]`,
the one place the corpus is cut. Privacy: WIRE: activity, verdict, eta, decisions without `detail`, needs_you, map rows, timelapse, sample. LOCAL: `names`, `detail`, any
`sentence(names=True)`. `wire(state)` drops `names`, `sentence` and every `detail`. The salt never leaves the machine (section 7).

## 4. `analysis/vocab.py`: glossary, titles, stack (C)

```python
@dataclasses.dataclass(frozen=True)
class Term: id: str; word: str; definition: str; paths: tuple = (); commands: tuple = (); tools: tuple = ()
            roles: tuple = (); kinds: tuple = (); errors: tuple = ()
CATALOG: tuple[Term, ...]; STACK: tuple[StackItem, ...]
def glossary(sessions: Sequence[patterns.SessionEvents]) -> dict
def session_title(session: patterns.SessionEvents, *, names: bool = False) -> dict
def stack(sessions: Sequence[patterns.SessionEvents], *, dependencies: Sequence[str] = ()) -> dict
def wire(result: Mapping) -> dict
```

### 4.1 Detectors and the glossary

A term matches an event when any detector does: `paths`, lowercase globs via `fnmatch.fnmatchcase` on the lowercased posix path of a tool event;
`commands`, `re.search(rx, e.text, re.I)` on a `SHELL_TOOLS` event; `tools`, `fnmatchcase` on `e.tool`; `roles`, `plain.role_of(e.path)`; `kinds`,
`e.kind`; `errors`, `re.search` on a `result_error` event's text. `glossary` returns `{"terms": [{id, word, definition, first_seen_ts, sessions,
count}], "locked_count", "catalog_size"}`, unlocked terms only, ordered by `first_seen_ts`; all WIRE, every string from the catalog. `word` equals the
id with `_` as a space unless the table says otherwise. `T` is `quality.TEST_CMD`.

| id (word) | definition | detectors |
|---|---|---|
| commit | A saved snapshot of your code with a note saying what changed. | cmd `\bgit commit\b`; tool `commit` |
| branch | A separate line of work you can merge back later. | cmd `\bgit (checkout -b\|switch -c\|branch)\b` |
| merge | Combining the changes from one branch into another. | cmd `\bgit merge\b` |
| rebase | Replaying your commits on top of newer work so history stays straight. | cmd `\bgit rebase\b` |
| diff | The exact lines that changed between two versions. | cmd `\bgit diff\b` |
| stash | Setting unfinished changes aside without committing them. | cmd `\bgit stash\b` |
| revert | A new commit that undoes an earlier one. | cmd `\bgit revert\b` |
| cherry_pick | Copying one commit from another branch onto yours. | cmd `\bgit cherry-pick\b` |
| worktree | A second checkout of the same repository in another folder. | cmd `\bgit worktree\b`; path `*/worktrees/*` |
| pull_request | A proposed change others can review before it lands. | cmd `\bgh pr\b` |
| force_push | Replacing the shared history with yours. | cmd `git push.*(--force\|\s-f\b)` |
| git_hook | A script git runs by itself before a commit or push. | path `*/.husky/*`, `*.pre-commit-config.yaml`; cmd `--no-verify` |
| test_suite | The whole collection of automated checks for your code. | cmd `T` |
| unit_test | A small automated check of one piece of code. | role `test` |
| fixture (test fixture) | Saved sample data a test runs against. | path `*fixtures*`, `*/conftest.py` |
| snapshot_test | A test that compares output with a saved copy. | path `*__snapshots__*`, `*.snap` |
| end_to_end_test | A test that drives the whole app the way a person would. | path `*e2e*`, `*.maestro/*`; cmd `\b(playwright\|cypress\|detox\|maestro)\b` |
| mock | A stand in for a real dependency while a test runs. | path `*mock*` |
| coverage (test coverage) | How much of your code the tests actually run. | cmd `(--cov\b\|\bcoverage\b\|\bc8\b\|\bnyc\b)` |
| type_check | A pass that proves values have the shapes the code expects. | cmd `\b(tsc\|mypy\|pyright)\b` |
| linter | A tool that flags suspicious or messy code. | cmd `\b(ruff check\|eslint\|flake8\|pylint\|swiftlint)\b` |
| formatter | A tool that rewrites code into one consistent style. | cmd `\b(prettier\|black\|ruff format\|gofmt\|swift-format)\b` |
| ci (continuous integration) | Checks that run on a server every time you push. | path `*/.github/workflows/*`, `*.gitlab-ci.yml`; cmd `\bgh (run\|workflow)\b` |
| dependency | Someone else's code your project pulls in. | role `dependency` |
| lockfile | A file pinning the exact version of every dependency. | path `*/{name}` for each of `languages.GENERATED_NAMES`, lowercased |
| package_manager | The tool that installs and updates dependencies. | cmd `\b(npm\|pnpm\|yarn\|bun\|pip3?\|uv\|poetry\|cargo)\s+(install\|add\|i)\b` |
| build | Turning source code into something that runs. | cmd `\b(run build\|swift build\|cargo build\|go build\|xcodebuild\|eas build\|vite build\|next build)\b` |
| bundler | A tool that packs many source files into a few for shipping. | path `*/vite.config.*`, `*/webpack.config.*`, `*/metro.config.*`; cmd `\b(webpack\|esbuild\|rollup)\b` |
| monorepo | One repository holding several projects side by side. | path `*/pnpm-workspace.yaml`, `*/turbo.json`, `*/lerna.json`, `*/nx.json` |
| virtualenv (virtual environment) | A private folder of Python packages for one project. | path `*/.venv/*`; cmd `\b(python3? -m venv\|uv venv)\b` |
| env_var (environment variable) | A setting handed to a program from outside its code. | path `*/.env*`; cmd `\bexport [a-z_]+=` |
| secret | A password or key that must never be committed. | cmd `\[redacted\]` (the digest's mask fired) |
| module | One file or folder of code with a single job. | path `*/__init__.py`, `*/index.ts`, `*/mod.rs` |
| api (API) | The doorway other programs use to talk to yours. | path `*/api/*`, `*openapi*` |
| endpoint | One address in an API that answers one kind of request. | path `*/routes/*`; cmd `\bcurl\b.*https?://` |
| schema | The agreed shape of your data. | path `*schema*`, `*.prisma`, `*.graphql`, `*.proto` |
| migration | A script that changes the database's shape one step at a time. | role `migration`; cmd `\b(alembic\|prisma migrate\|supabase migration)\b` |
| database | Where your app keeps data between runs. | cmd `\b(psql\|sqlite3\|mysql\|mongosh\|redis-cli)\b`; path `*.sqlite`, `*.db` |
| query | A question you ask the database. | path `*.sql`; cmd `\bselect\b.+\bfrom\b` |
| rls (row level security) | Database rules that decide which rows each person can see. | cmd `(row level security\|create policy)`; path `*rls*`, `*polic*` |
| orm (ORM) | A library that lets code treat database rows as objects. | path `*/models.py`, `*prisma*`, `*drizzle*` |
| cache | A fast copy of data kept close so you do not fetch it twice. | path `*cache*` |
| queue | A line of jobs waiting for a worker to pick them up. | path `*queue*`, `*worker*`, `*/jobs/*` |
| webhook | A message another service sends your app when something happens. | path `*webhook*` |
| cron_job | A task that runs on a schedule. | path `*cron*`; cmd `\bcrontab\b` |
| auth (authentication) | Proving who someone is before letting them in. | path `*auth*`, `*login*`, `*signin*`, `*oauth*` |
| jwt (JWT) | A signed token that proves who is making a request. | path `*jwt*`; cmd `\bjwt\b` |
| cors (CORS) | Browser rules for which sites may call your server. | path `*cors*`; cmd `\bcors\b` |
| rate_limit | A cap on how often something may be called. | path `*rate*limit*`, `*throttl*` |
| container | A packaged copy of your app and everything it needs to run. | path `*/dockerfile`, `*docker-compose*`; cmd `\b(docker\|podman)\b` |
| deploy | Putting a new version where people can reach it. | cmd `\b(railway up\|vercel\|fly deploy\|wrangler deploy\|eas submit\|eas update)\b` |
| server | A program that waits for requests and answers them. | cmd `\b(uvicorn\|gunicorn\|flask run\|npm run dev\|bun run dev\|npm start)\b` |
| port | A numbered door on a machine that a server listens on. | cmd `(localhost:\d+\|--port\b\|lsof -i)` |
| process | One running program, with its own number. | cmd `\b(ps aux\|pkill\|kill -9)\b` |
| log | A running record of what a program did. | path `*.log`; cmd `\b(tail -f\|journalctl\|log stream)\b` |
| stack_trace | The chain of function calls that led to an error. | error `(Traceback \(most recent call last\)\|^\s+at \S+ \()` |
| ssh (SSH) | A secure way to run commands on another machine. | cmd `\bssh\b` |
| shell_script | A file of terminal commands run in order. | path `*.sh` |
| makefile (Makefile) | A file of named build steps. | path `*/makefile`; cmd `^\s*make \w` |
| simulator | A pretend phone on your computer for trying an app. | cmd `\b(xcrun simctl\|emulator -avd\|adb)\b` |
| subagent | A helper agent your agent hands a piece of work to. | tool each of `burn.TASK_TOOLS` |
| mcp (MCP server) | A plugin that gives your agent new tools. | tool `mcp__*` |
| web_search | Your agent looked something up on the web. | tool `WebSearch`, `WebFetch`, `google_web_search`, `web_fetch` |
| regex | A pattern for matching text. | tool `Grep`, `grep_search`; cmd `^\s*(grep\|rg)\b` |
| glob | A wildcard pattern for matching file names. | tool `Glob`, `glob` |
| compaction | Summarising a long conversation so it still fits. | kind `compaction` |
| heredoc | Writing a whole file straight from the terminal. | cmd `<<\s*-?['"]?\w+` |
| patch | A set of line changes applied to files in one go. | tool `apply_patch`; cmd `\bgit apply\b` |
| symlink | A file that points at another file. | cmd `\bln -s\b` |
| permissions (file permissions) | Who may read, change or run a file. | cmd `\bchmod\b` |
| feature_flag | A switch that turns a feature on or off without shipping code. | path `*feature*flag*`, `*/flags.*` |
| type_definitions | A file describing the shapes values can take. | path `*.d.ts`, `*.pyi`, `*/types.ts` |

72 terms. Tests: unique ids, at least 60, one line definitions ending in a full stop with no dash, every regex compiles, every glob lowercase.

### 4.2 `session_title` `{title, verb, object, count, basis}`

`verb` and `object` are enums, `count` an int or None. From one session: writes (`patterns._wrote`) and their roles, lines added and removed, commits
(`patterns._committed`), tests (`patterns._tested`), recoveries (`quality.recoveries([s])`), reads (`READ_TOOLS`), the worst failure run
(`feedback._worst_failure_run`), modules (distinct parent directories of written files). `{role}` is the role with the most lines (most reads for
`explored`); `N` is `plain.spoken`. First match:

| verb | when | title |
|---|---|---|
| debugged | recoveries at least 1 | `Debugged a failing test suite` |
| wired | a written file has role `migration` | `Wired a database migration` (`Wired {N} database migrations`) |
| refactored | 5+ files, removed at least half of added, 20+ added (UNMEASURED JUDGEMENT CALL) | `Refactored {N(files)} files across {N(modules)} modules` |
| shipped | 1+ commits and lines added | `Shipped a change to one {role} file` / `Shipped changes to {N} {role} files` |
| tested | 3+ test runs and test role lines at least half of lines added | `Built out {N} test files` |
| built | 100+ lines added | `Built out {N} {role} files` |
| explored | no writes, 8+ reads (the `investigated` cause's floor) | `Read through {N} {role} files` |
| worked_through | failure run reaches `patterns.STUCK_FAILURES` | `Worked through a stubborn failure` |
| edited / looked_around | any write / otherwise | `Edited {N} {role} files` / `Looked around the codebase` |

`names=True` (LOCAL) appends ` in {basename of the most common parent directory}`. `names=False` titles are WIRE-safe; the contract already has
`title_source: "template"`, which a later contract change could point at them.

### 4.3 `stack` `{"items": [{id, name, category, first_seen_ts, sessions, evidence}]}`

Category enum `language, framework, database, infra, testing, tooling, service`; evidence enum `manifest, language, command, path, tool` (the first
that fired, in that order). Only catalog ids and names are emitted: the strings from `shipped.stack_evidence(root)` are matched and dropped.
`first_seen_ts` and `sessions` come from event evidence; manifest-only items have `first_seen_ts` None and `sessions` 0. Languages are
`languages.split(sessions)["languages"]` names. Catalog (`m:` lowercased manifest names, `*` a prefix; `c:` command regex; `p:` path glob; `t:` tool
glob):

- language: python, typescript, javascript, swift, kotlin, go, rust, ruby, java, sql, shell, dart, cpp, csharp, php, mapped from the
  `languages.EXTENSIONS` names.
- framework: react `m: react`; react_native `m: react-native`; expo `m: expo, expo-*`; nextjs `m: next`; fastapi `m: fastapi`; django; flask; express;
  tailwind `m: tailwindcss, nativewind`; vue; svelte; reanimated `m: react-native-reanimated`; swiftui `p: *view.swift` (a bare id means `m:` of that
  id).
- database: postgres `m: psycopg, psycopg2*, asyncpg, pg, postgres; c: \bpsql\b`; sqlite `m: better-sqlite3, expo-sqlite; c: \bsqlite3\b`; redis `m:
  redis, ioredis; c: redis-cli`; mongodb `m: mongodb, mongoose; c: mongosh`; mysql `m: mysql2, pymysql`.
- infra: docker `p: */dockerfile; c: \bdocker\b`; railway `p: */railway.*; c: \brailway\b`; vercel `p: */vercel.json; c: \bvercel\b`; cloudflare `p:
  */wrangler.*; c: \bwrangler\b`; aws `m: boto3, @aws-sdk/*; c: \baws\s`; github_actions `p: */.github/workflows/*`; eas `p: */eas.json; c: \beas\s`;
  fly `p: */fly.toml; c: \bfly(ctl)?\s`.
- testing: pytest `m: pytest; c: \bpytest\b`; jest `m: jest; c: \bjest\b`; vitest; bun_test `c: \bbun test\b`; playwright `m: playwright,
  @playwright/test`; xctest `c: \bswift test\b; p: *tests.swift`; cypress; maestro `p: *.maestro/*; c: \bmaestro\b`.
- tooling: git `c: \bgit\s`; bun `p: */bun.lock; c: \bbun\s`; npm `p: */package-lock.json; c: \bnpm\s`; uv `p: */uv.lock; c: \buv\s`; ruff `m: ruff;
  c: \bruff\b`; eslint; prettier; make `p: */makefile`; xcode `c: \bxcodebuild\b; p: *.xcodeproj*`.
- service: posthog `m: posthog*` (its `t: mcp__*posthog*` is removed: see "Deviations (review fixes)"); stripe; sentry `m: @sentry/*, sentry-sdk`; openai; anthropic `m: anthropic, @anthropic-ai/sdk`;
  supabase `m: @supabase/*; c: \bsupabase\s; p: */supabase/*`; firebase `m: firebase*`; mapbox `m: @rnmapbox/maps, mapbox-gl`.

## 5. Fixes (D)

### 5.1 `burn.explain` names the dominant cause

MEASURED on the live transcript: the 9.1M token spike lists subagent_fanout (4), error_loop (4) and context_replay (93% of the segment), and `explain`
read `causes[0]`, so it blamed "4 helper agents". The helpers' tokens live in sidecars and are in no burn number (root transcripts only; this Claude
Code version's async `Agent` results carry no `totalTokens`), so the sentence blamed a cost the number does not contain.

`Turn` gains `tool_ids: list[str]` (Claude Code `tool_use.id`, Codex `call_id`, Gemini `toolCalls[].id`). `Segment.attribution() -> dict[str, int]`
gives, per present cause, the tokens it can claim out of `self.tokens`: context_replay, the sum of `t.cache_read`; compaction, `t.fresh` of the first
turn at or after each compaction event; subagent_fanout, `t.fresh` of turns whose `tool_ids` include a `TASK_TOOLS` call; error_loop, `t.fresh` of
turns issuing a call answered by `result_error`; repeated_call, `t.fresh` of turns issuing the second and later copies of the top `_max_repeat`
signature; file_churn, `t.fresh` of turns issuing the second and later writes to the churned path; investigated, `t.fresh` of turns issuing
`READ_TOOLS` calls. Each `causes()` entry gains `tokens` and `share` (3 dp); `causes()` keeps its order, so existing tests hold.
`Segment.dominant_cause()` is the entry with the most tokens, ties to list order, and `_segment_row` adds `dominant`. `explain` reads
`row["dominant"]`: `The most expensive stretch cost {cost} tokens, {share:.0%} of it {phrase}, and {verdict}.`, verdict `nothing was written` or `it
wrote {n} lines`. `_CAUSE_SENTENCES` becomes the phrase table: context_replay `re-reading the conversation so far`; subagent_fanout `on the turns that
handed work to {n} helper agents`; error_loop `on {n} failing tool calls and the retries after them`; repeated_call `on running the same command {n}
times`; file_churn `on rewriting the same file {n} times`; compaction `on rebuilding the context after it was summarised`; investigated `on reading
{n} files`. Test: a spike with 7 Task calls and 90% cache reads names re-reading.

### 5.2 Codex and Gemini adapters for `load_turns`

`load_turns(path)` dispatches on `digest.detect_harness(path)`: `claude_code` to the current body (`_claude_turns`), `codex` to `_codex_turns`,
`gemini` to `_gemini_turns`, anything else `[]`. `USAGE_READERS = frozenset({"claude_code", "codex", "gemini"})`.

`_codex_turns`: iterate `codex.scan(path).records` sorted by (ts, line); the model is the latest `turn_context.payload.model`; `function_call`,
`custom_tool_call` and `local_shell_call` items since the previous usage record are the turn's tools. Each `token_usage_record` is one Turn, deduped
on `payload.response_id`: `cache_read = cached_input_tokens`, `cache_create = cache_write_input_tokens`, `input_tokens = max(0, input_tokens -
cached_input_tokens - cache_write_input_tokens)`, `output_tokens = output_tokens`. Cached inside input and reasoning inside output are VERIFIED
(`total_tokens == input_tokens + output_tokens` on 6 of 6 records of `spec/fixtures/codex/real_tools_mock_model.jsonl`); cache writes inside input is
ASSUMED (zero in every fixture). So `Turn.total == total_tokens`; mismatches are counted, never raised. A rollout with no usage record falls back to
`event_msg/token_count` events whose `info.total_token_usage.total_tokens` strictly grew, reading `info.last_token_usage` with ids `tc{n}` (an
unchanged `info` is a rate limit refresh, codex.py docstring). Test: 6 turns, total 7,635, cache reads 2,500.

`_gemini_turns`: one Turn per `gemini` message in `gemini.scan(path).messages` (one per id, later copies win, rewinds applied) with a `tokens` dict:
`cache_read = cached`, `input_tokens = max(0, input - cached) + tool`, `output_tokens = output + thoughts`, `cache_create = 0`, model `msg.model`,
tools from `toolCalls`. ASSUMED from the Gemini API's usage metadata and consistent with `spec/fixtures/gemini/synthetic_session.jsonl` (12,110 =
12,000 + 30 + 80 with 8,000 cached); the repo holds no token carrying recording from the real writer. Test: 4 turns totalling 51,862 where the naive
line sum is 75,042. Found on the way: `burn_report` tells a Cline or opencode user "this harness does not write token counts to disk", and both do. Outside
`USAGE_READERS` the missing line is `burn forensics does not read {harness} token counts yet` and `explain` says `Cost is not shown for this tool
yet.`

### 5.3 `barren_token_share` across the corpus

`burn.turns_for_window(paths, start, end) -> list[Turn]`: `load_turns` per path (each deduped on message id alone, the ledger's `(source_id,
message.id)` rule), kept when `start <= ts <= end`, sorted. `burn.session_burn(events, turns) -> tuple[int, int] | None`: `(segment tokens, tokens in
barren segments)` from `segments`, None unless `records_usage(turns)`. `SessionFact` gains `burn_tokens: int | None = None` and `barren_tokens: int |
None = None` through `session_fact_from_events`. `corpus_profile` adds `m["barren_token_share"]` over facts with `burn_tokens` not None: with
`MIN_SESSIONS`+ and a positive total, `round(barren/total, 3)`, unit `share`, basis `burn_segments_that_changed_nothing`, extras `barren_tokens,
tokens`; else None with "no session reported token counts" or "{k} sessions with token counts, 3 needed". Fact `{pct} of your tokens went into
stretches where nothing was written`, unusualness 0.25 (UNMEASURED JUDGEMENT CALL, the `peak_hour` device; no baseline invented). The integrator fills
the fields in `_corpus_facts`, memoising `load_turns` per path. MEASURED: 31.6% (1.31B of 4.14B tokens; 152 of 153 sessions report usage).

### 5.4 `longest_streak_days` counted unattended runs

`longest_run(sorted({s.local_day for s in ss if is_attended(s)}))`, basis `local_days_at_04h_attended`, fact text `{n} days in a row with a session you were
at`. MEASURED: 21 before, 11 after: unattended runs on ten days were bridging gaps, which CLAUDE.md says they can never do. `sample.days` stays "days
built". Test: attended days 1 and 3, unattended day 2, streak 1.

### 5.5 The five Paxel anchored `BASELINES`

`planning_ratio` becomes 2.5, source "MEASURED on the container corpus: 20 prose first against 8 tool first over 28 prompts (profile.py docstring);
one person, a small sample". `code_velocity` becomes 523, source "MEASURED in the proof database: 2,300 transcript lines over 4.4 active hours across
seven sittings (profile.py docstring)". `steer_rate` 0.4, `autonomy_score` 0.82 and `avg_prompt_chars` 156 keep their values with source "UNMEASURED:
Paxel landing page example copy, not a measurement". Scales unchanged. `ARCHETYPE_RULES` keeps 2.4 and 487 for architect and velocity_machine (moving
a threshold moves people's archetypes) and their `source` gains the same UNMEASURED prefix. Test: no source starts with "Paxel"; each starts with
MEASURED or UNMEASURED or states its derivation.

### 5.6 `contributions`

`_streaks` compared `days[-1]` with `local_day(now, 0)`, a UTC day against days cut at the person's offset, and read the wall clock inside a pure
function. It becomes `_streaks(days, today: dt.date)` (required; longest from `profile.longest_run`), and `split(..., now: float | None = None)` passes
`today = local_day(now or time.time(), tz_offset_minutes)`; the existing `Streaks` tests pass unchanged. `contributions.local_day` is a second copy of
`profile.local_day` and becomes `from .profile import local_day`.

### 5.7 Recorded, not fixed (capture/ is out of bounds)

`unattended` has two definitions: `presence == 0` in `__main__._corpus_facts` and `capture/cli.py`, and `presence == 0 and active >=
NOTABLE_MIN_ACTIVE_SEC` in `capture/sessions.build_payload`. `is_attended` is right under both, because a sitting with no presence has zero attended
seconds. The one definition belongs beside `is_counted` in `capture.sessions`, in a later workflow.

## 6. Tests and fixtures

No checked-in fixtures: transcripts are built by code in a temp dir, so none can drift from its builder, and the real corpus stays out of git.

- `tests/transcripts.py` (B, first): `T0`, `iso(s)`, `prompt(t, text, source="typed")`, `interrupt(t)`, `say(t, mid, text, stop="end_turn",
  usage=None)`, `calls(t, mid, [(tid, name, input)], usage=None)` (stop `tool_use`), `result(t, tid, content, is_error=False, tur=None)`,
  `write_transcript(records, root=None) -> Path` (as `<root>/<projdir>/<uuid>.jsonl`). Scenario builders: `starting`, `converging`,
  `circling_failures`, `circling_churn`, `lost`, `waiting_question`, `done_after_commit`, `pending_long_tool`, `decisions_all`, `blind_codex_like`
  (edits and no `Read`: `lost` must not fire).
- `tests/corpus_fixture.py` (A): parallel `SessionFact` and `SessionEvents` lists built in memory through `profile.session_fact_from_events`, with
  sentinel words in prompts, paths and commit subjects.
- `test_wrapped.py`: 15 ids in order, one key set, refusals null with reasons, no dashes, a digit in every sentence, generalist names its closest
  rule, an unattended day never bridges a streak, idle credit never creates concurrency, a prompt repeated inside one session is not a go to prompt,
  slash commands, pasted tracebacks and `[redacted]` prompts are never quoted, crash out ties go to the earliest, hashes, URLs and 20 character tokens
  are never cryptic, kind of work refuses at 9% and answers at 60% over 20, the fallback basis is named, quotes only with `quotes=True`, sentinels
  absent from `wire()`.
- `test_live.py`: every scenario's verdict; `idle` for a pending tool and `waiting_on_you` from `end_turn`; attempt counting; exact sentences; no
  basename in a `names=False` sentence; ETA refusal below 10 and the survivor median; each decision kind and the cap in significance order; needs_you
  order waiting, circling, lost, error_loop, idle, finished, running; ids change with the salt and not with the worktree; at most 600 deterministic
  frames.
- `test_plain.py`: `role_of` for one path per role plus `spec/strip.v1.json` (config, not test); `spoken`, `ordinal`, `has_dash`. `test_vocab.py`: the
  4.1 catalog checks, unlock counts and `locked_count`, exact titles per rule, only catalog ids in `stack`, no manifest string in the output.
- D extends `test_burn.py`, `test_profile.py` and `test_contributions.py` (fixed `today`) as section 5 lists.

Each implementer runs `cd ~/Downloads/projects/builder-overnight && python3 -m unittest discover -s analysis/tests -t .` before
handing over; the count only goes up from 546.

## 7. CLI (the integrator, in `analysis/__main__.py`)

```text
python -m analysis wrapped [ROOT] [--json] [--quotes]                                  ROOT defaults to ~/.claude/projects,
python -m analysis live [TRANSCRIPT] [--root ROOT] [--history ROOT] [--json] [--names]  like every other subcommand
python -m analysis vocab [ROOT] [--json]
```

`wrapped`: `facts, sessions = _narrative_inputs(root)`; `wrapped.wrapped(facts, sessions, profile=corpus_profile(facts),
contributions=_corpus_contributions(facts), fanout=_corpus_fanout(root), commit_subjects=_commit_subjects(roots, since), quotes=a.quotes)`, where
`_commit_subjects` is `_commit_messages` without its 40 cap, over every root. Text: per card the question, then display and sentence, or `not yet:
{reason}`; quotes print only under `--quotes`; `--json` prints the dict (`quotes` stays `{}` without the flag).

`live`: a `TRANSCRIPT` is one file; `--root` takes every `live_transcripts(root, now)` whose `current_session` is live, ordered by `needs_you.score`
(mission control's order). `--history` defaults to `--root`, or the transcript's grandparent. The salt is
`capture.identity.sha256_hex("builder-map-salt:" + capture.identity.raw_machine_identifier())`: derived from the raw identifier, never equal to the
uploaded `machine_id`, never printed. Text: sentence, verdict with evidence, ETA or its refusal, decisions, needs_you; `--names` switches to the LOCAL
variants.

`vocab`: `_narrative_inputs(root)`; `glossary(sessions)`; `stack(sessions, dependencies=[d for r in roots for d in shipped.stack_evidence(r)])`; the
last ten `session_title`s. Text lists unlocked terms with definitions, then `{locked_count} more to find`.

Manual checks with what to expect: `wrapped ~/.builder-overnight/corpus` gives builder_type Quality guardian, shipped 64,652 lines, streak 11,
kind_of_work on the file role fallback; `burn` on the live transcript names re-reading in the spike sentence; `live` on it gives a verdict and, for
builder, an ETA refusal; `vocab ~/.builder-overnight/corpus` unlocks at least commit, test_suite and migration.

## Deviations (fixes)

D, 2026-09-13. Each is the option most consistent with CLAUDE.md where section 5 was silent or would print a wrong sentence.

- **`repeated_call` names the tool that repeated.** MEASURED on the real corpus (940 segments): the cause fired in 41, and in 38 the repeated
  "call" was an Edit or Read whose digest text is only its path (1 was a shell command). So the entry gains `tool`, and the phrase is chosen by it:
  shell keeps `on running the same command {n} times`; edit tools `on editing the same file {n} times`; read tools `on reading the same file {n}
  times`; anything else `on making the same tool call {n} times`. Detection is unchanged, so `live.py` sees the same causes.
- **A cause that claims 0 tokens is never dominant** (`dominant_cause()` is None). With no dominant cause the spike sentence is `The most expensive
  stretch cost {cost} tokens, and {verdict}.` Only `spikes[0]` is ever called the most expensive: the old loop walked down to the first spike with a
  cause and printed that spike's cost under the first one's name.
- **Verdicts never say "wrote 0 lines".** A segment that produced work with no added lines reads `it removed {n} lines`, `it changed {n} files` (a
  `sed -i`: a path, no count; true only since the review made `patterns._touched` the one rule) or `it made {n} commits`; counts are singular at one and use thousands separators. A positive share that rounds to 0% is
  `under 1%`, and the sentence's share is computed from the unrounded claim (rounding twice printed 94% beside the cause detail's 95%).
- **`causes()` `tokens` and `share` are None when the segment carries no tokens**, rather than a 0 that reads as "cost nothing".
- **Refusal wording for a harness in `USAGE_READERS` with no counts** is about the transcript: `this transcript does not record token counts, so cost
  cannot be attributed` and `This transcript does not record token counts, so cost cannot be shown.` Codex and Gemini do write counts; both real
  writer first-record fixtures were killed before a response and have none. MEASURED on this machine: 17 of 127 Claude Code root transcripts carry
  no usage, and all 17 are bookkeeping files with no assistant record at all (`bridge-session`, `ai-title`, `mode` lines), about which "This tool
  does not record token counts" was false.
- **An empty transcript** returns the full report shape (`harness`, `causes`, `median_segment_tokens`, totals with None and a reason) and `explain`
  says `Nothing in this transcript could be read yet, so there is no cost to show.` It used to blame the tool, and `totals: {}` made `_print_burn`
  raise.
- **`burn_report` windows turns as well as events.** Only events were windowed, so every turn after `end` landed in the last segment as its cost.
- **Additive report fields:** `harness`; cause rollup rows gain `attributed_tokens` and `attributed_share` (the existing `tokens` and
  `share_of_session` count whole segments and overlap). For the integrator: `_print_burn` still prints "This harness writes no token counts to disk"
  on every refusal and the overlapping `share_of_session` under WHERE IT WENT; `sample.missing` / `explain` and `attributed_share` are the true ones.
- **`session_burn` is also None with no events** (every token would land in one segment that "changed nothing", a claim about the parser).
  `turns_for_window(..., loader=load_turns)` takes the memoised loader the integrator needs, and reads a path listed twice once. MEASURED over
  `~/.claude/projects` (342 sessions): 49.9 s of `turns_for_window` unmemoised, against 15.6 s for the whole cut plus burn with
  `functools.lru_cache(maxsize=None)(burn.load_turns)` passed as `loader`.
- **`SessionFact` refuses an impossible burn pair** in `__post_init__` (one of the two None, or barren outside 0..burn): ValueError before any
  division. `barren_token_share` with sessions but a zero total refuses with `the sessions with token counts spent none inside a segment, so there is
  nothing to divide`; its `barren_tokens`/`tokens` extras are the measured sums whenever any session reported, None when none did. When no fact
  carries burn fields but some reported token counts (the server's shape: `builder_profile` facts carry `output_tokens_by_model` and can never be
  cut into segments), the refusal is `sessions reported token counts, but none was split into segments, which needs the transcripts`; the doc's
  `no session reported token counts` would be false there, and is kept for the corpus that truly has none.
- **`longest_streak_days` refusals carry reasons** (`no sessions`; `no session had you present, and an unattended run never counts toward a streak`),
  and `longest_run` sorts and deduplicates its input (a repeated day reads as a zero gap and resets the run).
- **`skeptic`'s source also started with "Paxel"**; 5.5 named only architect and velocity_machine, but its own test forbids that prefix, so all three
  carry the label, which lives once as `profile.PAXEL_UNMEASURED`.
- **Gemini turns without a timestamp take the session start**, the rule `gemini._derive` applies to events, restated in `_gemini_turns` because
  `gemini.py` is not D's file and the rule is a closure there. Codex `local_shell_call` is named `shell` with id `call_id or id`, as `codex._derive`
  does. Both adapters count mismatches in an optional `counters` argument.
- **`_claude_turns` counts a `tool_use` block written twice as one call** and type checks `message`, `usage` and `content` (a plain string on 3,299
  records).
- **Not done here:** 5.6 (`contributions.py`) was outside this run's files; `profile.longest_run` and `profile.local_day` are ready for it.
- **Measured after the change** on `~/.builder-overnight/corpus` (now 154 counted sessions): `barren_token_share` 0.316 (1,309,078,925 of
  4,144,271,776 tokens, 153 sessions with counts); `longest_streak_days` 11 over 25 attended days (21 with unattended days included). On the live
  transcript the spike sentence names re-reading: subagent_fanout claims 15,460 of the 12.9M token stretch, error_loop 60,586, context_replay 94.5%.

## Deviations (wrapped)

A, 2026-09-13. Each is the option most consistent with CLAUDE.md where section 2 was silent, contradicted itself, or would print a wrong sentence.

- **Files.** `agents.peak_concurrency` is written in `agents.py` exactly as 1.3 says (the sweep lifted unchanged, `fanout` calls it, `test_agents`
  passes untouched); this run's file list named only `wrapped.py` and `test_wrapped.py`, but 0 assigns the function to A and nobody else writes it.
  `tests/corpus_fixture.py` was not created: the in memory corpus builder (`Sitting`, `corpus`, `rich()`) lives in `tests/test_wrapped.py`, the only
  file that uses it.
- **`_quotable` strips a list marker before looking for code characters.** MEASURED by hand on the corpus (155 counted sessions): the rule as written
  excluded 10 of 932 prompts, and 5 of those were the person's own words, four numbered lists whose `1)` read as code and one message wrapped with
  two leading spaces. Stripping `^\s*(\d{1,2}|[a-zA-Z])[.)]\s+` restores the four and lets no paste through; 6 are excluded now (a terminal paste of
  agent output, a JSON snippet, a masked log, a code paste, a key file path, and the wrapped message, which is the same shape as a terminal paste).
- **`prompt_length` MEASURED 30.3 was taken before the filter.** 30.3 is the mean over all 932 texts; over the quotable texts the rule names it is
  29.2 with the unstripped paste rule and 29.9 with the one above. Median 16 in all three.
- **The generalist's percentage** is `min(round(100 * value / threshold), 99)`: no rule met its threshold, so "100% of the way there" beside "no
  single pattern dominates" would contradict itself. A floor was tried and rejected: float error reads 2.4 / 3.0 as 79.
- **`crash_out` under a minute** says `Sent less than 1 minute into that session.` `feedback._mins` returns `under a minute`, which has no digit, and
  section 2 requires one in every answered sentence.
- **`agents_at_once` says `Up to {k} helper agents ran at the same moment.`**, not `Inside one session, ...`: `_corpus_fanout` sweeps every sidecar
  in the corpus together, so its `max_concurrent` can count helpers from two sittings running side by side. The value is floored at 1 when any
  session has an event (the floor `fanout` puts under `max_concurrent`), because the sweep skips spans under `MIN_OVERLAP_SEC` and would print
  "0 at once" for a sitting that ran. Sessions with no events refuse with `no session recorded an event`.
- **`shipped` refusals are split**: `no sessions` for an empty corpus, `no session carries a line count` when no fact has a lines basis; the
  section's reason stays for the measured zero, which is the case it describes. `+git_log_distinct_commits` is appended to the basis only when
  contributions were passed.
- **Extras gain the numbers their sentences are rendered from**, so the phone can write every sentence from the wire (rule 5): `builder_type`
  `metric`, `metric_value`; `change_course` `interrupts`, `corrective_prompts`; `deep_sessions` `longest_minutes`; `prompts_per_session`
  `tool_calls_per_prompt`; `cryptic_prompt` `length`, `tool_calls_after`, `corrected` (LOCAL with the rest of that card). `streak` extras are counts.
- **`go_to_prompt`**: a text that normalises to nothing (`???`) forms no group; `words` is `len(text.split())` of the quoted original, the digest
  word rule, so the number matches the words the person reads (`_norm` would count `don't` as two); distinct sessions are counted by position.
- **`kind_of_work`**: fewer than 20 labelled subjects has its own reason (`{k} of {n} commit subjects say what kind of change they are, 20 needed`)
  and no subjects says `no commit subjects were read`; the refusal basis is `commit_subject_labels_then_lines_by_file_role`; with one kind or one
  role the second clause is dropped; the sentence's role words are source, test, config, documentation, migration, style, build, dependency, other;
  `n` is labelled subjects on the first basis and attributable lines on the fallback.
- **Wording the section left open**: nouns agree with their numbers (`1 day straight`, `1 line across 1 commit`); the attended floor reads `{k}
  sessions you were present for, 3 needed` on all three cards that have it; the prompt floor reads `{k} prompts typed in your own words, 5 needed`.
  A card whose metric is None with no reason raises: a refusal must say why. `wrapped()` also raises when `facts[i]` and `sessions[i]` carry
  different session ids, not only on a length mismatch.
- **Measured** on `~/.builder-overnight/corpus`, 155 counted sessions: Quality guardian (4.7 test runs an hour); 64,680 lines across 247 commits,
  232 assisted; steering; 3h 06m of 132; 3 at once, 9 helpers; a go to prompt of 2 words in 4 sessions; streak 11 over 20 days with both; 43% (151
  interrupts, 253 corrections, 932 prompts); 29.9 words, median 16; 19 deep sessions averaging 99 minutes; 84.9 hours, 74.5 attended; one 10
  character cryptic prompt; 7.1 prompts a session, 12.1 tool calls a prompt; kind of work on the file role fallback, commit labels refusing at 25 of
  247 (10.1%).

## Deviations (vocab)

C, 2026-09-13. Each is the option most consistent with CLAUDE.md where section 4 was silent, or where a detector as written unlocked a word for
something that did not happen (or could not see what plainly did). MEASURED on `~/.builder-overnight/corpus`: 154 counted sessions, 9,085 shell
calls, 2,139 tool events with a path, 561 failing results. Every changed detector carries its count beside it in `analysis/vocab.py` too.

- **A command detector reads simple commands, not the raw text.** `Ev.text` is put back into lines (` ⏎ `), every heredoc body is skipped through
  `digest._command_lines` (CLAUDE.md, "A heredoc body is DATA"), each line is split at unquoted `;`, `&&`, `||`, `|` and `&` (never inside quotes,
  never `2>&1` or `&>`), and a simple command that only probes for a program (`which`, `whereis`, `type`, `command -v`) or is a comment is dropped.
  An `echo` or `printf` is read only for what it runs inside `$(...)` (`echo "pid: $(adb shell pidof ...)"`): its words are a label. The design's
  anchored regexes now see every command in a chain: `regex` 732 calls in 78 sessions became 2,287 in 136, `makefile` 1 call became 4. Probes and
  labels had credited TransLoc with 4 of its 23 sessions, Docker with 2 of 13, and Maestro, npm, EAS, Valhalla and five terms with one or two
  sessions each, in which none of them ran; no term or item was unlocked by them alone once `coverage` is fixed below.
- **Rules that exist elsewhere are imported and used compiled, as they are**: `commit` is `patterns._COMMIT_CMD` plus `digest.COMMIT_TOOLS`,
  `test_suite` is `quality.TEST_CMD` (case sensitive, its `(?<![\w/.-])` guard intact), `subagent` is `burn.TASK_TOOLS`, `lockfile` is
  `languages.GENERATED_NAMES`. `heredoc` is `digest._HEREDOC`, the opener the digest credits as a shell FILE write, so "Writing a whole file straight
  from the terminal" is true of every unlock: the design's `<<\s*-?['"]?\w+` also matched `python3 - <<'PY'` and the `<<<` here string. 1,734 calls
  in 107 sessions became 292 in 63.
- **Three detectors tightened after false unlocks.** `merge` is `\bgit merge\b(?!-)`: 10 of the design's 25 matching calls were `git merge-base`.
  `coverage` keeps `c8` lowercase (`(?-i:\bc8\b)`): the design's only corpus match was `echo "=== C8: tracksViewChanges ==="`, so coverage now stays
  locked, which is right for a corpus that never measured coverage. `rls` paths are `*[/_.-]rls*`, `*/polic*.sql`, `*/policies/*.sql` instead of
  `*rls*` and `*polic*`, which match every Django `urls.py` and every privacy policy page; the corpus's 3 true matches (this repository's
  `0003_rls.py` and `test_rls.py`) are kept.
- **Paths.** Matched lowercased as posix paths with a leading `/` on a relative one, so a heredoc `cat > Dockerfile` meets `*/dockerfile`. A path
  under the home directory's `.claude/` (Claude Code's memory notes, background jobs, plans) is the harness's, not the project's, for globs and for
  roles: all 48 events that unlocked `queue` through `*/jobs/*` were under `~/.claude/jobs/`, so `queue` is locked now. A repository's own
  `.claude/worktrees/` (six of RideGT's project directories) is still the project.
- **Three detectors widened because the corpus did the thing and the design could not see it.** `log` adds `railway|docker|kubectl|heroku|fly|
  flyctl|vercel|eas logs`, a `tail` of a `.log` file, `adb logcat` and `log show`: the design's three matched 0 calls; the additions 47 calls in 18
  sessions, 90 in 33, 13 in 4, 3 in 2. `endpoint` adds `*/routers/*`, FastAPI's directory: 5 path events in 1 session became 42 in 12.
  `stack_trace` is multiline, so a JavaScript `    at fn (file:1:2)` line after the message can match: 93 failing results in 45 sessions became 96 in
  46.
- **Two glossary terms added, 74 in all**: `monitoring` (130 shell calls in 14 sessions stand up, query or read RideGT's Prometheus and Grafana) and
  `routing_engine` (126 calls in 17 sessions on Valhalla). A test pins the additions to exactly these two.
- **The glossary carries `basis`, `n` and `reason`** (rule 1). No session with an event to read is a refusal: `terms` `[]`, `locked_count` None,
  `reason` `no session had any events to read`. Sessions read with nothing matched are a measured zero (`locked_count` is the catalog size). For the
  integrator: print the reason, not `None more to find`.
- **Titles carry `modules`, `n` and `reason` beside the five design keys.** `modules` is the refactor title's second number, so the phone can render
  every title from the wire. `{role}` renders through `plain.ROLE_NOUN` with `plain.spoken` counts (`Shipped changes to three source files`,
  `Edited the build setup`, `Edited two docs`), not the bare role id (`docs files`, `unknown files`); a refactor inside one directory reads `in one
  module`. `{N}` counts the files OF THAT ROLE: "three source files" must not count the two tests beside them. `tested` needs test role lines above
  zero, or "at least half of lines added" holds vacuously at zero. The top role is most lines, then most files, then `plain.ROLES` order
  (UNMEASURED JUDGEMENT CALL; it only has to be deterministic). `names=True` breaks a tie between directories by first appearance.
- **A title verb added: `committed`** (object `commit`), tried after `shipped`: a sitting whose commits are visible and whose line counts are not is
  `Landed a commit` / `Landed three commits`. MEASURED: 9 of the 47 sittings the design's rules titled "Looked around the codebase" had committed;
  their edits were `python3 - <<'PY'` scripts (1,183 such commands in 88 sessions), which carry no line count anywhere.
- **Three title refusals** (`title`, `verb`, `object` None, with a reason), each of a title that would describe the parser rather than the work: no
  tool calls at all (the design's fallback said "Looked around the codebase"); at least `feedback.MIN_TOOL_CALLS` calls with checkpoints under
  `patterns.MIN_CHECKPOINT_DENSITY` when only `explored` or `looked_around` remain (the bar the session note already uses for "went nowhere");
  writes that name no file. MEASURED on the corpus: shipped 41, looked_around 26, debugged 21, built 20, edited 18, committed 9, tested 2, wired 1,
  refactored 1, refused 15 (2 with no tool calls, 13 the parser could not see into).
- **`EXPLORED_MIN_READS = 8` restates an inline literal** in `burn.Segment.causes` (the `investigated` floor): there is no constant to import. A test
  pins the two together at 8 and 7 reads. If D names the constant, vocab should import it.
- **The stack carries `basis`, `n`, `manifest_names` (a count, never a name), `reason` and `language_reason`** (the split's own refusal). No events
  and no manifest names is a refusal; manifests alone answer with `n` 0. Items are ordered by `CATEGORIES`, then sessions, then catalog order.
- **The stack catalog covers what this corpus is built on.** Added: HTML and CSS as languages (HTML is the fourth language `languages.split` names,
  3,721 agent lines, 5.8%; Markdown, Text and YAML stay off); `sqlalchemy`, `react_native_maps`; `prometheus`, `grafana`, `google_cloud`; `locust`;
  `android_sdk` (68 `adb` calls in 5 sessions), `cocoapods`, `alembic`; `google_maps`, `valhalla` (126 calls in 17 sessions), `transloc` (41 in 19),
  `app_store_connect` (its MCP tools, 6 sessions; removed in review, an MCP server's identity on the wire). Widened: `expo` by its CLI (`npx expo`, 25 calls in 15 sessions), `eas` by `eas-cli` (97 calls in
  22 sessions became 135 in 32), `xcode` by `xcrun` (151 calls in 32 sessions against 3 `xcodebuild`), `docker` by `*/dockerfile.*`, `postgres` by
  `pg_isready` and `pg_dump`, `jest` by `jest-*` (RideGT depends on `jest-expo`, not `jest`), `vercel` by `@vercel/*`, `posthog` by `@posthog/*`,
  `eslint` by `eslint-config-*`, `firebase` by its config files and CLI (RideGT names no firebase package; one sitting ran 11 `firebase` commands),
  and the bare id items with a CLI (`vitest`, `prettier`, `eslint`) by it. Kotlin stays off the corpus stack, correctly: RideGT's two `.kt` files
  are generated and the agent never wrote Kotlin. `google_maps` is matched by API host only and has no corpus evidence: RideGT calls it from code,
  and every shell mention was an echo label or a grep pattern.
- **`wire` is one function** for any result or a bundle `{"glossary", "stack", "titles"}`. It keeps ids, catalog words and names (rule 4 lists
  catalog names), enums, counts, timestamps and reasons, and drops every `definition` and `title` (rule 5), which also drops the one LOCAL string
  (the `names=True` directory). An unrecognised shape raises.
- **No checked-in fixtures** (section 6 wins over the run's permission to add `tests/fixtures/vocab/`): the parser round trip writes its JSONL into a
  temp dir. `tests/transcripts.py` had not landed when these tests were written.
- **Recorded, not fixed**: 8,506 of the corpus's 64,673 agent lines (13%) are writes into the harness scratchpad (`/private/tmp/claude-*/.../
  scratchpad/`), and 6 sessions wrote nowhere else. `languages.split`, the wrapped `shipped` card and titles all count them, so a title can say
  "Shipped changes to three source files" about scratch scripts. What counts as project work belongs with `patterns._wrote`, not in vocab.

## Deviations (live)

MEASURED by replaying `live.live_state` over the 155 counted final sessions of `~/.builder-overnight/corpus` at every tenth tool call (1,058 cut
points, `now` five seconds after the call), then on the live transcript. The final distribution: no verdict 667 (a clean stretch cannot converge,
because converging needs errors to fall), starting 243, converging 132, circling 11, waiting 5, lost 0.

**Verdict**

- **`repeated_call` reads only calls whose input the digest kept** (`live._comparable`: a shell command, a `SEARCH_TOOLS` pattern or query, a
  `burn.TASK_TOOLS` description), still through `burn.Segment.causes()` so the threshold stays burn's; `evidence.repeats` counts the same set.
  `digest._tool_line` keeps only the path of Edit, Write and Read and a 100 character prefix (or nothing) of anything else, so three edits to one
  file were "the same call three times". MEASURED: the repeat behind 130 `causes:repeated_call` cut points was an Edit 111 times and a Read 13;
  after the change 2 fire, both a repeated Bash command, and circling fell from 132 cut points to 11 (the 7 churn ones inspected are genuine:
  "String to replace not found" three times on one file, failing tests between rewrites).
- **`lost` never counts a modification Claude Code guards** (`GUARDED_EDIT_TOOLS`: Edit, MultiEdit, NotebookEdit, Write). They stay in the
  modified denominator and are never blind: the harness refuses them on a file the conversation has not read, so one it accepted was read by its
  own record. MEASURED: zero "File has not been read yet" refusals in the corpus and one "File has been modified since read", so it tracks reads.
  `lost` fired on 11 cut points; the 6 inspected first edited files that earlier shell commands named (`sed -n`, `cat`, `grep`, three to six
  times each) or that an earlier sitting of the same conversation wrote (the sessionizer cuts one conversation into sittings; the agent's context
  does not). Naming by the shell (`live._names_file`) left 4, and in all 4 every blind file but one had been written or read in an earlier sitting;
  the one was `user.s`, a word inside a `sed -i` substitution that `digest._SED_I` took for the path (recorded, not fixed: digest is not live's).
  After the guard, 0. `sed -i`, `replace` and `replace_in_file` can still be blind; a relative spelling matches an absolute one (`_same_file`);
  a modification answered by an error modified nothing.
- **A cut closing message cannot be `done`.** The digest keeps 320 characters of assistant text and cuts the tail behind `…[+N]`, so "does not
  end in ?" cannot be read; the turn stays `waiting`, which is true of every ended turn, where `done` is the stronger claim.
- **An interrupt as the last event ends the turn**: activity `waiting_on_you`, verdict `waiting`. Claude Code stops after one; the literal rules
  said "thinking" off the interrupted call's result.
- **Basis names the section left open**: `starting` is `segment_tool_calls`, `lost` is `edits_to_unread_files`.

**Activity**

- **New output includes tool results.** `idle` is measured from the later of the last event and the last `result_ts`: a successful result writes
  no event of its own, and a five minute build read as five minutes of silence the moment it finished. `thinking` by rule 4 counts `since_s`
  from `result_ts`.
- **The trailing run ends at the last tool** and never crosses a prompt or interrupt. FOUND BY RUNNING IT: walking back from the segment's end met
  an interrupt after the last tool (tool, interrupt, assistant text) and crashed on an empty run. With no tool since the prompt and the turn not
  ended, the activity is `thinking`.
- **A test run's role is `test` before its path**: the digest gives `sed -i 's/x/y/' src/a.py && pytest` the path `src/a.py`, and "Running the
  source code" would describe the sed, not the tests.
- **Failure pairs on `tool_id`** (`_failed_calls`), adjacency only for a loader that writes no ids: Claude Code writes three results after three
  parallel calls, and "the next event" pinned a rejected `git push --force` on the `ls` beside it (tested end to end).

**Shape** (additive, every added field WIRE)

- `activity` gains `files` (distinct files in the trailing run), `calls` (calls in it) and `file_id` (the last tool's file); `verdict` gains
  `file_id` (the churned file); `evidence` gains `stuck_s` (from the circling run's first failure, repeat or churned write to `now`, 0 unless
  circling), `files_changed` and `commits` (`burn.Segment.files_touched` and `.commits`). `sentence()` is pure, and these are the numbers it
  reads, so the phone can render the same words from `wire()`.
- `names` is `{"files": {id: relpath}, "command": word, "failing_command": word}`: a command has no id to hang off the file map.
- Added: `decision_sentence(d, names=False)` (the CLI lines; `Added redis.` with names), `DECISION_SENTENCES`, `mission_order(states)` (score
  desc, `since_s` desc, id), and the enum tuples `ACTIVITY_KINDS`, `VERDICT_STATES`, `EVIDENCE_KEYS`, `NEEDS_YOU_REASONS`, `DECISION_KINDS`,
  `FRAME_KINDS`. `state["sentence"]` is always the `names=False` sentence; the CLI calls `sentence(state, names=True)` under `--names`.

**needs_you**

- **Increments count what lies beyond each rule's own bar**: `lost` is `55 + min(20, 5 * (blind_edits - 3))`, `error_loop` is
  `50 + min(20, 3 * (errors_now - 3))` (`ERROR_LOOP_MIN_ERRORS`, pinned by a test to `burn.Segment.causes()`). As written, `lost` needs three
  blind files and so always scored at least 70, above a fresh `circling` (60), and a fresh error loop (59) outranked a fresh `lost`: the reverse
  of the order this section calls the claim. Fresh floors are now 80, 60, 55, 50, 38 (idle fires at three minutes), 30, 5.

**ETA**

- Refuses "the active time of this session was not supplied" when `active_seconds` is None: the only clock the comparison holds on. `n` is None
  when the repository is unresolved (nothing was counted). One reads "1 finished session"; an unattended run reads "finished unattended runs",
  because its similar set excludes the attended sittings and "sessions on this repository" would understate the repository.

**Decisions**

- Every shell rule reads command lines with heredoc bodies skipped (`digest._command_lines`) and never a call a `result_error` answered: a
  rejected force push did not force push, a failed install added nothing.
- `deleted_test` reads the tokens of the `rm` simple command only (`rm notes.txt && pytest tests/` deleted no test).
- A dependency command must name a package, and a redirect is not one. MEASURED: `timeout=900 bun install 2>&1` was one of the corpus's two
  `added_dependency` hits, the `2` of `2>&1` read as a package by `(?!-)[@\w]`.
- `git restore --staged` without `--worktree` only unstages and is not `reverted_changes` (MEASURED: one corpus hit).
- `switched_approach` clause (b) needs a write in the segment before the revert, as clause (a) does; `abandoned_plan`'s first plan must not have
  been answered by an error (a rejected plan is the person's call, not the agent's).
- MEASURED after these, sessions carrying each kind: reverted_changes 12, deleted_test 3, added_dependency 1, changed_schema 1,
  switched_approach 1, weakened_test 1.

**Map**

- Rows are keyed by id, so one file in the checkout and in a worktree is one row. The fallback base is the common DIRECTORY of the absolute
  paths not under `repo` (the common path of one file is the file itself).
- An in repository worktree prefix is stripped, allowlisted by shape: `.claude/worktrees/<name>/` and `.worktrees/task/<name>/` (MEASURED: 3 of
  57 corpus transcripts ran in one). Without it one file had two ids and three extra levels of depth.
- `role` everywhere in the state is `plain.role_of` over the RELATIVE path, so a parent folder named `test` or `docs` cannot label a checkout.
- Recorded, not fixed: a worktree BESIDE the repository (`builder-overnight` next to `builder`) keeps the checkout's ids only when the session's
  outside paths share the worktree root. This session also touches the scratchpad and `~/.claude`, so its base is `/`. A pure function cannot
  find a worktree root; the caller could pass one.

**Sentence**

- Role nouns are `plain.ROLE_NOUN`'s singular (`Rewriting a test file, second attempt`, `Going back and forth on a source file, fourth pass`)
  rather than `one {role} file`, which reads "one unknown file" and "one docs file".
- Counts agree in number ("one file changed", "one helper agent", "for one minute"), and "Stuck on the same failing command" and "No new output"
  drop the duration under a minute, as "Waiting on you" does. A shell read names no path: "Reading a file". `done` prefers files changed, then
  a commit, then "Finished". No events: "Nothing has happened yet".
- `names=True` swaps the noun only when the activity has one file; the stuck sentence names the failing call's program ("Stuck on the same
  failing pytest command"); a command's program skips `cd`, `VAR=value`, `sudo`, `env`, `time`, `nohup` and `exec`.

**Recorded, not fixed**

- `analysis/plain.py`, the two `digest.Ev` fields and `tests/transcripts.py` (B's shared half, section 1) had not landed when live was handed
  over, so `live.py` imports a `plain` that does not exist yet and the suite cannot import it. `test_live.py` builds its events in memory and its
  JSONL in a temp dir rather than wait for `tests/transcripts.py`; all 94 pass against a stand in written from section 1.1, except the three
  `EndToEnd` parser tests, which fail by design until `digest.load_claude_code_events` stamps `stop_reason` and `result_ts`.

## Deviations (integration)

The integrator, 2026-09-13, `analysis/__main__.py` (section 7). Suite: 1,043 analysis tests, all green.

- **B's shared half was written here, from section 1 as specified**, because nothing imported without it: `analysis/plain.py` (1.1),
  `result_ts` and `stop_reason` on `digest.Ev`, stamped only in `load_claude_code_events` (1.2), and `tests/test_plain.py` (role per path, `spec/`
  is config, `spoken`, `ordinal`, `has_dash`, and the digest text byte identical with the fields cleared over every `spec/fixtures/live_path/`
  transcript). `ordinal` outside 1 to 10 takes the digit form, zero included (`0th`): `test_live` renders it. `tests/transcripts.py` was not
  written; every suite that wanted it builds its own.
- **`_corpus_facts` fills the burn pair** (5.3) and `unreadable_tokens`, through `burn.session_burn_detail` over every file the sitting's records
  came from, windowed to the sitting, with `load_turns` memoised per call. MEASURED on `~/.claude/projects` (345 counted sessions): 1.6 s of burn
  over a 7.4 s cut. On the corpus: `barren_token_share` 0.029 (120,070,737 of 4,170,485,618, 157 sessions with counts), fact "At least 3% ...".
- **A single transcript file is a corpus of one** (`_transcripts`), so `wrapped`, `vocab`, `profile` and the rest answer about one file; a file
  path used to be walked as a directory and answer about zero sessions without saying why.
- **`_commit_subjects` shares the commit window with `_corpus_contributions`** (`_commit_window`) and `_commit_messages` takes the cap as an
  argument, so the kind of work card and the shipped card count the same commits.
- **`live TRANSCRIPT` on a transcript whose last sitting has ended** prints why (`its last sitting ended 3 days ago, at ...`) and then that
  sitting as it stood at its `ended_at`, labelled; `--root` with nothing running prints the reason and "Nothing needs you". FOUND BY RUNNING IT:
  while the workflows ran, this overnight session's root transcript had not moved for 29 minutes, the reference cut had closed its sitting on the
  idle gap, and the literal rule would have printed nothing about the one transcript the person named.
- **Background work is summed over every file of the sitting**; None when any file cannot be read (absent, not zero).
- **The numbers block prints seconds exactly** (`3m 35s`), never `feedback._mins`: that rounds while `live.sentence` floors, and the first run
  printed "for 4 minutes" above "Waiting on you for three minutes" about one 215 second wait.
- **Dates in the printers are `profile.local_day`** (04:00 boundary): the calendar date filed this session's 01:38 sitting under the next day.
- **`_print_burn` fixes D left for the integrator**: the refusal line is the report's own reason; WHERE IT WENT prints `attributed_tokens`
  over the session total instead of the overlapping `share_of_session`; every share goes through `burn._unrounded` and `burn._share_words`
  (the live transcript's 15,460 token fan out printed `0%`, now `under 1%`); a spike's flag is `burn._verdict` (it printed `+0 lines` for work it
  could not count); a pasted prompt's newlines no longer break the column; the bullet hyphen is gone.
- **Recorded, not fixed (capture/ is out of bounds):** the map salt is `sha256("builder-map-salt:" + raw_machine_identifier())` as specified, and
  on a Mac `raw_machine_identifier()` is a fresh random UUID per call (no `BUILDER_MACHINE_ID`, no `/etc/machine-id`), so file ids hold within one
  run, every `--watch` refresh included, and differ between runs. A stable raw identifier belongs in `capture.identity`. SUPERSEDED in review: the
  salt is 32 random bytes in `~/.builder/map-salt` (0600), never derived from what is hashed onto the wire.

## Deviations (review fixes)

Four adversarial reviews (numbers, privacy, copy, design), 2026-09-13. Each fix has a regression test that fails when the fix is undone (checked
by mutation for the integration rules); every number below was measured on `~/.builder-overnight/corpus` (158 counted sessions) unless it says
otherwise.

**Numbers.**
- **Project work is one rule, `patterns.project_write`** (`_wrote` and not `patterns.harness_event`, both moved here from `vocab`): agent lines,
  write events, the kind of work split, `languages.split` (the report's languages, 63,840 lines beside 50,177 before) and `live`'s files
  changed, map and time lapse all read it. The shipped card counted 64,747 lines, 13,663 of
  them Claude Code's own files and 907 a resumed transcript's copies: 50,177 now. The lines basis is renamed
  `project_edit_tools_and_credited_shell_writes`, so a stored `uploaded_agent_lines` total (capture still counts every write) is never read as it.
- **Each event once, each message once.** The corpus cut applies `patterns.distinct_events` to every sitting; `burn.turns_for_window` dedupes a
  message id across a sitting's files. Corpus burn 4,170,485,618 to 4,144,956,746 tokens (25,528,872 were copies, three sittings exactly 2x); prompts
  932 to 927. RECORDED: `capture.sessions.token_ledger` doubles the same sittings.
- **`patterns._touched` is the one "which files did this change" rule**: `burn` (files touched, churn), `live` (files changed, map, time lapse)
  read it, a `sed -i` counts, and a call an error answered (`burn.failed_calls`, now the one failed call rule) never does.
- **Background work reported back mid turn** arrives as `queue-operation` and `queued_command` records, never a `user` record: 91 of 98 "still out"
  tasks in old transcripts had been notified that way. `live.background_tasks` reads all three shapes.
- **Waiting on its own job is not waiting on you**: a clean hand back with background work out (the exact count from the transcript) is basis
  `turn_ended_background_out`, needs you reason `waiting_on_background` at 10 (a point every ten minutes, to 30), sentence "Waiting on two
  background tasks it started". Evidence gains `background`. MEASURED on `~/.claude/projects`: of 595 turns handed back with work out, the job
  reported back before the person spoke 281 times and the person spoke first 134, mostly to nudge ("status?"). RECORDED:
  `mobile/src/live/sentence.ts` still renders "Waiting on you" for it.
- `explain` never says "changed 0 lines": lines are added and removed, else files or commits, else "cannot be read"; shares near the ends are
  `_share_words` everywhere (the replay detail printed 100% beside "over 99%"). The barren profile fact is said the same way and never on a zero.
- Cards: the longest session floors (3,585 s is 59 minutes on both cards), the tool calls a prompt ratio is over the attended sessions the card
  counts (11.3, the profile's 12.0 counts unattended runs), attended hours say how much may be counted twice (up to 1.2 of 74.5), "assisted"
  commits say what the rule counts (a session or the 30 minutes before one; RECORDED: no author filter in `capture.repo.commits_in`).
- `live TRANSCRIPT` on an ended sitting refuses its ETA ("this session has ended, after ...").

**Privacy.**
- Real identifiers from the owner's transcripts (an account id, an OAuth code and state, a key id, a request id, a deployment URL, most of an API
  key) were replaced in tests, docstrings and `docs/overnight-integration.md` by synthetic values of the same shape. RECORDED: `brief.md` (in the
  local commit `0f2c735`) still quotes the account id as Paxel's example. `scripts/check_private_tokens.py` reports any identifier shaped token
  or URL host in the changed files that also occurs in a transcript under `~/.claude/projects` (exit 1), to run before a commit.
- The map salt is random and private (above). File ids are HMAC-SHA256, and `live_state` refuses a salt under 32 characters.
- MCP tool names are never stack evidence: `posthog` lost `t:`, `app_store_connect` is gone.
- The quote cards pick only prompts `wrapped._private` passes (no secret words, home paths, URL credentials, pasted errors, other people's words), a
  crash out is never distress, and a one word prompt is never the cryptic prompt. Measured cards still count every prompt in the person's words.
- Excluded repositories (`BUILDER_CAPTURE_EXCLUDE`) are cut out of every wire bound input: `_corpus_facts` and `_live_doc`. RECORDED: the rule
  belongs beside `is_counted` in `capture.sessions`.
- `digest.clip` masks THEN cuts, in every loader and in `Packages/BuilderKit` (`SessionDigest.clip`), with nine more secret shapes and an
  unterminated private key; the parity golden and the budget hash are byte identical. A package URL is never a decision's name.
- `--wire` on `live`, `wrapped` and `vocab` prints what may leave the machine. `--json` keeps its shape (the simulator script reads it).

**Copy.** One phrase for attended time ("with you there"); `go-to`, `cherry-pick`, `end-to-end`, `row-level`, `stand-in` keep their in word
hyphens (`plain.DASH` never counted them); plural agreement in every printer; engine ids said in words; the cryptic refusal names its bar; the crash
out shows when it was sent, and the CLI says how to see a quote.

**Design.** `live` cuts its history lazily and lean (no burn, no commit attribution: the review measured 16.8 s on the live transcript, 8.8 s
now), `vocab` lean (10.6 s to 6.9 s); an ended transcript is cut once a tick; decisions read each simple command's program and dequoted arguments through the one quote aware
splitter (`digest.split_simple`); `digest.is_cut`, `shell_lines` and `shell_text` are the one reading of a digest shell text; `contributions`
imports the day rule and `longest_run`; `plain.DASH_CHARS` is the one list `run` rewrites; `burn`'s cause bars are named constants the other
modules import; `burn.session_burn` is gone.

**Not fixed, with the reason.** Mid turn human messages (`queued_command` attachments with `origin.kind == "human"`, 117 in 19 corpus
transcripts) are still not prompts: the fix is one rule in `digest`, `capture/sessions` and `scripts/measure_boundaries.py` together, capture is
out of bounds, and changing the digest alone would make the prompt count and the presence signal two counters for one number.
