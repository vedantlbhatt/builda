/**
 * The cell logic of PixelSwap and PixelTransition, in JavaScript and in SkSL, line for line,
 * so `bun test` can hold the ordering and timing rules without a GPU.
 *
 * Ported from react-bits `Animations/PixelSwap/PixelSwap.tsx` and
 * `Animations/PixelTransition/PixelTransition.tsx` by David Haz.
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
 * What changed in the port:
 * - PixelSwap: the original clones the incoming DOM into every pixel window (at most 220)
 *   and animates each with WAAPI keyframes. Here one runtime shader decides every pixel: a
 *   cell's start comes from its pattern rank (the original's nine patterns, kept), its window
 *   grows from 0.35 of the cell to the whole cell on the curve, and inside the window the
 *   incoming content shows at its true position (the original's counter transform, which is
 *   free in a shader). Spin and rounded pixels are dropped: Builda's cells are square. The
 *   `random` pattern uses the hash below instead of the original's `sin` noise, which is not
 *   the same on every GPU precision. Cells grow to whole dither cells, so a cell edge never
 *   cuts a dither dot.
 * - PixelTransition: the original shows a grid of coloured divs in random order (GSAP
 *   stagger), swaps the content under them, and hides them in a second random order. Here
 *   the grid is one shader over the content, two hashes give the two orders, and the swap
 *   happens while every cell is on.
 *
 * The hash is Dave Hoskins' `hash12` (no sine), the same arithmetic as the onboarding
 * dissolve's (`src/onboarding/shaders.ts`); `__tests__/bitsEffects.test.ts` holds the two
 * JavaScript copies equal, so the kit and the onboarding flow can never drift apart. The GPU
 * runs it in float32, the twin in doubles: they agree except for a cell whose hash sits
 * within about 0.005 of a whole number, where float32's last `fract` can land on the other
 * side (0.995 here, 0.004 there; MEASURED on CanvasKit, 2 cells of 192). Either is a random
 * order, and every rule the components rely on (all cells on at the middle of a cover, all
 * off at its end, every swap cell done at the end) holds in both precisions.
 */
import { EASE_BEZIER } from '../../motionSpec';
import { EFFECTS } from './spec';

// ─── the hash ──────────────────────────────────────────────────────────────────────────

export const HASH12_SKSL = `
float hash12(float2 c) {
  float3 p3 = fract(float3(c.x, c.y, c.x) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}`;

/** `hash12` in JavaScript, the shader's arithmetic in doubles: 0 <= h < 1. */
export function hash12(x: number, y: number): number {
  const fract = (v: number) => v - Math.floor(v);
  let a = fract(x * 0.1031);
  let b = fract(y * 0.1031);
  let c = fract(x * 0.1031);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d;
  b += d;
  c += d;
  return fract((a + b) * c);
}

// ─── the curve ─────────────────────────────────────────────────────────────────────────

/**
 * A CSS cubic bezier as a function of time: the original's `makeEasing` (five Newton steps
 * on x, then y). The shader runs the same five steps, so a cell's window grows on exactly the
 * curve the tests see. Default the kit's `EASE`.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  if (x1 === y1 && x2 === y2) return (t) => t;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  return (progress: number) => {
    let t = progress;
    for (let i = 0; i < 5; i++) {
      const slope = (3 * ax * t + 2 * bx) * t + cx;
      if (!slope) break;
      t -= (((ax * t + bx) * t + cx) * t - progress) / slope;
    }
    t = Math.min(1, Math.max(0, t));
    return ((ay * t + by) * t + cy) * t;
  };
}

export const easeCurve = cubicBezier(EASE_BEZIER[0], EASE_BEZIER[1], EASE_BEZIER[2], EASE_BEZIER[3]);

// ─── PixelSwap ─────────────────────────────────────────────────────────────────────────

/** The original's nine orders. */
export const SWAP_PATTERNS = [
  'random',
  'center',
  'edges',
  'left-to-right',
  'right-to-left',
  'top-to-bottom',
  'bottom-to-top',
  'diagonal',
  'spiral',
] as const;
export type SwapPattern = (typeof SWAP_PATTERNS)[number];

/** The `pattern` uniform for a name: its index in `SWAP_PATTERNS`. */
export function patternUniform(pattern: SwapPattern): number {
  return Math.max(0, SWAP_PATTERNS.indexOf(pattern));
}

/**
 * A cell's place in the order, 0 first to 1 last, from its position in unit coordinates
 * (0 is the first column or row, 1 the last). The original's table; `random` is null here
 * and takes the hash.
 */
