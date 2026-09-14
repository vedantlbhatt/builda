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

A `project_media` table: id, user_id, project key, kind (image, video), object key, content type,
width, height, duration_ms (video), bytes, position, the state label, created_at. Owner only RLS.
Objects go through `objectstore.py` as post media do, with a second backend for the local stack
(`OBJECT_STORE_ENDPOINT=file:///...`): uploads PUT to the API itself and reads stream from disk,
dev only, so the phone on the tunnel sees the same flow as production.

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

Stage by stage as `docs/research/demo-capture.md` section 3 recommends: no model by default, a flow
written once and replayed.

1. Detect how to run it: the commands that worked in the project's own Claude Code transcripts
   first (Builda already reads them), then `package.json` scripts, `app.json`/`app.config` for an
   Expo app, Procfile or compose, then Railpack's rules. The kinds: `expo_ios`, `web`, `cli`,
   `library`.
2. Never build in the person's checkout: `git clone --local` (or a `git worktree`) into
   `~/.builder/demos/work/<key>/`, or a `--repo https://github.com/...` URL cloned there. `.env`
   files are not copied in; secrets are not read. Dev servers run under Anthropic's
   `sandbox-runtime` where it is installed, and the run says when it is not.
3. Drive: an iOS app on its own fresh simulator (never the one a person is using) through
   `simctl openurl` deep links, `status_bar override`, `privacy grant`, `location set`, and Maestro
   for taps; a web app through Playwright (shot-scraper's storyboard shape) over its routes; a CLI
   through a VHS tape built from its README usage.
4. Capture: 4 to 6 stills after the screen settles, and one recorded pass of 3 to 5 beats.
5. Compose with ffmpeg only: drop duplicate frames (`mpdecimate`), speed up holds (`freezedetect`),
   a crossfade between beats, a caption per beat, portrait H.264 MP4 plus a poster frame.
6. Before anything can be published: Apple Vision text recognition over every still and sampled
   video frames, refusing a publish that shows the private repository's name or anything that
   looks like a token or key, and saying which image and where.
7. When it will not run: the last good capture, then images already in the checkout (README
   media, `docs/`, `shots/`), each labelled with where it came from. Never a generated picture of
   the product.

Output: `~/.builder/demos/<key>/manifest.json` (kind, the beats and their labels, each asset's
source, sizes, the commit it was taken at) beside the PNGs, `demo.mp4` and `poster.jpg`.

## The API (owner only, bearer auth)

- `POST /v1/projects/{key}/media:presign` (the Mac): `{kind, content_type, bytes, width, height,
  duration_ms?, position, label, source}` -> `{media_id, upload_url, headers}`.
- `POST /v1/projects/{key}/media/{media_id}:commit` (the Mac): checks the object is there and the
  size matches, then the row is visible.
- `GET /v1/projects/{key}/media` (the phone): `{items: [{id, kind, content_type, width, height,
  duration_ms, position, label, source, url, poster_url}]}`, videos first then stills by position.
  `url` is absolute and short lived in production (presigned GET), and relative in development
  (`/v1/media/{id}`), which the phone resolves against its API base and fetches with the bearer.
- `GET /v1/projects/media:preview?keys=a,b` (the Projects tab): up to 3 stills per project.
- `DELETE /v1/projects/{key}/media` (the phone or the Mac): every object and row for it.
