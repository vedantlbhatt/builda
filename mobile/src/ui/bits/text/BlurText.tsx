/**
 * BlurText: a line that comes into focus a word (or a letter) at a time, each unit dropping in
 * from 12 pt away, overshooting a hair and settling, sharpening as it lands. Once per arrival;
 * a new `replayKey` plays it again. Reduce Motion: the whole line fades in over 150 ms.
 *
 *   <BlurText text="Your 33 days of building" role="title" />
 *   <BlurText text="Builda" by="letters" direction="bottom" role="display" />
 *
 * Ported from react-bits `TextAnimations/BlurText/BlurText.tsx` by David Haz. react-bits is
 * MIT + Commons Clause (Copyright (c) 2026 David Haz): the notice is kept here as the licence
 * asks, and the port is used as part of this application only; it is not to be redistributed
 * as a component.
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
 * What the port keeps: react-bits' three keyframes (opacity 0, 0.5, 1; blur full, half, none;
 * away, a little past, home), its two 0.35 s steps, its 200 ms per unit, `animateBy` and
 * `direction`. What it changes:
 * - The blur is four ghost copies of the word that close in on it and hand their opacity back
 *   as it sharpens. A real blur is not available to RN text on iOS (the `filter` style there is
 *   brightness and opacity only), and Skia text takes a typeface by family name, which the
 *   system face is not published under on iOS, so a Skia mask blur risks another typeface.
 *   Letters skip the ghosts: four copies per letter is too many views for what it buys.
 * - Travel is 12 pt, not 50 px; the stagger squeezes so the line lands inside 1.2 s.
 * - Text in a hue never ghosts and snaps its opacity in 120 ms (DESIGN-V2 1.3: a hue at partial
 *   opacity over the ground is brown).
 * - Motion's `linear` default easing is kept for the keyframes: the ease lives in their shape.
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { useReduceMotion } from '../../motion';
import { keyframeAt, localProgress } from './curve';
import { SNAP_FADE_MS } from './ink';
import { unitCount } from './segment';
import {
  EffectShell,
  LineRows,
  useEffectClock,
  useInk,
  useKerning,
  useLaidLines,
  useTextLook,
  useUnitCount,
  type PlayProps,
  type TextLook,
  type TextLookProps,
} from './shared';
import { BLUR, BLUR_KEYFRAMES, TEXT_EFFECT_DONE_MS } from './spec';
import { unitWindows } from './stagger';

export interface BlurTextProps extends TextLookProps, PlayProps {
  text: string;
  /** Default `words`, react-bits' default. */
  by?: 'words' | 'letters';
  /** Where a unit comes from: `top` (react-bits' default) drops in, `bottom` rises. */
  direction?: 'top' | 'bottom';
  /** Per unit, before the fit. Default 200. */
  staggerMs?: number;
  /** One keyframe step. Default 350 (two steps a unit). */
  stepMs?: number;
  /** The ghosts' reach at full blur, in points. Default 4; 0 turns the ghosts off. */
  blurPt?: number;
  budgetMs?: number;
  numberOfLines?: number;
}

/** The ghosts' directions: the four diagonals, so the soft edge has no one axis. */
const GHOST_DIRS: readonly (readonly [number, number])[] = [
  [Math.SQRT1_2, Math.SQRT1_2],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [Math.SQRT1_2, -Math.SQRT1_2],
  [-Math.SQRT1_2, -Math.SQRT1_2],
];

