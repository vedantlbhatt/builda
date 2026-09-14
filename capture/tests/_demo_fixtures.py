"""Fixture repositories and files for the demo generator's tests. No simulator, no network."""

from __future__ import annotations

import json
import os
import pathlib
import struct
import subprocess
import zlib

T0 = 1_789_300_000


def git(cwd: pathlib.Path, *args: str) -> str:
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.invalid",
        "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.invalid",
        "GIT_CONFIG_NOSYSTEM": "1", "GIT_AUTHOR_DATE": f"@{T0} +0000", "GIT_COMMITTER_DATE": f"@{T0} +0000",
    }  # fmt: skip
    r = subprocess.run(
        ["git", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", *args],
        cwd=cwd, env=env, check=True, capture_output=True, text=True,
    )  # fmt: skip
    return r.stdout.strip()


def write(root: pathlib.Path, files: dict[str, str | bytes]) -> None:
    for rel, body in files.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(body, bytes):
            p.write_bytes(body)
        else:
            p.write_text(body)


def repo(root: pathlib.Path, files: dict[str, str | bytes], origin: str | None = "https://github.com/acme/widget.git") -> pathlib.Path:
    """A git repository with `files` committed and an origin (never contacted)."""
    root.mkdir(parents=True, exist_ok=True)
    git(root, "init", "-q")
    write(root, files)
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "init")
    if origin:
        git(root, "remote", "add", "origin", origin)
    return root


def png(w: int, h: int, rgb: tuple[int, int, int] = (20, 20, 22)) -> bytes:
    """A real, decodable PNG of one colour."""
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def jpeg_header(w: int, h: int) -> bytes:
    """Enough of a JPEG for a size reader: SOI, an APP0 segment, SOF0 with the size, EOI."""
    app0 = b"\xff\xe0" + struct.pack(">H", 16) + b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    sof0 = b"\xff\xc0" + struct.pack(">HBHHB", 11, 8, h, w, 1) + b"\x01\x11\x00"
    return b"\xff\xd8" + app0 + sof0 + b"\xff\xd9"


EXPO_APP = {
    "mobile/package.json": json.dumps(
        {"name": "m", "main": "expo-router/entry", "scripts": {"ios": "expo run:ios"}, "dependencies": {"expo": "~53.0.0", "expo-router": "~5.1.0", "react-native": "0.79.6"}}
    ),
    "mobile/bun.lock": "{}",
    "mobile/app.config.ts": (
        "export default { name: 'Widget Pro', slug: 'widget', scheme: 'widget', "
        "ios: { bundleIdentifier: 'com.acme.widget' }, extra: { posthogKey: process.env.EXPO_PUBLIC_POSTHOG_KEY } };\n"
    ),
    "mobile/app/_layout.tsx": "export default function L() { return null }\n",
    "mobile/app/(tabs)/_layout.tsx": "export default function T() { return null }\n",
    "mobile/app/(tabs)/home.tsx": "export default function H() { return null }\n",
    "mobile/app/(tabs)/stats.tsx": "export default function S() { return null }\n",
    "mobile/app/settings.tsx": "export default function X() { return null }\n",
    "mobile/app/item/[id].tsx": "export default function I() { return null }\n",
    "mobile/app/+not-found.tsx": "export default function N() { return null }\n",
    "mobile/src/analytics.ts": "export const key = process.env.EXPO_PUBLIC_POSTHOG_KEY; const api = process.env.EXPO_PUBLIC_API_URL;\n",
    "README.md": "# widget\n",
}

WEB_APP = {
    "package.json": json.dumps({"name": "site", "scripts": {"dev": "vite", "build": "vite build"}, "dependencies": {"react": "18"}, "devDependencies": {"vite": "5"}}),
    "package-lock.json": "{}",
    "src/pages/index.tsx": "x",
    "src/pages/about.tsx": "x",
    "src/pages/blog/[slug].tsx": "x",
    "src/pages/api/hello.ts": "x",
}

CLI_APP = {
    "pyproject.toml": '[project]\nname = "tidy"\nversion = "0.1"\n[project.scripts]\ntidy = "tidy.cli:main"\n',
    "tidy/__init__.py": "",
    "tidy/cli.py": "def main():\n    print('tidy')\n",
    "README.md": (
        "# tidy\n\n```bash\npip install tidy\n$ tidy --check src\ntidy fix . --verbose\ngit clone x\n```\n\n"
        "```\ntidy report > out.txt\n```\n"
    ),
}

LIBRARY = {
    "pyproject.toml": '[project]\nname = "numbery"\nversion = "0.1"\n',
    "numbery/__init__.py": "def add(a, b):\n    return a + b\n",
    "tests/test_add.py": "def test_add():\n    assert 1 + 1 == 2\n",
}
