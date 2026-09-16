"""The launch agent, so sharing a reel works with no terminal open.

WHY THIS IS THE FEATURE AND NOT A CONVENIENCE. Everything else here is finished and none of it
happens unless `python -m drops watch` is running: you share a reel from the sofa, the card says
"waiting for your Mac", and it says that until you sit down and start a process. A person is not
going to do that, so the honest choice is to install something that does.

WHAT IT MAY DO. Read links you shared, plan them, and run the moves YOU TAPPED. That is the same
rule as everywhere else in this feature and the agent does not widen it: `drops/runner.py` runs
what the server hands it, the server hands over only `queued` moves, and a move is queued only by
`POST .../moves/{id}:start`, which is a person's thumb. There is no flag here that changes that.

THE PATH IS THE TRAP. launchd starts a job with a minimal environment: `/usr/bin:/bin:/usr/sbin:
/sbin` and nothing else. `claude` lives in `~/.local/bin` or a shim directory, `git` may be in
Homebrew's, and `yt-dlp` is wherever pip put it. A job installed without carrying the PATH over
runs, finds no `claude`, and answers `planner_unavailable` on every drop forever, which looks
exactly like a model outage. The installer writes the PATH it was installed WITH, and
`python -m drops doctor` prints what the installed job would see.

IT IS ONE FILE AND IT SAYS SO. `--uninstall` unloads and deletes it, and `--print` writes the
plist to stdout and touches nothing, because an agent somebody cannot read before installing is
an agent they should not install.
"""

from __future__ import annotations

import os
import plistlib
import shutil
import subprocess
import sys
import pathlib

LABEL = "com.vedantlbhatt.builda-drops"
AGENTS = pathlib.Path.home() / "Library" / "LaunchAgents"
PLIST = AGENTS / f"{LABEL}.plist"
LOG_DIR = pathlib.Path.home() / ".builder" / "drops"

#: Passed through to the job when they are set here. Nothing else of the installing shell's
#: environment travels: a launch agent that inherited a whole shell would carry whatever was
#: exported for something else, which is how a stray DATABASE_URL ends up in a daemon.
CARRIED = (
    "BUILDER_CREDENTIALS",
    "BUILDER_SERVER",
    "BUILDER_DROPS_COOKIES_FROM",
    "BUILDER_DROPS_REPO_ROOTS",
    "BUILDER_DROPS_RUN_TIMEOUT",
    "BUILDER_ANALYSIS_MODEL",
    "HOME",
)


def plist(
    *,
    python: str,
    repo: str,
    server: str,
    env: dict[str, str],
    log_dir: str,
) -> dict:
    """The job, as a dictionary. PURE, so `drops/tests/test_agent.py` can hold every rule."""
    carried = {k: env[k] for k in CARRIED if env.get(k)}
    # The PATH the installer had, or the login shell's. See the module docstring: a job with
    # launchd's own PATH finds no `claude` and refuses every drop forever.
    carried["PATH"] = env.get("PATH") or "/usr/bin:/bin"
    return {
        "Label": LABEL,
        "ProgramArguments": [python, "-m", "drops", "--server", server, "watch"],
        "WorkingDirectory": repo,
        "EnvironmentVariables": carried,
        "RunAtLoad": True,
        # Restart if it dies, and NOT if it exited cleanly: `watch` only returns on a signal, so
        # a clean exit is somebody stopping it on purpose and starting it again would be rude.
        "KeepAlive": {"SuccessfulExit": False},
        # Never more than once a minute. A job that crashes on boot (no credentials yet) would
        # otherwise be restarted as fast as launchd can fork it.
        "ThrottleInterval": 60,
        "StandardOutPath": f"{log_dir}/agent.log",
        "StandardErrorPath": f"{log_dir}/agent.log",
        # It reads links and runs what you tapped; it is not a background service that should
        # keep a laptop awake or fight for the CPU with what you are doing.
        "ProcessType": "Background",
        "LowPriorityIO": True,
    }


def current(server: str, repo: pathlib.Path | None = None) -> dict:
    root = repo or pathlib.Path(__file__).resolve().parent.parent
    return plist(
        python=sys.executable,
        repo=str(root),
        server=server,
        env=dict(os.environ),
        log_dir=str(LOG_DIR),
    )


def install(server: str, *, repo: pathlib.Path | None = None) -> pathlib.Path:
    """Write the job and load it. Replaces an existing one rather than stacking a second."""
    AGENTS.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    if PLIST.exists():
        unload()
    PLIST.write_bytes(plistlib.dumps(current(server, repo)))
    PLIST.chmod(0o644)
    load()
    return PLIST


def load() -> None:
    subprocess.run(["launchctl", "load", "-w", str(PLIST)], check=False,
                   capture_output=True, stdin=subprocess.DEVNULL)


def unload() -> None:
    subprocess.run(["launchctl", "unload", "-w", str(PLIST)], check=False,
                   capture_output=True, stdin=subprocess.DEVNULL)


def uninstall() -> bool:
    if not PLIST.exists():
        return False
    unload()
    PLIST.unlink()
    return True


def running() -> bool:
    out = subprocess.run(["launchctl", "list"], capture_output=True, text=True, check=False,
                         stdin=subprocess.DEVNULL)
    return LABEL in (out.stdout or "")


def what_the_job_would_find(env: dict[str, str]) -> dict[str, str | None]:
    """The tools the installed job could actually reach, on the PATH it would be given.

    Answered from the PLIST's environment rather than from this shell's, which is the whole
    point: a `doctor` that checks the shell it is run in tells you nothing about a daemon.
    """
    path = env.get("PATH") or "/usr/bin:/bin"
    return {tool: shutil.which(tool, path=path) for tool in ("claude", "git", "yt-dlp")}


#: Directories that are gone after a reboot, or after the session that made them ends.
#:
#: FOUND INSTALLING THIS. On the machine it was written on, `claude` resolves to
#: `$TMPDIR/cmux-cli-shims/<uuid>/claude`, a per session shim. An agent installed with that PATH
#: works perfectly until the next reboot and then answers `planner_unavailable` on every drop
#: forever, which reads exactly like a model outage and is not one. A daemon outlives the shell
#: that installed it, so a path that does not outlive the shell is not a path a daemon may have.
TEMPORARY = ("/tmp/", "/private/tmp/", "/var/folders/", "/private/var/folders/")


def is_temporary(where: str | None) -> bool:
    return bool(where) and any(str(where).startswith(p) for p in TEMPORARY)


def fleeting(found: dict[str, str | None]) -> dict[str, str]:
    """The tools the job would find TODAY and not after a reboot."""
    return {tool: where for tool, where in found.items() if where and is_temporary(where)}
