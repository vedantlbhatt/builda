"""python3 -m unittest capture.tests.test_demo_workspace

Stage 2 (docs/demos.md): NEVER the person's checkout. The clone is made in the work dir, the
checkout is left byte for byte as it was (files, mtimes, git status, refs), no `.env*` file is
ever written into the clone (tracked or not), analytics keys are blanked, every child gets an
environment allowlist, and the sandbox is used when installed and named when it is not.
"""

from __future__ import annotations

import hashlib
import os
import pathlib
import subprocess
import tempfile
import unittest
from unittest import mock

from capture.demo import project as pj
from capture.demo import workspace as wsp
from capture.tests import _demo_fixtures as fx

POSTHOG = "phc_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v"
SENTRY = "https://" + "0123456789abcdef" * 2 + "@o12345.ingest.us.sentry.io/678"


def snapshot(root: pathlib.Path) -> dict:
    """Every file under `root` with its bytes' hash and mtime, and git's own view."""
    files = {}
    for dirpath, _dirs, names in os.walk(root):
        for n in names:
            p = pathlib.Path(dirpath) / n
            if ".git" in p.relative_to(root).parts and p.name in ("index.lock", "FETCH_HEAD"):
                continue
            st = p.stat()
            files[str(p.relative_to(root))] = (hashlib.sha256(p.read_bytes()).hexdigest(), st.st_mtime_ns)
    # GIT_OPTIONAL_LOCKS=0, as every git call in capture: a plain `git status` refreshes the
    # index's stat cache, and the first version of this test caught ITSELF moving .git/index.
    env = {**os.environ, "GIT_OPTIONAL_LOCKS": "0"}
    status = subprocess.run(["git", "status", "--porcelain", "--ignored"], cwd=root, capture_output=True, text=True, env=env).stdout
    refs = subprocess.run(["git", "show-ref"], cwd=root, capture_output=True, text=True, env=env).stdout
    return {"files": files, "status": status, "refs": refs}


