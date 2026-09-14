"""`web`: the dev server in the clone, then Playwright over its routes.

The server is the plan's run step (the transcript's command, the package.json script, or
Railpack's rule), started under the allowlisted environment with `PORT` set, inside the sandbox
runtime when it is installed, and waited on until its page answers (`servers.Server`). A server
that picks its own port (Vite's 5173, Next's 3000) is found from what it prints.

The driver is a Python script run with the Playwright venv's interpreter (`tools.playwright_python`),
so capture itself still imports nothing outside the standard library. It records one pass through
the beats in a phone sized viewport (so the video is portrait like every other demo), takes a
still of each beat once the page has SETTLED: the network idle, `document.fonts.ready`, every
image decoded, two animation frames, and two screenshots in a row identical (OpenVidStudio's
settle rules, docs/research/demo-capture.md section 3). Requests to analytics hosts are aborted
with `page.route` (section 4, "Phoning home").
"""

from __future__ import annotations

import json
import pathlib
import re
import subprocess
import sys
import time

from . import tools
from .detect import Plan
from .result import BeatWindow, Capture, CaptureError, Still
from .servers import Server, ServerError, port_free
from .workspace import Workspace

#: Hosts a demo's browser never reaches: analytics, session replay and crash reporting.
BLOCK_HOSTS = (
    "posthog.com", "i.posthog.com", "google-analytics.com", "googletagmanager.com", "segment.io",
    "segment.com", "sentry.io", "mixpanel.com", "amplitude.com", "plausible.io", "hotjar.com",
    "clarity.ms", "fullstory.com", "datadoghq.com", "logrocket.io", "heapanalytics.com",
    "vercel-insights.com", "va.vercel-scripts.com",
)  # fmt: skip
VIEWPORT = {"width": 402, "height": 874}
SCALE = 3

_URL_IN_LOG = re.compile(r"https?://(?:localhost|127\.0\.0\.1|\[::1\]):(\d{2,5})")

