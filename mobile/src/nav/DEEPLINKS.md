# Routes and deep links

Every screen Builder has, the link that opens it, and what a screenshot harness needs to know to
drive them with `xcrun simctl openurl`. The scheme is `builder://` (`app.config.ts`). The route
files are in `mobile/app/`; the rules behind the gate and dev auth are in `src/nav/rules.ts` and
pinned by `__tests__/nav.test.ts` and `__tests__/nativeIntent.test.ts`.

## Opening a link on the simulator

```bash
SIM=231E27A6-ADA7-48AA-8230-302A04689772          # iPhone 16 Pro, iOS 18.2
xcrun simctl openurl $SIM "builder://wrapped?card=7"
```

iOS sometimes asks **"Open in Builder?"** before handing a custom scheme to the app (it did on
the first link of a session here, and not on the next ones). Confirm it, then screenshot:

```bash
AXE=<scratchpad>/axe/axe                            # AXe, the simulator automation CLI
$AXE tap --label "Open" --wait-timeout 4 --udid $SIM || true   # no prompt is fine
sleep 2
xcrun simctl io $SIM screenshot shot.png
```

Links push onto whatever is on screen. For a clean stack, relaunch first:
`xcrun simctl terminate $SIM com.vedantlbhatt.Builder && xcrun simctl launch $SIM com.vedantlbhatt.Builder`.
A launch with no link lands on the first tab (`/now`), or on onboarding when the gate is closed.

The known expo-av deprecation is kept out of the dev warning toast (`app/_layout.tsx`), so the tab
bar is clear in dev shots. Any other warning still raises the yellow "Open debugger to view
warnings" toast over the bar; its close x is not an accessibility element, so tap it by point
(about x 370, y 811 on the 402 by 874 iPhone 16 Pro).

## The gate

One flag, `device.onboarded.v1` in the cache kv, decides which half of the app exists
(`app/_layout.tsx`, `Stack.Protected`):

| gate | routes that exist | a link to any other route |
|---|---|---|
| not onboarded | `onboarding/*`, `dev-auth`, `dev-gallery` | lands on onboarding (cold) or does nothing (warm) |
| onboarded | everything below except `onboarding/*` | `onboarding/*` does nothing; reset first |

- No flag and signed in: onboarded (every install from before onboarding existed). No flag and
  signed out: a fresh install, onboarding.
- `device.*` keys survive sign out (`cache.clear()`), so signing out never re-runs onboarding.
- Finishing onboarding ("That's me" on `notify`) writes the flag and flips the gate. The root
  stack swaps the onboarding group for the tabs in one render and lands on Now; no onboarding
  route is left for back, the edge swipe or a stale link. That is the one-way door.
- The flag is read once per launch; until it lands the root renders only the canvas colour, so
  a cold start never flashes the wrong half.

To shoot onboarding, close the gate first: `builder://dev-auth?reset=1`. To shoot the app, open
it: `builder://dev-auth?onboarded=1`.

## Dev auth (dev builds only)

```
builder://dev-auth?access=<jwt>&refresh=<token>[&onboarded=1 | &reset=1][&signout=1][&to=<path>]
```

| param | effect |
|---|---|
| `access`, `refresh` | stored with `api.setTokens`, exactly as Apple and Google sign-in end; then push registration and the pending name, as a real sign in does. Both or neither: one alone is refused |
| `onboarded=1` | mark onboarding done |
| `reset=1` | close the gate and clear the onboarding name (never together with `onboarded=1`: refused) |
| `signout=1` | clear tokens and the cache, as Settings' sign out does (runs before tokens) |
| `to=/path` | where to land afterwards, an in-app path (`/wrapped?card=7`); percent-encode it if it has an `&`. Default: `/now` when onboarded, `/onboarding/hello` when not |

Nothing is applied from a refused link; the screen says why and offers Close. The route is
registered only when `__DEV__` is true, and renders a redirect if it is ever reached in a release
build. Tokens are never displayed or logged.

Examples:

```bash
builder://dev-auth?onboarded=1                        # the app, signed out (sample session)
builder://dev-auth?reset=1                            # back to onboarding/hello
builder://dev-auth?signout=1                          # signed out, gate unchanged
builder://dev-auth?onboarded=1&to=/you/money          # the app, straight to a You page
```

### Real tokens for the simulator

