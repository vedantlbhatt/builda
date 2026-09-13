/**
 * The seven background fields as SkSL, one program each, built from one uniform table so the
 * declarations, the uniforms the components send and the tests can never disagree. Pure: no
 * React Native import, so `__tests__/bitsBackgrounds.test.ts` compiles every program through
 * CanvasKit (the SkSL compiler React Native Skia ships) and holds its pixels against the JS
 * twins in `twins.ts`.
 *
 * Ported from react-bits `Backgrounds/Dither/Dither.tsx`, `Backgrounds/PixelBlast/PixelBlast.tsx`,
 * `Backgrounds/Silk/Silk.tsx`, `Backgrounds/Grainient/Grainient.tsx`, `Backgrounds/Radar/Radar.tsx`,
 * `Backgrounds/DotGrid/DotGrid.tsx` and `Backgrounds/Topography/Topography.tsx` by David Haz.
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
 * What changed in the ports, all of them (each program says what else changed in it):
 * - **Builda's grain, not the original's colour ramp.** Every field is a scalar evaluated at the
 *   centre of a 3 pt cell and dithered to three levels of ONE hue, paper, partner and ink
 *   (DESIGN-V2 1.4, react-bits Dither's `colorNum 3` done on the scalar). So there is no smooth
 *   ramp anywhere (the brief bans gradients), no hue at partial opacity (the brown frame) and a
 *   whole cell is always one tone. Each react-bits colour stop becomes a level.
 * - **The threshold is fixed to the screen** (`b8(idx)`, DESIGN-V2 1.4): time moves the field
 *   only, so an animated field changes whole cells and never crawls with seams inside one.
 * - **No sine hashes.** `fract(sin(x) * 43758.5453)` differs between GPU precisions; every hash
 *   is Dave Hoskins' (the one `src/onboarding/shaders.ts` uses), so a still frame is the same
 *   on every phone and the JS twins match the GPU.
 * - **One pass or one texel per cell.** `unit` is points per shader pixel: 1 when the canvas
 *   evaluates every device pixel at its cell's centre, `cell` when a large field is drawn into a
 *   texture at one pixel per cell and scaled up with nearest sampling (`FieldSurface.tsx`).
 * - Loops have constant bounds with an early `break` (SkSL has no dynamic loops), uniform arrays
 *   are unrolled into numbered uniforms, and there is no `fwidth` (Topography measures its slope
 *   one cell across instead).
 * - No `smoothstep` with its edges reversed (Radar's falloff and Grainient's blend had them):
 *   Metal leaves that undefined, and `1 - smoothstep(b, a, x)` is the same curve exactly.
 */

// ─── the uniform tables ──────────────────────────────────────────────────────────────────

export type UniformKind = 'float' | 'float2' | 'float3' | 'float4' | 'half4';
export type UniformLayout = readonly (readonly [name: string, kind: UniformKind])[];

/** How many floats each kind takes in a uniform buffer. */
export const UNIFORM_FLOATS: Readonly<Record<UniformKind, number>> = {
  float: 1,
  float2: 2,
  float3: 3,
  float4: 4,
  half4: 4,
};

/**
 * Every field's shared uniforms.
 *
 *   size       the canvas, points
 *   cell       the dither grain, points (tokens.dither.cell)
 *   unit       points per shader pixel: 1 in one pass, `cell` in the one texel per cell texture
 *   t          field time, seconds, already scaled by the component's rate and `speed`
 *   levels     3: paper, partner, ink (default); 2: ink over paper
 *   reveal     0..1, the develop: cells switch on in Bayer order (HalftoneReveal)
 *   edge       react-bits PixelBlast `edgeFade`: the field thins toward every edge, 0 is off
 *   clearRect  x, y, width, height in points kept as paper (width 0 is none)
 *   ink, partner, paper  premultiplied colours; paper is transparent by default
 */
export const COMMON_UNIFORMS = [
  ['size', 'float2'],
  ['cell', 'float'],
  ['unit', 'float'],
  ['t', 'float'],
  ['levels', 'float'],
  ['reveal', 'float'],
  ['edge', 'float'],
  ['clearRect', 'float4'],
  ['ink', 'half4'],
  ['partner', 'half4'],
  ['paper', 'half4'],
] as const satisfies UniformLayout;

