"""Stage 7: `~/.builder/demos/<key>/manifest.json`, the one document the publish side reads.

    {"version": 1, "project_key": "<64 hex>", "kind": "expo_ios|web|cli|library",
     "commit": "<sha>", "taken_at": "<ISO 8601 UTC>",
     "assets": [
       {"file": "still-01.png", "kind": "image", "content_type": "image/png", "width": 1206,
        "height": 2622, "position": 1, "label": "the session page, the call chart",
        "source": "capture|checkout|transcript|previous"},
       {"file": "demo.mp4", "kind": "video", "content_type": "video/mp4", "width": 1206,
        "height": 2622, "duration_ms": 18000, "position": 0, "label": "...",
        "poster": "poster.jpg", "source": "capture"}],
     "privacy": {"checked": true, "engine": "vision", "refused": []}}

EXACTLY these keys: `validate` is the check the tests hold every manifest this package writes
to, both ways (no key missing, none added), because a reader that meets a key it does not know
has to guess, and a guess about what may be published is the wrong place for one.

Sizes are read from the files themselves (the PNG header, the JPEG frame header, ffprobe for the
video), never from what a driver believed it captured.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import pathlib
import struct

from . import KINDS, SOURCES

def caps() -> dict:
    """The contract's `project_media` caps, read from the publish side (capture/demo_publish.py
    holds them to privacy/upload-contract.json both ways), so a demo this writes is one
    `--publish` sends. The numbers beside each are the contract's on 2026-09-14, used only when
    the publish side is not deployed next to the generator."""
    try:
        from .. import demo_publish as dp

        return {
            "image_bytes": dp.CONTENT_TYPES["image/png"][1],
            "video_bytes": dp.CONTENT_TYPES["video/mp4"][1],
            "video_ms": dp.MAX_VIDEO_MS,
            "images": dp.MAX_IMAGES,
            "pixels": dp.MAX_PIXELS,
        }
    except (ImportError, AttributeError, KeyError):  # pragma: no cover - deployment shape
        return {"image_bytes": 6291456, "video_bytes": 41943040, "video_ms": 31000, "images": 8, "pixels": 8192}


TOP_KEYS = {"version", "project_key", "kind", "commit", "taken_at", "assets", "privacy"}
IMAGE_KEYS = {"file", "kind", "content_type", "width", "height", "position", "label", "source"}
VIDEO_KEYS = IMAGE_KEYS | {"duration_ms", "poster"}
PRIVACY_KEYS = {"checked", "engine", "refused"}
CONTENT_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".mp4": "video/mp4"}


def _label_refusal(label) -> str | None:
    if not isinstance(label, str):
        return "not a string"
    from .storyboard import label_refusal

    return label_refusal(label)


def image_size(path: pathlib.Path) -> tuple[int, int]:
    """(width, height) from a PNG's IHDR or a JPEG's start of frame. Standard library only."""
    with path.open("rb") as f:
        head = f.read(26)
        if head[:8] == b"\x89PNG\r\n\x1a\n":
            w, h = struct.unpack(">II", head[16:24])
            return int(w), int(h)
        if head[:2] != b"\xff\xd8":
            raise ValueError(f"{path.name} is neither PNG nor JPEG")
        f.seek(2)
        while True:
            b = f.read(1)
            while b and b != b"\xff":
                b = f.read(1)
            while b == b"\xff":
                b = f.read(1)
            if not b:
                break
            marker = b[0]
            if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
                continue
            seg = f.read(2)
            if len(seg) < 2:
                break
            (length,) = struct.unpack(">H", seg)
            if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                data = f.read(5)
                h, w = struct.unpack(">HH", data[1:5])
                return int(w), int(h)
            f.seek(length - 2, os.SEEK_CUR)
    raise ValueError(f"no frame header in {path.name}")


def content_type(path: str | pathlib.Path) -> str:
    ct = CONTENT_TYPES.get(pathlib.Path(path).suffix.lower())
    if ct is None:
        raise ValueError(f"{path}: only PNG, JPEG and MP4 are demo media")
    return ct


def taken_at(now: dt.datetime | None = None) -> str:
    return (now or dt.datetime.now(dt.UTC)).astimezone(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def image_asset(file: str, width: int, height: int, position: int, label: str, source: str) -> dict:
    return {
        "file": file,
        "kind": "image",
        "content_type": content_type(file),
        "width": int(width),
        "height": int(height),
        "position": int(position),
        "label": label,
        "source": source,
    }


def video_asset(file: str, width: int, height: int, duration_ms: int, label: str, poster: str, source: str) -> dict:
    return {
        "file": file,
        "kind": "video",
        "content_type": "video/mp4",
        "width": int(width),
        "height": int(height),
        "duration_ms": int(duration_ms),
        "position": 0,
        "label": label,
        "poster": poster,
        "source": source,
    }


def build(project_key: str, kind: str, commit: str, when: str, assets: list[dict], refused: list[dict], checked: bool = True) -> dict:
    return {
        "version": 1,
        "project_key": project_key,
        "kind": kind,
        "commit": commit,
        "taken_at": when,
        "assets": assets,
        "privacy": {"checked": bool(checked), "engine": "vision", "refused": refused},
    }


def validate(m: dict, directory: pathlib.Path | None = None) -> list[str]:
    """Every way `m` differs from the shape above; empty when it is exactly that shape. With
    `directory`, also that every file it names is there and is the size it says."""
    problems: list[str] = []
    if set(m) != TOP_KEYS:
        problems.append(f"top level keys {sorted(set(m) ^ TOP_KEYS)} differ")
    if m.get("version") != 1:
        problems.append("version is not 1")
    key = m.get("project_key")
    if not (isinstance(key, str) and len(key) == 64 and all(c in "0123456789abcdef" for c in key)):
        problems.append("project_key is not 64 lowercase hex")
    if m.get("kind") not in KINDS:
        problems.append(f"kind {m.get('kind')!r}")
    if not isinstance(m.get("commit"), str) or not m.get("commit"):
        problems.append("commit")
    try:
        dt.datetime.strptime(str(m.get("taken_at")), "%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        problems.append("taken_at is not ISO 8601 UTC")
    videos = 0
    positions = []
    cap = caps()
    for a in m.get("assets") or []:
        for side in ("width", "height"):
            if not (isinstance(a.get(side), int) and 0 < a[side] <= cap["pixels"]):
                problems.append(f"{a.get('file')}: {side} {a.get(side)!r} is not 1 to {cap['pixels']}")
        if a.get("kind") == "video" and not (isinstance(a.get("duration_ms"), int) and 0 < a["duration_ms"] <= cap["video_ms"]):
            problems.append(f"{a.get('file')}: duration_ms {a.get('duration_ms')!r} is over {cap['video_ms']}")
        label_problem = _label_refusal(a.get("label"))
        if label_problem:
            problems.append(f"{a.get('file')}: label: {label_problem}")
        want = VIDEO_KEYS if a.get("kind") == "video" else IMAGE_KEYS
        if set(a) != want:
            problems.append(f"{a.get('file')}: keys {sorted(set(a) ^ want)} differ")
        if a.get("source") not in SOURCES:
            problems.append(f"{a.get('file')}: source {a.get('source')!r}")
        if a.get("kind") == "video":
            videos += 1
            if a.get("position") != 0 or a.get("content_type") != "video/mp4":
                problems.append(f"{a.get('file')}: a video is position 0, video/mp4")
        else:
            positions.append(a.get("position"))
            if a.get("content_type") not in ("image/png", "image/jpeg"):
                problems.append(f"{a.get('file')}: content type {a.get('content_type')!r}")
        if not isinstance(a.get("label"), str) or not a["label"].strip():
            problems.append(f"{a.get('file')}: no label")
        if directory is not None:
            p = directory / str(a.get("file"))
            if not p.is_file():
                problems.append(f"{a.get('file')}: missing")
            else:
                limit = cap["video_bytes"] if a.get("kind") == "video" else cap["image_bytes"]
                if p.stat().st_size > limit:
                    problems.append(f"{a.get('file')}: {p.stat().st_size:,} bytes is over the {limit:,} byte cap")
                if a.get("kind") == "image":
                    try:
                        if image_size(p) != (a.get("width"), a.get("height")):
                            problems.append(f"{a.get('file')}: size differs from the file")
                    except ValueError as e:
                        problems.append(str(e))
            if a.get("kind") == "video" and not (directory / str(a.get("poster"))).is_file():
                problems.append(f"{a.get('file')}: poster missing")
    if videos > 1:
        problems.append("more than one video")
    if len(positions) > cap["images"]:
        problems.append(f"{len(positions)} stills; at most {cap['images']}")
    if positions != list(range(1, len(positions) + 1)):
        problems.append(f"still positions {positions} are not 1..{len(positions)}")
    pv = m.get("privacy") or {}
    if set(pv) != PRIVACY_KEYS or pv.get("engine") != "vision" or not isinstance(pv.get("refused"), list):
        problems.append("privacy block")
    return problems


def write(directory: pathlib.Path, m: dict) -> pathlib.Path:
    problems = validate(m, directory)
    if problems:
        raise ValueError("refusing to write a manifest of the wrong shape: " + "; ".join(problems))
    path = directory / "manifest.json"
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(m, indent=1) + "\n")
    os.replace(tmp, path)
    return path
