#!/usr/bin/env python3
"""mobile/assets/harness/*.svg -> the app's and the widget's harness marks. Never hand-edit either.

  mobile/src/pixel/harnessLogos.ts                  the SVG text, for react-native-svg (SvgXml)
  mobile/targets/widget/_shared/HarnessMarks.swift  the same marks as SwiftUI paths, for the Lock
                                                    Screen, the Dynamic Island and the widget

The owner supplied these marks (2026-09-13: "use these icons for each option"). Each SVG is a
24x24 viewBox; the monochrome ones fill with currentColor, which SvgXml's `color` prop sets, so
they follow the text colour. The -color ones keep their brand colours. Aider has no mark and
keeps its pixel glyph (src/pixel/harness.ts) on the phone, and its name alone on a native surface.

SwiftUI draws no SVG, and the system's own SVG reader (CoreSVG, what an asset catalog SVG and
NSImage go through) REFUSES these files: they write arc flags run together with the next number
("a14.147 14.147 0 01-4.45-3.001"), which the SVG grammar allows and CoreSVG logs as "A/a
command was given the wrong number of floats" before drawing nothing (MEASURED, 2026-09-13:
Gemini came out as a 14x10 pixel smudge, Cursor blank). So the Swift half is the path data
itself: every command made absolute, arcs turned into cubic curves (SVG 1.1 appendix F.6),
each path a list of SwiftUI `Path` calls on the 24 unit grid, with its fill: the tint for a
currentColor mark, its own colour, or its linear gradient in the viewBox's own units. Vectors,
so a mark is sharp at every size, and a monochrome one takes the colour of the words beside it.

Standard library only (`make gen` runs on a bare Python), and byte stable.
"""

from __future__ import annotations

import json
import math
import pathlib
import re
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "mobile/assets/harness"
OUT = ROOT / "mobile/src/pixel/harnessLogos.ts"
SWIFT_OUT = ROOT / "mobile/targets/widget/_shared/HarnessMarks.swift"
NS = "{http://www.w3.org/2000/svg}"
VIEWBOX = 24.0

# wire harness id -> svg file (stem)
MAP = {
    "claude_code": "claude-color",
    "codex": "codex-color",
    "cursor_ide": "cursor",
    "cursor_agent": "cursor",
    "gemini_cli": "gemini-color",
    "cline": "cline",
    "opencode": "opencode",
}


def clean(svg: str) -> str:
    svg = re.sub(r"<title>.*?</title>", "", svg, flags=re.S)
    svg = re.sub(r'\s(height|width)="1em"', "", svg)
    svg = re.sub(r'\sstyle="[^"]*"', "", svg)
    return re.sub(r"\s+", " ", svg).strip()


def write(path: pathlib.Path, text: str) -> None:
    if path.exists() and path.read_text() == text:
        return
    path.write_text(text)
    print(f"  wrote {path.relative_to(ROOT)}")


# ─── path data ─────────────────────────────────────────────────────────────────────────

NUM = re.compile(r"[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?")
ARGS = {"M": 2, "L": 2, "H": 1, "V": 1, "C": 6, "S": 4, "Q": 4, "T": 2, "A": 7, "Z": 0}


class _Reader:
    """The path grammar, one character at a time: a flag is ONE character, so "01-4.45" is
    the flags 0 and 1 and the number -4.45 (the case CoreSVG gets wrong)."""

    def __init__(self, d: str) -> None:
        self.d, self.i = d, 0

    def _ws(self) -> None:
        while self.i < len(self.d) and self.d[self.i] in " \t\r\n,":
            self.i += 1

    def command(self) -> str | None:
        self._ws()
        if self.i < len(self.d) and self.d[self.i].isalpha():
            self.i += 1
            return self.d[self.i - 1]
        return None

    def more(self) -> bool:
        self._ws()
        return self.i < len(self.d) and (self.d[self.i].isdigit() or self.d[self.i] in "-+.")

    def number(self) -> float:
        self._ws()
        m = NUM.match(self.d, self.i)
        if not m:
            raise SystemExit(f"gen_harness_logos.py: no number at {self.d[self.i:self.i + 20]!r}")
        self.i = m.end()
        return float(m.group(0))

    def flag(self) -> int:
        self._ws()
        ch = self.d[self.i]
        if ch not in "01":
            raise SystemExit(f"gen_harness_logos.py: arc flag {ch!r} at {self.i}")
        self.i += 1
        return int(ch)


