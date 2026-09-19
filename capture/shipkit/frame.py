"""One recording, four social formats, each with the device drawn around it at its own shape.

THE BUG THIS EXISTS TO MAKE IMPOSSIBLE. Another demo tool handed the owner "a weird elongated
phone": a recording of one size composed into a frame of another and stretched to fill it. Here:

1. the device is a row of spec/devices.v1.json (`capture.demo.devices`), and the capture was
   refused unless its pixels were that row's (`devices.check_capture`);
2. `layout` fits the row's aspect inside the format and rounds ONE side, deriving the other from
   the aspect, so the rendered screen is the row's shape to within a pixel;
3. `check_aspect` does not trust `layout`: it renders the same filter graph with a white screen
   on a black ground, reads the frame back as raw grey and measures where the white landed,
   pixel by pixel (`bbox`), and refuses the format (`device_aspect_mismatch`) when that box's
   aspect is not the row's within the device table's tolerance. It measures the pipeline, not the
   arithmetic that fed it. (`cropdetect` was tried first and REVERTED: it judges a row by its
   average, so the rows a rounded corner shortens came back as ground and a correct phone
   measured 1% too short, 704x1520 for a 706x1534 screen.)

WHAT IS DRAWN. A flat warm ground (design/tokens.json `surface.bg.dark`), the project's hue as a
band rising behind the lower part of the device with an ordered dither on its edge (the app's own
texture; never a gradient: tokens forbid one on an identity hue), the device's body as a thin dark
bezel with a shadow, the screen cut to the row's corner radius, and the post's title above when
there is one. The Swift helper draws the still layers (`backdrop`, `mask`, `ring`); ffmpeg lays the
recording over them.

MOTION. Each beat punches in by `ZOOM` about the point its first tap landed (or the screen's
centre), easing in over `ZOOM_IN` seconds after the beat starts and out before it ends: the eye is
taken to what changed without a cut. A beat whose tap place is known gets a ring there, just before
the screen reacts (`kit.change_time` measures when). Zooming about the tap keeps the tap still on
the canvas, so the ring never drifts off what was tapped.
"""

from __future__ import annotations

import dataclasses
import json
import pathlib
import re
import subprocess

from capture.demo import devices, tools
from capture.demo.result import CaptureError

#: How far a beat punches in. UNMEASURED JUDGEMENT CALL: 4% reads as a nudge toward the tap on a
#: phone held at arm's length; 8% started to crop the status bar off the Pro Max render.
ZOOM = 0.04
#: Seconds the punch in takes, after the beat's crossfade, and the punch out, before its end.
ZOOM_IN = 0.45
ZOOM_OUT = 0.35
#: The tap ring: its size as a share of the rendered screen's width, how long it shows, and how
#: long it fades in and out.
RING_SHARE = 0.17
RING_SHOW = 0.62
RING_FADE_IN = 0.08
RING_FADE_OUT = 0.28
FPS = 30
CRF = 20

#: The ground the device stands on and the colour its title is set in: design/tokens.json
#: `surface.bg.dark` and `surface.text.dark`. Restated (capture imports no generated TypeScript,
#: and tokens.json has no Python output); `test_shipkit` reads tokens.json and pins both.
GROUND = "#141210"
TITLE_INK = "#F5F1EA"
SUB_INK = "#A8A29A"
BEZEL_INK = "#0B0A09"


class FrameError(CaptureError):
    """A format that may not be kept, with its code (`kit.REFUSALS` has the sentence)."""

    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def even(n: float) -> int:
    n = int(round(n))
    return n - (n % 2)


@dataclasses.dataclass(frozen=True)
class Layout:
    """Where everything sits in one format, in the format's pixels."""

    width: int
    height: int
    #: The screen: top left, size. Its aspect is the device row's to within one pixel.
    x: int
    y: int
    w: int
    h: int
    #: The screen's corner radius and the body's bezel, in the format's pixels.
    radius: int
    bezel: int
    #: Where the band's solid part starts, and the dither cell.
    band_top: int
    cell: int
    #: The title's box (x, y, w, h) and size in points, or None when the format sets no title.
    title_box: tuple[int, int, int, int] | None
    title_size: int


