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

- House style (the owner's pick, 11:05): every screen like the analysis page: full bleed
  chapter bands that print themselves, huge numbers counting up, draw on charts, open lists,
  words for navigation. Theme = the builder's creature hue (11:58), amber retired from chrome.
  `design-refs/HOUSE-STYLE.md`. Real tool logos via `src/pixel/HarnessLogo.tsx` (86232de).
- Landed: v2 spectrum (c4ac68f), react-bits ports (5dbc073), creature hues (04323c8), the
  analysis page (69ac174), chrome + theme (fdac4fa), worklet crash fix (c150d95), map and
  time lapse (f7e43f0), You + Money (545f75c), mission control (d37b204), sessions
  (e2a5466), onboarding (e75eb19), Wrapped (eec66ad). bun test 2025, tsc clean.
- Landed after the review: native recolour (8e7dff7), privacy fixes (5f4e675), numbers fixes
  (9969477). All suites green: analysis 1218, capture 137, bun 2052, tsc clean, server 331,
  lint, make gen stable. Stack re synced with the corrected numbers (160 sessions).
- Landed 19:10: the Projects tab and project pages (bf7407d): the week axis in the projects
  block, rivers, the rank race, comparisons, the session swarm, nicknames on the phone only,
  `repo_key` on your own session rows. Captures in `shots/projects/`.
- Landed 19:55: the Money Sankey (c51e84a), reviewed before commit: rounded as one flow so
  every column and tap sentence sums to the shown total ($2,263 + $242 + $11 = $2,516), the
  grey stream leaves mid token stream, leftover reasons read `unresolved` and `projects_total`,
  no redraws after the sweep, copy without jargon. Plus the stack tools chapter, `burn._human`
  parity, Wrapped card 2's margin, `dev-auth?quiet=1`. Captures `shots/money/*-v2.png`.
  Artifact version 6 carries Projects and Money.
- Landed 20:45: the Projects review's fixes (f062570). Private projects go by a phone local
  number, never key characters (the key is an HMAC under the public pepper, so six hex
  confirmed a guessed repository in one try); nicknames and numbers clear on sign out; local
  days; week sentences scoped to what the Mac read; the swarm pages back over every session;
  drawings stop redrawing once landed. Real keys in docs and tests are synthetic.
- Landed 21:10: Money's cross page rounding (cd2abcf): a project reads the same dollars in the
  chart as on its page; when those cannot make the total, one line under the chart says so.
- Owner, 20:40: "make a graph showing token usage in a session, I'm confused how 99% is spent
  reading the cache". Answered with a web page from one real RideGT session (206 calls, 55k to
  253k tokens re-sent per call, 98.6% of tokens and 72.7% of list price cost re-reads, a cache
  expiry after a 68 minute break rewrote 140,553 tokens). Running: the same chart on every
  session page, end to end (engine series, contract field, capture, server, phone).
- Landed 21:55: Settings > Live Activities (05dd8e4). The owner swiped the app away and the
  card stayed in the Dynamic Island; the only way down was iOS Settings. On by default, per
  phone; off takes every card down at once (one from before launch too) and starts none.
- The owner's phone: a Release build over a Cloudflare tunnel, installed over the air from
  a second tunnel serving an itms-services manifest (the device is in the development
  profile, so no App Store Connect). Rebuilding it with every fix above as build 2.
- Visualizations the owner liked the sound of (16:40): project rivers, the rank race and the
  session swarm are built (bf7407d); the Money Sankey is built and in review fixes. Still on
  the list, not started: day ridgelines, tool chords, commit constellation, session
  fingerprint, burn river, the month as a pixel mosaic. The owner loved the stack bubble cloud
  (ee3c87c).
- Fixed from the capture pass: the time lapse crashed (bayer2 used before definition in a
  worklet; 293f273).
- Done since that plan: the capture pass (shots/final, shots/now), the native recolour
  (8e7dff7), the adversarial review and its fixes, the artifact (version 5 at 19:20).
- Pushing every commit to github.com/vedantlbhatt/builda (renamed from builder by the owner;
  the old URL redirects), branch claude/overnight-analysis.

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
  "Session finished" banner (needs a `session_notifications.kind` value, a migration).
- FIXED: the server's gate refuses `live_names` whose ids are not on the live map
  (`test_gate_rejects_a_name_for_a_file_the_map_does_not_carry`; server 345, capture 138).
- FIXED: `live --wire` on an ENDED sitting printed an ETA the spec cannot hold; it prints
  `"ended": null` now (test in `test_cli`). Checked at 18:30 and already fixed earlier: the
  Now tile's "pr…epo" (f11a167, the repository wraps) and the Lock Screen's "+0 -0"
  (`FinishedLine` shows each count only above zero, unknown says nothing).
- FIXED 19:35: `languages.split` could send two "other" rows (an unmapped extension is the
  language `other`, ranked in the top eight and then listed again as the tail's rollup;
  found by the Projects screen, which merges them). Unmapped files now join the tail, and the
  one "other" row is last.
