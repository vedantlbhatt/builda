import React, { useEffect, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { EASE, REDUCED_FADE, useReduceMotion } from '../ui/motion';
import { TILE_POP, tilePopAt, tilePopTurn } from './flow';

/** A cut: the opacity is whole on the first frame of the arrival. */
const CUT_MS = 1;

/**
 * One of a set of things dropping into place one after another, as yazio's welcome assets do
 * (appllama-top-welcome-screens yazio, 1.167 to 1.733 s; numbers only): the `index`th starts
 * 67ms after the one before, falls 18pt from 0.94 of its size and a 13 to 24 degree turn, and
 * lands on `out(back(1.5))` in 250ms, so it overshoots a hair and settles. Its opacity is a cut
 * at its start: colour enters by position, never by a fade.
 *
 * `play`: hold until true (a step's push has landed). Once only. Reduce Motion: a 150ms fade in
 * place, nothing moves.
 */
export function Pop({ index, delay = 0, play = true, children, style }: { index: number; delay?: number; play?: boolean; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduced = useReduceMotion();
  const shown = useSharedValue(0);
  const p = useSharedValue(0);
  const turn = tilePopTurn(index);

  useEffect(() => {
    if (!play) return;
    if (reduced) {
      p.value = 1;
      shown.value = withTiming(1, { duration: REDUCED_FADE, easing: EASE, reduceMotion: ReduceMotion.Never });
      return;
    }
    const at = delay + tilePopAt(index);
    shown.value = withDelay(at, withTiming(1, { duration: CUT_MS, reduceMotion: ReduceMotion.Never }));
    p.value = withDelay(at, withTiming(1, { duration: TILE_POP.ms, easing: Easing.out(Easing.back(TILE_POP.back)), reduceMotion: ReduceMotion.Never }));
    // Once: a step that re-renders never drops its tiles again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play]);

  const drop = TILE_POP.dropPt;
  const from = TILE_POP.fromScale;
  const moved = useAnimatedStyle(() => {
    const k = p.value;
    return {
      opacity: shown.value,
      transform: [{ translateY: (1 - k) * -drop }, { rotate: `${(1 - k) * turn}deg` }, { scale: from + (1 - from) * k }],
    };
  });
  return <Animated.View style={[style, moved]}>{children}</Animated.View>;
}
