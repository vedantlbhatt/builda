import React, { useCallback, useEffect, useState, type ReactNode } from 'react';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { EASE, REDUCED_FADE, staggerDelay, T as DUR, useReduceMotion } from '../ui/motion';
import { RISE_AFTER_MS, RISE_PT, WIPE_MS } from './flow';

/** A partial wipe never runs faster than this, however little is left to sweep. */
const WIPE_MIN_MS = 280;

/**
 * The two entrances onboarding has left (DESIGN-DIRECTION 4, "Motion inside a step"): a
 * headline wiping in from the left, and a line of grey text rising 8pt. Hello uses both; the
 * creature step wipes in the part of its caption after the name. Every other step arrives with
 * its push and nothing else: the push IS the entrance, and a second motion on top of it read
 * as a glitch. Nothing amber ever rises or fades in here: amber at partial opacity over the
 * canvas is brown. Nothing loops, and both run once: walking back to a step shows it as it
 * was left.
 *
 * Reduce Motion: the headline is simply there and a rise is a 150ms fade without moving.
 */

/** Fade up 8pt. `index` orders the stagger (40ms apart, capped at eight). */
export function Rise({
  index = 0,
  delay = RISE_AFTER_MS,
  children,
  style,
}: {
  index?: number;
  delay?: number;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReduceMotion();
  const p = useSharedValue(0);
  useEffect(() => {
    const at = delay + staggerDelay(index);
    // Never skipped: under Reduce Motion this is the 150ms fade that replaces the rise, and
    // Reanimated would otherwise jump it (its default follows the system setting).
    p.value = withDelay(
      at,
      withTiming(1, { duration: reduced ? REDUCED_FADE : DUR.enter, easing: EASE, reduceMotion: ReduceMotion.Never }),
    );
  }, [p, reduced, delay, index]);
  const animated = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ translateY: reduced ? 0 : (1 - p.value) * RISE_PT }],
  }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

/**
 * The headline wipe: a clip that sweeps left to right over 520ms on `EASE` while the text
 * inside it stays still (the clip moves right, its contents move left by the same amount, so
 * only the edge travels). Hard edged on purpose: the pixel grid is the only texture here, and
 * a blur would be a second one.
 *
 * `from`: points already showing when it starts (the name, on the creature step, so only what
 * follows it sweeps in, over the matching share of the time). `start`: hold at `from` until
 * true.
 */
export function Wipe({
  delay = 0,
  from = 0,
  start = true,
  children,
  style,
}: {
  delay?: number;
  from?: number;
  start?: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReduceMotion();
  const [width, setWidth] = useState(0);
  const p = useSharedValue(0);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setWidth((was) => (was > 0 ? was : w));
  }, []);

  useEffect(() => {
    if (width <= 0) return;
    if (reduced) {
      p.value = 1;
      return;
    }
    const p0 = Math.min(1, Math.max(0, from / width));
    if (!start) {
      p.value = p0;
      return;
    }
    const ms = Math.max(WIPE_MIN_MS, Math.round(WIPE_MS * (1 - p0)));
    p.value = p0;
    // Never: Reduce Motion is handled above from the live setting; Reanimated's own reads it
    // once at launch.
    p.value = withDelay(delay, withTiming(1, { duration: ms, easing: EASE, reduceMotion: ReduceMotion.Never }));
  }, [width, reduced, delay, p, from, start]);

  const outer = useAnimatedStyle(() => ({
    // Nothing until measured, so the first frame never shows the whole line and then wipes it.
    opacity: width > 0 ? 1 : 0,
    transform: [{ translateX: (p.value - 1) * width }],
  }));
  const inner = useAnimatedStyle(() => ({ transform: [{ translateX: (1 - p.value) * width }] }));

  return (
    <View style={style} onLayout={onLayout}>
      <Animated.View style={[{ overflow: 'hidden' }, outer]}>
        <Animated.View style={inner}>{children}</Animated.View>
      </Animated.View>
    </View>
  );
}
