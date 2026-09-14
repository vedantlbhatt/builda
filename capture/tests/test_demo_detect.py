"""python3 -m unittest capture.tests.test_demo_detect

Stage 1 of the demo generator (docs/demos.md): the kind of a project and how to run it, over a
fixture repository of each kind, with the transcripts' evidence preferred over the manifests.
"""

from __future__ import annotations

import json
import pathlib
import tempfile
import unittest

from analysis import plain

from capture.demo import detect
from capture.demo import project as pj
from capture.demo.transcripts import Evidence, Seen
from capture.tests import _demo_fixtures as fx


def evidence(*rows: Seen) -> Evidence:
    return Evidence(transcripts_read=3, transcripts_matched=1, commands=list(rows), images=[])


class Kinds(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = pathlib.Path(self.tmp.name).resolve()

    def tearDown(self):
        self.tmp.cleanup()

    def plan(self, files, ev=None, kind=None, configuration="Release"):
        root = fx.repo(self.base / "r", files)
        project = pj.from_checkout(root)
        return detect.detect(project, root, pj.resolve_commit(root, "HEAD"), ev, kind=kind, configuration=configuration)

    def test_expo_app_is_expo_ios_with_scheme_bundle_and_routes(self):
        p = self.plan(fx.EXPO_APP)
        self.assertEqual(p.kind, "expo_ios")
        self.assertEqual(p.app_dir, "mobile")
        self.assertEqual((p.expo.name, p.expo.scheme, p.expo.bundle_id), ("Widget Pro", "widget", "com.acme.widget"))
        self.assertEqual(p.expo.xcode_name, "WidgetPro")
        # Tabs first; groups, _layout, +files and [param] routes are not deep links a plan can open.
        self.assertEqual(p.routes, ["/home", "/stats", "/settings"])
        self.assertEqual(p.package_manager, "bun")
        roles = [s.role for s in p.steps]
        self.assertEqual(roles, ["install", "prebuild", "pods", "build"])  # Release: nothing to embed
        self.assertIn("-scheme WidgetPro", p.step("build").command)
        self.assertEqual(p.step("pods").env["RCT_METRO_PORT"], str(detect.DEMO_METRO_PORT))
        # The analytics key the app reads is named, so the person sees the build is made without it.
        self.assertEqual(p.analytics, ["EXPO_PUBLIC_POSTHOG_KEY"])

    def test_a_debug_build_never_uses_8081_and_builds_one_architecture(self):
        p = self.plan(fx.EXPO_APP, configuration="Debug")
        build = p.step("build").command
        self.assertIn(f"RCT_METRO_PORT={detect.DEMO_METRO_PORT}", build)
        self.assertNotEqual(detect.DEMO_METRO_PORT, 8081)
        self.assertIn("-configuration Debug", build)
        self.assertIn(f"ARCHS={detect.host_arch()}", build)
        # Embedding a development bundle was tried and reverted (ios.pin_packager says why).
        self.assertNotIn("FORCE_BUNDLING", build)
        self.assertTrue(any("never load another project's bundle" in n for n in p.notes))

    def test_a_debug_app_is_pinned_away_from_other_packagers(self):
        from capture.demo import ios

        with tempfile.TemporaryDirectory() as t:
            app = pathlib.Path(t) / "Widget.app"
            app.mkdir()
            ios.pin_packager(app)
            self.assertEqual((app / "ip.txt").read_text(), ios.NO_PACKAGER)
            self.assertNotIn(":8081", ios.NO_PACKAGER)

    def test_app_json_is_read_when_there_is_no_app_config(self):
        files = {
            "package.json": json.dumps({"dependencies": {"expo": "54"}}),
            "package-lock.json": "{}",
            "app.json": json.dumps({"expo": {"name": "RideAlong", "scheme": "ride", "ios": {"bundleIdentifier": "com.x.ride"}}}),
        }
        p = self.plan(files)
        self.assertEqual((p.expo.name, p.expo.scheme, p.expo.bundle_id, p.app_dir), ("RideAlong", "ride", "com.x.ride", ""))
        self.assertEqual(p.step("install").command, "npm ci --ignore-scripts --no-audit --no-fund")

    def test_npm_postinstall_patch_package_is_its_own_step(self):
        files = {
            "package.json": json.dumps({"scripts": {"postinstall": "patch-package"}, "dependencies": {"expo": "54"}}),
            "package-lock.json": "{}",
            "app.json": json.dumps({"expo": {"name": "A"}}),
        }
        p = self.plan(files)
        self.assertEqual([s.role for s in p.steps][:2], ["install", "patch"])
        self.assertIn("--ignore-scripts", p.steps[0].command)

    def test_web_app(self):
        p = self.plan(fx.WEB_APP)
        self.assertEqual(p.kind, "web")
        self.assertEqual(p.step("run").command, "npm run dev")
        self.assertIn("scripts.dev", p.step("run").source)
        self.assertEqual(p.routes, ["/", "/about"])

    def test_a_page_the_commit_does_not_hold_is_not_a_route(self):
        # The demo runs a clone at the commit; an untracked page there answers 404
        # (FOUND ON THE FIRST WEB DEMO, 2026-09-14: the Personal Website's portfolio.html).
        root = fx.repo(self.base / "site", {"index.html": "<h1>hi</h1>", "projects.html": "<h1>p</h1>"})
        (root / "portfolio.html").write_text("<h1>draft</h1>")
        p = detect.detect(pj.from_checkout(root), root, pj.resolve_commit(root, "HEAD"), None)
        self.assertEqual(p.kind, "web")
        self.assertEqual(p.routes, ["/", "/projects.html"])
        # With no commit to ask, nothing is filtered.
        self.assertIn("/portfolio.html", detect.web_routes(root))

    def test_cli_runs_its_readme_usage(self):
        p = self.plan(fx.CLI_APP)
        self.assertEqual(p.kind, "cli")
        # Installs, clones and redirections are not a demo of anything.
        self.assertEqual(p.readme_commands, ["tidy --check src", "tidy fix . --verbose"])
        self.assertEqual(p.step("install").command, "pip install -e .")

    def test_library_runs_its_tests(self):
        p = self.plan(fx.LIBRARY)
        self.assertEqual(p.kind, "library")
        self.assertEqual(p.step("run").command, "python -m pytest -q")

    def test_nothing_to_run_is_refused_with_the_reason(self):
        p = self.plan({"notes.txt": "hello"})
        self.assertIsNone(p.kind)
        self.assertIn("no run command found", p.refused)
        self.assertIn("Refused", detect.render(p))

    def test_kind_can_be_overridden(self):
        p = self.plan(fx.WEB_APP, kind="library")
        self.assertEqual(p.kind, "library")
        self.assertIn("--kind", p.kind_reason)


class TranscriptPreference(unittest.TestCase):
    """The commands that WORKED in the project's own transcripts come first."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = pathlib.Path(self.tmp.name).resolve()

    def tearDown(self):
        self.tmp.cleanup()

    def test_transcripts_make_an_ios_project_of_a_repo_with_a_web_app_at_the_top(self):
        # RideGT's shape: an old CRA site at the top and the Expo app the owner ships in mobile/.
        files = {
            "package.json": json.dumps({"scripts": {"start": "react-scripts start"}, "dependencies": {"react-scripts": "5"}}),
            "package-lock.json": "{}",
            "mobile/package.json": json.dumps({"dependencies": {"expo": "54"}}),
            "mobile/package-lock.json": "{}",
            "mobile/app.json": json.dumps({"expo": {"name": "Ride", "ios": {"bundleIdentifier": "com.x.r"}}}),
        }
        root = fx.repo(self.base / "r", files)
        project = pj.from_checkout(root)
        ev = evidence(
            Seen("xcrun simctl launch 1234 com.x.r", "", ok=2, last_ts=fx.T0),
            Seen("npm install", "mobile", ok=1, last_ts=fx.T0),
        )
        p = detect.detect(project, root, None, ev)
        self.assertEqual(p.kind, "expo_ios")
        self.assertIn("the transcripts ran it", p.kind_reason)
        self.assertIn("worked 1 time in mobile/", p.step("install").source)
        # Without the transcripts the structural order still puts the Expo app first, and
        # the reason says so without claiming evidence it does not have.
        q = detect.detect(project, root, None, None)
        self.assertEqual(q.kind, "expo_ios")
        self.assertNotIn("transcripts", q.kind_reason)

    def test_a_command_that_only_failed_is_not_evidence(self):
        root = fx.repo(self.base / "r", fx.WEB_APP)
        project = pj.from_checkout(root)
        ev = evidence(Seen("npm run dev", "", ok=0, failed=4, last_ts=fx.T0))
        p = detect.detect(project, root, None, ev)
        self.assertIn("package.json", p.step("run").source)

    def test_the_web_run_command_that_worked_wins_over_the_script(self):
        root = fx.repo(self.base / "r", fx.WEB_APP)
        project = pj.from_checkout(root)
        ev = evidence(
            Seen("npm run dev -- --port 4000", "", ok=5, failed=1, last_ts=fx.T0),
            Seen("npm run dev", "", ok=1, last_ts=fx.T0 - 99),
        )
        p = detect.detect(project, root, None, ev)
        self.assertEqual(p.step("run").command, "npm run dev -- --port 4000")
        self.assertIn("worked 5 times, failed 1", p.step("run").source)
        # A command is not prose: ` -- ` stays a command, never becomes a comma.
        self.assertIn("npm run dev -- --port 4000", detect.render(p))

    def test_the_scheme_the_transcripts_built_is_used(self):
        root = fx.repo(self.base / "r", fx.EXPO_APP)
        project = pj.from_checkout(root)
        ev = evidence(Seen("xcodebuild -workspace W.xcworkspace -scheme WidgetDev -configuration Debug", "mobile/ios", ok=3, last_ts=fx.T0))
        p = detect.detect(project, root, None, ev)
        self.assertIn("-scheme WidgetDev", p.step("build").command)

    def test_roles_are_anchored_on_the_program(self):
        rows = [
            Seen('grep "expo run:ios" README.md', "", ok=9),
            Seen("npx expo run:ios --device X", "mobile", ok=1),
            Seen("BUILDER_API_URL=http://127.0.0.1:8787 npx expo run:ios", "mobile", ok=1),
            Seen("bun install", "mobile", ok=2),
            Seen("python -m uvicorn main:app --port 5001", "backend", ok=3),
        ]
        roles = detect.roles_of(evidence(*rows))
        self.assertEqual([s.command for s in roles["build_ios"]], [rows[1].command, rows[2].command])
        self.assertEqual([s.command for s in roles["install"]], ["bun install"])
        self.assertEqual([s.command for s in roles["server"]], ["python -m uvicorn main:app --port 5001"])


class InlineEnv(unittest.TestCase):
    def test_leading_var_value_prefixes_are_stripped_from_a_replayed_command(self):
        cmd, dropped = detect.strip_env_assignments("DATABASE_URL=postgres://prod API_BASE=https://prod npm run dev")
        self.assertEqual(cmd, "npm run dev")
        self.assertEqual(dropped, ["DATABASE_URL", "API_BASE"])
        self.assertEqual(detect.strip_env_assignments("npm run dev"), ("npm run dev", []))

    def test_a_replayed_web_command_drops_inline_env_and_says_so(self):
        root = fx.repo(self.base / "w", fx.WEB_APP)
        project = pj.from_checkout(root)
        ev = evidence(Seen("API_BASE=https://prod.example.com npm run dev", "", ok=2, last_ts=fx.T0))
        p = detect.detect(project, root, None, ev, kind="web")
        self.assertEqual(p.step("run").command, "npm run dev")
        self.assertTrue(any("without its inline API_BASE" in n for n in p.notes), p.notes)

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = pathlib.Path(self.tmp.name).resolve()

    def tearDown(self):
        self.tmp.cleanup()


class Render(unittest.TestCase):
    def test_the_plan_is_plain_words_with_no_dash(self):
        with tempfile.TemporaryDirectory() as t:
            root = fx.repo(pathlib.Path(t).resolve() / "r", fx.EXPO_APP)
            project = pj.from_checkout(root)
            p = detect.detect(project, root, "abc123", evidence(Seen("npx expo prebuild", "mobile", ok=1, last_ts=fx.T0)))
            p.notes.append("a note with an en dash – in it")
            text = detect.render(p)
        self.assertFalse(any(c in text for c in plain.DASH_CHARS), text)
        for line in text.splitlines():
            if line.strip().startswith(tuple(f"{i}." for i in range(1, 10))):
                continue  # a command line, quoted as written
            self.assertFalse(plain.has_dash(line), line)
        self.assertIn("read only: nothing is built or run there", text)
        self.assertIn("made without  EXPO_PUBLIC_POSTHOG_KEY", text)

    def test_sandbox_status_says_plainly_when_srt_is_missing(self):
        import os
        import tempfile
        from unittest import mock

        # An empty tools dir so `tools.srt()` finds nothing there; then only shutil.which decides.
        with tempfile.TemporaryDirectory() as t, mock.patch.dict(os.environ, {"BUILDER_TOOLS_DIR": t}):
            with mock.patch("shutil.which", return_value=None):
                self.assertIn("NOT installed", detect.sandbox_status())
            with mock.patch("shutil.which", return_value="/usr/local/bin/srt"):
                self.assertIn("under Anthropic's sandbox runtime", detect.sandbox_status())


if __name__ == "__main__":
    unittest.main()