export function BlurText(props: BlurTextProps) {
  const {
    text,
    by = 'words',
    direction = 'top',
    staggerMs = BLUR.staggerMs,
    stepMs = BLUR.stepMs,
    blurPt = BLUR.spreadPt,
    budgetMs = TEXT_EFFECT_DONE_MS,
    play = true,
    delay = 0,
    replayKey,
    onEnd,
    numberOfLines,
    style,
    accessibilityRole,
  } = props;
  const reduce = useReduceMotion();
  const look = useTextLook(props, 'title');
  const ink = useInk(props);
  const split = by === 'words' ? 'words' : 'chars';
  const lines = useLaidLines(text);
  const count = useUnitCount(lines, split);
  const empty = useMemo(() => unitCount(text, split) === 0, [text, split]);

  const unitMs = stepMs * (BLUR_KEYFRAMES.opacity.length - 1);
  const plan = useMemo(() => unitWindows(count, { unitMs, staggerMs, budgetMs }), [count, unitMs, staggerMs, budgetMs]);
  const sign = direction === 'top' ? -1 : 1;
  const travel = useMemo(() => [sign * BLUR.travelPt, -sign * BLUR.overshootPt, 0], [sign]);
  const ghosts = by === 'words' && !ink.identity && blurPt > 0 ? GHOST_DIRS.length : 0;

  const kerning = useKerning(lines, split === 'chars', look);
  const { clock, fade, settled } = useEffectClock({
    play,
    ready: lines.lines !== null && count > 0 && kerning.ready,
    totalMs: plan.totalMs,
    delay,
    replayKey,
    reduce,
    onEnd,
  });

  const textStyle = useMemo(() => [look.font, { color: ink.color }], [look.font, ink.color]);

  return (
    <EffectShell
      text={text}
      font={look.font}
      color={ink.color}
      scaling={look.scaling}
      settled={settled || empty}
      fade={fade}
      lines={lines}
      numberOfLines={numberOfLines}
      style={style}
      accessibilityRole={accessibilityRole}
      probes={kerning.probes}
      overlay={
        <LineRows
          lines={lines}
          by={split}
          offsets={kerning.offsets}
          renderSpace={(t, key) => (
            <Text key={key} {...look.scaling} style={textStyle}>
              {t}
            </Text>
          )}
          renderUnit={(u, key) => (
            <BlurUnit
              key={key}
              text={u.text}
              clock={clock}
              start={plan.windows[u.index]?.start ?? 0}
              duration={unitMs}
              travel={travel}
              snap={ink.identity}
              ghosts={ghosts}
              spread={blurPt}
              textStyle={textStyle}
              scaling={look.scaling}
            />
          )}
        />
      }
    />
  );
}

function BlurUnit({
  text,
  clock,
  start,
  duration,
  travel,
  snap,
  ghosts,
  spread,
  textStyle,
  scaling,
}: {
  text: string;
  clock: SharedValue<number>;
  start: number;
  duration: number;
  travel: readonly number[];
  snap: boolean;
  ghosts: number;
  spread: number;
  textStyle: TextStyle[];
  scaling: TextLook['scaling'];
}) {
  const share = ghosts > 0 ? BLUR.ghostShare : 0;
  const main = useAnimatedStyle(() => {
    const p = localProgress(clock.value, start, duration);
    const o = snap ? localProgress(clock.value, start, SNAP_FADE_MS) : keyframeAt(BLUR_KEYFRAMES.opacity, p);
    const b = keyframeAt(BLUR_KEYFRAMES.blur, p);
    return { opacity: o * (1 - b * share), transform: [{ translateY: keyframeAt(travel, p) }] };
  });
  // The main copy holds the unit's place in its row; the ghosts lie over it from its corner.
  return (
    <View>
      <Animated.View style={main}>
        <Text {...scaling} style={textStyle}>
          {text}
        </Text>
      </Animated.View>
      {GHOST_DIRS.slice(0, ghosts).map(([dx, dy], k) => (
        <Ghost
          key={k}
          text={text}
          clock={clock}
          start={start}
          duration={duration}
          travel={travel}
          dx={dx}
          dy={dy}
          spread={spread}
          weight={(share * 2) / ghosts}
          textStyle={textStyle}
          scaling={scaling}
        />
      ))}
    </View>
  );
}

/**
 * One ghost: the word again, `spread` points out along (dx, dy) at full blur, closing to zero
 * as the blur does, carrying a share of the word's opacity that it gives back as it sharpens.
 */
function Ghost({
  text,
  clock,
  start,
  duration,
  travel,
  dx,
  dy,
  spread,
  weight,
  textStyle,
  scaling,
}: {
  text: string;
  clock: SharedValue<number>;
  start: number;
  duration: number;
  travel: readonly number[];
  dx: number;
  dy: number;
  spread: number;
  weight: number;
  textStyle: TextStyle[];
  scaling: TextLook['scaling'];
}) {
  const move = useAnimatedStyle(() => {
    const p = localProgress(clock.value, start, duration);
    const o = keyframeAt(BLUR_KEYFRAMES.opacity, p);
    const b = keyframeAt(BLUR_KEYFRAMES.blur, p);
    return {
      opacity: Math.min(0.5, o * b * weight),
      transform: [{ translateX: dx * spread * b }, { translateY: keyframeAt(travel, p) + dy * spread * b }],
    };
  });
  return (
    <Animated.View style={[styles.ghost, move]} pointerEvents="none">
      <Text {...scaling} style={textStyle}>
        {text}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  ghost: { position: 'absolute', left: 0, top: 0 },
});
