"""`expo_ios`: build the app in the clone, then film it on a simulator of its own.

BUILD. The plan's steps, in the clone, under the environment allowlist plus the storyboard's
`app.build_env` (Builda: `BUILDER_API_URL`, because a debug build's API address is baked in when
Xcode builds it, CLAUDE.md). Dependencies without lifecycle scripts, `expo prebuild` when ios/ is
not tracked, `pod install`, `xcodebuild` for the simulator with signing off. The `.app` is kept
per commit, configuration and build environment (`build/stamp.json`), so the second run of the
same commit films at once: docs/research/demo-capture.md section 4, "cache the .app per commit".

A Debug app loads its JavaScript from a Metro started IN THE CLONE on its own port (8097, not
8081), is launched pointed at it (`-RCT_jsLocation`, React Native's own user default), and has
`ip.txt` written into its bundle naming a port where nothing listens (`pin_packager`), so it can
never load another project's bundle. FOUND WHILE BUILDING THIS: on the machine it was written on,
8081 was the owner's own Metro serving the Builda checkout, and the RideGT debug app, left to
guess, opened showing Builda. `--app PATH.app` films an app built elsewhere; a debug one is
copied into the work dir and pinned the same way, the original never written to.

DRIVE. `simulator.py` has the device verbs. The order: boot headless, install fresh, seed
AsyncStorage (`app.async_storage`), pin the status bar, grant what the storyboard lists, set the
location, start the servers and Metro, launch, run the setup actions (a sign in link), then record
one pass through the beats, a still of each once its screen settles and, where the storyboard
says what it must show (`expect`), once Vision has read it there; then the extra stills with the
recorder off. A tap that fails, a colour that is not on screen, or an expected text that is not
there stops the run: every later picture would carry the wrong label.
"""

from __future__ import annotations

import hashlib
import json
import os
import pathlib
import plistlib
import re
import shutil
import subprocess
import sys
import time
import urllib.request

from . import simulator as sim
from . import tools
from .pictures import fingerprints, same_picture
from . import storyboard as sb_mod
from .detect import DEMO_METRO_PORT, Plan
from .result import BeatWindow, Capture, CaptureError, Still
from .servers import Server, ServerError, port_free, tail
from .workspace import Workspace, clean_env

STEP_TIMEOUT = {"install": 1800, "patch": 300, "prebuild": 900, "pods": 2400, "build": 5400}
#: The fewest matching pixels a colour tap accepts (sampled every other pixel): the RideGT
#: chevron is about 5,300 at 1206 by 2622, a stray pixel of the same gold in a map tile a few.
MIN_COLOR_PIXELS = 300
#: How long a beat's screen has to change after its actions before it is re-shot.
CHANGE_WAIT = 6.0
_CHANGING = ("open", "tap", "swipe", "type", "key", "back", "maestro", "relaunch")


def say(msg: str) -> None:
    print(f"  {msg}", file=sys.stderr, flush=True)


# ----------------------------------------------------------------------------- build


def find_app(build_dir: pathlib.Path, configuration: str) -> pathlib.Path | None:
    products = build_dir / "Build" / "Products" / f"{configuration}-iphonesimulator"
    apps = sorted(products.glob("*.app")) if products.is_dir() else []
    return apps[0] if apps else None


def build_stamp(ws: Workspace, plan: Plan, configuration: str, build_env: dict) -> dict:
    return {
        "commit": ws.commit,
        "configuration": configuration,
        "build_env": dict(sorted(build_env.items())),
        "steps": [s.command for s in plan.steps],
    }


