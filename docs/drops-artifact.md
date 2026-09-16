# Drops, end to end

What was built, in the order it happens, with what it actually did on real links.

## 1. You hit share on a reel

iOS: `mobile/targets/share/`, a real Share Extension added through `@bacons/apple-targets`, the
same plugin the widget uses. It shows **Builda's own sheet** on Builda's ground, not the system
compose sheet with a Post button on it, because nothing is being posted. It reads the link out of
the `NSExtensionItem`, writes it into the App Group (`BuilderDropsInbox`), says "On your board",
and closes itself after a beat.

It does not call the API. The account's tokens live behind the app's keychain access group, and
an extension that could post would be a second client of the API with a second set of rules about
what it may do. The app drains the queue on its next foreground.

`expo-share-intent` was the obvious alternative and cannot be installed here: MEASURED, its
lowest published version needs `expo ^54` and this app is on 53.

Two other doors, same rule at the end of all three: `builder://drop?url=` (a Mac, a Shortcut, a
paste), and a field on the empty board, which is the one that works in Expo Go.

## 2. The Mac reads what the platform published

`drops/resolve.py`, in order of what costs least and lies least: oEmbed, then yt-dlp, then
OpenGraph, then the share sheet's own text. **No video is downloaded and no audio is
transcribed.** If the platform published no words, the drop has no words and the card says so
with the character counts printed beside the refusal.

MEASURED against the live endpoints on 2026-09-15, which is the whole design of that module:

| | what it actually does |
|---|---|
| TikTok | oEmbed answers with no key: the FULL caption, the handle, a poster frame. yt-dlp is blocked for the same link in the same minute. |
| YouTube | oEmbed answers, and yt-dlp adds the PUBLISHED subtitle tracks, the only place real spoken words come from. |
| Instagram | closed. Zero `og:` tags to facebookexternalhit, Googlebot, WhatsApp and Twitterbot; yt-dlp asks for cookies. |

The cookie door exists, is off unless `BUILDER_DROPS_COOKIES_FROM` is set, and is refused
outright server side. The alternative was pretending Instagram works.

## 3. Claude reads it, and the gate throws away what it cannot ground

`claude -p`, no tools, `drops/schema.json` as a constrained decoder. Then four rules that can
only REMOVE:

1. **Evidence.** Every move carries a span copied out of the text. A move whose span is not found
   there is discarded before anybody sees it.
2. **Kind.** A recipe with no method is emptied, not downgraded.
3. **Source.** A URL that is not https, or a `ref` that reads like a sentence, is removed from
   the move; the move survives with no source and the finder goes looking.
4. **Dashes.** `analysis/run.py`'s one rule, over everything but the verbatim evidence.

Live, on `https://www.tiktok.com/@nocode.joshua/video/7620790035939462407`:

```
kind        skill
title       5 Claude Skills every beginner needs to install
confidence  25          because the caption names none of the five
moves       1 of 1, 0 discarded for evidence
  install   "Go find the 5 skills"
  evidence  "5 beginner Claude skills that will get you ahead of 90% of people"
  source    null        the finder goes looking
```

## 4. It goes looking, and then it checks

`drops/find.py` gets WebSearch and WebFetch and is handed a name and a claim and **nothing of
the person's**: not the caption, not the handle, not the machine. Two calls, not one, for a
measured reason: `--json-schema` together with `--tools` returns `stop_reason: "tool_use"` and no
structured output at all, so research and structuring are separate, which is also the safer
shape.

`drops/verify.py` then FETCHES every source, through the registry's own API where there is one,
because github.com answers 200 with a "not found" page. A source that does not answer downgrades
its move to a link you can open rather than a button that installs nothing.

## 5. The board

`mobile/app/(tabs)/drops.tsx`, the fifth tab, in the middle of the bar because it is the only
tab you arrive at from outside the app.

- **Clustered, with no model and no service.** TF-IDF over the drops' own words, cosine, average
  link agglomeration. Written once in Python and ported to TypeScript, held equal over the real
  corpus by `drops/tests/test_cluster_parity` and `mobile/__tests__/dropsCluster.test.ts`.
- **The floor is fitted, not chosen.** `python -m drops cluster --sweep` prints every partition
  over the range; a test fails unless the constant sits inside a plateau at least five steps wide.
- **A map, not a list.** Clusters are constellations on a phyllotaxis spiral, which grows outward,
  so the twentieth cluster does not move the first. Dots are part of the map and pan with it.
- **Every drop grows its own pixel sigil** from its own link, by accretion from a core, in its
  kind's hue. Its motion is its state: growing while the Mac reads it, still once planned, one
  bright cell down its spine while a move runs.
- **Tapping zooms the map to it.** The panel rises underneath with the node docked on its edge,
  so you can still see where you were.

On the real corpus of fifteen links:

```
productivity  6    six VS Code posts
pasta         6    six garlic butter pasta posts
skills        1    the Claude skills TikTok
saas          1    an opinion with no object
pets          1    a dog video, kind `unknown`, no moves
```

## 6. You pick, and Claude Code does it

Armed by a tap, started by a bar that says how many, with room to say more first in your own
words. Then `drops/runner.py` runs it **as Claude Code** in a scratch directory, a new project,
or a branch of the repo you chose, and the run shows up in Builda as a session, because Builda
reads the logs Claude Code writes and does not care who started it.

Live, on the stack, with seven real links shared through the API:

```
planned   skill      5 Claude Skills every beginner needs to install   1 move
planned   recipe     1-Pan Garlic Butter Pasta with Shrimp             1 move
planned   recipe     Homemade Garlic Butter Pasta                      2 moves
planned   technique  Top 5 VS Code Productivity Tips                   5 moves
refused   -          instagram.com/reel/...        private_or_gone
unknown   -          a dog video                   not_about_building, 0 moves

tapped:   card "Get the full recipe"
ran:      done, 7 ingredients and 4 steps, from littlesunnykitchen.com/garlic-butter-pasta
```

## 7. The recipe screen

Quantities in a mono column that reads down, **"as needed" where the video gave no amount and
never a number**, and the method one step at a time with its own number set huge behind it,
because you are holding a phone with wet hands. Where the method came from is printed, when it
came from a page rather than the video.

Recipe is not scope creep. It is the control case: it is the kind the whole rest of the market
has already solved, so it is the kind that says whether the extraction is honest.

## What already existed, and why this is not that

The pattern is proven and proven entirely in food. Shipping: Peel, FoodiePrep, Recipe Notes,
ReciMe, Crouton, Pestle, Tote, Remy. Open source: ReelBites (scrape, Whisper, Tesseract, Gemini),
LogosVeda/reel-recipes, AsmitBhardwaj/RecipeApp, GerardPolloRebozado/social-to-mealie. Adjacent:
OpenMontage points a coding agent at video production; yt-dlp MCP servers hand an agent a
transcript and stop there.

Every one of them ends at a document you read. The thing a builder wants from a reel is not a
document, it is the work started, and the terminal state of a drop here is a running session.

And all of them will confidently invent a quarter teaspoon. The evidence gate, the fetch before
the button, and the null quantity are the whole difference.
