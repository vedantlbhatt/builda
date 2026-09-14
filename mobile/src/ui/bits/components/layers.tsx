/**
 * The Skia layers the ported components draw with: the PixelCard fill, the spotlight pool, the
 * dithered scroll edge and ProfileCard's slow field. Each is one Canvas with one runtime shader
 * whose uniforms are a derived value, so it redraws only when a shared value it reads changes
 * (a finger moving, a fill running, the field's 20 fps tick) and costs nothing at rest.
 *
 * Ported from react-bits `Components/PixelCard`, `Components/SpotlightCard`,
 * `Components/AnimatedList` and `Backgrounds/Dither` by David Haz.
 * react-bits is MIT + Commons Clause (Copyright (c) 2026 David Haz): the notice is kept here
 * as the licence asks, and the ports are used as part of this application only; they are not
 * to be redistributed as components.
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
 * What changed in the port: the shader sources and the reasons are in `fills.ts`. The layers
 * here only place them: points, not pixels (the canvas works in points, so a 3pt cell lands on
 * whole device pixels at @2x and @3x), shaders compiled on first use rather than at import, and
 * an empty box if a shader ever fails to compile, so a missing effect never takes a screen down.
 */
import { Canvas, Rect, Shader, Skia, type SkRuntimeEffect } from '@shopify/react-native-skia';
import React, { useEffect, useMemo, useState } from 'react';
import { AppState, View, type StyleProp, type ViewStyle } from 'react-native';
import { useDerivedValue, useFrameCallback, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { tokens } from '../../../generated/tokens';
import type { Hue } from '../../../theme';
import { premultiplied } from '../../dithering';
import { useReduceMotion } from '../../motion';
import { EDGE_SKSL, FIELD_SKSL, FIELD_WAVE, PIXEL_FILL_SKSL, SPOTLIGHT_SKSL } from './fills';
import { AMBIENT, PIXEL, SPOT } from './spec';

type Source = 'fill' | 'spot' | 'edge' | 'field';

const SOURCES: Record<Source, string> = {
  fill: PIXEL_FILL_SKSL,
  spot: SPOTLIGHT_SKSL,
  edge: EDGE_SKSL,
  field: FIELD_SKSL,
};

const compiled: Partial<Record<Source, SkRuntimeEffect | null>> = {};

/** Compiled on first use, not at import: a screen that never lights a tile pays nothing. */
function effectFor(name: Source): SkRuntimeEffect | null {
  if (!(name in compiled)) {
    const e = Skia.RuntimeEffect.Make(SOURCES[name]);
    if (!e && __DEV__) console.warn(`[ui/bits] the ${name} shader did not compile; that layer draws nothing`);
    compiled[name] = e;
  }
  return compiled[name] ?? null;
}

const CELL = tokens.dither.cell;

/** A value a layer only reads: a shared value or a derived one. */
type Read = Readonly<SharedValue<number>>;

/** A layer is decoration: VoiceOver never lands on it and it never takes a touch. */
function Box({ width, height, style, children }: { width: number; height: number; style?: StyleProp<ViewStyle>; children?: React.ReactNode }) {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ position: 'absolute', left: 0, top: 0, width, height }, style]}
    >
      {children}
    </View>
  );
}

// ─── PixelCard's fill ───────────────────────────────────────────────────────────────────

export interface PixelFillLayerProps {
  width: number;
  height: number;
  /** The solid colour the cells grow into: the hue's fill. */
  ink: string;
  progress: Read;
  originX: Read;
  originY: Read;
  style?: StyleProp<ViewStyle>;
}

export function PixelFillLayer({ width, height, ink, progress, originX, originY, style }: PixelFillLayerProps) {
  const source = effectFor('fill');
  const inkU = useMemo(() => premultiplied(ink), [ink]);
  const uniforms = useDerivedValue(() => {
    const ox = originX.value;
    const oy = originY.value;
    // The farthest corner: the front has reached every cell by progress 1 (`fillSpan`).
    const span = Math.max(Math.hypot(ox, oy), Math.hypot(width - ox, oy), Math.hypot(ox, height - oy), Math.hypot(width - ox, height - oy));
    return {
      cell: PIXEL.cell,
      origin: [ox, oy],
      span,
      jitter: PIXEL.jitter,
      grow: PIXEL.grow,
      progress: progress.value,
      ink: inkU,
    };
  });
  if (!source || width <= 0 || height <= 0) return null;
  return (
    <Box width={width} height={height} style={style}>
      <Canvas style={{ width, height }}>
        <Rect x={0} y={0} width={width} height={height}>
          <Shader source={source} uniforms={uniforms} />
        </Rect>
      </Canvas>
    </Box>
  );
}

// ─── the spotlight ──────────────────────────────────────────────────────────────────────

