/**
 * The arithmetic of LogoLoop, apart from the component so `bun test` can hold it: how many
 * copies of the row fill the strip, where the track sits after it has travelled, the
 * original's eased velocity, and the rounding that keeps pixel glyphs on whole device pixels.
 *
 * Ported from react-bits `Animations/LogoLoop/LogoLoop.tsx` by David Haz.
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
 * What changed in the port: the numbers are the original's (`SMOOTH_TAU` 0.25s, at least two
 * copies plus two of headroom, the offset wrapped into one row's length), run on the UI
 * thread from a Reanimated frame callback instead of `requestAnimationFrame` writing
 * `style.transform`. The track's position is rounded to whole device pixels, because the
 * glyphs are pixel art and a pixel glyph at a fractional position is resampled and shimmers.
 * The edge fade (two linear gradients) is gone: the strip clips, as the kit's Counter does.
 */

export type LoopDirection = 'left' | 'right';

/** The original: at least `min` copies, or enough to cover the strip plus `headroom` more. */
export function copiesNeeded(container: number, sequence: number, min = 2, headroom = 2): number {
  if (!(sequence > 0) || !(container > 0)) return min;
  return Math.max(min, Math.ceil(container / sequence) + headroom);
}

/** The original's target velocity in points a second: positive moves the track left. */
export function loopVelocity(speed: number, direction: LoopDirection): number {
  return Math.abs(speed) * (direction === 'left' ? 1 : -1) * (speed < 0 ? -1 : 1);
}

/** The track's offset folded into one row's length, so it never grows without bound. */
export function wrapOffset(offset: number, sequence: number): number {
  'worklet';
  if (!(sequence > 0)) return 0;
  return ((offset % sequence) + sequence) % sequence;
}

/**
 * The original's velocity easing: each frame the velocity closes `1 - exp(-dt / tau)` of the
 * gap to its target, so a touch slows the row to a stop over about a second and letting go
 * brings it back the same way, whatever the frame rate.
 */
export function easeVelocity(velocity: number, target: number, dtSec: number, tau: number): number {
  'worklet';
  if (!(tau > 0)) return target;
  const k = 1 - Math.exp(-Math.max(0, dtSec) / tau);
  return velocity + (target - velocity) * k;
}

/** One frame of the loop: the eased velocity and the wrapped offset after `dtSec`. */
export function stepLoop(offset: number, velocity: number, target: number, dtSec: number, tau: number, sequence: number): [number, number] {
  'worklet';
  const v = easeVelocity(velocity, target, dtSec, tau);
  return [wrapOffset(offset + v * Math.max(0, dtSec), sequence), v];
}

/** `x` points rounded to the nearest whole device pixel at `ratio` pixels a point. */
export function snapToPixel(x: number, ratio: number): number {
  'worklet';
  if (!(ratio > 0)) return x;
  return Math.round(x * ratio) / ratio;
}
