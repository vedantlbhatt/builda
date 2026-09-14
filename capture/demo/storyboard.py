"""The flow a demo replays: a small storyboard file, written once and replayed without a model.

`docs/research/demo-capture.md` section 3: write the flow once and replay it deterministically
(aidemo's split), with no model by default. The storyboard lives in the work dir
(`~/.builder/demos/work/<key>/storyboard.json`) so the next run of the same project replays the
same beats; a first run writes a default one from the plan (the app's routes, the web app's
pages, the README's usage) for the person to edit.

    {
      "version": 1,
      "kind": "expo_ios",
      "app": {"configuration": "Debug", "build_env": {"BUILDER_API_URL": "http://127.0.0.1:8787"}},
      "device": {"appearance": "dark", "location": [33.7756, -84.3963], "grant": ["location"]},
      "setup": [{"open": "builder://dev-auth?onboarded=1&quiet=1"}, {"wait": 2}],
      "beats": [
        {"label": "the session page, the call chart", "caption": "Every call, as it happened",
         "actions": [{"open": "builder://session/sample"}, {"swipe": "up"}], "hold": 2.5}
      ],
      "stills": [{"label": "Wrapped, the first card", "actions": [{"open": "builder://wrapped?sample=1"}]}]
    }

A beat is one state of the product: the actions that reach it, a hold on it, a still of it (on
by default) and a caption in the video. `stills` are extra states photographed outside the
video. The actions, and what each kind of driver does with them:

    open    a deep link (iOS: simctl openurl), a path or URL (web: page.goto)
    wait    seconds
    settle  wait until the screen stops changing, up to N seconds
    tap     visible text, {"id": ...}, or {"point": "50%,90%"}; {"optional": true} passes when absent
    swipe   up, down, left, right (iOS: Maestro; web: the mouse wheel)
    type    text into the focused field
    key     a key: Enter, Backspace, ...
    back    the platform back
    run     a shell command typed into the terminal (cli, library)
    maestro raw Maestro commands, for anything the above cannot say (iOS)
    relaunch  terminate and launch the app again

`${NAME}` in an `open` or `type` value is read from the environment at run time and never
written back: that is how a sign in link carries a freshly minted token without the token ever
being in the file. Labels and captions are held to the phone's copy rules: plain words, no
dash (`analysis.plain`), short enough to read in a second.

JSON is the format the tool writes. A hand written `storyboard.yaml` is read too, in the small
block subset this module parses (mappings, sequences, scalars, JSON inline collections), because
standard library Python has no YAML reader and capture installs nothing.
"""

from __future__ import annotations

import json
import os
import pathlib
import re

from analysis import plain

from . import KINDS

ACTIONS = ("open", "wait", "settle", "tap", "swipe", "type", "key", "back", "run", "maestro", "relaunch")
SWIPES = ("up", "down", "left", "right")
MIN_STILLS, MAX_STILLS = 4, 6
#: The labels of a first storyboard's "further down" stills, a swipe (600 points) apart.
FURTHER_DOWN = ("scrolled down", "scrolled further", "scrolled further still")
MIN_BEATS, MAX_BEATS = 3, 5
LABEL_MAX, CAPTION_MAX = 80, 48
_ENV_REF = re.compile(r"\$\{([A-Z][A-Z0-9_]*)\}")
#: The ONLY variables `expand` ever reads from the environment: the tool's own, which is where a
#: minted device's tokens live (`BUILDER_DEMO_ACCESS`, `BUILDER_DEMO_REFRESH`). A `${GITHUB_TOKEN}`
#: or any other name is never expanded, so a value derived from the repository (an app.json scheme
#: read into a default `open`) can never carry a real secret into `simctl openurl` (the review's
#: item 2). Only these are accepted in a storyboard at all.
TOOL_VAR = re.compile(r"^BUILDER_DEMO_[A-Z0-9_]*$")
#: A URL scheme, RFC 3986: a letter then letters, digits, `+`, `.`, `-`. An app.json `scheme` is
#: the repository's, so it is checked before it becomes a deep link.
SCHEME = re.compile(r"^[a-z][a-z0-9+.-]*$")


def valid_scheme(s) -> bool:
    return isinstance(s, str) and bool(SCHEME.match(s))


