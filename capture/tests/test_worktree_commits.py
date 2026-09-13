"""python3 -m unittest capture.tests.test_worktree_commits

A sitting in a git WORKTREE commits to the worktree's own branch. Every commit question
here runs `git log` in the repository's common root (`--git-common-dir`, CLAUDE.md), which
is the main checkout, and a bare `git log` there walks only the main checkout's HEAD. FOUND
IN REVIEW (2026-09-13), MEASURED on this machine's builder repository with one worktree
beside it: from the common root, `git log --since='2 days ago'` counted 0 commits and with
`--branches` 32. Every sitting in the worktree uploaded "0 commits".
"""

from __future__ import annotations

import os
import pathlib
import subprocess
import tempfile
import unittest

from capture import repo

T = 1_789_300_000  # a fixed commit clock, so the windows below are exact


def git(cwd: pathlib.Path, *args: str, at: int | None = None) -> str:
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "t",
        "GIT_AUTHOR_EMAIL": "t@example.invalid",
        "GIT_COMMITTER_NAME": "t",
        "GIT_COMMITTER_EMAIL": "t@example.invalid",
        "GIT_CONFIG_NOSYSTEM": "1",
        "HOME": str(cwd),
    }
    if at is not None:
        env["GIT_AUTHOR_DATE"] = env["GIT_COMMITTER_DATE"] = f"@{at} +0000"
    out = subprocess.run(
        ["git", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", *args],
        cwd=cwd, env=env, check=True, capture_output=True, text=True,
    )  # fmt: skip
    return out.stdout.strip()


class WorktreeCommits(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        base = pathlib.Path(os.path.realpath(cls.tmp.name))
        cls.main = base / "app"
        cls.main.mkdir()
        git(cls.main, "init", "-q")
        (cls.main / "a.txt").write_text("one\n")
        git(cls.main, "add", "a.txt")
        git(cls.main, "commit", "-q", "-m", "first", at=T - 86400)
        cls.wt = base / "app-feature"
        git(cls.main, "worktree", "add", "-q", "-b", "feature", str(cls.wt))
        for i in range(2):
            (cls.wt / f"f{i}.txt").write_text("x\n" * (i + 3))
            git(cls.wt, "add", f"f{i}.txt")
            git(cls.wt, "commit", "-q", "-m", f"feat: worktree change {i}", at=T + 60 * i)
        (cls.main / "b.txt").write_text("b\n")
        git(cls.main, "add", "b.txt")
        git(cls.main, "commit", "-q", "-m", "fix: on main", at=T + 300)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def common_root(self) -> str:
        ident = repo.identity_for(str(self.wt))
        self.assertIsNotNone(ident)
        self.assertEqual(os.path.realpath(ident.common_root), str(self.main), "the worktree resolves to the main checkout")
        return ident.common_root

    def test_a_worktrees_commits_are_counted_from_the_common_root(self):
        """MEASURED with this test's repository (two commits on the worktree's branch and
        one on main inside the window): before the fix `commits_in` and `window_stats`
        counted 1, the main checkout's own; after, 3."""
        root = self.common_root()
        got = repo.commits_in(root, T - 10, T + 600)
        self.assertEqual(len(got), 3)
        self.assertEqual(sorted(ts for _, ts in got), [T, T + 60, T + 300])
        stats = repo.window_stats(root, T - 10, T + 600)
        self.assertEqual((stats.commits, stats.insertions, stats.files_changed), (3, 3 + 4 + 1, 3))

    def test_the_corpus_reads_the_same_commits_and_their_subjects(self):
        """The commit graph and the kind of work card read `analysis.corpus.commit_log`,
        which walks the same refs: before the fix it saw the one subject on main."""
        from analysis import corpus

        rows = corpus.commit_log(self.common_root(), T - 10, T + 600)
        self.assertEqual(
            sorted(s for _, s in rows), ["feat: worktree change 0", "feat: worktree change 1", "fix: on main"]
        )
        self.assertEqual(corpus.commit_messages(self.common_root(), T - 10, cap=None)[-1], "feat: worktree change 0")

    def test_a_remote_only_branch_is_not_this_machines_work(self):
        """`--branches`, never `--all`: MEASURED over 60 days of the builder repository,
        `--all` added one commit on a remote only branch that a cloud session pushed."""
        from capture.tuning import GIT_LOG_REFS

        self.assertEqual(GIT_LOG_REFS, ["--branches"])


if __name__ == "__main__":
    unittest.main()
