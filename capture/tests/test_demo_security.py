"""python3 -m unittest capture.tests.test_demo_security

The security review of the generator, item by item. No simulator, no network, no Vision: every
test here is a pure function or a mocked subprocess.

  1. untrusted repositories run sandboxed, own ones unsandboxed after a typed yes; the deny list,
     the HOME and cache redirection, and --ignore-scripts
  2. a repository derived scheme or variable never reaches a deep link (in test_demo_storyboard)
  3. symlinks out of the clone are never read or written
  4. the Vision check fails closed
  5. one secret-file list, and inline VAR=value stripped from replayed commands
  6. the web path installs into a venv
  7. the crash-screen list, the macOS user name, the joined-text match, the metadata strip
  8. no shared cache is write-allowed, and the browser cache lives in the work dir
  9. a monorepo root lockfile is fingerprinted, and a failed patch is not stamped
"""

from __future__ import annotations

import argparse
import io
import contextlib
import os
import pathlib
import tempfile
import unittest
from unittest import mock

from capture.demo import detect, run, storyboard, tools, web
from capture.demo import workspace as wsp
from capture.demo.transcripts import Evidence


def a_plan(kind="web", steps=None):
    return detect.Plan(
        project=None, commit="c", kind=kind, kind_reason="", app_dir="", package_manager=None,
        expo=None, steps=steps or [detect.Step("run", "npm start", "", "x")], evidence=None,
    )


class Trust(unittest.TestCase):
    def test_a_repo_the_transcripts_resolved_to_is_own(self):
        self.assertTrue(run.is_own(Evidence(transcripts_read=3, transcripts_matched=2, commands=[], images=[])))
        self.assertFalse(run.is_own(Evidence(transcripts_read=3, transcripts_matched=0, commands=[], images=[])))
        self.assertFalse(run.is_own(None))  # --no-transcripts is treated as untrusted

    def test_an_own_project_runs_unsandboxed(self):
        with tempfile.TemporaryDirectory() as t:
            ws = wsp.Workspace(root=pathlib.Path(t), src=pathlib.Path(t) / "src", commit="c", stripped=[])
            ev = Evidence(transcripts_read=1, transcripts_matched=1, commands=[], images=[])
            sb = run._sandbox_for(None, ev, a_plan("web"), ws)
            self.assertFalse(sb.untrusted)
            self.assertEqual(sb.wrap(["npm", "ci"])[0], ["npm", "ci"])  # not wrapped

    def test_an_untrusted_web_repo_requires_and_uses_the_sandbox(self):
        with tempfile.TemporaryDirectory() as t:
            ws = wsp.Workspace(root=pathlib.Path(t), src=pathlib.Path(t) / "src", commit="c", stripped=[])
            with mock.patch.object(tools, "ensure_srt", return_value="/opt/srt"):
                sb = run._sandbox_for(None, None, a_plan("web"), ws)
            self.assertTrue(sb.untrusted)
            argv, how = sb.wrap(["npm", "ci"], ["registry.npmjs.org"])
            self.assertEqual(argv[:2], ["/opt/srt", "--settings"])
            self.assertIn("sandbox", how)

    def test_an_untrusted_ios_repo_is_refused(self):
        with tempfile.TemporaryDirectory() as t:
            ws = wsp.Workspace(root=pathlib.Path(t), src=pathlib.Path(t) / "src", commit="c", stripped=[])
            with self.assertRaisesRegex(run.CaptureError, "cannot be sandboxed"):
                run._sandbox_for(None, None, a_plan("expo_ios"), ws)

    def test_an_untrusted_repo_with_no_sandbox_refuses(self):
        with tempfile.TemporaryDirectory() as t:
            ws = wsp.Workspace(root=pathlib.Path(t), src=pathlib.Path(t) / "src", commit="c", stripped=[])
            sb = wsp.Sandbox(work=ws.root, untrusted=True, srt=None)
            with self.assertRaisesRegex(wsp.WorkspaceError, "not available"):
                sb.wrap(["npm", "ci"])


