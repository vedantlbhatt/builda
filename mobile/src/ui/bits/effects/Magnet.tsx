/**
 * Magnet: the element leans toward the finger that is on it, a few points at most, and
 * springs home when the finger lifts or leaves. For primary buttons: the one amber action on a
 * screen answers the thumb with a lean as well as the kit's 0.97 press.
 *
 *   <Magnet>
 *     <Button label="That's me" haptic="commit" onPress={done} />
 *   </Magnet>
 *
 * Ported from react-bits `Animations/Magnet/Magnet.tsx` by David Haz.
 * react-bits is MIT + Commons Clause (Copyright (c) 2026 David Haz): the notice is kept
 * here as the licence asks, and the port is used as part of this application only; it is
 * not to be redistributed as a component.
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy of this
 *   software and associated documentation files (the "Software"), to deal in the Software
 *   without restriction, including without limitation the rights to use, copy, modify,
 *   merge, publish, and distribute the Software as part of an application, website, or
 *   product, subject to the following conditions: The above copyright notice and this
 *   permission notice shall be included in all copies or substantial portions of the
 *   Software. Commons Clause Restriction: You may use this Software, including for any
 *   commercial purpose, so long as you do not sell, sublicense, or redistribute the
 *   components themselves, whether alone, in a bundle, or as a ported version.
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
 *
 * What changed in the port: a window `mousemove` listener and React state per move become a
 * touch observer and two shared values on the UI thread. The original's rule stands (pull =
 * distance from the centre over `magnetStrength`, only within `padding` of the element) with
 * the pull soft clamped to `maxPt`. Its CSS transitions (0.3s ease-out following, 0.5s
 * ease-in-out home) become springs, because a finger is involved: a critically damped 300ms
 * spring while it follows, the kit's `SNAP` home. The arithmetic is in `pull.ts`.
 *
 * Reduce Motion: it does not move (the button's own press feedback still answers).
 */
import React, { useCallback, useEffect, type ReactNode } from 'react';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { SNAP, useReduceMotion } from '../../motion';
import { magnetOffset } from './pull';
import { useTouchObserver } from './runtime';
import { EFFECTS } from './spec';

const M = EFFECTS.magnet;

export interface MagnetProps {
  children?: ReactNode;
  /** How far outside the element the pull still holds, in points. Default 24. */
  padding?: number;
  /** The pull is the finger's distance from the centre over this. Default 2 (react-bits). */
  strength?: number;
  /** The most it leans on either axis, in points. Default 6. */
  maxPt?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Magnet({ children, padding = M.paddingPt, strength = M.strength, maxPt = M.maxPt, disabled = false, style }: MagnetProps) {
  const reduced = useReduceMotion();
  const w = useSharedValue(0);
  const h = useSharedValue(0);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      w.value = e.nativeEvent.layout.width;
      h.value = e.nativeEvent.layout.height;
    },
    [w, h],
  );

  const follow = { duration: M.followMs, dampingRatio: 1 };
  const pull = (x: number, y: number) => {
    'worklet';
    const p = magnetOffset(x, y, w.value, h.value, { padding, strength, maxPt });
    tx.value = withSpring(p.x, p.active ? follow : SNAP);
    ty.value = withSpring(p.y, p.active ? follow : SNAP);
  };
  const home = () => {
    'worklet';
    tx.value = withSpring(0, SNAP);
    ty.value = withSpring(0, SNAP);
  };

  const gesture = useTouchObserver({ onDown: pull, onMove: pull, onUp: home, onCancel: home }, !disabled && !reduced, [padding, strength, maxPt]);

  // Turned off mid lean (Reduce Motion switched on, the button disabled): straight home.
  useEffect(() => {
    if (!disabled && !reduced) return;
    tx.value = 0;
    ty.value = 0;
  }, [disabled, reduced, tx, ty]);

  const lean = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }, { translateY: ty.value }] }));

  return (
    <GestureDetector gesture={gesture}>
      <View collapsable={false} onLayout={onLayout} style={style}>
        <Animated.View style={lean}>{children}</Animated.View>
      </View>
    </GestureDetector>
  );
}
