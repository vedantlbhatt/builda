"""The cut: which scenes, in what order, with what words and timing (spec/trailer.v1.json `Cut`).

`first_cut` makes the one a project gets before anyone has asked for anything: a scene for each
thing the facts can show, and none for a thing they cannot (no figure without a number, no calendar
without a day built, no list of changes without two commits). `validate` holds any cut, the
director's included, to the spec and to the facts. `diff` says what changed between two cuts as
codes (the spec's `change_code`), which is the ONLY answer a note ever gets: the phone words it from
the spec's sentences, so a model's prose never reaches the owner as if it were the Mac's.
"""

from __future__ import annotations

import copy

from . import tables

#: A scene's weight in the first cut: its share of the seconds. The screens are the point, so they
#: get the most; a number or a list is read in about two seconds at 20 (UNMEASURED: set by watching
#: the RideGT trailer at 20 s, `docs/trailers.md`).
WEIGHTS = {"open": 1.1, "screens": 3.6, "figure": 1.0, "days": 1.1, "changelog": 1.2, "stack": 0.8, "end": 1.1}
#: The order a first cut tells a project in: what it is, it running, how much went into it, when,
#: what is new, what it is made of, where to get it.
ORDER = ("open", "screens", "figure", "days", "changelog", "stack", "end")
#: The figure a first cut shows, the first of these the facts have.
FIGURE_PREFERENCE = ("hours", "commits", "sessions")
#: Arrival orders a first cut deals its scenes, starting from the project's own, so no two scenes
#: in a trailer arrive alike (the app's `takeOrder` rule, per trailer instead of per page).
ARRIVALS = tables.ENUMS["arrival"]


def fnv(s: str) -> int:
    """FNV-1a, 32 bit: mobile/src/motion/pixelMotion.ts `fnv`, so a project's order is its own everywhere."""
    h = 0x811C9DC5
    for ch in s:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def available(facts: dict) -> dict[str, bool]:
    demo = facts.get("demo") or {}
    nums = facts.get("numbers") or {}
    return {
        "open": True,
        "screens": bool(demo.get("video") and demo.get("beats")) or bool(demo.get("stills")),
        "figure": any(k in nums for k in FIGURE_PREFERENCE),
        "days": bool((facts.get("days") or {}).get("levels")) and "days_built" in nums and nums["days_built"]["value"] >= 3,
        "changelog": len(facts.get("changelog") or []) >= 2,
        "stack": len(facts.get("languages") or []) >= 2,
        "end": True,
    }


def scene(kind: str, arrival: str, facts: dict) -> dict:
    s = {"kind": kind, "weight": WEIGHTS[kind], "arrival": arrival, "figure": None, "beats": None, "camera": None, "caption": None}
    if kind == "figure":
        nums = facts.get("numbers") or {}
        s["figure"] = next(k for k in FIGURE_PREFERENCE if k in nums)
    if kind == "screens":
        s["camera"] = "drift"
    return s


def first_cut(facts: dict) -> dict:
    """The cut a project gets first (pure)."""
    have = available(facts)
    start = fnv(facts.get("project_key", "")) % len(ARRIVALS)
    kinds = [k for k in ORDER if have[k]]
    scenes = [scene(k, ARRIVALS[(start + i) % len(ARRIVALS)], facts) for i, k in enumerate(kinds)]
    # About two and a half seconds a scene, the screens twice that, within the spec's bounds.
    seconds = min(tables.SECONDS["max"], max(tables.SECONDS["min"], round(2.4 * len(scenes) + (4 if have["screens"] else 0))))
    return {
        "version": 1,
        "seconds": seconds,
        "pace": 1.0,
        "hue": facts["hue"],
        "creature": facts["creature"],
        "mood": "quiet",
        "transition": "fluid",
        "title": dict(facts["title"]),
        "line": dict(facts["line"]) if facts.get("line") else None,
        "cta": dict(facts["cta"]) if facts.get("cta") else None,
        "scenes": scenes,
    }


