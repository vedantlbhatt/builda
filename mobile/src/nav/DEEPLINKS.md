# Routes and deep links

Every screen Builda has, the link that opens it, and what a screenshot harness needs to know to
drive them with `xcrun simctl openurl`. The scheme is `builder://` (`app.config.ts`). The route
files are in `mobile/app/`; the rules behind the gate and dev auth are in `src/nav/rules.ts` and
pinned by `__tests__/nav.test.ts` and `__tests__/nativeIntent.test.ts`.

## Opening a link on the simulator

```bash
SIM=231E27A6-ADA7-48AA-8230-302A04689772          # iPhone 16 Pro, iOS 18.2
xcrun simctl openurl $SIM "builder://wrapped?card=7"
```

iOS sometimes asks **"Open in Builda?"** before handing a custom scheme to the app (it did on
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

The app talks to `extra.apiBaseUrl`, which is `http://localhost:8000` unless `BUILDER_API_URL`
was set (the overnight stack serves on `http://127.0.0.1:8787`, which the simulator reaches as
the Mac's loopback). This build is not a dev client, so the value the app reads is the
`app.config` Xcode EMBEDDED when it built the binary, not Metro's manifest: restarting Metro
with the variable changes nothing (FOUND IN INTEGRATION, 2026-09-13: every request went to
`localhost:8000` while Metro's manifest said 8787). Build with it, and check what was baked in:

```bash
cd mobile && BUILDER_API_URL=http://127.0.0.1:8787 npx expo run:ios --device $SIM --no-bundler
plutil -p "$(xcrun simctl get_app_container $SIM com.vedantlbhatt.Builder)/EXConstants.bundle/app.config" | grep apiBaseUrl
```

Metro still serves the JavaScript (`npx expo start --port 8081`). `expo run:ios` also opens its
dev client link on every booted simulator, not only `$SIM`.

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
| `builder://analysis` | none | Your analysis: every chapter of the analysis on one page, native large title (`src/insights/`). Not listed in `app/_layout.tsx`, so it sets its own options |
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

## The You pages (Screens S2)

The tab and its four pages are built (they were skeletons above). Each is a route in the root
stack, pushed over the tabs with a back button labelled "You"; each opens by the link below,
signed in or not, and each draws all five states from one rule (`src/you/load.ts`).

| link | screen | reads |
|---|---|---|
| `builder://you` | the creature and name, the builder type (decrypts once), the Wrapped card, the four page rows, then the profile as it was | `GET /v1/profile/builder` (corpus, report, builder_profile), `GET /v1/profile` (graph, totals, projects), the local name and creature |
| `builder://you/dimensions` | five labelled bars with the trend in words, the type with its rule, runners up, where each bar came from, the rules not scored here | `builder_profile.dimensions`, `corpus.archetype` or the report's `builder_type` card |
| `builder://you/money` | dollars at API list prices with the day prices were read, tokens, lines as a diff, cost by model, the two sentences | `report.money` and `report.burn` (v2), else `corpus.metrics.spend_usd` and friends |
| `builder://you/glossary` | terms by the month they were first met, "N more to find." | `report.vocab` (v2) and `generated/copy.ts` TERMS |
| `builder://you/stack` | catalog items by category, sessions on the right | `report.stack` (v2) and `generated/copy.ts` STACK_NAMES |

Reaching each state for a screenshot (no taps needed except the mask):

| state | how |
|---|---|
| loading | the skeleton shows only until the first answer on an install with nothing saved: sign in fresh (`dev-auth` with a new token pair) and shoot at once |
| signed out | `builder://dev-auth?onboarded=1&signout=1&to=/you/money` (any page) |
| error | sign in fresh, then `scripts/overnight_stack.sh down` before the first load: "Could not load this page." with Try again |
| stale | open the page with the API up, then `scripts/overnight_stack.sh down` and pull to refresh: one line at the top, "... Showing what was saved at 9:41." |
| empty, not sent | a report without the v2 blocks (the local stack's report was v1 on 2026-09-13): glossary, stack and money say what sends them and offer "Copy the command" |
| empty, no sessions | the You tab on an account with no sessions: Bit and "Connect your Mac" |
| refused | a block carrying a `reason` (a v2 report built from too few sessions): the refusal sentence, never 0 |

- **The dollar mask.** Long press the dollar figure on `builder://you/money` (VoiceOver: the
  "Hide dollars" action). Every dollar on the page and on the You tab's Money row becomes `$•••`;
  the choice is `device.you.moneyMask.v1` in the cache kv, so it survives a sign out.
- **The archetype reveal.** The name decrypts the first time the tab shows that type on that
  account, then never again (`profile.you.archetypeRevealed.v1`). `dev-auth?signout=1` clears it,
  so the next signed in launch replays it.

## Wrapped (the built screen)

`app/wrapped.tsx`, full screen modal over the tabs, with its own Close. It replaces the
skeleton the table above describes. Two views of one deck: the story (a fanned stack of four,
the front card thrown aside to reach the next) and the grid (every card, two columns, tilted).

| link | opens |
|---|---|
| `builder://wrapped` | the story, on card 1, from the account's report (`GET /v1/profile/builder` `report.wrapped`) |
| `builder://wrapped?card=N` | the story on card N, 1 to 15 in the engine's order (`wrapped.CARD_IDS`); anything else is card 1 |
| `builder://wrapped?view=grid` | the grid; a tap on a card opens the story on it |
| `builder://wrapped?sample=1` | DEV ONLY: the sample deck (the engine's measured corpus run, synthetic headers), labelled "Sample deck" in the caption |
| `builder://wrapped?sample=1&quotes=1` | DEV ONLY: the sample with its three synthetic quotes shown, so cards 9 and 13 decrypt and the go to prompt quotes |

Every param combines (`?sample=1&quotes=1&card=13`, `?sample=1&view=grid`). Inside the story:
a throw of 24pt mostly sideways (or an 800pt/s flick) advances, a tap on the right advances,
a tap on the left third goes back, and Share opens the 4:5 export preview.

States, and how to reach each on the simulator:

| state | how |
|---|---|
| deck | a signed in account whose Mac sent a v2 report with `wrapped`, or `?sample=1` |
| no cards yet ("This report has no cards in it.") | signed in, report v1 (`wrapped` null): the overnight stack before `capture report` sends v2 |
| no report ("No report from your Mac yet.") | signed in, the account has never run `capture report` |
| signed out ("Sign in to see your cards.") | `builder://dev-auth?signout=1&onboarded=1&to=/wrapped` |
| error ("Could not load your cards.") | signed in with nothing cached and the API down (`scripts/overnight_stack.sh down`) |
| saved copy | the deck once loaded, then the API down: the caption ends "saved copy, the server did not answer" |
| loading | the skeleton stack and Bit reading; only visible on a first open with nothing cached |

The count up is a first reveal per report (kv `wrapped.revealed.v1`, keyed by the report's
`generated_at`); the sample deck reveals every time it opens. Wait two seconds before a shot
so the 800ms count and the 1.6s decrypt have landed.

```bash
for n in 1 2 4 5 7 12 15; do link "builder://wrapped?sample=1&card=$n"; sleep 2; shot wrapped-$n; done
link "builder://wrapped?sample=1&quotes=1&card=9";  sleep 2; shot wrapped-quote-9
link "builder://wrapped?sample=1&quotes=1&card=13"; sleep 2; shot wrapped-quote-13
link "builder://wrapped?sample=1&card=13";          sleep 2; shot wrapped-refused-13
link "builder://wrapped?sample=1&view=grid";        sleep 2; shot wrapped-grid
link "builder://wrapped";                           sleep 3; shot wrapped-account
```

## The session screen, in every state (S3)

`builder://session/<id>` is the session screen for a real session: the recap card, then the
engineer voice title and the plain English paragraph, the burn forensics ("where the tokens
went" and the costliest stretches), the decisions and the map and time lapse rows (running
sessions only, when their data is on the session), then Numbers, the notes worth a look and the
analysis. A running session opens on the live bar (`src/live/LiveBar.tsx`) above the card.

The built in sample opens in each state with `variant` (dev builds only; a release build always
shows the finished sample). No server, no Mac and no network needed; the states come from
`src/session/samples.ts` and are pinned by `__tests__/sessionScreen.test.ts`.

| link | what it shows |
|---|---|
| `builder://session/sample` | finished: title from the ids, the paragraph, the burn numbers, three costly stretches, one note worth a look |
| `builder://session/sample?variant=live` | running: the live bar on top with why it has no ETA under it, the paragraph in the present tense, decisions, the map and time lapse rows |
| `builder://session/sample?variant=refused` | a Cursor session: the burn section's refusal as a sentence, the tokens stat refused under Numbers |
| `builder://session/sample?variant=short` | three stretches: the numbers, and why no stretch is singled out |
| `builder://session/sample?variant=quiet` | an older producer: the harness's own title, no burn block ("No cost breakdown was sent with this session.") |
| `builder://session/sample?variant=stale` | the finished sample under the stale line ("Builda is not reachable right now. Showing what this phone saved.") |
| `builder://session/sample?variant=loading` | the skeleton, held (it never resolves) |
| `builder://session/sample?variant=missing` | Bit, "This session is not here.", Back to sessions |
| `builder://session/sample?variant=error` | Bit, "Could not load this session.", the reason, Try again |
| `builder://session/sample?variant=signedout` | Bit, "Sign in to see this session.", Sign in |

The live variant's map and time lapse rows open `builder://you/map/sample?variant=live` and
`builder://you/timelapse/sample?variant=live`, so those pages can draw the same sample
(`sampleOutcome(SAMPLE_SESSION, 'live', now, OFFLINE_MESSAGE)`).

```bash
for v in "" live refused short quiet stale loading missing error signedout; do
  link "builder://session/sample${v:+?variant=$v}"; shot "session-${v:-final}"
done
```

## Mission control (Screens S4)

The Now tab IS mission control: the grid sits inline under the large title, and `builder://live`
is the same component (`MissionControl` in `src/live/LiveSessions.tsx`) pushed full screen over
the tabs, with a back button. The Sessions tab's "live now" block is one row into `/live`
("3 running", "1 needs you" in amber, the top session's sentence under it). A tile opens
`/session/<id>`, whose screen carries the live bar (`src/live/LiveBar.tsx`). Every rule (the
order, the 15 second hold, the ten minute finished tile, every word on a tile) is pure in
`src/live/mission.ts` and pinned by `__tests__/mission.test.ts`.

| link | screen |
|---|---|
| `builder://now` | mission control inline: summary line, two tiles per row, Bit when nothing runs |
| `builder://live` | the same grid pushed full screen ("Mission control" in the bar) |
| `builder://live?sample=grid` (also `sample=1`) | DEV ONLY: six sample tiles, one of each kind a person meets most (needs you, circling, lost, finished, converging with an ETA, starting), labelled "sample sessions, not yours" |
| `builder://live?sample=all` | DEV ONLY: eight tiles, adding no new output and a wait on the agent's own background job |
| `builder://live?sample=empty` | DEV ONLY: Bit, "Nothing needs you.", and the last finished session as one row |
| `builder://live?sample=loading` | DEV ONLY: the skeleton, two tiles' shape |
| `builder://live?sample=error` | DEV ONLY: "Could not check what is running." with Try again |
| `builder://live?sample=stale` | DEV ONLY: the grid with the stale note at the top and one tile "as of" forty minutes ago, dimmed |
| `builder://live?sample=refused` | DEV ONLY: two sessions without a live state; their tiles use the presence line and the sentence under the grid says why none can say it needs you |
| `builder://live?sample=signedout` | DEV ONLY: "Nothing running that we can see." with Sign in |
| `builder://live?bars=1` | DEV ONLY: the session screen's live bar for every sample session (needs you, circling, lost, converging, starting, no new output, background, stale) |
| `builder://now?sample=<kind>` | DEV ONLY: any of the kinds above inline on the Now tab |

Reaching each state with real data:

| state | how |
|---|---|
| grid | a running session on the signed in account: `scripts/overnight_stack.sh live <transcript>` |
| needs you | the same, once the agent hands the turn back; the top such tile's creature is the only one that moves |
| finished | a session the phone saw leave the live list; its tile says "finished" and what landed for ten minutes |
| empty | signed in, nothing running |
| loading | sign in fresh (a new token pair) and shoot at once; it shows only until the first answer |
| error | sign in fresh, then `scripts/overnight_stack.sh down` before the first load |
| stale | load once with the API up, then `scripts/overnight_stack.sh down` and pull to refresh |
| refused | a live row uploaded without `live_state` (the Mac app, or a server older than 0020) |
| signed out | `builder://dev-auth?onboarded=1&signout=1&to=/now` |

The order re-sorts at most every 15 s and never while a finger is down, so a shot taken right
after a link shows the first placement; wait 16 s for the settled order when the data moved.
The live bar is on `builder://session/<id>` for a running session; `?bars=1` shows it without one.

```bash
for s in grid all empty loading error stale refused signedout; do link "builder://live?sample=$s"; sleep 2; shot live-$s; done
link "builder://live?bars=1"; sleep 2; shot live-bars
link "builder://now?sample=grid"; sleep 2; shot now-grid
link "builder://now"; sleep 3; shot now-account
```

## The codebase map and the time lapse (Screens S5)

Both were skeletons in the table above and are built. Each is a route in the root stack, pushed
over whatever is on screen with a back button; `id` is the session id `session/<id>` takes. Both
draw from the session detail's `live_state` (`GET /v1/sessions/{id}`), which exists only while
the session runs: the server deletes it when the session finalises, so a finished session shows
a sentence saying when it finished and offers "Open the session", never an empty map.

| link | screen | reads |
|---|---|---|
| `builder://you/map/<id>` | the repository as islands of folders, one cell per file: amber where the agent changed things, dim where it only read, bright where it is now and cooling as it moves on; the files it keeps rewriting pulse (2 s; still and outlined under Reduce Motion); tap a cell or a row for what happened to it; "Watch the time lapse" | `live_state.map`, `.verdict` (the knot), `.activity` (the cursor), `live_names` when File names is on |
| `builder://you/timelapse/<id>` | the same map replayed in fifteen seconds: plays once on arrival (not under Reduce Motion), play and pause, Replay, a scrubber to drag or tap (a selection tick crossing a spike, the knot or the burst), the knot pulsing while the playhead is in it, the burst popping once at the end | `live_state.timelapse` and `.map` |

The built in sample draws both without a Mac, a server or a running session (`src/map/sample.ts`,
a fictional 64 minute session that reads around, gets stuck on three files with failures between
rewrites, then changes a spread of files at the end):

| link | what it shows |
|---|---|
| `builder://you/map/sample` | the whole session: converging, the burst at the end still warm |
| `builder://you/map/sample?variant=circling` | the same session 43 minutes in, stuck: the knot pulses, the sentence says the pass |
| `builder://you/map/sample?variant=names` | with the opt in basenames: the picked cell and the list say `store.ts`, not "A source file" |
| `builder://you/map/sample?variant=cut` | more files than the map keeps: "The map keeps the 400 it touched most recently." |
| `builder://you/map/sample?variant=empty` | running, nothing touched yet: Bit and "Nothing touched yet." |
| `builder://you/timelapse/sample` | the replay: the knot bracketed "stuck" on the scrubber, then "burst" |
| `builder://you/timelapse/sample?variant=cut` | a thinned replay: "the replay keeps N of its M reads and changes" |
| `builder://you/timelapse/sample?variant=circling` | the replay of a session still in its knot: no burst at the end |

Any other `variant` is the session screen's (`src/session/samples.ts`), so the link its sample
offers opens the same sample; those reach the remaining states:

| state | link |
|---|---|
| refused, finished | `builder://you/map/sample?variant=final` (and `you/timelapse/sample?variant=final`) |
| stale | `builder://you/map/sample?variant=stale`: the stale line above the finished refusal |
| loading | `builder://you/map/sample?variant=loading`: the skeleton stays up |
| missing | `builder://you/map/sample?variant=missing` |
| error | `builder://you/map/sample?variant=error` |
| signed out | `builder://you/map/sample?variant=signedout` |
| the session screen's small live sample | `builder://you/map/sample?variant=live` |

With real data: a running session on the signed in account (`scripts/overnight_stack.sh live
<transcript>`), then `builder://you/map/<its server id>`. "Not computed" is a live session
uploaded without a live state (the Mac app); its action copies `python -m capture sync --live`.

```bash
for v in "" "?variant=circling" "?variant=names" "?variant=cut" "?variant=empty" "?variant=final" "?variant=loading"; do
  link "builder://you/map/sample$v"; sleep 2; shot "map${v#?variant=}"
done
link "builder://you/timelapse/sample"; sleep 1; shot lapse-playing; sleep 16; shot lapse-ended
link "builder://you/timelapse/sample?variant=cut"; sleep 17; shot lapse-cut
```
