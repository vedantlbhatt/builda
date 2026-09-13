/**
 * PixelTransition: square cells switch on over one view in random order, the content under
 * them changes while every cell is on, and the cells switch off in a second random order
 * (DESIGN-V2 3.2, Wrapped grid to story: "the tapped card's cells switch to the story view").
 * The content is ordinary React Native views; the cells are one Skia shader over them.
 *
 *   <PixelTransition active={story} hue={cardHue(id, archetype)} first={<Grid />} second={<Story />} />
 *
 * Ported from react-bits `Animations/PixelTransition/PixelTransition.tsx` by David Haz.
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
 * What changed in the port: a grid of GSAP-staggered divs becomes one runtime shader
 * (`COVER_SKSL` in `swap.ts`) with two hashes for the two random orders; hover and click
 * become a controlled `active`; the swap waits until the new content has committed before
 * the cells start switching off, so a slow mount is never seen half drawn. Square cells, 12
 * across (react-bits 7), 300ms to cover and 300ms to uncover as the original. The cells are
 * the given hue's ink, or the card surface: colour enters by cells, never by a fade.
 *
 * Reduce Motion: no cells; the new content fades in over the kit's 150ms.
 */
import { Canvas, Fill, Shader, Skia, type SkRuntimeEffect } from '@shopify/react-native-skia';
import React, { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, ReduceMotion, runOnJS, useAnimatedStyle, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';

import { premultiplied } from '../../dithering';
import { EASE, REDUCED_FADE, useReduceMotion } from '../../motion';
import { useColors, useScheme } from '../../scheme';
import { inkOf, type HueProp } from './hue';
import { EFFECTS } from './spec';
import { COVER_SKSL, coverGrid, coverPhases } from './swap';

const V = EFFECTS.cover;

let effect: SkRuntimeEffect | null | undefined;
function coverEffect(): SkRuntimeEffect | null {
  if (effect === undefined) {
    effect = Skia.RuntimeEffect.Make(COVER_SKSL);
    if (!effect && __DEV__) console.warn('[bits/PixelTransition] COVER_SKSL did not compile; the change is a fade');
  }
  return effect;
}

export interface PixelTransitionProps {
  /** Shown while `active` is false. */
  first: ReactNode;
  /** Shown while `active` is true. */
  second: ReactNode;
  /** Controlled: which content shows. Changing it plays the transition. */
  active: boolean;
  /** Cells across the width. Default 12. */
  grid?: number;
  /** Covering takes this, and uncovering the same again, in ms. Default 300. */
  stepMs?: number;
  /** The cells' hue. Default none: the card surface, a neutral turn of the page. */
  hue?: HueProp;
  onComplete?: (active: boolean) => void;
  style?: StyleProp<ViewStyle>;
}

type Phase = 'idle' | 'covering' | 'swapped' | 'uncovering';

export function PixelTransition({ first, second, active, grid = V.grid, stepMs = V.stepMs, hue, onComplete, style }: PixelTransitionProps) {
  const reduced = useReduceMotion();
  const c = useColors();
  const scheme = useScheme();
  const source = coverEffect();
  const ink = hue === undefined ? c.card : inkOf(hue, scheme);

  const [shown, setShown] = useState(active);
  const [phase, setPhase] = useState<Phase>('idle');
  const target = useRef(active);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((b) => (b && b.w === width && b.h === height ? b : { w: width, h: height }));
  }, []);

  const p = useSharedValue(0);
  const opacity = useSharedValue(1);

  const swapNow = useCallback(() => {
    setShown(target.current);
    setPhase('swapped');
  }, []);
  const done = useCallback(() => {
    setPhase('idle');
    onComplete?.(target.current);
  }, [onComplete]);

  // Start a transition when `active` moves away from what is shown and nothing is running.
  useEffect(() => {
    if (phase !== 'idle' || active === shown) return;
    target.current = active;
    if (reduced || !source || !box) {
      setShown(active);
      opacity.value = 0;
      opacity.value = withTiming(1, { duration: REDUCED_FADE, easing: EASE, reduceMotion: ReduceMotion.Never });
      onComplete?.(active);
      return;
    }
    setPhase('covering');
    p.value = 0;
    // Linear: the original's even stagger, cells switching at a steady rate.
    p.value = withTiming(1, { duration: stepMs, easing: Easing.linear, reduceMotion: ReduceMotion.Never }, (ok) => {
      if (ok) runOnJS(swapNow)();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, shown, phase, reduced, source, box]);

  // The new content has committed under a full cover: now the cells switch off.
  useEffect(() => {
    if (phase !== 'swapped') return;
    setPhase('uncovering');
    p.value = withTiming(2, { duration: stepMs, easing: Easing.linear, reduceMotion: ReduceMotion.Never }, (ok) => {
      if (ok) runOnJS(done)();
    });
  }, [phase, p, stepMs, done]);

  const g = coverGrid(box?.w ?? 0, box?.h ?? 0, grid);
  const inkU = premultiplied(ink);
  const uniforms = useDerivedValue(() => {
    const ph = coverPhases(p.value);
    return { cell: g.cell, pin: ph.pin, pout: ph.pout, ink: inkU };
  });
  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <View style={style} onLayout={onLayout}>
      <Animated.View style={fadeStyle}>{shown ? second : first}</Animated.View>
      {phase !== 'idle' && box && source ? (
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
          <Canvas style={StyleSheet.absoluteFill}>
            <Fill>
              <Shader source={source} uniforms={uniforms} />
            </Fill>
          </Canvas>
        </View>
      ) : null}
    </View>
  );
}
