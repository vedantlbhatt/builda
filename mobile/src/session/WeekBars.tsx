/**
 * This week as seven bars, in the Sessions band's dark ink (or in the builder's ink on the ground,
 * under the live band): each finished day stands at its hours against the week's biggest day, a
 * day with nothing finished is a two point stub on the floor, the days still to come are only
 * their letter. Today's letter is the bold one. The bars grow from the floor one after another on
 * the page's spring, then stand still.
 *
 * Borrowed: Apple Fitness's ring detail opens on "an hour by hour bar chart in the ring's
 * colour" (design-md/fitness/apple-fitness); this is that chart a week wide, printed in the
 * band's ink the way the analysis page prints its creature (one ink on one hue, no gradient).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { DRAW_MS, phase, spring } from '../insights/motion';
import { GROUND, ON_HUE } from '../insights/palette';
import { useClock } from '../insights/reveal';
import { AXIS } from './type';
import type { WeekModel } from './week';

const BAR = 10;
const GAP = 7;
const TALL = 58;

export const WEEK_BARS_WIDTH = BAR * 7 + GAP * 6;

export function WeekBars({ week, delay = 300, color = ON_HUE }: { week: WeekModel; delay?: number; color?: string }) {
  const most = Math.max(1, ...week.days.map((d) => d.seconds));
  return (
    <View style={styles.wrap} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.plot}>
        {week.days.map((d, i) => (
          <View key={d.date} style={styles.slot}>
            {d.future ? null : d.seconds > 0 ? (
              <Grow height={Math.max(4, Math.round((d.seconds / most) * TALL))} delay={delay + i * 70} color={color} />
            ) : (
              <View style={[styles.stub, { backgroundColor: color }]} />
            )}
          </View>
        ))}
      </View>
      <View style={styles.letters}>
        {week.days.map((d) => (
          <Text key={d.date} allowFontScaling={false} style={[AXIS, styles.letter, { color: color === ON_HUE ? ON_HUE : GROUND.dim }, d.today ? styles.today : null, d.future ? styles.future : null]}>
            {d.letter}
          </Text>
        ))}
      </View>
    </View>
  );
}

function Grow({ height, delay, color }: { height: number; delay: number; color: string }) {
  const clock = useClock();
  const a = useAnimatedStyle(() => ({ transform: [{ scaleY: spring(phase(clock.value, delay, DRAW_MS)) }] }));
  return <Animated.View style={[styles.bar, { height, backgroundColor: color, transformOrigin: 'bottom' }, a]} />;
}

const styles = StyleSheet.create({
  wrap: { width: WEEK_BARS_WIDTH },
  plot: { height: TALL, flexDirection: 'row', alignItems: 'flex-end', gap: GAP },
  slot: { width: BAR, height: TALL, justifyContent: 'flex-end' },
  bar: { width: BAR },
  stub: { width: BAR, height: 2 },
  letters: { flexDirection: 'row', gap: GAP, marginTop: 6 },
  letter: { width: BAR, textAlign: 'center' },
  today: { fontWeight: '800', textDecorationLine: 'underline' },
  future: { opacity: 0.45 },
});
