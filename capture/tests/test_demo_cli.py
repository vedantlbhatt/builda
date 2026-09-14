"""python3 -m unittest capture.tests.test_demo_cli

`python -m capture demo` is registered by capture's own parser like every other subcommand, and
shares `main` with the publish side: `demo --publish` and `demo --delete` are answered by
capture/demo_publish.py before the generator's parser, so the two never define one flag twice.
"""

from __future__ import annotations

import unittest

from capture import cli, demo_publish


class Registered(unittest.TestCase):
    def test_demo_is_a_capture_subcommand(self):
        a = cli.make_parser().parse_args(["demo", "/some/checkout", "--plan", "--kind", "web", "--sim", "Builda Demos"])
        self.assertEqual((a.cmd, a.path, a.plan, a.kind, a.sim), ("demo", "/some/checkout", True, "web", "Builda Demos"))
        from capture.demo.cli import cmd_demo

        self.assertIs(a.fn, cmd_demo)

    def test_the_defaults(self):
        a = cli.make_parser().parse_args(["demo"])
        self.assertEqual((a.path, a.project, a.ref, a.repo, a.app, a.until, a.no_video), (None, None, "HEAD", None, None, None, False))
        # A re-run is one line: the storyboard is the one in the work dir, reused.
        b = cli.make_parser().parse_args(["demo", "--project", "/p", "--app", "/b/App.app"])
        self.assertEqual((b.project, b.app), ("/p", "/b/App.app"))

    def test_publish_and_delete_belong_to_the_publish_side(self):
        self.assertTrue(demo_publish.claims(["demo", "--publish"]))
        self.assertTrue(demo_publish.claims(["demo", "--delete"]))
        self.assertFalse(demo_publish.claims(["demo", "--plan"]))
        self.assertFalse(demo_publish.claims(["demo", "."]))

    def test_the_generator_defines_no_flag_the_publish_side_owns(self):
        import argparse

        sub = argparse.ArgumentParser().add_subparsers()
        from capture.demo.cli import add_parser

        flags = {o for act in add_parser(sub)._actions for o in act.option_strings}
        self.assertFalse(flags & {"--publish", "--delete", "--yes", "--key", "--server"})


if __name__ == "__main__":
    unittest.main()
