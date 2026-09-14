/**
 * The arithmetic every text effect runs per frame, as worklets that are also plain functions:
 * the UI thread calls them inside `useAnimatedStyle`, and `bun test` calls them directly.
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
 * What changed in the ports: GSAP's `power3.out` and motion's defaults become the kit's one
 * curve, `EASE` = bezier(0.23, 1, 0.32, 1), evaluated here rather than through Reanimated's
 * `Easing.bezier` (a factory object, which a worklet cannot call per unit).
 */
import { EASE_BEZIER } from '../../motionSpec';

const X1 = EASE_BEZIER[0];
const Y1 = EASE_BEZIER[1];
const X2 = EASE_BEZIER[2];
const Y2 = EASE_BEZIER[3];

export function clamp01(v: number): number {
  'worklet';
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  'worklet';
  return a + (b - a) * t;
}

/**
 * A cubic bezier timing curve at `x` (CSS `cubic-bezier`): Newton's method on the x
 * polynomial, bisection if Newton wanders, then the y polynomial at that parameter.
 */
export function bezierAt(x: number, x1: number, y1: number, x2: number, y2: number): number {
  'worklet';
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  let u = x;
  for (let i = 0; i < 8; i++) {
    const err = ((ax * u + bx) * u + cx) * u - x;
    if (Math.abs(err) < 1e-7) break;
    const slope = (3 * ax * u + 2 * bx) * u + cx;
    if (Math.abs(slope) < 1e-7) break;
    u -= err / slope;
  }
  if (!(u >= 0 && u <= 1) || Math.abs(((ax * u + bx) * u + cx) * u - x) > 1e-5) {
    let lo = 0;
    let hi = 1;
    u = x;
    for (let i = 0; i < 40; i++) {
      const at = ((ax * u + bx) * u + cx) * u;
      if (Math.abs(at - x) < 1e-7) break;
      if (at < x) lo = u;
      else hi = u;
      u = (lo + hi) / 2;
    }
  }
  return ((ay * u + by) * u + cy) * u;
}

/** `EASE`, the kit's one curve: strong ease out. */
export function ease(t: number): number {
  'worklet';
  return bezierAt(t, X1, Y1, X2, Y2);
}

/** 0 before `start`, 1 after `start + duration`, linear between. A zero duration is a step. */
export function localProgress(clock: number, start: number, duration: number): number {
  'worklet';
  if (duration <= 0) return clock >= start ? 1 : 0;
  return clamp01((clock - start) / duration);
}

/**
 * A value through evenly spaced keyframes at progress `p` (motion's `times` when react-bits
 * leaves them even): [0, 0.5, 1] at 0.25 is 0.25. One value is a constant.
 */
export function keyframeAt(values: readonly number[], p: number): number {
  'worklet';
  const n = values.length;
  if (n === 0) return 0;
  if (n === 1) return values[0] as number;
  const t = clamp01(p) * (n - 1);
  const i = Math.min(n - 2, Math.floor(t));
  return lerp(values[i] as number, values[i + 1] as number, t - i);
}
