"""Where a move runs. Never the person's checkout unless they pointed at it.

Three places, and which one a move gets is decided by its `target`, never by the model:

  `this_machine`   `~/.builder/drops/work/<drop>/` — a scratch directory made for this move.
                   Installing something goes here first and is copied nowhere by this code.
  `new_project`    `~/.builder/drops/projects/<slug>/`, `git init`ed, empty. A scaffold move
                   builds here, so a project that does not work out is one directory to delete.
  `existing_repo`  the repository whose salted key the person CHOSE when they tapped. Resolved
                   by hashing the machine's own repositories and matching, so a key that names
                   nothing on this machine is a refusal (`no_repo_match`) rather than a guess.

`capture/demo/workspace.py` clones rather than touching a checkout, which is right for a demo
that has to be reproducible. A move is the opposite: "add this to RideGT" means RideGT, and
running it in a clone would leave the person with work in a directory they will never look at.
So an `existing_repo` move runs in the checkout, on a branch of its own, and the runner says so
before it starts.
"""

from __future__ import annotations

import json
import os
import pathlib
import re
import subprocess

from capture import repo as crepo

ROOT = pathlib.Path(os.environ.get("BUILDER_DROPS_HOME") or (pathlib.Path.home() / ".builder" / "drops"))
WORK = ROOT / "work"
PROJECTS = ROOT / "projects"

#: Where to look for the person's repositories when resolving a `repo_key`. Deliberately NOT a
#: recursive walk of the home directory: CLAUDE.md records what guessing `~/src`, `~/code`,
#: `~/projects` cost Aider discovery (on a CI runner `~/work` IS the checkout, and discovery
#: read the project's own fixtures as the user's sessions). The source here is the `cwd` the
#: harness itself stamped on the transcripts this machine already holds, which is knowledge.
CLAUDE_PROJECTS = pathlib.Path.home() / ".claude" / "projects"
#: MEASURED on this machine: `cwd` is NOT on the first record. A transcript opens with
#: bookkeeping (`last-prompt`, `mode`, `permission-mode`, `atis-latch`) that carries a session
#: id and nothing else, so a reader that takes the first line and gives up finds zero
#: repositories and reports, with no error, that this machine has none. The scan reads up to
#: HEAD_LINES records and stops at the first one that has a `cwd`, which is well inside the
#: head of every transcript here and nowhere near reading a 78 MB file.
HEAD_BYTES = 262_144
HEAD_LINES = 400


#: Repositories to offer BESIDES the ones the transcripts already resolved to, colon separated.
#:
#: A checkout you made this morning has no Claude Code transcripts in it yet, so discovery cannot
#: know about it, and "add this to that repo" is exactly the move you want on a repo you have just
#: started. This is the door for that, and it is a door rather than a guess: CLAUDE.md records what
#: guessing `~/src`, `~/code`, `~/projects` cost Aider discovery, so nothing here is inferred.
REPO_ROOTS_ENV = "BUILDER_DROPS_REPO_ROOTS"


def extra_roots() -> list[pathlib.Path]:
    raw = os.environ.get(REPO_ROOTS_ENV) or ""
    return [pathlib.Path(p).expanduser() for p in raw.split(":") if p.strip()]


def known_repos(root: pathlib.Path | None = None) -> list[pathlib.Path]:
    """Every repository this machine's own transcripts resolved to, plus any named by
    `BUILDER_DROPS_REPO_ROOTS`, deduped by common root.

    `--git-common-dir`, never `--show-toplevel`: CLAUDE.md measured that six of thirteen project
    directories on this machine are worktrees of one repository, and `--show-toplevel` fragments
    that into seven.
    """
    base = root or CLAUDE_PROJECTS
    cwds: list[str] = []
    seen_cwd: set[str] = set()
    for jsonl in sorted(base.glob("*/*.jsonl")) if base.is_dir() else []:
        cwd = _first_cwd(jsonl)
        if isinstance(cwd, str) and cwd and cwd not in seen_cwd:
            seen_cwd.add(cwd)
            cwds.append(cwd)

    out: list[pathlib.Path] = []
    seen_root: set[str] = set()
    for cwd in [str(p) for p in extra_roots()] + cwds:
        common = _git_common_root(cwd)
        if common and common not in seen_root:
            seen_root.add(common)
            out.append(pathlib.Path(common))
    return out