class StoryboardError(ValueError):
    pass


# ----------------------------------------------------------------------------- YAML subset


def _scalar(raw: str):
    s = raw.strip()
    if not s:
        return None
    if s[0] in "[{":
        try:
            return json.loads(s)
        except ValueError as e:
            raise StoryboardError(f"an inline collection must be JSON: {s!r}") from e
    if s[0] == '"':
        return json.loads(s)
    if s[0] == "'":
        if not s.endswith("'") or len(s) < 2:
            raise StoryboardError(f"unterminated string: {s!r}")
        return s[1:-1].replace("''", "'")
    low = s.lower()
    if low in ("true", "yes"):
        return True
    if low in ("false", "no"):
        return False
    if low in ("null", "~"):
        return None
    if re.fullmatch(r"-?\d+", s):
        return int(s)
    if re.fullmatch(r"-?\d+\.\d*|-?\.\d+", s):
        return float(s)
    return s


def _strip_comment(line: str) -> str:
    out, quote = [], None
    for i, c in enumerate(line):
        if quote:
            if c == quote:
                quote = None
        elif c in "'\"":
            quote = c
        elif c == "#" and (i == 0 or line[i - 1] in " \t"):
            break
        out.append(c)
    return "".join(out).rstrip()


def parse_yaml(text: str):
    """The block subset: `key: value`, nested by indentation, `- item` sequences whose items
    are scalars or mappings, quoted and plain scalars, and JSON inline collections."""
    lines = []
    for n, raw in enumerate(text.splitlines(), 1):
        if "\t" in raw[: len(raw) - len(raw.lstrip())]:
            raise StoryboardError(f"line {n}: indent with spaces, not tabs")
        s = _strip_comment(raw)
        if s.strip() in ("", "---"):
            continue
        lines.append((len(s) - len(s.lstrip(" ")), s.strip(), n))
    pos = 0

    def block(indent: int):
        nonlocal pos
        if pos >= len(lines):
            return None
        if lines[pos][1].startswith("- ") or lines[pos][1] == "-":
            return seq(lines[pos][0])
        return mapping(lines[pos][0])

    def mapping(indent: int) -> dict:
        nonlocal pos
        out: dict = {}
        while pos < len(lines) and lines[pos][0] == indent and not lines[pos][1].startswith("- "):
            _, s, n = lines[pos]
            m = re.match(r'^("(?:[^"\\]|\\.)*"|[^:]+?)\s*:(?:\s+(.*))?$', s)
            if not m:
                raise StoryboardError(f"line {n}: expected `key: value`, got {s!r}")
            key = json.loads(m.group(1)) if m.group(1).startswith('"') else m.group(1).strip()
            pos += 1
            if m.group(2) is not None and m.group(2).strip():
                out[key] = _scalar(m.group(2))
            elif pos < len(lines) and lines[pos][0] > indent:
                out[key] = block(lines[pos][0])
            elif pos < len(lines) and lines[pos][0] == indent and lines[pos][1].startswith("- "):
                out[key] = seq(indent)
            else:
                out[key] = None
        if pos < len(lines) and lines[pos][0] > indent:
            raise StoryboardError(f"line {lines[pos][2]}: unexpected indentation")
        return out

    def seq(indent: int) -> list:
        nonlocal pos
        out: list = []
        while pos < len(lines) and lines[pos][0] == indent and (lines[pos][1].startswith("- ") or lines[pos][1] == "-"):
            _, s, n = lines[pos]
            rest = s[1:].strip()
            if not rest:
                pos += 1
                out.append(block(lines[pos][0]) if pos < len(lines) and lines[pos][0] > indent else None)
                continue
            if re.match(r'^("(?:[^"\\]|\\.)*"|[\w.$-][^:]*?)\s*:(\s|$)', rest) and not rest.startswith(("[", "{")):
                # A mapping item: rewrite `- key: v` as a mapping at the column of `key`.
                col = indent + (len(s) - len(rest))
                lines[pos] = (col, rest, n)
                out.append(mapping(col))
            else:
                out.append(_scalar(rest))
                pos += 1
        return out

    result = block(0)
    if pos != len(lines):
        raise StoryboardError(f"line {lines[pos][2]}: could not read past here")
    return result


# ----------------------------------------------------------------------------- load, check


