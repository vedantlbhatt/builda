/**
 * Shuffle: a word whose letters roll through their own alphabet and land, odd letters first,
 * then the even ones. For Wrapped answers that are words ("Generalist", "A back and forth"),
 * every time the card arrives; not for titles people open several times a day (DESIGN-V2 4.5).
 * Reduce Motion: the word, faded in over 150 ms.
 *
 *   <Shuffle text="Generalist" role="hero" align="center" replayKey={cardArrival} />
 *   <Shuffle text="Mostly fixes" direction="down" />
 *
 * Ported from react-bits `TextAnimations/Shuffle/Shuffle.tsx` by David Haz. react-bits is MIT
 * + Commons Clause (Copyright (c) 2026 David Haz): the notice is kept here as the licence asks,
 * and the port is used as part of this application only; it is not to be redistributed as a
 * component.
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
 * What the port keeps: each character a clipped cell holding a strip (the original, the
 * copies, the real one) that slides a whole strip's length, `shuffleDirection`, `duration`,
 * `shuffleTimes`, `animationMode` (`evenodd` and `random` with `maxDelay`), `stagger`,
 * `scrambleCharset`, `onShuffleComplete` and the strip order (`strips.ts`). What it changes:
 * three copies drawn from the word's own letters (the doc; react-bits repeats the letter), the
 * kit's `EASE` for `power3.out`, the stagger fitted into 1.2 s, the cells laid out on the lines
 * the settled word breaks into (`shared.tsx`), and a seedable random source. Hover and loop
 * triggers are gone (no hover on a phone; `replayKey` replays), and so are `colorFrom` and
 * `colorTo` (a colour tween between two inks passes through brown, DESIGN-V2 1.3).
 */
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent, type TextStyle } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { mulberry32 } from '../../decrypt';
import { useReduceMotion } from '../../motion';
import { ease, lerp, localProgress } from './curve';
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
import {
  fitShuffleStagger,
  shuffleCharset,
  shuffleSchedule,
  shuffleStrip,
  shuffleTotalMs,
  type ShuffleDirection,
  type ShuffleMode,
  type ShuffleStrip,
} from './strips';
import { SHUFFLE, TEXT_EFFECT_DONE_MS } from './spec';

export interface ShuffleProps extends TextLookProps, PlayProps {
  text: string;
  /** Which way the strips slide. Default `right` (react-bits). */
  direction?: ShuffleDirection;
  /** One character's slide. Default 350. */
  durationMs?: number;
  /** Copies between the original and the real one. Default 3 (the doc). */
  rolls?: number;
  /** Default `evenodd`. */
  mode?: ShuffleMode;
  /** Within a group, before the fit. Default 30. */
  staggerMs?: number;
  /** For `random`: the longest a character waits. Default 0. */
  maxDelayMs?: number;
  /** What the copies are drawn from. Default the word's own letters. */
  charset?: string;
  /** A fixed seed makes the copies repeatable (tests, screenshots). */
  seed?: number;
  budgetMs?: number;
  numberOfLines?: number;
}

