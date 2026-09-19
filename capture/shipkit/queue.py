"""The demo queue: a session ends, a candidate lands here, and the worker films it if it shipped.

WHERE THE TRIGGER IS, and why there. A demo needs the Mac: a simulator, the checkout, Vision. The
server never films anything (docs/demos.md), and the hook channel's server side cannot see a
checkout. So the seam is the Mac side of the session's end: Claude Code's own `SessionEnd` hook,
which runs ON the machine the session ran on the moment it exits. Two ways in, one queue:

- `python -m capture demo hook` as a SessionEnd command (`hook --install` prints the entry), and
- the served `hook.sh` (docs/hooks-capture.md), which on a Mac that has made a demo before
  (`~/.builder/demos` exists) writes the same candidate with `printf` before it uploads.

Both only WRITE A FILE: a hook runs while Claude Code is exiting and must return at once, never
judge, never build. Judging is the worker's (`judge`, called by `python -m capture demo watch`):

  1. the session ran in a repository (`capture.demo.project.from_checkout`), not excluded;
  2. it SHIPPED something the app shows: a commit inside the session's own window (read from the
     transcript's first and last timestamps, with the 30 minute lookback capture uses for
     attribution) touching a file an app is made of (`UI_FILE`), or the build post's `demo`
     field says there is something to show;
  3. the project is a kind the Mac can run unattended (`expo_ios` or `web`);
  4. the newest commit is not already filmed (unless a person asked), and no demo of it is
     already waiting.

Each skip is a code (spec/shipkit.v1.json `queue_skip`), kept in `skipped/` with its sentence, so
"why did it not make a demo" has an answer on disk.

THE LAYOUT, one directory per state, a job moved between them with `os.replace` (atomic on one
file system), so two workers can never both claim one job and a crash leaves a job somewhere a
person can see it:

    ~/.builder/demos/queue/pending/<when>-<id>.json   waiting
    ~/.builder/demos/queue/running/...                 claimed by the one worker (worker.lock)
    ~/.builder/demos/queue/done|skipped|failed/...     the last `KEEP` of each, with the outcome
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import re
import secrets
import subprocess
import sys

from capture.demo import paths

from . import tables

STATES = ("pending", "running", "done", "skipped", "failed")
KEEP = 50
#: Attribution's lookback (analysis/corpus.py): a commit made up to 30 minutes after the
#: session's last record still belongs to it (the push after the agent stopped).
LOOKBACK_SEC = 30 * 60
#: A file an app is made of: the screens, their styles, the native projects. A commit touching
#: only tests, docs, scripts or the server changes nothing a demo would show.
UI_FILE = re.compile(r"\.(tsx|jsx|vue|svelte|astro|swift|kt|dart|css|scss|sass|less|html|mdx)$|(^|/)(app|screens|components|pages|views|ui|mobile|ios|web|src)/", re.I)
NOT_UI = re.compile(r"(^|/)(__tests__|tests?|spec|docs?|scripts?|server|\.github)/|\.(test|spec)\.[jt]sx?$|\.md$", re.I)
DEMOABLE = ("expo_ios", "web")


def root() -> pathlib.Path:
    return paths.demos_dir() / "queue"


def state_dir(state: str) -> pathlib.Path:
    return paths.private_dir(root() / state)


def now_iso() -> str:
    return dt.datetime.now(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def enqueue(job: dict) -> pathlib.Path:
    """Write a job into `pending/`, atomically: a worker reading the directory never sees half."""
    job = {"id": secrets.token_hex(6), "created_at": now_iso(), **job}
    # Microseconds in the name: the queue is taken in name order, and two jobs in one second
    # ordered by their random ids were taken newest first (FOUND BY A TEST).
    name = f"{dt.datetime.now(dt.UTC).strftime('%Y%m%dT%H%M%S%f')}Z-{job['id']}.json"
    d = state_dir("pending")
    tmp = d / f".{name}.tmp"
    tmp.write_text(json.dumps(job, indent=1) + "\n")
    os.replace(tmp, d / name)
    return d / name


def jobs(state: str) -> list[pathlib.Path]:
    d = root() / state
    return sorted(p for p in d.glob("*.json")) if d.is_dir() else []


def read(p: pathlib.Path) -> dict:
    return json.loads(p.read_text())


def move(p: pathlib.Path, state: str, **outcome) -> pathlib.Path:
    """Move a job to `state`, with what happened written into it."""
    job = read(p)
    job.update(outcome)
    job[f"{state}_at"] = now_iso()
    dest = state_dir(state) / p.name
    tmp = dest.with_name(f".{p.name}.tmp")
    tmp.write_text(json.dumps(job, indent=1) + "\n")
    os.replace(tmp, dest)
    if p != dest:
        p.unlink(missing_ok=True)
    for old in jobs(state)[:-KEEP] if state in ("done", "skipped", "failed") else []:
        old.unlink(missing_ok=True)
    return dest


def claim_next() -> pathlib.Path | None:
    """The oldest pending job, moved to `running/` (by rename, so only one worker gets it)."""
    for p in jobs("pending"):
        dest = state_dir("running") / p.name
        try:
            os.replace(p, dest)
        except FileNotFoundError:
            continue
        return dest
    return None


# ------------------------------------------------------------------------ judging


def session_window(transcript: str | None) -> tuple[float, float] | None:
    """(first, last) record time of a transcript, as epoch seconds, reading only its head and
    tail: a judge must not parse a 78 MB transcript to learn when it started."""
    if not transcript:
        return None
    p = pathlib.Path(transcript)
    if not p.is_file():
        return None

    def stamp(line: bytes) -> float | None:
        m = re.search(rb'"timestamp"\s*:\s*"([^"]+)"', line)
        if not m:
            return None
        try:
            return dt.datetime.fromisoformat(m.group(1).decode().replace("Z", "+00:00")).timestamp()
        except ValueError:
            return None

    with p.open("rb") as f:
        head = f.read(256 * 1024).splitlines()
        f.seek(max(0, p.stat().st_size - 256 * 1024))
        tail = f.read().splitlines()
    first = next((t for t in (stamp(x) for x in head) if t), None)
    last = next((t for t in (stamp(x) for x in reversed(tail)) if t), None)
    return (first, last) if first and last else None


def ui_files(files: list[str]) -> list[str]:
    """The files an app is made of, among these (pure)."""
    return [f for f in files if UI_FILE.search(f) and not NOT_UI.search(f)]


def commits_in(checkout: pathlib.Path, start: float, end: float) -> list[tuple[str, list[str]]]:
    """(sha, files) of every commit on a local branch inside [start, end + lookback]."""
    from capture.tuning import GIT_LOG_REFS

    r = subprocess.run(
        ["git", "-C", str(checkout), "log", *GIT_LOG_REFS, f"--since=@{int(start)}", f"--until=@{int(end + LOOKBACK_SEC)}",
         "--name-only", "--format=@%H"],
        capture_output=True, text=True, timeout=60, check=False,
    )  # fmt: skip
    out: list[tuple[str, list[str]]] = []
    for line in r.stdout.splitlines():
        if line.startswith("@"):
            out.append((line[1:], []))
        elif line.strip() and out:
            out[-1][1].append(line.strip())
    return out


def judge(job: dict) -> tuple[str | None, dict]:
    """(a `queue_skip` code or None, what was found). None means film it. A job the phone or a
    person asked for (`kind` request or manual) is not held to having shipped: they asked."""
    from capture.demo import detect
    from capture.demo import project as pj

    found: dict = {}
    where = job.get("path") or job.get("cwd")
    try:
        project = pj.from_checkout(where) if where else None
    except pj.ProjectError:
        project = None
    if project is None:
        return "not_a_repository", found
    found.update({"key": project.key, "path": str(project.checkout), "name": project.display_name})
    from capture.demo_publish import _excluded_keys

    if project.key in _excluded_keys():
        return "excluded", found
    head = pj.resolve_commit(project.checkout, "HEAD")
    found["commit"] = head
    m = paths.out_dir(project.key) / "manifest.json"
    asked = job.get("kind") in ("request", "manual")
    # A person who asked for a new demo gets one even of a commit already filmed: "Make a new
    # demo" on a kit's screen is asked precisely when that commit's demo exists.
    if head and m.is_file() and not asked:
        try:
            if json.loads(m.read_text()).get("commit") == head:
                return "already_filmed", found
        except ValueError:
            pass
    for p in jobs("pending") + jobs("running"):
        other = read(p)
        if other.get("id") != job.get("id") and other.get("key") == project.key:
            return "already_queued", found
    plan = detect.detect(project, project.checkout, head or "HEAD", None)
    found["kind"] = plan.kind
    if plan.refused or plan.kind not in DEMOABLE:
        return "not_demoable", found
    if asked:
        return None, found
    window = session_window(job.get("transcript"))
    if window is None:
        return "nothing_shipped", found
    shipped = commits_in(project.checkout, *window)
    touched = sorted({f for _, fs in shipped for f in ui_files(fs)})
    found["commits"] = len(shipped)
    found["ui_files"] = touched[:20]
    post = paths.work_dir(project.key) / "shipped.json"
    says_demo = False
    if post.is_file():
        try:
            says_demo = bool(json.loads(post.read_text()).get("demo")) and post.stat().st_mtime >= window[0]
        except ValueError:
            pass
    if not touched and not says_demo:
        return "nothing_shipped", found
    return None, found


# ------------------------------------------------------------------------ the hook


def hook_main(a: argparse.Namespace, stdin) -> int:
    """The SessionEnd hook: read Claude Code's JSON, queue a candidate, exit 0 whatever happens
    (a hook that fails must never block Claude Code from exiting)."""
    if a.install:
        repo_root = pathlib.Path(__file__).resolve().parents[2]
        cmd = f"PYTHONPATH={repo_root} python3 -m capture demo hook"
        print("Add this to ~/.claude/settings.json (merge it into an existing `hooks` block):\n")
        print(json.dumps({"hooks": {"SessionEnd": [{"hooks": [{"type": "command", "command": cmd}]}]}}, indent=2))
        print("\nIt writes one small file per finished session into ~/.builder/demos/queue/pending/ and")
        print("returns. `python -m capture demo watch` decides which ones shipped something and films them.")
        return 0
    try:
        data = json.loads(stdin.read() or "{}")
        if data.get("hook_event_name") not in (None, "SessionEnd"):
            return 0
        job = {"kind": "session_end", "session_id": data.get("session_id"), "transcript": data.get("transcript_path"), "cwd": data.get("cwd")}
        if not job["cwd"]:
            return 0
        if a.dry_run:
            print(json.dumps(job, indent=1))
            return 0
        enqueue(job)
    except Exception as e:  # noqa: BLE001 - a hook never fails the session it ends
        print(f"builda demo hook: {e}", file=sys.stderr)
    return 0


# ------------------------------------------------------------------------ the command


def describe(p: pathlib.Path, state: str) -> str:
    j = read(p)
    what = j.get("name") or j.get("path") or j.get("cwd") or j.get("project_key", "")[:12]
    tail = ""
    if state == "skipped":
        tail = f": {tables.REFUSALS.get(j.get('skip', ''), j.get('skip'))} ({j.get('skip')})"
    elif state == "failed":
        tail = f": {tables.REFUSALS.get(j.get('refusal', ''), j.get('refusal'))} ({j.get('refusal')})"
    elif state == "done":
        tail = f": {j.get('key', '')[:12]}"
    return f"  {j.get('created_at', '')}  {j.get('kind', ''):<12} {what}{tail}"


def main(a: argparse.Namespace) -> int:
    if a.add:
        job = {"kind": "manual", "path": str(pathlib.Path(a.add).expanduser().resolve())}
        if a.dry_run:
            print(json.dumps(job, indent=1))
            return 0
        print(f"queued {enqueue(job).name}; `python -m capture demo watch --once` films it")
        return 0
    if a.clear:
        n = 0
        for p in jobs("pending"):
            if not a.dry_run:
                move(p, "skipped", skip="already_queued", note="cleared by hand")
            n += 1
        print(f"{'would clear' if a.dry_run else 'cleared'} {n} waiting job(s)")
        return 0
    for state in STATES:
        items = jobs(state)
        print(f"{state}: {len(items)}")
        for p in items[-10:]:
            print(describe(p, state))
    return 0
