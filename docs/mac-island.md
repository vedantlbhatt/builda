# The Mac island

The notch is the island's Mac body (docs/motion.md, "The island is one object, everywhere"):
a black shape fused to the camera housing that grows to say more, in the same springs and the
same states as the phone's Dynamic Island. This is what goes on it, what does not, and the
measurements the choices rest on. Code: `Packages/BuilderKit/Sources/BuilderMac/Notch/`, the
views in `Sources/BuilderUI/Island*.swift`, the reading of running transcripts in
`Sources/BuilderIngest/LiveTail.swift` and `Sources/BuilderAnalysis/LiveAgents.swift`.

## What goes on the notch, and why only that

The rule is the design doc's: only what is HAPPENING ELSEWHERE, ON YOUR BEHALF, that you
might need to act on. On a Mac "elsewhere" is another window: the terminal behind your editor,
the agent in the worktree you are not looking at. Nothing that is true all day goes here (no
totals, no streak, no hours): an island that shows a number that has not changed since
breakfast is one you learn to ignore, and then the one that needs you is ignored too.

| mode | when | collapsed (the ears) | open |
|---|---|---|---|
| idle | nothing running | the builder's face, asleep if nothing ran today; four empty sockets | does not open; a click opens the menu bar popover |
| crew | agents are writing transcripts | face with the working glow; one dot per agent in its session's hue, 2x2 | the status wheel (every agent's repo and what it is doing, the active line shimmering), and the agent rail beside the island, one face per agent popping 60 ms apart |
| needs you | an agent handed the turn back, asked a question, or is stopped at a permission prompt | flat eyes on an amber glow, "2m" in amber where the dots were | amber wash from the top, "gt-transit is waiting on you", what it said or asked, how long; a click brings its terminal forward |
| shipped | a session finalized and was announced | (opens by itself) | green wash across, arc eyes, "Shipped · builder · 42m · 6 commits" a word at a time, 55 ms apart; lets go after 4 s |
| drop | a link is dragged over the notch, or was just dropped | (open while it lasts) | dashed zone, "Drop a link to make it a drop"; then a wheel of Sent, Reading, Planned; "Pair this Mac first" on a Mac with no account |

Precedence, when two are true: the thing you are doing with your hands (a drag), then the
one-off beat (shipped), then what needs you, then what is merely running.

Opening: the pointer resting on the island for 180 ms opens crew and needs you (the ears sit in
the menu bar, and a pointer on its way to the Wi-Fi menu crosses them; opening on contact would
open it every time); leaving closes it after 400 ms; a click pins it open and a second click
lets it go. A wait that begins while the app is watching opens the island by itself for 3.5 s,
once. A wait found on the first pass after launch does not: it is hours old, and announcing it
is the backfill mistake CLAUDE.md records (71 historical sessions announced at once) in miniature.

The drag is the one input. Nothing on the notch takes typing.

## Measurements

