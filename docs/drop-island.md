# The drop island: a shared reel, read while you keep scrolling

You are in Instagram. You see a reel you want to *do* something with, you share it to Builda,
and you go back to scrolling. Before this, the share went into the App Group and sat there until
you next opened Builda; only then did the Mac read it, and a push told you it had. Now the share
sheet sends it itself when it can, the Mac reads it straight away, and the Dynamic Island carries
the answer while you stay in Instagram, with a Start button for the first move.

This is the island table's third row (`docs/motion.md`, "The island is one object, everywhere"):
something happening somewhere else, on your behalf, that you may want to act on before you would
otherwise open the app. A banner would pull you out of the video. The island does not.

## What the island shows, and why each piece is there

| slot | shows | why |
|---|---|---|
| compact leading | the reel as a 9:16 poster, filling as the Mac gets further: an outline when sent, half full while it reads, full once it knows what it is | the shape the in-app island draws a drop as, so it is recognisably the same object; the level is the progress, with no number nobody measured |
| compact trailing | one word: `sent`, `reading`, `3 moves`, `nothing`, `started`, or `waiting` when the Mac has not answered by the stale date | what is true now, in the width the slot has (13 pt so "reading" fits 52 pt) |
| minimal | a ring: plain while sent, dotted while it reads (the ring's own rule for "no honest number yet"), full in the kind's hue with the move count inside once planned, a check once started, a cross for a refusal | minimal is shown when another app also has an activity; the ring says Builda and the state at 26 pt |
| expanded | where it came from (the platform's name, "Instagram", or the host for a web link, which fits beside the camera where `instagram.com` did not) and the clock time of the last move, what it is (the planner's title, or the step while there is none), a walk of three stops on one hairline (`sent`, `reading`, `3 moves`) with the current stop in colour, and when planned a **Start** button beside the first move's title | the one place there is room to act; Start is the only input, and it starts exactly one move |
| Lock Screen | the same, on the dark card; the step sentence names the host ("Reading instagram.com") | for a phone with no Dynamic Island, and for a locked phone |

Colour is state, from the generated palette only (`Palette.swift`, from `design/tokens.json`):
`spectrum.island.reading` (tide) while the Mac reads it, the drop kind's hue once it is read
(`spectrum.drop`: skill iris, technique tide, project orchid, tool brass, recipe coral),
`data.del` for a refusal, and the warm greys for `unknown` and for a Mac that has not answered.
`gen_tokens.py` now emits `dropHue` and `islandInk` into Palette.swift for this.

The words are the in-app island's (`src/island/model.ts dropSteps`): "Sent to your Mac",
"Reading instagram.com", "3 moves ready", "Nothing to do with this one". A test holds the Swift
copy to that function, so the island inside the app and the one outside it cannot disagree.

**Start is offered only when the island can finish the job itself.** A first move that runs in
one of your repositories (`target: existing_repo`) needs you to pick which one, and the island
cannot pick, so the server sends no move id for it and the card says "Open Builda to start it".
Past the stale date the button goes the same way, because the token it would use has most likely
expired. The button is an iOS 17 `LiveActivityIntent` (`StartDropMoveIntent`) that requires the
phone to be unlocked: a move starts Claude Code on your Mac, and a Lock Screen button anyone
holding the phone can press is not "a person tapped it" in the sense `docs/drops.md` means.

An answered card holds for the in-app island's beat (9 s, `DROP_DONE_HOLD_MS`) and comes down.

## The pieces

| where | what |
|---|---|
| `targets/share/ShareViewController.swift`, `ShareSheetView.swift` | reads the link, posts it when it may, queues it otherwise; says "Sent to your Mac" or "Kept for when Builda opens" |
| `modules/builder-drops/ios/BuilderDropsCredential.swift` | the mirrored token in the App Group's keychain; symlinked into the share extension, `_shared` and the builder-live pod |
| `modules/builder-drops/ios/BuilderDropsURL.swift`, `BuilderDropsShare.swift` | the Swift port of `src/drops/urls.ts` and the one POST; symlinked into the share extension |
| `targets/widget/_shared/BuilderDropAttributes.swift` (+ byte-identical pod copy) | the ActivityAttributes |
| `targets/widget/_shared/DropActivityViews.swift`, `DropStartIntent.swift`, `DropFixtures.swift` | the views, the Start intent, the render fixtures |
| `targets/widget/BuilderDropActivity.swift` | puts the views in ActivityKit's slots; registered in `index.swift` |
| `modules/builder-live/ios/BuilderDropLive.swift` | records, one card per drop, and the token registrar |
| `src/live/dropState.ts`, `dropActivity.ts` | the card from the phone's poll, and the glue (`trackDrop` and the foreground sync call it) |
| `src/drops/shareCredential.ts` | mirrors the access token on every read, write and removal of it |
| `server/builder/drop_push.py`, `routes/drop_activity.py`, migration `0031` | the push decisions, the token routes, the table |
| `spec/fixtures/drops/activity_state.json` | the card both sides must compute, case for case |

## The token model

**What the extension may hold:** a copy of the app's ACCESS token, its `exp`, and the API
address. Never the refresh token.

**For how long:** the access token lives fifteen minutes (`auth.issue_access_token`,
`access_token_ttl_seconds = 900`). The copy is refused thirty seconds before its `exp`
(`BuilderDropsCredential.margin`). The app rewrites the copy every time the access token is read
at launch, written by a sign in or a refresh, and clears it when the token is removed (sign out).
That is one wrapper around the app's own token storage (`src/drops/shareCredential.ts`, used by
`src/data/client.ts`), not a second schedule.

