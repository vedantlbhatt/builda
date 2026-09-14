"""Stage 2: a place to build and run that is not the person's checkout.

NEVER the checkout. A demo run installs dependencies, generates native projects, writes build
products and starts servers; any of that in the tree a person is working in would be their
problem the next time they ran `git status`. So the chosen commit is cloned into
`~/.builder/demos/work/<key>/src` with `git clone --local` (hard links to the object store,
about a second for this repository), or a `--repo` URL is cloned there, and everything
happens in the clone.

What the clone is made WITHOUT, each named in the run's output:

* every `.env*` file. Git only carries tracked files, so an untracked `.env` never arrives, and a
  tracked one (`.env.example` is common) is left out of the work tree by git's sparse checkout
  (`SPARSE`), so it is never a file in the clone at all; any that turns up anyway is deleted
  unopened (a file this package never opens cannot leak).
* analytics and crash reporting keys: a PostHog project key or a Sentry DSN written into a
  tracked file is blanked in the clone, and an Android `google-services.json` (Firebase keys an
  iOS or web demo does not use) is never checked out. A demo run is not a user session, and a key
  left in would send the demo to the project's dashboards (docs/research/demo-capture.md section
  4: the simulator app is not a process the sandbox governs, so the key has to be absent).

Every child process runs under an environment ALLOWLIST (`clean_env`), the rule
`scripts/overnight_stack.sh` follows with `env -i`: a DATABASE_URL, an API key or a capture key
exported in the person's shell for other work never reaches a project's build.

Dev servers run under Anthropic's sandbox runtime (`srt`) when it is installed: writes limited
to the work dir and the package caches, reads of `~/.ssh`, cloud credentials and Builda's own
tokens denied. When it is not installed the run says so in plain words and continues.
"""

from __future__ import annotations

import dataclasses
import json
import os
import pathlib
import re
import shutil
import subprocess

from . import paths
from .detect import ANALYTICS_ENV, _is_env_file
from .project import Project

#: The environment every child process starts from. Nothing else of the caller's crosses.
ENV_ALLOW = ("PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "USER", "LOGNAME", "SHELL", "DEVELOPER_DIR", "TERM")

#: Keys that are analytics by their SHAPE, wherever they are written. PostHog project keys are
#: `phc_` and 43 characters (MEASURED on RideGT's mobile/.env.example shape, and PostHog's docs);
#: a Sentry DSN is a URL with a 32 hex public key before `@` and an ingest host after it.
ANALYTICS_VALUES = (
    ("PostHog project key", re.compile(r"\bphc_[A-Za-z0-9]{20,}\b")),
    ("Sentry DSN", re.compile(r"https://[0-9a-f]{32}@[\w.-]*ingest[\w.-]*sentry\.io/\d+")),
)
#: Files that only configure an analytics or push SDK for a platform the demo does not run.
ANALYTICS_FILES = ("google-services.json",)
_TEXT_EXT = (".json", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".plist", ".xml", ".yaml", ".yml", ".toml", ".html")
_SCAN_SKIP = frozenset({".git", "node_modules", "Pods", "build", "dist", ".expo", "DerivedData", ".venv", "venv"})


class WorkspaceError(Exception):
    pass


@dataclasses.dataclass
class Workspace:
    root: pathlib.Path
    src: pathlib.Path
    commit: str
    #: Plain sentences naming what the clone was made without.
    stripped: list[str]
    #: True when the clone already existed at this commit and was reused.
    reused: bool = False

    @property
    def build_dir(self) -> pathlib.Path:
        return self.root / "build"

    @property
    def logs(self) -> pathlib.Path:
        return paths.private_dir(self.root / "logs")

    def storyboard_path(self) -> pathlib.Path:
        return self.root / "storyboard.json"


def clean_env(extra: dict[str, str] | None = None) -> dict[str, str]:
    """The allowlisted environment, plus the storyboard's own values. An analytics name is
    dropped even when a storyboard asks for it: a demo build is made without them."""
    env = {k: os.environ[k] for k in ENV_ALLOW if k in os.environ}
    env.setdefault("LANG", "en_US.UTF-8")
    for k, v in (extra or {}).items():
        if ANALYTICS_ENV.match(k):
            continue
        env[k] = v
    return env


def _git(args: list[str], cwd: pathlib.Path | None = None, timeout: int = 600) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", "-c", "advice.detachedHead=false", *args],
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
        env=clean_env({"GIT_TERMINAL_PROMPT": "0", "GIT_OPTIONAL_LOCKS": "0"}),
    )


