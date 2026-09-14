"""`python -m capture demo --publish` and `--delete`: one project's demo, from this Mac to the
account's server, only when asked (docs/demos.md, "What leaves the Mac, and when").

A demo is made by `python -m capture demo` (capture/demo/, the generator) into
`<BUILDER_DEMOS_DIR or ~/.builder/demos>/<key>/`, beside a `manifest.json` of a fixed shape:

    {"version": 1, "project_key": "<64 hex>", "kind": "expo_ios|web|cli|library",
     "commit": "<sha>", "taken_at": "<ISO UTC>",
     "assets": [{"file", "kind", "content_type", "width", "height", "duration_ms"?,
                 "position", "label", "poster"?, "source"}, ...],
     "privacy": {"checked": true, "engine": "vision", "refused": []}}

Nothing here makes, edits or looks inside a picture beyond its first bytes and its size. What
this module decides is whether a demo may LEAVE, and it refuses, before a byte is sent and
saying which file and why, unless:

  * the generator's privacy check ran (`privacy.checked`) and refused nothing (`refused`):
    the Vision pass over every still and sampled frames that looks for the private
    repository's name and anything shaped like a key (docs/demos.md, generator step 6);
  * every file is what the contract's `project_media` section allows: PNG, JPEG or MP4 by
    its own first bytes, inside its size cap, at most 8 stills and one video of at most 31 s,
    a label of plain words, a `source` from the list;
  * the project is not one `BUILDER_CAPTURE_EXCLUDE` names.

Then it prints exactly what will go (every file, the counts, the bytes in all) and waits for a
yes (`--yes` for a script; with no terminal and no `--yes` it sends nothing). WHAT GOES is the
presign body per file, the contract's fields and nothing else: the manifest's `commit` (a
commit SHA, on the never list), `taken_at`, `kind` and every file NAME stay here. The numbers
are the file's own where the file says them (a PNG's or JPEG's size, an MP4's length), so a
manifest that disagrees with its pictures cannot put a wrong number on the phone.

The order is the server's contract for a set (routes/media.py): under one fresh `publish_id`,
presign each file right before its upload (so its URL lives only as long as that upload), then
commit every file; the commit that completes the set replaces the demo the project had. A
failure before the commits leaves the old demo showing. A failure DURING them cannot be read
from here: the answer to the last commit can be lost after the server replaced the demo, so
the command says it cannot tell and how to look (`--list`, the phone's own list).

AUTH: the paired Mac's device credentials (`python -m capture pair`), refreshed and rotated
by `capture.client`. Never a capture key: the server refuses one on every demo route
(routes/media.py says why), so a key in the environment is ignored here rather than sent to
be refused.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import secrets
import struct
import sys
from dataclasses import dataclass

from . import client as cl
from . import identity, repo
from .tuning import REPO_HASH_PREFIX, REPO_PEPPER

# The contract's `project_media` section, restated because capture runs with nothing but the
# standard library and the server image ships no `privacy/`; capture/tests/test_demo_publish.py
# holds every one of these to privacy/upload-contract.json both ways.
CONTENT_TYPES: dict[str, tuple[str, int]] = {
    "image/png": ("image", 6291456),
    "image/jpeg": ("image", 6291456),
    "video/mp4": ("video", 41943040),
}
POSTER_TYPES = ("image/jpeg", "image/png")
KINDS = ("image", "video")
SOURCES = ("capture", "checkout", "transcript", "previous")
MAX_IMAGES = 8
MAX_VIDEOS = 1
MAX_VIDEO_MS = 31000
MAX_PIXELS = 8192
MAX_POSITION = 63
LABEL_MAX = 80
LABEL_WORD = 24
LABEL_PATTERN = r"^[A-Za-z0-9 ,.'():?!&]+$"
#: Every key a presign carries (the contract's `project_media.fields`), in contract order.
PRESIGN_FIELDS = (
    "publish_id",
    "kind",
    "content_type",
    "bytes",
    "width",
    "height",
    "duration_ms",
    "position",
    "label",
    "source",
    "poster",
)

MANIFEST_VERSION = 1
KEY_RE = re.compile(r"^[0-9a-f]{64}$")
_LABEL = re.compile(LABEL_PATTERN)


class Refused(Exception):
    """A demo that may not leave, and the sentence that says which file and why."""


def demos_dir() -> pathlib.Path:
    raw = os.environ.get("BUILDER_DEMOS_DIR", "").strip()
    return pathlib.Path(raw).expanduser() if raw else pathlib.Path.home() / ".builder" / "demos"


# ------------------------------------------------------------------------------ the project


def _excluded_keys() -> set[str]:
    return {identity.repo_hash(o, REPO_PEPPER, REPO_HASH_PREFIX) for o in repo.excluded_origins()}


def resolve_key(project: str | None, key: str | None) -> str:
    """The project key: `--key` as given, or the salted hash of `--project`'s repository
    (the current directory by default), the same `repo_hash` a session upload carries."""
    if key is not None:
        key = key.strip().lower()
        if not KEY_RE.match(key):
            raise Refused(f"{key!r} is not a project key (64 lowercase hex characters)")
    else:
        path = os.path.abspath(os.path.expanduser(project or "."))
        found = repo.identity_for(path)
        if found is None:
            raise Refused(f"{path} is not inside a git repository, so it has no project key")
        key = found.hash
    if key in _excluded_keys():
        raise Refused("BUILDER_CAPTURE_EXCLUDE names this project's repository, so nothing of it leaves")
    return key


# ------------------------------------------------------------------------------ the files


def _png_size(head: bytes) -> tuple[int, int] | None:
    if head[:8] != b"\x89PNG\r\n\x1a\n" or head[12:16] != b"IHDR" or len(head) < 24:
        return None
    return struct.unpack(">II", head[16:24])


def _jpeg_size(path: pathlib.Path) -> tuple[int, int] | None:
    """Width and height from the first start of frame marker, or None."""
    with path.open("rb") as f:
        if f.read(2) != b"\xff\xd8":
            return None
        while True:
            b = f.read(1)
            while b and b != b"\xff":
                b = f.read(1)
            while b == b"\xff":
                b = f.read(1)
            if not b:
                return None
            marker = b[0]
            if marker == 0xD8 or marker == 0x01 or 0xD0 <= marker <= 0xD7:
                continue
            raw = f.read(2)
            if len(raw) < 2:
                return None
            length = struct.unpack(">H", raw)[0]
            if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                data = f.read(5)
                if len(data) < 5:
                    return None
                h, w = struct.unpack(">xHH", data)
                return w, h
            f.seek(length - 2, 1)


def _mp4_duration_ms(path: pathlib.Path) -> int | None:
    """The movie's length from its `moov/mvhd` box, or None when it cannot be read."""
    end = path.stat().st_size
    with path.open("rb") as f:

        def boxes(start: int, stop: int):
            pos = start
            while pos + 8 <= stop:
                f.seek(pos)
                n, kind = struct.unpack(">I4s", f.read(8))
                head = 8
                if n == 1:
                    n = struct.unpack(">Q", f.read(8))[0]
                    head = 16
                elif n == 0:
                    n = stop - pos
                if n < head or pos + n > stop:
                    return
                yield kind, pos + head, pos + n
                pos += n

        for kind, start, stop in boxes(0, end):
            if kind != b"moov":
                continue
            for inner, s, _ in boxes(start, stop):
                if inner != b"mvhd":
                    continue
                f.seek(s)
                version = f.read(4)[0]
                if version == 1:
                    f.seek(16, 1)
                    timescale, duration = struct.unpack(">IQ", f.read(12))
                else:
                    f.seek(8, 1)
                    timescale, duration = struct.unpack(">II", f.read(8))
                return round(duration * 1000 / timescale) if timescale else None
    return None


