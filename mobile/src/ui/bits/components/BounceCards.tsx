/**
 * BounceCards: a hand of card faces that fans open with a bounce, and spreads apart around the
 * one under your finger. The Wrapped cover (five faces, every time Wrapped opens) and the end of
 * the story (the five you ranked highest) (DESIGN-V2 3.1 and 4.3, row 13).
 *
 * Ported from react-bits `Components/BounceCards/BounceCards.tsx` by David Haz.
 * react-bits is MIT + Commons Clause (Copyright (c) 2026 David Haz): the notice is kept here
 * as the licence asks, and the port is used as part of this application only; it is not to be
 * redistributed as a component.
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
 * What changed in the port:
 * - Kept, number for number: the five rest transforms (rotations 10, 5, -3, -10, 2; offsets
 *   -170, -85, 0, 85, 170 on a 400 box, scaled to this one), the 0.06s stagger, and the hover
 *   push (the held card straightens, the rest move 160 away, `distance * 0.05s` apart).
 * - The entrance is not `scale: 0` on `elastic.out(1, 0.8)`: nothing enters from nothing here.
 *   The faces start stacked at 0.94 and fan out to their rest poses on the kit's `POP` (one
 *   soft overshoot, the bounce), their opacity snapping in under 100ms so no face hangs half
 *   there. It replays whenever `replayKey` changes (every time Wrapped opens).
 * - Hover is a finger: a `Manual` gesture spreads the hand around the nearest face and follows
 *   the finger across it; a tap opens that face (`onPress`). The 5px white border is gone (a
 *   face draws its own surface) and the drop shadow is the kit's one float shadow: these faces
 *   lie over each other.
 *
 * Reduce Motion: the fan fades in at rest over 150ms; no bounce, no spread; a tap still opens.
 */
