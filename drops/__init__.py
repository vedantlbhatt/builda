"""Drops: a reel somebody shared into Builda, and the work it turns into.

`docs/drops.md` is the design and `spec/drops.v1.json` is the wire. The stages, one module
each, in the order the runner walks them:

1. ``urls``      is this a link Builda can read, which platform is it on, and what does it
                 look like with the tracking parameters gone.
2. ``resolve``   the text the PLATFORM published: oEmbed, then yt-dlp, then OpenGraph, then
                 whatever the share sheet itself carried. No audio is transcribed; no video
                 is downloaded.
3. ``plan``      ``claude -p`` with no tools and ``drops/schema.json``, then the evidence
                 gate: a move whose quote is not in the resolved text is discarded.
4. ``find``      only for moves that name something to install, and only with a name and a
                 claim: ``claude -p`` with WebSearch and WebFetch, never the person's data.
5. ``verify``    fetch every source URL. A source that does not answer downgrades its move.
6. ``cluster``   the board's shape: TF-IDF over the drops' own words, cosine similarity,
                 average link agglomeration. The phone runs the same rules in TypeScript and
                 ``drops/tests/test_cluster_parity.py`` holds the two equal.
7. ``runner``    poll, resolve, plan, and start the moves a person tapped, as Claude Code.

Standard library only, like ``capture``. yt-dlp is called as a SUBPROCESS when it is on the
PATH and skipped when it is not, so nothing here imports it and the package installs nowhere.
"""

from __future__ import annotations

import pathlib

from .tables import DROPS_VERSION  # noqa: F401  (re-export; generated, never restated)

ROOT = pathlib.Path(__file__).resolve().parent.parent
#: The schema handed to the constrained decoder. Generated beside this file by
#: scripts/gen_drops.py so the model's document and the server's door come from one spec.
SCHEMA_PATH = pathlib.Path(__file__).resolve().parent / "schema.json"
