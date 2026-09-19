"""Stage 6: when the project will not run, pictures that are real, each saying where it came from.

In this order (docs/research/demo-capture.md section 3, "When a project will not run"):

1. `previous`    the last good capture of this project: a run whose privacy check passed,
                 kept in the work dir (`last-good/`) every time one succeeds
2. `checkout`    images already in the checkout: the README's own images first, then `shots/`,
                 `screenshots/`, `verification-screenshots/`, `docs/` and the like, newest
                 commit first, phone shaped ones first for an iOS app
3. `transcript`  images a Claude Code session read while working in the project (a Read of a
                 screenshot), when the file is still on disk

NEVER a generated picture of the product. RepoClip draws illustrations of a repository it never
ran (research section 1), and a demo that looks like the product without being it is the
plausible wrong number of pictures. When none of the three has anything, the demo is refused
with the reason, and the phone says so in words.
"""

from __future__ import annotations

import json
import os
import pathlib
import re
import shutil
import subprocess

from . import devices, manifest

IMAGE_DIRS = (
    "shots", "screenshots", "screenshot", "verification-screenshots", "docs", "doc", "media",
    "assets/screenshots", ".github", "images", "img", "demo", "demos", "preview", "previews",
)  # fmt: skip
_IMG = re.compile(r"\.(png|jpe?g)$", re.IGNORECASE)
#: Pixel sizes an iPhone or iPad screenshot comes out at (simulator or device), from the device
#: table (spec/devices.v1.json), both ways round. FOUND ON THE FIRST RIDEGT FALLBACK: "phone
#: shaped" alone ranked the ad portal's 1440 by 2996 templates above the app's own 1179 by 2556
#: screenshots in the same folder. The list this replaced was typed here and had no iPhone Air and
#: no iPad Pro of 2024, so their screenshots ranked as pictures of nothing in particular.
DEVICE_SIZES = frozenset(
    (w, h) for d in devices.DEVICES if d["family"] in ("iphone", "ipad") for w, h in (d["pixels"], d["pixels"][::-1])
)
_README_IMG = re.compile(r"!\[[^\]]*\]\(([^)\s]+)|<img[^>]+src=[\"']([^\"']+)[\"']", re.IGNORECASE)
#: Too small to be a screen: icons, badges, favicons.
MIN_SIDE = 320
MAX_BYTES = 12_000_000


NEUTRAL_LABEL = "a picture from the repository"


def label_from_name(path: str) -> str:
    """`08-clough-directions.png` -> "clough directions": plain words from the file name, held
    to the label rule (letters and digits, no word over 24 characters, at most 80), else a
    neutral label rather than a file name read out as an id."""
    stem = pathlib.Path(path).stem
    words = [w for w in re.split(r"[^A-Za-z0-9]+", stem) if w and not w.isdigit()]
    words = [w for w in words if not re.fullmatch(r"\d+x\d+|v\d+|final|img|image|screenshot|screen|shot", w.lower())]
    words = [w.lower() for w in words if len(w) <= 24 and not re.fullmatch(r"[0-9a-f]{8,}", w.lower())]
    label = ""
    for w in words:
        if len(label) + len(w) + 1 > 80:
            break
        label = f"{label} {w}".strip()
    if not label or not any(c.isalpha() for c in label):
        return NEUTRAL_LABEL
    from .storyboard import label_refusal

    return NEUTRAL_LABEL if label_refusal(label) else label


def _git_times(top: pathlib.Path) -> dict[str, int]:
    """Last commit time of every tracked image, one `git log` for all of them."""
    try:
        r = subprocess.run(
            ["git", "log", "--format=@%ct", "--name-only", "--diff-filter=AM", "--", "*.png", "*.jpg", "*.jpeg", "*.PNG", "*.JPG"],
            cwd=str(top), capture_output=True, text=True, timeout=60, check=False,
        )  # fmt: skip
    except (OSError, subprocess.SubprocessError):
        return {}
    times: dict[str, int] = {}
    cur = 0
    for line in r.stdout.splitlines():
        if line.startswith("@"):
            cur = int(line[1:])
        elif line.strip():
            times.setdefault(line.strip(), cur)
    return times


def _usable(p: pathlib.Path) -> tuple[int, int] | None:
    try:
        if p.stat().st_size > MAX_BYTES:
            return None
        w, h = manifest.image_size(p)
    except (OSError, ValueError):
        return None
    return (w, h) if min(w, h) >= MIN_SIDE else None


