# Overnight integration: how the engine reaches the phone

`CLAUDE.md` overrides this page. `docs/overnight-engine.md` defines the engine (wrapped, live, vocab, the burn and profile fixes); this page defines
how its output travels: which spec declares every byte, which process computes it, which table stores it, which route serves it, which test pins it.
Five work packages implement it in parallel (section 8). Every open choice is made here; UNMEASURED JUDGEMENT CALL marks the ones with no measurement.

MEASURED 2026-09-13: `~/.builder-overnight/corpus` (57 root transcripts; distinct tool paths per transcript p50 3, p90 44, max 141) and the live
transcript `~/.claude/projects/-Users-vedantbhatt/fa5eaa46-bdbd-4c15-a73b-8d723f98706b.jsonl` (6.9 MB, 1,066 records, 25 distinct tool paths;
88 Bash, 15 Read, 10 Write, 6 Agent, 4 Workflow, 2 ToolSearch calls). Latest migration today: `0019_session_feedback`.

## 0. Three wires, one definition each

| wire | the one definition | computed by | stored | served |
|---|---|---|---|---|
| report v2: `wrapped`, `money`, `burn`, `vocab`, `stack` | `spec/report.v1.json`, `"version": 2` | `analysis.report.from_corpus` on the machine; `capture report` uploads | `builder_report.body` (0018, unchanged) | `GET /v1/profile/builder` `report` |
| `live`, and opt-in `live_names` | `spec/live.v1.json`, named by contract v4 field `live` | `analysis.live`: on the server for the hook channel, in `capture sync --live` elsewhere | `session_live` (0020), deleted at finalise | `GET /v1/sessions/live` (slim), `GET /v1/sessions/{id}`; APNs `liveactivity` |
| `quotes` (opt-in, off by default) | contract v4 `quotes` document | `wrapped.quotes_upload` on the machine; `capture report --quotes` uploads | `builder_quotes` (0021) | `GET /v1/profile/builder` `quotes` |

Rules every package holds. (1) The contract is the only definition of what leaves the machine: prompt text reaches the server in exactly two opt-in
places (`analysis.decision_patterns[].prompt_excerpt`, v4 `quotes`), basenames in one (`live_names`), and nothing else carries a typed word, a path, a
command or a commit subject. (2) No prose on the wire: ids, integers, floats, enums, clocks and 16 hex salted ids; the phone renders every sentence
(engine rule 5), and a refusal is an enum code plus `n` and `needed`. (3) Absent is null, never 0, never `[]` standing in for null. (4) One rule, one
function: where two languages must agree (the live sentence, the Live Activity content state, the wrapped sentences) Python is the reference and the
other side is pinned to generated fixtures, as strip conformance is. (5) A contract enum value is always also a migration: every new Postgres `CHECK`
list is pinned to its spec enum by a test that reads the migration. (6) The door rejects extra keys: every new document is generated Pydantic with
`extra="forbid"` at every level.

## 1. Report spec v2 (`spec/report.v1.json`)

The file keeps its name (every generator, test and docstring cites it) and moves to `"version": 2`; `analysis/report.py REPORT_VERSION = 2`. The five
blocks are nullable top-level fields appended after `languages`, so a v1 document still validates. Notation below: `?` is `"nullable": true`,
`[X] max n` is `{"type": "list", "item": "X", "max_items": n}`, `double` is a 0 to 1 share (its doc must say "share" or "fraction", which buys
`ge=0, le=1` in Pydantic), `enum e` is `{"type": "enum", "values": "e"}`. Written out, one field is:

```json
{"name": "reason", "type": "enum", "values": "wrapped_refusal", "nullable": true,
 "doc": "why the card is refused. The phone writes the sentence from this code, n and needed."}
```

### 1.1 Enums added beside `trend_direction`

```json
"wrapped_card": ["builder_type","shipped","work_style","longest_session","agents_at_once","go_to_prompt","streak","change_course","crash_out",
                 "prompt_length","deep_sessions","time_put_in","cryptic_prompt","prompts_per_session","kind_of_work"],
"wrapped_unit": ["archetype","lines","style","seconds","sessions","sends","days","share","score","words","hours","prompts_per_session","kind"],
"wrapped_basis": ["archetype_rules","edit_tools_and_credited_shell_writes","edit_tools_only","uploaded_agent_lines","absent",
                  "autonomy_then_prompts_then_steer","attended_seconds_rank","sweep_over_first_to_last_event","normalized_prompt_text_across_sessions",
                  "days_with_a_commit_and_an_attended_session","interrupts_and_correction_markers","profanity_caps_punctuation_markers",
                  "words_per_prompt","attended_sessions_over_an_hour","active_seconds","vowelless_runs","prompts_over_attended_sessions",
                  "commit_subject_labels","lines_by_file_role","commit_subject_labels_then_lines_by_file_role"],
"wrapped_value": ["architect","velocity_machine","quality_guardian","night_owl","director","skeptic","generalist","hand_off","dialogue","steering",
                  "one_shot","feature","fix","refactor","docs","test","chore","perf","style","build","revert","source","config","migration","dependency","unknown"],
"wrapped_refusal": ["no_sessions","below_session_floor","below_attended_floor","below_prompt_floor","no_prompt_text","no_archetype_metric","no_line_counts",
                    "no_lines_attributed","no_presence","no_events","no_repeated_prompt","no_commit_history","no_crash_out","no_cryptic_prompt","neither_kind_basis"],
"archetype": ["architect","velocity_machine","quality_guardian","night_owl","director","skeptic"],
"archetype_metric": ["planning_ratio","code_velocity","test_runs_per_hour","night_share","autonomy_score","steer_rate"],
"commits_basis": ["git_log_distinct_commits"],   "kind_refusal": ["no_subjects","too_few_labelled","low_label_coverage"],
"commit_kind": ["feature","fix","refactor","docs","test","chore","perf","style","build","revert"],
"plain_role": ["test","source","config","docs","migration","style","build","dependency","unknown"],
"money_basis": ["anthropic_api_list_price","stale_prices"],   "money_refusal": ["tokens_not_reported","model_not_in_price_table"],
"priced_model": ["claude-fable-5-1","claude-mythos-5-1","claude-fable-5","claude-opus-5","claude-opus-4-8","claude-opus-4-7","claude-opus-4-6",
                 "claude-sonnet-5","claude-sonnet-4-6","claude-haiku-4-5"],
"lines_basis": ["edit_tools_and_credited_shell_writes","edit_tools_only","uploaded_agent_lines","absent"],
"burn_cause": ["context_replay","subagent_fanout","error_loop","repeated_call","file_churn","compaction","investigated"],
"burn_refusal": ["no_token_counts","below_session_floor","nothing_inside_segments","not_segmented"],
"vocab_term": "<the 74 ids of analysis.vocab.CATALOG, catalog order>",   "vocab_refusal": ["no_events"],
"stack_item": "<the 81 ids of analysis.vocab.STACK, catalog order>",     "stack_refusal": ["no_evidence"],
"stack_category": ["language","framework","database","infra","testing","tooling","service"],   "stack_evidence": ["manifest","language","command","path","tool"]
```

Four enums copy a Python table and each copy is pinned both ways by a test (section 7): `wrapped_card` = `wrapped.CARD_IDS`, `priced_model` =
`list(pricing.PRICES)`, `vocab_term` = CATALOG ids, `stack_item` = STACK ids (paste from `python3 -c 'import json; from analysis import vocab;
print(json.dumps([t.id for t in vocab.CATALOG]))'`). A new price row, term or stack item is a spec edit plus `make gen`, never a migration: the report
is JSONB. `wrapped.py` changes its one unit with a space, `"prompts per session"`, to `"prompts_per_session"` (a unit is never rendered).

### 1.2 Objects

```text
ReportWrapped        cards: [ReportWrappedCard] max 15 | prompts_with_text: int | attended_sessions: int
ReportWrappedCard    id: enum wrapped_card | value: number? | value_id: enum wrapped_value? | unit: enum wrapped_unit | basis: enum wrapped_basis
                     n: int | needed: int? | reason: enum wrapped_refusal? | extras: ReportWrappedExtras
ReportWrappedExtras  every field nullable; a card sets only its own keys (report_blocks.WRAPPED_EXTRAS pins which)
                     confidence: double | metric: enum archetype_metric | metric_value: number | metric_lower_bound: bool
                     closest: ReportArchetypeScore | runners_up: [ReportArchetypeScore] max 2
                     commits: int | assisted: int | alone: int | commits_basis: enum commits_basis
                     autonomy: double | median_prompts: number | steer_rate: number (interrupts can outnumber prompts) | active_seconds: int | started_at: datetime
                     subagents_peak: int | subagents: int | sessions: int | words: int | commit_days: int | attended_days: int | both_days: int
                     interrupts: int | corrective_prompts: int | median: number | avg_minutes: int | longest_minutes: int
                     attended_hours: number | tool_calls_per_prompt: number | kinds: [ReportKindCount] max 10 | classified: int
                     coverage: double | role_lines: [ReportRoleLines] max 9 | commit_refusal: enum kind_refusal | lines: int | lines_needed: int
ReportArchetypeScore name: enum archetype | metric: enum archetype_metric | value: number? | threshold: number? | score: double?
ReportKindCount      kind: enum commit_kind | commits: int
ReportRoleLines      role: enum plain_role | lines: int
ReportMoney          usd: number? | basis: enum money_basis? | reason: enum money_refusal? | prices_read_on: datetime
                     priced_sessions: int | unpriced_sessions: int | usd_per_active_hour: number? | usd_without_a_commit: number?
                     share_without_a_commit: double? | tokens: ReportTokens? | token_sessions: int
                     lines_added: int? | lines_removed: int? | lines_basis: enum lines_basis | by_model: [ReportModelCost] max 10
ReportTokens         input: int | output: int | cache_read: int | cache_w5m: int | cache_w1h: int
ReportModelCost      model: enum priced_model | usd: number | output_tokens: int | sessions: int | sessions_dominated: int | commits: int
                     usd_per_commit: number?
ReportBurn           share: double? | barren_tokens: int? | tokens: int? | unreadable_tokens: int? | sessions: int | needed: int?
                     reason: enum burn_refusal? | causes: [ReportBurnCause] max 7 ?
ReportBurnCause      cause: enum burn_cause | tokens: int | share: double | segments: int
ReportVocab          terms: [ReportTerm] max 80 | locked: int? | catalog_size: int | sessions: int | shell_calls: int | shell_calls_cut: int
                     reason: enum vocab_refusal?
ReportTerm           id: enum vocab_term | count: int | sessions: int | first_seen: datetime
ReportStack          items: [ReportStackItem] max 120 | sessions: int | manifests: int | shell_calls: int | shell_calls_cut: int
                     reason: enum stack_refusal?
ReportStackItem      id: enum stack_item | category: enum stack_category | evidence: enum stack_evidence | sessions: int | first_seen: datetime?
top level (append)   wrapped: ReportWrapped? | money: ReportMoney? | burn: ReportBurn? | vocab: ReportVocab? | stack: ReportStack?
```

