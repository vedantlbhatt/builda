#!/usr/bin/env python3
"""Before a commit: does any file carry an identifier copied out of this machine's transcripts?

FOUND IN REVIEW (2026-09-13): tests and docstrings written from the owner's own sessions
carried an account id, an OAuth callback code and state, a key file's id, an error page's
request id, a deployment URL and most of an API key, verbatim, into a public repository.
Each was a real value from a real transcript, pasted as a test case or a measurement note.

This reads the files you name (a directory is read file by file; default: every file git
reports as changed or untracked), collects every IDENTIFIER shaped token in them
(`analysis.wrapped._carries_identifier`'s rule: letters and digits interleaved) that is not
plainly code (`code_shaped`), and every URL host, then reports those that also occur in
ANY text file under `~/.claude/projects` (or `--root`): the root transcripts, the subagent
sidecars beside them, and the tool results saved next to both. A hit is a value that came
from somebody's session. Nothing is changed; the exit status is 1 when anything is found and
2 when a named path or the root does not exist, so it can sit in front of a commit.

FOUND IN THE ADVERSARIAL REVIEW (2026-09-13), three ways it said "clean" or cried wolf:

  * a path that does not exist was read as an empty file and the run answered "no
    identifier in 1 files" with exit 0: a typo passed the check;
  * only `<project>/<session>.jsonl` was read, so a value a subagent saw (its sidecar is
    `<project>/<session>/subagents/agent-*.jsonl`) or a tool printed into a saved result
    (`tool-results/*.txt`) was never looked for;
  * `float2x2`, `readUInt32BE`, `Float32Array`, `b64encode`, colour literals and `\\u2019`
    escapes were reported as leaks. They are in every transcript because they are in every
    codebase, and a check that cries leak on correct output is worse than none (CLAUDE.md).

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
        # The vendors' own public endpoints: Apple's push service and site, Google's APIs.
        b"www.apple.com", b"api.push.apple.com", b"api.sandbox.push.apple.com",
        b"appleid.apple.com", b"maps.googleapis.com", b"www.googleapis.com",
        b"oauth2.googleapis.com", b"accounts.google.com", b"fonts.googleapis.com",
        b"fonts.gstatic.com",
    }
)

#: Literals that are code by their punctuation, removed before a file is tokenised: a colour
#: (`#E5484D`, `#0E9F8E80`), a unicode or byte escape (`’`, `\x89`) and a hex number
#: that fits in 64 bits (`0x811c9dc5`). A longer `0x` run (a key, an address) stays.
_CODE_LITERALS = re.compile(
    rb"#[0-9A-Fa-f]{3,8}\b|\\u[0-9A-Fa-f]{4}|\\x[0-9A-Fa-f]{2}|\b0[xX][0-9A-Fa-f]{1,16}\b"
)
#: A bare six digit hex token is a colour written without its `#`; a commit is seven or more.
_COLOUR = re.compile(r"[0-9A-Fa-f]{6}")
_HEX = re.compile(r"(?:0[xX])?[0-9A-Fa-f]+")
#: Prefixes that mark a credential whatever the rest looks like. Never code.
_SECRET_PREFIXES = ("sk-", "sk_", "pk_", "rk_", "ghp_", "gho_", "ghs_", "github_pat_", "xox", "akia", "bck_", "glpat-")
#: A camelCase or snake_case identifier's words: `readUInt32BE` is read, U, Int, BE.
_WORDS = re.compile(r"[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+")
_VOWEL = re.compile(r"[aeiouyAEIOUY]")
#: The most letter and digit switches an identifier a person named can have and still be
#: read as words and widths (`float2x2`, `utf8ToBase64` have three). UNMEASURED JUDGEMENT
#: CALL; the counterweight is that every word must carry a vowel, which a random token's
#: letter runs rarely do (a key's `Qzt`, `ZK`, `Lw`).
_CODE_MAX_SWITCHES = 4


def code_shaped(token: str) -> bool:
    """Is this an identifier somebody named, rather than a value somebody pasted?

    Code: its letters read as words (every word of two or more letters has a vowel, and one
    has three or more letters), few letter and digit switches, not hex, no credential
    prefix. So `readUInt32BE`, `Float32Array`, `ISO8601DateFormatter`, `chacha20poly1305`,
    `claude-3-5-haiku-20241022` are code, and a commit SHA, a UUID, `Q7ZK2M9X4P` and a key
    are not. A bare six digit hex token is a colour. Anything this cannot tell is reported:
    a value wrongly flagged costs a look, a value wrongly passed is published."""
    low = token.lower()
    if low.startswith(_SECRET_PREFIXES):
        return False
    core = re.sub(r"[^0-9A-Za-z]", "", token)
    if _COLOUR.fullmatch(core):
        return True
    if _HEX.fullmatch(core):
        return False
    switches = sum(1 for a, b in zip(core, core[1:]) if a.isalpha() != b.isalpha())
    if switches > _CODE_MAX_SWITCHES:
        return False
    words = [w for run in re.findall(r"[A-Za-z]+", token) for w in _WORDS.findall(run)]
    if not any(len(w) >= 3 and _VOWEL.search(w) for w in words):
        return False
    # Most of its letters are in words that carry a vowel: `verify_rs256_identity_token` is
    # code with one abbreviation in it, `xK9mQzt4Lw` is letters nobody pronounces.
    letters = sum(len(w) for w in words)
    spoken = sum(len(w) for w in words if _VOWEL.search(w))
    return 2 * spoken > letters


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


def _files_under(paths: list[pathlib.Path]) -> list[pathlib.Path]:
    """Every file named, and every file under a directory named."""
    out: list[pathlib.Path] = []
    for p in paths:
        if p.is_dir():
            out.extend(sorted(f for f in p.rglob("*") if f.is_file()))
        else:
            out.append(p)
    return out


#: Written by a package manager, never by a person copying out of a session: every token in
#: one is a public package's version, wheel tag or integrity hash.
LOCK_FILES = frozenset(
    {"bun.lock", "bun.lockb", "uv.lock", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
     "Podfile.lock", "Cargo.lock", "poetry.lock", "Package.resolved"}
)


def _candidates(paths: list[pathlib.Path]) -> dict[bytes, set[str]]:
    """Identifier shaped tokens that are not code, and URL hosts, each with the files it
    appears in."""
    found: dict[bytes, set[str]] = {}
    for p in paths:
        if p.name in LOCK_FILES:
            continue
        try:
            data = p.read_bytes()
        except OSError:
            continue
        rel = str(p.relative_to(REPO)) if p.is_relative_to(REPO) else str(p)
        for tok in _TOKEN.findall(_CODE_LITERALS.sub(b" ", data)):
            text = tok.decode("ascii", "ignore")
            core = re.sub(r"[^A-Za-z0-9]", "", text)
            if wrapped._interleaved(core) and not code_shaped(text):
                found.setdefault(tok, set()).add(rel)
        for host in _HOST.findall(data):
            if host.lower() not in _COMMON_HOSTS:
                found.setdefault(host, set()).add(rel)
    return found


#: What a transcript store writes as text: the transcripts and sidecars (`.jsonl`), their
#: metadata (`.json`), saved tool results (`.txt`) and notes (`.md`). Images and PDFs are
#: not read: a token found in their bytes is noise.
TEXT_SUFFIXES = frozenset({".jsonl", ".json", ".txt", ".md"})


def transcript_files(root: pathlib.Path) -> list[pathlib.Path]:
    """Every text file under `root`, at any depth: a value a subagent saw lives only in its
    sidecar, and a long tool result only in `tool-results/`."""
    return sorted(f for f in root.rglob("*") if f.suffix in TEXT_SUFFIXES and f.is_file())


def _transcript_tokens(root: pathlib.Path, wanted: set[bytes]) -> dict[bytes, int]:
    """How many transcript files each wanted token occurs in."""
    hits: dict[bytes, int] = {}
    if not wanted:
        return hits
    for f in transcript_files(root):
        try:
            data = f.read_bytes()
        except OSError:
            continue
        present = set(_TOKEN.findall(data)) | set(_HOST.findall(data))
        for tok in wanted & present:
            hits[tok] = hits.get(tok, 0) + 1
    return hits


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("files", nargs="*", help="files or directories to check (default: git's changed and untracked files)")
    ap.add_argument("--root", default="~/.claude/projects", help="where the transcripts are")
    a = ap.parse_args(argv)
    named = [pathlib.Path(f).expanduser().resolve() for f in a.files]
    missing = [p for p in named if not p.exists()]
    if missing:
        for p in missing:
            print(f"no file or directory at {p}", file=sys.stderr)
        return 2
    root = pathlib.Path(a.root).expanduser()
    if not root.is_dir():
        print(f"no transcripts at {root}: nothing was checked", file=sys.stderr)
        return 2
    paths = _files_under(named) if named else _changed_files()
    found = _candidates(paths)
    hits = _transcript_tokens(root, set(found))
    if not hits:
        print(f"no identifier from {root} in {len(paths)} files")
        return 0
    for tok, n in sorted(hits.items(), key=lambda kv: (-kv[1], kv[0])):
        where = ", ".join(sorted(found[tok]))
        print(f"{tok.decode('ascii', 'replace')}  in {n} transcript files  and in {where}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