def build(plan: Plan, ws: Workspace, story: dict, configuration: str) -> pathlib.Path:
    """Run the plan's steps in the clone and return the `.app`. Reuses a build of the same
    commit, configuration and build environment."""
    build_env = {k: str(v) for k, v in (story.get("app", {}).get("build_env") or {}).items()}
    stamp_path = ws.build_dir / "stamp.json"
    stamp = build_stamp(ws, plan, configuration, build_env)
    app = find_app(ws.build_dir, configuration)
    if app is not None and stamp_path.exists():
        try:
            if json.loads(stamp_path.read_text()) == stamp:
                say(f"reusing the build of {ws.commit[:10]} ({configuration}): {app}")
                if configuration == "Debug":
                    pin_packager(app)
                return app
        except ValueError:
            pass
    ws.build_dir.mkdir(parents=True, exist_ok=True)
    for i, step in enumerate(plan.steps, 1):
        if step.role == "note":
            continue
        cmd = step.command.replace("<work>", _q(ws.root))
        cwd = ws.src / step.cwd
        if step.role == "build":
            cmd = _fix_workspace(cmd, cwd)
        log = ws.logs / f"build-{i:02d}-{step.role}.log"
        env = clean_env({**step.env, **build_env})
        say(f"[{i}/{len(plan.steps)}] {step.role}: {cmd}  (in {step.cwd or '.'}; log {log.name})")
        t0 = time.monotonic()
        with log.open("w") as f:
            try:
                r = subprocess.run(
                    ["/bin/sh", "-c", cmd], cwd=str(cwd), stdout=f, stderr=subprocess.STDOUT,
                    env=env, timeout=STEP_TIMEOUT.get(step.role, 1800), check=False,
                )  # fmt: skip
            except subprocess.TimeoutExpired:
                raise CaptureError(f"the build failed: {step.role} ran past {STEP_TIMEOUT.get(step.role, 1800)} s") from None
        dt = time.monotonic() - t0
        if r.returncode != 0:
            say(f"{step.role} failed after {dt:.0f} s; the end of {log}:")
            print(tail(log, 30), file=sys.stderr)
            raise CaptureError(f"the build failed at {step.role} ({step.command.split()[0]} exited {r.returncode})")
        say(f"{step.role} done in {dt:.0f} s")
    app = find_app(ws.build_dir, configuration)
    if app is None:
        raise CaptureError("the build finished but no .app was written")
    if configuration == "Debug":
        pin_packager(app)
    stamp_path.write_text(json.dumps(stamp, indent=1))
    return app


#: Where a demo build's React Native guesses its packager is: a port nothing listens on.
NO_PACKAGER = "127.0.0.1:1"


def pin_packager(app: pathlib.Path) -> None:
    """Make sure a Debug app can only ever load JavaScript from the Metro this run starts.

    FOUND ON THE FIRST RIDEGT RUN: the RideGT debug app, built with `RCT_METRO_PORT=8097`, opened
    showing BUILDA's screens. Expo SDK 54 ships React Native's core PREBUILT, so the compile time
    port is 8081 whatever the build says, and a debug app that is not pointed anywhere asks
    `localhost:8081/status`; on this Mac 8081 was the owner's own Metro, serving the Builda
    checkout, and it answered. React Native reads the host to guess from `ip.txt` in the app
    bundle before it tries localhost (`guessPackagerHost`, RCTBundleURLProvider.mm); its own
    build script writes that file for device builds. Written here naming a port nothing listens
    on, the guess fails: the app loads from the Metro it is launched pointed at
    (`-RCT_jsLocation`), or from nothing, and nothing is an error screen the privacy pass refuses,
    never another project's app.

    Embedding the bundle instead was tried and REVERTED: React Native 0.81 stops a development
    bundle loaded without a dev server at "[runtime not ready]: Error: Cannot create devtools
    websocket connections in embedded environments", and a production bundle has no `__DEV__`,
    which RideGT needs for its replay mode and its local API address."""
    (app / "ip.txt").write_text(NO_PACKAGER)


def _q(p) -> str:
    import shlex

    return shlex.quote(str(p))


def _fix_workspace(cmd: str, ios_dir: pathlib.Path) -> str:
    """`expo prebuild` names the workspace after the app; when the plan's guess is not what it
    wrote and exactly one workspace is there, use that one."""
    m = re.search(r"-workspace\s+(\S+)", cmd)
    if not m or (ios_dir / m.group(1)).exists():
        return cmd
    found = sorted(p.name for p in ios_dir.glob("*.xcworkspace"))
    if len(found) == 1:
        name = found[0].removesuffix(".xcworkspace")
        cmd = cmd.replace(m.group(0), f"-workspace {found[0]}")
        cmd = re.sub(r"-scheme\s+\S+", f"-scheme {name}", cmd)
    return cmd


