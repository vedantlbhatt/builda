# Demo capture: stills and a short video for every project

Builda research, 2026-09-14. Stars and last-push dates are from the GitHub API that day.

## 1. What "repo clip" probably is

The owner almost certainly means **RepoClip** ([repoclip.io](https://repoclip.io/)), which turns a pasted GitHub URL into a narrated promo video. It launched on BetaList on 2026-02-19 ([BetaList](https://betalist.com/startups/repoclip)) and had a one-point Show HN ([HN](https://news.ycombinator.com/item?id=47045631)). It is closed source apart from a GitHub Action that calls its API ([generate-video](https://github.com/repoclip/generate-video), MIT, 1 star).

It does not do what the owner described. By its own account RepoClip "doesn't run or screenshot your project". Gemini 2.5 Flash writes a script from the code, an image model draws illustrations, OpenAI TTS narrates, and Remotion renders on AWS Lambda. Private repos are read over OAuth ([how it works](https://repoclip.io/blog/how-repoclip-generates-videos-from-github-repos), [founder](https://dev.to/kazutaka-dev/how-i-built-an-ai-pipeline-that-turns-github-repos-into-demo-videos-4k91)). RepoToViralVideo works the same way ([repo](https://github.com/Shubhamsaboo/repotovideo)). Uploading code and inventing visuals both break Builda's privacy rules. Running and filming the project is what OpenVidStudio, aidemo, DemoTape, supercut and demo-machine do; all date from 2026 and have under 20 stars (table 2B).

## 2. Ranked shortlist

### A. Building blocks to adopt

| # | Tool | License | Stars, last push | What it does, how | Maturity | Fit for Builda |
|---|---|---|---|---|---|---|
| 1 | [xcrun simctl](https://wwdcnotes.com/documentation/wwdc20-10647-become-a-simulator-expert/) | Ships with Xcode | n/a | `io screenshot`, `io recordVideo` (HEVC by default, or `--codec h264`, [ref](https://sarunw.com/posts/take-screenshot-and-record-video-in-ios-simulator/)), `openurl`, `status_bar override`, `privacy grant`, `location set` ([ref](https://dev.classmethod.jp/en/articles/ios-simulator-location-command-line/)) | Mature | Core of iOS capture |
| 2 | [Maestro](https://github.com/mobile-dev-inc/Maestro) | Apache-2.0 | 15.6k, 2026-09-13 | Accessibility-layer YAML flows, no app changes for RN or Expo ([docs](https://docs.maestro.dev/get-started/supported-platform/react-native.md)). `openLink`, `takeScreenshot`, `startRecording` to MP4 ([docs](https://docs.maestro.dev/reference/commands-available/startrecording.md)) | Mature | Taps that deep links cannot reach |
| 3 | [Playwright](https://github.com/microsoft/playwright) | Apache-2.0 | 96.1k, 2026-09-11 | Drives Chromium and WebKit; `recordVideo` ([docs](https://playwright.dev/docs/videos)); 1.59 added `page.screencast` with action annotations and chapters ([notes](https://playwright.dev/docs/release-notes)) | Mature | Web engine |
| 4 | [shot-scraper](https://github.com/simonw/shot-scraper) | Apache-2.0 | 2.6k, 2026-09-13 | Python CLI on Playwright. `multi`: a YAML shot list whose `server:` block starts the app ([docs](https://shot-scraper.datasette.io/en/stable/multi.html)). `video`: a `storyboard.yml` with cursor rings, `--mp4` output ([docs](https://shot-scraper.datasette.io/en/stable/video.html)) | Stable. `video` arrived June 2026 ([post](https://simonwillison.net/2026/Jun/30/shot-scraper-video/)) | Web apps, from Python |
| 5 | [FFmpeg](https://ffmpeg.org/ffmpeg-filters.html) | LGPL/GPL | 64.2k, 2026-09-14 | `mpdecimate`, `freezedetect`, `zoompan`, `xfade`, `drawtext` | Mature | All composition |
| 6 | [agent-device](https://github.com/callstack/agent-device) | MIT | 4.6k, 2026-09-14 | An agent drives iOS simulators through accessibility snapshots; `record start`, deep links, `.ad` replays, Maestro YAML export ([commands](https://github.com/callstack/agent-device/blob/main/website/docs/docs/commands.md)). Expo's AI QA template uses it ([Expo](https://expo.dev/blog/build-an-ai-qa-agent-for-expo-apps-with-eas-workflows-in-minutes-today)) | Young, active | Opt-in RN exploration |
| 7 | [Railpack](https://github.com/railwayapp/railpack) | MIT | 1.2k, 2026-09-14 | Detects and builds with BuildKit; `info --format json` reports provider and start command without building ([CLI](https://railpack.com/reference/cli)) | Active; replaces Nixpacks (maintenance mode, [notice](https://github.com/railwayapp/nixpacks)) | Run-command hints |
| 8 | [VHS](https://github.com/charmbracelet/vhs) | MIT | 20.9k, 2026-09-09 | `.tape` script to GIF, MP4 or WebM; `Screenshot` command | Mature | CLIs, libraries |
| 9 | [sandbox-runtime](https://github.com/anthropics/sandbox-runtime) | Apache-2.0 | 5.2k, 2026-09-10 | Generated `sandbox-exec` profiles; network only via an allowlisting host proxy | Beta | Metro, dev servers |
| 10 | [microsandbox](https://github.com/superradcompany/microsandbox) | Apache-2.0 | 8.2k, 2026-09-14 | libkrun microVMs on Apple Silicon: sub-100 ms boot, Python SDK, host allowlists, secrets kept outside the VM | Young | Linux-capable backends |
| 11 | [apple/container](https://github.com/apple/container) | Apache-2.0 | 49.9k, 2026-09-11 | OCI Linux containers, one lightweight VM each; Apple silicon, macOS 26 | Young | Alternative to 10 |
| 12 | [Revideo](https://github.com/midrender/revideo) | MIT | 4.0k, 2026-07-15 | Renders TypeScript scenes headless | Moderate | Optional title cards. [Remotion](https://github.com/remotion-dev/remotion) (59.1k) needs a paid license above 3 employees ([license](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md)) |

Passed over:

- **Detox:** needs Jest, a native build config and a separate Expo setup ([docs](https://wix.github.io/Detox/docs/introduction/project-setup)).
- **fastlane snapshot:** needs an XCUITest target ([docs](https://docs.fastlane.tools/actions/snapshot/)).
- **Stale:** capture-website and pageres (last push 2025, [1](https://github.com/sindresorhus/capture-website), [2](https://github.com/sindresorhus/pageres)), terminalizer (2024, [repo](https://github.com/faressoft/terminalizer)).
- **Browser agents:** browser-use, Stagehand (which has a local mode, [docs](https://docs.stagehand.dev/v3/configuration/browser)), Skyvern (AGPL) and Playwright MCP suit only opt-in authoring; browser-use's default-on telemetry sends the task, visited URLs and result ([issue](https://github.com/browser-use/browser-use/issues/5216)).

### B. End-to-end projects to borrow from, not depend on

| Project | License | Stars, last push | How it works | Borrow |
|---|---|---|---|---|
| [OpenVidStudio](https://github.com/AnayDhawan/openvidstudio) | Apache-2.0 | 16, 2026-09-12 | An agent uses 26 MCP tools: finds the start command, captures via Playwright, iOS Simulator or terminal, renders in Remotion | Settle waits ([settle.ts](https://github.com/AnayDhawan/openvidstudio/blob/main/packages/capture/src/settle.ts)); SIGINT to finalize simctl video, then faststart ([native.ts](https://github.com/AnayDhawan/openvidstudio/blob/main/packages/capture/src/native.ts)) |
| [aidemo](https://github.com/tandryukha/aidemo) | MIT | 7, 2026-09-09 | An agent writes `storyboard.json`; a deterministic replay records Chrome, trims idle time, auto-zooms and captions with Whisper, optionally with local TTS | Write the flow once, replay it |
| [DemoTape](https://github.com/gabosarmiento/demotape) | MIT | 11, 2026-08-13 | Native macOS app. Its agent skill drives Playwright, and a vision model checks each scene | Local-first defaults |
| [supercut](https://github.com/Co-Messi/supercut) | MIT | 11, 2026-09-03 | An LLM picks 2 to 4 moments from the source and DOM. The recorder writes `events.json`, and the renderer zooms from it | Driver-to-renderer event log |
| [demo-machine](https://github.com/45ck/demo-machine) | MIT | 13, 2026-07-16 | A `.demo.yaml` with `runner.command` and `healthcheck`, run through Playwright and FFmpeg | Spec shape |
| [readme2demo](https://github.com/alphacrack/readme2demo) | MIT | 8, 2026-08-18 | An agent runs the README in a hardened container, replays it in a fresh one, and renders with VHS | Libraries, CLIs |
| [OpenScreen](https://github.com/getopenscreen/openscreen) | MIT | 2.9k, 2026-09-13 | Screen recorder with a headless CLI. `export --auto-zoom` detects dwell in cursor telemetry ([cli](https://github.com/getopenscreen/openscreen/blob/main/docs/cli.md)) | The zoom heuristic. Recordly and Cap are AGPL ([1](https://github.com/webadderallorg/Recordly), [2](https://github.com/CapSoftware/Cap)) |

## 3. Recommended architecture

Two rules: write a flow once and replay it deterministically ([aidemo's split](https://github.com/tandryukha/aidemo)), and use no LLM by default, since Builda already knows the checkout, the commands that worked in the transcripts, and the files each session touched. In Expo Router, every file under `app/` is a deep-linkable screen ([Expo Router](https://docs.expo.dev/router/basics/core-concepts/)).

| Stage | Web app | Expo / RN iOS | CLI | Library, no UI |
|---|---|---|---|---|
| 1 Detect, run | Transcript commands, then scripts, Procfile, compose or `devcontainer.json` ([spec](https://containers.dev/implementors/json_reference/)), then Railpack (Node: `start`, `main`, `index.js`; FastAPI: `uvicorn main:app`, per [Node](https://railpack.com/languages/node) and [Python](https://railpack.com/languages/python)) | Scheme from `app.json`. Build once per commit with `expo run:ios --configuration Release`, which strips `__DEV__` code ([Expo CLI](https://docs.expo.dev/more/expo-cli/)), then reuse the `.app` | `bin`, `[project.scripts]`, `[[bin]]`, README code | Tests, `examples/` |
| 2 Boot safely | Dev server under srt; Linux-capable servers in microsandbox | Xcode on the host, Metro and backend under srt, fresh simulator | srt or microsandbox | same |
| 3 Drive | Framework routes, sitemap or same-origin links, fed to a shot-scraper storyboard | `simctl openurl` after `status_bar override`, `privacy grant`, `location set`; Maestro for taps | VHS tape from README usage | VHS running an example or tests |
| 4 Capture | shot-scraper `multi` and `video` | `simctl io screenshot`, `recordVideo --codec h264` | VHS | VHS |
| 5 Compose | FFmpeg | FFmpeg, device frame, tap rings | FFmpeg | FFmpeg title card |

- **Stills.** Shoot after the screen settles: on the web, fonts loaded, images decoded, finite animations done ([OpenVidStudio](https://github.com/AnayDhawan/openvidstudio/blob/main/packages/capture/src/settle.ts)); on iOS, a stable accessibility tree ([agent-device's `--settle`](https://github.com/callstack/agent-device/blob/main/website/docs/docs/commands.md)). Keep 4 to 6.
- **Video, 10 to 30 s.** Record one pass through 3 to 5 beats.
  - Cut duplicate frames with `mpdecimate`, and speed up the holds `freezedetect` finds ([filters](https://ffmpeg.org/ffmpeg-filters.html#freezedetect)).
  - Aim `zoompan` at rectangles from the driver's action log, [as supercut does](https://github.com/Co-Messi/supercut#-event-log-contract).
  - Simulator video shows no touches ([Maestro](https://maestro.dev/blog/showing-tap-indicators-on-ios-recordings)), so draw tap rings from that log.
  - Join beats with `xfade`, add `drawtext` captions, and export a portrait H.264 MP4 and a poster.
- **Opt-in agent.** With consent, Claude Code plus agent-device or Playwright MCP explores once and writes a Maestro flow or storyboard; later runs replay it without a model.

**Builda (this repo).**

- **Stack.** Expo SDK 53, RN 0.79, scheme `builder` ([app.config.ts](../../mobile/app.config.ts)).
- **Shot list.** [DEEPLINKS.md](../../mobile/src/nav/DEEPLINKS.md) is ready for `simctl openurl`: `now`, `projects`, `project/<key>`, `session/<id>?recap=1`, `wrapped?card=7`.
- **Setup.** Open `builder://dev-auth?onboarded=1&quiet=1` first. It passes onboarding with the sample session and hides LogBox toasts, but it exists only in debug builds ([dev-auth.tsx](../../mobile/app/dev-auth.tsx)), so Builda needs a Debug build. Build it with `BUILDER_API_URL` set, because the address is baked in at build time ([CLAUDE.md](../../CLAUDE.md)).
- **Data.** Real screens list project names ([DEEPLINKS.md](../../mobile/src/nav/DEEPLINKS.md)), so film the sample data or the local stack ([overnight_stack.sh](../../scripts/overnight_stack.sh)).
- **Fallbacks.** The web harness ([e2e_web.mjs](../../scripts/e2e_web.mjs)) and 121 PNG stills in `shots/final/`.

**RideGT** (read only) is a Georgia Tech bus route finder. The live product is an Expo SDK 54 / RN 0.81 iOS app with a native map, on a FastAPI backend over TransLoc feeds. There is also an older CRA web app with a Playwright spec ([README](../../../RideGT/README.md), [CLAUDE.md](../../../RideGT/CLAUDE.md)).

- **Build.** Release (`npm run ios:release`) uses the production backend. Debug expects a backend on port 5001 ([api.js](../../../RideGT/mobile/src/services/api.js)).
- **Simulator setup.** Set the location to campus and grant location to `com.vedantbhatt.ridegt` ([app.json](../../../RideGT/mobile/app.json)), so no permission sheet appears.
- **Beats.** Live map, building search, results, directions ([README](../../../RideGT/README.md)).
- **Traps.** The app shows only routes with active buses ([README](../../../RideGT/README.md)), so a night run films an empty map. Use its replay mode, which plays recorded bus data ([replayMode.js](../../../RideGT/mobile/src/services/replayMode.js)). Its PostHog session replay ([CLAUDE.md](../../../RideGT/CLAUDE.md)) would record the demo, so build without `EXPO_PUBLIC_POSTHOG_KEY`.
- **Fallbacks.** 182 PNG stills in `verification-screenshots/`, and the CRA app through its spec.

**When a project will not run**, work down this list, and label each asset's source on the phone:

1. The last good capture.
2. Images already in the checkout (README media, `docs/`, `shots/`), or screenshots in the project's transcripts.
3. Another surface: Expo web in a phone-sized viewport, a component gallery, or a web frontend.
4. A VHS recording of the tests.
5. A card drawn from Builda's analysis.

Never generate pictures of the product, [as RepoClip does](https://repoclip.io/blog/how-repoclip-generates-videos-from-github-repos).

## 4. Risks

- **Running code unattended.**
  - Installs run lifecycle scripts. Bun skips untrusted ones ([Bun](https://bun.sh/docs/install/lifecycle)) and pnpm 10 blocks them ([pnpm](https://github.com/orgs/pnpm/discussions/8945)); give npm `--ignore-scripts`.
  - Run only commands seen in the transcripts, under srt, with writes limited to the checkout and a temp dir.
  - readme2demo's container drops all capabilities, runs as non-root and caps memory, CPU and pids ([security](https://github.com/alphacrack/readme2demo#security-model)).
  - Xcode cannot run in a Linux VM. A macOS guest in Tart ([repo](https://github.com/openai/tart), FSL-1.1) with Xcode images ([templates](https://github.com/cirruslabs/macos-image-templates)) isolates it, but is too heavy as a default.
- **Secrets.**
  - Keep `.env` out of images: Docker says build args and env vars "persist in the final image" ([Docker](https://docs.docker.com/build/building/secrets/)).
  - Pass an explicit env allowlist, as [`overnight_stack.sh`](../../scripts/overnight_stack.sh) does with `env -i`.
  - Pixels leak too, and supercut warns that redaction "cannot cover images" ([supercut](https://github.com/Co-Messi/supercut#-privacy)). Before any upload, OCR every still with Apple Vision ([docs](https://developer.apple.com/documentation/vision/vnrecognizetextrequest)), and hold back frames that show a private repo name or a key-shaped string.
- **Phoning home.**
  - `maestro record` without `--local` uploads the recording to mobile.dev ([docs](https://docs.maestro.dev/maestro-flows/workspace-management/record-your-flow.md)). Set `MAESTRO_CLI_NO_ANALYTICS` ([docs](https://docs.maestro.dev/maestro-cli/environment-variables)).
  - [srt](https://github.com/anthropics/sandbox-runtime) governs processes it launches, and the simulator app is not one, so leave analytics keys out of iOS demo builds. On the web, abort analytics requests with `page.route` ([docs](https://playwright.dev/docs/network)).
- **Long installs.** Cache the `.app` and dependencies per commit, run when the Mac is idle and plugged in, and set hard timeouts ([readme2demo](https://github.com/alphacrack/readme2demo) caps spend per run). Wait for a health check before driving ([demo-machine](https://github.com/45ck/demo-machine)).
- **Licenses.** Do not link AGPL code (Recordly, Cap, Skyvern). Remotion needs a paid license above three people.

## 5. UI patterns to borrow

- **A muted, looping hero with a poster.** App Store previews run up to 30 s and autoplay muted. Apple advises on-screen text for that reason ([Apple](https://developer.apple.com/app-store/app-previews/)). `expo-video` loops and mutes with `player.loop` and `player.muted` ([docs](https://docs.expo.dev/versions/latest/sdk/video/)).
- **A screenshot strip under the video** that opens a full-screen pager.
- **The latest screenshot on the project card**, as Vercel shows for each project's latest production deploy ([Vercel](https://vercel.com/blog/dashboard-redesign)).
- **Video beside its stills.** Mobbin added video to flows because static screens miss transitions ([Mobbin](https://mobbin.com/changelog/2024-03-21-flows-in-action)).
- **A source label on each asset,** like [readme2demo](https://github.com/alphacrack/readme2demo)'s verified-on-commit badge: "captured", "from your repo" or "card".
- **The first image as share card.** Product Hunt's first gallery image becomes the link preview ([Submitator](https://submitator.com/blog/product-hunt-launch-assets)).
