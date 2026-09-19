# Drops — a reel you shared, turned into work you can start

Builda already turns the logs your coding tools write into sessions. A **drop** comes in the
other door: you are in Instagram or TikTok, you see something you want to *do*, you hit
share, you pick Builda. What you shared becomes a card on a board, and the card carries the
moves you could actually make on it. You pick one, and Claude Code starts it on your Mac —
which means the reel becomes a Builda session like any other. The loop closes.

## Three words

**drop** — one link you shared, plus everything that was legitimately readable from it.
**move** — one thing you could do about it, proposed with the words that justify it.
**run** — a move you started. It is a Claude Code run, so it is also a session.

## What already exists (searched 2026-09-15)

The share-a-reel-and-get-something-real pattern is proven, and it is proven *entirely in
food*. Shipping apps: Peel, FoodiePrep, Recipe Notes, ReciMe, Crouton, Pestle, Tote, Remy —
all iOS share sheet, all "video in, structured recipe out". Open source: ReelBites (scrape →
Whisper → Tesseract OCR → Gemini → recipe), LogosVeda/reel-recipes (reel → Apple Notes with
timers and a shopping list), AsmitBhardwaj/RecipeApp, GerardPolloRebozado/social-to-mealie
(reel → a Mealie instance). Adjacent but not this: OpenMontage points a coding agent at video
*production*; yt-dlp MCP servers hand an agent a transcript and stop there.

Nobody has built it for builders. Every one of those products ends at a document you read.
The thing a builder wants from a reel is not a document — it is the work started. That is the
whole of this feature, and it is why the terminal state of a drop is a running session rather
than a saved card.

Two things worth stealing from them, and one worth refusing:

- Steal: the share sheet *is* the product surface. Anything that makes you open the app first
  and paste a link has already lost. (Peel's own marketing is a stopwatch: ten seconds.)
- Steal: extract structure, not a summary. Quantities, steps, names of packages — the things
  you can act on — not a paragraph about the video.
- Refuse: their happy path is "the model said so". Every one of them will confidently invent a
  quarter teaspoon. This codebase's rule is the other one (CLAUDE.md, the rule that matters
  most), so a move that names something to install carries a source that was *fetched* before
  the move was shown, and a move with nothing behind it is refused with a reason code.

## The kinds

A drop is exactly one kind. The planner may not invent one; `unknown` is a real answer.

| kind | what it means | hue |
|---|---|---|
| `skill` | a Claude Code skill, plugin, MCP server, subagent or CLI you could install | iris |
| `technique` | a way of working: a prompt, a setting, an optimisation, a workflow | tide |
| `project` | an idea for something to build | orchid |
| `tool` | a product or library worth trying before you commit to it | cobalt |
| `recipe` | ingredients, quantities and steps (the one non-code kind, kept on purpose) | coral |
| `unknown` | readable, and not any of the above | none |

`recipe` is not a joke and it is not scope creep. It is the control case: it is the kind the
whole rest of the market has solved, so it is the kind that tells you whether the extraction
is honest. If Builda cannot get "3 cloves garlic, minced" right, it has no business claiming
it got "install the skill from this repo" right.

## The moves

| move | what the runner does | terminal state |
|---|---|---|
| `install` | fetch the verified source and install it on this Mac | installed, and the path it landed at |
| `apply` | open one of *your* repos and make the change | a Claude Code session |
| `scaffold` | make a new project and implement the first slice | a Claude Code session |
| `evaluate` | try it in a throwaway clone, report whether it is worth it | a written verdict |
| `card` | no code: render what the drop actually said, as a card in the app | a card |
| `keep` | file it | nothing, on purpose |

Every move carries `evidence`: a VERBATIM span of the caption or transcript. A move whose
evidence is not a substring of the resolved text is dropped before you ever see it, the same
way `analysis/run.py` drops a decision pattern whose excerpt it cannot find. This is the one
rule that keeps the board from filling with plausible inventions.

## The pipeline, and who runs which part