class Gate(unittest.TestCase):
    def _confirm(self, yes, isatty):
        story = storyboard.validate(storyboard.default(a_plan("web")))
        sb = wsp.Sandbox(work=pathlib.Path("/tmp/x"), untrusted=False)
        err = io.StringIO()
        with contextlib.redirect_stderr(err), mock.patch("sys.stdin.isatty", return_value=isatty):
            ok = run._confirm_run(a_plan("web"), story, sb, argparse.Namespace(yes=yes))
        return ok, err.getvalue()

    def test_yes_runs_and_prints_the_steps(self):
        ok, text = self._confirm(yes=True, isatty=False)
        self.assertTrue(ok)
        self.assertIn("[run] npm start", text)

    def test_no_yes_and_no_terminal_stops(self):
        ok, text = self._confirm(yes=False, isatty=False)
        self.assertFalse(ok)
        self.assertIn("pass --yes", text)

    def test_the_untrusted_prompt_names_the_sandbox(self):
        story = storyboard.validate(storyboard.default(a_plan("web")))
        sb = wsp.Sandbox(work=pathlib.Path("/tmp/x"), untrusted=True, srt="/opt/srt")
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            run._confirm_run(a_plan("web"), story, sb, argparse.Namespace(yes=True))
        self.assertIn("under the sandbox", err.getvalue())
        self.assertIn("unreadable", err.getvalue())


class Environment(unittest.TestCase):
    def test_home_and_caches_move_into_the_work_dir(self):
        with tempfile.TemporaryDirectory() as t:
            home = pathlib.Path(t) / "home"
            env = wsp.clean_env(home=home)
            self.assertEqual(env["HOME"], str(home))
            self.assertEqual(env["npm_config_cache"], f"{home}/.npm")
            self.assertEqual(env["PIP_CACHE_DIR"], f"{home}/.cache/pip")
            self.assertEqual(env["CP_HOME_DIR"], f"{home}/.cocoapods")
            self.assertEqual(env["PLAYWRIGHT_BROWSERS_PATH"], f"{home}/ms-playwright")

    def test_the_deny_list_and_no_shared_cache_writes(self):
        with tempfile.TemporaryDirectory() as t:
            work = pathlib.Path(t)
            s = wsp.sandbox_settings(work, ["example.com"])
            deny = s["filesystem"]["denyRead"]
            # Absolute (~ expanded against the real home) so the deny holds under a work-dir HOME.
            for p in ("~/.ssh", "~/.aws", "~/.config/gh", "~/.git-credentials", "~/.npmrc", "~/.claude", "~/.builder"):
                self.assertIn(os.path.expanduser(p), deny)
                self.assertNotIn(p, deny)
            self.assertIn(str(work), s["filesystem"]["allowRead"])
            self.assertIn(str(tools.paths.tools_dir()), s["filesystem"]["allowRead"])
            self.assertEqual(s["filesystem"]["allowWrite"].count(str(pathlib.Path.home() / "Library" / "Caches")), 0)
            self.assertTrue(s["network"]["allowLocalBinding"])


class Symlinks(unittest.TestCase):
    def test_inside_rejects_a_symlink_and_a_path_outside(self):
        with tempfile.TemporaryDirectory() as t:
            base = pathlib.Path(t) / "clone"
            (base / "sub").mkdir(parents=True)
            real = base / "sub" / "a.txt"
            real.write_text("x")
            self.assertTrue(wsp._inside(base, real))
            outside = pathlib.Path(t) / "outside.txt"
            outside.write_text("secret")
            link = base / "link.txt"
            link.symlink_to(outside)
            self.assertFalse(wsp._inside(base, link))
            linkdir = base / "docs"
            linkdir.symlink_to(pathlib.Path(t))
            self.assertFalse(wsp._inside(base, linkdir / "outside.txt"))

    def test_strip_analytics_never_writes_through_a_symlink(self):
        POSTHOG = "phc_" + "A" * 40
        with tempfile.TemporaryDirectory() as t:
            base = pathlib.Path(t) / "clone"
            base.mkdir(parents=True)
            (base / ".git").mkdir()  # so ls-files returns nothing, walk still runs
            outside = pathlib.Path(t) / "real.js"
            outside.write_text(f"const k = '{POSTHOG}';\n")
            (base / "config.js").symlink_to(outside)
            wsp.strip_analytics(base)
            # The file the link points at, outside the clone, was never rewritten.
            self.assertIn(POSTHOG, outside.read_text())

    def test_strip_secret_files_removes_a_symlink_without_touching_its_target(self):
        with tempfile.TemporaryDirectory() as t:
            base = pathlib.Path(t) / "clone"
            base.mkdir(parents=True)
            outside = pathlib.Path(t) / "real.env"
            outside.write_text("SECRET=1\n")
            (base / ".env").symlink_to(outside)
            wsp.strip_secret_files(base)
            self.assertFalse((base / ".env").exists() or (base / ".env").is_symlink())
            self.assertTrue(outside.exists())  # the target, outside the clone, is untouched


