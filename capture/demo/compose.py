"""Stage 4: one raw recording and its beat windows in, a 10 to 30 second portrait MP4 out.

ffmpeg only, and every command line is built by a pure function here so the tests can read it
(`test_demo_compose`). Two encodes:

1. per beat: its window of the raw recording cut into segments. Where `freezedetect` found the
   screen still, the hold is sped up to `HOLD_KEEP` seconds (the beat's LAST hold keeps
   `TAIL_KEEP`, the time it takes to read its caption); where it moves, `mpdecimate` drops the
   duplicate frames a variable frame rate recording turns into at a constant 30 fps. Then the
   caption: `drawtext` where this ffmpeg has it, else the helper's caption PNG through `overlay`.
   FOUND WHILE BUILDING THIS: Homebrew's ffmpeg 8.1.1 is built without libfreetype, so
   `drawtext` does not exist on the machine this was written on; the overlay path is that case.
2. the beats joined with `xfade`, the whole sped up evenly when it would run past 30 s and the
   last frame held when it would end before 10, H.264 High, yuv420p, `+faststart` so a phone
   starts playing before the file has arrived, no audio. The poster is the first beat's settled
   frame, just before its crossfade.
"""

from __future__ import annotations

import dataclasses
import json
import pathlib
import re
import subprocess

from . import tools
from .result import BeatWindow, CaptureError

FPS = 30
FADE = 0.4
#: A still stretch in the middle of a beat: long enough to register, short enough not to wait.
HOLD_KEEP = 0.7
#: A beat's final state, which is what its caption describes: time to read eight words.
TAIL_KEEP = 2.2
MAX_SPEED = 16.0
#: `freezedetect`: a stretch counts as still when frames differ by less than -60 dB for 0.5 s.
FREEZE_NOISE = "-60dB"
FREEZE_MIN = 0.5
MIN_TOTAL, MAX_TOTAL = 10.0, 30.0
#: Where a too long video is sped to: under the cap, with room for the crossfades' rounding.
FIT_TOTAL = 28.0
#: UIKit's tab bar is 49 points tall on an iPhone in portrait, above the home indicator's safe
#: area; a caption sits this far above both so it never covers the navigation. The safe area is
#: the device row's (spec/devices.v1.json): on the iPhone 17 Pro it is 34 points, so the caption's
#: bottom edge is (34 + 49 + 17.5) / 874 = 11.5% up, which is where every earlier demo put it
#: when the share was a constant typed for that one phone.
TAB_BAR_POINTS = 49
CAPTION_GAP_POINTS = 17.5


def caption_bottom(device: dict | None) -> float:
    """The caption's bottom edge as a share of the frame's height, from the device row: above the
    home indicator and a tab bar on a phone or tablet, a gap alone in a Mac window or a terminal
    (pure)."""
    if device is None:
        return 0.06
    h = device["points"][1]
    if device["family"] == "mac":
        return round(CAPTION_GAP_POINTS * 2 / h, 4)
    return round((device["safe_area"]["bottom"] + TAB_BAR_POINTS + CAPTION_GAP_POINTS) / h, 4)


CRF_BEAT, CRF_FINAL = 16, 23


@dataclasses.dataclass(frozen=True)
class Segment:
    start: float
    end: float
    speed: float

    @property
    def out_len(self) -> float:
        return (self.end - self.start) / self.speed


def parse_freezes(text: str, duration: float | None = None) -> list[tuple[float, float]]:
    """`freezedetect`'s log lines as (start, end). A freeze still open when the video ends has
    no end line; it ends at `duration` (or is dropped when that is unknown)."""
    out: list[tuple[float, float]] = []
    start = None
    for m in re.finditer(r"lavfi\.freezedetect\.freeze_(start|end):\s*([0-9.]+)", text):
        kind, t = m.group(1), float(m.group(2))
        if kind == "start":
            start = t
        elif start is not None:
            out.append((start, t))
            start = None
    if start is not None and duration is not None and duration > start:
        out.append((start, duration))
    return out


