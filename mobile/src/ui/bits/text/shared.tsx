/**
 * What the text ports share: the ink, the type look, the lines the text system broke a string
 * into, the one clock an effect runs on, and the shell that holds the settled text's place
 * while an animated copy is drawn over it.
 *
 * Part of the react-bits text ports (by David Haz; MIT + Commons Clause, Copyright (c) 2026
 * David Haz; used as part of this application, not redistributed as components).
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
 * Two things measured on this build shape everything here:
 * - A transform on an `Animated.Text` is dropped at mount (RN 0.79, Fabric, Reanimated 3.17;
 *   `Counter.tsx` found it). Every moving unit is an `Animated.View` around a plain `Text`.
 * - The animated copy must break its lines exactly where the settled text will, or the swap
 *   at the end jumps a word to another line. So the settled text is laid out first (hidden),
 *   its lines are read from `onTextLayout`, and each line is drawn as a row at the place the
 *   text system put it. When the effect ends, the settled text shows and the rows go.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextLayoutEventData,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import type { TypeRole } from '../../../theme';
import { EASE } from '../../motion';
import { useColors } from '../../scheme';
import { roleScaling, roleStyle, type RoleWeight } from '../../typeStyle';
import { resolveInk, type InkSource } from './ink';
import {
  kernedOffsets,
  kerningProbes,
  linesAreText,
  sameLines,
  trimLineEnd,
  unitsForLines,
  type LaidLine,
  type SplitBy,
  type TextUnit,
} from './segment';
import { TEXT_REDUCED_FADE } from './spec';

// ─── props every text port takes ─────────────────────────────────────────────────────

export interface TextLookProps extends InkSource {
  /** One of the nine type roles. Each component names its default. */
  role?: TypeRole;
  weight?: RoleWeight;
  /** Left unless the design says otherwise (the Wrapped answer, the onboarding creature). */
  align?: 'left' | 'center' | 'right';
  /**
   * Type that is not a kit role (the onboarding headline, 34/800). Font metrics only: the
   * colour comes from `tone`, `hue` or `color`.
   */
  textStyle?: StyleProp<TextStyle>;
  allowFontScaling?: boolean;
  maxFontSizeMultiplier?: number;
  style?: StyleProp<ViewStyle>;
  /** `header` for a headline. Default `text`. */
  accessibilityRole?: 'text' | 'header';
}

export interface PlayProps {
  /** Start when true (a card arrived, a step's push settled). Default true. */
  play?: boolean;
  /** Milliseconds between `play` and the first frame. */
  delay?: number;
  /**
   * A new value replays the effect (a Wrapped card arriving again, a long press on a hero). The
   * same value never plays twice; a new `text` with the same key just lands.
   */
  replayKey?: string | number;
  /** Once the effect has landed (under Reduce Motion, once the fade has). */
  onEnd?: () => void;
}

// ─── ink and type ─────────────────────────────────────────────────────────────────────

/** The resolved colour and whether it is an identity hue (see `ink.ts`). */
export function useInk(src: InkSource): { color: string; identity: boolean } {
  const c = useColors();
  return useMemo(() => resolveInk(c, src), [c, src.tone, src.hue, src.color]);
}

export interface TextLook {
  /** Role, weight and override, flattened, without colour. */
  font: TextStyle;
  scaling: { allowFontScaling: boolean; maxFontSizeMultiplier?: number };
  lineHeight: number;
  fontSize: number;
}

export function useTextLook(props: TextLookProps, defaultRole: TypeRole): TextLook {
  const { role = defaultRole, weight, align, textStyle, allowFontScaling, maxFontSizeMultiplier } = props;
  return useMemo(() => {
    const base = roleStyle(role, weight);
    const flat = (StyleSheet.flatten(textStyle) ?? {}) as TextStyle;
    const font: TextStyle = { ...base, ...(align ? { textAlign: align } : null), ...flat };
    delete font.color;
    const scaled = roleScaling(role);
    const scaling =
      allowFontScaling === undefined && maxFontSizeMultiplier === undefined
        ? scaled
        : {
            allowFontScaling: allowFontScaling ?? scaled.allowFontScaling,
            maxFontSizeMultiplier: maxFontSizeMultiplier ?? scaled.maxFontSizeMultiplier,
          };
    const fontSize = typeof font.fontSize === 'number' ? font.fontSize : base.fontSize;
    const lineHeight = typeof font.lineHeight === 'number' ? font.lineHeight : Math.round(fontSize * 1.2);
    return { font, scaling, lineHeight, fontSize };
  }, [role, weight, align, textStyle, allowFontScaling, maxFontSizeMultiplier]);
}

