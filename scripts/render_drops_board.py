#!/usr/bin/env python3
"""Render the drops board to a PNG, from the app's own TypeScript.

    python3 scripts/render_drops_board.py --board board.json --out shots/drops-board.png

WHY IT SHELLS OUT TO BUN. `render_pixel_sheet.py` reads `sprites.ts` so a sheet can never show a
frame the app does not have; this does the same thing one step further and RUNS the app's
modules. `src/drops/cluster.ts`, `layout.ts`, `sigil.ts` and the generated tokens produce the
clusters, the positions, the glyphs and the hues, and this file only draws them. A second layout
written in Python would be a picture of a board nobody can open.

WHAT IT IS FOR, and what it is not. It is a review sheet: the board's shape and colour at a size
you can read, from real rows, without a simulator. It is not evidence that the app runs. The
screenshots in `shots/drops/` are that.

`--board` takes what `GET /v1/drops` answers with. `--demo` builds the same sheet from the
cached corpus instead, for a machine with no stack up.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from PIL import Image, ImageDraw, ImageFont  # noqa: E402

MOBILE = ROOT / "mobile"
UNIT = 46

BUN_SCRIPT = """
const {board} = require('./src/drops/cluster.ts');
const {layout, fit} = require('./src/drops/layout.ts');
const {grow} = require('./src/drops/sigil.ts');
const {dropHue} = require('./src/theme.ts');
const {colors} = require('./src/theme.ts');
const drops = JSON.parse(process.env.DROPS_JSON);
const clusters = board(drops.map(d => ({kind: d.kind, title: d.title, summary: d.summary, tags: d.tags || []})));
const shape = layout(clusters);
const c = colors('dark');
const out = {
  hubs: shape.hubs,
  extent: shape.extent,
  palette: {bg: c.bg, border: c.border, text: c.text, textDim: c.textDim, textFaint: c.textFaint, accent: c.accent, raised: c.raised},
  nodes: shape.nodes.map(n => {
    const d = drops[n.index];
    const hue = d.kind ? dropHue(d.kind) : null;
    return {
      ...n,
      title: d.title || d.url,
      kind: d.kind, status: d.status, refusal: d.refusal,
      ink: hue ? hue.ink : c.textFaint,
      partner: hue ? hue.partner : c.border,
      grid: grow(d.url),
    };
  }),
};
console.log(JSON.stringify(out));
"""


def shape_from(drops: list[dict]) -> dict:
    import os

    # The rows go through the ENVIRONMENT, not argv: `bun -e` puts its own arguments at indices
    # that move with the flags, and a board of a hundred drops is longer than some argv limits.
    env = {**os.environ, "DROPS_JSON": json.dumps(drops)}
    proc = subprocess.run(
        ["bun", "-e", BUN_SCRIPT], cwd=MOBILE, capture_output=True, text=True, check=False, env=env,
    )
    if proc.returncode != 0:
        raise SystemExit(f"bun failed:\n{proc.stderr[-2000:]}")
    return json.loads(proc.stdout)


def font(size: int, bold: bool = False):
    for name in (
        "/System/Library/Fonts/SFNSRounded.ttf",
        "/System/Library/Fonts/Supplemental/Menlo.ttc" if not bold else "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/SFNS.ttf",
    ):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def wrap(d, text: str, f, width: float) -> list[str]:
    out: list[str] = []
    line = ""
    for word in (text or "").split():
        trial = f"{line} {word}".strip()
        if d.textlength(trial, font=f) <= width or not line:
            line = trial
        else:
            out.append(line)
            line = word
    if line:
        out.append(line)
    return out


def render(shape: dict, out: pathlib.Path, *, width: int = 1170, height: int = 2000, scale: float | None = None) -> None:
    p = shape["palette"]
    img = Image.new("RGB", (width, height), p["bg"])
    d = ImageDraw.Draw(img)

    ext = shape["extent"]
    bw = (ext["maxX"] - ext["minX"]) * UNIT
    bh = (ext["maxY"] - ext["minY"]) * UNIT
    k = scale or min(width / max(bw, 1), height / max(bh, 1)) * 0.92
    cx = (ext["minX"] + ext["maxX"]) / 2 * UNIT
    cy = (ext["minY"] + ext["maxY"]) / 2 * UNIT
    ox = width / 2 - cx * k
    oy = height / 2 - cy * k

    def X(u: float) -> float:
        return u * UNIT * k + ox

    def Y(u: float) -> float:
        return u * UNIT * k + oy

    # The field. Same pitch and radius as Board.tsx.
    pitch, dot_r = 0.5, 0.028
    x = ext["minX"] - 2
    while x <= ext["maxX"] + 2:
        y = ext["minY"] - 2
        while y <= ext["maxY"] + 2:
            r = max(1.0, dot_r * UNIT * k)
            d.ellipse([X(x) - r, Y(y) - r, X(x) + r, Y(y) + r], fill=p["border"])
            y += pitch
        x += pitch

    hubs = {h["cluster"]: h for h in shape["hubs"]}

    # Threads, under the sigils.
    for n in shape["nodes"]:
        if n["isHub"]:
            continue
        h = hubs[n["cluster"]]
        d.line([X(h["x"]), Y(h["y"]), X(n["x"]), Y(n["y"])], fill=n["partner"], width=max(1, int(k)))

    # Sigils.
    for n in shape["nodes"]:
        grid = n["grid"]
        side = UNIT * k
        cell = side / len(grid)
        gx = X(n["x"]) - side / 2
        gy = Y(n["y"]) - side / 2
        partial = n["status"] in ("waiting", "resolving")
        rows = grid if not partial else grid
        for ri, row in enumerate(rows):
            for ci, tone in enumerate(row):
                if not tone:
                    continue
                d.rectangle(
                    [gx + ci * cell, gy + ri * cell, gx + (ci + 1) * cell, gy + (ri + 1) * cell],
                    fill=n["ink"] if tone == 1 else n["partner"],
                )

    # Words. The phone wraps a title to two lines in a fixed 112 pt column; this sheet does the
    # same, because a title set on one long line overlaps its neighbours and makes the map look
    # busier than the app is.
    hub_f = font(max(11, int(13 * k)))
    node_f = font(max(10, int(12 * k)))
    for h in shape["hubs"]:
        label = h["label"].upper()
        w = d.textlength(label, font=hub_f)
        top = Y(h["top"] - 0.86)
        d.text((X(h["x"]) - w / 2, top), label, font=hub_f, fill=p["textDim"])
    column = 112 * k
    for n in shape["nodes"]:
        lines = wrap(d, n["title"] or "", node_f, column)[:2]
        for i, line in enumerate(lines):
            w = d.textlength(line, font=node_f)
            d.text(
                (X(n["x"]) - w / 2, Y(n["y"]) + UNIT * k * 0.56 + i * node_f.size * 1.25),
                line, font=node_f, fill=p["textFaint"],
            )

    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out)
    print(f"wrote {out} ({len(shape['nodes'])} drops, {len(shape['hubs'])} clusters)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--board", help="what GET /v1/drops answered with")
    ap.add_argument("--demo", action="store_true", help="use the cached corpus instead")
    ap.add_argument("--out", default="shots/drops/board.png")
    ap.add_argument("--width", type=int, default=1170)
    ap.add_argument("--height", type=int, default=2000)
    args = ap.parse_args()

    if args.demo:
        from drops.tests import corpus_read

        drops = [
            {"kind": r["kind"], "title": r["title"], "summary": r["summary"], "tags": r["tags"],
             "url": r["url"], "status": "planned", "refusal": None}
            for r in corpus_read.drops()
        ]
    else:
        raw = json.loads(pathlib.Path(args.board).read_text())
        drops = [
            {
                "kind": x["kind"], "title": x["title"], "summary": x["summary"],
                "tags": (x.get("resolution") or {}).get("plan", {}).get("tags") if x.get("resolution") else [],
                "url": x["url"], "status": x["status"], "refusal": x["refusal"],
            }
            for x in raw["drops"]
        ]
    render(shape_from(drops), pathlib.Path(args.out), width=args.width, height=args.height)


if __name__ == "__main__":
    main()
