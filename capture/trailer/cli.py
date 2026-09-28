"""`python -m capture demo trailer|direct`: cut a project's trailer, and change it by a note.

    python -m capture demo trailer [PATH | --key KEY]     cut it from the project's demo and render it
    python -m capture demo trailer ... --dry-run          the cut it would render, and nothing else
    python -m capture demo trailer ... --draft            half size, no motion blur: a quick look
    python -m capture demo direct --key KEY "make it shorter and orange"
    python -m capture demo direct ... --no-model          only the notes the rules can read
    python -m capture demo direct ... --dry-run           the answer, and no render

The first cut is made by rules (`cut.first_cut`); a note is read by rules first and by your own
Claude Code only when the rules understood nothing (`direct.py`). Nothing leaves this Mac.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import sys

from capture.demo import privacy
from capture.demo.result import CaptureError

from . import cut as cutmod
from . import direct, facts, render, tables


def say(msg: str = "") -> None:
    print(msg, file=sys.stderr, flush=True)


def add_arguments(t: argparse.ArgumentParser, d: argparse.ArgumentParser) -> None:
    t.add_argument("path", nargs="?", default=None, help="the project's checkout (default: the current directory)")
    t.add_argument("--project", help="the same as PATH")
    t.add_argument("--key", help="the project's 64 hex key, instead of a checkout")
    t.add_argument("--title", help="the project's name as it should appear on screen (yours to say)")
    t.add_argument("--allow-name", action="append", metavar="NAME", help="a repository name that may be the title (its public name)")
    t.add_argument("--line", help="one line under the title, in your words")
    t.add_argument("--cta", help="the end card's line, in your words (where to get it)")
    t.add_argument("--hue", choices=tables.ENUMS["hue"], help="the project's colour; default: the one its key asks for")
    t.add_argument("--creature", choices=tables.ENUMS["creature"], help="the creature on the band; default: the project's crew creature")
    t.add_argument("--report", help="your report (`python -m analysis report --json`), for hours and sessions")
    t.add_argument("--shipped", help="a build post to take the title from when there is no name")
    t.add_argument("--formats", help="only these formats, comma separated (vertical,feed,landscape,square)")
    t.add_argument("--fresh", action="store_true", help="start again from a first cut, as version one more than the last")
    t.add_argument("--draft", action="store_true", help="half size, no motion blur")
    t.add_argument("--dry-run", action="store_true", help="print the cut; render nothing")
    t.add_argument("--root", default="~/.claude/projects")
    t.add_argument("--no-transcripts", action="store_true")

    d.add_argument("note", help="what to change, in your own words")
    d.add_argument("--key", help="the project's 64 hex key")
    d.add_argument("--project", help="the project's checkout, instead of --key")
    d.add_argument("--no-model", action="store_true", help="only what the rules can read; no claude call")
    d.add_argument("--draft", action="store_true", help="render the new cut at half size")
    d.add_argument("--formats", help="only these formats, comma separated")
    d.add_argument("--dry-run", action="store_true", help="answer the note, render nothing, keep nothing")
    d.add_argument("--root", default="~/.claude/projects")
    d.add_argument("--no-transcripts", action="store_true")


def resolve(a: argparse.Namespace):
    """(key, project, checkout, names, others), as the ship kit resolves them (kit.main)."""
    from capture.demo import project as pj
    from capture.shipkit import kit

    if getattr(a, "key", None):
        project = kit.project_for_key(a.key)
        names, others = kit.names_for(project, a) if project else (tuple(privacy.machine_names()), ())
        return a.key, project, (project.checkout if project else None), names, others
    project = pj.from_checkout(a.project or getattr(a, "path", None) or ".")
    names, others = kit.names_for(project, a)
    return project.key, project, project.checkout, names, others


def crew_creature(key: str) -> str:
    """A project's creature when nobody names one: the crew ring by its key (never Bit)."""
    ring = ["fox", "whale", "bee", "octopus", "crab", "dog", "cat", "owl"]
    return ring[cutmod.fnv(key) % len(ring)]


