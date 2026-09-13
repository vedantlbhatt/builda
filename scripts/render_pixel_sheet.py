#!/usr/bin/env python3
"""
Contact sheets for Builder's pixel identity: Bit (`sprites.ts`) and the creature pack
(`animals.ts`), drawn from the TypeScript sources themselves, so a sheet can never show a
frame, a colour or a timing the app does not.

What is read, and from where:
  frames.ts    GRID, GLYPHS (the encoding: 16 rows of 16 chars, '.' transparent, every other
               char a palette ROLE resolved per scheme)
  sprites.ts   SPRITE_STATES, SPRITES and every `const NAME: Frame = [...]` they name
  animals.ts   ANIMALS, ANIMAL_LABELS, ANIMAL_FRAMES and the `const CRAB: Frame[]` they name
  palette.ts   GLYPH_INK, the one ink per scheme and tone (rest, selected, faint) that every
               role of Bit and every creature resolves to. An older `--src` with per-animal
               ANIMAL_COLOURS recipes and BODY_DARK_FACTOR still renders (the 00-current sheets)
  motion.ts    ANIMAL_MOTION (beat, holds) and MOTION.idle (Bit's loop), for timings
  design/tokens.json   the colours every role and hue resolves to

Sheets (all on the scheme's `bg`, PNG, stdlib only: zlib + struct, no Pillow):
  <prefix>-bit.png          every Bit state, every drawn frame at --scale, with the cells that
                            changed entering each frame, and frame 0 at 16/32/48/64 pt @3x
  <prefix>-<animal>.png     one per creature: every loop frame at --scale, per-frame change
                            count and hold, a motion map, true sizes, palette and contrast
  <prefix>-pack.png         the whole pack, every frame, one row per creature
  <prefix>-alignment.png    frame 0 of all nine on the 16x16 grid with the 12x12 live area,
                            each bounding box and baseline, and the overlap of all nine
  <prefix>-picker.png       all nine at 64 pt side by side on picker tiles, then 32 and 16 pt,
                            the selected (amber fill) tile of DESIGN-DIRECTION 5, and light
  <prefix>.png (round)      ONE sheet per redraw round: all nine at 64 and 32 pt on the tile,
                            16 pt inline, the selected tile, a textFaint carousel, the light
                            scheme, every loop frame as played with the changed cells boxed,
                            the runtime blink, and the family rules measured (red = broken)

Only 16, 32, 48 and 64 pt are drawn as "true size": at @3x those are 3, 6, 9 and 12 device
pixels per cell, whole pixels, which is DESIGN-DIRECTION 5's rule. Nearest neighbour only.

  python3 scripts/render_pixel_sheet.py                         the current pack, 00-current-*
  python3 scripts/render_pixel_sheet.py --metrics               also print the audit numbers
  python3 scripts/render_pixel_sheet.py --src some/dir --prefix 01-proposal
                                                                render a candidate pixel dir
  python3 scripts/render_pixel_sheet.py --check                 cross-check the parsed palette
                                                                against bun evaluating palette.ts
  python3 scripts/render_pixel_sheet.py --sheets round --prefix 10-creatures-round5 --rules
                                                                one round sheet, and the family rules
                                                                (animals.ts 1-7) printed; exit 1 on
                                                                any break
  python3 scripts/render_pixel_sheet.py --glyphs 5              the harness glyphs (harness.ts
                                                                HARNESS_MARKS): 20-glyphs-round5.png,
                                                                the family rules printed, exit 1
                                                                on a break
  python3 scripts/render_pixel_sheet.py --sheets round --prefix 30-final-creatures --loop-cell 12 --rules
  python3 scripts/render_pixel_sheet.py --glyphs 6 --name 31-final-glyphs
                                                                the final sheets: loop frames at 12 px
                                                                a cell, the amber hero at true 64 pt,
                                                                idle and selected tiles at 32 pt, and
                                                                creature and harness tiles as one picker.
                                                                The rules read PACK_EXCEPTIONS from
                                                                animals.ts (the whale, the bee)
"""

from __future__ import annotations

import argparse
import json
import math
import re
import shutil
import struct
import subprocess
import sys
import zlib
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SRC = ROOT / "mobile" / "src" / "pixel"
DEFAULT_TOKENS = ROOT / "design" / "tokens.json"
DEFAULT_OUT = ROOT / "shots" / "identity"

EMPTY = "."
PT_SIZES = (16, 32, 48, 64)
DEVICE = 3  # @3x
LIVE = (2, 13)  # the proposed 12x12 live area, inclusive cell range on both axes

RGB = tuple  # (r, g, b)


# ─────────────────────────────────────────────────────────────── a tiny TS literal reader


class ParseError(SystemExit):
    pass


@dataclass(frozen=True)
class Ident:
    name: str


class Reader:
    """Just enough of a TS reader to walk array and object literals of strings, numbers,
    identifiers and nested literals, skipping comments and `as Type` casts. A regex over
    quotes would also match a quote inside a comment, and these files are full of them."""

    IDENT = re.compile(r"[A-Za-z_$][\w$]*")
    NUMBER = re.compile(r"-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")

    def __init__(self, src: str, pos: int, where: str):
        self.s, self.i, self.where = src, pos, where

    def fail(self, msg: str) -> ParseError:
        line = self.s.count("\n", 0, self.i) + 1
        return ParseError(f"{self.where}:{line}: {msg}")

    def skip(self) -> None:
        s = self.s
        while self.i < len(s):
            c = s[self.i]
            if c in " \t\r\n":
                self.i += 1
            elif s.startswith("//", self.i):
                nl = s.find("\n", self.i)
                self.i = len(s) if nl < 0 else nl + 1
            elif s.startswith("/*", self.i):
                end = s.find("*/", self.i + 2)
                if end < 0:
                    raise self.fail("unterminated block comment")
                self.i = end + 2
            else:
                return

    def peek(self) -> str:
        self.skip()
        return self.s[self.i] if self.i < len(self.s) else ""

    def expect(self, ch: str) -> None:
        if self.peek() != ch:
            raise self.fail(f"expected {ch!r}, found {self.peek()!r}")
        self.i += 1

    def string(self) -> str:
        q = self.s[self.i]
        out = []
        self.i += 1
        while self.i < len(self.s):
            c = self.s[self.i]
            if c == "\\":
                out.append(self.s[self.i + 1])
                self.i += 2
                continue
            if c == q:
                self.i += 1
                return "".join(out)
            if q == "`" and self.s.startswith("${", self.i):
                raise self.fail("template interpolation inside a literal")
            out.append(c)
            self.i += 1
        raise self.fail("unterminated string")

    def ident(self) -> str:
        m = self.IDENT.match(self.s, self.i)
        if not m:
            raise self.fail(f"expected a value, found {self.s[self.i:self.i + 16]!r}")
        self.i = m.end()
        return m.group(0)

    def cast(self) -> None:
        """Skip a trailing `as Type` (or `as const`) up to the next top-level , ] or }."""
        self.skip()
        if not re.match(r"as\b", self.s[self.i:self.i + 3]):
            return
        self.i += 2
        depth = 0
        while self.i < len(self.s):
            c = self.s[self.i]
            if c in "<([{":
                depth += 1
            elif c in ">)]}":
                if depth == 0:
                    return
                depth -= 1
            elif c == "," and depth == 0:
                return
            self.i += 1

    def value(self):
        c = self.peek()
        if c in "'\"`":
            v = self.string()
        elif c == "[":
            v = self.array()
        elif c == "{":
            v = self.obj()
        elif c == "-" or c == "." or c.isdigit():
            m = self.NUMBER.match(self.s, self.i)
            if not m:
                raise self.fail("bad number")
            self.i = m.end()
            v = float(m.group(0)) if any(ch in m.group(0) for ch in ".eE") else int(m.group(0))
        else:
            name = self.ident()
            v = {"null": None, "undefined": None, "true": True, "false": False}.get(name, Ident(name))
        self.cast()
        return v

    def array(self) -> list:
        self.expect("[")
        out = []
        while self.peek() != "]":
            out.append(self.value())
            if self.peek() == ",":
                self.i += 1
            elif self.peek() != "]":
                raise self.fail(f"expected ',' or ']', found {self.peek()!r}")
        self.i += 1
        return out

    def obj(self) -> dict:
        self.expect("{")
        out = {}
        while self.peek() != "}":
            key = self.string() if self.peek() in "'\"" else self.ident()
            self.expect(":")
            out[key] = self.value()
            if self.peek() == ",":
                self.i += 1
            elif self.peek() != "}":
                raise self.fail(f"expected ',' or '}}', found {self.peek()!r}")
        self.i += 1
        return out


def literal(path: Path, name: str, required: bool = True):
    """The literal assigned by `const <name>` (exported or not, any type annotation)."""
    src = path.read_text()
    m = re.search(rf"(?:^|\n)\s*(?:export\s+)?const\s+{re.escape(name)}\b[^=\n]*=", src)
    if not m:
        if required:
            raise ParseError(f"{path.name}: no `const {name} =`")
        return None
    return Reader(src, m.end(), path.name).value()


def resolve(path: Path, v):
    """Follow identifiers to their own `const` literal, recursively."""
    if isinstance(v, Ident):
        return resolve(path, literal(path, v.name))
    if isinstance(v, list):
        return [resolve(path, x) for x in v]
    return v


def return_block(path: Path, fn: str) -> dict[str, str]:
    """`key: expression` pairs of the object literal a function returns, as source text."""
    src = path.read_text()
    m = re.search(rf"function\s+{re.escape(fn)}\s*\(", src)
    if not m:
        raise ParseError(f"{path.name}: no function {fn}")
    r = src.find("return {", m.end())
    if r < 0:
        raise ParseError(f"{path.name}: {fn} returns no object literal")
    i, depth = r + len("return "), 0
    for j in range(i, len(src)):
        if src[j] == "{":
            depth += 1
        elif src[j] == "}":
            depth -= 1
            if depth == 0:
                body = src[i + 1:j]
                break
    else:
        raise ParseError(f"{path.name}: unterminated return in {fn}")
    out = {}
    for line in body.splitlines():
        line = re.sub(r"//.*", "", line).strip()
        mm = re.match(r"(\w+)\s*:\s*(.+?),?$", line)
        if mm:
            out[mm.group(1)] = mm.group(2)
    return out


# ───────────────────────────────────────────────────────────────────── colour, as palette.ts


def parse_hex(v: str) -> RGB:
    v = v.lstrip("#")
    return (int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16))


def to_hex(c: RGB) -> str:
    return "#%02X%02X%02X" % c


def js_round(x: float) -> int:
    return math.floor(x + 0.5)


def scale(c: RGB, f: float) -> RGB:
    return tuple(max(0, min(255, js_round(ch * f))) for ch in c)


def mix(a: RGB, b: RGB, t: float) -> RGB:
    k = max(0.0, min(1.0, t))
    return tuple(js_round(a[i] * (1 - k) + b[i] * k) for i in range(3))


def luminance(c: RGB) -> float:
    def ch(v: int) -> float:
        s = v / 255
        return s / 12.92 if s <= 0.03928 else ((s + 0.055) / 1.055) ** 2.4

    return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2])


