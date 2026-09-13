/**
 * GradientText: a word in flat bands of one hue's tones (its ink, a step lighter, the ink again,
 * a step deeper toward its partner), like light moving on a pressed plate. On arrival the bands
 * slide one period and come to rest where they began; `animate="loop"` keeps them drifting the
 * way react-bits does. Sparingly: one hero word on a screen (the archetype's name on its share
 * card, the Wrapped cover's title). Reduce Motion: the bands at rest.
 *
 *   <GradientText text="Architect" hue={archetypeHue(a).name} role="hero" />
 *   <GradientText text="Your year" colors={deckTones} direction="diagonal" animate="loop" />
 *
 * Ported from react-bits `TextAnimations/GradientText/GradientText.tsx` by David Haz.
 * react-bits is MIT + Commons Clause (Copyright (c) 2026 David Haz): the notice is kept here as
 * the licence asks, and the port is used as part of this application only; it is not to be
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
 * What the port keeps: `colors` (repeating, so the loop is seamless, as react-bits repeats its
 * first colour), `animationSpeed` as `driftMs` (8 s), `yoyo` (default true), `direction`
 * (`horizontal`, and `diagonal` as leaning bands), and the drift arithmetic
 * (`bands.gradientCycle`). What it changes: no smooth ramp, anywhere (DESIGN-V2 1.3): a band is
 * one flat tone and the ramp is the steps between bands; the default colours are one hue's
 * tones (react-bits' purple and pink are the house style the brief bans); the drift is once on
 * arrival by default (rule 6: nothing moves while it is read), `showBorder` (a gradient border)
 * and `pauseOnHover` are gone, and `vertical` is not ported (one line of text split top and
 * bottom reads as two colours, not light).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import {
  Easing,
  ReduceMotion,
  cancelAnimation,
  runOnJS,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { EASE, useReduceMotion } from '../../motion';
import { useColors } from '../../scheme';
import { gradientCycle, gradientLayout, gradientTones, skewReach } from './bands';
import { ClipBand } from './ClipBand';
import { useInk, useTextLook, type PlayProps, type TextLookProps } from './shared';
import { GRADIENT } from './spec';

export interface GradientTextProps extends TextLookProps, PlayProps {
  text: string;
  /** Flat tones, repeating across the text. Default: the ink's tones (`lifts`). */
  colors?: readonly string[];
  /**
   * Each default tone: up toward `text`, or (negative) down toward the hue's partner. Default
   * 0, 0.3, 0, -0.35: ink, light, ink, deep.
   */
  lifts?: readonly number[];
  /** One band's share of the text width. Default a third. */
  bandFraction?: number;
  /** `horizontal` (react-bits' default): upright bands. `diagonal`: bands leaning 30 degrees. */
  direction?: 'horizontal' | 'diagonal';
  /** `arrive` (default): one period on arrival, then rest. `loop`: react-bits' drift. `none`: still. */
  animate?: 'arrive' | 'loop' | 'none';
  /** One drift across a period, for `loop`. Default 8000 (react-bits' `animationSpeed` 8). */
  driftMs?: number;
  /** For `loop`: back and forth (react-bits' default) or round and round. */
  yoyo?: boolean;
  /** For `arrive`. Default 1100, inside rule 7. */
  arriveMs?: number;
  numberOfLines?: number;
}

