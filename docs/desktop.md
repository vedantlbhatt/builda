# Builda on the desktop: Mac, Windows, Linux

Requirement 7 of `brief-motion.md`: the Mac app and Windows, cross platform, parity for every
feature, the same design principles, structure allowed to differ. `docs/motion.md` "Mac and
Windows" says how: the notch is the island's Mac body (the native app, `Packages/BuilderKit`,
built separately), and everywhere else the island is a pill from the desktop shell, which runs
the phone's own screens.

## The decision

The phone app (`mobile/`) is the single source of every feature. The desktop app is THE SAME
CODE, exported for the web by Expo and run by react-native-web inside an Electron shell
(`desktop/`). Parity is structural: a feature that ships on the phone is on the desktop the day it
ships, because it is the same component. What differs is layout (`mobile/src/desktop/`) and what
only a desktop process can do (`desktop/src/`).

```
mobile/                                   one codebase
  app/, src/                              every screen, unchanged
  index.web.js                            web entry: CanvasKit (Skia) loads before any route
  src/web/                                web twins of native-only modules (SQLite, secure
                                          store, SF Symbols, the window size hook, Skia's canvas)
  src/desktop/                            the desktop layout, the island page, the bridge's types
      DesktopFrame.web.tsx                sidebar | a list kept beside what it opened | the stack
      island/                             the pill (model, springs, face, wheel)
desktop/                                  the Electron shell
  src/main.js                             windows, links, menu, tray, IPC, the store, the island
  src/preload.js                          window.builda: the whole surface a page gets
  src/bundle.js                           app://builda serves desktop/web (the export)
  src/cors.js                             the API reachable from app://builda
  src/island.js, geometry.js, native.js   the island window: where, click-through, notch
  src/tokens.js                           safeStorage
  scripts/build-web.mjs                   mobile/ -> desktop/web
```

On iOS nothing of this runs. `DesktopFrame.tsx` (what iOS loads) returns its children,
`useFormFactor()` is the constant `'phone'`, `desktopTabs(false)` spreads nothing onto the tab
navigator, and every `.web.ts(x)` twin is invisible to a native bundle. Shared files touched are
listed at the end.

## Run it

```bash
# once
cd mobile && bun install                 # or copy node_modules from a sibling checkout
cd desktop && npm install                # Electron 44, electron-builder 26, qrcode-terminal

# the web bundle the shell loads (the API address is baked in, as in a phone build)
cd desktop && BUILDER_API_URL=https://<server> npm run web     # refuses without it
cd desktop && node scripts/build-web.mjs --local               # http://127.0.0.1:8788

# run the shell on that bundle
cd desktop && npm start

# or on Expo's dev server, hot reloading
cd mobile && BUILDER_API_URL=http://127.0.0.1:8788 bun run web   # :8081
cd desktop && npm run dev

# package
cd desktop && npx electron-builder --mac --dir          # dist/mac-arm64/Builda.app
cd desktop && npx electron-builder --mac                # DMGs, arm64 and x64
cd desktop && npx electron-builder --win                # NSIS installer, x64
cd desktop && npx electron-builder --linux              # AppImage

# checks
cd mobile && bun test && npx tsc --noEmit                # includes __tests__/desktop*.test.ts
cd desktop && npm run check                             # node --test test/*.test.js
```

