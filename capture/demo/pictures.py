"""When two pictures are the same picture: a 256 bit difference hash through the Swift helper.

A demo never keeps one picture twice under two labels, whatever it came from (a capture, the
last good capture, images in the checkout): one of the two labels would be wrong, and a stack of
near copies is not a demo of anything. FOUND BY THE COORDINATOR on the fourth Builda run, where
"Wrapped, every card in a grid" was the story card again; and on the fourth RideGT fallback,
where the newest six images in verification-screenshots/ were six takes of one effect.
"""

from __future__ import annotations

import json
import pathlib
import subprocess

from . import tools
from .result import CaptureError

#: Two screenshots whose hashes are this close are the same picture. MEASURED on the fourth
#: Builda run's six stills: the two Wrapped stills (one screen, its background drifting) were 4
#: bits apart, and every pair of different screens 87 to 118.
SAME_PICTURE_BITS = 16


def fingerprints(paths: list[pathlib.Path]) -> list[int]:
    if not paths:
        return []
    r = subprocess.run([str(tools.helper()), "dhash", *map(str, paths)], capture_output=True, text=True, timeout=120, check=False)
    if r.returncode != 0:
        raise CaptureError(f"fingerprinting a picture failed: {r.stderr.strip()[-200:]}")
    rows = json.loads(r.stdout)
    if any("hash" not in x for x in rows):
        raise CaptureError(f"a picture could not be read: {[x.get('file') for x in rows if 'hash' not in x]}")
    return [int(x["hash"], 16) for x in rows]


def same_picture(a: int, b: int) -> bool:
    return bin(a ^ b).count("1") <= SAME_PICTURE_BITS


def distinct(prints: list[int]) -> list[int | None]:
    """For each picture in order, the index of an EARLIER one it is the same picture as, or None
    (pure; the tests hold it)."""
    out: list[int | None] = []
    for i, p in enumerate(prints):
        out.append(next((j for j in range(i) if out[j] is None and same_picture(prints[j], p)), None))
    return out