def _arc(x1, y1, rx, ry, phi_deg, large, sweep, x2, y2):
    """SVG 1.1 F.6.5 (endpoint to centre), then one cubic per quarter turn at most, each with
    the 4/3 tan(t/4) handle. Returns the cubics' (c1x, c1y, c2x, c2y, x, y)."""
    if x1 == x2 and y1 == y2:
        return []
    rx, ry = abs(rx), abs(ry)
    if rx == 0 or ry == 0:
        return [(x1, y1, x2, y2, x2, y2)]
    phi = math.radians(phi_deg % 360)
    cos, sin = math.cos(phi), math.sin(phi)
    dx, dy = (x1 - x2) / 2, (y1 - y2) / 2
    x1p, y1p = cos * dx + sin * dy, -sin * dx + cos * dy
    lam = (x1p / rx) ** 2 + (y1p / ry) ** 2
    if lam > 1:
        rx, ry = rx * math.sqrt(lam), ry * math.sqrt(lam)
    num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
    den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
    coef = math.sqrt(max(0.0, num / den)) * (-1 if large == sweep else 1)
    cxp, cyp = coef * rx * y1p / ry, -coef * ry * x1p / rx
    cx, cy = cos * cxp - sin * cyp + (x1 + x2) / 2, sin * cxp + cos * cyp + (y1 + y2) / 2

    def angle(ux, uy, vx, vy):
        a = math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
        return a

    t1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
    dt = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
    if not sweep and dt > 0:
        dt -= 2 * math.pi
    elif sweep and dt < 0:
        dt += 2 * math.pi
    n = max(1, math.ceil(abs(dt) / (math.pi / 2) - 1e-9))
    step = dt / n
    k = 4 / 3 * math.tan(step / 4)
    out = []

    def point(t):
        return (cx + rx * math.cos(t) * cos - ry * math.sin(t) * sin, cy + rx * math.cos(t) * sin + ry * math.sin(t) * cos)

    def deriv(t):
        return (-rx * math.sin(t) * cos - ry * math.cos(t) * sin, -rx * math.sin(t) * sin + ry * math.cos(t) * cos)

    t = t1
    for i in range(n):
        a, b = t, t + step
        (ax, ay), (bx, by) = point(a), point(b)
        (dax, day), (dbx, dby) = deriv(a), deriv(b)
        if i == n - 1:
            bx, by = x2, y2  # land exactly on the endpoint the path names
        out.append((ax + k * dax, ay + k * day, bx - k * dbx, by - k * dby, bx, by))
        t = b
    return out


def segments(d: str) -> list[tuple]:
    """Absolute M, L, C, Q and Z from any path data (every relative and shorthand command)."""
    r = _Reader(d)
    out: list[tuple] = []
    cx = cy = sx = sy = 0.0
    last_c = last_q = None  # the reflected control point of S and T
    cmd = None
    while True:
        c = r.command()
        if c is None:
            if cmd is None or not r.more():
                break
            c = cmd  # an implicit repeat
        elif c.upper() == "Z":
            out.append(("Z",))
            cx, cy = sx, sy
            last_c = last_q = None
            cmd = c
            continue
        rel = c.islower()
        u = c.upper()
        while True:
            if u == "M":
                x, y = r.number(), r.number()
                if rel:
                    x, y = cx + x, cy + y
                out.append(("M", x, y))
                cx, cy, sx, sy = x, y, x, y
                last_c = last_q = None
                u = "L"  # a moveto's extra pairs are linetos
            elif u == "L":
                x, y = r.number(), r.number()
                if rel:
                    x, y = cx + x, cy + y
                out.append(("L", x, y))
                cx, cy = x, y
                last_c = last_q = None
            elif u == "H":
                x = r.number()
                cx = cx + x if rel else x
                out.append(("L", cx, cy))
                last_c = last_q = None
            elif u == "V":
                y = r.number()
                cy = cy + y if rel else y
                out.append(("L", cx, cy))
                last_c = last_q = None
            elif u in ("C", "S"):
                if u == "C":
                    x1, y1 = r.number(), r.number()
                    if rel:
                        x1, y1 = cx + x1, cy + y1
                else:
                    x1, y1 = (2 * cx - last_c[0], 2 * cy - last_c[1]) if last_c else (cx, cy)
                x2, y2, x, y = r.number(), r.number(), r.number(), r.number()
                if rel:
                    x2, y2, x, y = cx + x2, cy + y2, cx + x, cy + y
                out.append(("C", x1, y1, x2, y2, x, y))
                last_c, last_q = (x2, y2), None
                cx, cy = x, y
            elif u in ("Q", "T"):
                if u == "Q":
                    x1, y1 = r.number(), r.number()
                    if rel:
                        x1, y1 = cx + x1, cy + y1
                else:
                    x1, y1 = (2 * cx - last_q[0], 2 * cy - last_q[1]) if last_q else (cx, cy)
                x, y = r.number(), r.number()
                if rel:
                    x, y = cx + x, cy + y
                out.append(("Q", x1, y1, x, y))
                last_q, last_c = (x1, y1), None
                cx, cy = x, y
            elif u == "A":
                rx, ry, rot = r.number(), r.number(), r.number()
                large, sweep = r.flag(), r.flag()
                x, y = r.number(), r.number()
                if rel:
                    x, y = cx + x, cy + y
                for seg in _arc(cx, cy, rx, ry, rot, large, sweep, x, y):
                    out.append(("C", *seg))
                cx, cy = x, y
                last_c = last_q = None
            else:
                raise SystemExit(f"gen_harness_logos.py: path command {c!r} is not SVG")
            if not r.more():
                break
        cmd = c if c.upper() != "M" else ("l" if rel else "L")
    return out