def segments(
    start: float,
    end: float,
    freezes: list[tuple[float, float]],
    hold_keep: float = HOLD_KEEP,
    tail_keep: float = TAIL_KEEP,
    max_speed: float = MAX_SPEED,
) -> list[Segment]:
    """One beat's window as motion (speed 1) and sped up holds, in order, covering it exactly."""
    if end <= start:
        return []
    holds = sorted(
        (max(s, start), min(e, end))
        for s, e in freezes
        if min(e, end) - max(s, start) >= FREEZE_MIN
    )
    out: list[Segment] = []
    cur = start
    for s, e in holds:
        if s < cur:
            s = cur
        if e <= s:
            continue
        if s - cur > 1e-3:
            out.append(Segment(cur, s, 1.0))
        keep = tail_keep if end - e < 0.05 else hold_keep
        speed = min(max_speed, max(1.0, (e - s) / keep))
        out.append(Segment(s, e, round(speed, 4)))
        cur = e
    if end - cur > 1e-3:
        out.append(Segment(cur, end, 1.0))
    return out


#: The longest one beat may run in the video. FOUND ON THE FIRST BUILDA RUN: a Maestro scroll
#: down a long session page is motion, so no hold is found in it, and its 25 seconds forced
#: `fit` to speed the WHOLE video up 1.5x, the short beats with it. A beat over budget is sped up
#: on its own instead, its final hold (what the caption describes) kept.
BEAT_MAX = 6.5


def budget(segs: list[Segment], max_len: float = BEAT_MAX, max_speed: float = MAX_SPEED) -> list[Segment]:
    """`segs` sped up evenly, all but a final hold, until the beat runs `max_len` seconds."""
    if not segs:
        return segs
    total = sum(s.out_len for s in segs)
    if total <= max_len:
        return segs
    tail = segs[-1] if segs[-1].speed > 1.0 else None
    head = segs[:-1] if tail else segs
    room = max_len - (tail.out_len if tail else 0.0)
    head_len = sum(s.out_len for s in head)
    if room <= 0.5 or head_len <= 0:
        return segs
    k = head_len / room
    out = [Segment(s.start, s.end, round(min(max_speed, s.speed * k), 4)) for s in head]
    return out + ([tail] if tail else [])


def fit(durations: list[float], fade: float = FADE) -> tuple[float, float]:
    """(speed, seconds to hold the last frame) that bring the joined length into [10, 30]."""
    n = len(durations)
    if n == 0:
        return 1.0, 0.0
    total = sum(durations) - fade * (n - 1)
    if total > MAX_TOTAL:
        return round(sum(durations) / (FIT_TOTAL + fade * (n - 1)), 4), 0.0
    if total < MIN_TOTAL:
        return 1.0, round(MIN_TOTAL - total + 0.05, 3)
    return 1.0, 0.0


def _esc(path: str) -> str:
    """A path inside a filtergraph option: `\\`, `:` and `'` escaped (ffmpeg-filters, quoting)."""
    return path.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")


def even(n: int) -> int:
    return n - (n % 2)