```
phone   share sheet → POST /v1/drops {url, shared_text}            drop.status = waiting
 Mac    python -m capture drops watch
          resolve   oEmbed, then yt-dlp metadata + subtitles       drop.status = resolving
          plan      claude -p, --tools "", strict JSON schema
          find      claude -p, --tools "WebSearch,WebFetch"        (only for install moves)
          verify    every source URL is fetched, or the move is downgraded
          PUT /v1/drops/{id}/resolution                            drop.status = planned
phone   the board draws the card and its moves
          tap → start                                              move.status = queued
 Mac    the same watcher: workspace, then `claude`                 move.status = running
          the run is a Claude Code session, so Builda sees it      move.status = done
```

**Why the Mac and not the server.** Same reason `analysis/run.py` shells out to `claude -p`:
the person's own subscription pays for it, there is no key to manage, and nothing about them
is stored on a server that did not need it. It also happens to be the only place the work can
*happen* — the moves end in a repository on this machine. The honest cost is that a drop
shared while the Mac is asleep says `waiting` on the card, with those words on it, until the
Mac wakes up. That is a true sentence about where the work runs, so it is the one shown.

**Two model calls, deliberately split.** `plan` sees the drop's text and has NO tools, so
nothing it reads can leave. `find` has WebSearch and WebFetch and is handed only a name and a
claim — never the caption, never your repos, never anything of yours. A single call with tools
would have put a stranger's caption and your machine in the same context; this split is why
it does not.

## What may be read from a link

ONLY what is public and what the platform itself offers:

- the oEmbed endpoint, which is the author, the title and the thumbnail;
- `yt-dlp`'s metadata and any subtitle track the platform publishes;
- the page's own OpenGraph tags.

NEVER: a logged-in session, a cookie jar, a private account, a download of the video itself.
If the post is private the answer is the refusal `private_or_gone`, not a workaround. No audio
is transcribed by Builda: if the platform did not publish words, the drop has no words, and
`no_text` is the honest card.

## Refusals, as codes

`url_unsupported`, `no_text`, `private_or_gone`, `not_about_building`, `planner_unavailable`,
`planner_refused`, `source_unverified`. Prose is rendered on the phone from the code, exactly
as every other refusal in this codebase is (`spec/drops.v1.json` holds the table; the phone's
sentences are in `mobile/src/drops/copy.ts`). A refusal is never a blank card.

## The board

A dotted field, and drops on it, two to a row. The dotted background is not decoration: it is
the same grid the cards snap to, so a board with three drops looks like a board with thirty.
Kind decides the hue, status decides what the card says, and the thumbnail is the reel's own
poster when the platform published one. `mobile/app/(tabs)/drops.tsx` draws it;
`mobile/src/drops/` holds the pieces.

## Security notes, because this feature takes a stranger's words as input

A caption is UNTRUSTED TEXT that reaches a planner whose output starts work on your machine.
Three walls:

1. The planner has no tools and cannot act. Its output is a JSON document held to a schema.
2. Every move is inert until a person taps it. There is no auto-run, ever, and no setting to
   turn one on.
3. The runner builds its own prompt from the drop's STRUCTURED fields (kind, title, the move's
   `intent`) and passes the raw caption as clearly-delimited quoted material it is told not to
   follow. The caption never becomes an instruction.

And the smaller one that is easy to miss: a shared URL goes to the server before anything has
looked at it, so the URL itself is validated at the door (scheme, host allowlist, length) and
stored as text, never fetched by the server.

What comes BACK from a run is one line, the move's `outcome`, shown on its card: Claude's own last
words about the run, a recipe's host, or why it failed. It is free text from your machine, so it
goes out through `drops/runner.outbound`: one line, the server's 300 character cap, and your home
directory written `~`, because the first version sent `/Users/<name>/...` in every scaffold's line
and the last 200 characters of claude's stderr in every failure. The stderr stays in the terminal
running `drops watch`. Excluding a repository clears the outcome of every move that ran in it.
