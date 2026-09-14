/**
 * RotatingText: a word that turns over to the next one in a list, its letters rolling up out
 * of a slot while the next word's roll in from below, the slot's width following the word. For
 * a short list said once (onboarding: "Builda reads [Claude Code, Codex, Cursor]", each name in
 * its harness hue), stopping on the last unless `loop`. Not for the Now tab's empty line (it is
 * still, DESIGN-V2 4.5). Reduce Motion: the words cross fade in place.
 *
 *   <RotatingText texts={['Claude Code', 'Codex', 'Cursor']} colors={harnessInks} role="title" />
 *
 * Ported from react-bits `TextAnimations/RotatingText/RotatingText.tsx` by David Haz.
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
 * What the port keeps: `texts`, `rotationInterval` (2 s), `auto`, `loop`, `splitBy`
 * (characters, words, lines or any separator), `staggerDuration` and `staggerFrom`, enter from
 * `y: 100%` and exit to `y: -120%` with opacity, AnimatePresence's `wait` and `sync`, the width
 * following the word (motion's `layout`), `onNext`, and the ref's `next`, `previous`, `jumpTo`,
 * `reset`. What it changes: the spring becomes timing on `EASE` (nothing here is pulled by a
 * finger, DESIGN-DIRECTION 3.5), in over 300 ms and out in 210; `loop` defaults to false; one
 * pivot for `random`; per text colours (`colors`, `hues`), and a word in a hue snaps its opacity
 * and arrives by position (DESIGN-V2 1.3).
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent, type TextStyle } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import type { HueName } from '../../../theme';
import { EASE, useReduceMotion } from '../../motion';
import { useColors } from '../../scheme';
import { ease, lerp, localProgress } from './curve';
import { fadeFor, resolveInk } from './ink';
import {
  clampIndex,
  nextIndex,
  previousIndex,
  rotateDelays,
  rotateElements,
  rotationTiming,
  type RotateSplit,
} from './rotate';
import { useInk, useTextLook, type TextLook, type TextLookProps } from './shared';
import { ROTATE, TEXT_REDUCED_FADE } from './spec';
import type { StaggerFrom } from './stagger';

export interface RotatingTextRef {
  next: () => void;
  previous: () => void;
  jumpTo: (index: number) => void;
  reset: () => void;
}

export interface RotatingTextProps extends TextLookProps {
  texts: readonly string[];
  /** Between turns. Default 2000 (react-bits). */
  intervalMs?: number;
  /** Turn by itself. Default true; false to drive it with the ref. */
  auto?: boolean;
  /** Start again after the last. Default false: it says its list once and rests. */
  loop?: boolean;
  /** Default `characters`. */
  splitBy?: RotateSplit;
  /** Per element. Default 0 (react-bits): a word turns over as one. */
  staggerMs?: number;
  staggerFrom?: StaggerFrom;
  /** `wait` (default): the next word waits for this one to leave. `sync`: both at once. */
  mode?: 'wait' | 'sync';
  /** Per text, cycling: a resolved colour each (`harnessHue(id)?.text`). Wins over `hues`. */
  colors?: readonly (string | undefined)[];
  /** Per text, cycling: a spectrum hue each. */
  hues?: readonly HueName[];
  enterMs?: number;
  exitMs?: number;
  /** Hold the first word until true (a step's push has settled). Default true. */
  play?: boolean;
  onNext?: (index: number) => void;
}

interface Layer {
  id: number;
  index: number;
  exiting: boolean;
  /** Milliseconds after mount before its elements start in. */
  enterAt: number;
  /** Mounted already shown (the first word). */
  shown: boolean;
}

