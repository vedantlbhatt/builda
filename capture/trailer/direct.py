"""The director: a note from the owner, in their own words, becomes a new cut (docs/trailers.md).

"Make it shorter and orange", "open on the app", "call it RideGT", "no music", "go back to version
3". A note is answered in three steps, and only the first two can change anything:

  rules    the asks a sentence can be read for without a model: the length and the pace, the colour
           and the creature, the title, the line and the end card's words (in quotes), a scene
           taken out, added or moved first, the sound, the transitions, the camera, the figure, a
           version to go back to. Several in one note are all applied. No model, no network, and
           the same note always makes the same cut
  model    when the rules understood nothing, and claude is on this Mac: `claude -p` with the cut,
           what the facts can show and the note, answering the spec's `CutEdit` (the whole new cut)
  the gate EVERY new cut, from either: held to the spec and the facts (`cut.validate`), every
           number in its words held to the project's own numbers and the note's (a model may not
           put "10,000 users" on a trailer), every word held to this Mac's repository names (the
           ship kit's rule for every caption and label), dashes rewritten. A cut that fails is
           refused with a code; the trailer the owner had stays

The answer is never the model's prose. It is `cut.diff` of the old cut against the new one: codes
and values the phone words from the spec, so "make it punchier" is answered "the pace went from 1 to
1.15 · scenes change by a straight cut now", which is what was actually done.
"""

from __future__ import annotations

import dataclasses
import json
import pathlib
import re

from analysis.run import dedash

from . import cut as cutmod
from . import tables

SCHEMA_PATH = pathlib.Path(__file__).with_name("edit_schema.json")

#: Words a person uses for the hues, to the hue (design/tokens.json names are not everyday words).
COLOURS = {
    "amber": "amber", "gold": "amber", "golden": "amber", "honey": "amber",
    "yellow": "brass", "brass": "brass", "lemon": "brass",
    "cyan": "tide", "teal": "tide", "aqua": "tide", "turquoise": "tide", "tide": "tide", "sky": "tide",
    "blue": "cobalt", "cobalt": "cobalt", "navy": "cobalt",
    "purple": "iris", "violet": "iris", "iris": "iris",
    "lavender": "heather", "lilac": "heather", "heather": "heather",
    "pink": "orchid", "magenta": "orchid", "orchid": "orchid", "hot pink": "orchid",
    "salmon": "coral", "coral": "coral", "peach": "coral", "red": "coral",
    "orange": "ember", "ember": "ember", "rust": "ember",
}
CREATURES = {c: c for c in tables.ENUMS["creature"]} | {"robot": "bit", "the robot": "bit", "kitty": "cat", "puppy": "dog", "octopus": "octopus", "bird": "owl"}
#: Words for scenes, to the scene.
SCENE_WORDS = {
    "screens": "screens", "screen": "screens", "app": "screens", "demo": "screens", "phone": "screens", "recording": "screens",
    "number": "figure", "numbers": "figure", "figure": "figure", "count": "figure", "stat": "figure", "stats": "figure", "big number": "figure",
    "calendar": "days", "days": "days", "days built": "days", "graph": "days", "streak": "days",
    "changelog": "changelog", "changes": "changelog", "commits": "changelog", "commit list": "changelog", "list": "changelog", "what's new": "changelog", "whats new": "changelog",
    "stack": "stack", "languages": "stack", "tech": "stack", "tech stack": "stack",
    "title": "open", "intro": "open", "end card": "end", "outro": "end", "ending": "end",
}
FIGURE_WORDS = {"hours": "hours", "time": "hours", "commits": "commits", "sessions": "sessions", "lines": "lines_added", "days": "days_built", "streak": "streak_days"}
QUOTED = r"[\"“‘']([^\"”’']{1,120})[\"”’']"


@dataclasses.dataclass
class Answer:
    """What a note came to: a new cut and its changes, a version to go back to, or a refusal."""

    cut: dict | None = None
    changes: list[dict] = dataclasses.field(default_factory=list)
    refusal: str | None = None
    revert_to: int | None = None
    source: str = "rules"


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _scene_word(s: str) -> str | None:
    """The scene a phrase names: the whole phrase, else its last word ("the list of changes" is the
    changelog, "that big number" the figure)."""
    s = re.sub(r"^(the|a|an|that|this)\s+", "", s.strip().lower())
    if not s:
        return None
    for cand in (s, s.rstrip("s"), s.split()[-1], s.split()[-1].rstrip("s")):
        if cand in SCENE_WORDS:
            return SCENE_WORDS[cand]
    return None


