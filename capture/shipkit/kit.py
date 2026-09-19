"""`python -m capture demo kit`: everything a builder posts beside a demo, made from it, on the Mac.

A demo (`python -m capture demo`) is stills and one portrait video of the app running. What a
person actually shares is more than that, and this makes all of it, proactively, as local files
(docs/ship-kit.md; nothing leaves until `kit --publish`, which lists every file and waits for a yes):

    kit/video-<format>.mp4     the demo in each social format of spec/devices.v1.json (9:16, 4:5,
                               16:9, 1:1), the device drawn at its own shape (`frame.py`), each with
                               its poster baked in as frame 0 and `poster-<format>.jpg` beside it
    kit/loop.gif               the square format as a GIF, for a README or a chat with no video
    kit/framed/still-NN.png    each still in the 4:5 frame, ready for a carousel
    kit/before-after-NN.png    the same screen at the last demo and now, when there was a last demo
    kit/app-store/<slot>/NN.png the stills at the App Store's own sizes, for an iOS app
    kit/share-copy.json        a caption per platform, checked (`copy.py`)
    kit/changelog.json / .md   the commits since the last demo, as written
    kit/kit.json               every file above with its size, and every refusal with its code
    kit/checks.json            the measurements: the device's aspect in every format, the blank
                               screen scan, the numbers the captions were held to

Every refusal is a code from spec/shipkit.v1.json with its sentence (`tables.REFUSALS`), so a kit
that could not make one format still makes the others and says which and why.
"""

from __future__ import annotations

import argparse
import dataclasses
import datetime as dt
import json
import os
import pathlib
import shutil
import subprocess
import sys

from capture.demo import compose, devices, manifest, paths, pictures, privacy, tools
from capture.demo.result import CaptureError

from . import copy as kcopy
from . import frame as fr
from . import tables

KIT_DIR = "kit"
HISTORY_DIR = "kit-history"
FORMATS = [f["id"] for f in devices.FORMATS]
#: The format the stills are framed in: 4:5 is what a carousel of screenshots is posted at.
STILL_FORMAT = "feed"
#: How many earlier kits' stills are kept for before and after, oldest dropped first.
HISTORY_KEEP = 6

#: The hues a project wears, in the order the phone deals them: mobile/src/projects/model.ts
#: `PROJECT_HUES`, restated because capture imports no TypeScript; `test_shipkit` reads that file
#: and holds this list to it, so the kit's band is the colour the project page wears.
PROJECT_HUES = ["tide", "ember", "iris", "brass", "orchid", "cobalt", "coral", "heather"]


def say(msg: str = "") -> None:
    print(msg, file=sys.stderr, flush=True)


def preferred_hue(key: str) -> str:
    """The hue a project key asks for: its first eight hex digits round the ring (the phone's
    `preferredHue`, pure)."""
    return PROJECT_HUES[int(key[:8], 16) % len(PROJECT_HUES)]


def hue_ink(name: str) -> str:
    """The band's colour: the hue's `partner` tone from design/tokens.json, the dither's middle
    tone, which sits under white text and beside the warm ground without shouting."""
    tokens = json.loads((paths_root() / "design" / "tokens.json").read_text())
    return tokens["spectrum"]["hues"][name]["partner"]


def paths_root() -> pathlib.Path:
    return pathlib.Path(__file__).resolve().parents[2]


def refusal(what: str, code: str) -> dict:
    return {"what": what, "code": code, "sentence": tables.REFUSALS[code]}


# ------------------------------------------------------------------------ the demo read


@dataclasses.dataclass
class Demo:
    key: str
    dir: pathlib.Path
    manifest: dict
    capture: dict
    device: dict | None
    video: pathlib.Path | None
    stills: list[dict]

    @property
    def commit(self) -> str:
        return self.manifest["commit"]