**Where:** a generic password item in the keychain, in the App Group's access group
(`group.com.vedantlbhatt.Builder`), `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`. Every target
that holds the App Group entitlement can read it (the app, the widget extension, the share
extension) and nothing else can. It is readable only while the phone is unlocked, is never in a
backup and is never restored to another phone.

**Why that is safe:**

1. A leaked copy is worth fifteen minutes at most, and cannot be turned into more: nothing
   outside the app can refresh. That is not only a choice, it is forced: refresh tokens rotate,
   a second redeemer of one is reuse, and reuse revokes every token the device holds
   (`auth.redeem_refresh_token`). An extension that refreshed would sign the phone out.
2. The extension calls one route, `POST /v1/drops`, with `api.shareDrop`'s body. That route only
   ever makes an inert card: nothing runs until a person taps a move (`docs/drops.md`, the rule
   the whole feature rests on). The Start intent calls one route, `:start`, for one move, and only
   after Face ID or the passcode.
3. Any failure falls back to the App Group queue, which is unchanged: no token, an expired one,
   a link the Swift normaliser cannot read, four seconds with no answer, a refusal. The old path
   is still the floor, so the worst case is exactly the behaviour before this change.

**The honest limit:** because the copy lives fifteen minutes, the share sheet sends the drop
itself only within fifteen minutes of Builda last refreshing its token, which in practice means
within about fifteen minutes of last having Builda open. Share a reel hours after you last opened
Builda and the sheet says "Kept for when Builda opens", as before, and the island has nothing to
show until you open the app. Making that window longer means a longer lived credential, which is
a decision for a person, not an overnight run: the two ways worth weighing are a scoped share
token the server mints that can call only `POST /v1/drops` (weeks, revocable, useless for
anything else), or a background refresh the app schedules (BGAppRefreshTask) that keeps the copy
fresh without ever handing the refresh token out.

## The push flow

```
share sheet   POST /v1/drops (mirrored token)            drop created, status waiting
server        push-to-start to the app's drop token      the card appears: "Sent to your Mac"
phone (woken) the new card's update token                POST /v1/push/drop-activity (from Swift)
Mac           POST /v1/drops:claim                       update: reading
Mac           PUT  /v1/drops/{id}/resolution             update: planned, N moves, with alert
                                                         (and the read banner is NOT sent)
island        Start: POST /v1/drops/{id}/moves/{m}:start card: started on your Mac; down after 9 s
server        (after that :start, from anywhere)         update: started
```