def rules(note: str, old: dict, facts: dict) -> Answer:
    """Read `note` for the asks a sentence can be read for (pure). An Answer with no cut and no
    refusal means nothing here was understood."""
    n = " " + re.sub(r"\s+", " ", note.strip().lower()) + " "
    raw = note.strip()
    c = cutmod.bump(old)
    hit = False
    have = cutmod.available(facts)

    # New screens cannot be made by cutting: that is a new demo.
    if re.search(r"\b(film|re ?record|record|capture|new screenshots?|new screens?|different screens?|other screens?)\b", n) and not re.search(r"\b(fewer|less|more) screens\b", n):
        return Answer(refusal="needs_new_capture")

    m = re.search(r"\b(?:go back to|back to|revert to|restore|use)\s+(?:version|v)\s*(\d+)\b", n)
    if m:
        return Answer(revert_to=int(m.group(1)))
    if re.search(r"^\s*(undo|revert|go back|undo that|put it back)\b", n):
        return Answer(revert_to=old["version"] - 1)

    # Length: a number of seconds, or shorter and longer.
    m = re.search(r"\b(\d{1,3})\s*(?:s|sec|secs|seconds?)\b", n)
    if m:
        c["seconds"] = int(_clamp(int(m.group(1)), tables.SECONDS["min"], tables.SECONDS["max"]))
        hit = True
    elif re.search(r"\b(much|way|a lot) shorter\b|\bhalf as long\b", n):
        c["seconds"] = int(_clamp(round(old["seconds"] * 0.6), tables.SECONDS["min"], tables.SECONDS["max"]))
        hit = True
    elif re.search(r"\b(shorter|tighter|trim it|cut it down|too long)\b", n):
        c["seconds"] = int(_clamp(round(old["seconds"] * 0.75), tables.SECONDS["min"], tables.SECONDS["max"]))
        hit = True
    elif re.search(r"\b(longer|too short|more time)\b", n):
        c["seconds"] = int(_clamp(round(old["seconds"] * 1.3), tables.SECONDS["min"], tables.SECONDS["max"]))
        hit = True

    # Pace.
    if re.search(r"\b(faster|quicker|snappier|punchier|speed (it )?up|more energy)\b", n):
        c["pace"] = round(_clamp(old["pace"] + 0.15, tables.PACE["min"], tables.PACE["max"]), 2)
        hit = True
    elif re.search(r"\b(slower|calmer|slow (it )?down|more relaxed|let it breathe)\b", n):
        c["pace"] = round(_clamp(old["pace"] - 0.15, tables.PACE["min"], tables.PACE["max"]), 2)
        hit = True

    # Colour and creature.
    for word in sorted(COLOURS, key=len, reverse=True):
        if re.search(rf"\b{re.escape(word)}\b", n) and not re.search(rf"\b{re.escape(word)} (bus|line|route)\b", n):
            c["hue"] = COLOURS[word]
            hit = True
            break
    for word in sorted(CREATURES, key=len, reverse=True):
        if re.search(rf"\b{re.escape(word)}\b", n) and CREATURES[word] != old["creature"]:
            c["creature"] = CREATURES[word]
            hit = True
            break

    # Words, in quotes, for the title, the line and the end card. The owner typed them: theirs to say.
    for field, pat in (
        ("title", r"\b(?:title|call it|name it|rename(?: it)?(?: to)?|named)\b\s*(?:to|as|:)?\s*" + QUOTED),
        ("line", r"\b(?:tagline|subtitle|line|subline|description|say)\b\s*(?:to|as|:)?\s*" + QUOTED),
        ("cta", r"\b(?:end with|ending|end card|last card|cta|call to action|outro)\b\s*(?:to|as|says?|:)?\s*" + QUOTED),
    ):
        m = re.search(pat, raw, re.I)
        if m:
            text = dedash(m.group(1).strip())[0]
            if len(text) > tables.MAX_LENGTHS[field]:
                return Answer(refusal="over_limit")
            c[field] = {"text": text, "source": "person"}
            hit = True
    if re.search(r"\b(no|drop the|remove the|without the|lose the) (tagline|subtitle|line under)\b", n):
        c["line"] = None
        hit = True

    # Scenes: taken out, added, or moved to come first. A verb takes a list ("drop the stack and
    # the calendar"), read up to the end of its clause.
    kinds = [s["kind"] for s in c["scenes"]]
    clause_end = r"(?=\s*(?:\.|;|$| then| please| but| too| instead|,\s*(?:and\s+)?(?:make|use|add|show|open|start|call|end|no|drop)\b))"
    for m in re.finditer(r"\b(?:no|drop|remove|cut|lose|without|skip|take out|get rid of)\s+([a-z' ,]+?)" + clause_end, n):
        for part in re.split(r",|\band\b|\bor\b", m.group(1)):
            k = _scene_word(part)
            if k and k not in ("open", "end"):
                hit = True
                if k in kinds:
                    c["scenes"] = [s for s in c["scenes"] if s["kind"] != k]
                    kinds = [s["kind"] for s in c["scenes"]]
    for m in re.finditer(r"\b(?:add|show|include|put in|bring back)\s+([a-z' ,]+?)" + clause_end, n):
        for part in re.split(r",|\band\b", m.group(1)):
            word = re.sub(r"^(the|a|an)\s+", "", part.strip())
            if word in FIGURE_WORDS and FIGURE_WORDS[word] in (facts.get("numbers") or {}) and "figure" in kinds:
                continue  # "show hours" is the figure changing, below
            k = _scene_word(word)
            if not k:
                continue
            hit = True
            if k not in kinds and have.get(k):
                new = cutmod.scene(k, tables.ENUMS["arrival"][len(kinds) % 8], facts)
                order = cutmod.ORDER
                at = next((i for i, s in enumerate(c["scenes"]) if order.index(s["kind"]) > order.index(k)), len(c["scenes"]) - 1)
                c["scenes"].insert(at, new)
                kinds = [s["kind"] for s in c["scenes"]]
    m = re.search(r"\b(?:start|open|lead|begin|kick off)\s+(?:it\s+)?(?:with|on)\s+(?:the\s+)?([a-z' ]+?)" + clause_end, n)
    if m:
        k = _scene_word(m.group(1))
        if k and k in kinds and k not in ("open", "end"):
            hit = True
            if kinds.index(k) != 1:
                s = next(s for s in c["scenes"] if s["kind"] == k)
                c["scenes"].remove(s)
                c["scenes"].insert(1, s)

    # The figure: which number.
    m = re.search(r"\b(?:show|use|count|with)\s+(?:the\s+)?(hours|time|commits|sessions|lines|streak)\b(?:\s+instead)?", n)
    if m and "figure" in [s["kind"] for s in c["scenes"]]:
        f = FIGURE_WORDS[m.group(1)]
        if f in (facts.get("numbers") or {}):
            for s in c["scenes"]:
                if s["kind"] == "figure":
                    s["figure"] = f
            hit = True

    # Sound.
    if re.search(r"\b(no music|no sound|silent|mute(d)?|without music|kill the music)\b", n):
        c["mood"] = "none"
        hit = True
    elif re.search(r"\b(upbeat|energetic|hype|driving|beat|drums?|pulse)\b", n):
        c["mood"] = "drive"
        hit = True
    elif re.search(r"\b(calm music|quiet music|softer music|chill)\b", n):
        c["mood"] = "quiet"
        hit = True

    # Transitions.
    if re.search(r"\b((hard|straight|simple|plain) cuts?|no (ink|transitions?|wipes?))\b", n):
        c["transition"] = "cut"
        hit = True
    elif re.search(r"\b(morph|grow(ing)? band)\b", n):
        c["transition"] = "morph"
        hit = True
    elif re.search(r"\b(ink|fluid|liquid|pour)\b", n):
        c["transition"] = "fluid"
        hit = True

    # Camera.
    screens = [s for s in c["scenes"] if s["kind"] == "screens"]
    if screens:
        cam = None
        if re.search(r"\b(still|steady|static|stop (moving|tilting)|hold the phone still|no tilt)\b", n):
            cam = "still"
        elif re.search(r"\b(lean|tilt|angled?|3d)\b", n):
            cam = "lean"
        elif re.search(r"\b(drift|float|gentle move)\b", n):
            cam = "drift"
        if cam:
            for s in screens:
                s["camera"] = cam
            hit = True
        beats = len((facts.get("demo") or {}).get("beats") or (facts.get("demo") or {}).get("stills") or [])
        m = re.search(r"\b(?:only|just)\s+(?:the\s+)?(?:first\s+)?(\d)\s+screens?\b", n)
        if m and beats:
            k = max(1, min(beats, int(m.group(1))))
            for s in screens:
                s["beats"] = list(range(k))
            hit = True
        elif re.search(r"\bfewer screens\b", n) and beats > 1:
            cur = len(screens[0].get("beats") or range(min(5, beats)))
            for s in screens:
                s["beats"] = list(range(max(1, cur - 1)))
            hit = True
        elif re.search(r"\bmore screens\b", n) and beats > 1:
            cur = len(screens[0].get("beats") or range(min(5, beats)))
            for s in screens:
                s["beats"] = list(range(min(8, beats, cur + 1)))
            hit = True

    if not hit:
        return Answer()
    changes = cutmod.diff(old, c)
    if not changes:
        return Answer(refusal="nothing_to_change")
    return Answer(cut=c, changes=changes)


