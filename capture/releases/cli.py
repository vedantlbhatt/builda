"""`python -m capture release draft|check`: release drafts for the phone, made on this Mac.

    python -m capture release draft [PATH | --key KEY] [--no-model] [--dry-run]
        draft a release of this project now (trigger `asked`), print it and, unless a dry run,
        send it as the project's one draft, which the owner edits and publishes on the phone
    python -m capture release check [--dry-run] [--no-model]
        every project whose owner turned drafts on, once: a draft where a trigger fires. The demo
        worker (`python -m capture demo watch --server URL`) runs this at most every ten minutes.

`--server URL` (or `BUILDER_SERVER`, or `BUILDER_API_URL`) names the server; the paired Mac's
credentials are used. A dry run reads the server to count and writes and sends nothing.

Answered before capture/cli.py's own parser, as the ship kit's verbs are (`claims`).
"""

from __future__ import annotations

import argparse
import os
import sys

from . import draft


def claims(argv: list[str]) -> bool:
    """Whether a `python -m capture` command line is this one: `release` first."""
    return len(argv) >= 1 and argv[0] == "release"


def make_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="python -m capture release", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="verb", required=True)

    d = sub.add_parser("draft", help="draft a release of this project now, and send it to the phone")
    d.add_argument("path", nargs="?", default=None, help="the project's checkout (default: the current directory)")
    d.add_argument("--key", help="the project's 64 hex key, instead of a checkout")
    d.add_argument("--no-model", action="store_true", help="the rules' words alone, no claude call")
    d.add_argument("--dry-run", action="store_true", help="print the draft; send and record nothing")
    d.add_argument("--server", default=None)

    c = sub.add_parser("check", help="every project with drafts on, once: a draft where a trigger fires")
    c.add_argument("--no-model", action="store_true", help="the rules' words alone, no claude call")
    c.add_argument("--dry-run", action="store_true", help="say what would be drafted; send and record nothing")
    c.add_argument("--server", default=None)
    return ap


def server_of(arg: str | None) -> str:
    from capture import client as cl

    return (arg or os.environ.get("BUILDER_SERVER") or os.environ.get("BUILDER_API_URL") or cl.DEFAULT_SERVER).rstrip("/")


def show(out: dict, say=print) -> None:
    """A draft as a person reads it in a terminal, and what became of it."""
    if out.get("note"):
        say(f"  {out['note']}")
    w, f = out.get("words"), out.get("facts")
    if w is None:
        say(draft.line(out).strip())
        return
    say(f"release draft ({out['trigger']}, {w.source} words)")
    say(f"  title       {w.title}")
    say(f"  notes       {w.notes or '(none)'}")
    for h in w.highlights:
        say(f"  highlight   {h}")
    if f is not None:
        since = "so far, no release published yet" if f.published_id is None else "since the last published release"
        say(f"  commits     {f'{f.commits} {since}' if f.commits is not None else 'not counted: no checkout of it on this Mac'}")
        trailer = f"version {f.trailer_version}" if f.trailer_version else ("published" if f.has_trailer else "none published")
        say(f"  trailer     {trailer}")
    for d in w.dropped:
        say(f"  left out    a {d['what']} ({d['code']}): {d['text']!r}")
    if w.no_model:
        say(f"  no model    {w.no_model}")
    st = out.get("status")
    if st == "dry_run":
        say("dry run: nothing was sent and nothing was recorded")
    elif st == "drafted":
        say("sent: it is the project's draft on the phone now" + (", in place of the one that was there" if out.get("replaced") else ""))
    else:
        say(draft.line(out).strip())


def main(argv: list[str]) -> int:
    from capture import client as cl

    a = make_parser().parse_args(argv)
    api = draft.Api(server_of(a.server))
    if a.verb == "check":
        outs = draft.check(api, dry_run=a.dry_run, use_model=not a.no_model)
        for o in outs:
            if o.get("words") is not None:
                show(o)
        n = sum(1 for o in outs if o.get("status") == "drafted")
        print(f"{len(outs)} {'project' if len(outs) == 1 else 'projects'} with drafts on, {n} drafted"
              + (" (dry run: nothing was sent or recorded)" if a.dry_run else ""))  # fmt: skip
        return 0
    if a.key:
        from capture.shipkit.watch import known_checkouts

        key = a.key.strip().lower()
        checkout = known_checkouts().get(key)
        if checkout is None:
            print("no checkout on this Mac is this key's: the draft counts no commits and reads only the build post", file=sys.stderr)
    else:
        from capture.demo import project as pj

        try:
            project = pj.from_checkout(a.path or ".")
        except pj.ProjectError as e:
            print(f"Refused: {e}", file=sys.stderr)
            return 2
        key, checkout = project.key, project.checkout
    try:
        out = draft.run_one(api, key, checkout, asked=True, dry_run=a.dry_run, use_model=not a.no_model)
    except ValueError as e:
        print(f"Refused: {e}", file=sys.stderr)
        return 2
    except cl.NotPaired as e:
        print(str(e), file=sys.stderr)
        return 3
    except (cl.HTTPFailure, OSError) as e:
        print(f"the server did not answer: {e}", file=sys.stderr)
        return 4
    show(out)
    return 0 if out.get("status") in ("drafted", "dry_run") else 1
