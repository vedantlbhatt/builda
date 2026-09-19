"""`web`: the dev server in the clone, then Playwright over its routes, as a phone and as a Mac.

The server is the plan's run step (the transcript's command, the package.json script, or
Railpack's rule), started under the allowlisted environment with `PORT` set, inside the sandbox
runtime when it is installed, and waited on until its page answers (`servers.Server`). A server
that picks its own port (Vite's 5173, Next's 3000) is found from what it prints.

The driver is a Python script run with the Playwright venv's interpreter (`tools.playwright_python`),
so capture itself still imports nothing outside the standard library. It records one pass through
the beats in a PHONE's viewport, a row of spec/devices.v1.json (`devices.web_phone`, or the
storyboard's `device.row`), and takes a still of each beat once the page has SETTLED: the network
idle, `document.fonts.ready`, every image decoded, two animation frames, and two screenshots in a
row identical (OpenVidStudio's settle rules, docs/research/demo-capture.md section 3). Requests to
analytics hosts are aborted with `page.route` (section 4, "Phoning home").

THE DESKTOP PASS. Every website used to be filmed as a phone and nothing else, so a site people
open on a laptop was shown only in a shape it is rarely seen in, and the 16:9 post had a phone in
the middle of a wide frame. The same beats now run a second time in a Mac window (a `mac` row,
`devices.web_desktop`, or `device.desktop`; `false` skips it), recorded and stilled the same way,
without the phone's touch emulation. It is optional: a desktop pass whose pictures do not show
what the storyboard expects is left out with a note, never a reason to lose the phone's demo.

Every beat and still is then held to what its label says, as on iOS (`ios.Driver.expect`): a
page the server refused (4xx, 5xx) stops the run, and `expect` must be on the settled picture,
read with Vision (`_verify`). A beat's first click also records where it landed (the element's
box, as fractions of the viewport), which the social formats draw a ring at (`BeatWindow.tap`).
"""

from __future__ import annotations

import json
import os
import pathlib
import re
import subprocess
import sys
import time

from . import devices as table
from . import tools
from .detect import Plan
from .result import BeatWindow, Capture, CaptureError, Still
from .servers import Server, ServerError, port_free
from .workspace import Sandbox, Workspace

#: Hosts a demo's browser never reaches: analytics, session replay and crash reporting.
BLOCK_HOSTS = (
    "posthog.com", "i.posthog.com", "google-analytics.com", "googletagmanager.com", "segment.io",
    "segment.com", "sentry.io", "mixpanel.com", "amplitude.com", "plausible.io", "hotjar.com",
    "clarity.ms", "fullstory.com", "datadoghq.com", "logrocket.io", "heapanalytics.com",
    "vercel-insights.com", "va.vercel-scripts.com",
)  # fmt: skip

_URL_IN_LOG = re.compile(r"https?://(?:localhost|127\.0\.0\.1|\[::1\]):(\d{2,5})")