# ------------------------------------------------------------------------ the gate


def numbers_in(text: str) -> set[str]:
    return set(re.findall(r"\d[\d,.]*", text or ""))


def gate(old: dict, new: dict, facts: dict, note: str, leaks) -> tuple[dict | None, str | None]:
    """Hold a new cut to everything a trailer promises (see the module doc). Returns the cut to
    render (dashes rewritten) or a refusal code. `leaks` is privacy.label_leaks bound to this Mac's
    names: it answers whether any of the words it is given names a repository."""
    new = json.loads(json.dumps(new))
    new["version"] = old["version"] + 1
    # A number past its bound is the note's intent overshooting: held to the bound, not refused.
    # A scene the old cut had keeps its arrival: no change code can say an arrival changed, and a
    # change the answer cannot say is a change the owner did not ask for.
    if isinstance(new.get("seconds"), (int, float)):
        new["seconds"] = _clamp(new["seconds"], tables.SECONDS["min"], tables.SECONDS["max"])
    if isinstance(new.get("pace"), (int, float)):
        new["pace"] = round(_clamp(new["pace"], tables.PACE["min"], tables.PACE["max"]), 2)
    arrivals = {s["kind"]: s["arrival"] for s in old["scenes"]}
    for s in new.get("scenes") or []:
        if isinstance(s, dict):
            if isinstance(s.get("weight"), (int, float)):
                s["weight"] = _clamp(s["weight"], tables.WEIGHT["min"], tables.WEIGHT["max"])
            if s.get("kind") in arrivals:
                s["arrival"] = arrivals[s["kind"]]
    for f in ("title", "line", "cta"):
        if new.get(f):
            new[f]["text"] = dedash(new[f]["text"])[0]
    problems = cutmod.validate(new, facts)
    if problems:
        return None, "not_understood"
    allowed = set()
    for v in (facts.get("numbers") or {}).values():
        allowed |= {v["text"], str(v["value"])}
    allowed |= numbers_in(note)
    for f in ("title", "line", "cta"):
        t = new.get(f)
        if not t:
            continue
        before = (old.get(f) or {}).get("text")
        if t["text"] == before:
            continue
        unknown = [x for x in numbers_in(t["text"]) if x.strip(".,") not in {a.strip(".,") for a in allowed}]
        if unknown:
            return None, "invented_number"
        # The owner's own words may name their project; words a model wrote may not name any repository.
        if t.get("source") != "person" and leaks([t["text"]]):
            return None, "names_a_repository"
        if t["text"] not in note and t.get("source") == "person":
            # A model may not pass its own words off as the owner's.
            t["source"] = "model"
            if leaks([t["text"]]):
                return None, "names_a_repository"
    return new, None