def screen_of(device: dict | None) -> tuple[tuple[int, int], float, str]:
    """(the recording's shape in pixels, its corner radius in those pixels, its family) for a
    device row, or the device table's terminal canvas for a CLI (pure)."""
    if device is None:
        size = tuple(devices.fmt(devices.TERMINAL["format"])["size"])
        return (int(size[0]), int(size[1])), float(devices.TERMINAL["corner_radius"]), "terminal"
    w, h = device["pixels"]
    return (int(w), int(h)), float(device["corner_radius"]) * device["native_scale"], device["family"]


def layout(fmt: dict, device: dict | None, title: bool) -> Layout:
    """Fit the device inside the format (pure; `test_shipkit` holds the aspect on every row and
    every format).

    A portrait device in a portrait or square format stands in the middle, under the title; in
    the landscape format it stands to the right and the title sits to its left. A Mac window or
    a terminal card fills the width it is given. The screen's width is rounded to an even number
    and its height is DERIVED from the row's aspect, never fitted separately, which is the rule
    that keeps a phone from coming out a pixel taller than its own shape on every format."""
    W, H = fmt["size"]
    (dw, dh), radius_px, family = screen_of(device)
    aspect = dw / dh
    margin = round(min(W, H) * 0.06)
    landscape_format = W > H
    portrait_device = aspect < 1
    title_h = 0
    title_box = None
    size = 0
    if landscape_format and portrait_device:
        # The device on the right, the title in the left half.
        avail = (W * 0.46, H - 2 * margin)
        ax0 = W * 0.54 - margin * 0.5
        ay0 = margin
        if title:
            size = round(H * 0.058)
            title_box = (margin * 2, round(H * 0.34), round(W * 0.44), round(H * 0.4))
    else:
        if title:
            title_h = round(H * (0.12 if H > W else 0.13))
            size = round(min(W, H) * (0.052 if H > W else 0.048))
            title_box = (margin, margin, W - 2 * margin, title_h)
        top = margin + title_h + (round(margin * 0.4) if title else 0)
        avail = (W - 2 * margin, H - top - margin)
        ax0, ay0 = margin, top
    if not title and not landscape_format:
        # With no title above it the device would fill the canvas edge to edge, and a phone that
        # touches the frame reads as a screenshot, not as a thing standing on the band. MEASURED
        # on the Builda demo's first kit: 93% of the 9:16 height with no title; 84% keeps the
        # band and the ground in view on every format.
        shrink = min(1.0, H * 0.84 / avail[1])
        avail = (avail[0], avail[1] * shrink)
        ay0 = (H - avail[1]) / 2
    scale = min(avail[0] / dw, avail[1] / dh)
    w = even(dw * scale)
    h = even(w / aspect)
    if h > avail[1]:
        h = even(avail[1])
        w = even(h * aspect)
    x = even(ax0 + (avail[0] - w) / 2)
    y = even(ay0 + (avail[1] - h) / 2)
    r = round(radius_px * w / dw)
    bezel = 0 if family in ("terminal",) else max(2, round(w * (0.012 if family == "mac" else 0.026)))
    band_top = round(y + h * (0.64 if portrait_device else 0.55)) if not landscape_format or portrait_device else round(y + h * 0.7)
    cell = max(6, even(min(W, H) / 90))
    return Layout(W, H, x, y, w, h, r, bezel, band_top, cell, title_box, size)


# ------------------------------------------------------------------------- motion


def envelope(start: float, end: float) -> str:
    """0 outside a beat, rising to 1 over `ZOOM_IN` after its crossfade and falling back to 0
    over `ZOOM_OUT` before it ends: an ffmpeg expression in `t` (pure)."""
    a = start + 0.1
    b = end - 0.15
    if b - a < ZOOM_IN + ZOOM_OUT:
        return "0"
    return f"clip((t-{a:.3f})/{ZOOM_IN},0,1)*clip(({b:.3f}-t)/{ZOOM_OUT},0,1)"