def _first_cwd(jsonl: pathlib.Path) -> str | None:
    """The first `cwd` in a transcript's head, or None."""
    try:
        with jsonl.open("rb") as fh:
            head = fh.read(HEAD_BYTES)
    except OSError:
        return None
    for line in head.split(b"\n")[:HEAD_LINES]:
        if b'"cwd"' not in line:
            continue
        try:
            cwd = json.loads(line).get("cwd")
        except (ValueError, json.JSONDecodeError):
            continue
        if isinstance(cwd, str) and cwd:
            return cwd
    return None


def _git_common_root(cwd: str) -> str | None:
    if not pathlib.Path(cwd).is_dir():
        return None
    r = subprocess.run(
        ["git", "-C", cwd, "rev-parse", "--git-common-dir"],
        capture_output=True, text=True, check=False, stdin=subprocess.DEVNULL,
    )
    if r.returncode != 0:
        return None
    gitdir = pathlib.Path(r.stdout.strip())
    if not gitdir.is_absolute():
        gitdir = pathlib.Path(cwd) / gitdir
    try:
        return str(gitdir.resolve().parent)
    except OSError:
        return None


def repo_for_key(key: str, candidates: list[pathlib.Path] | None = None) -> pathlib.Path | None:
    """The checkout whose salted key is `key`, or None.

    The key is an HMAC under a global, non secret pepper (`capture/identity.repo_hash`), so
    this is a forward computation over the machine's own repositories and not a lookup table
    the server could hold.
    """
    for path in candidates if candidates is not None else known_repos():
        ident = crepo.identity_for(str(path))
        if ident is not None and ident.hash == key:
            return path
    return None


SLUG = re.compile(r"[^a-z0-9]+")


def slug_of(title: str) -> str:
    s = SLUG.sub("-", (title or "").lower()).strip("-")
    return (s or "drop")[:40]


def scratch(drop_id: str) -> pathlib.Path:
    d = WORK / drop_id[:12]
    d.mkdir(parents=True, exist_ok=True)
    return d


def new_project(title: str) -> pathlib.Path:
    """An empty git repository named after the drop. Never overwrites: a second scaffold of the
    same title gets `-2`, because silently building into a directory that already has somebody's
    work in it is the one outcome there is no undo for."""
    base = PROJECTS / slug_of(title)
    path, n = base, 2
    while path.exists():
        path = base.with_name(f"{base.name}-{n}")
        n += 1
    path.mkdir(parents=True)
    subprocess.run(["git", "init", "-q"], cwd=path, check=False, stdin=subprocess.DEVNULL)
    return path


def branch_for(path: pathlib.Path, slug: str) -> str | None:
    """Put an `existing_repo` move on its own branch. Returns the branch, or None.

    None when the checkout is dirty (a move that started by carrying somebody's uncommitted work
    onto a new branch is a move they cannot undo), and None when the switch did not take, which
    is checked by asking git rather than by assuming the command worked.
    """
    dirty = subprocess.run(
        ["git", "status", "--porcelain"], cwd=path, capture_output=True, text=True,
        check=False, stdin=subprocess.DEVNULL,
    )
    if dirty.returncode != 0:
        return None
    if dirty.stdout.strip():
        return None
    name = f"drops/{slug}"
    subprocess.run(["git", "switch", "-c", name], cwd=path, capture_output=True,
                   check=False, stdin=subprocess.DEVNULL)
    # ASK, do not assume. The first version returned the name whatever `git switch` did, so a
    # branch that already existed, a detached HEAD or a repository mid rebase would have run the
    # move on whatever was checked out, having told the person it was on a branch of its own.
    on = subprocess.run(["git", "branch", "--show-current"], cwd=path, capture_output=True,
                        text=True, check=False, stdin=subprocess.DEVNULL)
    return name if on.returncode == 0 and on.stdout.strip() == name else None
