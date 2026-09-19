"""`python -m capture demo kit|queue|watch|hook`: the ship kit's commands (docs/ship-kit.md).

    python -m capture demo kit [PATH | --key KEY]      make the kit beside the project's demo
    python -m capture demo kit ... --dry-run           what it would make; makes nothing
    python -m capture demo kit ... --publish           send it to your account, after a yes
    python -m capture demo queue [--list]              what is waiting to be filmed, and why
    python -m capture demo queue --add PATH            film this project next
    python -m capture demo watch [--once] [--dry-run]  the worker: the queue and the phone's
                                                       requests, one demo at a time
    python -m capture demo hook                        the Claude Code SessionEnd hook's command
                                                       (reads the hook's JSON on stdin, queues)
    python -m capture demo hook --install              print the settings.json entry to add

Answered before the `demo` generator's parser (capture/cli.py), as `demo --publish` is, so a
project folder that happened to be called `watch` is still reachable as `./watch`.
"""

from __future__ import annotations

import argparse
import sys

VERBS = ("kit", "queue", "watch", "hook")


def claims(argv: list[str]) -> bool:
    """Whether a `python -m capture` command line is the ship kit's: `demo` followed by one of
    `VERBS`."""
    return len(argv) >= 2 and argv[0] == "demo" and argv[1] in VERBS


def make_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="python -m capture demo", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="verb", required=True)

    k = sub.add_parser("kit", help="make the ship kit beside a project's demo")
    k.add_argument("path", nargs="?", default=None, help="the project's checkout (default: the current directory)")
    k.add_argument("--project", help="the same as PATH")
    k.add_argument("--key", help="the project's 64 hex key, instead of a checkout")
    k.add_argument("--hue", help="the project's hue (the phone's); default: the one its key asks for")
    k.add_argument("--shipped", help="a build post (python -m analysis shipped --out FILE) to caption from")
    k.add_argument("--formats", help="only these formats, comma separated (vertical,feed,landscape,square)")
    k.add_argument("--no-model", action="store_true", help="captions from the inputs alone, no claude call")
    k.add_argument("--dry-run", action="store_true", help="say what it would make, and make nothing")
    k.add_argument("--publish", action="store_true", help="send the kit to your account, after it lists every file")
    k.add_argument("--yes", action="store_true", help="with --publish: do not ask")
    k.add_argument("--server", default=None)
    k.add_argument("--root", default="~/.claude/projects")
    k.add_argument("--no-transcripts", action="store_true")

    q = sub.add_parser("queue", help="the demos waiting to be made")
    q.add_argument("--list", action="store_true", help="what is waiting, running and done (the default)")
    q.add_argument("--add", metavar="PATH", help="queue a demo of this checkout")
    q.add_argument("--clear", action="store_true", help="drop every job still waiting")
    q.add_argument("--dry-run", action="store_true")

    w = sub.add_parser("watch", help="make queued demos and the phone's requests, one at a time")
    w.add_argument("--once", action="store_true", help="one job, then stop")
    w.add_argument("--dry-run", action="store_true", help="judge and print; film nothing, claim nothing")
    w.add_argument("--server", default=None, help="claim the phone's requests from this server too")
    w.add_argument("--every", type=float, default=30.0, help="seconds between looks at the queue")
    w.add_argument("--no-model", action="store_true", help="kits without a claude call")
    w.add_argument("--publish-requests", action="store_true",
                   help="send the kit of a demo the PHONE asked for without asking again (starting the worker with this is the yes)")

    h = sub.add_parser("hook", help="the SessionEnd hook: queue a candidate from the hook's JSON")
    h.add_argument("--install", action="store_true", help="print the settings.json entry, change nothing")
    h.add_argument("--dry-run", action="store_true", help="say what it would queue, and queue nothing")
    return ap


def main(argv: list[str]) -> int:
    a = make_parser().parse_args(argv)
    if a.verb == "kit":
        if a.publish:
            from . import publish

            return publish.main(a)
        from . import kit

        return kit.main(a)
    if a.verb == "queue":
        from . import queue

        return queue.main(a)
    if a.verb == "watch":
        from . import watch

        return watch.main(a)
    from . import queue

    return queue.hook_main(a, sys.stdin)
