# Demos: every project carries its screenshots and a short video

The owner, 2026-09-14: "build the tool that allows people to put in a GitHub repo and
automatically run whatever project they're working on and get screenshots and make a demo of
it... for every project, it should be attached with a demo or some screenshots." How a project is
run and recorded comes from `docs/research/demo-capture.md`; this file is the rest: what a demo is,
where it lives, who can see it, and how the phone shows it.

## What a demo is

Per project (the projects block's `key`, the repository's salted hash): up to 8 stills and at most
one video of 10 to 30 seconds, each with the state it shows in plain words ("the session page,
scrolled to the chart"). Produced on the Mac by `python -m capture demo`, never on the server and
never on the phone. A project that cannot be run gets no fake: it is refused with the reason
(no run command found, the build failed, nothing to show), and the phone says so in words.

## What leaves the Mac, and when

Nothing, by default. A demo is written to `~/.builder/demos/<key>/` and stays there until the person
publishes it (`python -m capture demo --publish`, or the phone's button on that project's page,
which asks the Mac through the pairing). The images are the person's own content and may show a
private repository's name inside the app they recorded; so:

- publishing is explicit, per project, and says what it sends (how many images, the video's size);
- demo media is visible to its owner only, whatever the session sharing settings (RLS, owner policy);
- reads are authorised: production hands the owner short lived presigned GET URLs; the local stack
  serves the bytes itself behind the bearer token. Never a public bucket URL, which would be a
  capability link anyone holding it could open;
- deleting a demo on the phone deletes the objects and the rows in one request, and deleting the
  account deletes every demo (`account/delete` already sweeps owned rows; objects go with them);
- `privacy/upload-contract.json` declares the channel (`project_media`: image/png, image/jpeg,
  video/mp4 only, size caps, and the metadata fields, numbers and the state label only) and
  `PRIVACY.md` regenerates from it.

## Storage

A `project_media` table (migration 0026): id, user_id, project key, publish_id, kind (image,
video), object key, content type, width, height, duration_ms (video), bytes, position, the state
label, source, the video's poster (object key, type, bytes), committed, created_at. Owner only
RLS: one policy per command, each `user_id = the viewer`, no public policy; `builder_app` may
update only `committed` and `committed_at`. Objects go through `objectstore.py` as post media do,
under `project-media/<user>/<project key>/<media id>[-poster].<ext>`, with a second backend for the
local stack (`OBJECT_STORE_ENDPOINT=file:///...`, which `scripts/overnight_stack.sh` points at
`$OVERNIGHT_HOME/media`, 0700): uploads PUT to the API itself and reads stream from disk, dev
only (refused at boot when ENVIRONMENT is production), so the phone on the tunnel sees the same
flow as production.

## On the phone

- The Projects tab: each project's door carries a small stack of its stills to the side, fanned
  like prints (react-bits `Stack`), the top one printing in with the band's dither.
- A project page: the video plays muted and looping behind the hero band, cut to the band's shape
  and sunk under its dither edge, never over words; a tap opens it full screen with sound. The
  stills sit beside the first chapter as a stack; a tap expands them to a full screen gallery that
  swipes (react-bits `Carousel`, `PixelTransition` between images), with each state's label.
- No demo yet: the stack is a single empty print that says how to make one, never a spinner and
  never a stock image.
- Motion follows the house rules: the video pauses off screen and under Reduce Motion; stills
  decode at display size (`expo-image`), and nothing redraws after it lands.
- Playback is `expo-video` (not `expo-av`, which is deprecated), a native module, so it needs a
  build.

## The generator, on the Mac (`capture/demo/`)

Built. Stage by stage as `docs/research/demo-capture.md` section 3 recommends: no model anywhere, a
flow written once and replayed. Standard library only, like the rest of capture.

```bash
python -m capture demo [PATH] --plan          how it would run the project; runs nothing
python -m capture demo [PATH]                 detect, clone, build, film, compose, check
python -m capture demo --repo https://github.com/owner/name
python -m capture demo PATH --app Some.app    film an iOS app built elsewhere
python -m capture demo PATH --sim NAME|UDID   the simulator (default "Builda Demos", created)
python -m capture demo PATH --until build     stop after a stage (workspace, build)
```

1. `detect.py`, `transcripts.py`: the kind (`expo_ios`, `web`, `cli`, `library`) and the steps.
   The commands that WORKED in the project's own Claude Code transcripts come first, read through
   capture's reader (`sessions.load_source`) and resolver (`repo.identity_for` on each record's
   own cwd, following `cd` within and across the lines of one shell call); then `package.json`
   scripts, `app.json` or `app.config` read as text (never executed), Procfile, then Railpack's
   rules. A kind the transcripts ran wins over the structural order: RideGT's repository holds an
   old CRA site at the top and the Expo app its owner ships in `mobile/`.
2. `workspace.py`: never the checkout. `git clone --local` of the commit into
   `~/.builder/demos/work/<key>/src` with a sparse checkout that never writes `.env*` or
   `google-services.json` (MEASURED on RideGT: both are tracked, and `git status` stays clean), a
   PostHog key or Sentry DSN in a tracked file blanked, every child under an environment
   allowlist, dev servers under `srt` when it is installed and a plain sentence when it is not.
3. `simulator.py`, `ios.py`: a simulator of its own, booted headless; a booted device nobody
   marked as the tool's is refused. Status bar 9:41, `privacy grant`, `location set`, AsyncStorage
   seeded before the first launch (`app.async_storage`, how a first run's terms and tips are
   skipped without a tap each), `openurl` per beat, Maestro for taps, and a tap on a COLOUR in a
   region for a control no accessibility label reaches. A Debug app loads its JavaScript from a
   Metro started in the clone on port 8097 and carries an `ip.txt` naming a closed port: FOUND
   WHILE BUILDING IT, Expo SDK 54's prebuilt React Native asks `localhost:8081` when left to guess,
   and there the owner's own Metro served the Builda checkout, so the RideGT app opened as Builda.
   Embedding the bundle was tried and reverted: React Native 0.81 will not run a development
   bundle without a dev server. `app.quiet_logs` turns development toasts off in the clone (a toast
   covered the button a tap needed). `web.py` drives Playwright from a venv in `~/.builder/tools`;
   `terminal.py` types each beat's command into VHS (0.11.0: 0.12.0 writes nothing, vhs#787).
4. Stills once two screenshots in a row are identical; one recorded pass through 3 to 5 beats. A
   beat can say what its screen must show (`expect`, read with Vision) and be filmed from where it
   lands (`film: "settled"`). A failed tap, a missing colour or a missing text STOPS the run and
   falls back: a point tap always "succeeds", and the sixth RideGT run filmed the results screen
   under the label "directions" before this existed.
5. `compose.py`, ffmpeg only, every command line a pure function: `freezedetect` holds sped up to
   0.7 s (the last one of a beat keeps 2.2 s for its caption), `mpdecimate` on the motion, a beat
   over 6.5 s sped up on its own, `xfade`, the whole brought inside 10 to 30 s, H.264 High with
   `+faststart`, a poster frame. Captions use `drawtext` where ffmpeg has it and otherwise a pill
   drawn by the Swift helper and laid on with `overlay`: Homebrew's ffmpeg 8.1.1 has no libfreetype.
6. `privacy.py`: Apple Vision (`helper.swift`, compiled on first use) over every still, the poster
   and the video at 2 frames a second. Refused with the file, the box and the masked text: the
   repository's names (origin, `owner/name`, folder), the names of the Mac's OTHER repositories,
   every key shape `analysis/digest.py` masks plus any 32 character token, email addresses, and a
   React Native crash screen (never a good capture). A one word name that is also an ordinary word
   (`builder`) is refused as a label or a path, not inside a sentence: Builda's own Wrapped card
   asks "Which kind of builder are you?". Labels are checked as text too, since they travel with
   the demo. It earned its place on the first runs: Builda's sample Now tab and sample session
   print the owner's real repository names (`builder`, `RideGT`, `gt-transit`), and both were
   refused until the storyboard filmed around them.
7. `fallback.py`: the last good capture (`previous`), then device sized screenshots and README
   images in the checkout (`checkout`), then screenshots a session read (`transcript`). Never a
   generated picture; with none of them the demo is refused and no manifest is written.

Output, in `~/.builder/demos/<key>/` (or `BUILDER_DEMOS_DIR`): `still-NN.png`, `demo.mp4`,
`poster.jpg` and `manifest.json`, exactly this shape (`manifest.validate` holds every write to it,
and to the contract's caps and label rule, so a demo it writes is one `--publish` sends):

```json
{"version": 1, "project_key": "<the 64 hex repo_hash>", "kind": "expo_ios", "commit": "<sha>",
 "taken_at": "2026-09-14T07:02:11Z",
 "assets": [{"file": "still-01.png", "kind": "image", "content_type": "image/png", "width": 1206,
             "height": 2622, "position": 1, "label": "the session page, the call chart", "source": "capture"},
            {"file": "demo.mp4", "kind": "video", "content_type": "video/mp4", "width": 1206, "height": 2622,
             "duration_ms": 18000, "position": 0, "label": "...", "poster": "poster.jpg", "source": "capture"}],
 "privacy": {"checked": true, "engine": "vision", "refused": []}}
```

A project's storyboard lives beside its clone (`work/<key>/storyboard.json`, or `.yaml`), with any
harness it needs: RideGT's `transloc_replay_feed.py` serves the repository's own recordings in
TransLoc's format, because its map reads the live mirror, which replay mode does not reach.

## The API (owner only, bearer auth)

Built (migration 0026, `server/builder/routes/media.py`, `server/builder/project_media.py`). Every
route is on `current_device`: the phone's sign in token or the paired Mac's device flow token, the
same person. A capture key is refused (401) on all of them: it belongs to a headless container
that cannot make or vet a demo, the bytes are opaque images, and a publish replaces, so a leaked
key must not be able to delete a demo. A key that is not the caller's project (a repository with
one of their sessions, or a key in their own report, never an excluded one) is a 404; `{key}` is
the whole 64 hex hash, never the 12 character prefix.

- `POST /v1/projects/{key}/media:presign` (the Mac): `{publish_id, kind, content_type, bytes,
  width, height, duration_ms, position, label, source, poster}` (`poster: {content_type, bytes}`
  on a video, else null) -> `{media_id, upload_url, method: "PUT", headers: {Content-Type,
  Content-Length}, expires_in: 900, poster: {upload_url, method, headers, expires_in} | null}`.
  `publish_id` is 16 random hex the Mac mints per run: a publish is a SET. A presign for a new
  publish drops the unfinished rows of an older one; the caps (8 images, 1 video) count one
  publish's rows, so a full set refuses the next presign (409). 413 over a size cap, 422 for
  anything the contract does not declare or the label rule refuses.
- The upload: `PUT upload_url` with exactly those headers and no bearer. In production a
  presigned S3 PUT (type and size signed); in development `PUT /v1/media-upload/{token}`, a JWT
  for one object, type and size, 15 minutes, used once (the file is created exclusively).
- `POST /v1/projects/{key}/media/{media_id}:commit` (the Mac): checks the object is there, the
  size matches and it starts like its type (409 otherwise), marks it committed, and answers
  `{item, pending, replaced}`. The commit that leaves nothing of its publish pending deletes the
  project's rows of every other publish and their objects.
- `GET /v1/projects/{key}/media` (the phone): `{items: [{id, kind, content_type, width, height,
  duration_ms, position, label, source, url, poster_url}]}`, videos first then stills by position,
  from the one publish with nothing pending (half a new set never shows beside the old one).
  `url` and `poster_url` are presigned GETs good for 15 minutes in production, and relative in
  development (`/v1/media/{id}`, `/v1/media/{id}/poster`, ranges supported), fetched with the bearer.
- `GET /v1/projects/media:preview?keys=a,b` (the Projects tab, up to 50 keys): `{projects: {key:
  [items]}}`, up to 3 stills each, `[]` for a key with no demo of the caller's.
- `DELETE /v1/projects/{key}/media` (the phone or the Mac): every row, then every object, in one
  request: `{deleted: n}`. Account deletion and excluding the repository do the same.

The Mac's side is `python -m capture demo --publish [--project DIR | --key KEY] [--yes]` and
`--delete` (`capture/demo_publish.py`): it refuses a manifest whose privacy check did not run or
refused anything, checks every file against the contract (by its own first bytes and size; the
numbers sent are the file's own), prints every file, the counts and the bytes, waits for a yes,
then presigns every file, uploads every file and commits every file. Labels: ASCII letters,
digits, the space and `, . ' ( ) : ? ! &`, at most 80 characters, no word over 24, no dash and no
hyphen. The caps and why are in `privacy/upload-contract.json` (`project_media.measured`).
