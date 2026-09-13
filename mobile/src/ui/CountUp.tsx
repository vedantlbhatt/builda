/**
 * A number that counts up on its FIRST reveal only (a Wrapped answer, an archetype number,
 * the session hero), over 800ms on `EASE`. After that, and under Reduce Motion, it is just
 * the number. Live numbers never count up; they roll (`Counter`).
 *
 * Ported from react-bits `TextAnimations/CountUp/CountUp.tsx` by David Haz, MIT + Commons
 * Clause (Copyright (c) 2026 David Haz; the full notice is in `digits.ts`; used as part of
 * this application, not redistributed). Changes: a timing curve from the motion vocabulary
 * instead of the original's spring, the value drawn into a TextInput's `text` on the UI
 * thread (no React render per frame), and a formatter that runs in a worklet (no `Intl`).
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { runOnJS, useAnimatedProps, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import type { TypeRole } from '../theme';
import { decimalsOf, formatCount } from './format';
import { COUNT_UP_MS, timing, useReduceMotion } from './motion';
import { toneColor, useColors, type Tone } from './scheme';
import { T } from './Text';
import { roleScaling, roleStyle, type RoleWeight } from './typeStyle';

// On Fabric, Reanimated commits every animated prop through the shadow tree, and a prop on
// neither allowlist is ALSO bounced to the JS thread, re-rendering this component every
// frame. `text` goes on the native list so it only takes the commit path: the TextInput's
// shadow node rebuilds its attributed string from `text` during layout. `defaultValue` is
// deliberately not animated for the same reason.
Animated.addWhitelistedNativeProps({ text: true });
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

export interface CountUpProps {
  to: number;
  from?: number;
  /** Default the larger of `from`'s and `to`'s written decimals, so the width never jumps. */
  decimals?: number;
  /** Default true: "229,367". */
  grouping?: boolean;
  prefix?: string;
  suffix?: string;
  /** Default `display` (40/800): the one big number. `hero` on a Wrapped card. */
  role?: TypeRole;
  weight?: RoleWeight;
  tone?: Tone;
  /** Start when this is true (a card scrolled into view). Counts once per mount. */
  play?: boolean;
  delay?: number;
  duration?: number;
  align?: 'left' | 'center' | 'right';
  onEnd?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function CountUp({
  to,
  from = 0,
  decimals,
  grouping = true,
  prefix = '',
  suffix = '',
  role = 'display',
  weight,
  tone = 'text',
  play = true,
  delay = 0,
  duration = COUNT_UP_MS,
  align = 'left',
  onEnd,
  style,
}: CountUpProps) {
  const c = useColors();
  const reduce = useReduceMotion();
  const places = decimals ?? Math.max(decimalsOf(from), decimalsOf(to));
  const final = formatCount(to, places, grouping, prefix, suffix);

  const shown = useSharedValue(play && !reduce ? from : to);
  const counted = useRef(false);
  // A ref, so a parent re-rendering with a new inline `onEnd` cannot re-run the effect
  // mid-count (which would land the number early).
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const fireEnd = useCallback(() => onEndRef.current?.(), []);

  useEffect(() => {
    if (!play) return;
    if (counted.current || reduce) {
      shown.value = to; // first reveal only: later changes, and Reduce Motion, just land
      return;
    }
    counted.current = true;
    shown.value = from;
    shown.value = withDelay(
      delay,
      withTiming(to, timing(duration), (finished) => {
        if (finished) runOnJS(fireEnd)();
      }),
    );
  }, [play, to, from, delay, duration, reduce, shown, fireEnd]);

  const animatedProps = useAnimatedProps(() => {
    const text = formatCount(shown.value, places, grouping, prefix, suffix);
    return { text } as unknown as Partial<React.ComponentProps<typeof TextInput>>;
  });

  const font = roleStyle(role, weight);
  return (
    <View accessible accessibilityRole="text" accessibilityLabel={final} style={style}>
      {/* Holds the final width and height, so nothing beside the number moves while it counts. */}
      <T role={role} weight={weight} align={align} style={styles.hidden} importantForAccessibility="no">
        {final}
      </T>
      <AnimatedTextInput
        editable={false}
        pointerEvents="none"
        underlineColorAndroid="transparent"
        importantForAccessibility="no"
        accessibilityElementsHidden
        defaultValue={formatCount(play && !reduce ? from : to, places, grouping, prefix, suffix)}
        animatedProps={animatedProps}
        {...roleScaling(role)}
        style={[
          StyleSheet.absoluteFill,
          font,
          { color: toneColor(c, tone), textAlign: align, padding: 0, margin: 0 },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: { opacity: 0 },
});