# ─── fills ─────────────────────────────────────────────────────────────────────────────

HEX3 = re.compile(r"^#([0-9a-fA-F]{3})$")
HEX6 = re.compile(r"^#([0-9a-fA-F]{6})$")


def _hex(v: str) -> str:
    m = HEX3.match(v)
    if m:
        return "#" + "".join(ch * 2 for ch in m.group(1)).upper()
    if HEX6.match(v):
        return v.upper()
    raise SystemExit(f"gen_harness_logos.py: colour {v!r} is not #RGB or #RRGGBB")


def marks() -> dict[str, dict]:
    """stem -> {"layers": [{"segments", "fill", "evenodd"}], "mono"} for every SVG in MAP."""
    out: dict[str, dict] = {}
    for stem in sorted(set(MAP.values())):
        root = ET.fromstring((SRC / f"{stem}.svg").read_text())
        if root.get("viewBox") != "0 0 24 24":
            raise SystemExit(f"gen_harness_logos.py: {stem}.svg has viewBox {root.get('viewBox')!r}, not 0 0 24 24")
        grads = {}
        for g in root.iter(f"{NS}linearGradient"):
            if g.get("gradientUnits") != "userSpaceOnUse":
                raise SystemExit(f"gen_harness_logos.py: {stem}.svg gradient {g.get('id')} is not in user space")
            stops = [
                (float(s.get("offset", "0")), _hex(s.get("stop-color", "#000")), float(s.get("stop-opacity", "1")))
                for s in g.iter(f"{NS}stop")
            ]
            grads[g.get("id")] = {
                "start": (float(g.get("x1")), float(g.get("y1"))),
                "end": (float(g.get("x2")), float(g.get("y2"))),
                "stops": stops,
            }
        if any(True for _ in root.iter(f"{NS}radialGradient")):
            raise SystemExit(f"gen_harness_logos.py: {stem}.svg has a radial gradient, which this does not draw yet")
        root_fill = root.get("fill", "#000")
        root_rule = root.get("fill-rule", "nonzero")
        layers = []
        for p in root.iter(f"{NS}path"):
            fill = p.get("fill", root_fill)
            if fill == "currentColor":
                spec = {"kind": "tint"}
            elif fill.startswith("url(#"):
                spec = {"kind": "linear", **grads[fill[5:-1]]}
            else:
                spec = {"kind": "solid", "color": _hex(fill)}
            layers.append({"segments": segments(p.get("d")), "fill": spec, "evenodd": p.get("fill-rule", root_rule) == "evenodd"})
        out[stem] = {"layers": layers, "mono": all(layer["fill"]["kind"] == "tint" for layer in layers)}
    return out


# ─── Swift ─────────────────────────────────────────────────────────────────────────────


def _n(x: float) -> str:
    s = f"{x:.3f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def _pt(x: float, y: float) -> str:
    return f"CGPoint(x: {_n(x)}, y: {_n(y)})"


def _swift_color(h: str, opacity: float = 1.0) -> str:
    r, g, b = (h[i : i + 2] for i in (1, 3, 5))
    return f"Color(.sRGB, red: 0x{r} / 255, green: 0x{g} / 255, blue: 0x{b} / 255, opacity: {_n(opacity)})"


def _swift_body(segs: list[tuple]) -> str:
    lines = []
    for s in segs:
        if s[0] == "M":
            lines.append(f"p.move(to: {_pt(s[1], s[2])})")
        elif s[0] == "L":
            lines.append(f"p.addLine(to: {_pt(s[1], s[2])})")
        elif s[0] == "C":
            lines.append(f"p.addCurve(to: {_pt(s[5], s[6])}, control1: {_pt(s[1], s[2])}, control2: {_pt(s[3], s[4])})")
        elif s[0] == "Q":
            lines.append(f"p.addQuadCurve(to: {_pt(s[3], s[4])}, control: {_pt(s[1], s[2])})")
        else:
            lines.append("p.closeSubpath()")
    return "\n".join("      " + ln for ln in lines)