def load_demo(key: str) -> Demo:
    d = paths.out_dir(key)
    mpath = d / "manifest.json"
    if not mpath.is_file():
        raise CaptureError(f"no demo for this project at {d} (make one with `python -m capture demo`)")
    m = json.loads(mpath.read_text())
    problems = manifest.validate(m, d)
    if problems:
        raise CaptureError(f"the demo's manifest is not one this reads: {'; '.join(problems[:3])}")
    cap = {}
    if (d / "capture.json").is_file():
        cap = json.loads((d / "capture.json").read_text())
    video = next((d / a["file"] for a in m["assets"] if a["kind"] == "video"), None)
    stills = sorted((a for a in m["assets"] if a["kind"] == "image"), key=lambda a: a["position"])
    device = device_of(cap, m)
    return Demo(key, d, m, cap, device, video, stills)


def device_of(cap: dict, m: dict) -> dict | None:
    """The row the demo was filmed on: `capture.json` says so since the device table; an older
    demo is matched by its pixels, the video's first (`devices.match_pixels`). None for a terminal
    (a CLI or a library), whose canvas is the table's terminal format."""
    if cap.get("device"):
        return devices.by_id(cap["device"])
    if m["kind"] in ("cli", "library"):
        return None
    for a in sorted(m["assets"], key=lambda a: a["kind"] != "video"):
        if a["source"] in ("capture", "previous"):
            row = devices.match_pixels(a["width"], a["height"])
            if row is not None:
                return row
            # A web recording is CSS pixels: the row whose POINTS these are.
            row = next((d for d in devices.DEVICES if d["points"] == [a["width"], a["height"]]), None)
            if row is not None:
                return row
    return devices.default_phone()


# ------------------------------------------------------------------------ the poster


#: A hold this long in the finished video is a settled screen a poster may be taken from.
POSTER_HOLD = 0.6


def poster_candidates(holds: list[tuple[float, float]], timeline: list[dict], duration: float) -> list[float]:
    """Moments the finished video shows a SETTLED screen: the middle of every hold at least
    `POSTER_HOLD` long (`freezedetect` over the video itself), else just before each beat's next
    crossfade, else the middle (pure).

    FOUND ON THE FIRST KIT (the Builda demo, 2026-09-19): candidates spread evenly over a video
    made before timelines were written landed in crossfades, and the one with the most text on it
    was two screens on top of each other, which read as the richest frame precisely because it
    was two. A hold cannot be a crossfade: its frames do not change."""
    out = [round((s + e) / 2, 3) for s, e in holds if e - s >= POSTER_HOLD and e <= duration]
    if out:
        return out
    if timeline:
        for k, b in enumerate(timeline):
            end = float(b["end"]) - (compose.FADE if k < len(timeline) - 1 else 0.0) - 0.3
            out.append(round(max(float(b["start"]) + 0.2, end), 3))
        return out
    return [round(duration / 2, 3)]


def holds_in(video: pathlib.Path) -> list[tuple[float, float]]:
    """The still stretches of a video, from ffmpeg's `freezedetect` (compose's own settings)."""
    ff = tools.ffmpeg()
    info = compose.probe(video)
    r = subprocess.run(compose.freeze_command(ff, str(video)), capture_output=True, text=True, timeout=600, check=False)
    return compose.parse_freezes(r.stderr, info["duration"])


def pick_poster(scores: list[tuple[float, int, float]]) -> int:
    """The index of the candidate with the most on screen: (time, text lines Vision read, grey
    spread); the most lines wins, then the widest spread, then the earliest (pure). Brag's rule
    is "a frame that is postable on its own", and a settled screen with the most words on it is
    the one that says the most about the app without the video playing."""
    best = 0
    for i, (_, lines, std) in enumerate(scores):
        _, bl, bs = scores[best]
        if (lines, round(std)) > (bl, round(bs)):
            best = i
    return best


