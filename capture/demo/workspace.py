"""Stage 2: a place to build and run that is not the person's checkout.

NEVER the checkout. A demo run installs dependencies, generates native projects, writes build
products and starts servers; any of that in the tree a person is working in would be their
problem the next time they ran `git status`. So the chosen commit is cloned into
`~/.builder/demos/work/<key>/src` with `git clone --local` (hard links to the object store,
about a second for this repository), or a `--repo` URL is cloned there, and everything
happens in the clone.

What the clone is made WITHOUT, each named in the run's output:

* every secret file (`is_secret_file`): all `.env*` variants, `.envrc`, `.dev.vars`, `.npmrc`,
  `.netrc`, `.pypirc`, `.git-credentials`, the Firebase configs for BOTH platforms, and key,
  certificate and provisioning files. Git only carries tracked files, so an untracked `.env`
  never arrives; a tracked one is left out of the work tree by git's sparse checkout (`SPARSE`);
  and `strip_secret_files` deletes anything that slips through, unopened (a file this package
  never opens cannot leak). Symlinks are removed as links, never followed.
* analytics and crash reporting keys: a PostHog project key or a Sentry DSN written into a
  tracked file is blanked in the clone. A demo run is not a user session, and a key left in would
  send the demo to the project's dashboards (docs/research/demo-capture.md section 4: the
  simulator app is not a process the sandbox governs, so the key has to be absent).

Every child process runs under an environment ALLOWLIST (`clean_env`), the rule
`scripts/overnight_stack.sh` follows with `env -i`: a DATABASE_URL, an API key or a capture key
exported in the person's shell for other work never reaches a project's build.

TRUST. A project this Mac's transcripts have resolved to is the person's own: its steps run
unsandboxed after their typed yes, and the run says plainly what the code can reach. A `--repo`
(or a local checkout) whose origin the transcripts have never seen is UNTRUSTED: every step runs
under Anthropic's sandbox runtime (`srt`), with HOME and every package cache inside the work dir,
`~/.ssh`, cloud credentials, the GitHub CLI token and the other work dirs unreadable, and network
on an allowlist (`Sandbox`, `sandbox_settings`). `srt` is required there; with none available the
run refuses rather than run untrusted code loose.
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

#: One list of secret file names, for the sparse checkout, the analytics strip and `check_copy`
#: (servers.py imports it). Every `.env*` variant (`.env`, `.env.local`, `.env-production`,
#: `.env_local`), the direnv and Node/Python credential dotfiles, Firebase configs for BOTH
#: platforms (iOS `GoogleService-Info.plist` was kept while Android's was stripped), and the key,
#: certificate and provisioning shapes. Matched on the BASENAME, case folded; a file that matches
#: is deleted from the clone WITHOUT BEING OPENED (a file this package never reads cannot leak).
_SECRET_NAME = re.compile(
    r"(?i)^(?:"
    r"\.env(?:[._-].*)?|\.envrc|\.dev\.vars|\.npmrc|\.netrc|\.pypirc|\.git-credentials|"
    r"google-services\.json|googleservice-info\.plist|"
    r"credentials.*\.json|id_rsa\b.*|id_dsa\b.*|id_ecdsa\b.*|id_ed25519\b.*|"
    r".*\.(?:p12|pem|key|keystore|jks|p8|mobileprovision|pfx|cer|crt)"
    r")$"
)


def is_secret_file(name: str) -> bool:
    """A basename that carries a secret or a credential (see `_SECRET_NAME`)."""
    return bool(_SECRET_NAME.match(name))

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


def clean_env(extra: dict[str, str] | None = None, home: pathlib.Path | None = None) -> dict[str, str]:
    """The allowlisted environment, plus the storyboard's own values. An analytics name is
    dropped even when a storyboard asks for it: a demo build is made without them.

    With `home`, `HOME` is that directory and every package manager's cache is pointed inside it:
    a sandboxed run of an untrusted repository reads and writes only the work dir, so `~/.ssh`,
    `~/.aws` and the tokens under the real home are not even on the paths it would look at, and
    `~/.npmrc` / `~/.gitconfig` are not read."""
    env = {k: os.environ[k] for k in ENV_ALLOW if k in os.environ}
    env.setdefault("LANG", "en_US.UTF-8")
    if home is not None:
        h = str(home)
        home.mkdir(parents=True, exist_ok=True)
        env["HOME"] = h
        env["XDG_CACHE_HOME"] = f"{h}/.cache"
        env["XDG_CONFIG_HOME"] = f"{h}/.config"
        env["npm_config_cache"] = f"{h}/.npm"
        env["npm_config_userconfig"] = f"{h}/.npmrc"
        env["BUN_INSTALL_CACHE_DIR"] = f"{h}/.bun/cache"
        env["PIP_CACHE_DIR"] = f"{h}/.cache/pip"
        env["CP_HOME_DIR"] = f"{h}/.cocoapods"
        env["PLAYWRIGHT_BROWSERS_PATH"] = f"{h}/ms-playwright"
    for k, v in (extra or {}).items():
        if ANALYTICS_ENV.match(k):
            continue
        env[k] = v
    return env


def _inside(base: pathlib.Path, p: pathlib.Path) -> bool:
    """True when `p` is inside `base` with no symlink anywhere on the way: neither `p` itself nor
    any directory between `base` and `p` is a link, and its real path stays under `base`'s real
    path. A tracked `docs -> /etc` symlink, or a file reached through one, is therefore never
    read or written as if it were part of the clone (the review's item 3)."""
    try:
        base = base.resolve(strict=False)
        cur = p
        while True:
            if cur.is_symlink():
                return False
            if cur == cur.parent:
                break
            cur = cur.parent
            if cur == base or cur.resolve(strict=False) == base:
                return p.resolve(strict=False).is_relative_to(base)
        return p.resolve(strict=False).is_relative_to(base)
    except (OSError, ValueError):
        return False


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
#: leaves these paths out of every checkout, so a tracked `.env.example` or a Firebase config is
#: in the object store and never a file on disk. MEASURED on RideGT: both are tracked
#: (`ads-portal/.env.example`, `mobile/google-services.json`) and `git status` stays clean. This
#: is belt and suspenders: `strip_secret_files` deletes anything that slips through by the same
#: `is_secret_file` list, so a new secret shape is covered without touching this list.
SPARSE = (
    "/*", "!.env", "!.env.*", "!.env-*", "!.env_*", "!.envrc", "!.dev.vars", "!.npmrc", "!.netrc",
    "!.pypirc", "!.git-credentials", "!google-services.json", "!GoogleService-Info.plist",
    "!*.pem", "!*.key", "!*.p12", "!*.p8", "!*.keystore", "!*.jks", "!*.mobileprovision",
    "!id_rsa*", "!id_ed25519*", "!credentials*.json",
)  # fmt: skip


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
    if r.returncode != 0 and commit:
        # A branch or tag name given for a URL project exists only as a remote ref in the clone.
        r = _git(["checkout", "--quiet", "--detach", "--force", f"origin/{commit}"], src)
    if r.returncode != 0:
        raise WorkspaceError(f"git checkout {target} in the work dir failed: {r.stderr.strip()[:300]}")
    head = _head(src)
    if not head:
        raise WorkspaceError("the clone has no HEAD after checkout")
    return src, head, reused


def strip_secret_files(src: pathlib.Path) -> list[str]:
    """Every secret file the repository tracks (the sparse checkout never writes them), and any
    that turn up in the clone anyway, deleted WITHOUT BEING OPENED (`is_secret_file`): all `.env*`
    variants, `.envrc`, `.dev.vars`, `.npmrc`, `.netrc`, `.pypirc`, `.git-credentials`, the
    Firebase configs for BOTH platforms, and key, certificate and provisioning files.

    Symlinks are removed as links, never followed: the target of a `.env -> /real/.env` link is
    never read (the review's item 3)."""
    tracked = set()
    r = _git(["ls-files", "-z"], src)
    if r.returncode == 0:
        tracked = {p for p in r.stdout.split("\0") if p and is_secret_file(pathlib.PurePosixPath(p).name)}
    gone = set()
    for dirpath, dirnames, filenames in os.walk(src, followlinks=False):
        dirnames[:] = [d for d in dirnames if d not in _SCAN_SKIP]
        for f in filenames:
            # Templates too (`.env.example`): nothing a demo builds needs one, and a template
            # is where a real key most often gets pasted by mistake.
            if is_secret_file(f):
                p = pathlib.Path(dirpath) / f
                p.unlink()  # a matching symlink: the link goes, its target is untouched
                gone.add(str(p.relative_to(src)))
    return sorted(tracked | gone)


def strip_analytics(src: pathlib.Path, app_dir: str = "") -> list[str]:
    """Blank analytics keys written into tracked files, and remove platform files that only
    configure an SDK for a platform the demo does not run. Returns one sentence per change.

    Never reads or writes through a symlink, and never a path that resolves outside the clone
    (`_inside`): the review found a file outside the clone had its key blanked through a link."""
    out: list[str] = []
    r = _git(["ls-files", "-z"], src)
    if r.returncode == 0:
        for p in sorted(x for x in r.stdout.split("\0") if pathlib.PurePosixPath(x).name in ANALYTICS_FILES):
            if not (src / p).exists():
                out.append(f"{p} never written (Firebase config for Android, unused by this demo)")
    base = src / app_dir if app_dir else src
    for dirpath, dirnames, filenames in os.walk(base, followlinks=False):
        dirnames[:] = [d for d in dirnames if d not in _SCAN_SKIP and d not in ("ios", "android")]
        for f in filenames:
            p = pathlib.Path(dirpath) / f
            if p.is_symlink() or not _inside(src, p):
                continue
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
    envs = strip_secret_files(src)
    stripped.append(
        f"secret files the repository tracks, never written to the clone: {', '.join(envs)}"
        if envs
        else "no secret file (.env, keys, Firebase configs) is tracked, so none was copied"
    )
    stripped.extend(strip_analytics(src, app_dir))
    return Workspace(root=root, src=src, commit=head, stripped=stripped, reused=reused)


# ----------------------------------------------------------------------------- sandbox


#: Never readable from inside the sandbox: SSH, cloud and GitHub CLI credentials, the git and npm
#: credential files, Claude's own config, Builda's pairing tokens and the local stack's keys, and
#: the whole of `~/.builder` (the OTHER demos' work dirs live under it). The one work dir a run
#: owns is re-allowed with `allowRead`, which takes precedence over `denyRead` on macOS.
SANDBOX_DENY_READ = (
    "~/.ssh", "~/.aws", "~/.gnupg", "~/.config/gh", "~/.config/gcloud", "~/.netrc", "~/.docker",
    "~/.npmrc", "~/.git-credentials", "~/.pypirc", "~/.claude", "~/.claude.json",
    "~/.builder", "~/.builder-overnight", "~/Library/Keychains",
)  # fmt: skip


def sandbox_settings(work: pathlib.Path, allowed_domains: list[str]) -> dict:
    """The `srt --settings` document: writes only to the work dir and the temp dir (never a
    shared package cache, so a sandboxed step cannot plant a file a later unsandboxed tool runs,
    the review's item 8), the credential paths and every other work dir unreadable, this run's
    own work dir re-allowed, and network to the listed hosts. A dev server may bind a local port
    (`allowLocalBinding`) so the browser can reach it; egress stays on the allowlist.

    Every `~` is expanded HERE, against the real home, so the paths are absolute: the sandboxed
    step runs with `HOME` pointed at the work dir, and srt expands a `~` in its settings against
    the process HOME, so a `~/.ssh` deny would resolve to the work dir and deny nothing. FOUND ON
    THE SANDBOX PROOF RUN: with `~` left in, `cat /Users/<me>/.ssh/...` came back readable."""
    denies = [os.path.expanduser(p) for p in SANDBOX_DENY_READ] + [str(paths.demos_dir())]
    return {
        "filesystem": {
            "denyRead": denies,
            # This run's work dir, and the tools dir (VHS, ttyd, the Playwright venv, srt itself):
            # trusted binaries a sandboxed step still has to be able to read to exec. Everything
            # else under ~/.builder (credentials, the OTHER demos' work dirs) stays denied.
            "allowRead": [str(work), str(paths.tools_dir())],
            "allowWrite": [str(work), os.environ.get("TMPDIR", "/tmp"), "/private/tmp", "/private/var/folders"],
            "denyWrite": [],
        },
        "network": {"allowedDomains": sorted(set(allowed_domains)), "deniedDomains": [], "allowLocalBinding": True},
    }


def sandboxed(
    argv: list[str], work: pathlib.Path, allowed_domains: list[str], srt: str | None = None
) -> tuple[list[str], str]:
    """(the argv to run, a sentence saying how it runs). Under `srt` when it is available."""
    srt = srt or shutil.which("srt")
    if not srt:
        return argv, "unsandboxed: Anthropic's sandbox runtime (srt) is not installed"
    settings = work / "srt-settings.json"
    settings.write_text(json.dumps(sandbox_settings(work, allowed_domains), indent=1))
    return [srt, "--settings", str(settings), *argv], f"under the sandbox runtime ({srt})"


@dataclasses.dataclass
class Sandbox:
    """How a run's steps are wrapped and what environment they start from.

    A `--repo` (or a local checkout) whose origin this Mac's transcripts have never resolved to is
    UNTRUSTED: every step (install, build, dev server, VHS, the browser) runs under `srt`, HOME
    and every package cache point inside the work dir, and the credential paths are unreadable. A
    project the person has worked in is trusted and runs unsandboxed after their typed yes, with
    the environment allowlist; the run says plainly what its code can reach. `srt` is required for
    an untrusted repository: with none available the run refuses rather than run its code loose."""

    work: pathlib.Path
    #: True for an untrusted repository (sandbox every step, or refuse).
    untrusted: bool
    srt: str | None = None

    @property
    def home(self) -> pathlib.Path | None:
        return (self.work / "home") if self.untrusted else None

    def env(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        return clean_env(extra, home=self.home)

    def wrap(self, argv: list[str], allowed_domains: list[str] | None = None) -> tuple[list[str], str]:
        if not self.untrusted:
            return list(argv), "unsandboxed (your own project, after your yes)"
        wrapped, how = sandboxed(list(argv), self.work, sorted(set(allowed_domains or [])), srt=self.srt)
        if "unsandboxed" in how:  # sandboxed() fell back: no srt to wrap with
            raise WorkspaceError(
                "this repository is not one your transcripts resolved to, so it runs sandboxed, "
                "and Anthropic's sandbox runtime is not available"
            )
        return wrapped, how