DRIVER = r'''
import json, re, sys, time, hashlib
from playwright.sync_api import sync_playwright

job = json.load(open(sys.argv[1]))
out = {"beats": [], "stills": [], "notes": [], "checks": [], "prefix": ""}
block = tuple(job["block_hosts"])
# The last `open` the server refused, as [path, status]; reset at every beat. `tap` is where the
# beat's first click landed, as fractions of the viewport, or None.
state = {"refused": None, "tap": None, "viewport": job["viewport"]}

def blocked(url):
    host = url.split("/")[2] if "://" in url else ""
    return any(host == h or host.endswith("." + h) for h in block)

def settle(page, timeout):
    t_end = time.monotonic() + timeout
    try:
        page.wait_for_load_state("networkidle", timeout=timeout * 1000)
    except Exception:
        out["notes"].append("network never went idle on " + page.url)
    page.evaluate("""async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].filter(i => !i.complete).map(i => new Promise(r => { i.onload = i.onerror = r; })));
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    }""")
    prev = None
    while True:
        shot = page.screenshot()
        h = hashlib.sha256(shot).hexdigest()
        if h == prev or time.monotonic() > t_end:
            return shot
        prev = h
        time.sleep(0.4)

def saw_tap(x, y):
    if state["tap"] is None:
        vw, vh = state["viewport"]["width"], state["viewport"]["height"]
        state["tap"] = [round(min(1, max(0, x / vw)), 4), round(min(1, max(0, y / vh)), 4)]

def click(loc):
    try:
        box = loc.bounding_box()
    except Exception:
        box = None
    if box:
        saw_tap(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    loc.click()

def act(page, a):
    (k, v), = a.items()
    if k == "open":
        r = page.goto(v if "://" in v else job["base"] + v, wait_until="domcontentloaded")
        state["refused"] = [v, r.status] if r is not None and r.status >= 400 else None
    elif k == "wait":
        time.sleep(float(v))
    elif k == "settle":
        settle(page, float(v))
    elif k == "tap":
        if isinstance(v, str):
            click(page.get_by_text(v, exact=False).first)
        elif "id" in v:
            click(page.locator("#" + v["id"]).first)
        elif "text" in v:
            loc = page.get_by_text(v["text"], exact=False).first
            if v.get("optional") and loc.count() == 0:
                return
            click(loc)
        elif "point" in v:
            x, y = [float(p.strip().rstrip("%")) / 100 for p in v["point"].split(",")]
            vw, vh = state["viewport"]["width"], state["viewport"]["height"]
            saw_tap(x * vw, y * vh)
            page.mouse.click(x * vw, y * vh)
    elif k == "swipe":
        dy = {"up": 600, "down": -600}.get(v, 0)
        dx = {"left": 400, "right": -400}.get(v, 0)
        page.mouse.wheel(dx, dy)
        time.sleep(0.6)
    elif k == "type":
        page.keyboard.type(v, delay=40)
    elif k == "key":
        page.keyboard.press(v)
    elif k == "back":
        page.go_back()
    elif k == "reveal":
        loc = page.get_by_text(re.compile(v)).first
        try:
            loc.scroll_into_view_if_needed(timeout=5000)
            # A little of what is above it, so the text is not pinned to the window's edge.
            page.evaluate("window.scrollBy(0, -Math.round(window.innerHeight * 0.2))")
        except Exception:
            pass
        time.sleep(0.6)

def desktop_actions(b):
    """A beat's actions for a Mac window. A swipe scrolls by pixels, and a wider page is a
    shorter one, so the phone's two swipes land somewhere else on a desktop (FOUND ON THE FIRST
    DESKTOP PASS, 2026-09-19: "where I have worked" was two swipes down on the phone and off
    screen on a 1512 point window, so the pass was refused rather than mislabelled). A beat that
    says what it must show gets its swipes replaced by scrolling that text into view, which is
    what the swipes were for; a beat that says nothing keeps its swipes."""
    acts = b["actions"]
    if not b.get("expect") or not any("swipe" in a for a in acts):
        return acts
    out = [a for a in acts if "swipe" not in a]
    out.append({"reveal": b["expect"]})
    return out

def check(bucket, label, pattern, shot, path, optional=False):
    """What `_verify` needs to hold the picture to its label: the refused open, and the settled
    picture (a beat that is not a still keeps one for Vision)."""
    if pattern and path is None:
        path = f"{job['run_dir']}/check-{bucket['prefix']}{len(bucket['checks']) + 1:02d}.png"
        open(path, "wb").write(shot)
    bucket["checks"].append({"label": label, "refused": state["refused"], "pattern": pattern, "shot": path, "optional": optional})

def film(browser, bucket, viewport, scale, mobile, video_dir):
    """One recorded pass through the beats in one viewport: its beats, stills and checks go in
    `bucket`, and the video's path is returned."""
    state["viewport"] = viewport
    ctx = browser.new_context(
        viewport=viewport, device_scale_factor=scale, is_mobile=mobile, has_touch=mobile,
        color_scheme=job.get("color_scheme") or "light",
        record_video_dir=video_dir,
        # The viewport's own size: Playwright records CSS pixels whatever the device scale and
        # only ever scales DOWN, so twice the viewport put the page in the top left quarter of a
        # grey frame (FOUND ON THE FIRST WEB DEMO, 2026-09-14). Softer than the stills.
        record_video_size={"width": viewport["width"], "height": viewport["height"]},
    )
    t0 = time.monotonic()
    ctx.route("**/*", lambda route: route.abort() if blocked(route.request.url) else route.continue_())
    page = ctx.new_page()
    last = None
    n = 0
    for b in job["beats"]:
        state["refused"] = None
        state["tap"] = None
        start = time.monotonic() - t0
        actions = b["actions"] if mobile else desktop_actions(b)
        for a in actions:
            act(page, a)
        shot = settle(page, b["settle"])
        if last is not None and shot == last and actions:
            # The page did not change: act once more, then keep what it shows (the run's
            # manifest step still refuses the same picture twice).
            bucket["notes"].append("re-shot " + b["label"] + ": the page did not change")
            for a in actions:
                act(page, a)
            shot = settle(page, b["settle"])
        last = shot
        tap = state["tap"]
        if b.get("film") == "settled":
            start = time.monotonic() - t0
            tap = None
        path = None
        if b["still"]:
            n += 1
            path = f"{job['run_dir']}/{bucket['prefix']}still-{n:02d}.png"
            open(path, "wb").write(shot)
            bucket["stills"].append({"path": path, "label": b["label"]})
        check(bucket, b["label"], b.get("expect"), shot, path)
        time.sleep(b["hold"])
        bucket["beats"].append({"label": b["label"], "caption": b["caption"], "start": start, "end": time.monotonic() - t0, "tap": tap})
    video = page.video.path() if page.video else None
    ctx.close()
    return str(video) if video else None, n

with sync_playwright() as p:
    browser = p.chromium.launch()
    n = 0
    out["video"] = None
    # Nothing is filmed when no beat is (`--no-video` makes every beat a still).
    if job["beats"]:
        out["video"], n = film(browser, out, job["viewport"], job["scale"], True, job["video_dir"])

    def context(viewport, scale):
        c = browser.new_context(viewport=viewport, device_scale_factor=scale, is_mobile=True, has_touch=True, color_scheme=job.get("color_scheme") or "light")
        c.route("**/*", lambda route: route.abort() if blocked(route.request.url) else route.continue_())
        return c

    state["viewport"] = job["viewport"]
    ctx2 = context(job["viewport"], job["scale"])
    page = ctx2.new_page()
    for s in job["stills"]:
        state["refused"] = None
        own = None
        if s.get("viewport"):
            # A page of its own size, from a fresh page (so its actions open one), at the scale
            # that keeps the picture as wide as the phone's stills.
            own = context(s["viewport"], round(job["viewport"]["width"] * job["scale"] / s["viewport"]["width"], 3))
        pg = own.new_page() if own else page
        for a in s["actions"]:
            act(pg, a)
        n += 1
        path = f"{job['run_dir']}/still-{n:02d}.png"
        shot = settle(pg, s["settle"])
        open(path, "wb").write(shot)
        out["stills"].append({"path": path, "label": s["label"], "own_size": bool(own)})
        check(out, s["label"], s.get("expect"), shot, path, bool(s.get("optional")))
        if own:
            own.close()
    ctx2.close()
    desk = job.get("desktop")
    if desk and job["beats"]:
        d = {"beats": [], "stills": [], "notes": [], "checks": [], "prefix": "desktop-"}
        try:
            d["video"], _ = film(browser, d, desk["viewport"], desk["scale"], False, desk["video_dir"])
            out["desktop"] = d
        except Exception as e:
            out["notes"].append("the desktop pass did not finish: " + str(e)[:200])
    browser.close()
json.dump(out, open(sys.argv[2], "w"))
'''