The dev bundle talks to `extra.apiBaseUrl`, which is `http://localhost:8000` unless Metro was
started with `BUILDER_API_URL` (the overnight stack serves on `http://127.0.0.1:8787`, which the
simulator reaches as the Mac's loopback). Restart Metro with it before signing the simulator in:

```bash
cd mobile && BUILDER_API_URL=http://127.0.0.1:8787 npx expo start --port 8081
```

Mint a **separate** device for the simulator. Never paste `~/.builder-overnight/device.json`'s
pair: refresh tokens rotate, and the second holder to refresh presents a spent token, which the
server treats as reuse and answers by revoking the whole device, for both holders
(`scripts/overnight_stack.sh`, `cmd_pair`).

```bash
cd ~/Downloads/projects/builder-overnight
DATABASE_URL="postgresql+psycopg://$(id -un)@/builder_overnight?host=/tmp&port=5432" \
  server/.venv/bin/python scripts/e2e_mint_device.py --server http://127.0.0.1:8787 \
  --handle vedant --label "iPhone simulator (overnight)" --platform ios \
  --machine overnight-simulator > ~/.builder-overnight/simulator.json
chmod 600 ~/.builder-overnight/simulator.json
URL=$(python3 -c 'import json,os,urllib.parse as u; d=json.load(open(os.path.expanduser("~/.builder-overnight/simulator.json"))); print("builder://dev-auth?onboarded=1&access=%s&refresh=%s" % (u.quote(d["access_token"], safe=""), u.quote(d["refresh_token"], safe="")))')
xcrun simctl openurl $SIM "$URL"
```

After that the simulator owns that pair and refreshes it itself; mint again rather than reuse it.

## Every route

Paths are what `router.push` takes and what a link carries after `builder://`. "Push" means it
opens over the tabs in the root stack with a back button; the back label is the tab it came
from.

### Tabs (gate open)

| link | screen | notes |
|---|---|---|
| `builder://now` | Now: live sessions, the empty state, the way into mission control | the first tab; `builder://` and `builder:///` land here too |
| `builder://sessions` | Sessions: finished sessions, sample when signed out | the old home screen |
| `builder://you` | You: profile, the You pages, gear to Settings | `builder://profile` (the old route) lands here |

### Pushed over the tabs (gate open)

| link | params | screen |
|---|---|---|
| `builder://session/<id>` | `id`; `recap=1` raises the recap sheet (not for `sample`) | session detail. `sample` is the built-in sample session. Also accepted: `builder://session/<id>/recap`, `builder:///session/<id>` |
| `builder://live` | none | mission control, full screen (skeleton) |
| `builder://wrapped` | `card` = 1 to 15, anything else opens card 1 | Wrapped story view, full screen modal with Close (skeleton) |
| `builder://you/dimensions` | none | the five dimensions and the archetype (skeleton) |
| `builder://you/money` | none | the money view (skeleton) |
| `builder://you/stack` | none | your stack (skeleton) |
| `builder://you/glossary` | none | the glossary (skeleton) |
| `builder://you/map/<id>` | `id`: a session id | codebase map (skeleton) |
| `builder://you/timelapse/<id>` | `id`: a session id | time lapse (skeleton) |
| `builder://settings` | none | Settings |
| `builder://pair` | `code` = `XXXX-XXXX` pairs at once when signed in | connect your Mac. Asks for the camera on first open |
| `builder://icon` | none | the creature picker |

Social, out of the navigation but still routable (nothing in the app links to them):
`builder://feed` (`slug` for a faction feed), `builder://post/<id>`, `builder://factions`,
`builder://u/<handle>`. The session screen's post flow still opens `post/<id>` and `feed`.

### Onboarding (gate closed)

Six steps on one stack; a link to a step lands with `hello` underneath, so back walks the flow.

| link | step |
|---|---|
| `builder://onboarding/hello` | 1, Bit's hello (`builder://onboarding` lands here) |
| `builder://onboarding/name` | 2, your name: stored locally, sent as `display_name` at the first sign in |
| `builder://onboarding/creature` | 3, your creature (skeleton) |
| `builder://onboarding/tools` | 4, your tools (skeleton) |
| `builder://onboarding/connect` | 5, connect your Mac (skeleton) |
| `builder://onboarding/notify` | 6, stay in the loop; "That's me" finishes |

### Dev only (either gate)

| link | params | screen |
|---|---|---|
| `builder://dev-auth` | see above | sign in, gate, sign out |
| `builder://dev-gallery` | `section` (one of `GALLERY_SECTIONS` in `src/ui/KitGallery.tsx`: colour, type, surfaces, rows, stats, buttons, symbols, progress, verdicts, numbers, dither, wrapped, haptics), `scheme` = light or dark, `seed` = integer | the UI kit gallery |

### Not routes

`builder://auth/google#id_token=...` is the Google sign in redirect: the root layout consumes it
and `+native-intent.ts` sends the router to `/settings`. A tapped push opens
`/session/<id>?recap=1` for a finished session (`src/push/route.ts`).

## Shot list, in order

A full pass that needs no taps inside the app:

```bash
link builder://dev-auth?reset=1                  # onboarding
for s in hello name creature tools connect notify; do link builder://onboarding/$s; shot onb-$s; done
link builder://dev-auth?onboarded=1             # tabs
for t in now sessions you; do link builder://$t; shot tab-$t; done
link "builder://session/sample"; shot session
for n in 1 7 15; do link "builder://wrapped?card=$n"; shot wrapped-$n; done
for p in dimensions money stack glossary; do link builder://you/$p; shot you-$p; done
link builder://live; shot live
for s in colour type buttons; do link "builder://dev-gallery?section=$s"; shot kit-$s; done
```

where `link` is the openurl plus prompt snippet above and `shot` is `xcrun simctl io $SIM screenshot`.