def score_frames(ff: str, video: pathlib.Path, times: list[float], work: pathlib.Path) -> list[tuple[float, int, float]]:
    frames = []
    for k, t in enumerate(times):
        p = work / f"poster-candidate-{k:02d}.png"
        subprocess.run([ff, "-y", "-hide_banner", "-loglevel", "error", "-ss", f"{t:.3f}", "-i", str(video), "-frames:v", "1", str(p)],
                       check=True, capture_output=True, timeout=60)  # fmt: skip
        frames.append(p)
    try:
        read = {pathlib.Path(r["file"]).name: len(r.get("lines") or []) for r in privacy.ocr(frames)}
    except (RuntimeError, tools.ToolError):
        read = {}
    r = subprocess.run([str(tools.helper()), "stats", *map(str, frames)], capture_output=True, text=True, timeout=120, check=False)
    stds = {pathlib.Path(x["file"]).name: float(x.get("std", 0)) for x in json.loads(r.stdout)} if r.returncode == 0 else {}
    return [(t, read.get(p.name, 0), stds.get(p.name, 0.0)) for t, p in zip(times, frames)]


def change_times(video: pathlib.Path, timeline: list[dict], work: pathlib.Path) -> dict[int, float]:
    """For each beat with a tap: when its screen first changed after its crossfade, from the
    video itself (10 frames a second, difference hashes), so a ring lands just before the app
    reacts rather than where a clock guessed it would."""
    out: dict[int, float] = {}
    ff = tools.ffmpeg()
    for k, b in enumerate(timeline):
        if not b.get("tap"):
            continue
        start = float(b["start"]) + (compose.FADE if k else 0.0)
        end = float(b["end"])
        if end - start < 0.4:
            continue
        d = work / f"change-{k:02d}"
        shutil.rmtree(d, ignore_errors=True)
        d.mkdir(parents=True)
        subprocess.run([ff, "-y", "-hide_banner", "-loglevel", "error", "-ss", f"{start:.3f}", "-t", f"{end - start:.3f}", "-i", str(video),
                        "-vf", "fps=10,scale=96:-2", str(d / "f-%04d.png")], check=True, capture_output=True, timeout=120)  # fmt: skip
        files = sorted(d.glob("f-*.png"))
        if len(files) < 2:
            continue
        prints = pictures.fingerprints(files)
        first = prints[0]
        for i, p in enumerate(prints[1:], 1):
            if not pictures.same_picture(first, p):
                out[k] = round(start + i / 10, 3)
                break
    return out


# ------------------------------------------------------------------------ the kit


@dataclasses.dataclass
class Plan:
    """What `build` will make, before it makes any of it (`--dry-run` prints this)."""

    demo: Demo
    hue: str
    title: str | None
    formats: list[tuple[str, dict | None, pathlib.Path | None, list[dict], fr.Layout]]
    refused: list[dict]
    ios: bool
    previous: pathlib.Path | None


def plan(demo: Demo, hue: str | None, shipped: dict | None, names=(), others=()) -> Plan:
    refused: list[dict] = []
    h = hue if hue in tables.ENUMS["hue"] else preferred_hue(demo.key)
    title = (shipped or {}).get("what")
    if title and privacy.label_leaks([title], tuple(names), tuple(others)):
        title = None
    tl = demo.capture.get("timeline") or []
    desk = demo.capture.get("desktop") or None
    fmts = []
    if demo.video is None:
        refused.append(refusal("video", "no_video"))
    for fid in FORMATS:
        f = devices.fmt(fid)
        device, video, timeline = demo.device, demo.video, tl
        if fid == "landscape" and desk and desk.get("device") and (demo.dir / "desktop" / "demo.mp4").exists() and not (desk.get("privacy") or {}).get("refused"):
            # A website in a 16:9 post is a Mac window, not a phone in the middle of a wide frame.
            device, video, timeline = devices.by_id(desk["device"]), demo.dir / "desktop" / "demo.mp4", desk.get("timeline") or []
        fmts.append((fid, device, video, timeline, fr.layout(f, device, title=bool(title))))
    prev = previous_kit(demo)
    return Plan(demo, h, title, fmts, refused, demo.manifest["kind"] == "expo_ios", prev)


def history_root(key: str) -> pathlib.Path:
    return paths.out_dir(key) / HISTORY_DIR


