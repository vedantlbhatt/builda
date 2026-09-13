#!/usr/bin/env python3
"""analysis/vocab.py STACK + Simple Icons -> mobile/src/stack/stackLogos.ts. Never hand-edit the output.

Every thing the Stack page can name (the vocab STACK catalog: its ids, names and categories) gets
exactly one mark: its real logo as Simple Icons draws it (one path on a 24 unit grid, in the
brand's own hex), or a monogram when there is no honest logo to draw. The id to slug table below
is written out by hand, one line an id, because a guessed slug is a wrong logo: Simple Icons'
`shell` is the oil company, its `maestro` is Mastercard's debit card, and neither is the thing
the catalog means. An id with no line in either table stops the generator, so a new catalog item
is a decision, never a silent blank.

Licence (read from the installed package, recorded in the output's header):
  - Simple Icons is CC0 1.0 (`mobile/node_modules/simple-icons/LICENSE.md`, "CC0 1.0 Universal").
  - Its DISCLAIMER.md: CC0 covers the project, not every icon. Some icons carry their own licence
    (the `license` field in `data/simple-icons.json`), and every brand keeps its trademark.
  - So an icon under a NonCommercial licence is never drawn (Builda is a product): Vue.js
    (CC BY-NC-SA 4.0) and CocoaPods (CC BY-NC 4.0) are monograms, and the generator refuses any
    mapping to an NC icon.
  - An icon under an attribution licence (CC BY, CC BY-SA) carries its credit in the output, and
    the page prints the credit of every such mark it shows. The generator refuses one with no
    credit written below.
  - MIT and BSD icons keep their licence named beside the path.
  - Every mark is there to identify a thing the person used, never to say the brand endorses
    Builda. Each brand's guidelines link (when Simple Icons has one) is kept beside its mark.

Installed only at build time: `cd mobile && bun add -d simple-icons`. The app ships the paths
written below, never the package. When the package is not installed (CI's contract job runs
`make gen` on a bare Python), this leaves the committed file as it is and says so.

Standard library only, and byte stable.
"""

from __future__ import annotations

import json
import pathlib
import re
import sys
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from analysis import vocab  # noqa: E402

PKG = ROOT / "mobile/node_modules/simple-icons"
OUT = ROOT / "mobile/src/stack/stackLogos.ts"
NS = "{http://www.w3.org/2000/svg}"

# catalog id -> Simple Icons slug. A comment says why wherever the slug is not the id's own name.
SLUGS: dict[str, str] = {
    # language
    "python": "python",
    "typescript": "typescript",
    "javascript": "javascript",
    "swift": "swift",
    "kotlin": "kotlin",
    "go": "go",
    "rust": "rust",
    "ruby": "ruby",
    "dart": "dart",
    "cpp": "cplusplus",
    "php": "php",
    "html": "html5",  # the W3C's HTML5 mark is the one HTML has
    "css": "css",
    # framework
    "react": "react",
    "react_native": "react",  # React Native's own mark is React's; Simple Icons lists it as a `dup` alias of `react`
    "expo": "expo",
    "nextjs": "nextdotjs",
    "fastapi": "fastapi",
    "django": "django",
    "flask": "flask",
    "express": "express",
    "tailwind": "tailwindcss",
    "svelte": "svelte",
    "sqlalchemy": "sqlalchemy",
    # database
    "postgres": "postgresql",
    "sqlite": "sqlite",
    "redis": "redis",
    "mongodb": "mongodb",
    "mysql": "mysql",
    # infra
    "docker": "docker",
    "railway": "railway",
    "vercel": "vercel",
    "cloudflare": "cloudflare",
    "github_actions": "githubactions",
    "eas": "expo",  # Expo Application Services wears Expo's mark on expo.dev; it has none of its own
    "fly": "flydotio",
    "prometheus": "prometheus",
    "grafana": "grafana",
    "google_cloud": "googlecloud",
    # testing
    "pytest": "pytest",
    "jest": "jest",
    "vitest": "vitest",
    "bun_test": "bun",  # `bun test` is Bun's own runner
    "cypress": "cypress",
    "locust": "locust",
    # tooling
    "git": "git",
    "bun": "bun",
    "npm": "npm",
    "uv": "uv",
    "ruff": "ruff",
    "eslint": "eslint",
    "prettier": "prettier",
    "xcode": "xcode",
    "android_sdk": "android",  # the SDK is Android's; the robot is its mark
    # service
    "posthog": "posthog",
    "stripe": "stripe",
    "sentry": "sentry",
    "anthropic": "anthropic",
    "supabase": "supabase",
    "firebase": "firebase",
    "mapbox": "mapbox",
    "google_maps": "googlemaps",
}