def beat_command(
    ffmpeg: str,
    raw: str,
    segs: list[Segment],
    out: str,
    size: tuple[int, int],
    caption_png: str | None = None,
    caption_text_file: str | None = None,
    fontfile: str | None = None,
    bottom_share: float = 0.115,
) -> list[str]:
    w, h = even(size[0]), even(size[1])
    args = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error"]
    for s in segs:
        args += ["-ss", f"{s.start:.3f}", "-t", f"{s.end - s.start:.3f}", "-i", raw]
    parts = []
    for k, s in enumerate(segs):
        chain = f"[{k}:v]setpts=(PTS-STARTPTS)/{s.speed:g},fps={FPS}"
        if s.speed == 1.0:
            chain += f",mpdecimate=hi=768:lo=320:frac=0.33:max=4,setpts=N/{FPS}/TB"
        chain += (
            f",scale={w}:{h}:force_original_aspect_ratio=decrease,"
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p[s{k}]"
        )
        parts.append(chain)
    n = len(segs)
    if n > 1:
        parts.append("".join(f"[s{k}]" for k in range(n)) + f"concat=n={n}:v=1:a=0[cat]")
        cur = "[cat]"
    else:
        cur = "[s0]"
    bottom = round(h * bottom_share)
    if caption_text_file and fontfile:
        fs = round(w * 0.041)
        parts.append(
            f"{cur}drawtext=textfile='{_esc(caption_text_file)}':fontfile='{_esc(fontfile)}':"
            f"fontcolor=white:fontsize={fs}:box=1:boxcolor=0x121214@0.78:boxborderw={round(fs * 0.7)}:"
            f"x=(w-text_w)/2:y=h-text_h-{bottom}[out]"
        )
    elif caption_png:
        args += ["-i", caption_png]
        parts.append(f"{cur}[{n}:v]overlay=x=(W-w)/2:y=H-h-{bottom}:format=auto,format=yuv420p[out]")
    else:
        parts.append(f"{cur}null[out]")
    args += [
        "-filter_complex", ";".join(parts), "-map", "[out]",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", str(CRF_BEAT), "-pix_fmt", "yuv420p",
        "-r", str(FPS), "-an", out,
    ]  # fmt: skip
    return args


def join_command(
    ffmpeg: str, beats: list[str], durations: list[float], out: str, speed: float = 1.0, pad: float = 0.0, fade: float = FADE
) -> list[str]:
    args = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error"]
    for b in beats:
        args += ["-i", b]
    n = len(beats)
    parts = []
    for k in range(n):
        chain = f"[{k}:v]"
        chain += f"setpts=PTS/{speed:g}," if speed != 1.0 else ""
        chain += f"tpad=stop_mode=clone:stop_duration={pad:g}," if (k == n - 1 and pad > 0) else ""
        chain += f"settb=AVTB,fps={FPS},format=yuv420p[v{k}]"
        parts.append(chain)
    cur = "[v0]"
    elapsed = 0.0
    for k in range(1, n):
        elapsed += durations[k - 1] / speed
        offset = elapsed - k * fade
        parts.append(f"{cur}[v{k}]xfade=transition=fade:duration={fade:g}:offset={offset:.3f}[x{k}]")
        cur = f"[x{k}]"
    parts.append(f"{cur}null[out]")
    args += [
        "-filter_complex", ";".join(parts), "-map", "[out]",
        "-c:v", "libx264", "-preset", "slow", "-crf", str(CRF_FINAL), "-profile:v", "high",
        # No metadata on the shipped file: no encoder tag, no creation time, nothing carried from
        # the source recording (the review's item 7).
        "-map_metadata", "-1", "-map_chapters", "-1",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", out,
    ]  # fmt: skip
    return args


def total_length(durations: list[float], speed: float = 1.0, pad: float = 0.0, fade: float = FADE) -> float:
    return sum(d / speed for d in durations) + pad - fade * max(0, len(durations) - 1)


def poster_time(durations: list[float], speed: float = 1.0, fade: float = FADE) -> float:
    """Just before the first crossfade: the first beat, settled, with its caption on."""
    if not durations:
        return 0.0
    first = durations[0] / speed
    return max(0.0, first - (fade if len(durations) > 1 else 0.0) - 0.15)