def contrast(a: RGB, b: RGB) -> float:
    hi, lo = sorted((luminance(a), luminance(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def load_colours(tokens: Path, scheme: str) -> dict[str, RGB]:
    t = json.loads(tokens.read_text())
    out: dict[str, RGB] = {}
    for group in ("surface", "strip"):
        for k, v in t.get(group, {}).items():
            if isinstance(v, dict) and scheme in v:
                out[f"{group}.{k}"] = parse_hex(v[scheme])
    return out


def split_args(s: str) -> list[str]:
    out, depth, cur = [], 0, []
    for ch in s:
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        if ch == "," and depth == 0:
            out.append("".join(cur).strip())
            cur = []
        else:
            cur.append(ch)
    if "".join(cur).strip():
        out.append("".join(cur).strip())
    return out


def eval_colour(expr: str, c: dict[str, RGB], consts: dict[str, float]):
    """The handful of expressions palette.ts builds colours from: `c.accent`,
    `c.strip[StripClass.human_edit]`, `scale(e, f)`, `mix(e, e, t)`, numbers, constants."""
    e = expr.strip()
    m = re.fullmatch(r"(scale|mix)\((.*)\)", e, re.S)
    if m:
        args = split_args(m.group(2))
        vals = [eval_colour(a, c, consts) for a in args]
        return scale(vals[0], vals[1]) if m.group(1) == "scale" else mix(vals[0], vals[1], vals[2])
    m = re.fullmatch(r"c\.strip\[StripClass\.(\w+)\]", e)
    if m:
        return c[f"strip.{m.group(1)}"]
    m = re.fullmatch(r"c\.(\w+)", e)
    if m:
        return c[f"surface.{m.group(1)}"]
    if re.fullmatch(r"-?[\d.]+", e):
        return float(e)
    if e in consts:
        return consts[e]
    raise ParseError(f"palette.ts: cannot evaluate {expr!r}")


@dataclass
class Palettes:
    scheme: str
    c: dict[str, RGB]
    bit: dict[str, RGB]
    animals: dict[str, dict[str, RGB]]
    recipes: dict[str, dict]
    # The one-ink palette (GLYPH_INK in palette.ts): the ink per tone, 'rest', 'selected' and
    # 'dim'. None for the older per-animal recipe palettes.
    tones: dict[str, RGB] | None = None

    @property
    def bg(self) -> RGB:
        return self.c["surface.bg"]

    def toned(self, p: dict[str, RGB], tone: str) -> dict[str, RGB]:
        """`p` redrawn in another tone: every role in the one ink of `tone`."""
        if not self.tones:
            return p
        return {k: self.tones[tone] for k in p}


def ink_token(c: dict[str, RGB], tokens: Path, name: str) -> RGB:
    """A GLYPH_INK token name to a colour. `onAccent` is the light scheme's text in BOTH
    schemes (theme.ts derives it, it is not a token of its own)."""
    if name == "onAccent":
        return parse_hex(json.loads(tokens.read_text())["surface"]["text"]["light"])
    return c[f"surface.{name}"]


def load_palettes(src: Path, tokens: Path, scheme: str, animals: list[str]) -> Palettes:
    c = load_colours(tokens, scheme)
    palette_ts = src / "palette.ts"
    ink_table = literal(palette_ts, "GLYPH_INK", required=False)
    if isinstance(ink_table, dict):
        # One ink for the whole family: every Bit role and every animal's one role resolve to
        # the scheme's rest ink; the tones are what a selected tile and a dimmed neighbour use.
        tones = {t: ink_token(c, tokens, v) for t, v in ink_table[scheme].items()}
        glyphs = literal(src / "frames.ts", "GLYPHS")
        bit = {g: tones["rest"] for g in glyphs}
        pals = {a: {"b": tones["rest"]} for a in animals}
        recipes = {a: {"ink": ink_table[scheme]["rest"]} for a in animals}
        return Palettes(scheme, c, bit, pals, recipes, tones)
    consts = {}
    f = literal(palette_ts, "BODY_DARK_FACTOR", required=False)
    if isinstance(f, (int, float)):
        consts["BODY_DARK_FACTOR"] = float(f)
    bit = {k: eval_colour(v, c, consts) for k, v in return_block(palette_ts, "spritePalette").items()}
    hues = {k: eval_colour(v, c, consts) for k, v in return_block(palette_ts, "hues").items()}
    recipes = literal(palette_ts, "ANIMAL_COLOURS")

    def cook(r: dict) -> RGB:
        out = hues[r["hue"]]
        if r.get("toward"):
            out = mix(out, hues[r["toward"]["hue"]], r["toward"]["t"])
        if r.get("by") is not None:
            out = scale(out, r["by"])
        return out

    pals = {a: {"b": cook(recipes[a]["body"]), "d": cook(recipes[a]["accent"])} for a in animals}
    return Palettes(scheme, c, bit, pals, recipes)


def check_with_bun(src: Path, pal: Palettes, animals: list[str]) -> list[str]:
    """Evaluate palette.ts with bun and compare. A parser that drifts from the TypeScript is a
    sheet that shows a colour the app does not, which is the one thing a contact sheet is for."""
    bun = shutil.which("bun")
    if not bun:
        return ["bun not on PATH: palette not cross-checked"]
    mobile = src.parent.parent
    rel = "./" + str((src / "palette.ts").relative_to(mobile))
    js = (
        f"import {{ animalPalette, spritePalette }} from '{rel}';"
        f"const a = {json.dumps(animals)};"
        f"console.log(JSON.stringify({{ bit: spritePalette('{pal.scheme}'),"
        f" animals: Object.fromEntries(a.map((x) => [x, animalPalette(x, '{pal.scheme}')])) }}));"
    )
    out = subprocess.run([bun, "-e", js], cwd=mobile, capture_output=True, text=True, timeout=60)
    if out.returncode != 0:
        return [f"bun failed: {out.stderr.strip()[:300]}"]
    truth = json.loads(out.stdout)
    problems = []
    for k, v in truth["bit"].items():
        if to_hex(pal.bit[k]) != v.upper():
            problems.append(f"bit.{k}: parsed {to_hex(pal.bit[k])}, bun {v}")
    for a, p in truth["animals"].items():
        for k, v in p.items():
            if to_hex(pal.animals[a][k]) != v.upper():
                problems.append(f"{a}.{k}: parsed {to_hex(pal.animals[a][k])}, bun {v}")
    return problems


# ─────────────────────────────────────────────────────────────────────────────── the pack


@dataclass
class Pack:
    grid: int
    glyphs: set
    animals: list[str]
    labels: dict[str, str]
    animal_frames: dict[str, list[list[str]]]
    states: list[str]
    bit: dict[str, list[list[str]]]
    motion: dict
    bit_motion: dict | None = None  # motion.ts MOTION, for Bit's idle loop (MOTION.idle)


def load_pack(src: Path) -> Pack:
    frames_ts, sprites_ts, animals_ts = src / "frames.ts", src / "sprites.ts", src / "animals.ts"
    grid = literal(frames_ts, "GRID")
    glyphs = set(literal(frames_ts, "GLYPHS"))
    animals = literal(animals_ts, "ANIMALS")
    table = literal(animals_ts, "ANIMAL_FRAMES")
    animal_frames = {a: resolve(animals_ts, table[a]) for a in animals}
    labels = literal(animals_ts, "ANIMAL_LABELS", required=False) or {a: a for a in animals}
    states = literal(sprites_ts, "SPRITE_STATES")
    stable = literal(sprites_ts, "SPRITES")
    bit = {s: resolve(sprites_ts, stable[s]) for s in states}
    try:
        motion = literal(src / "motion.ts", "ANIMAL_MOTION", required=False) or {}
    except ParseError:
        motion = {}
    try:
        bit_motion = literal(src / "motion.ts", "MOTION", required=False) or {}
    except ParseError:
        bit_motion = {}
    pack = Pack(grid, glyphs, animals, labels, animal_frames, states, bit, motion, bit_motion)
    problems = []
    for name, frames in [*animal_frames.items(), *(("bit." + s, f) for s, f in bit.items())]:
        for i, f in enumerate(frames):
            if len(f) != grid or any(len(r) != grid for r in f):
                problems.append(f"{name}[{i}] is not {grid}x{grid}")
            bad = {ch for r in f for ch in r if ch != EMPTY and ch not in glyphs}
            if bad:
                problems.append(f"{name}[{i}] unknown glyphs {sorted(bad)}")
    if problems:
        raise ParseError("\n".join(problems))
    return pack


# ──────────────────────────────────────────────────────────────────────────────── metrics


def cells(frame) -> list[tuple[int, int, str]]:
    return [(x, y, ch) for y, row in enumerate(frame) for x, ch in enumerate(row) if ch != EMPTY]


def diff(a, b) -> int:
    return sum(1 for y in range(len(a)) for x in range(len(a[y])) if a[y][x] != b[y][x])


def changed_cells(a, b) -> set[tuple[int, int]]:
    return {(x, y) for y in range(len(a)) for x in range(len(a[y])) if a[y][x] != b[y][x]}


def components(pts: set[tuple[int, int]], eight: bool) -> list[set[tuple[int, int]]]:
    steps = [(1, 0), (-1, 0), (0, 1), (0, -1)]
    if eight:
        steps += [(1, 1), (1, -1), (-1, 1), (-1, -1)]
    todo, out = set(pts), []
    while todo:
        start = todo.pop()
        group, stack = {start}, [start]
        while stack:
            x, y = stack.pop()
            for dx, dy in steps:
                q = (x + dx, y + dy)
                if q in todo:
                    todo.remove(q)
                    group.add(q)
                    stack.append(q)
        out.append(group)
    return out


@dataclass
class FrameStats:
    filled: int
    by_glyph: dict[str, int]
    bbox: tuple[int, int, int, int]  # x0, y0, x1, y1 inclusive
    islands4: int
    islands8: int
    holes: int  # transparent cells enclosed by the silhouette (4-connected to nothing outside)
    edges: int  # adjacent cell pairs that differ, the frame border counted as '.'
    runs: int  # same-glyph runs of drawn cells, summed over rows
    asym: int  # cells that differ from the mirror image, over one half
    outside_live: int
    com: tuple[float, float]

    @property
    def w(self) -> int:
        return self.bbox[2] - self.bbox[0] + 1

    @property
    def h(self) -> int:
        return self.bbox[3] - self.bbox[1] + 1


def frame_stats(frame) -> FrameStats:
    g = len(frame)
    drawn = cells(frame)
    pts = {(x, y) for x, y, _ in drawn}
    by: dict[str, int] = {}
    for _, _, ch in drawn:
        by[ch] = by.get(ch, 0) + 1
    xs = [x for x, _ in pts] or [0]
    ys = [y for _, y in pts] or [0]
    # holes: flood the transparent cells from outside the grid
    outside, stack = set(), [(-1, -1)]
    while stack:
        x, y = stack.pop()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            q = (x + dx, y + dy)
            if -1 <= q[0] <= g and -1 <= q[1] <= g and q not in outside and q not in pts:
                outside.add(q)
                stack.append(q)
    holes = sum(1 for y in range(g) for x in range(g) if (x, y) not in pts and (x, y) not in outside)

    def at(x, y):
        return frame[y][x] if 0 <= x < g and 0 <= y < g else EMPTY

    edges = 0
    for y in range(-1, g):
        for x in range(-1, g):
            if at(x, y) != at(x + 1, y) and (0 <= y < g):
                edges += 1
            if at(x, y) != at(x, y + 1) and (0 <= x < g):
                edges += 1
    runs = 0
    for row in frame:
        prev = EMPTY
        for ch in row:
            if ch != EMPTY and ch != prev:
                runs += 1
            prev = ch
    asym = sum(1 for y in range(g) for x in range(g // 2) if frame[y][x] != frame[y][g - 1 - x])
    lo, hi = LIVE
    outside_live = sum(1 for x, y in pts if not (lo <= x <= hi and lo <= y <= hi))
    n = max(1, len(pts))
    com = (sum(x for x, _ in pts) / n, sum(y for _, y in pts) / n)
    return FrameStats(
        filled=len(pts),
        by_glyph=by,
        bbox=(min(xs), min(ys), max(xs), max(ys)),
        islands4=len(components(pts, eight=False)),
        islands8=len(components(pts, eight=True)),
        holes=holes,
        edges=edges,
        runs=runs,
        asym=asym,
        outside_live=outside_live,
        com=com,
    )


@dataclass
class LoopStats:
    frames: int
    steps: list[int]  # cells changed entering frame i (from frame i-1, wrapping)
    footprint: int  # distinct cells that change at least once across the loop
    filled_min: int
    filled_max: int

    @property
    def worst(self) -> int:
        return max(self.steps) if self.steps else 0

    @property
    def mean(self) -> float:
        return sum(self.steps) / len(self.steps) if self.steps else 0.0


def loop_stats(frames) -> LoopStats:
    n = len(frames)
    steps = [diff(frames[i - 1], frames[i]) for i in range(n)] if n > 1 else [0]
    foot: set = set()
    for i in range(n):
        foot |= changed_cells(frames[i - 1], frames[i])
    filled = [frame_stats(f).filled for f in frames]
    return LoopStats(n, steps, len(foot), min(filled), max(filled))


# ─────────────────────────────────────────────────────────────────────── a 5x7 bitmap font

_FONT_SRC = {
    "A": ".###.|#...#|#...#|#####|#...#|#...#|#...#",
    "B": "####.|#...#|#...#|####.|#...#|#...#|####.",
    "C": ".###.|#...#|#....|#....|#....|#...#|.###.",
    "D": "####.|#...#|#...#|#...#|#...#|#...#|####.",
    "E": "#####|#....|#....|####.|#....|#....|#####",
    "F": "#####|#....|#....|####.|#....|#....|#....",
    "G": ".###.|#...#|#....|#.###|#...#|#...#|.####",
    "H": "#...#|#...#|#...#|#####|#...#|#...#|#...#",
    "I": ".###.|..#..|..#..|..#..|..#..|..#..|.###.",
    "J": "..###|...#.|...#.|...#.|...#.|#..#.|.##..",
    "K": "#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#",
    "L": "#....|#....|#....|#....|#....|#....|#####",
    "M": "#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#",
    "N": "#...#|#...#|##..#|#.#.#|#..##|#...#|#...#",
    "O": ".###.|#...#|#...#|#...#|#...#|#...#|.###.",
    "P": "####.|#...#|#...#|####.|#....|#....|#....",
    "Q": ".###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#",
    "R": "####.|#...#|#...#|####.|#.#..|#..#.|#...#",
    "S": ".####|#....|#....|.###.|....#|....#|####.",
    "T": "#####|..#..|..#..|..#..|..#..|..#..|..#..",
    "U": "#...#|#...#|#...#|#...#|#...#|#...#|.###.",
    "V": "#...#|#...#|#...#|#...#|#...#|.#.#.|..#..",
    "W": "#...#|#...#|#...#|#.#.#|#.#.#|#.#.#|.#.#.",
    "X": "#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#",
    "Y": "#...#|#...#|.#.#.|..#..|..#..|..#..|..#..",
    "Z": "#####|....#|...#.|..#..|.#...|#....|#####",
    "0": ".###.|#...#|#..##|#.#.#|##..#|#...#|.###.",
    "1": "..#..|.##..|..#..|..#..|..#..|..#..|.###.",
    "2": ".###.|#...#|....#|...#.|..#..|.#...|#####",
    "3": "####.|....#|....#|.###.|....#|....#|####.",
    "4": "...#.|..##.|.#.#.|#..#.|#####|...#.|...#.",
    "5": "#####|#....|####.|....#|....#|#...#|.###.",
    "6": "..##.|.#...|#....|####.|#...#|#...#|.###.",
    "7": "#####|....#|...#.|..#..|.#...|.#...|.#...",
    "8": ".###.|#...#|#...#|.###.|#...#|#...#|.###.",
    "9": ".###.|#...#|#...#|.####|....#|...#.|.##..",
    " ": ".....|.....|.....|.....|.....|.....|.....",
    ".": ".....|.....|.....|.....|.....|.##..|.##..",
    ",": ".....|.....|.....|.....|.##..|..#..|.#...",
    ":": ".....|.##..|.##..|.....|.##..|.##..|.....",
    ";": ".....|.##..|.##..|.....|.##..|..#..|.#...",
    "-": ".....|.....|.....|#####|.....|.....|.....",
    "+": ".....|..#..|..#..|#####|..#..|..#..|.....",
    "/": "....#|....#|...#.|..#..|.#...|#....|#....",
    "(": "...#.|..#..|.#...|.#...|.#...|..#..|...#.",
    ")": ".#...|..#..|...#.|...#.|...#.|..#..|.#...",
    "[": ".###.|.#...|.#...|.#...|.#...|.#...|.###.",
    "]": ".###.|...#.|...#.|...#.|...#.|...#.|.###.",
    "#": ".#.#.|.#.#.|#####|.#.#.|#####|.#.#.|.#.#.",
    "%": "##...|##..#|...#.|..#..|.#...|#..##|...##",
    "=": ".....|.....|#####|.....|#####|.....|.....",
    ">": ".#...|..#..|...#.|....#|...#.|..#..|.#...",
    "<": "...#.|..#..|.#...|#....|.#...|..#..|...#.",
    "_": ".....|.....|.....|.....|.....|.....|#####",
    "|": "..#..|..#..|..#..|..#..|..#..|..#..|..#..",
    "?": ".###.|#...#|....#|...#.|..#..|.....|..#..",
    "!": "..#..|..#..|..#..|..#..|..#..|.....|..#..",
    "'": "..#..|..#..|.....|.....|.....|.....|.....",
    "*": ".....|..#..|#.#.#|.###.|#.#.#|..#..|.....",
    "x": ".....|.....|#...#|.#.#.|..#..|.#.#.|#...#",
    "~": ".....|.....|.#...|#.#.#|...#.|.....|.....",
    "@": ".###.|#...#|#.###|#.#.#|#.###|#....|.###.",
}
_FONT = {k: [r for r in v.split("|")] for k, v in _FONT_SRC.items()}
_ALIASES = {"·": ".", "×": "x", "x": "X", "Δ": "D", "→": ">", "–": "-", "—": "-", "±": "+"}
CHAR_W, CHAR_H = 5, 7

# Lower case, for the few places a sheet must show a brand's own casing ("opencode", "Claude
# Code"). Same 5 wide, baseline on row 6 like the capitals; row 7 is the descender.
_LOWER_SRC = {
    "a": ".....|.....|.###.|....#|.####|#...#|.####|.....",
    "b": "#....|#....|#.##.|##..#|#...#|#...#|####.|.....",
    "c": ".....|.....|.###.|#....|#....|#...#|.###.|.....",
    "d": "....#|....#|.##.#|#..##|#...#|#...#|.####|.....",
    "e": ".....|.....|.###.|#...#|#####|#....|.###.|.....",
    "f": "..##.|.#..#|.#...|###..|.#...|.#...|.#...|.....",
    "g": ".....|.....|.####|#...#|#...#|.####|....#|.###.",
    "h": "#....|#....|#.##.|##..#|#...#|#...#|#...#|.....",
    "i": "..#..|.....|.##..|..#..|..#..|..#..|.###.|.....",
    "j": "...#.|.....|..##.|...#.|...#.|...#.|#..#.|.##..",
    "k": "#....|#....|#..#.|#.#..|##...|#.#..|#..#.|.....",
    "l": ".##..|..#..|..#..|..#..|..#..|..#..|.###.|.....",
    "m": ".....|.....|##.#.|#.#.#|#.#.#|#...#|#...#|.....",
    "n": ".....|.....|#.##.|##..#|#...#|#...#|#...#|.....",
    "o": ".....|.....|.###.|#...#|#...#|#...#|.###.|.....",
    "p": ".....|.....|####.|#...#|#...#|####.|#....|#....",
    "q": ".....|.....|.####|#...#|#...#|.####|....#|....#",
    "r": ".....|.....|#.##.|##..#|#....|#....|#....|.....",
    "s": ".....|.....|.###.|#....|.###.|....#|####.|.....",
    "t": ".#...|.#...|###..|.#...|.#...|.#..#|..##.|.....",
    "u": ".....|.....|#...#|#...#|#...#|#..##|.##.#|.....",
    "v": ".....|.....|#...#|#...#|#...#|.#.#.|..#..|.....",
    "w": ".....|.....|#...#|#...#|#.#.#|#.#.#|.#.#.|.....",
    "x": ".....|.....|#...#|.#.#.|..#..|.#.#.|#...#|.....",
    "y": ".....|.....|#...#|#...#|#...#|.####|....#|.###.",
    "z": ".....|.....|#####|...#.|..#..|.#...|#####|.....",
}
_LOWER = {k: v.split("|") for k, v in _LOWER_SRC.items()}


def _glyph(ch: str, cased: bool = False):
    if cased and ch in _LOWER:
        return _LOWER[ch]
    ch = _ALIASES.get(ch, ch)
    if ch == "x":  # only reached through the `×` alias: a letter x is upper-cased below
        return _FONT["x"]
    return _FONT.get(ch.upper()) or _FONT["?"]


def text_width(s: str, k: int) -> int:
    return len(s) * (CHAR_W + 1) * k - (k if s else 0)


# ──────────────────────────────────────────────────────────────────────────────── canvas


class Canvas:
    def __init__(self, w: int, h: int, bg: RGB):
        self.w, self.h = w, h
        self.px = bytearray(bytes(bg) * (w * h))

    def rect(self, x: int, y: int, w: int, h: int, col: RGB) -> None:
        x0, y0, x1, y1 = max(0, x), max(0, y), min(self.w, x + w), min(self.h, y + h)
        if x0 >= x1 or y0 >= y1:
            return
        run = bytes(col) * (x1 - x0)
        for yy in range(y0, y1):
            off = (yy * self.w + x0) * 3
            self.px[off:off + len(run)] = run

    def outline(self, x: int, y: int, w: int, h: int, col: RGB, t: int = 1) -> None:
        self.rect(x, y, w, t, col)
        self.rect(x, y + h - t, w, t, col)
        self.rect(x, y, t, h, col)
        self.rect(x + w - t, y, t, h, col)

    def rrect(self, x: int, y: int, w: int, h: int, r: int, col: RGB) -> None:
        r = max(0, min(r, w // 2, h // 2))
        for yy in range(h):
            if yy < r:
                d = r - yy - 0.5
            elif yy >= h - r:
                d = yy - (h - r) + 0.5
            else:
                d = -1
            inset = 0 if d < 0 else int(math.ceil(r - math.sqrt(max(0.0, r * r - d * d))))
            self.rect(x + inset, y + yy, w - 2 * inset, 1, col)

    def dashed_h(self, x: int, y: int, w: int, col: RGB, dash: int = 6, gap: int = 4, t: int = 1) -> None:
        i = 0
        while i < w:
            self.rect(x + i, y, min(dash, w - i), t, col)
            i += dash + gap

    def dashed_v(self, x: int, y: int, h: int, col: RGB, dash: int = 6, gap: int = 4, t: int = 1) -> None:
        i = 0
        while i < h:
            self.rect(x, y + i, t, min(dash, h - i), col)
            i += dash + gap

    def text(self, x: int, y: int, s: str, col: RGB, k: int = 2, cased: bool = False) -> int:
        cx = x
        for ch in s:
            g = _glyph(ch, cased)
            for gy, row in enumerate(g):
                for gx, bit in enumerate(row):
                    if bit == "#":
                        self.rect(cx + gx * k, y + gy * k, k, k, col)
            cx += (CHAR_W + 1) * k
        return cx - x

    def frame(self, frame, pal: dict[str, RGB], x: int, y: int, cell: int) -> None:
        for gy, row in enumerate(frame):
            gx = 0
            while gx < len(row):
                ch = row[gx]
                start = gx
                while gx < len(row) and row[gx] == ch:
                    gx += 1
                if ch != EMPTY:
                    self.rect(x + start * cell, y + gy * cell, (gx - start) * cell, cell, pal.get(ch, (255, 0, 255)))

    def save(self, path: Path) -> None:
        raw = b"".join(b"\x00" + bytes(self.px[y * self.w * 3:(y + 1) * self.w * 3]) for y in range(self.h))

        def chunk(tag: bytes, data: bytes) -> bytes:
            return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

        png = (
            b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", self.w, self.h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 6))
            + chunk(b"IEND", b"")
        )
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(png)


# ─────────────────────────────────────────────────────────────────────────────── sheets

M = 48  # sheet margin
ANNOT = (0x5A, 0xC8, 0xFA)  # annotation blue: never a palette colour, so it cannot be mistaken for art
ANNOT_RED = (0xFF, 0x4D, 0x6D)


class Ink:
    """Sheet chrome colours, from the scheme's own tokens."""

    def __init__(self, pal: Palettes):
        c = pal.c
        self.bg = c["surface.bg"]
        self.card = c["surface.card"]
        self.raised = c.get("surface.raised", c["surface.card"])
        self.border = c["surface.border"]
        self.text = c["surface.text"]
        self.dim = c["surface.textDim"]
        self.faint = c.get("surface.textFaint", c["surface.textDim"])
        self.accent = c["surface.accent"]
        self.on_accent = parse_hex("#1C1917")
        self.moved = self.text
        self.gone = ANNOT_RED
        self.still = mix(self.bg, self.dim, 0.28)


def frame_box(cv: Canvas, ink: Ink, frame, pal, x, y, cell) -> None:
    g = len(frame)
    cv.outline(x - 1, y - 1, g * cell + 2, g * cell + 2, ink.border)
    cv.frame(frame, pal, x, y, cell)


def motion_map(cv: Canvas, ink: Ink, prev, cur, x, y, cell) -> None:
    """Drawn cells that did not change in dim; cells that appeared or changed colour entering
    this frame in bone; cells that were drawn and are now empty in red."""
    g = len(cur)
    cv.outline(x - 1, y - 1, g * cell + 2, g * cell + 2, ink.border)
    for yy in range(g):
        for xx in range(g):
            a, b = prev[yy][xx], cur[yy][xx]
            if a == b:
                if b != EMPTY:
                    cv.rect(x + xx * cell, y + yy * cell, cell, cell, ink.still)
            elif b == EMPTY:
                cv.rect(x + xx * cell, y + yy * cell, cell, cell, ink.gone)
            else:
                cv.rect(x + xx * cell, y + yy * cell, cell, cell, ink.moved)


def true_sizes(cv: Canvas, ink: Ink, frame, pal, x, y, bg_tile: RGB | None = None) -> int:
    """Frame at 16/32/48/64 pt @3x, bottom-aligned, labelled. Returns the width used."""
    g = len(frame)
    cx = x
    top = y
    big = 64 * DEVICE
    for pt in PT_SIZES:
        cell = pt * DEVICE // g
        side = cell * g
        oy = top + (big - side)
        if bg_tile is not None:
            cv.rect(cx - 6, oy - 6, side + 12, side + 12, bg_tile)
        cv.frame(frame, pal, cx, oy, cell)
        cv.text(cx, top + big + 10, f"{pt}PT", ink.dim, 2)
        cx += side + 28
    return cx - x


def swatch(cv: Canvas, ink: Ink, x, y, col: RGB, label: str) -> int:
    cv.rect(x, y, 40, 40, col)
    cv.outline(x - 1, y - 1, 42, 42, ink.border)
    return 40 + 10 + cv.text(x + 50, y + 13, label, ink.dim, 2) + 28


def palette_line(pal: Palettes, cols: dict[str, RGB]) -> list[tuple[str, RGB, str]]:
    bg = pal.bg
    out = []
    for k, v in cols.items():
        out.append((k, v, f"{k} {to_hex(v)}  {contrast(v, bg):.1f}:1 ON BG"))
    return out


def sheet_animal(pack: Pack, pal: Palettes, animal: str, cellk: int, path: Path) -> None:
    ink = Ink(pal)
    frames = pack.animal_frames[animal]
    p = pal.animals[animal]
    g = pack.grid
    fb = g * cellk
    gap = 28
    mm = max(3, cellk // 2)
    ls = loop_stats(frames)
    st0 = frame_stats(frames[0])
    mo = pack.motion.get(animal, {}) if isinstance(pack.motion, dict) else {}
    beat = mo.get("beatMs")
    holds = mo.get("holds") or [1] * len(frames)
    drift = mo.get("drift")

    width = max(2 * M + len(frames) * (fb + gap) - gap, 2 * M + 1500)
    height = M + 30 + 22 + 30 + fb + 44 + g * mm + 60 + 64 * DEVICE + 44 + 60 + 40 * 5 + M
    cv = Canvas(width, height, ink.bg)
    y = M
    cv.text(M, y, f"{animal.upper()}  {len(frames)} FRAMES", ink.text, 4)
    y += 28 + 12
    drift_s = f"DRIFT {drift['axis'].upper()} {drift['cells']} CELL / {drift['periodMs']}MS" if isinstance(drift, dict) else "NO DRIFT"
    cv.text(
        M,
        y,
        f"BEAT {beat}MS  {drift_s}  WORST STEP {ls.worst} CELLS  MEAN {ls.mean:.1f}  FOOTPRINT {ls.footprint} CELLS  {pal.scheme.upper()} SCHEME",
        ink.dim,
        2,
    )
    if mo.get("note"):
        y += 22
        cv.text(M, y, mo["note"], ink.faint, 2)
    y += 36
    for i, f in enumerate(frames):
        x = M + i * (fb + gap)
        frame_box(cv, ink, f, p, x, y, cellk)
        hold = beat * holds[i] if beat and i < len(holds) else None
        cap = f"F{i}  D{ls.steps[i]}" + (f"  {js_round(hold)}MS" if hold else "")
        cv.text(x, y + fb + 10, cap, ink.dim, 2)
        motion_map(cv, ink, frames[i - 1], f, x, y + fb + 36, mm)
    y += fb + 36 + g * mm + 34
    cv.text(M, y, "TRUE SIZE, FRAME 0, @3X ON BG", ink.dim, 2)
    w = true_sizes(cv, ink, frames[0], p, M, y + 30)
    tx = M + w + 40
    cv.text(tx, y, "SAME ON A PICKER TILE (RAISED)", ink.dim, 2)
    true_sizes(cv, ink, frames[0], p, tx, y + 30, bg_tile=ink.raised)
    y += 30 + 64 * DEVICE + 48 + 24
    x = M
    for k, col, label in palette_line(pal, p):
        x += swatch(cv, ink, x, y, col, label)
    if "d" in p and "b" in p:
        cv.text(x, y + 13, f"D ON B {contrast(p['d'], p['b']):.1f}:1", ink.dim, 2)
    y += 60
    lines = [
        f"FRAME 0: {st0.filled} CELLS ({', '.join(f'{k}={v}' for k, v in sorted(st0.by_glyph.items()))})  "
        f"BBOX {st0.w}x{st0.h} AT COLS {st0.bbox[0]}-{st0.bbox[2]} ROWS {st0.bbox[1]}-{st0.bbox[3]}  BASELINE ROW {st0.bbox[3]}",
        f"ISLANDS {st0.islands4} (4-CONN) / {st0.islands8} (8-CONN)  HOLES {st0.holes}  EDGES {st0.edges}  "
        f"RUNS {st0.runs}  EDGES PER CELL {st0.edges / max(1, st0.filled):.2f}  OUTSIDE 12×12 {st0.outside_live}  ASYM {st0.asym}",
        f"LOOP: FILLED {ls.filled_min}-{ls.filled_max}  STEPS {' '.join(str(s) for s in ls.steps)}",
    ]
    for ln in lines:
        cv.text(M, y, ln, ink.dim, 2)
        y += 26
    cv.save(path)


def sheet_bit(pack: Pack, pal: Palettes, cellk: int, path: Path) -> None:
    ink = Ink(pal)
    g = pack.grid
    fb = g * cellk
    gap = 28
    mm = 4
    labw = 300
    maxf = max(len(f) for f in pack.bit.values())
    ts_w = sum(pt * DEVICE + 28 for pt in PT_SIZES)
    row_h = fb + 36 + g * mm + 40
    width = 2 * M + labw + maxf * (fb + gap) + 40 + ts_w
    height = M + 40 + 30 + len(pack.states) * row_h + 180 + M
    cv = Canvas(width, height, ink.bg)
    cv.text(M, M, "BIT  7 STATES, EVERY DRAWN FRAME", ink.text, 4)
    cv.text(
        M,
        M + 40,
        "ROLES: " + "  ".join(f"{k}={to_hex(v)}" for k, v in pal.bit.items()) + f"  {pal.scheme.upper()} SCHEME",
        ink.dim,
        2,
    )
    y = M + 40 + 40
    for s in pack.states:
        frames = pack.bit[s]
        ls = loop_stats(frames)
        st = frame_stats(frames[0])
        cv.text(M, y + 4, s.upper(), ink.text, 3)
        cv.text(M, y + 36, f"{len(frames)} FRAMES", ink.dim, 2)
        cv.text(M, y + 60, f"WORST STEP {ls.worst}", ink.dim, 2)
        cv.text(M, y + 84, f"CELLS {ls.filled_min}-{ls.filled_max}", ink.dim, 2)
        cv.text(M, y + 108, f"COLOURS {len(st.by_glyph)}", ink.dim, 2)
        cv.text(M, y + 132, f"ISLANDS {st.islands8}", ink.dim, 2)
        for i, f in enumerate(frames):
            x = M + labw + i * (fb + gap)
            frame_box(cv, ink, f, pal.bit, x, y, cellk)
            cv.text(x, y + fb + 10, f"F{i}  D{ls.steps[i]}", ink.dim, 2)
            motion_map(cv, ink, frames[i - 1], f, x, y + fb + 36, mm)
        tx = M + labw + maxf * (fb + gap) + 40
        true_sizes(cv, ink, frames[0], pal.bit, tx, y)
        y += row_h
    cv.save(path)


def sheet_pack(pack: Pack, pal: Palettes, cellk: int, path: Path) -> None:
    ink = Ink(pal)
    g = pack.grid
    fb = g * cellk
    gap = 16
    labw = 230
    rows = [("bit", pack.bit.get("blink") or pack.bit[pack.states[0]], pal.bit)]
    rows += [(a, pack.animal_frames[a], pal.animals[a]) for a in pack.animals]
    maxf = max(len(f) for _, f, _ in rows)
    row_h = fb + 44
    width = 2 * M + labw + maxf * (fb + gap)
    height = M + 60 + len(rows) * row_h + M
    cv = Canvas(width, height, ink.bg)
    cv.text(M, M, "THE PACK, EVERY FRAME OF EVERY LOOP", ink.text, 4)
    y = M + 60
    for name, frames, p in rows:
        ls = loop_stats(frames)
        cv.text(M, y + 8, name.upper(), ink.text, 3)
        cv.text(M, y + 40, f"{len(frames)} FR  WORST D{ls.worst}", ink.dim, 2)
        st = frame_stats(frames[0])
        cv.text(M, y + 64, f"{st.filled} CELLS {len(st.by_glyph)} COL", ink.dim, 2)
        for i, f in enumerate(frames):
            x = M + labw + i * (fb + gap)
            frame_box(cv, ink, f, p, x, y, cellk)
        y += row_h
    cv.save(path)


def nine(pack: Pack, pal: Palettes):
    first = pack.bit.get("idle") or pack.bit[pack.states[0]]
    out = [("bit", first[0], pal.bit)]
    out += [(a, pack.animal_frames[a][0], pal.animals[a]) for a in pack.animals]
    return out


def sheet_alignment(pack: Pack, pal: Palettes, cellk: int, path: Path) -> None:
    ink = Ink(pal)
    g = pack.grid
    fb = g * cellk
    gap = 36
    items = nine(pack, pal)
    width = 2 * M + (len(items) + 1) * (fb + gap) - gap + 160
    height = M + 50 + 30 + fb + 150 + M
    cv = Canvas(width, height, ink.bg)
    cv.text(M, M, "ALIGNMENT  FRAME 0 ON THE 16×16 GRID", ink.text, 4)
    cv.text(
        M,
        M + 40,
        "BLUE DASH = PROPOSED 12×12 LIVE AREA (CELLS 2-13)   BONE = BOUNDING BOX   RED = BASELINE (LOWEST DRAWN ROW)",
        ink.dim,
        2,
    )
    y = M + 80
    heat = [[0] * g for _ in range(g)]
    lo, hi = LIVE
    for i, (name, f, p) in enumerate(items):
        x = M + i * (fb + gap)
        cv.rect(x, y, fb, fb, mix(ink.bg, ink.card, 0.6))
        for k in range(1, g):
            cv.rect(x + k * cellk, y, 1, fb, mix(ink.bg, ink.border, 0.8))
            cv.rect(x, y + k * cellk, fb, 1, mix(ink.bg, ink.border, 0.8))
        cv.frame(f, p, x, y, cellk)
        st = frame_stats(f)
        bx0, by0, bx1, by1 = st.bbox
        cv.outline(x + bx0 * cellk - 2, y + by0 * cellk - 2, (bx1 - bx0 + 1) * cellk + 4, (by1 - by0 + 1) * cellk + 4, ink.text, 2)
        cv.rect(x - 6, y + (by1 + 1) * cellk - 1, fb + 12, 3, ANNOT_RED)
        lx, ly = x + lo * cellk, y + lo * cellk
        side = (hi - lo + 1) * cellk
        cv.dashed_h(lx, ly, side, ANNOT, 8, 6, 2)
        cv.dashed_h(lx, ly + side - 2, side, ANNOT, 8, 6, 2)
        cv.dashed_v(lx, ly, side, ANNOT, 8, 6, 2)
        cv.dashed_v(lx + side - 2, ly, side, ANNOT, 8, 6, 2)
        cv.text(x, y + fb + 14, name.upper(), ink.text, 3)
        cv.text(x, y + fb + 44, f"{st.filled} CELLS {st.w}×{st.h}", ink.dim, 2)
        cv.text(x, y + fb + 68, f"ROWS {by0}-{by1}", ink.dim, 2)
        cv.text(x, y + fb + 92, f"COLS {bx0}-{bx1}", ink.dim, 2)
        cv.text(x, y + fb + 116, f"OUTSIDE 12×12 {st.outside_live}", ink.dim, 2)
        for xx, yy, _ in cells(f):
            heat[yy][xx] += 1
    x = M + len(items) * (fb + gap)
    n = len(items)
    for yy in range(g):
        for xx in range(g):
            if heat[yy][xx]:
                cv.rect(x + xx * cellk, y + yy * cellk, cellk, cellk, mix(ink.bg, ink.text, heat[yy][xx] / n))
    cv.outline(x - 1, y - 1, fb + 2, fb + 2, ink.border)
    cv.text(x, y + fb + 14, "OVERLAP", ink.text, 3)
    cv.text(x, y + fb + 44, "BRIGHTER = MORE", ink.dim, 2)
    cv.text(x, y + fb + 68, f"OF THE {n} DRAW IT", ink.dim, 2)
    cv.save(path)


def picker_band(cv: Canvas, ink: Ink, items, x0: int, y: int, pt: int, tile_w: int, tile_h: int,
                fill: RGB, label_col: RGB, bg: RGB | None = None) -> int:
    """One row of picker tiles, creature `pt` points at @3x, centred, label under it."""
    g = 16
    gap = 12 * DEVICE
    if bg is not None:
        cv.rect(x0 - 36, y - 36, len(items) * (tile_w + gap) - gap + 72, tile_h + 72, bg)
    for i, (name, f, p) in enumerate(items):
        x = x0 + i * (tile_w + gap)
        cv.rrect(x, y, tile_w, tile_h, 18 * DEVICE, fill)
        cell = pt * DEVICE // g
        side = cell * g
        cx = x + (tile_w - side) // 2
        cy = y + 12 * DEVICE
        cv.frame(f, p, cx, cy, cell)
        k = 3 if pt >= 48 else 2
        lw = text_width(name, k)
        cv.text(x + (tile_w - lw) // 2, cy + side + 8 * DEVICE, name, label_col, k)
    return len(items) * (tile_w + gap) - gap


def carousel_as_shipped(src: Path) -> tuple[int, int, float]:
    """The creature screen's centre size, neighbour size and neighbour opacity, read from
    `mobile/app/icon.tsx` when it still says them the way it did (best effort: that screen is
    not part of the pixel source, and the defaults are what it said on 2026-09-13)."""
    stage, neighbour, alpha = 128, 32, 0.45
    icon = src.parent.parent / "app" / "icon.tsx"
    try:
        s = icon.read_text()
        if m := re.search(r"const STAGE_CREATURE\s*=\s*(\d+)", s):
            stage = int(m.group(1))
        if m := re.search(r"const NEIGHBOUR\s*=\s*(\d+)", s):
            neighbour = int(m.group(1))
        if m := re.search(r"size=\{NEIGHBOUR\}[^>]*opacity:\s*([\d.]+)", s):
            alpha = float(m.group(1))
    except OSError:
        pass
    return stage, neighbour, alpha


def faded(p: dict[str, RGB], bg: RGB, alpha: float) -> dict[str, RGB]:
    return {k: mix(bg, v, alpha) for k, v in p.items()}


def sheet_picker(
    pack: Pack, pal: Palettes, light: Palettes | None, path: Path, src: Path = DEFAULT_SRC, selected_ink: bool = False
) -> None:
    ink = Ink(pal)
    items = nine(pack, pal)
    n = len(items)
    t64w, t64h = 88 * DEVICE, 104 * DEVICE
    t32w, t32h = 72 * DEVICE, 72 * DEVICE
    gap = 12 * DEVICE
    stage, neighbour, alpha = carousel_as_shipped(src)
    width = 2 * M + 72 + n * (t64w + gap) - gap
    height = (
        M + 60 + (stage * DEVICE + 150) + (t64h + 110) + (t32h + 110) + (16 * DEVICE + 120) + (t64h + 110)
        + ((t64h + 150) if light else 0) + M
    )
    cv = Canvas(width, height, ink.bg)
    cv.text(M, M, "PICKER  ALL NINE, FRAME 0, SIDE BY SIDE @3X", ink.text, 4)
    y = M + 60
    x0 = M + 36

    # What the creature screen shows today: the first creature (the default) in the middle,
    # its two wrap-around neighbours dimmed beside it.
    first = pack.animals[0]
    prev_a, next_a = pack.animals[-1], pack.animals[1]
    cv.text(
        M,
        y,
        f"AS app/icon.tsx SHOWS IT: {first.upper()} (ANIMALS[0], THE DEFAULT) AT {stage} PT, NEIGHBOURS AT {neighbour} PT x {alpha} OPACITY",
        ink.dim,
        2,
    )
    y += 36
    big = stage * DEVICE
    small = neighbour * DEVICE
    cx = x0 + small + 160
    ny = y + (big - small) // 2
    cv.frame(pack.animal_frames[prev_a][0], faded(pal.animals[prev_a], ink.bg, alpha), x0, ny, small // pack.grid)
    cv.frame(pack.animal_frames[first][0], pal.animals[first], cx, y, big // pack.grid)
    cv.frame(pack.animal_frames[next_a][0], faded(pal.animals[next_a], ink.bg, alpha), cx + big + 160, ny, small // pack.grid)
    cv.text(cx + big + 160 + small + 60, y + 20, f"BODY {to_hex(pal.animals[first]['b'])}", ink.dim, 2)
    if "d" in pal.animals[first]:
        cv.text(cx + big + 160 + small + 60, y + 44, f"ACCENT {to_hex(pal.animals[first]['d'])}", ink.dim, 2)
    else:
        cv.text(cx + big + 160 + small + 60, y + 44, "ONE INK, NO ACCENT", ink.dim, 2)
    fb_ = faded(pal.animals[next_a], ink.bg, alpha)
    cv.text(cx + big + 160 + small + 60, y + 80, f"DIMMED {next_a.upper()} BODY {to_hex(fb_['b'])}", ink.dim, 2)
    fp_ = faded(pal.animals[prev_a], ink.bg, alpha)
    cv.text(cx + big + 160 + small + 60, y + 104, f"DIMMED {prev_a.upper()} BODY {to_hex(fp_['b'])}", ink.dim, 2)
    y += big + 74
    cv.text(M, y, "64 PT ON THE RAISED TILE (DESIGN-DIRECTION 5: RADIUS 18, 12 PT TOP INSET)", ink.dim, 2)
    y += 36
    picker_band(cv, ink, items, x0, y, 64, t64w, t64h, ink.raised, ink.text)
    y += t64h + 74
    cv.text(M, y, "32 PT (THE HARNESS PICKER GLYPH SIZE, AND THE CAROUSEL NEIGHBOUR SIZE)", ink.dim, 2)
    y += 36
    picker_band(cv, ink, items, x0, y, 32, t32w, t32h, ink.raised, ink.dim)
    y += t32h + 74
    cv.text(M, y, "16 PT INLINE, AS IN A ROW OR ON A CARD, NO TILE", ink.dim, 2)
    y += 36
    x = x0
    for name, f, p in items:
        cv.frame(f, p, x, y, DEVICE)
        cv.text(x + 16 * DEVICE + 12, y + 16, name, ink.dim, 2)
        x += 16 * DEVICE + 12 + text_width(name, 2) + 60
    y += 16 * DEVICE + 84
    if pal.tones:
        # The one-ink palette carries its own selected tone (GLYPH_INK in palette.ts).
        sel = [(nm, f, pal.toned(p, "selected")) for nm, f, p in items]
        cv.text(M, y, f"SELECTED: THE TILE FILLS AMBER (DESIGN-DIRECTION 5), THE ONE INK IN ITS SELECTED TONE {to_hex(pal.tones['selected'])}", ink.dim, 2)
    elif selected_ink:
        # One role: on an accent fill the role resolves to ink, and the holes show the amber.
        sel = [(nm, f, {k: (ink.on_accent if v == ink.accent else v) for k, v in p.items()}) for nm, f, p in items]
        cv.text(M, y, "SELECTED: THE TILE FILLS AMBER (DESIGN-DIRECTION 5), THE ONE ROLE DRAWN IN INK #1C1917", ink.dim, 2)
    else:
        sel = items
        cv.text(M, y, "SELECTED: THE TILE FILLS AMBER (DESIGN-DIRECTION 5), CREATURES IN THEIR CURRENT COLOURS", ink.dim, 2)
    y += 36
    picker_band(cv, ink, sel, x0, y, 64, t64w, t64h, ink.accent, ink.on_accent)
    y += t64h + 74
    if light:
        li = Ink(light)
        litems = nine(pack, light)
        cv.text(M, y, "LIGHT SCHEME (WIDGET / LOCK SCREEN IN LIGHT APPEARANCE), 64 PT", ink.dim, 2)
        y += 36 + 36
        picker_band(cv, li, litems, x0, y, 64, t64w, t64h, li.raised, li.text, bg=li.bg)
    cv.save(path)


# ─────────────────────────────────────────────── the harness glyphs (harness.ts, DESIGN-DIRECTION 5)
#
# The seven tool marks, read from `mobile/src/pixel/harness.ts` (HARNESS_MARKS), judged by the
# same numbers `__tests__/harness.test.ts` asserts, and drawn the way the app shows them: true
# 64/32/16 pt @3x in `text` on `bg`, the picker tile idle / selected / not found, the 3-column
# picker at 393 pt, beside the creatures, and in the light scheme.
#
#   python3 scripts/render_pixel_sheet.py --glyphs 3      -> shots/identity/20-glyphs-round3.png

GLYPH_BAND = 0.15  # every mark's filled cells within 15% of the set's mean
GLYPH_OUTLINE_MIN = 24  # two marks differ by at least this many cells (the creature floor)
GLYPH_THIN_MAX = 0  # cells in the middle of a one-cell-wide line
PHONE_PT = 393  # iPhone 15/16 width, for the true-size picker


@dataclass
class Mark:
    id: str
    name: str
    harnesses: list[str]
    symmetry: list[str]
    frame: list[str]


def load_marks(src: Path) -> list[Mark]:
    path = src / "harness.ts"
    out = []
    for m in literal(path, "HARNESS_MARKS"):
        frame = resolve(path, m["frame"])
        out.append(Mark(m["id"], m["name"], list(m["harnesses"]), list(m["symmetry"]), frame))
    return out


def sym_breaks(frame) -> dict[str, int]:
    """Cells that break each symmetry: left-right, top-bottom and a half turn."""
    g = len(frame)
    return {
        "mirror": sum(1 for y in range(g) for x in range(g // 2) if frame[y][x] != frame[y][g - 1 - x]),
        "flip": sum(1 for y in range(g // 2) for x in range(g) if frame[y][x] != frame[g - 1 - y][x]),
        "rotate": sum(1 for y in range(g) for x in range(g) if frame[y][x] != frame[g - 1 - y][g - 1 - x]) // 2,
    }


def glyph_thin(frame) -> list[tuple[int, int]]:
    """Cells in the middle of a one-cell-wide line (the creature rule, same definition): two or
    more drawn neighbours with both horizontal, or both vertical, neighbours empty."""
    pts = {(x, y) for x, y, _ in cells(frame)}
    out = []
    for x, y in sorted(pts):
        l, r, u, d = ((x - 1, y) in pts, (x + 1, y) in pts, (x, y - 1) in pts, (x, y + 1) in pts)
        if l + r + u + d >= 2 and ((not l and not r) or (not u and not d)):
            out.append((x, y))
    return out


def glyph_rules(m: Mark, mean: float) -> list[tuple[str, bool, str]]:
    f = m.frame
    st = frame_stats(f)
    x0, y0, x1, y1 = st.bbox
    lo, hi = LIVE
    roles = {ch for r in f for ch in r if ch != EMPTY}
    sb = sym_breaks(f)
    declared = [s for s in ("mirror", "flip", "rotate") if s in m.symmetry]
    dev = (st.filled - mean) / mean
    cx = (x0 - lo) - (hi - x1)
    cy = (y0 - lo) - (hi - y1)
    thin = glyph_thin(f)
    return [
        ("ONE ROLE", roles <= {"b"}, "".join(sorted(roles))),
        ("LIVE 2-13", lo <= x0 and x1 <= hi and lo <= y0 and y1 <= hi, f"C{x0}-{x1} R{y0}-{y1}"),
        ("CENTRED", abs(cx) <= 1 and abs(cy) <= 1, f"X{cx:+d} Y{cy:+d}"),
        ("WEIGHT", abs(dev) <= GLYPH_BAND, f"{st.filled} {dev * 100:+.0f}%"),
        ("SYM", all(sb[s] == 0 for s in declared), " ".join(f"{s[0].upper()}{sb[s]}" for s in ("mirror", "flip", "rotate"))
         + ("  DECL " + "".join(s[0].upper() for s in declared) if declared else "  DECL NONE")),
        ("NO THIN", len(thin) <= GLYPH_THIN_MAX, str(len(thin))),
    ]


def glyph_distances(marks: list[Mark]) -> dict[tuple[str, str], int]:
    out = {}
    for i, a in enumerate(marks):
        pa = {(x, y) for x, y, _ in cells(a.frame)}
        for b in marks[i + 1:]:
            pb = {(x, y) for x, y, _ in cells(b.frame)}
            out[(a.id, b.id)] = len(pa ^ pb)
    return out


def print_glyph_rules(marks: list[Mark]) -> int:
    mean = sum(frame_stats(m.frame).filled for m in marks) / len(marks)
    print(f"glyph mean {mean:.1f} cells, band {mean * (1 - GLYPH_BAND):.1f}-{mean * (1 + GLYPH_BAND):.1f}")
    fails = 0
    for m in marks:
        rr = glyph_rules(m, mean)
        bad = [(r, v) for r, ok, v in rr if not ok]
        fails += len(bad)
        st = frame_stats(m.frame)
        print(
            f"  {m.id:<12}{st.filled:>4} cells {st.w}x{st.h}  holes {st.holes:<3} islands {st.islands4}  "
            f"e/c {st.edges / max(1, st.filled):.2f}  " + ("ok" if not bad else "FAIL " + "; ".join(f"{r} [{v}]" for r, v in bad))
        )
    dist = glyph_distances(marks)
    close = sorted(dist.items(), key=lambda kv: kv[1])[:5]
    print("closest pairs: " + "  ".join(f"{a}/{b} {d}" for (a, b), d in close) + f"  (floor {GLYPH_OUTLINE_MIN})")
    fails += sum(1 for d in dist.values() if d < GLYPH_OUTLINE_MIN)
    return fails


def _mono(col: RGB) -> dict[str, RGB]:
    return {"b": col}


def glyph_tile(cv: Canvas, x: int, y: int, w: int, h: int, m: Mark, fill: RGB, glyph: RGB, name: RGB,
               status: RGB, status_text: str | None) -> None:
    """DESIGN-DIRECTION 5 tile @3x: radius 18, 14 pt padding, 32 pt glyph 12 pt from the top,
    name below, status under it. Left aligned, like every other block of text in the app."""
    cv.rrect(x, y, w, h, 18 * DEVICE, fill)
    pad = 14 * DEVICE
    cv.frame(m.frame, _mono(glyph), x + pad - 2 * 2 * DEVICE, y + 12 * DEVICE, 2 * DEVICE)  # live area starts 2 cells in
    ny = y + (12 + 32 + 6) * DEVICE
    cv.text(x + pad, ny, m.name, name, 3, cased=True)
    if status_text:
        cv.text(x + pad, ny + 17 * DEVICE, status_text, status, 2, cased=True)


def sheet_glyphs(marks: list[Mark], tokens: Path, path: Path, title: str, src: Path | None = None) -> Canvas:
    dark = load_colours(tokens, "dark")
    light = load_colours(tokens, "light")
    bg, text, dim = dark["surface.bg"], dark["surface.text"], dark["surface.textDim"]
    faint, raised, card = dark["surface.textFaint"], dark["surface.raised"], dark["surface.card"]
    border, accent = dark["surface.border"], dark["surface.accent"]
    on_accent = light["surface.text"]
    n = len(marks)
    mean = sum(frame_stats(m.frame).filled for m in marks) / n
    big = 14
    colw = 16 * big + 76
    tile = 88 * DEVICE
    width = 2 * M + 120 + n * colw
    phone_w = PHONE_PT * DEVICE
    tile_w = int(round((PHONE_PT - 32 - 24) / 3 * DEVICE))
    rows_n = (n + 2) // 3
    phone_h = 110 + rows_n * tile + (rows_n - 1) * 12 * DEVICE + 16 * DEVICE
    height = M + 150 + (16 * big + 210) + (192 + 60) + (96 + 60) + (48 + 60) + (48 + 70) + 3 * (tile + 60) + 60 + phone_h + 80 + M
    cv = Canvas(width, height, bg)
    x0 = M + 120

    # header
    cv.text(M, M, f"{title.upper()}  THE HARNESS GLYPHS", text, 4)
    cv.text(M, M + 44, f"ONE ROLE, NO BRAND COLOUR. 12X12 LIVE AREA (BLUE DASH). 2-CELL STROKES. WEIGHT WITHIN 15% OF THE MEAN "
            f"{mean:.1f} ({mean * (1 - GLYPH_BAND):.0f}-{mean * (1 + GLYPH_BAND):.0f}). SYMMETRIC WHERE THE SOURCE IS.", dim, 2)
    dist = glyph_distances(marks)
    (pa, pb), pd = min(dist.items(), key=lambda kv: kv[1])
    close = "  ".join(f"{a}/{b} {d}" for (a, b), d in sorted(dist.items(), key=lambda kv: kv[1])[:4])
    cv.text(M, M + 70, f"CLOSEST SILHOUETTES (CELLS THAT DIFFER): {close}   FLOOR {GLYPH_OUTLINE_MIN}",
            dim if pd >= GLYPH_OUTLINE_MIN else ANNOT_RED, 2)
    cv.text(M, M + 96, "SYM: M = LEFT-RIGHT, F = TOP-BOTTOM, R = HALF TURN; NUMBER = CELLS THAT BREAK IT. RED = A RULE BROKEN.", dim, 2)
    y = M + 150

    # big, on the grid
    for i, m in enumerate(marks):
        x = x0 + i * colw
        fb = 16 * big
        cv.rect(x, y, fb, fb, mix(bg, card, 0.7))
        for k in range(1, 16):
            cv.rect(x + k * big, y, 1, fb, mix(bg, border, 0.7))
            cv.rect(x, y + k * big, fb, 1, mix(bg, border, 0.7))
        lo, hi = LIVE
        side = (hi - lo + 1) * big
        lx, ly = x + lo * big, y + lo * big
        cv.dashed_h(lx, ly, side, ANNOT, 8, 6, 2)
        cv.dashed_h(lx, ly + side - 2, side, ANNOT, 8, 6, 2)
        cv.dashed_v(lx, ly, side, ANNOT, 8, 6, 2)
        cv.dashed_v(lx + side - 2, ly, side, ANNOT, 8, 6, 2)
        cv.frame(m.frame, _mono(text), x, y, big)
        cv.text(x, y + fb + 12, m.name, text, 3, cased=True)
        ty = y + fb + 44
        for r, ok, v in glyph_rules(m, mean):
            cv.text(x, ty, f"{r} {v}" if r not in ("WEIGHT", "SYM") else (f"{v}" if r == "SYM" else f"CELLS {v}"),
                    dim if ok else ANNOT_RED, 2)
            ty += 22
    y += 16 * big + 210

    def label(yy, s):
        cv.text(M, yy, s, dim, 2)

    # true sizes on bg
    for pt, gapy in ((64, 60), (32, 60), (16, 60)):
        label(y + pt * DEVICE // 2 - 7, f"{pt} PT")
        for i, m in enumerate(marks):
            cv.frame(m.frame, _mono(text), x0 + i * colw, y, pt * DEVICE // 16)
        y += pt * DEVICE + gapy
    # in a row: 16 pt textDim beside the name on a card
    label(y + 14, "ROW")
    for i, m in enumerate(marks):
        x = x0 + i * colw
        cv.rrect(x - 18, y - 12, colw - 20, 48 + 24, 12 * DEVICE // 2, card)
        cv.frame(m.frame, _mono(dim), x - 6, y, DEVICE)
        cv.text(x - 6 + 16 * DEVICE + 6, y + 17, m.name, dim, 2, cased=True)
    y += 48 + 70

    # the three tile states, 88 pt square here (the real width follows the screen, below)
    states = [
        ("IDLE", raised, text, text, dim, "found 212 sessions"),
        ("SELECTED", accent, on_accent, on_accent, on_accent, "found 212 sessions"),
        ("NOT FOUND", raised, faint, dim, dim, "not found"),
    ]
    for lab, fill, g_col, n_col, s_col, st_text in states:
        label(y + tile // 2 - 7, lab)
        for i, m in enumerate(marks):
            glyph_tile(cv, x0 + i * colw - 18, y, tile, tile, m, fill, g_col, n_col, s_col, st_text)
        y += tile + 60
    y += 20

    # the picker as a person sees it: 393 pt wide, 3 columns, mixed states
    cv.text(M, y, f"THE PICKER AT {PHONE_PT} PT @3X: TILES (W - 32 - 24) / 3 = {(PHONE_PT - 56) / 3:.1f} PT, 88 PT TALL, GAP 12", dim, 2)
    py = y + 40
    cv.rect(M, py, phone_w, phone_h - 40, bg)
    cv.outline(M - 1, py - 1, phone_w + 2, phone_h - 38, border)
    cv.text(M + 16 * DEVICE, py + 16 * DEVICE, "Your tools", text, 4, cased=True)
    counts = {"claude_code": 212, "codex": 38, "cursor": 57, "cline": 3}
    chosen = {"claude_code", "cursor"}
    ty0 = py + 16 * DEVICE + 60
    for i, m in enumerate(marks):
        r, c = divmod(i, 3)
        tx = M + 16 * DEVICE + c * (tile_w + 12 * DEVICE)
        tyy = ty0 + r * (tile + 12 * DEVICE)
        k = counts.get(m.id)
        st_text = (f"found {k} session" + ("s" if k != 1 else "")) if k else "not found"
        if m.id in chosen:
            glyph_tile(cv, tx, tyy, tile_w, tile, m, accent, on_accent, on_accent, on_accent, st_text)
        elif k:
            glyph_tile(cv, tx, tyy, tile_w, tile, m, raised, text, text, dim, st_text)
        else:
            glyph_tile(cv, tx, tyy, tile_w, tile, m, raised, faint, dim, dim, st_text)

    # beside the creatures, and in light mode, to the right of the phone
    rx = M + phone_w + 80
    ry = py
    cv.text(rx, y, "BESIDE THE CREATURES, 32 PT, ALL IN TEXT: ONE INK, ONE GRID, ONE PICKER", dim, 2)
    try:
        pack = load_pack(src or DEFAULT_SRC)
        crits = [pack.bit.get("idle", pack.bit[pack.states[0]])[0]] + [pack.animal_frames[a][0] for a in pack.animals]
    except SystemExit:
        crits = []
    items = [m.frame for m in marks] + crits
    per = (width - rx - M) // (32 * DEVICE + 24)
    for j, f in enumerate(items):
        r, c = divmod(j, max(1, per))
        pal = {ch: (text if ch == "b" else bg) for ch in "bdewhz"}
        cv.frame(f, pal, rx + c * (32 * DEVICE + 24), ry + r * (32 * DEVICE + 30), 2 * DEVICE)
    ry += ((len(items) + per - 1) // max(1, per)) * (32 * DEVICE + 30) + 40
    cv.text(rx, ry, "LIGHT SCHEME, 32 PT: GLYPH IN TEXT ON BG, AND THE SELECTED TILE", dim, 2)
    ry += 36
    lbg, ltext = light["surface.bg"], light["surface.text"]
    lw = width - rx - M
    cv.rect(rx, ry, lw, 24 + 32 * DEVICE + 50 + tile + 24, lbg)
    for j, m in enumerate(marks):
        cv.frame(m.frame, _mono(ltext), rx + 24 + j * (32 * DEVICE + 24), ry + 24, 2 * DEVICE)
    ry2 = ry + 32 * DEVICE + 50
    fit = max(1, (lw - 24) // (tile + 24))
    for j, m in enumerate(marks[:fit]):
        glyph_tile(cv, rx + 24 + j * (tile + 24), ry2, tile, tile, m, accent, on_accent, on_accent, on_accent, None)
    cv.save(path)
    return cv


# ─────────────────────────────────────────────────────────────────────────── the metrics


def print_metrics(pack: Pack, pal: Palettes) -> None:
    bg = pal.bg
    print(f"scheme {pal.scheme}, bg {to_hex(bg)}")
    head = (
        f"{'sprite':<18}{'fr':>3}{'cells':>7}{'b':>5}{'d':>4}{'oth':>5}{'bbox':>8}{'rows':>8}{'cols':>8}"
        f"{'isl8':>5}{'isl4':>5}{'hole':>5}{'edge':>6}{'e/c':>6}{'runs':>5}{'out12':>6}{'asym':>5}"
        f"{'worst':>6}{'mean':>6}{'foot':>5}"
    )
    print(head)

    def row(name, frames):
        st = frame_stats(frames[0])
        ls = loop_stats(frames)
        b = st.by_glyph.get("b", 0)
        d = st.by_glyph.get("d", 0)
        print(
            f"{name:<18}{len(frames):>3}{st.filled:>7}{b:>5}{d:>4}{st.filled - b - d:>5}{f'{st.w}x{st.h}':>8}"
            f"{f'{st.bbox[1]}-{st.bbox[3]}':>8}{f'{st.bbox[0]}-{st.bbox[2]}':>8}{st.islands8:>5}{st.islands4:>5}"
            f"{st.holes:>5}{st.edges:>6}{st.edges / max(1, st.filled):>6.2f}{st.runs:>5}{st.outside_live:>6}"
            f"{st.asym:>5}{ls.worst:>6}{ls.mean:>6.1f}{ls.footprint:>5}"
        )

    for s in pack.states:
        row(f"bit.{s}", pack.bit[s])
    for a in pack.animals:
        row(a, pack.animal_frames[a])
    print()
    print("colours (contrast on bg; accent on body)")
    for k, v in pal.bit.items():
        print(f"  bit.{k} {to_hex(v)} {contrast(v, bg):5.2f}:1")
    for a in pack.animals:
        p = pal.animals[a]
        r = pal.recipes.get(a, {})
        if "d" not in p:
            print(f"  {a:<8} b {to_hex(p['b'])} {contrast(p['b'], bg):5.2f}:1   recipe {json.dumps(r, separators=(',', ':'))}")
            continue
        print(
            f"  {a:<8} b {to_hex(p['b'])} {contrast(p['b'], bg):5.2f}:1   d {to_hex(p['d'])} {contrast(p['d'], bg):5.2f}:1"
            f"   d-on-b {contrast(p['d'], p['b']):4.2f}:1   recipe {json.dumps(r, separators=(',', ':'))}"
        )
    print()
    print("steps per frame (cells changed entering each frame, wrap included)")
    for s in pack.states:
        print(f"  bit.{s:<12} {loop_stats(pack.bit[s]).steps}")
    for a in pack.animals:
        print(f"  {a:<16} {loop_stats(pack.animal_frames[a]).steps}")


# ─────────────────────────────────────────────────────── a mechanical one-colour preview


def one_colour_frame(frame, ink_glyphs: str, hole_glyphs: str) -> list[str]:
    """Collapse a frame to ONE role, the way a template image or a one-colour rule would:
    `hole_glyphs` become transparent; any other drawn glyph not in `ink_glyphs` becomes a hole
    when all four neighbours are drawn (detail INSIDE the silhouette: eyes, a mouth, a stripe)
    and ink when it is on the edge (feet, claws, ear tips, wings). This is a preview of what
    today's drawings say in one colour, not a redraw: it shows which creatures keep their
    identity when colour stops doing the work and which ones were leaning on it."""
    g = len(frame)

    def drawn(x, y):
        return 0 <= x < g and 0 <= y < g and frame[y][x] != EMPTY and frame[y][x] not in hole_glyphs

    out = []
    for y, row in enumerate(frame):
        r = []
        for x, ch in enumerate(row):
            if ch == EMPTY or ch in hole_glyphs:
                r.append(EMPTY)
            elif ch in ink_glyphs:
                r.append("b")
            else:
                inside = all(drawn(x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
                r.append(EMPTY if inside else "b")
        out.append("".join(r))
    return out


def one_colour(pack: Pack, pal: Palettes) -> tuple[Pack, Palettes]:
    animals = {a: [one_colour_frame(f, "b", "") for f in fs] for a, fs in pack.animal_frames.items()}
    bit = {s: [one_colour_frame(f, "bdhzw", "e") for f in fs] for s, fs in pack.bit.items()}
    # Bit's highlight `w` sits beside the eye; fold it into the hole so the eye is one shape.
    for s, fs in pack.bit.items():
        for fi, f in enumerate(fs):
            rows = [list(r) for r in bit[s][fi]]
            for y, row in enumerate(f):
                for x, ch in enumerate(row):
                    if ch == "w" and ((x > 0 and row[x - 1] == "e") or (x < len(row) - 1 and row[x + 1] == "e")):
                        rows[y][x] = EMPTY
            bit[s][fi] = ["".join(r) for r in rows]
    amber = pal.c["surface.accent"]
    p2 = Palettes(
        pal.scheme,
        pal.c,
        {k: amber for k in pal.bit},
        {a: {"b": amber, "d": amber} for a in pal.animals},
        {a: {"body": {"hue": "amber"}} for a in pal.animals},
    )
    pk = Pack(pack.grid, pack.glyphs, pack.animals, pack.labels, animals, pack.states, bit, pack.motion, pack.bit_motion)
    return pk, p2


# ─────────────────────────────────────────────────── one family: the rules, and the round sheet
#
# The simplification rules (shots/identity audit, 2026-09-13) as numbers, so a round sheet can
# say which creature breaks which rule instead of leaving it to the eye. The TypeScript tests
# (`__tests__/animals.test.ts`) assert the same rules; this is the same arithmetic in Python so
# a candidate `--src` can be judged before it is copied over.
#
# Round 6 (the three-reviewer pass): the eyes are two 2x2 holes, a creature may have up to three
# other holes of eight cells or fewer, edges per cell may reach 1.15, and `PACK_EXCEPTIONS` in
# animals.ts lets exactly two creatures depart: the whale is asymmetric and floats on row 12, and
# the bee may be one cell thin where its ink borders a stripe hole. An older `--src` with no
# exceptions table is judged by the same rules with none.

EYES = ((5, 6), (6, 6), (5, 7), (6, 7), (9, 6), (10, 6), (9, 7), (10, 7))  # two 2x2 holes, rows 6-7
BASELINE = 13
MASS_BAND = 0.15  # every rest pose within 15% of the family's mean filled-cell count
OTHER_HOLES = (3, 8)  # at most this many holes besides the eyes, each at most this many cells
EDGES_PER_CELL = 1.15
OUTLINE_MIN = 24
STEP_MAX = 4
FOOTPRINT_MAX = 12


def pack_exceptions(src: Path) -> dict[str, dict]:
    """`PACK_EXCEPTIONS` from animals.ts ({} when the source has none): which creature may break
    which rule, and how far."""
    try:
        table = literal(src / "animals.ts", "PACK_EXCEPTIONS", required=False)
    except ParseError:
        return {}
    return table if isinstance(table, dict) else {}


def hole_cells(frame) -> set[tuple[int, int]]:
    """Transparent cells the silhouette encloses (4-connected to nothing outside the grid)."""
    g = len(frame)
    pts = {(x, y) for x, y, _ in cells(frame)}
    outside, stack = set(), [(-1, -1)]
    while stack:
        x, y = stack.pop()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            q = (x + dx, y + dy)
            if -1 <= q[0] <= g and -1 <= q[1] <= g and q not in outside and q not in pts:
                outside.add(q)
                stack.append(q)
    return {(x, y) for y in range(g) for x in range(g) if (x, y) not in pts and (x, y) not in outside}


def thin_cells(frame, stripes: bool = False) -> list[tuple[int, int]]:
    """Drawn cells in the middle of a one-cell-wide line: two or more drawn neighbours with
    both horizontal, or both vertical, neighbours empty. A cell with one neighbour is a tip.
    With `stripes` (the bee), a thin cell that borders a non-eye hole is a stripe's wall or
    band and is not reported."""
    pts = {(x, y) for x, y, _ in cells(frame)}
    out = []
    for x, y in sorted(pts):
        l, r, u, d = ((x - 1, y) in pts, (x + 1, y) in pts, (x, y - 1) in pts, (x, y + 1) in pts)
        if l + r + u + d >= 2 and ((not l and not r) or (not u and not d)):
            out.append((x, y))
    if stripes and out:
        stripe = hole_cells(frame) - set(EYES)
        out = [(x, y) for x, y in out if not any((x + dx, y + dy) in stripe for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))]
    return out


def blinked(frame):
    """The runtime blink: the two eye holes filled with the body role, if both are open."""
    h = hole_cells(frame)
    if not all(e in h for e in EYES):
        return frame
    rows = [list(r) for r in frame]
    for x, y in EYES:
        rows[y][x] = "b"
    return ["".join(r) for r in rows]


def silhouette(frame) -> set[tuple[int, int]]:
    return {(x, y) for x, y, _ in cells(frame)} | hole_cells(frame)


@dataclass
class Member:
    name: str
    frames: list  # the loop as played, repeats included
    holds: list[float]  # beats per frame
    beat: int | None
    exc: dict | None = None  # this member's PACK_EXCEPTIONS entry, if any

    @property
    def rest(self):
        return self.frames[0]


def family(pack: Pack, src: Path | None = None) -> list[Member]:
    """Bit's idle loop, then the pack in presentation order."""
    out = []
    exc = pack_exceptions(src) if src is not None else {}
    idle = (pack.bit_motion or {}).get("idle") if isinstance(pack.bit_motion, dict) else None
    bit = pack.bit.get("idle") or pack.bit[pack.states[0]]
    if isinstance(idle, dict):
        out.append(Member("bit", bit, list(idle.get("holds") or [1] * len(bit)), idle.get("beatMs")))
    else:
        out.append(Member("bit", bit, [1] * len(bit), None))
    for a in pack.animals:
        m = pack.motion.get(a, {}) if isinstance(pack.motion, dict) else {}
        fr = pack.animal_frames[a]
        out.append(Member(a, fr, list(m.get("holds") or [1] * len(fr)), m.get("beatMs"), exc.get(a)))
    return out


def rules_for(m: Member, mean: float) -> list[tuple[str, bool, str]]:
    """(rule, ok, measured) for one member. `mean` is the family's mean filled-cell count."""
    rest = m.rest
    exc = m.exc or {}
    st = frame_stats(rest)
    x0, y0, x1, y1 = st.bbox
    lo, hi = LIVE
    h = hole_cells(rest)
    other = components(h - set(EYES), eight=False)
    eye_groups = sorted(len(g) for g in components(h, eight=False) if g & set(EYES))
    n = len(m.frames)
    steps = [diff(m.frames[i - 1], m.frames[i]) for i in range(n)] if n > 1 else [0]
    foot: set = set()
    for i in range(n):
        foot |= changed_cells(m.frames[i - 1], m.frames[i])
    drawn = len({"\n".join(f) for f in m.frames})
    rest_share = sum(hd for f, hd in zip(m.frames, m.holds) if f == rest) / max(1e-9, sum(m.holds))
    stripes = bool(exc.get("stripes"))
    thin_any = [(i, t) for i, f in enumerate(m.frames) if (t := thin_cells(f, stripes))]
    out_gesture = []
    for i, f in enumerate(m.frames):
        a, b, c, d = frame_stats(f).bbox
        if a < lo - 1 or c > hi + 1 or b < lo - 1 or d > hi + 1:
            out_gesture.append(i)
    roles = {ch for f in m.frames for r in f for ch in r if ch != EMPTY}
    base = exc.get("baseline", BASELINE)
    free_mirror = exc.get("mirror") is False
    gasym = max(frame_stats(f).asym for f in m.frames)
    lo_mass, hi_mass = mean * (1 - MASS_BAND), mean * (1 + MASS_BAND)
    return [
        ("ONE ROLE", roles <= {"b"}, "".join(sorted(roles))),
        ("EYES 2X2 R6-7", all(e in h for e in EYES) and eye_groups == [4, 4], f"{len(h)} HOLES"),
        (f"OTHER <={OTHER_HOLES[0]}X{OTHER_HOLES[1]}", len(other) <= OTHER_HOLES[0] and all(len(g) <= OTHER_HOLES[1] for g in other),
         "+".join(str(len(g)) for g in other) or "NONE"),
        ("LIVE 2-13", lo <= x0 and x1 <= hi and lo <= y0 and y1 <= hi, f"C{x0}-{x1} R{y0}-{y1}"),
        (f"BASE {BASELINE}", y1 == base, f"R{y1}" + ("*" if base != BASELINE else "")),
        ("GESTURE +1", not out_gesture, ",".join(f"F{i}" for i in out_gesture) or "OK"),
        ("WIDTH 10-12", 10 <= st.w <= 12, str(st.w)),
        (f"MASS {lo_mass:.0f}-{hi_mass:.0f}", lo_mass <= st.filled <= hi_mass, f"{st.filled} {(st.filled - mean) / mean * 100:+.0f}%"),
        ("ONE SHAPE", st.islands4 == 1, str(st.islands4)),
        ("NO THIN", not thin_any, ";".join(f"F{i}:{len(t)}" for i, t in thin_any) or ("0*" if stripes else "0")),
        (f"E/C <={EDGES_PER_CELL}", st.edges / max(1, st.filled) <= EDGES_PER_CELL, f"{st.edges / max(1, st.filled):.2f}"),
        ("MIRROR", st.asym == 0 or (free_mirror and st.asym <= 12), str(st.asym) + ("*" if free_mirror else "")),
        ("GESTURE ASYM +4", gasym <= st.asym + 4, str(gasym)),
        ("3-5 FRAMES", 3 <= n <= 5 and 3 <= drawn <= 4, f"{n}/{drawn}"),
        (f"STEP <={STEP_MAX}", max(steps) <= STEP_MAX and min(steps) > 0, "-".join(map(str, steps))),
        (f"FOOT <={FOOTPRINT_MAX}", len(foot) <= FOOTPRINT_MAX, str(len(foot))),
        ("REST >=1/2", rest_share >= 0.5, f"{rest_share * 100:.0f}%"),
        ("BEAT 400-600", m.beat is not None and 400 <= m.beat <= 600, str(m.beat)),
    ]


def outline_matrix(members: list[Member]) -> dict[tuple[str, str], int]:
    out = {}
    for i, a in enumerate(members):
        for b in members[i + 1:]:
            out[(a.name, b.name)] = len(silhouette(a.rest) ^ silhouette(b.rest))
    return out


def print_rules(pack: Pack, src: Path | None = None) -> int:
    members = family(pack, src)
    mean = sum(frame_stats(m.rest).filled for m in members) / len(members)
    fails = 0
    print(f"family mean {mean:.1f} cells, band {mean * 0.85:.1f}-{mean * 1.15:.1f}")
    for m in members:
        if m.exc:
            print(f"  exception: {m.name} {m.exc}")
    for m in members:
        bad = [(r, v) for r, ok, v in rules_for(m, mean) if not ok]
        fails += len(bad)
        good = "ok" if not bad else "FAIL " + "; ".join(f"{r} [{v}]" for r, v in bad)
        print(f"  {m.name:<8} {good}")
    mat = outline_matrix(members)
    (a, b), v = min(mat.items(), key=lambda kv: kv[1])
    print(f"closest outlines: {a}/{b} differ by {v} cells (floor {OUTLINE_MIN})")
    for (a, b), v in sorted(mat.items(), key=lambda kv: kv[1])[:6]:
        print(f"    {a}/{b} {v}")
    fails += sum(1 for v in mat.values() if v < OUTLINE_MIN)
    return fails


def sheet_round(pack: Pack, pal: Palettes, light: Palettes | None, path: Path, title: str,
                src: Path | None = None, loop_cell: int = 8) -> Canvas:
    """One round of the redraw on one sheet: all nine at 64 and 32 pt, 16 pt inline, the
    selected tile and a dimmed carousel, the light scheme, every loop frame with the cells that
    change entering it boxed, the runtime blink, and the rule table.

    When palette.ts has an `idle` tone (round 6 on), the 64 pt row is the amber hero on `bg` and
    the 32 pt tiles are idle in `text`, with a band that sets creature tiles beside harness tiles
    in both states: amber means selected in both pickers. `loop_cell` sets the loop frames'
    scale (the final sheet draws them at 12 px a cell)."""
    ink = Ink(pal)
    members = family(pack, src)
    items = [(m.name, m.rest, pal.bit if m.name == "bit" else pal.animals[m.name]) for m in members]
    n = len(items)
    tones = pal.tones or {}
    idle_tone = "idle" in tones
    marks = []
    if idle_tone and src is not None and (src / "harness.ts").exists():
        try:
            marks = load_marks(src)
        except SystemExit:
            marks = []
    gap = 12 * DEVICE
    t64w, t64h = 88 * DEVICE, 104 * DEVICE
    t32w, t32h = 72 * DEVICE, 72 * DEVICE
    band64 = n * (t64w + gap) - gap
    width = 2 * M + 72 + band64
    lfb = 16 * loop_cell
    per_row = max(1, (width - 2 * M) // (6 * (lfb + 18) + 40))
    panel_w = (width - 2 * M) // per_row
    panel_h = 44 + lfb + 40 + 28 * 3
    panel_rows = (n + per_row - 1) // per_row
    rules_h = 60 + (n + 1) * 30 + 120
    tile_h = 88 * DEVICE
    same_h = (36 + 2 * (tile_h + 24) + 40) if marks else 0
    height = (
        M + 110
        + 36 + t64h + 60
        + 36 + t32h + 60
        + 36 + 16 * DEVICE + 70
        + 36 + t32h + 60
        + same_h
        + 36 + 64 * DEVICE + 70
        + (36 + 36 + t32h + 90 if light else 0)
        + 50 + panel_rows * panel_h + 30
        + rules_h + M
    )
    cv = Canvas(width, height, ink.bg)
    cv.text(M, M, f"{title.upper()}  ONE FAMILY, ONE INK", ink.text, 4)
    mean = sum(frame_stats(m.rest).filled for m in members) / n
    tone_s = "  ".join(f"{k.upper()} {to_hex(v)}" for k, v in tones.items())
    cv.text(M, M + 44, f"INK {tone_s}   {pal.scheme.upper()} BG {to_hex(pal.bg)}   FAMILY MEAN {mean:.1f} CELLS", ink.dim, 2)
    eyes_s = "TWO 2X2 HOLES AT COLS 5-6 AND 9-10" if len(EYES) == 8 else "TWO 1X2 HOLES AT COLS 6 AND 9"
    exc_s = "  ".join(f"{m.name.upper()}: " + ", ".join(f"{k.upper()} {str(v).upper()}" for k, v in m.exc.items()) for m in members if m.exc)
    cv.text(M, M + 70, f"EYES: {eyes_s}, ROWS 6-7, IN ALL NINE. BLUE BOXES = CELLS THAT CHANGE ENTERING THAT FRAME."
            + (f"  EXCEPTIONS (ANIMALS.TS): {exc_s}" if exc_s else ""), ink.dim, 2)
    y = M + 110
    x0 = M + 36

    if idle_tone:
        cv.text(M, y, "64 PT @3X ON BG, THE HERO: THE CREATURE AS THE SUBJECT IS AMBER (REST TONE)", ink.dim, 2)
        y += 36
        for i, (name, f, p) in enumerate(items):
            x = x0 + i * (t64w + gap)
            side = 64 * DEVICE
            cv.frame(f, p, x + (t64w - side) // 2, y, side // 16)
            cv.text(x + (t64w - text_width(name, 3)) // 2, y + side + 8 * DEVICE, name, ink.dim, 3)
        y += t64h + 60
        cv.text(M, y, "32 PT ON AN UNSELECTED PICKER TILE: TEXT, AS A HARNESS GLYPH IS (IDLE TONE)", ink.dim, 2)
        y += 36
        idle = [(nm, f, pal.toned(p, "idle")) for nm, f, p in items]
        picker_band(cv, ink, idle, x0, y, 32, t32w, t32h, ink.raised, ink.dim)
        y += t32h + 60
    else:
        cv.text(M, y, "64 PT ON THE RAISED TILE (DESIGN-DIRECTION 5: RADIUS 18, 12 PT TOP INSET), @3X", ink.dim, 2)
        y += 36
        picker_band(cv, ink, items, x0, y, 64, t64w, t64h, ink.raised, ink.text)
        y += t64h + 60
        cv.text(M, y, "32 PT, THE PICKER GLYPH SIZE", ink.dim, 2)
        y += 36
        picker_band(cv, ink, items, x0, y, 32, t32w, t32h, ink.raised, ink.dim)
        y += t32h + 60
    cv.text(M, y, "16 PT INLINE, IN A ROW OR ON A CARD", ink.dim, 2)
    y += 36
    x = x0
    for name, f, p in items:
        cv.frame(f, p, x, y, DEVICE)
        cv.text(x + 16 * DEVICE + 12, y + 16, name, ink.dim, 2)
        x += 16 * DEVICE + 12 + text_width(name, 2) + 60
    y += 16 * DEVICE + 70
    cv.text(M, y, "SELECTED: THE TILE FILLS AMBER, THE ONE ROLE DRAWN IN ONACCENT INK", ink.dim, 2)
    y += 36
    sel = [(nm, f, pal.toned(p, "selected")) for nm, f, p in items]
    picker_band(cv, ink, sel, x0, y, 32, t32w, t32h, ink.accent, ink.on_accent)
    y += t32h + 60
    if marks:
        # One picker: the same HarnessPicker tile (3 columns at 393 pt), a creature on one and a
        # tool on the next, idle then selected. Nothing tells them apart but the drawing.
        cv.text(M, y, "ONE PICKER: CREATURE TILES AND HARNESS TILES AT 393 PT, IDLE (TEXT) THEN SELECTED (INK ON AMBER)", ink.dim, 2)
        y += 36
        tw = int(round((PHONE_PT - 32 - 24) / 3 * DEVICE))
        crit = [Mark(nm, nm, [], [], f) for nm, f, _ in items[1:5]]
        mix4 = [crit[0], marks[0], crit[1], marks[1], crit[2], marks[2]]
        for row, selected in enumerate((False, True)):
            for j, mk in enumerate(mix4):
                tx = x0 + j * (tw + 12 * DEVICE)
                ty = y + row * (tile_h + 24)
                if selected:
                    glyph_tile(cv, tx, ty, tw, tile_h, mk, ink.accent, ink.on_accent, ink.on_accent, ink.on_accent, None)
                else:
                    glyph_tile(cv, tx, ty, tw, tile_h, mk, ink.raised, ink.text, ink.text, ink.dim, None)
        y += 2 * (tile_h + 24) + 40
    cv.text(M, y, "CAROUSEL: 64 PT CENTRE IN AMBER, 32 PT NEIGHBOURS IN TEXTFAINT (NOT 0.45 OPACITY)", ink.dim, 2)
    y += 36
    cx = x0
    for k in range(3):
        i0 = k * 3
        trio = [items[(i0 + j) % n] for j in range(3)]
        big = 64 * DEVICE
        small = 32 * DEVICE
        ny = y + (big - small) // 2
        cv.frame(trio[0][1], pal.toned(trio[0][2], "faint"), cx, ny, small // 16)
        cv.frame(trio[1][1], trio[1][2], cx + small + 60, y, big // 16)
        cv.frame(trio[2][1], pal.toned(trio[2][2], "faint"), cx + small + 60 + big + 60, ny, small // 16)
        cx += small * 2 + big + 120 + 140
    y += 64 * DEVICE + 70
    if light:
        li = Ink(light)
        lits = [(m.name, m.rest, light.bit if m.name == "bit" else light.animals[m.name]) for m in members]
        cv.text(M, y, f"LIGHT SCHEME, 32 PT: THE ONE INK IS {to_hex((light.tones or {}).get('rest', li.text))}", ink.dim, 2)
        y += 36 + 36
        picker_band(cv, li, lits, x0, y, 32, t32w, t32h, li.raised, li.dim, bg=li.bg)
        y += t32h + 90

    cv.text(M, y, f"EVERY LOOP FRAME AS PLAYED AT {loop_cell} PX A CELL, THEN THE RUNTIME BLINK (EYE HOLES FILLED, 120 MS)", ink.dim, 2)
    y += 50
    for idx, m in enumerate(members):
        px = M + (idx % per_row) * panel_w
        py = y + (idx // per_row) * panel_h
        p = pal.bit if m.name == "bit" else pal.animals[m.name]
        cv.text(px, py, m.name.upper(), ink.text, 3)
        beat = m.beat or 0
        cv.text(px + text_width(m.name, 3) + 20, py + 6, f"BEAT {beat}MS  HOLDS {' '.join(f'{h:g}' for h in m.holds)}", ink.dim, 2)
        fy = py + 44
        seq = list(m.frames) + [blinked(m.rest)]
        for i, f in enumerate(seq):
            fx = px + i * (lfb + 18)
            if fx + lfb > px + panel_w - 10:
                break
            frame_box(cv, ink, f, p, fx, fy, loop_cell)
            if i < len(m.frames):
                prev = m.frames[i - 1]
                for cx_, cy_ in changed_cells(prev, f):
                    cv.outline(fx + cx_ * loop_cell - 1, fy + cy_ * loop_cell - 1, loop_cell + 2, loop_cell + 2, ANNOT, 2)
                ms = js_round(beat * (m.holds[i] if i < len(m.holds) else 1))
                cv.text(fx, fy + lfb + 8, f"F{i} D{diff(prev, f)}", ink.dim, 2)
                cv.text(fx, fy + lfb + 30, f"{ms}MS", ink.faint, 2)
            else:
                cv.text(fx, fy + lfb + 8, "BLINK", ink.dim, 2)
        st = frame_stats(m.rest)
        cv.text(px, fy + lfb + 58, f"{st.filled} CELLS  {st.w}X{st.h}  E/C {st.edges / max(1, st.filled):.2f}  HOLES {len(hole_cells(m.rest))}", ink.dim, 2)
    y += panel_rows * panel_h + 30

    cv.text(M, y, "THE RULES, MEASURED (RED = BROKEN)", ink.text, 3)
    y += 44
    rows = [(m.name, rules_for(m, mean)) for m in members]
    heads = [r for r, _, _ in rows[0][1]]
    colw = (width - 2 * M - 160) // len(heads)
    for j, hd in enumerate(heads):
        words = hd.split(" ")
        cv.text(M + 160 + j * colw, y, words[0], ink.dim, 2)
        if len(words) > 1:
            cv.text(M + 160 + j * colw, y + 20, " ".join(words[1:]), ink.dim, 2)
    y += 52
    for name, rr in rows:
        cv.text(M, y, name.upper(), ink.text, 2)
        for j, (_, ok, v) in enumerate(rr):
            cv.text(M + 160 + j * colw, y, v[: max(3, colw // 12 - 1)], ink.text if ok else ANNOT_RED, 2)
        y += 30
    mat = outline_matrix(members)
    (a, b), v = min(mat.items(), key=lambda kv: kv[1])
    close = "  ".join(f"{p}/{q} {d}" for (p, q), d in sorted(mat.items(), key=lambda kv: kv[1])[:5])
    cv.text(M, y + 14, f"OUTLINES: CLOSEST PAIRS  {close}   (FLOOR {OUTLINE_MIN})", ink.text if v >= OUTLINE_MIN else ANNOT_RED, 2)
    cv.save(path)
    return cv


def crop(cv: Canvas, x: int, y: int, w: int, h: int) -> Canvas:
    out = Canvas(w, h, (0, 0, 0))
    for yy in range(h):
        so = ((y + yy) * cv.w + x) * 3
        out.px[yy * w * 3:(yy + 1) * w * 3] = cv.px[so:so + w * 3]
    return out


# ──────────────────────────────────────────────────────────────────────────────── main


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--src", type=Path, default=DEFAULT_SRC, help="pixel source dir (frames/sprites/animals/palette/motion .ts)")
    ap.add_argument("--tokens", type=Path, default=DEFAULT_TOKENS)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--prefix", default="00-current")
    ap.add_argument("--scheme", choices=("dark", "light"), default="dark")
    ap.add_argument("--scale", type=int, default=12, help="device pixels per cell for the big frames")
    ap.add_argument(
        "--sheets",
        default="bit,animals,pack,alignment,picker",
        help="comma list of: bit, animals, pack, alignment, picker, round (one sheet named by --prefix), or single animal names",
    )
    ap.add_argument("--metrics", action="store_true", help="print the audit numbers")
    ap.add_argument("--rules", action="store_true", help="print the family rules, measured; exit 1 on any break")
    ap.add_argument("--check", action="store_true", help="cross-check the parsed palette against bun")
    ap.add_argument(
        "--one-colour",
        action="store_true",
        help="preview: collapse every frame to one amber role, interior detail as holes (not a redraw)",
    )
    ap.add_argument(
        "--glyphs",
        type=int,
        metavar="ROUND",
        help="the harness glyph sheet from harness.ts: <out>/20-glyphs-round<ROUND>.png, rules printed; exit 1 on a break",
    )
    ap.add_argument(
        "--name",
        help="with --glyphs: write <out>/<NAME>.png instead of 20-glyphs-round<ROUND>.png (e.g. 31-final-glyphs)",
    )
    ap.add_argument(
        "--loop-cell",
        type=int,
        default=8,
        help="with --sheets round: device pixels per cell for the loop frames (the final sheet uses 12)",
    )
    args = ap.parse_args(argv)

    src = args.src.resolve()
    if args.glyphs is not None:
        marks = load_marks(src)
        p = args.out / (f"{args.name}.png" if args.name else f"20-glyphs-round{args.glyphs}.png")
        title = args.name.replace("-", " ") if args.name else f"round {args.glyphs}"
        sheet_glyphs(marks, args.tokens, p, title, src)
        print(p)
        return 1 if print_glyph_rules(marks) else 0
    pack = load_pack(src)
    pal = load_palettes(src, args.tokens, args.scheme, pack.animals)
    if args.check:
        problems = check_with_bun(src, pal, pack.animals)
        for p in problems:
            print("CHECK:", p, file=sys.stderr)
        if problems:
            return 1
        print("check: every parsed colour matches bun's palette.ts", file=sys.stderr)
    if args.one_colour:
        pack, pal = one_colour(pack, pal)

    want = {s.strip() for s in args.sheets.split(",") if s.strip()}
    out: list[Path] = []
    pre = args.out / args.prefix
    if "bit" in want:
        sheet_bit(pack, pal, args.scale, p := Path(f"{pre}-bit.png"))
        out.append(p)
    for a in pack.animals:
        if "animals" in want or a in want:
            sheet_animal(pack, pal, a, args.scale, p := Path(f"{pre}-{a}.png"))
            out.append(p)
    if "pack" in want:
        sheet_pack(pack, pal, 8, p := Path(f"{pre}-pack.png"))
        out.append(p)
    if "alignment" in want:
        sheet_alignment(pack, pal, args.scale, p := Path(f"{pre}-alignment.png"))
        out.append(p)
    if "picker" in want:
        light = load_palettes(src, args.tokens, "light", pack.animals) if args.scheme == "dark" else None
        if light and args.one_colour:
            light = None  # one amber on the light ground is 1.7:1; the rule there is ink, drawn separately
        sheet_picker(pack, pal, light, p := Path(f"{pre}-picker.png"), src, selected_ink=args.one_colour)
        out.append(p)
    if "round" in want:
        # The round sheet is ONE file named by the prefix itself: 10-creatures-round3.png.
        light = load_palettes(src, args.tokens, "light", pack.animals) if args.scheme == "dark" else None
        sheet_round(pack, pal, light, p := Path(f"{pre}.png"), args.prefix.replace("-", " "), src, args.loop_cell)
        out.append(p)
    for p in out:
        print(p)
    if args.metrics:
        print()
        print_metrics(pack, pal)
    if args.rules:
        print()
        return 1 if print_rules(pack, src) else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