- **Tokens.** `drop_activity_tokens` (0031): the app's push-to-start token for
  `BuilderDropAttributes` (a different token from the session cards', which is why this is not
  `live_activity_tokens`) and each card's update token, owner only under RLS. The phone's module
  posts them from Swift, not JS (`BuilderDropLive.swift` says why: a push-started card wakes the
  app in the background, and that is no place to wait for React Native). A card registers with
  what it is `showing`; if the Mac got further while it had no token, the server catches it up at
  once.
- **Start on create.** Only for a drop the share CREATED (the same reel twice is the card you
  already have). `event: start`, `attributes-type: BuilderDropAttributes`, the attributes
  (`dropId`, `host`, `platform`), the first content state and an alert (ActivityKit shows a pushed
  start only with one). `input-push-token: 1` asks iOS 18 for the new card's update token; an
  older system ignores it and still hands the token over on the wake it gives the app.
- **Update on transition.** Claim (reading, quiet, priority 5), resolution (planned, with the
  alert, priority 10), refusal (refused, with the alert), a started move (started, quiet). A card
  only ever moves forward, so a claim retried after a stale lease or a second resolution sends
  nothing. When the answer's alert was delivered to a card, the ordinary "it was read" banner is
  not sent as well: one moment, one alert, as `live_push` does for needs you.
- **Nobody else's.** Tokens are read by the drop owner's id AND under their RLS; registering a
  card for someone else's drop is a 404 and refused by the policy's WITH CHECK.
- **No APNs key** (a laptop): nothing is sent, `drop island: APNs is not configured, so N push(es)
  for drop X were not sent` is logged, and the decision is still recorded so a key added later
  does not replay old moves.