class Clone(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = pathlib.Path(self.tmp.name).resolve()
        self.env = mock.patch.dict(os.environ, {"BUILDER_DEMOS_DIR": str(base / "demos")})
        self.env.start()
        self.src = fx.repo(
            base / "checkout",
            {
                "app/package.json": '{"dependencies": {"expo": "54"}}',
                "app/app.json": '{"expo": {"name": "A", "extra": {"posthog": "' + POSTHOG + '"}}}',
                "app/sentry.js": f"export const dsn = '{SENTRY}';\n",
                "app/google-services.json": '{"api_key": [{"current_key": "AIzaFAKEFAKEFAKEFAKE"}]}',
                "app/.env.example": "EXPO_PUBLIC_POSTHOG_KEY=put-yours-here\n",
                ".gitignore": ".env\n",
            },
        )
        # An untracked .env beside it, as a person has: never read, never copied.
        (self.src / ".env").write_text("SECRET_TOKEN=do-not-copy\n")
        (self.src / "app" / "notes.txt").write_text("untracked work in progress\n")
        self.project = pj.from_checkout(self.src)
        self.before = snapshot(self.src)

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def test_the_checkout_is_never_touched(self):
        ws = wsp.prepare(self.project, pj.resolve_commit(self.src, "HEAD"), "app")
        self.assertEqual(snapshot(self.src), self.before)
        self.assertNotEqual(ws.src, self.src)
        self.assertTrue(str(ws.src).startswith(os.environ["BUILDER_DEMOS_DIR"]))
        # A second run over the same clone: still nothing in the checkout moves.
        wsp.prepare(self.project, pj.resolve_commit(self.src, "HEAD"), "app")
        self.assertEqual(snapshot(self.src), self.before)

    def test_no_env_file_is_ever_in_the_clone(self):
        ws = wsp.prepare(self.project, None, "app")
        on_disk = [p for p in ws.src.rglob(".env*")]
        self.assertEqual(on_disk, [])
        # The tracked template is in the object store and was never a file; the untracked one
        # never arrived at all; the run says which it left out.
        self.assertTrue(any("app/.env.example" in s for s in ws.stripped), ws.stripped)
        self.assertFalse(any("do-not-copy" in s for s in ws.stripped))
        self.assertFalse((ws.src / "app" / "notes.txt").exists())  # only committed work is cloned
        # git itself agrees nothing was deleted by hand: the sparse checkout keeps status clean.
        status = subprocess.run(["git", "status", "--porcelain"], cwd=ws.src, capture_output=True, text=True).stdout
        self.assertNotIn(".env", status)

    def test_analytics_keys_are_blanked_and_named(self):
        ws = wsp.prepare(self.project, None, "app")
        self.assertNotIn(POSTHOG, (ws.src / "app" / "app.json").read_text())
        self.assertNotIn(SENTRY, (ws.src / "app" / "sentry.js").read_text())
        self.assertFalse((ws.src / "app" / "google-services.json").exists())
        joined = "\n".join(ws.stripped)
        self.assertIn("app/app.json: PostHog project key blanked", joined)
        self.assertIn("app/sentry.js: Sentry DSN blanked", joined)
        self.assertIn("app/google-services.json never written", joined)
        # And none of it touched the checkout.
        self.assertIn(POSTHOG, (self.src / "app" / "app.json").read_text())

    def test_a_later_run_says_the_same_thing(self):
        a = wsp.prepare(self.project, None, "app").stripped
        b = wsp.prepare(self.project, None, "app").stripped
        self.assertEqual(a, b)


class Environment(unittest.TestCase):
    def test_only_the_allowlist_and_the_storyboards_values(self):
        fake = {"PATH": "/bin", "HOME": "/h", "DATABASE_URL": "postgres://x", "BUILDER_CAPTURE_KEY": "k", "AWS_SECRET_ACCESS_KEY": "s", "LANG": "C"}
        with mock.patch.dict(os.environ, fake, clear=True):
            env = wsp.clean_env({"BUILDER_API_URL": "http://127.0.0.1:8787", "EXPO_PUBLIC_POSTHOG_KEY": "phc_x", "SENTRY_DSN": "d"})
        self.assertEqual(env, {"PATH": "/bin", "HOME": "/h", "LANG": "C", "BUILDER_API_URL": "http://127.0.0.1:8787"})

    def test_the_sandbox_when_it_is_installed_and_the_sentence_when_it_is_not(self):
        with tempfile.TemporaryDirectory() as t:
            work = pathlib.Path(t)
            with mock.patch("shutil.which", return_value=None):
                argv, how = wsp.sandboxed(["npm", "run", "dev"], work, [])
            self.assertEqual(argv, ["npm", "run", "dev"])
            self.assertIn("not installed", how)
            with mock.patch("shutil.which", return_value="/opt/srt"):
                argv, how = wsp.sandboxed(["npm", "run", "dev"], work, ["registry.npmjs.org"])
            self.assertEqual(argv[:3], ["/opt/srt", "--settings", str(work / "srt-settings.json")])
            self.assertEqual(argv[3:], ["npm", "run", "dev"])
            import json

            settings = json.loads((work / "srt-settings.json").read_text())
            self.assertIn("~/.ssh", settings["filesystem"]["denyRead"])
            self.assertIn("~/.builder/credentials.json", settings["filesystem"]["denyRead"])
            self.assertIn(str(work), settings["filesystem"]["allowWrite"])
            self.assertEqual(settings["network"]["allowedDomains"], ["registry.npmjs.org"])


class CopyGuard(unittest.TestCase):
    def test_env_files_keys_and_credentials_are_never_copied_in(self):
        from capture.demo.servers import ServerError, check_copy

        for name in (".env", ".env.local", "AuthKey_ABC.p8", "server.pem", "credentials.json", "id_ed25519"):
            with self.assertRaises(ServerError, msg=name):
                check_copy(pathlib.Path("/x") / name)
        check_copy(pathlib.Path("/x/bus_recordings.sqlite"))


if __name__ == "__main__":
    unittest.main()