**The notch** (this Mac, MacBook Pro 14", `NSScreen.auxiliaryTopLeftArea` and
`auxiliaryTopRightArea`, `safeAreaInsets`): screen 1512 x 982 pt at 2x; the notch runs from
x 665 to 850, **185 pt wide, 32 pt tall**, centred at **757.5**, not at the screen's centre
(756). The island is centred on the measured notch; centring it on the screen would put the
ears 1.5 pt off the hardware and the seam would show. The menu bar there is 34 pt (982 minus
the visible frame's top, 948), two points taller than the notch. Collapsed, the island is the
notch plus two 38 pt ears (261 x 32 pt) with bottom corners of 10 pt and a 6 pt concave flare
where it leaves the top edge. A screen with no notch gets a pill of its own under the menu bar.

**The spring, on screen.** Recorded from the running app at 30 fps with a hairline drawn round
the shape (`scripts/island_demo.sh OUT 25 --edge`, then the left edge found per frame): the
crew opening travels 149 px, goes **15 px (10.1%) past its target, peaks at 267 to 300 ms and
is settled by 433 to 467 ms**. The clip the kit was measured from: first peak ~300 ms, ~10%
past target, settled ~450 ms. The closed form of ISLAND (damping 17, stiffness 210, mass 1):
268 ms, 10.3%, 470 ms at 2%. `shots/motion/mac/morph-open-frames.png` is those frames. Under
Reduce Motion the same morph has no overshoot and is done in four frames.

**Waiting on you**, read off the end of each running transcript (`LiveTail`), with the rules
of `analysis/live.py` so the notch and the phone's mission control name the same wait. MEASURED
on this machine's `~/.claude/projects`, 218 root transcripts, 2026-09-19:

- 35,291 assistant records: `stop_reason` `tool_use` 32,826, `end_turn` 2,383, `stop_sequence`
  25, absent 57. The field is there to read, and 128 of the 218 transcripts end on `end_turn`
  text, which is what a finished turn looks like at rest. Only `end_turn`, `stop_sequence` or an
  interrupt hands the turn back.
- A permission prompt and a long tool run look the same in a transcript (live.py rule 1),
  except for file edits: 970 Edit and Write calls, result p50 0.04 s, p99 0.58 s, and not one
  took 5 s. So an edit with no result for 5 s is a permission prompt. Bash cannot be read that
  way (p90 14.9 s, p99 311 s): a quiet Bash call is "Running", never "waiting".
- `AskUserQuestion` and `ExitPlanMode` with no result are asking by definition.
- A turn ended while the agent's own background job is out (its result reads "Async agent
  launched successfully" or "Command running in background", MEASURED in this machine's
  transcripts; the job's report is a queued task notification naming the launch's tool-use id)
  is not your turn, unless it ended on a question.

A wait is shown while its session is open. When the session reaches the session threshold it
ends, and the shipped beat fires instead, as on the phone, whose live state is deleted at
finalise.

**One transcript is one agent.** The Swift deriver pools by the repository each record's cwd
resolves to, so a sitting that `cd`'d out of its repository is split into two sessions; found
by running it, the orchestrator's transcript came back twice and the wheel, keyed by
transcript, drew one row of two. Agents are unique by transcript now. A transcript silent past
the p99 record gap (180 s) that did not hand the turn back is neither working nor waiting and is
not on the notch (found by running it: "7 agents running", four of them windows left open).

**Cost.** CPU seconds over 30 s, demo mode (no store), island held in one state:

| | before | after |
|---|---|---|
| idle, collapsed | 4.3% | 0.8% |
| crew, collapsed | 6.3% | 1.0% |
| needs you, open | 6.8% | 0.4% |
| crew, open (shimmer at 20 fps, three rail faces) | 6.9% | 6.9% |

The face on a SwiftUI `TimelineView` cost about 5% of a core at 30 fps and at 12 fps alike, on
the display link and on a timer alike, so the cost was redrawing it at all, not how often. The
glow's breath is now a Core Animation keyframe animation the render server plays, and the
pixel creature is redrawn only when it changes: its breath frame twice a cycle, a blink every
few seconds. Hidden rail faces do not breathe. The open crew state is a hover and costs what it
costs while the pointer is on it.

The engine's own pass is the larger cost, and it is not the island's: the daemon re-derives the
whole corpus on every burst of file events, **5.3 s in a release build and 18 s in a debug one**
on this machine's corpus (`builder island --store` timed), so while an agent writes the passes
run back to back (MEASURED 93% of a core, debug, island off). Between passes the island re-reads
the running transcripts' tails every 2 s on its own, so a wait reaches the notch on time
regardless.

## The face