def poster_command(ffmpeg: str, video: str, t: float, out: str) -> list[str]:
    return [ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-ss", f"{t:.3f}", "-i", video, "-frames:v", "1", "-q:v", "3", "-map_metadata", "-1", out]


def cfr_command(ffmpeg: str, raw: str, out: str) -> list[str]:
    """The raw recording at a constant 30 fps with a keyframe every second, before anything is cut.

    FOUND ON THE FOURTH BUILDA RUN: `simctl io recordVideo` writes a frame only when the screen
    changes, so a still screen is a stretch with NO frames (82.7 s to 91.0 s in that recording),
    and an input seek (`-ss 84 -t 2`) into such a stretch came back with frames from the END of
    the file, the Wrapped card, with no error. Three beats of that video showed Wrapped under
    their own captions while every per beat file looked right at its first frame. RideGT's map
    never stops moving, which is why its run did not show it. Every frame at every timestamp, and
    a keyframe a second, makes every cut exact."""
    return [
        ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-i", raw, "-vf", f"fps={FPS}",
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "12", "-g", str(FPS), "-pix_fmt", "yuv420p",
        "-an", out,
    ]  # fmt: skip


def freeze_command(ffmpeg: str, raw: str) -> list[str]:
    return [ffmpeg, "-hide_banner", "-nostats", "-i", raw, "-vf", f"freezedetect=n={FREEZE_NOISE}:d={FREEZE_MIN}", "-map", "0:v:0", "-f", "null", "-"]


# ----------------------------------------------------------------------------- run


def _run(args: list[str], what: str, timeout: int = 900) -> subprocess.CompletedProcess:
    r = subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)
    if r.returncode != 0:
        raise CaptureError(f"ffmpeg failed while {what}: {r.stderr.strip()[-600:]}")
    return r


def probe(path: pathlib.Path) -> dict:
    r = subprocess.run(
        [tools.ffprobe(), "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height:format=duration", "-of", "json", str(path)],
        capture_output=True, text=True, timeout=60, check=False,
    )  # fmt: skip
    if r.returncode != 0:
        raise CaptureError(f"ffprobe could not read {path.name}: {r.stderr.strip()[-300:]}")
    data = json.loads(r.stdout)
    st = (data.get("streams") or [{}])[0]
    return {"width": int(st.get("width") or 0), "height": int(st.get("height") or 0), "duration": float((data.get("format") or {}).get("duration") or 0)}


def _font() -> str | None:
    for f in ("/System/Library/Fonts/SFNS.ttf", "/System/Library/Fonts/Helvetica.ttc", "/Library/Fonts/Arial.ttf"):
        if pathlib.Path(f).exists():
            return f
    return None


def timeline(beats: list[BeatWindow], durations: list[float], speed: float = 1.0, pad: float = 0.0, fade: float = FADE) -> list[dict]:
    """Where each beat is in the FINISHED video, in its seconds: the social formats zoom and draw
    a tap ring on this clock (shipkit.frame), so it is computed from the same numbers `join_command`
    cuts with, never re-estimated (pure). A beat's `start` is where its clip starts, under the
    crossfade from the one before."""
    out: list[dict] = []
    t = 0.0
    for k, (b, d) in enumerate(zip(beats, durations)):
        start = t
        end = start + d / speed + (pad if k == len(durations) - 1 else 0.0)
        out.append({"label": b.label, "caption": b.caption, "start": round(start, 3), "end": round(end, 3), "tap": list(b.tap) if b.tap else None})
        t = start + d / speed - fade
    return out


