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
  own (`PaneSize`, through react-native-web's `useWindowDimensions`, swapped only where its own
  index imports it), so a strip or a fitted figure is laid out for the pane it is in.
- **Content max width** 1120, centred, on pages with no list. Onboarding sits in a phone-wide
  column.
- **Keyboard**: Cmd/Ctrl+1..5 the sections, Cmd/Ctrl+, Settings, Cmd/Ctrl+K a palette over the
  places, the sessions, projects and drops this machine holds, Cmd/Ctrl+\ the sidebar, Esc back.
  The shell's menu carries the same, plus Cmd/Ctrl+Shift+V to drop the link on the clipboard.
- **Hover and focus**: a 5% wash on anything pressable, a focus ring for the keyboard, quiet
  scrollbars.
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
blinks on a random 1.8 to 5 s timer; words arrive 55 ms apart. The constants are a LOCAL COPY of
`mobile/src/motion/spec.ts` (`island/motion.ts`), pinned by a test, until that file is on this
branch.

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
1440 x 900 and fails on a page error, a console error or a blank pane.

## Parity

Every phone feature, and what the desktop has. "Same code" means the phone's own screen or module
runs; "verified" means seen working in the desktop build on the local stack.

| phone | desktop | status |
|---|---|---|
| Now: mission control, tiles, needs you order | same code, full width | verified |
| Sessions list, notable and every, paging | same code, in the list column | verified |
| A session: hero, strip, numbers, analysis, links | same code, beside the list | verified |
| Recap sheet (`?recap=1`) | same code; a full-window sheet | verified opening; posting not exercised |
| Photos and a voice note on a post | same code (expo-image-picker, expo-av on web) | not exercised |
| Drops wall: the web of strands, search | same code, in the list column | verified |
| A drop: the post, its moves, Start, the repo picker | same code, beside the wall | verified reading; Start not exercised |
| Sharing a reel INTO Builda (iOS share extension) | paste a link on the wall, Cmd/Ctrl+Shift+V, `builder://drop?url=` | wired; the paste field is the phone's; not exercised end to end |
| Drop banners (read, finished) | native notifications from the shell | wired (`localNotify.web.ts`); not observed |
| Projects, a project's page | same code, list beside page | verified |
| You, Analysis, Wrapped (15 cards), Money, Stack, Dimensions, Glossary | same code | verified rendering |
| Codebase map, time lapse | same code | verified (the finished-session state) |
| Creature picker | same code | verified |
| Settings | same code | verified rendering |
| Onboarding | same code, phone-wide column | verified rendering |
| Sign in with Apple | not possible off the phone | replaced by the phone approving the desktop: verified end to end |
| Sign in with Google | the redirect is handled when it arrives through the shell | wired; needs a configured client |
| Connect your Mac (scan the agent's code) | same code; webcam or typing | renders; not exercised with a camera |
| Push notifications (APNs) | none on a desktop; the island's poll posts needs you and shipped natively while the app runs | partial |
| Live Activity, Dynamic Island | the desktop island | verified (samples and a real live run) |
| Home Screen widget | none | not planned; the island is the glanceable surface |
| Share a card or Wrapped image | expo-sharing has no share sheet in Electron; view-shot's web capture unverified | NOT YET |
| Haptics | none | not applicable |
| Offline cache | real SQLite in memory, `kv` kept; sessions re-sync each launch | partial: nothing offline across launches |
| Deep links `builder://…` | OS handler, second launch, notification clicks | verified (second launch opened a session with its recap) |
| Social routes (feed, post, factions, profiles) | same code | not exercised (out of scope on the phone too) |

Builds: the Mac app packaged (`--mac --dir`, arm64) and launched, every screen above captured
from it. Windows: `--win --dir` and the NSIS installer both BUILD on macOS (a PE32+ x64
`Builda.exe`, a 115 MB `Builda Setup 0.1.0.exe`, unsigned); neither has been RUN, because there
is no Windows machine here. Linux: configured (AppImage), not built.

## Shared files this touched

Surgical, and none changes what iOS draws: `mobile/app/_layout.tsx` (the frame around the stack,
the island route in a web-only guard, a transparent ground for the island window),
`mobile/app/(tabs)/_layout.tsx` (`{...desktopTabs(desktop)}`), `mobile/src/data/api.ts` (the
cross-window refresh), `mobile/src/insights/RevealScroll.tsx` (the reveal arms at the pane's left
edge, 0 on a phone), `mobile/src/drops/force.ts` (declaration order), `mobile/metro.config.js`
(web-only resolver rules), `mobile/package.json` (`main: index`, two scripts),
`mobile/src/web/*` (the web shims), `.gitignore`.

## What is left

- Signing and notarization (a Developer ID certificate and an App Store Connect key, which live in
  a password manager); Windows code signing. Until then Gatekeeper and SmartScreen ask once.
- Run the Windows build on Windows: the island's `toolbar` window type, the tray, DPAPI.
- Sharing an image from the desktop: save to a file and reveal it, or copy it, through the bridge.
- The phone's in-app island (`src/island/`, motion branch) and this one should share one model;
  `island/motion.ts` should become an import of `src/motion/spec.ts`.
- Reanimated's custom-spring entering animations do not run on web (a warning, and the element
  simply appears); the Glossary grid overhangs its gutter by about 36 points at 1120 wide.
- Lists kept beside a detail keep polling while hidden; a shared poller would halve the requests.
- The shell takes every request on the API's scheme to answer the API's preflights (`cors.js`);
  against an https API that is every https request the page makes, images included, passed
  through `net.fetch`. Listing `app://builda` in the server's CORS origins would let it stop.