def zoom_terms(timeline: list[dict], zoom: float = ZOOM) -> list[tuple[str, float, float]]:
    """(envelope, x, y) per beat: the punch in and the point it is about, the beat's tap or the
    screen's centre (pure)."""
    out = []
    for b in timeline:
        e = envelope(float(b["start"]), float(b["end"]))
        if e == "0" or zoom <= 0:
            continue
        tap = b.get("tap") or [0.5, 0.5]
        out.append((e, float(tap[0]), float(tap[1])))
    return out


def motion_exprs(lay: Layout, timeline: list[dict], zoom: float = ZOOM) -> tuple[str, str, str]:
    """(scale factor, x, y) expressions: the screen scaled by 1 + zoom * envelope about the tap,
    which stays where it was on the canvas (pure). Envelopes never overlap (a beat's starts after
    the one before has eased out), so a sum of terms is the one active term."""
    terms = zoom_terms(timeline, zoom)
    if not terms:
        return "1", str(lay.x), str(lay.y)
    z = "1+" + "+".join(f"{zoom}*{e}" for e, _, _ in terms)
    x = f"{lay.x}-" + "-".join(f"{round(lay.w * px * zoom, 3)}*{e}" for e, px, _ in terms)
    y = f"{lay.y}-" + "-".join(f"{round(lay.h * py * zoom, 3)}*{e}" for e, _, py in terms)
    return z, x, y


@dataclasses.dataclass(frozen=True)
class Ring:
    at: float
    x: float
    y: float


def rings(timeline: list[dict], changes: dict[int, float] | None = None) -> list[Ring]:
    """A ring for every beat whose first tap place is known, `RING_LEAD` before the screen
    reacted when that was measured (`changes`, by beat index), else just after the beat's
    crossfade (pure)."""
    out = []
    for k, b in enumerate(timeline):
        tap = b.get("tap")
        if not tap:
            continue
        when = (changes or {}).get(k)
        at = max(float(b["start"]) + 0.05, when - 0.22) if when is not None else float(b["start"]) + (0.45 if k else 0.1)
        out.append(Ring(round(at, 3), float(tap[0]), float(tap[1])))
    return out


# ------------------------------------------------------------------------ the graph


def filter_graph(lay: Layout, timeline: list[dict], ring_list: list[Ring], zoom: float = ZOOM) -> str:
    """The filtergraph for one format (pure; the tests read it). Inputs: 0 the recording, 1 the
    backdrop, 2 the mask, 3 and on one ring image each."""
    z, x, y = motion_exprs(lay, timeline, zoom)
    parts = [
        f"[0:v]fps={FPS},scale={lay.w}:{lay.h}:flags=lanczos,setsar=1,format=rgba[scr]",
        f"[2:v]format=gray,scale={lay.w}:{lay.h}[m]",
        "[scr][m]alphamerge[dev]",
    ]
    if z == "1":
        parts.append("[dev]null[devz]")
    else:
        parts.append(f"[dev]scale=w='trunc({lay.w}*({z})/2)*2':h='trunc({lay.h}*({z})/2)*2':eval=frame[devz]")
    parts.append(f"[1:v]format=rgba[bg]")
    parts.append(f"[bg][devz]overlay=x='{x}':y='{y}':eval=frame:format=auto:shortest=1[v0]")
    cur = "[v0]"
    rs = max(8, even(lay.w * RING_SHARE))
    for i, r in enumerate(ring_list):
        k = 3 + i
        cx = round(lay.x + r.x * lay.w - rs / 2)
        cy = round(lay.y + r.y * lay.h - rs / 2)
        out = RING_SHOW - RING_FADE_OUT
        parts.append(
            f"[{k}:v]format=rgba,fade=t=in:st={r.at:.3f}:d={RING_FADE_IN}:alpha=1,"
            f"fade=t=out:st={r.at + out:.3f}:d={RING_FADE_OUT}:alpha=1[r{i}]"
        )
        parts.append(f"{cur}[r{i}]overlay=x={cx}:y={cy}:enable='between(t,{r.at:.3f},{r.at + RING_SHOW:.3f})'[v{i + 1}]")
        cur = f"[v{i + 1}]"
    parts.append(f"{cur}format=yuv420p[out]")
    return ";".join(parts)