def report_project(path: str | None, key: str) -> dict | None:
    if not path:
        return None
    doc = json.loads(pathlib.Path(path).expanduser().read_text())
    block = (doc.get("report") or doc).get("projects") or {}
    return next((p for p in block.get("projects") or [] if p.get("key") == key), None)


def cmd_trailer(a: argparse.Namespace) -> int:
    from capture.shipkit import kit

    try:
        key, _project, src, names, others = resolve(a)
        demo = kit.load_demo(key)
    except CaptureError as e:
        say(f"Refused: {tables.REFUSALS['no_demo']} ({e})")
        return 1
    leaks = lambda texts: privacy.label_leaks(texts, names, others)  # noqa: E731
    prev = kit.previous_kit(demo, src)
    since = json.loads((prev / "manifest.json").read_text())["commit"] if prev else None
    log = kit.changelog(src, since, demo.commit, cap=12)
    title = facts.choose_title(typed=a.title, allowed=tuple(a.allow_name or ()), shipped=kit.shipped_for(key, a.shipped), leaks=leaks)
    words = {}
    for field in ("line", "cta"):
        text = getattr(a, field)
        if text:
            words[field] = {"text": direct.dedash(text.strip())[0][: tables.MAX_LENGTHS[field]], "source": "person"}
    f = facts.gather(
        demo, src=src, hue=a.hue or kit.preferred_hue(key), creature=a.creature or crew_creature(key), title=title,
        line=words.get("line"), cta=words.get("cta"), changelog=log, since_last_demo=since is not None,
        report_project=report_project(a.report, key),
    )
    old = render.current(key)
    if old and not a.fresh and not cutmod.validate(old, f):
        c = old
    else:
        c = cutmod.first_cut(f)
        c["version"] = max(render.history(key), default=0) + 1
    problems = cutmod.validate(c, f)
    if problems:
        say("Refused: the cut does not fit the facts: " + "; ".join(problems[:3]))
        return 1
    if a.dry_run:
        print(json.dumps({"facts": f, "cut": c}, indent=1, ensure_ascii=False))
        return 0
    render.save_cut(key, c)
    try:
        made = render.render(key, f, c, formats=a.formats.split(",") if a.formats else None, draft=a.draft, say=say)
    except render.RenderError as e:
        say(f"Refused: {tables.REFUSALS.get(e.code, e.code)}")
        return 1
    out = render.trailer_dir(key) / "render"
    print(f"Trailer version {c['version']} written to {out}")
    for m in made["made"]:
        print(f"  {m['file']:<24} {m['bytes'] / 1e6:.2f} MB")
    print("  nothing was sent anywhere; the trailer travels with the kit (`python -m capture demo kit --publish`)")
    return 0


def cmd_direct(a: argparse.Namespace) -> int:
    try:
        key, _project, _src, names, others = resolve(a)
    except CaptureError as e:
        say(f"Refused: {e}")
        return 1
    old = render.current(key)
    fpath = render.trailer_dir(key) / "facts.json"
    if old is None or not fpath.is_file():
        say(f"Refused: {tables.REFUSALS['no_trailer']}")
        return 1
    f = json.loads(fpath.read_text())
    leaks = lambda texts: privacy.label_leaks(texts, names, others)  # noqa: E731
    ans = direct.answer(a.note, old, f, render.history(key), leaks, use_model=not a.no_model)
    entry = {"at": dt.datetime.now(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ"), "note": a.note, "from": old["version"],
             "to": ans.cut["version"] if ans.cut else None, "changes": ans.changes, "refusal": ans.refusal, "source": ans.source}
    if ans.cut is None:
        print(tables.REFUSALS[ans.refusal])
        if not a.dry_run:
            render.log_note(key, entry)
        return 1
    for ch in ans.changes:
        print(cutmod.say(ch))
    if a.dry_run:
        return 0
    render.save_cut(key, ans.cut)
    render.log_note(key, entry)
    try:
        render.render(key, f, ans.cut, formats=a.formats.split(",") if a.formats else None, draft=a.draft, say=say)
    except render.RenderError as e:
        say(tables.REFUSALS["render_failed"] + f" ({e.code})")
        render.save_cut(key, old)
        return 1
    print(f"version {ans.cut['version']} is cut: {render.trailer_dir(key) / 'render'}")
    return 0