def compose(raw: pathlib.Path | None, beats: list[BeatWindow], out_dir: pathlib.Path, device: dict | None = None) -> dict:
    """demo.mp4 and poster.jpg in `out_dir`. Each beat is a window of `raw`, or of its own clip
    (`BeatWindow.video`). `device` is the row it was filmed on, for where the caption sits.
    Returns their facts for the manifest, and the beats' places in the finished video."""
    if not beats:
        raise CaptureError("nothing to compose: the pass recorded no beats")
    ff = tools.ffmpeg()
    sources: dict[pathlib.Path, tuple[pathlib.Path, dict, list[tuple[float, float]]]] = {}

    def source(p: pathlib.Path) -> tuple[pathlib.Path, dict, list[tuple[float, float]]]:
        """(the constant frame rate copy to cut from, its facts, its holds)."""
        if p not in sources:
            cfr = p.with_name(p.stem + "-cfr.mp4")
            _run(cfr_command(ff, str(p), str(cfr)), f"normalising {p.name} to {FPS} fps", timeout=1800)
            info = probe(cfr)
            fr = subprocess.run(freeze_command(ff, str(cfr)), capture_output=True, text=True, timeout=900, check=False)
            sources[p] = (cfr, info, parse_freezes(fr.stderr, info["duration"]))
        return sources[p]

    first = beats[0].video or raw
    if first is None:
        raise CaptureError("nothing to compose: no recording")
    _, info0, _ = source(first)
    size = (info0["width"], info0["height"])
    use_drawtext = tools.ffmpeg_has("drawtext") and _font() is not None
    work = out_dir / "compose"
    work.mkdir(parents=True, exist_ok=True)
    if raw is not None:
        cfr, info_raw, _ = source(raw)
        beats = align(cfr, beats, work, info_raw["duration"])
        (work / "aligned.json").write_text(json.dumps([{"label": b.label, "start": b.start, "end": b.end} for b in beats], indent=1))
    files, durations, kept = [], [], []
    freeze_count = 0
    for k, b in enumerate(beats, 1):
        if (b.video or raw) is None:
            continue
        src, info, freezes = source(b.video or raw)
        segs = budget(segments(b.start, min(b.end, info["duration"] or b.end), freezes))
        freeze_count += sum(1 for s in segs if s.speed > 1.0)
        if not segs:
            continue
        cap_png = cap_txt = None
        if b.caption:
            if use_drawtext:
                cap_txt = str(work / f"caption-{k:02d}.txt")
                pathlib.Path(cap_txt).write_text(b.caption)
            else:
                cap_png = str(work / f"caption-{k:02d}.png")
                _run_helper_caption(b.caption, even(size[0]), cap_png)
        out = work / f"beat-{k:02d}.mp4"
        _run(
            beat_command(ff, str(src), segs, str(out), size, cap_png, cap_txt, _font() if use_drawtext else None, caption_bottom(device)),
            f"cutting beat {k}",
        )
        d = probe(out)["duration"]
        if d <= FADE + 0.1:
            continue
        files.append(str(out))
        durations.append(d)
        kept.append(b)
    if not files:
        raise CaptureError("every beat came out empty after the holds were cut")
    speed, pad = fit(durations)
    video = out_dir / "demo.mp4"
    _run(join_command(ff, files, durations, str(video), speed, pad), "joining the beats", timeout=1800)
    poster = out_dir / "poster.jpg"
    _run(poster_command(ff, str(video), poster_time(durations, speed), str(poster)), "taking the poster frame")
    final = probe(video)
    return {
        "video": video,
        "poster": poster,
        "duration_ms": round(final["duration"] * 1000),
        "width": final["width"],
        "height": final["height"],
        "freezes": freeze_count,
        "speed": speed,
        "captions": "drawtext" if use_drawtext else "overlay",
        "timeline": timeline(kept, durations, speed, pad),
        "poster_at": round(poster_time(durations, speed), 3),
    }


#: How far a video frame may be from its beat's still and still be that picture: twice the
#: stills' own rule (`pictures.SAME_PICTURE_BITS`), since a frame is a re-encode of the screen.
ALIGN_BITS = 32


def frame_time(b: BeatWindow) -> float:
    """Where in the recording a beat's still should be: just before its window closes, inside
    the hold that follows the settle (pure)."""
    return max(b.start, b.end - 0.4)


#: Frames a second the recording is sampled at to find each beat in it.
ALIGN_FPS = 5


def match_runs(frame_prints: list[int], still: int, bits: int = ALIGN_BITS) -> list[tuple[int, int]]:
    """(first, last) index of every stretch of consecutive frames that are the still's picture."""
    runs: list[tuple[int, int]] = []
    for j, fp in enumerate(frame_prints):
        if bin(fp ^ still).count("1") <= bits:
            if runs and runs[-1][1] == j - 1:
                runs[-1] = (runs[-1][0], j)
            else:
                runs.append((j, j))
    return runs


