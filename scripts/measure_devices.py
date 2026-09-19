#!/usr/bin/env python3
"""Measure every screen in spec/devices.v1.json on the simulators this Mac has, from iOS itself.

WHY THIS EXISTS. The demo kit draws a phone around a recording and checks every capture against
a frame size, so a wrong number in the device table is a demo with an elongated phone in it (the
flaw the owner found in another tool), and a table typed from memory is exactly how that happens.
So the numbers are not typed: a forty line UIKit app is compiled for the simulator, launched on a
fresh device of each type, and prints what iOS says about its own screen:

    UIScreen.bounds / scale / nativeBounds      the points, the scale and the pixels
    view.safeAreaInsets (portrait, full screen)  the status bar or island above, the home bar below
    UIScreen._displayCornerRadius               the screen's own corner radius, the value UIKit
                                                 rounds a full screen sheet with (private KVC; a
                                                 device without rounded corners answers 0)

and the device type's own `profile.plist` (mainScreenWidth, mainScreenHeight, mainScreenScale) is
read beside it. The output is `docs/research/device-measurements.json`, which
`scripts/gen_devices.py --verify` holds the spec to.

Each device is created under a name of its own ("Builda Measure <type>"), booted headless, used
once and deleted: a booted simulator somebody else is using is never touched (the same rule as
capture/demo/simulator.py), and the devices run ONE AT A TIME, because two simulators at once is
how the demo pipeline once ran this Mac out of memory.

    python3 scripts/measure_devices.py                 every device type the spec names
    python3 scripts/measure_devices.py --only iphone-17-pro,ipad-air-11
    python3 scripts/measure_devices.py --dry-run       what it would boot, and nothing else
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
SPEC = ROOT / "spec" / "devices.v1.json"
OUT = ROOT / "docs" / "research" / "device-measurements.json"
BUNDLE_ID = "dev.builda.measure"
MARK = "BUILDA-MEASURE "

APP_SOURCE = r'''
import UIKit

final class Probe: UIViewController {
  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    guard let window = view.window else { return }
    let s = window.screen
    let i = view.safeAreaInsets
    var radius = -1.0
    if let r = s.value(forKey: "_displayCornerRadius") as? CGFloat { radius = Double(r) }
    let out: [String: Any] = [
      "points": [Double(s.bounds.width), Double(s.bounds.height)],
      "window": [Double(window.bounds.width), Double(window.bounds.height)],
      "scale": Double(s.scale),
      "native_scale": Double(s.nativeScale),
      "native_pixels": [Double(s.nativeBounds.width), Double(s.nativeBounds.height)],
      "safe_top": Double(i.top), "safe_bottom": Double(i.bottom),
      "safe_left": Double(i.left), "safe_right": Double(i.right),
      "corner_radius": radius,
      "system": UIDevice.current.systemVersion,
    ]
    let data = try! JSONSerialization.data(withJSONObject: out, options: [.sortedKeys])
    print("BUILDA-MEASURE " + String(data: data, encoding: .utf8)!)
    fflush(stdout)
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { exit(0) }
  }
}

final class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    window = UIWindow(frame: UIScreen.main.bounds)
    window!.rootViewController = Probe()
    window!.makeKeyAndVisible()
    return true
  }
}

UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(AppDelegate.self))
'''

INFO = {
    "CFBundleIdentifier": BUNDLE_ID,
    "CFBundleExecutable": "Measure",
    "CFBundleName": "Measure",
    "CFBundlePackageType": "APPL",
    "CFBundleVersion": "1",
    "CFBundleShortVersionString": "1.0",
    "MinimumOSVersion": "17.0",
    "UIDeviceFamily": [1, 2],
    # Without a launch screen iOS runs an app in its legacy letterboxed size, and every number
    # this prints would be the compatibility mode's, not the screen's.
    "UILaunchScreen": {},
    "UIRequiresFullScreen": True,
    "UISupportedInterfaceOrientations": ["UIInterfaceOrientationPortrait"],
    "UISupportedInterfaceOrientations~ipad": ["UIInterfaceOrientationPortrait"],
    "CFBundleSupportedPlatforms": ["iPhoneSimulator"],
}


def sh(args: list[str], timeout: int = 600, check: bool = True) -> subprocess.CompletedProcess:
    r = subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)
    if check and r.returncode != 0:
        raise SystemExit(f"{' '.join(args[:4])} failed: {(r.stderr or r.stdout).strip()[:400]}")
    return r


def build_app(work: pathlib.Path) -> pathlib.Path:
    app = work / "Measure.app"
    app.mkdir(parents=True, exist_ok=True)
    src = work / "main.swift"
    src.write_text(APP_SOURCE)
    sdk = sh(["xcrun", "--sdk", "iphonesimulator", "--show-sdk-path"]).stdout.strip()
    arch = "arm64" if sh(["uname", "-m"]).stdout.strip() == "arm64" else "x86_64"
    sh(["xcrun", "--sdk", "iphonesimulator", "swiftc", "-target", f"{arch}-apple-ios17.0-simulator",
        "-sdk", sdk, "-O", str(src), "-o", str(app / "Measure")])  # fmt: skip
    (app / "Info.plist").write_bytes(plistlib.dumps(INFO))
    sh(["codesign", "--force", "--sign", "-", str(app)])
    return app


def runtimes() -> list[dict]:
    """Installed iOS runtimes, newest first."""
    data = json.loads(sh(["xcrun", "simctl", "list", "runtimes", "-j"]).stdout)
    ios = [r for r in data.get("runtimes", []) if r.get("isAvailable") and "iOS" in r.get("identifier", "")]
    ios.sort(key=lambda r: tuple(int(x) for x in re.findall(r"\d+", r.get("version", "0"))), reverse=True)
    return ios


def runtime_for(type_id: str, installed: list[dict]) -> str | None:
    """The newest installed runtime that boots this device type: iOS 26 dropped the iPhone XS,
    so its row is measured on the newest one that still has it (18.2 here)."""
    for r in installed:
        if any(t.get("identifier") == type_id for t in r.get("supportedDeviceTypes") or []):
            return r["identifier"]
    return None


def profile_of(type_id: str) -> dict | None:
    data = json.loads(sh(["xcrun", "simctl", "list", "devicetypes", "-j"]).stdout)
    for t in data["devicetypes"]:
        if t["identifier"] == type_id:
            p = plistlib.loads((pathlib.Path(t["bundlePath"]) / "Contents" / "Resources" / "profile.plist").read_bytes())
            return {
                "name": t["name"],
                "model": t.get("modelIdentifier"),
                "pixels": [int(p["mainScreenWidth"]), int(p["mainScreenHeight"])],
                "scale": float(p["mainScreenScale"]),
            }
    return None


def measure_one(app: pathlib.Path, type_id: str, runtime: str) -> dict:
    name = f"Builda Measure {type_id.rsplit('.', 1)[-1]}"
    udid = sh(["xcrun", "simctl", "create", name, type_id, runtime]).stdout.strip()
    try:
        sh(["xcrun", "simctl", "boot", udid], timeout=300)
        sh(["xcrun", "simctl", "bootstatus", udid, "-b"], timeout=900)
        sh(["xcrun", "simctl", "install", udid, str(app)])
        got = None
        for _ in range(3):
            r = sh(["xcrun", "simctl", "launch", "--console", "--terminate-running-process", udid, BUNDLE_ID], timeout=120, check=False)
            line = next((ln for ln in (r.stdout or "").splitlines() if ln.startswith(MARK)), None)
            if line:
                got = json.loads(line[len(MARK):])
                break
            time.sleep(3)
        if got is None:
            raise SystemExit(f"{name}: the probe printed nothing")
        return got
    finally:
        sh(["xcrun", "simctl", "shutdown", udid], check=False, timeout=120)
        sh(["xcrun", "simctl", "delete", udid], check=False, timeout=120)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--only", help="comma separated device ids from the spec")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    spec = json.loads(SPEC.read_text())
    want = set(a.only.split(",")) if a.only else None
    # One probe per simulator device type the spec names; several spec rows can share one.
    types: dict[str, list[str]] = {}
    for d in spec["devices"]:
        if want and d["id"] not in want:
            continue
        for t in d.get("simulator_types") or []:
            types.setdefault(t, []).append(d["id"])
    installed = runtimes()
    if a.dry_run:
        for t, ids in types.items():
            print(f"  {t}  ({', '.join(ids)}) on {runtime_for(t, installed)}")
        return 0
    prev = json.loads(OUT.read_text()) if OUT.exists() else {"devices": {}}
    work = pathlib.Path(tempfile.mkdtemp(prefix="builda-measure-"))
    try:
        app = build_app(work)
        for t, ids in types.items():
            prof = profile_of(t)
            runtime = runtime_for(t, installed)
            if prof is None or runtime is None:
                print(f"{t}: not installed on this Mac", file=sys.stderr)
                prev["devices"][t] = {"installed": False}
                continue
            t0 = time.monotonic()
            got = measure_one(app, t, runtime)
            prev["devices"][t] = {"installed": True, "profile": prof, "ios": got, "runtime": runtime}
            print(f"{prof['name']:<30} {got['points']} @{got['scale']:g}  safe {got['safe_top']:g}/{got['safe_bottom']:g}  "
                  f"radius {got['corner_radius']:g}  ({time.monotonic() - t0:.0f} s)", file=sys.stderr, flush=True)
            prev["measured_at"] = dt.date.today().isoformat()
            OUT.parent.mkdir(parents=True, exist_ok=True)
            OUT.write_text(json.dumps(prev, indent=1, sort_keys=True) + "\n")
    finally:
        shutil.rmtree(work, ignore_errors=True)
    print(f"wrote {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
