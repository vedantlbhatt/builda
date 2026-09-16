#!/usr/bin/env python3
"""Tap a point on the booted simulator, in DEVICE PIXELS.

    python3 scripts/sim_tap.py 794 1408          one tap
    python3 scripts/sim_tap.py 794 1408 --drag 400 1400   a drag, for the board's pan
    python3 scripts/sim_tap.py 200 700 --drag 600 1600 --hold 0.4   a drag behind a long press

`xcrun simctl` can screenshot and it cannot touch, and `System Events`' `click at` is not
supported on this macOS (error -25204). So this synthesizes the events with Quartz and converts
device pixels to screen points through the Simulator window's own frame, which means a caller
can work in the coordinates a screenshot shows and never in the coordinates the window happens
to be at.

NOT A TEST HARNESS. It is for driving the simulator while taking review screenshots
(`scripts/e2e_web.mjs` is the scripted one). Nothing in the app depends on it.
"""

from __future__ import annotations

import argparse
import subprocess
import time

import Quartz

#: iPhone 15 Pro. `xcrun simctl io booted screenshot` writes at this size, and that is the
#: coordinate space a caller reads a point off a screenshot in.
DEVICE = (1179, 2556)


def window_frame() -> tuple[int, int, int, int]:
    out = subprocess.run(
        ["osascript", "-e",
         'tell application "System Events" to tell process "Simulator" to get {position, size} of window 1'],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    x, y, w, h = (int(v) for v in out.split(", "))
    return x, y, w, h


def to_screen(px: float, py: float, device: tuple[int, int]) -> tuple[float, float]:
    """Device pixels to screen points, with the window's chrome worked out rather than guessed.

    MEASURED: the Simulator window for a 1179x2556 device is 283x688, and 283/688 is 0.411 where
    the device is 0.461. Mapping straight onto the window's height put every tap about thirty
    points high, which is the difference between a dialog's button and its title. The screen is
    as tall as its own aspect ratio makes it (283 / 0.461 = 613), and the remaining 75 points are
    the title bar, at the TOP. Derived from the frame every time, so a resized window, a
    different device or a Simulator release that changes its chrome all still land.
    """
    x, y, w, h = window_frame()
    screen_h = w * device[1] / device[0]
    chrome = max(0.0, h - screen_h)
    return x + px * w / device[0], y + chrome + py * screen_h / device[1]


def click(x: float, y: float, *, down_ms: int = 60) -> None:
    pt = Quartz.CGPointMake(x, y)
    move = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventMouseMoved, pt, Quartz.kCGMouseButtonLeft)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, move)
    time.sleep(0.05)
    for kind in (Quartz.kCGEventLeftMouseDown, Quartz.kCGEventLeftMouseUp):
        ev = Quartz.CGEventCreateMouseEvent(None, kind, pt, Quartz.kCGMouseButtonLeft)
        Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev)
        time.sleep(down_ms / 1000)


def drag(x1: float, y1: float, x2: float, y2: float, *, steps: int = 24, hold: float = 0.0) -> None:
    """`hold` seconds pressed and still before the move, for a gesture behind a long press.

    The board's piles are dragged with `Gesture.Pan().activateAfterLongPress(220)`, and a drag that
    starts moving on the same tick it went down never activates one: the recogniser sees a flick.
    """
    down = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseDown, Quartz.CGPointMake(x1, y1), Quartz.kCGMouseButtonLeft)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, down)
    if hold:
        # Still, and silent. A repeated `LeftMouseDragged` at the same point still counts as
        # movement to a recogniser watching for it, and cancels the long press it is waiting on.
        time.sleep(hold)
    for i in range(1, steps + 1):
        pt = Quartz.CGPointMake(x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps)
        ev = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseDragged, pt, Quartz.kCGMouseButtonLeft)
        Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev)
        time.sleep(0.012)
    up = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseUp, Quartz.CGPointMake(x2, y2), Quartz.kCGMouseButtonLeft)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, up)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("x", type=float)
    ap.add_argument("y", type=float)
    ap.add_argument("--drag", nargs=2, type=float, metavar=("X2", "Y2"))
    ap.add_argument("--device", nargs=2, type=int, default=DEVICE)
    ap.add_argument("--hold", type=float, default=0.0, help="seconds pressed before the drag moves")
    args = ap.parse_args()

    subprocess.run(["osascript", "-e", 'tell application "Simulator" to activate'], check=False)
    time.sleep(0.3)
    sx, sy = to_screen(args.x, args.y, tuple(args.device))
    if args.drag:
        ex, ey = to_screen(args.drag[0], args.drag[1], tuple(args.device))
        drag(sx, sy, ex, ey, hold=args.hold)
        print(f"dragged ({args.x:.0f},{args.y:.0f}) -> ({args.drag[0]:.0f},{args.drag[1]:.0f})")
    else:
        click(sx, sy)
        print(f"tapped ({args.x:.0f},{args.y:.0f})")


if __name__ == "__main__":
    main()
