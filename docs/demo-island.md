# The demo island: a demo you asked for, carried past the app

You open a project's ship kit and tap "Request a demo". Your Mac picks the request up, runs the
app, films it, and makes the kit: minutes, thirteen on the one phone request run end to end
(docs/ship-kit.md). Before this, the IN-APP island carried it (`src/island/feeds.ts trackDemo`):
a faint dot while it waited, the data red while the Mac filmed, green when the kit was up. Leave
Builda and nothing told you. Now the request is a Live Activity too, in the system Dynamic Island
and on the Lock Screen, so you can go back to whatever you were doing and see the kit land.

This is the island table's fourth row (docs/motion.md, "a demo being cut"): something happening
somewhere else, on your behalf, that you will want to act on the moment it is done. It is the
same object as the in-app demo island, in a second body.

## What the card shows, and why each piece is there

| slot | shows | why |
|---|---|---|
| compact leading | the record light: a faint dot while asked, the data red while the Mac films, the data green once the kit is up, a red cross when it could not be made | the in-app island's demo dot, so it is recognisably the same thing; red is what a record light is everywhere; a failure is a cross so red never has to mean two things |
| compact trailing | how long since you asked, as a system timer (`4:30`, `1:02:00`), or the answer in one word: `kit` in the green, `no kit` in the red | the in-app ear's clock and its word `kit`. A system timer, not a written "4m": a number in the state froze on the Lock Screen for as long as the app was away (`LiveMarks.swift ElapsedTimer` records it) |
| minimal | the light alone | minimal is shown when another app also has an activity; the light says Builda and where it stands at 26 pt |
| expanded | the light and "Demo" beside the camera, the timer (or the clock time it landed) on the right, the project's title in the project's own hue, the walk `asked`, `filming`, `kit up` (or `made`, or `no kit`) on one hairline with the current stop in the light's colour, and when ready a **Share** button with "Tap to share it anywhere." | the one place with room to act; Share is a link, `builder://ship/<key>`, the screen the in-app island opens when its demo is tapped |
| Lock Screen | the same, on the dark card | for a phone with no Dynamic Island, and for a locked phone |

A failure's walk ends `no kit` in the red and the line under it is the kit screen's own:
"It did not work: the Mac could not film it." A Mac that goes quiet past the stale date turns the
light faint and adds the one line that is news: "Waiting for your Mac" for a request nobody picked
up, "Not updating since 3:56am" for one that went quiet while filming.

