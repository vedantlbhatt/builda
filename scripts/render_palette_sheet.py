#!/usr/bin/env python3
"""
The colour v2 sheet (design-refs/DESIGN-V2-COLOUR-MOTION.md): Builda's spectrum on the warm dark
ground, every creature in its own hue, the fifteen Wrapped cards in story order, and the harness
glyphs in theirs. Stdlib only (zlib + struct, no Pillow): the PNG writer, the 5x7 font, the TS
literal reader and the pixel pack loaders are `render_pixel_sheet.py`'s, imported, so this sheet
draws the same frames the app draws.

What is read, and from where:
  mobile/src/pixel/{frames,sprites,animals}.ts   the nine creatures' 16x16 frames (frame 0)
  mobile/src/pixel/harness.ts                    the seven harness marks
  design/tokens.json                             the neutrals, the data hues and `spectrum`: the
                                                 nine hues AND every mapping (creature, crew
                                                 ring, harness, card, archetype, dimension,
                                                 verdict). The tables below are the round 1 to 7
                                                 proposal, used only when tokens.json has none

  python3 scripts/render_palette_sheet.py                  shots/v2/design/palette.png
  python3 scripts/render_palette_sheet.py --name round1    shots/v2/design/round1.png
  python3 scripts/render_palette_sheet.py --table          also print the contrast table
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from render_pixel_sheet import (  # noqa: E402
    DEFAULT_SRC,
    DEFAULT_TOKENS,
    ROOT,
    Canvas,
    contrast,
    load_marks,
    load_pack,
    mix,
    parse_hex,
    text_width,
    to_hex,
)

OUT = ROOT / "shots" / "v2" / "design"
D = 3  # device pixels per point: the sheet is drawn @3x, so 16/32/64 pt creatures land on whole pixels

# ─────────────────────────────────────────────────────────────────────────── OKLCH, sRGB


def _lin(c: float) -> float:
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _gam(c: float) -> float:
    c = max(0.0, min(1.0, c))
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def oklch_of(rgb) -> tuple[float, float, float]:
    r, g, b = (_lin(x) for x in rgb)
    l_ = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m_ = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s_ = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l_, m_, s_ = (math.copysign(abs(x) ** (1 / 3), x) for x in (l_, m_, s_))
    L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_
    a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_
    b2 = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    return L, math.hypot(a, b2), math.degrees(math.atan2(b2, a)) % 360


def _lin_rgb(L: float, C: float, H: float):
    a, b = C * math.cos(math.radians(H)), C * math.sin(math.radians(H))
    l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s_ = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    return (
        4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
        -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
        -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_,
    )


def oklch(L: float, C: float, H: float):
    """An sRGB colour at this lightness and hue, chroma reduced until it is inside sRGB."""
    c = C
    while c > 0 and not all(-1e-6 <= x <= 1 + 1e-6 for x in _lin_rgb(L, c, H)):
        c -= 0.001
    return tuple(round(_gam(x) * 255) for x in _lin_rgb(L, c, H))


def light_text(C: float, H: float, ground, floor: float = 4.6):
    """The lightest tone of the hue that still clears `floor` on the light ground: 4.6 for text,
    3.1 for a mark (a creature, a glyph, a ring), which is why a mark can stay brighter."""
    L = 0.80
    while L > 0.3:
        col = oklch(L, C, H)
        if contrast(col, ground) >= floor:
            return col
        L -= 0.005
    return oklch(0.3, C, H)


# ────────────────────────────────────────────────────────────────────────────── the table

# name, OKLCH L, C, H (dark ink), who wears it first. Amber is pinned to the brand's #FFB300.
# The green band (hue 120 to 200: add 141, human 182) and the red band (19 to 42: del 23,
# Claude's terracotta 39) are left empty on purpose: those hues are data, never identity. Coral
# sits at 16, just short of the red band, and 0.19 OKLab from del: lighter and pinker, never red.
SPECTRUM: list[tuple[str, float, float, float]] = [
    ("amber", 0.818, 0.171, 77.9),
    ("brass", 0.880, 0.150, 105.0),
    ("tide", 0.830, 0.105, 214.0),
    ("cobalt", 0.700, 0.140, 250.0),
    ("iris", 0.690, 0.160, 292.0),
    ("heather", 0.810, 0.105, 312.0),
    ("orchid", 0.710, 0.165, 342.0),
    ("coral", 0.800, 0.110, 16.0),
    ("ember", 0.730, 0.165, 48.0),
]
PINNED = {"amber": "#FFB300"}
PARTNER_L = 0.58  # the dark partner: same hue, ~3.8:1 on card, never under 3:1 (no muddy brown)
PARTNER_C = 0.85
LIGHT_PARTNER_L = 0.80
LIGHT_PARTNER_C = 0.70

CREATURES = {  # the creature wears the hue: one ink each, just not all the same ink
    "bit": "amber",
    "cat": "orchid",
    "dog": "cobalt",
    "fox": "ember",
    "owl": "heather",
    "bee": "brass",
    "whale": "tide",
    "octopus": "iris",
    "crab": "coral",
}

# Mission control: every session is its own builder. It wears ring[fnv1a32(id) % 8], stepped
# forward past any creature a session running at its start already wears (crew_v2).
CREW = ["fox", "whale", "bee", "octopus", "crab", "dog", "cat", "owl"]

HARNESS = {  # never the vendor's own brand colour, never amber (amber is Builder's)
    "claude_code": "heather",
    "codex": "tide",
    "cursor": "brass",
    "gemini_cli": "coral",
    "cline": "iris",
    "opencode": "ember",
    "aider": "cobalt",
}

# The fifteen, in story order. builder_type wears the archetype's creature hue (amber for a
# generalist, which is Bit's); the table's other fourteen never repeat a neighbour across (i+1)
# or down the two column grid (i+2), whichever archetype card one turns out to be (ALT).
CARDS: list[tuple[str, str, str]] = [
    ("builder_type", "archetype", "which kind of builder"),
    ("shipped", "brass", "how much did you ship"),
    ("work_style", "tide", "how do you work with your agent"),
    ("longest_session", "iris", "your longest session"),
    ("agents_at_once", "ember", "how many agents"),
    ("go_to_prompt", "orchid", "your go to prompt"),
    ("streak", "coral", "your longest streak"),
    ("change_course", "cobalt", "how often you change course"),
    ("crash_out", "ember", "your biggest crash out"),
    ("prompt_length", "heather", "how long are your prompts"),
    ("deep_sessions", "iris", "how do you work"),
    ("time_put_in", "amber", "how much time"),
    ("cryptic_prompt", "tide", "your most cryptic prompt"),
    ("prompts_per_session", "orchid", "how much do you talk"),
    ("kind_of_work", "brass", "what kind of work"),
]
ALT = {"shipped": "coral", "work_style": "coral"}  # when the archetype hue would meet card 2 or 3

VERDICT = {"converging": "add", "circling": "dim", "lost": "del"}
DIMENSIONS = {  # each wears the hue of the archetype whose rule reads it (DESIGN-V2 2.5)
    "steering": "tide",
    "execution": "brass",
    "engineering": "coral",
    "product instinct": "cobalt",
    "planning": "heather",
}
ARCHETYPE_CREATURE = {
    "architect": "owl",
    "velocity machine": "bee",
    "quality guardian": "crab",
    "night owl": "cat",
    "explorer": "octopus",
    "firefighter": "fox",
    "director": "dog",
    "skeptic": "whale",
    "generalist": "bit",
}


class Hue:
    def __init__(self, name: str, L: float, C: float, H: float, n: dict):
        self.name, self.L, self.C, self.H = name, L, C, H
        self.ink = parse_hex(PINNED[name]) if name in PINNED else oklch(L, C, H)
        self.partner = oklch(PARTNER_L, C * PARTNER_C, H)
        self.light = light_text(C, H, n["lbg"])  # text on the light ground, 4.5:1 and up
        self.light_mark = light_text(max(C, 0.13), H, n["lbg"], 3.1)  # a creature, a glyph, a ring: 3:1
        self.light_partner = oklch(LIGHT_PARTNER_L, C * LIGHT_PARTNER_C, H)

    def row(self, n: dict) -> dict:
        return {
            "ink": to_hex(self.ink),
            "on_bg": contrast(self.ink, n["bg"]),
            "on_card": contrast(self.ink, n["card"]),
            "ink_on": contrast(n["onink"], self.ink),
            "partner": to_hex(self.partner),
            "partner_on_card": contrast(self.partner, n["card"]),
            "light": to_hex(self.light),
            "light_on_lbg": contrast(self.light, n["lbg"]),
            "light_on_white": contrast(self.light, (255, 255, 255)),
            "light_mark": to_hex(self.light_mark),
            "light_mark_on_lbg": contrast(self.light_mark, n["lbg"]),
            "light_partner": to_hex(self.light_partner),
        }


def neutrals(tokens: Path) -> dict:
    t = json.loads(tokens.read_text())
    s, d = t["surface"], t["data"]
    return {
        "bg": parse_hex(s["bg"]["dark"]),
        "card": parse_hex(s["card"]["dark"]),
        "raised": parse_hex(s["raised"]["dark"]),
        "border": parse_hex(s["border"]["dark"]),
        "text": parse_hex(s["text"]["dark"]),
        "dim": parse_hex(s["textDim"]["dark"]),
        "faint": parse_hex(s["textFaint"]["dark"]),
        "lbg": parse_hex(s["bg"]["light"]),
        "lcard": parse_hex(s["card"]["light"]),
        "ltext": parse_hex(s["text"]["light"]),
        "onink": parse_hex(s["text"]["light"]),  # onAccent is the light text, #1C1917
        "add": parse_hex(d["add"]["dark"]),
        "del": parse_hex(d["del"]["dark"]),
        "bayer": t["dither"]["bayer8"],
        "spectrum": t.get("spectrum"),
    }


VERDICT_TOKEN = {"data.add": "add", "data.del": "del", "surface.textDim": "dim", "surface.text": "text"}


def adopt_mapping(spec: dict | None) -> None:
    """Once tokens.json carries the spectrum, every table on the sheet is the tokens' table, so
    the sheet cannot show a mapping the app does not ship."""
    global CREW, ALT
    if not isinstance(spec, dict) or not spec.get("hues"):
        return
    body = lambda k: {a: b for a, b in spec.get(k, {}).items() if not a.startswith("_")}  # noqa: E731
    CREATURES.clear()
    CREATURES.update(body("creature"))
    CREW = list(spec.get("crew", {}).get("ring", CREW))
    HARNESS.clear()
    HARNESS.update(body("harness"))
    questions = {cid: q for cid, _, q in CARDS}
    CARDS[:] = [(cid, hue, questions.get(cid, cid.replace("_", " "))) for cid, hue in body("card").items()]
    ALT = body("cardAlt")
    VERDICT.clear()
    VERDICT.update({k: VERDICT_TOKEN[v] for k, v in body("verdict").items()})
    DIMENSIONS.clear()
    DIMENSIONS.update({k.replace("_", " "): v for k, v in body("dimension").items()})
    wearer = {hue: animal for animal, hue in CREATURES.items()}
    ARCHETYPE_CREATURE.clear()
    ARCHETYPE_CREATURE.update({k.replace("_", " "): wearer[v] for k, v in body("archetype").items()})


def load_hues(n: dict) -> dict[str, Hue]:
    spec = n.get("spectrum")
    adopt_mapping(spec)
    if isinstance(spec, dict) and spec.get("hues"):
        # Once tokens.json carries the spectrum, the sheet draws the tokens, not this file's table.
        out = {}
        for name, v in spec["hues"].items():
            if name.startswith("_"):
                continue
            L, C, H = oklch_of(parse_hex(v["dark"]))
            h = Hue(name, L, C, H, n)
            h.ink = parse_hex(v["dark"])
            h.partner = parse_hex(v["partner"])
            h.light = parse_hex(v["lightText"])
            h.light_mark = parse_hex(v["light"])
            h.light_partner = parse_hex(v.get("lightPartner", to_hex(h.light_partner)))
            out[name] = h
        return out
    return {name: Hue(name, L, C, H, n) for name, L, C, H in SPECTRUM}


# ─────────────────────────────────────────────────────────────────────────── drawing kit


def rr(cv: Canvas, x, y, w, h, r, col) -> None:
    cv.rrect(int(x), int(y), int(w), int(h), int(r), col)


def perimeter(x, y, w, h, r) -> list[tuple[float, float]]:
    """Points one pixel apart round a rounded rectangle, clockwise from the top edge's start."""
    r = min(r, w / 2, h / 2)
    straight = [(x + r, y, 1, 0, w - 2 * r), (x + w, y + r, 0, 1, h - 2 * r), (x + w - r, y + h, -1, 0, w - 2 * r),
                (x, y + h - r, 0, -1, h - 2 * r)]
    corners = [(x + w - r, y + r, -90), (x + w - r, y + h - r, 0), (x + r, y + h - r, 90), (x + r, y + r, 180)]
    pts = []
    for i in range(4):
        sx, sy, dx, dy, length = straight[i]
        for s_ in range(int(length)):
            pts.append((sx + dx * s_, sy + dy * s_))
        cx, cy, a0 = corners[i]
        arc = int(math.pi * r / 2)
        for s_ in range(arc):
            a = math.radians(a0 + 90 * s_ / max(1, arc))
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def dashed_rrect(cv: Canvas, x, y, w, h, r, col, dash=4, gap=4, t=1) -> None:
    """A dashed rounded rectangle, walked by arc length so the dashes stay even round the
    corners (DESIGN-DIRECTION 6 draws it with Skia's DashPathEffect for the same reason)."""
    period = dash + gap
    for i, (px, py) in enumerate(perimeter(x, y, w, h, r)):
        if i % period < dash:
            cv.rect(int(round(px)) - t // 2, int(round(py)) - t // 2, t, t, col)


def comet(cv: Canvas, x, y, w, h, r, head: float, length: float, col, ground, t=4) -> None:
    """StarBorder, drawn still and on Builder's grain: a run of the border in `col` whose tail
    steps down in three flat tones (no blur, no gradient) behind a solid head."""
    pts = perimeter(x, y, w, h, r)
    n = len(pts)
    run = int(length * n)
    start = int(head * n) - run
    for k in range(run):
        f = k / run
        tone = col if f > 0.55 else mix(ground, col, 0.66) if f > 0.3 else mix(ground, col, 0.38) if f > 0.12 else mix(ground, col, 0.18)
        px, py = pts[(start + k) % n]
        cv.rect(int(round(px)) - t // 2, int(round(py)) - t // 2, t, t, tone)


def wrap(s: str, k: int, width: int) -> list[str]:
    lines, cur = [], ""
    for wd in s.split(" "):
        nxt = (cur + " " + wd).strip()
        if tw(nxt, k) > width and cur:
            lines.append(cur)
            cur = wd
        else:
            cur = nxt
    if cur:
        lines.append(cur)
    return lines


def text(cv: Canvas, x, y, s, col, k=2, cased=True) -> int:
    return cv.text(int(x), int(y), s, col, k, cased=cased)


def tw(s: str, k: int) -> int:
    return text_width(s, k)


def bayer(n: dict, x: int, y: int) -> float:
    return n["bayer"][y % 8][x % 8] / 64


def dither3(cv: Canvas, n: dict, x0, y0, w, h, cell, field, ink, partner, paper) -> None:
    """The two tone ordered dither: paper, then the hue's partner, then its ink, one Bayer
    threshold per cell (react-bits Dither's `colorNum 3`, done on the scalar so the hue never
    shifts). `field(u, v)` is 0..1 over the box. White stays paper."""
    cols, rows = w // cell, h // cell
    for j in range(rows):
        for i in range(cols):
            v = field((i + 0.5) / cols, (j + 0.5) / rows)
            if v <= 0.002:
                continue
            t = bayer(n, i, j)
            if v <= 0.5:
                c = partner if v * 2 > t else None
            else:
                c = ink if v * 2 - 1 > t else partner
            if c is not None:
                cv.rect(x0 + i * cell, y0 + j * cell, cell, cell, c)
            elif paper is not None:
                cv.rect(x0 + i * cell, y0 + j * cell, cell, cell, paper)


def frame_at(cv: Canvas, frame, x, y, pt, col) -> None:
    cv.frame(frame, {k: col for k in "bwhz"}, int(x), int(y), pt * D // 16)


# ───────────────────────────────────────────────────────────────────────── card motifs


def _hash(x: int, y: int, seed: int) -> float:
    h = (x * 374761393 + y * 668265263 + seed * 1442695041) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    h ^= h >> 16
    return h / 4294967296


def _noise(x: float, y: float, seed: int) -> float:
    ix, iy = math.floor(x), math.floor(y)
    fx, fy = x - ix, y - iy
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a, b = _hash(ix, iy, seed), _hash(ix + 1, iy, seed)
    c, d = _hash(ix, iy + 1, seed), _hash(ix + 1, iy + 1, seed)
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy


def motif(card: str, aspect: float):
    """A stand in for each card's header (mobile/src/wrapped/art.ts), seeded, so the sheet shows
    each hue over the kind of picture it will actually carry."""
    seed = sum(ord(c) * (i + 1) for i, c in enumerate(card))
    if card == "builder_type":  # the orb, lit from the upper left
        def f(u, v):
            X, Y = (u - 0.5) * aspect, v - 0.47
            d = math.hypot(X, Y) / 0.36
            if d <= 1:
                z = math.sqrt(1 - d * d)
                lam = max(0.0, (X / 0.36 * -0.55 + Y / 0.36 * -0.6 + z * 0.6) / 0.99)
                return 0.35 + 0.65 * lam
            return 0.0
        return f
    if card in ("shipped", "longest_session"):  # a rising area / a session's strip
        def f(u, v):
            if card == "shipped":
                top = 0.92 - 0.8 * (u ** 1.6) - 0.05 * math.sin(u * 19)
            else:
                top = 0.3 + 0.55 * _noise(u * 9, 0.5, seed)
            return 0.0 if v < top else 0.5 + 0.5 * min(1.0, (v - top) * 4)
        return f
    if card == "work_style":  # two voices, back and forth
        def f(u, v):
            a = 2 * math.pi * 1.4 * u
            y1, y2 = 0.5 + 0.22 * math.sin(a), 0.5 + 0.22 * math.sin(a + math.pi)
            b1 = max(0.0, 1 - abs(v - y1) / 0.07)
            b2 = max(0.0, 1 - abs(v - y2) / 0.07)
            between = 0.3 if min(y1, y2) < v < max(y1, y2) else 0.0
            return max(b1, b2 * 0.75, between)
        return f
    if card == "agents_at_once":  # lanes, three at the busiest moment
        lanes = [(0.05, 0.62), (0.28, 0.95), (0.4, 0.78), (0.1, 0.35), (0.55, 0.9)]
        def f(u, v):
            i = int(v * len(lanes))
            if i >= len(lanes) or (v * len(lanes)) % 1 > 0.7:
                return 0.0
            a, b = lanes[i]
            peak = a <= 0.58 <= b
            return (1.0 if peak else 0.45) if a <= u <= b else 0.0
        return f
    if card in ("go_to_prompt",):  # ripples: the same words, coming back
        def f(u, v):
            d = math.hypot((u - 0.3) * aspect, v - 0.5)
            ring = 0.5 + 0.5 * math.cos(2 * math.pi * d * 6)
            return 1.0 if d < 0.05 else ring * max(0.0, 1 - d / 1.2) ** 0.8
        return f
    if card == "streak":  # the commit row, a long run in the middle
        def f(u, v):
            i = int(u * 24)
            on = 1.0 if 7 <= i <= 17 else (0.45 if _hash(i, 1, seed) > 0.5 else 0.0)
            return on if 0.34 < v < 0.66 and (u * 24) % 1 < 0.8 else 0.0
        return f
    if card == "change_course":  # scatter, inked at the card's share
        def f(u, v):
            bx, by = int(u * 10), int(v * 7)
            if (u * 10) % 1 > 0.8 or (v * 7) % 1 > 0.8:
                return 0.0
            return 1.0 if _hash(bx, by, seed) < 0.18 else 0.28
        return f
    if card == "crash_out":  # a burst
        n = 13
        reach = [0.3 + 0.36 * _hash(i, 0, seed) for i in range(n)]
        def f(u, v):
            X, Y = (u - 0.5) * aspect, v - 0.5
            d = math.hypot(X, Y)
            if d < 0.07:
                return 1.0
            pos = ((math.atan2(Y, X) + math.pi) / (2 * math.pi) * n) % n
            i = int(pos)
            tip = 1 - abs(pos - i - 0.5) * 2
            ext = reach[i] * (0.3 + 0.7 * tip * tip)
            return 1 - d / ext * 0.55 if d < ext else 0.0
        return f
    if card == "prompt_length":  # a paragraph's silhouette
        lines = [0.84, 0.9, 0.7, 0.35, 0.88, 0.8, 0.5]
        def f(u, v):
            i = int((v - 0.1) / 0.12)
            if 0 <= i < len(lines) and ((v - 0.1) / 0.12) % 1 < 0.55:
                return 0.92 if 0.06 <= u < 0.06 + lines[i] * 0.88 else 0.0
            return 0.0
        return f
    if card in ("deep_sessions", "prompts_per_session"):  # bars, the long ones solid
        def f(u, v):
            i = int(u * 14)
            if (u * 14) % 1 > 0.7:
                return 0.0
            h = 0.25 + 0.7 * _hash(i, 3, seed)
            return 0.0 if v < 1 - h else (1.0 if h > 0.62 else 0.45)
        return f
    if card == "time_put_in":  # the contribution grid
        def f(u, v):
            i, j = int(u * 16), int(v * 7)
            if (u * 16) % 1 > 0.78 or (v * 7) % 1 > 0.78:
                return 0.0
            return round(_noise(i * 0.5, j * 0.5, seed) * 4) / 4
        return f
    if card == "cryptic_prompt":  # a blocky mosaic
        def f(u, v):
            bx, by = int(u * 9 * aspect), int(v * 9)
            h = _hash(bx, by, seed)
            if h < 0.42:
                return 0.0
            return 0.3 if h < 0.62 else 0.62 if h < 0.82 else 1.0
        return f
    if card == "kind_of_work":  # the split, as bands
        shares = [0.46, 0.3, 0.14, 0.1]
        def f(u, v):
            acc = 0.0
            for i, s in enumerate(shares):
                if acc <= u < acc + s - 0.015:
                    return [1.0, 0.62, 0.4, 0.2][i] if 0.2 < v < 0.8 else 0.0
                acc += s
            return 0.0
        return f
    return lambda u, v: _noise(u * 4, v * 4, seed)


# ────────────────────────────────────────────────────────────────────────────── sections


def card_hues(archetype_hue: str) -> list[str]:
    out = []
    for i, (cid, hue, _) in enumerate(CARDS):
        h = archetype_hue if hue == "archetype" else hue
        if cid in ALT and h == archetype_hue:  # the rule theme.cardHue runs
            h = ALT[cid]
        out.append(h)
    return out


def check_cards() -> list[str]:
    """No card meets its own hue across (i+1) or down the two column grid (i+2), for every hue
    card one can wear."""
    problems = []
    for arch in {CREATURES[c] for c in ARCHETYPE_CREATURE.values()}:
        hs = card_hues(arch)
        for i in range(len(hs)):
            for j in (i + 1, i + 2):
                if j < len(hs) and hs[i] == hs[j]:
                    problems.append(f"archetype hue {arch}: card {i + 1} and {j + 1} are both {hs[i]}")
    return problems


def frames_by_creature() -> dict[str, list[str]]:
    pack = load_pack(DEFAULT_SRC)
    out = {a: pack.animal_frames[a][0] for a in pack.animals}
    out["bit"] = pack.bit[pack.states[0]][0]
    return out


def section_title(cv: Canvas, n, x, y, num: str, title: str, sub: str) -> int:
    text(cv, x, y, num, n["faint"], 4, cased=False)
    text(cv, x + tw(num, 4) + 24, y, title, n["text"], 4, cased=False)
    text(cv, x, y + 42, sub, n["dim"], 2)
    return y + 42 + 14 + 38


def draw_hue_line(cv: Canvas, n, hues: dict[str, Hue], x0, y0, W) -> int:
    """The wheel, unrolled: where each hue sits, and the two bands left to data."""
    h = 34
    y = y0 + 30
    scale = W / 360
    # the bands the spectrum leaves empty: red (del, Claude's terracotta) and green (add, human)
    for lo, hi, col, label in ((19, 42, n["del"], "red: data"), (120, 200, n["add"], "green: data")):
        x = x0 + int(lo * scale)
        wpx = int((hi - lo) * scale)
        for yy in range(h):
            for xx in range(0, wpx, 1):
                if (xx + yy) % 8 < 2:
                    cv.rect(x + xx, y + yy, 1, 1, mix(n["bg"], col, 0.55))
        text(cv, x + 8, y + h + 10, label, col, 2) if label.startswith("green") else None
    # a faint axis
    cv.rect(x0, y + h // 2, W, 2, n["border"])
    for name, hue in hues.items():
        L, C, H = oklch_of(hue.ink)
        x = x0 + int(H * scale)
        rr(cv, x - 14, y - 6, 28, h + 12, 8, hue.ink)
        text(cv, x - tw(name, 2) // 2, y - 30, name, hue.ink, 2)
    for name, col, dy in (("add", n["add"], 0), ("del", n["del"], 0), ("you", n["human"], 0), ("claude", n["claude"], 22)):
        L, C, H = oklch_of(col)
        x = x0 + int(H * scale)
        rr(cv, x - 5, y + 2, 10, h - 4, 5, col)
        text(cv, x - tw(name, 2) // 2, y + h + 34 + dy, name, col, 2)
    for deg in range(0, 361, 60):
        text(cv, x0 + int(deg * scale) - tw(str(deg), 2) // 2, y + h + 78, str(deg), n["faint"], 2)
    lab = "oklch hue, 0 to 360. hatched: the bands data owns"
    text(cv, x0, y + h + 108, lab, n["faint"], 2)
    return y + h + 108 + 46


def draw_spectrum(cv: Canvas, n, hues: dict[str, Hue], x0, y0, W) -> int:
    names = list(hues)
    gap = 24
    colw = (W - gap * (len(names) - 1)) // len(names)
    frames = frames_by_creature()
    who = {v: k for k, v in CREATURES.items()}
    y = y0
    for i, name in enumerate(names):
        h = hues[name]
        x = x0 + i * (colw + gap)
        r = h.row(n)
        creature = who.get(name)
        # the ink as a fill with ink on it: the selected tile, the primary action
        rr(cv, x, y, colw, 220, 30, h.ink)
        text(cv, x + 18, y + 20, name, n["onink"], 4)
        text(cv, x + 18, y + 64, to_hex(h.ink), n["onink"], 2, cased=False)
        if creature:
            frame_at(cv, frames[creature], x + colw - 18 - 96, y + 220 - 18 - 96, 32, n["onink"])
            text(cv, x + 18, y + 220 - 18 - 14, creature, n["onink"], 2)
        # the two tone: paper, partner, ink, as a band on the card colour
        rr(cv, x, y + 232, colw, 132, 18, n["card"])
        band = lambda u, v: max(0.0, min(1.0, u * 1.08 - 0.04 + (0.5 - v) * 0.12))  # noqa: E731
        dither3(cv, n, x + 12, y + 244, colw - 24, 108, 6, band, h.ink, h.partner, None)
        # the numbers: on bg, on card, ink on the fill, the partner
        ty = y + 380
        rows = [("on bg", r["on_bg"]), ("on card", r["on_card"]), ("ink on it", r["ink_on"])]
        for k, (lab, v) in enumerate(rows):
            text(cv, x, ty + k * 30, lab, n["dim"], 2)
            vs = f"{v:.1f}"
            text(cv, x + colw - tw(vs, 3), ty + k * 30 - 4, vs, n["text"], 3)
        py = ty + 92
        rr(cv, x, py, 22, 22, 5, h.partner)
        text(cv, x + 32, py + 4, "partner", n["dim"], 2)
        vs = f"{r['partner_on_card']:.1f}"
        text(cv, x + colw - tw(vs, 3), py, vs, n["text"], 3)
        text(cv, x + 32, py + 26, to_hex(h.partner), n["faint"], 2, cased=False)
        # the light variant on the light ground: the text tone, its contrast, its two tone
        ly = py + 58
        rr(cv, x, ly, colw, 168, 18, n["lbg"])
        text(cv, x + 14, ly + 14, name, h.light, 4)
        soft = mix(n["lbg"], n["ltext"], 0.72)
        text(cv, x + 14, ly + 58, to_hex(h.light), h.light, 2, cased=False)
        vs = f"{r['light_on_lbg']:.1f}"
        text(cv, x + colw - 14 - tw(vs, 2), ly + 58, vs, n["ltext"], 2)
        rr(cv, x + 14, ly + 86, 16, 16, 4, h.light_mark)
        text(cv, x + 38, ly + 88, to_hex(h.light_mark), soft, 2, cased=False)
        vs = f"{r['light_mark_on_lbg']:.1f}"
        text(cv, x + colw - 14 - tw(vs, 2), ly + 88, vs, n["ltext"], 2)
        dither3(cv, n, x + 14, ly + 124, colw - 28, 28, 4, lambda u, v: u, h.light_mark, h.light_partner, None)
    cap = "light: the text tone (4.5:1 on #FBF9F5) under the name, the mark tone (3:1, creatures, glyphs, rings) beside the swatch"
    text(cv, x0, y + 380 + 92 + 58 + 168 + 14, cap, n["dim"], 2)
    return y + 380 + 92 + 58 + 168 + 64


def draw_creatures(cv: Canvas, n, hues, x0, y0, W) -> int:
    frames = frames_by_creature()
    order = ["bit", "cat", "dog", "fox", "owl", "bee", "whale", "octopus", "crab"]
    slot = W // len(order)
    big = 64 * D
    y = y0
    for i, a in enumerate(order):
        h = hues[CREATURES[a]]
        x = x0 + i * slot + (slot - big) // 2
        frame_at(cv, frames[a], x, y, 64, h.ink)
        text(cv, x0 + i * slot + (slot - tw(a, 3)) // 2, y + big + 20, a, n["text"], 3)
        text(cv, x0 + i * slot + (slot - tw(h.name, 2)) // 2, y + big + 48, h.name, h.ink, 2)
    y += big + 92
    # the picker, 32 pt on tiles: idle (the hue on raised), then selected (the hue is the fill)
    tile_w, tile_h = slot - 20, 150
    for selected in (False, True):
        for i, a in enumerate(order):
            h = hues[CREATURES[a]]
            x = x0 + i * slot + 10
            rr(cv, x, y, tile_w, tile_h, 30, h.ink if selected else n["raised"])
            frame_at(cv, frames[a], x + 20, y + 16, 32, n["onink"] if selected else h.ink)
            text(cv, x + 26, y + 16 + 96 + 12, a, n["onink"] if selected else n["text"], 3)
        y += tile_h + 16
    # the carousel: the centre at 64 pt, the neighbours at 32 pt, every one in its own ink. The
    # partner is never a creature on its own (a fox in its partner was the brown the judges saw)
    y += 24
    strip = ["dog", "fox", "owl", "bee", "whale"]
    sizes = [32, 32, 64, 32, 32]
    total = sum(s * D for s in sizes) + 4 * 64
    cx = x0 + (W - total) // 2
    for a, s in zip(strip, sizes):
        h = hues[CREATURES[a]]
        frame_at(cv, frames[a], cx, y + (64 - s) * D, s, h.ink)
        cx += s * D + 64
    lab = "the carousel: size and a 35 degree turn push the neighbours back; each keeps its full ink"
    text(cv, x0 + (W - tw(lab, 2)) // 2, y + 64 * D + 16, lab, n["dim"], 2)
    y += 64 * D + 56
    # inline at 16 pt, the way a row or a card shows a creature
    cx = x0
    for a in order:
        h = hues[CREATURES[a]]
        frame_at(cv, frames[a], cx, y, 16, h.ink)
        cx += 16 * D + 12
        cx += text(cv, cx, y + 16, a, n["dim"], 3) + 44
    y += 16 * D + 40
    # light appearance (widgets, a light Lock Screen): each creature in its hue's light tone
    rr(cv, x0, y, W, 190, 30, n["lbg"])
    for i, a in enumerate(order):
        h = hues[CREATURES[a]]
        x = x0 + i * slot + (slot - 96) // 2 - 40
        frame_at(cv, frames[a], x, y + 30, 32, h.light_mark)
        text(cv, x + 110, y + 50, a, n["ltext"], 3)
        text(cv, x + 110, y + 82, f"{contrast(h.light_mark, n['lbg']):.1f}", h.light, 2)
    text(cv, x0 + 26, y + 150, "light appearance: each creature in its hue's light mark tone on #FBF9F5 (3:1 and up; text in the hue uses the 4.5:1 tone)", mix(n["lbg"], n["ltext"], 0.6), 2)
    return y + 190 + 44


def rotate_blit(dst: Canvas, src: Canvas, x: int, y: int, deg: float, key) -> None:
    """Blit `src` rotated about its centre, supersampled 2x2 so the edges stay smooth; `key`
    pixels are transparent."""
    a = math.radians(deg)
    ca, sa = math.cos(a), math.sin(a)
    w, h = src.w, src.h
    cx, cy = w / 2, h / 2
    pad = int(abs(sa) * max(w, h)) + 2
    kb = bytes(key)
    for yy in range(-pad, h + pad):
        ty = y + yy
        if not 0 <= ty < dst.h:
            continue
        for xx in range(-pad, w + pad):
            tx = x + xx
            if not 0 <= tx < dst.w:
                continue
            acc0 = acc1 = acc2 = cnt = 0
            for oy in (0.25, 0.75):
                for ox in (0.25, 0.75):
                    dx, dy = xx + ox - cx, yy + oy - cy
                    ix, iy = int(ca * dx + sa * dy + cx), int(-sa * dx + ca * dy + cy)
                    if 0 <= ix < w and 0 <= iy < h:
                        o = (iy * w + ix) * 3
                        px = src.px[o:o + 3]
                        if px != kb:
                            acc0 += px[0]
                            acc1 += px[1]
                            acc2 += px[2]
                            cnt += 1
            if cnt == 0:
                continue
            o = (ty * dst.w + tx) * 3
            b = dst.px[o:o + 3]
            dst.px[o:o + 3] = bytes(
                (round((acc0 + b[0] * (4 - cnt)) / 4), round((acc1 + b[1] * (4 - cnt)) / 4), round((acc2 + b[2] * (4 - cnt)) / 4))
            )


def card_face(n, hue: Hue, cid: str, w: int, h: int, key, cell: int) -> Canvas:
    """A Wrapped card at a reduced size: radius 28, the dashed inset, three dots, the two tone
    header over the top half, the question in the hue, the answer, one sentence."""
    cv = Canvas(w, h, key)
    s = w / 174  # sheet px per point of the 174 pt grid card
    r = int(28 * s)
    rr(cv, 0, 0, w, h, r, n["card"])
    inset = int(8 * s)
    dashed_rrect(cv, inset, inset, w - 2 * inset, h - 2 * inset, max(2, r - inset), n["border"], 4, 4, 1)
    dot = max(3, int(6 * s))
    for i in range(3):
        rr(cv, int(16 * s) + i * (dot + int(8 * s) - dot // 2), int(16 * s), dot, dot, dot // 2, n["faint"])
    top = int(30 * s)
    band_h = int(h * 0.5) - top
    pad = int(14 * s)
    bw = w - 2 * pad
    dither3(cv, n, pad, top, bw, band_h, cell, motif(cid, bw / band_h), hue.ink, hue.partner, None)
    qy = top + band_h + int(14 * s)
    lh = max(4, int(7 * s))
    cv.rect(pad + 2, qy, int(bw * 0.86), lh, hue.ink)
    cv.rect(pad + 2, qy + lh + int(6 * s), int(bw * 0.52), lh, hue.ink)
    ay = qy + 2 * lh + int(16 * s)
    rr(cv, pad + 2, ay, int(bw * 0.6), int(22 * s), 4, n["text"])
    sy = ay + int(22 * s) + int(12 * s)
    cv.rect(pad + 2, sy, int(bw * 0.9), max(3, int(5 * s)), n["dim"])
    cv.rect(pad + 2, sy + int(11 * s), int(bw * 0.58), max(3, int(5 * s)), n["dim"])
    return cv


def draw_cards(cv: Canvas, n, hues, x0, y0, W, archetype_hue: str) -> int:
    hs = card_hues(archetype_hue)
    per_row = 8
    gap = 26
    cw = (W - gap * (per_row - 1)) // per_row
    ch = cw * 4 // 3
    key = (255, 0, 255)
    tilt = [-1.5, 1, -0.5, 1.5]
    cell = max(3, round(3 * cw / 174))  # the in app 3 pt grain, at this card's scale
    y = y0
    for i, (cid, _, q) in enumerate(CARDS):
        row, col = divmod(i, per_row)
        hue = hues[hs[i]]
        face = card_face(n, hue, cid, cw, ch, key, cell)
        x = x0 + col * (cw + gap)
        yy = y + row * (ch + 110)
        rotate_blit(cv, face, x, yy, tilt[i % 4], key)
        text(cv, x + 4, yy + ch + 18, f"{i + 1:02d}", n["faint"], 3)
        text(cv, x + 4 + tw("00 ", 3), yy + ch + 18, hue.name, hue.ink, 3)
        text(cv, x + 4, yy + ch + 50, cid.replace("_", " "), n["dim"], 2)
    # the sixteenth slot: the deck as the two column grid, to show no hue meets itself
    x = x0 + 7 * (cw + gap)
    yy = y + (ch + 110) + 10
    s, g = 30, 8
    for i, h in enumerate(hs):
        c, r = i % 2, i // 2
        rr(cv, x + c * (s + g), yy + r * (s + g), s, s, 7, hues[h].ink)
    text(cv, x + 2 * (s + g) + 12, yy, "the grid,", n["dim"], 2)
    text(cv, x + 2 * (s + g) + 12, yy + 20, "two columns:", n["dim"], 2)
    text(cv, x + 2 * (s + g) + 12, yy + 40, "no hue meets", n["dim"], 2)
    text(cv, x + 2 * (s + g) + 12, yy + 60, "itself across", n["dim"], 2)
    text(cv, x + 2 * (s + g) + 12, yy + 80, "or down", n["dim"], 2)
    return y + 2 * (ch + 110) + 10


def draw_harness(cv: Canvas, n, hues, x0, y0, W) -> int:
    marks = load_marks(DEFAULT_SRC)
    gap = 20
    tile_w = (W - gap * (len(marks) - 1)) // len(marks)
    tile_h = 170
    y = y0
    for selected in (False, True):
        for i, m in enumerate(marks):
            h = hues[HARNESS[m.id]]
            x = x0 + i * (tile_w + gap)
            rr(cv, x, y, tile_w, tile_h, 30, h.ink if selected else n["raised"])
            frame_at(cv, m.frame, x + 18, y + 16, 32, n["onink"] if selected else h.ink)
            text(cv, x + 24, y + 16 + 96 + 10, m.name, n["onink"] if selected else n["text"], 3)
            text(cv, x + 24, y + 16 + 96 + 38, h.name, n["onink"] if selected else h.ink, 2)
        y += tile_h + 16
    y += 12
    cx = x0
    for m in marks:
        h = hues[HARNESS[m.id]]
        frame_at(cv, m.frame, cx, y, 16, h.ink)
        cx += 16 * D + 12
        cx += text(cv, cx, y + 14, m.name, n["dim"], 3) + 44
    return y + 16 * D + 40


def verdict_glyph(cv: Canvas, word: str, x, y, col, bg) -> None:
    """Pixel stand ins for VerdictGlyph.tsx: lines meeting, a loop with a head, an open ring."""
    if word == "converging":
        for k in range(3):
            cv.rect(x, y + 2 + k * 9, 20 - abs(k - 1) * 4, 4, col)
        cv.rect(x + 20, y + 11, 6, 4, col)
    elif word == "circling":
        rr(cv, x, y, 28, 28, 14, col)
        rr(cv, x + 5, y + 5, 18, 18, 9, bg)
        cv.rect(x + 18, y - 2, 10, 8, bg)
        cv.rect(x + 20, y - 1, 7, 5, col)
    else:
        for k in range(10):
            if k in (2,):
                continue
            a = k * math.pi / 5
            cv.rect(int(x + 12 + 12 * math.cos(a)), int(y + 12 + 12 * math.sin(a)), 5, 5, col)


HAND = [  # hand.raised, as eight by ten cells: the island's needs you mark, drawn for the sheet
    ".#.#.#..",
    ".#.#.#..",
    ".#.#.#.#",
    ".#.#.#.#",
    "########",
    "########",
    "#######.",
    ".######.",
    "..####..",
    "..####..",
]


def draw_mission(cv: Canvas, n, hues, x0, y0, W) -> int:
    """Every running session is its own builder: the crew, in mission control and on the island."""
    frames = frames_by_creature()
    tiles = [
        ("needs you", "Waiting for you to pick between two migrations.", "owl", "needs"),
        ("22m", "Rewriting the auth middleware, third try.", "fox", "circling"),
        ("41m", "Tests pass. Tidying the last two files.", "whale", "converging"),
        ("1h 04m", "Same failing import for six minutes.", "bee", "lost"),
    ]
    tw_, th_ = 522, 560
    gap = 36
    pad = 42
    amber = hues["amber"].ink
    y = y0
    for i, (top, sentence, creature, state) in enumerate(tiles):
        c, r = i % 2, i // 2
        x = x0 + c * (tw_ + gap)
        yy = y + r * (th_ + gap)
        hue = hues[CREATURES[creature]]
        rr(cv, x, yy, tw_, th_, 54, n["card"])
        if state == "needs":
            comet(cv, x + 2, yy + 2, tw_ - 4, th_ - 4, 52, 0.30, 0.24, amber, n["card"], 5)
        text(cv, x + pad, yy + pad, "builder", n["dim"], 3)
        text(cv, x + tw_ - pad - tw(top, 3), yy + pad, top, amber if state == "needs" else n["dim"], 3)
        for k, line in enumerate(wrap(sentence, 3, tw_ - 2 * pad)[:4]):
            text(cv, x + pad, yy + 112 + k * 40, line, n["text"], 3)
        if state != "needs":
            col = n[VERDICT[state]]
            verdict_glyph(cv, state, x + pad, yy + th_ - 196, col, n["card"])
            text(cv, x + pad + 46, yy + th_ - 192, state, col, 3)
        text(cv, x + pad, yy + th_ - 124, "14 files", n["text"], 3)
        text(cv, x + pad, yy + th_ - 86, "no ETA yet", n["dim"], 3)
        frame_at(cv, frames[creature], x + tw_ - 12 - 144, yy + th_ - 12 - 144, 48, hue.ink)
    # right: the island and the Lock Screen, in the top session's creature hue
    rx = x0 + 2 * (tw_ + gap) + 48
    iw = W - (rx - x0)
    hue = hues[CREATURES["owl"]]
    rr(cv, rx, y + 10, iw, 110, 55, (0, 0, 0))
    frame_at(cv, frames["owl"], rx + 34, y + 17, 32, hue.ink)
    text(cv, rx + iw - 40 - tw("12:14", 4), y + 48, "12:14", hue.ink, 4)
    text(cv, rx + 8, y + 140, "compact island: the creature and the timer wear the session's hue", n["dim"], 2)
    rr(cv, rx, y + 190, iw, 110, 55, (0, 0, 0))
    frame_at(cv, frames["owl"], rx + 34, y + 197, 32, hue.ink)
    hx = rx + iw - 40 - 8 * 5
    for gy, row in enumerate(HAND):
        for gx, ch in enumerate(row):
            if ch == "#":
                cv.rect(hx + gx * 5, y + 220 + gy * 5, 5, 5, amber)
    text(cv, rx + 8, y + 320, "needs you: the trailing mark is hand.raised, amber", n["dim"], 2)
    ly = y + 380
    rr(cv, rx, ly, iw, 300, 48, (0x14, 0x12, 0x10))
    dashed_rrect(cv, rx, ly, iw, 300, 48, n["border"], 1, 0, 2)
    cxr, cyr, R = rx + 120, ly + 150, 70
    for k in range(720):
        a = math.radians(k / 2 - 90)
        col = hue.ink if k < 500 else n["border"]
        for wd in range(15):
            rr_ = R - 7 + wd
            cv.rect(int(cxr + rr_ * math.cos(a)), int(cyr + rr_ * math.sin(a)), 2, 2, col)
    text(cv, cxr - tw("14", 4) // 2, cyr - 14, "14", n["text"], 4)
    tx = rx + 230
    text(cv, tx, ly + 56, "builder", n["text"], 3)
    text(cv, tx + tw("builder ", 3), ly + 56, "Claude Code", n["dim"], 3)
    for k, line in enumerate(wrap("Waiting for you to pick between two migrations.", 3, iw - 260)[:2]):
        text(cv, tx, ly + 104 + k * 36, line, n["text"], 3)
    text(cv, tx, ly + 210, "runs like this took about 40m", n["dim"], 2)
    text(cv, tx, ly + 236, "2 more running", n["dim"], 2)
    text(cv, rx + 8, ly + 320, "lock screen: the ring is elapsed over typical, in the session's hue", n["dim"], 2)
    # the widgets: small (the top session) and the medium's rows (one creature per session)
    wy = ly + 380
    ws = 400
    rr(cv, rx, wy, ws, ws, 60, n["card"])
    frame_at(cv, frames["owl"], rx + 40, wy + 40, 32, hue.ink)
    text(cv, rx + ws - 40 - tw("3", 3), wy + 52, "3", n["dim"], 3)
    text(cv, rx + 40, wy + 170, "22:14", n["text"], 6)
    for k, line in enumerate(wrap("Waiting for you to pick a migration.", 2, ws - 80)[:2]):
        text(cv, rx + 40, wy + 250 + k * 26, line, n["text"], 2)
    text(cv, rx + 40, wy + 330, "needs you", amber, 3)
    mx = rx + ws + 40
    mw = iw - ws - 40
    rr(cv, mx, wy, mw, ws, 60, n["card"])
    rows = [("owl", "builder", "22m", "needs you"), ("fox", "builder", "41m", "circling"), ("whale", "ridegt", "1h 04m", "converging")]
    for k, (cr, repo, el, st) in enumerate(rows):
        ry = wy + 44 + k * 118
        frame_at(cv, frames[cr], mx + 36, ry, 16, hues[CREATURES[cr]].ink)
        text(cv, mx + 36 + 48 + 18, ry + 2, repo, n["text"], 3)
        text(cv, mx + mw - 36 - tw(el, 3), ry + 2, el, n["dim"], 3)
        stc = amber if st == "needs you" else n[VERDICT[st]]
        text(cv, mx + 36 + 48 + 18, ry + 40, st, stc, 2)
        if k < 2:
            cv.rect(mx + 36, ry + 84, mw - 72, 2, n["border"])
    text(cv, rx + 8, wy + ws + 20, "widgets: the creature marks the session; state words keep their own colours", n["dim"], 2)
    return max(y + 2 * (th_ + gap), wy + ws + 60)


def fnv1a32(s: str) -> int:
    """FNV-1a, 32 bit, over the UTF-8 bytes: the hash `crew_creature` and `crew.ts` share."""
    h = 0x811C9DC5
    for b in s.encode("utf-8"):
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return h


def crew_v2(rows: list[tuple[str, float, float]]) -> list[str]:
    """ring[fnv1a32(id) % 8], stepped forward past any creature a session running at its start
    already wears (DESIGN-V2 2.2). `rows` are (client_session_id, start, end), oldest first."""
    out: list[str] = []
    for i, (sid, start, _) in enumerate(rows):
        worn = {out[j] for j in range(i) if rows[j][2] > start}
        k = fnv1a32(sid) % len(CREW)
        pick = next((CREW[(k + s) % len(CREW)] for s in range(len(CREW)) if CREW[(k + s) % len(CREW)] not in worn), CREW[k])
        out.append(pick)
    return out


def crew_v1(rows: list[tuple[str, float, float]], own: str) -> list[str]:
    """The rule the judges measured: yours when alone, else the first free crew member."""
    out: list[str] = []
    for i, (_, start, _) in enumerate(rows):
        running = [j for j in range(i) if rows[j][2] > start]
        taken = {out[j] for j in running}
        out.append(own if not running else next((c for c in CREW if c != own and c not in taken), CREW[0]))
    return out


def draw_crew_rows(cv: Canvas, n, hues, x0, y0, W) -> int:
    """The Sessions list, newest first, under both rules: the same synthetic week, most sittings
    alone and a few running together, the way this machine's 354 are (70% alone)."""
    import hashlib

    frames = frames_by_creature()
    rows, t = [], 0.0
    for i in range(24):
        sid = hashlib.sha256(f"session {i}".encode()).hexdigest()
        together = i % 7 in (3, 4)  # two of every seven start while another runs
        start = t - 40 if together else t
        rows.append((sid, start, start + 80))
        t += 100
    y = y0 + 8
    step = 16 * D + 22
    for label, worn in (("yours when alone (v1)", crew_v1(rows, "crab")), ("a hash of the session (v2)", crew_v2(rows))):
        text(cv, x0, y + 14, label, n["dim"], 3)
        cx = x0 + 560
        for a in reversed(worn):
            frame_at(cv, frames[a], cx, y, 16, hues[CREATURES[a]].ink)
            cx += step
        y += 16 * D + 30
    cap = "measured on this machine's 354 sessions: v1 put 70% in coral with a run of 19; v2 gives each creature 10 to 16% and the longest run is 4"
    text(cv, x0, y + 4, cap, n["faint"], 2)
    return y + 60


def draw_semantics(cv: Canvas, n, hues, x0, y0, W) -> int:
    """States and data (the colours that are NOT identity), the dimensions, the archetypes."""
    y = y0
    x = x0
    text(cv, x, y, "needs you", hues["amber"].ink, 3)
    x += tw("needs you", 3) + 70
    for word, key in VERDICT.items():
        col = n[key]
        verdict_glyph(cv, word, x, y - 6, col, n["bg"])
        x += 46
        x += text(cv, x, y, word, col, 3) + 60
    x += 20
    x += text(cv, x, y, "+420", n["add"], 3) + 20
    x += text(cv, x, y, "-88", n["del"], 3) + 26
    text(cv, x, y + 4, "lines added and removed stay green and red", n["dim"], 2)
    y += 70
    bw = (W - 4 * 48) // 5
    for i, (dname, hue) in enumerate(DIMENSIONS.items()):
        h = hues[hue]
        bx = x0 + i * (bw + 48)
        text(cv, bx, y, dname, n["dim"], 2)
        v = [72, 58, 81, 44, 63][i]
        text(cv, bx + bw - tw(str(v), 3), y - 4, str(v), n["text"], 3)
        rr(cv, bx, y + 26, bw, 14, 7, n["border"])
        rr(cv, bx, y + 26, int(bw * v / 100), 14, 7, h.ink)
    y += 84
    frames = frames_by_creature()
    per_row = 5
    colw = W // per_row
    for i, (arch, creature) in enumerate(ARCHETYPE_CREATURE.items()):
        h = hues[CREATURES[creature]]
        c, r = i % per_row, i // per_row
        x = x0 + c * colw
        yy = y + r * 72
        frame_at(cv, frames[creature], x, yy, 16, h.ink)
        text(cv, x + 16 * D + 14, yy + 14, arch, h.ink, 3)
    return y + 2 * 72 + 20


# ─────────────────────────────────────────────────────────────────────────────────── main


def render(tokens: Path, path: Path, archetype: str = "crab") -> list[str]:
    n = neutrals(tokens)
    n["human"] = parse_hex(json.loads(tokens.read_text())["strip"]["human_edit"]["dark"])
    n["claude"] = parse_hex("#D97757")
    hues = load_hues(n)
    W, M = 2400, 80
    cv = Canvas(W, 6800, n["bg"])
    inner = W - 2 * M
    y = 72
    text(cv, M, y, "BUILDA", n["text"], 8, cased=False)
    text(cv, M + tw("BUILDA ", 8), y, "COLOUR", hues["amber"].ink, 8, cased=False)
    ax = M + tw("BUILDA COLOUR ", 8)
    for i, name in enumerate(hues):
        rr(cv, ax + i * 34, y + 8, 26, 40, 8, hues[name].ink)
    y += 90
    text(cv, M, y, "nine hues on the warm dark ground. amber stays the brand and the primary action.", n["dim"], 3)
    y += 32
    text(cv, M, y, "red and green are left empty on purpose: those hues are data, never identity.", n["dim"], 3)
    y += 80
    y = section_title(cv, n, M, y, "01", "THE SPECTRUM", "each hue as a fill with ink on it, its three level dither (paper, partner, ink), contrast on #141210 and #1E1B18, its light variant on #FBF9F5")
    y = draw_hue_line(cv, n, hues, M, y, inner)
    y = draw_spectrum(cv, n, hues, M, y, inner)
    y = section_title(cv, n, M, y, "02", "THE CREATURES", "one ink each, just not all the same ink. 64 pt at @3x, then the picker at 32 pt: idle, and selected (the hue is the fill, ink on it)")
    y = draw_creatures(cv, n, hues, M, y, inner)
    y = section_title(cv, n, M, y, "03", "THE FIFTEEN CARDS", f"story order, three level header in the card's hue. card one wears the archetype's creature hue (here the {archetype}'s, {CREATURES[archetype]})")
    y = draw_cards(cv, n, hues, M, y, inner, CREATURES[archetype])
    y = section_title(cv, n, M, y, "04", "THE HARNESSES", "never the vendor's own colour, never amber. idle on raised, then selected")
    y = draw_harness(cv, n, hues, M, y, inner)
    y = section_title(cv, n, M, y, "05", "EVERY SESSION ITS OWN BUILDER", "a session wears the creature a hash of its id picks, stepped past any creature already running. no session is ever bit, so amber means needs you")
    y = draw_mission(cv, n, hues, M, y, inner)
    y = draw_crew_rows(cv, n, hues, M, y, inner)
    y = section_title(cv, n, M, y, "06", "STATES, DATA, DIMENSIONS, ARCHETYPES", "verdicts borrow the data colours (circling is textdim); each dimension wears the hue of the archetype that reads it; an archetype wears its creature's")
    y = draw_semantics(cv, n, hues, M, y, inner)
    out = crop_to(cv, y + 40)
    out.save(path)
    return check_cards()


def crop_to(cv: Canvas, h: int) -> Canvas:
    h = min(h, cv.h)
    out = Canvas(cv.w, h, (0, 0, 0))
    out.px[:] = cv.px[: cv.w * h * 3]
    return out


def table(tokens: Path) -> None:
    n = neutrals(tokens)
    for name, h in load_hues(n).items():
        r = h.row(n)
        L, C, H = oklch_of(h.ink)
        print(
            f"{name:8s} {r['ink']}  oklch {L:.3f} {C:.3f} {H:5.1f}  bg {r['on_bg']:5.2f}  card {r['on_card']:5.2f}  "
            f"ink-on {r['ink_on']:5.2f}  partner {r['partner']} {r['partner_on_card']:.2f}/{contrast(h.partner, n['bg']):.2f}  "
            f"lightText {r['light']} {r['light_on_lbg']:.2f}/{r['light_on_white']:.2f}  lightMark {r['light_mark']} {r['light_mark_on_lbg']:.2f}  lpartner {r['light_partner']}"
        )


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--tokens", type=Path, default=DEFAULT_TOKENS)
    ap.add_argument("--name", default="palette")
    ap.add_argument("--archetype", default="crab", help="the creature whose hue card one wears on the sheet")
    ap.add_argument("--table", action="store_true")
    args = ap.parse_args(argv)
    path = OUT / f"{args.name}.png"
    problems = render(args.tokens, path, args.archetype)
    print(path)
    if args.table:
        table(args.tokens)
    for p in problems:
        print("CARDS:", p, file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
