/**
 * A Wrapped card's art, alive: the card's own data (`art.ts`, one value per 3pt cell) printed on
 * its band in the two tone recipe, and moving the way react-bits PixelBlast moves. Pure, so
 * `__tests__/wrappedStory.test.ts` compiles the program through CanvasKit (React Native Skia's own
 * SkSL compiler) and reads its cells back against the data.
 *
 * WHAT MOVES, AND WHAT NEVER DOES
 *   - The data decides which cells can ever be ink. A cell the data leaves empty is paper in
 *     every frame, so the silhouette of the chart is always the chart.
 *   - It PRINTS itself when the card arrives: cells switch on in a random order biased along the
 *     data's own axis (time runs left to right, a bar grows up from its foot, a burst from its
 *     middle), react-bits PixelTransition's `hash(cell) < progress`, the Band's print.
 *   - Then PixelBlast's value noise clouds drift THROUGH it at the ambient 20 fps, and one of its
 *     ripples runs out from where the finger was. Both only ever THIN the data (a multiplier
 *     under 1), never add to it: no frame draws a cell denser than the data says, and at rest
 *     (no drift, no ripple) every cell is exactly the data's three level print (the test).
 *
 * THE TONES, on a band: paper is the band itself (transparent), the midtone is the hue's partner,
 * the full ink is the dark ink every band's words are set in. So a card prints in its own hue's
 * three levels, like the analysis page's chapters, and nothing is a hue at partial opacity.
 *
 * Ported in part from react-bits `Backgrounds/PixelBlast/PixelBlast.tsx` (the 3D value noise, the
 * ripple's shape) and `Animations/PixelTransition/PixelTransition.tsx` (the random arrival order)
 * by David Haz. react-bits is MIT + Commons Clause (Copyright (c) 2026 David Haz): the notice is
 * kept here as the licence asks, and the port is used as part of this application only; it is not
 * to be redistributed as a component.
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
 * What changed from PixelBlast: its clouds ARE the picture there; here they are a multiplier on
 * the data, so the data is the picture and the clouds only breathe through it. The density
 * comes from the data texture, not a `patternDensity` uniform. Its ripple adds ink; this one
 * lifts it, a wave of the band's own colour running through the chart, and it reaches a whole
 * card (`rippleReach` 300 pt) where PixelBlast's `exp(-10 r)` fades out within a few blocks.
 * Hashes are Dave Hoskins' (no sine), as in every ported field, so a still frame is the same on
 * every phone.
 */
import { quantize, type Field } from '../ui/dithering';
import type { ArtShape } from './art';

export const DATA_FIELD_SKSL = `
uniform shader data;
uniform float2 size;
uniform float cell;
uniform float t;
uniform float now;
uniform float develop;
uniform float axis;
uniform float shimmer;
uniform float noiseUnit;
uniform float4 tap;
uniform float rippleSpeed;
uniform float rippleWidth;
uniform float rippleDepth;
uniform float rippleReach;
uniform half4 ink;
uniform half4 partner;
uniform half4 paper;

float b2(float2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
float b8(float2 a) { return b2(a * 0.25) * 0.0625 + b2(a * 0.5) * 0.25 + b2(a); }

float hash12(float2 c) {
  float3 p3 = fract(float3(c.x, c.y, c.x) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float hash11(float n) {
  n = fract(n * 0.1031);
  n *= n + 33.33;
  n *= n + n;
  return fract(n);
}

float vnoise(float3 q) {
  float3 ip = floor(q);
  float3 fp = fract(q);
  float3 k = float3(1.0, 57.0, 113.0);
  float n000 = hash11(dot(ip, k));
  float n100 = hash11(dot(ip + float3(1.0, 0.0, 0.0), k));
  float n010 = hash11(dot(ip + float3(0.0, 1.0, 0.0), k));
  float n110 = hash11(dot(ip + float3(1.0, 1.0, 0.0), k));
  float n001 = hash11(dot(ip + float3(0.0, 0.0, 1.0), k));
  float n101 = hash11(dot(ip + float3(1.0, 0.0, 1.0), k));
  float n011 = hash11(dot(ip + float3(0.0, 1.0, 1.0), k));
  float n111 = hash11(dot(ip + float3(1.0, 1.0, 1.0), k));
  float3 w = fp * fp * fp * (fp * (fp * 6.0 - 15.0) + 10.0);
  float x00 = mix(n000, n100, w.x);
  float x10 = mix(n010, n110, w.x);
  float x01 = mix(n001, n101, w.x);
  float x11 = mix(n011, n111, w.x);
  float y0 = mix(x00, x10, w.y);
  float y1 = mix(x01, x11, w.y);
  return mix(y0, y1, w.z);
}

float ink01(float2 c) {
  half4 s = data.eval(c);
  if (s.a <= 0.0) { return 0.0; }
  float v = (1.0 - dot(s.rgb / s.a, half3(0.2126, 0.7152, 0.0722))) * s.a;
  return v < 0.002 ? 0.0 : v;
}

half4 tone(float v, float b) {
  if (v < 0.0078125) { return paper; }
  float s = v * 2.0;
  if (s <= 1.0) { return s > b ? partner : paper; }
  return (s - 1.0) > b ? ink : partner;
}

half4 main(float2 p) {
  float2 idx = floor(p / cell);
  float2 c = (idx + 0.5) * cell;
  float v = ink01(c);
  if (v <= 0.0) { return paper; }
  float2 n = c / size;
  float along = axis < 0.5 ? n.x : (axis < 1.5 ? 1.0 - n.y : min(1.0, length(n - 0.5) * 1.41421356));
  float order = hash12(idx + 11.0) * 0.45 + along * 0.55;
  if (order > develop * 1.02) { return paper; }
  float k = 1.0;
  if (shimmer > 0.0) {
    float cloud = vnoise(float3(c / noiseUnit, t));
    k = 1.0 - shimmer * (1.0 - cloud);
  }
  if (tap.w > 0.0) {
    float age = now - tap.z;
    if (age > 0.0) {
      float r = distance(c, tap.xy) / rippleReach;
      float w = (r - rippleSpeed * age) / rippleWidth;
      k *= 1.0 - rippleDepth * exp(-w * w) * exp(-age);
    }
  }
  return tone(v * k, b8(idx));
}
`;