export function declareUniforms(layout: UniformLayout): string {
  return layout.map(([name, kind]) => `uniform ${kind} ${name};`).join('\n');
}

export function uniformFloatCount(layout: UniformLayout): number {
  return layout.reduce((n, [, kind]) => n + UNIFORM_FLOATS[kind], 0);
}

// ─── shared SkSL ─────────────────────────────────────────────────────────────────────────

/**
 * The kit's arithmetic Bayer (react-bits PixelBlast's `Bayer2`/`Bayer8` macros, as in
 * `src/ui/dithering.ts`), the sine free hash, the three level tone and the frame (develop,
 * edge fade and the cleared rect), in that order. A value under half a Bayer step (1/128) is
 * paper: otherwise every cell whose threshold is 0 lights wherever a faded field is barely
 * above zero, and each faded edge and cleared rim gets a regular grid of lone dots (the kit's
 * `DITHER_SKSL` has the same dead zone, at 0.002).
 */
const PRELUDE = `
float b2(float2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
float b8(float2 a) { return b2(a * 0.25) * 0.0625 + b2(a * 0.5) * 0.25 + b2(a); }

float hash12(float2 c) {
  float3 p3 = fract(float3(c.x, c.y, c.x) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

half4 tone(float v, float b) {
  if (v < 0.0078125) { return paper; }
  if (levels < 2.5) { return v > b ? ink : paper; }
  float s = v * 2.0;
  if (s <= 1.0) { return s > b ? partner : paper; }
  return (s - 1.0) > b ? ink : partner;
}

float frame(float2 c) {
  float k = reveal;
  if (edge > 0.0) {
    float2 n = c / size;
    float e = min(min(n.x, n.y), min(1.0 - n.x, 1.0 - n.y));
    k *= smoothstep(0.0, edge, e);
  }
  if (clearRect.z > 0.0 && c.x >= clearRect.x && c.x <= clearRect.x + clearRect.z &&
      c.y >= clearRect.y && c.y <= clearRect.y + clearRect.w) {
    k = 0.0;
  }
  return k;
}
`;

/** A field program's `main`: the cell, its centre, the frame, the field, the tone. */
const CELL_MAIN = `
half4 main(float2 p) {
  float2 idx = floor(p * unit / cell);
  float2 c = (idx + 0.5) * cell;
  float k = frame(c);
  if (k <= 0.0) { return paper; }
  return tone(clamp(field(c), 0.0, 1.0) * k, b8(idx));
}
`;

function program(layout: UniformLayout, body: string, main: string = CELL_MAIN): string {
  return `${declareUniforms([...COMMON_UNIFORMS, ...layout])}\n${PRELUDE}\n${body}\n${main}`;
}

// ─── 1. Dither: the wave field (react-bits `Backgrounds/Dither/Dither.tsx`) ───────────────

/**
 * `fbm(p + fbm(p - t * waveSpeed))` over Gustavson's classic Perlin noise, 4 octaves, exactly
 * the react-bits wave (`waveFrequency 3`, `waveAmplitude 0.3`, `waveSpeed 0.05`), on the same
 * coordinates (centred, y up). What changed: one unit is `ref` points (react-bits: the canvas
 * height; here a fixed length, so a hero band and a full screen draw the same size of wave and
 * the grain keeps its ratio to it); the RGB `colorNum 4`
 * posterise becomes the three level scalar dither; its luminance bias (`mix(0.2, 0.0,
 * smoothstep(0.45, 0.8, lum))`, which keeps the dark areas clean) is applied to the scalar; the
 * mouse hole is a finger (`touch`, radius in height units, 0.35 rather than 1: a whole field
 * hole is a hover effect, a thumb makes a pool); `octaves` can drop to 2 (DESIGN-V2 3.3).
 */
