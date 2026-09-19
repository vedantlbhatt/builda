"""Which screen a demo is filmed on, and the check that it was that screen.

The rows are `devices_table.py`, generated from spec/devices.v1.json, the only place a frame size
lives (docs/ship-kit.md). This module is the rules over them:

- `choose_phone`: the device an iOS demo is filmed on. The project's OWN simulator first, the one
  its Claude Code transcripts booted or built for most often (`simulators_in`), because a demo of
  an app on a phone its author never used is a demo of a layout nobody checked; else the table's
  default. Every choice says why, and the run prints it.
- `check_capture`: a capture whose pixels are not its row's pixels within `MATCH_TOLERANCE` is
  REFUSED, with the code `frame_size_mismatch`. That is the elongated phone made impossible: the
  composer draws the row's shape at the row's aspect, so a recording of any other shape would have
  to be stretched into it, and it is stopped here instead.
- `match_pixels`: the row a picture of unknown origin was taken on (an older demo that wrote no
  `capture.json`, a screenshot in the checkout), or None.
"""

from __future__ import annotations

import collections
import json
import re
import subprocess

from . import devices_table as t
from .result import CaptureError

DEVICES = t.DEVICES
FORMATS = t.FORMATS
LOOP = t.LOOP
APP_STORE = t.APP_STORE
TERMINAL = t.TERMINAL
MATCH_TOLERANCE = t.MATCH_TOLERANCE

_BY_ID = {d["id"]: d for d in DEVICES}
_BY_TYPE = {ty: d for d in DEVICES for ty in d["simulator_types"]}
_FORMATS = {f["id"]: f for f in FORMATS}

#: A refusal is a code, and the sentence is rendered from it (`refusal`), so the phone and the
#: terminal say the same thing and a test can hold the code without matching prose.
REFUSALS = {
    "frame_size_mismatch": (
        "{what} is {got_w}x{got_h} pixels and {device} is {want_w}x{want_h}: more than {tol} apart, so it "
        "was not filmed on the screen it is labelled with, and a frame drawn around it would stretch it"
    ),
    "unknown_device": "{device!r} is not a row of spec/devices.v1.json",
    "no_simulator_type": "{device} has no simulator on this Mac ({types}), so it cannot be filmed here",
}


class DeviceError(CaptureError):
    """A refusal about the screen, with its code."""

    def __init__(self, code: str, **facts):
        self.code = code
        self.facts = facts
        super().__init__(refusal(code, **facts))


def refusal(code: str, **facts) -> str:
    return REFUSALS[code].format(**facts)


def by_id(device_id: str) -> dict:
    d = _BY_ID.get(device_id)
    if d is None:
        raise DeviceError("unknown_device", device=device_id)
    return d


def fmt(format_id: str) -> dict:
    return _FORMATS[format_id]


def for_simulator_type(type_id: str | None) -> dict | None:
    return _BY_TYPE.get(type_id or "")


def default_phone() -> dict:
    return _BY_ID[t.DEFAULT_PHONE]


def web_phone() -> dict:
    return _BY_ID[t.DEFAULT_WEB_PHONE]


def web_desktop() -> dict:
    return _BY_ID[t.DEFAULT_WEB_DESKTOP]


def within(got: tuple[int, int], want: tuple[int, int] | list[int], tol: float = MATCH_TOLERANCE) -> bool:
    """Both sides within `tol` of the row's (pure)."""
    return all(abs(int(g) - int(w)) <= tol * int(w) for g, w in zip(got, want))


def match_pixels(width: int, height: int, families: tuple[str, ...] = ("iphone", "ipad")) -> dict | None:
    """The row whose pixels these are, portrait or landscape, or None. The generator guarantees
    no two phone or tablet rows are within the tolerance of each other, so there is at most one."""
    for d in DEVICES:
        if d["family"] not in families:
            continue
        pw, ph = d["pixels"]
        if within((width, height), (pw, ph)) or within((width, height), (ph, pw)):
            return d
    return None