A null BLOCK means only "the machine that sent this report does not compute it" (an older capture); a refusal is the block's own `reason` with its
numbers null. Burn `causes` is null exactly when `share` is, `[]` only when `barren_tokens` is a measured 0, and cause shares overlap (engine doc 5.1),
so the phone never sums them. The machine sends only the `extras` keys a card sets; the server stores the validated dump (every key, null where unset).

### 1.3 Where each block comes from: `analysis/report_blocks.py` (new)

- `wrapped_block(wrapped.wire(result))`. `wrapped.py` cards gain `code` (the `wrapped_refusal` value beside every prose `reason`, from a new
  `REFUSALS: dict[code, template]` that `_refuse` requires) and `needed` (the floor named: `pf.MIN_SESSIONS`, `pf.MIN_PROMPTS`, `KIND_MIN_SUBJECTS`,
  `round(100 * KIND_MIN_COVERAGE)`); CARD_KEYS becomes 12 and WIRE_KEYS and LOCAL_CARD_KEYS gain both; extras gain `commit_code`. Mapping: `reason :=
  code`; `basis, _, c = basis.partition("+")`, `extras.commits_basis = c or None`; `value_id := value` for units archetype, style, kind (`value`
  null); `closest`, `runners_up` keep `name, metric, value, threshold, score`; `counts` becomes `kinds` in `KINDS` order and `role_lines` a list in
  `plain.ROLES` order; `commit_code` becomes `commit_refusal`; `metric_basis` becomes `metric_lower_bound = wrapped._is_lower_bound(...)`. Crash out
  and cryptic prompt keep `id, n, reason, unit, basis` only (their numbers read typed words). All 15 cards, in `CARD_IDS` order.
- `money_block(profile, facts)`, `m = profile["metrics"]`: `usd` is `spend_usd.value`; `basis` its basis when answered, and when refused that basis
  (`tokens_not_reported`, `model_not_in_price_table`) IS the refusal code; `priced_sessions` its n; `unpriced_sessions` its extra or 0;
  `prices_read_on` is `pricing.PRICES_READ_ON` at 00:00Z; `usd_per_active_hour` from `spend_per_hour_usd`; the without a commit pair from
  `spend_without_a_commit_usd` (value, `share_of_spend`); `tokens` the five buckets summed over facts with `tokens` (None if none), `token_sessions`
  their count; `lines_added`, `lines_removed` from `totals` (5.2); `by_model` from `profile["model_costs"]` by its new `model_id`. No price is
  computed here: `corpus_profile` is the one place and the server runs it too (5.2), so with `report` null the phone shows `corpus.metrics.spend_usd`.
- `burn_block(profile)` from `m["barren_token_share"]` (value, n, `barren_tokens`, `tokens`, `unreadable_tokens`) plus two new extras: `code`
  (`no_token_counts`, `below_session_floor` with needed `MIN_SESSIONS`, `nothing_inside_segments`, `not_segmented`) and `by_cause`
  `[{cause, tokens, share, segments}]` (share of barren tokens, 3 dp), summed from a new `SessionFact.barren_causes: Mapping[str, tuple[int, int]] |
  None`, which `burn.session_burn_detail` fills as `causes` by summing `Segment.attribution()` over BARREN segments.
- `vocab_block(vocab.wire(glossary))` drops `word` and `basis`, renames `first_seen_ts` to ISO `first_seen`, `locked_count` to `locked`, `n` to
  `sessions`; `stack_block(vocab.wire(stack))` drops `name` and `language_reason`, renames `manifest_names` to `manifests`.

`analysis/corpus.py` (new) is the one corpus cut: `Corpus(facts, sessions, kept, roots, fanout, contributions, commit_subjects)` from `cut(sources,
transcripts, tz, now, *, tau="auto")`, the body of today's `__main__._corpus_facts` and `_narrative_inputs` (tokens, burn, `repo`, first claim
commits) plus `_commit_subjects` and the fan out. `report.from_corpus(c, window_days, *, quotes=False) -> tuple[dict, dict | None]` builds every block
and, with `quotes=True`, the quotes document; `python -m analysis report` and `python -m capture report` both call it, so the two cannot differ.

### 1.4 Example (wire; the burn share is the profile's measured 2.9%, the other figures show shape only)

```json
{"wrapped": {"prompts_with_text": 926, "attended_sessions": 132, "cards": [
   {"id": "builder_type", "value": null, "value_id": "quality_guardian", "unit": "archetype", "basis": "archetype_rules", "n": 155,
    "needed": null, "reason": null, "extras": {"confidence": 0.44, "metric": "test_runs_per_hour", "metric_value": 4.72,
    "metric_lower_bound": true, "runners_up": [{"name": "velocity_machine", "metric": "code_velocity", "value": 764.1, "threshold": 487.0,
    "score": 0.785}]}},
   {"id": "prompt_length", "value": null, "value_id": null, "unit": "words", "basis": "words_per_prompt", "n": 3, "needed": 5,
    "reason": "below_prompt_floor", "extras": {"median": null}},
   {"id": "crash_out", "value": null, "value_id": null, "unit": "score", "basis": "profanity_caps_punctuation_markers", "n": 923, "needed": null,
    "reason": null, "extras": {}}]},
 "money": {"usd": 1873.42, "basis": "anthropic_api_list_price", "reason": null, "prices_read_on": "2026-09-06T00:00:00Z", "priced_sessions": 152,
   "unpriced_sessions": 0, "usd_per_active_hour": 22.1, "usd_without_a_commit": 19.8, "share_without_a_commit": 0.011, "tokens": {"input": 812201,
   "output": 9912330, "cache_read": 3900112034, "cache_w5m": 201334551, "cache_w1h": 0}, "token_sessions": 152, "lines_added": 64680, "lines_removed": 9021,
   "lines_basis": "edit_tools_and_credited_shell_writes", "by_model": [{"model": "claude-opus-4-8", "usd": 1502.2, "output_tokens": 9120433,
   "sessions": 97, "sessions_dominated": 88, "commits": 201, "usd_per_commit": 6.83}]},
 "burn": {"share": 0.029, "barren_tokens": 120070737, "tokens": 4168469723, "unreadable_tokens": 1192481138, "sessions": 156, "needed": null,
   "reason": null, "causes": [{"cause": "context_replay", "tokens": 101000000, "share": 0.841, "segments": 58}]},
 "vocab": {"terms": [{"id": "commit", "count": 412, "sessions": 88, "first_seen": "2026-06-02T14:11:07Z"}], "locked": 31, "catalog_size": 74,
   "sessions": 155, "shell_calls": 9085, "shell_calls_cut": 312, "reason": null},
 "stack": {"items": [{"id": "postgres", "category": "database", "evidence": "command", "sessions": 14, "first_seen": "2026-06-11T09:02:44Z"}],
   "sessions": 155, "manifests": 38, "shell_calls": 9085, "shell_calls_cut": 312, "reason": null}}
```

### 1.5 Copy lives on the phone, and how its no dashes rule is enforced