export const DITHER_WAVES_UNIFORMS = [
  ['waveSpeed', 'float'],
  ['waveFrequency', 'float'],
  ['waveAmplitude', 'float'],
  ['octaves', 'float'],
  ['ref', 'float'],
  ['zoom', 'float'],
  ['touch', 'float3'],
  ['touchRadius', 'float'],
] as const satisfies UniformLayout;

const DITHER_WAVES_BODY = `
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
  float4 i = permute(permute(ix) + iy);
  float4 gx = fract(i * (1.0 / 41.0)) * 2.0 - 1.0;
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
  float2 fxy = fade2(Pf.xy);
  float2 nx = mix(float2(n00, n01), float2(n10, n11), fxy.x);
  return 2.3 * mix(nx.x, nx.y, fxy.y);
}

float fbm(float2 q) {
  float value = 0.0;
  float amp = 1.0;
  for (int i = 0; i < 4; i++) {
    if (float(i) >= octaves) { break; }
    value += amp * abs(cnoise(q));
    q *= waveFrequency;
    amp *= waveAmplitude;
  }
  return value;
}

float2 waveUv(float2 c) {
  float2 uv = (c - size * 0.5) / ref;
  return float2(uv.x, -uv.y) / zoom;
}

float field(float2 c) {
  float2 uv = waveUv(c);
  float f = fbm(uv + fbm(uv - t * waveSpeed));
  if (touch.z > 0.0) {
    float d = length(uv - waveUv(touch.xy));
    f -= 0.5 * (1.0 - smoothstep(0.0, touchRadius, d)) * touch.z;
  }
  return f - mix(0.2, 0.0, smoothstep(0.45, 0.8, f));
}
`;

// ─── 2. PixelBlast (react-bits `Backgrounds/PixelBlast/PixelBlast.tsx`) ───────────────────

/**
 * 3D value noise fbm (5 octaves, lacunarity 1.25, gain 1.0) over blocks of `block` cells (react-
 * bits: 8 x pixelSize), `base * 0.5 - 0.65` plus `(density - 0.5) * 0.3`, and the tap ripples
 * (`exp(-((r - speed t) / thickness)^2) * exp(-t) * exp(-10 r)`, taken as a max), all its numbers.
 * What changed: ripples cut from 10 to 4 (DESIGN-V2 3.3), unrolled into `tap0..tap3` (x, y in
 * points, start in `now` seconds, 1 when live); variant square only; no liquid, jitter or noise
 * passes; one unit is `ref` points rather than the canvas height (a portrait phone is under one
 * noise cell wide at the original's scale, so the whole screen was one blob); `hash11` is
 * Hoskins' rather than `fract(sin(n) * 43758.5453)`; the block's density is
 * dithered to the three levels, where the original drew one bit and faded its alpha at the
 * edges (a smooth alpha ramp); here the edge fade thins the cells instead.
 */
export const PIXEL_BLAST_UNIFORMS = [
  ['patternScale', 'float'],
  ['density', 'float'],
  ['octaves', 'float'],
  ['block', 'float'],
  ['ref', 'float'],
  ['zoom', 'float'],
  ['now', 'float'],
  ['tap0', 'float4'],
  ['tap1', 'float4'],
  ['tap2', 'float4'],
  ['tap3', 'float4'],
  ['rippleSpeed', 'float'],
  ['rippleThickness', 'float'],
  ['rippleIntensity', 'float'],
  ['rippleRate', 'float'],
] as const satisfies UniformLayout;

