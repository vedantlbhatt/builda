/**
 * The four SkSL programs the ported components draw with, and the JavaScript twin of each, so
 * `bun test` holds every cell rule without a GPU (and, through CanvasKit, the same SkSL compiler
 * React Native Skia ships, with one). Pure: no React Native import.
 *
 *   PIXEL_FILL_SKSL   PixelCard: square cells growing out of the finger into a solid fill
 *   SPOTLIGHT_SKSL    SpotlightCard and MagicBento: a pool of pixels under the finger
 *   EDGE_SKSL         AnimatedList: the scroll edges dissolve into the surface by cells
 *   FIELD_SKSL        ProfileCard: react-bits Dither's slow wave, in three levels of one hue
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
 * What changed in the port, and why:
 * - PixelCard draws a canvas of 2D pixels per frame on the JS thread with `Math.random()` per
 *   pixel (speed, size, delay jitter) and a shimmer that loops for as long as the pointer is
 *   over the card. Here one shader decides every cell from its distance to the finger (react-bits'
 *   `delay = distance`) plus a fixed hash, driven by ONE progress value, and the cells grow to a
 *   solid square, so the fill lands as the tile's selected colour instead of sparkling forever.
 * - SpotlightCard and MagicBento's spotlight are radial gradients of white at 25%. Gradients are
 *   banned here and a hue at partial opacity over the warm ground turns brown, so the light is
 *   the three level dither of the tile's own hue (paper, partner, ink) at 3pt cells: a pool of
 *   pixels, never a glow.
 * - AnimatedList's edge fades are gradients to the page colour. Here the rows dissolve into the
 *   surface by Bayer cells, so a creature at the edge is either there in its ink or not there,
 *   never a dimmed brown version of itself.
 * - Dither's wave is `fbm(p + fbm(p - t))` with 4 octaves of Perlin noise over the whole frame,
 *   quantised per RGB channel. Here it is 2 octaves, evaluated once per 3pt cell at the cell's
 *   centre, dithered on the scalar in three levels of one hue (no channel quantising, so the hue
 *   never shifts), with the threshold fixed to the cell grid so time moves only the field
 *   (DESIGN-V2 1.4), and a hole cut for the creature so it never sits on its own hue.
 */
import { bayer8 } from '../../dithering';
import { PIXEL, SPOT } from './spec';

// ─── shared SkSL ────────────────────────────────────────────────────────────────────────

/** The arithmetic 8x8 Bayer threshold (SkSL cannot index arrays dynamically). The kit's `b8`. */
export const BAYER_SKSL = `
float b2(float2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
float b8(float2 a) { return b2(a * 0.25) * 0.0625 + b2(a * 0.5) * 0.25 + b2(a); }`;

/**
 * Dave Hoskins' `hash12` (no sine, so every GPU precision agrees), as onboarding's dissolve
 * uses it. `hash12` below is its JavaScript twin, and the test holds both against
 * `src/onboarding/shaders.ts` so the two never drift.
 */
export const HASH_SKSL = `
float hash12(float2 c) {
  float3 p3 = fract(float3(c.x, c.y, c.x) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}`;

/** The three level rule in SkSL: paper, partner, ink, on the scalar. */
const LEVELS_SKSL = `
half4 level3(float v, float b) {
  float s = v * 2.0;
  if (s <= 1.0) { return s > b ? partner : half4(0.0); }
  return (s - 1.0) > b ? ink : partner;
}`;

// ─── PixelCard ──────────────────────────────────────────────────────────────────────────

/**
 * A cell's turn is where the fill front reaches it: its distance to `origin` over `span` (the
 * farthest corner), with `jitter` of it replaced by the cell's hash so the front is ragged. It
 * then grows from nothing to a full square over `grow` of the progress. At `progress` 1 every
 * cell is full, so the canvas IS the solid fill and the plain fill can take over with no seam.
 */