**Colour** comes only from the generated palette. `design/tokens.json spectrum.demo` names the
light for each phase as token paths (`surface.textFaint`, `data.del`, `data.add`, `data.del`),
never a hue: the light is state, and the project's hue already colours its title on the same card.
`scripts/gen_tokens.py` validates it (exactly the four phases, token paths only) and emits
`BuilderPalette.DemoState` and `demoInk` into Palette.swift, the way the drop island's `dropHue`
and `islandInk` were added. The title wears `BuilderPalette.hue(name).ink`, the hue the request was
made with (the kit screen's `preferredHue`), and the warm grey without one.

**Words** are the in-app island's and the kit screen's, and a test holds them there
(`__tests__/liveActivityAttributes.test.ts`): "Waiting for your Mac", "Your Mac is filming it",
"The kit is up", "Tap to share it anywhere." are `Island.tsx DemoContent`'s, and the failure line
is `requestView`'s, with and without a reason. The walk's stop words are the card's own
(`asked`, `filming`, `kit up`, `no kit`, `kit`). The first render drew "The kit is up" over
"kit up" a line apart, the drop card's "3 moves twice" again, so the sentence is VoiceOver's
reading of the walk and is drawn only when it is news the walk cannot carry (a quiet Mac).

## The two islands cannot disagree

Where a request stands is one rule, `demoStepFor` (`src/island/model.ts`), which the in-app
`trackDemo` already read. The card's phase is that step renamed: waiting is `asked`, filming,
ready, failed; `clear` (taken back, no row) is no card. `src/live/demoState.ts demoState` calls
`demoStepFor` itself, the server's `demo_push.PHASE_OF_STATUS` is the same table, and three tests
hold them together: the TypeScript reads every spec request status through `demoStepFor` and
compares the Python table; the Python test reads `demoStepFor` out of `model.ts` and compares
back; and `spec/fixtures/demos/activity_state.json` is the card both `demoState` and
`demo_push.content_state` must produce, case for case (including the rounding of a
microsecond `created_at`, and a code on a request that did not fail, which is not shown). The
in-app island's behaviour is unchanged: `trackDemo` takes the request row as an optional third
argument and hands it on; a test posts a demo with and without it and reads the island back.

## The flow

```
phone (in front)  POST /v1/demos/requests            the request, queued
phone             startDemo (ActivityKit, local)     the card: asked, timer from created_at
phone (Swift)     POST /v1/push/demo-activity        the card's update token, filed under the request
Mac               POST /v1/demos/requests:claim      update: filming (quiet, priority 5)
Mac               POST /v1/demos/requests/{id}:finish  update: ready, or failed with the words,
                                                     with the alert (priority 10); never an end
Mac               the next :claim after 15 min       end, dismissal now, and the token forgotten
phone             DELETE /v1/demos/requests/{id}     taken back: end now, on every card of it
```

- **Start.** The app is in front when you tap Request, so the app starts the card itself
  (`src/live/demoActivity.ts demoAsked`, from `trackDemo`); no push-to-start token is needed or
  registered. One card per request, and one per PROJECT: a new request ends any older card of the
  same project (an earlier kit), because two cards for one project would say two things about it.
- **Tokens.** `demo_activity_tokens` (migration `0032`, after `0031_drop_activity_tokens`): one
  update token per card, owner only under RLS. Posted from Swift (`BuilderDemoLive.swift`) with the
  mirrored short-lived credential the drop cards use, through one shared POST (`IslandTokenPost`,
  lifted out of the drop registrar so the two cannot come to disagree about a refusal). Why Swift:
  ActivityKit hands the token over a moment after the card starts, and the moment after tapping
  Request is exactly when a person leaves the app; a token that waits for a JS event loop waits
  until Builda is next opened. A card registers with what it is `showing`; if the Mac got further
  first, the server catches it up at once.
- **Updates.** Forward only (`RANK`): a second claim, a finish replayed, a card that already shows
  the answer, are not news. The answer carries the alert ("The kit is up" / "Tap to share it
  anywhere.", or "No kit this time" / the failure line); there was no banner for a finished demo
  before, so nothing is doubled.
- **Ending.** Never an `end` on the answer: iOS takes an ended activity out of the Dynamic Island
  at once, which would hide "the kit is up" as it lands. The server ends an answer on the Mac's
  claim poll once it has been up `ANSWER_HOLD_SECONDS` (fifteen minutes, the drop answer's hold,
  so every answer leaves the island on one clock; the worker polls every 30 s while idle). The
  phone ends one sooner: the in-app island's beat (9 s, `DROP_DONE_HOLD_MS`, the hold `trackDemo`
  gives a ready kit) after its poll sees the answer, and on every foreground sync any answer past
  the beat and any card past its stale date. A request taken back is ended at once, on the phone
  (`untrackDemo`) and by the server (`plan_cancel`, for a card on another phone), because there is
  no answer for an end to hide.
- **Stale dates.** Asked: 30 minutes, the in-app island's own give up (`DEMO_FOR_MS`), so the two
  stop claiming a request is on its way together. Filming: 85 minutes, the worker's three ceilings
  end to end (capture 60, build post 5, kit 20, `capture/shipkit/watch.py`); past them the worker
  has finished it one way or the other, so a card still filming means the Mac went quiet. An
  answer: the fifteen minute hold. Tests read the worker's and the island's constants.
- **Relevance** 55: the in-app island's order, under a reel being read (60) and a run that needs
  you (100), over a session merely running (50).
- **No APNs key** (a laptop): nothing is sent, `demo island: APNs is not configured, so N push(es)
  for request X were not sent` is logged once, and the decision is still recorded, so a key added
  later does not replay old moves. The same shape as the drop pushes.
- **Nobody else's.** Tokens are read by the request owner's id AND under their RLS; a token filed
  under someone else's request is a 404 from the route and refused by the policy's WITH CHECK,
  which reads `demo_requests` through the viewer's eyes and so fails closed. Exclusion and account
  deletion delete requests, and the tokens go with them (the foreign key cascades).
- **Switches.** The session and drop cards': no card unless Settings > Live Activities AND Show
  details on Lock Screen are on (the card names your project on the Lock Screen), and the server
  may push only for a signed in phone with both on; turning either off forgets the tokens.

## Decisions, and why

- **A table of its own, not a kind in `drop_activity_tokens`.** That table's rows reference
  `drops` and its phase CHECK is the drop card's, both held by the drop tests. A demo card points
  at a `demo_requests` row and has four other phases; a kind column would have made `drop_id`
  nullable for a third reason and turned one foreign key into two optional ones. 0031 argued the
  same against sharing `live_activity_tokens`. The route is its own too (`routes/demo_activity.py`),
  beside the drop one and validated by the same patterns.
- **`updatedEpoch` in the state, beyond the phase, since and words the brief named.** The phone's
  foreground sweep ends an answer past the beat by when the card last moved, and the expanded
  card shows the clock time the kit landed; the drop card carries it for the same reasons.
- **Identifiers in the attributes.** `requestId` (what the token is filed under) and `projectKey`
  (the Share link) beside the project title and hue the brief named.
- **The failure words travel as words**, not a code the widget would look up: the server's
  `shipkit_spec.REQUEST_REFUSAL_SENTENCES` is now generated from the spec's `refusals`, the same
  sentences the kit screen and the Mac print.
- **The server's alert does not name the project.** The project's name on the card is the phone's
  (the attributes); the server has a key, not a name it may put on a Lock Screen.
- **`boot.py` now refuses a database without RLS on `drop_activity_tokens` and
  `demo_activity_tokens`.** The drop migration had not added its table to that list.

## The pieces

| where | what |
|---|---|
| `targets/widget/_shared/BuilderDemoAttributes.swift` (+ byte-identical pod copy) | the ActivityAttributes |
| `targets/widget/_shared/DemoActivityViews.swift`, `DemoFixtures.swift` | the views and the render fixtures |
| `targets/widget/BuilderDemoActivity.swift` | puts the views in ActivityKit's slots; registered in `index.swift` |
| `targets/widget/_shared/LivePreviewRenderer.swift` | `demoGallery()`: nine states, four surfaces each |
| `modules/builder-live/ios/BuilderDemoLive.swift`, `BuilderLiveModule.swift` | Records, one card per request, the token registrar, `startDemo`/`updateDemo`/`endDemo`/`listDemos`/`setDemoPush`/`flushDemoTokens` |
| `src/live/demoState.ts`, `demoActivity.ts` | the card from a request row, and the glue (`trackDemo`, `untrackDemo` and the foreground sync call it) |
| `app/debug/live.tsx` | `builder://debug/live?demo=asked|filming|ready|failed|end[&stale=10][&render=1]` |
| `server/builder/demo_push.py`, `routes/demo_activity.py`, migration `0032` | the push decisions, the token routes, the table |
| `server/builder/routes/shipkit.py` | the claim, finish and cancel routes call `demo_push` after their commit |
| `spec/fixtures/demos/activity_state.json` | the card both sides must compute, case for case |
| `design/tokens.json spectrum.demo`, `scripts/gen_tokens.py` | the record light, emitted as `demoInk` |

## Verified here, and not

Verified on this Mac (2026-09-19), worktree branch `claude/motion-demoisland`:

- `server/tests/test_demo_island.py`, 28 tests, against my own Postgres database
  (`builder_overnight_demoisland_test`, migrated to 0032) as `builder_app` with RLS on, APNs
  replaced by `test_live_push`'s http2 double: registration and its RLS through a second real
  account (a direct INSERT as the other viewer is refused by WITH CHECK, both naming me and naming
  my request), the 422s, filming on the claim and quiet, ready with the alert and no end, failure
  with the words, a second claim saying nothing, catch up on a late token and not twice, the end
  after the hold on the Mac's next poll and once only, a filming card never ended by the hold,
  taken back ended at once, nothing without a token, nothing ever to somebody else, the one
  no-key log line with the decision still recorded, the token cascading with its request; and the
  card held to the Swift struct, the Swift phases, the migration's CHECK, `demoStepFor`, the
  worker's ceilings and the shared fixture. With them, `test_shipkit.py`, `test_drop_island.py`
  and `test_boot.py`: 73 passed; the whole server suite against the same database, 564 passed,
  none skipped. `make lint` clean.
- `bun test`: 2732 pass (the new `demoActivity.test.ts`, 27, and 11 more in
  `liveActivityAttributes.test.ts`): the attributes byte-identical in both places, the Records,
  the JS types and the server's keys one list; the phases one list across the TypeScript, the
  views, the palette and the server; `demoState` against the shared fixture; the words against
  `DemoContent` and `requestView`; no literal colour in the views; the glue with ActivityKit faked
  (nothing before the switches or with the app away, forward only with each stale date, the beat,
  taken back, swiped away, the foreground sweep); `trackDemo` with and without a row.
  `npx tsc --noEmit` clean. `make gen && git diff --exit-code` clean.
- The whole app built natively (`expo prebuild`, `pod install`, `xcodebuild` into my own derived
  data, iOS 26.5 simulator SDK, Debug): the app, the widget extension with `BuilderDemoActivity`,
  and the pod with `BuilderDemoLive.swift` all compiled, so the Records, the module functions and
  the ActivityKit calls are real Swift, not only strings a test reads.
- Every demo state rendered through the widget's own preview renderer to
  `shots/motion/demo-island/demo-{lock,compact,minimal,expanded}-<state>.png` (36 files: asked,
  filming, ready, failed, failed-long, filming-long-name, filming-hours, asked-stale,
  filming-stale). The renderer ran in a process spawned on my own simulator ("Builda Demo
  Island"), compiled from `targets/widget/_shared` with a ten line `main` that calls
  `BuilderPreviewRenderer().renderAll(into:)`, so the pixels are the real views; timers are
  frozen at the fixtures' clock. Looking at them changed the views once (the sentence over the
  walk, above).
- On that simulator, the app I built, with Metro on its own port (8093): a real ActivityKit demo
  card, started through `builder://debug/live?demo=filming` and moved with `demo=ready` (the same
  `startDemo` a real ask calls, which moves the live card of a request rather than stacking a
  second one: the list showed one card throughout). In the real Dynamic Island over another app:
  compact filming, the red light and a live system timer counting from the ask
  (`sim-island-compact-filming.png`); compact ready, the green light and `kit`
  (`sim-island-compact-ready.png`); and expanded ready by a long press, "Demo" beside the camera,
  the title in the project's hue, the walk and Share (`sim-island-expanded-ready.png`). A tap on
  the expanded card's body brought Builda to the front.

Not verified, and how to verify on a device:

- **Share landing on the kit screen.** The simulator's app was not signed in and sat in
  onboarding, where the router drops any link but onboarding's and the dev routes
  (`+native-intent.ts pathWhileOnboarding`), so `builder://ship/<key>` could not land; the body
  tap brought Builda forward and stayed on the screen it was on. A tap on the Share capsule
  itself, synthesised on the simulator, did nothing visible, as the drop card's Start did. The
  link is the in-app island's own route (`/ship/<key>`, a test holds the two), and on a signed in
  device a tap on Share or the card should open the kit screen.
- **The real Lock Screen.** The simulator was not locked (that needs the Simulator app's menu,
  shared with other sessions' windows); the Lock Screen views are the renders above, the same
  views ActivityKit places.

- **APNs.** No key here, so no update or end ever reached a phone. On a device build with the
  Push Notifications capability and `APNS_*` set on a server running this branch:
  1. Open a project's kit, tap "Request a demo", leave Builda. The island should show the faint
     light and a timer; `SELECT shown_phase FROM demo_activity_tokens` shows `asked`.
  2. With `python -m capture demo watch --server ...` running on the Mac, the light should turn
     red within 30 s (`filming`), and when the worker finishes, green with `kit` and the island
     expanding once with "The kit is up". Share opens the kit screen.
  3. Leave it: about fifteen minutes later, on the worker's next idle poll, the card comes down.
- **A token posted while the app is being suspended.** The Swift task posts the token as soon as
  ActivityKit hands it over; if the process is suspended first, it goes on the next foreground
  sync, and the pushes in between have nowhere to go (the card still counts its timer and moves
  when the app next polls). Only a device shows how often that happens.
- **The ready card's promise.** FIXED after the merge: a done request with no kit of its own is
  `made` on both islands, and on the push (below, "Done is not the same as up").
- **The in-app island after a relaunch.** FIXED after the merge: the root poll (`resumeDemos`, at most every five minutes) reads every project's requests and tracks the newest queued or claimed one per project again, from when it was asked. Checked on the simulator: request, kill the app, relaunch, and the island shows it.

## Done is not the same as up (added after the merge)

A request the Mac finished WITHOUT publishing (a worker run without `--publish-requests`) comes back
`done`, and both islands used to say "the kit is up" for it. `shipkit/model.kitFromRequest` is now the
one rule (a kit published at or after the Mac took the request) for the kit screen and the in-app
island: when the kit is not from this request the in-app island says "The demo of X is made on your
Mac. Publish it there to share it." The system card now has a phase for it, `made`, decided by the
same rule on both sides:

- **The card.** A dim grey light (`spectrum.demo.made`, `surface.textDim`: legible and neutral,
  because green would promise a Share there is nothing behind), the ear says `made`, the walk ends
  `asked`, `filming`, `made`, and the line is the in-app notice's own sentence, "Made on your Mac.
  Publish it there to share it.", with no Share. Renders: `shots/motion/demo-island/demo-*-made.png`
  and `demo-*-made-long-name.png`, all four surfaces.
- **The server.** `demo_push.content_state` takes the project's kit publish time (the newest
  `ship_kits` row, exactly what `GET /v1/projects/{key}/kit` answers as `published_at`) and a done
  request is `ready` only when that is at or after the request's `claimed_at` (else `created_at`),
  compared in whole milliseconds, the precision `Date.parse` reads, so the two sides cannot split
  on a sub millisecond edge; `made` otherwise. The finish route's push says `made` for the default
  worker and `ready` for `--publish-requests` (which publishes before it finishes).
- **Made to ready.** `RANK` puts made below ready (asked 0, filming 1, made 2, ready and failed 3),
  and the kit publish route (`PUT /v1/projects/{key}/kit`) calls `demo_push.after_publish` after its
  commit, which moves every card of that project still at `made` to `ready`, with the alert and its
  Share. A second publish is not news; a card for another project is not touched; a card still
  filming stays filming (its request is still claimed). Migration `0033_demo_activity_made` (after
  0032) widens the `shown_phase` CHECK; its way back puts a made card at `filming`.
- **Made is quiet** (`MADE_IS_QUIET`): priority 5, no alert. An alert lights the screen and expands
  the island, the card's budget for "act on this now, here"; made asks you to act on the Mac, and
  the ready that follows a publish is the moment worth waking the phone for, which would otherwise
  be the second alert for one demo.
- **Holding it.** Made takes an answer's stale date and the server's fifteen minute hold (the
  Mac's claim poll ends it, and a publish restarts the hold as ready). It is NOT final on the
  phone: the in-app beat that ends a ready or failed card does not end a made one, so a publish can
  still move it; the foreground sweep ends it at its stale date.
- **The phone.** `demoState` reads the same `kitFromRequest`; a done request with no kit time given
  is `made`, the phase that promises less. `trackDemo`'s done branch moves the system card to
  whichever the rule says (it used to take it down when the kit was not this request's).
  `spec/fixtures/demos/activity_state.json` holds both sides to made and ready cases: no kit, the
  field absent, an older kit from before the claim, a kit at the claim's own instant, one in the
  claim's millisecond, one a microsecond before it, and a row with no claim time.

Verified for `made` (2026-09-19, branch `claude/motion-demoisland2`): `server/tests/test_demo_island.py`
against my own `builder_overnight_demoisland_test` migrated to 0033 (and 0033 taken down to 0032 and
back up, the CHECK read from `pg_constraint` each way): the default finish says made quietly, a publish
then says ready with the alert and once only, `--publish-requests` goes straight to ready, an older kit
leaves it made, a publish moves only its own project's cards, a made card comes down after the hold;
with `test_shipkit.py`, `test_drop_island.py` and `test_boot.py` 86 passed, the whole server suite 577 passed with none skipped, and `make lint` clean.
`bun test` 2765 pass, `npx tsc --noEmit` clean, `make gen && git diff --exit-code` clean. The made
renders came from the widget's own renderer on my own simulator. Not verified: a real push reaching a
phone (no APNs key here), as before.
