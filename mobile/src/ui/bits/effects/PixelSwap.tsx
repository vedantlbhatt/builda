/**
 * PixelSwap: one Skia picture turns into another cell by cell, each cell's window growing
 * from a third of the cell to the whole, in a spiral (DESIGN-V2 3.1, the archetype reveal:
 * the field turns into the creature; a long press replays it).
 *
 *   <PixelSwap
 *     width={w} height={h} active={revealed} replayKey={replays}
 *     first={<Shader source={field} uniforms={u} />}
 *     second={<ImageShader image={creature} fit="contain" rect={{ x: 0, y: 0, width: w, height: h }} />}
 *   />
 *
 * Both pictures are Skia shader elements (an `ImageShader`, a `Shader`, a `ColorShader`),
 * evaluated in the canvas's points.
 *
 * Ported from react-bits `Animations/PixelSwap/PixelSwap.tsx` by David Haz.
 * react-bits is MIT + Commons Clause (Copyright (c) 2026 David Haz): the notice is kept
 * here as the licence asks, and the port is used as part of this application only; it is
 * not to be redistributed as a component.
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
 * What changed in the port: a grid of up to 220 DOM windows, each holding a clone of the
 * incoming content, becomes one runtime shader (`SWAP_SKSL` in `swap.ts`) that decides every
 * pixel from its cell's rank, so the grid costs nothing per cell (the cap is 256, one cell per
 * pixel of a creature, not the original's 220). The original's controlled
 * `active`, its queue (a change during a swap waits for the swap to finish, so a cell never
 * jumps back), its nine patterns, `randomness`, `fade` and the 0.35 start scale are kept; the
 * timing is v2's `SWAP` (900ms, 240ms a cell, react-bits 1400 and 450) on the kit's `EASE`.
 *
 * Reduce Motion: the swap is a cut to the new picture, and a replay shows its still.
 */
import { Canvas, Fill, Shader, Skia, type SkRuntimeEffect } from '@shopify/react-native-skia';
import React, { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Easing, ReduceMotion, runOnJS, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';

import { useReduceMotion } from '../../motion';
import { EASE_BEZIER } from '../../motionSpec';
import { EFFECTS } from './spec';
import { SWAP_SKSL, patternUniform, swapGrid, swapTimes, type SwapPattern } from './swap';

const W = EFFECTS.swap;

// Compiled on first use, not at import.
let effect: SkRuntimeEffect | null | undefined;
function swapEffect(): SkRuntimeEffect | null {
  if (effect === undefined) {
    effect = Skia.RuntimeEffect.Make(SWAP_SKSL);
    if (!effect && __DEV__) console.warn('[bits/PixelSwap] SWAP_SKSL did not compile; the swap is a cut');
  }
  return effect;
}

export interface PixelSwapProps {
  width: number;
  height: number;
  /** The picture shown while `active` is false: a Skia shader element. */
  first: ReactNode;
  /** The picture shown while `active` is true. */
  second: ReactNode;
  /** Controlled: which picture shows. Changing it swaps. */
  active?: boolean;
  /** Uncontrolled start. Default false. */
  initialActive?: boolean;
  /** Changing this plays first to second again from the start (a replay). */
  replayKey?: number | string;
  /** The order cells turn in. Default `spiral`. */
  pattern?: SwapPattern;
  /** 0 is the pure pattern, 1 pure chance. Default 0. */
  randomness?: number;
  /** Cell side in points before the grid's caps. Default 12. */
  cell?: number;
  /** More cells than this and they grow until they fit. Default 256 (a creature, pixel for pixel). */
  maxCells?: number;
  /** The whole swap, in ms. Default 900. */
  totalMs?: number;
  /** One cell, in ms. Default 240. */
  cellMs?: number;
  /** A cell's window starts at this share of the cell. Default 0.35. */
  startScale?: number;
  /** The incoming picture fades up in its window (done in the first 60ms of the cell). Default true. */
  fade?: boolean;
  onComplete?: (active: boolean) => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function PixelSwap({
  width,
  height,
  first,
  second,
  active,
  initialActive = false,
  replayKey,
  pattern = 'spiral',
  randomness = 0,
  cell = W.cellPt,
  maxCells = W.maxCells,
  totalMs = W.totalMs,
  cellMs = W.cellMs,
  startScale = W.startScale,
  fade = true,
  onComplete,
  accessibilityLabel,
  style,
}: PixelSwapProps) {
  const reduced = useReduceMotion();
  const source = swapEffect();
  const grid = swapGrid(width, height, cell, maxCells);
  const times = swapTimes(totalMs, cellMs);

  const desired = active ?? initialActive;
  // What the canvas shows when no swap is running.
  const [shown, setShown] = useState(desired);
  const running = useRef(false);
  const t = useSharedValue(times.total);
  const forward = useSharedValue(desired ? 1 : 0);

  const finish = useCallback(
    (to: boolean) => {
      running.current = false;
      setShown(to);
      onComplete?.(to);
    },
    [onComplete],
  );

  const start = useCallback(
    (to: boolean) => {
      forward.value = to ? 1 : 0;
      if (reduced || !source) {
        t.value = times.total;
        finish(to);
        return;
      }
      running.current = true;
      // At t 0 every cell shows the outgoing picture: the one on screen, or `first` on a replay.
      t.value = 0;
      // Linear: each cell eases itself inside the shader.
      t.value = withTiming(times.total, { duration: times.total, easing: Easing.linear, reduceMotion: ReduceMotion.Never }, (done) => {
        if (done) runOnJS(finish)(to);
      });
    },
    [finish, forward, reduced, source, t, times.total],
  );

  // A change of `active` swaps; one during a swap waits for it (the original's queue).
  useEffect(() => {
    if (running.current || desired === shown) return;
    start(desired);
  }, [desired, shown, start]);

  const mountedReplay = useRef(replayKey);
  useEffect(() => {
    if (replayKey === undefined || replayKey === mountedReplay.current) return;
    mountedReplay.current = replayKey;
    if (running.current) return;
    start(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayKey]);

  const patternU = patternUniform(pattern);
  const uniforms = useDerivedValue(() => ({
    cell: grid.size,
    grid: [grid.cols, grid.rows],
    pattern: patternU,
    randomness,
    t: t.value,
    total: times.total,
    cellMs: times.cell,
    startScale,
    fade: fade ? 1 : 0,
    forward: forward.value,
    curve: [EASE_BEZIER[0], EASE_BEZIER[1], EASE_BEZIER[2], EASE_BEZIER[3]],
  }));

  const decorative = accessibilityLabel === undefined;
  return (
    <View
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : 'image'}
      accessibilityLabel={accessibilityLabel}
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'auto'}
      style={[{ width, height }, style]}
    >
      <Canvas style={{ width, height }}>
        {source ? (
          <Fill>
            <Shader source={source} uniforms={uniforms}>
              {first}
              {second}
            </Shader>
          </Fill>
        ) : (
          <Fill>{shown ? second : first}</Fill>
        )}
      </Canvas>
    </View>
  );
}
