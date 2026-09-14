/**
 * SplitFlapText: a phrase that changes on a departures board, each changed character falling
 * through a few others on hinged flaps to land on its new one. For a phrase that changes STATE
 * (the ETA: "no ETA yet" to "about 18m left", on mission tiles and the live bar), never for a
 * number that ticks (that is `Counter`). A new `text` flips from the old one; the first phrase
 * is simply there. `words` cycles like react-bits. Reduce Motion: the new phrase at once.
 *
 *   <SplitFlapText text={etaPhrase} />                         inline, on a card
 *   <SplitFlapText text="GATE 12" tiles role="title" />         a board of tiles
 *
 * Ported from react-bits `TextAnimations/SplitFlapText/SplitFlapText.tsx` by David Haz.
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
 * What the port keeps: each tile two clipped halves and two flaps, the front flap (the old
 * top) folding away over a whole flip while darkening to 52%, the back flap (the new bottom)
 * unfolding over its last 55%, perspective, the monospaced face, react-bits' 120 ms flips and
 * 60 ms stagger, `words`, `cycleDelay`, `loop`, `padTo`, `charset`, `tileColor`, `textColor` (the
 * ink here) and the plan and tick arithmetic (`flap.ts`). What it changes: 6 flips (the doc);
 * the halves show what a real board shows (the new top behind the falling flap, the old bottom
 * until the new one covers it); the tiles are flat `raised` with a `bg` seam and the kit's mark
 * radius, no gradients, inset glows or shadows (DESIGN-V2 1.3); `tiles` is optional, so a phrase
 * can flip inline on its card; the ETA's lower case flips through lower case (`auto`); a change
 * lands inside 1.2 s; a flap is a transform on an Animated.View (a transform on Animated.Text
 * is dropped at mount on this build).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { mulberry32 } from '../../decrypt';
import { useReduceMotion } from '../../motion';
import { useColors } from '../../scheme';
import { SHAPE } from '../../shape';
import { clamp01, ease } from './curve';
import {
  fitFlap,
  flapPlans,
  flapStateAt,
  flapTotalMs,
  flapWidth,
  padPhrase,
  type FlapCharset,
  type FlapTileState,
} from './flap';
import { useInk, useTextLook, type TextLook, type TextLookProps } from './shared';
import { FLIP, TEXT_EFFECT_DONE_MS } from './spec';

export interface SplitFlapTextProps extends TextLookProps {
  /** The phrase. A new one flips from the old. */
  text?: string;
  /** Instead of `text`: phrases shown in turn, `cycleDelayMs` apart (react-bits' mode). */
  words?: readonly string[];
  /** Between phrases for `words`. Default 2400 (react-bits). */
  cycleDelayMs?: number;
  /** For `words`: back to the first after the last. Default false (rule 6). */
  loop?: boolean;
  /** Default 120. */
  flipMs?: number;
  /** Per tile index, before the fit. Default 60. */
  staggerMs?: number;
  /** Random characters before each target. Default 6. */
  flips?: number;
  /** Default `auto`: digits flip through digits, letters through their own case. */
  charset?: FlapCharset;
  /** Draw each character on a flat tile, a board. Default false: inline on `surface`. */
  tiles?: boolean;
  /** The tile. Default `raised`. */
  tileColor?: string;
  /** What the phrase sits on when there are no tiles (the flaps are opaque). Default `card`. */
  surface?: string;
  /** At least this many tiles. */
  padTo?: number;
  /** Flip in from blank tiles on mount instead of starting settled. */
  playOnMount?: boolean;
  seed?: number;
  budgetMs?: number;
  /** A change has landed. */
  onEnd?: () => void;
}