The builder's pixel creature (Bit, or `defaults write com.vedantlbhatt.Builder.Mac
IslandCreature fox`) with the notch kit's STATE MACHINE and not its sphere: tint and glow spring
between states on CONTENT (idle, working blue, thinking violet, waiting amber, error red, done
green, sleep), the eyes are the family's 2x2 holes (frames.ts `EYES`, the same eight cells in
all nine creatures) cut at a sprung height (open, a flat line, shut) or drawn as arcs (^ ^, done:
the kit's half height rounded eye read as sleepy on a 16 cell face). The glow breathes 1500 ms
out and 1700 ms back; the creature breathes by its own drawn breath frame, never by scaling (the
pack forbids a scale breath on a pixel icon); blinks land on seeded 1.8 to 5 s gaps, a quarter of
them double. The cells come from `mobile/src/pixel/` through `scripts/gen_mac_creatures.py` (in
`make gen`), and an agent wears its session's crew creature (FNV-1a of the client session id on
the ring, `mobile/src/live/crew.ts`) so a session is the same colour on the notch as on the Lock
Screen.

## The drop

`POST /v1/drops` with exactly `{url, platform, shared_text}` (the route's model forbids any other
key), the link normalised by `DropLink`, the third copy of `drops/urls.py`'s rule and held to it
by a test over the phone's parity cases, with the Mac's own tokens. Then `GET /v1/drops/{id}` every
2 s: `waiting` is Sent, `resolving` is Reading, `planned` is Planned with its move count. If
nothing has read it in 15 s (the Mac's `python -m drops watch` is not running) the island lets go:
the card is on the board saying "waiting for your Mac", which is the true state. A refusal shows
its reason on a red wash. An unpaired Mac says "Pair this Mac first".

A real drag cannot be synthesised without the Accessibility permission, so
`BUILDER_ISLAND_FAKE_DROP=<text>` runs a hover and a drop through the same controller calls the
drop target makes. The request itself is held to the server's contract by `DropClientTests`.

## Looking at it

| | |
|---|---|
| `scripts/island_demo.sh OUT [SECONDS] [--edge]` | the demo cycle filmed from inside the app: `OUT/island.mp4` and a still per mode |
| `BUILDER_ISLAND_DEMO=1` | cycle every mode on fixtures; the store is not opened |
| `BUILDER_ISLAND_DEMO_HOLD=<step>` | hold one step, to measure what it costs |
| `BUILDER_ISLAND_RECORD=<dir>` | film the top of the screen, demo or live (`BUILDER_ISLAND_RECORD_AFTER_PASS=1` waits for the first pass) |
| `BUILDER_ISLAND_EDGE=1` | a hairline round the black shape, for recordings on a black menu bar |
| `BUILDER_POPOVER_SHOT=<png>` | open the popover after the first pass and photograph it |
| `BUILDER_STORE_DIR=<dir>` | run against a copy of the store; also keeps off the Keychain and notifications |
| `BUILDER_REDUCE_MOTION=1` | Reduce Motion for one process |
| `builder island [--store DIR]` | what the notch would show now |
| `builder live-tail TRANSCRIPT` | what the island makes of one transcript |
| `builder preview-island [--pill] [--outline]` | every mode rendered offscreen |

The app films itself because a process without the Screen Recording permission gets only its
own windows over the wallpaper and menu bar from `CGWindowListCreateImage` (exactly the picture
wanted), while `screencapture -R` and ffmpeg's avfoundation input refuse on this machine.
`shots/motion/mac/` has the stills (flattened onto black: the capture leaves a column at partial
alpha where a black edge lands between pixels), the recordings, and the live popover.

## Not done

- A needs-you on a Codex, Gemini or Cursor session: their stores are not JSONL transcripts, so
  those agents show on the notch without a sentence or a wait.
- Focusing the exact terminal tab: the click brings the owning app forward, not the tab inside
  it. The app is found by walking the Claude Code process's parents to the first regular app.
  MEASURED: Claude Code's kernel process name is its VERSION ("2.1.276"), not "claude", so it is
  found by its executable (`~/.local/share/claude/versions/<version>`); all four running here
  shared one working directory (home), so the process started closest before the transcript's
  first record is taken. `builder live-tail` on two live transcripts named Terminal for one and
  cmux for the other, which is right.
- The engine's full re-derive per pass (above). An incremental derive is the fix, and it is an
  engine change with the boundary rules' correctness riding on it, not an island one.