export const PIXEL_FILL_SKSL = `
uniform float cell;
uniform float2 origin;
uniform float span;
uniform float jitter;
uniform float grow;
uniform float progress;
uniform half4 ink;
${HASH_SKSL}
half4 main(float2 p) {
  if (progress <= 0.0) { return half4(0.0); }
  float2 idx = floor(p / cell);
  float2 c = (idx + 0.5) * cell;
  float reach = clamp(length(c - origin) / max(span, 1.0), 0.0, 1.0);
  float turn = (1.0 - grow) * ((1.0 - jitter) * reach + jitter * hash12(idx));
  float h = clamp((progress - turn) / grow, 0.0, 1.0) * cell * 0.5;
  float2 d = abs(p - c);
  return (d.x < h && d.y < h) ? ink : half4(0.0);
}`;

/** `hash12` in JavaScript, the same arithmetic as the shader's (in doubles). */
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

export interface FillGeometry {
  cell: number;
  origin: readonly [number, number];
  span: number;
  jitter: number;
  grow: number;
}

/** The farthest corner of a `w` by `h` tile from `origin`: the front has reached every cell by 1. */
export function fillSpan(origin: readonly [number, number], w: number, h: number): number {
  let far = 0;
  for (const x of [0, w]) for (const y of [0, h]) far = Math.max(far, Math.hypot(x - origin[0], y - origin[1]));
  return far;
}

/** The geometry a `w` by `h` tile fills with, from `origin` (the finger, or the centre). */
export function fillGeometry(origin: readonly [number, number], w: number, h: number): FillGeometry {
  return { cell: PIXEL.cell, origin, span: fillSpan(origin, w, h), jitter: PIXEL.jitter, grow: PIXEL.grow };
}

/** When the cell at index (`ix`, `iy`) starts to grow, in progress units, 0 to 1 minus `grow`. */
export function cellTurn(ix: number, iy: number, g: FillGeometry): number {
  const cx = (ix + 0.5) * g.cell;
  const cy = (iy + 0.5) * g.cell;
  const reach = Math.min(1, Math.max(0, Math.hypot(cx - g.origin[0], cy - g.origin[1]) / Math.max(g.span, 1)));
  return (1 - g.grow) * ((1 - g.jitter) * reach + g.jitter * hash12(ix, iy));
}

/** The cell's half size in points at `progress`: 0 before its turn, `cell / 2` once grown. */
export function cellHalf(ix: number, iy: number, progress: number, g: FillGeometry): number {
  if (progress <= 0) return 0;
  const t = cellTurn(ix, iy, g);
  return Math.min(1, Math.max(0, (progress - t) / g.grow)) * g.cell * 0.5;
}

/**
 * Whether the point (`x`, `y`) in points is inked at `progress`: the shader, line for line.
 * Strictly inside the square: a cell that has not started (half size 0) inks nothing, not even
 * the pixel at its exact centre. No pixel centre ever sits on a full square's edge (a centre is
 * a half pixel, an edge a whole number of points), so a grown cell is still solid.
 */
export function fillCovers(x: number, y: number, progress: number, g: FillGeometry): boolean {
  if (progress <= 0) return false;
  const ix = Math.floor(x / g.cell);
  const iy = Math.floor(y / g.cell);
  const h = cellHalf(ix, iy, progress, g);
  return Math.abs(x - (ix + 0.5) * g.cell) < h && Math.abs(y - (iy + 0.5) * g.cell) < h;
}

/** The tile's words switch to the ink on the fill at half way, both ways (DESIGN-V2 4.3). */
export function inkFlipped(progress: number): boolean {
  'worklet';
  return progress >= PIXEL.flipAt;
}

// ─── the three levels ───────────────────────────────────────────────────────────────────

export type Level = 0 | 1 | 2;

/**
 * Paper (0), partner (1) or ink (2) for an amount `v` at a cell whose threshold is `b`. The
 * dither is on the scalar: the first half of the range turns paper into partner, the second
 * partner into ink, each strictly above the threshold, so 0 stays paper and 1 is solid ink.
 */