export function SplitFlapText(props: SplitFlapTextProps) {
  const {
    text,
    words,
    cycleDelayMs = 2400,
    loop = false,
    flipMs = FLIP.flipMs,
    staggerMs = FLIP.staggerMs,
    flips = FLIP.flips,
    charset = 'auto',
    tiles = false,
    tileColor,
    surface,
    padTo = 0,
    playOnMount = false,
    seed,
    budgetMs = TEXT_EFFECT_DONE_MS,
    onEnd,
    style,
    accessibilityRole = 'text',
  } = props;
  const c = useColors();
  const reduce = useReduceMotion();
  const look = useTextLook(props, 'mono');
  const ink = useInk(props);
  const ground = tiles ? (tileColor ?? c.raised) : (surface ?? c.card);

  // `words` mode walks its own index; `text` mode follows the prop.
  const phrases = useMemo(() => (words && words.length > 0 ? [...words] : [text ?? '']), [words, text]);
  const [wordIndex, setWordIndex] = useState(0);
  const target = words && words.length > 0 ? (phrases[wordIndex] ?? '') : (text ?? '');
  const width = flapWidth(words && words.length > 0 ? phrases : [target], padTo);

  const rngRef = useRef<() => number>(seed === undefined ? Math.random : mulberry32(seed));
  const [cells, setCells] = useState<FlapTileState[]>(() =>
    padPhrase(playOnMount && !reduce ? '' : target, width).map((ch) => ({ current: ch, next: ch, flipping: false, step: -1 })),
  );
  const shownRef = useRef<string[]>(padPhrase(playOnMount && !reduce ? '' : target, width));
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  // One change at a time: from what is showing to `target`, on a frame loop that only renders
  // when some tile's flip moves on.
  useEffect(() => {
    const to = padPhrase(target, Math.max(width, shownRef.current.length));
    const from = padPhrase(shownRef.current.join(''), to.length);
    if (from.join('') === to.join('')) {
      if (cells.length !== to.length) setCells(to.map((ch) => ({ current: ch, next: ch, flipping: false, step: -1 })));
      return;
    }
    if (reduce) {
      shownRef.current = to;
      setCells(to.map((ch) => ({ current: ch, next: ch, flipping: false, step: -1 })));
      onEndRef.current?.();
      return;
    }
    let last = -1;
    for (let i = 0; i < to.length; i++) if (from[i] !== to[i]) last = i;
    const fit = fitFlap(last, { flipMs, staggerMs, flips }, budgetMs);
    const plans = flapPlans(from, to, { flips: fit.flips, staggerMs: fit.staggerMs, charset, rng: rngRef.current });
    const total = flapTotalMs(plans, flipMs);
    const byIndex = new Map(plans.map((p) => [p.index, p]));
    const t0 = Date.now();
    let raf = 0;
    let steps = to.map(() => -2);
    const tick = () => {
      const elapsed = Date.now() - t0;
      let changed = false;
      const next: FlapTileState[] = to.map((ch, i) => {
        const plan = byIndex.get(i);
        const s = plan ? flapStateAt(plan, elapsed, flipMs) : { current: ch, next: ch, flipping: false, step: -1 };
        if (s.step !== steps[i]) changed = true;
        return s;
      });
      if (changed) {
        steps = next.map((s) => s.step);
        setCells(next);
      }
      if (elapsed < total) {
        raf = requestAnimationFrame(tick);
        return;
      }
      shownRef.current = to;
      onEndRef.current?.();
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      // Interrupted: the next change starts from where this one was heading.
      shownRef.current = to;
    };
    // `cells` is read only to fix a width change with nothing to flip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, width, reduce, flipMs, staggerMs, flips, charset, budgetMs]);

  // `words`: the next phrase once this one has shown for `cycleDelayMs` (and has landed).
  useEffect(() => {
    if (!words || words.length < 2) return;
    if (!loop && wordIndex >= words.length - 1) return;
    const id = setTimeout(() => setWordIndex((i) => (i + 1) % words.length), cycleDelayMs + budgetMs);
    return () => clearTimeout(id);
  }, [words, loop, wordIndex, cycleDelayMs, budgetMs]);

  // A tile is a line tall and as wide as the face's widest digit; a board's tile is wider
  // (react-bits' 0.78 em), with the character centred.
  const [cellWidth, setCellWidth] = useState(0);
  const measure = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setCellWidth((was) => (Math.abs(was - w) < 0.25 ? was : w));
  }, []);
  const tileW = tiles ? Math.max(cellWidth, Math.round(look.fontSize * 0.78)) : cellWidth;
  const tileH = look.lineHeight;
  const gap = tiles ? Math.max(2, Math.round(look.fontSize * 0.08)) : 0;
  const label = (words && words.length > 0 ? target : text ?? '').trim();
  const textStyle = useMemo(() => [look.font, { color: ink.color, textAlign: 'center' as const }], [look.font, ink.color]);
  const trimmed = tiles ? cells : trimTrailingBlanks(cells);

  return (
    <View accessible accessibilityRole={accessibilityRole} accessibilityLabel={label} style={[styles.row, { gap }, style]}>
      {/* One clear digit, measured once: the width every cell shares. */}
      <Text {...look.scaling} style={[look.font, styles.probe]} onLayout={measure} importantForAccessibility="no">
        0
      </Text>
      {tileW > 0
        ? trimmed.map((cell, i) => (
            <Tile
              key={i}
              cell={cell}
              width={tileW}
              height={tileH}
              flipMs={flipMs}
              ground={ground}
              seam={c.bg}
              shadeColor={c.bg}
              board={tiles}
              textStyle={textStyle}
              scaling={look.scaling}
            />
          ))
        : null}
    </View>
  );
}

/** Inline, a phrase that got shorter gives its trailing blank cells back once it has landed. */
function trimTrailingBlanks(cells: FlapTileState[]): FlapTileState[] {
  let end = cells.length;
  while (end > 0) {
    const cell = cells[end - 1]!;
    if (cell.flipping || cell.current !== ' ') break;
    end -= 1;
  }
  return end === cells.length ? cells : cells.slice(0, end);
}

