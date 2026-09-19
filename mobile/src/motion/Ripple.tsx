/**
 * Stagger in, never out (docs/motion.md rule 4). Each child arrives on `POP` a step after the one
 * before it, rising and growing from 0.82; when `open` goes false they all leave at once in
 * `EXIT_MS`, because a group that leaves one at a time feels reluctant to go.
 */
import React, { useEffect } from 'react';
import type { ViewStyle } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';

import { staggerDelay, STAGGER_MS } from './spec';
import { EXIT, SPRING } from './springs';

export function RippleItem({
  i,
  open = true,
  per = STAGGER_MS,
  rise = 8,
  from = 0.82,
  style,
  children,
}: {
  i: number;
  open?: boolean;
  per?: number;
  rise?: number;
  from?: number;
  style?: ViewStyle | ViewStyle[];
  children: React.ReactNode;
}) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = open ? withDelay(staggerDelay(i, per), withSpring(1, SPRING.pop)) : withTiming(0, EXIT);
  }, [open, i, per, p]);
  const anim = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, p.value)),
    transform: [{ translateY: interpolate(p.value, [0, 1], [rise, 0]) }, { scale: interpolate(p.value, [0, 1], [from, 1]) }],
  }));
  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}