export function patternRank(pattern: SwapPattern, x: number, y: number): number | null {
  switch (pattern) {
    case 'random':
      return null;
    case 'center':
      return Math.hypot(x - 0.5, y - 0.5) / Math.SQRT1_2;
    case 'edges':
      return Math.min(x, 1 - x, y, 1 - y) * 2;
    case 'left-to-right':
      return x;
    case 'right-to-left':
      return 1 - x;
    case 'top-to-bottom':
      return y;
    case 'bottom-to-top':
      return 1 - y;
    case 'diagonal':
      return (x + y) / 2;
    case 'spiral': {
      const angle = (Math.atan2(y - 0.5, x - 0.5) + Math.PI) / (Math.PI * 2);
      const radius = Math.hypot(x - 0.5, y - 0.5) / Math.SQRT1_2;
      return (angle + radius) % 1;
    }
  }
}

export interface SwapGrid {
  /** Cell side in points. */
  size: number;
  cols: number;
  rows: number;
}

/**
 * The grid for a `width` by `height` box: the original's rule (cells at least 8pt; if more
 * than `maxCells` would fit, grow them until they do not), then each cell grown to a whole
 * number of `snap` points (the dither cell), laid from the top left corner so cell edges fall
 * on dither cell edges. The last row and column may hang over the box, as in the original.
 */
export function swapGrid(
  width: number,
  height: number,
  cellPt: number = EFFECTS.swap.cellPt,
  maxCells: number = EFFECTS.swap.maxCells,
  snap: number = EFFECTS.swap.snapPt,
): SwapGrid {
  let size = Math.max(8, Math.round(cellPt));
  const count = (s: number) => [Math.max(1, Math.ceil(width / s)), Math.max(1, Math.ceil(height / s))] as const;
  let [cols, rows] = count(size);
  if (cols * rows > maxCells) {
    size = Math.ceil(size * Math.sqrt((cols * rows) / maxCells));
    [cols, rows] = count(size);
    // The original's one step is approximate: the ceilings on columns and rows can leave it
    // a row over (1000 by 800 at 12pt lands on 270 cells of 256). Grow until it holds.
    while (cols * rows > maxCells && size < Math.max(width, height)) {
      size += 1;
      [cols, rows] = count(size);
    }
  }
  if (snap > 0) {
    size = Math.ceil(size / snap) * snap;
    [cols, rows] = count(size);
  }
  return { size, cols, rows };
}

/**
 * Cell (`col`, `row`)'s start in the order, 0 to 1: its pattern rank, mixed with its hash by
 * `randomness` (0 is the pure pattern, 1 pure chance; `random` is always the hash).
 */
export function swapOffset(col: number, row: number, grid: SwapGrid, pattern: SwapPattern, randomness = 0): number {
  const x = grid.cols <= 1 ? 0.5 : col / (grid.cols - 1);
  const y = grid.rows <= 1 ? 0.5 : row / (grid.rows - 1);
  const base = patternRank(pattern, x, y);
  const r = hash12(col + 1, row + 1);
  if (base === null) return r;
  const mix = Math.min(1, Math.max(0, randomness));
  return base * (1 - mix) + r * mix;
}

/** The original's clamps: the whole swap at least 200ms, one cell between 60ms and the whole. */
export function swapTimes(totalMs: number, cellMs: number): { total: number; cell: number; spread: number } {
  const total = Math.max(200, totalMs);
  const cell = Math.min(total, Math.max(60, cellMs));
  return { total, cell, spread: Math.max(0, total - cell) };
}

/** How far a cell starting at `offset` has turned at `t` ms into the swap, 0 to 1. */
export function swapLocal(offset: number, t: number, totalMs: number, cellMs: number): number {
  const { cell, spread } = swapTimes(totalMs, cellMs);
  return Math.min(1, Math.max(0, (t - offset * spread) / cell));
}

/** A turning cell's window: its side as a share of the cell, and the incoming content's opacity in it. */
export function swapWindow(local: number, startScale: number, fade: boolean, ease: (t: number) => number = easeCurve): { scale: number; alpha: number } {
  if (local <= 0) return { scale: 0, alpha: 0 };
  if (local >= 1) return { scale: 1, alpha: 1 };
  const e = ease(local);
  return { scale: startScale + (1 - startScale) * e, alpha: fade ? Math.min(1, e * 1.6) : 1 };
}

/**
 * The swap. Two child shaders, `first` then `second` (the original's `firstContent` and
 * `secondContent`); `forward` 1 brings `second` in over `first`, 0 brings `first` back over
 * `second`. Every uniform is in points and milliseconds.
 */