export function level3(v: number, b: number): Level {
  const s = v * 2;
  if (s <= 1) return s > b ? 1 : 0;
  return s - 1 > b ? 2 : 1;
}

// ─── SpotlightCard ──────────────────────────────────────────────────────────────────────

/**
 * The light: an amount `strength` at the finger falling to nothing at `radius` along a squared
 * smoothstep, per 3pt cell, through the three levels. Under 0.5 it never reaches ink: a pool of
 * the partner tone, densest under the finger. Squared because a plain smoothstep, drawn and
 * looked at, left a sprinkle of cells out to the full radius and a mission tile read as covered;
 * squared, the pool gathers round the finger and the radius is where the last cell goes.
 */
export const SPOTLIGHT_SKSL = `
uniform float cell;
uniform float2 origin;
uniform float radius;
uniform float strength;
uniform half4 ink;
uniform half4 partner;
${BAYER_SKSL}
${LEVELS_SKSL}
half4 main(float2 p) {
  if (strength <= 0.0) { return half4(0.0); }
  float2 c = (floor(p / cell) + 0.5) * cell;
  float x = clamp(length(c - origin) / max(radius, 1.0), 0.0, 1.0);
  float f = 1.0 - x * x * (3.0 - 2.0 * x);
  return level3(strength * f * f, b8(p / cell));
}`;

/** The light's amount at a cell centre `d` points from the finger. */
export function spotAmount(d: number, strength: number = SPOT.strength, radius: number = SPOT.radius): number {
  if (strength <= 0) return 0;
  const x = Math.min(1, Math.max(0, d / Math.max(radius, 1)));
  const f = 1 - x * x * (3 - 2 * x);
  return strength * f * f;
}

/** The level the spotlight draws at cell (`ix`, `iy`) of `cell` points, for a finger at `origin`. */
export function spotLevel(ix: number, iy: number, cell: number, origin: readonly [number, number], strength: number, radius: number): Level {
  if (strength <= 0) return 0;
  const d = Math.hypot((ix + 0.5) * cell - origin[0], (iy + 0.5) * cell - origin[1]);
  return level3(spotAmount(d, strength, radius), bayer8(ix, iy));
}

// ─── AnimatedList edges ─────────────────────────────────────────────────────────────────

/**
 * A band `rows` cells tall at a scroll edge: the row against the edge is covered by the
 * surface colour at `strength`, thinning row by row to nothing at the band's inner end.
 */
export const EDGE_SKSL = `
uniform float cell;
uniform float rows;
uniform float strength;
uniform float fromBottom;
uniform half4 ink;
${BAYER_SKSL}
half4 main(float2 p) {
  if (strength <= 0.0) { return half4(0.0); }
  float row = floor(p.y / cell);
  float k = fromBottom > 0.5 ? rows - 1.0 - row : row;
  float cover = strength * (1.0 - (k + 0.5) / rows);
  return cover > b8(p / cell) ? ink : half4(0.0);
}`;

/** Whether the edge band covers cell (`ix`, `iy`): the shader, line for line. */
export function edgeCovers(ix: number, iy: number, rows: number, strength: number, fromBottom: boolean): boolean {
  if (strength <= 0) return false;
  const k = fromBottom ? rows - 1 - iy : iy;
  return strength * (1 - (k + 0.5) / rows) > bayer8(ix, iy);
}

// ─── ProfileCard's field ────────────────────────────────────────────────────────────────

/**
 * react-bits Dither's wave (`waveFrequency 3`, `waveAmplitude 0.3`; its Perlin noise verbatim),
 * two octaves, at each cell's centre, through the three levels. `t` is the only thing that
 * moves, and it moves the field: the threshold is fixed to the cell grid. `clearBox` (x, y, w,
 * h in points) is left as paper: the creature's box plus one cell.
 *
 * The wave is read through `smoothstep(0.3, 1.3, ...)` before `density`: the pattern's values
 * sit mostly between 0.5 and 1, so read straight (as react-bits' colour mix does) every cell
 * came out partner and the band was one busy texture. Through the curve the troughs are paper,
 * the body partner and only the crests reach ink (drawn and compared at four settings).
 */
