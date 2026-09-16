#!/usr/bin/env python3
"""Resolve and plan every link in drops/tests/corpus/urls.txt, and cache the answers.

WHY A REAL CORPUS AND NOT FIXTURES. Every constant in the clustering (`drops/cluster.py`) has
to come from a measurement, the way every constant in `Tuning.swift` does, and a similarity
floor fitted to captions somebody wrote to pass it is a floor that means nothing. These are
public posts by strangers: four pasta recipes that should cluster, five editor tips that should
cluster, one post about Claude skills, one about shipping a SaaS, and one about dogs that
should cluster with nothing and be `unknown`.

NOT PART OF `make gen` AND NOT A CI GATE. It calls the network and `claude -p`, so it is run by
hand and its output is committed. `--refresh` re-reads a link that is already cached.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from drops import plan as dp  # noqa: E402
from drops import resolve as dr  # noqa: E402
from drops import urls as du  # noqa: E402

HERE = ROOT / "drops" / "tests" / "corpus"
URLS = HERE / "urls.txt"


def key_for(url: str) -> str:
    return hashlib.sha1(url.encode()).hexdigest()[:10]


def load_urls() -> list[str]:
    return [
        line.strip()
        for line in URLS.read_text().splitlines()
        if line.strip() and not line.startswith("#")
    ]


def one(url: str, *, model: str) -> dict:
    row: dict = {"url": url}
    try:
        r = dr.resolve(url)
    except du.UrlRefused as e:
        return {**row, "refusal": e.code, "source": None, "plan": None, "text": ""}
    row["source"] = r.source_block()
    row["notes"] = r.notes
    row["text"] = r.text
    refusal = dr.refusal_for(r)
    if refusal:
        return {**row, "refusal": refusal, "plan": None}
    try:
        plan, counts = dp.plan_for(r, model=model)
    except dp.PlanError as e:
        return {**row, "refusal": str(e).split(":")[0], "plan": None}
    return {**row, "refusal": None, "plan": plan, "counts": counts}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="re-read links already cached")
    ap.add_argument("--model", default=dp.DEFAULT_MODEL)
    ap.add_argument("--only", default="", help="substring filter over the urls")
    args = ap.parse_args()

    urls = [u for u in load_urls() if args.only in u]
    print(f"{len(urls)} links")
    for i, url in enumerate(urls, 1):
        out = HERE / f"{key_for(url)}.json"
        if out.exists() and not args.refresh:
            row = json.loads(out.read_text())
            print(f"  {i:2d}. cached   {row.get('plan', {}).get('kind') if row.get('plan') else row.get('refusal')}  {url}")
            continue
        t = time.time()
        row = one(url, model=args.model)
        out.write_text(json.dumps(row, indent=1, ensure_ascii=False) + "\n")
        kind = row["plan"]["kind"] if row.get("plan") else f"REFUSED {row.get('refusal')}"
        moves = len(row["plan"]["moves"]) if row.get("plan") else 0
        print(f"  {i:2d}. {time.time() - t:5.1f}s  {kind:<12} {moves} moves  {url}")


if __name__ == "__main__":
    main()
