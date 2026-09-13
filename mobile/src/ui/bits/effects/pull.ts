/**
 * The arithmetic of Magnet, apart from the component so `bun test` can hold it.
 *
 * Ported from react-bits `Animations/Magnet/Magnet.tsx` by David Haz.
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
 * What changed in the port: the original follows a hovering mouse anywhere within
 * `padding` of the element and moves it by `(pointer - centre) / magnetStrength`. A phone has
 * no hover, so the pull is the finger that is already down on the element, and the same rule
 * applies while it stays within `padding`; outside, the element lets go, as in the original.
 * The original's pull is unbounded (half the distance to the pointer); here it is soft
 * clamped with `tanh` so it eases into `maxPt` and never passes it: a primary button that
 * wanders from under a thumb reads as broken, one that leans toward it reads as alive.
 */

export interface MagnetOptions {
  /** How far outside the element the pull still holds, in points. react-bits 100px. */
  padding: number;
  /** react-bits `magnetStrength`: the offset is the distance divided by this. */
  strength: number;
  /** The most the element ever moves on either axis, in points. */
  maxPt: number;
}

export interface MagnetPull {
  x: number;
  y: number;
  /** The finger is inside the zone: the element follows it. Outside: it goes home. */
  active: boolean;
}

/**
 * A value that tracks `v` for small values and eases into `limit` for large ones, never
 * reaching it: `limit * tanh(v / limit)`. Its slope at 0 is 1, so a small pull is the
 * original's, untouched.
 */
export function softClamp(v: number, limit: number): number {
  'worklet';
  if (limit <= 0) return 0;
  return limit * Math.tanh(v / limit);
}

/**
 * Where the element leans for a finger at (`x`, `y`) in its own coordinates, for an element
 * `width` by `height`.
 */
export function magnetOffset(x: number, y: number, width: number, height: number, options: MagnetOptions): MagnetPull {
  'worklet';
  const dx = x - width / 2;
  const dy = y - height / 2;
  if (Math.abs(dx) >= width / 2 + options.padding || Math.abs(dy) >= height / 2 + options.padding) {
    return { x: 0, y: 0, active: false };
  }
  const k = options.strength > 0 ? options.strength : 1;
  return { x: softClamp(dx / k, options.maxPt), y: softClamp(dy / k, options.maxPt), active: true };
}