# catalog id -> (monogram, why it has no logo). Two or three letters, set in the category's hue.
MONOGRAMS: dict[str, tuple[str, str]] = {
    "java": ("Jv", "Simple Icons has no Java mark (Oracle's is not in the set), and OpenJDK's is a different thing"),
    "sql": ("SQL", "a language with no mark of its own"),
    "shell": ("Sh", "no one mark stands for every shell; Simple Icons' `shell` is the oil company"),
    "csharp": ("C#", "not in Simple Icons"),
    "vue": ("Vu", "Simple Icons' Vue.js mark is CC BY-NC-SA 4.0, NonCommercial"),
    "reanimated": ("Re", "not in Simple Icons"),
    "swiftui": ("SUI", "not in Simple Icons; Swift's mark is a different thing"),
    "react_native_maps": ("RNM", "not in Simple Icons"),
    "aws": ("AWS", "not in Simple Icons"),
    "playwright": ("Pw", "not in Simple Icons"),
    "xctest": ("XCT", "no mark of its own; Xcode's would name a different tool"),
    "maestro": ("Ma", "not in Simple Icons; its `maestro` is Mastercard's debit card"),
    "make": ("Mk", "not in Simple Icons"),
    "cocoapods": ("CP", "Simple Icons' CocoaPods mark is CC BY-NC 4.0, NonCommercial"),
    "alembic": ("Al", "not in Simple Icons"),
    "openai": ("OAI", "not in Simple Icons"),
    "valhalla": ("Va", "not in Simple Icons"),
    "transloc": ("TL", "not in Simple Icons"),
}

# slug -> the credit an attribution licence asks for, printed on the page wherever the mark is.
CREDITS: dict[str, str] = {
    "git": "Git logo by Jason Long, CC BY 3.0",
    "android": "Android robot by Google, CC BY 3.0",
    "rust": "Rust logo by the Rust Foundation, CC BY SA 4.0",
    "ruby": "Ruby logo by Yukihiro Matsumoto, CC BY SA 2.5",
    "php": "PHP logo by Colin Viebrock, CC BY SA 4.0",
}

PERMISSIVE = {"CC0-1.0", "MIT", "BSD-3-Clause", "BSD-2-Clause", "Apache-2.0", "ISC"}


def die(msg: str) -> None:
    raise SystemExit(f"gen_stack_logos.py: {msg}")


def write(path: pathlib.Path, text: str) -> None:
    if path.exists() and path.read_text() == text:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    print(f"  wrote {path.relative_to(ROOT)}")


def svg_path(slug: str) -> str:
    """The one `<path d>` of an icon, as Simple Icons ships it on its 24 unit viewBox."""
    root = ET.fromstring((PKG / "icons" / f"{slug}.svg").read_text())
    if root.get("viewBox") != "0 0 24 24":
        die(f"{slug}.svg has viewBox {root.get('viewBox')!r}, not 0 0 24 24")
    paths = list(root.iter(f"{NS}path"))
    if len(paths) != 1:
        die(f"{slug}.svg has {len(paths)} paths, not one")
    if paths[0].get("fill-rule") or root.get("fill-rule"):
        die(f"{slug}.svg sets a fill rule; the phone draws nonzero")
    d = paths[0].get("d") or ""
    if not re.fullmatch(r"[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\- ]+", d):
        die(f"{slug}.svg path has characters that are not path data")
    return d


def licence_of(entry: dict) -> str | None:
    lic = entry.get("license")
    return lic.get("type") if isinstance(lic, dict) else None