const PIXEL_BLAST_BODY = `
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
  return mix(y0, y1, w.z) * 2.0 - 1.0;
}

float fbm2(float2 uv, float tt) {
  float3 q = float3(uv * patternScale, tt);
  float amp = 1.0;
  float freq = 1.0;
  float sum = 1.0;
  for (int i = 0; i < 5; i++) {
    if (float(i) >= octaves) { break; }
    sum += amp * vnoise(q * freq);
    freq *= 1.25;
    amp *= 1.0;
  }
  return sum * 0.5 + 0.5;
}

float2 blastUv(float2 pt) {
  float2 uv = (pt - size * 0.5) / ref;
  return float2(uv.x, -uv.y) / zoom;
}

float ripple(float4 tap, float2 uv) {
  if (tap.w <= 0.0) { return 0.0; }
  float age = max((now - tap.z) * rippleRate, 0.0);
  float r = distance(uv, blastUv(tap.xy));
  float wave = (r - rippleSpeed * age) / rippleThickness;
  return exp(-wave * wave) * exp(-age) * exp(-10.0 * r) * rippleIntensity;
}

float field(float2 c) {
  float2 corner = floor(floor(c / cell) / block) * block * cell;
  float2 uv = blastUv(corner);
  float feed = (fbm2(uv, t * 0.05) * 0.5 - 0.65) + (density - 0.5) * 0.3;
  feed = max(feed, ripple(tap0, uv));
  feed = max(feed, ripple(tap1, uv));
  feed = max(feed, ripple(tap2, uv));
  feed = max(feed, ripple(tap3, uv));
  return feed;
}
`;

// ─── 3. Silk (react-bits `Backgrounds/Silk/Silk.tsx`) ─────────────────────────────────────

/**
 * The folds, exactly: `0.6 + 0.4 sin(5 (x + y + cos(3x + 5y) + 0.02 o) + sin(20 (x + y - 0.1 o)))`
 * with the `0.03 sin(8x - o)` ripple and `o = 5 t` (react-bits `uSpeed 5`, time `0.1` a second),
 * the uv rotated and scaled twice as the original does. What changed: one unit is `ref` points
 * (the original stretched 0..1 over the canvas, so a tall phone canvas drew tall folds and a
 * small card a squashed copy of a big one); `brightness` scales the folds before the dither (the
 * original tints a 48% grey, so its cloth is mostly shadow; the same scalar in a spectrum ink is
 * mostly ink, so the default keeps it mostly partner with ink on the crests); the grain
 * (`rnd / 15 * noiseIntensity`) is one Hoskins hash per cell, not per pixel; the brightness of
 * one colour over black becomes the three levels; no light mode (the light scheme's tones do it).
 */
export const SILK_UNIFORMS = [
  ['ref', 'float'],
  ['zoom', 'float'],
  ['rotation', 'float'],
  ['noiseIntensity', 'float'],
  ['brightness', 'float'],
] as const satisfies UniformLayout;

const SILK_BODY = `
float2 rotateUv(float2 uv, float a) {
  float cs = cos(a);
  float sn = sin(a);
  return float2x2(cs, -sn, sn, cs) * uv;
}

float field(float2 c) {
  float2 vuv = float2(c.x, size.y - c.y) / ref;
  float2 tex = rotateUv(vuv / zoom, rotation) / zoom;
  float o = 5.0 * t;
  tex.y += 0.03 * sin(8.0 * tex.x - o);
  float pattern = 0.6 + 0.4 * sin(5.0 * (tex.x + tex.y + cos(3.0 * tex.x + 5.0 * tex.y) + 0.02 * o) +
                                  sin(20.0 * (tex.x + tex.y - 0.1 * o)));
  return pattern * brightness - hash12(floor(c / cell)) / 15.0 * noiseIntensity;
}
`;

// ─── 4. Grainient (react-bits `Backgrounds/Grainient/Grainient.tsx`) ─────────────────────

/**
 * The warped blend, exactly: a noise driven rotation (`rotationAmount 500`, `noiseScale 2`), two
 * sine warps (`warpFrequency 5`, `warpSpeed 2`, `warpAmplitude 50`), a blend of three colour stops
 * across a rotated axis (`blendSoftness 0.05`) and down, grain (`grainAmount 0.1`) and `contrast
 * 1.5`, on the original's stretched uv with y up. What changed: the three colour stops ARE the
 * three levels (the dark stop is paper, the middle one the partner, the light one the ink), so
 * the blend is a scalar and the gradient becomes a dithered print in one hue, which is the only
 * way a "gradient" survives the brief; gamma, saturation and light mode go (they act on RGB);
 * the value noise hash is Hoskins' `hash22`; the grain is one hash per cell.
 */
