"""`python -m capture demo watch`: the one worker that turns queued jobs into demos and kits.

ONE AT A TIME, ON PURPOSE. Two demo runs at once (two simulators, two Metros, two xcodebuilds)
ran this Mac out of memory before the queue existed. So a worker holds `queue/worker.lock` with
`flock` for its whole life (a second `watch` says so and leaves), takes one job, and runs its
stages as CHILD PROCESSES in order, each with a ceiling: the capture (`python -m capture demo
PATH --yes`), then, when the demo passed its privacy check, the build post
(`python -m analysis shipped`, one model call, skipped with `--no-model`) and the kit
(`python -m capture demo kit`). A child that runs out of memory takes itself down, not the worker.

THE PHONE'S REQUESTS. With `--server` (or a paired Mac's credentials), each loop first claims the
requests the phone made (`POST /v1/demos/requests:claim`, the same shape as `drops watch` claiming
drops), finds the checkout whose key the request names among the repositories this Mac's own
transcripts resolved to (`known_checkouts`), queues it as a `request` job, and reports how it
ended (`POST /v1/demos/requests/{id}:finish`, `done` or `failed` with a code from
spec/shipkit.v1.json `request_refusal`). A request is never filmed from a checkout the Mac has not
worked in: the transcripts are the evidence that the repository is the person's own (run.py
`is_own`), which is also what lets the capture run without a sandbox.

A kit stays on the Mac until `kit --publish` and a yes, the demo channel's rule. The one exception
is opt in, given on the Mac: `watch --publish-requests` sends the kit of a demo the PHONE asked for
(`kit --publish --yes`, the same listing and the same second privacy read), because a person who
tapped "Request a demo" and started the worker with that flag has said yes twice already. A kit the
worker made on its own (a session that ended) is never sent by it. A publish that fails still
finishes the request `done`: the demo and the kit were made, and the phone's line for a done
request with no kit says to publish it on the Mac.

`--dry-run` judges every waiting job and prints what it would do; it claims nothing, moves
nothing and films nothing.
"""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import pathlib
import subprocess
import sys
import time

from capture.demo import paths

from . import queue, tables

#: Ceilings per stage, in seconds. The capture's is the longest step it has measured (a cold
#: xcodebuild of the Builda app, about 25 minutes on this Mac) with room; a kit is a minute.
CAPTURE_TIMEOUT = 60 * 60
SHIPPED_TIMEOUT = 5 * 60
KIT_TIMEOUT = 20 * 60


def say(msg: str) -> None:
    print(msg, flush=True)


def repo_root() -> pathlib.Path:
    return pathlib.Path(__file__).resolve().parents[2]


def child_env() -> dict:
    env = dict(os.environ)
    env["PYTHONPATH"] = str(repo_root()) + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
    return env


def lock() -> object | None:
    """The worker lock, held for the process's life; None when another worker has it."""
    path = paths.private_dir(queue.root()) / "worker.lock"
    f = open(path, "w")  # noqa: SIM115 - held open on purpose
    try:
        fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        f.close()
        return None
    f.write(str(os.getpid()))
    f.flush()
    return f


# ------------------------------------------------------------------------ the server


def known_checkouts() -> dict[str, pathlib.Path]:
    """{project key: checkout} for every repository this Mac's transcripts resolved to."""
    from capture.demo import project as pj

    try:
        from drops.workspace import known_repos
    except ImportError:  # pragma: no cover - the drops package is beside capture in this repo
        return {}
    out: dict[str, pathlib.Path] = {}
    for r in known_repos():
        try:
            out.setdefault(pj.from_checkout(r).key, r)
        except pj.ProjectError:
            continue
    return out


class Requests:
    """The phone's requests for a demo, through the paired Mac's credentials."""

    def __init__(self, server: str):
        from capture.client import Client

        self.client = Client(server)

    def _call(self, method: str, path: str, body: dict | None = None) -> dict:
        from capture.client import HTTPFailure

        status, parsed = self.client._authorized(method, path, body if body is not None else ({} if method == "POST" else None))
        if not 200 <= status < 300:
            raise HTTPFailure(status, json.dumps(parsed))
        return parsed

    def claim(self) -> list[dict]:
        return self._call("POST", "/v1/demos/requests:claim").get("requests") or []

    def pending(self) -> list[dict]:
        return self._call("GET", "/v1/demos/requests?status=queued").get("requests") or []

    def finish(self, request_id: str, status: str, refusal: str | None = None) -> None:
        self._call("POST", f"/v1/demos/requests/{request_id}:finish", {"status": status, "refusal": refusal})


def take_requests(req: Requests, dry_run: bool) -> int:
    """Claim the phone's requests and queue each one whose checkout this Mac has."""
    try:
        got = req.pending() if dry_run else req.claim()
    except Exception as e:  # noqa: BLE001 - a server that is down never stops the local queue
        say(f"  requests: the server did not answer ({e})")
        return 0
    if not got:
        return 0
    checkouts = known_checkouts()
    for r in got:
        path = checkouts.get(r["project_key"])
        if path is None:
            say(f"  request {r['id'][:8]}: no checkout of {r['project_key'][:12]} on this Mac")
            if not dry_run:
                req.finish(r["id"], "failed", "no_checkout")
            continue
        say(f"  request {r['id'][:8]}: {path}" + (" (dry run: not claimed)" if dry_run else ""))
        if not dry_run:
            queue.enqueue({"kind": "request", "request_id": r["id"], "project_key": r["project_key"], "path": str(path), "hue": r.get("hue")})
    return len(got)