def app_info(app: pathlib.Path) -> dict:
    """What the `.app` says about itself: bundle id, name, whether it carries its JavaScript,
    and the config Expo embedded (the API address a debug build will call)."""
    info = {}
    try:
        with (app / "Info.plist").open("rb") as f:
            info = plistlib.load(f)
    except (OSError, plistlib.InvalidFileException):
        pass
    cfg = {}
    try:
        with (app / "EXConstants.bundle" / "app.config").open("rb") as f:
            raw = f.read()
        try:
            cfg = json.loads(raw)
        except ValueError:
            cfg = plistlib.loads(raw)
    except (OSError, plistlib.InvalidFileException):
        pass
    extra = cfg.get("extra") if isinstance(cfg, dict) and isinstance(cfg.get("extra"), dict) else {}
    return {
        "bundle_id": info.get("CFBundleIdentifier"),
        "name": info.get("CFBundleDisplayName") or info.get("CFBundleName"),
        "embedded_js": (app / "main.jsbundle").exists(),
        "debug": any(app.glob("*.debug.dylib")),
        "api_base": extra.get("apiBaseUrl"),
    }


# ----------------------------------------------------------------------------- drive


class Driver:
    """One pass over a storyboard on one device."""

    def __init__(self, udid: str, bundle_id: str, run_dir: pathlib.Path, launch_args: list[str]):
        self.udid = udid
        self.bundle_id = bundle_id
        self.run_dir = run_dir
        self.launch_args = launch_args
        self.log = run_dir / "drive.log"
        self.flows = 0
        self.prompted = False
        self.maestro_failures: list[str] = []

    def note(self, msg: str) -> None:
        with self.log.open("a") as f:
            f.write(f"{time.strftime('%H:%M:%S')} {msg}\n")

    def maestro(self, commands: list, optional: bool = False) -> bool:
        self.flows += 1
        flow = self.run_dir / f"flow-{self.flows:02d}.yaml"
        flow.write_text(sim.maestro_flow(self.bundle_id, commands))
        ok = sim.run_maestro(self.udid, flow, self.log)
        self.note(f"maestro {flow.name}: {'ok' if ok else 'FAILED'}")
        if not ok and not optional:
            # A tap that did not happen leaves every later beat on the wrong screen under the
            # right label: a picture that says one thing and shows another. The run stops here.
            self.maestro_failures.append(flow.name)
            raise CaptureError(
                f"the storyboard did not replay: Maestro flow {flow.name} failed ({self.log}), "
                "so the screens after it would not be what their labels say"
            )
        return ok

    def open(self, url: str) -> None:
        self.note(f"open {sb_mod.redact(url)}")
        sim.openurl(self.udid, sb_mod.expand(url))
        if not self.prompted and not re.match(r"https?://", url):
            # iOS may ask "Open in <app>?" the first time a custom scheme is opened
            # (src/nav/DEEPLINKS.md: it did on the first link of a session, not after).
            self.prompted = True
            time.sleep(1.2)
            self.maestro([{"tapOn": {"text": "Open", "optional": True}}], optional=True)

    def tap_color(self, spec: dict) -> None:
        """Tap where a colour is on screen, inside a region (`tap: {"color": ...}`)."""
        shot = sim.screenshot(self.udid, self.run_dir / "find-color.png")
        reg = spec.get("region", [0, 0, 1, 1])
        r = subprocess.run(
            [str(tools.helper()), "find-color", "--png", str(shot), "--color", str(spec["color"]),
             "--tolerance", str(spec.get("tolerance", 36)), "--region", ",".join(str(x) for x in reg)],
            capture_output=True, text=True, timeout=60, check=False,
        )  # fmt: skip
        found = json.loads(r.stdout) if r.returncode == 0 and r.stdout.strip() else {"count": 0}
        if found["count"] < MIN_COLOR_PIXELS:
            raise CaptureError(
                f"the storyboard did not replay: {spec['color']} is not on screen in {reg} "
                f"({found['count']} pixels), so there was nothing to tap"
            )
        # Whole percentages: Maestro 2.8 parses "88.5%" as a NumberFormatException (FOUND ON THE
        # SEVENTH RIDEGT RUN). One percent is 4 points across and 9 down, inside any button.
        point = f"{round(found['x'] * 100)}%, {round(found['y'] * 100)}%"
        self.note(f"colour {spec['color']} at {point} ({found['count']} pixels)")
        self.maestro([{"tapOn": {"point": point}}])

    def shoot(self, actions: list[dict], dest: pathlib.Path, settle: float) -> tuple[pathlib.Path, bool]:
        """Run a beat's actions and photograph where they land. Returns (the still, whether the
        screen changed). Before settling, it waits for the screen to differ from how it was
        before the actions: FOUND BY THE COORDINATOR ON THE FOURTH BUILDA RUN, a link to the
        Wrapped grid while the Wrapped story was open changed nothing (the screen reads its mode
        once, when it mounts) and the still labelled "every card in a grid" was the story card
        again. A beat of only waits is not expected to change anything."""
        changing = any(next(iter(a)) in _CHANGING for a in actions)
        pre = fingerprints([sim.screenshot(self.udid, self.run_dir / "pre.png")])[0] if changing else None
        self.run_actions(actions)
        changed = True
        if pre is not None:
            deadline = time.monotonic() + CHANGE_WAIT
            while True:
                now = fingerprints([sim.screenshot(self.udid, self.run_dir / "changed.png")])[0]
                if not same_picture(now, pre):
                    break
                if time.monotonic() > deadline:
                    changed = False
                    break
                time.sleep(0.4)
        shot, settled = sim.settle(self.udid, dest, timeout=settle)
        if not settled:
            self.note(f"{dest.name} did not settle in {settle:.0f} s; kept as it was")
        return shot, changed

    def shoot_checked(self, label: str, actions: list[dict], dest: pathlib.Path, settle: float, kept: list[tuple[str, int]]) -> tuple[pathlib.Path, str | None]:
        """`shoot`, and once more when the screen did not change or the picture is one already
        kept under another label. Returns (the still, the label it duplicates or None)."""
        shot, changed = self.shoot(actions, dest, settle)
        fp = fingerprints([shot])[0]
        dup = next((lbl for lbl, f in kept if same_picture(f, fp)), None)
        if not changed or dup:
            why = f"it shows the same picture as {dup!r}" if dup else "the screen did not change"
            self.note(f"re-shooting {label!r}: {why}")
            say(f"re-shooting {label!r}: {why}")
            shot, changed = self.shoot(actions, dest, settle)
            fp = fingerprints([shot])[0]
            dup = next((lbl for lbl, f in kept if same_picture(f, fp)), None)
        if not changed and not dup:
            self.note(f"{label!r}: the screen was already showing it before its actions")
        if not dup:
            kept.append((label, fp))
        return shot, dup

    def expect(self, label: str, pattern: str | None, shot: pathlib.Path) -> None:
        """The settled screen shows `pattern` (Vision's text), or the run stops (`expect`)."""
        if not pattern:
            return
        from . import privacy

        try:
            results = privacy.ocr([shot])
        except (RuntimeError, tools.ToolError) as e:
            # Vision could not read the shot (the review's item 4: it must fail closed): a beat
            # whose screen cannot be read is a failed beat, not a passing one.
            raise CaptureError(f"the storyboard did not replay: {label!r} could not be read to check /{pattern}/ ({e})") from e
        text = "\n".join(line.get("text", "") for r in results for line in r.get("lines") or [])
        if not re.search(pattern, text):
            raise CaptureError(
                f"the storyboard did not replay: {label!r} expects /{pattern}/ on screen and it is "
                f"not there ({shot.name}), so that picture would not be what its label says"
            )
        self.note(f"{label!r}: /{pattern}/ is on screen")

    def run_actions(self, actions: list[dict]) -> None:
        batch: list = []

        def flush() -> None:
            if batch:
                self.maestro(list(batch))
                batch.clear()

        for a in actions:
            (k, v), = a.items()
            if k == "tap" and isinstance(v, dict) and "color" in v:
                flush()
                self.tap_color(v)
                continue
            if k in ("tap", "swipe", "type", "key", "back", "maestro"):
                batch.extend(to_maestro(k, v))
                continue
            flush()
            if k == "open":
                self.open(v)
            elif k == "wait":
                time.sleep(float(v))
            elif k == "settle":
                sim.settle(self.udid, self.run_dir / "settle.png", timeout=float(v))
            elif k == "relaunch":
                sim.launch(self.udid, self.bundle_id, self.launch_args)
                time.sleep(2.0)
        flush()


