#!/usr/bin/env python3
"""
Render the builder's creatures as 1-bit template PNGs for the widget extension.

The Live Activity, the Dynamic Island and the Home Screen widget draw the SAME creature the
app animates: each animal's first frame (its base pose) from `mobile/src/pixel/animals.ts`,
and Bit's idle and sleeping poses from `mobile/src/pixel/sprites.ts`, read straight out of the
TypeScript. SwiftUI tints them amber with `.renderingMode(.template)` and draws them with
`.interpolation(.none)`, so a creature re-drawn in the pack re-draws on the Lock Screen at the
next `python3 scripts/gen_widget_creatures.py`.

Output, all under `mobile/targets/widget/`:
  Assets.xcassets/creature-<id>-<pt>.imageset/   @2x and @3x PNGs at 16, 32, 48 and 64 pt
  _shared/CreatureArt.swift                        the ids and sizes, so Swift cannot ask for
                                                   an image this script did not draw, and each
                                                   drawing's empty side columns

@bacons/apple-targets 4.0.7 syncs the whole `targets/widget/` folder into the extension
target (a PBXFileSystemSynchronizedRootGroup), so Xcode compiles `Assets.xcassets` into the
extension's Assets.car on its own. The plugin writes its own `$accent` and
`$widgetBackground` colorsets into the same catalog with mkdir and never deletes a folder, and
this script only ever touches `creature-*.imageset`, so the two never step on each other.

Only 16, 32, 48 and 64 pt: a 16 cell grid lands on whole device pixels at those sizes at @2x
and @3x (DESIGN-DIRECTION 5), and every scale here is an integer multiple, so nearest
neighbour is exact. Anything in between blurs the grid.

ONE BIT, TWO ROLES. A template image has one colour, so each frame collapses to ink and hole:
  * Animals draw `b` (body) and `d` (accent). A `d` pixel whose four neighbours are all drawn
    is detail INSIDE the silhouette. A connected patch of those that is one cell thin or four
    cells at most (eyes, a mouth, an ear lining, a belly line) becomes a hole; a wider patch
    stays ink, because the fox's chest and muzzle came out as a hole through the animal in the
    first render. A `d` pixel on the silhouette's edge (claws, feet, ear tips, wings) stays
    ink. That is the pack's own rule turned around: "a transparent pixel inside a body reads as
    the background - that is how eyes ... are drawn" (animals.ts), so the dog, fox, whale and
    bee, whose eyes were already holes, keep them exactly as drawn.
  * Bit draws `b`, `d`, `h` and `z` as ink; `e` (eye) and `w` (eye highlight) are holes, so the
    face survives and the sleeping pose keeps its trail of z's.

Stdlib only, like the other gen_*.py scripts (the PNG encoder is gen_app_icons.py's, zlib and
struct). Deliberately NOT part of `make gen`, for gen_app_icons.py's reason: a zlib stream is not
guaranteed byte-identical across zlib builds, so a PNG cannot be a `git diff --exit-code` gate.

  python3 scripts/gen_widget_creatures.py            write the catalog and CreatureArt.swift
  python3 scripts/gen_widget_creatures.py --print    also print every 1-bit frame as text
  python3 scripts/gen_widget_creatures.py --sheet out.png   also write an amber contact sheet
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import struct
import sys
import zlib
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PIXEL = ROOT / "mobile" / "src" / "pixel"
ANIMALS_TS = PIXEL / "animals.ts"
SPRITES_TS = PIXEL / "sprites.ts"
TARGET = ROOT / "mobile" / "targets" / "widget"
CATALOG = TARGET / "Assets.xcassets"
SWIFT_OUT = TARGET / "_shared" / "CreatureArt.swift"

GRID = 16
SIZES_PT = (16, 32, 48, 64)
SCALES = (2, 3)
PREFIX = "creature-"

ANIMAL_GLYPHS = frozenset("bd")
BIT_GLYPHS = frozenset("bdewhz")
BIT_INK = frozenset("bdhz")  # `e` and `w` are the face: holes

# ------------------------------------------------------------------ a tiny TS literal parser


class ParseError(SystemExit):
    pass


@dataclass(frozen=True)
class Ident:
    name: str


class Reader:
    """Just enough of a JS/TS reader to walk array and object literals made of string literals,
    identifiers and nested literals, skipping comments and whitespace. Frames are data the
    tests validate, and a regex over quotes would also match a quote inside a comment."""

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
                raise self.fail("template interpolation inside a frame literal")
            out.append(c)
            self.i += 1
        raise self.fail("unterminated string")

    def ident(self) -> str:
        m = re.compile(r"[A-Za-z_$][\w$]*").match(self.s, self.i)
        if not m:
            raise self.fail(f"expected a value, found {self.s[self.i:self.i + 12]!r}")
        self.i = m.end()
        return m.group(0)

    def value(self):
        c = self.peek()
        if c in "'\"`":
            return self.string()
        if c == "[":
            return self.array()
        if c == "{":
            return self.obj()
        return Ident(self.ident())

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


def literal(path: Path, declaration: str):
    """The literal assigned by `const <declaration>` (with or without `export`, any type
    annotation), e.g. `literal(ANIMALS_TS, "ANIMAL_FRAMES")`."""
    src = path.read_text()
    m = re.search(rf"(?:^|\n)\s*(?:export\s+)?const\s+{re.escape(declaration)}\b[^=\n]*=", src)
    if not m:
        raise ParseError(f"{path.name}: no `const {declaration} =`")
    return Reader(src, m.end(), path.name).value()


def frame(value, where: str, glyphs: frozenset[str]) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(r, str) for r in value):
        raise ParseError(f"{where}: not a list of row strings")
    problems = []
    if len(value) != GRID:
        problems.append(f"{len(value)} rows, want {GRID}")
    for y, row in enumerate(value):
        if len(row) != GRID:
            problems.append(f"row {y}: {len(row)} columns, want {GRID}")
        bad = sorted({c for c in row if c != "." and c not in glyphs})
        if bad:
            problems.append(f"row {y}: glyphs {bad} not allowed here")
    if problems:
        raise ParseError(f"{where}: " + "; ".join(problems))
    return value


# ------------------------------------------------------------------ the sources


def creatures() -> dict[str, list[str]]:
    """{id: 16 rows}, in the pack's presentation order, then Bit's two poses."""
    order = literal(ANIMALS_TS, "ANIMALS")
    table = literal(ANIMALS_TS, "ANIMAL_FRAMES")
    if not isinstance(order, list) or not all(isinstance(a, str) for a in order):
        raise ParseError("animals.ts: ANIMALS is not a list of strings")
    if not isinstance(table, dict) or set(table) != set(order):
        raise ParseError("animals.ts: ANIMAL_FRAMES keys are not exactly ANIMALS")
    out: dict[str, list[str]] = {}
    for animal in order:
        ref = table[animal]
        if not isinstance(ref, Ident):
            raise ParseError(f"animals.ts: ANIMAL_FRAMES.{animal} is not a const name")
        frames = literal(ANIMALS_TS, ref.name)
        if not isinstance(frames, list) or not frames:
            raise ParseError(f"animals.ts: {ref.name} has no frames")
        # The first frame is the base pose every loop starts from (animals.ts, rule 1).
        out[animal] = frame(frames[0], f"animals.ts {ref.name}[0]", ANIMAL_GLYPHS)

    sprites = literal(SPRITES_TS, "SPRITES")
    for key, pick, name in (("idle", 0, "bit"), ("sleeping", -1, "bit-sleeping")):
        refs = sprites.get(key) if isinstance(sprites, dict) else None
        if not isinstance(refs, list) or not refs or not isinstance(refs[pick], Ident):
            raise ParseError(f"sprites.ts: SPRITES.{key} is not a list of frame names")
        # Sleeping takes its LAST frame: the one whose z trail has fully risen, so the pose
        # reads as asleep in a still image rather than as Bit with its eyes shut.
        ref = refs[pick]
        out[name] = frame(literal(SPRITES_TS, ref.name), f"sprites.ts {ref.name}", BIT_GLYPHS)
    return out


def one_bit(rows: list[str], is_bit: bool) -> list[list[bool]]:
    """Ink (True) or hole (False) per cell, by the rules in the module docstring."""

    def drawn(x: int, y: int) -> bool:
        return 0 <= x < GRID and 0 <= y < GRID and rows[y][x] != "."

    steps = ((1, 0), (-1, 0), (0, 1), (0, -1))
    ink = [[False] * GRID for _ in range(GRID)]
    interior: set[tuple[int, int]] = set()
    for y in range(GRID):
        for x in range(GRID):
            g = rows[y][x]
            if g == ".":
                continue
            if is_bit:
                ink[y][x] = g in BIT_INK
            elif g == "b" or not all(drawn(x + dx, y + dy) for dx, dy in steps):
                ink[y][x] = True  # the body, and accent on the silhouette's edge
            else:
                interior.add((x, y))

    # Interior accent, one connected patch at a time: thin or small is a hole, wide is ink.
    while interior:
        stack, patch = [interior.pop()], []
        while stack:
            x, y = stack.pop()
            patch.append((x, y))
            for dx, dy in steps:
                n = (x + dx, y + dy)
                if n in interior:
                    interior.remove(n)
                    stack.append(n)
        w = max(x for x, _ in patch) - min(x for x, _ in patch) + 1
        h = max(y for _, y in patch) - min(y for _, y in patch) + 1
        hole = min(w, h) == 1 or len(patch) <= 4
        for x, y in patch:
            ink[y][x] = not hole
    return ink


# ------------------------------------------------------------------ PNG (gen_app_icons.py's encoder)


def png_bytes(w: int, h: int, rgba: bytes) -> bytes:
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw += rgba[y * w * 4 : (y + 1) * w * 4]

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def render(ink: list[list[bool]], cell: int, fg=(255, 255, 255), bg=None) -> tuple[int, bytes]:
    """The full 16x16 grid at `cell` px per cell, nearest neighbour. The frame keeps its
    transparent margin so every creature sits in the same box and they align across surfaces."""
    size = GRID * cell
    on = bytes((*fg, 255))
    off = bytes((*bg, 255)) if bg else bytes(4)
    buf = bytearray()
    for y in range(size):
        row = ink[y // cell]
        buf += b"".join(on if row[x // cell] else off for x in range(size))
    return size, bytes(buf)


# ------------------------------------------------------------------ writers


def write_catalog(art: dict[str, list[list[bool]]]) -> list[str]:
    CATALOG.mkdir(parents=True, exist_ok=True)
    root_contents = CATALOG / "Contents.json"
    if not root_contents.exists():
        root_contents.write_text(json.dumps({"info": {"author": "xcode", "version": 1}}, indent=2) + "\n")

    wanted = set()
    for cid, ink in art.items():
        for pt in SIZES_PT:
            name = f"{PREFIX}{cid}-{pt}"
            wanted.add(f"{name}.imageset")
            d = CATALOG / f"{name}.imageset"
            if d.exists():
                shutil.rmtree(d)
            d.mkdir(parents=True)
            images = [{"idiom": "universal", "scale": "1x"}]
            for scale in SCALES:
                cell = (pt // GRID) * scale
                size, rgba = render(ink, cell)
                fname = f"{name}@{scale}x.png"
                (d / fname).write_bytes(png_bytes(size, size, rgba))
                images.append({"filename": fname, "idiom": "universal", "scale": f"{scale}x"})
            contents = {
                "images": images,
                "info": {"author": "xcode", "version": 1},
                # Template: SwiftUI tints it (amber, or the accent in tinted Home Screens).
                "properties": {"template-rendering-intent": "template"},
            }
            (d / "Contents.json").write_text(json.dumps(contents, indent=2) + "\n")

    # A creature removed from the pack takes its images with it. Only ours: never a colorset.
    for stale in sorted(CATALOG.glob(f"{PREFIX}*.imageset")):
        if stale.name not in wanted:
            shutil.rmtree(stale)
            print(f"removed {stale.relative_to(ROOT)}")
    return sorted(wanted)


def side_insets(ink: list[list[bool]]) -> tuple[int, int]:
    """Empty columns left and right of the drawing (0, 0 for a blank frame)."""
    cols = [x for x in range(GRID) if any(ink[y][x] for y in range(GRID))]
    return (cols[0], GRID - 1 - cols[-1]) if cols else (0, 0)


def write_swift(art: dict[str, list[list[bool]]]) -> None:
    insets = ", ".join(f"{json.dumps(cid)}: {side_insets(ink)}" for cid, ink in art.items())
    lines = [
        "// GENERATED by scripts/gen_widget_creatures.py from mobile/src/pixel/animals.ts and",
        "// sprites.ts. Do not edit: re-run the script, which also redraws Assets.xcassets.",
        "",
        "enum CreatureArt {",
        "  /// Every creature with images in the widget's Assets.xcassets, in the pack's order, then Bit.",
        "  static let ids: [String] = [" + ", ".join(json.dumps(i) for i in art) + "]",
        "  /// Point sizes drawn. The grid lands on whole device pixels only at these.",
        "  static let sizes: [Int] = [" + ", ".join(str(s) for s in SIZES_PT) + "]",
        f'  static let prefix = "{PREFIX}"',
        "  /// Empty grid columns left and right of each drawing. Every image keeps the full 16 cell",
        "  /// frame so creatures line up with each other; a surface that must sit flush with text or",
        "  /// snug to the camera trims these instead (`CreatureMark(trim:)`).",
        "  static let insets: [String: (leading: Int, trailing: Int)] = [" + insets + "]",
        "}",
        "",
    ]
    SWIFT_OUT.write_text("\n".join(lines))


def contact_sheet(path: Path, art: dict[str, list[list[bool]]]) -> None:
    """Every creature at 32pt @3x, amber on the dark bg, for a human to look at."""
    amber, bg = (0xFF, 0xB3, 0x00), (0x14, 0x12, 0x10)
    cell, pad = 6, 24
    tile = GRID * cell
    n = len(art)
    w, h = pad + n * (tile + pad), tile + 2 * pad
    canvas = bytearray(bytes((*bg, 255)) * (w * h))
    for k, ink in enumerate(art.values()):
        ox, oy = pad + k * (tile + pad), pad
        for y in range(tile):
            for x in range(tile):
                if ink[y // cell][x // cell]:
                    i = ((oy + y) * w + ox + x) * 4
                    canvas[i : i + 4] = bytes((*amber, 255))
    path.write_bytes(png_bytes(w, h, bytes(canvas)))
    print(f"sheet {path}  {w}x{h}")


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--print", action="store_true", help="print every 1-bit frame as text")
    ap.add_argument("--sheet", type=Path, help="write an amber contact sheet PNG here")
    a = ap.parse_args(argv)

    src = creatures()
    art = {cid: one_bit(rows, is_bit=cid.startswith("bit")) for cid, rows in src.items()}
    sets = write_catalog(art)
    write_swift(art)
    print(f"{len(sets)} imagesets ({len(art)} creatures x {len(SIZES_PT)} sizes x @{'/@'.join(map(str, SCALES))}x) in {CATALOG.relative_to(ROOT)}")
    print(f"wrote {SWIFT_OUT.relative_to(ROOT)}")
    if a.print:
        for cid, ink in art.items():
            print(f"\n{cid}")
            for row in ink:
                print("".join("#" if c else "." for c in row))
    if a.sheet:
        contact_sheet(a.sheet, art)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