- **Stale dates.** Ten minutes while unanswered (resolve and plan take 15 to 40 s, so ten minutes
  means the Mac is asleep, and the card says "waiting for your Mac"); fifteen minutes on an
  answer (the Start button's token lifetime).
- **Ending.** An end push would take the card out of the island at once (iOS removes an ended
  activity from the Dynamic Island immediately and keeps only its Lock Screen copy), which would
  defeat the point of seeing the answer land. So the server never ends a drop card; the phone
  does, 9 s after the answer while the app is in front (`dropMoved`), after the Start beat (the
  intent), and on every foreground sync for any answered card past the beat and any card past its
  stale date (`dropsToEnd`): once you are looking at the board, it says the rest. The honest cost:
  an answer that lands while Builda stays closed sits in the island until you open Builda, tap
  Start, or swipe it away, because no push can end it without taking it out of the island first.

## The app's own start

When the APP lands a drop (paste on the board, a `builder://drop` link, or the drained share
queue) and is in front, `trackDrop` starts the card locally and moves it from the poll it already
runs. iOS never shows your own app's Live Activity while the app is in front, so this card is
for the moment you leave: share, go back to Instagram, and the system island carries on from
where the in-app one was. If a push-started card for the same drop turns up too, the module keeps
one card per drop (a start adopts a live card; a pushed twin is ended on arrival).

Both paths are behind the session cards' two switches: no drop card unless Settings > Live
Activities AND Show details on Lock Screen are on (a drop's title is a stranger's words on your
Lock Screen), and the server may push only for a signed in phone with both on. Turning either
off forgets the tokens on the server and takes every card down.

## Verified here, and not

Verified on this machine (2026-09-19):

- `server/tests/test_drop_island.py` (26, against a Postgres as `builder_app` with RLS on, APNs
  replaced by `test_live_push`'s http2 double): registration and its RLS through a second real
  account, a start on create and none on a re-share, an update per transition and never a step
  back, catch-up on late registration, the banner not doubled, nothing without a token, nothing
  ever to a person who did not share it, the no-key log line, a dead token forgotten, an answer
  ended by the Mac's poll after its hold; and the card held to the Swift struct, the Swift
  phases, the migration and the shared fixture.
- `bun test`: the attributes byte-identical in both places, the Records, the JS types and the
  server's keys one list; `dropState` against the shared fixture; the words against `dropSteps`;
  the credential mirror copies the access token and never the refresh token; the glue with
  ActivityKit faked; and the Swift URL normaliser COMPILED with `swiftc` and run over 24 cases,
  every answer equal to `normalizeShared`.
- The app built natively (iOS 26.5 simulator, "Builda Drops Island") and every drop state
  rendered through the real views to `shots/motion/drop-island/drop-*.png`
  (`BuilderLive.renderPreviews()`, 12 states, 4 surfaces each). Looking at them changed the
  views twice: the Lock Screen said "3 moves" twice a line apart, and the expanded island put
  "instagram.com" under the camera beside an empty top row.
- On the simulator, against the 8788 stack:
  - the mirrored credential lands in the App Group keychain and reads back from the pod
    (`drop=credential`: "usable, 744 s left");
  - the share extension's own send, run from the app (`drop=direct`), POSTed `/v1/drops` with the
    mirrored token and got the card (201). The first attempt, made while the app's sign in was
    loading the server, ran past the 4 s timeout AFTER the server had committed the row; the
    extension would have queued it, and the app's later send is the same card (the route is
    idempotent on the link), which is the fallback working as designed;
  - a real drop card in the real Dynamic Island, compact (`reading`, `3 moves`) and expanded with
    Start, over the Home Screen and over another app (`sim-island-*.png`), and on the real Lock
    Screen (`sim-lock-screen-planned.png`, with iOS's own first run "Allow Live Activities"
    prompt under it);
  - a tap on the card's body opens the board with that drop (`sim-island-tap-opens-board.png`);
  - ActivityKit issued push tokens on the simulator and the module posted them from Swift (the
    8788 stack runs code from before this branch, so it answered 404, as it should).
- Two things the simulator found that no test could: the session gallery's
  `island-expanded-stale` trapped in `LayoutSubviews.subscript` on iOS 26 (a stale card's empty
  trailing region is not a layout subview there), which took the app down half way through every
  render; the preview layout now places only the subviews it has. And a Metro started in a git
  worktree served a stale transform of an edited file until it was restarted with `--clear`.

Not verified, and how to verify on a device:

- **The Start button.** Its tap did nothing on the simulator: no intent ran and nothing reached
  the server. An ad hoc signed simulator build is refused outright by the App Intents daemon
  ("Unable to get teamId ... Rejecting invalid client due to requiresValidBundle"); re-signed
  with the development team it was accepted, and the tap still dispatched nothing. The route it
  calls, the server's `started` push and the intent's metadata (present in both the app and the
  widget extension) are checked; the tap itself needs a device.
- **APNs.** No key here, so no push-to-start or update ever reached a phone. On a device build
  with the Push Notifications capability and `APNS_*` set on the server (and this branch's
  server, which has `POST /v1/push/drop-activity`):
  1. Open Builda once. It registers the drop push-to-start token:
     `SELECT kind FROM drop_activity_tokens` shows a `push_to_start` row.
  2. Leave Builda, open Instagram, share a reel to Builda. The sheet should say "Sent to your
     Mac" and the island should show the poster outline and `sent` within a second or two.
  3. With `python -m drops watch` running on the Mac, the island should go `reading` and then
     `N moves`, expanding once with the alert. No "it was read" banner should arrive.
  4. Tap Start (Face ID if locked). The card says "started on your Mac", the board shows the move
     `queued`, and the card comes down after about 9 s.
  If step 2 shows "Kept for when Builda opens", the mirrored token had expired: open Builda, leave
  it, and share again within fifteen minutes.
- **Where a `LiveActivityIntent` runs.** Apple documents that the system runs it in the app's
  process; the intent is compiled into both the app and the widget extension for that reason, and
  the server's `started` push covers the card if a system version ran it elsewhere.
- **The share extension itself.** `simctl` cannot drive a share sheet, so the extension's send
  was exercised through the same code from the app (`builder://debug/live?drop=direct&url=...`),
  not from Instagram.