def checkout_images(top: pathlib.Path, kind: str | None, limit: int = 6) -> list[tuple[pathlib.Path, str]]:
    """Up to `limit` images from the checkout: README images, then the image folders.

    Never a picture reached through a symlink, and never one whose real path is outside the
    checkout (`_inside`, the review's item 3): a tracked `docs -> /etc` link, or a `shots/x.png`
    that is a link out of the tree, would otherwise be published as if it were the project's."""
    from .workspace import _inside

    found: list[pathlib.Path] = []
    readme = next((top / n for n in ("README.md", "readme.md") if (top / n).exists()), None)
    if readme is not None and not (top / readme.name).is_symlink():
        for m in _README_IMG.finditer(readme.read_text(errors="replace")):
            ref = m.group(1) or m.group(2)
            if ref.startswith(("http://", "https://", "data:")):
                continue
            p = top / ref.split("#")[0].split("?")[0]
            if p.is_file() and _IMG.search(p.name) and _inside(top, p):
                found.append(p)
    times = _git_times(top)
    folder: list[pathlib.Path] = []
    for d in IMAGE_DIRS:
        base = top / d
        if not base.is_dir() or base.is_symlink():
            continue
        for dirpath, dirnames, filenames in os.walk(base, followlinks=False):
            dirnames[:] = [x for x in dirnames if x not in ("node_modules", ".git")]
            for f in filenames:
                p = pathlib.Path(dirpath) / f
                if _IMG.search(f) and not p.is_symlink() and _inside(top, p):
                    folder.append(p)

    def rank(p: pathlib.Path):
        rel = str(p.relative_to(top)) if str(p).startswith(str(top)) else str(p)
        size = _usable(p) or (0, 0)
        device = size in DEVICE_SIZES or (size[1], size[0]) in DEVICE_SIZES
        named = label_from_name(p.name) != NEUTRAL_LABEL
        try:
            mtime = int(p.stat().st_mtime)
        except OSError:
            mtime = 0
        # A real device screenshot first (for an iOS app), then one whose file name says what
        # it shows, then the newest.
        return (not (kind == "expo_ios" and device), not named, -times.get(rel, mtime), rel)

    folder.sort(key=rank)
    out: list[tuple[pathlib.Path, str]] = []
    seen: set[str] = set()
    # One picture per label first, then the rest: FOUND ON THE FOURTH RIDEGT RUN, the newest
    # six in verification-screenshots/ were glow-25 to glow-30, six takes of one effect.
    labels: set[str] = set()
    later: list[tuple[pathlib.Path, str]] = []
    for p in found + folder:
        if str(p) in seen or _usable(p) is None:
            continue
        seen.add(str(p))
        label = label_from_name(p.name)
        if label in labels:
            later.append((p, label))
            continue
        labels.add(label)
        out.append((p, label))
        if len(out) >= limit:
            break
    return (out + later)[:limit]


def transcript_images(images: list[tuple[str, float]], limit: int = 6) -> list[tuple[pathlib.Path, str]]:
    out = []
    for path, _ts in images:
        p = pathlib.Path(path)
        if p.is_file() and _usable(p) is not None:
            out.append((p, "a screenshot read in a Claude Code session"))
        if len(out) >= limit:
            break
    return out


def last_good(work_root: pathlib.Path) -> tuple[dict, pathlib.Path] | None:
    d = work_root / "last-good"
    m = d / "manifest.json"
    if not m.is_file():
        return None
    try:
        data = json.loads(m.read_text())
    except ValueError:
        return None
    if manifest.validate(data, d):
        return None
    return data, d


def keep_last_good(work_root: pathlib.Path, out_dir: pathlib.Path, m: dict) -> None:
    """Copy a clean capture into `last-good/`, the first fallback of the next run that fails."""
    if m["privacy"]["refused"] or not any(a["source"] == "capture" for a in m["assets"]):
        return
    d = work_root / "last-good"
    tmp = work_root / "last-good.tmp"
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(parents=True)
    names = {a["file"] for a in m["assets"]} | {a["poster"] for a in m["assets"] if a["kind"] == "video"}
    for n in names:
        shutil.copyfile(out_dir / n, tmp / n)
    (tmp / "manifest.json").write_text(json.dumps(m, indent=1) + "\n")
    if d.exists():
        shutil.rmtree(d)
    os.replace(tmp, d)
