/**
 * The two SkSL programs onboarding draws with, and the JavaScript twin of their hash so the
 * tests can hold the ordering rules without a GPU.
 *
 * Pixel cell logic from react-bits PixelTransition by David Haz, MIT + Commons Clause
 * (Copyright (c) 2026 David Haz; the full notice is in `src/ui/digits.ts`; used as part of this
 * application, not redistributed). What changed: the web version hides and shows a grid of
 * divs with a random GSAP stagger; here one runtime shader decides every cell from a hash, so
 * the order is fixed per cell and the whole thing is one draw.
 *
 * The hash is Dave Hoskins' `hash12` (no sine, so it is the same on every GPU precision),
 * written out once in SkSL and once in JavaScript below.
 */

const HASH = `
float hash12(float2 c) {
  float3 p3 = fract(float3(c.x, c.y, c.x) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}`;

/**
 * Hello to the name step. `snapshot` is a picture of the hello screen; the name step is
 * already mounted underneath. The grid is laid from `anchor` (Bit's top left corner, so cell
 * edges fall between Bit's pixels). A cell's turn `h` is `wave` times its centre's distance
 * from `origin` (the Continue that was pressed) over `span`, plus `jitter` times its hash:
 * a ragged front moving out of the finger. A cell whose turn is below `progress` has switched
 * and the name step shows through; one switching this frame (inside `band` of the front) is
 * a solid `flash` square. Everything else is still hello.
 */
export const DISSOLVE_SKSL = `
uniform shader snapshot;
uniform float cell;
uniform float2 anchor;
uniform float2 origin;
uniform float span;
uniform float wave;
uniform float jitter;
uniform float progress;
uniform float band;
uniform half4 flash;
${HASH}
half4 main(float2 p) {
  float2 idx = floor((p - anchor) / cell);
  float d = length(anchor + (idx + 0.5) * cell - origin);
  float h = wave * clamp(d / span, 0.0, 1.0) + jitter * hash12(idx);
  if (h < progress - band) { return half4(0.0); }
  if (h < progress) { return flash; }
  return snapshot.eval(p);
}`;

/**
 * The "That's me" burst: one ring of pixel squares leaving `center`. A cell is lit while the
 * ring passes over its centre and its hash is under a density that falls to zero as the ring
 * travels, so the squares thin out rather than fade.
 */
export const BURST_SKSL = `
uniform float2 center;
uniform float cell;
uniform float p;
uniform float r0;
uniform float r1;
uniform float ring;
uniform float density;
uniform half4 ink;
${HASH}
half4 main(float2 pt) {
  if (p <= 0.0 || p >= 1.0) { return half4(0.0); }
  float2 c = floor(pt / cell);
  float d = length((c + 0.5) * cell - center);
  float e = 1.0 - (1.0 - p) * (1.0 - p) * (1.0 - p);
  float r = mix(r0, r1, e);
  if (abs(d - r) > ring * 0.5) { return half4(0.0); }
  if (hash12(c) >= density * (1.0 - p)) { return half4(0.0); }
  return ink;
}`;

/** `hash12` in JavaScript, bit for bit the same arithmetic as the shader's (in doubles). */
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

export type CellState = 'old' | 'flash' | 'new';

/** What the dissolve shader draws for a cell whose turn is `h` at `progress`. */
export function dissolveCell(h: number, progress: number, band: number): CellState {
  if (h < progress - band) return 'new';
  if (h < progress) return 'flash';
  return 'old';
}

/**
 * The dissolve's geometry, the shader's `h` in JavaScript: when the cell at grid index
 * (`ix`, `iy`) turns, from 0 to `wave + jitter`.
 */
export function dissolveTurn(
  ix: number,
  iy: number,
  g: { cell: number; anchor: readonly [number, number]; origin: readonly [number, number]; span: number; wave: number; jitter: number },
): number {
  const cx = g.anchor[0] + (ix + 0.5) * g.cell;
  const cy = g.anchor[1] + (iy + 0.5) * g.cell;
  const d = Math.hypot(cx - g.origin[0], cy - g.origin[1]);
  const reach = g.span > 0 ? Math.min(1, Math.max(0, d / g.span)) : 0;
  return g.wave * reach + g.jitter * hash12(ix, iy);
}

/**
 * The distance from `origin` to the farthest corner of a `width` by `height` screen: the
 * wave's `span`, so the last cell turns as the progress reaches the end.
 */
export function waveSpan(origin: readonly [number, number], width: number, height: number): number {
  const xs = [0, width];
  const ys = [0, height];
  let far = 0;
  for (const x of xs) for (const y of ys) far = Math.max(far, Math.hypot(x - origin[0], y - origin[1]));
  return far;
}

/** An sRGB hex colour as the premultiplied 0..1 vector a `half4` uniform takes. */
export function colorUniform(hex: string, alpha = 1): [number, number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0, 0];
  const n = parseInt(m[1]!, 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  return [r * alpha, g * alpha, b * alpha, alpha];
}
