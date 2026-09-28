"""Run the renderer (trailer/, Node) and keep what it made, beside the project's demo.

    ~/.builder/demos/<key>/trailer/
        facts.json            what the trailer may show (facts.py), rewritten on every cut
        cut.json              the current cut
        cuts/NNNN.json        every cut there has been, by version: any can come back
        notes.jsonl           every note and its answer, as the Mac heard it
        render/               the current render: trailer-<format>.mp4, poster-<format>.jpg,
                              trailer.gif, render.json

Nothing leaves the Mac from here; the trailer travels with the ship kit (`demo kit --publish`,
`watch --publish-requests`), in its own slots, under the same listing and the same yes.
"""

from __future__ import annotations

import json
import os
import pathlib
import re
import shutil
import subprocess

from capture.demo import paths

from . import tables

#: The oldest Node that strips TypeScript types on require: the renderer reads the app's own
#: motion and pixel modules (mobile/src/motion/*.ts) that way.
NODE_MIN = (22, 18)
#: A render longer than this is a hang, not a slow Mac (MEASURED: four formats of a 20 s cut in
#: 207 s on 16 cores; a four core Mac takes about four times that).
TIMEOUT_S = 1800


class RenderError(Exception):
    def __init__(self, code: str, detail: str = ""):
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code


def repo_root() -> pathlib.Path:
    return pathlib.Path(__file__).resolve().parents[2]


def renderer() -> pathlib.Path:
    return repo_root() / "trailer"


def trailer_dir(key: str) -> pathlib.Path:
    return paths.out_dir(key) / "trailer"


def node() -> str:
    """The node to render with, or RenderError("no_node")."""
    exe = os.environ.get("BUILDER_NODE") or shutil.which("node")
    if not exe:
        raise RenderError("no_node", "node is not on PATH")
    r = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=20, check=False)
    m = re.match(r"v(\d+)\.(\d+)", r.stdout.strip())
    if not m or (int(m.group(1)), int(m.group(2))) < NODE_MIN:
        raise RenderError("no_node", f"{r.stdout.strip() or 'no version'} is older than {NODE_MIN[0]}.{NODE_MIN[1]}")
    return exe


def ensure_packages(exe: str) -> None:
    """trailer/node_modules, installed once from the lockfile (`npm ci`), never upgraded here."""
    root = renderer()
    if (root / "node_modules" / "@napi-rs" / "canvas").is_dir():
        return
    npm = shutil.which("npm") or str(pathlib.Path(exe).with_name("npm"))
    r = subprocess.run([npm, "ci", "--no-audit", "--no-fund"], cwd=root, capture_output=True, text=True, timeout=600, check=False)
    if r.returncode != 0:
        raise RenderError("no_node", f"npm ci in trailer/ failed: {r.stderr.strip()[-300:]}")


def history(key: str) -> dict[int, dict]:
    d = trailer_dir(key) / "cuts"
    out: dict[int, dict] = {}
    if d.is_dir():
        for p in d.glob("*.json"):
            try:
                c = json.loads(p.read_text())
                out[int(c["version"])] = c
            except (ValueError, KeyError):
                continue
    return out


def current(key: str) -> dict | None:
    p = trailer_dir(key) / "cut.json"
    return json.loads(p.read_text()) if p.is_file() else None


def save_cut(key: str, cut: dict) -> None:
    d = trailer_dir(key)
    (d / "cuts").mkdir(parents=True, exist_ok=True)
    text = json.dumps(cut, indent=1, ensure_ascii=False)
    (d / "cuts" / f"{cut['version']:04d}.json").write_text(text)
    (d / "cut.json").write_text(text)


def log_note(key: str, entry: dict) -> None:
    d = trailer_dir(key)
    d.mkdir(parents=True, exist_ok=True)
    with (d / "notes.jsonl").open("a") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def render(key: str, facts: dict, cut: dict, *, formats: list[str] | None = None, draft: bool = False,
           gif: bool = True, say=print) -> dict:
    """Render `cut` of `facts` into trailer/render (replacing the last render only once the new one
    is whole). Returns render.json. `draft` renders at half size with no motion blur, for a quick
    look; a draft is never published (render.json says `draft`)."""
    exe = node()
    ensure_packages(exe)
    d = trailer_dir(key)
    d.mkdir(parents=True, exist_ok=True)
    (d / "facts.json").write_text(json.dumps(facts, indent=1, ensure_ascii=False))
    (d / "cut.json").write_text(json.dumps(cut, indent=1, ensure_ascii=False))
    out = d / "render-new"
    shutil.rmtree(out, ignore_errors=True)
    fmts = formats or ["vertical", "feed", "landscape", "square"]
    cmd = [exe, str(renderer() / "bin" / "render.js"), "--facts", str(d / "facts.json"), "--cut", str(d / "cut.json"),
           "--out", str(out), "--formats", ",".join(fmts)]
    if draft:
        cmd += ["--scale", "0.5", "--blur", "1", "--preset", "veryfast"]
    if gif and "square" in fmts and not draft:
        cmd.append("--gif")
    say(f"cutting version {cut['version']}: {', '.join(fmts)}{' (draft)' if draft else ''}")
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=TIMEOUT_S, check=False)
    if r.returncode != 0:
        raise RenderError("render_failed", r.stderr.strip()[-600:])
    made = json.loads((out / "render.json").read_text())
    made["draft"] = draft
    made["trailer_version"] = tables.TRAILER_VERSION
    (out / "render.json").write_text(json.dumps(made, indent=2))
    final = d / "render"
    old = d / "render-old"
    shutil.rmtree(old, ignore_errors=True)
    if final.exists():
        final.rename(old)
    out.rename(final)
    shutil.rmtree(old, ignore_errors=True)
    return made
