"""Deciding whether a drop is news, and what the banner says.

`notify.py` is this module's older sibling and its four rules are the ones borrowed: only a
TRANSITION is news, a re-read of something already read is not, an alert that is not news is not
sent, and the words are composed once on the server so a phone build that does not know a kind
renders nothing rather than a debug string.

TWO MOMENTS, and they are the two a person actually waits through.

  read      the Mac read the link and worked out what it is. You shared it from the sofa and
            walked off; this is the answer. ONE banner per share, whatever the answer was,
            including a refusal: "Instagram would not give Builda anything to read" is news you
            can act on (share a different link), and silence there is indistinguishable from the
            Mac being asleep.
  finished  a move you tapped is done. This is the payoff, and it is the one banner that is worth
            interrupting somebody for.

WHAT IS NOT NEWS. A re-resolution: the content moved, the fact that the link has been read did
not. A move being queued or starting: you tapped it, you know. A move being declined: you did it.
A refusal that replaces an earlier refusal, for the same reason a re-resolution is not news.

COLLAPSE BY DROP. Both banners collapse on the drop's id, so a drop that is read and then has a
move finish shows one row in Notification Centre that says the latest thing, rather than a stack.
The same reason `notify.needs_you_collapse_id` exists.
"""

from __future__ import annotations

from .drops_spec import ANALYSIS_ENUM_VALUES

#: The `data.kind` a tap reads, beside `notify.KIND_*`.
KIND_DROP_READ = "drop_read"
KIND_DROP_DONE = "drop_done"


#: One banner per drop, whichever of the two fired last.
def collapse_id(drop_id: str) -> str:
    return f"drop:{drop_id}"[:63]


def drop_url(drop_id: str) -> str:
    """What a tap opens: the board, with this drop open on it."""
    return f"builder://drops?open={drop_id}"


def push_data(drop_id: str, kind: str) -> dict:
    return {"kind": kind, "drop_id": drop_id, "url": drop_url(drop_id)}


#: What a drop turned out to be, in the second person, one line each. Rendered here rather than
#: on the phone for the reason every other banner is: a build that meets a kind it does not know
#: would otherwise show the enum.
_WAS = {
    "skill": "a skill",
    "technique": "a technique",
    "project": "something to build",
    "tool": "a tool",
    "recipe": "a recipe",
    "unknown": "nothing to act on",
}

_REFUSED = {
    "url_unsupported": "That link is not one Builda can read.",
    "no_text": "The platform published no words about it, so there was nothing to read.",
    "private_or_gone": "That post is private or has been taken down.",
    "not_about_building": "Readable, and there is nothing in it to build or cook.",
    "planner_unavailable": "Your Mac could not reach Claude Code.",
    "planner_refused": "What came back did not hold up, so none of it is being shown.",
}

assert set(_WAS) == set(ANALYSIS_ENUM_VALUES["drop_kind"]), "a kind with no sentence"
assert set(_REFUSED) == set(ANALYSIS_ENUM_VALUES["drop_refusal"]), "a refusal with no sentence"


def is_first_read(had_resolution: bool, had_refusal: bool) -> bool:
    """Only a transition is news. A drop that has already been read is being re-read."""
    return not (had_resolution or had_refusal)


def compose_read(
    *, title: str | None, kind: str | None, refusal: str | None, moves: int
) -> tuple[str, str]:
    """(banner title, body) for a drop that has just been read."""
    if refusal:
        return ("Builda could not read that", _REFUSED.get(refusal, "Nothing came back."))
    was = _WAS.get(kind or "unknown", "nothing to act on")
    head = title.strip() if title and title.strip() else "One drop"
    if moves <= 0:
        return (head, f"{was.capitalize()}. Nothing to do about it yet.")
    thing = "thing you could do" if moves == 1 else "things you could do"
    return (head, f"{was.capitalize()}, and {moves} {thing}.")


def compose_finished(*, title: str, outcome: str | None, ok: bool) -> tuple[str, str]:
    """(banner title, body) for a move that has just finished.

    The outcome is the RUNNER'S sentence, which is the only one that knows what happened. It is
    bounded at 300 characters by the column and trimmed here to what a banner shows, on a word.
    """
    head = title.strip() or ("Done" if ok else "That did not finish")
    body = (outcome or "").strip()
    if not body:
        body = "Done." if ok else "It did not finish. Open it to see how far it got."
    return (head, _trim(body, 150))


def _trim(s: str, n: int) -> str:
    if len(s) <= n:
        return s
    cut = s[: n - 1].rstrip()
    space = cut.rfind(" ")
    return (cut[:space] if space > n // 2 else cut).rstrip(" ,.;:") + "…"
