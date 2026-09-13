import { useLocalSearchParams } from 'expo-router';
import React from 'react';

import { MissionControl } from '../../src/live/LiveSessions';
import { parseSample } from '../../src/live/mission';

/**
 * Now: mission control, inline (DESIGN-DIRECTION 7.1). Every running session as a tile, two to a
 * row, the one that needs you first; Bit and "Nothing needs you." when nothing runs.
 *
 * WHY THE GRID AND NOT A ROW INTO IT. The design's one row summary ("3 running · 1 needs you")
 * was written for the tabs whose job is something else (it now leads Sessions, `LiveSessions`).
 * What is running IS this tab's job: a row that pushed to the same grid would leave the tab
 * empty and put a tap on the most frequent path the app has. Three rows of tiles fit above the
 * fold on a 6.1" phone, the tab bar stays for the next tap, and `/live` is the same component
 * pushed full screen for everything that links to mission control (the Sessions row, a
 * notification, a deep link), so the two can never differ.
 *
 * Cache first, then a sync every 60 s while this tab is focused, as Sessions does: switching
 * tabs never shows a spinner, and only the focused tab polls.
 *
 * `?sample=` (DEV only) draws the sample sessions instead: see `mission.SAMPLE_KINDS`.
 */
export default function NowScreen() {
  const params = useLocalSearchParams<{ sample?: string }>();
  const sample = __DEV__ ? parseSample(params.sample) : null;
  return <MissionControl sample={sample} />;
}