export const GRAINIENT_UNIFORMS = [
  ['zoom', 'float'],
  ['timeSpeed', 'float'],
  ['colorBalance', 'float'],
  ['warpStrength', 'float'],
  ['warpFrequency', 'float'],
  ['warpSpeed', 'float'],
  ['warpAmplitude', 'float'],
  ['blendAngle', 'float'],
  ['blendSoftness', 'float'],
  ['rotationAmount', 'float'],
  ['noiseScale', 'float'],
  ['grainAmount', 'float'],
  ['contrast', 'float'],
  ['center', 'float2'],
] as const satisfies UniformLayout;

const GRAINIENT_BODY = `
float2 hash22(float2 q) {
  float3 p3 = fract(float3(q.x, q.y, q.x) * float3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float gnoise(float2 q) {
  float2 i = floor(q);
  float2 f = fract(q);
  float2 u = f * f * (3.0 - 2.0 * f);
  float a = dot(-1.0 + 2.0 * hash22(i), f);
  float b = dot(-1.0 + 2.0 * hash22(i + float2(1.0, 0.0)), f - float2(1.0, 0.0));
  float cc = dot(-1.0 + 2.0 * hash22(i + float2(0.0, 1.0)), f - float2(0.0, 1.0));
  float d = dot(-1.0 + 2.0 * hash22(i + float2(1.0, 1.0)), f - float2(1.0, 1.0));
  return 0.5 + 0.5 * mix(mix(a, b, u.x), mix(cc, d, u.x), u.y);
}

float2x2 rot(float a) {
  float sn = sin(a);
  float cs = cos(a);
  return float2x2(cs, -sn, sn, cs);
}

float field(float2 c) {
  float tt = t * timeSpeed;
  float2 uv = float2(c.x, size.y - c.y) / size;
  float ratio = size.x / size.y;
  float2 tuv = (uv - 0.5 + center) / max(zoom, 0.001);
  float degree = gnoise(float2(tt * 0.1, tuv.x * tuv.y) * noiseScale);
  tuv.y *= 1.0 / ratio;
  tuv = tuv * rot(radians((degree - 0.5) * rotationAmount + 180.0));
  tuv.y *= ratio;
  float amplitude = warpAmplitude / max(warpStrength, 0.001);
  float warpTime = tt * warpSpeed;
  tuv.x += sin(tuv.y * warpFrequency + warpTime) / amplitude;
  tuv.y += sin(tuv.x * (warpFrequency * 1.5) + warpTime) / (amplitude * 0.5);
  float s = max(blendSoftness, 0.0);
  float blendX = (tuv * rot(radians(blendAngle))).x;
  float across = smoothstep(-0.3 - colorBalance - s, 0.2 - colorBalance + s, blendX);
  float down = 1.0 - smoothstep(-0.3 - colorBalance - s, 0.5 - colorBalance + s, tuv.y);
  float v = mix(0.5 * across, 0.5 + 0.5 * across, down);
  v += (hash12(floor(c / cell)) - 0.5) * grainAmount;
  return (v - 0.5) * contrast + 0.5;
}
`;

// ─── 5. Radar (react-bits `Backgrounds/Radar/Radar.tsx`) ─────────────────────────────────

/**
 * Rings moving out (`dist * ringCount - t`), spokes, one sweep lobe (`pow(0.5 sin(lobes theta +
 * t sweepSpeed) + 0.5, sweepWidth)`) and the falloff (`smoothstep(1.05, 0.85, d) * (1 - d)^2`),
 * with every react-bits number. What changed: the radar is placed in points (`center`, and
 * `reach`, the distance where it fades out: the original's `scale 0.5` over the canvas height,
 * i.e. the shorter side); a ring or spoke is never thinner than three quarters of a cell, or the
 * dither would break a 1.5 pt line into dots; no mouse drift and no light mode.
 */
export const RADAR_UNIFORMS = [
  ['center', 'float2'],
  ['reach', 'float'],
  ['ringCount', 'float'],
  ['spokeCount', 'float'],
  ['ringThickness', 'float'],
  ['spokeThickness', 'float'],
  ['sweepSpeed', 'float'],
  ['sweepWidth', 'float'],
  ['sweepLobes', 'float'],
  ['falloff', 'float'],
  ['brightness', 'float'],
] as const satisfies UniformLayout;