def _head(path: pathlib.Path, n: int = 32) -> bytes:
    with path.open("rb") as f:
        return f.read(n)


def looks_like(content_type: str, head: bytes) -> bool:
    """The server's `project_media.looks_like`, on this side: a file is sent only as what its
    own first bytes say it is."""
    if content_type == "image/png":
        return head.startswith(b"\x89PNG\r\n\x1a\n")
    if content_type == "image/jpeg":
        return head.startswith(b"\xff\xd8\xff")
    if content_type == "video/mp4":
        return len(head) >= 12 and head[4:8] == b"ftyp"
    return False


def label_refusal(label) -> str | None:
    """The server's `project_media.label_refusal`, word for word, so a label is refused here
    with the same sentence rather than as a 422 after the other files were presigned."""
    if not isinstance(label, str) or not label.strip():
        return "a label says what the screen shows; this one is empty"
    if len(label) > LABEL_MAX:
        return f"a label is at most {LABEL_MAX} characters; this one is {len(label)}"
    if label != label.strip() or "  " in label:
        return "a label has single spaces between words and none at either end"
    bad = sorted({ch for ch in label if not _LABEL.match(ch)})
    if bad:
        shown = " ".join(repr(ch) for ch in bad[:5])
        return f"a label is plain words (letters, digits and , . ' ( ) : ? ! &); it may not carry {shown}"
    if not any(ch.isalpha() for ch in label):
        return "a label needs at least one word"
    long = [w for w in label.split(" ") if len(w) > LABEL_WORD]
    if long:
        return f"no word in a label is over {LABEL_WORD} characters; {len(long[0])} reads as an id"
    return None