DRIVER = r'''
import json, sys, time, hashlib
from playwright.sync_api import sync_playwright

job = json.load(open(sys.argv[1]))
out = {"beats": [], "stills": [], "notes": []}
block = tuple(job["block_hosts"])

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

def act(page, a):
    (k, v), = a.items()
    if k == "open":
        page.goto(v if "://" in v else job["base"] + v, wait_until="domcontentloaded")
    elif k == "wait":
        time.sleep(float(v))
    elif k == "settle":
        settle(page, float(v))
    elif k == "tap":
        if isinstance(v, str):
            page.get_by_text(v, exact=False).first.click()
        elif "id" in v:
            page.locator("#" + v["id"]).first.click()
        elif "text" in v:
            loc = page.get_by_text(v["text"], exact=False).first
            if v.get("optional") and loc.count() == 0:
                return
            loc.click()
        elif "point" in v:
            x, y = [float(p.strip().rstrip("%")) / 100 for p in v["point"].split(",")]
            page.mouse.click(x * job["viewport"]["width"], y * job["viewport"]["height"])
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

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(
        viewport=job["viewport"], device_scale_factor=job["scale"], is_mobile=True, has_touch=True,
        color_scheme=job.get("color_scheme") or "light",
        record_video_dir=job["video_dir"],
        record_video_size={"width": job["viewport"]["width"] * 2, "height": job["viewport"]["height"] * 2},
    )
    t0 = time.monotonic()
    ctx.route("**/*", lambda route: route.abort() if blocked(route.request.url) else route.continue_())
    page = ctx.new_page()
    n = 0
    last = None
    for b in job["beats"]:
        start = time.monotonic() - t0
        for a in b["actions"]:
            act(page, a)
        shot = settle(page, b["settle"])
        if last is not None and shot == last and b["actions"]:
            # The page did not change: act once more, then keep what it shows (the run's
            # manifest step still refuses the same picture twice).
            out["notes"].append("re-shot " + b["label"] + ": the page did not change")
            for a in b["actions"]:
                act(page, a)
            shot = settle(page, b["settle"])
        last = shot
        if b.get("film") == "settled":
            start = time.monotonic() - t0
        if b["still"]:
            n += 1
            path = f"{job['run_dir']}/still-{n:02d}.png"
            open(path, "wb").write(shot)
            out["stills"].append({"path": path, "label": b["label"]})
        time.sleep(b["hold"])
        out["beats"].append({"label": b["label"], "caption": b["caption"], "start": start, "end": time.monotonic() - t0})
    video = page.video.path() if page.video else None
    ctx.close()
    out["video"] = str(video) if video else None
    ctx2 = browser.new_context(viewport=job["viewport"], device_scale_factor=job["scale"], is_mobile=True, has_touch=True)
    ctx2.route("**/*", lambda route: route.abort() if blocked(route.request.url) else route.continue_())
    page = ctx2.new_page()
    for s in job["stills"]:
        for a in s["actions"]:
            act(page, a)
        n += 1
        path = f"{job['run_dir']}/still-{n:02d}.png"
        open(path, "wb").write(settle(page, s["settle"]))
        out["stills"].append({"path": path, "label": s["label"]})
    ctx2.close()
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


def run(plan: Plan, ws: Workspace, story: dict, run_dir: pathlib.Path) -> Capture:
    install = plan.step("install")
    if install is not None:
        inst = Server({"name": "install", "cwd": install.cwd, "command": "true", "install": install.command}, ws, ws.logs)
        try:
            inst.prepare()
        except ServerError as e:
            raise CaptureError(f"installing dependencies failed: {e}") from e
    step = plan.step("run")
    if step is None:
        raise CaptureError("no run command found for this web project")
    port = _port()
    spec = {
        "name": "web",
        "cwd": step.cwd,
        "command": step.command.replace("$PORT", str(port)),
        "env": {"PORT": str(port), "HOST": "127.0.0.1", "BROWSER": "none", "NODE_ENV": "development"},
    }
    for s in story.get("servers") or []:
        spec_extra = dict(s)
        if spec_extra.get("name") == "web":
            spec.update(spec_extra)
    srv = Server(spec, ws, ws.logs, allowed_domains=["registry.npmjs.org"])
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
            "viewport": story.get("viewport") or VIEWPORT,
            "scale": SCALE,
            "color_scheme": (story.get("device") or {}).get("appearance"),
            "video_dir": str(run_dir / "video"),
            "run_dir": str(run_dir),
            "block_hosts": list(BLOCK_HOSTS),
            "beats": [b for b in story["beats"] if b["video"]],
            "stills": [{"label": b["label"], "actions": b["actions"], "settle": b["settle"]} for b in story["beats"] if not b["video"]] + story["stills"],
        }
        jp, rp = run_dir / "web-job.json", run_dir / "web-result.json"
        jp.write_text(json.dumps(job))
        (run_dir / "drive_web.py").write_text(DRIVER)
        r = subprocess.run([str(py), str(run_dir / "drive_web.py"), str(jp), str(rp)], capture_output=True, text=True, timeout=1800, check=False)
        if r.returncode != 0:
            raise CaptureError(f"the browser pass failed: {r.stderr.strip()[-600:]}")
        res = json.loads(rp.read_text())
    except ServerError as e:
        raise CaptureError(str(e)) from e
    finally:
        for s in servers:
            s.stop()
    stills = [Still(pathlib.Path(s["path"]), s["label"]) for s in res["stills"]]
    beats = [BeatWindow(b["label"], b["caption"], b["start"], b["end"]) for b in res["beats"]]
    notes = [f"the dev server ran from the clone ({srv.how}) on {base}", f"requests to {len(BLOCK_HOSTS)} analytics hosts were aborted"]
    notes.extend(res.get("notes") or [])
    return Capture(stills=stills, video=pathlib.Path(res["video"]) if res.get("video") else None, beats=beats, notes=notes)


if __name__ == "__main__":  # pragma: no cover
    sys.exit(0)