def to_maestro(k: str, v) -> list:
    """One storyboard action as Maestro commands (pure; `test_demo_storyboard` pins it)."""
    if k == "tap":
        if isinstance(v, str):
            return [{"tapOn": v}]
        spec = {key: v[key] for key in ("text", "id", "point", "index", "optional") if key in v}
        return [{"tapOn": spec}]
    if k == "swipe":
        start, end = {
            "up": ("50%, 72%", "50%, 28%"),
            "down": ("50%, 28%", "50%, 72%"),
            "left": ("85%, 50%", "15%, 50%"),
            "right": ("15%, 50%", "85%, 50%"),
        }[v]
        return [{"swipe": {"start": start, "end": end, "duration": 450}}, {"waitForAnimationToEnd": {"timeout": 2500}}]
    if k == "type":
        return [{"inputText": sb_mod.expand(v)}]
    if k == "key":
        return [{"pressKey": v}]
    if k == "back":
        # iOS has no back key: the edge swipe every navigation stack answers.
        return [{"swipe": {"start": "1%, 50%", "end": "75%, 50%", "duration": 350}}]
    if k == "maestro":
        return list(v)
    raise ValueError(k)


#: React Native AsyncStorage keeps values up to this long inline in its manifest; longer ones
#: go to files of their own (RNCAsyncStorage.mm), which a seed does not write.
ASYNC_INLINE_MAX = 1024


