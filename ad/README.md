# The ad: Builda in 74 seconds, 9:16, drawn from code

Builda's own ad for Reels, TikTok and Shorts. Every frame is a pure function of its time, drawn with
`@napi-rs/canvas` in the app's own pixels. Nothing is a screen recording, and there is no stock
footage and no generated imagery. `SPEC.md` is the visual spec it was built against, read from the
app's source.

    cd ad && npm install && pip install -r requirements.txt
    npm run build        # out/builda.mp4: 1080 x 1920, 60 fps, motion blurred, scored, -14 LUFS
    npm run sheet        # out/sheet.png: a contact sheet, one frame every two seconds
    node render.js png 2400,2600    # single frames at full size, into out/

## Where it came from

The kit is RideGT's reel kit (the "One Dot" trailer), brought here with Builda's ad, which was
first made in that repository:

- sub-frame motion blur accumulated in linear light;
- four chunk workers rendering to lossless FFV1, joined once, then encoded to H.264;
- a score synthesised from `cues()`, so every hit lands on its frame;
- two-pass loudnorm, grain and a vignette.

What is Builda's own:

- **Colours.** Every colour comes from `design/tokens.json` (`T`, `HUE`, `RAMP` in `builda.js`),
  except the world outside the app (a macOS window, the lock screen), which is `WORLD`.
- **Creatures.** They are the app's 16 by 16 frames.
- **The pour.** In the trailer chapter one version pours into the next through the phone's own
  fluid, `wipePhases` and `wipeCell` from `mobile/src/motion/fluid.ts`, which Node 22.18 or newer
  loads as TypeScript.

## Chapters

| s | scene | what it shows |
|---|---|---|
| 0.0 | hello, picker, pair | the band prints, pick a creature, pair the Mac once |
| 10.2 | term, fly | the agent's log becomes the strip, and the camera flies it |
| 20.8 | lock, now | the Live Activity, then "needs you" |
| 28.5 | phone, card | the session page on a phone in the strip world, then the share card |
| 36.8 | direct | a trailer on the ship kit; "make it shorter and orange" is typed and sent, the Mac cuts it, version 2 pours in, and the answer reads "20 s became 15 s · the colour is ember now" |
| 41.7 | shapes | the same cut goes to 9:16, 4:5 and 1:1, and each platform lights on the shape its post shows best (`spec/shipkit.v1.json` `platform_format`) |
| 45.2 | release | "A release draft is waiting"; the draft the Mac wrote after 12 commits, then Publish |
| 48.0 | star | the follower's push, the pixel star, 12 becomes 13, and the README badge as `server/builder/badge.py` draws it |
| 51.2 | feed, board, graph, money | kudos, the faction board, the streak graph, what the tokens would cost |
| 63.8 | wrapped, end | the year deck, Bit and the wordmark |

The trailer chapter's words are the app's own: the director's lines ("Waiting for your Mac", "Your
Mac is cutting it"), the change sentences from `spec/trailer.v1.json`, the draft banner's title from
`server/builder/releases.py`, and the platform table from the ship kit spec. The project, its
numbers and its people are samples, and they say so where the phone would show a name ("tramline
(sample)").