const RADAR_BODY = `
float field(float2 c) {
  float2 st = (c - center) / reach;
  st.y = -st.y;
  float dist = length(st);
  float theta = atan(st.y, st.x);
  float ringHalf = max(ringThickness, 0.75 * cell * ringCount / reach);
  float ringDist = abs(fract(dist * ringCount - t) - 0.5);
  float ringGlow = 1.0 - smoothstep(0.0, ringHalf, ringDist);
  float tau = 6.28318530718;
  float spokeAngle = abs(fract(theta * spokeCount / tau + 0.5) - 0.5) * tau / spokeCount;
  float spokeHalf = max(spokeThickness, 0.75 * cell / reach);
  float spokeGlow = (1.0 - smoothstep(0.0, spokeHalf, spokeAngle * dist)) * smoothstep(0.0, 0.1, dist);
  float sweep = pow(max(0.5 * sin(sweepLobes * theta + t * sweepSpeed) + 0.5, 0.0), sweepWidth);
  float fadeOut = (1.0 - smoothstep(0.85, 1.05, dist)) * pow(max(1.0 - dist, 0.0), falloff);
  return (ringGlow + spokeGlow + sweep) * fadeOut * brightness;
}
`;

// ─── 6. Topography (react-bits `Backgrounds/Topography/Topography.tsx`) ──────────────────

/**
 * The contour field, exactly: `distance((bez(x, A), bez(x, B)), (bez(y, C), bez(y, D)))` with
 * `bez(t, k) = 0.5 (k.x sin w + k.y cos w + k.z sin 2w + k.w cos 2w)`, the control points moved on
 * the UI thread (`topographyCtrl`, react-bits' `CTRL_INDICES`, `morphAmount 3`, `speed 0.35`,
 * `morphSpeed 0.05`), `bands 2`, the glow band (`glow 0.5` of a band past the line at `coverage
 * 0.55`, raised to `contrast 3`, so it is a faint halo) and the three colour modes. What
 * changed: a contour is `lineWidth` CELLS wide wherever the ground is steep or flat, because
 * the band distance is measured against how much the field changes one cell across (the
 * original's `fwidth`, which SkSL does not have); the halo dithers at the partner level; elevation colour picks
 * between partner and ink instead of mixing three hues; `fill` puts sparse partner cells between
 * the lines; the touch bump is a finger (`touch`, react-bits' radius 0.3 and strength 0.4); no
 * grain pass (the Bayer is the grain).
 */
export const TOPOGRAPHY_UNIFORMS = [
  ['zoom', 'float'],
  ['ctrlA', 'float4'],
  ['ctrlB', 'float4'],
  ['ctrlC', 'float4'],
  ['ctrlD', 'float4'],
  ['bands', 'float'],
  ['lineWidth', 'float'],
  ['glow', 'float'],
  ['contrast', 'float'],
  ['mode', 'float'],
  ['fill', 'float'],
  ['morph', 'float'],
  ['touch', 'float3'],
  ['touchRadius', 'float'],
  ['touchStrength', 'float'],
] as const satisfies UniformLayout;

