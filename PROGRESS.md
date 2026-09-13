# Overnight progress

Read `brief.md` for what was asked. This file is where it stands. Newest at the top of each
section.

## Done

- `3a4fa08` analysis engine: wrapped.py (15 cards, 14 answered on the real corpus), live.py,
  vocab.py, plain.py, burn/profile fixes, 1101 tests. `a704386` integration design + the
  Team ID scrub.
- `1386f84` Live Activity, Dynamic Island, widget authored in SwiftUI + builder-live module
  + JS sync layer + debug deep link + capture script. Catalyst renders of 35 states in
  `shots/live-renders-catalyst/`.
- `faddc4d` Mobile foundation: SDK 53 animation/graphics deps, tokens, `mobile/src/ui/` kit,
  tabs Now/Sessions/You, onboarding skeleton, dev auth, refit, slop and dashes removed, three
  simulator review passes (`shots/foundation/final-*`).
- `54588ff` Local end to end stack (`scripts/overnight_stack.sh`).
- Burn forensics patch applied on top of `claude/hello-hvkwll` (546 analysis tests green).
- `planzz.md`, `docs/approved-roadmap.md`, `burn-forensics.patch`, `brief.md` added.

## In progress

- Workflow `builder-integrate-and-screens`: contract v4 + live spec, report v2, server
  (migrations 0020 to 0022, live state, spend fix), capture (tool bucketing fix, `capture
  live`), phone data and copy, and the screens: Wrapped deck, You pages (dimensions, money,
  glossary, stack), session burn + summary + title, mission control + LiveBar, codebase map
  + timelapse. Then end to end with this session live, simulator screenshots, three critics,
  polish, adversarial review. Design: `docs/overnight-integration.md` + addendum (per
  session burn and title_ids).
- Workflow `builder-native-capture`: real simulator captures of the island, Lock Screen,
  widgets, banners, and this session live (`shots/native/`), critics, polish.
- Workflow `builder-onboarding`: the six step flow on the second simulator
  (`Builder Screens`, C3F41B44), video + stills in `shots/onboarding/`.
- Workflow `builder-identity-art`: simplified creature family + harness glyphs
  (`shots/identity/`), finalize stage.

## Reference material

- Design law: `~/Downloads/projects/design-refs/DESIGN-DIRECTION.md` (tokens, type, radius
  rule, motion, haptics, onboarding, icons, Wrapped cards, Live Activity/island/widget
  layouts, react-bits ports, slop pre-flight).
- Local stack: `scripts/overnight_stack.sh up|pair|sync|status|phone|test|down`, API on
  127.0.0.1:8787, DB `builder_overnight`, secrets in `~/.builder-overnight/`.
- Test corpus: `~/.builder-overnight/corpus` (builder + RideGT project dirs, symlinks).
- This live session: `~/.claude/projects/-Users-vedantbhatt/fa5eaa46-bdbd-4c15-a73b-8d723f98706b.jsonl`.

## Next

See `brief.md` sections A to D, in this order: onboarding and icons, the analysis screens and
the Paxel cards, the live engine, Live Activity and widget, mission control, the map.

## Screenshots

`shots/` (git ignored), one folder per run.

## Backlog found along the way

- capture drops WebSearch/ToolSearch/MCP tool calls instead of bucketing them as
  `mcp_other`/`other` (the contract says bucket), so short chat sittings are rejected by
  `sanity_gate` (prompts > tool_calls). 5 of 154 real sessions. Fix in capture, not the gate.
- server `builder_profile` builds the corpus without token counts, so `spend_usd` is always
  refused with a misleading reason.
- phone `api.builderProfile()` sends `?days=`, the server reads `window_days`.
- `GET /v1/sessions/{id}` omits `lines_removed_agent`.
- per-session archetype enum and corpus archetype rules use two different name sets.
- the four explainx sourced BASELINES (planning_ratio, code_velocity, autonomy_score,
  avg_prompt_chars) and the architect/velocity_machine thresholds: label the source as an
  explainx.ai mock of a Paxel report, not Paxel copy (research/paxel.md). Only steer_rate
  0.4 is Paxel copy.
- tools: AXe 1.8.0 at `~/.builder-overnight/tools/axe` (brew cannot build here: stale CLT);
  applesimutils on PATH. Lab kit + capture recipe: `design-refs/research/live-activities-assets/`.
- MUST BEFORE ANY PUSH: rewrite the local commits 0f2c735 (brief.md) and faddc4d
  (mobile/__tests__/uikit.test.ts) that contain the owner's Apple Team ID from the Paxel
  screenshot (replaced in the working tree by Q7ZK2XW9PL). Run scripts/check_private_tokens.py.
