"""The iOS Simulator, driven from the command line: `xcrun simctl` for everything a deep link
can reach, Maestro for the taps it cannot.

A demo runs on a simulator of its OWN, booted headless (`simctl boot` never opens a Simulator
window). A device that is already booted when the run starts is somebody's: a person, or an
agent, is looking at it, and a run that installed an app, overrode its status bar and filmed it
would be doing that to them. So a booted device is refused unless this run booted it, and the
default is a device named "Builda Demos" that the run creates when it does not exist.

What the capture needs from the device, each a `simctl` verb:

    status_bar override   9:41, full battery, full bars: a demo that shows the clock it was
                          filmed at dates itself, and every still differs from the last
    privacy grant         no permission sheet in the middle of a beat
    location set          a map app shows the place it is for (RideGT: the Georgia Tech campus)
    openurl               a deep link per beat (Expo Router makes every screen one)
    io screenshot         a still, taken once two screenshots in a row are identical
    io recordVideo        the pass, H.264 (`--codec h264`; the default is HEVC), ended with
                          SIGINT so the file is finalised (OpenVidStudio's native.ts does the same)
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
import os
import pathlib
import re
import signal
import subprocess
import threading
import time

from . import devices as table
from . import paths

DEFAULT_NAME = "Builda Demos"
MAESTRO = pathlib.Path("~/.maestro/bin/maestro").expanduser()

#: The status bar every still shows (Apple's own marketing time).
STATUS_BAR = (
    "--time", "9:41", "--dataNetwork", "wifi", "--wifiMode", "active", "--wifiBars", "3",
    "--cellularMode", "active", "--cellularBars", "4", "--batteryState", "discharging",
    "--batteryLevel", "100",
)  # fmt: skip

#: The environment Maestro runs under: its analytics off (docs/research/demo-capture.md,
#: "Phoning home": Maestro reports usage unless told not to).
MAESTRO_ENV = {
    "MAESTRO_CLI_NO_ANALYTICS": "1",
    "MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED": "true",
    "MAESTRO_DISABLE_UPDATE_CHECK": "true",
}


class SimulatorError(Exception):
    pass


@dataclasses.dataclass(frozen=True)
class Device:
    udid: str
    name: str
    state: str
    runtime: str
    #: `com.apple.CoreSimulator.SimDeviceType.<model>`: which row of the device table it is.
    type_id: str = ""


def _simctl(args: list[str], timeout: int = 120, check: bool = True) -> subprocess.CompletedProcess:
    r = subprocess.run(["xcrun", "simctl", *args], capture_output=True, text=True, timeout=timeout, check=False)
    if check and r.returncode != 0:
        raise SimulatorError(f"simctl {' '.join(args[:2])} failed: {(r.stderr or r.stdout).strip()[:400]}")
    return r


def devices() -> list[Device]:
    data = json.loads(_simctl(["list", "devices", "-j"]).stdout)
    out = []
    for runtime, devs in (data.get("devices") or {}).items():
        for d in devs:
            if d.get("isAvailable", True):
                out.append(Device(d["udid"], d["name"], d["state"], runtime, d.get("deviceTypeIdentifier", "")))
    return out


def latest_ios_runtime() -> str:
    data = json.loads(_simctl(["list", "runtimes", "-j"]).stdout)
    ios = [r for r in data.get("runtimes", []) if r.get("isAvailable") and r.get("platform", "iOS") == "iOS" and "iOS" in r.get("identifier", "")]
    if not ios:
        raise SimulatorError("no iOS simulator runtime is installed (Xcode > Settings > Components)")
    ios.sort(key=lambda r: tuple(int(x) for x in re.findall(r"\d+", r.get("version", "0"))))
    return ios[-1]["identifier"]


def _marker(udid: str) -> pathlib.Path:
    return paths.demos_dir() / "work" / "booted" / udid


def name_for(row: dict) -> str:
    """The tool's own device for a row of the device table: "Builda Demos" for the default phone,
    "Builda Demos <row name>" for any other, so a project filmed on an iPhone Air never borrows
    the default device and comes out at the default's size."""
    return DEFAULT_NAME if row["id"] == table.default_phone()["id"] else f"{DEFAULT_NAME} {row['name']}"


