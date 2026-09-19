#!/usr/bin/env python3
"""Stills of every ship kit on this Mac, for looking at: shots/motion/shipkit/.

For each demo with a kit (`python -m capture demo kit`): one frame of each social format (the
poster baked into it as frame 0, so exactly what a platform shows before it plays), one framed
still, and a contact sheet putting them side by side at one height, so a phone of the wrong shape
next to one of the right shape is plain at a glance. Also a table of the device's measured aspect
in every format (the kit's own checks.json), which docs/ship-kit.md quotes.

    python3 scripts/shipkit_shots.py [--out shots/motion/shipkit]
"""

from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from capture.demo import paths, tools  # noqa: E402


def frame0(ff: str, video: pathlib.Path, out: pathlib.Path) -> None:
    subprocess.run([ff, "-y", "-hide_banner", "-loglevel", "error", "-i", str(video), "-frames:v", "1", str(out)], check=True)


def sheet(ff: str, images: list[pathlib.Path], out: pathlib.Path, height: int = 640) -> None:
    """The images side by side at one height, each at its own aspect (never stretched)."""
    args = [ff, "-y", "-hide_banner", "-loglevel", "error"]
    for p in images:
        args += ["-i", str(p)]
    chains = [f"[{i}:v]scale=-2:{height}:flags=lanczos,pad=iw+24:ih:12:0:color=0x0b0a09[s{i}]" for i in range(len(images))]
    graph = ";".join(chains) + ";" + "".join(f"[s{i}]" for i in range(len(images))) + f"hstack=inputs={len(images)}[out]"
    subprocess.run(args + ["-filter_complex", graph, "-map", "[out]", "-frames:v", "1", str(out)], check=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", default=str(ROOT / "shots" / "motion" / "shipkit"))
    a = ap.parse_args()
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    ff = tools.ffmpeg()
    rows = []
    for d in sorted(p for p in paths.demos_dir().iterdir() if (p / "kit" / "kit.json").is_file()):
        kit = json.loads((d / "kit" / "kit.json").read_text())
        checks = json.loads((d / "kit" / "checks.json").read_text())
        tag = f"{kit['device']['id'] if kit['device'] else 'terminal'}-{d.name[:6]}"
        made = []
        for f in kit["formats"]:
            p = out / f"{tag}-{f['id']}.png"
            frame0(ff, d / "kit" / f["file"], p)
            made.append(p)
            c = checks["formats"].get(f["id"], {}).get("aspect") or {}
            rows.append((tag, f["id"], f"{f['width']}x{f['height']}", c.get("measured"), c.get("want_aspect"), c.get("got_aspect")))
        if kit["framed"]:
            src = d / "kit" / kit["framed"][0]["file"]
            p = out / f"{tag}-framed-still.png"
            subprocess.run([ff, "-y", "-loglevel", "error", "-i", str(src), str(p)], check=True)
            made.append(p)
        if kit["before_after"]:
            p = out / f"{tag}-before-after.png"
            subprocess.run([ff, "-y", "-loglevel", "error", "-i", str(d / "kit" / kit["before_after"][0]["file"]), str(p)], check=True)
        if made:
            sheet(ff, made, out / f"{tag}-contact-sheet.png")
        print(f"{tag}: {len(made)} stills and a contact sheet")
    table = ["| demo | format | canvas | screen measured | device aspect | measured aspect |", "|---|---|---|---|---|---|"]
    table += [f"| {t} | {f} | {c} | {m[0]}x{m[1] if m else ''} | {w} | {g} |" if m else f"| {t} | {f} | {c} | refused | {w} | {g} |" for t, f, c, m, w, g in rows]
    (out / "aspects.md").write_text("\n".join(table) + "\n")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
