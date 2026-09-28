# The trailer: a project's film, cut from its demo, directed from the phone

The owner, 2026-09-28: "look at how we made demo videos for RideGT. It goes far beyond that ... I
want to make the demo thing for everyone so they can put on GitHub and have quick shares to X Reddit
Facebook TikTok Instagram, auto format it to different sizes ... and then have a chat where they can
request changes and it actually goes and rerenders it."

A demo (docs/demos.md) is the app, filmed. A trailer is what you would post: the demo's screens in
their device, the project's name, a number it earned, the days it was built, what changed, what it
is made of and an end card, drawn in the app's own pixels and motion, in every social shape. It is
made on your Mac from facts, never from a model's imagination, and it changes when you ask it to in
your own words.

## The pieces

| where | what |
|---|---|
| `spec/trailer.v1.json` | the one definition: a cut (seconds, pace, hue, creature, mood, camera, transition, scenes), the scene kinds, the change codes and the refusal codes, each with its sentence. `make gen` writes the Python, TypeScript and server shapes |
| `capture/trailer/facts.py` | what a trailer may show, measured: the demo's beats and stills, commits and days built from git on a 04:00 day, commits since the last demo only when there was one, hours and sessions only from your report |
| `capture/trailer/cut.py` | the first cut (a scene for each thing the facts can show and none for anything else), the checks every cut must pass, the diff of two cuts as change codes, and each code's sentence |
| `capture/trailer/direct.py` | a note in your words, read by rules first and by your own `claude -p` only when the rules understood nothing, then held to the gate (below) |
| `capture/trailer/make.py` | the facts and the cut, the one way the CLI and the worker gather them |
| `capture/trailer/notes.py` | the phone's notes: claim, read, cut, render, publish, finish |
| `trailer/` | the renderer (Node 22.18 or newer, which loads the app's own TypeScript motion modules as they are) |
| `mobile/src/trailer/` | the director on the phone |

## The renderer

`node trailer/bin/render.js --facts F --cut C --out DIR --formats vertical,feed,landscape,square --gif`

Every frame is a pure function of its time, drawn with `@napi-rs/canvas`:

- **The house's own motion.** The springs are `mobile/src/motion/spec.ts`'s, the pixel arrivals are
  `pixelMotion.ts`'s eight orders, the creatures are `pixel/animals.ts`'s 16 by 16 frames, the band
  is the app's Bayer dither with its fringe. Nothing is a lookalike: the renderer requires the same
  files the phone imports.
- **Motion blur** by accumulating sub frames in linear light, the shutter half the frame.
- **Fluid.** Scene changes are an ink wipe: a phase field carried by a stable fluids solver
  (`mobile/src/motion/fluid.ts`, shared with the Projects tab's ink), MacCormack advection for the
  edge, two tones at the edge from the project's hue and its partner. A figure rises on a plume.
- **Layout by shape.** A frame wider than 0.95 of its height lays out side by side, taller ones
  stack; every size is in points of the shorter side over 393, so one cut reads alike in all four.
- **The words.** Labels are the demo's own (the words its privacy check read). A label is never
  cut: it steps its size down to 0.64 of the asked before any word could go, and none does.
  FOUND IN THE DIRECTOR RUN: the square format cut "pick a place on campus" to "pick a place on".
- **Sound.** A score synthesised from the cut (mood quiet or drive, or none), two pass loudnorm to
  -14 LUFS and -1 dBTP at mux.
- **Out.** Frames split across worker processes by range into lossless FFV1, joined once, encoded
  H.264 High, yuv420p, BT.709, faststart; a poster per format (the settled end card); a GIF from
  the square at the device table's loop size, smaller until it is under 8 MiB.

MEASURED: RideGT's 20 s cut in all four formats, 207 s on 16 cores, -13.8 LUFS, the GIF 6.1 MB.
An 11 s cut in the square alone, 29 s on 4 cores (the director run below). `node trailer/test/smoke.js`
renders every scene at a quarter size in CI.

## The director

You write what you want: "make it shorter and orange", "open on the app", `call it "RideGT"`,
"hard cuts", "no music", "go back to version 2". Your Mac changes the cut, renders it again, and
answers with what it did.

**The answer is never prose a model wrote.** It is `cut.diff` of the old cut against the new one:
change codes with before and after, which the phone words from the spec's sentences, the same ones
the Mac prints (a test runs `cut.say` and holds the phone to it). So "make it orange with hard cuts"
is answered "the colour is ember now · scenes change by a straight cut now", which is what the new
version is.

**The gate.** Every new cut, from the rules or the model, is held to the spec's bounds and the
facts (`cut.validate`), every number in its words to the project's own numbers and the note's (a
model may not put "10,000 users" on a trailer), every word to this Mac's repository names, dashes
rewritten. A cut that fails is refused with a code and the trailer you had stays.

**Every cut is kept** (`~/.builder/demos/<key>/trailer/cuts/NNNN.json`), so any version can come
back, and every note and its answer is in `notes.jsonl`.

### From the phone

The ship kit screen opens on the trailer when the kit has one, with the recording one word away.
Under the trailer is the conversation:

1. The phone posts the note (`POST /v1/projects/{key}/trailer/notes`, owner only, at most five
   waiting). It shows at once as waiting, with a "take back" while no Mac has it.
2. The worker (`python -m capture demo watch`) claims it (`POST /v1/trailer/notes:claim`, each note
   once, a claim stale after ten minutes). The phone says your Mac is cutting it, three cells in the
   project's hue rising in turn.
3. The Mac reads the note against the current cut, or cuts the first version when there is none
   ("make a trailer" is a note like any other), renders it, and, when the worker runs with
   `--publish-requests`, publishes the kit with the new trailer in it.
4. It finishes the note (`POST /v1/trailer/notes/{id}:finish`) done with the version and the change
   codes, or failed with a refusal code. The phone reads it on its next poll, words it, and reads the
   kit again, so the new version is the one playing. It arrives the way the film changes scenes:
   the trailer's own ink (`InkWipe`, the same `wipePhases` and `wipeCell`) rises through the frame,
   the versions swap while the band covers it, and it drains off the top. A version the Mac made but
   did not publish is said to be on the Mac.

The worker answers notes BEFORE it films anything: a note is a render of a minute or so with you
looking at the phone, a demo is half an hour nobody is waiting on. It is still one worker, so a
render never runs beside a simulator. After it films a new demo it cuts the trailer again from it,
so a published kit never carries a trailer of screens the app no longer has.

MEASURED ON THE LOCAL STACK (2026-09-28, Linux, 4 cores, the square format only, with a stand in for
Apple Vision, which exists only on a Mac): "make a trailer" answered with version 1; "make it orange
with hard cuts" sent from a page left open, answered and shown with version 2 playing 54 s after the
send, 25 s of which the worker was not yet running.

## In the kit

The trailer travels with the ship kit, under its listing and its yes (`demo kit --publish`, or the
worker's `--publish-requests`), in its own slots: `trailer_vertical`, `trailer_feed`,
`trailer_landscape`, `trailer_square` (MP4, up to 41 s) and `trailer_loop` (GIF), with the
document's `trailer` saying which version, how long and which scenes. Only a whole render of the
current cut goes: never a draft, never a render of a cut you have since changed. Every word a
trailer draws came from its facts file, and those words are read once more against this Mac's
repository names at publish; a trailer that names one stays on the Mac and the kit goes without it.

## Commands

    python -m capture demo trailer [PATH | --key KEY]     cut it from the demo and render it
    python -m capture demo trailer ... --draft            half size, no motion blur: a quick look
    python -m capture demo direct --key KEY "NOTE"        change it by a note, and render the new cut
    python -m capture demo watch --publish-requests       answer the phone's notes and requests