export interface SpotlightLayerProps {
  width: number;
  height: number;
  hue: Hue;
  originX: Read;
  originY: Read;
  /** 0 is off (the shader returns at once); up to about 0.5 is partner only. */
  strength: Read;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

export function SpotlightLayer({ width, height, hue, originX, originY, strength, radius = SPOT.radius, style }: SpotlightLayerProps) {
  const source = effectFor('spot');
  const inkU = useMemo(() => premultiplied(hue.ink), [hue.ink]);
  const partnerU = useMemo(() => premultiplied(hue.partner), [hue.partner]);
  const uniforms = useDerivedValue(() => ({
    cell: CELL,
    origin: [originX.value, originY.value],
    radius,
    strength: strength.value,
    ink: inkU,
    partner: partnerU,
  }));
  if (!source || width <= 0 || height <= 0) return null;
  return (
    <Box width={width} height={height} style={style}>
      <Canvas style={{ width, height }}>
        <Rect x={0} y={0} width={width} height={height}>
          <Shader source={source} uniforms={uniforms} />
        </Rect>
      </Canvas>
    </Box>
  );
}

// ─── the scroll edge ────────────────────────────────────────────────────────────────────

export interface EdgeDitherProps {
  width: number;
  height: number;
  /** The surface the rows dissolve into: the list's own background. */
  color: string;
  strength: Read;
  fromBottom: boolean;
  style?: StyleProp<ViewStyle>;
}

export function EdgeDither({ width, height, color, strength, fromBottom, style }: EdgeDitherProps) {
  const source = effectFor('edge');
  const inkU = useMemo(() => premultiplied(color), [color]);
  const rows = Math.max(1, Math.ceil(height / CELL));
  const uniforms = useDerivedValue(() => ({
    cell: CELL,
    rows,
    strength: strength.value,
    fromBottom: fromBottom ? 1 : 0,
    ink: inkU,
  }));
  if (!source || width <= 0 || height <= 0) return null;
  return (
    <Box width={width} height={height} style={style}>
      <Canvas style={{ width, height }}>
        <Rect x={0} y={0} width={width} height={height}>
          <Shader source={source} uniforms={uniforms} />
        </Rect>
      </Canvas>
    </Box>
  );
}

// ─── the slow field ─────────────────────────────────────────────────────────────────────

/**
 * The field's clock: seconds times react-bits' wave speed times `AMBIENT.speed`, ticking at
 * 20 fps, and only while `active`, the app is in the foreground and Reduce Motion is off.
 * Paused means the frame callback is off, not that it draws the same frame again.
 */
export function useAmbientClock(active: boolean, start: number = 0): SharedValue<number> {
  const reduce = useReduceMotion();
  const t = useSharedValue(start);
  const acc = useSharedValue(0);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setForeground(s === 'active'));
    return () => sub.remove();
  }, []);
  const step = 1000 / AMBIENT.fps;
  const rate = (FIELD_WAVE.speed * AMBIENT.speed) / 1000;
  const frame = useFrameCallback((info) => {
    'worklet';
    // A long gap (the callback just resumed) is one tick, not a jump across the field.
    const dt = Math.min(info.timeSincePreviousFrame ?? 0, step * 2);
    acc.value += dt;
    if (acc.value >= step) {
      acc.value -= step;
      t.value += step * rate;
    }
  }, false);
  const running = active && foreground && !reduce;
  useEffect(() => {
    frame.setActive(running);
    return () => frame.setActive(false);
  }, [frame, running]);
  return t;
}

export interface HueFieldProps {
  width: number;
  height: number;
  hue: Hue;
  t: Read;
  /** Paper here: the creature's box plus one cell (`clearBoxFor`). */
  clearBox?: readonly [number, number, number, number];
  /** How much of the field reaches ink before the dither. */
  density: number;
  style?: StyleProp<ViewStyle>;
}

export function HueField({ width, height, hue, t, clearBox, density, style }: HueFieldProps) {
  const source = effectFor('field');
  const inkU = useMemo(() => premultiplied(hue.ink), [hue.ink]);
  const partnerU = useMemo(() => premultiplied(hue.partner), [hue.partner]);
  const [bx, by, bw, bh] = clearBox ?? [0, 0, 0, 0];
  const box = useMemo(() => [bx, by, bw, bh], [bx, by, bw, bh]);
  const uniforms = useDerivedValue(() => ({
    cell: CELL,
    size: [Math.max(1, width), Math.max(1, height)],
    t: t.value,
    frequency: FIELD_WAVE.frequency,
    amplitude: FIELD_WAVE.amplitude,
    density,
    clearBox: box,
    ink: inkU,
    partner: partnerU,
  }));
  if (!source || width <= 0 || height <= 0) return null;
  return (
    <Box width={width} height={height} style={style}>
      <Canvas style={{ width, height }}>
        <Rect x={0} y={0} width={width} height={height}>
          <Shader source={source} uniforms={uniforms} />
        </Rect>
      </Canvas>
    </Box>
  );
}
