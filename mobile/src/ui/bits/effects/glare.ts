/**
 * The geometry of GlareHover's sheen, apart from the component so `bun test` can hold it:
 * which way the band travels for an angle, where it starts and stops so it is wholly off the
 * card at both ends, and the three flat stripes it is made of.
 *
 * Ported from react-bits `Animations/GlareHover/GlareHover.tsx` (and its CSS) by David Haz.
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
 * What changed in the port: the original is a `linear-gradient(-45deg, ...)` background
 * whose position moves from -100% -100% to 100% 100% on hover. Here the band is three flat
 * stripes (a gradient sheen is banned in this app), 24pt wide in all, moved across the card
 * once on press in. The angle keeps the CSS meaning: the gradient line points at `angle`
 * (0 is up, 90 is right), its stripes lie across that line, and the band travels the other
 * way along it, so -45 runs "/" stripes from the top left corner to the bottom right.
 */

export interface GlareStripe {
  /** Offset of the stripe's centre from the band's centre, along the travel, in points. */
  offset: number;
  width: number;
  /** The glare colour's opacity for this stripe. Flat: one value per stripe. */
  opacity: number;
}

export interface GlareGeometry {
  /** The unit vector the band travels along. */
  u: readonly [number, number];
  /** The unit vector along the stripes. */
  v: readonly [number, number];
  /** Rotation to give a vertical bar (width across, length down) so its width lies along `u`. */
  rotateDeg: number;
  /** Travel positions (along `u`, from the card's top left corner) at which the band is wholly off the card. */
  from: number;
  to: number;
  /** Where the band's centre sits across the travel, along `v`. */
  across: number;
  /** The band's length along its stripes: covers the card at every position. */
  length: number;
  bandWidth: number;
  stripes: readonly GlareStripe[];
}

/** The CSS gradient direction for `angleDeg`, in screen coordinates (y down). */
export function gradientDirection(angleDeg: number): [number, number] {
  const a = (angleDeg * Math.PI) / 180;
  return [Math.sin(a), -Math.cos(a)];
}

/**
 * Everything the sheen needs to cross a `width` by `height` card at `angleDeg` with a band
 * `bandPt` wide made of one stripe per entry of `steps`.
 */
export function glareGeometry(width: number, height: number, angleDeg: number, bandPt: number, steps: readonly number[]): GlareGeometry {
  const d = gradientDirection(angleDeg);
  const u: [number, number] = [clean(-d[0]), clean(-d[1])];
  const v: [number, number] = [clean(-u[1]), clean(u[0])];
  const corners: [number, number][] = [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ];
  const along = corners.map(([x, y]) => x * u[0] + y * u[1]);
  const acrossAll = corners.map(([x, y]) => x * v[0] + y * v[1]);
  const sMin = Math.min(...along);
  const sMax = Math.max(...along);
  const vMin = Math.min(...acrossAll);
  const vMax = Math.max(...acrossAll);
  const n = Math.max(1, steps.length);
  const stripeWidth = bandPt / n;
  const stripes = steps.map((opacity, i) => ({
    offset: (i - (n - 1) / 2) * stripeWidth,
    width: stripeWidth,
    opacity,
  }));
  return {
    u,
    v,
    rotateDeg: clean((Math.atan2(u[1], u[0]) * 180) / Math.PI),
    from: sMin - bandPt / 2,
    to: sMax + bandPt / 2,
    across: (vMin + vMax) / 2,
    // A little over the card's extent across, so the stripe ends never show at a corner.
    length: vMax - vMin + 2 * bandPt,
    bandWidth: bandPt,
    stripes,
  };
}

/** The band's centre, in the card's coordinates, when it has travelled to `s`. */
export function glareCenter(s: number, u: readonly [number, number], v: readonly [number, number], across: number): [number, number] {
  'worklet';
  return [s * u[0] + across * v[0], s * u[1] + across * v[1]];
}

/** Rounds away the float dust of sin and cos so -45 degrees gives exactly 45, not 44.99999. */
function clean(x: number): number {
  const r = Math.round(x * 1e9) / 1e9;
  return Object.is(r, -0) ? 0 : r;
}
