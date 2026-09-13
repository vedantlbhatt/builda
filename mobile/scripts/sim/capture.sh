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
#   STEPS="..."       subset, in order, of: prep smoke working island lock needsyou stale done
#                     handoff stalled states banners previews widget self replay app end
#                     (default: all but smoke, handoff, widget, self, replay and app)
#   CREATURE=owl      draw this creature instead of the builder's own
#   SESSION_ID=<id>   a real session id for the push payloads, so a tapped banner opens something
#   ISLAND_X, ISLAND_Y  island centre in points (default 201,32: iPhone 16 Pro and 17 Pro, 402pt wide)
#   TRANSCRIPT=<jsonl>  for `self`: a running Claude Code transcript; the step runs the live engine
#                     over it (`python3 -m analysis live T --json`) and drives the activity with
#                     what it says, through `scripts/sim/live_payload.py` and the payload= link
#   SELF_N=1          for `self`: the capture number in the file names (live-self-<n>-*.png and
#                     live-self-<n>.json, the engine's output and the ContentState beside them).
#                     SELF_N=1 ends every other activity first; later ones UPDATE the same activity
#   SELF_FRESH=1      for `self`: start the activity afresh even when SELF_N is above 1
#   REPLAY=<json>     for `replay`: a live-self-<n>.json recorded earlier, sent again (REPLAY_NAME)
#   WIDGET_ADD=0      for `widget`: photograph the gallery without adding (the widgets are there)
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
STEPS=${STEPS:-prep working island lock needsyou stale done stalled states banners previews end}
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
shot() { xcrun simctl io "$UDID" screenshot "$OUT/$1.png" >/dev/null 2>&1; print "  shot $1"; }
axe() { "$AXE" "$@" --udid "$UDID" >/dev/null 2>&1 || true; }

