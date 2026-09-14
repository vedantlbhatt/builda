"""The tools a demo drives, found on the machine or installed into `~/.builder/tools`.

Nothing is installed system wide and nothing through Homebrew (which cannot build on the
machine this was written on). What lands where:

    ~/.builder/tools/builder-demo-helper-<hash>   the Vision OCR and caption helper, compiled from
                                                  helper.swift with /usr/bin/swiftc on first use;
                                                  the hash of the source is in the name, so an
                                                  edit recompiles and an old binary is never run
    ~/.builder/tools/playwright/                  a venv with Playwright, for web projects; the
                                                  browsers are Playwright's own cache
                                                  (~/Library/Caches/ms-playwright)
    ~/.builder/tools/vhs/vhs                      VHS, the release binary from GitHub
    ~/.builder/tools/ttyd/bin/ttyd                ttyd, which VHS needs and which has no macOS
                                                  release binary: conda-forge's osx-arm64 build,
                                                  installed with micromamba into its own prefix
    ~/.builder/tools/micromamba                   the single static binary that installs ttyd

ffmpeg and Maestro are found, not installed: `FFMPEG` (default /opt/homebrew/bin/ffmpeg) and
`~/.maestro/bin/maestro`.
"""

from __future__ import annotations

import hashlib
import os
import pathlib
import platform
import shutil
import subprocess
import sys
import tarfile
import urllib.request

from . import paths

HERE = pathlib.Path(__file__).resolve().parent
SWIFTC = "/usr/bin/swiftc"
#: NOT the latest. FOUND ON THIS MAC, 2026-09-14: VHS 0.12.0 prints "Creating out.mp4...", exits
#: 0 and writes nothing, for every tape (a two line `echo hi` included), with Chrome 152 and
#: ttyd 1.7.7; upstream issue charmbracelet/vhs#787 reports the same on Ubuntu with 0.11.0
#: recording the same tape. 0.11.0 is what the demo uses until that is fixed.
VHS_VERSION = "0.11.0"
#: The release whose Chromium (revision 1223) was already in Playwright's cache on the machine
#: this was written on (1217, 1223 and 1234 were there; 1.57 wants 1200, 1.61 wants 1228), so
#: web demos start without a browser download. `ensure_chromium` installs one otherwise.
PLAYWRIGHT_VERSION = "1.60.0"
#: Anthropic's sandbox runtime, pinned. Installed into `tools/sandbox-runtime-<version>` with a
#: LOCAL npm install (never `npm -g`) and with lifecycle scripts off, and used to wrap every step
#: of an untrusted `--repo`. On macOS it drives `sandbox-exec`; no extra dependency is needed.
SRT_VERSION = "0.0.76"


class ToolError(Exception):
    pass


def srt() -> str | None:
    """The `srt` binary if it is available: the one installed under `tools/`, else one on PATH.
    None when neither is there (an untrusted repository then refuses; `ensure_srt` installs it)."""
    for d in sorted(paths.tools_dir().glob("sandbox-runtime-*"), reverse=True):
        exe = d / "node_modules" / ".bin" / "srt"
        if exe.exists():
            return str(exe)
    return shutil.which("srt")


def ensure_srt() -> str:
    """`srt`, installed into `tools/sandbox-runtime-<version>` with a local, scripts-off npm
    install if it is not already there. Never `npm -g`. Raises `ToolError` if it cannot."""
    found = srt()
    if found:
        return found
    npm = shutil.which("npm")
    if not npm:
        raise ToolError("npm is not on PATH, so Anthropic's sandbox runtime cannot be installed")
    prefix = paths.private_dir(paths.tools_dir() / f"sandbox-runtime-{SRT_VERSION}")
    print(f"  installing @anthropic-ai/sandbox-runtime@{SRT_VERSION} into {prefix} (local, no scripts)", file=sys.stderr)
    r = subprocess.run(
        [npm, "install", "--prefix", str(prefix), "--ignore-scripts", "--no-audit", "--no-fund",
         "--no-save", f"@anthropic-ai/sandbox-runtime@{SRT_VERSION}"],
        capture_output=True, text=True, timeout=1800, check=False,
    )  # fmt: skip
    exe = prefix / "node_modules" / ".bin" / "srt"
    if r.returncode != 0 or not exe.exists():
        raise ToolError(f"installing the sandbox runtime failed:\n{(r.stderr or r.stdout)[-1500:]}")
    return str(exe)


def ffmpeg() -> str:
    for c in (os.environ.get("FFMPEG"), "/opt/homebrew/bin/ffmpeg", shutil.which("ffmpeg")):
        if c and os.path.exists(c):
            return c
    raise ToolError("ffmpeg is not installed (the composer uses ffmpeg only)")


def ffprobe() -> str:
    f = ffmpeg()
    probe = os.path.join(os.path.dirname(f), "ffprobe")
    if os.path.exists(probe):
        return probe
    p = shutil.which("ffprobe")
    if not p:
        raise ToolError("ffprobe is not installed beside ffmpeg")
    return p


def ffmpeg_has(filter_name: str) -> bool:
    try:
        r = subprocess.run([ffmpeg(), "-hide_banner", "-filters"], capture_output=True, text=True, timeout=30, check=False)
    except (OSError, subprocess.SubprocessError, ToolError):
        return False
    return any(line.split()[1:2] == [filter_name] for line in r.stdout.splitlines() if len(line.split()) > 1)


