"""Stage 5: read every pixel of text before anything can be marked publishable.

Pixels leak what redaction cannot: supercut's own privacy note says redaction "cannot cover
images" (docs/research/demo-capture.md section 4). So Apple Vision reads the text in every still
and in frames sampled from the video, and the demo is REFUSED, with the file and the box, when
that text shows:

    repo_name   the repository's name: the origin's (`gt-transit`), its `owner/name`, or the
                folder's (`RideGT`, `builder-overnight`), because a person recognises either
    token       anything shaped like a token or key: every shape `analysis.digest` masks in a
                transcript (the one list of them in this codebase, imported, never copied),
                plus any 32 or more letters and digits in one run
    email       an email address (the digest's pattern)

Matching is on the TEXT, so it is tested with fixtures (`test_demo_privacy`), never with Vision.
A name matches as whole words, case folded, with punctuation between words ignored, so OCR
reading `gt-transit` as `GT Transit` or `gt—transit` still matches, and `builder` does not match
inside `Builda`. A name of two or more words also matches squashed (`gttransit`), which is how a
wordmark sets it; one word names do not, or `builder` would match inside every longer word.

A one word name that is also an ORDINARY WORD (in the Mac's own `/usr/share/dict/words`) matches
where a name is shown: a line of at most three words (a tile's label, a title, a breadcrumb) or a
path (`owner/builder`, `builder/mobile`). Not inside a sentence. FOUND ON THE FIRST RUN: Builda's
repository is `builder`, and its own Wrapped card asks "Which kind of builder are you?". Refusing
that is a check that cries leak on correct output (CLAUDE.md: worse than none, because the next
thing a person does is allow the name, and then the tile that really does print `builder` goes
out). The residual case is prose that uses a dictionary word name as the name; it is recorded
here rather than guessed at.

The OTHER repositories this Mac's transcripts worked in are refused too (`other_repo_name`): the
same first run filmed Builda's sample Now tab, whose tiles carry the owner's real repository
names, one of them RideGT's. A demo of one project is not a place to show the others.

A refusal records the matched text MASKED: the manifest is a file on disk, and a token found in
a frame is no less a token for being in a JSON document about the frame.
"""

from __future__ import annotations

import dataclasses
import functools
import json
import pathlib
import re
import subprocess
import tempfile

from analysis import digest

from . import tools

#: A run of 32 or more letters, digits, `_` or `-` with at least one letter and one digit: an
#: API key, a hex digest, a JWT segment. Generous on purpose; a refusal says where it was.
_TOKENISH = re.compile(r"(?<![A-Za-z0-9_\-])(?=[A-Za-z0-9_\-]*\d)(?=[A-Za-z0-9_\-]*[A-Za-z])[A-Za-z0-9_\-]{32,}(?![A-Za-z0-9_\-])")
#: A React Native crash screen is not a demo of anything, and must never become the "last good
#: capture" a later run falls back to. FOUND ON THE SECOND RIDEGT RUN: an embedded debug bundle
#: stopped at "[runtime not ready]: Error: Cannot create devtools websocket connections in
#: embedded environments", filmed for four beats, and would have passed every other check.
ERROR_SCREEN = re.compile(
    r"Uncaught Error|Render Error|runtime not ready|Unable to load script|No bundle URL present|"
    r"Unhandled JS Exception|Invariant Violation|Connect to Metro to develop JavaScript"
)
#: How often the video is sampled for the check, frames per second.
SAMPLE_FPS = 2
MIN_NAME = 3


@dataclasses.dataclass(frozen=True)
class Line:
    text: str
    box: tuple[int, int, int, int]
    confidence: float = 1.0


@dataclasses.dataclass(frozen=True)
class Hit:
    reason: str
    text: str
    box: tuple[int, int, int, int]


