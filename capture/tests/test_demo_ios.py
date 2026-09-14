"""python3 -m unittest capture.tests.test_demo_ios

The iOS driver's file work, without a simulator: which built app is found, what an `.app` says
about itself, the pin that keeps a debug app away from another project's Metro, AsyncStorage
seeded into a data container, development toasts off in the clone (never the checkout), and
the workspace name a prebuild wrote.
"""

from __future__ import annotations

import json
import pathlib
import plistlib
import tempfile
import unittest

from capture.demo import ios


class Apps(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = pathlib.Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def app(self, name="Widget", debug=True, bundle=False, api="http://127.0.0.1:8787") -> pathlib.Path:
        a = self.base / "build" / "Build" / "Products" / "Debug-iphonesimulator" / f"{name}.app"
        (a / "EXConstants.bundle").mkdir(parents=True)
        with (a / "Info.plist").open("wb") as f:
            plistlib.dump({"CFBundleIdentifier": "com.acme.widget", "CFBundleName": name}, f)
        (a / "EXConstants.bundle" / "app.config").write_text(json.dumps({"extra": {"apiBaseUrl": api}}))
        if debug:
            (a / f"{name}.debug.dylib").write_bytes(b"\0")
        if bundle:
            (a / "main.jsbundle").write_bytes(b"\0")
        return a

    def test_the_built_app_is_found_and_read(self):
        a = self.app()
        self.assertEqual(ios.find_app(self.base / "build", "Debug"), a)
        self.assertIsNone(ios.find_app(self.base / "build", "Release"))
        self.assertEqual(
            ios.app_info(a),
            {"bundle_id": "com.acme.widget", "name": "Widget", "embedded_js": False, "debug": True, "api_base": "http://127.0.0.1:8787"},
        )

    def test_a_debug_app_is_pinned(self):
        a = self.app()
        ios.pin_packager(a)
        self.assertEqual((a / "ip.txt").read_text(), ios.NO_PACKAGER)

    def test_async_storage_is_merged_into_the_manifest(self):
        container = self.base / "data"
        path = ios.write_async_storage(container, "com.acme.widget", {"@terms": "true", "@meta": {"slug": "gatech"}})
        self.assertEqual(path, container / "Library/Application Support/com.acme.widget/RCTAsyncLocalStorage_V1/manifest.json")
        ios.write_async_storage(container, "com.acme.widget", {"@replay": "1"})
        self.assertEqual(json.loads(path.read_text()), {"@terms": "true", "@meta": '{"slug": "gatech"}', "@replay": "1"})
        from capture.demo.result import CaptureError

        with self.assertRaises(CaptureError):
            ios.write_async_storage(container, "com.acme.widget", {"@big": "x" * 2000})

    def test_quiet_logs_prepends_one_import_to_a_file_entry(self):
        d = self.base / "mobile"
        d.mkdir()
        (d / "package.json").write_text(json.dumps({"main": "index.js"}))
        (d / "index.js").write_text("import App from './App';\n")
        said = ios.quiet_logs(d)
        self.assertTrue((d / "index.js").read_text().startswith("import './demo-quiet-logs';\nimport App"))
        self.assertIn("LogBox.ignoreAllLogs(true)", (d / ios.QUIET_LOGS).read_text())
        ios.quiet_logs(d)  # idempotent: one import, however many runs
        self.assertEqual((d / "index.js").read_text().count("demo-quiet-logs"), 1)
        self.assertIn("the checkout is untouched", said)

    def test_quiet_logs_wraps_a_package_entry(self):
        d = self.base / "app"
        d.mkdir()
        (d / "package.json").write_text(json.dumps({"main": "expo-router/entry", "name": "x"}))
        ios.quiet_logs(d)
        self.assertEqual(json.loads((d / "package.json").read_text())["main"], "./demo-entry.js")
        self.assertEqual((d / "demo-entry.js").read_text(), "import './demo-quiet-logs';\nimport 'expo-router/entry';\n")

    def test_the_workspace_prebuild_wrote_is_used(self):
        ios_dir = self.base / "ios"
        (ios_dir / "RideAlong.xcworkspace").mkdir(parents=True)
        cmd = ios._fix_workspace("xcodebuild -workspace Ride.xcworkspace -scheme Ride -configuration Debug", ios_dir)
        self.assertEqual(cmd, "xcodebuild -workspace RideAlong.xcworkspace -scheme RideAlong -configuration Debug")

    def test_the_build_stamp_moves_with_what_the_build_depends_on(self):
        from capture.demo.detect import Plan, Step
        from capture.demo.workspace import Workspace

        ws = Workspace(root=self.base, src=self.base / "src", commit="c1", stripped=[])
        plan = Plan(project=None, commit="c1", kind="expo_ios", kind_reason="", app_dir="", package_manager="npm", expo=None, steps=[Step("build", "xcodebuild", "ios", "")], evidence=None)
        a = ios.build_stamp(ws, plan, "Debug", {"API": "1"})
        self.assertNotEqual(a, ios.build_stamp(ws, plan, "Debug", {"API": "2"}))
        self.assertNotEqual(a, ios.build_stamp(ws, plan, "Release", {"API": "1"}))
        ws.commit = "c2"
        self.assertNotEqual(a, ios.build_stamp(ws, plan, "Debug", {"API": "1"}))


if __name__ == "__main__":
    unittest.main()