def resolve(which: str | None, row: dict | None = None, type_id: str | None = None) -> Device:
    """The device to film on: a UDID or a name (`--sim`), else the tool's own device for `row`
    (the device table's default phone when none is given), created on `type_id` (or the row's
    first simulator type) when it is missing. A device of the tool's own name whose type is
    another row is not used: its screen would be the wrong size for the row the run checks."""
    devs = devices()
    if which:
        match = [d for d in devs if d.udid == which] or [d for d in devs if d.name == which]
        if not match:
            if re.fullmatch(r"[0-9A-Fa-f-]{36}", which):
                raise SimulatorError(f"no simulator with UDID {which}")
            raise SimulatorError(f"no simulator named {which!r}")
        return match[0]
    row = row or table.default_phone()
    want = name_for(row)
    ours = [d for d in devs if d.name == want and table.for_simulator_type(d.type_id) is row]
    if ours:
        return ours[0]
    ty = type_id or (row["simulator_types"][0] if row["simulator_types"] else None)
    if not ty:
        raise SimulatorError(table.refusal("no_simulator_type", device=row["name"], types="none listed"))
    if any(d.name == want for d in devs):
        want = f"{want} {ty.rsplit('.', 1)[-1]}"
    udid = _simctl(["create", want, ty, latest_ios_runtime()]).stdout.strip()
    return Device(udid, want, "Shutdown", "", ty)


def claim(dev: Device) -> None:
    """Refuse a device somebody else booted. A device this tool booted carries a marker."""
    if dev.state == "Booted" and not _marker(dev.udid).exists():
        raise SimulatorError(
            f"{dev.name} ({dev.udid}) is already booted, so somebody is using it; a demo runs on "
            f"a device of its own. Shut it down first, or pass --sim with another device "
            f"(the default, {DEFAULT_NAME!r}, is created when it does not exist)"
        )


def boot(dev: Device) -> None:
    """Boot headless and wait until it is up. Never opens Simulator.app."""
    claim(dev)
    if dev.state != "Booted":
        _simctl(["boot", dev.udid], timeout=300)
        m = _marker(dev.udid)
        paths.private_dir(m.parent)
        m.write_text(str(time.time()))
    _simctl(["bootstatus", dev.udid, "-b"], timeout=600)


def shutdown(dev: Device) -> None:
    """Shut down a device this tool booted. The marker goes only once the device is down: a
    marker removed from a device still booted turns the tool's own device into "somebody's"."""
    if not _marker(dev.udid).exists():
        return
    _simctl(["shutdown", dev.udid], timeout=120, check=False)
    state = next((d.state for d in devices() if d.udid == dev.udid), "Shutdown")
    if state == "Shutdown":
        _marker(dev.udid).unlink(missing_ok=True)


def status_bar(udid: str) -> None:
    _simctl(["status_bar", udid, "override", *STATUS_BAR])


def mark_start(udid: str) -> float:
    """Make the screen change NOW, so the recording's first frame is now. Returns when.

    FOUND ON THE FIFTH BUILDA RUN: `simctl io recordVideo` writes its first frame when the screen
    first CHANGES, and its video time starts there, not at "Recording started". A run that began
    on a still screen had its zero 11 s late, and every beat's window showed what came 11 s after
    it: the Now beat's poster was the next beat's session page, with a repository name on it.
    RideGT's map never stops moving, which is why its runs lined up. The clock flips to 9:42 for
    a quarter of a second, before any beat's window opens, and back."""
    _simctl(["status_bar", udid, "override", "--time", "9:42"])
    at = time.monotonic()
    time.sleep(0.25)
    status_bar(udid)
    time.sleep(0.5)
    return at


def clear_status_bar(udid: str) -> None:
    _simctl(["status_bar", udid, "clear"], check=False)


def appearance(udid: str, mode: str) -> None:
    if mode in ("light", "dark"):
        _simctl(["ui", udid, "appearance", mode], check=False)


def privacy(udid: str, service: str, bundle_id: str, action: str = "grant") -> None:
    _simctl(["privacy", udid, action, service, bundle_id])


def location(udid: str, lat: float, lng: float) -> None:
    _simctl(["location", udid, "set", f"{lat},{lng}"])


def install(udid: str, app: pathlib.Path) -> None:
    _simctl(["install", udid, str(app)], timeout=600)


def uninstall(udid: str, bundle_id: str) -> None:
    _simctl(["uninstall", udid, bundle_id], timeout=120, check=False)


def launch(udid: str, bundle_id: str, args: list[str] | None = None) -> None:
    _simctl(["launch", "--terminate-running-process", udid, bundle_id, *(args or [])], timeout=120)


def terminate(udid: str, bundle_id: str) -> None:
    _simctl(["terminate", udid, bundle_id], check=False)


def openurl(udid: str, url: str) -> None:
    _simctl(["openurl", udid, url], timeout=60)


def screenshot(udid: str, path: pathlib.Path) -> pathlib.Path:
    _simctl(["io", udid, "screenshot", "--type=png", str(path)], timeout=60)
    return path


