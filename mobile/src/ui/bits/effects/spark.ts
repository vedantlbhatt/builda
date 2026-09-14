/**
 * The arithmetic of ClickSpark, apart from the component so `bun test` can hold it. Every
 * function that the burst calls per frame is a worklet: it runs on the UI thread inside a
 * Reanimated derived value and allocates nothing but its result.
 *
 * Ported from react-bits `Animations/ClickSpark/ClickSpark.tsx` by David Haz.
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
 * What changed in the port: the geometry is the original's, line for line (spark `i` of
 * `n` leaves at angle `2 pi i / n`; at eased progress `e` it is the segment from
 * `e * radius * extraScale` to that plus `size * (1 - e)` along its ray). The numbers are the
 * phone's (see `spec.ts`), the easing is the kit's `EASE` applied by the caller, and a second
 * shape, `pixel`, draws each spark as a square of the grain that shrinks as it flies.
 */

export interface SparkShape {
  /** Sparks in the burst. react-bits 8. */
  count: number;
  /** Stroke of a ray, or the side of a pixel spark at launch, in points. */
  sizePt: number;
  /** A ray's length at launch, in points. It shrinks to nothing as it flies. */
  lengthPt: number;
  /** How far a spark travels, in points. */
  radiusPt: number;
  /** react-bits `extraScale`: multiplies the travel. Default 1. */
  extraScale?: number;
}

export type SparkVariant = 'ray' | 'pixel';

/** Spark `i` of `count` leaves at this angle, in radians: evenly round, the first pointing right. */
export function sparkAngle(i: number, count: number): number {
  'worklet';
  return count > 0 ? (2 * Math.PI * i) / count : 0;
}

/**
 * Spark `i`'s segment at eased progress `e` (0 launch, 1 gone), relative to the burst's
 * origin: `[x1, y1, x2, y2]`. The original's rule: the near end has flown `e * radius`, and the
 * segment is `length * (1 - e)` long, so it thins to a point exactly as it arrives.
 */
export function sparkSegment(i: number, e: number, shape: SparkShape): [number, number, number, number] {
  'worklet';
  const a = sparkAngle(i, shape.count);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const distance = e * shape.radiusPt * (shape.extraScale ?? 1);
  const length = shape.lengthPt * (1 - e);
  return [distance * cos, distance * sin, (distance + length) * cos, (distance + length) * sin];
}

/**
 * A pixel spark at eased progress `e`: its centre relative to the origin and its side. It
 * flies the same ray and shrinks from `sizePt` to nothing, so a spark leaves by its cells
 * getting smaller, never by fading (a hue at partial opacity over the warm ground is brown).
 */
export function sparkPixel(i: number, e: number, shape: SparkShape): [number, number, number] {
  'worklet';
  const a = sparkAngle(i, shape.count);
  const distance = e * shape.radiusPt * (shape.extraScale ?? 1) + shape.sizePt / 2;
  return [distance * Math.cos(a), distance * Math.sin(a), shape.sizePt * (1 - e)];
}

/**
 * How far past its origin any part of a burst can reach, in points: the margin the overlay
 * canvas needs on every side so no spark is clipped by it.
 */
export function sparkReach(shape: SparkShape): number {
  return Math.ceil(shape.radiusPt * (shape.extraScale ?? 1) + shape.lengthPt + shape.sizePt);
}

/** Whether a burst at eased progress `e` has anything to draw. */
export function sparkVisible(e: number): boolean {
  'worklet';
  return e > 0 && e < 1;
}

/**
 * A finger that went down at one point and came up at another was a press only if it stayed
 * within `slop` points and was not cancelled. A drag or a scroll that started on the element
 * does not spark.
 */
export function isTap(downX: number, downY: number, upX: number, upY: number, slop: number): boolean {
  'worklet';
  const dx = upX - downX;
  const dy = upY - downY;
  return dx * dx + dy * dy <= slop * slop;
}

/** Whether a point is inside a `width` by `height` box, grown by `grow` points on every side. */
export function inBox(x: number, y: number, width: number, height: number, grow = 0): boolean {
  'worklet';
  return x >= -grow && y >= -grow && x <= width + grow && y <= height + grow;
}

/**
 * The original's four easings, kept so a caller can match a react-bits demo exactly. The kit
 * default is `EASE` (a stronger ease out), which the component passes to Reanimated instead.
 */
export type SparkEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

export function sparkEase(easing: SparkEasing, t: number): number {
  'worklet';
  switch (easing) {
    case 'linear':
      return t;
    case 'ease-in':
      return t * t;
    case 'ease-in-out':
      return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    default:
      return t * (2 - t);
  }
}