@dataclass
class Asset:
    file: pathlib.Path
    kind: str
    content_type: str
    bytes: int
    width: int
    height: int
    duration_ms: int | None
    position: int
    label: str
    source: str
    poster: pathlib.Path | None = None
    poster_type: str | None = None
    poster_bytes: int | None = None
    note: str | None = None

    def presign(self, publish_id: str) -> dict:
        """The presign body: the contract's fields, and nothing else from the manifest."""
        body = {
            "publish_id": publish_id,
            "kind": self.kind,
            "content_type": self.content_type,
            "bytes": self.bytes,
            "width": self.width,
            "height": self.height,
            "duration_ms": self.duration_ms,
            "position": self.position,
            "label": self.label,
            "source": self.source,
            "poster": (
                {"content_type": self.poster_type, "bytes": self.poster_bytes} if self.poster else None
            ),
        }
        assert tuple(body) == PRESIGN_FIELDS
        return body


def _inside(d: pathlib.Path, name, what: str) -> pathlib.Path:
    """A file the manifest names, which must be a plain name in the demo's own directory: no
    path, no `..`, no link out. The manifest is data; it does not get to point at ~/.ssh."""
    if not isinstance(name, str) or not name or "/" in name or "\\" in name or name.startswith("."):
        raise Refused(f"{what} {name!r} is not a file name in the demo's directory")
    p = d / name
    if not p.is_file() or p.resolve().parent != d.resolve():
        raise Refused(f"{what} {name} is not a file in {d}")
    return p


def _int(asset: dict, field: str, lo: int, hi: int, name: str) -> int:
    v = asset.get(field)
    if not isinstance(v, int) or isinstance(v, bool) or not lo <= v <= hi:
        raise Refused(f"{name}: {field} must be a whole number from {lo} to {hi}, not {v!r}")
    return v


def _asset(d: pathlib.Path, a: dict) -> Asset:
    if not isinstance(a, dict):
        raise Refused(f"an asset in the manifest is {a!r}, not an object")
    path = _inside(d, a.get("file"), "the asset")
    name = path.name
    kind, ctype, source = a.get("kind"), a.get("content_type"), a.get("source")
    if ctype not in CONTENT_TYPES:
        raise Refused(f"{name}: {ctype!r} is not one of {', '.join(CONTENT_TYPES)}")
    if kind not in KINDS or CONTENT_TYPES[ctype][0] != kind:
        raise Refused(f"{name}: {ctype} is not a kind {kind!r} file")
    if source not in SOURCES:
        raise Refused(f"{name}: source {source!r} is not one of {', '.join(SOURCES)}")
    size = path.stat().st_size
    cap = CONTENT_TYPES[ctype][1]
    if not 0 < size <= cap:
        raise Refused(f"{name} is {size:,} bytes; {ctype} is at most {cap:,}")
    head = _head(path)
    if not looks_like(ctype, head):
        raise Refused(f"{name} does not start like {ctype}; its first bytes say otherwise")
    refusal = label_refusal(a.get("label"))
    if refusal:
        raise Refused(f"{name}: {refusal}")
    width = _int(a, "width", 1, MAX_PIXELS, name)
    height = _int(a, "height", 1, MAX_PIXELS, name)
    position = _int(a, "position", 0, MAX_POSITION, name)
    note = None
    measured = _png_size(head) if ctype == "image/png" else _jpeg_size(path) if ctype == "image/jpeg" else None
    if measured is not None and measured != (width, height):
        note = f"the manifest says {width}x{height} and the file is {measured[0]}x{measured[1]}; sending the file's"
        width, height = measured
        if not (0 < width <= MAX_PIXELS and 0 < height <= MAX_PIXELS):
            raise Refused(f"{name} is {width}x{height}, over {MAX_PIXELS} pixels a side")
    duration = None
    poster = poster_type = poster_bytes = None
    if kind == "video":
        said = a.get("duration_ms")
        duration = _mp4_duration_ms(path)
        if duration is None:
            duration = _int(a, "duration_ms", 1, MAX_VIDEO_MS, name)
        elif isinstance(said, int) and abs(said - duration) > 500:
            note = f"the manifest says {said} ms and the file is {duration} ms; sending the file's"
        if not 1 <= duration <= MAX_VIDEO_MS:
            raise Refused(f"{name} is {duration / 1000:.1f} s; a demo video is at most {MAX_VIDEO_MS / 1000:.0f} s")
        if a.get("poster") is not None:
            poster = _inside(d, a["poster"], f"{name}'s poster")
            first = _head(poster, 8)
            poster_type = next((t for t in POSTER_TYPES if looks_like(t, first)), None)
            if poster_type is None:
                raise Refused(f"{poster.name} is not a JPEG or a PNG; its first bytes say otherwise")
            poster_bytes = poster.stat().st_size
            cap = CONTENT_TYPES[poster_type][1]
            if not 0 < poster_bytes <= cap:
                raise Refused(f"{poster.name} is {poster_bytes:,} bytes; a poster is at most {cap:,}")
    elif a.get("duration_ms") is not None or a.get("poster") is not None:
        raise Refused(f"{name} is an image, and an image has no duration or poster")
    return Asset(path, kind, ctype, size, width, height, duration, position, a["label"], source,
                 poster, poster_type, poster_bytes, note)  # fmt: skip