const TOPOGRAPHY_BODY = `
float bez(float x, float4 k) {
  float w = 6.2831853 * x;
  return 0.5 * (k.x * sin(w) + k.y * cos(w) + k.z * sin(2.0 * w) + k.w * cos(2.0 * w));
}

float height(float2 c) {
  float2 uv = float2(c.x, size.y - c.y) / size;
  float2 suv = (uv - 0.5) / max(zoom, 0.001) + 0.5;
  float2 a = float2(bez(suv.x, ctrlA), bez(suv.x, ctrlB));
  float2 b = float2(bez(suv.y, ctrlC), bez(suv.y, ctrlD));
  float h = distance(a, b);
  if (touch.z > 0.0) {
    float2 d = (c - touch.xy) / size.y;
    h += exp(-dot(d, d) / (touchRadius * touchRadius)) * touchStrength * touch.z;
  }
  return h;
}

float field(float2 c) {
  float h = height(c);
  float k = h * bands;
  float kx = height(c + float2(cell, 0.0)) * bands;
  float ky = height(c + float2(0.0, cell)) * bands;
  float slope = max(abs(kx - k) + abs(ky - k), 0.0001);
  float fr = fract(k);
  float d = min(fr, 1.0 - fr);
  float lineD = 0.5 * lineWidth * slope;
  float elev = clamp(h / (morph * 2.5 + 0.001), 0.0, 1.0);
  float lineV = 1.0;
  if (mode < 0.5) {
    lineV = 0.5 + 0.5 * elev;
  } else if (mode > 1.5) {
    lineV = mod(floor(k), 2.0) > 0.5 ? 1.0 : 0.5;
  }
  float v = 0.0;
  if (d < lineD) {
    v = lineV;
  } else if (glow > 0.0) {
    v = pow((1.0 - smoothstep(lineD, lineD + glow * 0.5, d)) * 0.55, contrast) * lineV;
  }
  return max(v, fill * elev);
}
`;

// ─── 7. DotGrid (react-bits `Backgrounds/DotGrid/DotGrid.tsx`) ────────────────────────────

/**
 * A grid of dots that a tap shoves outward and that spring back: react-bits' click shock
 * (`shockRadius 250`, `shockStrength 5`, GSAP inertia with `resistance 750`, then `elastic.out(1,
 * 0.75)` over `returnDuration 1.5` s) and its proximity colour. What changed: the canvas loop and
 * GSAP's per dot tweens become one stateless program: a dot's push is `(4x(1 - x))^2` of `push`
 * cells at `x = distance / reach` (the shape of the inertia's `v^2 / 2 resistance` with the
 * original's linear falloff: it peaks halfway out), in the direction away from the tap, times an
 * envelope in time (`dotEnvelope`: the inertia's quadratic rise over `rise`, then the elastic
 * return over `settle`), up to four shocks at once (`shock0..3`: x, y in points, start in `now`
 * seconds, strength). Dots are `dotCells` square on the cell grid and move by whole cells, so the
 * grid stays Builda's grain; each cell checks the nine nearest dots, which is why `push` stays
 * under one `pitch`. The proximity lerp from `baseColor` to `activeColor` (a ramp between two
 * colours) becomes energy dithered by each dot's own Bayer value: a dot near the finger or a
 * shock switches to partner, then ink, and back to `base`, one dot at a time.
 */
export const DOT_GRID_UNIFORMS = [
  ['pitch', 'float'],
  ['dotCells', 'float'],
  ['origin', 'float2'],
  ['grid', 'float2'],
  ['base', 'half4'],
  ['now', 'float'],
  ['shock0', 'float4'],
  ['shock1', 'float4'],
  ['shock2', 'float4'],
  ['shock3', 'float4'],
  ['touch', 'float3'],
  ['proximity', 'float'],
  ['reach', 'float'],
  ['push', 'float'],
  ['rise', 'float'],
  ['settle', 'float'],
] as const satisfies UniformLayout;

const DOT_GRID_BODY = `
float envelope(float a) {
  if (a < 0.0) { return 0.0; }
  if (a < rise) {
    float k = 1.0 - a / rise;
    return 1.0 - k * k;
  }
  float q = (a - rise) / settle;
  if (q >= 1.0) { return 0.0; }
  return -pow(2.0, -10.0 * q) * sin((q - 0.1875) * 8.37758041);
}

float3 shove(float4 s, float2 d) {
  if (s.w <= 0.0) { return float3(0.0); }
  float age = now - s.z;
  if (age < 0.0 || age >= rise + settle) { return float3(0.0); }
  float2 v = d - s.xy;
  float r = length(v);
  if (r >= reach || r < 0.001) { return float3(0.0); }
  float x = r / reach;
  float m = 4.0 * x * (1.0 - x);
  float e = envelope(age);
  float2 off = v / r * (m * m * push * s.w * e);
  return float3(off, s.w * (1.0 - x) * min(abs(e) * 1.5, 1.0));
}

half4 dotTone(float e, float b) {
  if (e < 0.0078125) { return base; }
  if (levels < 2.5) { return e > b ? ink : base; }
  float s = e * 2.0;
  if (s <= 1.0) { return s > b ? partner : base; }
  return (s - 1.0) > b ? ink : partner;
}
`;

