# Drops: where it stands

`brief-drops.md` is what was asked. `docs/drops.md` is the design. This file is the state.
Newest at the top of each section.

Branch `claude/drops`, worktree `~/Downloads/projects/builder-drops`, based on
`claude/overnight-analysis`. The main checkout and the overnight worktree are untouched.

## Done

- **The wire.** `spec/drops.v1.json` is the only definition; `scripts/gen_drops.py` emits four
  (Pydantic door, TypeScript, the JSON Schema the planner is handed, and `drops/tables.py`, the
  enums with no Pydantic import so the runner stays standard library only). `make gen` runs it
  and `make check-gen` covers its outputs.
- **The reader** (`drops/resolve.py`): oEmbed, then yt-dlp, then OpenGraph, then the share
  sheet's own text. No video is downloaded and no audio is transcribed.
- **The planner** (`drops/plan.py`, `drops/prompt.py`): `claude -p`, no tools, the generated
  schema, then the gate that discards any move whose evidence is not verbatim in the text.
- **The finder and the verifier** (`drops/find.py`, `drops/web.py`, `drops/verify.py`): a second
  call with WebSearch and WebFetch that is given a name and a claim and nothing of the person's,
  and a fetch of every source URL through the registry's own API before a move is offered.
- **The recipe pass** (`drops/recipe.py`): a cooking post that names a dish and gives no method
  gets one, from a page that was actually opened, with the page named on the card.
- **The clustering** (`drops/cluster.py` + `mobile/src/drops/cluster.ts`): TF-IDF, cosine,
  average link agglomeration, in two languages held equal over the real corpus.
- **The server** (`0028_drops.py`, `server/builder/drops_store.py`, `routes/drops.py`): two
  owner only tables under RLS and the rule that a move is inert until a person taps it.
- **The runner** (`drops/runner.py`, `drops/workspace.py`): claims drops, resolves them, and runs
  tapped moves as Claude Code, in a scratch directory, a new project, or a branch of the repo the
  person chose.
- **The phone**: the Drops tab (fifth, middle of the bar), the Skia mind map, the generative
  pixel sigils, the zoom in panel, the move ledger, the step by step recipe screen, and the
  intake (share extension, deep link, paste).
- **The share extension** (`mobile/targets/share/`): its own Builda sheet, written directly
  rather than through `expo-share-intent`, which cannot be installed on Expo 53.
- **The CLI**: `python -m drops resolve|plan|find|recipe|cluster|watch|doctor`.

## Green

- `bun test` 2544 pass, `tsc --noEmit` clean.
- `pytest` 492 pass (32 of them `server/tests/test_drops.py`).
- `python3 -m unittest drops.tests.test_cluster` 6 pass, over the real corpus.
- `make gen && git diff --exit-code` stable.
- The corpus: 15 real public links resolved and planned, cached in `drops/tests/corpus/`.

## Measured, and each one changed the code

1. **`www.` is not noise.** Dropping it turns a working TikTok link into one TikTok's own oEmbed
   answers 400 for and yt-dlp calls `unsupported url`.
2. **A lazy quantifier either side of an alternation is not a parser.** The first OpenGraph
   reader ran 100% of a core for four minutes on Instagram's 625 KB app shell. 40 ms now.
3. **Instagram is closed.** Zero `og:` tags to four crawler user agents; yt-dlp asks for cookies.
   The card says so, and the cookie door is opt in and off by default.
4. **A truncated registry document is not a missing package.** PyPI's `yt-dlp` JSON ran past a
   200 KB read and a package that plainly exists came back unverified beside an HTTP 200.
5. **An emoji is not evidence.** A correct move was discarded because the model wrote a different
   shrimp.
6. **A cooking post that names a dish and gives no method is still a recipe.**
7. **A schema and a tool loop do not compose in this CLI.** `--json-schema` with
   `--tools "WebSearch,WebFetch"` returns `stop_reason: "tool_use"` and no structured output.
8. **`--tools` is not a grant.** `--allowedTools` is, and it is derived from the same string.
9. **Accretion, not erosion,** for the sigils: erosion took a 0.42 field to 0.05 mass.
10. **`expo-share-intent` cannot be installed here:** its lowest published version needs
    `expo ^54` and this app is on 53.
11. **A test that skips when the fixture gives it one account is a test that checked nothing.**
    The RLS test makes the second account.
12. **A label is a word somebody wrote, not a stem.** The first board sheet named a cluster `saa`.
13. **A `card` move that found a recipe and wrote it to disk is a move that did nothing.** It goes
    back onto the card, through the same validated door.
14. **A shared value's initial argument is read once.** The board seeded its transform from `fit`
    at first render, and at first render the board is EMPTY, so the map opened at the zoom ceiling
    on whatever was at the origin. It follows the board until a finger moves it.
15. **Skia scales about (0,0) and React Native scales about the centre.** The two layers agreed at
    scale 1 and nowhere else, so a cluster's word sat two hundred points from the cluster it named.
    `transformOrigin` top left.
16. **Fitting the whole board is the wrong result past five clusters:** every sigil at 23 points.
    The opening view stops shrinking where a node is still legible; the rest is one drag away.
17. **`#282420` on `#141210` is not subtle, it is missing.** The step number set huge behind a
    recipe step measured 1.2:1 and did not appear at all.

## Seen running

`shots/drops/` holds the simulator passes: the board with seven real shared links on it, the
recipe drop zoomed in with nine real ingredients in a mono column, and the method one step at a
time. `shots/drops/board-corpus.png` is the review sheet
(`scripts/render_drops_board.py`, which draws through the app's own TypeScript).

The app is built with BOTH extensions in it (`Builda.app/PlugIns/BuilderShare.appex` and
`BuilderWidgets.appex`) against the local stack on 127.0.0.1:8788.

## Next

- The Android half of the intake. The deep link (`builder://drop?url=`) works on both platforms;
  what is missing is an Android `ACTION_SEND` receiver, which needs a native module of its own.
- A native iOS build with the share extension in it, and a pass on the simulator with real
  shares. The board, the panel and the recipe screen have not been seen on a device yet.
- `drops/runner.py`'s `apply` path against a real repository end to end.