def main() -> None:
    print("gen_stack_logos.py")
    if not (PKG / "package.json").exists():
        print("  simple-icons is not installed (cd mobile && bun install); mobile/src/stack/stackLogos.ts left as it is")
        return
    version = json.loads((PKG / "package.json").read_text())["version"]
    licence_text = (PKG / "LICENSE.md").read_text()
    if "CC0 1.0 Universal" not in licence_text:
        die("simple-icons' LICENSE.md is no longer CC0 1.0 Universal; read it before shipping its marks")
    data = {i["slug"]: i for i in json.loads((PKG / "data/simple-icons.json").read_text())}

    ids = [s.id for s in vocab.STACK]
    both = sorted(set(SLUGS) & set(MONOGRAMS))
    if both:
        die(f"in both tables: {both}")
    missing = [i for i in ids if i not in SLUGS and i not in MONOGRAMS]
    if missing:
        die(f"catalog ids with no mark decided (add each to SLUGS or MONOGRAMS): {missing}")
    stray = sorted((set(SLUGS) | set(MONOGRAMS)) - set(ids))
    if stray:
        die(f"marks for ids the catalog does not have: {stray}")

    marks: dict[str, dict] = {}
    for item in vocab.STACK:
        if item.id in MONOGRAMS:
            text, why = MONOGRAMS[item.id]
            marks[item.id] = {"kind": "monogram", "text": text, "why": why}
            continue
        slug = SLUGS[item.id]
        entry = data.get(slug)
        if entry is None:
            die(f"{item.id}: Simple Icons {version} has no `{slug}` (removed in an upgrade?); pick again or make it a monogram")
        lic = licence_of(entry)
        if lic and "NC" in lic.split("-"):
            die(f"{item.id}: `{slug}` is {lic}, NonCommercial; Builda cannot ship it")
        credit = CREDITS.get(slug)
        if lic and lic not in PERMISSIVE and not credit:
            die(f"{item.id}: `{slug}` is {lic}; write its credit in CREDITS")
        hexv = entry["hex"].upper()
        if not re.fullmatch(r"[0-9A-F]{6}", hexv):
            die(f"{slug}: hex {hexv!r}")
        marks[item.id] = {
            "kind": "logo",
            "slug": slug,
            "title": entry["title"],
            "hex": f"#{hexv}",
            "path": svg_path(slug),
            "license": lic,
            "credit": credit,
            "guidelines": entry.get("guidelines"),
        }

    logos = sum(1 for m in marks.values() if m["kind"] == "logo")
    slugs = sorted({m["slug"] for m in marks.values() if m["kind"] == "logo"})
    lines = []
    for item in vocab.STACK:
        m = marks[item.id]
        lines.append(f"  {item.id}: {json.dumps(m, sort_keys=True, ensure_ascii=True)},")
    body = "\n".join(lines)
    out = f"""// GENERATED by scripts/gen_stack_logos.py from analysis/vocab.py STACK and Simple Icons {version}.
// Never hand-edit: change the tables in the script and run `make gen` (with mobile/node_modules installed).
//
// Simple Icons, https://simpleicons.org, is CC0 1.0 Universal (its LICENSE.md). Its DISCLAIMER.md
// says CC0 covers the project, not every icon: an icon's own licence is kept beside it here
// (`license`), an attribution licence carries its `credit` (the Stack page prints the credit of
// every such mark it shows), and no NonCommercial icon is used. Every mark is its brand's
// trademark, drawn to identify a thing a person used and never to say the brand endorses Builda;
// `guidelines` links each brand's rules where Simple Icons has one. Paths are on a 24 unit grid.
//
// {logos} of {len(ids)} catalog ids draw a real logo ({len(slugs)} distinct marks); the rest are monograms, each saying why.

import type {{ StackItem }} from '../generated/report';

export type StackMark =
  | {{
      kind: 'logo';
      slug: string;
      title: string;
      /** The brand's own colour, `#RRGGBB`. */
      hex: string;
      /** One path on a 24 by 24 grid, filled nonzero. */
      path: string;
      license: string | null;
      credit: string | null;
      guidelines: string | null;
    }}
  | {{ kind: 'monogram'; text: string; why: string }};

export const SIMPLE_ICONS = {{ version: {json.dumps(version)}, license: 'CC0-1.0' }} as const;

export const STACK_LOGO_COVERAGE = {{ logos: {logos}, catalog: {len(ids)} }} as const;

export const STACK_MARKS: Record<StackItem, StackMark> = {{
{body}
}};
"""
    write(OUT, out)
    print(f"  {logos} of {len(ids)} catalog ids have a real logo")


if __name__ == "__main__":
    main()