def helper() -> pathlib.Path:
    """The compiled helper, built from helper.swift if this version of the source has no
    binary yet. About six seconds, once."""
    src = HERE / "helper.swift"
    digest = hashlib.sha256(src.read_bytes()).hexdigest()[:12]
    out = paths.private_dir(paths.tools_dir()) / f"builder-demo-helper-{digest}"
    if out.exists():
        return out
    if not os.path.exists(SWIFTC):
        raise ToolError(f"{SWIFTC} is missing; install the Xcode command line tools (xcode-select --install)")
    tmp = out.with_suffix(".tmp")
    r = subprocess.run([SWIFTC, "-O", str(src), "-o", str(tmp)], capture_output=True, text=True, timeout=600, check=False)
    if r.returncode != 0:
        raise ToolError(f"compiling the Vision helper failed:\n{r.stderr[-2000:]}")
    os.replace(tmp, out)
    return out


def _download(url: str, dest: pathlib.Path) -> pathlib.Path:
    req = urllib.request.Request(url, headers={"User-Agent": "builder-demo"})
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(req, timeout=300) as r, tmp.open("wb") as f:
        shutil.copyfileobj(r, f)
    os.replace(tmp, dest)
    return dest


def _arch() -> str:
    return "arm64" if platform.machine() in ("arm64", "aarch64") else "x86_64"


def ttyd() -> pathlib.Path:
    """ttyd from conda-forge, into `tools/ttyd`. VHS runs a terminal in a headless browser
    through it; its GitHub releases have Linux and Windows binaries only."""
    found = shutil.which("ttyd")
    if found:
        return pathlib.Path(found)
    prefix = paths.tools_dir() / "ttyd"
    exe = prefix / "bin" / "ttyd"
    if exe.exists():
        return exe
    mm = paths.tools_dir() / "micromamba"
    if not mm.exists():
        plat = "osx-arm64" if _arch() == "arm64" else "osx-64"
        print(f"  installing micromamba into {mm} (to install ttyd from conda-forge)", file=sys.stderr)
        _download(f"https://github.com/mamba-org/micromamba-releases/releases/latest/download/micromamba-{plat}", mm)
        mm.chmod(0o755)
    print(f"  installing ttyd from conda-forge into {prefix}", file=sys.stderr)
    r = subprocess.run(
        [str(mm), "create", "--yes", "--prefix", str(prefix), "--root-prefix", str(paths.tools_dir() / "mamba"),
         "--channel", "conda-forge", "--override-channels", "ttyd"],
        capture_output=True, text=True, timeout=1800, check=False,
    )  # fmt: skip
    if r.returncode != 0 or not exe.exists():
        raise ToolError(f"installing ttyd failed:\n{(r.stderr or r.stdout)[-1500:]}")
    return exe


def vhs() -> pathlib.Path:
    """VHS `VHS_VERSION` from its GitHub release, into `tools/vhs-<version>`. One on PATH is not
    used: its version is not known to work (see `VHS_VERSION`)."""
    d = paths.private_dir(paths.tools_dir() / f"vhs-{VHS_VERSION}")
    exe = d / "vhs"
    if exe.exists():
        return exe
    name = f"vhs_{VHS_VERSION}_Darwin_{_arch()}"
    tgz = d / f"{name}.tar.gz"
    print(f"  downloading VHS {VHS_VERSION} into {d}", file=sys.stderr)
    _download(f"https://github.com/charmbracelet/vhs/releases/download/v{VHS_VERSION}/{name}.tar.gz", tgz)
    with tarfile.open(tgz) as t:
        member = next((m for m in t.getmembers() if m.name.endswith("/vhs") or m.name == "vhs"), None)
        if member is None:
            raise ToolError("the VHS release archive has no vhs binary in it")
        member.name = "vhs"
        t.extract(member, d, filter="data")
    tgz.unlink()
    exe.chmod(0o755)
    return exe


def playwright_python() -> pathlib.Path:
    """The Python of a venv holding Playwright, created on first use. Its browsers are the ones
    Playwright already cached (`PLAYWRIGHT_BROWSERS_PATH` unset means ~/Library/Caches/ms-playwright)."""
    venv = paths.tools_dir() / "playwright"
    py = venv / "bin" / "python"
    if py.exists():
        r = subprocess.run(
            [str(py), "-c", "import playwright._repo_version as v; print(v.version)"],
            capture_output=True, text=True, timeout=60, check=False,
        )  # fmt: skip
        if r.returncode == 0 and r.stdout.strip() == PLAYWRIGHT_VERSION:
            return py
    else:
        paths.private_dir(paths.tools_dir())
        print(f"  creating a Playwright venv in {venv}", file=sys.stderr)
        subprocess.run([sys.executable, "-m", "venv", str(venv)], check=True, timeout=300)
    r = subprocess.run(
        [str(py), "-m", "pip", "install", "--quiet", "--disable-pip-version-check", f"playwright=={PLAYWRIGHT_VERSION}"],
        capture_output=True, text=True, timeout=1200, check=False,
    )  # fmt: skip
    if r.returncode != 0:
        raise ToolError(f"pip install playwright failed:\n{r.stderr[-1500:]}")
    return py


def ensure_chromium(py: pathlib.Path) -> None:
    """Playwright's headless Chromium, from its cache when the pinned version's revision is
    there (it was, for three revisions, on the machine this was written on), else installed."""
    probe = (
        "from playwright.sync_api import sync_playwright\n"
        "with sync_playwright() as p:\n"
        "    b = p.chromium.launch(); b.close()\n"
    )
    r = subprocess.run([str(py), "-c", probe], capture_output=True, text=True, timeout=180, check=False)
    if r.returncode == 0:
        return
    print("  installing Playwright's Chromium (not in the cache for this version)", file=sys.stderr)
    r = subprocess.run([str(py), "-m", "playwright", "install", "chromium"], capture_output=True, text=True, timeout=1800, check=False)
    if r.returncode != 0:
        raise ToolError(f"playwright install chromium failed:\n{r.stderr[-1500:]}")