def _head(src: pathlib.Path) -> str | None:
    r = _git(["rev-parse", "HEAD"], src)
    return r.stdout.strip() if r.returncode == 0 else None


#: The work tree the clone never has: git's sparse checkout (gitignore syntax, non cone mode)
#: leaves these paths out of every checkout, so a tracked `.env.example` or an Android Firebase
#: config is in the object store and never a file on disk. MEASURED on RideGT: both are tracked
#: (`ads-portal/.env.example`, `mobile/google-services.json`) and `git status` stays clean.
SPARSE = ("/*", "!.env", "!.env.*", "!google-services.json")


def clone(project: Project, commit: str | None, root: pathlib.Path) -> tuple[pathlib.Path, str, bool]:
    """Clone (or refresh) `root/src` at `commit`. Returns (src, the commit, reused).

    Every run checks the commit out again with `--force`, which puts back any tracked file an
    earlier run blanked, so what the clone is made without is decided (and said) on every run
    rather than inherited from the last one. Untracked build products (node_modules, ios/,
    Pods) are left where they are: they are the per commit cache."""
    src = root / "src"
    reused = False
    if (src / ".git").exists():
        reused = True
        if not (commit and _head(src) == commit):
            fetch = _git(["fetch", "--quiet", "origin"], src)
            if fetch.returncode != 0:
                raise WorkspaceError(f"git fetch in the work dir failed: {fetch.stderr.strip()[:300]}")
    else:
        paths.private_dir(root)
        if project.checkout is not None:
            r = _git(["clone", "--local", "--no-checkout", "--quiet", str(project.checkout), str(src)])
        elif project.url:
            r = _git(["clone", "--no-checkout", "--quiet", "--filter=blob:none", project.url, str(src)], timeout=1800)
        else:
            raise WorkspaceError("a project needs a checkout or a URL")
        if r.returncode != 0:
            raise WorkspaceError(f"git clone failed: {r.stderr.strip()[:300]}")
    r = _git(["sparse-checkout", "set", "--no-cone", *SPARSE], src)
    if r.returncode != 0:
        raise WorkspaceError(f"git sparse-checkout in the work dir failed: {r.stderr.strip()[:300]}")
    target = commit or "origin/HEAD"
    r = _git(["checkout", "--quiet", "--detach", "--force", target], src)
    if r.returncode != 0:
        raise WorkspaceError(f"git checkout {target} in the work dir failed: {r.stderr.strip()[:300]}")
    head = _head(src)
    if not head:
        raise WorkspaceError("the clone has no HEAD after checkout")
    return src, head, reused


def strip_env_files(src: pathlib.Path) -> list[str]:
    """Every `.env*` path the repository tracks (the sparse checkout never writes them), and
    any `.env*` file in the clone anyway, deleted WITHOUT BEING OPENED."""
    tracked = set()
    r = _git(["ls-files", "-z"], src)
    if r.returncode == 0:
        tracked = {p for p in r.stdout.split("\0") if p and _is_env_file(pathlib.PurePosixPath(p).name)}
    gone = set()
    for dirpath, dirnames, filenames in os.walk(src):
        dirnames[:] = [d for d in dirnames if d not in _SCAN_SKIP]
        for f in filenames:
            # Templates too (`.env.example`): nothing a demo builds needs one, and a template
            # is where a real key most often gets pasted by mistake.
            if _is_env_file(f):
                p = pathlib.Path(dirpath) / f
                p.unlink()
                gone.add(str(p.relative_to(src)))
    return sorted(tracked | gone)


