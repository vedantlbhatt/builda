"""`python -m capture demo`: the command. Registered by `capture/cli.py` like every other one.

    python -m capture demo [PATH]                 detect, clone, build, film, compose, check
    python -m capture demo [PATH] --plan          how it would run the project; runs nothing
    python -m capture demo --repo https://github.com/owner/name
    python -m capture demo PATH --app Some.app    film an iOS app built elsewhere
    python -m capture demo PATH --sim NAME|UDID   which simulator (default "Builda Demos")
    python -m capture demo PATH --until build     stop after the build (or `workspace`)
"""

from __future__ import annotations

import argparse

from . import KINDS
from . import transcripts as tx


def add_parser(sub) -> argparse.ArgumentParser:
    d = sub.add_parser(
        "demo",
        help="stills and a 10 to 30 second video of a project, running (docs/demos.md)",
        description=(
            "Make 4 to 6 stills and one 10 to 30 second video of a project, running, on this Mac. "
            "Nothing is built or run in your checkout, no model is called, and nothing leaves the "
            "machine: the demo is written to ~/.builder/demos/<key>/."
        ),
    )
    d.add_argument("path", nargs="?", default=None, help="a local checkout (default: the current directory)")
    d.add_argument("--project", help="the same as PATH: a local checkout")
    d.add_argument("--repo", help="clone this https://github.com/owner/name URL instead of a local checkout")
    d.add_argument("--ref", default="HEAD", help="the commit, branch or tag to demo (default HEAD)")
    d.add_argument("--plan", action="store_true", help="print how it would run the project, and run nothing")
    d.add_argument("--kind", choices=KINDS, help="override the detected kind")
    d.add_argument("--storyboard", help="the flow to replay (default: the one in the work dir, else a new one)")
    d.add_argument("--app", help="expo_ios: film this already built .app instead of building one")
    d.add_argument("--sim", help="expo_ios: the simulator, a name or UDID (default 'Builda Demos', created when missing)")
    d.add_argument("--configuration", choices=("Debug", "Release"), help="expo_ios build configuration (default: the storyboard's, else Release)")
    d.add_argument("--until", choices=("workspace", "build"), help="stop after this stage")
    d.add_argument("--no-video", action="store_true", help="stills only")
    d.add_argument(
        "--allow-name",
        action="append",
        metavar="NAME",
        help="a repository or folder name that may appear on screen (the app's own public name); "
        "printed in the result, never assumed",
    )
    d.add_argument("--root", default=str(tx.DEFAULT_ROOT), help="Claude Code transcript root (default ~/.claude/projects)")
    d.add_argument("--no-transcripts", action="store_true", help="do not read the transcripts for commands that worked")
    d.set_defaults(fn=cmd_demo)
    return d


def cmd_demo(a: argparse.Namespace) -> int:
    from . import run

    if a.path and a.project and a.path != a.project:
        print("give the checkout once: PATH or --project, not two different ones")
        return 2
    a.path = a.project or a.path or "."
    return run.main(a)
