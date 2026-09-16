"""`python -m drops`: read a link, plan it, cluster a board, or run the watcher.

Every subcommand that costs a model call says so before it makes one, and `resolve` makes none
at all: it is the one to reach for when a link is not being read and the question is whether the
platform published anything.

  resolve URL          what the platform published. No model, no server, no writes.
  plan URL             resolve, then plan it. One model call. Prints the gate's counts.
  find URL             plan, then go looking for what it named, then fetch every source.
  recipe DISH          the ingredients and steps for a dish, from a published page.
  cluster              the board the cached corpus makes, and `--sweep` for the floor.
  watch                the loop: claim drops from the server, resolve them, run what was tapped.
  doctor               what this machine can do: yt-dlp, claude, the cookie door, the server.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from . import cluster as dc
from . import find as dfind
from . import plan as dp
from . import recipe as drecipe
from . import resolve as dr
from . import urls as du
from . import verify as dv


def _print(obj) -> None:
    print(json.dumps(obj, indent=1, ensure_ascii=False, default=str))


def cmd_resolve(args) -> int:
    try:
        r = dr.resolve(args.url, shared_text=args.text or "")
    except du.UrlRefused as e:
        print(f"refused: {e.code}")
        return 1
    _print(r.source_block())
    print(f"\nnotes: {r.notes or 'none'}")
    print(f"refusal: {dr.refusal_for(r) or 'none'}")
    if args.text_out:
        print(f"\n{r.text}")
    return 0


def cmd_plan(args) -> int:
    try:
        r = dr.resolve(args.url, shared_text=args.text or "")
    except du.UrlRefused as e:
        print(f"refused: {e.code}")
        return 1
    refusal = dr.refusal_for(r)
    if refusal:
        print(f"refused: {refusal} ({r.resolver}, notes={r.notes})")
        return 1
    print(f"read {len(r.text)} characters through {r.resolver}; planning")
    try:
        plan, counts = dp.plan_for(r, model=args.model)
    except dp.PlanError as e:
        print(f"refused: {e}")
        return 1
    if args.find:
        dfind.mark_caption_sources(plan)
        filled = dfind.fill_sources(plan, model=args.model)
        checked = dv.verify_plan(plan)
        print(f"found {filled}, verified {checked['verified']} of {checked['checked']}")
    _print(plan)
    print(f"\ngate: {counts}")
    return 0


def cmd_recipe(args) -> int:
    recipe, url = drecipe.find_recipe(args.dish, model=args.model)
    if not recipe:
        print("no published recipe found for that dish")
        return 1
    _print({"found_url": url, **recipe})
    return 0


def cmd_cluster(args) -> int:
    from .tests import corpus_read

    drops = corpus_read.drops()
    if not drops:
        print("no corpus: python3 scripts/drops_corpus.py")
        return 1
    if args.sweep:
        # What the floor is fitted to. A partition that changes at every step is a floor fitted
        # to noise; the one to take is in the middle of the widest run that does not change.
        seen: dict[tuple, list[float]] = {}
        for i in range(1, 26):
            f = round(0.02 * i, 2)
            key = tuple(tuple(c["members"]) for c in dc.board(drops, floor=f))
            seen.setdefault(key, []).append(f)
        for key, floors in sorted(seen.items(), key=lambda kv: -len(kv[1])):
            print(f"{len(key)} clusters over {floors[0]:.2f} to {floors[-1]:.2f} ({len(floors)} steps)")
        print(f"\nthe constant is {dc.MERGE_FLOOR}")
        return 0
    for c in dc.board(drops):
        print(f"{c['label']:<16} {c['size']}")
        for i in c["members"]:
            print(f"    {drops[i]['kind']:<10} {drops[i]['title']}")
    return 0


def cmd_watch(args) -> int:
    from capture.client import Client

    from .runner import Runner

    server = args.server or os.environ.get("BUILDER_SERVER") or "http://127.0.0.1:8000"
    Runner(Client(server), model=args.model).watch(once=args.once)
    return 0


def cmd_doctor(args) -> int:
    import shutil

    print(f"yt-dlp          {dr.have_yt_dlp() or 'not on PATH (oEmbed and OpenGraph only)'}")
    print(f"claude          {shutil.which('claude') or 'not on PATH (nothing can be planned)'}")
    cookies = dr.cookies_from()
    print(f"cookie door     {cookies or 'shut (Instagram will refuse; set BUILDER_DROPS_COOKIES_FROM)'}")
    print(f"schema          {'there' if dp.SCHEMA_PATH.exists() else 'MISSING, run make gen'}")
    print(f"server          {args.server or os.environ.get('BUILDER_SERVER') or 'http://127.0.0.1:8000'}")
    from . import workspace as ws
    from .tests import corpus_read

    print(f"corpus          {len(corpus_read.rows())} links cached")
    repos = ws.known_repos()
    extra = ws.extra_roots()
    print(f"repos           {len(repos)} this machine's transcripts resolved to"
          + (f", {len(extra)} named by {ws.REPO_ROOTS_ENV}" if extra else ""))
    for r in repos[:8]:
        print(f"                {r}")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m drops", description=__doc__)
    ap.add_argument("--model", default=dp.DEFAULT_MODEL)
    ap.add_argument("--server", default=None)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("resolve", help="what the platform published; no model")
    p.add_argument("url")
    p.add_argument("--text", default="", help="whatever the share sheet carried besides the link")
    p.add_argument("--text-out", action="store_true", help="print the resolved text too")
    p.set_defaults(fn=cmd_resolve)

    p = sub.add_parser("plan", help="resolve, then plan it")
    p.add_argument("url")
    p.add_argument("--text", default="")
    p.add_argument("--find", action="store_true", help="also go looking, and fetch every source")
    p.set_defaults(fn=cmd_plan)

    p = sub.add_parser("recipe", help="a published recipe for a dish")
    p.add_argument("dish")
    p.set_defaults(fn=cmd_recipe)

    p = sub.add_parser("cluster", help="the board the cached corpus makes")
    p.add_argument("--sweep", action="store_true", help="every partition over the floor's range")
    p.set_defaults(fn=cmd_cluster)

    p = sub.add_parser("watch", help="claim drops, resolve them, run what was tapped")
    p.add_argument("--once", action="store_true", help="one pass, then stop")
    p.set_defaults(fn=cmd_watch)

    p = sub.add_parser("doctor", help="what this machine can do")
    p.set_defaults(fn=cmd_doctor)

    args = ap.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
