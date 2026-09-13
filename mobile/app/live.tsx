import { useLocalSearchParams } from 'expo-router';
import React, { useMemo } from 'react';
import { ScrollView, View } from 'react-native';

import { LiveBar } from '../src/live/LiveBar';
import { MissionControl } from '../src/live/LiveSessions';
import { missionSample, parseSample } from '../src/live/mission';
import { colors, layout, space } from '../src/theme';
import { Section } from '../src/ui';

const c = colors('dark');

/**
 * Mission control, full screen: the Now tab's grid pushed over the tabs with a back button
 * (DESIGN-DIRECTION 7.1). Reached from the Sessions tab's "live now" row, a notification and
 * `builder://live`. The same component as the Now tab, so the two can never disagree.
 *
 * DEV only: `?sample=grid|all|empty|loading|error|stale|refused|signedout` draws the sample
 * sessions in that state, and `?bars=1` shows the session screen's live bar for each sample
 * session instead of the grid, so every state can be shot on the simulator without eight
 * agents running (`src/nav/DEEPLINKS.md`, Mission control).
 */
export default function LiveScreen() {
  const params = useLocalSearchParams<{ sample?: string; bars?: string }>();
  const sample = __DEV__ ? parseSample(params.sample) : null;
  if (__DEV__ && params.bars === '1') return <SampleBars />;
  return <MissionControl sample={sample} />;
}

/** DEV: the live bar in every state the sample has, one under another. */
function SampleBars() {
  // One instant for the whole sheet, taken once, so every bar ages from the same moment.
  const rows = useMemo(() => {
    const now = Date.now();
    return [...missionSample('all', now).live, ...missionSample('stale', now).live.slice(1, 2)];
  }, []);
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingTop: space.md, paddingBottom: space.xxl }}
    >
      <Section label="live bar, sample sessions" gap={space.tile}>
        <View style={{ gap: space.tile }}>
          {rows.map((r) => (
            <LiveBar key={r.id} session={r} animate={false} />
          ))}
        </View>
      </Section>
    </ScrollView>
  );
}
