#!/bin/zsh
# Screenshot every live surface on a simulator: the Dynamic Island (compact, minimal beside it,
# expanded), the Lock Screen Live Activity in each state (working, needs you, stale, finished,
# stalled), the push banners that stand in when no activity runs, the Home Screen widget, and
# the ImageRenderer previews of every state pulled out of the app's Documents.
#
# Adapted from design-refs/research/live-activities-assets/kit/sim-capture.sh, whose steps were
# each run by hand on Xcode 26.5 against the iPhone 16 Pro / iOS 18.2 simulator. This file
# strings them together through the app's own dev link instead of launch arguments.
#
# Usage (from anywhere):
#   mobile/scripts/sim/capture.sh [run-name]
#     writes <repo>/shots/<run-name>/  (default run name: live-<date>-<time>)
#
# Environment (all optional):
#   UDID=<udid>       simulator to drive (default: the first booted one)
#   BUNDLE=...        default com.vedantlbhatt.Builder
#   AXE=<path>        default /Users/vedantbhatt/.builder-overnight/tools/axe (AXe 1.8.0, not on PATH)
#   STEPS="..."       subset, in order, of: prep working island lock needsyou stale done stalled
#                     banners previews widget end   (default: all but widget)
#   CREATURE=owl      draw this creature instead of the builder's own
#   SESSION_ID=<id>   a real session id for the push payloads, so a tapped banner opens something
#   ISLAND_X, ISLAND_Y  island centre in points (default 201,32: iPhone 16 Pro and 17 Pro, 402pt wide)
#
# Needs: a build of this branch made after `npx expo prebuild -p ios --clean` (the widget target
# and the BuilderLive module), installed on a Dynamic Island simulator, and applesimutils on
# PATH. `simctl install` ENDS running activities, so run this after installing, not before.
# ActivityKit only STARTS an activity with the app in front, which each dev link guarantees.
# Not possible here, by design of the simulator: an activity update by APNs push (`simctl push`
# ignores content-state; use the APNs sandbox with the token from onPushToken), and the alert's
# own expanded presentation (the update happens with the app in front, so the long press stands in).
set -euo pipefail

HERE=${0:A:h}
REPO=${HERE:h:h:h}
RUN=${1:-live-$(date +%Y%m%d-%H%M%S)}
OUT=${OUT:-$REPO/shots/$RUN}
BUNDLE=${BUNDLE:-com.vedantlbhatt.Builder}
AXE=${AXE:-/Users/vedantbhatt/.builder-overnight/tools/axe}
STEPS=${STEPS:-prep working island lock needsyou stale done stalled banners previews end}
IX=${ISLAND_X:-201}
IY=${ISLAND_Y:-32}
Q=${CREATURE:+&creature=$CREATURE}

