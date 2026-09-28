"""The README badge (docs/social.md): a public project's stars and its latest release, in the app's
own pixels, for a GitHub README.

    [![builda](https://<server>/v1/badge/<handle>/<key>.svg)](https://<server>/u/<handle>)

Two halves on the dark ground: the pixel star in the project's hue beside "builda", then the hue
itself carrying "12 stars · released sep 28", the two joined by the band's dithered fringe (the
Bayer table the phone's bands print through, `palette.BAYER8`). Square corners: it is pixels.

WHAT IT SAYS AND TO WHOM. The route (routes/badge.py) is read by anyone, since a README is, so
it reads as nobody: a number only for a project its owner made public on a profile that shows its
projects (`project_is_public`, `can_see_projects`, the stars' own rules), and only a release that
went out to everyone. Anything else, an unknown handle included, is the plain mark, the same bytes
for every case, so the badge never tells a stranger that a private project exists. No words of the
owner's are drawn (no title, no name): nothing to escape, nothing to leak.

The widths are a judgement, not a measurement: 6.4 points a character is the average advance of
Verdana at 11 points (the face shields.io badges use, which GitHub renders them in), so a badge
sits beside the others in a README without a gap or a clip.
"""

from __future__ import annotations

import datetime as dt

from . import palette

#: The phone's `PROJECT_HUES` (mobile/src/projects/model.ts), restated; test_badge.py holds it.
PROJECT_HUES = ("tide", "ember", "iris", "brass", "orchid", "cobalt", "coral", "heather")

HEIGHT = 20
CELL = 2
CHAR = 6.4
PAD = 6
FONT = "Verdana,DejaVu Sans,sans-serif"
#: The pixel star (the phone's `releases/model.ts STAR`), 7 by 7.
STAR = ("...X...", "..XXX..", "XXXXXXX", ".XXXXX.", "..XXX..", ".XX.XX.", ".X...X.")
FRINGE = 4


def preferred_hue(key: str) -> str:
    """The hue a project key asks for: its first eight hex digits round the ring (the phone's
    `preferredHue`)."""
    return PROJECT_HUES[int(key[:8], 16) % len(PROJECT_HUES)]


def width_of(text: str) -> int:
    return round(len(text) * CHAR)


def words(stars: int | None, released: dt.datetime | None) -> str | None:
    """The right half's words: "12 stars · released sep 28", "1 star", "released sep 28". None
    when there is nothing public to say (the plain mark)."""
    parts = []
    if stars is not None:
        parts.append(f"{stars} {'star' if stars == 1 else 'stars'}")
    if released is not None:
        parts.append(f"released {released.strftime('%b').lower()} {released.day}")
    return " · ".join(parts) or None


def _star(x0: int, y0: int, ink: str, filled: bool) -> list[str]:
    out = []
    for r, row in enumerate(STAR):
        for c, ch in enumerate(row):
            if ch != "X":
                continue
            edge = any(
                not (0 <= rr < 7 and 0 <= cc < 7 and STAR[rr][cc] == "X")
                for rr, cc in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1))
            )
            if filled or edge:
                x, y = x0 + c * CELL, y0 + r * CELL
                out.append(f'<rect x="{x}" y="{y}" width="{CELL}" height="{CELL}" fill="{ink}"/>')
    return out


def _text(x: float, s: str, fill: str) -> str:
    return f'<text x="{x:.1f}" y="14" fill="{fill}" font-family="{FONT}" font-size="11">{s}</text>'


def svg(key: str | None, stars: int | None, released: dt.datetime | None) -> str:
    """The badge. `key` None, or nothing to say, is the plain mark in the text colour."""
    right = words(stars, released) if key else None
    ink = palette.HUES[preferred_hue(key)][0] if key and right else palette.TEXT_DIM
    left_w = PAD + 7 * CELL + 5 + width_of("builda") + PAD
    parts = [f'<rect width="{left_w}" height="{HEIGHT}" fill="{palette.GROUND}"/>']
    parts += _star(PAD, (HEIGHT - 7 * CELL) // 2, ink, filled=right is not None)
    parts.append(_text(PAD + 7 * CELL + 5, "builda", palette.TEXT))
    total = left_w
    label = "builda"
    if right:
        fringe_w = FRINGE * CELL
        right_w = PAD + width_of(right) + PAD
        x0 = left_w
        # The fringe: ground into hue, cell by cell, through the band's threshold table.
        for c in range(FRINGE):
            for r in range(HEIGHT // CELL):
                if (c + 0.5) / FRINGE * 64 > palette.BAYER8[r % 8][c % 8]:
                    parts.append(
                        f'<rect x="{x0 + c * CELL}" y="{r * CELL}" width="{CELL}" '
                        f'height="{CELL}" fill="{ink}"/>'
                    )
        parts.insert(
            0,
            f'<rect x="{x0 + fringe_w}" width="{right_w}" height="{HEIGHT}" fill="{ink}"/>',
        )
        parts.insert(
            0, f'<rect x="{x0}" width="{fringe_w}" height="{HEIGHT}" fill="{palette.GROUND}"/>'
        )
        parts.append(_text(x0 + fringe_w + PAD, right, palette.GROUND))
        total = left_w + fringe_w + right_w
        label = f"builda: {right}"
    body = "".join(parts)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{total}" height="{HEIGHT}" '
        f'viewBox="0 0 {total} {HEIGHT}" role="img" aria-label="{label}" '
        f'shape-rendering="crispEdges"><title>{label}</title>{body}</svg>'
    )
