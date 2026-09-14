"""python3 -m unittest analysis.tests.test_public_repo

This repository is public, and the transcripts it is built from are the owner's own. Every
test here guards one way a value from those transcripts, or from this machine, reached a
tracked file (FOUND IN THE ADVERSARIAL REVIEW, 2026-09-13):

  * `scripts/check_private_tokens.py`, the check that runs before a commit, answered "no
    identifier" for a path that does not exist, read only the ROOT transcripts (so a value
    that appeared only in a subagent's sidecar was never looked for), and cried leak on
    `float2x2` and `readUInt32BE`, which trains a person to stop reading it;
  * the phone's insights fixture carried its projects' `repo_hash` prefixes, and the pepper
    is public, so a dictionary of repository names read them back as gt-transit and builder;
  * a routes document carried this machine's simulator UDID;
  * an untracked vim swap file, which records the user name and the host name, sat in
    `mobile/` with nothing to stop `git add -A` taking it.

Every identifier below is synthetic.
"""

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import pathlib
import subprocess
import tempfile
import unittest

REPO = pathlib.Path(__file__).resolve().parents[2]


def _checker():
    spec = importlib.util.spec_from_file_location(
        "check_private_tokens", REPO / "scripts" / "check_private_tokens.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _run(*argv: str) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        rc = _checker().main(list(argv))
    return rc, out.getvalue(), err.getvalue()


def _line(text: str) -> str:
    return json.dumps({"type": "user", "message": {"role": "user", "content": text}}) + "\n"


class CheckPrivateTokens(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = pathlib.Path(self._tmp.name)
        self.root = self.tmp / "projects"
        self.project = self.root / "-Users-someone-app"
        self.project.mkdir(parents=True)
        self.sid = "8f7c2a4e-0000-4000-8000-00000000abcd"
        (self.project / f"{self.sid}.jsonl").write_text(_line("fix the page"))

    def tearDown(self):
        self._tmp.cleanup()

    def file(self, text: str, name: str = "notes.py") -> pathlib.Path:
        p = self.tmp / name
        p.write_text(text)
        return p

    def test_a_path_that_does_not_exist_is_an_error(self):
        """Exit 0 said "no identifier in 1 files" about a file it never read."""
        rc, out, err = _run(str(self.tmp / "gone.py"), "--root", str(self.root))
        self.assertEqual(rc, 2)
        self.assertIn("gone.py", err)
        self.assertNotIn("no identifier", out)

    def test_a_root_that_does_not_exist_is_an_error(self):
        rc, out, err = _run(str(self.file("x = 1\n")), "--root", str(self.tmp / "nowhere"))
        self.assertEqual(rc, 2)
        self.assertIn("nowhere", err)
        self.assertNotIn("no identifier", out)

    def test_a_value_only_a_sidecar_saw_is_found(self):
        """A subagent's transcript is `<project>/<session>/subagents/agent-*.jsonl`, and the
        tool results beside it are `.txt`: the value below appears in neither root."""
        side = self.project / self.sid / "subagents"
        side.mkdir(parents=True)
        (side / "agent-a1.jsonl").write_text(_line("the team id is Q7ZK2M9X4P"))
        results = self.project / self.sid / "tool-results"
        results.mkdir()
        (results / "toolu_01.txt").write_text("commit a1b2c3d landed\n")
        rc, out, _ = _run(
            str(self.file('TEAM = "Q7ZK2M9X4P"\nSHA = "a1b2c3d"\n')), "--root", str(self.root)
        )
        self.assertEqual(rc, 1, out)
        self.assertIn("Q7ZK2M9X4P", out)
        self.assertIn("a1b2c3d", out)

    def test_code_is_not_a_finding(self):
        """Identifiers every codebase and every transcript share: a shader type, a buffer
        reader, typed arrays, a hash name, a date formatter, a key class, library names, a
        colour literal, escapes and a hash constant. Crying leak on these is how a person
        learns to ignore the check."""
        code = (
            "float2x2 readUInt32BE Float32Array Sha256Hex sha256hex ISO8601DateFormatter "
            "Ed25519PrivateKey urlsafe_b64decode b64encode chacha20poly1305 i18next "
            "claude-3-5-haiku-20241022 utf8ToBase64 verify_rs256_identity_token '#E5484D' '#0E9F8E80' "
            "'\\u2019s' b'\\x89PNG' 0x811c9dc5\n"
        )
        (self.project / f"{self.sid}.jsonl").write_text(_line(code))
        rc, out, _ = _run(str(self.file(code)), "--root", str(self.root))
        self.assertEqual(rc, 0, out)
        self.assertIn("no identifier", out)

    def test_what_is_still_a_finding(self):
        """A commit SHA, a UUID, an account id, a key with a known prefix, and a random
        token whose letter runs are not words: none of these is code, and a transcript
        holding one means the value came from somebody's session."""
        values = (
            "a1b2c3d",
            "8f7c2a4e-1111-4000-8000-00000000abcd",
            "Q7ZK2M9X4P",
            "sk-ant-api03-AbCdEfGhIjKlMnOpQrSt",
            "xK9mQzt4Lw",
            "0x3f9a0c1d2e4b5a69ab12cd34ef56ab78",
        )
        blob = " ".join(values)
        (self.project / f"{self.sid}.jsonl").write_text(_line(blob))
        rc, out, _ = _run(str(self.file(blob + "\n")), "--root", str(self.root))
        self.assertEqual(rc, 1, out)
        for v in values:
            with self.subTest(value=v):
                self.assertIn(v, out)

    def test_a_lock_file_is_not_read(self):
        """A package manager writes every token in one: versions, wheel tags, hashes."""
        lock = "wheels = [{ url = 'x-0-cp312-cp312-macosx_11_0_arm64.whl', hash = 'a1b2c3d' }]\n"
        (self.project / f"{self.sid}.jsonl").write_text(_line(lock))
        rc, out, _ = _run(str(self.file(lock, name="uv.lock")), "--root", str(self.root))
        self.assertEqual(rc, 0, out)

    def test_a_named_directory_is_read(self):
        d = self.tmp / "pkg"
        d.mkdir()
        (d / "a.py").write_text('SHA = "a1b2c3d"\n')
        (self.project / f"{self.sid}.jsonl").write_text(_line("revert a1b2c3d"))
        rc, out, _ = _run(str(d), "--root", str(self.root))
        self.assertEqual(rc, 1, out)
        self.assertIn("pkg/a.py", out.replace("\\", "/"))


class NothingFromThisMachine(unittest.TestCase):
    def test_the_insights_fixture_names_no_repository_by_its_key(self):
        """A project `key` is `repo_hash[:12]` (routes/sessions.py), an HMAC under a pepper
        that ships in this open source repository. So a key is a name to anyone with a
        list of repository names: here, every GitHub origin this repository's own text
        mentions, and its own origin."""
        from capture import identity, repo
        from capture.tuning import REPO_HASH_PREFIX, REPO_PEPPER

        text = subprocess.run(
            ["git", "grep", "-h", "-o", "-I", "-E", r"github\.com[/:][A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+"],
            cwd=REPO, capture_output=True, text=True, check=False,
        ).stdout.split()
        own = subprocess.run(
            ["git", "config", "--get", "remote.origin.url"],
            cwd=REPO, capture_output=True, text=True, check=False,
        ).stdout.split()
        origins = {o for o in (repo.normalize_origin(t) for t in text + own) if o}
        self.assertIn("github.com/vedantlbhatt/gt-transit", origins, "the list must be real")
        named = {identity.repo_hash(o, REPO_PEPPER, REPO_HASH_PREFIX)[:12] for o in origins}
        fixture = json.loads(
            (REPO / "mobile" / "src" / "insights" / "fixtures" / "report-2026-09-13.json").read_text()
        )
        keys = {p["key"] for p in fixture["profile"]["projects"]}
        self.assertTrue(keys)
        self.assertEqual(keys & named, set())

    def test_no_tracked_document_carries_a_device_udid(self):
        """A simulator's UDID is this machine's (upper case, the only UUIDs written that way
        here); a document says where to find it instead."""
        found = subprocess.run(
            ["git", "grep", "-n", "-I", "-E", r"[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}", "--", "*.md"],
            cwd=REPO, capture_output=True, text=True, check=False,
        ).stdout
        self.assertEqual(found, "")
        doc = (REPO / "mobile" / "src" / "nav" / "DEEPLINKS.md").read_text()
        self.assertIn("SIM=<UDID>", doc)
        self.assertIn("xcrun simctl list devices booted", doc)

    def test_vim_swap_files_are_ignored(self):
        for name in ("mobile/.valueUnpacker.swp", "mobile/src/data/api.ts.swp", "notes.swp"):
            with self.subTest(name=name):
                r = subprocess.run(
                    ["git", "check-ignore", "-q", "--no-index", name], cwd=REPO, check=False
                )
                self.assertEqual(r.returncode, 0, f"{name} would be committed")


if __name__ == "__main__":
    unittest.main()
