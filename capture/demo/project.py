"""Which project a demo is of, and the key the phone knows it by.

The key is `RepoIdentity.hash`: the HMAC of the normalized origin under the global pepper,
exactly what every session upload carries as `repo_hash` and what the phone's Projects screen
keys a project by (`capture/repo.py`, `capture/identity.py`). A second derivation here would
be a second definition of the same number, and a demo filed under a key the phone never
shows is invisible with no error anywhere; `test_demo_manifest` pins the two together.

The private names are what the privacy check refuses to see on screen: the origin's name
(`gt-transit`), its `owner/name`, and the folder names on disk (`RideGT`, `builder-overnight`),
because CLAUDE.md's rule is that the display name comes from the origin and never the folder,
and a person reading a demo would recognise either.
"""

from __future__ import annotations

import dataclasses
import os
import pathlib
import re
import subprocess

from .. import repo


class ProjectError(Exception):
    """A project this command cannot key: not a git repository, or a URL it will not clone."""


@dataclasses.dataclass(frozen=True)
class Project:
    identity: str
    key: str
    #: The person's checkout, READ ONLY: detection reads files in it, nothing builds or runs
    #: there. None for a `--repo` URL, which is cloned straight into the work dir.
    checkout: pathlib.Path | None
    #: The `--repo` URL with any credentials removed, or None.
    url: str | None
    #: Names that must not appear on screen (`privacy.private_names`).
    names: tuple[str, ...]

    @property
    def display_name(self) -> str:
        """The origin's name, else the folder's (a repository with no origin is keyed by its root
        commit, which is no name for a person to read)."""
        if self.identity.startswith("localroot:"):
            return self.names[0] if self.names else "project"
        return repo.display_name(self.identity) or (self.names[0] if self.names else "project")


def _git(args: list[str], cwd: pathlib.Path) -> str | None:
    try:
        r = subprocess.run(
            ["git", *args],
            cwd=str(cwd),
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
            env={**os.environ, "GIT_OPTIONAL_LOCKS": "0"},
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return r.stdout.strip() if r.returncode == 0 else None


def names_for(identity: str, folders: list[str]) -> tuple[str, ...]:
    """The private names, most specific first, each once (case folded for the dedupe)."""
    out: list[str] = []
    if not identity.startswith("localroot:"):
        path = identity.split("/", 1)[1] if "/" in identity else ""
        if path:
            out.append(path)  # owner/name
        name = repo.display_name(identity)
        if name:
            out.append(name)
    out.extend(f for f in folders if f)
    seen: set[str] = set()
    kept = []
    for n in out:
        if n.lower() not in seen:
            seen.add(n.lower())
            kept.append(n)
    return tuple(kept)


def from_checkout(path: str | os.PathLike) -> Project:
    p = pathlib.Path(path).expanduser().resolve()
    if not p.is_dir():
        raise ProjectError(f"no directory at {p}")
    ident = repo.identity_for(str(p))
    if ident is None:
        raise ProjectError(
            f"{p} is not inside a git repository with a commit: a demo is kept per repository, "
            "under the key its sessions upload with"
        )
    top = _git(["rev-parse", "--show-toplevel"], p)
    folders = []
    if top:
        folders.append(pathlib.Path(top).name)
    if ident.common_root:
        folders.append(pathlib.Path(ident.common_root).name)
    return Project(
        identity=ident.identity,
        key=ident.hash,
        checkout=pathlib.Path(top) if top else p,
        url=None,
        names=names_for(ident.identity, folders),
    )


_URL = re.compile(r"^https://(github\.com|gitlab\.com|bitbucket\.org)/[\w.-]+/[\w.-]+?(\.git)?/?$")


def from_url(url: str) -> Project:
    """`--repo https://github.com/owner/name`. HTTPS only, and only the three hosts whose
    paths `normalize_origin` folds case on: a URL the phone would key differently from the
    same repository's sessions is a demo nobody finds."""
    clean = url.strip()
    # Credentials in a URL are not identity (`normalize_origin` strips them too), and are never
    # kept: the clone uses the URL without them and the person's git credential helper.
    clean = re.sub(r"^https://[^/@]+@", "https://", clean)
    if not _URL.match(clean):
        raise ProjectError(
            "--repo takes an https URL of a repository on github.com, gitlab.com or "
            f"bitbucket.org, like https://github.com/owner/name (got {url!r})"
        )
    norm = repo.normalize_origin(clean)
    if not norm:
        raise ProjectError(f"could not read a repository out of {url!r}")
    ident = repo.RepoIdentity(identity=norm, basis="origin", common_root=None)
    return Project(
        identity=norm,
        key=ident.hash,
        checkout=None,
        url=clean.rstrip("/"),
        names=names_for(norm, [repo.display_name(norm) or ""]),
    )


def resolve_commit(checkout: pathlib.Path, ref: str) -> str | None:
    return _git(["rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}"], checkout)
