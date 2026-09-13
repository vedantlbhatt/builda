/**
 * TiltedCard: a card that leans toward the finger on it, springs home when let go, and can
 * carry a stepped glare that sweeps with the lean. The Wrapped share preview and ProfileCard
 * wear it (DESIGN-V2 4.3, row 15).
 *
 * Ported from react-bits `Components/TiltedCard/TiltedCard.tsx` by David Haz.
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
 * - The mouse is a finger. The lean follows a Gesture Handler `Manual` gesture's touches on
 *   the UI thread; `Manual` never activates, so a card inside a scroll view still scrolls and
 *   a Pressable inside it still presses. When the scroll takes the touch, the card lets go.
 * - react-bits' `rotateAmplitude 14` and `scaleOnHover 1.1` are 8 degrees and 1.02
 *   (`TILT` in spec.ts); its `{ damping 30, stiffness 100, mass 2 }` follow spring, which is
 *   critically damped, is the kit's `SNAP`. The perspective stays 800.
 * - The tooltip that trails the cursor is gone (there is no cursor). The glare is
 *   GlareHover's stepped band (three flat steps, never a ramp), which the original does not
 *   have; it is off unless asked for.
 * - `intro` is react-bits ProfileCard's arrival: the lean starts where its pointer starts
 *   (70 in from the right, 60 down) and eases home over 1.2s.
 *
 * Reduce Motion: no lean, no lift, no glare; a press still presses, with the kit's opacity dip.
 */