def _words(s: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", s.lower()))


def _squash(s: str) -> str:
    return "".join(re.findall(r"[a-z0-9]+", s.lower()))


DICTIONARY = pathlib.Path("/usr/share/dict/words")
#: A line this short is a label, not a sentence: a tile's repository, a title, a crumb.
LABEL_WORDS = 3


@functools.lru_cache(maxsize=1)
def ordinary_words() -> frozenset[str]:
    """The Mac's word list, lower case. Empty where there is none, which makes every name
    distinctive and the check strict."""
    try:
        return frozenset(w.strip().lower() for w in DICTIONARY.read_text(errors="replace").split())
    except OSError:
        return frozenset()


def name_patterns(names, words: frozenset[str] | None = None) -> list[tuple[str, str, bool, bool]]:
    """(the name, its words, may it match squashed, is it an ordinary word) for names long
    enough to mean something."""
    vocab = ordinary_words() if words is None else words
    out = []
    for n in names:
        w = _words(n)
        if len(_squash(n)) < MIN_NAME:
            continue
        out.append((n, w, " " in w and len(_squash(n)) >= 6, " " not in w and w in vocab))
    return out


def _named(text: str, w: str, squash: bool, ordinary: bool) -> bool:
    words = _words(text)
    if f" {w} " not in f" {words} " and not (squash and w.replace(" ", "") in _squash(text)):
        return False
    if not ordinary:
        return True
    if len(words.split()) <= LABEL_WORDS:
        return True
    return bool(re.search(rf"[/\\:@~]{re.escape(w)}\b|\b{re.escape(w)}[/\\]", text.lower()))


def find(lines: list[Line], names, other_names=(), words: frozenset[str] | None = None) -> list[Hit]:
    """Every private name, key shaped string and email address in one image's text."""
    own = name_patterns(names, words)
    others = name_patterns(other_names, words)
    hits: list[Hit] = []
    for ln in lines:
        text = ln.text
        for reason, pats in (("repo_name", own), ("other_repo_name", others)):
            hit = next((name for name, w, sq, ordn in pats if _named(text, w, sq, ordn)), None)
            if hit:
                hits.append(Hit(reason, hit, ln.box))
                break
        for pat in digest._SECRET_PATTERNS:
            if pat.search(text):
                hits.append(Hit("token", digest.mask(text), ln.box))
                break
        else:
            if _TOKENISH.search(text):
                hits.append(Hit("token", _TOKENISH.sub("[token]", digest.mask(text)), ln.box))
        if digest._EMAIL.search(text):
            hits.append(Hit("email", digest._EMAIL.sub("[email]", digest.mask(text)), ln.box))
        m = ERROR_SCREEN.search(text)
        if m:
            hits.append(Hit("error_screen", m.group(0), ln.box))
    return hits


def other_names(others: list[tuple[str, str | None]], own: tuple[str, ...]) -> tuple[str, ...]:
    """The names of the other repositories the transcripts worked in (origin name, owner/name
    and folder), minus any this project shares."""
    from .project import names_for

    mine = {n.lower() for n in own}
    out: list[str] = []
    for ident, root in others:
        for n in names_for(ident, [pathlib.Path(root).name] if root else []):
            if n.lower() not in mine and n not in out:
                out.append(n)
    return tuple(out)


def label_leaks(texts: list[str], names, others=(), words=None) -> list[str]:
    """Labels and captions travel with a demo as TEXT (the phone shows them, `--publish` sends
    them), so a private name in one is a leak no pixel check would see. Returns each offending
    text with the name it carries."""
    out = []
    for t in texts:
        for h in find([Line(t, (0, 0, 0, 0))], names, others, words):
            if h.reason in ("repo_name", "other_repo_name"):
                out.append(f"{t!r} names {h.text}")
    return out


def refusals(results: list[dict], names, labels: dict[str, str] | None = None, other_names=(), words=None) -> list[dict]:
    """OCR results (the helper's JSON, one entry per image) to `privacy.refused` entries:
    `{"file", "box": {x, y, width, height}, "reason", "text"}` plus `at_ms` for a video frame.
    A video shows one name in many sampled frames; it is refused once per file, reason and
    text, at the first frame it appears in."""
    out = []
    seen: set[tuple[str, str, str]] = set()
    for r in results:
        lines = [Line(str(x.get("text", "")), tuple(int(v) for v in x.get("box", (0, 0, 0, 0)))) for x in r.get("lines") or []]
        for h in find(lines, names, other_names, words):
            src = str(r.get("file", ""))
            entry = {
                "file": (labels or {}).get(src, pathlib.Path(src).name),
                "box": {"x": h.box[0], "y": h.box[1], "width": h.box[2], "height": h.box[3]},
                "reason": h.reason,
                "text": h.text,
            }
            if "at_ms" in r:
                entry["at_ms"] = r["at_ms"]
            key = (entry["file"], h.reason, h.text)
            if key in seen:
                continue
            seen.add(key)
            out.append(entry)
    return out


# ----------------------------------------------------------------------------- Vision


def ocr(files: list[pathlib.Path]) -> list[dict]:
    """Vision text recognition through the compiled helper, in batches."""
    exe = tools.helper()
    out: list[dict] = []
    for i in range(0, len(files), 24):
        batch = [str(f) for f in files[i : i + 24]]
        r = subprocess.run([str(exe), "ocr", *batch], capture_output=True, text=True, timeout=600, check=False)
        if r.returncode != 0:
            raise RuntimeError(f"text recognition failed: {r.stderr.strip()[-300:]}")
        out.extend(json.loads(r.stdout))
    return out


def sample_frames(video: pathlib.Path, into: pathlib.Path, fps: int = SAMPLE_FPS) -> list[tuple[pathlib.Path, int]]:
    """(frame png, its time in ms) at `fps` frames a second."""
    into.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(
        [tools.ffmpeg(), "-hide_banner", "-loglevel", "error", "-i", str(video), "-vf", f"fps={fps}",
         str(into / "f-%05d.png")],
        capture_output=True, text=True, timeout=900, check=False,
    )  # fmt: skip
    if r.returncode != 0:
        raise RuntimeError(f"sampling the video failed: {r.stderr.strip()[-300:]}")
    frames = sorted(into.glob("f-*.png"))
    return [(f, round(i * 1000 / fps)) for i, f in enumerate(frames)]


def check(stills: list[pathlib.Path], video: pathlib.Path | None, names, poster: pathlib.Path | None = None, other_names=()) -> tuple[list[dict], int]:
    """Every still, the poster and the video's sampled frames through Vision. Returns
    (refusals, images read)."""
    images = list(stills) + ([poster] if poster else [])
    results = ocr(images) if images else []
    for r in results:
        r["file"] = pathlib.Path(r["file"]).name
    read = len(images)
    if video is not None:
        with tempfile.TemporaryDirectory(prefix="demo-frames-") as tmp:
            frames = sample_frames(video, pathlib.Path(tmp))
            got = ocr([f for f, _ in frames]) if frames else []
            at = {str(f): ms for f, ms in frames}
            for r in got:
                r["at_ms"] = at.get(r["file"], 0)
                r["file"] = video.name
            results.extend(got)
            read += len(frames)
    return refusals(results, names, other_names=other_names), read