interface TileProps {
  cell: FlapTileState;
  width: number;
  height: number;
  flipMs: number;
  ground: string;
  seam: string;
  shadeColor: string;
  board: boolean;
  textStyle: TextStyle[];
  scaling: TextLook['scaling'];
}

/**
 * A tile: the new top and the old bottom as still halves, and while it flips, the old top on
 * the front flap and the new bottom on the back flap, remounted for every flip so each one runs
 * from its first frame.
 */
function Tile({ cell, width, height, flipMs, ground, seam, shadeColor, board, textStyle, scaling }: TileProps) {
  const half = height / 2;
  const box: ViewStyle = { width, height };
  return (
    <View style={[box, board ? [styles.board, { backgroundColor: ground }] : null]}>
      <Half char={cell.flipping ? cell.next : cell.current} top width={width} height={height} ground={ground} textStyle={textStyle} scaling={scaling} />
      <Half char={cell.current} top={false} width={width} height={height} ground={ground} textStyle={textStyle} scaling={scaling} />
      {cell.flipping ? (
        <>
          <Flap key={`f${cell.step}`} front char={cell.current} width={width} height={height} flipMs={flipMs} ground={ground} shadeColor={shadeColor} textStyle={textStyle} scaling={scaling} />
          <Flap key={`b${cell.step}`} front={false} char={cell.next} width={width} height={height} flipMs={flipMs} ground={ground} shadeColor={shadeColor} textStyle={textStyle} scaling={scaling} />
        </>
      ) : null}
      {board ? <View pointerEvents="none" style={[styles.seam, { top: half - 0.5, backgroundColor: seam }]} /> : null}
    </View>
  );
}

/** Half a character: the top or bottom half of a line tall glyph box, clipped. */
function Half({
  char,
  top,
  width,
  height,
  ground,
  textStyle,
  scaling,
  style,
}: {
  char: string;
  top: boolean;
  width: number;
  height: number;
  ground: string;
  textStyle: TextStyle[];
  scaling: TextLook['scaling'];
  style?: StyleProp<ViewStyle>;
}) {
  const half = height / 2;
  return (
    <View style={[styles.half, { top: top ? 0 : half, width, height: half, backgroundColor: ground }, style]}>
      <Text {...scaling} style={[textStyle, { position: 'absolute', left: 0, width, height, top: top ? 0 : -half }]}>
        {char}
      </Text>
    </View>
  );
}

/**
 * A flap. Front: the old top, hinged at its bottom edge, folding from 0 to 90 degrees over the
 * whole flip and darkening. Back: the new bottom, hinged at its top edge, unfolding from 90 to
 * 0 over the flip's last 55%. The hinge is a translate either side of the rotation, so nothing
 * depends on `transformOrigin`.
 */
function Flap({
  front,
  char,
  width,
  height,
  flipMs,
  ground,
  shadeColor,
  textStyle,
  scaling,
}: {
  front: boolean;
  char: string;
  width: number;
  height: number;
  flipMs: number;
  ground: string;
  shadeColor: string;
  textStyle: TextStyle[];
  scaling: TextLook['scaling'];
}) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withTiming(1, { duration: flipMs, easing: Easing.linear, reduceMotion: ReduceMotion.Never });
  }, [p, flipMs]);
  const quarter = height / 4;
  const fold = useAnimatedStyle(() => {
    const t = front ? ease(p.value) : ease(clamp01((p.value - FLIP.backFrom) / (1 - FLIP.backFrom)));
    const angle = front ? -90 * t : 90 * (1 - t);
    const hinge = front ? quarter : -quarter;
    return {
      transform: [{ perspective: FLIP.perspective }, { translateY: hinge }, { rotateX: `${angle}deg` }, { translateY: -hinge }],
    };
  });
  const shade = useAnimatedStyle(() => {
    const t = front ? ease(p.value) : ease(clamp01((p.value - FLIP.backFrom) / (1 - FLIP.backFrom)));
    return { opacity: front ? FLIP.shade * t : (FLIP.shade - 0.06) * (1 - t) };
  });
  const half = height / 2;
  return (
    <Animated.View style={[styles.flap, { top: front ? 0 : half, width, height: half, backgroundColor: ground }, fold]}>
      <Text {...scaling} style={[textStyle, { position: 'absolute', left: 0, width, height, top: front ? 0 : -half }]}>
        {char}
      </Text>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: shadeColor }, shade]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', alignSelf: 'flex-start' },
  probe: { position: 'absolute', opacity: 0, left: 0, top: 0 },
  board: { borderRadius: SHAPE.mark, borderCurve: 'continuous', overflow: 'hidden' },
  half: { position: 'absolute', left: 0, overflow: 'hidden' },
  flap: { position: 'absolute', left: 0, overflow: 'hidden', backfaceVisibility: 'hidden' },
  seam: { position: 'absolute', left: 0, right: 0, height: 1 },
});