# Open a builder:// link with the app in front. iOS sometimes asks "Open in Builder?" first.
# Every step leaves the phone unlocked: an openurl on a locked phone fails
# (LSApplicationWorkspaceErrorDomain 115) and iOS may still deliver it later, on top of the next
# link, where two syncs race. Links longer than about 2,000 characters never reach the route
# (live_payload.py LINK_MAX).
#
# Every debug link carries a nonce. FOUND IN CAPTURE (2026-09-13): a link identical to one
# already in the route's history (`state=end` a second time) brought that screen back instead
# of pushing a new one, so its effect never ran again: the activities it was meant to end were
# still in the island for the banner and Home Screen shots.
link() {
  local url=$1
  [[ $url == builder://debug/live\?* ]] && url="$url&nonce=$RANDOM$RANDOM"
  xcrun simctl openurl "$UDID" "$url"
  axe tap --label "Open" --wait-timeout 3
  nap "${2:-3}"
}

# Anything else in front: the island shows the activity (compact, and minimal for a second one).
background() { xcrun simctl launch "$UDID" com.apple.Preferences >/dev/null; nap 1.5; }

expand() { axe touch -x "$IX" -y "$IY" --down --up --delay 1.0; nap 1.2; }

# Collapse an expanded island (or leave an app) to the Home Screen.
home() { axe button home; nap 1.5; }

# The first Home Screen page, where the widgets live: a second press scrolls back to page 1
# (or leaves jiggle mode). One press left the Home Screen shots on whichever page the widget
# gallery was opened from, a page of app icons (capture, 2026-09-13).
page1() { axe button home; nap 1.2; axe button home; nap 1.5; }

# The side button puts the 16 Pro to sleep, and the simulator then draws the dim Always-On
# display with the activity on it: `lock NAME` photographs that as NAME-aod. One home press
# then wakes the ordinary Lock Screen (a second one unlocks; the first version of this script
# pressed once and photographed Always-On as "the Lock Screen"). The first time an activity
# reaches the Lock Screen iOS asks "Allow Live Activities from Builder?", and later "continue
# to allow"; tap both away so they are not in the picture.
lock() {
  axe button lock
  nap 2.5
  [[ -n ${1:-} ]] && shot "$1-aod"
  axe button home
  nap 1.5
  # They slide in after the Lock Screen wakes: without the wait the taps land first and
  # "Always Allow" was still in the picture (lock-needs-you, first run). When SpringBoard has
  # expanded a stack of activities ("Show less") the accessibility frames are the COLLAPSED
  # layout's, so a label tap "succeeds" on empty space; it took `axe tap -x 290 -y 528` (the
  # drawn button) once. Answered "Always Allow", neither prompt comes back.
  axe tap --label "Allow" --wait-timeout 1.5
  axe tap --label "Always Allow" --wait-timeout 1.5
  nap 1
}

# From the awake Lock Screen one home press unlocks (the simulator has no passcode).
unlock() { axe button home; nap 1.5; }

step_prep() {
  # Pre-grant notifications (simctl privacy cannot); restarts SpringBoard, so it goes first.
  applesimutils --byId "$UDID" --bundle "$BUNDLE" --setPermissions "notifications=YES" >/dev/null || true
  nap 4
  # One lock and unlock: banners an earlier run posted sit on the first Lock Screen after them
  # (lock-working, second run) until the phone is unlocked once, then move to Notification Center.
  axe button lock; nap 2; axe button home; nap 1.5; axe button home; nap 1.5
  # A full ISO date: simctl says it then sets the date "on relevant devices". The iOS 18.2
  # simulator is not one: its Lock Screen reads "Saturday, January 1" either way (seen
  # 2026-09-13). No carrier name: the Lock Screen otherwise says "Carrier".
  xcrun simctl status_bar "$UDID" override --time "${SHOT_DATE:-2026-09-13T09:41:00.000-04:00}" \
    --operatorName '' --batteryState charged --batteryLevel 100 --wifiBars 3 --cellularBars 4 \
    >/dev/null 2>&1 || true
  # The live routes exist once onboarding is finished (src/nav/DEEPLINKS.md, "The gate").
  link "builder://dev-auth?onboarded=1" 3
  link "builder://debug/live?state=end" 2
}

# After an install: the app signed in (the Now tab), then one card in the compact island.
step_smoke() {
  link "builder://now" 4
  shot 00-signed-in
  link "builder://debug/live?state=working&n=1$Q" 3
  background
  shot 01-island-compact-smoke
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
  home
}

step_lock() {
  lock lock-working
  shot lock-working
  unlock
}

step_needsyou() {
  link "builder://debug/live?state=needsYou&n=2$Q"
  background
  shot island-compact-needs-you
  expand
  shot island-expanded-needs-you
  home
  lock lock-needs-you
  shot lock-needs-you
  unlock
}

# A fresh activity whose content goes stale in 10 s: "Not updating" without waiting 15 minutes.
step_stale() {
  link "builder://debug/live?state=end" 2
  link "builder://debug/live?state=working&n=1&stale=10$Q"
  background
  nap ${STALE_WAIT:-40}
  lock
  shot lock-stale
  unlock
}

# One session: with n=2 the ended card sits UNDER the running one in the Lock Screen stack and
# the picture shows only the other session working (first run).
step_done() {
  link "builder://debug/live?state=end" 2
  link "builder://debug/live?state=done&n=1$Q" 4
  background
  shot island-compact-done
  home
  lock
  shot lock-done
  unlock
}

# A finished card, then new work: the planner takes the finished card down the moment anything
# runs, so it never sits on top of a running card (live-self-3, first run: an earlier sitting's
# "finished" card was stacked above the new one).
step_handoff() {
  link "builder://debug/live?state=end" 2
  link "builder://debug/live?state=done&n=1$Q" 4
  lock
  shot lock-handoff-1-finished
  unlock
  link "builder://debug/live?state=working&n=2$Q" 4
  shot app-debug-handoff
  lock
  shot lock-handoff-2-running
  unlock
}

step_stalled() {
  link "builder://debug/live?state=end" 2
  link "builder://debug/live?state=stalled&n=1$Q"
  lock
  shot lock-stalled
  unlock
}

# The Lock Screen states the fixtures lack, one activity each, from `live_payload.py state`:
# an ETA the engine stands behind, circling inside the typical run, past the typical run, lost.
step_states() {
  local name url
  for name in working-eta circling over-typical lost; do
    url=$(python3 "$HERE/live_payload.py" state "$name" --record "$OUT/lock-$name.json")
    # 5 s: coming from the Lock Screen the app first lands on Now, then the route (first run
    # photographed Now for working-eta).
    link "$url" 5
    shot "app-debug-$name"
    lock
    shot "lock-$name"
    unlock
  done
}

# THIS machine's running session, live: the engine's own reading of TRANSCRIPT drives the
# activity. Run it more than once, minutes apart, with SELF_N=1, 2, 3. SELF_N=1 (or SELF_FRESH)
# starts clean: every other activity ends and this session's starts as it last stood
# (`--as-running`), so the link that follows is what the phone would do next: an UPDATE while
# the sitting runs, or, once the sessionizer has ended it, the END with its finished card (which
# leaves the island and stays on the Lock Screen). Later numbers only send the current truth.
step_self() {
  [[ -n ${TRANSCRIPT:-} ]] || { print -u2 "  self needs TRANSCRIPT=<a running Claude Code jsonl>"; return 1; }
  local n=${SELF_N:-1} url pre
  url=$(python3 "$HERE/live_payload.py" self "$TRANSCRIPT" --record "$OUT/live-self-$n.json") || return 1
  if [[ $n == 1 || -n ${SELF_FRESH:-} ]]; then
    pre=$(python3 "$HERE/live_payload.py" self "$TRANSCRIPT" --fresh --as-running) || return 1
    link "$pre" 4
    shot "live-self-$n-app-start"
  fi
  link "$url" 4
  shot "live-self-$n-app"
  background
  shot "live-self-$n-island-compact"
  expand
  shot "live-self-$n-island-expanded"
  home
  lock "live-self-$n-lock"
  shot "live-self-$n-lock"
  unlock
}

# A moment `self` recorded earlier, sent again through today's phone code: REPLAY=<live-self-N.json>
# (the engine's state and the row, verbatim), shot as <name>-replay-*. For a state the live
# session is not in right now: live-self-1 (04:23) was waiting on its own background task.
step_replay() {
  [[ -n ${REPLAY:-} ]] || { print -u2 "  replay needs REPLAY=<a live-self record>"; return 1; }
  local name=${REPLAY_NAME:-${REPLAY:t:r}} url
  url=$(python3 "$HERE/live_payload.py" replay "$REPLAY" --record "$OUT/$name-replay.json") || return 1
  link "$url" 4
  shot "$name-replay-app"
  background
  shot "$name-replay-island-compact"
  expand
  shot "$name-replay-island-expanded"
  home
  lock
  shot "$name-replay-lock"
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

# Add the Builder widgets by driving SpringBoard, WIDGETS="medium small" (the default) in that
# order, one pass each. The labels come from `axe describe-ui` on iOS 18.2. Verified end to end
# on the iPhone 16 Pro / 18.2 simulator, 2026-09-13, first try for both sizes. The long press
# is on empty wallpaper (y 690) because after the first widget the icon rows move down, and a
# long press on an icon opens its menu instead of jiggle mode. WIDGET_ADD=0 photographs the
# gallery and backs out without adding (the widgets from an earlier run survive an install).
add_widget() {
  page1
  axe touch -x 200 -y 690 --down --up --delay 1.5; nap 1.5        # jiggle mode
  axe tap --label "Edit"; nap 1.2
  axe tap --label "Add Widget"; nap 2.5
  axe tap -x 200 -y 176; nap 1                                      # search field
  "$AXE" type "Builder" --udid "$UDID" >/dev/null 2>&1 || true; nap 2
  axe tap -x 120 -y 256; nap 2                                      # the Builder result
  if [[ $1 == medium ]]; then
    axe swipe --start-x 330 --start-y 520 --end-x 60 --end-y 520; nap 1.2
  fi
  shot "widget-gallery-$1"
  if [[ ${WIDGET_ADD:-1} == 1 ]]; then
    axe tap --label " Add Widget"; nap 2                            # the leading space is real
  else
    # The sheet's own close button, then the gallery's. Never a swipe: in jiggle mode a drag
    # that starts on a widget MOVES it (the first try at this carried three widgets off the page).
    axe tap --label "Close" --wait-timeout 2; nap 1.2
    axe tap --label "Close" --wait-timeout 2; nap 1.2
  fi
  axe tap --label "Done"; nap 1.5
}

# Two Home Screen states: the four running fixtures in mission control order (the Codex
# session circling on top), then the same four with builder needing you, which moves it first.
step_widget() {
  link "builder://debug/live?state=end" 2      # no activity in the island over the Home Screen
  link "builder://debug/live?widget=1&n=4$Q"
  local size
  for size in ${=WIDGETS:-medium small}; do add_widget "$size"; done
  # Out of jiggle mode for certain: after the gallery closes, the first Done can land too early.
  axe tap --label "Done" --wait-timeout 2; nap 1.2
  page1
  shot home-widgets
  link "builder://debug/live?state=needsYou&n=4&widget=1$Q" 3
  link "builder://debug/live?state=end" 2
  page1; nap 1
  shot home-widget-medium
}

# The app's own screens for the live row: Now, the session it opens, and mission control. The
# row is the first card under "live now" (y 205pt on the 16 Pro); the session scrolls once.
step_app() {
  link "builder://now" 4
  shot app-now
  axe tap -x 200 -y 205; nap 3
  shot app-session-live
  axe swipe --start-x 200 --start-y 700 --end-x 200 --end-y 250; nap 1.5
  shot app-session-live-scrolled
  link "builder://live" 3
  shot app-mission-control
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