export const RotatingText = forwardRef<RotatingTextRef, RotatingTextProps>(function RotatingText(props, ref) {
  const {
    texts,
    intervalMs = ROTATE.intervalMs,
    auto = true,
    loop = false,
    splitBy = 'characters',
    staggerMs = ROTATE.staggerMs,
    staggerFrom = 'first',
    mode = 'wait',
    colors,
    hues,
    enterMs: enterProp,
    exitMs: exitProp,
    play = true,
    onNext,
    style,
    accessibilityRole = 'text',
  } = props;
  const c = useColors();
  const reduce = useReduceMotion();
  const look = useTextLook(props, 'title');
  const base = useInk(props);
  const enterMs = reduce ? TEXT_REDUCED_FADE : (enterProp ?? ROTATE.enterMs);
  const exitMs = reduce ? TEXT_REDUCED_FADE : (exitProp ?? ROTATE.exitMs);
  const lineH = look.lineHeight;
  const vertical = splitBy === 'lines';

  const inkFor = useCallback(
    (i: number) => {
      const own = colors && colors.length > 0 ? colors[i % colors.length] : undefined;
      if (own) return resolveInk(c, { color: own });
      const h = hues && hues.length > 0 ? hues[i % hues.length] : undefined;
      if (h) return resolveInk(c, { hue: h });
      return base;
    },
    [colors, hues, c, base],
  );

  const [index, setIndex] = useState(0);
  const nextId = useRef(1);
  const [layers, setLayers] = useState<Layer[]>([{ id: 0, index: 0, exiting: false, enterAt: 0, shown: true }]);
  const indexRef = useRef(0);
  const onNextRef = useRef(onNext);
  onNextRef.current = onNext;

  const elementsOf = useCallback((i: number) => rotateElements(texts[i] ?? '', splitBy), [texts, splitBy]);
  const lastDelay = useCallback(
    (i: number) => {
      const d = rotateDelays(elementsOf(i), staggerMs, staggerFrom, () => 0.5);
      let m = 0;
      for (const v of d) if (v > m) m = v;
      return m;
    },
    [elementsOf, staggerMs, staggerFrom],
  );

  // The slot's width follows the word, measured from clear copies of every word.
  const [widths, setWidths] = useState<Record<number, number>>({});
  const width = useSharedValue(0);
  const measured = widths[index] !== undefined;

  const go = useCallback(
    (to: number) => {
      const from = indexRef.current;
      if (to === from) return;
      indexRef.current = to;
      const timing = rotationTiming(
        { lastDelayMs: lastDelay(from), exitMs },
        { lastDelayMs: lastDelay(to), enterMs },
        mode,
      );
      setLayers((prev) => [
        ...prev.map((l) => (l.exiting ? l : { ...l, exiting: true })),
        { id: nextId.current++, index: to, exiting: false, enterAt: timing.enterAt, shown: false },
      ]);
      setIndex(to);
      onNextRef.current?.(to);
    },
    [lastDelay, exitMs, enterMs, mode],
  );

  const next = useCallback(() => go(nextIndex(indexRef.current, texts.length, loop)), [go, texts.length, loop]);
  const previous = useCallback(() => go(previousIndex(indexRef.current, texts.length, loop)), [go, texts.length, loop]);
  const jumpTo = useCallback((i: number) => go(clampIndex(i, texts.length)), [go, texts.length]);
  const reset = useCallback(() => go(0), [go]);
  useImperativeHandle(ref, () => ({ next, previous, jumpTo, reset }), [next, previous, jumpTo, reset]);

  // Auto: one turn per interval, and none past the last word unless looping.
  useEffect(() => {
    if (!auto || !play || texts.length < 2) return;
    if (!loop && index >= texts.length - 1) return;
    const id = setTimeout(next, intervalMs);
    return () => clearTimeout(id);
  }, [auto, play, texts.length, loop, index, intervalMs, next]);

  // The width moves with the incoming word: in `wait`, once the outgoing one has left.
  const firstWidth = useRef(true);
  useEffect(() => {
    const w = widths[index];
    if (w === undefined) return;
    if (firstWidth.current) {
      firstWidth.current = false;
      width.value = w;
      return;
    }
    const entering = layers.find((l) => !l.exiting);
    width.value = withDelay(
      entering?.enterAt ?? 0,
      withTiming(w, { duration: enterMs, easing: EASE, reduceMotion: ReduceMotion.Never }),
    );
    // Only a new index moves the width; `layers` is read for the incoming layer's delay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, widths[index], enterMs, width]);

  // A little room past the measured word, taken back by a negative margin: the rolled letters
  // are drawn one by one without the word's kerning, and the slot must not shave the last one.
  const slack = Math.ceil(look.fontSize * 0.1);
  const slot = useAnimatedStyle(() => ({ width: width.value + slack, marginRight: -slack }));
  const removeLayer = useCallback((id: number) => setLayers((prev) => prev.filter((l) => l.id !== id)), []);
  const onMeasure = useCallback((i: number, w: number) => {
    setWidths((prev) => (prev[i] !== undefined && Math.abs(prev[i]! - w) < 0.5 ? prev : { ...prev, [i]: w }));
  }, []);

  const lines = vertical ? Math.max(1, ...texts.map((t) => t.split('\n').length)) : 1;
  const textStyleFor = (i: number): TextStyle[] => [look.font, { color: inkFor(i).color }];

  return (
    <View accessible accessibilityRole={accessibilityRole} accessibilityLabel={texts[index] ?? ''} style={style}>
      {/* Every word once, in clear ink and out of the flow, to measure the slot. */}
      <View style={styles.measure} pointerEvents="none" importantForAccessibility="no-hide-descendants">
        {texts.map((t, i) => (
          <Text
            key={i}
            {...look.scaling}
            style={[look.font, styles.clear]}
            onLayout={(e: LayoutChangeEvent) => onMeasure(i, e.nativeEvent.layout.width)}
          >
            {t}
          </Text>
        ))}
      </View>
      <Animated.View
        importantForAccessibility="no-hide-descendants"
        style={[styles.slot, { height: lineH * lines }, measured ? slot : null]}
      >
        {layers.map((layer) => (
          <RotLayer
            key={layer.id}
            layer={layer}
            words={elementsOf(layer.index)}
            delays={rotateDelays(elementsOf(layer.index), staggerMs, staggerFrom, () => 0.5)}
            enterMs={enterMs}
            exitMs={exitMs}
            fadeMs={fadeFor(inkFor(layer.index).identity, reduce ? TEXT_REDUCED_FADE : enterMs)}
            travel={reduce ? 0 : lineH}
            vertical={vertical}
            play={play}
            textStyle={textStyleFor(layer.index)}
            scaling={look.scaling}
            onExited={removeLayer}
          />
        ))}
      </Animated.View>
    </View>
  );
});

function RotLayer({
  layer,
  words,
  delays,
  enterMs,
  exitMs,
  fadeMs,
  travel,
  vertical,
  play,
  textStyle,
  scaling,
  onExited,
}: {
  layer: Layer;
  words: ReturnType<typeof rotateElements>;
  delays: number[];
  enterMs: number;
  exitMs: number;
  fadeMs: number;
  travel: number;
  vertical: boolean;
  play: boolean;
  textStyle: TextStyle[];
  scaling: TextLook['scaling'];
  onExited: (id: number) => void;
}) {
  let maxDelay = 0;
  for (const d of delays) if (d > maxDelay) maxDelay = d;
  // Two clocks in ms: in, then out. The first word mounts already in.
  const inClock = useSharedValue(layer.shown ? maxDelay + enterMs : 0);
  const outClock = useSharedValue(0);
  const linear = { easing: Easing.linear, reduceMotion: ReduceMotion.Never };

  useEffect(() => {
    if (layer.shown || !play) return;
    const total = maxDelay + enterMs;
    inClock.value = withDelay(layer.enterAt, withTiming(total, { ...linear, duration: total }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play]);

  const id = layer.id;
  useEffect(() => {
    if (!layer.exiting) return;
    const total = maxDelay + exitMs;
    outClock.value = withTiming(total, { ...linear, duration: total }, (finished) => {
      if (finished) runOnJS(onExited)(id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer.exiting]);

  let n = 0;
  return (
    <View style={[styles.layer, vertical ? styles.column : styles.row]}>
      {words.map((w, wi) => (
        <View key={wi} style={styles.row}>
          {w.characters.map((ch, ci) => {
            const delay = delays[n++] ?? 0;
            return (
              <RotElement
                key={ci}
                text={ch}
                delay={delay}
                inClock={inClock}
                outClock={outClock}
                enterMs={enterMs}
                exitMs={exitMs}
                fadeMs={fadeMs}
                travel={travel}
                textStyle={textStyle}
                scaling={scaling}
              />
            );
          })}
          {w.needsSpace && !vertical ? (
            <Text {...scaling} style={[textStyle, styles.clear]}>
              {' '}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function RotElement({
  text,
  delay,
  inClock,
  outClock,
  enterMs,
  exitMs,
  fadeMs,
  travel,
  textStyle,
  scaling,
}: {
  text: string;
  delay: number;
  inClock: SharedValue<number>;
  outClock: SharedValue<number>;
  enterMs: number;
  exitMs: number;
  fadeMs: number;
  travel: number;
  textStyle: TextStyle[];
  scaling: TextLook['scaling'];
}) {
  const move = useAnimatedStyle(() => {
    const a = ease(localProgress(inClock.value, delay, enterMs));
    const b = ease(localProgress(outClock.value, delay, exitMs));
    const fadeIn = localProgress(inClock.value, delay, fadeMs);
    const fadeOut = localProgress(outClock.value, delay, Math.min(fadeMs, exitMs));
    const y = lerp(ROTATE.fromLines * travel, 0, a) + lerp(0, ROTATE.toLines * travel, b);
    return { opacity: fadeIn * (1 - fadeOut), transform: [{ translateY: y }] };
  });
  return (
    <Animated.View style={move}>
      <Text {...scaling} style={textStyle}>
        {text}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  measure: { position: 'absolute', left: 0, top: 0, width: 4096, alignItems: 'flex-start', opacity: 0 },
  clear: { opacity: 0 },
  slot: { overflow: 'hidden', alignSelf: 'flex-start' },
  layer: { position: 'absolute', left: 0, top: 0 },
  row: { flexDirection: 'row' },
  column: { flexDirection: 'column' },
});