def _port(start: int = 4097) -> int:
    p = start
    while not port_free(p):
        p += 1
    return p


def _found_port(log: pathlib.Path, default: int, timeout: float = 60.0) -> int:
    """The port a server printed it is listening on, when it chose its own."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            m = _URL_IN_LOG.search(log.read_text(errors="replace"))
        except OSError:
            m = None
        if m:
            return int(m.group(1))
        time.sleep(0.5)
    return default


def _venv_pip(command: str, ws: Workspace, sandbox: Sandbox) -> tuple[str, str]:
    """A `pip install ...` rewritten to a venv in the work dir and the venv's bin dir for PATH.

    FOUND BY THE REVIEW (item 6): the web path ran `pip install -r requirements.txt` with the
    person's own `pip`, though `detect` promised a venv in the work dir. It now creates the venv
    and installs into it, so a project's dependencies never land in the user's site packages."""
    venv = ws.root / "venv"
    if not (venv / "bin" / "python").exists():
        argv, _ = sandbox.wrap(["python3", "-m", "venv", str(venv)])
        r = subprocess.run(argv, capture_output=True, text=True, timeout=300, check=False, env=sandbox.env())
        if r.returncode != 0:
            raise CaptureError(f"creating the venv failed: {r.stderr[-300:]}")
    return command.replace("pip install", f"{venv}/bin/pip install", 1), str(venv / "bin")


def _verify(checks: list[dict]) -> tuple[list[str], set[str]]:
    """Every picture is what its label says, or the run stops, as on iOS (`ios.Driver.expect`).

    A page the server refused is never a state of the app, and `expect` is read from the settled
    PICTURE with Vision, which fails closed: the page's text would pass a beat whose words sit
    below the fold (a beat scrolled 200 points passed on a heading 900 points down). FOUND ON THE
    FIRST WEB DEMO (2026-09-14): the web driver never read `expect` at all, though every
    generated beat carries one so a storyboard "never films a screen it never checked", and the
    Personal Website's "portfolio page" still was Python's 404 page.

    An OPTIONAL still (a generated "further down" one) whose picture does not show its `expect`
    is left out rather than stopping the run: a page with nothing more below it scrolls onto a
    blank. Returns the notes and the pictures to leave out."""
    for c in checks:
        if c.get("refused"):
            path, status = c["refused"]
            raise CaptureError(
                f"the storyboard did not replay: {c['label']!r} opened {path} and the server answered "
                f"{status}, so that picture would not be what its label says"
            )
    wanted = [c for c in checks if c.get("pattern")]
    if not wanted:
        return [], set()
    from . import privacy

    shots = [pathlib.Path(c["shot"]) for c in wanted]
    try:
        results = privacy.ocr(shots)
    except (RuntimeError, tools.ToolError) as e:
        raise CaptureError(f"the storyboard did not replay: {wanted[0]['label']!r} and the rest could not be read to check what they show ({e})") from e
    text = {pathlib.Path(str(r.get("file"))).name: "\n".join(line.get("text", "") for line in r.get("lines") or []) for r in results}
    notes: list[str] = []
    left_out: set[str] = set()
    for c, shot in zip(wanted, shots):
        if re.search(c["pattern"], text.get(shot.name, "")):
            continue
        if c.get("optional"):
            left_out.add(str(shot))
            notes.append(f"left out {c['label']!r}: /{c['pattern']}/ is not on its picture")
            continue
        raise CaptureError(
            f"the storyboard did not replay: {c['label']!r} expects /{c['pattern']}/ on the page and it is "
            f"not there ({shot.name}), so that picture would not be what its label says"
        )
    kept = len(wanted) - len(left_out)
    notes.insert(0, f"every picture shows what its storyboard expects ({kept} read with Vision)")
    return notes, left_out


def rows_for(story: dict) -> tuple[dict, dict | None]:
    """(the phone row, the Mac window row or None) a web demo is filmed in: the storyboard's
    `device.row` / `device.desktop` (`false` for no desktop pass), a top level `viewport` that is
    some row's points, else the table's defaults (pure over the table)."""
    dev = story.get("device") or {}
    phone = table.web_phone()
    vp = story.get("viewport") or {}
    if dev.get("row"):
        phone = table.by_id(str(dev["row"]))
    elif vp:
        phone = next((d for d in table.DEVICES if d["points"] == [vp.get("width"), vp.get("height")] and d["family"] != "mac"), phone)
    desk = dev.get("desktop")
    desktop = None if desk is False else table.by_id(str(desk)) if desk else table.web_desktop()
    return phone, desktop


def viewport_of(row: dict) -> dict:
    return {"width": row["points"][0], "height": row["points"][1]}


def run(plan: Plan, ws: Workspace, story: dict, run_dir: pathlib.Path, sandbox: Sandbox | None = None) -> Capture:
    sandbox = sandbox or Sandbox(work=ws.root, untrusted=False)
    venv_bin = None
    install = plan.step("install")
    if install is not None:
        cmd = install.command
        domains = ["registry.npmjs.org"]
        if cmd.strip().startswith("pip install"):
            cmd, venv_bin = _venv_pip(cmd, ws, sandbox)
            domains = ["pypi.org", "files.pythonhosted.org"]
        inst = Server({"name": "install", "cwd": install.cwd, "command": "true", "install": cmd}, ws, ws.logs, allowed_domains=domains, sandbox=sandbox)
        try:
            inst.prepare()
        except ServerError as e:
            raise CaptureError(f"installing dependencies failed: {e}") from e
    step = plan.step("run")
    if step is None:
        raise CaptureError("no run command found for this web project")
    phone, desktop = rows_for(story)
    port = _port()
    env = {"PORT": str(port), "HOST": "127.0.0.1", "BROWSER": "none", "NODE_ENV": "development"}
    if venv_bin:
        env["PATH"] = venv_bin + os.pathsep + os.environ.get("PATH", "")
    spec = {
        "name": "web",
        "cwd": step.cwd,
        "command": step.command.replace("$PORT", str(port)),
        "env": env,
    }
    for s in story.get("servers") or []:
        spec_extra = dict(s)
        if spec_extra.get("name") == "web":
            spec.update(spec_extra)
    srv = Server(spec, ws, ws.logs, allowed_domains=["registry.npmjs.org"], sandbox=sandbox)
    servers = [srv]
    try:
        srv.start(timeout=0)
        actual = _found_port(srv.log, port)
        base = f"http://127.0.0.1:{actual}"
        srv.wait(base + "/", timeout=float(spec.get("timeout", 180)))
        py = tools.playwright_python()
        tools.ensure_chromium(py)
        job = {
            "base": base,
            "viewport": viewport_of(phone),
            "scale": phone["native_scale"],
            "color_scheme": (story.get("device") or {}).get("appearance"),
            "video_dir": str(run_dir / "video"),
            "run_dir": str(run_dir),
            "block_hosts": list(BLOCK_HOSTS),
            "beats": [b for b in story["beats"] if b["video"]],
            "stills": [{"label": b["label"], "actions": b["actions"], "settle": b["settle"], "expect": b.get("expect"), "viewport": b.get("viewport"), "optional": b.get("optional")} for b in story["beats"] if not b["video"]] + story["stills"],
            "desktop": {"viewport": viewport_of(desktop), "scale": desktop["native_scale"], "video_dir": str(run_dir / "desktop-video")} if desktop else None,
        }
        jp, rp = run_dir / "web-job.json", run_dir / "web-result.json"
        jp.write_text(json.dumps(job))
        (run_dir / "drive_web.py").write_text(DRIVER)
        r = subprocess.run([str(py), str(run_dir / "drive_web.py"), str(jp), str(rp)], capture_output=True, text=True, timeout=2400, check=False)
        if r.returncode != 0:
            raise CaptureError(f"the browser pass failed: {r.stderr.strip()[-600:]}")
        res = json.loads(rp.read_text())
    except ServerError as e:
        raise CaptureError(str(e)) from e
    finally:
        for s in servers:
            s.stop()
    checked, left_out = _verify(res.get("checks") or [])
    stills = [Still(pathlib.Path(s["path"]), s["label"], own_size=bool(s.get("own_size"))) for s in res["stills"] if s["path"] not in left_out]
    beats = [BeatWindow(b["label"], b["caption"], b["start"], b["end"], tap=_tap(b.get("tap"))) for b in res["beats"]]
    notes = [
        f"the dev server ran from the clone ({srv.how}) on {base}",
        f"requests to {len(BLOCK_HOSTS)} analytics hosts were aborted",
        f"filmed as a {phone['name']} ({phone['points'][0]}x{phone['points'][1]} points at {phone['scale']:g}x)",
    ]
    notes.extend(res.get("notes") or [])
    notes.extend(checked)
    cap = Capture(stills=stills, video=pathlib.Path(res["video"]) if res.get("video") else None, beats=beats, notes=notes, device=phone["id"])
    cap.desktop = _desktop(res.get("desktop"), desktop, notes)
    return cap


def _tap(v) -> tuple[float, float] | None:
    return (float(v[0]), float(v[1])) if isinstance(v, list) and len(v) == 2 else None


def _desktop(d: dict | None, row: dict | None, notes: list[str]) -> Capture | None:
    """The desktop pass, held to its storyboard like the phone's, or None with a note: a desktop
    pass that does not show what the beats expect is left out, never the reason a demo fails."""
    if not d or row is None:
        return None
    try:
        checked, left_out = _verify(d.get("checks") or [])
    except CaptureError as e:
        notes.append(f"the desktop pass is left out: {e}")
        return None
    stills = [Still(pathlib.Path(s["path"]), s["label"]) for s in d["stills"] if s["path"] not in left_out]
    beats = [BeatWindow(b["label"], b["caption"], b["start"], b["end"], tap=_tap(b.get("tap"))) for b in d["beats"]]
    notes.append(f"a desktop pass in a {row['name']} ({row['points'][0]}x{row['points'][1]} points): {len(stills)} stills" + (", a video" if d.get("video") else ""))
    notes.extend(f"desktop: {n}" for n in (d.get("notes") or []))
    notes.extend(f"desktop: {n}" for n in checked)
    return Capture(stills=stills, video=pathlib.Path(d["video"]) if d.get("video") else None, beats=beats, device=row["id"])


if __name__ == "__main__":  # pragma: no cover
    sys.exit(0)