export const SWAP_SKSL = `
uniform shader first;
uniform shader second;
uniform float cell;
uniform float2 grid;
uniform float pattern;
uniform float randomness;
uniform float t;
uniform float total;
uniform float cellMs;
uniform float startScale;
uniform float fade;
uniform float forward;
uniform float4 curve;
${HASH12_SKSL}

float rank(float2 u) {
  if (pattern < 1.5) { return length(u - 0.5) / 0.70710678; }
  if (pattern < 2.5) { return min(min(u.x, 1.0 - u.x), min(u.y, 1.0 - u.y)) * 2.0; }
  if (pattern < 3.5) { return u.x; }
  if (pattern < 4.5) { return 1.0 - u.x; }
  if (pattern < 5.5) { return u.y; }
  if (pattern < 6.5) { return 1.0 - u.y; }
  if (pattern < 7.5) { return (u.x + u.y) * 0.5; }
  float angle = (atan(u.y - 0.5, u.x - 0.5) + 3.14159265) / 6.28318531;
  float radius = length(u - 0.5) / 0.70710678;
  return fract(angle + radius);
}

float ease(float x) {
  float cx = 3.0 * curve.x;
  float bx = 3.0 * (curve.z - curve.x) - cx;
  float ax = 1.0 - cx - bx;
  float cy = 3.0 * curve.y;
  float by = 3.0 * (curve.w - curve.y) - cy;
  float ay = 1.0 - cy - by;
  float s = x;
  for (int i = 0; i < 5; i++) {
    float slope = (3.0 * ax * s + 2.0 * bx) * s + cx;
    if (slope == 0.0) { break; }
    s -= (((ax * s + bx) * s + cx) * s - x) / slope;
  }
  s = clamp(s, 0.0, 1.0);
  return ((ay * s + by) * s + cy) * s;
}

half4 main(float2 p) {
  half4 a = first.eval(p);
  half4 b = second.eval(p);
  half4 outgoing = forward > 0.5 ? a : b;
  half4 incoming = forward > 0.5 ? b : a;
  float2 idx = floor(p / cell);
  float2 u = float2(grid.x <= 1.0 ? 0.5 : idx.x / (grid.x - 1.0), grid.y <= 1.0 ? 0.5 : idx.y / (grid.y - 1.0));
  float r = hash12(idx + 1.0);
  float off = pattern < 0.5 ? r : mix(rank(u), r, clamp(randomness, 0.0, 1.0));
  float spread = max(0.0, total - cellMs);
  float local = clamp((t - off * spread) / cellMs, 0.0, 1.0);
  if (local <= 0.0) { return outgoing; }
  if (local >= 1.0) { return incoming; }
  float e = ease(local);
  float half_ = 0.5 * cell * mix(startScale, 1.0, e);
  float2 d = abs(p - (idx + 0.5) * cell);
  if (d.x > half_ || d.y > half_) { return outgoing; }
  float alpha = fade > 0.5 ? min(1.0, e * 1.6) : 1.0;
  return mix(outgoing, incoming, half(alpha));
}`;

// ─── PixelTransition ───────────────────────────────────────────────────────────────────

/** The grid: `grid` square cells across the width, as many rows as the height needs. */
export function coverGrid(width: number, height: number, grid: number = EFFECTS.cover.grid): { cell: number; cols: number; rows: number } {
  const cols = Math.max(1, Math.round(grid));
  const cell = width > 0 ? width / cols : 1;
  return { cell, cols, rows: Math.max(1, Math.ceil(height / cell)) };
}

/**
 * The two phases from one progress `p` running 0 to 2: cells switch on in their first order
 * while `pin` goes 0 to 1, the content swaps while every cell is on, then they switch off in
 * their second order while `pout` goes 0 to 1.
 */
export function coverPhases(p: number): { pin: number; pout: number } {
  'worklet';
  return { pin: Math.min(1, Math.max(0, p)), pout: Math.min(1, Math.max(0, p - 1)) };
}

/** A cell's two places in the two orders. */
export function coverHashes(col: number, row: number): [number, number] {
  return [hash12(col, row), hash12(col + 71, row + 113)];
}

/** Whether a cell is on: switched on in the first order and not yet off in the second. */
export function coverOn(hIn: number, hOut: number, pin: number, pout: number): boolean {
  return hIn < pin && hOut >= pout;
}

export const COVER_SKSL = `
uniform float cell;
uniform float pin;
uniform float pout;
uniform half4 ink;
${HASH12_SKSL}
half4 main(float2 p) {
  float2 idx = floor(p / cell);
  float hIn = hash12(idx);
  float hOut = hash12(idx + float2(71.0, 113.0));
  return (hIn < pin && hOut >= pout) ? ink : half4(0.0);
}`;