def seed_async_storage(udid: str, bundle_id: str, values: dict) -> pathlib.Path:
    """Write React Native AsyncStorage keys into the freshly installed app's container, before
    its first launch: how a storyboard skips a first run's terms, pickers and tips without a
    tap for each (`app.async_storage`). Where RNCAsyncStorage keeps them on iOS:
    `Library/Application Support/<bundle id>/RCTAsyncLocalStorage_V1/manifest.json`."""
    r = subprocess.run(["xcrun", "simctl", "get_app_container", udid, bundle_id, "data"], capture_output=True, text=True, timeout=60, check=False)
    if r.returncode != 0 or not r.stdout.strip():
        raise CaptureError(f"no data container for {bundle_id} to seed: {r.stderr.strip()[:200]}")
    return write_async_storage(pathlib.Path(r.stdout.strip()), bundle_id, values)


def write_async_storage(container: pathlib.Path, bundle_id: str, values: dict) -> pathlib.Path:
    """The file half of `seed_async_storage`: merge `values` into the manifest RNCAsyncStorage
    reads, inside an app's data container."""
    d = container / "Library" / "Application Support" / bundle_id / "RCTAsyncLocalStorage_V1"
    d.mkdir(parents=True, exist_ok=True)
    manifest = d / "manifest.json"
    current = json.loads(manifest.read_text()) if manifest.exists() else {}
    for k, v in values.items():
        v = v if isinstance(v, str) else json.dumps(v)
        if len(v) >= ASYNC_INLINE_MAX:
            raise CaptureError(f"app.async_storage {k}: values of {ASYNC_INLINE_MAX} characters or more are not seeded")
        current[str(k)] = v
    manifest.write_text(json.dumps(current))
    return manifest


QUIET_LOGS = "demo-quiet-logs.js"
_QUIET_BODY = (
    "// Written by capture/demo into a demo's CLONE, never the checkout: development toasts\n"
    "// (LogBox) off for the recording, as a release build has none. The storyboard's app.quiet_logs.\n"
    "import { LogBox } from 'react-native';\n"
    "LogBox.ignoreAllLogs(true);\n"
)


def quiet_logs(app_dir: pathlib.Path) -> str:
    """Development toasts off for a debug recording (`app.quiet_logs` in the storyboard).

    FOUND ON THE FOURTH RIDEGT RUN: a red LogBox toast ("[expo-notifications] Error reading
    persisted...") sat over the bottom of every screen and covered the "Open directions" button,
    so the storyboard's tap missed. A release build shows no LogBox at all, and Builda's own
    `builder://dev-auth?quiet=1` does exactly this through the app. For an app without such a
    switch, the clone's entry imports one line first. Returns the sentence the run prints."""
    pkg_path = app_dir / "package.json"
    pkg = json.loads(pkg_path.read_text()) if pkg_path.exists() else {}
    main = str(pkg.get("main") or "index.js")
    (app_dir / QUIET_LOGS).write_text(_QUIET_BODY)
    entry = (app_dir / main).resolve()
    line = f"import './{QUIET_LOGS[:-3]}';\n"
    if entry.is_file() and str(entry).startswith(str(app_dir.resolve())):
        text = entry.read_text()
        if line not in text:
            entry.write_text(line + text)
        return f"development toasts off in the clone: {main} imports {QUIET_LOGS} first (app.quiet_logs; the checkout is untouched)"
    # The entry is a package (`expo-router/entry`): a wrapper entry imports both.
    (app_dir / "demo-entry.js").write_text(f"{line}import '{main}';\n")
    pkg["main"] = "./demo-entry.js"
    pkg_path.write_text(json.dumps(pkg, indent=2) + "\n")
    return f"development toasts off in the clone: package.json main is demo-entry.js, which imports {QUIET_LOGS} then {main} (app.quiet_logs)"