def _refused_list(refused) -> str:
    out = []
    for r in refused if isinstance(refused, list) else [refused]:
        if isinstance(r, dict):
            where = r.get("file") or r.get("asset") or "a file"
            why = r.get("reason") or r.get("why") or r.get("found") or json.dumps(r, sort_keys=True)
            out.append(f"{where}: {why}")
        else:
            out.append(str(r))
    return "; ".join(out)


def load(key: str) -> tuple[pathlib.Path, list[Asset]]:
    """The demo of `key`, every file checked, or `Refused` with the sentence that says why."""
    d = demos_dir() / key
    mpath = d / "manifest.json"
    if not mpath.is_file():
        raise Refused(f"no demo for this project at {d} (make one with `python -m capture demo`)")
    try:
        m = json.loads(mpath.read_text())
    except (OSError, json.JSONDecodeError) as e:
        raise Refused(f"{mpath} is not readable JSON: {e}") from e
    if not isinstance(m, dict) or m.get("version") != MANIFEST_VERSION:
        raise Refused(f"{mpath} is not a version {MANIFEST_VERSION} demo manifest")
    if m.get("project_key") != key:
        raise Refused(f"{mpath} is the demo of project {str(m.get('project_key'))[:12]}, not {key[:12]}")
    privacy = m.get("privacy")
    if not isinstance(privacy, dict) or privacy.get("checked") is not True:
        raise Refused(
            "the privacy check has not run on this demo, so it does not leave "
            "(run `python -m capture demo` again; it reads every picture for names and keys)"
        )
    if privacy.get("refused"):
        raise Refused(f"the privacy check refused this demo: {_refused_list(privacy['refused'])}")
    raw = m.get("assets")
    if not isinstance(raw, list) or not raw:
        raise Refused(f"{mpath} lists no files")
    assets = [_asset(d, a) for a in raw]
    images = [a for a in assets if a.kind == "image"]
    videos = [a for a in assets if a.kind == "video"]
    if len(images) > MAX_IMAGES:
        raise Refused(f"the demo has {len(images)} stills; one publish sends at most {MAX_IMAGES}")
    if len(videos) > MAX_VIDEOS:
        raise Refused(f"the demo has {len(videos)} videos; one publish sends at most one")
    for group in (images, videos):
        seen: dict[int, str] = {}
        for a in group:
            if a.position in seen:
                raise Refused(f"{a.file.name} and {seen[a.position]} are both at position {a.position}")
            seen[a.position] = a.file.name
    return d, videos + sorted(images, key=lambda a: a.position)


# ------------------------------------------------------------------------------ printing


def _mb(n: int) -> str:
    return f"{n / 1_000_000:.1f} MB"


def total_bytes(assets: list[Asset]) -> int:
    return sum(a.bytes + (a.poster_bytes or 0) for a in assets)


def file_count(assets: list[Asset]) -> int:
    return len(assets) + sum(1 for a in assets if a.poster)