def previous_kit(demo: Demo) -> pathlib.Path | None:
    """The newest earlier demo kept in the history whose commit is not this demo's."""
    root = history_root(demo.key)
    if not root.is_dir():
        return None
    entries = sorted((p for p in root.iterdir() if (p / "manifest.json").is_file()), key=lambda p: p.name, reverse=True)
    for p in entries:
        try:
            if json.loads((p / "manifest.json").read_text())["commit"] != demo.commit:
                return p
        except (ValueError, KeyError):
            continue
    return None


def remember(demo: Demo) -> None:
    """Keep this demo's manifest and stills in the history, for the next kit's before and after
    and changelog. At most `HISTORY_KEEP` entries."""
    root = paths.private_dir(history_root(demo.key))
    name = f"{demo.manifest['taken_at'].replace(':', '').replace('-', '')}-{demo.commit[:12]}"
    dest = root / name
    if not dest.exists():
        tmp = root / f".{name}.tmp"
        shutil.rmtree(tmp, ignore_errors=True)
        tmp.mkdir()
        for a in demo.stills:
            shutil.copyfile(demo.dir / a["file"], tmp / a["file"])
        (tmp / "manifest.json").write_text(json.dumps(demo.manifest, indent=1) + "\n")
        os.replace(tmp, dest)
    for old in sorted((p for p in root.iterdir() if p.is_dir() and not p.name.startswith(".")), key=lambda p: p.name)[:-HISTORY_KEEP]:
        shutil.rmtree(old, ignore_errors=True)


def changelog(src: pathlib.Path | None, since: str | None, until: str, cap: int = 30) -> list[dict]:
    """The commits after `since` up to `until`, newest first, as written: (sha, subject, when).
    With no `since`, the last `cap` commits. Every local branch is NOT walked: the demo is of one
    commit, and what is new in it is its own ancestry."""
    if src is None or not (src / ".git").exists():
        return []
    rng = f"{since}..{until}" if since else until
    r = subprocess.run(["git", "-C", str(src), "log", "--no-merges", f"-n{cap}", "--format=%H%x09%ct%x09%s", rng],
                       capture_output=True, text=True, timeout=60, check=False)  # fmt: skip
    out = []
    for line in r.stdout.splitlines():
        parts = line.split("\t", 2)
        if len(parts) == 3:
            out.append({"sha": parts[0], "when": int(parts[1]), "subject": parts[2][: tables.MAX_LENGTHS["subject"]]})
    return out


def app_store_set(demo: Demo, out: pathlib.Path) -> tuple[list[dict], list[dict]]:
    """The stills at the App Store's own pixel sizes (spec/devices.v1.json `app_store`), for an
    iOS app: scaled uniformly to cover the slot and centre cropped, never stretched, and only when
    the still's aspect is within 1% of the slot's (a phone's screenshot is not an iPad's). Returns
    (the sets, the refusals)."""
    sets, refused = [], []
    if demo.manifest["kind"] != "expo_ios":
        return [], [refusal("app_store", "not_an_ios_app")]
    ff = tools.ffmpeg()
    shots = [a for a in demo.stills if a["source"] == "capture"]
    for slot in devices.APP_STORE:
        row = devices.by_id(slot["device"])
        W, H = row["pixels"]
        if demo.device is not None and demo.device["family"] != row["family"]:
            refused.append(refusal(slot["id"], "no_ipad_capture" if row["family"] == "ipad" else "aspect_too_far"))
            continue
        files = []
        for a in shots[: tables.CAPS["app_store_each"]]:
            if abs((a["width"] / a["height"]) / (W / H) - 1) > 0.01:
                continue
            dest = paths.private_dir(out / slot["id"]) / f"{a['position']:02d}.png"
            subprocess.run([ff, "-y", "-hide_banner", "-loglevel", "error", "-i", str(demo.dir / a["file"]),
                            "-vf", f"scale={W}:{H}:force_original_aspect_ratio=increase:flags=lanczos,crop={W}:{H}",
                            "-frames:v", "1", str(dest)], check=True, capture_output=True, timeout=120)  # fmt: skip
            files.append({"file": str(dest.relative_to(out.parent)), "width": W, "height": H, "label": a["label"]})
        if files:
            sets.append({"slot": slot["id"], "label": slot["label"], "files": files})
        else:
            refused.append(refusal(slot["id"], "aspect_too_far"))
    return sets, refused


