# Motion: where it stands

`brief-motion.md` is what was asked. `docs/motion.md` is the design. This file is the state; read
it first when resuming. Newest at the top of each section.

Branch `claude/motion`, worktree `~/Downloads/projects/builda-motion`. Pushed to
`origin/claude/motion` (the repo is `vedantlbhatt/builda`). Three helper branches built in
parallel by subagents in their own worktrees, to be merged here when they report:
`claude/motion-mac` (the notch island in SwiftUI), `claude/motion-shipkit` (the demo ship kit),
`claude/motion-desktop` (Electron + react-native-web, Mac and Windows).

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
- A rebuild of the native app: `cd mobile && BUILDER_API_URL=http://127.0.0.1:8788 npx expo run:ios
  --device <UDID> --no-bundler`, then `xcrun simctl install <UDID> <DerivedData>/Builda.app` if the
  install step was skipped. `targets/*/generated.entitlements` are not in git: copy them from
  builder-drops when a fresh worktree is made.

## Done

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

1. Drops, rethought (docs/motion.md "Drops: seen, built, shown"): the wall of 9:16 posters, moves
   on the poster, the aura on a running one, the seen → built pair.
2. The pixel diet across the tabs: Now, Sessions, Projects, You, each its own entrance.
3. Drop Live Activity (system island while you are still in Instagram).
4. Merge the three helper branches; screenshots and recordings of everything; the artifact.

## Measured

1. The clip's container: first peak ~300 ms, ~10% over, still ~450 ms. The spring
   (17, 210, 1) gives 268 ms, 10.3%, 460 ms at 2%.
2. An `rgba()` stop colour in react-native-svg paints at full strength on iOS: the first wash
   was a solid block. Hex plus `stopOpacity`.
3. A clock set at mount reads "now" for a wait that began after it: the first "2m waiting"
   read "now". The island re-reads the clock when its activity changes.
4. Toast words at the island's vertical centre sit under the camera; the toast is the hardware
   height plus 58 and its words start 34 down.