def what_can_show(facts: dict) -> str:
    """What the model is told the facts hold: the scenes it may use and the numbers it may show."""
    have = cutmod.available(facts)
    nums = facts.get("numbers") or {}
    lines = ["SCENES THE FACTS CAN SHOW: " + ", ".join(k for k, v in have.items() if v)]
    lines.append("NUMBERS THE PROJECT GAVE (the only numbers that may appear in any words): " + (", ".join(f"{k} = {v['text']} {v['unit']}" for k, v in nums.items()) or "none"))
    beats = (facts.get("demo") or {}).get("beats") or (facts.get("demo") or {}).get("stills") or []
    lines.append(
        f"BOUNDS: seconds {tables.SECONDS['min']} to {tables.SECONDS['max']}, pace {tables.PACE['min']} to {tables.PACE['max']} "
        f"(1 is the app's own springs), a scene's weight {tables.WEIGHT['min']} to {tables.WEIGHT['max']}, at most {tables.SCENES_MAX} scenes"
    )
    lines.append(f"THE DEMO HAS {len(beats)} BEATS (positions 0 to {max(0, len(beats) - 1)}): " + "; ".join(f"{i}: {b.get('label') or 'no label'}" for i, b in enumerate(beats)))
    return "\n".join(lines)


SYSTEM = """You edit the cut of a short trailer of a software project, as its owner asks, in their words.
You change only what the note asks for and return the whole new cut. You never invent a number or a
claim: words on screen may use only the numbers listed as the project's, or numbers the owner wrote in
the note. When the note asks for something a cut cannot do (new footage, a different app, an effect
not in the schema), return a refusal and no cut. Plain words, lower case captions, no dashes."""