if [[ -z ${UDID:-} ]]; then
  UDID=$(xcrun simctl list devices booted -j | python3 -c 'import json,sys
d=json.load(sys.stdin)["devices"]
print(next((x["udid"] for v in d.values() for x in v if x["state"]=="Booted"), ""))')
fi
[[ -n $UDID ]] || { print -u2 "no booted simulator: boot one or set UDID"; exit 1; }
[[ -x $AXE ]] || { print -u2 "AXe not found at $AXE (set AXE)"; exit 1; }
command -v applesimutils >/dev/null || { print -u2 "applesimutils not on PATH (brew tap wix/brew && brew install applesimutils)"; exit 1; }
xcrun simctl get_app_container "$UDID" "$BUNDLE" >/dev/null 2>&1 || { print -u2 "$BUNDLE is not installed on $UDID"; exit 1; }

mkdir -p "$OUT"
print "capturing into $OUT on $UDID"

nap() { python3 -c "import time; time.sleep($1)"; }
shot() { xcrun simctl io "$UDID" screenshot "$OUT/$1.png" >/dev/null; print "  shot $1"; }
axe() { "$AXE" "$@" --udid "$UDID" >/dev/null 2>&1 || true; }

# Open a builder:// link with the app in front. iOS sometimes asks "Open in Builder?" first.
link() {
  xcrun simctl openurl "$UDID" "$1"
  axe tap --label "Open" --wait-timeout 3
  nap "${2:-3}"
}

# Anything else in front: the island shows the activity (compact, and minimal for a second one).
background() { xcrun simctl launch "$UDID" com.apple.Preferences >/dev/null; nap 1.5; }

expand() { axe touch -x "$IX" -y "$IY" --down --up --delay 1.0; nap 1.2; }

# The first time an activity reaches the Lock Screen iOS asks "Allow Live Activities from
# Builder?", and later "continue to allow"; tap both away so they are not in the picture.
lock() {
  axe button lock
  nap 2
  axe tap --label "Allow"
  axe tap --label "Always Allow"
  nap 1.5
}

unlock() { axe button home; nap 1.5; }

step_prep() {
  xcrun simctl status_bar "$UDID" override --time 9:41 --batteryState charged --batteryLevel 100 \
    --wifiBars 3 --cellularBars 4 >/dev/null 2>&1 || true
  # Pre-grant notifications (simctl privacy cannot); restarts SpringBoard.
  applesimutils --byId "$UDID" --bundle "$BUNDLE" --setPermissions "notifications=YES" >/dev/null || true
  nap 4
  # The live routes exist once onboarding is finished (src/nav/DEEPLINKS.md, "The gate").
  link "builder://dev-auth?onboarded=1" 3
  link "builder://debug/live?state=end" 2
}

step_working() {
  link "builder://debug/live?state=working&n=2&widget=1$Q"
  shot app-debug-working
}

step_island() {
  background
  shot island-compact-and-minimal-working
  expand
  shot island-expanded-working
  unlock
}

step_lock() {
  lock
  shot lock-working
  unlock
}

step_needsyou() {
  link "builder://debug/live?state=needsYou&n=2$Q"
  background
  shot island-compact-needs-you
  expand
  shot island-expanded-needs-you
  unlock
  lock
  shot lock-needs-you
  unlock
}

# A fresh activity whose content goes stale in 10 s: "Not updating" without waiting 15 minutes.
step_stale() {
  link "builder://debug/live?state=end" 2
  link "builder://debug/live?state=working&n=1&stale=10$Q"
  background
  nap 11
  lock
  shot lock-stale
  unlock
}

step_done() {
  link "builder://debug/live?state=end" 2
  link "builder://debug/live?state=done&n=2$Q" 4
  lock
  shot lock-done
  unlock
}

step_stalled() {
  link "builder://debug/live?state=end" 2
  link "builder://debug/live?state=stalled&n=1$Q"
  lock
  shot lock-stalled
  unlock
}

# Never both (HIG): the banners are what the phone posts when NO activity runs, so end them first.
step_banners() {
  link "builder://debug/live?state=end" 2
  background
  local sid=${SESSION_ID:-debug-builder}
  for name in needs-you finished; do
    sed "s/debug-builder/$sid/g" "$HERE/$name.apns" > "$OUT/$name.apns"
    xcrun simctl push "$UDID" "$BUNDLE" "$OUT/$name.apns" >/dev/null
    nap 1.5
    shot "banner-$name"
    nap 5
  done
}

# Every state of every surface, drawn by ImageRenderer from the same SwiftUI in Documents.
step_previews() {
  link "builder://debug/live?render=1" 8
  local data
  data=$(xcrun simctl get_app_container "$UDID" "$BUNDLE" data)
  if [[ -d $data/Documents/live-previews ]]; then
    mkdir -p "$OUT/previews"
    cp "$data"/Documents/live-previews/*.png "$OUT/previews/"
    print "  previews $(ls "$OUT/previews" | wc -l | tr -d ' ')"
  else
    print -u2 "  no Documents/live-previews: is the widget target in this build?"
  fi
}

# Add the medium widget by driving SpringBoard. Flaky by nature: the labels come from
# `axe describe-ui` on iOS 18.2, and the widget sizes on a 402pt phone are not the HIG's.
step_widget() {
  link "builder://debug/live?widget=1&n=4$Q"
  axe button home; nap 1.5
  axe touch -x 200 -y 600 --down --up --delay 1.5; nap 1.5        # jiggle mode
  axe tap --label "Edit"; nap 1.2
  axe tap --label "Add Widget"; nap 2.5
  axe tap -x 200 -y 176; nap 1                                      # search field
  "$AXE" type "Builder" --udid "$UDID" >/dev/null 2>&1 || true; nap 2
  axe tap -x 120 -y 256; nap 2
  shot widget-gallery-small
  axe swipe --start-x 330 --start-y 520 --end-x 60 --end-y 520; nap 1.2
  shot widget-gallery-medium
  axe tap --label " Add Widget"; nap 2                              # the leading space is real
  axe tap --label "Done"; nap 1.5
  shot home-widget-medium
}

step_end() {
  link "builder://debug/live?state=end" 2
  xcrun simctl status_bar "$UDID" clear >/dev/null 2>&1 || true
}

for s in ${=STEPS}; do
  print "$s"
  "step_$s"
done
print "done: $OUT"
