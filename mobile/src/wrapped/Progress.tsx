/**
 * The story's progress row: one thin segment per card, the Wrapped story's own mark (Spotify's
 * segmented bar, with no timer: nothing here advances by itself). The cards already seen are
 * bone, the ones ahead are the ground's raised grey, and the one in front fills from the left in
 * ITS card's hue as the card arrives, so the row always says which colour world you are in.
 * Solid colours only: a hue at partial opacity over the ground is brown.
 *
 * Reduce Motion: the current segment is simply full.
 */
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { GROUND } from '../insights/palette';
import { EASE, T, useReduceMotion } from '../ui/motion';
import { progressSegments } from './story';

/** The fill's run: the kit's entrance plus a beat, so it lands with the card. */
const FILL_MS = T.enter + 40;

export function ProgressRow({ count, front, ink }: { count: number; front: number; ink: string }) {
  const segments = progressSegments(count, front);
  return (
    <View style={styles.row} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {segments.map((s, i) => (
        <View key={i} style={[styles.segment, { backgroundColor: s === 'seen' ? GROUND.text : GROUND.raised }]}>
          {s === 'current' ? <Fill key={front} ink={ink} /> : null}
        </View>
      ))}
    </View>
  );
}

function Fill({ ink }: { ink: string }) {
  const reduce = useReduceMotion();
  const p = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (reduce) {
      p.value = 1;
      return;
    }
    p.value = withTiming(1, { duration: FILL_MS, easing: EASE, reduceMotion: ReduceMotion.Never });
  }, [p, reduce]);
  const style = useAnimatedStyle(() => ({ width: `${p.value * 100}%` }));
  return <Animated.View style={[styles.fill, { backgroundColor: ink }, style]} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 4, height: 3 },
  segment: { flex: 1, height: 3, borderRadius: 1.5, borderCurve: 'continuous', overflow: 'hidden' },
  fill: { height: 3 },
});
