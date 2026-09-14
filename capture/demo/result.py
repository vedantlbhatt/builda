"""What a driver hands the composer: stills, one raw recording, and where each beat is in it."""

from __future__ import annotations

import dataclasses
import pathlib


@dataclasses.dataclass
class Still:
    path: pathlib.Path
    label: str
    source: str = "capture"


@dataclasses.dataclass
class BeatWindow:
    """One beat's stretch of the raw recording, in seconds from its first frame."""

    label: str
    caption: str | None
    start: float
    end: float
    #: A beat filmed as a clip of its own (one VHS tape per command); None when every beat is
    #: a window of the one pass recording.
    video: pathlib.Path | None = None
    #: The screenshot of where the beat settled, taken just before its hold: what the end of
    #: its window must show (`compose.check_alignment`).
    still: pathlib.Path | None = None


@dataclasses.dataclass
class Capture:
    stills: list[Still]
    video: pathlib.Path | None
    beats: list[BeatWindow]
    notes: list[str] = dataclasses.field(default_factory=list)


class CaptureError(Exception):
    """The project could not be run or filmed. The message is the reason the phone shows."""
