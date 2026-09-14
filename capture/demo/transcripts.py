"""What the project's own Claude Code transcripts say about running it.

Read through capture's reader and nothing else: `discover.iter_root_transcripts` (the root
allowlist), `sessions.load_source` (the reference record parse and the digest events), and
`repo.identity_for` (the `--git-common-dir` resolver). A second transcript reader here would be
a second set of rules for which record is a tool call and which repository it ran in, and the
first one has already been wrong four different ways (CLAUDE.md).

A command belongs to the project when the working directory Claude Code stamped on ITS OWN
record resolves to the project's repository, not when the transcript's dominant repository
does: one sitting `cd`s between repositories (MEASURED: 332 cwd runs in one 2,231 record
sitting), and the commands that built RideGT were typed in a sitting filed under home.

A command WORKED when its tool call has no error result. The digest marks an error from the
harness's own `is_error` flag, or from the shapes `_looks_like_error` accepts. A compound line
that failed counts as a failure for every command in it, because the transcript does not say
which one failed; that makes "worked" the conservative count.

The text is the digest's: secrets masked, 160 characters at most, a multi line command joined.
A command the digest cut short is never offered, because its tail is gone.
"""

from __future__ import annotations

import dataclasses
import functools
import os
import pathlib
import re
import shlex
import subprocess
import sys
from collections.abc import Iterable

from analysis import digest

from .. import repo, sessions
from ..discover import Transcript, iter_root_transcripts

DEFAULT_ROOT = pathlib.Path("~/.claude/projects")

#: Redirections that change nothing about WHAT ran, dropped so `x 2>&1` and `x` are one row.
_REDIRECT = re.compile(r"\s+(?:\d?>>?\s*(?:&\d|/dev/null|\S+)|&>\s*\S+)")
_IMAGE = re.compile(r"\.(png|jpe?g)$", re.IGNORECASE)


@dataclasses.dataclass
class Seen:
    """One simple command, where it ran, and how it went."""

    command: str
    #: Where it ran, relative to the worktree's top (`mobile`, `backend`, `` for the top).
    subdir: str
    ok: int = 0
    failed: int = 0
    last_ts: float = 0.0


@dataclasses.dataclass
class Evidence:
    transcripts_read: int
    transcripts_matched: int
    commands: list[Seen]
    #: Images a Read tool call opened while working in the project: (path, when).
    images: list[tuple[str, float]]
    #: The OTHER repositories these transcripts worked in, as (identity, common root): what the
    #: privacy check refuses to see in this project's demo (`privacy.other_repo_name`).
    others: list[tuple[str, str | None]] = dataclasses.field(default_factory=list)


@functools.lru_cache(maxsize=512)
def _top(cwd: str) -> str | None:
    """The worktree top a cwd sits in (NOT the common root: the subdir is a path inside the
    checkout the command ran in, and a worktree's `mobile/` is the main checkout's too)."""
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
            env={**os.environ, "GIT_OPTIONAL_LOCKS": "0"},
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return r.stdout.strip() if r.returncode == 0 and r.stdout.strip() else None


def normalize(command: str) -> str:
    """The command a row is keyed on: redirections gone, whitespace single."""
    c = _REDIRECT.sub("", " " + command).strip()
    return re.sub(r"\s+", " ", c)


def split_command(text: str, cwd: str, top: str) -> Iterable[tuple[str, str]]:
    """(command, subdir) for each simple command of one shell call, following `cd` the way the
    shell does: within a line (`cd mobile && npx expo run:ios` ran in `mobile`) and across its
    lines (a `cd` on line one holds for line two; FOUND BY A TEST, the first version reset it
    per line). A `cd` out of the checkout ends the call: what ran there is not this project's."""
    here = cwd
    inside = lambda p: p == top or p.startswith(top.rstrip("/") + "/")  # noqa: E731
    for line in digest.shell_lines(text):
        for seg in digest.split_simple(line):
            if "…[+" in seg:  # the digest cut this command: its tail is gone
                return
            try:
                argv = shlex.split(seg)
            except ValueError:
                argv = seg.split()
            if not argv:
                continue
            if argv[0] == "cd":
                if len(argv) == 1:
                    return
                here = os.path.normpath(os.path.join(here, os.path.expanduser(argv[1])))
                if not inside(here):
                    return
                continue
            if not inside(here):
                return
            sub = os.path.relpath(here, top)
            yield normalize(seg), ("" if sub == "." else sub)


def harvest(
    identity: str,
    root: pathlib.Path | None = None,
    transcripts: list[Transcript] | None = None,
    progress: bool = False,
) -> Evidence:
    """Every shell command the project's transcripts ran inside the project, counted."""
    root = (root or DEFAULT_ROOT).expanduser()
    ts_list = transcripts if transcripts is not None else iter_root_transcripts(root)
    rows: dict[tuple[str, str], Seen] = {}
    images: dict[str, float] = {}
    others: dict[str, str | None] = {}
    matched = 0
    for i, t in enumerate(ts_list):
        if progress and i % 20 == 0:
            print(f"  reading transcripts {i}/{len(ts_list)}", file=sys.stderr)
        try:
            src = sessions.load_source(t)
        except (OSError, ValueError) as e:
            if progress:
                print(f"  skipped {t.path.name}: {e}", file=sys.stderr)
            continue
        cwd_at: dict[float, str] = {}
        for r in src.records:
            c = r.get("cwd")
            if isinstance(c, str) and c:
                cwd_at.setdefault(r["ts"], c)
        failed = {e.tool_id for e in src.events if e.kind == "result_error" and e.tool_id}
        hit = False
        for e in src.events:
            if e.kind != "tool":
                continue
            cwd = cwd_at.get(e.ts)
            if not cwd:
                continue
            ident = repo.identity_for(cwd)
            if ident is not None and ident.identity != identity:
                others.setdefault(ident.identity, ident.common_root)
            if ident is None or ident.identity != identity:
                continue
            top = _top(cwd)
            if not top:
                continue
            hit = True
            if e.tool in ("Read",) and e.path and _IMAGE.search(e.path):
                images[e.path] = max(images.get(e.path, 0.0), e.ts)
                continue
            if e.tool not in digest.SHELL_TOOLS:
                continue
            bad = e.tool_id in failed
            for cmd, sub in split_command(e.text, cwd, top):
                if not cmd:
                    continue
                row = rows.setdefault((cmd, sub), Seen(cmd, sub))
                if bad:
                    row.failed += 1
                else:
                    row.ok += 1
                row.last_ts = max(row.last_ts, e.ts)
        matched += hit
    cmds = sorted(rows.values(), key=lambda s: (-s.ok, s.failed, -s.last_ts, s.command))
    return Evidence(
        transcripts_read=len(ts_list),
        transcripts_matched=matched,
        commands=cmds,
        images=sorted(images.items(), key=lambda kv: -kv[1]),
        others=sorted(others.items()),
    )
