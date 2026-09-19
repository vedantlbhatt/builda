"""What a driver hands the composer: stills, one raw recording, and where each beat is in it."""

from __future__ import annotations

import dataclasses
import pathlib


@dataclasses.dataclass
class Still:
    path: pathlib.Path
    label: str
    source: str = "capture"
    #: A web still taken in a viewport of its own (a storyboard still with `viewport`): as wide as
    #: the phone's stills, as tall as its page, so it is not held to the device row's height.
    own_size: bool = False


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
    #: Where the beat's first tap landed, as fractions of the screen (x across, y down), when the
    #: driver knows: a point tap, a colour tap, a text tap found on screen, a browser click's box.
    #: The social formats draw a ring there as the beat starts (`shipkit.frame`). None when the
    #: beat opened a link, only waited, or tapped something whose place was not known.
    tap: tuple[float, float] | None = None


@dataclasses.dataclass
class Capture:
    stills: list[Still]
    video: pathlib.Path | None
    beats: list[BeatWindow]
    notes: list[str] = dataclasses.field(default_factory=list)
    #: The row of spec/devices.v1.json it was filmed on (`devices.py`), or None for a terminal.
    device: str | None = None
    #: A web project's second pass, in a Mac window (`web.run`): the same beats, a desktop size.
    desktop: Capture | None = None


class CaptureError(Exception):
    """The project could not be run or filmed. The message is the reason the phone shows."""