def load(path: pathlib.Path) -> dict:
    text = path.read_text(encoding="utf-8")
    if path.suffix in (".yaml", ".yml"):
        data = parse_yaml(text)
    else:
        try:
            data = json.loads(text)
        except ValueError as e:
            raise StoryboardError(f"{path.name} is not JSON: {e}") from e
    return validate(data)


def label_refusal(s: str) -> str | None:
    """The server's label rule (`project_media.label_refusal`), through the publish side's copy
    of it, so a label this file accepts is one `--publish` will send. The dash rule on top."""
    if plain.has_dash(s):
        return "it has a dash in it; say it in plain words (analysis/plain.py)"
    try:
        from ..demo_publish import label_refusal as server_rule
    except ImportError:  # pragma: no cover - the publish side not deployed beside the generator
        return None
    return server_rule(s)


def _check_words(what: str, s, limit: int) -> str:
    if not isinstance(s, str) or not s.strip():
        raise StoryboardError(f"{what} must be a non empty string")
    s = " ".join(s.split())
    if len(s) > limit:
        raise StoryboardError(f"{what} is {len(s)} characters; keep it under {limit} so it reads in a second")
    why = label_refusal(s)
    if why:
        raise StoryboardError(f"{what} {s!r}: {why}")
    return s


def _check_action(where: str, a) -> dict:
    if isinstance(a, str) and a in ("back", "relaunch"):
        return {a: True}
    if not isinstance(a, dict) or len(a) != 1:
        raise StoryboardError(f"{where}: an action is one key of {', '.join(ACTIONS)}, got {a!r}")
    (k, v), = a.items()
    if k not in ACTIONS:
        raise StoryboardError(f"{where}: unknown action {k!r} (one of {', '.join(ACTIONS)})")
    if k in ("wait", "settle") and not (isinstance(v, (int, float)) and 0 <= v <= 60):
        raise StoryboardError(f"{where}: {k} takes seconds between 0 and 60")
    if k == "swipe" and v not in SWIPES:
        raise StoryboardError(f"{where}: swipe is one of {', '.join(SWIPES)}")
    if k in ("open", "type", "key", "run") and not (isinstance(v, str) and v):
        raise StoryboardError(f"{where}: {k} takes a string")
    if k == "tap" and not (isinstance(v, str) and v or isinstance(v, dict) and ({"text", "id", "point", "color"} & v.keys())):
        raise StoryboardError(f"{where}: tap takes visible text, or {{\"text\"|\"id\"|\"point\"|\"color\": ...}}")
    if k == "tap" and isinstance(v, dict) and "point" in v and not re.fullmatch(r"\d{1,3}%, ?\d{1,3}%|\d+, ?\d+", str(v["point"])):
        # Maestro reads "88.5%" as a NumberFormatException: whole percentages or whole points.
        raise StoryboardError(f"{where}: tap point is whole percentages (\"88%, 81%\") or points (\"350, 700\")")
    if k == "tap" and isinstance(v, dict) and "color" in v:
        if not re.fullmatch(r"#?[0-9A-Fa-f]{6}", str(v["color"])):
            raise StoryboardError(f"{where}: tap color is #RRGGBB")
        reg = v.get("region", [0, 0, 1, 1])
        if not (isinstance(reg, list) and len(reg) == 4 and all(isinstance(x, (int, float)) and 0 <= x <= 1 for x in reg) and reg[0] < reg[2] and reg[1] < reg[3]):
            raise StoryboardError(f"{where}: tap region is [left, top, right, bottom] as fractions of the screen")
    if k == "maestro" and not isinstance(v, list):
        raise StoryboardError(f"{where}: maestro takes a list of Maestro commands")
    for s in _strings(v):
        for name in _ENV_REF.findall(s):
            if k not in ("open", "type", "run"):
                raise StoryboardError(f"{where}: ${{{name}}} is read from the environment only in open, type and run")
            if not TOOL_VAR.match(name):
                raise StoryboardError(
                    f"{where}: ${{{name}}} is not one of the tool's own variables; only ${{BUILDER_DEMO_...}} "
                    "(the minted device's tokens) are read from the environment, never a repository's secret"
                )
    return {k: v}