// ─── lines ────────────────────────────────────────────────────────────────────────────

/** How long to wait for `onTextLayout` before drawing the text as one wrapping row (web). */
const LINES_GRACE_MS = 120;

export interface Lines {
  /** The lines to draw, or null until the text has been laid out. */
  lines: LaidLine[] | null;
  /** True when `lines` is one wrapping row because no line layout arrived. */
  approximate: boolean;
  box: { width: number; height: number } | null;
  onTextLayout: (e: NativeSyntheticEvent<TextLayoutEventData>) => void;
  onLayout: (e: LayoutChangeEvent) => void;
}

/**
 * The lines `text` was broken into, from the hidden settled copy's `onTextLayout`. A layout
 * event for an older string is ignored. Where the platform never reports lines (react native
 * web), the whole text becomes one wrapping row after a short grace.
 */
export function useLaidLines(text: string): Lines {
  const [lines, setLines] = useState<LaidLine[] | null>(null);
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const [graceOver, setGraceOver] = useState(Platform.OS === 'web');
  const textRef = useRef(text);
  textRef.current = text;

  const onTextLayout = useCallback((e: NativeSyntheticEvent<TextLayoutEventData>) => {
    const next: LaidLine[] = e.nativeEvent.lines.map((l) => ({ text: l.text, x: l.x, y: l.y, width: l.width, height: l.height }));
    if (!linesAreText(next, textRef.current)) return;
    setLines((prev) => (sameLines(prev, next) ? prev : next));
  }, []);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((prev) => (prev && Math.abs(prev.width - width) < 0.5 && Math.abs(prev.height - height) < 0.5 ? prev : { width, height }));
  }, []);

  useEffect(() => {
    if (graceOver || !box) return;
    const id = setTimeout(() => setGraceOver(true), LINES_GRACE_MS);
    return () => clearTimeout(id);
  }, [box, graceOver]);

  const valid = lines && linesAreText(lines, text) ? lines : null;
  if (valid) return { lines: valid, approximate: false, box, onTextLayout, onLayout };
  if (graceOver && box) {
    return { lines: [{ text, x: 0, y: 0, width: box.width, height: box.height }], approximate: true, box, onTextLayout, onLayout };
  }
  return { lines: null, approximate: false, box, onTextLayout, onLayout };
}

// ─── kerning ──────────────────────────────────────────────────────────────────────────

/** How long to wait for the kerning probes before placing characters side by side instead. */
const KERNING_GRACE_MS = 160;

export interface Kerning {
  /** Per laid line, each visible character's left edge from the line's start; null until measured. */
  offsets: number[][] | null;
  /** Measured, not needed, or given up on: the effect may start. */
  ready: boolean;
  /** The clear texts that measure it; render them (inside `EffectShell`) until `ready`. */
  probes: ReactNode;
}

/**
 * Where each character of each laid line sits, kerning included (`segment.kerningProbes`): the
 * line up to and through each character, and each character alone, laid out once in clear ink
 * and read through `onTextLayout`. Only for effects that split into characters; words keep their
 * own kerning. Approximate lines (web) and a slow layout fall back to characters side by side.
 */