def validate(cut: dict, facts: dict) -> list[str]:
    """Everything wrong with a cut, as sentences for a log (pure). Empty when it may be rendered."""
    bad: list[str] = []
    e = tables.ENUMS
    if not isinstance(cut.get("version"), int) or not 1 <= cut["version"] <= 1000:
        bad.append("version is not a whole number from 1")
    sec = cut.get("seconds")
    if not isinstance(sec, (int, float)) or not tables.SECONDS["min"] <= sec <= tables.SECONDS["max"]:
        bad.append(f"seconds must be {tables.SECONDS['min']} to {tables.SECONDS['max']}")
    pace = cut.get("pace")
    if not isinstance(pace, (int, float)) or not tables.PACE["min"] <= pace <= tables.PACE["max"]:
        bad.append(f"pace must be {tables.PACE['min']} to {tables.PACE['max']}")
    for field, enum in (("hue", "hue"), ("creature", "creature"), ("mood", "mood"), ("transition", "transition")):
        if cut.get(field) not in e[enum]:
            bad.append(f"{field} {cut.get(field)!r} is not one of {e[enum]}")
    for field, cap in (("title", "title"), ("line", "line"), ("cta", "cta")):
        t = cut.get(field)
        if t is None and field != "title":
            continue
        if not isinstance(t, dict) or not isinstance(t.get("text"), str) or not t["text"].strip():
            bad.append(f"{field} has no words")
        elif len(t["text"]) > tables.MAX_LENGTHS[cap]:
            bad.append(f"{field} runs past {tables.MAX_LENGTHS[cap]} characters")
        elif t.get("source") not in e["text_source"]:
            bad.append(f"{field} says it came from {t.get('source')!r}")
    scenes = cut.get("scenes")
    if not isinstance(scenes, list) or not 2 <= len(scenes) <= tables.SCENES_MAX:
        bad.append(f"a cut has 2 to {tables.SCENES_MAX} scenes")
        return bad
    if scenes[0].get("kind") != "open" or scenes[-1].get("kind") != "end":
        bad.append("a cut opens on its title and ends on its end card")
    have = available(facts)
    nums = facts.get("numbers") or {}
    beats = len(((facts.get("demo") or {}).get("beats")) or ((facts.get("demo") or {}).get("stills")) or [])
    for i, s in enumerate(scenes):
        k = s.get("kind")
        if k not in e["scene_kind"]:
            bad.append(f"scene {i} is a {k!r}")
            continue
        if not have[k]:
            bad.append(f"scene {i} ({k}) has nothing in the facts to show")
        w = s.get("weight")
        if not isinstance(w, (int, float)) or not tables.WEIGHT["min"] <= w <= tables.WEIGHT["max"]:
            bad.append(f"scene {i} weighs {w!r}")
        if s.get("arrival") not in e["arrival"]:
            bad.append(f"scene {i} arrives {s.get('arrival')!r}")
        if k == "figure" and s.get("figure") not in nums:
            bad.append(f"scene {i} shows a number the facts do not have: {s.get('figure')!r}")
        if k == "screens":
            if s.get("camera") not in e["camera"]:
                bad.append(f"scene {i} has camera {s.get('camera')!r}")
            for b in s.get("beats") or []:
                if not isinstance(b, int) or not 0 <= b < beats:
                    bad.append(f"scene {i} names beat {b!r}; the demo has {beats}")
            if s.get("beats") is not None and len(s["beats"]) > 8:
                bad.append(f"scene {i} holds more than 8 beats")
    return bad


def _text(t: dict | None) -> str | None:
    return t.get("text") if t else None


def diff(old: dict, new: dict) -> list[dict]:
    """Every difference between two cuts, as the spec's `Change`s, in the order a person reads them
    (pure). Values travel as their codes or numbers; the phone says them."""
    out: list[dict] = []

    def add(code: str, before=None, after=None) -> None:
        out.append({"code": code, "before": None if before is None else str(before), "after": None if after is None else str(after)})

    if old["seconds"] != new["seconds"]:
        add("seconds", _num(old["seconds"]), _num(new["seconds"]))
    if old["pace"] != new["pace"]:
        add("pace", _num(old["pace"]), _num(new["pace"]))
    for f in ("hue", "creature", "mood", "transition"):
        if old[f] != new[f]:
            add(f, old[f], new[f])
    for f in ("title", "line", "cta"):
        if _text(old.get(f)) != _text(new.get(f)):
            add(f, _text(old.get(f)), _text(new.get(f)))
    ok = [s["kind"] for s in old["scenes"]]
    nk = [s["kind"] for s in new["scenes"]]
    for k in [k for k in ok if k not in nk]:
        add("scene_removed", k, None)
    for k in [k for k in nk if k not in ok]:
        add("scene_added", None, k)
    kept_old = [k for k in ok if k in nk]
    kept_new = [k for k in nk if k in ok]
    if kept_old != kept_new:
        first_mid = kept_new[1] if len(kept_new) > 2 else None
        if first_mid and first_mid != (kept_old[1] if len(kept_old) > 2 else None):
            add("first", None, first_mid)
        else:
            moved = next((k for k in kept_new if kept_new.index(k) < kept_old.index(k)), None)
            add("scene_moved", None, moved)
    oscr = next((s for s in old["scenes"] if s["kind"] == "screens"), None)
    nscr = next((s for s in new["scenes"] if s["kind"] == "screens"), None)
    if oscr and nscr:
        if oscr.get("camera") != nscr.get("camera"):
            add("camera", oscr.get("camera"), nscr.get("camera"))
        if (oscr.get("beats") or None) != (nscr.get("beats") or None) and nscr.get("beats") is not None:
            add("screens", len(oscr.get("beats") or []) or None, len(nscr["beats"]))
    ofig = next((s.get("figure") for s in old["scenes"] if s["kind"] == "figure"), None)
    nfig = next((s.get("figure") for s in new["scenes"] if s["kind"] == "figure"), None)
    if ofig and nfig and ofig != nfig:
        add("figure", ofig, nfig)
    return out


def _num(x) -> str:
    return f"{x:g}" if isinstance(x, float) else str(x)


def say(change: dict) -> str:
    """A change in the spec's words (the phone's `sayChange` is the same rule; a test holds them)."""
    code = change["code"]
    words = tables.WORDS
    group = {"scene_added": "scene_kind", "scene_removed": "scene_kind", "scene_moved": "scene_kind", "first": "scene_kind",
             "figure": "figure", "mood": "mood", "camera": "camera", "transition": "transition"}.get(code)

    def word(v):
        if v is None:
            return ""
        return words[group].get(v, v) if group else v

    return tables.CHANGES[code].replace("{before}", word(change.get("before"))).replace("{after}", word(change.get("after")))


def bump(cut: dict) -> dict:
    """A copy of `cut` with the next version number: every change is a new cut, and the old stays."""
    c = copy.deepcopy(cut)
    c["version"] = cut["version"] + 1
    return c