def render_command(ff: str, video: str, backdrop: str, mask: str, ring_png: str | None, n_rings: int, duration: float, graph: str, out: str) -> list[str]:
    """The ffmpeg command for one format (pure)."""
    args = [ff, "-y", "-hide_banner", "-loglevel", "error", "-i", video,
            "-loop", "1", "-framerate", str(FPS), "-t", f"{duration:.3f}", "-i", backdrop,
            "-loop", "1", "-framerate", str(FPS), "-t", f"{duration:.3f}", "-i", mask]  # fmt: skip
    for _ in range(n_rings):
        args += ["-loop", "1", "-framerate", str(FPS), "-t", f"{duration:.3f}", "-i", ring_png or ""]
    args += [
        "-filter_complex", graph, "-map", "[out]", "-t", f"{duration:.3f}",
        "-c:v", "libx264", "-preset", "slow", "-crf", str(CRF), "-profile:v", "high", "-pix_fmt", "yuv420p",
        "-map_metadata", "-1", "-map_chapters", "-1", "-movflags", "+faststart", "-an", out,
    ]  # fmt: skip
    return args


def bake_poster_command(ff: str, video: str, poster: str, out: str) -> list[str]:
    """Frame 0 of the video becomes the poster, every other frame and the length untouched
    (brag's trick, skills/brag/references/step-4-deliver.md): X, Slack and Discord make the idle
    thumbnail from frame 0 whatever a file's cover art says, so the poster has to BE frame 0."""
    return [
        ff, "-y", "-hide_banner", "-loglevel", "error", "-i", video, "-i", poster,
        "-filter_complex", "[1:v]scale=iw:ih[p];[0:v][p]overlay=0:0:enable='eq(n,0)',format=yuv420p[v]",
        "-map", "[v]", "-c:v", "libx264", "-preset", "slow", "-crf", str(CRF), "-profile:v", "high",
        "-pix_fmt", "yuv420p", "-map_metadata", "-1", "-movflags", "+faststart", "-an", out,
    ]  # fmt: skip


# ------------------------------------------------------------------------ the checks


def bbox(gray: bytes, width: int, height: int, level: int = 128) -> tuple[int, int, int, int] | None:
    """(w, h, x, y) of the pixels at or above `level` in a raw 8 bit grey frame, or None (pure).
    Every row is scanned in C through `bytes.translate`, so a 1920 by 1080 frame is milliseconds."""
    table = bytes(1 if i >= level else 0 for i in range(256))
    top = bottom = None
    left, right = width, -1
    for row in range(height):
        line = gray[row * width : (row + 1) * width].translate(table)
        a = line.find(1)
        if a < 0:
            continue
        b = line.rfind(1)
        top = row if top is None else top
        bottom = row
        left, right = min(left, a), max(right, b)
    if top is None:
        return None
    return right - left + 1, bottom - top + 1, left, top


def aspect_ok(measured: tuple[int, int], device: dict | None, tol: float = devices.MATCH_TOLERANCE) -> bool:
    """Whether a measured screen box is the device's shape: its aspect within the device table's
    tolerance plus one pixel of rounding on the shorter side (pure)."""
    (dw, dh), _, _ = screen_of(device)
    want = dw / dh
    w, h = measured
    if w <= 0 or h <= 0:
        return False
    slack = tol + 1.0 / min(w, h)
    return abs((w / h) / want - 1) <= slack


