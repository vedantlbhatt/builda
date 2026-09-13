/**
 * GlareHover, as a press sheen: a band of light in three flat steps crosses the card once
 * when a finger goes down on it (DESIGN-V2 4.4: Wrapped cards, the share preview, the
 * ProfileCard). It watches the press and never takes it, so the card keeps its own.
 *
 *   <GlareHover radius={SHAPE.wrapped}>
 *     <WrappedCard ... />
 *   </GlareHover>
 *
 * Ported from react-bits `Animations/GlareHover/GlareHover.tsx` (and its CSS) by David Haz.
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
 * What changed in the port: hover becomes press in (a phone has no hover); the original's
 * `playOnce` behaviour is the only one (it crosses once and is gone, it does not sit on the
 * card while the finger stays down); the gradient becomes three flat stripes of the warm
 * white at 6, 10 and 6% (a gradient sheen is banned here; light comes from a stepped band);
 * 380ms on `EASE` instead of 650ms `ease`. The band is plain views on the UI thread, clipped
 * to the card's continuous corners. The geometry is in `glare.ts`, the numbers in `spec.ts`.
 *
 * Reduce Motion: no sheen (DESIGN-V2 3.2, "press a card": still is none).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, { ReduceMotion, runOnUI, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { colors } from '../../../theme';
import { EASE, useReduceMotion } from '../../motion';
import { SHAPE } from '../../shape';
import { glareCenter, glareGeometry } from './glare';
import { useTouchObserver } from './runtime';
import { EFFECTS } from './spec';

const G = EFFECTS.glare;
/** The glare is light on the dark cards it crosses (share cards stay dark in both schemes). */
const GLARE_INK = colors('dark').text;

export interface GlareHoverProps {
  children?: ReactNode;
  /** The card's corner radius, so the band is clipped to it. Default 28 (a Wrapped card). */
  radius?: number;
  /** The CSS gradient angle. Default -45: "/" stripes crossing from the top left corner. */
  angle?: number;
  /** The band's width in points. Default 24. */
  band?: number;
  /** One stripe per entry: the glare's opacity in it. Default 0.06, 0.10, 0.06. */
  steps?: readonly number[];
  /** One crossing, in ms. Default 380. */
  duration?: number;
  /** Cross on press in. Default true; false leaves `playKey`. */
  playOnPress?: boolean;
  /** Changing this crosses once with no touch (a card arriving). The value it mounts with does not. */
  playKey?: number | string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function GlareHover({
  children,
  radius = SHAPE.wrapped,
  angle = G.angleDeg,
  band = G.bandPt,
  steps = G.steps,
  duration = G.ms,
  playOnPress = true,
  playKey,
  disabled = false,
  style,
}: GlareHoverProps) {
  const reduced = useReduceMotion();
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((b) => (b && b.w === width && b.h === height ? b : { w: width, h: height }));
  }, []);

  const geo = useMemo(() => (box ? glareGeometry(box.w, box.h, angle, band, steps) : null), [box, angle, band, steps]);
  const from = geo?.from ?? 0;
  const to = geo?.to ?? 0;
  const u = geo?.u ?? ([1, 0] as const);
  const v = geo?.v ?? ([0, 1] as const);
  const across = geo?.across ?? 0;
  const rotateDeg = geo?.rotateDeg ?? 0;
  const length = geo?.length ?? 0;

  const s = useSharedValue(from);
  // Park the band off the card whenever the card's size changes.
  useEffect(() => {
    s.value = from;
  }, [from, s]);

  const play = useCallback(() => {
    'worklet';
    s.value = from;
    // Never: Reduce Motion never mounts the band.
    s.value = withTiming(to, { duration, easing: EASE, reduceMotion: ReduceMotion.Never });
  }, [from, to, duration, s]);

  const gesture = useTouchObserver(
    {
      onDown: () => {
        'worklet';
        play();
      },
    },
    playOnPress && !disabled && !reduced && geo !== null,
    [play],
  );

  const mountedKey = useRef(playKey);
  useEffect(() => {
    if (playKey === undefined || playKey === mountedKey.current) return;
    mountedKey.current = playKey;
    if (!reduced && !disabled) runOnUI(play)();
    // A new geometry alone does not play.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playKey]);

  const bandStyle = useAnimatedStyle(() => {
    const c = glareCenter(s.value, u, v, across);
    return { transform: [{ translateX: c[0] }, { translateY: c[1] }, { rotate: `${rotateDeg}deg` }] };
  }, [u, v, across, rotateDeg]);

  return (
    <GestureDetector gesture={gesture}>
      <View collapsable={false} onLayout={onLayout} style={style}>
        {children}
        {geo && !reduced ? (
          <View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[StyleSheet.absoluteFill, { borderRadius: radius, borderCurve: 'continuous', overflow: 'hidden' }]}
          >
            <Animated.View
              style={[
                { position: 'absolute', left: -geo.bandWidth / 2, top: -length / 2, width: geo.bandWidth, height: length, flexDirection: 'row' },
                bandStyle,
              ]}
            >
              {geo.stripes.map((stripe, i) => (
                <View key={i} style={{ width: stripe.width, height: length, backgroundColor: GLARE_INK, opacity: stripe.opacity }} />
              ))}
            </Animated.View>
          </View>
        ) : null}
      </View>
    </GestureDetector>
  );
}
