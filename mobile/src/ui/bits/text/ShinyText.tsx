/**
 * ShinyText: light crossing a label once, as three flat steps of a lighter tone leaning 30
 * degrees, like light off a pressed metal plate. Sparingly: the label a person is about to act
 * on, once, when it arrives (the paired Mac's name, "That's me" the moment it enables). It is
 * not a loading shimmer (a still line is the placeholder; DESIGN-V2 4.5). `sweeps` loops it,
 * for the rare label that waits for a person. Reduce Motion, or `disabled`: the plain label.
 *
 *   <ShinyText text="Vedant's MacBook Pro" role="row" />
 *   <ShinyText text="needs you" hue="amber" role="meta" weight={600} sweeps={3} />
 *
 * Ported from react-bits `TextAnimations/ShinyText/ShinyText.tsx` by David Haz. react-bits is
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
 * What the port keeps: `color` and `shineColor` (dim text and full text, react-bits' grey and
 * white; a hue and its own lifted tone), `speed` as `sweepMs`, `delay` as `pauseMs` between
 * passes, `yoyo`, `direction`, `spread` (the band's share of the text), `disabled`, and the
 * off to off pass on a linear clock with react-bits' cycle arithmetic (`bands.shineCycle`).
 * What it changes: the ramp is three flat steps (DESIGN-V2 1.3), one pass by default inside
 * rule 7 rather than forever, the pass runs the way its name says (react-bits' `left` moves the
 * light right), `pauseOnHover` is gone (no hover on a phone), and the band is capped at 120 pt
 * so a long line gets a band, not a floodlight. `play`, `delay` and `replayKey` work as on
 * every text port; `delay` waits before the first pass.
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

import { useReduceMotion } from '../../motion';
import { useColors } from '../../scheme';
import { mixHex, passCount, shineBandWidths, shineCycle, shineRunMs, shineTones, skewReach } from './bands';
import { ClipBand } from './ClipBand';
import { useInk, useTextLook, type PlayProps, type TextLookProps } from './shared';
import { SHINY } from './spec';

export interface ShinyTextProps extends TextLookProps, PlayProps {
  text: string;
  /**
   * The light's peak. Default: `text` over dim ink; over a hue, the hue lifted toward `text`;
   * over `text` itself, a glint down to `textDim`.
   */
  shineColor?: string;
  /** One pass, off to off. Default 1000. */
  sweepMs?: number;
  /** Between passes, the light off the far end. Default 1000. */
  pauseMs?: number;
  /** Passes. Default 1; Infinity for a label that waits. */
  sweeps?: number;
  /** Every other pass runs back. */
  yoyo?: boolean;
  /** Which way the light travels. Default `right`. */
  direction?: 'left' | 'right';
  /** The widest step's share of the text width. Default 0.6. */
  spread?: number;
  /** The lean off vertical. Default 30 (react-bits' 120 degree gradient). 0 is upright. */
  skewDeg?: number;
  /** Flat steps. Default 3. */
  steps?: number;
  disabled?: boolean;
  numberOfLines?: number;
}

export function ShinyText(props: ShinyTextProps) {
  const {
    text,
    shineColor,
    sweepMs = SHINY.sweepMs,
    pauseMs = SHINY.pauseMs,
    sweeps = 1,
    yoyo = false,
    direction = 'right',
    spread = SHINY.spread,
    skewDeg = SHINY.skewDeg,
    steps = SHINY.steps,
    disabled = false,
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
  const look = useTextLook(props, 'row');
  // Unlike the other ports the resting ink is dim: the light is what brings it up to `text`.
  const ink = useInk(props.tone || props.hue || props.color ? props : { tone: 'dim' });
  // The peak: a hue lifted toward `text`; dim ink up to `text`; and a label already in `text`
  // (nothing brighter in the tokens) gets a glint that steps down to `textDim` and back.
  const peak = shineColor ?? (ink.identity ? mixHex(ink.color, c.text, 0.55) : ink.color === c.text ? c.textDim : c.text);
  const tones = useMemo(() => shineTones(ink.color, peak, steps), [ink.color, peak, steps]);

  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((b) => (b && Math.abs(b.width - width) < 0.5 && Math.abs(b.height - height) < 0.5 ? b : { width, height }));
  }, []);
  const widths = useMemo(
    () => (box ? shineBandWidths(box.width, { spread, steps, maxPt: SHINY.maxBandPt, minPt: SHINY.minBandPt }) : []),
    [box, spread, steps],
  );
  const reach = box ? (widths[0] ?? 0) / 2 + skewReach(box.height, skewDeg) : 0;

  const passes = passCount(sweeps);
  const pass = Math.max(1, sweepMs);
  const hold = Math.max(0, pauseMs);
  const runMs = shineRunMs(passes, pass, hold);
  const endsBack = yoyo && Number.isFinite(passes) && passes % 2 === 0;

  // Elapsed ms through the passes, on the UI thread. The bands read the pass progress from it.
  const clock = useSharedValue(0);
  const progress = useDerivedValue(() => {
    const t = clock.value;
    if (t >= runMs) return endsBack ? 0 : 1;
    return shineCycle(t, pass, hold, yoyo);
  });

  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const fireEnd = useCallback(() => onEndRef.current?.(), []);
  const started = useRef<{ key: string | number | undefined } | null>(null);
  const still = reduce || disabled;

  useEffect(() => {
    if (still || !play || !box) return;
    if (started.current && started.current.key === replayKey) return;
    started.current = { key: replayKey };
    cancelAnimation(clock);
    clock.value = 0;
    const linear = { easing: Easing.linear, reduceMotion: ReduceMotion.Never };
    if (Number.isFinite(runMs)) {
      clock.value = withDelay(
        delay,
        withTiming(runMs, { ...linear, duration: runMs }, (finished) => {
          if (finished) runOnJS(fireEnd)();
        }),
      );
    } else {
      const loop = (pass + hold) * (yoyo ? 2 : 1);
      clock.value = withDelay(delay, withRepeat(withTiming(loop, { ...linear, duration: loop }), -1, false));
    }
  }, [still, play, box, replayKey, runMs, pass, hold, yoyo, delay, clock, fireEnd]);

  useEffect(() => () => cancelAnimation(clock), [clock]);

  const textStyle = useMemo(() => [look.font, { color: ink.color }], [look.font, ink.color]);

  return (
    <View accessible accessibilityRole={accessibilityRole} accessibilityLabel={text} style={style}>
      <View onLayout={onLayout}>
        <Text {...look.scaling} numberOfLines={numberOfLines} importantForAccessibility="no" style={textStyle}>
          {text}
        </Text>
        {still || !box ? null : (
          <View style={StyleSheet.absoluteFill} pointerEvents="none" importantForAccessibility="no-hide-descendants">
            {tones.map((tone, k) => (
              <ClipBand
                key={k}
                text={text}
                textStyle={[look.font, { color: tone }]}
                scaling={look.scaling}
                width={box.width}
                height={box.height}
                bandWidth={widths[k] ?? 0}
                skewDeg={skewDeg}
                progress={progress}
                place={{ kind: 'sweep', reach, reverse: direction === 'left' }}
              />
            ))}
          </View>
        )}
      </View>
    </View>
  );
}
