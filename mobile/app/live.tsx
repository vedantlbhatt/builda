import { Stack, useLocalSearchParams } from 'expo-router';
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { GROUND } from '../src/insights/palette';
import { LiveBar } from '../src/live/LiveBar';
import { MissionControl } from '../src/live/LiveSessions';
import { missionSample, parseSample } from '../src/live/mission';
import { layout } from '../src/theme';
import { T } from '../src/ui';

/**
 * Mission control, full screen: the Now tab's chapter pushed over the tabs with a back button.
 * Reached from the Now tab's summary band, the Sessions tab's "Live now" band, a notification
 * and `builder://live`. The same component as the Now tab, so the two can never disagree.
 *
 * DEV only: `?sample=grid|all|empty|loading|error|stale|refused|signedout|review` draws the sample
 * sessions in that state, and `?bars=1` shows the session screen's live bar for each sample
 * session instead of the grid, so every state can be shot on the simulator without eight
 * agents running (`src/nav/DEEPLINKS.md`, Mission control).
 */
export default function LiveScreen() {
  const params = useLocalSearchParams<{ sample?: string; bars?: string }>();
  const sample = __DEV__ ? parseSample(params.sample) : null;
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Mission control',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: GROUND.bg },
          headerTintColor: GROUND.text,
          headerTitleStyle: { color: GROUND.text },
        }}
      />
      {__DEV__ && params.bars === '1' ? <SampleBars /> : <MissionControl sample={sample} />}
    </>
  );
}

/** DEV: the live bar in every state the sample has, one under another. */
function SampleBars() {
  // One instant for the whole sheet, taken once, so every bar ages from the same moment.
  const rows = useMemo(() => {
    const now = Date.now();
    return [...missionSample('all', now).live, ...missionSample('review', now).live.slice(0, 1), ...missionSample('stale', now).live.slice(1, 2)];
  }, []);
  return (
    <ScrollView style={styles.sheet} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.sheetContent}>
      <T role="label" tone="dim">
        live bar, sample sessions
      </T>
      <View style={styles.bars}>
        {rows.map((r) => (
          <LiveBar key={r.id} session={r} animate={false} />
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: GROUND.bg },
  sheetContent: { paddingHorizontal: layout.gutter, paddingTop: 16, paddingBottom: 64, gap: 12 },
  bars: { gap: 16 },
});
