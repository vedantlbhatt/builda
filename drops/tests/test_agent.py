"""The launch agent's job description: every rule in it, held.

Nothing here loads launchd. The plist is built by a pure function on purpose, because the
interesting parts are what the job is allowed to carry and what it is refused for, and neither
is worth a real daemon to check.
"""

from __future__ import annotations

import plistlib
import unittest

from drops import agent as ag


def job(**env) -> dict:
    return ag.plist(
        python="/usr/bin/python3",
        repo="/repo",
        server="https://builda.example",
        env={"PATH": "/opt/homebrew/bin:/usr/bin", **env},
        log_dir="/logs",
    )


class WhatItRunsTests(unittest.TestCase):
    def test_it_runs_watch_and_nothing_else(self):
        args = job()["ProgramArguments"]
        self.assertEqual(args[1:], ["-m", "drops", "--server", "https://builda.example", "watch"])
        # No flag here can widen what a watcher does, and there is none to pass.
        self.assertNotIn("--auto", args)
        self.assertNotIn("--all", args)

    def test_a_clean_exit_is_left_alone(self):
        """`watch` returns only on a signal, so a clean exit is somebody stopping it on purpose."""
        self.assertEqual(job()["KeepAlive"], {"SuccessfulExit": False})

    def test_a_job_that_cannot_start_is_not_restarted_as_fast_as_launchd_can_fork(self):
        self.assertGreaterEqual(job()["ThrottleInterval"], 60)

    def test_it_does_not_fight_the_person_using_the_machine(self):
        self.assertEqual(job()["ProcessType"], "Background")
        self.assertTrue(job()["LowPriorityIO"])

    def test_it_is_a_plist_that_plistlib_round_trips(self):
        self.assertEqual(plistlib.loads(plistlib.dumps(job())), job())


class EnvironmentTests(unittest.TestCase):
    def test_the_path_travels_because_launchd_gives_a_job_almost_none(self):
        """The trap the module exists to avoid: a job with launchd's own PATH finds no `claude`
        and answers `planner_unavailable` on every drop, which looks like a model outage."""
        self.assertEqual(job()["EnvironmentVariables"]["PATH"], "/opt/homebrew/bin:/usr/bin")

    def test_a_job_installed_from_a_shell_with_no_path_still_has_one(self):
        out = ag.plist(python="p", repo="/r", server="s", env={}, log_dir="/l")
        self.assertTrue(out["EnvironmentVariables"]["PATH"])

    def test_only_the_named_variables_travel(self):
        """A launch agent that inherited a whole shell carries whatever was exported for
        something else, which is how a stray DATABASE_URL ends up in a daemon."""
        out = job(BUILDER_CREDENTIALS="/c/creds.json", DATABASE_URL="postgres://secret", AWS_SECRET_ACCESS_KEY="x")
        carried = out["EnvironmentVariables"]
        self.assertEqual(carried["BUILDER_CREDENTIALS"], "/c/creds.json")
        self.assertNotIn("DATABASE_URL", carried)
        self.assertNotIn("AWS_SECRET_ACCESS_KEY", carried)

    def test_an_empty_variable_does_not_travel_as_empty(self):
        """`BUILDER_DROPS_COOKIES_FROM=` in a shell means "off", and a job that carried the empty
        string would read it the same way; carrying it at all is noise in a file people read."""
        self.assertNotIn("BUILDER_DROPS_COOKIES_FROM", job(BUILDER_DROPS_COOKIES_FROM="")["EnvironmentVariables"])

    def test_every_carried_name_is_one_this_package_reads(self):
        self.assertIn("BUILDER_DROPS_REPO_ROOTS", ag.CARRIED)
        self.assertIn("BUILDER_CREDENTIALS", ag.CARRIED)


class FleetingTests(unittest.TestCase):
    def test_a_tool_in_a_temporary_directory_is_not_a_tool_a_daemon_may_have(self):
        """FOUND INSTALLING THIS: on the machine it was written on, `claude` resolves to
        `$TMPDIR/cmux-cli-shims/<uuid>/claude`. An agent installed with that PATH works until the
        next reboot and then refuses every drop forever."""
        for where in (
            "/var/folders/cd/h8/T/cmux-cli-shims/abc/claude",
            "/private/var/folders/x/T/shim/claude",
            "/tmp/claude",
            "/private/tmp/claude",
        ):
            self.assertTrue(ag.is_temporary(where), where)

    def test_a_real_install_is_not_flagged(self):
        for where in ("/opt/homebrew/bin/claude", "/usr/local/bin/git", "/Users/me/.local/bin/claude"):
            self.assertFalse(ag.is_temporary(where), where)

    def test_missing_is_not_temporary(self):
        self.assertFalse(ag.is_temporary(None))
        self.assertEqual(ag.fleeting({"claude": None, "git": "/usr/bin/git"}), {})

    def test_fleeting_names_only_the_ones_that_go(self):
        found = {"claude": "/var/folders/x/T/s/claude", "git": "/usr/bin/git", "yt-dlp": None}
        self.assertEqual(list(ag.fleeting(found)), ["claude"])


class LabelTests(unittest.TestCase):
    def test_the_label_and_the_file_name_agree(self):
        """launchctl finds a job by its Label and a person finds it by its file name; two
        different answers there is a job you can load and cannot unload."""
        self.assertEqual(ag.PLIST.name, f"{ag.LABEL}.plist")
        self.assertEqual(job()["Label"], ag.LABEL)

    def test_the_log_is_one_file_for_both_streams(self):
        out = job()
        self.assertEqual(out["StandardOutPath"], out["StandardErrorPath"])


if __name__ == "__main__":
    unittest.main()
