#!/usr/bin/env bash
# Screenshot a simulator N times, T seconds apart, and tile the TOP of every frame into one sheet.
#
#   scripts/sim_burst.sh UDID OUT_DIR [N=16] [T=1.0] [CROP_H=620]
#
# For reviewing motion that a single screenshot cannot show (the island's morphs): the sheet is
# OUT_DIR/sheet.png, the frames OUT_DIR/f01.png... Always pass a UDID: with two simulators booted
# `booted` picks whichever it likes, and a sheet of another device's black screen looks exactly
# like a broken app.
set -euo pipefail
UDID="$1"; OUT="$2"; N="${3:-16}"; T="${4:-1.0}"; CROP_H="${5:-620}"
mkdir -p "$OUT"
rm -f "$OUT"/f*.png "$OUT"/sheet.png
for i in $(seq -w 1 "$N"); do
  xcrun simctl io "$UDID" screenshot "$OUT/f$i.png" >/dev/null 2>&1
  sleep "$T"
done
W=$(sips -g pixelWidth "$OUT/f01.png" | awk '/pixelWidth/ {print $2}')
ffmpeg -v error -y -pattern_type glob -i "$OUT/f*.png" -vf "crop=$W:$CROP_H:0:0,scale=400:-1,tile=2x$(( (N + 1) / 2 ))" "$OUT/sheet.png"
echo "$OUT/sheet.png"
