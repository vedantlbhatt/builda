"""A project's trailer facts and its cut, gathered the one way the CLI and the notes worker share.

`facts_for` reads what a trailer may show from the project's demo and its git (facts.py), with
every word it brings along held to this Mac's repository names first: a commit subject can name a
repository or carry a key, and a trailer draws its changelog on screen. `cut_for` keeps the cut the
owner has when it still fits the facts, and otherwise makes a first cut (cut.first_cut) as the next
version, so a project whose demo changed shape never renders a cut that points at screens it no
longer has.
"""

from __future__ import annotations

import json
import pathlib

from capture.demo import privacy

from . import cut as cutmod
from . import direct, facts, render, tables

#: The project's creature when nobody names one: the crew ring by its key (never Bit).
CREW = ["fox", "whale", "bee", "octopus", "crab", "dog", "cat", "owl"]


def crew_creature(key: str) -> str:
    return CREW[cutmod.fnv(key) % len(CREW)]


def kit_hue(key: str) -> str | None:
    """The hue the kit was made in (the phone's, when the phone asked for the demo), or None."""
    from capture.demo import paths
    from capture.shipkit import kit

    p = paths.out_dir(key) / kit.KIT_DIR / "kit.json"
    try:
        hue = json.loads(p.read_text()).get("hue")
    except (OSError, ValueError):
        return None
    return hue if hue in tables.ENUMS["hue"] else None


def report_project(path: str | None, key: str) -> dict | None:
    if not path:
        return None
    doc = json.loads(pathlib.Path(path).expanduser().read_text())
    block = (doc.get("report") or doc).get("projects") or {}
    return next((p for p in block.get("projects") or [] if p.get("key") == key), None)


def facts_for(key: str, src: pathlib.Path | None, names: tuple, others: tuple, *, title: str | None = None,
              allow: tuple[str, ...] = (), line: str | None = None, cta: str | None = None, hue: str | None = None,
              creature: str | None = None, report: str | None = None, shipped: str | None = None) -> dict:
    """The facts document for `key`'s demo. Raises CaptureError when there is no demo."""
    from capture.shipkit import kit

    demo = kit.load_demo(key)
    leaks = lambda texts: privacy.label_leaks(texts, names, others)  # noqa: E731
    prev = kit.previous_kit(demo, src)
    since = json.loads((prev / "manifest.json").read_text())["commit"] if prev else None
    log = [c for c in kit.changelog(src, since, demo.commit, cap=12) if not leaks([c["subject"]])]
    chosen = facts.choose_title(typed=title, allowed=allow, shipped=kit.shipped_for(key, shipped), leaks=leaks)
    words = {}
    for field, text in (("line", line), ("cta", cta)):
        if text:
            words[field] = {"text": direct.dedash(text.strip())[0][: tables.MAX_LENGTHS[field]], "source": "person"}
    return facts.gather(
        demo, src=src, hue=hue or kit_hue(key) or kit.preferred_hue(key), creature=creature or crew_creature(key),
        title=chosen, line=words.get("line"), cta=words.get("cta"), changelog=log, since_last_demo=since is not None,
        report_project=report_project(report, key),
    )


def cut_for(key: str, f: dict, *, fresh: bool = False) -> tuple[dict, bool]:
    """(the cut to render, whether it is a new first cut): the owner's current cut when it still
    fits `f`, else a first cut as one version more than any there has been."""
    old = render.current(key)
    if old and not fresh and not cutmod.validate(old, f):
        return old, False
    c = cutmod.first_cut(f)
    c["version"] = max(render.history(key), default=0) + 1
    return c, True


def words_of(f: dict) -> list[str]:
    """Every word a render of `f` draws: the title, the line, the end card, the changelog, the
    beats' and stills' labels, the stack's languages. What the publish reads once more for names
    (the pictures are read by Vision)."""
    out = [(f.get(k) or {}).get("text") or "" for k in ("title", "line", "cta")]
    out += list(f.get("changelog") or [])
    demo = f.get("demo") or {}
    out += [b.get("label") or "" for b in demo.get("beats") or []]
    out += [s.get("label") or "" for s in demo.get("stills") or []]
    out += [lang.get("name") or "" for lang in f.get("languages") or []]
    return [w for w in out if w]
