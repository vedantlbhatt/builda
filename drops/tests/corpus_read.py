"""The cached real corpus, as `cluster.py` wants it.

`scripts/drops_corpus.py` writes one JSON file per link (its resolution and its plan). Every
test that needs realistic drops reads them through here rather than building fixtures, so a
rule that only works on text somebody wrote to make it pass fails loudly.
"""

from __future__ import annotations

import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent / "corpus"


def rows() -> list[dict]:
    """Every cached link, in a stable order (by file name, which is a hash of the URL)."""
    return [json.loads(p.read_text()) for p in sorted(HERE.glob("*.json"))]


def drops() -> list[dict]:
    """The clusterable shape: {kind, title, summary, tags}, for the rows that have a plan.

    A refused row has no title and nothing to cluster on, which is correct: the board draws it
    as its own node with its refusal on it, and it never joins a cluster by accident.
    """
    out = []
    for r in rows():
        plan = r.get("plan")
        if not plan:
            continue
        out.append(
            {
                "kind": plan.get("kind"),
                "title": plan.get("title"),
                "summary": plan.get("summary"),
                "tags": plan.get("tags") or [],
                "url": r.get("url"),
            }
        )
    return out