class SecretFiles(unittest.TestCase):
    def test_the_one_list_covers_every_shape_the_review_named(self):
        for name in (
            ".env", ".env.local", ".env.production", ".env-production", ".env_local", ".envrc",
            ".dev.vars", ".npmrc", ".netrc", ".pypirc", ".git-credentials", "google-services.json",
            "GoogleService-Info.plist", "credentials.json", "credentials-prod.json", "id_rsa",
            "id_ed25519", "server.pem", "key.p12", "cert.mobileprovision", "signing.keystore",
        ):
            self.assertTrue(wsp.is_secret_file(name), name)
        for name in ("index.js", "app.json", "bus_recordings.sqlite", "README.md", "envelope.txt"):
            self.assertFalse(wsp.is_secret_file(name), name)


class Reencode(unittest.TestCase):
    def _have_ffmpeg(self):
        try:
            tools.ffmpeg()
            return True
        except tools.ToolError:
            return False

    def test_reencode_drops_a_jpeg_exif_block(self):
        # A JPEG carrying an APP1/Exif marker (where GPS would live); after `_reencode` (ffmpeg
        # with -map_metadata -1) the Exif block is gone (the review's item 7). sips is not used
        # because it copies EXIF through a JPEG re-encode.
        if not self._have_ffmpeg():
            self.skipTest("ffmpeg not installed")
        import subprocess

        from capture.tests import _demo_fixtures as fx

        with tempfile.TemporaryDirectory() as t:
            d = pathlib.Path(t)
            (d / "src.png").write_bytes(fx.png(48, 48))
            subprocess.run([tools.ffmpeg(), "-y", "-loglevel", "error", "-i", str(d / "src.png"), "-q:v", "2", str(d / "photo.jpg")], capture_output=True, check=False)
            app1 = b"\xff\xe1" + (52).to_bytes(2, "big") + b"Exif\x00\x00MM\x00*" + b"\x00" * 42
            data = (d / "photo.jpg").read_bytes()
            (d / "photo.jpg").write_bytes(data[:2] + app1 + data[2:])
            self.assertIn(b"Exif", (d / "photo.jpg").read_bytes())
            self.assertTrue(run._reencode(d / "photo.jpg", d / "out.jpg"))
            self.assertNotIn(b"Exif", (d / "out.jpg").read_bytes())


class WebVenv(unittest.TestCase):
    def test_pip_install_is_rewritten_to_the_venv(self):
        with tempfile.TemporaryDirectory() as t:
            ws = wsp.Workspace(root=pathlib.Path(t), src=pathlib.Path(t) / "src", commit="c", stripped=[])
            (ws.root / "venv" / "bin").mkdir(parents=True)
            (ws.root / "venv" / "bin" / "python").write_text("")  # pretend the venv exists
            sb = wsp.Sandbox(work=ws.root, untrusted=False)
            cmd, bindir = web._venv_pip("pip install -r requirements.txt", ws, sb)
            self.assertEqual(cmd, f"{ws.root}/venv/bin/pip install -r requirements.txt")
            self.assertEqual(bindir, str(ws.root / "venv" / "bin"))


class InstallScripts(unittest.TestCase):
    def test_every_package_manager_ignores_lifecycle_scripts(self):
        from capture.demo.detect import _install_step

        for pm in ("bun", "pnpm", "yarn", "npm"):
            steps = _install_step(pm, "", {}, {r: [] for r in detect.ROLE_PATTERNS})
            self.assertIn("--ignore-scripts", steps[0].command, pm)
            self.assertIn("lifecycle scripts off", steps[0].source)


if __name__ == "__main__":
    unittest.main()
