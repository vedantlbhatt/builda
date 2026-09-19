# Motion: where it stands

`brief-motion.md` is what was asked. `docs/motion.md` is the design. This file is the state; read
it first when resuming. Newest at the top of each section.

Branch `claude/motion`, worktree `~/Downloads/projects/builda-motion`. Pushed to
`origin/claude/motion` (the repo is `vedantlbhatt/builda`). Helper branches, built by subagents in
their own worktrees: `claude/motion-mac` (MERGED 41fdf64), `claude/motion-desktop` (MERGED
feab2dd), `claude/motion-dropisland` (MERGED after 3f/aura commit), `claude/motion-shipkit` (the
demo ship kit, still running at 03:05), `claude/motion-desktop2` (desktop parity with the merged
UI, started 02:50).

## The report

https://claude.ai/artifact/C7dfZJDEG9q8wdciD8eLHv, built by
`/private/tmp/claude-501/-Users-vedantbhatt/312de8a5-69ba-47fc-a21e-51a07c7dcf44/scratchpad/report/build.py`
(template.html + status.json + media from `shots/motion/web`). Republish the same file path to
keep the URL; from a new conversation pass the URL.

## Running it

- API: `OVERNIGHT_HOME=~/.builder-drops-stack OVERNIGHT_DB=builder_overnight_drops
  OVERNIGHT_TEST_DB=builder_overnight_drops_test OVERNIGHT_PORT=8788 bash scripts/overnight_stack.sh up`
- Simulator: iPhone 16 Pro `231E27A6-ADA7-48AA-8230-302A04689772` has the build from this worktree
  (API baked to 127.0.0.1:8788, both extensions). Sign it in:
  `... overnight_stack.sh sim 231E27A6-ADA7-48AA-8230-302A04689772 --onboarded`.
  Another agent boots its own "Builda Measure" simulator: ALWAYS pass the UDID, never `booted`.
- Metro: `cd mobile && EXPO_PUBLIC_ISLAND_DEMO=1 npx expo start --port 8081` (the env var makes
  the island cycle through every state for screenshots; drop it for real use).
- Review motion: `scripts/sim_burst.sh <UDID> <dir> 20 1.2 700` tiles a burst of screenshots.
- Metro: start it WITHOUT `CI=1` (`npx expo start --port 8081 < /dev/null` in the background). CI
  mode turns file watching off, and the app then keeps loading the bundle Metro built first: from
  02:54 to 03:22 the simulator ran stale JS and edits looked like they did nothing.
- A rebuild of the native app: `cd mobile && BUILDER_API_URL=http://127.0.0.1:8788 npx expo run:ios
  --device <UDID> --no-bundler`, then `xcrun simctl install <UDID> <DerivedData>/Builda.app` if the
  install step was skipped. `targets/*/generated.entitlements` are not in git: copy them from
  builder-drops when a fresh worktree is made.

## Done

- **Merges** (03:00): Mac notch (SNAP spring aligned to the phone's 33 by the cross check test),
  desktop (its spring copy became a re-export of `src/motion/spec.ts`, its state inks resolve via
  `stateColor`; `force.ts` stays deleted), drop island (Live Activity, share extension direct POST).
- **Aura is one hue** (phone `Aura.tsx`, Mac `AuraRing`): a light travelling round the edge in the
  state's colour over a faint ring. The multi hue ring was the most generated looking thing on
  screen. The Mac face glow reads `DesignTokens.Spectrum.island` (new in the Swift generator).
- **Performance** (02:40): a face is one SVG path and blinks by an opacity overlay, not a render;
  breath and shimmer rest after a few passes. Idle CPU, 20 ps samples: Now 3.8% -> 0.4% median,
  Sessions 0.4 -> 0.2, Drops 2.5 -> 0.5 (20.6 before the wall).
- **Now, one run**: the stage is a header (face, count, "Nothing needs you."), not a second frame
  around a card that repeats the tile under it.
- **The pixel diet** (03a51ad): `Band` is an inset card whose hue grows down on the island spring
  (`springAt`), no dithered fringe anywhere; a number counts up once per screen (the page's
  `counted`); Sessions opens on the week (no live slab), Projects on `HoursSplit`, You's creature
  is a living `Face`.
- **Now** (78fe98e): `IslandStage`, the island opened full width; tiles are dark cards with a face,
  a hue wash and the aura on the one that needs you. The radar is gone.
- **Drops** (d4492dc, a1ca1a3): the wall (`src/drops/wall/`), bands by what happens next, 9:16
  posters, moves on the card, a drop opens out of its exact poster (`Opening`, `ui/overlay.tsx`).
- **Real data on the local stack**: the real corpus is synced into the drops stack
  (`~/.builder-drops-stack/corpus`, symlinks), and this overnight session's transcript is tailed
  into the hook route (`overnight_stack.sh live <jsonl>`), so the island and Now show a real live
  session.
- **Widget faces.** `scripts/gen_widget_creatures.py` draws each animal twice more, lids down and
  eyes up; the Lock Screen and both island presentations draw the phase's face.
- **The in-app island** (`mobile/src/island/`): fused to the hardware island, the crew, needs
  you, a shared reel walking sent → reading → moves, shipped, a demo being cut, notices. Fed by
  the root live poll (`useLiveSurfaces` → `publishLive`, `announceFinished`) and by the drop
  intake (`trackDrop`). Status bar hides while it is big. Tests: `__tests__/island.test.ts`.
- **The motion language** (`mobile/src/motion/`): the spec (the only place a spring lives, held
  to the clip's measurements by `__tests__/motionSpec.test.ts`), `useMorph`, `Face`, `Wheel`,
  `Shimmer`, `RippleItem`, `Words`, `Wash`, `Aura`. Island state colours in
  `design/tokens.json` `spectrum.island`.
- The brief and the design (`brief-motion.md`, `docs/motion.md`).

## Next

1. Merge `claude/motion-shipkit` when it reports; connect "Make the reel" on the pair card and the
   shipped island beat to its demo request.
2. Merge `claude/motion-desktop2`; screenshots of the desktop on the merged UI into the report.
3. Native rebuild on the simulator (widget moods, drop activity); screenshots of the system island.
4. The report: republish with the merges, the perf numbers, Mac and desktop shots.
5. Then: tests, UI audit for anything that still looks generated, new features.

## Measured

1. The clip's container: first peak ~300 ms, ~10% over, still ~450 ms. The spring
   (17, 210, 1) gives 268 ms, 10.3%, 460 ms at 2%.
2. An `rgba()` stop colour in react-native-svg paints at full strength on iOS: the first wash
   was a solid block. Hex plus `stopOpacity`.
3. A clock set at mount reads "now" for a wait that began after it: the first "2m waiting"
   read "now". The island re-reads the clock when its activity changes.
4. Toast words at the island's vertical centre sit under the camera; the toast is the hardware
   height plus 58 and its words start 34 down.