def check_capture(device: dict, width: int, height: int, what: str) -> None:
    """Refuse a capture that is not `device`'s pixels (portrait for a phone or tablet; a Mac
    window is landscape already). `what` names the file for the sentence."""
    want = tuple(device["pixels"])
    if not within((width, height), want):
        raise DeviceError(
            "frame_size_mismatch",
            what=what,
            got_w=width,
            got_h=height,
            device=device["name"],
            want_w=want[0],
            want_h=want[1],
            tol=f"{MATCH_TOLERANCE:.1%}",
        )


def aspect(device: dict) -> float:
    w, h = device["pixels"]
    return w / h


# ------------------------------------------------------------------ the project's own simulator

#: How a transcript names the simulator it ran on. Each pattern's group 1 is a device NAME as
#: `simctl list devicetypes` spells it ("iPhone 16 Pro"), or a device type id.
_NAME = r"(iPhone[ A-Za-z0-9()]*?|iPad[ A-Za-z0-9()\-.]*?)"
_SIM_PATTERNS = (
    # xcodebuild -destination 'platform=iOS Simulator,name=iPhone 16 Pro,OS=18.2'
    re.compile(r"name=" + _NAME + r"\s*(?:,|['\"]|$)"),
    # npx expo run:ios --device "iPhone 16 Pro" / -d / --simulator
    re.compile(r"(?:--device|--simulator|\s-d)\s+['\"]" + _NAME + r"['\"]"),
    # xcrun simctl boot "iPhone 16 Pro"
    re.compile(r"simctl\s+boot\s+['\"]" + _NAME + r"['\"]"),
    # xcrun simctl create NAME com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro
    re.compile(r"(com\.apple\.CoreSimulator\.SimDeviceType\.[A-Za-z0-9\-]+)"),
)


def simulators_in(commands) -> collections.Counter:
    """How often each simulator (a name, or a device type id) appears in the commands that
    WORKED, weighted by how many times each worked (pure; `transcripts.Seen` rows, or any object
    with `.command` and `.ok`)."""
    out: collections.Counter = collections.Counter()
    for c in commands:
        ok = getattr(c, "ok", 1)
        if ok <= 0:
            continue
        text = getattr(c, "command", c)
        for pat in _SIM_PATTERNS:
            for m in pat.finditer(text):
                out[m.group(1).strip()] += ok
    return out


def installed_types() -> dict[str, str]:
    """{device name: device type id} for every simulator device type on this Mac."""
    try:
        r = subprocess.run(["xcrun", "simctl", "list", "devicetypes", "-j"], capture_output=True, text=True, timeout=60, check=False)
        return {x["name"]: x["identifier"] for x in json.loads(r.stdout)["devicetypes"]}
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        return {}


def choose_phone(commands=(), explicit: str | None = None, names: dict[str, str] | None = None) -> tuple[dict, str, str | None]:
    """(row, why, the simulator device type to film on). `explicit` is `--device ROW_ID`;
    otherwise the project's most used simulator that maps to a row, else the default."""
    names = installed_types() if names is None else names
    if explicit:
        d = by_id(explicit)
        return d, f"{d['name']}, as asked (--device {explicit})", _type_for(d, names)
    seen = simulators_in(commands)
    for sim, n in seen.most_common():
        type_id = sim if sim.startswith("com.apple.") else names.get(sim)
        d = for_simulator_type(type_id)
        if d is not None and d["family"] in ("iphone", "ipad"):
            return d, f"{d['name']}: the project's own simulator ({sim}, used {n} times in its transcripts)", type_id
    d = default_phone()
    why = "no simulator named in the project's transcripts" if not seen else f"the transcripts name {', '.join(seen)}, none of them a row"
    return d, f"{d['name']}, the default ({why})", _type_for(d, names)


def _type_for(d: dict, names: dict[str, str]) -> str | None:
    """The first of the row's simulator types that is installed here (the first listed when the
    installed set is unknown)."""
    have = set(names.values())
    for ty in d["simulator_types"]:
        if not have or ty in have:
            return ty
    return None
