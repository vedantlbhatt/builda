import { useLocalSearchParams } from 'expo-router';
import React from 'react';

import { MissionControl } from '../../src/live/LiveSessions';
import { parseSample } from '../../src/live/mission';

/**
 * Now: mission control, inline. One chapter under the large title: the summary band in the
 * builder's creature hue ("1 needs you", or "3 running" and "Nothing needs you."), which is the
 * doorway into `/live`, and under it every running session as a tile printed in its own
 * creature's hue, the one who needs you most first and largest. When nothing runs the whole
 * tab is the builder's band with Bit asleep on it: "Nothing needs you. Go do something else."
 *
 * WHY THE GRID AND NOT ONLY A DOORWAY. What is running IS this tab's job: a band that pushed to
 * the same grid would leave the tab empty and put a tap on the most frequent path the app has.
 * So the tiles are here, and the band opens `/live`, the same component pushed full screen over
 * the tabs (where a notification lands), so the two can never differ.
 *
 * Cache first, then a sync every 60 s while this tab is focused, as Sessions does: switching
 * tabs never shows a spinner, and only the focused tab polls.
 *
 * `?sample=` (DEV only) draws the sample sessions instead: see `mission.SAMPLE_KINDS`.
 */
export default function NowScreen() {
  const params = useLocalSearchParams<{ sample?: string }>();
  const sample = __DEV__ ? parseSample(params.sample) : null;
  return <MissionControl sample={sample} doorway />;
}