export function Shuffle(props: ShuffleProps) {
  const {
    text,
    direction = 'right',
    durationMs = SHUFFLE.ms,
    rolls = SHUFFLE.rolls,
    mode = 'evenodd',
    staggerMs = SHUFFLE.staggerMs,
    maxDelayMs = 0,
    charset,
    seed,
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
  const look = useTextLook(props, 'hero');
  const ink = useInk(props);
  const lines = useLaidLines(text);
  const count = useUnitCount(lines, 'chars');
  const empty = useMemo(() => unitCount(text, 'chars') === 0, [text]);

  // Strips and timings are drawn once per text, seed and replay, so a re-render never reshuffles.
  const plan = useMemo(() => {
    const rng = seed === undefined ? Math.random : mulberry32(seed);
    const set = charset ?? shuffleCharset(text);
    const stagger = mode === 'evenodd' ? fitShuffleStagger(count, durationMs, staggerMs, budgetMs, SHUFFLE.evenStart) : staggerMs;
    const schedule = shuffleSchedule(count, { mode, durationMs, staggerMs: stagger, evenStart: SHUFFLE.evenStart, maxDelayMs, rng });
    return { rng, set, schedule, totalMs: shuffleTotalMs(schedule), strips: new Map<number, ShuffleStrip>() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, count, seed, charset, mode, durationMs, staggerMs, maxDelayMs, budgetMs, replayKey, rolls, direction]);

  const stripFor = (index: number, ch: string): ShuffleStrip => {
    let s = plan.strips.get(index);
    if (!s || s.cells[0] !== ch) {
      s = shuffleStrip(ch, rolls, plan.set, plan.rng, direction);
      plan.strips.set(index, s);
    }
    return s;
  };

  const kerning = useKerning(lines, true, look);
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
      // Until the characters' kerned places are known, the word itself shows: its letters are
      // visible from the first frame (the strips start on the original), and this way the
      // overlay arrives exactly on top of it.
      settled={settled || empty || !kerning.ready}
      fade={fade}
      lines={lines}
      numberOfLines={numberOfLines}
      style={style}
      accessibilityRole={accessibilityRole}
      probes={kerning.probes}
      overlay={
        <LineRows
          lines={lines}
          by="chars"
          offsets={kerning.offsets}
          renderSpace={(t, key) => (
            <Text key={key} {...look.scaling} style={textStyle}>
              {t}
            </Text>
          )}
          renderUnit={(u, key) => {
            const timing = plan.schedule[u.index];
            return (
              <ShuffleCell
                key={key}
                strip={stripFor(u.index, u.text)}
                clock={clock}
                delay={timing?.delay ?? 0}
                duration={timing?.duration ?? durationMs}
                vertical={direction === 'up' || direction === 'down'}
                lineHeight={look.lineHeight}
                textStyle={textStyle}
                scaling={look.scaling}
              />
            );
          }}
        />
      }
    />
  );
}

/**
 * One character: its real glyph (clear) sizes the cell; the strip slides over it, clipped to
 * it. Vertical strips need nothing measured (every row is a line tall); horizontal ones take
 * the cell's width from its first layout, before which the cell shows its own letter.
 */
function ShuffleCell({
  strip,
  clock,
  delay,
  duration,
  vertical,
  lineHeight,
  textStyle,
  scaling,
}: {
  strip: ShuffleStrip;
  clock: SharedValue<number>;
  delay: number;
  duration: number;
  vertical: boolean;
  lineHeight: number;
  textStyle: TextStyle[];
  scaling: TextLook['scaling'];
}) {
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setWidth((was) => (Math.abs(was - w) < 0.25 ? was : w));
  }, []);
  const cell = vertical ? lineHeight : width;
  const from = strip.from;
  const to = strip.to;
  const slide = useAnimatedStyle(() => {
    const e = ease(localProgress(clock.value, delay, duration));
    const offset = lerp(from, to, e) * cell;
    return { transform: vertical ? [{ translateY: offset }] : [{ translateX: offset }] };
  });
  const ch = strip.cells[0] ?? '';
  return (
    <View style={styles.cell} onLayout={vertical ? undefined : onLayout}>
      <Text {...scaling} style={[textStyle, styles.clear]}>
        {ch}
      </Text>
      {vertical || width > 0 ? (
        <Animated.View
          style={[vertical ? styles.column : [styles.row, { width: width * strip.cells.length }], slide]}
        >
          {strip.cells.map((c, i) => (
            <View key={i} style={vertical ? [styles.slotV, { height: lineHeight }] : [styles.slotH, { width }]}>
              <Text {...scaling} style={textStyle}>
                {c}
              </Text>
            </View>
          ))}
        </Animated.View>
      ) : (
        <Text {...scaling} style={[textStyle, styles.over]}>
          {ch}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  cell: { overflow: 'hidden' },
  clear: { opacity: 0 },
  over: { position: 'absolute', left: 0, top: 0 },
  column: { position: 'absolute', left: 0, right: 0, top: 0 },
  row: { position: 'absolute', left: 0, top: 0, bottom: 0, flexDirection: 'row' },
  slotV: { alignItems: 'center', justifyContent: 'flex-start' },
  slotH: { alignItems: 'center' },
});
