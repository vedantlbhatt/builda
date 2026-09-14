"""Where a demo, its work dir and the tools it installs live.

    ~/.builder/demos/<key>/            the demo: still-NN.png, demo.mp4, poster.jpg, manifest.json
    ~/.builder/demos/work/<key>/       the clone, the storyboard, builds, raw runs, the last good capture
    ~/.builder/tools/                  VHS, ttyd, the Playwright venv, the compiled Vision helper

`BUILDER_DEMOS_DIR` replaces `~/.builder/demos` and `BUILDER_TOOLS_DIR` replaces
`~/.builder/tools`, so a test never writes into the person's home.
"""

from __future__ import annotations

import os
import pathlib
import re

_KEY = re.compile(r"^[0-9a-f]{64}$")


def demos_dir() -> pathlib.Path:
    raw = os.environ.get("BUILDER_DEMOS_DIR", "").strip()
    return pathlib.Path(raw).expanduser() if raw else pathlib.Path("~/.builder/demos").expanduser()


def tools_dir() -> pathlib.Path:
    raw = os.environ.get("BUILDER_TOOLS_DIR", "").strip()
    return pathlib.Path(raw).expanduser() if raw else pathlib.Path("~/.builder/tools").expanduser()


def _checked(key: str) -> str:
    # The key names a directory; a value that is not the 64 hex repo hash could walk out of it.
    if not _KEY.match(key):
        raise ValueError(f"not a project key (64 lowercase hex): {key!r}")
    return key


def out_dir(key: str) -> pathlib.Path:
    return demos_dir() / _checked(key)


def work_dir(key: str) -> pathlib.Path:
    return demos_dir() / "work" / _checked(key)


def private_dir(path: pathlib.Path) -> pathlib.Path:
    """mkdir -p, owner only, and the demos root owner only too. A demo can show the person's
    own data, so nobody else on the Mac reads it."""
    path.mkdir(parents=True, exist_ok=True)
    for p in {path, demos_dir()}:
        try:
            if p == path or path.is_relative_to(p):
                os.chmod(p, 0o700)
        except OSError:
            pass
    return path