#: What a JavaScript app's installed dependencies are decided by. A reused work dir is pulled to
#: the project's newest commit, and that commit can add a dependency the old install lacks.
DEPENDENCY_FILES = ("package.json", "bun.lock", "bun.lockb", "package-lock.json", "yarn.lock", "pnpm-lock.yaml")
#: Written into `node_modules` after an install: the fingerprint of `DEPENDENCY_FILES` it installed.
INSTALL_STAMP = ".builda-demo-install"


def dependency_fingerprint(app_path: pathlib.Path, root: pathlib.Path | None = None) -> str:
    """sha256 over the dependency files the app has, each named, so a rename changes it too. In a
    monorepo the lockfile lives at the WORKSPACE ROOT, not beside the app, so the root's
    dependency files are folded in too (the review's item 9); without them a `bun install` at the
    root that added a package would leave the app's `node_modules` looking unchanged."""
    h = hashlib.sha256()
    seen: set[pathlib.Path] = set()
    for base in (root, app_path):
        if base is None:
            continue
        for name in DEPENDENCY_FILES:
            p = base / name
            if p.is_file() and p.resolve() not in seen:
                seen.add(p.resolve())
                h.update(str(p).encode() + b"\0" + p.read_bytes() + b"\0")
    return h.hexdigest()


def needs_install(app_path: pathlib.Path, root: pathlib.Path | None = None) -> str | None:
    """Why the app's dependencies must be installed before Metro can serve it, or None.

    FOUND ON A RE-RUN (2026-09-14): the Builda work dir was pulled to a commit that added
    expo-video, its `node_modules` was from the first run, and this checked only that the folder
    existed. Metro answered its status page, died on the first bundle with "expo-video is added as
    a dependency ... but doesn't seem to be installed", and the app filmed "No script URL
    provided". An install from before this stamp existed is reinstalled once."""
    modules = app_path / "node_modules"
    if not modules.is_dir():
        return "no node_modules yet"
    stamp = modules / INSTALL_STAMP
    if not stamp.is_file():
        return "an install from before the stamp"
    if stamp.read_text().strip() != dependency_fingerprint(app_path, root):
        return "the dependencies changed since the last install"
    return None


def stamp_install(app_path: pathlib.Path, root: pathlib.Path | None = None) -> None:
    modules = app_path / "node_modules"
    if modules.is_dir():
        (modules / INSTALL_STAMP).write_text(dependency_fingerprint(app_path, root) + "\n")


def start_metro(ws: Workspace, plan: Plan, story: dict, log_dir: pathlib.Path) -> tuple[Server, int]:
    """Metro from the clone, for an app that carries no bundle. On `DEMO_METRO_PORT`, or the
    next free port, never 8081."""
    port = DEMO_METRO_PORT
    while not port_free(port):
        port += 1
    app_dir = plan.app_dir
    why = needs_install(ws.src / app_dir, ws.src)
    if why:
        inst = plan.step("install")
        if inst is None:
            raise CaptureError("the app needs Metro, and the plan has no install step for its dependencies")
        say(f"installing dependencies for Metro ({why}): {inst.command}")
        r = subprocess.run(["/bin/sh", "-c", inst.command], cwd=str(ws.src / inst.cwd), env=clean_env(), capture_output=True, text=True, timeout=1800, check=False)
        if r.returncode != 0:
            raise CaptureError(f"installing dependencies failed: {r.stderr[-400:]}")
        patch = plan.step("patch")
        if patch:
            # A failed patch must NOT be stamped as a good install (the review's item 9): the
            # next run would reuse a half patched node_modules. Stamp only when it succeeds.
            pr = subprocess.run(["/bin/sh", "-c", patch.command], cwd=str(ws.src / patch.cwd), env=clean_env(), capture_output=True, text=True, timeout=300, check=False)
            if pr.returncode != 0:
                raise CaptureError(f"applying the project's patches failed, so the install is not stamped: {(pr.stderr or pr.stdout)[-400:]}")
        stamp_install(ws.src / app_dir, ws.src)
    env = {"CI": "1", "EXPO_NO_TELEMETRY": "1", **{k: str(v) for k, v in (story.get("app", {}).get("build_env") or {}).items()}}
    spec = {
        "name": "metro",
        "cwd": app_dir,
        "command": f"npx expo start --port {port} --localhost",
        "health": f"http://127.0.0.1:{port}/status",
        "expect": "packager-status:running",
        "env": env,
    }
    srv = Server(spec, ws, log_dir, allowed_domains=["registry.npmjs.org"])
    srv.start(timeout=240)
    return srv, port


