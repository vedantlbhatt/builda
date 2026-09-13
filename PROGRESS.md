# Overnight progress

Read `brief.md` for what was asked. This file is where it stands. Newest at the top of each
section.

## Done

- Burn forensics patch applied on top of `claude/hello-hvkwll` (546 analysis tests green).
- `planzz.md`, `docs/approved-roadmap.md`, `burn-forensics.patch`, `brief.md` added.

## In progress

- Workflow `builder-engine`: `analysis/wrapped.py` (15 Paxel cards), `analysis/live.py`
  (sentence, verdict, ETA, decisions, needs you, map, timelapse), `analysis/vocab.py`
  (glossary, stack, engineer titles), burn/profile fixes. Design doc:
  `docs/overnight-engine.md`.
- Workflow `builder-mobile-foundation`: deps (reanimated, gesture handler, skia, symbols,
  keyboard controller), tokens + `mobile/src/ui/` kit, tabs (Now, Sessions, You),
  onboarding skeleton behind `Stack.Protected`, `builder://dev-auth`, refit + slop removal,
  simulator verify. Shots in `shots/foundation/`.
- Workflow `builder-overnight-research`: Paxel, Live Activities on SDK 53, simulator capture,
  Phantom, competitors. Output in `~/Downloads/projects/design-refs/research/`.

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
