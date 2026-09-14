"""Stage 1: what kind of project this is and how to run it, as a plan a person can read.

The order of evidence is `docs/demos.md`'s: the commands that WORKED in the project's own
Claude Code transcripts (`transcripts.harvest`), then `package.json` scripts, `app.json` /
`app.config` for an Expo app, Procfile, compose and devcontainer, then Railpack's rules (Node:
the `start` script, `main`, `index.js`; Python: `uvicorn main:app`, `manage.py runserver`).
Railpack itself is not run: its `info` would be one more binary to install for the handful of
rules below, and the rules are the part the plan needs.

Nothing here runs the project, and nothing reads a `.env` file: detection reads manifests,
config and the README, and `app.config.ts` is read as TEXT, never executed (`npx expo config`
would run the project's code to answer, which is stage 2's business and the sandbox's).

The kinds and what decides each, first match wins unless the transcripts say otherwise:

    expo_ios   a package.json depending on `expo` beside an app.json or app.config
    web        a web framework in package.json (next, vite, react-scripts, ...), a Python web
               framework with an entry point, a Procfile `web:` line, or a top level index.html
    cli        package.json `bin`, `[project.scripts]`, Cargo `[[bin]]` or `src/main.rs`, a Go main
    library    any other package manifest; its demo is its tests or an example running

When the transcripts ran one kind's commands successfully (`expo run:ios`, `xcodebuild`, a
`simctl install` of the app, `npm run dev`, ...) that kind wins over the structural order: a
repository holding an old CRA site and the Expo app its owner actually ships (RideGT) is an
iOS project, and the transcripts are how this machine knows.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
import json
import os
import pathlib
import re
import shutil
import subprocess
import tomllib

from analysis import plain

from . import KINDS
from .project import Project
from .transcripts import Evidence, Seen

#: Directories never walked for manifests: dependencies, build output, native projects.
_SKIP_DIRS = frozenset(
    {
        ".git", "node_modules", "ios", "android", "Pods", "build", "dist", ".next", ".expo",
        "vendor", "target", ".venv", "venv", "__pycache__", ".turbo", "coverage", "out",
        "DerivedData", ".build", "site-packages", "mobile_backup_v1", "backups",
    }
)  # fmt: skip
_MAX_DEPTH = 3

_WEB_JS = (
    "next", "vite", "react-scripts", "@remix-run/dev", "astro", "nuxt", "@sveltejs/kit",
    "gatsby", "@angular/core", "@vue/cli-service", "parcel", "webpack-dev-server",
)  # fmt: skip
_WEB_PY = ("fastapi", "flask", "django", "streamlit", "starlette", "gradio", "fasthtml")

#: The transcript commands that mean a kind was really run on this machine. Anchored on the
#: program so `grep "expo run:ios" README.md` is not evidence of anything.
ROLE_PATTERNS: dict[str, re.Pattern] = {
    "install": re.compile(
        r"^(?:\w+=\S+\s+)*(?:bun|npm|pnpm|yarn)(?:\s+(?:install|i|ci)\b|$)|"
        r"^(?:\w+=\S+\s+)*(?:pip3?|uv\s+pip)\s+install\b|^uv\s+sync\b|^poetry\s+install\b"
    ),
    "pods": re.compile(r"^(?:\w+=\S+\s+)*(?:bundle exec\s+)?pod\s+install\b|^npx\s+pod-install\b"),
    "prebuild": re.compile(r"^(?:\w+=\S+\s+)*(?:npx|bunx|pnpm\s+exec|yarn)\s+expo\s+prebuild\b"),
    "build_ios": re.compile(
        r"^(?:\w+=\S+\s+)*(?:(?:npx|bunx|pnpm\s+exec|yarn)\s+expo\s+run:ios\b|xcodebuild\b.*-scheme\b)"
    ),
    "sim_app": re.compile(r"^xcrun\s+simctl\s+(?:install|launch)\b"),
    "metro": re.compile(r"^(?:\w+=\S+\s+)*(?:npx|bunx|pnpm\s+exec|yarn)\s+expo\s+start\b"),
    "server": re.compile(
        r"^(?:\w+=\S+\s+)*(?:\S*python3?\s+-m\s+)?(?:uvicorn|gunicorn|hypercorn)\s+\S+:\S+|"
        r"^(?:\w+=\S+\s+)*\S*python3?\s+manage\.py\s+runserver\b|^(?:\w+=\S+\s+)*flask\s+run\b"
    ),
    "web": re.compile(
        r"^(?:\w+=\S+\s+)*(?:bun|npm|pnpm|yarn)(?:\s+run)?\s+(?:dev|start|serve|preview)\b|"
        r"^(?:\w+=\S+\s+)*(?:npx\s+)?(?:next\s+dev|vite(?:\s|$)|astro\s+dev|react-scripts\s+start)"
    ),
    "test": re.compile(
        r"^(?:\w+=\S+\s+)*(?:(?:bun|npm|pnpm|yarn)(?:\s+run)?\s+test\b|\S*pytest\b|"
        r"\S*python3?\s+-m\s+(?:pytest|unittest)\b|cargo\s+test\b|go\s+test\b|swift\s+test\b)"
    ),
}

#: Which roles are evidence FOR which kind.
_KIND_ROLES = {
    "expo_ios": ("build_ios", "sim_app", "prebuild", "pods", "metro"),
    "web": ("web", "server"),
    "cli": (),
    "library": ("test",),
}

#: Environment variable names that carry an analytics or crash reporting key. Never passed to
#: a build or a run (the environment is an allowlist anyway) and named in the plan when the
#: project reads one, so the person sees what their demo build was made without.
ANALYTICS_ENV = re.compile(
    r"^(?:EXPO_PUBLIC_|NEXT_PUBLIC_|VITE_|REACT_APP_)?\w*"
    r"(?:POSTHOG|SENTRY|AMPLITUDE|MIXPANEL|SEGMENT|DATADOG|BUGSNAG|LOGROCKET|FULLSTORY|HOTJAR|"
    r"HEAP|PLAUSIBLE|RUDDERSTACK|STATSIG|CLARITY|GA_MEASUREMENT|GOOGLE_ANALYTICS|UMAMI|"
    r"FIREBASE_ANALYTICS|APPSFLYER|BRANCH_KEY|ONESIGNAL|INTERCOM)\w*$"
)
_ENV_REF = re.compile(r"process\.env\.([A-Z][A-Z0-9_]{2,})|import\.meta\.env\.([A-Z][A-Z0-9_]{2,})")


@dataclasses.dataclass
class Step:
    """One command the run will execute, where, and why this one."""

    role: str
    command: str
    cwd: str  # relative to the clone's top
    source: str
    env: dict[str, str] = dataclasses.field(default_factory=dict)


@dataclasses.dataclass
class ExpoApp:
    dir: str
    name: str | None
    scheme: str | None
    bundle_id: str | None
    config_file: str
    ios_tracked: bool
    routes: list[str]
    #: `src/nav/DEEPLINKS.md`-style shot list, when the project wrote one.
    deeplinks_doc: str | None = None

    @property
    def xcode_name(self) -> str | None:
        """What `expo prebuild` names the Xcode project: the app name, letters and digits."""
        if not self.name:
            return None
        return re.sub(r"[^A-Za-z0-9]", "", self.name) or None


@dataclasses.dataclass
class Plan:
    project: Project
    commit: str | None
    kind: str | None
    kind_reason: str
    app_dir: str
    package_manager: str | None
    expo: ExpoApp | None
    steps: list[Step]
    evidence: Evidence | None
    #: What the demo build is made without: analytics env names the project reads, key files.
    analytics: list[str] = dataclasses.field(default_factory=list)
    routes: list[str] = dataclasses.field(default_factory=list)
    readme_commands: list[str] = dataclasses.field(default_factory=list)
    notes: list[str] = dataclasses.field(default_factory=list)
    refused: str | None = None

    def step(self, role: str) -> Step | None:
        return next((s for s in self.steps if s.role == role), None)


# ----------------------------------------------------------------------------- files


def _read_json(p: pathlib.Path) -> dict | None:
    try:
        v = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError, UnicodeDecodeError):
        return None
    return v if isinstance(v, dict) else None


def _read_text(p: pathlib.Path, limit: int = 400_000) -> str:
    try:
        with p.open("r", encoding="utf-8", errors="replace") as f:
            return f.read(limit)
    except OSError:
        return ""


def _is_env_file(name: str) -> bool:
    """`.env`, `.env.local`, `.env.production`: never opened by anything in this package."""
    return name == ".env" or name.startswith(".env.")


def manifests(top: pathlib.Path, name: str) -> list[pathlib.Path]:
    """Every file called `name` within `_MAX_DEPTH` directories of `top`, shallowest first,
    skipping dependency and build directories."""
    out: list[pathlib.Path] = []

    def walk(d: pathlib.Path, depth: int) -> None:
        try:
            entries = sorted(d.iterdir())
        except OSError:
            return
        for e in entries:
            if e.is_file() and e.name == name:
                out.append(e)
        if depth >= _MAX_DEPTH:
            return
        for e in entries:
            if e.is_dir() and not e.is_symlink() and e.name not in _SKIP_DIRS and not e.name.startswith("."):
                walk(e, depth + 1)

    walk(top, 0)
    return sorted(out, key=lambda p: (len(p.relative_to(top).parts), str(p)))


def _rel(top: pathlib.Path, p: pathlib.Path) -> str:
    r = str(p.relative_to(top))
    return "" if r == "." else r


def _deps(pkg: dict) -> dict:
    d: dict = {}
    for k in ("dependencies", "devDependencies", "peerDependencies"):
        v = pkg.get(k)
        if isinstance(v, dict):
            d.update(v)
    return d


def package_manager(top: pathlib.Path, app_dir: str) -> str:
    """From the lockfile beside the app, else at the top. npm when there is none."""
    for d in (top / app_dir, top):
        if (d / "bun.lock").exists() or (d / "bun.lockb").exists():
            return "bun"
        if (d / "pnpm-lock.yaml").exists():
            return "pnpm"
        if (d / "yarn.lock").exists():
            return "yarn"
        if (d / "package-lock.json").exists():
            return "npm"
    return "npm"


def _tracked(top: pathlib.Path, rel: str) -> bool:
    try:
        r = subprocess.run(
            ["git", "ls-files", "--", rel],
            cwd=str(top),
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return r.returncode == 0 and bool(r.stdout.strip())


# ----------------------------------------------------------------------------- Expo


_CFG_STR = r"""\b{key}\s*:\s*['"]([^'"]+)['"]"""


def _config_value(text: str, key: str) -> str | None:
    m = re.search(_CFG_STR.format(key=key), text)
    return m.group(1) if m else None


def expo_app(top: pathlib.Path, pkg_path: pathlib.Path) -> ExpoApp | None:
    pkg = _read_json(pkg_path)
    if not pkg or "expo" not in _deps(pkg):
        return None
    d = pkg_path.parent
    app_json = _read_json(d / "app.json") or {}
    expo = app_json.get("expo") if isinstance(app_json.get("expo"), dict) else app_json
    cfg_file = next(
        (d / n for n in ("app.config.ts", "app.config.js", "app.config.mjs", "app.config.cjs") if (d / n).exists()),
        None,
    )
    if not expo and cfg_file is None:
        return None
    name = expo.get("name") if isinstance(expo.get("name"), str) else None
    scheme = expo.get("scheme") if isinstance(expo.get("scheme"), str) else None
    ios = expo.get("ios") if isinstance(expo.get("ios"), dict) else {}
    bundle = ios.get("bundleIdentifier") if isinstance(ios.get("bundleIdentifier"), str) else None
    if cfg_file is not None:
        # Read as TEXT. The first literal of each key is the app's own: a widget target's
        # bundle id lives in its own config file, not here.
        text = _read_text(cfg_file)
        name = _config_value(text, "name") or name
        scheme = _config_value(text, "scheme") or scheme
        bundle = _config_value(text, "bundleIdentifier") or bundle
    rel_dir = _rel(top, d)
    routes = router_routes(d / "app") if "expo-router" in _deps(pkg) and (d / "app").is_dir() else []
    doc = next(
        (str(p.relative_to(top)) for p in d.glob("src/**/DEEPLINKS.md")),
        None,
    )
    return ExpoApp(
        dir=rel_dir,
        name=name,
        scheme=scheme,
        bundle_id=bundle,
        config_file=_rel(top, cfg_file) if cfg_file else _rel(top, d / "app.json"),
        ios_tracked=_tracked(top, os.path.join(rel_dir, "ios") if rel_dir else "ios"),
        routes=routes,
        deeplinks_doc=doc,
    )


def router_routes(app: pathlib.Path) -> list[str]:
    """The static routes of an Expo Router `app/` directory, tabs first.

    Every file under `app/` is a deep-linkable screen (Expo Router's core concept): groups in
    parentheses are not part of the path, `index` is its directory, `_layout` and `+` files are
    not screens, and a `[param]` segment needs a value a plan cannot invent, so it is left out.
    """
    tabs: list[str] = []
    rest: list[str] = []
    for f in sorted(app.rglob("*")):
        if not f.is_file() or f.suffix not in (".tsx", ".ts", ".jsx", ".js"):
            continue
        parts = list(f.relative_to(app).with_suffix("").parts)
        if parts[-1].startswith(("_", "+")) or any("[" in p for p in parts):
            continue
        in_tabs = any(p.startswith("(") and "tab" in p for p in parts)
        segs = [p for p in parts if not (p.startswith("(") and p.endswith(")"))]
        if segs and segs[-1] == "index":
            segs = segs[:-1]
        route = "/" + "/".join(segs)
        (tabs if in_tabs else rest).append(route)
    seen: set[str] = set()
    return [r for r in tabs + rest if not (r in seen or seen.add(r))]


# ----------------------------------------------------------------------------- web, cli


def web_routes(d: pathlib.Path) -> list[str]:
    """Static page routes a framework's file layout declares: Next (`app/**/page.*`,
    `pages/*`), SvelteKit (`src/routes/**/+page.svelte`), Astro (`src/pages`), else `/`."""
    routes: list[str] = []
    for base, pat in (("app", "page"), ("src/app", "page")):
        root = d / base
        if root.is_dir():
            for f in sorted(root.rglob(f"{pat}.*")):
                parts = [p for p in f.parent.relative_to(root).parts if not p.startswith("(")]
                if any("[" in p for p in parts):
                    continue
                routes.append("/" + "/".join(parts))
    for base in ("pages", "src/pages"):
        root = d / base
        if root.is_dir():
            for f in sorted(root.rglob("*")):
                if f.suffix not in (".tsx", ".jsx", ".js", ".ts", ".astro", ".md", ".mdx", ".vue"):
                    continue
                rel = f.relative_to(root).with_suffix("")
                if rel.parts[0] in ("api",) or rel.name.startswith(("_", "[")) or "[" in str(rel):
                    continue
                path = "/" + "/".join(p for p in rel.parts if p != "index")
                routes.append(path)
    root = d / "src" / "routes"
    if root.is_dir():
        for f in sorted(root.rglob("+page.svelte")):
            parts = [p for p in f.parent.relative_to(root).parts if not p.startswith("(")]
            if not any("[" in p for p in parts):
                routes.append("/" + "/".join(parts))
    # A static site: its other top level pages.
    for f in sorted(d.glob("*.html")):
        if f.name != "index.html":
            routes.append("/" + f.name)
    routes = [re.sub(r"/+$", "", r) or "/" for r in routes]
    seen: set[str] = set()
    out = [r for r in ["/", *routes] if not (r in seen or seen.add(r))]
    return out


_FENCE = re.compile(r"```(?:bash|sh|shell|console|zsh|text)?\s*\n(.*?)```", re.DOTALL)
_NOT_A_DEMO = re.compile(
    r"^(?:sudo|git\s|cd\s|export\s|source\s|\.\s|rm\s|curl\s|wget\s|brew\s|apt|mkdir\s|cp\s|mv\s|"
    r"docker\s|echo\s|#|pip3?\s+install|npm\s+(?:i|install|ci)\b|bun\s+(?:add|install)|yarn\s+add|"
    r"pnpm\s+(?:add|install)|cargo\s+install|go\s+install|uv\s+(?:pip|tool|add|sync))"
)


def readme_usage(top: pathlib.Path, bins: list[str]) -> list[str]:
    """Commands from the README's fenced code blocks that invoke one of `bins` (a CLI's own
    names), with a leading `$ ` prompt removed. Installs, clones and shell plumbing are not a
    demo of anything, so they are left out."""
    readme = next((top / n for n in ("README.md", "readme.md", "README.rst", "README") if (top / n).exists()), None)
    if readme is None or not bins:
        return []
    out: list[str] = []
    for block in _FENCE.findall(_read_text(readme)):
        for raw in block.splitlines():
            line = raw.strip()
            if line.startswith("$ "):
                line = line[2:].strip()
            if not line or _NOT_A_DEMO.match(line) or any(c in line for c in ("<", ">", "|")):
                continue
            prog = line.split()[0]
            if prog in bins or any(line.startswith(f"python -m {b}") or line.startswith(f"npx {b}") for b in bins):
                if line not in out:
                    out.append(line)
    return out[:5]


def _py_meta(top: pathlib.Path) -> dict:
    p = top / "pyproject.toml"
    if not p.exists():
        return {}
    try:
        return tomllib.loads(_read_text(p))
    except (tomllib.TOMLDecodeError, ValueError):
        return {}


def _py_deps(top: pathlib.Path) -> str:
    text = _read_text(top / "requirements.txt") + _read_text(top / "pyproject.toml")
    return text.lower()


# ----------------------------------------------------------------------------- evidence


def roles_of(ev: Evidence | None) -> dict[str, list[Seen]]:
    """The transcript commands that WORKED at least once, sorted into roles."""
    out: dict[str, list[Seen]] = {r: [] for r in ROLE_PATTERNS}
    if ev is None:
        return out
    for s in ev.commands:
        if s.ok == 0:
            continue
        for role, pat in ROLE_PATTERNS.items():
            if pat.search(s.command):
                out[role].append(s)
                break
    return out


def _when(ts: float) -> str:
    return dt.datetime.fromtimestamp(ts, dt.UTC).strftime("%Y-%m-%d") if ts else "undated"


def describe_seen(s: Seen) -> str:
    where = f" in {s.subdir}/" if s.subdir else " at the top"
    fails = f", failed {s.failed}" if s.failed else ""
    return f"transcripts: worked {s.ok} time{'' if s.ok == 1 else 's'}{fails}{where}, last {_when(s.last_ts)}"


def _pick(seen: list[Seen], subdir: str | None = None) -> Seen | None:
    """The command that worked most, in `subdir` when one is asked for."""
    rows = [s for s in seen if subdir is None or s.subdir == subdir]
    return rows[0] if rows else None


# ----------------------------------------------------------------------------- detect


def detect(
    project: Project,
    top: pathlib.Path,
    commit: str | None,
    evidence: Evidence | None,
    kind: str | None = None,
    configuration: str = "Debug",
) -> Plan:
    """Read `top` (the person's checkout, or the clone for a URL) and write the plan."""
    roles = roles_of(evidence)
    pkgs = manifests(top, "package.json")
    expos = [e for e in (expo_app(top, p) for p in pkgs) if e is not None]
    ios_dirs = {s.subdir for r in _KIND_ROLES["expo_ios"] for s in roles[r]}

    def built_here(e: ExpoApp) -> bool:
        return any(d == e.dir or d.startswith(e.dir + "/") or not e.dir for d in ios_dirs)

    if expos:
        # The Expo app the transcripts built wins; else the shallowest.
        expos.sort(key=lambda e: (not built_here(e), len(e.dir)))

    web_pkg = None
    for p in pkgs:
        pkg = _read_json(p) or {}
        deps = _deps(pkg)
        if "expo" in deps:
            continue
        if any(w in deps for w in _WEB_JS):
            web_pkg = (p, pkg)
            break
    py = _py_meta(top)
    pydeps = _py_deps(top)
    py_web = next((w for w in _WEB_PY if re.search(rf"(?m)^\s*['\"]?{w}\b", pydeps)), None)
    procfile_web = None
    if (top / "Procfile").exists():
        m = re.search(r"(?m)^web:\s*(.+)$", _read_text(top / "Procfile"))
        procfile_web = m.group(1).strip() if m else None

    bins: list[str] = []
    top_pkg = _read_json(top / "package.json") or {}
    if isinstance(top_pkg.get("bin"), str) and isinstance(top_pkg.get("name"), str):
        bins.append(top_pkg["name"].split("/")[-1])
    elif isinstance(top_pkg.get("bin"), dict):
        bins.extend(top_pkg["bin"].keys())
    scripts = (py.get("project") or {}).get("scripts") or ((py.get("tool") or {}).get("poetry") or {}).get("scripts")
    if isinstance(scripts, dict):
        bins.extend(scripts.keys())
    cargo = top / "Cargo.toml"
    if cargo.exists():
        ctext = _read_text(cargo)
        m = re.search(r'(?m)^\s*name\s*=\s*"([^"]+)"', ctext)
        if "[[bin]]" in ctext or (top / "src" / "main.rs").exists():
            bins.append(m.group(1) if m else top.name)
    if (top / "go.mod").exists() and ((top / "main.go").exists() or any((top / "cmd").glob("*/main.go"))):
        bins.append(top.name)

    has_manifest = bool(pkgs) or bool(py) or (top / "setup.py").exists() or cargo.exists() or (top / "go.mod").exists() or (top / "Package.swift").exists()

    # Structural order, then the transcripts' verdict on top of it.
    structural: list[tuple[str, str]] = []
    if expos:
        e = expos[0]
        structural.append(("expo_ios", f"an Expo app in {e.dir or 'the top'} ({e.config_file})"))
    if web_pkg:
        structural.append(("web", f"a web framework in {_rel(top, web_pkg[0])}"))
    elif py_web and any((top / n).exists() for n in ("main.py", "app.py", "manage.py", "app/main.py")):
        structural.append(("web", f"{py_web} with an entry point at the top"))
    elif procfile_web:
        structural.append(("web", "a Procfile web line"))
    elif (top / "index.html").exists():
        structural.append(("web", "an index.html at the top"))
    if bins:
        structural.append(("cli", f"it installs a command: {', '.join(bins[:3])}"))
    if has_manifest:
        structural.append(("library", "a package manifest and nothing that runs on its own"))

    chosen = None
    reason = ""
    if kind:
        chosen, reason = kind, "you chose it (--kind)"
    else:
        for k, _why in structural:
            hits = [s for r in _KIND_ROLES[k] for s in roles[r]]
            if hits and k in ("expo_ios", "web"):
                best = max(hits, key=lambda s: s.ok)
                chosen = k
                reason = f"{_why}, and the transcripts ran it: `{best.command}` worked {best.ok} time{'' if best.ok == 1 else 's'}"
                break
        if chosen is None and structural:
            chosen, reason = structural[0]
    if chosen is not None and chosen not in KINDS:
        chosen = None
    plan = Plan(
        project=project,
        commit=commit,
        kind=chosen,
        kind_reason=reason,
        app_dir="",
        package_manager=None,
        expo=None,
        steps=[],
        evidence=evidence,
    )
    if chosen is None:
        plan.refused = "no run command found: no package manifest, app config, Procfile or entry point"
        return plan

    if chosen == "expo_ios":
        _plan_expo(plan, top, expos[0] if expos else None, roles, configuration)
    elif chosen == "web":
        _plan_web(plan, top, web_pkg, py_web, procfile_web, roles)
    elif chosen == "cli":
        _plan_cli(plan, top, bins, roles)
    else:
        _plan_library(plan, top, roles)
    plan.analytics = analytics_names(top, plan.app_dir)
    return plan


def _install_step(pm: str, app_dir: str, pkg: dict, roles: dict[str, list[Seen]]) -> list[Step]:
    """Dependencies without lifecycle scripts (docs/research/demo-capture.md section 4): bun
    skips untrusted dependency scripts on its own, pnpm 10 blocks them, npm and yarn are told
    to. A project whose own postinstall is `patch-package` gets its patches applied as a step
    of its own, because a project that patches a native module is not the project without it."""
    seen = _pick(roles["install"], app_dir)
    src = describe_seen(seen) if seen else f"the {pm} lockfile"
    cmd = {
        "bun": "bun install --frozen-lockfile",
        "pnpm": "pnpm install --frozen-lockfile",
        "yarn": "yarn install --frozen-lockfile --ignore-scripts",
        "npm": "npm ci --ignore-scripts --no-audit --no-fund",
    }[pm]
    steps = [Step("install", cmd, app_dir, src)]
    post = ((pkg.get("scripts") or {}).get("postinstall") or "").strip()
    if pm in ("npm", "yarn") and post:
        if re.fullmatch(r"(?:npx\s+)?patch-package(?:\s+[\w=-]+)*", post):
            steps.append(Step("patch", "npx --no-install patch-package", app_dir, "package.json scripts.postinstall"))
        else:
            steps.append(
                Step("note", f"postinstall not run: {post}", app_dir, "package.json scripts.postinstall")
            )
    return steps


#: The port a demo's Metro serves on. Not 8081: the person's own Metro is usually there (it
#: was, serving this repository to the owner's phone, while the first demo was made), and a
#: debug app that finds a packager loads THAT bundle, whichever project it belongs to. The app
#: is pointed here at launch (`-RCT_jsLocation`) and pinned away from 8081 by `ios.pin_packager`.
#: `RCT_METRO_PORT` is passed to the build too; it only takes where React Native is compiled
#: from source (Expo SDK 54 ships it prebuilt, with 8081 inside).
DEMO_METRO_PORT = 8097


def host_arch() -> str:
    """The one simulator architecture this Mac runs. FOUND ON THE FIRST RIDEGT BUILD: a generic
    simulator destination builds arm64 AND x86_64 whatever ONLY_ACTIVE_ARCH says, which doubled
    every compile for a slice the simulator here never loads."""
    import platform

    return "arm64" if platform.machine() in ("arm64", "aarch64") else "x86_64"


def _plan_expo(plan: Plan, top: pathlib.Path, e: ExpoApp | None, roles, configuration: str) -> None:
    if e is None:
        plan.refused = "the transcripts built an iOS app, but no Expo app config was found to build it from"
        return
    plan.expo = e
    plan.app_dir = e.dir
    pkg = _read_json(top / e.dir / "package.json") or {}
    pm = package_manager(top, e.dir)
    plan.package_manager = pm
    plan.routes = e.routes
    plan.steps.extend(_install_step(pm, e.dir, pkg, roles))
    ios_dir = os.path.join(e.dir, "ios") if e.dir else "ios"
    env = {"CI": "1", "EXPO_NO_TELEMETRY": "1"}
    if not e.ios_tracked:
        seen = _pick(roles["prebuild"])
        plan.steps.append(
            Step(
                "prebuild",
                "npx expo prebuild --platform ios --no-install",
                e.dir,
                describe_seen(seen) if seen else "ios/ is not tracked, so it is generated",
                env,
            )
        )
    seen = _pick(roles["pods"])
    plan.steps.append(
        Step(
            "pods",
            "pod install",
            ios_dir,
            describe_seen(seen) if seen else "the generated Podfile",
            {**env, "RCT_METRO_PORT": str(DEMO_METRO_PORT)},
        )
    )
    name = e.xcode_name or "App"
    seen = next((s for s in roles["build_ios"] if "xcodebuild" in s.command), None) or _pick(roles["build_ios"])
    m = re.search(r"-scheme\s+(\S+)", seen.command) if seen and "xcodebuild" in seen.command else None
    scheme = m.group(1).strip("'\"") if m else name
    plan.steps.append(
        Step(
            "build",
            f"xcodebuild -workspace {name}.xcworkspace -scheme {scheme} -configuration {configuration} "
            "-sdk iphonesimulator -destination generic/platform=iOS\\ Simulator "
            f"-derivedDataPath <work>/build CODE_SIGNING_ALLOWED=NO ARCHS={host_arch()} ONLY_ACTIVE_ARCH=YES "
            f"RCT_NO_LAUNCH_PACKAGER=1 RCT_METRO_PORT={DEMO_METRO_PORT}",
            ios_dir,
            (describe_seen(seen) + f", scheme {scheme}") if seen else f"the Xcode project expo names after the app, {name}",
            {"RCT_METRO_PORT": str(DEMO_METRO_PORT)},
        )
    )
    if configuration == "Debug":
        plan.notes.append(
            f"a Debug build loads its JavaScript from a Metro started in the clone on port {DEMO_METRO_PORT}, "
            "and the app's ip.txt names a port where nothing listens, so it can never load another "
            "project's bundle from a Metro on 8081"
        )
    server = _pick(roles["server"])
    if server is not None:
        plan.notes.append(
            f"the transcripts ran a backend beside the app: `{server.command}` "
            f"({describe_seen(server)}); a storyboard can start it under `servers`"
        )
    if not e.bundle_id:
        plan.notes.append("no bundle identifier in the app config; the built app's Info.plist is read instead")
    if e.deeplinks_doc:
        plan.notes.append(f"the project documents its deep links: {e.deeplinks_doc}")


def _plan_web(plan: Plan, top: pathlib.Path, web_pkg, py_web, procfile_web, roles) -> None:
    if web_pkg is not None:
        p, pkg = web_pkg
        d = _rel(top, p.parent)
        plan.app_dir = d
        pm = package_manager(top, d)
        plan.package_manager = pm
        plan.steps.extend(_install_step(pm, d, pkg, roles))
        scripts = pkg.get("scripts") or {}
        seen = _pick(roles["web"], d)
        if seen:
            plan.steps.append(Step("run", seen.command, d, describe_seen(seen)))
        else:
            for name in ("dev", "start", "serve", "preview"):
                if name in scripts:
                    run = f"{pm} run {name}" if pm != "npm" or name not in ("start",) else "npm start"
                    plan.steps.append(Step("run", run, d, f"package.json scripts.{name}: {scripts[name]}"))
                    break
            else:
                plan.steps.append(Step("run", f"{pm} start", d, "Railpack's Node rule: the start script"))
        plan.routes = web_routes(p.parent)
        return
    seen = _pick(roles["server"]) or _pick(roles["web"])
    if seen:
        plan.steps.append(Step("run", seen.command, seen.subdir, describe_seen(seen)))
    elif procfile_web:
        plan.steps.append(Step("run", procfile_web, "", "Procfile web"))
    elif py_web and (top / "manage.py").exists():
        plan.steps.append(Step("run", "python manage.py runserver $PORT", "", "Railpack's Django rule"))
    elif py_web:
        entry = "main" if (top / "main.py").exists() else "app"
        run = f"uvicorn {entry}:app --host 127.0.0.1 --port $PORT" if py_web in ("fastapi", "starlette") else f"python {entry}.py"
        plan.steps.append(Step("run", run, "", f"Railpack's Python rule for {py_web}"))
    else:
        plan.steps.append(Step("run", "python3 -m http.server $PORT", "", "Railpack's static rule: index.html"))
    if (top / "requirements.txt").exists():
        plan.steps.insert(0, Step("install", "pip install -r requirements.txt", "", "requirements.txt, into a venv in the work dir"))
    plan.routes = ["/", "/docs"] if py_web in ("fastapi",) else web_routes(top)


def _plan_cli(plan: Plan, top: pathlib.Path, bins: list[str], roles) -> None:
    if (top / "package.json").exists():
        pm = package_manager(top, "")
        plan.package_manager = pm
        plan.steps.extend(_install_step(pm, "", _read_json(top / "package.json") or {}, roles))
    elif (top / "pyproject.toml").exists() or (top / "setup.py").exists():
        plan.steps.append(Step("install", "pip install -e .", "", "pyproject.toml, into a venv in the work dir"))
    elif (top / "Cargo.toml").exists():
        plan.steps.append(Step("install", "cargo build --release", "", "Cargo.toml"))
    elif (top / "go.mod").exists():
        plan.steps.append(Step("install", "go build ./...", "", "go.mod"))
    plan.readme_commands = readme_usage(top, bins)
    if not plan.readme_commands:
        plan.readme_commands = [f"{bins[0]} --help"]
        plan.notes.append("the README shows no usage of the command, so the demo is its --help")
    for c in plan.readme_commands:
        plan.steps.append(Step("run", c, "", "the README's usage"))


def _plan_library(plan: Plan, top: pathlib.Path, roles) -> None:
    seen = _pick(roles["test"])
    if seen:
        plan.steps.append(Step("run", seen.command, seen.subdir, describe_seen(seen)))
    elif (top / "package.json").exists():
        pm = package_manager(top, "")
        plan.package_manager = pm
        plan.steps.extend(_install_step(pm, "", _read_json(top / "package.json") or {}, roles))
        plan.steps.append(Step("run", f"{pm} test", "", "package.json scripts.test"))
    elif (top / "Cargo.toml").exists():
        plan.steps.append(Step("run", "cargo test", "", "Cargo.toml"))
    elif (top / "go.mod").exists():
        plan.steps.append(Step("run", "go test ./...", "", "go.mod"))
    elif (top / "Package.swift").exists():
        plan.steps.append(Step("run", "swift test", "", "Package.swift"))
    else:
        plan.steps.append(Step("run", "python -m pytest -q", "", "a Python package: its tests"))
    examples = sorted(p for p in (top / "examples").glob("*") if p.is_file()) if (top / "examples").is_dir() else []
    if examples:
        plan.notes.append(f"examples/ has {len(examples)} file(s); a storyboard can run one instead of the tests")


def analytics_names(top: pathlib.Path, app_dir: str) -> list[str]:
    """Analytics environment names the app's source reads (`process.env.EXPO_PUBLIC_POSTHOG_KEY`),
    each of which the demo build is made without. Source is read as text; `.env` files never."""
    names: set[str] = set()
    base = top / app_dir if app_dir else top
    budget = 4000
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS and not d.startswith(".")]
        for f in filenames:
            if _is_env_file(f) or not f.endswith((".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs")):
                continue
            budget -= 1
            if budget <= 0:
                break
            for m in _ENV_REF.finditer(_read_text(pathlib.Path(dirpath) / f, 200_000)):
                n = m.group(1) or m.group(2)
                if ANALYTICS_ENV.match(n):
                    names.add(n)
    return sorted(names)