def _check_film(where: str, v) -> str:
    """`film`: "all" (default) films the beat from its first action; "settled" films only the
    state it arrives at. FOUND ON THE THIRD BUILDA RUN: opening the built in sample session passes
    its header, which names the sample's repository (`gt-transit`), on the way to the call chart;
    the privacy pass refused the video at 4.0 s and every still was clean. A beat whose way in shows
    what the demo must not can be filmed from where it lands."""
    if v not in ("all", "settled"):
        raise StoryboardError(f"{where}: film is \"all\" or \"settled\"")
    return v


def _check_expect(where: str, v) -> str | None:
    """`expect`: a regular expression the beat's settled screen must show (read with Vision).
    A tap that lands on nothing changes nothing, and a point tap always "succeeds": FOUND ON THE
    SIXTH RIDEGT RUN, the directions beat filmed the results screen under the label
    "directions", because the replayed data had moved the button. The check makes that a failed
    run instead of a picture that says one thing and shows another."""
    if v is None:
        return None
    if not isinstance(v, str) or not v:
        raise StoryboardError(f"{where}: expect is a regular expression")
    try:
        re.compile(v)
    except re.error as e:
        raise StoryboardError(f"{where}: expect is not a regular expression: {e}") from e
    return v


def _check_viewport(where: str, v, video: bool) -> dict | None:
    """A web picture's own page size, CSS points: a page whose list only shows at a wider width
    (the Personal Website's Projects page is one card a screen on a phone and two columns at
    820). The video keeps the storyboard's one size, so such a beat is a still only."""
    if v is None:
        return None
    if not (isinstance(v, dict) and set(v) == {"width", "height"} and all(isinstance(v[k], int) for k in v)):
        raise StoryboardError(f"{where}: viewport is {{width, height}} in whole points")
    if not (320 <= v["width"] <= 1600 and 480 <= v["height"] <= 3200):
        raise StoryboardError(f"{where}: viewport is 320 to 1600 points wide and 480 to 3200 tall")
    if video:
        raise StoryboardError(f"{where}: a beat with its own viewport is a still only; add video: false")
    return {"width": v["width"], "height": v["height"]}


def _check_optional(where: str, v, video: bool) -> bool:
    """`optional`: a web still left out, not a stopped run, when its picture does not show its
    `expect` (a generated "further down" still on a page with nothing more below)."""
    if not isinstance(v, bool):
        raise StoryboardError(f"{where}: optional is true or false")
    if v and video:
        raise StoryboardError(f"{where}: an optional beat is a still only; add video: false")
    return v


def _strings(v):
    if isinstance(v, str):
        yield v
    elif isinstance(v, dict):
        for x in v.values():
            yield from _strings(x)
    elif isinstance(v, list):
        for x in v:
            yield from _strings(x)