import React, { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { ReduceMotion, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';

import { floatShadow } from '../../../theme';
import { haptics, type HapticKind } from '../../haptics';
import { EASE, exitMs, SNAP, T, useReduceMotion } from '../../motion';
import { useColors } from '../../scheme';
import { SHAPE, type ShapeName } from '../../shape';
import { glareOffset, introPoint, tiltAt } from './geometry';
import { PROFILE, TILT } from './spec';

export interface TiltedCardProps {
  width: number;
  height: number;
  /** The face. It draws its own surface; the card clips it to `shape`. */
  children?: ReactNode;
  /** Degrees at the edge. Default 8 (react-bits 14). */
  maxTilt?: number;
  /** While held. Default 1.02 (react-bits 1.1). */
  scaleOnPress?: number;
  /** Default 800, react-bits'. */
  perspective?: number;
  /** The stepped glare that sweeps with the lean. Default off. */
  glare?: boolean;
  /** From the radius rule. Default `wrapped` (28): the share card and ProfileCard. */
  shape?: ShapeName;
  /** react-bits ProfileCard's arrival sweep, once on mount. Default off. */
  intro?: boolean;
  /** Lean toward the finger. Default on; off keeps the press. */
  lean?: boolean;
  /** The one shadow, for a card that floats over content (the share preview). Default off. */
  floating?: boolean;
  onPress?: () => void;
  /** Fired with the press, on the same frame. */
  haptic?: HapticKind;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

export function TiltedCard({
  width,
  height,
  children,
  maxTilt = TILT.maxDeg,
  scaleOnPress = TILT.pressScale,
  perspective = TILT.perspective,
  glare = false,
  shape = 'wrapped',
  intro = false,
  lean: leans = true,
  floating = false,
  onPress,
  haptic,
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  style,
}: TiltedCardProps) {
  const reduce = useReduceMotion();
  const c = useColors();
  const rx = useSharedValue(0);
  const ry = useSharedValue(0);
  const held = useSharedValue(0);
  const live = !reduce && !disabled && leans;
  const radius = SHAPE[shape];

  // The arrival sweep runs once per mount, from react-bits' initial pointer back to rest.
  const introduced = useRef(false);
  useEffect(() => {
    if (!intro || !live || introduced.current || width <= 0 || height <= 0) return;
    introduced.current = true;
    const p = introPoint(width);
    const from = tiltAt(p.x, p.y, width, height, maxTilt);
    rx.value = from.rotateX;
    ry.value = from.rotateY;
    const home = { duration: PROFILE.initialMs, easing: EASE, reduceMotion: ReduceMotion.Never };
    rx.value = withTiming(0, home);
    ry.value = withTiming(0, home);
  }, [intro, live, width, height, maxTilt, rx, ry]);

  // Reduce Motion switched on while leaning: go flat at once.
  useEffect(() => {
    if (live) return;
    rx.value = 0;
    ry.value = 0;
  }, [live, rx, ry]);
  // A press still answers under Reduce Motion (the kit's opacity dip), so a card that opens
  // something always shows the finger landed.
  const answers = live || (onPress !== undefined && !disabled);

  const press = useCallback(() => {
    if (haptic) haptics[haptic]();
    onPress?.();
  }, [haptic, onPress]);

  const gesture = useMemo(() => {
    const aim = (x: number, y: number) => {
      'worklet';
      if (!live) return;
      const t = tiltAt(x, y, width, height, maxTilt);
      rx.value = withSpring(t.rotateX, SNAP);
      ry.value = withSpring(t.rotateY, SNAP);
    };
    const release = () => {
      'worklet';
      held.value = withTiming(0, { duration: exitMs(T.press), easing: EASE });
      rx.value = withSpring(0, SNAP);
      ry.value = withSpring(0, SNAP);
    };
    const track = Gesture.Manual()
      .enabled(answers)
      .onTouchesDown((e) => {
        const t = e.allTouches[0];
        if (!t) return;
        held.value = withTiming(1, { duration: T.press, easing: EASE });
        aim(t.x, t.y);
      })
      .onTouchesMove((e) => {
        const t = e.allTouches[0];
        if (t) aim(t.x, t.y);
      })
      .onTouchesUp(() => release())
      .onTouchesCancelled(() => release())
      .onFinalize(() => release());
    if (!onPress) return track;
    const tap = Gesture.Tap()
      .enabled(!disabled)
      .maxDuration(600)
      .onEnd((_e, ok) => {
        if (ok) runOnJS(press)();
      });
    return Gesture.Simultaneous(track, tap);
  }, [live, answers, width, height, maxTilt, rx, ry, held, onPress, disabled, press]);

  const lean = useAnimatedStyle(() => {
    if (!live) return { opacity: 1 - 0.3 * held.value, transform: [{ perspective }, { rotateX: '0deg' }, { rotateY: '0deg' }, { scale: 1 }] };
    return {
      opacity: 1,
      transform: [
        { perspective },
        { rotateX: `${rx.value}deg` },
        { rotateY: `${ry.value}deg` },
        { scale: 1 + (scaleOnPress - 1) * held.value },
      ],
    };
  });

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessible={onPress ? true : undefined}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={onPress ? { disabled } : undefined}
        onAccessibilityTap={onPress && !disabled ? press : undefined}
        style={[{ width, height, borderRadius: radius, borderCurve: 'continuous' }, floating ? { boxShadow: floatShadow } : null, style, lean]}
      >
        <View style={{ width, height, borderRadius: radius, borderCurve: 'continuous', overflow: 'hidden' }}>
          {children}
          {glare && live ? <Glare width={width} height={height} rotateY={ry} held={held} maxTilt={maxTilt} color={c.text} /> : null}
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

/**
 * GlareHover's band in three flat steps (6%, 10%, 6% of the bone text colour, 8pt each),
 * laid at -45 degrees across the face and swept by the lean. Bone, not white: the greys are
 * warm. Shows while a finger is on the card.
 */
function Glare({
  width,
  height,
  rotateY,
  held,
  maxTilt,
  color,
}: {
  width: number;
  height: number;
  rotateY: SharedValue<number>;
  held: SharedValue<number>;
  maxTilt: number;
  color: string;
}) {
  const band = TILT.glareStepPt * TILT.glareSteps.length;
  const long = Math.ceil(Math.hypot(width, height));
  const sweep = useAnimatedStyle(() => ({
    opacity: held.value,
    transform: [{ translateX: glareOffset(rotateY.value, maxTilt, width) }, { rotate: '-45deg' }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', left: (width - band) / 2, top: (height - long) / 2, width: band, height: long, flexDirection: 'row' }, sweep]}
    >
      {TILT.glareSteps.map((alpha, i) => (
        <View key={i} style={{ width: TILT.glareStepPt, height: long, backgroundColor: color, opacity: alpha }} />
      ))}
    </Animated.View>
  );
}