- For a decision: the per-session archetype enum (`spec/analysis.v1.json`: architect,
  velocity_machine, quality_guardian, night_owl, explorer, firefighter) and the corpus rules
  (`spec/report.v1.json`: the same four, then director, skeptic) name two different sets.
  One set is a contract rename in either spec (generated models, the phone's copy, stored
  rows); `docs/analysis-complete.md` also says an archetype is never read from one session.
- tools: AXe 1.8.0 at `~/.builder-overnight/tools/axe` (brew cannot build here: stale CLT);
  applesimutils on PATH. Lab kit + capture recipe: `design-refs/research/live-activities-assets/`.
- DONE 12:10: history rewritten (filter-branch in a scratch clone, tip tree byte identical)
  so no commit carries the Apple Team ID, then pushed: github.com/vedantlbhatt/builder, branch
  `claude/overnight-analysis` (PUBLIC repo). Commit hashes before 0533f35's successors changed.
  Every commit is pushed from now on (owner, 12:05).
- after native capture polish: regenerate widget creature PNGs from the new pack
  (`python3 scripts/gen_widget_creatures.py`), rebuild, re-capture island/lock/widget.
- FIXED 18:55: the small widget cut the longest sentence a surface can show (58 characters,
  measured over every branch of `live.sentence`) to "migration, seventh…". It shrinks to 0.8
  now, only when it must; rendered before and after in `shots/widget-longest/` from the new
  `LiveFixtures.widgetLongest`, which `liveSurface.test.ts` holds to the phone's renderer.
- ENVIRONMENT, not code: inside `bun test`, a child process started from a test file in a
  subfolder of `mobile/` returns empty stdout here (even `echo hi`; the same file in
  `mobile/` itself or the scratchpad prints). So `dither.test.ts` and `missionFit.test.ts`
  fail on `JSON.parse('')` in this terminal; `make gen` still asserts the Bayer parity.
- simulator: the app on <simulator 1> was rebuilt at 08:40 with `BUILDER_API_URL` (the address is
  baked in at build time) and signed in with its own minted device
  (`~/.builder-overnight/simulator.json`), never `device.json`'s pair. The rebuild's
  `expo run:ios` opened its dev client link on the OTHER booted simulator (<simulator 2>) too.
- the owner's iPhone (18:05): Expo Go cannot run this app (SDK 53 against the store's newer
  Go, plus the widget and `builder-live`), so it runs a Debug device build that loads JS from
  this worktree's Metro over Wi-Fi. `overnight_stack.sh lan` serves the phone a second API on
  the Mac's Wi-Fi address; the build bakes that address (`BUILDER_API_URL`) and takes the team
  on the xcodebuild command line only (`DEVELOPMENT_TEAM=...`, never in a tracked file);
  `-allowProvisioningUpdates` registered both bundle ids and the App Group. Then
  `overnight_stack.sh iphone <id>` signs it in with a device of its own.
- the phone off the home Wi-Fi (00:15): the Debug build has no embedded bundle, so away from
  the Mac it cannot start at all, and a build cannot be installed until the phone is on the
  Mac's network or cabled. Also, the Projects agent's `overnight_stack.sh restart` stopped the
  Wi-Fi API through `down` (fixed: restart restores it, 722332a). Now: a Cloudflare quick tunnel
  to 127.0.0.1:8787 (`~/.builder-overnight/tunnel.log`, pid in `tunnel.pid`, the Mac kept awake
  by `caffeinate -w` on it) and a Release device build with the JS embedded and
  `BUILDER_API_URL` set to the tunnel, installed automatically when the phone reappears. A quick
  tunnel's address dies with the process, and the address is baked into the build.
- the phone's first sign in made a second, empty user, and it was NOT an app bug (a first
  note here said it was; retracted). The dev-auth link never applied: the log has no
  authenticated request before `POST /v1/auth/apple`, and the minted device was never used.
  The first launch cannot reach Metro until Local Network is allowed, and the relaunch drops
  the launch URL. So onboarding ran signed out (the Apple button only renders then), and an
  Apple subject this database had never seen made a new user, which is the linking policy
  working. The scripted `vedant` user has no Apple identity. Relinked by hand in
  `builder_overnight` (identity, devices, capture key, push token moved; the empty user
  deleted). `iphone` now says to run it only after the app has loaded once.
  Sign in with Apple itself works against the local API.

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
- native pass must also: draw each session in its crew creature's hue on the Lock Screen and
  island (src/live/activity.ts still uses the builder's own creature), and stop calling a
  finished unreviewed session "needs you" there (mission control's tilePhase rule).

## Waiting on the owner's go (discussed 17:40, not started: "don't code anything to change the UI")

- Restraint: the colour bands lost their charm by being everywhere. Proposal: at most one
  full bleed band per screen for the hero moment; the rest on the calm ground, colour only for
  data and identity; big reveals on first visit only; small pages quiet; Wrapped and the
  analysis page keep their chapters.
- Scroll jank on the analysis page in the simulator. Likely: many Skia canvases redrawing during
  scroll, count ups re rendering text per frame, bands re printing, and a debug build on the
  simulator. Ideas: pause animations while scrolling, flatten finished bands into still images,
  mount only chapters near the viewport, and measure on a release build on a real phone first.