export const FIELD_SKSL = `
uniform float cell;
uniform float2 size;
uniform float t;
uniform float frequency;
uniform float amplitude;
uniform float density;
uniform float4 clearBox;
uniform half4 ink;
uniform half4 partner;
${BAYER_SKSL}
${LEVELS_SKSL}
float4 mod289(float4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
float4 permute(float4 x) { return mod289(((x * 34.0) + 1.0) * x); }
float4 taylorInvSqrt(float4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float2 fade2(float2 q) { return q * q * q * (q * (q * 6.0 - 15.0) + 10.0); }
float cnoise(float2 P) {
  float4 Pi = floor(P.xyxy) + float4(0.0, 0.0, 1.0, 1.0);
  float4 Pf = fract(P.xyxy) - float4(0.0, 0.0, 1.0, 1.0);
  Pi = mod289(Pi);
  float4 ix = Pi.xzxz;
  float4 iy = Pi.yyww;
  float4 fx = Pf.xzxz;
  float4 fy = Pf.yyww;
  float4 k = permute(permute(ix) + iy);
  float4 gx = fract(k * (1.0 / 41.0)) * 2.0 - 1.0;
  float4 gy = abs(gx) - 0.5;
  float4 tx = floor(gx + 0.5);
  gx = gx - tx;
  float2 g00 = float2(gx.x, gy.x);
  float2 g10 = float2(gx.y, gy.y);
  float2 g01 = float2(gx.z, gy.z);
  float2 g11 = float2(gx.w, gy.w);
  float4 norm = taylorInvSqrt(float4(dot(g00, g00), dot(g01, g01), dot(g10, g10), dot(g11, g11)));
  g00 *= norm.x;
  g01 *= norm.y;
  g10 *= norm.z;
  g11 *= norm.w;
  float n00 = dot(g00, float2(fx.x, fy.x));
  float n10 = dot(g10, float2(fx.y, fy.y));
  float n01 = dot(g01, float2(fx.z, fy.z));
  float n11 = dot(g11, float2(fx.w, fy.w));
  float2 f = fade2(Pf.xy);
  float2 nx = mix(float2(n00, n01), float2(n10, n11), f.x);
  return 2.3 * mix(nx.x, nx.y, f.y);
}
float fbm(float2 q) {
  float value = 0.0;
  float amp = 1.0;
  for (int o = 0; o < 2; o++) {
    value += amp * abs(cnoise(q));
    q *= frequency;
    amp *= amplitude;
  }
  return value;
}
half4 main(float2 p) {
  float2 c = (floor(p / cell) + 0.5) * cell;
  if (c.x > clearBox.x && c.x < clearBox.x + clearBox.z && c.y > clearBox.y && c.y < clearBox.y + clearBox.w) {
    return half4(0.0);
  }
  float2 uv = float2(c.x / size.x - 0.5, 0.5 - c.y / size.y);
  uv.x *= size.x / size.y;
  float v = smoothstep(0.3, 1.3, fbm(uv + fbm(uv - t))) * density;
  return level3(v, b8(p / cell));
}`;

/** react-bits Dither's defaults: `waveSpeed 0.05`, `waveFrequency 3`, `waveAmplitude 0.3`. */
export const FIELD_WAVE = { speed: 0.05, frequency: 3, amplitude: 0.3 } as const;

/**
 * The creature's hole in the field: its box grown by one cell on every side, so no cell of the
 * field touches it (DESIGN-V2 3.2: a creature never sits on its own hue).
 */
export function clearBoxFor(x: number, y: number, size: number, cell: number): [number, number, number, number] {
  return [x - cell, y - cell, size + 2 * cell, size + 2 * cell];
}