def validate(data) -> dict:
    """The storyboard, checked and normalised. Raises `StoryboardError` with the place and the
    rule a person broke, never a traceback."""
    if not isinstance(data, dict):
        raise StoryboardError("a storyboard is a mapping")
    if data.get("version", 1) != 1:
        raise StoryboardError(f"storyboard version {data.get('version')!r}; this tool reads version 1")
    kind = data.get("kind")
    if kind not in KINDS:
        raise StoryboardError(f"kind must be one of {', '.join(KINDS)}")
    beats = data.get("beats")
    if not isinstance(beats, list) or not beats:
        raise StoryboardError("beats: at least one beat")
    if len(beats) > MAX_BEATS + 3:
        raise StoryboardError(f"{len(beats)} beats; a 10 to 30 second video holds {MIN_BEATS} to {MAX_BEATS}")
    out_beats = []
    for i, b in enumerate(beats, 1):
        if not isinstance(b, dict):
            raise StoryboardError(f"beat {i} is not a mapping")
        label = _check_words(f"beat {i} label", b.get("label"), LABEL_MAX)
        if b.get("caption"):
            caption = _check_words(f"beat {i} caption", b["caption"], CAPTION_MAX)
        elif len(label) <= CAPTION_MAX:
            # No caption written: the label says what the screen shows, so it is the caption.
            caption = label[:1].upper() + label[1:]
        else:
            caption = None
        acts = [_check_action(f"beat {i}", a) for a in (b.get("actions") or [])]
        hold = b.get("hold", 2.0)
        if not isinstance(hold, (int, float)) or not 0 <= hold <= 10:
            raise StoryboardError(f"beat {i}: hold is seconds between 0 and 10")
        out_beats.append(
            {
                "label": label,
                "caption": caption,
                "actions": acts,
                "hold": float(hold),
                "still": bool(b.get("still", True)),
                "video": bool(b.get("video", True)),
                "settle": float(b.get("settle", 8.0)),
                "expect": _check_expect(f"beat {i}", b.get("expect")),
                "film": _check_film(f"beat {i}", b.get("film", "all")),
                "viewport": _check_viewport(f"beat {i}", b.get("viewport"), bool(b.get("video", True))),
                "optional": _check_optional(f"beat {i}", b.get("optional", False), bool(b.get("video", True))),
            }
        )
    stills = []
    for i, s in enumerate(data.get("stills") or [], 1):
        if not isinstance(s, dict):
            raise StoryboardError(f"still {i} is not a mapping")
        stills.append(
            {
                "label": _check_words(f"still {i} label", s.get("label"), LABEL_MAX),
                "actions": [_check_action(f"still {i}", a) for a in (s.get("actions") or [])],
                "settle": float(s.get("settle", 8.0)),
                "expect": _check_expect(f"still {i}", s.get("expect")),
                "viewport": _check_viewport(f"still {i}", s.get("viewport"), False),
                "optional": _check_optional(f"still {i}", s.get("optional", False), False),
            }
        )
    if kind != "web" and any(x["viewport"] for x in [*out_beats, *stills]):
        raise StoryboardError("viewport: only a web page takes its own size; a device's screen is its own")
    if kind != "web" and any(x["optional"] for x in [*out_beats, *stills]):
        raise StoryboardError("optional: only a web still may be left out when it shows nothing")
    n_stills = sum(1 for b in out_beats if b["still"]) + len(stills)
    if n_stills > MAX_STILLS:
        raise StoryboardError(f"{n_stills} stills; a demo keeps {MIN_STILLS} to {MAX_STILLS}")
    setup = [_check_action("setup", a) for a in (data.get("setup") or [])]
    dev = data.get("device") or {}
    if not isinstance(dev, dict):
        raise StoryboardError("device is a mapping")
    loc = dev.get("location")
    if loc is not None and not (isinstance(loc, list) and len(loc) == 2 and all(isinstance(x, (int, float)) for x in loc)):
        raise StoryboardError("device.location is [latitude, longitude]")
    app = data.get("app") or {}
    if not isinstance(app, dict):
        raise StoryboardError("app is a mapping")
    for k in (app.get("build_env") or {}):
        if not re.fullmatch(r"[A-Z][A-Z0-9_]*", k):
            raise StoryboardError(f"app.build_env: {k!r} is not an environment variable name")
    servers = data.get("servers") or []
    for i, s in enumerate(servers, 1):
        if not isinstance(s, dict) or not isinstance(s.get("command"), str):
            raise StoryboardError(f"server {i} needs a command")
    video_label = _check_words("video_label", data["video_label"], LABEL_MAX) if data.get("video_label") else None
    return {
        "version": 1,
        "kind": kind,
        "video_label": video_label,
        "app": app,
        "device": dev,
        "servers": servers,
        "setup": setup,
        "beats": out_beats,
        "stills": stills,
        "viewport": data.get("viewport") or {},
        "terminal": data.get("terminal") or {},
    }


def expand(value: str, env: dict[str, str] | None = None) -> str:
    """`${BUILDER_DEMO_...}` from the environment, and ONLY those (`TOOL_VAR`): a value that came
    from the repository can hold a `${GITHUB_TOKEN}`, which is left as the literal text it is
    rather than read out of the environment (the review's item 2). A missing tool variable is an
    error, never an empty string: a sign in link with an empty token films the signed out app."""
    env = os.environ if env is None else env

    def sub(m: re.Match) -> str:
        name = m.group(1)
        if not TOOL_VAR.match(name):
            return m.group(0)  # not the tool's own variable: never expanded, kept literal
        if name not in env:
            raise StoryboardError(f"${{{name}}} is not set in the environment")
        return env[name]

    return _ENV_REF.sub(sub, value)