def strip_analytics(src: pathlib.Path, app_dir: str = "") -> list[str]:
    """Blank analytics keys written into tracked files, and remove platform files that only
    configure an SDK for a platform the demo does not run. Returns one sentence per change."""
    out: list[str] = []
    r = _git(["ls-files", "-z"], src)
    if r.returncode == 0:
        for p in sorted(x for x in r.stdout.split("\0") if pathlib.PurePosixPath(x).name in ANALYTICS_FILES):
            if not (src / p).exists():
                out.append(f"{p} never written (Firebase config for Android, unused by this demo)")
    base = src / app_dir if app_dir else src
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [d for d in dirnames if d not in _SCAN_SKIP and d not in ("ios", "android")]
        for f in filenames:
            p = pathlib.Path(dirpath) / f
            rel = str(p.relative_to(src))
            if f in ANALYTICS_FILES:
                p.unlink()
                out.append(f"{rel} removed (Firebase config for Android, unused by this demo)")
                continue
            if _is_env_file(f) or not f.endswith(_TEXT_EXT):
                continue
            try:
                if p.stat().st_size > 1_000_000:
                    continue
                text = p.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            new = text
            for label, pat in ANALYTICS_VALUES:
                if pat.search(new):
                    new = pat.sub("", new)
                    out.append(f"{rel}: {label} blanked")
            if new != text:
                p.write_text(new, encoding="utf-8")
    return out


def prepare(project: Project, commit: str | None, app_dir: str = "") -> Workspace:
    root = paths.private_dir(paths.work_dir(project.key))
    src, head, reused = clone(project, commit, root)
    stripped = []
    envs = strip_env_files(src)
    stripped.append(
        f".env files the repository tracks, never written to the clone: {', '.join(envs)}"
        if envs
        else "no .env file is tracked, so none was copied"
    )
    stripped.extend(strip_analytics(src, app_dir))
    return Workspace(root=root, src=src, commit=head, stripped=stripped, reused=reused)


# ----------------------------------------------------------------------------- sandbox


#: Never readable from inside the sandbox: SSH and cloud credentials, the GitHub CLI's token,
#: Builda's own pairing tokens and the local stack's keys.
SANDBOX_DENY_READ = (
    "~/.ssh", "~/.aws", "~/.gnupg", "~/.config/gh", "~/.netrc", "~/.docker",
    "~/.builder/credentials.json", "~/.builder/env", "~/.builder-overnight", "~/Library/Keychains",
)  # fmt: skip


def sandbox_settings(work: pathlib.Path, allowed_domains: list[str]) -> dict:
    """The `srt --settings` document for one dev server: writes to the work dir, the temp dir
    and the package caches; the credential paths unreadable; network to the listed hosts."""
    home = pathlib.Path.home()
    return {
        "filesystem": {
            "denyRead": list(SANDBOX_DENY_READ),
            "allowWrite": [
                str(work),
                os.environ.get("TMPDIR", "/tmp"),
                str(home / ".npm"),
                str(home / ".bun"),
                str(home / ".cache"),
                str(home / "Library" / "Caches"),
            ],
            "denyWrite": [],
        },
        "network": {"allowedDomains": sorted(set(allowed_domains)), "deniedDomains": []},
    }


def sandboxed(argv: list[str], work: pathlib.Path, allowed_domains: list[str]) -> tuple[list[str], str]:
    """(the argv to run, a sentence saying how it runs). Under `srt` when it is installed."""
    srt = shutil.which("srt")
    if not srt:
        return argv, "unsandboxed: Anthropic's sandbox runtime (srt) is not installed"
    settings = work / "srt-settings.json"
    settings.write_text(json.dumps(sandbox_settings(work, allowed_domains), indent=1))
    return [srt, "--settings", str(settings), *argv], f"under the sandbox runtime ({srt})"
