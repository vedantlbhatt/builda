# Overnight progress

Read `brief.md` for what was asked. This file is where it stands. Newest at the top of each
section.

## Done

- Integration pass of `builder-integrate-and-screens` (uncommitted; the orchestrator commits):
  contract v4 + live spec, report v2 with all five blocks filled from the real corpus,
  migrations 0020 to 0023, the live state on the hook channel and `capture sync --live`,
  ActivityKit pushes and the push token route, quotes and file names opt ins, the phone's
  data, copy, Settings switches, and the screens (Wrapped deck, You pages, session burn +
  summary + title, mission control + LiveBar, codebase map + time lapse). Suites: analysis
  1196, pytest 309, capture 120, bun 1463, tsc clean, lint clean, `make gen` idempotent,
  Swift digest parity 13/13. Seams fixed in the pass: the Lock Screen's clocks anchor on
  `live_state.computed_at`; a cut map is not counted; one dash rule on the phone (U+2015,
  U+2212; the Lock Screen writes `-88`); the generated `LiveState` is the surfaces' type;
  the root foreground poll (`src/live/useLiveSurfaces.ts`) drives the Live Activity and the
  widget from real rows; activity push tokens go to the server (details on only); Show
  details on Lock Screen off now says "Builder · N running"; a live to final upload ends
  its card at once; the file names switch is read under a lock; the prompt gate reads from 3
  tool calls up (the 4 real conversations it refused are stored); the session numbers are
  exact seconds; the map row says "project files". End to end with THIS session live:
  `shots/screens/e2e-{now,session,session-burn,lock,lock-details-off,island-widget,wrapped-grid}.png`.
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

- Owner feedback at 09:22 and after: more colour, react-bits used visibly, "basic ai ui",
  the full analysis with numbers counting up and charts drawing on, rename to Builda (done,
  3665e85). The $2,951 is API list price value, not a bill (said in the money copy).
- Workflow `builder-colour-motion`: the v2 spectrum (nine hues: amber, brass, ember, rose,
  orchid, heather, iris, cobalt, tide; `design-refs/DESIGN-V2-COLOUR-MOTION.md`,
  `shots/v2/design/palette.png`), then react-bits ports into `mobile/src/ui/bits/`, every
  screen rebuilt with them, simulator video + critics + polish, native recolour.
- Agent: the full analysis page `builder://analysis` (`mobile/app/analysis.tsx`,
  `mobile/src/insights/`), eleven chapters, count ups per section, draw on charts, on both
  simulators. Needs an entry row from the You tab when the redesign releases that file.
- Artifact: https://claude.ai/code/artifact/542a2582-7538-475f-b9fc-796cfdb22a0a, built by
  `scratchpad/artifact/build.py` from `manifest.json`; republish as screens land.

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

- FIXED in the integration pass: capture buckets every tool call (1 of the 5 rejected
  sittings); the other 4 were real conversations with more prompts than calls, now stored
  because the gate reads from 3 calls up (CLAUDE.md, "A gate written for a 13x bug").
- FIXED: the server prices spend from the stored token buckets ($2,988.38 over 167 stored
  sessions; the Mac's report says $2,951.68 over 157, and the phone prefers the report).
- FIXED: `api.builderProfile()` sends `?window_days=`; the session detail carries
  `lines_removed_agent`; the explainx and Paxel baselines say where they came from.
- Still open, for a decision: a finished card that stays up still gets the server's
  "Session finished" banner (needs a `session_notifications.kind` value, a migration);
  `live --wire` on an ENDED sitting prints an ETA the spec cannot hold (CLI only, never
  uploaded); the Now tile middle cuts "private repo" to "pr…epo" beside "needs you"; the
  server does not check that `live_names` ids are map ids.
- per-session archetype enum and corpus archetype rules use two different name sets.
- tools: AXe 1.8.0 at `~/.builder-overnight/tools/axe` (brew cannot build here: stale CLT);
  applesimutils on PATH. Lab kit + capture recipe: `design-refs/research/live-activities-assets/`.
- DONE 12:10: history rewritten (filter-branch in a scratch clone, tip tree byte identical)
  so no commit carries the Apple Team ID, then pushed: github.com/vedantlbhatt/builder, branch
  `claude/overnight-analysis` (PUBLIC repo). Commit hashes before 0533f35's successors changed.
  Every commit is pushed from now on (owner, 12:05).
- after native capture polish: regenerate widget creature PNGs from the new pack
  (`python3 scripts/gen_widget_creatures.py`), rebuild, re-capture island/lock/widget.
- live state: Lock Screen "Finished, with two files changed" beside "+0 -0" when line counts
  are unknown (should be hidden, never 0); small widget truncates the sentence.
- simulator: the app on 231E27A6 was rebuilt at 08:40 with `BUILDER_API_URL` (the address is
  baked in at build time) and signed in with its own minted device
  (`~/.builder-overnight/simulator.json`), never `device.json`'s pair. The rebuild's
  `expo run:ios` opened its dev client link on the OTHER booted simulator (C3F41B44) too.

## The final artifact (plan)

- Title: "Builder, overnight". Treatment: utilitarian report in Builder's own system (bg
  #141210, card #1E1B18, border #2F2B27, text #F5F1EA, dim #A8A29A, one accent #FFB300, add
  #7BC96F, del #E5484D; light theme #FBF9F5/#1C1917 with amber as a fill only). System font
  for words (SF on Apple), a mono for data. The one identity detail: the creatures drawn on a
  canvas from their real 16x16 frames.
- Structure: what shipped first (a feature map grouped as the brief: A onboarding and
  identity, B after a session, C the fifteen cards, D live, native surfaces, engine and
  data), each feature = status in words, what it does, phone screenshots, the evidence
  (tests, real numbers, refusals). Then "decisions for you" (history rewrite before push,
  the quotes and file names opt ins, a brand check of the glyphs), the libraries and
  references actually used, and how it was built (workflows, reviews, runs).
- Images: screenshots resized to 390pt wide JPEG (`sips -Z`), published as supporting files.
- live surfaces, settled: elapsed on the Lock Screen and island is a SYSTEM timer ("12:12")
  on purpose. A computed "12m" froze in the background because an activity only redraws on
  an update. The "2:57:..." cut was the box width; it is sized from measured widths now
  (LiveMarks.swift ElapsedTimer). Other times are clock times ("waiting since 9:37").
- workflow agents can hang forever on a permission prompt (an `rm -f` glob and an `mv` to
  scratch did, at 07:02 and 07:46): the native and onboarding workflows were stopped at
  08:25 and their finished work committed by hand (20081e7, 6de98c9).
- seen on the first e2e screenshots (08:51), for the iteration loop if the screens polish
  misses them: Wrapped "How many agents" art is two flat amber blocks (not dithered data);
  "shipped" sub line truncates ("247 com..."); Now tile says "1 running · 1 needs you" for a
  session whose sentence is "Finished, with one file changed" (finished unreviewed needs a
  clearer word than running); repo name truncates to "pr…epo" beside "needs you".