/**
 * The field's motion. `shimmer` is how far a cloud can thin a cell (0.34: a solid bar breathes
 * between ink and a third partner, a light one between partner and paper); `noiseUnit` is the
 * clouds' size in points; `rate` is field seconds per second, PixelBlast's `speed 0.5` at the
 * ambient 0.3 (0.15) cut a little, so the clouds drift about 12 points a second. The ripple:
 * `rippleSpeed` units of `rippleReach` points a second, `rippleWidth` thick, lifting at most
 * `rippleDepth` of the ink, starting `rippleDelayS` after the card arrives.
 */
export const FIELD = {
  shimmer: 0.34,
  noiseUnit: 96,
  rate: 0.12,
  rippleSpeed: 0.55,
  rippleWidth: 0.09,
  rippleDepth: 0.75,
  rippleReach: 300,
  rippleDelayS: 0.3,
} as const;

/** The print's direction: 0 left to right (time), 1 bottom up (a bar), 2 out from the middle. */
export type PrintAxis = 0 | 1 | 2;

export function printAxis(shape: ArtShape): PrintAxis {
  switch (shape.kind) {
    case 'bars':
    case 'row':
      return 1;
    case 'motif':
      return shape.motif === 'scatter' || shape.motif === 'blocks' || shape.motif === 'lines' ? 0 : 2;
    default:
      // A grid, a series, lanes, bands and a paragraph all read left to right.
      return 0;
  }
}

// ─── the shader's arithmetic, in JavaScript ─────────────────────────────────────────────

/** Under half a Bayer step a value is paper (the program's `tone`). */
export const TONE_DEAD = 1 / 128;

/** What `tone` draws for an amount `v` at a cell whose Bayer threshold is `b`: 0 paper, 1 partner, 2 ink. */
export function restTone(v: number, b: number): 0 | 1 | 2 {
  if (v < TONE_DEAD) return 0;
  const s = v * 2;
  if (s <= 1) return s > b ? 1 : 0;
  return s - 1 > b ? 2 : 1;
}

/** The value the program reads back for a field cell: the field through 8 bit grey (`quantize`). */
export function cellValue(field: Field, x: number, y: number): number {
  const v = quantize(field.data[y * field.width + x] ?? 0);
  return v < 0.002 ? 0 : v;
}

// ─── where the creature fits ────────────────────────────────────────────────────────────

export type Corner = 'br' | 'bl' | 'tr' | 'tl';

export interface CreatureSpot {
  /** Top left of the creature's box, in points from the field's top left. */
  x: number;
  y: number;
  size: number;
  corner: Corner;
}

/** The corners tried, in order: standing on the ground first, then peeking in from the top. */
export const CORNERS: readonly Corner[] = ['br', 'bl', 'tr', 'tl'];

/**
 * A corner of the art where the creature can stand without covering one cell of data: a
 * window of its size plus `margin` cells round it in which every cell is paper. The largest
 * size that fits anywhere wins, then the corner order. Null when no corner is empty (a full
 * contribution grid): the card prints it elsewhere or not at all, and never over its data.
 */
export function creatureSpot(field: Field, cell: number, sizes: readonly number[], margin = 2): CreatureSpot | null {
  for (const size of sizes) {
    const n = Math.ceil(size / cell);
    const side = n + margin * 2;
    if (side > field.width || side > field.height) continue;
    for (const corner of CORNERS) {
      const x0 = corner === 'br' || corner === 'tr' ? field.width - side : 0;
      const y0 = corner === 'br' || corner === 'bl' ? field.height - side : 0;
      let empty = true;
      for (let y = y0; y < y0 + side && empty; y++) {
        for (let x = x0; x < x0 + side; x++) {
          if (cellValue(field, x, y) >= TONE_DEAD) {
            empty = false;
            break;
          }
        }
      }
      if (empty) return { x: (x0 + margin) * cell, y: (y0 + margin) * cell, size, corner };
    }
  }
  return null;
}
