#!/usr/bin/env bash
#
# Film the notch island's demo cycle from inside the app (docs/mac-island.md).
#
#   scripts/island_demo.sh OUT_DIR [SECONDS] [--edge]
#
# Launches build/Builder.app with BUILDER_ISLAND_DEMO=1 (fixture data, the store untouched)
# and BUILDER_ISLAND_RECORD=OUT_DIR/frames, waits, quits it, and writes OUT_DIR/island.mp4
# and a still per demo step. --edge draws a hairline round the black shape, which is otherwise
# invisible on a black menu bar. BUILDER_ANALYSIS=0 so a demo never calls `claude -p`.
#
# The app films itself because a process without the Screen Recording permission gets only
# its own windows over the wallpaper and menu bar (IslandRecorder), which is exactly the
# picture wanted, and `screencapture` refuses outright on such a machine.

set -euo pipefail
cd "$(dirname "$0")/.."

OUT="${1:?usage: scripts/island_demo.sh OUT_DIR [SECONDS] [--edge]}"
SECONDS_TO_RECORD="${2:-25}"
EDGE=0
for a in "$@"; do [ "$a" = "--edge" ] && EDGE=1; done

APP="build/Builder.app/Contents/MacOS/Builder"
[ -x "$APP" ] || ./scripts/make_app.sh

pkill -f "Builder.app/Contents/MacOS/Builder" 2>/dev/null || true
rm -rf "$OUT/frames"
mkdir -p "$OUT/frames"

BUILDER_ISLAND_DEMO=1 BUILDER_ANALYSIS=0 BUILDER_ISLAND_EDGE="$EDGE" \
  BUILDER_ISLAND_RECORD="$OUT/frames" BUILDER_ISLAND_RECORD_SECONDS="$SECONDS_TO_RECORD" \
  "$APP" > "$OUT/app.log" 2>&1 &
PID=$!

# Wait for the recorder to finish (it logs when it has written every frame).
for _ in $(seq 1 $((SECONDS_TO_RECORD + 20))); do
  grep -q "island recorder wrote" "$OUT/app.log" 2>/dev/null && break
  sleep 1
done
kill "$PID" 2>/dev/null || true

ffmpeg -loglevel error -y -framerate 30 -i "$OUT/frames/frame_%05d.png" \
  -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -c:v libx264 -pix_fmt yuv420p "$OUT/island.mp4"

# One still per step, 1.2 s after it began: every morph has settled by then (ISLAND settles
# inside 0.5 s, the shipped sentence's last word lands by 0.6 s).
while read -r t name; do
  frame=$(awk -v t="$t" 'BEGIN{printf "%05d", (t + 1.2) * 30}')
  [ -f "$OUT/frames/frame_$frame.png" ] && cp "$OUT/frames/frame_$frame.png" "$OUT/$name.png"
done < "$OUT/frames/demo-steps.log"

echo "$OUT/island.mp4"
ls "$OUT"/*.png