Useful environment for the shell: `BUILDA_USER_DATA=<dir>` (a separate profile),
`BUILDA_DEV_TOKENS=<device.json>` (start signed in, the way `scripts/e2e_web.mjs` injects a
browser's tokens; refresh tokens rotate, so never share that file with another client),
`BUILDA_ISLAND=0`, `BUILDA_ISLAND_FORCE=1` (show it beside the native Mac app),
`BUILDA_ISLAND_SAMPLE=needsYou|crew|drop|shipped`, `BUILDA_NOTCH=0|1`, `BUILDA_NOTCH_WIDTH=<pt>`,
`BUILDA_DEBUG=1`, and `BUILDA_CAPTURE=<dir>` (below).

## What made the web build work again

It last worked 2026-09-05 (9641950). Since then, each of these took a tab down or blanked it,
found by loading every route:

| what broke | why | the fix |
|---|---|---|
| every Skia view | `Skia` on web is built from `global.CanvasKit` when its module runs | `index.web.js` loads CanvasKit, then requires the router |
| every tab, at load | the worklet plugin captured `separate` in `step`'s closure before it existed (TDZ on V8) | `force.ts` declares it first |
| Projects, You | the onboarding clipboard reached RN's native module by file | `clipboard.web.ts` |
| the Sessions list, empty | the SQLite shim was a dozen-statement interpreter; `cache.ts` now uses `json_extract`, `julianday`, numbered parameters | real SQLite: the wa-sqlite build expo-sqlite ships, in memory, `kv` kept in localStorage |
| tab glyphs, the gear, every arrow | `expo-symbols` draws nothing on web | a web twin draws the symbols the app names |
| repo names, clocks, paths in Times | `ui-monospace` is a Safari keyword | a local font face declared under that name |
| canvases blank after a few | a WebGL context per canvas; Chromium keeps sixteen | ONE context for every Skia view, copied into a 2D canvas each; offscreen surfaces share one too |
| 2 frames in 500 ms on You | the first fix drew overflow on the CPU, where a band's dither shader is interpreted per pixel | (the same one context: 60 fps on every tab) |

## The desktop layout

From 900 points wide (`rules.DESKTOP_MIN_WIDTH`), on web only:

- **Sidebar** in place of the tab bar: the builder's creature at the top, the same five peers with
  the same glyphs and tint rule, Settings at the foot, a fold to the glyphs. On a Mac the top strip
  is the window's drag handle and leaves room for the traffic lights.
- **Lists that stay**: Sessions, Drops and Projects keep their own tab screen in a column beside
  whatever it opened (a session, a drop, a project). A row still calls
  `router.push('/session/<id>')`; the frame leaves the list where it is.
- **Pane widths**: forty screens size themselves from the window's width. A pane tells them its
  own (`PaneSize`, through react-native-web's `useWindowDimensions`), so a strip or a fitted figure
  is laid out for the pane it is in. The hook is swapped in TWO places (`metro.config.js`): where
  react-native-web's index imports it, and the deep import `react-native-web/dist/exports/
  useWindowDimensions` that babel-plugin-react-native-web writes into every app file on web. Until
  2026-09-19 only the first was swapped, so 44 app modules read the window, not the pane (see
  "After the motion merge"); `__tests__/desktopMetro.test.ts` holds both.
- **Content max width** 1120, centred, on pages with no list. Onboarding sits in a phone-wide
  column.
- **Keyboard**: Cmd/Ctrl+1..5 the sections, Cmd/Ctrl+, Settings, Cmd/Ctrl+K a palette over the
  places, the sessions, projects and drops this machine holds, Cmd/Ctrl+\ the sidebar, Esc closes
  a preview over the window if one is up (`ui/overlay.tsx` `dismiss`) and otherwise goes back.
  The shell's menu carries the same, plus Cmd/Ctrl+Shift+V to drop the link on the clipboard.
- **Hover and focus**: a 5% wash on anything pressable, a focus ring for the keyboard, quiet
  scrollbars. The wash is an inset shadow on the pressable and follows ITS corners, so a pressable
  wrapped round a rounded shape carries that shape's radius (the Now stage 44, a wall card 24 or
  22), or it draws a square behind it.
- **Morphs land in the pane** (`src/desktop/morphTarget.web.ts`, rule `rules.morphRectFor`): the
  phone grows the thing you touched into the whole screen because the page is the whole screen.
  Here a row grows into the pane beside its list; a tile on Now, whose session brings the Sessions
  list in with it, covers everything right of the sidebar, because that is what changes; a band on
  You grows into the centred 1120 column. The frame and the morph read one layout rule
  (`rules.frameLayout`). A drop does not use the phone's Opening overlay here: its poster's picture
  grows into the pane and `/drop/<id>` opens there, like every other detail.
- **The Now stage** drops out of its own top edge (full width, height from nothing, the ISLAND
  spring, words lagging) instead of growing out of a 125 point pill: a desktop window has no
  hardware island for it to come from.
- **Signing in**: the phone approves the desktop (RFC 8628, the Mac agent's flow): a code and a QR
  of `builder://pair?code=…`, which the phone's camera opens into `app/pair.tsx`. The desktop gets
  its own device and token pair, stored with safeStorage. MEASURED end to end on the packaged
  build: code shown, approved, signed in and reloaded 5 s later.
- **Two windows, one token store**: the app and the island both refresh. A refresh now holds a Web
  Lock across windows and adopts a pair another window rotated instead of redeeming a spent one
  (which the server treats as reuse and answers by revoking the device).

## The island on the desktop

`/island`, a page of the same bundle, on its own window: frameless, transparent, always on top at
`screen-saver` level, on every Space and over full-screen apps, out of the taskbar and the app
switcher, never focused. It lets every click through except over the pill: the page reports the
pill's box and a 30 Hz look at the pointer flips `setIgnoreMouseEvents`, with forwarded moves so
the page sees the pointer arrive.

Where it sits (`geometry.islandGeometry`): on a notched Mac (the built-in screen's menu bar is
37 or 38 points, the notch's height; every other screen's is 24 or 25) at the very top, and the
page is told the notch's size so the pill grows out of it; on other Macs just under the menu bar;
on Windows and Linux at the top of the work area. Electron does not expose the notch's width, so
200 points is assumed (Apple's machines measure 185 to 200 at default scaling). While the native
Mac app runs (`lsappinfo`, bundle `com.vedantlbhatt.Builder.Mac`) this one stands down: the notch
is the native app's.

What it says (`island/model.ts`, the same four as the phone's island, in the same order): a run
that needs you, the crew running now (the wheel, the active line with a light across it), a reel
being read (sent, reading, N moves ready), and the beat when something shipped. With nothing to
say it is not there. Hover opens it; a click opens the app at the session, the drop, or Now. It
polls `/v1/sessions/live` every 5 s and the wall every 12 s, and posts a native notification when
a run starts needing you or ships.

Motion: one progress value per morph on the ISLAND spring (17, 210, 1); width and height ride it
past their targets, the radius rides it clamped; the outgoing content is gone by 0.28 and scales
up, the incoming arrives from 0.34 rising 5 points from 0.92; the face breathes 1500/1700 ms and
blinks on a random 1.8 to 5 s timer; words arrive 55 ms apart. The constants are
`mobile/src/motion/spec.ts`'s, re-exported by `island/motion.ts` since the merge; the test still
pins the numbers it reads.

**The phone's in-app island in a desktop window** (`src/island/Island.tsx`, host rule in
`src/desktop/islandHost.web.ts`). The phone draws it fused to the hardware island; a desktop window
has none. So: in the island window it draws nothing (that page IS an island); in the desktop
layout the standing states (the crew, a run waiting on you, a demo) are left to this window and to
the Now stage, and only the app's own passing beats (a notice such as "Sent to your Mac", shipped,
a reel being read) come down as a 58 point toast from 8 points under the window's top edge,
centred over the area right of the sidebar, with no camera gap above the words. Under 900 points
the window is the phone layout and gets the phone's island. Settings' "Play every state once"
plays only those passing steps on a desktop (`island/demo.ts` `PASSING_STEPS`). This window does
not hear the main window's notices: they are two pages.

## After the motion merge (2026-09-19)

The motion branch merged the phone's motion overhaul and this shell. The screenshots behind the
first version of this file were of the phone UI before it. On the merged build, at 1440 x 900,
found by reading every screenshot and recording each morph:

| what was wrong | why | the fix |
|---|---|---|
| Now: the island stage 1424 wide in a 1120 pane, its words cut off at the left, square corners; the tile under it clipped | babel rewrites `useWindowDimensions` from 'react-native' to a deep import, and only the index import was swapped for the pane hook: 44 modules read the window | `metro.config.js` swaps the deep import too (`DEEP_WINDOW_HOOK`), held by `desktopMetro.test.ts` |
| the wall: a Pick a move poster 450 wide in a 520 column, its words off the right edge | the same | the same |
| Sessions strips and the Projects split bar running into the column's edge | the same | the same |
| the Glossary grid 36 points past its gutter (listed as left over before the merge) | the same | the same |
| a black pill with the crew's face and a clock over every page title, in a Mac's title bar strip | the phone's in-app island, drawn where a hardware island would be | `islandHost.web.ts`: nothing in the island window, passing beats only, as a toast, in the desktop layout |
| the Now stage opening out of a stray pill in the middle of the page | it grows out of the phone's hardware island | on a desktop it drops from its own top edge |
| a row, a tile or a band growing over the sidebar and the list that were about to stay | `MorphNav` grows to the window | it grows into the pane the route opens in, or over everything right of the sidebar when the list arrives with it |
| a poster opening as an overlay over the whole window, with no route under it | the phone's `wall/Opening.tsx` | the poster grows into the pane and `/drop/<id>` opens there |
| Esc under the pair share preview went back a page and left the preview up | the overlay is not a route | overlays register their own close; Esc asks them first |
| a grey square behind the Now stage and each wall card on hover | the wash follows the pressable, which was square | the pressables carry their shape's corner |
| "Blocked call to navigator.vibrate" in the shell's log on opening a project | expo-haptics on web | `ui/haptics.web.ts` does nothing |

Every one of these is web only or behind the form factor: the phone's twins (`morphTarget.ts`,
`islandHost.ts`, `useIsDesktop()`) are constants, and the few shared lines added (a radius on a
pressable with no fill, a closer registered with the overlay, an optional argument) draw and do
nothing different on a phone.

NOT fixed, a design law finding for the owner: the wall's "Being built" card wears `motion/Aura.tsx`,
a four hue sweep gradient ring (cobalt, iris, orchid, tide) with a glow. That is a multi-hue
gradient border, which the house rules ban. It is the phone's design as merged, the desktop only
shows it, and changing it would change the phone, so it is left for whoever owns the motion work.

## Verifying without a screen

`screencapture` needs the Screen Recording permission for the process that asks, and an
unattended run has nobody to click Allow ("could not create image from display"). So the shell
screenshots itself: `BUILDA_CAPTURE=<dir>` visits each route (`BUILDA_CAPTURE_ROUTES`) and saves
`webContents.capturePage()`, shoots the island on the account's live rows and on every sample,
records it opening frame by frame (`beginFrameSubscription`), and writes every page error to
`capture.log`, with the frames per second each page managed. `scripts/island-video.mjs` plays the
frames at their own timestamps over a drawn notch. These are the app's own pixels: the window's
title bar and traffic lights are the system's and are not in them.
`BUILDA_CAPTURE_PAIR=1` runs the sign in: it leaves the code in `pair-code.txt` for something to
approve and waits for the page to sign itself in.

`scripts/e2e_desktop_web.mjs` screenshots every tab and pushed route of the web build at
1440 x 900 and fails on a page error, a console error or a blank pane. It does not click, so it
cannot see a morph or an overlay; those were recorded frame by frame with a scripted Playwright
page (click, then screenshot as fast as Chromium allows, about one frame per 60 to 100 ms).

## Parity

Every phone feature, and what the desktop has, on the MERGED UI (the motion overhaul). "Same code"
means the phone's own screen or module runs; "verified" means seen working in the desktop build on
the local stack on 2026-09-19, in the web build at 1440 x 900 and in the Electron shell, and says
how where it matters. Rows marked "before the merge" were verified on the old UI and not again.

| phone | desktop | status |
|---|---|---|
| Now: the island stage (the crew's face and state, the wheel, needs you in amber), tiles in needs you order | same code in the centred 1120 column; the stage drops from its top edge instead of growing out of a pill | verified: one real live run, the stage's entrance recorded frame by frame; the waiting (amber) and quiet stages not seen on this account |
| A tile opens its session by growing into it | the tile covers everything right of the sidebar, then the Sessions list and the session appear together | verified, recorded |
| Sessions list, notable and every, paging | same code, in the list column, strips fitted to the column | verified |
| A session: hero, strip, numbers, analysis, links | same code, beside the list; a row grows into that pane | verified, recorded |
| Recap sheet (`?recap=1`) | same code; a full-window sheet | before the merge: opening verified, posting not exercised |
| Photos and a voice note on a post | same code (expo-image-picker, expo-av on web) | not exercised |
| Drops wall: being built, pick a move (Start on the poster), what you made of them, every poster, search | same code, in the list column (520) | verified rendering, scrolled top to bottom; search, Start and the paste field not exercised |
| A drop opening out of its poster | the poster's picture grows into the pane and `/drop/<id>` opens there (the phone's Opening overlay is not used) | verified, recorded |
| A drop: the post, its moves, Start, the repo picker | same code, beside the wall | verified reading; Start not exercised |
| The pair (the reel beside what you made) and its share image | same code; the preview is a modal over the window, Esc closes it | preview and Esc verified; Share does nothing useful (expo-sharing has no sheet in Electron) |
| Sharing a reel INTO Builda (iOS share extension) | paste a link on the wall, Cmd/Ctrl+Shift+V, `builder://drop?url=` | wired; not exercised end to end |
| Drop banners (read, finished) | native notifications from the shell | wired (`localNotify.web.ts`); not observed |
| The in-app island (passing news: "Sent to your Mac", shipped, a reel being read) | a toast from the window's top edge, centred over the page area; standing states are the desktop island's | verified with the Settings tour, recorded; a real notice from a Start not exercised |
| Projects: where the hours go (the split), a project's page | same code, list beside page | verified |
| You, Analysis, Wrapped (15 cards), Money, Stack, Dimensions, Glossary; a band growing into its page | same code; the band grows into the 1120 column | verified rendering; the You to Analysis morph recorded |
| Codebase map, time lapse | same code | verified (the finished-session state only) |
| Creature picker | same code | verified rendering |
| Settings | same code | verified rendering |
| Onboarding | same code, phone-wide column | before the merge |
| Sign in with Apple | not possible off the phone | replaced by the phone approving the desktop: before the merge, end to end |
| Sign in with Google | the redirect is handled when it arrives through the shell | wired; needs a configured client |
| Connect your Mac (scan the agent's code) | same code; webcam or typing | renders; not exercised with a camera |
| Push notifications (APNs) | none on a desktop; the island's poll posts needs you and shipped natively while the app runs | partial |
| Live Activity, Dynamic Island | the desktop island window | verified: every sample, compact and open, and the account's real live run, in the shell |
| Home Screen widget | none | not planned; the island is the glanceable surface |
| Share a card or Wrapped image | expo-sharing has no share sheet in Electron; view-shot's web capture unverified | NOT YET |
| Haptics | none (`ui/haptics.web.ts` does nothing) | not applicable |
| Offline cache | real SQLite in memory, `kv` kept; sessions re-sync each launch | partial: nothing offline across launches |
| Deep links `builder://…` | OS handler, second launch, notification clicks | before the merge |
| Social routes (feed, post, factions, profiles) | same code | not exercised (out of scope on the phone too) |

Builds: before the merge, the Mac app was packaged (`--mac --dir`, arm64) and launched. After the
merge only the unpackaged shell (`electron .` on the exported bundle) was run; the packaged app
was NOT rebuilt. Windows: `--win --dir` and the NSIS installer both BUILD on macOS (a PE32+ x64
`Builda.exe`, a 115 MB `Builda Setup 0.1.0.exe`, unsigned); neither has been RUN, because there
is no Windows machine here. Linux: configured (AppImage), not built.

## Screenshots

Kept under `shots/` (gitignored), from this worktree's build against the local stack:

- `shots/motion/desktop/` (the desktop branch's): BEFORE the merge, the old phone UI (a pink Now
  band, the web of strands on the wall, the old project bands). They no longer show the app.
- `shots/motion/desktop2/web-before/`: the merged build as it came, at 1440 x 900, every route
  (`scripts/e2e_desktop_web.mjs`). All 22 "ok" (no page error, no blank pane), and still broken:
  the e2e cannot see a layout laid out for the wrong width.
- `shots/motion/desktop2/web/`: the same routes after the fixes.
- `shots/motion/desktop2/app/`: the Electron shell's own capture (`BUILDA_CAPTURE`), at 2x, the
  main window's routes and the island window on the live run and every sample; `capture.log` has
  no error.
- `shots/motion/desktop2/motion1/`, `motion2/`: morphs recorded frame by frame (a row, a tile, a
  poster, a band, the Now stage's entrance, the Settings tour), with contact sheets. Headless
  Chromium screenshots at roughly one frame per 60 to 100 ms, so they show WHERE things go, not
  whether the spring feels right; that needs a person at a screen.

## Shared files this touched

Surgical, and none changes what iOS draws: `mobile/app/_layout.tsx` (the frame around the stack,
the island route in a web-only guard, a transparent ground for the island window),
`mobile/app/(tabs)/_layout.tsx` (`{...desktopTabs(desktop)}`), `mobile/src/data/api.ts` (the
cross-window refresh), `mobile/src/insights/RevealScroll.tsx` (the reveal arms at the pane's left
edge, 0 on a phone), `mobile/src/drops/force.ts` (declaration order), `mobile/metro.config.js`
(web-only resolver rules), `mobile/package.json` (`main: index`, two scripts),
`mobile/src/web/*` (the web shims), `.gitignore`.

After the motion merge: `mobile/metro.config.js` (the deep window hook, web only);
`src/motion/MorphNav.tsx` (an optional route and picture; the target is null on a phone, so the
same math); its callers `src/insights/Band.tsx`, `src/live/MissionTile.tsx`,
`src/session/SessionsScreen.tsx` (pass the route); `src/live/IslandStage.tsx` (the desktop start
box behind `useIsDesktop()`, a radius on its fill-less pressable); `src/island/Island.tsx` (the
host hook, null on a phone); `src/island/demo.ts` (`playIslandTour(only?)`, every step when not
given); `app/settings.tsx` and `app/(tabs)/drops.tsx` (a desktop branch behind `useIsDesktop()`);
`src/ui/overlay.tsx` (`onDismiss`, `dismiss`, which only the desktop's Esc calls);
`src/drops/wall/PairShare.tsx`, `src/drops/wall/Opening.tsx` (register their close);
`src/drops/wall/Cards.tsx` (radii on fill-less pressables). New, desktop or web only:
`src/desktop/morphTarget(.web).ts`, `src/desktop/islandHost(.web).ts`, `src/ui/haptics.web.ts`.

## What is left

- Signing and notarization (a Developer ID certificate and an App Store Connect key, which live in
  a password manager); Windows code signing. Until then Gatekeeper and SmartScreen ask once.
- Run the Windows build on Windows: the island's `toolbar` window type, the tray, DPAPI.
- Rebuild and run the PACKAGED Mac app on the merged UI (only `electron .` was run after the merge).
- Sharing an image from the desktop: save to a file and reveal it, or copy it, through the bridge.
  The pair preview's Share button is the phone's and does nothing useful here.
- The Aura's four hue ring on the wall's "Being built" card (see "After the motion merge").
- The in-app island and the desktop island window are two pages: a notice the app posts ("Sent to
  your Mac") shows in the app's window only. A bridge message would let the window say it too.
- The Settings tour on a desktop plays only the passing states; the standing ones are the desktop
  island's, which has samples (`BUILDA_ISLAND_SAMPLE`) but no tour of its own.
- Not seen on the merged UI: the Now stage waiting (amber) and quiet (asleep), a drop's Start, the
  repo picker, the wall's search, onboarding, deep links. The morphs were recorded in headless
  Chromium at about 10 frames a second: where they go is verified, how they feel is not.
- Reanimated's custom-spring entering animations do not run on web (a warning, and the element
  simply appears).
- Lists kept beside a detail keep polling while hidden; a shared poller would halve the requests.
- The shell takes every request on the API's scheme to answer the API's preflights (`cors.js`);
  against an https API that is every https request the page makes, images included, passed
  through `net.fetch`. Listing `app://builda` in the server's CORS origins would let it stop.
