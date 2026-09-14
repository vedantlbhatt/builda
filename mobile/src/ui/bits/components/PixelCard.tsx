/**
 * PixelCard: a tile whose selected state fills in pixels, growing out of the finger that chose
 * it into the solid fill of its hue. The selected state of creature and harness tiles
 * (DESIGN-V2 4.3, row 17; 2.1 and 2.4: idle is the glyph in its ink on `raised`, selected is
 * the tile filled with its hue and the glyph and name in `#1C1917`).
 *
 * Ported from react-bits `Components/PixelCard/PixelCard.tsx` by David Haz.
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
 * - Kept: react-bits' rule that a pixel's delay is its distance, and pixels that grow from
 *   nothing. Changed: the distance is from the FINGER (react-bits measures from the centre;
 *   a programmatic change still grows from the centre), and the pixels grow into a solid
 *   fill in 240ms, then the plain fill takes over, instead of sparkling at random sizes with
 *   a shimmer that never stops (nothing loops here).
 * - One shader and one progress value on the UI thread (`PIXEL_FILL_SKSL`), not a canvas of
 *   JS objects stepped by `requestAnimationFrame`; its canvas mounts on the first touch, so a
 *   screen of tiles pays nothing until one is pressed.
 * - Colours are the spectrum's: the fill is the hue's `fill`, the ink on it `onFill`, and the
 *   words switch to that ink at half way (react-bits' four fixed Tailwind variants are gone).
 * - Deselecting runs the same cells backwards at 0.7x, so the fill retracts into the finger.
 *
 * Reduce Motion: the fill cross fades in 120ms and the ink flips with it.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, View, type GestureResponderEvent, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { hue as hueOf, layout, type Hue, type HueName } from '../../../theme';
import { haptics, type HapticKind } from '../../haptics';
import { EASE, exitMs, useReduceMotion } from '../../motion';
import { usePressFeedback } from '../../PressableScale';
import { useColors, useScheme } from '../../scheme';
import { SHAPE, type ShapeName } from '../../shape';
import type { SurfaceLevel } from '../../Surface';
import { inkFlipped } from './fills';
import { PixelFillLayer } from './layers';
import { PIXEL } from './spec';

export interface PixelCardFace {
  /** The words and glyph are on the fill (flips at half way through the fill). */
  filled: boolean;
  /** A glyph or a creature: the hue's ink on the idle tile, `onFill` on the filled one. */
  ink: string;
  /** The name: `text` idle, `onFill` filled. */
  text: string;
  /** A status line: `textDim` idle, `onFill` filled. */
  dim: string;
  hue: Hue;
}

export interface PixelCardProps {
  /** The tile's identity: the creature's or the harness's hue. */
  hue: HueName;
  selected: boolean;
  onPress?: () => void;
  /** Default `select`: a tile toggling is a value passing a step. */
  haptic?: HapticKind | null;
  /** The face. A function gets the colours for the state it is in. */
  children?: ReactNode | ((face: PixelCardFace) => ReactNode);
  /** The unselected ground. Default `raised` (the picker tile). */
  idle?: SurfaceLevel;
  /** From the radius rule. Default `container` (18). */
  shape?: ShapeName;
  /** Default the tile padding, 14. */
  padding?: number;
  width?: number;
  height?: number;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

export function PixelCard({
  hue,
  selected,
  onPress,
  haptic = 'select',
  children,
  idle = 'raised',
  shape = 'container',
  padding = layout.tilePad,
  width,
  height,
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  style,
}: PixelCardProps) {
  const c = useColors();
  const scheme = useScheme();
  const reduce = useReduceMotion();
  const tone = useMemo(() => hueOf(hue, scheme), [hue, scheme]);
  const fb = usePressFeedback();

  const [size, setSize] = useState({ w: width ?? 0, h: height ?? 0 });
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
  }, []);

  const progress = useSharedValue(selected ? 1 : 0);
  const fade = useSharedValue(selected ? 1 : 0);
  const reducedSV = useSharedValue(reduce ? 1 : 0);
  const ox = useSharedValue(0);
  const oy = useSharedValue(0);
  const [filled, setFilled] = useState(selected);
  // The canvas mounts on the first touch (or the first change), never with the screen.
  const [armed, setArmed] = useState(false);
  const touched = useRef(false);

  // Reduce Motion switched while the screen is up: both paths start from the resting state.
  useEffect(() => {
    reducedSV.value = reduce ? 1 : 0;
    fade.value = selected ? 1 : 0;
    // `selected` is read, not reacted to: its own effect below runs the change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce, reducedSV, fade]);

  // The words flip on the frame the fill passes half way, both ways.
  useAnimatedReaction(
    () => inkFlipped(progress.value),
    (now, prev) => {
      if (prev !== null && now !== prev && reducedSV.value === 0) runOnJS(setFilled)(now);
    },
  );

  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const to = selected ? 1 : 0;
    if (reduce) {
      setFilled(selected);
      progress.value = to;
      fade.value = withTiming(to, { duration: PIXEL.reducedMs, easing: EASE, reduceMotion: ReduceMotion.Never });
      return;
    }
    if (!touched.current) {
      // A change nobody pressed for (restored state, select all): from the centre.
      ox.value = size.w / 2;
      oy.value = size.h / 2;
    }
    touched.current = false;
    // The plain fill shows only at progress 1 (`solid` below), so while a deselect waits for
    // its canvas the tile stays filled, and the cells take over on the frame they draw.
    // A canvas mounting on this render draws from the next frame: wait one.
    const wait = armed ? 0 : 16;
    if (!armed) setArmed(true);
    progress.value = withDelay(
      wait,
      withTiming(to, { duration: selected ? PIXEL.ms : exitMs(PIXEL.ms), easing: Easing.linear, reduceMotion: ReduceMotion.Never }),
    );
    // `armed` and `size` are read, not reacted to: only a change of `selected` runs the fill.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const solid = useAnimatedStyle(() => ({
    opacity: reducedSV.value === 1 ? fade.value : progress.value >= 1 ? 1 : 0,
  }));

  const onPressIn = useCallback(
    (e: GestureResponderEvent) => {
      ox.value = e.nativeEvent.locationX;
      oy.value = e.nativeEvent.locationY;
      touched.current = true;
      if (!reduce && !armed) setArmed(true);
      fb.onPressIn();
    },
    [ox, oy, reduce, armed, fb],
  );
  const handlePress = useCallback(() => {
    if (haptic) haptics[haptic]();
    onPress?.();
  }, [haptic, onPress]);

  const face: PixelCardFace = filled
    ? { filled, ink: tone.onFill, text: tone.onFill, dim: tone.onFill, hue: tone }
    : { filled, ink: tone.ink, text: c.text, dim: c.textDim, hue: tone };
  const r = SHAPE[shape];

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={onPressIn}
      onPressOut={fb.onPressOut}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      style={style}
    >
      <Animated.View
        onLayout={onLayout}
        style={[
          { width, height, backgroundColor: c[idle], borderRadius: r, borderCurve: 'continuous', overflow: 'hidden', padding },
          fb.animatedStyle,
        ]}
      >
        <Animated.View
          pointerEvents="none"
          style={[{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: tone.fill }, solid]}
        />
        {armed && !reduce && size.w > 0 ? (
          <PixelFillLayer width={size.w} height={size.h} ink={tone.fill} progress={progress} originX={ox} originY={oy} />
        ) : null}
        <View pointerEvents="none">{typeof children === 'function' ? children(face) : children}</View>
      </Animated.View>
    </Pressable>
  );
}
