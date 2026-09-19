"""The posts beside a demo: one per platform, written by the person's own `claude`, then checked.

THE EVIDENCE RULE, the one drops and the narrative already follow. A model is handed the session
record (the build post's `what`, `hard_part` and `demo`, from analysis/shipped.py), the commit
subjects since the last demo and what the video shows, and asked for a post per platform. Then
every caption is held to four checks, each of which can only REMOVE:

  1. NUMBERS. Every number in it is one the input contains (analysis.narrative's `numbers_in` and
     `known_numbers`, the same normalisation, so "1,211" and "1211" are one number) and STRICTLY:
     the narrative lets numbers up to 12 through as ordinary English, and a caption does not,
     because "3 screens" is a public claim about somebody's work like any other. A caption with
     one number the input lacks is dropped whole (`invented_number`); it is never edited, since a
     sentence with its number cut out says something else.
  2. NAMES. A repository's name, the Mac's other repositories', a key or an email address
     (`capture.demo.privacy.label_leaks`, the rule the demo's labels are held to):
     `names_a_repository`.
  3. LENGTH. Within the platform's limit (spec/shipkit.v1.json `platform_limits`), each thread
     post within 280: `over_limit`.
  4. DASHES. Rewritten, never refused (analysis/run.py `dedash`): a paid call is not thrown away
     over punctuation.

A platform whose caption was dropped, or that got none, gets a TEMPLATE caption made from the
inputs with no model at all (`template`): the build post's `what`, else the video's first caption,
and the first change. It can carry no number the input does not, because it is the input.

The model call is `analysis.run.call_claude`, the one wrapper every model call here goes through:
the person's own subscription, no tools, the caller's session never attached to.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
import json
import pathlib
import re

from . import tables

HERE = pathlib.Path(__file__).resolve().parent
SCHEMA_PATH = HERE / "copy_schema.json"
PROMPT_PATH = HERE / "copy_prompt.txt"
PLATFORMS: list[str] = tables.ENUMS["platform"]
#: Every number counts in a caption (the module docstring, rule 1).
STRICT = -1
#: Sonnet, like the analyst and the drop planner: six short posts, and the ceiling is the checks.
DEFAULT_MODEL = "sonnet"


@dataclasses.dataclass
class Inputs:
    """Everything a caption may say, and nothing else."""

    what: str | None = None
    why: str | None = None
    hard_part: str | None = None
    demo: str | None = None
    stack: list[str] = dataclasses.field(default_factory=list)
    changes: list[str] = dataclasses.field(default_factory=list)
    commits: list[str] = dataclasses.field(default_factory=list)
    shows: list[str] = dataclasses.field(default_factory=list)
    facts: dict[str, int] = dataclasses.field(default_factory=dict)

    @classmethod
    def from_shipped(cls, post: dict | None, **kw) -> Inputs:
        post = post or {}
        return cls(
            what=post.get("what"),
            why=post.get("why"),
            hard_part=post.get("hard_part"),
            demo=post.get("demo"),
            stack=list(post.get("stack") or []),
            changes=[c.get("text", "") for c in post.get("changes") or [] if isinstance(c, dict) and c.get("text")],
            **kw,
        )


def build_input(i: Inputs) -> str:
    """The text the model reads, and the text every number is checked against (pure). The order
    is the instruction, as analysis/shipped.py found: what was made first, the raw material last."""
    lines: list[str] = []
    add = lines.append
    add("WHAT WAS BUILT (the builder's own session record)")
    add(f"  what: {i.what or '(not recorded)'}")
    if i.why:
        add(f"  who it is for: {i.why}")
    if i.changes:
        add("  what is new:")
        for c in i.changes:
            add(f"    - {c}")
    add(f"  what was hard: {i.hard_part or '(nothing recorded as hard; do not invent a difficulty)'}")
    if i.demo:
        add(f"  the moment worth showing: {i.demo}")
    if i.stack:
        add(f"  stack: {', '.join(i.stack)}")
    if i.commits:
        add("")
        add("COMMITS SINCE THE LAST DEMO, as written (never quote a hash or a file name)")
        for c in i.commits:
            add(f"  {c}")
    if i.shows:
        add("")
        add("WHAT THE VIDEO SHOWS, beat by beat")
        for s in i.shows:
            add(f"  {s}")
    if i.facts:
        add("")
        add("NUMBERS YOU MAY USE, and only these")
        for k, v in i.facts.items():
            add(f"  {k}: {v}")
    return "\n".join(lines)


# ------------------------------------------------------------------------ the checks


def numbers_unknown(text: str, source: str) -> list[str]:
    from analysis.narrative import known_numbers, numbers_in

    return sorted(numbers_in(text, STRICT) - known_numbers(source, STRICT))


def check(caption: dict, source: str, names=(), others=()) -> str | None:
    """The refusal code for one caption, or None (pure over its inputs)."""
    from capture.demo.privacy import label_leaks

    platform = caption["platform"]
    texts = [caption.get("text") or ""] + list(caption.get("thread") or [])
    if not texts[0].strip():
        return "over_limit"
    for t in texts:
        if numbers_unknown(t, source):
            return "invented_number"
    if names or others:
        if label_leaks([t for t in texts if t], tuple(names), tuple(others)):
            return "names_a_repository"
    if len(texts[0]) > tables.PLATFORM_LIMITS[platform]:
        return "over_limit"
    if any(len(t) > tables.PLATFORM_LIMITS["x"] for t in texts[1:]) or len(texts) - 1 > tables.THREAD_MAX:
        return "over_limit"
    return None


def _cut(text: str, limit: int) -> str:
    """At most `limit` characters, cut at a word, with no dangling punctuation (pure)."""
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    cut = text[: limit - 1].rsplit(" ", 1)[0].rstrip(",;:")
    return cut + "."


def template(platform: str, i: Inputs) -> str | None:
    """A caption made from the inputs with no model (pure): the build post's `what`, else what
    the video shows first, then the first thing that is new. None when the input has nothing."""
    head = (i.what or (i.shows[0][:1].upper() + i.shows[0][1:] if i.shows else "")).strip()
    if not head:
        return None
    head = head.rstrip(".") + "."
    extra = i.changes[0].rstrip(".") + "." if i.changes else ""
    body = f"{head} {extra}".strip() if extra and extra.lower() != head.lower() else head
    return _cut(body, tables.PLATFORM_LIMITS[platform])


# ------------------------------------------------------------------------ writing


def write(i: Inputs, names=(), others=(), model: str = DEFAULT_MODEL, use_model: bool = True) -> dict:
    """share-copy.json's document: a caption per platform, each checked, and what was dropped."""
    from analysis import run as rn

    source = build_input(i)
    captions: dict[str, dict] = {}
    dropped: list[dict] = []
    used_model: str | None = None
    no_model = None
    if use_model:
        try:
            schema = json.loads(SCHEMA_PATH.read_text())
            for k in ("$schema", "$comment"):
                schema.pop(k, None)
            doc, envelope = rn.call_claude(PROMPT_PATH.read_text(), source, schema, model)
            doc, _ = rn.dedash(doc)
            usage = envelope.get("modelUsage") or {}
            used_model = max(usage, key=lambda k: usage[k].get("outputTokens", 0)) if usage else (envelope.get("model") or model)
            for c in (doc or {}).get("captions") or []:
                if not isinstance(c, dict) or c.get("platform") not in PLATFORMS or c["platform"] in captions:
                    continue
                c = {"platform": c["platform"], "text": str(c.get("text") or "").strip(), "thread": [str(t).strip() for t in c.get("thread") or [] if str(t).strip()] if c["platform"] == "x" else []}
                code = check(c, source, names, others)
                if code:
                    dropped.append({"platform": c["platform"], "code": code, "text": c["text"], "unknown_numbers": numbers_unknown(" ".join([c["text"], *c["thread"]]), source)})
                    continue
                captions[c["platform"]] = {**c, "source": "model"}
        except rn.AnalysisError as e:
            no_model = str(e)
    for p in PLATFORMS:
        if p in captions:
            continue
        t = template(p, i)
        if t is None:
            continue
        c = {"platform": p, "text": t, "thread": [], "source": "template"}
        if check(c, source, names, others) is None:
            captions[p] = c
    return {
        "version": tables.SHIPKIT_VERSION,
        "made_at": dt.datetime.now(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "model": used_model,
        "no_model": no_model,
        "captions": [captions[p] for p in PLATFORMS if p in captions],
        "dropped": dropped,
        "input": source,
    }