def prewarm(port: int, bundle_id: str, metro: Server | None = None) -> None:
    """Ask Metro for the bundle once before the app does, so the first launch does not film a
    minute of bundling. What the request returns is thrown away."""
    # The query React Native's RCTBundleURLProvider sends (0.79); Expo's server adds its own
    # transform options to it the same way for both requests, so the cache this fills is hit.
    url = (
        f"http://127.0.0.1:{port}/.expo/.virtual-metro-entry.bundle?platform=ios&dev=true&lazy=true"
        f"&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&app={bundle_id}"
    )
    try:
        with urllib.request.urlopen(url, timeout=600) as r:
            while r.read(1 << 20):
                pass
    except OSError as e:
        # A Metro that died building the bundle leaves the app "No script URL provided"; filming
        # that and falling back to the last capture hides why. Say it from Metro's own log.
        if metro is not None and metro.proc is not None and metro.proc.poll() is not None:
            raise CaptureError(f"Metro could not build the app's JavaScript ({e}):\n{tail(metro.log)}") from e
        say(f"prewarming Metro did not finish ({e}); the first launch will bundle")


def run(plan: Plan, ws: Workspace, story: dict, app: pathlib.Path, device: str | None, run_dir: pathlib.Path) -> Capture:
    info = app_info(app)
    bundle_id = info["bundle_id"] or (plan.expo.bundle_id if plan.expo else None)
    if not bundle_id:
        raise CaptureError("the app has no bundle identifier")
    notes: list[str] = []
    if info.get("api_base"):
        notes.append(f"the app calls {info['api_base']} (baked in when it was built)")
    needs_metro = info["debug"] or not info["embedded_js"]
    pinned = (app / "ip.txt").is_file() and (app / "ip.txt").read_text().strip() == NO_PACKAGER
    if info["debug"] and not pinned:
        raise CaptureError(
            f"{app.name} is a debug app not pinned away from other packagers (ip.txt); it could load "
            "whatever Metro answers on localhost:8081. Build it with this tool, or pass it with --app"
        )
    try:
        dev = sim.resolve(device)
        say(f"simulator: {dev.name} ({dev.udid}), booting headless")
        sim.boot(dev)
    except sim.SimulatorError as e:
        raise CaptureError(str(e)) from e
    udid = dev.udid
    servers: list[Server] = []
    launch_args: list[str] = list(story.get("app", {}).get("launch_args") or [])
    metro: Server | None = None
    rec: sim.Recorder | None = None
    try:
        if needs_metro:
            if (story.get("app") or {}).get("quiet_logs"):
                notes.append(quiet_logs(ws.src / plan.app_dir))
            say("a debug app: starting Metro from the clone")
            metro, port = start_metro(ws, plan, story, ws.logs)
            launch_args += ["-RCT_jsLocation", f"localhost:{port}"]
            notes.append(
                f"the JavaScript came from a Metro started in the clone on port {port} ({metro.how}); "
                f"the app's ip.txt names {NO_PACKAGER}, so no other Metro could answer"
            )
            say(f"Metro is up on {port} ({metro.how}); prewarming the bundle")
            prewarm(port, bundle_id, metro)
        for spec in story.get("servers") or []:
            s = Server(spec, ws, ws.logs, allowed_domains=list(spec.get("allowed_domains") or []))
            say(f"starting {s.name}: {spec['command']}")
            s.start(timeout=float(spec.get("timeout", 180)))
            servers.append(s)
            notes.append(f"{s.name} ran from the clone ({s.how})")
        sim.uninstall(udid, bundle_id)
        sim.install(udid, app)
        seed = (story.get("app") or {}).get("async_storage")
        if seed:
            seed_async_storage(udid, bundle_id, seed)
            notes.append(f"{len(seed)} AsyncStorage keys seeded before the first launch (the storyboard's app.async_storage)")
        sim.status_bar(udid)
        devcfg = story.get("device") or {}
        sim.appearance(udid, str(devcfg.get("appearance") or ""))
        for service in devcfg.get("grant") or []:
            sim.privacy(udid, str(service), bundle_id)
        if devcfg.get("location"):
            lat, lng = devcfg["location"]
            sim.location(udid, float(lat), float(lng))
        drv = Driver(udid, bundle_id, run_dir, launch_args)
        say("launching")
        sim.launch(udid, bundle_id, launch_args)
        sim.settle(udid, run_dir / "launch.png", timeout=float(story.get("app", {}).get("launch_timeout", 25)), min_wait=3.0)
        drv.run_actions(story.get("setup") or [])
        stills: list[Still] = []
        windows: list[BeatWindow] = []
        kept: list[tuple[str, int]] = []  # (label, fingerprint) of every picture kept so far
        n = 0
        rec = sim.Recorder(udid, run_dir / "raw.mp4")
        beats = [b for b in story["beats"] if b["video"]]
        if beats:
            rec.start()
            t_rec = sim.mark_start(udid)  # the video's zero (simulator.mark_start says why)
            say(f"recording {len(beats)} beats")
            for b in beats:
                t0 = time.monotonic() - t_rec
                shot, dup = drv.shoot_checked(b["label"], b["actions"], run_dir / f"beat-{len(windows) + 1:02d}.png", b["settle"], kept)
                if dup:
                    raise CaptureError(
                        f"the storyboard did not replay: {b['label']!r} shows the same picture as {dup!r} "
                        "after a second try, so one of the two labels would be wrong"
                    )
                drv.expect(b["label"], b.get("expect"), shot)
                if b.get("film") == "settled":
                    t0 = time.monotonic() - t_rec  # the video starts where the beat landed
                if b["still"]:
                    n += 1
                    dest = run_dir / f"still-{n:02d}.png"
                    shutil.copyfile(shot, dest)
                    stills.append(Still(dest, b["label"]))
                time.sleep(b["hold"])
                windows.append(BeatWindow(b["label"], b["caption"], max(0.0, t0), time.monotonic() - t_rec, still=shot))
                say(f"beat {len(windows)}: {b['label']} ({windows[-1].end - windows[-1].start:.1f} s raw)")
            rec.stop()
        for s in [b for b in story["beats"] if not b["video"]] + story["stills"]:
            dest = run_dir / f"still-{n + 1:02d}.png"
            shot, dup = drv.shoot_checked(s["label"], s["actions"], dest, s["settle"], kept)
            if dup:
                # An extra still is optional: the same picture twice is never kept, the demo goes on.
                notes.append(f"not kept: {s['label']!r} came out the same picture as {dup!r} twice")
                dest.unlink(missing_ok=True)
                continue
            drv.expect(s["label"], s.get("expect"), shot)
            n += 1
            stills.append(Still(dest, s["label"]))
        if drv.maestro_failures:
            notes.append(f"Maestro flows that failed: {', '.join(drv.maestro_failures)} (see drive.log)")
        sim.terminate(udid, bundle_id)
        return Capture(stills=stills, video=rec.path if beats else None, beats=windows, notes=notes)
    except (sim.SimulatorError, ServerError, sb_mod.StoryboardError) as e:
        raise CaptureError(str(e)) from e
    finally:
        # FOUND BY INTERRUPTING A RUN: a recorder still going kept the device busy, `simctl
        # shutdown` failed, and the device was left booted with nothing to say it was ours.
        if rec is not None:
            rec.abort()
        for s in servers:
            s.stop()
        if metro is not None:
            metro.stop()
        try:
            sim.clear_status_bar(udid)
        finally:
            if os.environ.get("BUILDER_DEMO_KEEP_BOOTED") != "1":
                sim.shutdown(dev)