def realign(beats: list[BeatWindow], frame_prints: list[int], still_prints: list[int | None], fps: int = ALIGN_FPS, duration: float | None = None) -> list[BeatWindow]:
    """Each beat's window moved to where the RECORDING shows its still (pure; the tests hold it).

    FOUND ON THE FIFTH AND SIXTH BUILDA RUNS: simctl's frame timestamps drift from the clock the
    driver measures beats with. The recording's zero was right (a status bar flip at the start
    shows up at 0.4 s, `simulator.mark_start`), yet 40 s in, the session page the driver opened at
    40.3 s was already on screen at 35 s: the stamps run behind when the Mac is busy (a Maestro
    JVM starting, Vision reading a still). A window measured on the clock then puts one beat's
    caption over the next beat's screen, and one of them showed a repository name. So the clock
    only ESTIMATES: a beat ends where the recording last shows its settled still, in the stretch
    of matching frames nearest that estimate and after the previous beat, and its start moves by
    the same amount. A beat whose picture is nowhere in the recording is refused."""
    out: list[BeatWindow] = []
    prev_end = 0.0
    for b, sp in zip(beats, still_prints):
        if sp is None:
            out.append(b)
            prev_end = max(prev_end, b.end)
            continue
        runs = [r for r in match_runs(frame_prints, sp) if (r[1] + 1) / fps > prev_end + 0.1]
        if not runs:
            raise CaptureError(
                f"the recording does not line up with the beats: {b.label!r} is not in it anywhere after "
                f"{prev_end:.1f} s, so its caption would sit on another screen"
            )
        est = frame_time(b)
        first, last = min(runs, key=lambda r: abs(r[1] / fps - est))
        end = (last + 1) / fps
        if duration is not None:
            end = min(end, duration)
        shift = end - b.end
        start = max(prev_end, b.start + shift, 0.0)
        if end - start < 0.5:
            start = max(prev_end, first / fps)
        out.append(BeatWindow(b.label, b.caption, round(start, 3), round(end, 3), video=b.video, still=b.still))
        prev_end = end
    return out


def align(cfr: pathlib.Path, beats: list[BeatWindow], work: pathlib.Path, duration: float) -> list[BeatWindow]:
    """`realign` over the recording, sampled at `ALIGN_FPS` and shrunk (a difference hash is
    17 by 16 pixels, so nothing is lost)."""
    from . import pictures

    if not any(b.still is not None and b.video is None and b.still.exists() for b in beats):
        return beats
    frames = work / "align"
    if frames.exists():
        for p in frames.glob("f-*.png"):
            p.unlink()
    frames.mkdir(parents=True, exist_ok=True)
    _run([tools.ffmpeg(), "-y", "-hide_banner", "-loglevel", "error", "-i", str(cfr), "-vf", f"fps={ALIGN_FPS},scale=96:-1",
          str(frames / "f-%05d.png")], "sampling the recording to find each beat", timeout=1800)  # fmt: skip
    frame_files = sorted(frames.glob("f-*.png"))
    frame_prints = pictures.fingerprints(frame_files)
    stills = [b.still if (b.still is not None and b.video is None and b.still.exists()) else None for b in beats]
    known = pictures.fingerprints([s for s in stills if s is not None])
    it = iter(known)
    still_prints = [next(it) if s is not None else None for s in stills]
    return realign(beats, frame_prints, still_prints, ALIGN_FPS, duration)


def _run_helper_caption(text: str, width: int, out: str) -> None:
    r = subprocess.run([str(tools.helper()), "caption", "--text", text, "--width", str(width), "--out", out], capture_output=True, text=True, timeout=60, check=False)
    if r.returncode != 0:
        raise CaptureError(f"drawing the caption failed: {r.stderr.strip()[-300:]}")
