#!/usr/bin/env bash
# Screenshot the Drops tab on the booted simulator, in the order a person meets it.
#
#   scripts/capture_drops.sh [out-dir]
#
# Needs: the app installed and signed in (scripts/overnight_stack.sh + a dev-auth link), Metro
# serving, and the board holding something. `scripts/sim_tap.py` does the touching, because
# `xcrun simctl` can screenshot and cannot touch.
#
# The coordinates are DEVICE PIXELS on an iPhone 15 Pro (1179x2556), read off a screenshot.
set -euo pipefail
OUT="${1:-shots/drops}"
mkdir -p "$OUT"
TAP="python3 scripts/sim_tap.py"
SHOT() { xcrun simctl io booted screenshot "$OUT/$1" >/dev/null; echo "  $1"; }

echo "capturing into $OUT"
xcrun simctl terminate booted com.vedantlbhatt.Builder 2>/dev/null || true
sleep 1
xcrun simctl launch booted com.vedantlbhatt.Builder >/dev/null
sleep 12                       # the first frame after a cold launch is the splash

$TAP 590 2374 >/dev/null       # the Drops tab
sleep 4
SHOT 01-board.png

$TAP 620 1280 >/dev/null       # a drop on the board: it zooms and the panel rises
sleep 3
SHOT 02-drop.png

$TAP 590 2100 --drag 590 900 >/dev/null
sleep 1
$TAP 590 2100 --drag 590 900 >/dev/null
sleep 2
SHOT 03-method.png

echo "done"