def model(note: str, old: dict, facts: dict, use_model: bool = True) -> Answer:
    """Ask `claude -p` for a CutEdit. The changes are never taken from it: `cut.diff` computes them."""
    if not use_model:
        return Answer(refusal="no_model", source="model")
    from analysis import run as rn

    schema = json.loads(SCHEMA_PATH.read_text())
    for k in ("$schema", "$comment"):
        schema.pop(k, None)
    user = "\n\n".join([
        "THE CUT NOW:\n" + json.dumps(old, indent=1),
        what_can_show(facts),
        "THE OWNER'S NOTE:\n" + note,
    ])
    try:
        doc, _ = rn.call_claude(SYSTEM, user, schema, "sonnet")
    except rn.AnalysisError:
        return Answer(refusal="no_model", source="model")
    if not isinstance(doc, dict):
        return Answer(refusal="not_understood", source="model")
    if doc.get("refusal") in tables.ENUMS["note_refusal"] and not doc.get("cut"):
        return Answer(refusal=doc["refusal"], source="model")
    if not isinstance(doc.get("cut"), dict):
        return Answer(refusal="not_understood", source="model")
    return Answer(cut=doc["cut"], source="model")


def answer(note: str, old: dict, facts: dict, history: dict[int, dict], leaks, use_model: bool = True) -> Answer:
    """A note, answered: rules first, the model when the rules understood nothing, then the gate."""
    note = note.strip()[: tables.MAX_LENGTHS["note"]]
    a = rules(note, old, facts)
    if a.revert_to is not None:
        target = history.get(a.revert_to)
        if target is None or a.revert_to == old["version"]:
            return Answer(refusal="no_such_version" if target is None else "nothing_to_change")
        c = cutmod.bump(old)
        restored = {**json.loads(json.dumps(target)), "version": c["version"]}
        problems = cutmod.validate(restored, facts)
        if problems:
            return Answer(refusal="no_such_version")
        return Answer(cut=restored, changes=[{"code": "reverted", "before": None, "after": str(a.revert_to)}] + cutmod.diff(old, restored))
    if a.refusal:
        return a
    if a.cut is None:
        a = model(note, old, facts, use_model)
        if a.cut is None:
            # With the model off, nobody but the rules read it, and the answer says so.
            return Answer(refusal=a.refusal if use_model else "not_understood", source=a.source if use_model else "rules")
    new, code = gate(old, a.cut, facts, note, leaks)
    if code:
        return Answer(refusal=code, source=a.source)
    changes = cutmod.diff(old, new)
    if not changes:
        return Answer(refusal="nothing_to_change", source=a.source)
    return Answer(cut=new, changes=changes, source=a.source)