export function GradientText(props: GradientTextProps) {
  const {
    text,
    colors,
    lifts = GRADIENT.lifts,
    bandFraction = GRADIENT.bandFraction,
    direction = 'horizontal',
    animate = 'arrive',
    driftMs = GRADIENT.driftMs,
    yoyo = true,
    arriveMs = GRADIENT.arriveMs,
    play = true,
    delay = 0,
    replayKey,
    onEnd,
    numberOfLines,
    style,
    accessibilityRole = 'text',
  } = props;
  const c = useColors();
  const reduce = useReduceMotion();
  const look = useTextLook(props, 'display');
  // Amber unless told otherwise: a gradient in the neutral inks is just grey.
  const ink = useInk(props.tone || props.hue || props.color ? props : { hue: 'amber' });
  // The deep band goes toward the hue's own partner; a bare colour has none, so it stays ink.
  const hueName = props.color ? undefined : (props.hue ?? (props.tone ? undefined : 'amber'));
  const deep = hueName ? c.hues[hueName].partner : undefined;
  const tones = useMemo(
    () => (colors && colors.length > 0 ? [...colors] : gradientTones(ink.color, c.text, lifts, deep)),
    [colors, ink.color, c.text, lifts, deep],
  );
  const skewDeg = direction === 'diagonal' ? GRADIENT.skewDeg : 0;

  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((b) => (b && Math.abs(b.width - width) < 0.5 && Math.abs(b.height - height) < 0.5 ? b : { width, height }));
  }, []);
  const layout = useMemo(
    () => (box ? gradientLayout(box.width, tones.length, bandFraction, skewReach(box.height, skewDeg)) : null),
    [box, tones.length, bandFraction, skewDeg],
  );
  const period = layout?.period ?? 0;

  // `arrive` drives the shift in points directly on `EASE`; `loop` drives elapsed ms and the
  // shift follows react-bits' drift cycle.
  const arrive = useSharedValue(0);
  const elapsed = useSharedValue(0);
  const looping = animate === 'loop';
  const shift = useDerivedValue(() => (looping ? period * gradientCycle(elapsed.value, driftMs, yoyo) : arrive.value));

  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const fireEnd = useCallback(() => onEndRef.current?.(), []);
  const started = useRef<{ key: string | number | undefined } | null>(null);
  const still = reduce || animate === 'none';

  useEffect(() => {
    if (still || !play || !layout) return;
    if (started.current && started.current.key === replayKey) return;
    started.current = { key: replayKey };
    cancelAnimation(arrive);
    cancelAnimation(elapsed);
    arrive.value = 0;
    elapsed.value = 0;
    if (looping) {
      const leg = yoyo ? driftMs * 2 : driftMs;
      elapsed.value = withDelay(
        delay,
        withRepeat(withTiming(leg, { duration: leg, easing: Easing.linear, reduceMotion: ReduceMotion.Never }), -1, false),
      );
      return;
    }
    // A whole period lands on the picture it started from, so the rest state is the start state.
    arrive.value = withDelay(
      delay,
      withTiming(layout.period, { duration: arriveMs, easing: EASE, reduceMotion: ReduceMotion.Never }, (finished) => {
        if (finished) runOnJS(fireEnd)();
      }),
    );
  }, [still, play, layout, replayKey, looping, yoyo, driftMs, arriveMs, delay, arrive, elapsed, fireEnd]);

  useEffect(
    () => () => {
      cancelAnimation(arrive);
      cancelAnimation(elapsed);
    },
    [arrive, elapsed],
  );

  const base = tones[0] ?? ink.color;
  return (
    <View accessible accessibilityRole={accessibilityRole} accessibilityLabel={text} style={style}>
      <View onLayout={onLayout}>
        {/* The layout holder, in the first tone: what shows where no band has reached. */}
        <Text {...look.scaling} numberOfLines={numberOfLines} importantForAccessibility="no" style={[look.font, { color: base }]}>
          {text}
        </Text>
        {box && layout ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="none" importantForAccessibility="no-hide-descendants">
            {Array.from({ length: layout.count }, (_, k) => (
              <ClipBand
                key={k}
                text={text}
                textStyle={[look.font, { color: tones[k % tones.length] ?? base }]}
                scaling={look.scaling}
                width={box.width}
                height={box.height}
                bandWidth={layout.band}
                skewDeg={skewDeg}
                progress={shift}
                place={{ kind: 'tile', k, band: layout.band, period: layout.period, reach: layout.reach }}
              />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}