def redact(value: str) -> str:
    """What a log may say about an expanded value: the references, never what they held."""
    return _ENV_REF.sub(lambda m: f"${{{m.group(1)}}}", value)


# ----------------------------------------------------------------------------- defaults


def _route_words(route: str) -> list[str]:
    route = re.sub(r"\.(html?|php|aspx?)$", "", route)
    return [w for w in re.split(r"[/_\-.]+", route) if w]


def _route_label(route: str) -> str:
    words = _route_words(route)
    return ("the " + " ".join(words) + " screen") if words else "the first screen"


def _expect_from(words: list[str]) -> str:
    """A default `expect` for a generated beat: the route's or command's own words, matched case
    insensitively so the screen has to show that section rather than a blank or a crash screen;
    `.` (any text at all) when there are no words to key on. Every default beat carries one so a
    generated storyboard never films a screen it never checked (the review's item 7); the person
    editing the storyboard writes the real expected text."""
    real = [re.escape(w) for w in words if len(w) >= 3 and not w.isdigit()]
    return "(?i)" + "|".join(real) if real else "."


def default(plan, named=None) -> dict:
    """A first storyboard from the plan, for the person to edit: a beat per route (tabs first),
    a beat per README command, or the tests. Written to the work dir on the first run.

    `named(text)` says a text names a repository (`privacy.label_leaks`). A route whose label
    would is left out, since its page is likely to show that name as well, and a command's label
    falls back to plain words. FOUND ON THE FIRST WEB DEMO (2026-09-14): the Personal Website's
    fourth route is ridegt-fonts.html, and the first run never checked generated labels at all."""
    named = named or (lambda _text: False)
    kind = plan.kind
    beats: list[dict] = []
    if kind == "expo_ios":
        # The scheme is the repository's, so it is checked before it becomes a deep link; an
        # invalid one leaves the beat without an `open` rather than reaching `simctl openurl`.
        scheme = plan.expo.scheme if (plan.expo and valid_scheme(plan.expo.scheme)) else None
        routes = [r for r in plan.routes if not r.startswith(("/dev", "/debug", "/onboarding")) and not named(_route_label(r))][:4]
        for r in routes:
            beats.append({"label": _route_label(r), "actions": [{"open": f"{scheme}://{r.lstrip('/')}"}] if scheme else [], "hold": 2.0, "expect": _expect_from(_route_words(r))})
        if not beats:
            beats.append({"label": "the first screen", "actions": [], "hold": 3.0, "expect": "."})
    elif kind == "web":
        def page_label(r: str) -> str:
            return "the home page" if r == "/" else _route_label(r).replace("screen", "page")

        for r in [r for r in (plan.routes or ["/"]) if r == "/" or not named(page_label(r))][:4]:
            beats.append({"label": page_label(r), "actions": [{"open": r}], "hold": 2.0, "expect": _expect_from(_route_words(r))})
        # A site of one or two pages is mostly below the fold: stills further down its first
        # page, each left out when the page has nothing more (the same picture again, or no
        # text on it), so a short page still makes one honest still.
        for k, where in enumerate(FURTHER_DOWN[: max(0, MIN_STILLS - len(beats))], 1):
            beats.append({"label": f"the home page, {where}", "actions": [{"open": "/"}, *[{"swipe": "up"}] * k], "hold": 0.0,
                          "expect": ".", "video": False, "optional": True})  # fmt: skip
    else:
        cmds = [s.command for s in plan.steps if s.role == "run"][:4]
        if kind == "cli" and cmds and len(cmds) < MIN_BEATS and not any("--help" in c for c in cmds):
            cmds.insert(0, f"{cmds[0].split()[0]} --help")
        for c in cmds:
            words = re.findall(r"[A-Za-z0-9]+", " ".join(c.split()[1:]))[:4]
            if kind != "cli":
                label = "the tests running"
            elif "help" in words:
                label = "what the command can do, its help"
            else:
                label = "running it on " + " ".join(words) if words else "running it"
            if named(label):
                label = "running it"
            beats.append({"label": label[:LABEL_MAX], "actions": [{"run": c}], "hold": 2.0, "expect": _expect_from(re.findall(r"[A-Za-z0-9]+", c))})
    return {"version": 1, "kind": kind, "app": {}, "device": {}, "setup": [], "beats": beats, "stills": []}
