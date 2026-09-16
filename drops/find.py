"""The second model call: given a NAME and a CLAIM, where does the thing actually live.

THIS IS THE ONLY PLACE IN BUILDA A MODEL IS GIVEN TOOLS, and the split is the reason it is
allowed to be. The planner reads the person's drop and has no tools. The finder has WebSearch
and WebFetch and is given two short strings that this machine composed: a name, and one line
about what it is said to do. It never sees the caption, the person's repositories, their
handle, or anything else. A single call with tools would have had a stranger's caption and a
live network connection in one context; two calls means neither half can do what the pair
could.

WHAT IT IS FOR. A short video caption promises and does not name: "5 skills every beginner
needs", "the MCP server that fixed my context problem". The planner is right to leave `source`
null there, and the person is still owed the answer. This pass goes and gets it, and
`verify.py` then fetches whatever it comes back with, so a hallucinated `owner/repo` dies one
step later rather than becoming an install button.

WHEN IT RUNS. Only for a move whose `source` is null and whose kind is `install`, and only when
the drop's own kind is one where a thing to install is even plausible. It costs a web search
and a fetch, so it is not run over `keep` moves or over a recipe.
"""

from __future__ import annotations

import json

from analysis.run import AnalysisError, call_claude

from . import prompt as pr
from .tables import SOURCE_KIND

#: The finder reads pages, so it is given room the planner does not need.
TIMEOUT_S = 240
DEFAULT_MODEL = "sonnet"
#: WebSearch to find candidates, WebFetch to open the one it picks. Nothing that can write.
TOOLS = "WebSearch,WebFetch"

#: Where each drop kind's thing is most likely to live, best guess first. Given to the finder
#: as a hint about SHAPE, never as an answer: it still has to fetch the page.
LIKELY: dict[str, list[str]] = {
    "skill": ["github", "plugin_marketplace", "mcp", "npm", "docs_url"],
    "tool": ["github", "npm", "pypi", "homebrew", "docs_url"],
    "technique": ["docs_url", "github"],
    "project": ["docs_url", "github"],
}


def wants_find(move: dict, drop_kind: str) -> bool:
    """Is this a move the finder should go looking for."""
    return (
        move.get("source") is None
        and move.get("move_kind") == "install"
        and drop_kind in LIKELY
    )


def find_source(name: str, claim: str, drop_kind: str, *, model: str = DEFAULT_MODEL) -> dict | None:
    """A `MoveSource` for a named thing, or None. Never raises on a miss."""
    kinds = LIKELY.get(drop_kind) or list(SOURCE_KIND)
    schema = pr.find_schema(list(SOURCE_KIND))
    try:
        out, _ = call_claude(
            pr.FIND_SYSTEM,
            pr.find_message(name, claim, kinds),
            schema,
            model,
            tools=TOOLS,
            timeout_s=TIMEOUT_S,
        )
    except AnalysisError:
        # A finder that could not run is a move with no source, which is the state it was
        # already in. It is never an error the person has to see.
        return None
    if not isinstance(out, dict) or not out.get("found"):
        return None
    kind, ref, url = out.get("source_kind"), out.get("ref"), out.get("url")
    if kind not in SOURCE_KIND:
        return None
    if not (isinstance(url, str) and url.startswith("https://") and len(url) <= 500):
        return None
    if not (isinstance(ref, str) and ref.strip() and len(ref) <= 140):
        return None
    return {"source_kind": kind, "ref": ref.strip(), "url": url}


def fill_sources(plan: dict, *, model: str = DEFAULT_MODEL, limit: int = 3) -> int:
    """Run the finder over the moves that want one. Returns how many were filled.

    `limit` is a ceiling on the web searches one drop can cost. Five moves that all want
    finding is a caption that named nothing at all, and the first three are the ones the
    planner ranked highest.
    """
    kind = plan.get("kind") or "unknown"
    filled = 0
    for move in plan.get("moves") or []:
        if filled >= limit or not wants_find(move, kind):
            continue
        name = " ".join(
            str(x) for x in (plan.get("title") or "", move.get("title") or "") if x
        ).strip()
        src = find_source(name[:200], str(move.get("intent") or "")[:200], kind, model=model)
        if src:
            move["source"] = src
            move["verification"] = {
                "state": "unchecked",
                "found_by": "search",
                "http_status": None,
                "checked_at": None,
                "refusal": None,
            }
            filled += 1
    return filled


def mark_caption_sources(plan: dict) -> None:
    """Every source the PLANNER wrote came from the caption. Recorded before the finder runs
    so the two can be told apart on the card: a link the creator published is a different
    claim from a link a search found."""
    for move in plan.get("moves") or []:
        if move.get("source") and move.get("verification") is None:
            move["verification"] = {
                "state": "unchecked",
                "found_by": "caption",
                "http_status": None,
                "checked_at": None,
                "refusal": None,
            }