def settle(udid: str, path: pathlib.Path, timeout: float = 8.0, interval: float = 0.6, min_wait: float = 0.8) -> tuple[pathlib.Path, bool]:
    """Screenshot until two in a row are identical, then keep that one. Returns (path, settled).

    With the status bar pinned to 9:41 an idle screen is byte for byte the same PNG twice, so
    identity is the settle test; a screen still animating when `timeout` runs out is kept as it
    is and reported unsettled rather than waited on forever."""
    time.sleep(min_wait)
    prev = None
    deadline = time.monotonic() + timeout
    tmp = path.with_suffix(".settle.png")
    while True:
        screenshot(udid, tmp)
        digest = hashlib.sha256(tmp.read_bytes()).hexdigest()
        if digest == prev:
            os.replace(tmp, path)
            return path, True
        prev = digest
        if time.monotonic() > deadline:
            os.replace(tmp, path)
            return path, False
        time.sleep(interval)


class Recorder:
    """`simctl io recordVideo --codec h264`, started and stopped around the pass."""

    def __init__(self, udid: str, path: pathlib.Path):
        self.udid = udid
        self.path = path
        self.proc: subprocess.Popen | None = None
        self.started_at: float | None = None
        self._err: list[str] = []

    def start(self, timeout: float = 20.0) -> float:
        self.proc = subprocess.Popen(
            ["xcrun", "simctl", "io", self.udid, "recordVideo", "--codec=h264", "--force", str(self.path)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        ready = threading.Event()

        def read() -> None:
            assert self.proc and self.proc.stderr
            for line in self.proc.stderr:
                self._err.append(line)
                if "Recording started" in line:
                    self.started_at = time.monotonic()
                    ready.set()

        threading.Thread(target=read, daemon=True).start()
        if not ready.wait(timeout):
            # Older simctl says nothing; the file appearing is the next best signal.
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline and not self.path.exists():
                time.sleep(0.1)
            self.started_at = time.monotonic()
        return self.started_at

    def abort(self) -> None:
        """Stop a recording that is still going (an interrupted run), without judging the file."""
        if self.proc is not None and self.proc.poll() is None:
            self.proc.send_signal(signal.SIGINT)
            try:
                self.proc.wait(15)
            except subprocess.TimeoutExpired:
                self.proc.kill()

    def stop(self, timeout: float = 30.0) -> pathlib.Path:
        if self.proc is None:
            raise SimulatorError("recording was never started")
        self.proc.send_signal(signal.SIGINT)
        try:
            self.proc.wait(timeout)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            raise SimulatorError("recordVideo did not finish writing within 30 s") from None
        if not self.path.exists() or self.path.stat().st_size == 0:
            raise SimulatorError(f"recordVideo wrote nothing: {''.join(self._err)[-300:]}")
        return self.path


# ----------------------------------------------------------------------------- Maestro


def _yaml_scalar(v) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    return json.dumps(str(v))  # a JSON string is a valid YAML double quoted scalar


def _yaml(node, indent: int = 0) -> list[str]:
    pad = "  " * indent
    out: list[str] = []
    if isinstance(node, dict):
        for k, v in node.items():
            if isinstance(v, (dict, list)) and v:
                out.append(f"{pad}{k}:")
                out.extend(_yaml(v, indent + 1))
            else:
                out.append(f"{pad}{k}: {_yaml_scalar(v) if not isinstance(v, (dict, list)) else ('{}' if isinstance(v, dict) else '[]')}")
    elif isinstance(node, list):
        for item in node:
            if isinstance(item, dict) and item:
                sub = _yaml(item, indent + 1)
                out.append(f"{pad}- {sub[0].strip()}")
                out.extend(sub[1:])
            elif isinstance(item, str) and not item.startswith(("-", "{", "[")):
                out.append(f"{pad}- {item}" if re.fullmatch(r"[A-Za-z]+", item) else f"{pad}- {_yaml_scalar(item)}")
            else:
                out.append(f"{pad}- {_yaml_scalar(item)}")
    return out


def maestro_flow(app_id: str, commands: list) -> str:
    """A Maestro flow file: the app id header, then the commands (a list of Maestro command
    mappings, or bare command names like `back`)."""
    return "\n".join([f"appId: {app_id}", "---", *_yaml(commands)]) + "\n"


def run_maestro(udid: str, flow: pathlib.Path, log: pathlib.Path, timeout: int = 300) -> bool:
    if not MAESTRO.exists():
        raise SimulatorError(f"Maestro is not installed at {MAESTRO} (curl -Ls https://get.maestro.mobile.dev | bash)")
    from .workspace import clean_env

    env = clean_env({**MAESTRO_ENV, "JAVA_HOME": os.environ.get("JAVA_HOME", "")})
    if not env.get("JAVA_HOME"):
        env.pop("JAVA_HOME", None)
    with log.open("a") as f:
        f.write(f"\n== maestro {flow.name}\n")
        f.flush()
        r = subprocess.run(
            [str(MAESTRO), "--device", udid, "test", "--no-ansi", str(flow)],
            stdout=f,
            stderr=subprocess.STDOUT,
            timeout=timeout,
            check=False,
            env=env,
        )
    return r.returncode == 0