const DOT_GRID_MAIN = `
half4 main(float2 p) {
  float2 idx = floor(p * unit / cell);
  float2 c = (idx + 0.5) * cell;
  float k = frame(c);
  if (k <= 0.0) { return paper; }
  float2 near = floor((idx - origin) / pitch + 0.5);
  for (int j = 0; j < 3; j++) {
    for (int i = 0; i < 3; i++) {
      float2 g = near + float2(float(i - 1), float(j - 1));
      if (g.x < 0.0 || g.y < 0.0 || g.x >= grid.x || g.y >= grid.y) { continue; }
      float b = b8(g);
      if (k <= b) { continue; }
      float2 home = origin + g * pitch;
      float2 centre = (home + dotCells * 0.5) * cell;
      float3 a = shove(shock0, centre);
      float3 s1 = shove(shock1, centre);
      float3 s2 = shove(shock2, centre);
      float3 s3 = shove(shock3, centre);
      float2 at = home + floor(a.xy + s1.xy + s2.xy + s3.xy + 0.5);
      if (idx.x >= at.x && idx.y >= at.y && idx.x < at.x + dotCells && idx.y < at.y + dotCells) {
        float e = max(max(a.z, s1.z), max(s2.z, s3.z));
        if (touch.z > 0.0) {
          e = max(e, touch.z * max(0.0, 1.0 - length(centre - touch.xy) / proximity));
        }
        return dotTone(clamp(e, 0.0, 1.0), b);
      }
    }
  }
  return paper;
}
`;

// ─── the registry ────────────────────────────────────────────────────────────────────────

export type BackgroundName = 'FieldDither' | 'PixelBlast' | 'Silk' | 'Grainient' | 'Radar' | 'Topography' | 'DotGrid';

export interface BackgroundProgram {
  name: BackgroundName;
  /** The react-bits file it is ported from. */
  reactBits: string;
  /** Every uniform, the shared ones first, in declaration order. */
  uniforms: UniformLayout;
  source: string;
}

function entry(name: BackgroundName, reactBits: string, layout: UniformLayout, body: string, main?: string): BackgroundProgram {
  return { name, reactBits, uniforms: [...COMMON_UNIFORMS, ...layout], source: program(layout, body, main) };
}

export const PROGRAMS: Readonly<Record<BackgroundName, BackgroundProgram>> = {
  FieldDither: entry('FieldDither', 'Backgrounds/Dither/Dither.tsx', DITHER_WAVES_UNIFORMS, DITHER_WAVES_BODY),
  PixelBlast: entry('PixelBlast', 'Backgrounds/PixelBlast/PixelBlast.tsx', PIXEL_BLAST_UNIFORMS, PIXEL_BLAST_BODY),
  Silk: entry('Silk', 'Backgrounds/Silk/Silk.tsx', SILK_UNIFORMS, SILK_BODY),
  Grainient: entry('Grainient', 'Backgrounds/Grainient/Grainient.tsx', GRAINIENT_UNIFORMS, GRAINIENT_BODY),
  Radar: entry('Radar', 'Backgrounds/Radar/Radar.tsx', RADAR_UNIFORMS, RADAR_BODY),
  Topography: entry('Topography', 'Backgrounds/Topography/Topography.tsx', TOPOGRAPHY_UNIFORMS, TOPOGRAPHY_BODY),
  DotGrid: entry('DotGrid', 'Backgrounds/DotGrid/DotGrid.tsx', DOT_GRID_UNIFORMS, DOT_GRID_BODY, DOT_GRID_MAIN),
};

export const BACKGROUND_NAMES = Object.keys(PROGRAMS) as BackgroundName[];