def _swift_fill(f: dict) -> str:
    if f["kind"] == "tint":
        return ".tint"
    if f["kind"] == "solid":
        return f".solid({_swift_color(f['color'])})"
    stops = ", ".join(f".init(color: {_swift_color(c, o)}, location: {_n(off)})" for off, c, o in f["stops"])
    (x1, y1), (x2, y2) = f["start"], f["end"]
    return (
        f".linear([{stops}],\n"
        f"                    start: UnitPoint(x: {_n(x1 / VIEWBOX)}, y: {_n(y1 / VIEWBOX)}), "
        f"end: UnitPoint(x: {_n(x2 / VIEWBOX)}, y: {_n(y2 / VIEWBOX)}))"
    )


def gen_swift(ms: dict[str, dict]) -> str:
    stems = list(ms)
    index = {}
    shapes, layer_cases = [], []
    k = 0
    for stem in stems:
        ids = []
        for layer in ms[stem]["layers"]:
            shapes.append(f"    case {k}: // {stem}, layer {len(ids) + 1}\n{_swift_body(layer['segments'])}")
            ids.append((k, layer))
            k += 1
        index[stem] = ids
    for stem in stems:
        items = ",\n".join(
            f"        HarnessMarkLayer(shape: HarnessMarkShape(id: {i}), fill: {_swift_fill(layer['fill'])}, "
            f"evenOdd: {'true' if layer['evenodd'] else 'false'})"
            for i, layer in index[stem]
        )
        layer_cases.append(f'    case "{stem}":\n      return [\n{items},\n      ]')
    wire_cases = "\n".join(f'    case "{w}": return "{s}"' for w, s in MAP.items())
    mono = ", ".join(f'"{s}"' for s in stems if ms[s]["mono"])
    return f"""// GENERATED by scripts/gen_harness_logos.py from mobile/assets/harness/*.svg. Do not edit:
// change the SVG and run make gen.
//
// The owner's harness marks as SwiftUI paths, for the Lock Screen, the Dynamic Island and the
// Home Screen widget (SwiftUI draws no SVG, and CoreSVG refuses these files' run together arc
// flags; the generator's docstring has the measurement). Every command is absolute on the 24
// unit viewBox, arcs are cubic curves, and a gradient keeps the viewBox's own coordinates.
// `HarnessMark` in LiveMarks.swift draws them.

import SwiftUI

/// One filled path of a mark.
struct HarnessMarkLayer {{
  enum Fill {{
    /// The SVG's currentColor: the colour of the words beside the mark.
    case tint
    case solid(Color)
    /// A linear gradient in the viewBox's units (the SVG's userSpaceOnUse).
    case linear([Gradient.Stop], start: UnitPoint, end: UnitPoint)
  }}

  let shape: HarnessMarkShape
  let fill: Fill
  let evenOdd: Bool
}}

enum HarnessMarks {{
  /// The mark a wire harness id draws, or nil: Aider has none, and an id this build does not
  /// know shows its name alone.
  static func stem(for agent: String) -> String? {{
    switch agent {{
{wire_cases}
    default: return nil
    }}
  }}

  /// Marks drawn in one colour, the tint: the SVG filled them with currentColor.
  static let monochrome: Set<String> = [{mono}]

  static func layers(for agent: String) -> [HarnessMarkLayer] {{
    switch stem(for: agent) {{
{chr(10).join(layer_cases)}
    default:
      return []
    }}
  }}
}}

/// One path of one mark on the 24 unit grid, scaled into whatever square it is given.
struct HarnessMarkShape: Shape {{
  let id: Int

  func path(in rect: CGRect) -> Path {{
    var p = Path()
    switch id {{
{chr(10).join(shapes)}
    default:
      break
    }}
    let s = min(rect.width, rect.height) / {_n(VIEWBOX)}
    return p.applying(CGAffineTransform(scaleX: s, y: s).concatenating(CGAffineTransform(translationX: rect.minX, y: rect.minY)))
  }}
}}
"""


def main() -> None:
    print("gen_harness_logos.py")
    entries = {}
    for wire, stem in MAP.items():
        raw = (SRC / f"{stem}.svg").read_text()
        entries[wire] = {"xml": clean(raw), "mono": "currentColor" in raw}
    body = json.dumps(entries, indent=2, sort_keys=True)
    write(
        OUT,
        "// GENERATED by scripts/gen_harness_logos.py from mobile/assets/harness/*.svg.\n"
        "// Never hand-edit. The owner supplied these marks (2026-09-13).\n\n"
        "export type HarnessLogo = { xml: string; mono: boolean };\n\n"
        f"export const HARNESS_LOGOS: Record<string, HarnessLogo> = {body};\n",
    )
    write(SWIFT_OUT, gen_swift(marks()))


if __name__ == "__main__":
    main()