Decision: the report carries no rendered string; the phone renders every question, answer, sentence and refusal. Static strings are GENERATED by
`scripts/gen_copy.py` into `mobile/src/generated/copy.ts` (`export const COPY = {...} as const`) from `wrapped.QUESTIONS`, `ARCHETYPE_DISPLAY`,
`WORK_STYLE_DISPLAY`, `_KIND_NOUN`, `ROLE_DISPLAY`, `ROLE_WORD`, `REFUSALS`, `LOCAL_CARDS`, vocab `{id: {word, definition}}`, stack `{id: name}`,
`pricing.FAMILIES` keyed by PRICES key, `burn._CAUSE_SENTENCES`, `live.DECISION_SENTENCES` and `plain.ROLE_NOUN` (which `src/live/sentence.ts` then
imports instead of its hand copy): the phone never retypes a catalog. Sentences with numbers are hand ported TS, `mobile/src/copy/wrapped.ts`
(`renderCard(card) -> {question, display, sentence} | {question, refusal}`), `numbers.ts` (ports of `profile._n`, `profile._pct`, `feedback._mins`),
`money.ts` ("about $1,873 of API use at list prices, read Sep 6"), `burn.ts`, pinned to Python by `spec/fixtures/wrapped/cards.json`
(`[{"card": <ReportWrappedCard>, "question", "display", "sentence", "refusal"}]`, every card answered and every refusal code, written by gen_copy from
`analysis/tests/corpus_fixture.py`). No dashes, four ways: `plain.has_dash` over every table gen_copy reads (the modules' own tests);
`__tests__/copy.test.ts` already parses every literal under `app/` and `src/`, so `src/copy/*` is covered; `copyCatalog.test.ts` runs `hasDash` over
`generated/copy.ts` (copy.test.ts skips `generated/`); `wrappedCopy.test.ts` renders every fixture card: no dash, and a digit in every answered sentence.

### 1.6 The no free text test

`analysis/tests/test_report.py::test_no_field_in_the_spec_carries_free_text_from_a_transcript` extends `allowed`, one comment each: `id`, `value_id`,
`unit`, `basis`, `metric`, `commits_basis`, `commit_refusal`, `kind`, `role`, `model`, `cause`, `category`, `evidence` (enums from fixed tables);
`started_at`, `first_seen`, `prices_read_on` (clocks). New `test_the_v2_blocks_carry_only_enums_numbers_and_clocks` walks the five blocks' objects and
fails on any field of type `string`: inside them every string is an enum or a datetime, and every `reason` is an enum.

## 2. Contract v4 (`privacy/upload-contract.json`)

`"version": 4`. Every change below regenerates Pydantic, Swift, TypeScript, `upload-fields.json` and `PRIVACY.md` through `scripts/gen_contract.py`.

**2.1 The tool map allowlist becomes data.** `tool_calls` gains `"values": ["Read","Edit","Write","Bash","mcp_other","other"]`; gen_contract emits
`TOOL_CALL_KEYS` and a validator (an undeclared key is a 422). Its doc already promises the bucketing; capture now keeps the promise (5.1).

**2.2 `live`** (a session field):
```json
{"name": "live", "type": "live", "nullable": true, "modes": ["public","anonymous"],
 "doc": "what a RUNNING session is doing now (spec/live.v1.json): enums, integers, clocks and 16 hex salted file ids. No path, file name, command, prompt or sentence. Only on state=live payloads; deleted when the session is final."}
```
**2.3 `live_names`** (the third opt-in exception):
```json
{"name": "live_names", "type": "live_names", "nullable": true, "modes": ["public","anonymous"],
 "doc": "OPT-IN, OFF BY DEFAULT: the basename of each file in live.map, keyed by its id. Sent only with `capture sync --live --live-names` and stored only while the account has File names on. Owner only; shown on the session screen, never on the Lock Screen, the widget, a push or a share."}
```
`sanity_gate` adds three rejections: `live` on a final payload; `live_names` without `live`; a name containing `/`, `\` or NUL (the spec caps it at
120). `store_payloads` rejects a session carrying `live_names` while `privacy_prefs.live_names` is false ("live_names sent while file names are off for
this account"). Turning it off: `PUT /v1/privacy/prefs {"live_names": false}` sets the flag and runs `UPDATE session_live SET names = NULL WHERE
user_id = :u` in one transaction; the hook channel stops computing names on the next post.

**2.4 `quotes`** (the second opt-in exception, a document of its own, modelled on `analysis`):
```json
"quotes": {
  "doc": ["THE SECOND OPT-IN EXCEPTION (v4). Up to three prompts, verbatim, for the Wrapped cards that quote you. Off until BOTH Settings on the phone",
          "and --quotes on the machine say yes. Masked, identifier filtered twice. Owner only; never in a post, feed, share, push or activity. Off deletes."],
  "route": "PUT /v1/profile/quotes", "default": "off",
  "max_lengths": {"quote": 160},
  "enums": {"quote_card": ["go_to_prompt","crash_out","cryptic_prompt"]},
  "objects": {"QuoteWire": [
    {"name": "card", "type": "enum", "values": "quote_card"},
    {"name": "text", "type": "string", "max": "quote", "doc": "wrapped._quote: whitespace collapsed, cut at the last space inside 160"},
    {"name": "client_session_id", "type": "sha256hex", "doc": "the session it was sent in, already on the server"},
    {"name": "sent_at", "type": "datetime"},
    {"name": "seconds_in", "type": "int", "doc": "from that session's start to this prompt (the crash out sentence)"},
    {"name": "tool_calls_after", "type": "int", "nullable": true, "doc": "cryptic_prompt only"},
    {"name": "corrected", "type": "bool", "nullable": true, "doc": "cryptic_prompt only"}]},
  "fields": [{"name": "quotes_version", "type": "int"}, {"name": "generated_at", "type": "datetime"},
             {"name": "quotes", "type": "list", "item": "QuoteWire", "max_items": 3}]}
```
gen_contract writes it through the gen_analysis emitters to `server/builder/quotes_spec.py` (`QuotesUpload`) and `mobile/src/generated/quotes.ts`,
adds a Quotes section to PRIVACY.md (its "one opt-in exception" becomes three) and `"documents": {"quotes": {"route", "leaf_paths"}}` to
upload-fields.json, so `capture report --quotes --dry-run` can be diffed like `sync --dry-run`.

Masking and the ID, OTP and token filter, all existing functions, in order: (1) every prompt Ev is already `digest.mask`ed at load; (2)
`wrapped.quotable(text)` (today `_quotable`, made public) drops slash commands, anything the mask fired on, any token with an identifier's shape
(`_carries_identifier`: letters and digits interleaved, which caught a pasted account identifier, shaped like the synthetic `Q7ZK2M9X4P`) and pastes; (3) `wrapped._quote` cuts to 160;
(4) `wrapped.quotes_upload(result)` re-checks `digest.mask(text) == text and quotable(text)`; (5) `server/builder/quotes.py quotes_gate(doc)` re-runs
the same two functions (lazy import, as `builder_profile` does): 422 on a failure, 503 and nothing stored when `analysis` cannot be imported.

Routes (`routes/privacy.py`): `GET /v1/privacy/prefs` answers `{"quotes": false, "live_names": false}` (the salt is never returned); `PUT
/v1/privacy/prefs` takes either key (`current_phone`, a Sign in with Apple or Google token, so only the phone flips a switch: a paired machine's
device flow token was accepted by `current_device` and is a 403 since `0024_device_grant_flow`); `PUT /v1/profile/quotes` and `DELETE /v1/profile/quotes`
take `current_uploader` (the machine holds a capture key or a device token). Two switches, both off by default: the phone's Settings row "Quote my
prompts on my cards" ("Up to three of your prompts, quoted on your Wrapped cards. Only you can see them. Turning this off deletes them."), and
`python -m capture report --quotes`, never persisted, so a scheduled `capture report` never sends one. With the account off, the PUT answers 409
`{"reason": "quotes are off for this account; turn on Settings, Quote my prompts"}` and capture prints it. Off deletes: the toggle runs `UPDATE
privacy_prefs SET quotes = false` and `DELETE FROM builder_quotes WHERE user_id = :u` in one transaction and answers `{"quotes": false, "live_names":
false, "quotes_deleted": 1}`; `python -m capture quotes --delete` calls the DELETE (204); account deletion cascades from `users`. `builder_quotes`
(0021) is owner only, read by `GET /v1/profile/builder` for its owner and joined by no social query.

**2.5 What the Lock Screen may show (it is public).** Every field ActivityKit and the widget receive is safe by construction, because nothing that feeds
them ever holds a name:

| surface field | from | Lock Screen |
|---|---|---|
| attributes `repo`, `agent`, `sessionId`, `startedEpoch` | `repo_name` (public repos only) else "private repo"; harness; server id; clock | safe |
| `phase`, `trajectory` | live `verdict.state`, `activity.kind`; the session's state | safe: enums |
| `sentence` | `live.sentence(state)` (names=False) or `renderLiveSentence`: role nouns, counts, minutes | safe: no input to either carries a name |
| `progress`, `etaEpoch` | `eta.elapsed_s / typical_s`; `computed_at + remaining_s` | safe |
| `filesTouched`, `linesAdded`, `linesRemoved`, `commits`, `runningCount`, `updatedEpoch`, `creature` | session_stats, live rows, clock, the phone | safe |
| `decisions`, `map`, `timelapse` | live | in the app only (mission control, session screen) |
| `live_names` | opt-in | session screen only; `/v1/sessions/live` never returns it, so ActivityKit, the widget and pushes never see one |
| `quotes` | opt-in | Wrapped only |

**2.6 `spec/live.v1.json`** (new; `scripts/gen_live.py` emits it like gen_report.py). A new scalar `hex16` joins gen_analysis's four scalar tables
(Python `Hex16 = Annotated[str, Field(pattern=r"^[0-9a-f]{16}$")]`, TypeScript `string`), so a path can never pass the door as an id.

Enums: `activity_kind` (live.ACTIVITY_KINDS, 9), `plain_role` (9), `verdict_state` (6), `verdict_basis` [turn_ended, segment_tool_calls,
causes:repeated_call, causes:file_churn_with_failures, consecutive_failures, edits_to_unread_files, error_rate_down_and_new_files], `verdict_refusal`
[no_events, no_rule_fired], `eta_basis` [finished_sessions_same_repo_that_ran_at_least_this_long], `eta_refusal` [no_active_time, repo_unresolved,
no_history, too_few_sessions, too_few_survivors], `decision_kind` (10), `needs_you_reason` (7), `frame_kind` [read, edit, fail], and the Live Activity's:
`phase` [working, needsYou, done, stalled], `trajectory` [converging, circling, lost, none], `creature` [crab, octopus, dog, cat, owl, fox, whale, bee, bit].

```text
LiveState    live_version: int | computed_at: datetime | activity: LiveActivity? | verdict: LiveVerdict | eta: LiveEta
             decisions: [LiveDecision] max 4 | needs_you: LiveNeedsYou | map: LiveMap? | timelapse: [LiveFrame] max 600 ? | sample: LiveSample
LiveActivity kind: enum activity_kind | role: enum plain_role | attempt: int | since_s: int | files: int | calls: int | file_id: hex16?
LiveVerdict  state: enum verdict_state? | basis: enum verdict_basis? | reason: enum verdict_refusal? | file_id: hex16? | evidence: LiveEvidence
LiveEvidence window_calls errors_now errors_before new_files checkpoints repeats churn_writes fail_run blind_edits stuck_s files_changed commits: int (all 12)
LiveEta      elapsed_s, typical_s, p25_s, p75_s, remaining_s, n: int? | needed: int | unattended: bool | basis: enum eta_basis | reason: enum eta_refusal?
LiveDecision kind: enum decision_kind | ts: number (Unix s) | event_n: int | count: int
LiveNeedsYou score: int, doc "0-100: ..." (the RANGE_DOC bound) | reason: enum needs_you_reason
LiveMap      files: [LiveFile] max 400 | files_total: int
LiveFile     id: hex16 | dir_id: hex16? (null at the base) | role: enum plain_role | depth: int? | reads, edits: int | last_read_ts, last_edit_ts: number?
LiveFrame    t: int (seconds from the first event) | file_id: hex16 | kind: enum frame_kind
LiveSample   events: int | tool_calls: int | segments: int | tokens: int?
LiveNames    files: [LiveName] max 400          LiveName   id: hex16 | name: string max 120 (a basename)
```
The map keeps the 400 rows touched most recently (`max(last_read_ts, last_edit_ts)`), `files_total` counting all: 400 is 2.8x the measured maximum of
141 distinct tool paths in one transcript, UNMEASURED JUDGEMENT CALL beyond that. 600 frames are about 30 KB.

`analysis/live.py` changes (WP-D) so `wire()` IS this shape: each refusal gains `code` beside its prose (`verdict.code`; `eta.code`, `eta.needed =
ETA_MIN_SESSIONS`, `eta.unattended`); `live_state(history=None)` refuses the ETA with `no_history` rather than counting zero sessions;
`live_state(repo_key=None)` matches history on that key (default `repo`), because the server keys sessions by `repo_hash` while map paths are relative to
the checkout; `state["computed_at"] = now`; `wire(state)` drops `names`, `sentence`, `session_id` and every decision `detail`, sets `reason := code`,
turns frames into objects and `dir_id ""` into null, cuts the map, adds `live_version: 1` and ISO `computed_at`; `wire_names(state) -> dict | None`
keeps `posixpath.basename` of each relpath and nothing else; `eta_history(sessions) -> list[SessionFact]` builds the minimal facts `_eta` reads
(id, clocks, `repo=common_root`, `unattended=presence == 0`) from already cut sessions, with no second parse.

```json
{"live_version": 1, "computed_at": "2026-09-13T07:41:05Z",
 "activity": {"kind": "delegating", "role": "unknown", "attempt": 0, "since_s": 212, "files": 0, "calls": 3, "file_id": null},
 "verdict": {"state": "starting", "basis": "segment_tool_calls", "reason": null, "file_id": null, "evidence": {"window_calls": 3, "errors_now": 0,
   "errors_before": 0, "new_files": 0, "checkpoints": 0, "repeats": 0, "churn_writes": 0, "fail_run": 0, "blind_edits": 0, "stuck_s": 0, "files_changed": 0, "commits": 0}},
 "eta": {"elapsed_s": 5412, "typical_s": null, "p25_s": null, "p75_s": null, "remaining_s": null, "n": 5, "needed": 10, "unattended": false,
   "basis": "finished_sessions_same_repo_that_ran_at_least_this_long", "reason": "too_few_sessions"}, "decisions": [], "needs_you": {"score": 5, "reason": "running_fine"},
 "map": {"files": [{"id": "3f9a0c1d2e4b5a69", "dir_id": null, "role": "docs", "depth": 1, "reads": 2, "edits": 1, "last_read_ts": 1757748660.2, "last_edit_ts": 1757749001.9}], "files_total": 25},
 "timelapse": [{"t": 0, "file_id": "3f9a0c1d2e4b5a69", "kind": "read"}], "sample": {"events": 412, "tool_calls": 131, "segments": 9, "tokens": 12900311}}
```

## 3. Where live_state is computed, and how it reaches the phone

**3.1 The hook channel (primary, least new plumbing).** `hook_ingest.payloads_for` already cuts the transcript bytes in memory with capture's pipeline.
It now also computes the live block for any cut session still live, inside its `TemporaryDirectory` block (`burn.turns_for_window` and
`live.background_tasks` read the file):

```python
@dataclasses.dataclass(frozen=True)   # server/builder/hook_ingest.py
class LiveContext: history: list; salt: str; names: bool   # eta_history(db, user) keyed by repo_hash; privacy_prefs.map_salt; .live_names
def payloads_for(raw, *, native_session_id, project_dir, tz_offset_minutes, finalize, device_id, now=None, live: LiveContext | None = None) -> list[dict]
```
For a live session: `st = lv.live_state(s.events, burn.turns_for_window([str(path)], s.started_at, now), now, live.history, salt=live.salt,
repo=s.repo.common_root if s.repo else None, repo_key=p.get("repo_hash"), active_seconds=s.attended + s.autonomous, unattended=s.presence == 0,
names=live.names, background=lv.background_tasks(path, s.started_at, now), root=lv.worktree_root(s))`; then `p["live"] = lv.wire(st)` and, only when
`live.names`, `p["live_names"] = lv.wire_names(st)`. The payload then goes through `SessionUpload(**p)` (the generated door checks the server's own
output too) and `store_payloads`, exactly as a capture upload does. `routes/ingest.py` builds the context once per request (`live_store.prefs(db, user)`
creates the prefs row on first use) and passes it to the stale re-cuts. The ingest response gains `"live": [{"client_session_id", "sentence",
"needs_you"}]` for the watcher's terminal (the uploader holds the transcript already). On Railway a hook's `cwd` does not exist, so `s.repo` is None:
the ETA refuses `repo_unresolved` and map ids are relative to the common directory.

**3.2 capture sync** (`python -m capture sync --live`, a machine without hooks). `build_payloads` attaches the same keys per live session: history
`live.eta_history(the final counted sessions of the same cut)`, salt `capture.identity.map_salt()` (5.6), names only with `--live-names`.
`content_hash` stays the hash of the payload WITHOUT `live`; `cmd_sync` skips a known hash only when the payload has no `live` (the block moves with
the clock, not the bytes), still at most once per `LIVE_UPLOAD_MIN_INTERVAL_SEC` (60).

**3.3 Storage: `0020_session_live`** (`down_revision = "0019_session_feedback"`).
```sql
CREATE TABLE privacy_prefs (user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  quotes boolean NOT NULL DEFAULT false, live_names boolean NOT NULL DEFAULT false,
  map_salt text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE session_live (session_id uuid PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, live_version integer NOT NULL,
  source text NOT NULL CHECK (source IN ('hook','capture')), computed_at timestamptz NOT NULL,
  body jsonb NOT NULL,   -- LiveState, validated by live_spec.py on the way in
  names jsonb,           -- LiveNames, only while privacy_prefs.live_names
  alerted_phase text CHECK (alerted_phase IN ('working','needsYou','done','stalled')), updated_at timestamptz NOT NULL DEFAULT now());
```
Both ENABLE and FORCE RLS; `GRANT SELECT, INSERT, UPDATE, DELETE ... TO builder_app, builder_worker`; policies `USING (user_id = viewer)` and, on
session_live, `WITH CHECK (user_id = viewer AND EXISTS (SELECT 1 FROM sessions s WHERE s.id = session_id AND s.user_id = viewer))` (0008's shape: a
viewer cannot squat another person's session id and block their row). `boot.assert_policies_present` lists both, and 0021 and 0022's tables.
`0021_builder_quotes` is 0018's table with `quotes_version` for `report_version` and no `window_days`.

Lifecycle, all in `routes/sync.py store_payloads`, the one path both channels share: after the session upsert, `_upsert_live(db, session_id, p)` when
`p.live` is not None (`source = 'hook'` when `client_version == hook_ingest.HOOK_CLIENT_VERSION`, else `capture`; names per 2.3); an unchanged
content hash still refreshes the live row (the `continue` moves below it); a live payload WITHOUT `live` (the Mac app) leaves the row alone, as with
`analysis`; `p.state == "final"` deletes the row. The row exists exactly while the session is live. Revoking a key, deleting the raw transcript or
excluding the repo reaches it through the session's cascade.

**3.4 Read API** (`routes/sessions.py`). `_live_rows` LEFT JOINs session_live and each row gains `live_state`: the SLIM body
(`live_store.slim(body)`: `timelapse` null; `map.files` only the rows `activity.file_id` and `verdict.file_id` name, which the sentence's role lookup
needs; `files_total` kept) or null. `GET /v1/sessions/{id}` gains `live_state` (full body or null), `live_names` (null unless the pref is on and names
are stored) and `stats.lines_removed_agent` (5.4). `/v1/profile`'s `live` rows come from `_live_rows`, so they carry the slim state too. Slim because
ten sessions with a 400 row map and 600 frames each is about 600 KB every 60 s, and mission control, the widget and ActivityKit read only activity,
verdict, eta, needs_you and decisions.

**3.5 The phone polls as it does now.** `app/(tabs)/now.tsx` and `sessions.tsx` refresh every 60 s (`LIVE_REFRESH_MS`) through `cache.sync`, which
reads `/v1/sessions/live` and re-reads the detail of any live row whose `updated_at` moved; `live_state` rides on those rows. `activity.ts
syncLiveActivities(rows, liveStates)` gets `Object.fromEntries(rows.map(r => [r.id, r.live_state]))` from a new `src/live/useLiveSurfaces.ts`
hook; the owner of `now.tsx` adds its one call line. `surface.etaEpochOf` anchors on `live_state.computed_at` (falling back to `updated_at`), and
`activity.since_s` is aged by the seconds since `computed_at`, for display only.

**3.6 ActivityKit pushes** (`routes/push.py`, `server/builder/live_push.py`). Tokens, `0022_live_activity_tokens`:
```sql
CREATE TABLE live_activity_tokens (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind text NOT NULL CHECK (kind IN ('activity','push_to_start')),
  session_id uuid REFERENCES sessions(id) ON DELETE CASCADE, activity_id text, token text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox','production')),
  creature text NOT NULL CHECK (creature IN ('crab','octopus','dog','cat','owl','fox','whale','bee','bit')),
  last_phase text CHECK (last_phase IN ('working','needsYou','done','stalled')),
  last_trajectory text CHECK (last_trajectory IN ('converging','circling','lost','none')),
  last_pushed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (user_id, token),
  CHECK ((kind = 'activity') = (session_id IS NOT NULL AND activity_id IS NOT NULL)));
```
Owner RLS as session_live (the EXISTS clause applies when `session_id` is not null). Routes, both `current_device`: `POST /v1/push/live-activity`
`{"kind": "activity", "session_id": "<server uuid>", "activity_id": "…", "token": "<hex>", "environment": "sandbox", "creature": "owl"}`, upserted on
`(user_id, token)`; `DELETE /v1/push/live-activity/{activity_id}` (204). The phone starts activities with `push: true`, posts from `onPushToken`, and
deletes when it ends one. The creature rides on the token because the server stores no creature and ContentState requires one.

`live_push.content_state(row, stats, live, *, creature, running_count, now) -> dict` is pure (no DB and no FastAPI import, so a script can call it)
and returns exactly the keys of `BuilderSessionAttributes.ContentState`: `phase, sentence, progress, filesTouched, etaEpoch, trajectory, creature,
linesAdded, linesRemoved, commits, runningCount, updatedEpoch`. `sentence` is `analysis.live.sentence(live)` (names=False, never names=True, whatever
the pref) clamped like `clampSentence` (89). It is the Python half of `surface.toState` for a session WITH a live state; the server never pushes one it
has no state for, so the presence line fallback is not ported. `spec/fixtures/live/content_state.json` pins the two halves together.

When, decided inside the transaction and sent after commit like `send_pending`: `live_push.plan(db, user_id, changed)` for every session whose live
row was written or deleted, per activity token of that session. `(phase, trajectory)` unchanged from `(last_phase, last_trajectory)`: nothing (state
transitions only). Changed: `event: "update"`, `apns-priority: 10` with `alert {"title": "{repo} needs you", "body": sentence}` only on a move INTO
`needsYou` (the phone's `alertFor` words), else priority 5 and no alert; `last_*` updated. Final, or a turn the engine called `done` while the
row is still live (finished, not looked at yet: phase `done`, never `needsYou`, the owner's rule of 2026-09-13, on both halves and in the fixture's
`done_after_commit` case): `event: "end"` with the done state and `"dismissal-date": now + 1200` (DISMISS_AFTER_SECONDS), then the token row is
deleted. The card's `creature` is the one the phone registered with the token: that session's crew creature (`mobile/src/live/crew.ts`), so the
server needs no copy of the crew rule. A move into `needsYou` with NO activity token: one ordinary
banner (`apns-push-type: alert`, `data.kind = "needs_you"`, which `notify.push_data` grows) through `send_session_finished`'s machinery, once per entry
(`session_live.alerted_phase`) and only while `activity.since_s <= notify.NOTIFY_HORIZON_SEC`, because backfill must be silent.

`routes/push.py send_live_activity(row, payload: dict, *, priority: int) -> bool` POSTs `https://api[.sandbox].push.apple.com/3/device/{row.token}`
with `authorization: bearer _apns_jwt()`, `apns-push-type: liveactivity`, `apns-topic: f"{settings().apns_topic}.push-type.liveactivity"`,
`apns-priority: 10 | 5`, `apns-expiration: <stale epoch>`; BadDeviceToken retries once on the other host (the push_tokens rule), and failing both
deletes the row; with no `apns_private_key` it sends nothing and returns False.
```json
{"aps": {"timestamp": 1757749265, "event": "update", "stale-date": 1757750165, "relevance-score": 100,
  "content-state": {"phase": "needsYou", "sentence": "Waiting on you for three minutes", "progress": -1, "filesTouched": 25, "etaEpoch": null,
    "trajectory": "none", "creature": "owl", "linesAdded": 1840, "linesRemoved": 212, "commits": 3, "runningCount": 1, "updatedEpoch": 1757749265},
  "alert": {"title": "private repo needs you", "body": "Waiting on you for three minutes"}}}
```
`stale-date` is now + 900 (STALE_SECONDS, `format.TEMPO_STALE_SECONDS`); `relevance-score` is 100 for needsYou, else the needs_you score capped at 99
(`relevanceOf`). Push to start (`kind: push_to_start`, iOS 17.2+) is stored by the table and not sent in this pass: a start needs an alert, and a card
for every running session is the noise mission control exists to remove.

## 4. Tonight: this session on the simulator, through the same code

No hook goes into `~/.claude/settings.json`. A watcher does what `hook.sh` does, through the same route:

`python -m capture live [--transcript PATH ...] [--root ~/.claude/projects] [--every 5] [--heartbeat 30] [--server URL] [--key KEY] [--tz ZONE] [--once]`

Per transcript (explicit, or every `live.live_transcripts(root, now)` each tick): `sid = path.stem`, `project_dir = path.parent.name`, offset in
`<credentials dir>/live-offsets/<sid>` (0700 dir, 0600 file; never hook.sh's `~/.builder/offsets`). Each tick reads from the offset to the LAST
NEWLINE (a partial trailing line is never sent: CLAUDE.md's first trap) and POSTs `/v1/ingest/transcript` with `X-Builder-Session-Id`,
`X-Builder-Project-Dir`, `X-Builder-Offset`, `X-Builder-Hook: Watch`, `X-Builder-Tz-Offset-Minutes`, gzipped above 64 KB. After `--heartbeat`
seconds with no new bytes it POSTs an empty body at the current offset, which re-cuts on the server's clock so `idle` and "waiting on you for N
minutes" advance. A 409 GETs `/offset` and resends. Auth is `capture.client.Client` (a capture key, or the paired credentials with refresh on 401)
through a new `Client.post_transcript(sid, project_dir, offset, body, hook, tz_offset_minutes) -> dict`. One line per post:
`fa5eaa46  +18,204 B  live  Handing work to three helper agents  needs you 5`. `overnight_stack.sh` gains `live [TRANSCRIPT]`, which runs
`capture_env "$PY" -m capture live --server "$API" --transcript "$T" --every 5 --heartbeat 30`.

```sh
scripts/overnight_stack.sh up && scripts/overnight_stack.sh pair   # migrates 0020 to 0022; phone device.json and capture credentials, one user
scripts/overnight_stack.sh sync      # the history (153 sessions, 148 RideGT, 5 builder) and report v2
scripts/overnight_stack.sh live ~/.claude/projects/-Users-vedantbhatt/fa5eaa46-bdbd-4c15-a73b-8d723f98706b.jsonl
scripts/overnight_stack.sh phone     # /v1/sessions/live now carries live_state
```
Expect: the first post is the whole 6.9 MB file (inside `MAX_BYTES`, 64 MB). The API runs on this Mac, so `repo.identity_for(cwd)` resolves through
git: a builder sitting refuses the ETA `too_few_sessions` (n 5, needed 10, as engine doc 3.5 measured); a home directory sitting `repo_unresolved`.
Both are honest, and the screenshot shows the refusal. The sitting appears once it clears `is_counted` (300 s active, 3 meaningful events). The
simulator app talks to `http://127.0.0.1:8787` as device.json's user; the Now tab's 60 s poll feeds `syncLiveActivities`, which starts the Lock Screen
and Dynamic Island card in the foreground. APNs is not exercised (no key locally; `simctl push` cannot update an activity): a fake transport tests it.

## 5. Backlog bugs, fixed in the same pass

**5.1 capture drops tool calls it should bucket** (WP-D). `capture/sessions.uploaded_tool_counts` keeps only the four names and their aliases, so a
short sitting of WebSearch or ToolSearch calls uploads fewer tool calls than prompts and `sanity_gate` rejects it (5 real sessions). Fix: a name in
`UPLOADED_TOOLS` or `TOOL_ALIASES` keeps its bucket, `mcp__*` goes to `mcp_other`, anything else (WebSearch, WebFetch, ToolSearch, Task, Agent, Grep,
Glob, TodoWrite, ExitPlanMode, Skill) to `other`, as the contract has always said. Such sessions change hash and re-upload once (already final: no
banner). WP-B: `profile.top_tools` skips `TOOL_BUCKETS = ("mcp_other", "other")` but keeps them in the denominator, so "Bash is N% of every tool call"
becomes true on the server. Recorded, not fixed: the Mac stores four tool columns (`SyncCommand.swift` L261) and needs a local schema change. Tests:
`test_websearch_toolsearch_and_mcp_calls_bucket_to_other_and_mcp_other`, `test_a_short_websearch_session_clears_the_prompt_gate` (3 prompts, 3
WebSearch calls), `test_tool_call_keys_are_the_contracts`, `test_toolmap_keys_outside_the_contract_are_rejected`, `test_top_tools_never_names_a_bucket`.

**5.2 the server refuses spend with a misleading reason** (WP-C; WP-B for the machine). `builder_profile._session_fact` passes `output_tokens_by_model`
and no `tokens`, so pricing skips every session and `spend_usd` says "no session reported token counts" about sessions that all did. Fix: the query
selects `st.tok_in, st.tok_cache_read, st.tok_cache_w5m, st.tok_cache_w1h, st.lines_removed_agent, r.repo_hash` (LEFT JOIN repos) and becomes
`_final_rows(db, user, days)`, shared by `corpus_metrics` and `eta_history`; `_session_fact` passes `tokens=ap.pricing.Tokens(...)` when
`tokens_reported` and a bucket is non-null (else None), `lines_removed_agent` (a new `SessionFact` field summed in `session_fact_from_events` beside
`lines_added_agent`; `totals.total_lines_removed`) and `repo=r.repo_hash` (one key for the commit overlap rule and the ETA). `model_costs` rows gain
`model_id` (`per_model` keyed by `pricing.normalize(model)`, a PRICES key). Capture's `_corpus` also passes no tokens, so `capture report` refuses
spend too: `analysis/corpus.cut()` replaces it and `__main__._corpus_facts`. Tests: `test_spend_is_priced_from_the_stored_token_buckets` (two
sessions, one model, dollars from `pricing.cost_usd` by hand, `prices_read_on` present), `test_a_corpus_with_no_token_buckets_refuses_as_not_reported`,
`test_capture_and_analysis_cut_the_same_facts`, `test_model_costs_carry_the_price_table_key`.

**5.3 the phone asks for the wrong window** (WP-E). `api.builderProfile(days = 119)` sends `?days=119`; `/v1/profile/builder` reads `window_days`
(default 90, max 365), so the phone always got 90 and nothing said so. Fix: `builderProfile(windowDays = 90)` sends `?window_days=`; `profile(days)` is
right as it is (`/v1/profile` reads `days` for the graph). Tests: bun `builderProfile sends window_days, the name the server reads`; server
`test_window_days_is_the_query_the_phone_sends`.

**5.4 the session detail omits lines removed** (WP-C). `get_session`'s stats dict lacks `lines_removed_agent` though `_upsert_stats` stores it; the Live
Activity's `linesRemoved` and the money view read it. Fix: add it; `SessionStats` in api.ts gains `lines_removed_agent: number`. Test:
`test_session_detail_carries_lines_removed_agent`.

**5.5 five baselines, mislabelled** (WP-B). paxel.md section 6 (confirmed by a second reviewer): `planning_ratio 2.4`, `code_velocity 487`,
`autonomy_score 0.82`, `avg_prompt_chars 156` come from an explainx.ai mock of a Paxel report; only `steer_rate 0.4` is Paxel copy, describing a heavy
steerer. profile.py already refit planning_ratio (2.5) and code_velocity (523) as MEASURED but still labels autonomy_score, avg_prompt_chars and the
architect (2.4) and velocity_machine (487) thresholds `PAXEL_UNMEASURED` ("Paxel landing page example copy"): the wrong source. Fix: two constants
replace it, `EXPLAINX_MOCK = "UNMEASURED: from an explainx.ai mock of a Paxel report, which Paxel never published; not a measurement"` (those four) and
`PAXEL_HEAVY_STEERER = "UNMEASURED: Paxel landing card 10 ('about 4 prompts in 10'), which describes a heavy steerer, not a norm"` (steer_rate and the
skeptic threshold). No value moves (a threshold move moves archetypes); `docs/analysis.md` gets the same words. Tests:
`test_only_steer_rate_and_skeptic_cite_paxel`, `test_the_explainx_numbers_say_where_they_came_from` (all four contain "explainx.ai").

**5.6 found while designing: the map salt changes every run on a Mac** (WP-D). `_map_salt` hashes `identity.raw_machine_identifier()`, a random UUID
per call on every Mac (its own docstring), so a timer driven `capture sync --live` would redraw the map from nothing on each upload. Fix:
`capture/identity.py map_salt()`, 32 random hex persisted as `map-salt` beside the credentials (0600), never uploaded; `__main__._map_salt` calls it (that one line is WP-B's file). Test:
`test_map_salt_is_stable_across_runs_and_never_in_a_payload`.

**5.7 found while designing: `check-gen` misses three generated files** (WP-A). The Makefile's diff list has no `server/builder/report_spec.py`,
`narrative_spec.py` or `shipped_spec.py`, so a hand edit to the report door passes CI. Fix: add them, with `live_spec.py` and `quotes_spec.py`.

## 6. Generated types

| `make gen` step | reads | writes |
|---|---|---|
| `gen_contract.py` | the contract; `spec/live.v1.json` for leaf paths | `server/builder/contract.py` (`live: LiveState \| None`, `live_names: LiveNames \| None`, `TOOL_CALL_KEYS`), `server/builder/quotes_spec.py`, `UploadContract.swift`, `mobile/src/generated/{contract,quotes}.ts`, `upload-fields.json`, `PRIVACY.md` |
| `gen_live.py` (new) | `spec/live.v1.json` | `server/builder/live_spec.py`, `mobile/src/generated/live.ts` (+ `LIVE_ENUMS`) |
| `gen_report.py` | `spec/report.v1.json` | `server/builder/report_spec.py`, `mobile/src/generated/report.ts` (+ `REPORT_ENUMS`, new) |
| `gen_copy.py` (new) | the analysis tables in 1.5; `analysis/tests/corpus_fixture.py` | `mobile/src/generated/copy.ts`, `spec/fixtures/wrapped/cards.json` |
| `gen_live_fixtures.py` (new) | `analysis/tests/transcripts.py` scenarios, `analysis.live`, `live_push.content_state` | `spec/fixtures/live/content_state.json` |

`gen` order: contract, strip, tokens, analysis, narrative, shipped, report, live, copy, live_fixtures, fixtures. gen_report emits no `map` fields (its
Python header has no `MAP_KEY_ENUMS`), which is why kinds and role lines are lists of objects. The screens import:

```ts
import type { BuilderReport, ReportWrapped, ReportWrappedCard, ReportWrappedExtras, ReportArchetypeScore, ReportMoney, ReportModelCost,
  ReportTokens, ReportBurn, ReportBurnCause, ReportVocab, ReportTerm, ReportStack, ReportStackItem, WrappedCard, WrappedRefusal, WrappedValue,
  PricedModel, BurnCause, VocabTerm, StackItem, StackCategory } from '../generated/report';
import { REPORT_ENUMS } from '../generated/report';
import type { LiveState, LiveActivity, LiveVerdict, LiveEvidence, LiveEta, LiveDecision, LiveNeedsYou, LiveFile, LiveFrame, LiveNames,
  ActivityKind, VerdictState, DecisionKind, NeedsYouReason, Phase, Trajectory, Creature } from '../generated/live';
import type { QuotesUpload, QuoteWire, QuoteCard } from '../generated/quotes';
import { COPY } from '../generated/copy';
import { renderCard } from '../copy/wrapped';           // question, display, sentence, or the refusal
import { renderLiveSentence } from '../live/sentence';   // unchanged signature
```
`api.ts`: `SessionDetail.live_state?: LiveState | null`, `live_names?: LiveNames | null`; `SessionStats.lines_removed_agent: number`;
`BuilderProfileResponse.quotes?: QuotesUpload | null`; `PrivacyPrefs = {quotes: boolean; live_names: boolean}` (the salt is never returned); methods
`privacyPrefs()`, `setPrivacyPrefs(p)`, `registerLiveActivity(body)`, `forgetLiveActivity(activityId)`, `deleteQuotes()`. `sentence.ts`'s hand typed
`LiveStateWire` stays the structural partial it is, with a test that a generated `LiveState` fixture is assignable to it.

## 7. Test plan

Commands: `python3 -m unittest discover -s analysis/tests -t .` (546 today; only goes up), `scripts/overnight_stack.sh test` (pytest on
`builder_overnight_test`, RLS as `builder_app`), `make capture-test`, `cd mobile && bun test`, `make check-gen`, `make lint`. Privacy tests plant
sentinels: prompt `zqx sentinel prompt`, path `/tmp/zqx_sentinel_dir/zqx_secret.py`, subject `zqx sentinel subject`, command `zqxcmd --flag`. Python
names below drop their `test_` prefix.

**unittest (analysis/tests).** `test_report.py`: the widened `allowed` (1.6), `the_v2_blocks_carry_only_enums_numbers_and_clocks`, Shape tests at every
level of the five blocks. New `test_report_blocks.py`: `every_wrapped_card_maps_to_the_spec_card_shape`, `a_refused_card_carries_a_code_and_never_a_sentence`,
`local_cards_carry_only_id_n_and_code`, `every_basis_wrapped_can_emit_is_in_the_spec`, `every_refusal_code_is_in_the_spec_and_has_a_template`,
`wrapped_card_enum_is_card_ids`, `priced_model_enum_is_the_price_table`, `vocab_term_enum_is_the_catalog_in_order`, `stack_item_enum_is_the_catalog_in_order`,
`money_invents_no_price_and_says_when_prices_were_read`, `money_refuses_by_basis_when_no_tokens_were_reported`, `burn_cause_shares_are_each_at_most_one`,
`sentinels_never_reach_the_report`, `every_string_in_the_report_is_an_enum_value_or_a_clock`. New `test_corpus.py`:
`capture_and_analysis_cut_the_same_facts`, `facts_carry_tokens_and_burn_when_the_ledger_reported_them`. `test_wrapped.py`:
`every_card_has_a_code_exactly_when_it_has_a_reason`, `units_are_identifiers`, `quotes_upload_is_empty_without_quotes_true`,
`quotes_upload_never_exceeds_160_or_carries_a_mask`, `an_apple_team_id_is_never_quoted`. `test_profile.py`: the 5.1, 5.2, 5.5 tests,
`lines_removed_are_summed_like_lines_added`. `test_burn.py`: `session_burn_detail_attributes_barren_tokens_to_causes`. `test_live.py` (WP-D):
`wire_keys_are_the_spec_keys_at_every_level`, `wire_carries_no_path_basename_or_command`, `file_ids_are_16_hex`, `frames_are_objects_and_capped_at_600`,
`map_keeps_the_400_most_recent_and_counts_all`, `refusals_carry_codes_and_needed`, `eta_refuses_without_history_rather_than_counting_zero`,
`repo_key_matches_history_by_key_not_by_path`, `wire_names_are_basenames_only`.

**pytest (server/tests).** `test_contract.py`: `contract_is_v4`, `toolmap_keys_outside_the_contract_are_rejected`, `published_leaf_paths_cover_every_live_scalar`,
`quotes_leaf_paths_are_published`, `every_live_check_value_is_a_spec_enum` (0020 and 0022's CHECK lists against the spec's phase, trajectory, creature). `test_report_route.py` (WP-B):
`a_v2_report_with_every_block_round_trips`, `a_v1_report_without_the_new_blocks_still_round_trips`, `a_wrapped_card_carrying_a_sentence_is_refused`,
`a_quote_inside_the_report_is_refused`, `an_unknown_term_id_is_refused`. New `test_live_ingest.py`: `gate_rejects_live_on_a_final_payload`,
`gate_rejects_names_without_live_or_with_a_separator`, `a_hook_tail_stores_a_live_state_for_the_open_session`,
`the_live_state_is_deleted_when_the_session_finalises`, `live_state_never_carries_a_path_or_a_prompt` (sentinels in the tail; `/v1/sessions/live` and
`/{id}` bodies searched), `an_empty_heartbeat_recomputes_idle`, `eta_history_is_the_stored_sessions_of_the_same_repo_hash`,
`live_names_stored_only_while_the_account_has_them_on`, `live_names_never_appear_in_the_live_list`, `the_live_list_is_slim`. New `test_live_rls.py`:
`another_viewer_cannot_read_a_live_state`, `a_viewer_cannot_write_a_live_row_for_someone_elses_session` (the victim's id resolved through the OWNER
engine first: CLAUDE.md's negative test lesson), `quotes_are_owner_only`, `live_activity_tokens_are_owner_only`, `privacy_prefs_are_owner_only`. New
`test_live_push.py`: `content_state_keys_equal_the_swift_content_state` (parses `BuilderSessionAttributes.swift`), `content_state_matches_the_shared_fixtures`,
`a_push_goes_out_only_on_a_phase_or_trajectory_change`, `needs_you_is_priority_10_with_an_alert_and_everything_else_5`,
`the_topic_is_the_bundle_push_type_liveactivity`, `final_sends_end_with_a_dismissal_date_and_forgets_the_token`, `names_never_reach_a_push`,
`no_apns_key_sends_nothing`, `needs_you_banner_only_without_an_activity_and_only_once`. New `test_quotes_route.py`:
`quotes_are_refused_while_the_account_has_them_off` (409), `quotes_round_trip_when_on`, `turning_quotes_off_deletes_them`, `a_quote_over_160_is_refused`,
`a_quote_with_a_mask_or_an_identifier_is_refused` (`Q7ZK2M9X4P`, `sk-ant-...`), `delete_quotes_route`, `quotes_never_reach_the_feed_or_a_shared_session`.
Plus the 5.2, 5.3, 5.4 tests and `test_boot.py` requiring the four new tables.

**make capture-test.** The 5.1 and 5.6 tests; new `test_live_watch.py`: `the_watcher_sends_only_complete_lines`, `a_409_resumes_from_the_servers_offset`,
`an_idle_tick_sends_an_empty_heartbeat`, `the_watcher_posts_the_hook_headers_to_the_hook_route` (fake opener), `sync_live_attaches_live_and_never_names_without_the_flag`,
`report_dry_run_without_quotes_contains_no_prompt_text`, `quotes_flag_puts_quotes_after_the_report_and_prints_a_409`; `test_contract.py` walks `live`
and `live_names` against the spec.

**bun test.** `api.test.ts` (5.3; `live_state` and `lines_removed_agent` decode); new `wrappedCopy.test.ts` (every fixture card renders the Python
question, display, sentence and refusal exactly; no dash; a digit in every answered sentence); new `copyCatalog.test.ts` (an entry for every
`vocab_term`, `stack_item`, `priced_model`, `burn_cause`, `decision_kind`; no dash in `generated/copy.ts`); `liveSurface.test.ts` (parity of `toState`
and `renderLiveSentence` with `content_state.json`; "the lock screen state never carries a basename even when live_names is present"; "etaEpoch anchors
on computed_at"); `liveActivityAttributes.test.ts` (generated `Phase`, `Trajectory`, `Creature` equal `BuilderLive.types.ts`); new `liveTokens.test.ts`
(`onPushToken` registers `{kind, session_id, activity_id, token, environment, creature}`; end forgets); new `privacyToggles.test.ts` (both default off;
quotes off calls `setPrivacyPrefs({quotes: false})` and shows the deleted count).

## 8. Work packages and order

No two packages edit one file. Generated files belong to the package that owns their generator. `mobile/app/**` screens stay with the UI agents;
WP-E touches only `app/settings.tsx` (the two toggles).

| WP | owns | lands first (others import it) |
|---|---|---|
| A: contract, live spec, then push and privacy | `privacy/upload-contract.json`, `spec/live.v1.json`, `scripts/gen_{contract,live,analysis,live_fixtures}.py`, `Makefile`, their generated outputs (`contract.py`, `live_spec.py`, `quotes_spec.py`, `UploadContract.swift`, `contract.ts`, `live.ts`, `quotes.ts`, `upload-fields.json`, `PRIVACY.md`, `spec/fixtures/live/`), `server/tests/test_contract.py`; phase 2: `server/builder/{live_push.py, quotes.py, notify.py}`, `routes/{push.py, privacy.py}`, `server/tests/{test_live_push,test_quotes_route,test_privacy_prefs}.py` | contract v4, live spec, `make gen`, and a stub `live_push.py` whose `plan()` returns `[]` and `send_after_commit()` does nothing |
| B: report v2, on the machine | `spec/report.v1.json`, `scripts/{gen_report,gen_copy}.py`, `report_spec.py`, `report.ts`, `copy.ts`, `spec/fixtures/wrapped/`, `analysis/{corpus,report_blocks,report,wrapped,profile,burn,__main__}.py`, `analysis/tests/*` except `test_live.py` and `transcripts.py`, `docs/analysis.md`, `server/tests/test_report_route.py` | spec v2 with `report.build` emitting the five blocks as null and the widened `allowed`, in ONE commit so test_report never goes red; then `corpus.cut` and `report.from_corpus` |
| C: server data plane | `server/alembic/versions/{0020_session_live,0021_builder_quotes,0022_live_activity_tokens}.py`, `server/builder/{boot,live_store,hook_ingest,builder_profile}.py`, `routes/{ingest,sync,sessions}.py`, `docs/hooks-capture.md`, `server/tests/{test_live_ingest,test_live_rls,test_builder_profile,test_sync,test_boot,test_ingest}.py` | the three migrations and `boot.py`, before anything that reads the tables |
| D: capture and the live producer | `capture/{sessions,cli,client,identity}.py`, `capture/tests/*`, `analysis/live.py`, `analysis/tests/{test_live,transcripts}.py`, `scripts/overnight_stack.sh` | `live.wire()` in the spec shape, `wire_names`, `eta_history` |
| E: phone data, copy, live | `mobile/src/data/{api,cache}.ts`, `mobile/src/copy/*` (new), `mobile/src/live/{sentence,surface,activity,useLiveSurfaces}.ts`, `mobile/app/settings.tsx`, `mobile/__tests__/{api,wrappedCopy,copyCatalog,liveSurface,liveActivityAttributes,liveTokens,privacyToggles}.test.ts` | `api.ts` types, so screens can build against them |

Order. (1) Start when the engine agents hand over `analysis/`, `mobile/` and `scripts/` (their deviations sections written); nothing here edits a
file they hold. (2) A phase 1 and B step 1 first, in parallel, about an hour; C, D and E start at once against this page's JSON and rebase onto the
generated files. (3) C: migrations and `boot.py` in its first commit, then `live_store`, `builder_profile`, `sync`, `sessions`, `hook_ingest`,
`ingest` (its live tests go green once D's `live.wire` lands). (4) D: `live.py` wire, 5.1, 5.6, `Client.post_transcript`, `capture live`, `sync
--live`, `report --quotes` on B's `from_corpus`, `overnight_stack.sh live`; B step 2: `corpus.py`, `report_blocks.py`, the wrapped, profile and burn
changes, gen_copy. (5) A phase 2 after C's migrations: `live_push`, push, prefs and quotes routes, then `gen_live_fixtures.py` once D's wire lands.
(6) E throughout; its parity tests go green when gen_copy and gen_live_fixtures have run. (7) Integration, one agent: `make gen && git diff
--exit-code`, all six commands of section 7 green, the section 4 demo on the simulator with screenshots, CLAUDE.md's suite counts and PROGRESS.md.

## Deviations (push and privacy, WP-A phase 2)

Each is the option most consistent with CLAUDE.md where section 3.6 or 2.4 was silent, or where the phone's code had moved since this page was
written. Every one has a test in `server/tests/test_live_push.py`, `test_quotes_route.py` or `test_privacy_prefs.py` that fails when it is undone
(checked by mutation: 36 of 36 caught).

- **The card is the Swift struct as it is now.** `BuilderSessionAttributes.ContentState` has 14 keys: `filesTouched` became `filesChanged` (map rows
  with an edit, never a read) and `sinceEpoch` and `endedEpoch` were added. `live_push.CONTENT_STATE_KEYS` is read against the Swift file.
- **No duration in the card's sentence.** A Lock Screen is redrawn only when a push lands, so the card renders `live.sentence` of the state with
  `since_s` and `stuck_s` zeroed ("Waiting on you") and says when it began through `sinceEpoch`; the alert, read once, carries the minutes
  ("Waiting on you for two minutes"). Both are `surface.ts`'s own rules (`surfaceSentenceOf`, `sentenceOf`), ported.
- **Clocks anchor on `live.computed_at`,** as 2.5 and 3.5 say. `surface.ts etaEpochOf` and `sinceEpochOf` still anchor on the session row's
  `updated_at`, which a heartbeat on an unchanged transcript never moves; the fixture's rows are 90 s older than their states, so the phone's
  half fails the fixture until it anchors the same way.
- **A cut map is not counted.** `filesChanged` is -1 when `map.files_total` is above the rows sent. The slim list body keeps one or two rows, and a
  count over them is a plausible wrong number. The fixture's `map_cut` case pins it.
- **`Math.round`, not `round`.** Halves round up, as on the phone (`live_push.js_round`); Python's banker's rounding would move an ETA a minute.
- **The finished card comes down at once while another session runs** (`surface.endOptions`), else after `DISMISS_AFTER_SECONDS`; its content is
  `toState` of the final row with no live state ("Finished", the final counts, `endedEpoch`). Priority 5. `apns-expiration` is eight hours,
  Apple's ceiling on a running activity, so a late end still takes a stale card down.
- **An end is owed to any card whose session is final,** not only to one whose live row was deleted: a session the Mac app sent (no live block)
  deletes no live row when it finishes, so `plan` also ends every activity token on a final session of the account. It runs only when some live
  row of the account moves; `routes/sync.py` could add a live to final transition to `live_changed` to end it on the same upload.
- **A token starts from what the phone shows.** Registration seeds `last_phase` and `last_trajectory` from the session's current live state, so
  the first push is the first change, and a session already waiting when its activity starts does not alert again. A finished session is a 409;
  another person's is a 404; a newer token for the same activity replaces the older one.
- **One entry, one alert, across both channels.** `session_live.alerted_phase` is set when either the activity or the banner said it, and
  cleared when the session leaves needs you. An entry older than `notify.NOTIFY_HORIZON_SEC` (the state's `since_s` aged by the seconds since
  `computed_at`) is recorded and never announced, by either channel. The banner's words and collapse id are the phone's own fallback
  notification's (`localCopy.ts needsYouNotification`: "A session needs you", `needs-you-<id>`); the activity alert's title is `alertFor`'s
  ("private repo needs you"), with the phone's `sound: default`.
- **A planning failure never fails the upload.** `plan` runs in a savepoint; a bug rolls back only its own bookkeeping and is logged.
- **Quotes: three filters, not two, and a fourth lock.** The gate also runs `wrapped._private` (the rule the quote cards pick by), which alone
  catches a home directory path; every quote must name a session the account has uploaded (an excluded repository's are deleted); the switch is
  read `FOR UPDATE`, so a store racing the phone's off either waits and is deleted or sees the off. Reasons name the quote and the rule, never
  the text.
- **Standard library only for the card.** CI's `make gen` runs on a bare Python, so `live_push` restates the spec's `phase`, `trajectory` and
  `creature` lists (pinned both ways to `live_spec.py`) instead of importing pydantic, and the generator leaves the door check to the suite.

Recorded, not fixed (other packages' files):
- `store_payloads` checks File names before storing names without a lock, so a store racing the phone's off can write names after it (the read
  side still refuses to serve them). Reading the switch `FOR UPDATE`, as quotes do, closes it.
- Show details on Lock Screen is the phone's alone; server pushes carry the sentence and the repo. With it off the phone should not register
  activity tokens (and should forget the ones it has), or the token needs a `details` column: a migration.
- A finish that is news still sends its banner (`notify.plan`) when the activity's finished card stays up; `surface.planSync` sends none then.
  Suppressing it needs a `session_notifications.kind` value, which is a migration.

## Deviations (integration, section 8 step 7)

The integration pass, 2026-09-13. Each has a test that fails when it is undone (checked by mutation).

- **The surfaces anchor on `computed_at`.** `surface.anchorOf` is `live_state.computed_at`, then the row's `updated_at`, then now, the
  Python `live_push.anchor_of`; `etaEpochOf` and `sinceEpochOf` count from it. `mission.toWire` carries `computed_at` and `files_total`.
- **A cut map is not counted** on the phone either: `filesChangedOf` is -1 when `files_total` is above the rows sent.
- **`LiveStateWire` is the generated `LiveState`'s structural partial**, and `liveSurface.test.ts` assigns one to the other at compile
  time. `content_state.json` gains a fifteenth case, `waiting_on_background` (a new `tests/transcripts.py` scenario: two background jobs
  out, "Waiting on two background tasks it started", working, relevance 10, no alert), and the phone's `toState`, `renderLiveSentence`,
  `sentenceOf`, `relevanceOf` and `alertFor` equal the fixture on every case. The sentence is also held to `live.sentence` itself over
  45,360 generated states.
- **One dash rule on the phone.** `src/live/sentence.ts` imports `spoken`, `ordinal`, `ROLE_NOUN` and the dash rule from `src/copy/plain.ts`
  (four characters, as `plain.DASH_CHARS`), `__tests__/copy.test.ts` uses it too, the widget string scan decodes Swift `\u{...}` escapes,
  and the Lock Screen's removed count is `-88` with a hyphen, as the phone writes it (it was U+2212).
- **The foreground poll** is `src/live/useLiveSurfaces.ts`, mounted once in `app/_layout.tsx` (it runs whichever tab is open, pauses in
  the background, and stands aside on `/debug/*`); mission control's own sync runs one pass too, so a tile and its card move together.
  `cache.sync` is single flight: two passes asked for at once share one.
- **Activity push tokens** (`src/live/tokens.ts`): every card starts with `push: true` when the server may push to it (signed in, details
  on), and without when ActivityKit refuses a token; `onPushToken` posts `{kind, session_id, activity_id, token, environment, creature}`
  once per token, a creature change re-registers, and an ended or dismissed card, sign out, or turning details off forgets the token on
  the server. On the simulator a real token reached `live_activity_tokens` for this session.
- **Show details on Lock Screen off** now changes the surfaces: the card is named Builder, says "Builder · N running", and carries no
  verdict, clock, count or alert; a move of the switch ends every card so the next sync starts them with the new name.
- **A live to final upload ends its card on that upload** (`routes/sync._went_final`), the Mac app's sessions included, and the file names
  switch is read `FOR SHARE` before names are stored (a two connection race test).
- **The prompt gate reads from 3 tool calls up** (`PROMPT_GATE_MIN_TOOL_CALLS`, measured in CLAUDE.md): the four real conversations it
  refused are stored, and a broken prompt filter is still refused on 110 of the corpus's 115 sessions with a prompt.
- **Session numbers are exact** (`copy.clock`, the CLI's `_clock`): the paragraph said "3 minutes of it with you there" above "2m
  attended" about one 162 second figure. The map row says "project files", because the map leaves Claude Code's own files out and the
  numbers' "files touched" does not.

Fixed later: `live --wire` on an ended sitting printed an ETA with `needed` and `unattended` blanked, which the spec requires. It now prints
`"ended": null`, since no ended sitting's live block can leave the machine (`attach_live` raises on a final); `--json` still shows it.
Fixed later too: the gate refuses `live_names` naming an id on no row of the live map ("live_names names a file the live map does not
carry"), the same reason names without the map are refused. Recorded, not fixed: a finished card that stays up still gets the server's
finish banner (a `session_notifications.kind` value, a migration).