def make_gif(ff: str, square: pathlib.Path, out: pathlib.Path) -> tuple[dict | None, dict | None]:
    """The square video as a looping GIF at the table's loop size, then smaller until it fits."""
    w, h = devices.LOOP["size"]
    for fps, scale in ((devices.LOOP["fps"], 1.0), (10, 0.8), (8, 0.64)):
        sw, sh = fr.even(w * scale), fr.even(h * scale)
        vf = (f"fps={fps},scale={sw}:{sh}:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];"
              f"[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle")  # fmt: skip
        subprocess.run([ff, "-y", "-hide_banner", "-loglevel", "error", "-i", str(square), "-vf", vf, "-loop", "0", str(out)],
                       check=True, capture_output=True, timeout=600)  # fmt: skip
        if out.stat().st_size <= devices.LOOP["max_bytes"]:
            return {"file": out.name, "width": sw, "height": sh, "fps": fps, "bytes": out.stat().st_size}, None
    out.unlink(missing_ok=True)
    return None, refusal("loop", "loop_too_large")


def before_after(ff: str, demo: Demo, prev: pathlib.Path, device: dict | None, hue_hex: str, work: pathlib.Path, out: pathlib.Path) -> list[dict]:
    """The same screen then and now, side by side: stills paired by label (a storyboard's beats
    keep their labels from run to run), else the first still of each. Each half is the square
    format's frame, so the device is at its own shape in both."""
    old = json.loads((prev / "manifest.json").read_text())
    before = {a["label"]: a for a in old["assets"] if a["kind"] == "image"}
    pairs = [(before[a["label"]], a) for a in demo.stills if a["label"] in before]
    if not pairs and before and demo.stills:
        pairs = [(sorted(before.values(), key=lambda a: a["position"])[0], demo.stills[0])]
    made = []
    lay = fr.layout(devices.fmt("square"), device, title=True)
    mask = fr.draw_mask(lay, work / "ba-mask.png")
    when_then = old["taken_at"][:10]
    when_now = demo.manifest["taken_at"][:10]
    for i, (b, a) in enumerate(pairs[: tables.CAPS["before_after"]], 1):
        halves = []
        for tag, src, when in (("Before", prev / b["file"], when_then), ("Now", demo.dir / a["file"], when_now)):
            bg = fr.draw_backdrop(lay, hue_hex, f"{tag}, {when}", work / f"ba-bg-{i}-{tag}.png")
            halves.append(fr.frame_still(ff, src, lay, bg, mask, work / f"ba-{i}-{tag}.png"))
        dest = out / f"before-after-{i:02d}.png"
        subprocess.run([ff, "-y", "-hide_banner", "-loglevel", "error", "-i", str(halves[0]), "-i", str(halves[1]),
                        "-filter_complex", "[0:v][1:v]hstack=inputs=2", "-frames:v", "1", str(dest)],
                       check=True, capture_output=True, timeout=120)  # fmt: skip
        made.append({"file": dest.name, "width": lay.width * 2, "height": lay.height, "label": a["label"], "before_taken_at": old["taken_at"], "before_commit": old["commit"]})
    return made


