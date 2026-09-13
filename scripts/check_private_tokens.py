#!/usr/bin/env python3
"""Before a commit: does any file carry an identifier copied out of this machine's transcripts?

FOUND IN REVIEW (2026-09-13): tests and docstrings written from the owner's own sessions
carried an account id, an OAuth callback code and state, a key file's id, an error page's
request id, a deployment URL and most of an API key, verbatim, into a public repository.
Each was a real value from a real transcript, pasted as a test case or a measurement note.

This reads the files you name (default: every file git reports as changed or untracked),
collects every IDENTIFIER shaped token in them (`analysis.wrapped._carries_identifier`'s
rule: letters and digits interleaved) and every URL host, then reports those that also
occur in a root transcript under `~/.claude/projects` (or `--root`). A hit is a value that
came from somebody's session. Nothing is changed; the exit status is 1 when anything is
found, so it can sit in front of a commit.

    python3 scripts/check_private_tokens.py
    python3 scripts/check_private_tokens.py analysis/tests/test_wrapped.py --root ~/.claude/projects
"""

from __future__ import annotations

import argparse
import pathlib
import re
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from analysis import wrapped  # noqa: E402  (the one identifier rule)

#: Alphanumeric runs long enough to be a key, an id or a code.
_TOKEN = re.compile(rb"[A-Za-z0-9][A-Za-z0-9_\-]{5,}")
#: A host in a URL: a deployment's name is as private as its key.
_HOST = re.compile(rb"https?://([A-Za-z0-9.\-]+\.[A-Za-z]{2,})")
#: Hosts every transcript and every repository names; never a finding.
_COMMON_HOSTS = frozenset(
    {
        b"github.com", b"localhost", b"example.com", b"example.edu", b"api.anthropic.com",
        b"docs.anthropic.com", b"claude.ai", b"code.claude.com", b"docs.claude.com",
        b"pypi.org", b"npmjs.com", b"www.npmjs.com", b"registry.npmjs.org", b"developer.apple.com",
        b"apps.apple.com", b"expo.dev", b"docs.expo.dev", b"vercel.com", b"railway.app",
        b"www.w3.org", b"json-schema.org", b"raw.githubusercontent.com", b"img.shields.io",
    }
)


def _changed_files() -> list[pathlib.Path]:
    out = subprocess.run(
        ["git", "status", "--porcelain", "--untracked-files=all"],
        cwd=REPO,
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    paths = []
    for line in out.splitlines():
        name = line[3:].split(" -> ")[-1].strip()
        p = REPO / name
        if p.is_file():
            paths.append(p)
    return paths


def _candidates(paths: list[pathlib.Path]) -> dict[bytes, set[str]]:
    """Identifier shaped tokens and URL hosts, each with the files it appears in."""
    found: dict[bytes, set[str]] = {}
    for p in paths:
        try:
            data = p.read_bytes()
        except OSError:
            continue
        rel = str(p.relative_to(REPO)) if p.is_relative_to(REPO) else str(p)
        for tok in _TOKEN.findall(data):
            core = re.sub(rb"[^A-Za-z0-9]", b"", tok)
            if wrapped._interleaved(core.decode("ascii", "ignore")):
                found.setdefault(tok, set()).add(rel)
        for host in _HOST.findall(data):
            if host.lower() not in _COMMON_HOSTS:
                found.setdefault(host, set()).add(rel)
    return found


def _transcript_tokens(root: pathlib.Path, wanted: set[bytes]) -> dict[bytes, int]:
    """How many root transcripts each wanted token occurs in."""
    hits: dict[bytes, int] = {}
    for f in sorted(root.glob("*/*.jsonl")):
        try:
            data = f.read_bytes()
        except OSError:
            continue
        present = set(_TOKEN.findall(data)) | set(_HOST.findall(data))
        for tok in wanted & present:
            hits[tok] = hits.get(tok, 0) + 1
    return hits


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("files", nargs="*", help="files to check (default: git's changed and untracked files)")
    ap.add_argument("--root", default="~/.claude/projects", help="where the transcripts are")
    a = ap.parse_args()
    paths = [pathlib.Path(f).resolve() for f in a.files] if a.files else _changed_files()
    found = _candidates(paths)
    root = pathlib.Path(a.root).expanduser()
    hits = _transcript_tokens(root, set(found))
    if not hits:
        print(f"no identifier from {root} in {len(paths)} files")
        return 0
    for tok, n in sorted(hits.items(), key=lambda kv: (-kv[1], kv[0])):
        where = ", ".join(sorted(found[tok]))
        print(f"{tok.decode('ascii', 'replace')}  in {n} transcripts  and in {where}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
