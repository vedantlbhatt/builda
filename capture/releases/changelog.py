"""`python -m capture release changelog [PATH]`: the project's published releases, in its CHANGELOG.md.

The phone publishes a release; this writes it where a repository keeps its history, on the owner's
Mac, as an uncommitted change the owner reviews and commits (nothing here runs git). Each release
is written once, newest first, under the file's own title, marked with a comment that carries its
id so a second run adds only what is new and never touches a word the owner wrote:

    # Changelog

    <!-- builda release 768246be-... -->
    ## The trailer, faster and in ember · 2026-09-28

    The trip now says when to leave.

    * A trailer cut from the demo, version 4
    * Hard cuts between scenes

Points are asterisks, as a README block's are: the house has no dashes. A release's words were read
by its owner before it went out, and the server held them to the private names it knows
(`names_a_repository`), so they are written as published.
"""

from __future__ import annotations

import datetime as dt
import re

HEADER = "# Changelog"
MARK = "<!-- builda release {id} -->"
_MARKED = re.compile(r"<!-- builda release ([0-9a-f-]{36}) -->")


def entry(r: dict) -> str:
    """One release as the changelog writes it (pure)."""
    when = r.get("published_at") or ""
    try:
        day = dt.datetime.fromisoformat(when.replace("Z", "+00:00")).date().isoformat()
    except ValueError:
        day = ""
    head = f"## {r['title'].strip()}" + (f" · {day}" if day else "")
    parts = [MARK.format(id=r["id"]), head]
    notes = (r.get("notes") or "").strip()
    if notes:
        parts += ["", notes]
    points = [h.strip() for h in r.get("highlights") or [] if str(h).strip()]
    if points:
        parts += [""] + [f"* {h}" for h in points]
    return "\n".join(parts)


def merge(existing: str | None, releases: list[dict]) -> tuple[str, int]:
    """(the file with every published release not in it yet, how many were added). New ones go
    under the title, newest first, above everything already there; nothing already there moves."""
    text = existing if existing is not None else f"{HEADER}\n"
    have = set(_MARKED.findall(text))
    new = [r for r in releases if r.get("status", "published") == "published" and str(r.get("id")) not in have]
    if not new:
        return text, 0
    new.sort(key=lambda r: r.get("published_at") or "", reverse=True)
    block = "\n\n".join(entry(r) for r in new)
    lines = text.splitlines()
    # Under the file's first heading line when it has one; else at the top.
    at = next((i + 1 for i, ln in enumerate(lines) if ln.startswith("# ")), 0)
    head, rest = lines[:at], lines[at:]
    while rest and not rest[0].strip():
        rest = rest[1:]
    out = "\n".join(head + ([""] if head else []) + [block] + ([""] + rest if rest else [])).rstrip() + "\n"
    return out, len(new)