def check_aspect(ff: str, lay: Layout, device: dict | None, mask: pathlib.Path, work: pathlib.Path) -> dict:
    """Render the format's geometry with a white screen on a black ground and measure where the
    white landed, pixel by pixel, then hold its aspect to the device's (the module docstring,
    point 3). The measured box is the screen's whole extent: a rounded corner trims no row or
    column entirely, since each edge's straight run reaches the box."""
    (dw, dh), _, _ = screen_of(device)
    black = work / f"probe-ground-{lay.width}x{lay.height}.png"
    white = f"color=c=white:s={dw}x{dh}:d=0.2:r={FPS}"
    graph = filter_graph(lay, [], []).replace("format=yuv420p[out]", "format=gray[out]")
    subprocess.run([ff, "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", f"color=c=black:s={lay.width}x{lay.height}:d=0.2",
                    "-frames:v", "1", str(black)], check=True, capture_output=True, timeout=60)  # fmt: skip
    r = subprocess.run(
        [ff, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", white, "-loop", "1", "-t", "0.2", "-i", str(black),
         "-loop", "1", "-t", "0.2", "-i", str(mask), "-filter_complex", graph, "-map", "[out]", "-frames:v", "1",
         "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        capture_output=True, timeout=120, check=False,
    )  # fmt: skip
    if r.returncode != 0 or len(r.stdout) != lay.width * lay.height:
        raise FrameError("render_failed", f"the geometry probe did not render: {r.stderr.decode(errors='replace').strip()[-300:]}")
    box = bbox(r.stdout, lay.width, lay.height)
    if box is None:
        raise FrameError("device_aspect_mismatch", "the device could not be found in the geometry probe")
    w, h, x, y = box
    ok = aspect_ok((w, h), device)
    result = {"measured": [w, h], "at": [x, y], "want_aspect": round(dw / dh, 5), "got_aspect": round(w / h, 5), "ok": ok}
    if not ok:
        raise FrameError(
            "device_aspect_mismatch",
            f"the screen came out {w}x{h} ({w / h:.4f}) in the {lay.width}x{lay.height} format, and the device is "
            f"{dw}x{dh} ({dw / dh:.4f}): that is a stretched device, so the format is not kept",
        )
    return result


#: A sampled frame whose screen's grey levels spread less than this (standard deviation, 0 to
#: 255, read at 96 pixels across) is blank: one flat colour. MEASURED on the four demos on this
#: Mac (docs/ship-kit.md, "Blank screens"): the lowest a real screen of theirs reads is the
#: RideGT search sheet, well above this; a white page still loading reads under 1.
BLANK_STD = 4.0
#: Two samples in a row at `BLANK_FPS` is half a second of nothing on screen: a segment.
BLANK_RUN = 2
BLANK_FPS = 4


def blank_runs(stds: list[float], fps: int = BLANK_FPS, floor: float = BLANK_STD, run: int = BLANK_RUN) -> list[tuple[float, float]]:
    """(start, end) seconds of every run of at least `run` consecutive blank samples (pure)."""
    out: list[tuple[float, float]] = []
    i = 0
    while i < len(stds):
        if stds[i] < floor:
            j = i
            while j < len(stds) and stds[j] < floor:
                j += 1
            if j - i >= run:
                out.append((round(i / fps, 2), round(j / fps, 2)))
            i = j
        else:
            i += 1
    return out


def screen_stats(ff: str, video: pathlib.Path, lay: Layout | None, work: pathlib.Path, fps: int = BLANK_FPS) -> list[float]:
    """The grey level spread of the SCREEN (the layout's box, or the whole frame) at `fps`."""
    frames = work / f"blank-{video.stem}"
    if frames.exists():
        for p in frames.glob("*.png"):
            p.unlink()
    frames.mkdir(parents=True, exist_ok=True)
    crop = f"crop={lay.w}:{lay.h}:{lay.x}:{lay.y}," if lay is not None else ""
    subprocess.run([ff, "-y", "-hide_banner", "-loglevel", "error", "-i", str(video), "-vf", f"{crop}fps={fps},scale=96:-2",
                    str(frames / "f-%05d.png")], check=True, capture_output=True, timeout=600)  # fmt: skip
    files = sorted(frames.glob("f-*.png"))
    if not files:
        return []
    r = subprocess.run([str(tools.helper()), "stats", *map(str, files)], capture_output=True, text=True, timeout=300, check=False)
    if r.returncode != 0:
        raise FrameError("render_failed", f"reading the frames failed: {r.stderr.strip()[-200:]}")
    return [float(x.get("std", 0.0)) for x in json.loads(r.stdout)]


def check_blank(ff: str, video: pathlib.Path, lay: Layout | None, work: pathlib.Path) -> dict:
    """Refuse a video with a blank stretch on its screen (`blank_segment`)."""
    stds = screen_stats(ff, video, lay, work)
    runs = blank_runs(stds)
    if runs:
        s, e = runs[0]
        raise FrameError("blank_segment", f"{video.name} shows a blank screen from {s:.1f} s to {e:.1f} s (grey spread under {BLANK_STD})")
    return {"samples": len(stds), "min_std": round(min(stds), 2) if stds else None, "blank_runs": 0}


# ------------------------------------------------------------------------ the layers


def draw_backdrop(lay: Layout, band_hex: str, title: str | None, out: pathlib.Path) -> pathlib.Path:
    args = [str(tools.helper()), "backdrop", "--width", str(lay.width), "--height", str(lay.height),
            "--ground", GROUND, "--band", band_hex, "--band-top", str(lay.band_top), "--cell", str(lay.cell),
            "--screen", f"{lay.x},{lay.y},{lay.w},{lay.h}", "--radius", str(lay.radius), "--bezel", str(lay.bezel),
            "--bezel-color", BEZEL_INK, "--out", str(out)]  # fmt: skip
    if title and lay.title_box:
        args += ["--title", title, "--title-box", ",".join(map(str, lay.title_box)), "--title-size", str(lay.title_size), "--title-color", TITLE_INK]
    r = subprocess.run(args, capture_output=True, text=True, timeout=120, check=False)
    if r.returncode != 0:
        raise FrameError("render_failed", f"drawing the backdrop failed: {r.stderr.strip()[-300:]}")
    return out


def draw_mask(lay: Layout, out: pathlib.Path) -> pathlib.Path:
    r = subprocess.run([str(tools.helper()), "mask", "--width", str(lay.w), "--height", str(lay.h), "--radius", str(lay.radius), "--out", str(out)],
                       capture_output=True, text=True, timeout=60, check=False)  # fmt: skip
    if r.returncode != 0:
        raise FrameError("render_failed", f"drawing the mask failed: {r.stderr.strip()[-300:]}")
    return out


def draw_ring(size: int, out: pathlib.Path) -> pathlib.Path:
    r = subprocess.run([str(tools.helper()), "ring", "--size", str(size), "--out", str(out)], capture_output=True, text=True, timeout=60, check=False)
    if r.returncode != 0:
        raise FrameError("render_failed", f"drawing the tap ring failed: {r.stderr.strip()[-300:]}")
    return out


def frame_still(ff: str, still: pathlib.Path, lay: Layout, backdrop: pathlib.Path, mask: pathlib.Path, out: pathlib.Path) -> pathlib.Path:
    """One still in the format's frame, as a PNG: the same layers as the video, no motion."""
    graph = filter_graph(lay, [], [])
    r = subprocess.run([ff, "-y", "-hide_banner", "-loglevel", "error", "-i", str(still), "-loop", "1", "-t", "0.1", "-i", str(backdrop),
                        "-loop", "1", "-t", "0.1", "-i", str(mask), "-filter_complex", graph.replace("format=yuv420p[out]", "format=rgb24[out]"),
                        "-map", "[out]", "-frames:v", "1", str(out)], capture_output=True, text=True, timeout=120, check=False)  # fmt: skip
    if r.returncode != 0:
        raise FrameError("render_failed", f"framing {still.name} failed: {r.stderr.strip()[-300:]}")
    return out
