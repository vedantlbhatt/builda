/**
 * The small parts the session screens share, in the house style (design-refs/HOUSE-STYLE.md):
 * a line that arrives on its block's clock, a hook that says when that clock has reached a
 * moment (for an effect with its own `play` switch, like SplitText), and the doorway, which is
 * words: a page's name set large with an arrow in its hue, never a row with a chevron.
 */
import { SymbolView } from 'expo-symbols';
import React, { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { runOnJS, useAnimatedReaction, useAnimatedStyle } from 'react-native-reanimated';

import { type, Words } from '../insights/kit';
import { ease, phase, RISE } from '../insights/motion';
import { GROUND } from '../insights/palette';
import { useClock, useReducedSV } from '../insights/reveal';
import { DOOR_TITLE } from './type';

/** Whether this block's clock has reached `at` ms. */
export function useClockReached(at: number): boolean {
  const clock = useClock();
  const [reached, setReached] = useState(false);
  useAnimatedReaction(
    () => clock.value >= at,
    (now, before) => {
      if (now && !before) runOnJS(setReached)(true);
    },
  );
  return reached;
}

/** How long one line takes to arrive. */
const ARRIVE_MS = 420;

/**
 * A line that fades and rises into place at `delay` on its block's clock, then is still. Neutral
 * ink only: a hue at partial opacity over the warm ground reads brown (DESIGN-V2 1.3).
 */
export function Arrive({ delay, children, style }: { delay: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const clock = useClock();
  const reduced = useReducedSV();
  const a = useAnimatedStyle(() => {
    const p = ease(phase(clock.value, delay, ARRIVE_MS));
    return { opacity: p, transform: [{ translateY: reduced.value ? 0 : (1 - p) * RISE }] };
  });
  return <Animated.View style={[a, style]}>{children}</Animated.View>;
}

/**
 * A way into another page, or an act: the name set large, one quiet line under it, an arrow in
 * its hue. `small` for an act inside a chapter (Save this card as an image).
 */
export function Door({
  title,
  line,
  color,
  onPress,
  small = false,
  busy = false,
  hairline = true,
  accessibilityHint,
}: {
  title: string;
  line?: string | null;
  color: string;
  onPress: () => void;
  small?: boolean;
  busy?: boolean;
  hairline?: boolean;
  accessibilityHint?: string;
}) {
  return (
    <Pressable
      onPress={busy ? undefined : onPress}
      accessibilityRole="link"
      accessibilityLabel={line ? `${title}. ${line}` : title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ busy }}
      style={({ pressed }) => [styles.door, small ? styles.doorSmall : null, hairline ? styles.hairTop : null, { opacity: pressed ? 0.55 : 1 }]}
    >
      <View style={styles.doorWords}>
        <Text maxFontSizeMultiplier={1.3} style={small ? type.lead : [DOOR_TITLE, { color: GROUND.text }]}>
          {title}
        </Text>
        {line ? <Words style={type.meta}>{line}</Words> : null}
      </View>
      {busy ? (
        <ActivityIndicator color={color} />
      ) : (
        <SymbolView name="arrow.right" tintColor={color} weight="semibold" size={small ? 17 : 22} style={small ? styles.arrowSmall : styles.arrow} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  door: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 18 },
  doorSmall: { paddingVertical: 14 },
  hairTop: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: GROUND.border },
  doorWords: { flex: 1, gap: 2 },
  arrow: { width: 22, height: 22 },
  arrowSmall: { width: 17, height: 17 },
});