def _counted(n: int, one: str) -> str:
    words = {1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight"}
    return f"{words.get(n, n)} {one}{'' if n == 1 else 's'}"


def summary(key: str, server: str, assets: list[Asset]) -> list[str]:
    """Exactly what will be sent, file by file, then the counts and the bytes in all."""
    lines = [f"Publishing the demo of project {key[:12]} to {server}", ""]
    for a in assets:
        length = f"{a.duration_ms / 1000:.1f} s" if a.duration_ms else ""
        lines.append(
            f"  {a.kind:<6} {a.file.name:<22} {a.width}x{a.height:<6} {length:>7} "
            f"{_mb(a.bytes):>9}  \"{a.label}\""
        )
        if a.poster:
            lines.append(f"  {'':<6} {a.poster.name:<22} {'its still frame':<22} {_mb(a.poster_bytes):>9}")
        if a.note:
            lines.append(f"  {'':<6} {a.note}")
    videos = sum(1 for a in assets if a.kind == "video")
    images = len(assets) - videos
    parts = [p for p in (_counted(videos, "video") if videos else "", _counted(images, "image") if images else "") if p]
    total = total_bytes(assets)
    lines += [
        "",
        f"{' and '.join(parts).capitalize()}: {_counted(file_count(assets), 'file')}, {total:,} bytes ({_mb(total)}) in all.",
        "With each file go its size, width, height, length, place, label and where it came from.",
        "Not the file names, not the commit it was taken at, not the project's name.",
        "Only you will see it, and it replaces the demo this project has on the server now.",
    ]
    return lines


def _confirm(prompt: str, yes: bool) -> bool:
    if yes:
        return True
    if not sys.stdin.isatty():
        print("Nothing sent: pass --yes to answer yes without a terminal.", file=sys.stderr)
        return False
    try:
        answer = input(f"{prompt} [y/N] ")
    except EOFError:
        return False
    return answer.strip().lower() in ("y", "yes")


# ------------------------------------------------------------------------------ commands


class NotPairedForDemos(cl.NotPaired):
    def __str__(self) -> str:
        return (
            "not paired: run `python -m capture pair --server URL` first. A capture key "
            "cannot publish or delete a demo; the paired Mac does"
        )


def _client(server: str) -> cl.Client:
    """The paired Mac's credentials, never a capture key (the module docstring): the client
    is made without one whatever BUILDER_CAPTURE_KEY says."""
    if cl.load_credentials() is None:
        raise NotPairedForDemos()
    return cl.Client(server)


def publish(key: str, server: str, yes: bool, stills_only: bool = False) -> int:
    try:
        _, assets = load(key)
        if stills_only:
            # The owner, 2026-09-14: "just screenshots for now". A publish replaces the whole
            # set, so the video that was on the server goes with it.
            assets = [a for a in assets if a.kind != "video"]
            if not assets:
                raise Refused("the demo has no stills to send without its video")
    except Refused as e:
        print(f"Not publishing: {e}", file=sys.stderr)
        return 2
    print("\n".join(summary(key, server, assets)))
    c = _client(server)
    if not _confirm(f"Send these {file_count(assets)} files?", yes):
        print("Nothing was sent.")
        return 1
    publish_id = secrets.token_hex(8)
    slots: list[dict] = []
    step = ""
    committing = False
    try:
        # Each file is presigned right before its upload: its URL lives only as long as that
        # one upload needs (server/builder/project_media.py upload_seconds), and a URL that
        # outlives its use is one an object can still land through at the bucket.
        for a in assets:
            step = f"the presign of {a.file.name}"
            slot = c.media_presign(key, a.presign(publish_id))
            slots.append(slot)
            step = a.file.name
            c.put_object(slot["upload_url"], a.file.read_bytes(), slot["headers"])
            if a.poster:
                step = a.poster.name
                c.put_object(slot["poster"]["upload_url"], a.poster.read_bytes(), slot["poster"]["headers"])
        replaced = 0
        committing = True
        for a, slot in zip(assets, slots, strict=True):
            step = f"the commit of {a.file.name}"
            replaced += int(c.media_commit(key, slot["media_id"]).get("replaced") or 0)
    except cl.HTTPFailure as e:
        if not committing:
            # Nothing of this publish was committed, and only a complete set replaces.
            print(
                f"The publish stopped at {step}: {e}. Nothing of it was committed, so the demo "
                "on the server is still the one that was there; run the publish again.",
                file=sys.stderr,
            )
        else:
            # A commit's answer can be lost after the server acted on it, and the last commit
            # is the one that replaces: this side cannot know which happened.
            print(
                f"The publish stopped at {step}: {e}. This Mac cannot tell whether the server "
                "finished it, so the project's demo may be the one that was there or this one. "
                f"See which with `python -m capture demo --list --key {key}`, and run the "
                "publish again to be sure.",
                file=sys.stderr,
            )
        return 4
    videos = sum(1 for a in assets if a.kind == "video")
    images = len(assets) - videos
    what = " and ".join(
        p for p in (_counted(videos, "video") if videos else "", _counted(images, "image") if images else "") if p
    )
    print(f"Published {what} ({_mb(total_bytes(assets))}).")
    # `replaced` and `deleted` count rows, the items the phone shows (a poster rides on its
    # video's row), so the sentence says items, not files.
    print(
        f"It replaced the demo that was there ({_counted(replaced, 'item')} on the phone)."
        if replaced
        else "This is the first demo of this project on the server."
    )
    return 0


def listing(key: str, server: str) -> int:
    """What the server shows for this project now: the phone's list, read with this Mac's
    device token. The way to see how a publish that lost an answer ended."""
    items = _client(server).media_list(key).get("items") or []
    if not items:
        print(f"The server shows no demo of project {key[:12]}.")
        return 0
    print(f"The server shows this demo of project {key[:12]}:")
    for i in items:
        length = f" {i['duration_ms'] / 1000:.1f} s" if i.get("duration_ms") else ""
        print(f"  {i['kind']:<6} {i['position']:>2}  {i['width']}x{i['height']}{length}  \"{i['label']}\"")
    return 0


def delete(key: str, server: str, yes: bool) -> int:
    c = _client(server)
    if not _confirm(f"Delete the published demo of project {key[:12]} from {server}?", yes):
        print("Nothing was deleted.")
        return 1
    n = int(c.media_delete(key).get("deleted") or 0)
    print(
        f"Deleted this project's demo from the server ({_counted(n, 'item')} on the phone). "
        "The copy on this Mac is untouched."
        if n
        else "The server held no demo of this project."
    )
    return 0


def make_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="python -m capture demo",
        description="Publish a project's demo to your account, list what the server shows "
        "for it, or delete the published one. Making a demo is `python -m capture demo` "
        "without any of these flags.",
    )
    act = ap.add_mutually_exclusive_group(required=True)
    act.add_argument("--publish", action="store_true", help="send this project's demo, after a yes")
    act.add_argument("--delete", action="store_true", help="delete this project's published demo")
    act.add_argument("--list", action="store_true", help="what the server shows for this project now")
    which = ap.add_mutually_exclusive_group()
    which.add_argument("--project", help="the project's directory (default: the current one)")
    which.add_argument("--key", help="the project key, the repository's 64 hex salted hash")
    ap.add_argument("--yes", action="store_true", help="answer yes; with no terminal this is required")
    ap.add_argument("--no-video", action="store_true", help="--publish: send the stills and not the video")
    ap.add_argument("--server", help="API base URL (or BUILDER_API_URL)")
    return ap


def main(argv: list[str]) -> int:
    a = make_parser().parse_args(argv)
    server = (a.server or os.environ.get("BUILDER_API_URL") or cl.DEFAULT_SERVER).rstrip("/")
    try:
        key = resolve_key(a.project, a.key)
    except Refused as e:
        doing = "publishing" if a.publish else "deleting" if a.delete else "listing"
        print(f"Not {doing}: {e}", file=sys.stderr)
        return 2
    try:
        if a.list:
            return listing(key, server)
        return publish(key, server, a.yes, a.no_video) if a.publish else delete(key, server, a.yes)
    except cl.NotPaired as e:
        print(str(e), file=sys.stderr)
        return 3
    except cl.HTTPFailure as e:
        print(str(e), file=sys.stderr)
        return 4


def claims(argv: list[str]) -> bool:
    """Whether a `python -m capture` command line is this module's: `demo` with `--publish`,
    `--delete` or `--list`. Everything else about `demo` is the generator's (capture/demo/)."""
    return argv[:1] == ["demo"] and bool({"--publish", "--delete", "--list"} & set(argv[1:]))


__all__ = ["Asset", "Refused", "claims", "load", "main", "resolve_key", "summary"]