import React, { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  ReduceMotion,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { floatShadow } from '../../../theme';
import { haptics, type HapticKind } from '../../haptics';
import { EASE, POP, REDUCED_FADE, useReduceMotion } from '../../motion';
import { SHAPE, type ShapeName } from '../../shape';
import { fanPoses, nearestFanCard, pushDelay, pushedPose, type FanPose } from './geometry';
import { BOUNCE } from './spec';

export interface BounceCardsProps {
  count: number;
  renderCard: (index: number) => ReactNode;
  containerWidth: number;
  containerHeight: number;
  /** One face. Default half the box wide, square (react-bits 200 in 400). */
  cardWidth?: number;
  cardHeight?: number;
  /** The rest poses. Default react-bits' five, scaled to the box. */
  poses?: readonly FanPose[];
  /** ms before the first face moves. Default 0. */
  delay?: number;
  /** Change it to play the fan again (every time Wrapped opens). */
  replayKey?: string | number;
  /** Spread the hand around the face under the finger (react-bits `enableHover`). Default on. */
  spread?: boolean;
  /** From the radius rule. Default `wrapped` (28). */
  shape?: ShapeName;
  onPress?: (index: number) => void;
  haptic?: HapticKind;
  /** What VoiceOver reads for each face. */
  labelFor?: (index: number) => string;
  style?: StyleProp<ViewStyle>;
}

export function BounceCards({
  count,
  renderCard,
  containerWidth,
  containerHeight,
  cardWidth,
  cardHeight,
  poses: posesProp,
  delay = 0,
  replayKey,
  spread = true,
  shape = 'wrapped',
  onPress,
  haptic,
  labelFor,
  style,
}: BounceCardsProps) {
  const reduce = useReduceMotion();
  const w = cardWidth ?? Math.round(containerWidth / 2);
  const h = cardHeight ?? w;
  const poses = useMemo(() => posesProp ?? fanPoses(count, containerWidth), [posesProp, count, containerWidth]);
  const push = BOUNCE.pushPt * (containerWidth / BOUNCE.designWidth);
  const held = useSharedValue(-1);

  const press = useCallback(
    (i: number) => {
      if (i < 0) return;
      if (haptic) haptics[haptic]();
      onPress?.(i);
    },
    [haptic, onPress],
  );

  const gesture = useMemo(() => {
    const track = Gesture.Manual()
      .enabled(spread && !reduce)
      .onTouchesDown((e) => {
        const t = e.allTouches[0];
        if (t) held.value = nearestFanCard(t.x, poses, containerWidth);
      })
      .onTouchesMove((e) => {
        const t = e.allTouches[0];
        if (!t) return;
        const i = nearestFanCard(t.x, poses, containerWidth);
        if (i !== held.value) held.value = i;
      })
      .onTouchesUp(() => {
        held.value = -1;
      })
      .onTouchesCancelled(() => {
        held.value = -1;
      })
      .onFinalize(() => {
        held.value = -1;
      });
    const tap = Gesture.Tap()
      .enabled(onPress !== undefined)
      .maxDuration(500)
      .onEnd((e, ok) => {
        if (ok) runOnJS(press)(nearestFanCard(e.x, poses, containerWidth));
      });
    return Gesture.Simultaneous(track, tap);
  }, [spread, reduce, held, poses, containerWidth, onPress, press]);

  const left = (containerWidth - w) / 2;
  const top = (containerHeight - h) / 2;
  const radius = SHAPE[shape];

  return (
    <GestureDetector gesture={gesture}>
      <View style={[{ width: containerWidth, height: containerHeight }, style]}>
        {poses.map((pose, i) => (
          <FanCard
            key={i}
            index={i}
            base={pose}
            held={held}
            push={push}
            delay={delay}
            replayKey={replayKey}
            reduce={reduce}
            left={left}
            top={top}
            width={w}
            height={h}
            radius={radius}
            label={labelFor?.(i)}
            onActivate={onPress ? () => press(i) : undefined}
          >
            {renderCard(i)}
          </FanCard>
        ))}
      </View>
    </GestureDetector>
  );
}

function FanCard({
  index,
  base,
  held,
  push,
  delay,
  replayKey,
  reduce,
  left,
  top,
  width,
  height,
  radius,
  label,
  onActivate,
  children,
}: {
  index: number;
  base: FanPose;
  held: SharedValue<number>;
  push: number;
  delay: number;
  replayKey?: string | number;
  reduce: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
  radius: number;
  label?: string;
  onActivate?: () => void;
  children: ReactNode;
}) {
  // 0 stacked, 1 at rest in the fan (POP overshoots it a little: the bounce).
  const open = useSharedValue(reduce ? 1 : 0);
  const shown = useSharedValue(0);
  const px = useSharedValue(0);
  const straight = useSharedValue(0);

  useEffect(() => {
    if (reduce) {
      open.value = 1;
      shown.value = 0;
      shown.value = withTiming(1, { duration: REDUCED_FADE, easing: EASE, reduceMotion: ReduceMotion.Never });
      return;
    }
    const at = delay + index * BOUNCE.staggerMs;
    open.value = 0;
    shown.value = 0;
    open.value = withDelay(at, withSpring(1, POP));
    shown.value = withDelay(at, withTiming(1, { duration: BOUNCE.snapMs, easing: EASE }));
  }, [replayKey, reduce, delay, index, open, shown]);

  // The spread: every card answers the held one, the far ones a little later.
  useAnimatedReaction(
    () => held.value,
    (h, prev) => {
      if (h === prev) return;
      const target = pushedPose(index, h, base, push);
      const wait = pushDelay(index, h);
      px.value = withDelay(wait, withSpring(target.x - base.x, POP));
      straight.value = withDelay(wait, withSpring(index === h ? 1 : 0, POP));
    },
    [index, base, push],
  );

  const place = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [
      { translateX: base.x * open.value + px.value },
      { rotate: `${base.rotate * open.value * (1 - straight.value)}deg` },
      { scale: BOUNCE.fromScale + (1 - BOUNCE.fromScale) * open.value },
    ],
  }));

  return (
    <Animated.View
      accessible={label !== undefined || onActivate !== undefined}
      accessibilityRole={onActivate ? 'button' : undefined}
      accessibilityLabel={label}
      onAccessibilityTap={onActivate}
      style={[
        {
          position: 'absolute',
          left,
          top,
          width,
          height,
          borderRadius: radius,
          borderCurve: 'continuous',
          boxShadow: floatShadow,
        },
        place,
      ]}
    >
      <View style={{ width, height, borderRadius: radius, borderCurve: 'continuous', overflow: 'hidden' }}>{children}</View>
    </Animated.View>
  );
}