# ------------------------------------------------------------------------ one job


def run_child(args: list[str], timeout: int, log: pathlib.Path) -> int:
    with log.open("a") as f:
        f.write(f"\n== {' '.join(args)}\n")
        f.flush()
        try:
            r = subprocess.run(args, stdout=f, stderr=subprocess.STDOUT, timeout=timeout, check=False, env=child_env(), stdin=subprocess.DEVNULL)
        except subprocess.TimeoutExpired:
            f.write(f"\n== ran past {timeout} s\n")
            return 124
    return r.returncode


def work(p: pathlib.Path, no_model: bool, req: Requests | None, publish_to: str | None = None) -> str:
    """Run one claimed job to its end; returns the state it ended in."""
    job = queue.read(p)
    skip, found = queue.judge(job)
    job.update(found)
    p.write_text(json.dumps(job, indent=1) + "\n")
    if skip:
        say(f"  skipped {found.get('name') or job.get('cwd')}: {tables.REFUSALS[skip]} ({skip})")
        queue.move(p, "skipped", skip=skip)
        if req and job.get("request_id"):
            req.finish(job["request_id"], "failed", "excluded" if skip == "excluded" else "not_runnable")
        return "skipped"
    key, path = found["key"], found["path"]
    log = paths.private_dir(paths.work_dir(key)) / "watch.log"
    say(f"  filming {found.get('name')} ({found.get('kind')}, {found.get('commits', 0)} commits, {len(found.get('ui_files') or [])} app files); log {log}")
    rc = run_child([sys.executable, "-m", "capture", "demo", path, "--yes"], CAPTURE_TIMEOUT, log)
    if rc not in (0,):
        code = "privacy_refused" if rc == 3 else "capture_failed"
        say(f"  the capture ended {rc}: {tables.REFUSALS[code]}")
        queue.move(p, "failed", refusal=code, exit=rc)
        if req and job.get("request_id"):
            req.finish(job["request_id"], "failed", code)
        return "failed"
    kit_args = [sys.executable, "-m", "capture", "demo", "kit", path]
    if job.get("hue"):
        kit_args += ["--hue", job["hue"]]
    if no_model:
        kit_args.append("--no-model")
    else:
        post = paths.work_dir(key) / "shipped.json"
        run_child([sys.executable, "-m", "analysis", "shipped", "--repo", pathlib.Path(path).name, "--days", "3", "--out", str(post)], SHIPPED_TIMEOUT, log)
    rc = run_child(kit_args, KIT_TIMEOUT, log)
    if rc != 0:
        queue.move(p, "failed", refusal="kit_failed", exit=rc)
        if req and job.get("request_id"):
            req.finish(job["request_id"], "failed", "kit_failed")
        return "failed"
    if publish_to and job.get("kind") == "request":
        rc = run_child([sys.executable, "-m", "capture", "demo", "kit", path, "--publish", "--yes", "--server", publish_to], KIT_TIMEOUT, log)
        say(f"  {'published the kit' if rc == 0 else f'the publish ended {rc}; the kit is on this Mac (see {log})'}")
    queue.move(p, "done")
    if req and job.get("request_id"):
        req.finish(job["request_id"], "done")
    say(f"  done: {paths.out_dir(key) / 'kit'}")
    return "done"


def main(a: argparse.Namespace) -> int:
    server = a.server or os.environ.get("BUILDER_SERVER")
    req = Requests(server) if server else None
    if a.dry_run:
        if req:
            take_requests(req, dry_run=True)
        for p in queue.jobs("pending"):
            job = queue.read(p)
            skip, found = queue.judge(job)
            verdict = f"skip: {tables.REFUSALS[skip]} ({skip})" if skip else f"film {found.get('path')} ({found.get('kind')})"
            say(f"  {p.name}: {verdict}")
        say("dry run: nothing was claimed, moved or filmed")
        return 0
    held = lock()
    if held is None:
        say("another demo worker is running (one at a time: two simulators at once ran this Mac out of memory)")
        return 0
    say(f"watching {queue.root()}" + (f" and the requests on {server}" if server else ""))
    for p in queue.jobs("running"):
        # A worker that died left its job here; nobody else can be running it (the lock), so
        # it goes back to the front of the queue rather than sitting in `running` forever.
        os.replace(p, queue.state_dir("pending") / p.name)
    while True:
        if req:
            take_requests(req, dry_run=False)
        p = queue.claim_next()
        if p is not None:
            work(p, a.no_model, req, server if getattr(a, "publish_requests", False) else None)
            if a.once:
                return 0
            continue
        if a.once:
            say("nothing waiting")
            return 0
        time.sleep(a.every)