def build(key: str, *, hue: str | None = None, shipped: dict | None = None, src: pathlib.Path | None = None,
          use_model: bool = True, dry_run: bool = False, names=(), others=(), only: list[str] | None = None) -> dict:  # fmt: skip
    """Make the kit for `key`'s demo (or, with `dry_run`, say what it would make and make nothing)."""
    demo = load_demo(key)
    pv = demo.manifest["privacy"]
    if not pv["checked"] or pv["refused"]:
        raise CaptureError(tables.REFUSALS["privacy_not_checked"])
    p = plan(demo, hue, shipped, names, others)
    formats = [f for f in p.formats if not only or f[0] in only]
    if dry_run:
        return describe(p, formats)
    ff = tools.ffmpeg()
    out = paths.private_dir(demo.dir / KIT_DIR)
    work = paths.private_dir(paths.work_dir(key) / "kit-work")
    for old in list(out.iterdir()):
        if old.is_dir():
            shutil.rmtree(old)
        else:
            old.unlink()
    refused = list(p.refused)
    checks: dict = {"formats": {}}
    kit: dict = {
        "version": tables.SHIPKIT_VERSION,
        "project_key": key,
        "commit": demo.commit,
        "taken_at": demo.manifest["taken_at"],
        "made_at": dt.datetime.now(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "device": {k: demo.device[k] for k in ("id", "name", "family", "points", "scale", "pixels", "corner_radius")} if demo.device else None,
        "hue": p.hue,
        "title": p.title,
        "formats": [],
        "stills": [],
        "framed": [],
        "loop": None,
        "before_after": [],
        "app_store": [],
        "poster": None,
    }
    band = hue_ink(p.hue)
    say(f"  kit for {key[:12]}: {demo.device['name'] if demo.device else 'a terminal'}, hue {p.hue}" + (f", titled {p.title!r}" if p.title else ""))
    poster_t = None
    if demo.video is not None:
        dur = compose.probe(demo.video)["duration"]
        tl = demo.capture.get("timeline") or []
        cands = poster_candidates(holds_in(demo.video), tl, dur)
        scores = score_frames(ff, demo.video, cands, work)
        best = pick_poster(scores)
        poster_t = scores[best][0]
        why = f"the settled frame with the most on screen: {scores[best][1]} lines of text, of {len(scores)} settled moments"
        kit["poster"] = {"at": poster_t, "beat": best if tl else None, "why": why}
        say(f"  poster at {poster_t:.2f} s ({why})")
    for fid, device, video, timeline, lay in formats:
        if video is None:
            continue
        try:
            say(f"  rendering {fid} {lay.width}x{lay.height}, the screen {lay.w}x{lay.h}")
            bg = fr.draw_backdrop(lay, band, p.title, work / f"bg-{fid}.png")
            mask = fr.draw_mask(lay, work / f"mask-{fid}.png")
            aspect = fr.check_aspect(ff, lay, device, mask, work)
            changes = change_times(video, timeline, work) if any(b.get("tap") for b in timeline) else {}
            ring_list = fr.rings(timeline, changes)
            ring = fr.draw_ring(max(8, fr.even(lay.w * fr.RING_SHARE)), work / f"ring-{fid}.png") if ring_list else None
            dur = compose.probe(video)["duration"]
            raw = work / f"video-{fid}-raw.mp4"
            subprocess.run(fr.render_command(ff, str(video), str(bg), str(mask), str(ring) if ring else None, len(ring_list), dur,
                                             fr.filter_graph(lay, timeline, ring_list), str(raw)),
                           check=True, capture_output=True, timeout=1800)  # fmt: skip
            blank = fr.check_blank(ff, raw, lay, work)
            final = out / f"video-{fid}.mp4"
            poster = out / f"poster-{fid}.jpg"
            pt = poster_t if (poster_t is not None and video == demo.video) else round(dur * 0.5, 3)
            subprocess.run([ff, "-y", "-hide_banner", "-loglevel", "error", "-ss", f"{min(pt, dur - 0.05):.3f}", "-i", str(raw),
                            "-frames:v", "1", "-q:v", "2", str(poster)], check=True, capture_output=True, timeout=60)  # fmt: skip
            subprocess.run(fr.bake_poster_command(ff, str(raw), str(poster), str(final)), check=True, capture_output=True, timeout=1800)
            info = compose.probe(final)
            kit["formats"].append({
                "id": fid, "label": devices.fmt(fid)["label"], "file": final.name, "poster": poster.name,
                "width": info["width"], "height": info["height"], "duration_ms": round(info["duration"] * 1000),
                "bytes": final.stat().st_size, "device": device["id"] if device else None, "rings": len(ring_list),
            })  # fmt: skip
            checks["formats"][fid] = {"aspect": aspect, "blank": blank, "rings": [dataclasses.asdict(r) for r in ring_list]}
        except (fr.FrameError, subprocess.CalledProcessError, CaptureError) as e:
            code = getattr(e, "code", "render_failed")
            say(f"    {fid} refused: {code}: {e}")
            refused.append(refusal(fid, code if code in tables.ENUMS["kit_refusal"] else "render_failed"))
            checks["formats"][fid] = {"refused": code, "detail": str(e)[-300:]}
    square = out / "video-square.mp4"
    if square.exists():
        loop, why = make_gif(ff, square, out / "loop.gif")
        kit["loop"] = loop
        if why:
            refused.append(why)
    # The stills, as they are and framed at 4:5.
    lay = fr.layout(devices.fmt(STILL_FORMAT), demo.device, title=False)
    smask = fr.draw_mask(lay, work / "still-mask.png")
    sbg = fr.draw_backdrop(lay, band, None, work / "still-bg.png")
    framed_dir = paths.private_dir(out / "framed")
    for a in demo.stills:
        kit["stills"].append({"file": f"../{a['file']}", "label": a["label"], "width": a["width"], "height": a["height"], "source": a["source"]})
        if a["source"] != "capture" or (devices.match_pixels(a["width"], a["height"]) is None and demo.device and demo.device["family"] != "mac"):
            continue
        dest = framed_dir / f"still-{a['position']:02d}.png"
        try:
            fr.frame_still(ff, demo.dir / a["file"], lay, sbg, smask, dest)
            kit["framed"].append({"file": f"framed/{dest.name}", "label": a["label"], "width": lay.width, "height": lay.height})
        except fr.FrameError as e:
            refused.append(refusal(f"framed {a['file']}", e.code))
    if p.previous is not None:
        kit["before_after"] = before_after(ff, demo, p.previous, demo.device, band, work, out)
    else:
        refused.append(refusal("before_after", "no_previous_demo"))
    sets, why = app_store_set(demo, out / "app-store")
    kit["app_store"] = sets
    refused.extend(why)
    # What changed, and the words to post it with.
    since = json.loads((p.previous / "manifest.json").read_text())["commit"] if p.previous else None
    log = changelog(src or (paths.work_dir(key) / "src"), since, demo.commit)
    (out / "changelog.json").write_text(json.dumps({"since_commit": since, "until_commit": demo.commit, "commits": log}, indent=1) + "\n")
    (out / "changelog.md").write_text(changelog_md(log, since, demo) + "\n")
    facts = {"stills in the demo": len(demo.stills), "commits since the last demo": len(log)}
    if demo.video is not None:
        facts["seconds of video"] = round(compose.probe(demo.video)["duration"])
    inputs = kcopy.Inputs.from_shipped(shipped, commits=[c["subject"] for c in log[:12]], shows=[b.get("caption") or b.get("label") for b in demo.capture.get("timeline") or [] if b.get("label")] or [a["label"] for a in demo.stills], facts=facts)
    copydoc = kcopy.write(inputs, names=names, others=others, use_model=use_model)
    for d in copydoc["dropped"]:
        refused.append(refusal(d["platform"], d["code"]))
    if copydoc.get("no_model") and use_model:
        refused.append(refusal("captions", "no_model"))
    (out / "share-copy.json").write_text(json.dumps(copydoc, indent=1, ensure_ascii=False) + "\n")
    kit["copy"] = "share-copy.json"
    kit["changelog"] = "changelog.json"
    kit["refused"] = refused
    checks["captions"] = {"input_numbers": sorted(__import__("analysis.narrative", fromlist=["x"]).known_numbers(copydoc["input"], kcopy.STRICT)), "dropped": copydoc["dropped"]}
    (out / "checks.json").write_text(json.dumps(checks, indent=1) + "\n")
    (out / "kit.json").write_text(json.dumps(kit, indent=1, ensure_ascii=False) + "\n")
    remember(demo)
    return kit


def changelog_md(log: list[dict], since: str | None, demo: Demo) -> str:
    head = f"What is new since the demo of {since[:10]}" if since else "The latest commits (the first demo)"
    lines = [f"# {head}", ""]
    for c in log:
        lines.append(f"- {c['subject']}")
    if not log:
        lines.append("- nothing committed since")
    return "\n".join(lines)


def describe(p: Plan, formats) -> dict:
    """What `build` would make: `--dry-run` prints it and writes nothing."""
    return {
        "dry_run": True,
        "project_key": p.demo.key,
        "device": p.demo.device["id"] if p.demo.device else None,
        "hue": p.hue,
        "title": p.title,
        "formats": [{"id": fid, "device": d["id"] if d else None, "video": str(v) if v else None, "beats": len(tl),
                     "taps": sum(1 for b in tl if b.get("tap")), "screen": [lay.x, lay.y, lay.w, lay.h]} for fid, d, v, tl, lay in formats],  # fmt: skip
        "stills": [a["file"] for a in p.demo.stills],
        "before_after_with": p.previous.name if p.previous else None,
        "app_store": p.ios,
        "refused": p.refused,
    }


# ------------------------------------------------------------------------ the command


def shipped_for(key: str, explicit: str | None) -> dict | None:
    """The build post to caption from: `--shipped FILE`, else the one the queue drafted into the
    work dir (`work/<key>/shipped.json`), else none (the captions then come from the commits and
    the video alone)."""
    for p in [pathlib.Path(explicit).expanduser()] if explicit else [paths.work_dir(key) / "shipped.json"]:
        if p.is_file():
            try:
                return json.loads(p.read_text())
            except ValueError:
                return None
    return None


def main(a: argparse.Namespace) -> int:
    from capture.demo import project as pj
    from capture.demo import transcripts as tx

    if a.key:
        key = a.key
        names: tuple = ()
        others: tuple = ()
        src = None
    else:
        project = pj.from_checkout(a.project or a.path or ".")
        key = project.key
        names = tuple(project.names) + tuple(privacy.machine_names())
        evidence = None if a.no_transcripts else tx.harvest(project.identity, pathlib.Path(a.root).expanduser(), progress=False)
        others = tuple(privacy.other_names(evidence.others if evidence else [], project.names))
        src = project.checkout
    try:
        kit = build(key, hue=a.hue, shipped=shipped_for(key, a.shipped), src=src, use_model=not a.no_model,
                    dry_run=a.dry_run, names=names, others=others, only=a.formats.split(",") if a.formats else None)  # fmt: skip
    except CaptureError as e:
        say(f"Refused: {e}")
        return 1
    if a.dry_run:
        print(json.dumps(kit, indent=1))
        return 0
    out = paths.out_dir(key) / KIT_DIR
    print(f"Kit written to {out}")
    for f in kit["formats"]:
        print(f"  {f['file']:<22} {f['width']}x{f['height']}, {f['duration_ms'] / 1000:.1f} s, {f['bytes'] / 1e6:.2f} MB, {f['rings']} tap rings")
    if kit["loop"]:
        print(f"  {kit['loop']['file']:<22} {kit['loop']['width']}x{kit['loop']['height']}, {kit['loop']['bytes'] / 1e6:.2f} MB")
    print(f"  framed stills          {len(kit['framed'])}")
    print(f"  before and after       {len(kit['before_after'])}")
    print(f"  app store              {', '.join(s['slot'] + ' x' + str(len(s['files'])) for s in kit['app_store']) or 'none'}")
    for r in kit["refused"]:
        print(f"  not made: {r['what']}: {r['sentence']} ({r['code']})")
    print("  nothing was sent anywhere; `python -m capture demo kit --publish` lists every file first")
    return 0
