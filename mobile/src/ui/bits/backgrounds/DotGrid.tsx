/**
 * DotGrid: react-bits' grid of dots that a tap shoves outward and that spring back, on the cell
 * grid: 3 pt dots every 12 pt in a warm grey, lighting to the partner and ink of one hue near the
 * finger and while a shock passes. The codebase map's ground (DESIGN-V2 4.5, deferred there,
 * built here). Still until touched: it draws nothing between touches.
 *
 *   <DotGrid width={w} height={h} hue={creatureHue(crew)} />
 *
 * Props: every `BackgroundProps` (spec.ts: width, height, hue, ink, partner, paper, levels,
 * speed, scale, cell, fps, seed, paused, develop, reveal, edgeFade, clear, resolution, style,
 * accessibilityLabel; `speed`, `scale` and `seed` have nothing to move: the dots only answer a
 * finger), plus
 *   pitch          cells from one dot to the next: 4 (12 pt)
 *   dot            a dot's side in cells: 1
 *   base           the resting dots' colour: the scheme's `border`
 *   proximity      points around the finger where dots light: 90 (react-bits 150 px)
 *   reach          points a tap's shock reaches: 150 (react-bits `shockRadius 250`)
 *   push           the farthest a dot moves, in cells: 3
 *   interactive    taps shock the grid, a quick drag leaves a wake, the finger lights the dots
 *                  near it; never steals a scroll. Default true
 *   onTap          where a tap landed, points
 * Motion: react-bits' inertia rise (0.3 s here) then `elastic.out(1, 0.75)` over 1.5 s, up to 4
 * shocks at once. Reduce Motion: the grid at rest, nothing moves.
 *
 * Ported from react-bits `Backgrounds/DotGrid/DotGrid.tsx` by David Haz.
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
 * What changed in the port: a 2D canvas redrawn every frame with a GSAP inertia tween per dot
 * becomes one stateless SkSL program (a dot's place is a function of the shocks and the time)
 * that draws only while something moves; dots are squares on the cell grid and move by whole
 * cells; the colour lerp between two hues becomes each dot's own Bayer step into partner and ink.
 * The shader and the push's shape are in `shaders.ts`.
 */
import type { Uniforms } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { runOnJS, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';

import { timing } from '../../motion';
import { useColors } from '../../scheme';
import { FieldSurface, useBackgroundBase } from './FieldSurface';
import { TAP_SLOP } from './fingers';
import { DOT_GRID, dotGridUniforms, frameUniforms, NO_TAP, pushTap, type BackgroundProps, type FieldPoint, type Vec } from './spec';

export interface DotGridProps extends BackgroundProps {
  pitch?: number;
  dot?: number;
  base?: string;
  proximity?: number;
  reach?: number;
  push?: number;
  interactive?: boolean;
  onTap?: (point: FieldPoint) => void;
}

/** A shock's whole life: the inertia's rise and the elastic return. */
const SHOCK_LIFE_S = DOT_GRID.rise + DOT_GRID.settle;
/** A press shorter than this that moved less than TAP_SLOP is a tap. */
const TAP_MAX_S = 0.35;

export function DotGrid(props: DotGridProps) {
  const c = useColors();
  const base = useBackgroundBase('DotGrid', props, { interactive: props.interactive !== false });
  const { clock, reveal, common, cell } = base;
  const live = props.interactive !== false && !base.still;
  const { width, height, pitch, dot, proximity, reach, push, onTap } = props;
  const baseColor = props.base ?? c.border;
  const own = useMemo(
    () => dotGridUniforms({ width, height, cell, base: baseColor, pitch, dot, proximity, reach, push }),
    [width, height, cell, baseColor, pitch, dot, proximity, reach, push],
  );

  const shocks = useSharedValue<Vec[]>([NO_TAP, NO_TAP, NO_TAP, NO_TAP]);
  const next = useSharedValue(0);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const tk = useSharedValue(0);
  const down = useSharedValue([0, 0, 0] as Vec);
  const last = useSharedValue([0, 0, 0] as Vec);
  const lastShove = useSharedValue(-1);
  const { realMs, until } = clock;

  const gesture = useMemo(() => {
    const easeIn = timing(DOT_GRID.touchInMs);
    const easeOut = timing(DOT_GRID.touchOutMs);
    return Gesture.Manual()
      .enabled(live)
      .onTouchesDown((e) => {
        'worklet';
        const p = e.allTouches[0];
        if (!p) return;
        const now = realMs.value / 1000;
        down.value = [p.x, p.y, now];
        last.value = [p.x, p.y, now];
        tx.value = p.x;
        ty.value = p.y;
        tk.value = withTiming(1, easeIn);
      })
      .onTouchesMove((e) => {
        'worklet';
        const p = e.allTouches[0];
        if (!p) return;
        const now = realMs.value / 1000;
        const [lx, ly, lt] = last.value as [number, number, number];
        const speed = Math.hypot(p.x - lx, p.y - ly) / Math.max(now - lt, 1 / 120);
        tx.value = p.x;
        ty.value = p.y;
        last.value = [p.x, p.y, now];
        if (speed > DOT_GRID.speedTrigger && now - lastShove.value >= DOT_GRID.dragEveryS) {
          const r = pushTap(shocks.value, next.value, p.x, p.y, now, DOT_GRID.dragStrength);
          shocks.value = r.taps;
          next.value = r.next;
          lastShove.value = now;
          until.value = Math.max(until.value, now + SHOCK_LIFE_S);
        }
      })
      .onTouchesUp((e) => {
        'worklet';
        tk.value = withTiming(0, easeOut);
        const p = e.changedTouches[0];
        if (!p) return;
        const now = realMs.value / 1000;
        const [dx, dy, dt] = down.value as [number, number, number];
        if (Math.hypot(p.x - dx, p.y - dy) > TAP_SLOP || now - dt > TAP_MAX_S) return;
        const r = pushTap(shocks.value, next.value, p.x, p.y, now, 1);
        shocks.value = r.taps;
        next.value = r.next;
        until.value = Math.max(until.value, now + SHOCK_LIFE_S);
        if (onTap) runOnJS(onTap)({ x: p.x, y: p.y });
      })
      .onTouchesCancelled(() => {
        'worklet';
        tk.value = withTiming(0, easeOut);
      });
  }, [live, onTap, realMs, until, shocks, next, tx, ty, tk, down, last, lastShove]);

  const fixed = useMemo(() => ({ ...common, ...own }), [common, own]);
  const uniforms = useDerivedValue<Uniforms>(() =>
    frameUniforms('DotGrid', fixed, {
      t: 0,
      now: clock.now.value,
      reveal: reveal.value,
      taps: shocks.value,
      touch: [tx.value, ty.value, tk.value],
    }),
  );
  return <FieldSurface base={base} uniforms={uniforms} gesture={live ? gesture : undefined} />;
}