export function useKerning(lines: Lines, enabled: boolean, look: TextLook): Kerning {
  const laid = enabled && !lines.approximate ? lines.lines : null;
  const plan = useMemo(() => (laid ? laid.map((l) => kerningProbes(trimLineEnd(l.text))) : null), [laid]);
  const texts = useMemo(() => (plan ? Array.from(new Set(plan.flatMap((p) => [...p.prefixes, ...p.glyphs]))) : []), [plan]);
  // Widths belong to one plan; a new layout starts a new map (checked where it is written, so
  // a layout event that lands before an effect runs is never thrown away).
  const widths = useRef<{ plan: typeof plan; map: Map<string, number> }>({ plan: null, map: new Map() });
  const [offsets, setOffsets] = useState<{ plan: typeof plan; x: number[][] } | null>(null);
  const [gaveUp, setGaveUp] = useState<typeof plan | null>(null);

  useEffect(() => {
    if (!plan) return;
    const id = setTimeout(() => setGaveUp(plan), KERNING_GRACE_MS);
    return () => clearTimeout(id);
  }, [plan]);

  const measured = useCallback(
    (text: string, width: number) => {
      if (!plan) return;
      if (widths.current.plan !== plan) widths.current = { plan, map: new Map() };
      widths.current.map.set(text, width);
      if (widths.current.map.size < texts.length) return;
      const w = widths.current.map;
      const x = plan.map((p) =>
        kernedOffsets(
          p.prefixes.map((t) => w.get(t) ?? 0),
          p.glyphs.map((t) => w.get(t) ?? 0),
        ),
      );
      setOffsets((prev) => (prev && prev.plan === plan ? prev : { plan, x }));
    },
    [plan, texts.length],
  );

  const current = offsets && offsets.plan === plan ? offsets.x : null;
  const ready = !enabled || lines.approximate || (lines.lines !== null && (current !== null || gaveUp === plan));
  const probeStyle = useMemo(() => [look.font, styles.probeText], [look.font]);
  const probes =
    plan && current === null && gaveUp !== plan ? (
      <View style={styles.probes} pointerEvents="none" importantForAccessibility="no-hide-descendants">
        {texts.map((t, i) => (
          <Text
            key={`${i}:${t}`}
            {...look.scaling}
            style={probeStyle}
            onTextLayout={(e: NativeSyntheticEvent<TextLayoutEventData>) => measured(t, e.nativeEvent.lines[0]?.width ?? 0)}
          >
            {t}
          </Text>
        ))}
      </View>
    ) : null;
  return { offsets: current, ready, probes };
}

// ─── the clock ────────────────────────────────────────────────────────────────────────

export interface EffectClock {
  /** Milliseconds into the effect, on the UI thread. */
  clock: SharedValue<number>;
  /** The whole element's opacity: 1, except the Reduce Motion fade. */
  fade: SharedValue<number>;
  /** The effect has landed (or never runs): draw the settled text. */
  settled: boolean;
}

/**
 * One linear clock from 0 to `totalMs`, started when `play` and `ready` are both true, once per
 * `replayKey`. Every unit reads it and eases its own share, so a 30 character reveal is one
 * animation, not thirty. Under Reduce Motion there is no clock: the element fades in over
 * 150 ms and is settled from the first frame.
 */
export function useEffectClock(options: {
  play: boolean;
  ready: boolean;
  totalMs: number;
  delay: number;
  replayKey: string | number | undefined;
  reduce: boolean;
  onEnd?: () => void;
}): EffectClock {
  const { play, ready, totalMs, delay, replayKey, reduce } = options;
  const clock = useSharedValue(0);
  const fade = useSharedValue(reduce ? 0 : 1);
  const [settled, setSettled] = useState(reduce);
  const started = useRef<{ key: string | number | undefined } | null>(null);
  const onEndRef = useRef(options.onEnd);
  onEndRef.current = options.onEnd;
  const finish = useCallback(() => {
    setSettled(true);
    onEndRef.current?.();
  }, []);
  const fireEnd = useCallback(() => onEndRef.current?.(), []);

  const keyRef = useRef(replayKey);
  useEffect(() => {
    if (keyRef.current === replayKey) return;
    keyRef.current = replayKey;
    started.current = null;
    cancelAnimation(clock);
    clock.value = 0;
    if (!reduce) setSettled(false);
  }, [replayKey, reduce, clock]);

  useEffect(() => {
    if (reduce) {
      setSettled(true);
      if (!play) return;
      if (started.current && started.current.key === replayKey) {
        fade.value = 1;
        return;
      }
      started.current = { key: replayKey };
      fade.value = 0;
      fade.value = withDelay(
        delay,
        withTiming(1, { duration: TEXT_REDUCED_FADE, easing: EASE, reduceMotion: ReduceMotion.Never }, (finished) => {
          if (finished) runOnJS(fireEnd)();
        }),
      );
      return;
    }
    fade.value = 1;
    if (!play || !ready) return;
    if (started.current && started.current.key === replayKey) return;
    started.current = { key: replayKey };
    const ms = Math.max(0, totalMs);
    clock.value = 0;
    clock.value = withDelay(
      delay,
      withTiming(ms, { duration: ms, easing: Easing.linear, reduceMotion: ReduceMotion.Never }, (finished) => {
        if (finished) runOnJS(finish)();
      }),
    );
  }, [play, ready, reduce, replayKey, totalMs, delay, clock, fade, finish, fireEnd]);

  return { clock, fade, settled };
}