# ----------------------------------------------------------------------------- render


def sandbox_status() -> str:
    srt = shutil.which("srt")
    if srt:
        return f"dev servers run under Anthropic's sandbox runtime ({srt})"
    return (
        "Anthropic's sandbox runtime is NOT installed, so dev servers run unsandboxed "
        "(npm install -g @anthropic-ai/sandbox-runtime to change that)"
    )


def render(plan: Plan, work: pathlib.Path | None = None) -> str:
    """The plan as text a person can read. Plain words, no dash (`analysis.plain`)."""
    p = plan.project
    lines = [f"Demo plan for {p.display_name}", ""]
    lines.append(f"  project key   {p.key}")
    if p.checkout:
        lines.append(f"  checkout      {p.checkout} (read only: nothing is built or run there)")
    if p.url:
        lines.append(f"  repository    {p.url}")
    lines.append(f"  commit        {plan.commit or 'unknown'}")
    if work is not None:
        lines.append(f"  work dir      {work}")
    lines.append("")
    if plan.refused:
        lines.append(f"  Refused: {plan.refused}.")
        return "\n".join(lines)
    lines.append(f"  kind          {plan.kind}, because {plan.kind_reason}")
    if plan.expo:
        e = plan.expo
        lines.append(
            f"  app           {e.name or 'unnamed'} in {e.dir or 'the top'}: scheme {e.scheme or 'none'}, "
            f"bundle id {e.bundle_id or 'unknown'} ({e.config_file}, read as text)"
        )
    if plan.package_manager:
        lines.append(f"  packages      {plan.package_manager}")
    ev = plan.evidence
    if ev is not None:
        lines.append(
            f"  transcripts   {ev.transcripts_matched} of {ev.transcripts_read} Claude Code transcripts "
            f"worked in this repository; {sum(1 for s in ev.commands if s.ok)} distinct commands worked there"
        )
    lines.append("")
    lines.append("  Steps, in order:")
    for i, s in enumerate(plan.steps, 1):
        where = s.cwd or "."
        env = " ".join(f"{k}={v}" for k, v in s.env.items())
        lines.append(f"   {i}. [{s.role}] {s.command}")
        lines.append(f"      in {where}{'  with ' + env if env else ''}")
        lines.append(f"      why: {s.source}")
    if plan.routes:
        shown = ", ".join(plan.routes[:8]) + (f" and {len(plan.routes) - 8} more" if len(plan.routes) > 8 else "")
        lines.append("")
        lines.append(f"  routes        {shown}")
    lines.append("")
    if plan.analytics:
        lines.append(f"  made without  {', '.join(plan.analytics)} (analytics; never passed to the build or the run)")
    lines.append("  environment   an allowlist: PATH, HOME, LANG, TMPDIR and the storyboard's own values; no .env file is copied or read")
    lines.append(f"  sandbox       {sandbox_status()}")
    for n in plan.notes:
        lines.append(f"  note          {n}")
    return "\n".join(no_dash(line) for line in lines)


_NO_DASH = {ord(c): "-" for c in plain.DASH_CHARS}
_DASH_RUN = re.compile(r"\s*[" + "".join(plain.DASH_CHARS) + r"]\s*")
_STEP_LINE = re.compile(r"^\s+\d+\. \[")


def no_dash(line: str) -> str:
    """The one dash rule (`analysis.plain.DASH_CHARS`) on a line of output. Prose is written
    without them, and a dash that arrives in quoted text becomes a comma; a step's command is
    not prose, so there it becomes a hyphen, and ` -- ` in `npm run dev -- --port` is left
    alone as the command it is."""
    if _STEP_LINE.match(line):
        return line.translate(_NO_DASH)
    return _DASH_RUN.sub(", ", line)
