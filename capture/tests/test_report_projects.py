"""python3 -m unittest capture.tests.test_report_projects

The report's `projects` block (docs/projects.md) names a project by the key the machine's
session uploads already carry, `repo_hash`, and by nothing else: the server joins the two
to put a PUBLIC repository's name beside the key, and a private one's name must never be
in either document. Held here through capture's own two dry runs over one transcript in a
real git repository: the key in `capture report` is the `repo_hash` in `capture sync`, and
neither the repository's name nor its path is anywhere in the report.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import pathlib
import subprocess
import time

from capture import cli
from capture.tests.test_dry_run import _Harness

SID = "00000000-0000-4000-8000-0000000000e1"


def _git(cwd: pathlib.Path, *args: str, at: int | None = None) -> None:
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.invalid",
        "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.invalid",
        "GIT_CONFIG_NOSYSTEM": "1",
    }  # fmt: skip
    if at is not None:
        env["GIT_AUTHOR_DATE"] = env["GIT_COMMITTER_DATE"] = f"@{at} +0000"
    subprocess.run(
        ["git", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", *args],
        cwd=cwd, env=env, check=True, capture_output=True, text=True,
    )  # fmt: skip


class ReportProjects(_Harness):
    def setUp(self):
        super().setUp()
        from analysis.tests import test_cli as tc

        base = pathlib.Path(os.path.realpath(self.tmp.name))
        self.repo = base / "zebracapture-app"
        self.repo.mkdir()
        _git(self.repo, "init", "-q")
        _git(self.repo, "remote", "add", "origin", "git@github.com:me/zebracapture.git")
        start = time.time() - 2 * 86400
        (self.repo / "a.txt").write_text("a\n")
        _git(self.repo, "add", "a.txt")
        _git(self.repo, "commit", "-q", "-m", "zebrasubject in the sitting", at=int(start) + 7)
        tc.write(self.root, tc.records(start, sid=SID, ids="z", cwd=str(self.repo)), project="-zebra", sid=SID)

    def run_cli(self, *args) -> str:
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = cli.main([*args, "--root", str(self.root), "--server", self.url, "--no-other-harnesses", "--dry-run"])
        self.assertEqual(rc, 0, err.getvalue())
        return out.getvalue()

    def test_the_project_key_is_the_sessions_repo_hash_and_no_name_travels(self):
        sessions = json.loads(self.run_cli("sync"))["sessions"]
        hashes = {p["repo_hash"] for p in sessions if p.get("repo_hash")}
        self.assertEqual(len(hashes), 1, "the transcript in the repository resolves to one")
        text = self.run_cli("report")
        doc = json.JSONDecoder().raw_decode(text)[0]
        block = doc["projects"]
        self.assertEqual({p["key"] for p in block["projects"]}, hashes)
        # The boundary fixture's sittings ran in a directory that is no repository.
        self.assertGreaterEqual(block["unresolved"]["history_sessions"], 1)
        project = block["projects"][0]
        self.assertEqual(project["window"]["commits"]["assisted"], 1)
        for word in ("zebracapture", str(self.repo), "zebrasubject", "github.com"):
            self.assertNotIn(word, text)


if __name__ == "__main__":
    import unittest

    unittest.main()
