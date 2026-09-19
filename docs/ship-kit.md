# The ship kit: everything you post beside a demo, made for you

The owner, 2026-09-19 (brief-motion.md, requirement 6): "completely flesh out a demo feature ...
look at latent-spaces/brag ... whole point is to generate context ... think what else we can do
with this and in general what else we can generate proactively for the user. this is to share
what they built." And the flaw to fix: another demo tool "gave me a weird elongated phone". So:
defined device sizes, a demo that starts by itself or at the tap of a button, and one tap to send
the video and any screenshots you pick to any app.

`docs/demos.md` is the capture pipeline (run the project in a clone, film it, check every frame).
This is what grows around it: the device table, the social formats, what else gets made, when it
gets made, how the phone asks for one and shares it, and the measurements behind each number.

## What gets made, per demo, on the Mac

`python -m capture demo kit` (or the worker, below) writes `~/.builder/demos/<key>/kit/`. Nothing
of it leaves the Mac until `python -m capture demo kit --publish` lists every file and you say yes.

| file | what it is for | how it is made |
|---|---|---|
| `video-vertical.mp4` 1080x1920 | Reels, TikTok, Shorts, Stories | the demo, the device drawn at its own shape (`frame.py`), the picture inside it punching in 4% about each beat's first tap, with a ring there |
| `video-feed.mp4` 1080x1350 | Instagram and LinkedIn feed, Threads | the same |
| `video-landscape.mp4` 1920x1080 | X, YouTube, Bluesky, a README | the same; a website's is its desktop pass in a Mac window |
| `video-square.mp4` 1080x1080 | anywhere a square crops least | the same |
| `poster-<format>.jpg` | the idle thumbnail | the settled frame with the most on screen, and ALSO baked into each video as frame 0 (brag's trick: X, Slack and Discord make the thumbnail from frame 0 whatever the file says) |
| `loop.gif` 600x600 | a README, a pull request, a chat with no video | the square video at 12 fps, smaller until it is under 8 MiB |
| `framed/still-NN.png` 1080x1350 | a carousel of screens | each still in the 4:5 frame |
| `before-after-NN.png` 2160x1080 | "look how it changed" | the same screen at the last demo and now, paired by label, side by side, each half dated by the day its commit was made |
| `app-store/iphone_69/NN.png` 1320x2868 | App Store Connect's required iPhone size | an iOS app's stills, scaled uniformly and centre cropped only when within 1% of the slot's shape |
| `share-copy.json` | a caption per platform: X (and a thread), LinkedIn, Threads, Instagram, TikTok, Bluesky | your own `claude -p`, then checked (below) |
| `changelog.json`, `.md` | what is new since the last demo | the commit subjects between the two demos' commits |
| `kit.json`, `checks.json` | every file and its size; every refusal with its code; the measurements | |

The "last demo" is the newest earlier demo whose commit is IN this one's history (`kit.previous_kit`):
FOUND ON THE MDN KIT, an old commit filmed after HEAD took HEAD as its "before", both halves dated
the morning they were filmed. `python -m capture demo --repo URL --ref X` films X (the URL path
dropped `--ref` until then).

The 13 inch iPad App Store set is made only from a demo filmed on an iPad: a phone's screenshot is
not an iPad's, so for a phone demo it is refused with `no_ipad_capture` and the command that makes
one (`python -m capture demo --device ipad-pro-13 --no-video`).

## When it gets made

**By itself, when a session ships.** The seam is the Mac side of a session's end: Claude Code's
own `SessionEnd` hook runs on the machine the session ran on, the moment it exits. It only writes a
file (`~/.builder/demos/queue/pending/<when>-<id>.json`), because a hook must return at once:

- `python -m capture demo hook --install` prints the settings.json entry for
  `python -m capture demo hook`, which reads the hook's JSON and queues it; and
- the served `hook.sh` (docs/hooks-capture.md) does the same with `printf` on a Mac that has made a
  demo before (`~/.builder/demos` exists), whether or not an upload is configured.

`python -m capture demo watch` is the one worker. It holds `queue/worker.lock` (a second worker
says so and leaves: two simulators at once ran this Mac out of memory before the queue existed),
takes the oldest job, and JUDGES it (`queue.judge`): the session ran in a repository you have not
excluded; it committed, inside its own window plus attribution's 30 minute lookback, a file an app
is made of (`queue.UI_FILE`: screens, styles, native projects; never tests, docs, scripts or the
server), or its build post says there is something to show; the project is `expo_ios` or `web`;
its newest commit is not already filmed and no demo of it is waiting. A skip is a code with its
sentence, kept in `queue/skipped/`. A job that passes runs as child processes in order, each with
a ceiling: the capture, the build post (`python -m analysis shipped`, one model call), the kit.

MEASURED on this Mac's own transcripts: a builder-drops session whose window held 4 commits
touching `mobile/src/drops/Board.tsx` and six other app files is filmed; a RideGT session whose 2
commits touched no app file is skipped `nothing_shipped`; a session in `~/Downloads` is skipped
`not_a_repository`.

**At a tap, from the phone.** The project page and the kit screen have "Request a demo". It is
`POST /v1/demos/requests {project_key, hue}` (one live request a project: a second tap is the same
request). The worker claims requests (`POST /v1/demos/requests:claim`, `FOR UPDATE SKIP LOCKED`,
the drops runner's shape), finds the checkout among the repositories this Mac's transcripts
resolved to (never one it has not worked in), films it and reports `done` or `failed` with a code.
The phone reads the request back every 20 s while it waits and turns into the kit when it lands.

A kit stays on the Mac until `kit --publish` and a yes. The one exception is given ON THE MAC:
`watch --publish-requests` sends the kit of a demo the phone asked for (`kit --publish --yes`, the
same listing and the same second Vision read); a kit the worker made on its own is never sent by
it. A publish that fails still finishes the request `done`, and the phone's line for a done request
with no kit says to publish it on the Mac. A request is filmed even when its commit already has a
demo: "Make a new demo" is asked exactly then.

`--dry-run` everywhere: `demo --dry-run` (the plan), `demo kit --dry-run` (the layouts, the
formats, the device), `demo watch --dry-run` (every waiting job judged, nothing claimed or filmed),
`demo queue --add PATH --dry-run`, `demo hook --dry-run`, `demo kit --publish --dry-run`.

## The device table: the only place a frame size lives

`spec/devices.v1.json` -> `scripts/gen_devices.py` -> `capture/demo/devices_table.py` and
`mobile/src/generated/devices.ts` (`make gen`, `make check-gen`). Every screen a demo is filmed on,
every social canvas, the GIF and the App Store slots. The hard coded sizes that were here are gone:
the simulator's device type, the web viewport, the terminal's canvas, the fallback's list of
screenshot sizes, the caption's offset over the tab bar, the phone's `PHONE_ASPECT` and
`PHONE_TOP_SHARE`. `make gen` refuses a table whose pixels are not points times the panel's scale,
a simulator type claimed by two rows, two rows a capture could match both of, an odd canvas side.

**Measured, not typed.** `scripts/measure_devices.py` compiles a forty line UIKit probe, boots a
fresh simulator of each type ONE AT A TIME under a name of its own, and records what iOS says:
`UIScreen.bounds`, `scale`, `nativeScale`, `nativeBounds`, the full screen view's portrait safe
area, and `_displayCornerRadius`, beside the device type's own `profile.plist`
(`docs/research/device-measurements.json`). `python3 scripts/gen_devices.py --verify` holds every
row to it. On 2026-09-19, iOS 26.5 and 18.2 simulators, Xcode 26.5: **22 rows verified on 45
simulator types, all equal.**

| row | models | points | pixels | corner | safe top/bottom | island | verified on |
|---|---|---|---|---|---|---|---|
| `iphone-17-pro-max` | iPhone 17 Pro Max, iPhone 16 Pro Max | 440x956 @3 | 1320x2868 | 62 | 62/34 | yes | 2 of 2 |
| `iphone-air` | iPhone Air | 420x912 @3 | 1260x2736 | 62 | 68/34 | yes | 1 of 1 |
| `iphone-17-pro` (default) | iPhone 17 Pro, iPhone 17, iPhone 16 Pro | 402x874 @3 | 1206x2622 | 62 | 62/34 | yes | 3 of 3 |
| `iphone-16-plus` | iPhone 16 Plus, 15 Plus, 15 Pro Max | 430x932 @3 | 1290x2796 | 55 | 59/34 | yes | 3 of 3 |
| `iphone-16` | iPhone 16, 15, 15 Pro | 393x852 @3 | 1179x2556 | 55 | 59/34 | yes | 3 of 3 |
| `iphone-16e` | iPhone 17e, 16e, 14 | 390x844 @3 | 1170x2532 | 47.33 | 47/34 | no | 3 of 3 |
| `iphone-se` | iPhone SE (3rd generation) | 375x667 @2 | 750x1334 | 0 | 20/0 | no | 1 of 1 |
| `iphone-14-plus` | iPhone 14 Plus, 13 Pro Max, 12 Pro Max | 428x926 @3 | 1284x2778 | 53.33 | 47/34 | no | 3 of 3 |
| `iphone-13-mini` | iPhone 13 mini, 12 mini | 375x812 @3, panel 2.88 | 1080x2340 | 44 | 50/34 | no | 2 of 2 |
| `iphone-11-pro-max` | iPhone 11 Pro Max, XS Max | 414x896 @3 | 1242x2688 | 39 | 44/34 | no | 2 of 2 |
| `iphone-11` | iPhone 11, XR | 414x896 @2 | 828x1792 | 41.5 | 48/34 | no | 2 of 2 |
| `iphone-11-pro` | iPhone 11 Pro, XS (and X) | 375x812 @3 | 1125x2436 | 39 | 44/34 | no | 2 of 2 |
| `ipad-pro-13` | iPad Pro 13-inch (M5, M4) | 1032x1376 @2 | 2064x2752 | 30 | 32/25 | no | 2 of 2 |
| `ipad-pro-11` | iPad Pro 11-inch (M5, M4) | 834x1210 @2 | 1668x2420 | 30 | 32/25 | no | 2 of 2 |
| `ipad-air-13` | iPad Air 13-inch (M4, M3) | 1024x1366 @2 | 2048x2732 | 18 | 32/25 | no | 2 of 2 |
| `ipad-air-11` | iPad Air 11-inch (M4, M3) | 820x1180 @2 | 1640x2360 | 18 | 32/25 | no | 2 of 2 |
| `ipad-a16` | iPad (A16) | 820x1180 @2 | 1640x2360 | 25 | 32/25 | no | 1 of 1 |
| `ipad-mini` | iPad mini (A17 Pro) | 744x1133 @2 | 1488x2266 | 21.5 | 32/25 | no | 1 of 1 |
| `ipad-pro-11-2018` | iPad Pro 11-inch (4th, 3rd generation) | 834x1194 @2 | 1668x2388 | 18 | 32/25 | no | 2 of 2 |
| `ipad-9` | iPad (9th, 8th generation) | 810x1080 @2 | 1620x2160 | 0 | 32/0 | no | 1 of 1 |
| `mac-1280` .. `mac-1728` | a browser window at the Macs' default scaled resolutions | 1280x800, 1440x900, 1512x982, 1728x1117 @2 | | 12 (a drawing choice) | 0/0 | no | not measurable |

Not verifiable here: `iphone-8-plus` (1242x2208) and `iphone-se-1` (640x1136) have no runtime on
this Mac that boots them, and are in the table only so a checkout's old screenshots rank as device
screenshots; the Mac windows are browser viewports, not simulators.

Four things the measurement found that a table typed from memory had wrong:

1. **Every current iPad reports a 32/25 safe area on iPadOS 26**, not the 24/20 of earlier iPadOS.
2. **The iPad (A16) rounds at 25 points and the iPad Air 11-inch at 18**, on one 1640x2360 screen,
   so they are two rows (the one pixel size two rows may share, exactly, spec `_same_screen`).
3. **The iPhone 13 mini and 12 mini lay out 375x812 points at 3x on a 1080x2340 panel**, 2.88
   pixels a point: a table that multiplied points by UIKit's scale would expect 1125x2436, a phone
   4% too tall. Rows carry `native_scale` (the panel's) beside `scale` (UIKit's) now.
4. **The iPad (9th generation) has a 32 point top on iPadOS 26**, not 20.

**The capture is held to its row.** The device is chosen from the table: `--device ROW`, else the
storyboard's `device.row`, else the project's own most used simulator from its transcripts
(`devices.simulators_in`: `-destination name=`, `--device`, `simctl boot`, a device type id), else
`iphone-17-pro`. The tool's own simulator for that row is "Builda Demos" (or "Builda Demos
<row>"), created on the row's device type. The first screenshot of the app, every still and the
recording are checked against the row's pixels: more than 0.5% off is refused,
`frame_size_mismatch`. A web recording is held to the row's points (Playwright records CSS pixels).

## The frame, and the two checks every format passes

`capture/shipkit/frame.py`. A flat warm ground (`surface.bg.dark`), the project's hue (the phone's
own `preferredHue` rule, or the hue the phone sends with a request) as a solid band with an
ordered dither edge (the app's texture; tokens forbid a gradient on an identity hue), the device's
body as a thin dark bezel with a shadow, the screen cut to the row's `corner_radius` times its panel
scale, the title (the build post's `what`, checked for names) above. The Swift helper draws the
still layers (`backdrop`, `mask`, `ring`); ffmpeg lays the recording over them. The screen's width
is rounded to an even number and its height derived from the row's aspect, never fitted apart.

**The punch in moves the picture, never the phone.** Each beat scales the recording 4% about its
first tap and lays it on a canvas the screen's own size, so the device, its bezel and its corner
never move. For a simulator's recording the top safe area (the status bar and the Dynamic Island)
is held still over it, as on a real phone. FOUND LOOKING AT THE FIRST KITS: scaling the masked
screen itself grew it over its own bezel at every beat's peak, and a tap near the bottom slid the
island 57 pixels up and off the screen's edge.

**The device's aspect, measured in every rendered format.** `check_aspect` renders the format's
own filter graph with a white screen on a black ground, reads the frame back as raw grey and finds
the white pixel by pixel; a box whose aspect is not the row's (within the table's 0.5% plus one
pixel) refuses the format, `device_aspect_mismatch`. It measures the pipeline, not the arithmetic
that fed it. REVERTED on the way: ffmpeg's `cropdetect` judges a row by its average, so the rows a
rounded corner shortens read as ground, and a correct 706x1534 phone measured 704x1520, 1% short.
The unit tests hold `layout` on all 26 rows in all four formats, with and without a title.

**No blank stretch.** Each format is sampled 4 times a second, the screen alone and below its
status bar (the row's top safe area), and two blank samples in a row refuse it, `blank_segment`.
MEASURED on the four demos on this Mac: the lowest real screen of 15 stills and 99 video samples
spreads its grey levels 22.0 (a RideGT map sheet); a flat screen reads 0, a white page with a small
spinner 1.65, and a dark screen with only its status bar 7.2 whole but 0 below the bar, which is
why the bar is left out. `BLANK_STD` is 4.

**The poster.** The candidates are the middle of every hold at least 0.6 s long in the finished
video (`freezedetect`), and the one Vision reads the most text on wins, the widest grey spread
breaking a tie, then the earliest. FOUND ON THE FIRST KIT: candidates spread evenly over a video
landed in crossfades, and the "richest" frame was two screens on top of each other, rich because
it was two. A hold cannot be a crossfade.

## The captions, and the evidence rule

`capture/shipkit/copy.py`: your own `claude -p --json-schema` (the schema is generated from
spec/shipkit.v1.json) reads the build post's `what`, `hard_part` and `demo`, the commit subjects,
what the video shows beat by beat, and a short list of numbers it may use. Then every caption is
held to rules that can only remove:

1. **Every number** in it must be in the input, written the same way, the narrative's own
   `numbers_in`/`known_numbers` normalisation, and STRICT: the narrative waves numbers up to 12
   through as ordinary English; a public post's "3 taps" is a claim like any other. One unknown
   number drops the whole caption (`invented_number`); a sentence is never edited around it.
2. **No repository name**, key or email (`names_a_repository`), the rule a demo's labels meet.
3. **Within the platform's limit** (X 280 and each thread post 280, Bluesky 300, Threads 500,
   LinkedIn 3000, Instagram 2200, TikTok 2200), `over_limit`.
4. **No dash**: rewritten, never refused.

A platform left without a caption gets a template made from the input alone (`source: template`).
FOUND ON THE FIRST WEBSITE KIT: with no earlier demo the changelog is the latest 30 commits, handed
over as "commits since the last demo: 30", and four captions said "30 commits since the last demo"
about a project that had never had one. That count is a fact only when there is a last demo now.

## On the phone

`mobile/app/ship/[key].tsx` (`src/shipkit/`), reached from one row on the project page and one on a
session page when its project has a kit. Plain on purpose: the motion system is being rebuilt
beside it (docs/motion.md). A tab per format of the device table over the video at that shape; the
stills, framed stills, before and after and the GIF, each tap picking one; the platforms and each
one's caption, editable and counted against its limit, X's thread under it; and ONE Share. Picking
a platform picks the format it shows best (spec `platform_format`) until you pick one by hand.

Share downloads the picked files into the app's cache under the names they should arrive with
(`demo-vertical.mp4`, `screen-01.png`) and presents ONE `UIActivityViewController` with all of them
and the caption (`BuilderDrops.shareItems`, the app's local Expo module). Some apps take the files
and drop the words (Instagram; X's extension with more than one item), so the caption also goes on
the pasteboard, one paste away. A build without the native module falls back to expo-sharing,
which takes one file, and says so rather than sharing half a post silently. It also copies the
words first, and never says "Shared": expo-sharing resolves alike whether the person sent the file
or closed the sheet (FOUND ON THE SIMULATOR, a dismissed sheet read "Shared.").

On a project's first demo the commit list is headed "The latest commits", not "What changed since
the last demo", which is what the first simulator run said over 24 commits with no last demo.

No kit yet: "Request a demo", and the words for where the request stands, the spec's sentence for
a failure's code.

## On the server

Migration `0030_ship_kits`: `demo_requests`, `ship_kits` (the document: captions, commit subjects,
refusals, device, hue; never a commit hash, a file name or a project name), `ship_kit_media` (one
row a file). Owner only, four policies each on the row's own `user_id`. Kit files live in the
demos' private store under `ship-kit/<user>/<project>/`, a prefix of their own, so neither the demo
sweep nor the kit sweep can mistake the other's objects for orphans; exclusion, account deletion and
`python -m builder.media_sweep` take them too. A kit is a set: shown only once its document arrives
with nothing pending, replacing the older kit's rows and objects then. The contract declares the
channel (`privacy/upload-contract.json` `ship_kit`) and PRIVACY.md says what a kit sends.

```
POST   /v1/demos/requests            {project_key, hue}   the phone asks (201, or 200 with the live one)
GET    /v1/demos/requests?project_key=&status=            newest first
POST   /v1/demos/requests:claim                           the Mac takes up to 5, once each
POST   /v1/demos/requests/{id}:finish {status, refusal}   done, or failed with a spec code
DELETE /v1/demos/requests/{id}                            take back one that has not ended
POST   /v1/projects/{key}/kit:presign  KitPresign         one file of a publish
POST   /v1/projects/{key}/kit/{id}:commit                 the file is there
PUT    /v1/projects/{key}/kit          KitDocument        the set is complete: show it
GET    /v1/projects/{key}/kit                             {kit: {document, files}} or {kit: null}
DELETE /v1/projects/{key}/kit
GET    /v1/kit-media/{id}                                 the local stack's read, with the bearer
```

## Commands

```bash
python -m capture demo PATH [--device ROW] [--dry-run]    film it (docs/demos.md), on a row of the table
python -m capture demo kit [PATH | --key KEY] [--dry-run] [--no-model] [--hue H] [--formats a,b]
python -m capture demo kit PATH --publish [--yes] [--dry-run]
python -m capture demo queue [--add PATH] [--clear]
python -m capture demo watch [--once] [--dry-run] [--server URL] [--no-model] [--publish-requests]
python -m capture demo hook [--install] [--dry-run]
python3 scripts/measure_devices.py [--only ROW,...] [--dry-run]
python3 scripts/gen_devices.py --verify
python3 scripts/shipkit_shots.py                          one frame of every format of every kit, and a contact sheet
```

## Verified on this Mac

2026-09-19, this Mac (Xcode 26.5, iOS 26.5 simulators), the tool's own "Builda Demos" simulator,
and a local stack of my own on 127.0.0.1:8787 (`OVERNIGHT_HOME=~/.builder-shipkit-stack`,
database `builder_overnight_shipkit`). The stills are under `shots/motion/shipkit/` (not tracked:
`shots/` is ignored), made by `python3 scripts/shipkit_shots.py`, and were looked at.

**The table.** `scripts/measure_devices.py` over every installed device type: 22 rows verified on
45 simulator types, all equal (`gen_devices.py --verify`).

**Four kits, all four formats each, captions from `claude -p` (claude-sonnet-5), none dropped:**

| demo | filmed on | rings | before and after | lowest screen grey spread (blank if under 4) |
|---|---|---|---|---|
| Builda (expo_ios, filmed 2026-09-14) | `iphone-17-pro`, matched by its pixels | 0 (no timeline then) | none, first demo | 45.65 |
| RideGT (expo_ios) | `iphone-17-pro` on "Builda Demos", taps at (0.31, 0.16) and (0.89, 0.88) | 2 | none, first demo | 30.77 |
| Personal Website (web) | `iphone-17-pro` viewport, and the `mac-1512` window for 16:9 | 0 | none, first demo | 21.26 |
| MDN beginner-html-site-styled (web, `--repo`) | the same | 0 | 2014-11-18 against 2026-07-08, the old Firefox icon beside the new | 37.04 |

The device's measured aspect in every format of every kit (`shots/motion/shipkit/aspects.md`): the
phone is 0.45995 wide for its height and measured 0.45992 to 0.46032 in all twelve phone renders;
the Mac window is 1.53971 and measured 1.53895. No render was refused. Looked at: every format's
frame 0, a framed still and a contact sheet per kit, the RideGT vertical video at both rings and
at every beat's zoom peak (the ring on the control the tap hit, the island still at the top), and
the MDN before and after.

The MDN captions say "12 commits since my last demo", and the kit's changelog from c9d9487 to 6c7a360 holds 12;
the first-demo kits no longer claim a count since a last demo.

**The phone, end to end, on the simulator against the local stack** (`shots/motion/shipkit/phone-*.png`):
the project page's "Share what you built" row; the kit screen with its four tabs, the 16:9 desktop
video and the 9:16 phone video playing, the stills and framed stills picked with a tap, each
platform's caption counted against its limit and X's thread; Share presenting the system sheet
with the video (the expo-sharing fallback, see below) and the caption on the pasteboard
(`simctl pbpaste` read it back); then "Make a new demo": the phone showed "Waiting for your Mac",
`watch --once --server ... --publish-requests` claimed it, the phone showed "Your Mac is filming it
now", the Mac filmed the site again, made the kit with captions and published it (13 files,
replacing 13), and the phone turned into the new kit with "The kit above is from the demo you asked
for". Six bugs were found only by doing this and are fixed, each with a test: `--key` publishing
the wrong project, the App Store stills' path, the job losing its `request` kind, the done line
above an old kit, "Shared." after a dismissed sheet, "since the last demo" on a first demo.

**Suites.** `make check-gen` (generated files match), `make lint`, capture 373 tests,
`server` 510 passed against `builder_overnight_shipkit_test`, `mobile` `bun test` 2610 pass and
`npx tsc --noEmit` clean.

**Not verified here, and why:**

- The native `BuilderDrops.shareItems` (one UIActivityViewController with every file and the text)
  is written but was not compiled into an app: the simulator ran an existing debug build, so the
  share went through the expo-sharing fallback, one file. The next native build carries it; until
  then the screen says it sends one file at a time.
- The 13 inch iPad App Store set: every demo here was filmed on a phone, so it is refused
  (`no_ipad_capture`), correctly. `python -m capture demo --device ipad-pro-13 --no-video` makes one.
- The SessionEnd hook was not installed into this Mac's real `~/.claude/settings.json` (another
  agent's sessions run here). The hook, the served `hook.sh` path and the judge are held by tests;
  `demo hook --install` prints the entry.
- Publishing went to the local stack's file store, not the production object store; the presign
  and commit routes are the demos' own, which production already serves.