// ─── the shell ────────────────────────────────────────────────────────────────────────

/**
 * The element: the settled text (hidden until the effect lands, but always there, so the
 * layout never moves), the animated overlay on top of it, and the whole thing announced once
 * as the final text.
 */
export function EffectShell({
  text,
  font,
  color,
  scaling,
  settled,
  fade,
  lines,
  overlay,
  probes,
  numberOfLines,
  style,
  accessibilityRole = 'text',
}: {
  text: string;
  font: TextStyle;
  color: string;
  scaling: TextLook['scaling'];
  settled: boolean;
  fade: SharedValue<number>;
  lines: Lines;
  overlay: ReactNode;
  /** Clear measuring texts (`useKerning`), out of the flow. */
  probes?: ReactNode;
  numberOfLines?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityRole?: 'text' | 'header';
}) {
  const whole = useAnimatedStyle(() => ({ opacity: fade.value }));
  return (
    <Animated.View accessible accessibilityRole={accessibilityRole} accessibilityLabel={text} style={[style, whole]}>
      {/* No padding here, so the overlay's origin is the text's origin. */}
      <View onLayout={lines.onLayout}>
        <Text
          {...scaling}
          numberOfLines={numberOfLines}
          onTextLayout={lines.onTextLayout}
          importantForAccessibility="no"
          style={[font, { color }, settled ? null : styles.hidden]}
        >
          {text}
        </Text>
        {settled ? null : (
          <View style={StyleSheet.absoluteFill} pointerEvents="none" importantForAccessibility="no-hide-descendants">
            {overlay}
          </View>
        )}
        {probes}
      </View>
    </Animated.View>
  );
}

/**
 * Each laid line as a row at the text system's own place, its units drawn by `renderUnit` and
 * its still spaces by `renderSpace`. `approximate` lines (web) wrap as one row instead.
 */
export function LineRows({
  lines,
  by,
  offsets,
  renderUnit,
  renderSpace,
}: {
  lines: Lines;
  by: SplitBy;
  /** From `useKerning`: each character placed at its kerned edge instead of side by side. */
  offsets?: number[][] | null;
  renderUnit: (unit: TextUnit, key: string) => ReactNode;
  renderSpace: (text: string, key: string) => ReactNode;
}) {
  const laid = lines.lines;
  const split = useMemo(() => (laid ? unitsForLines(laid, by) : null), [laid, by]);
  if (!laid || !split) return null;
  return (
    <>
      {laid.map((line, li) => {
        const units = split.lines[li] ?? [];
        const placed = !lines.approximate && by === 'chars' ? offsets?.[li] : undefined;
        if (placed) {
          // Kerned: every character absolutely at its own edge; the spaces are just gaps.
          let v = 0;
          return (
            <View key={`l${li}`} style={{ position: 'absolute', left: line.x, top: line.y }}>
              {units.map((u, ui) => {
                if (u.index < 0) return null;
                const x = placed[v++] ?? 0;
                return (
                  <View key={`u${li}.${ui}`} style={{ position: 'absolute', left: x, top: 0 }}>
                    {renderUnit(u, `u${li}.${ui}`)}
                  </View>
                );
              })}
            </View>
          );
        }
        const rowStyle: ViewStyle = lines.approximate
          ? { position: 'absolute', left: 0, top: 0, width: line.width, flexDirection: 'row', flexWrap: 'wrap' }
          : { position: 'absolute', left: line.x, top: line.y, flexDirection: 'row' };
        return (
          <View key={`l${li}`} style={rowStyle}>
            {units.map((u, ui) => (u.index < 0 ? renderSpace(u.text, `s${li}.${ui}`) : renderUnit(u, `u${li}.${ui}`)))}
          </View>
        );
      })}
    </>
  );
}

/** How many units the laid lines animate (0 before layout). */
export function useUnitCount(lines: Lines, by: SplitBy): number {
  const laid = lines.lines;
  return useMemo(() => (laid ? unitsForLines(laid, by).count : 0), [laid, by]);
}

const styles = StyleSheet.create({
  hidden: { opacity: 0 },
  // Wide enough that no probe wraps; out of the flow and clear.
  probes: { position: 'absolute', left: 0, top: 0, width: 4096, alignItems: 'flex-start', opacity: 0 },
  probeText: { textAlign: 'left' },
});
