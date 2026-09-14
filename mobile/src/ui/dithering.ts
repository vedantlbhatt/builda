import { tokens } from '../generated/tokens';

/**
 * Builda's one texture: a 1-bit, one-hue dither (DESIGN-DIRECTION 6 and 8). Everything
 * here is pure so the tests can hold it, and so a data field (a contribution grid, a
 * session strip) is computed once in JS at exactly the resolution the shader dithers at.
 *
 * Algorithm from react-bits `Backgrounds/Dither/Dither.tsx` (8x8 Bayer) and
 * `Backgrounds/PixelBlast/PixelBlast.tsx` (arithmetic Bayer) by David Haz, MIT + Commons
 * Clause; the notice is in `digits.ts`. One hue: the scalar ink amount is dithered, never
 * RGB per channel (quantising channels shifts amber toward brown).
 *
 * Changes from the SkSL in DESIGN-DIRECTION 6, each for a reason:
 * - `px` (one device pixel, in points) replaces `1.0 / cell` as the halftone's edge width.
 *   The canvas works in points, so `cell` is 3 (3pt = 3 x PixelRatio device pixels, the
 *   doc's number) and a one-pixel edge is `px / cell` in cell units.
 * - A transparent source reads as paper (`ink01` unpremultiplies and scales by alpha).
 *   The doc's version reads transparent as black, which inks every empty pixel.
 * - The halftone returns paper where there is no ink at all. Without it the anti-aliased
 *   edge of a zero-radius dot leaves a faint grey pixel at every dot centre on white.
 * - Ink under 0.002 is zero. In half precision `1 - luma(white)` comes out a hair above 0,
 *   which inked every 64th cell and specked the halftone (seen in a CanvasKit render). The
 *   dead zone is under one 8-bit grey level (1/255), so a source grey of 254 still inks.
 */
export const DITHER_SKSL = `
uniform shader art;
uniform float cell;
uniform float mode;
uniform float t;
uniform float px;
uniform half4 ink;
uniform half4 paper;

float b2(float2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
float b8(float2 a) { return b2(a * 0.25) * 0.0625 + b2(a * 0.5) * 0.25 + b2(a); }

float ink01(float2 c) {
  half4 s = art.eval(c);
  if (s.a <= 0.0) { return 0.0; }
  float v = (1.0 - dot(s.rgb / s.a, half3(0.2126, 0.7152, 0.0722))) * s.a;
  return v < 0.002 ? 0.0 : v;
}

half4 main(float2 p) {
  if (mode < 0.5) {
    float v = ink01((floor(p / cell) + 0.5) * cell);
    return v > b8(p / cell + t * 0.3) ? ink : paper;
  }
  const float a = 0.7853982;
  float2x2 R  = float2x2(cos(a), -sin(a), sin(a), cos(a));
  float2x2 Ri = float2x2(cos(a),  sin(a), -sin(a), cos(a));
  float2 q = R * (p / cell);
  float v = ink01(Ri * (floor(q) + 0.5) * cell);
  if (v <= 0.0) { return paper; }
  float r = sqrt(clamp(v, 0.0, 1.0)) * 0.72;
  float w = px / cell;
  return mix(paper, ink, half(1.0 - smoothstep(r - w, r + w, length(fract(q) - 0.5))));
}
`;

export type DitherMode = 'bayer' | 'halftone';

/** Uniform value for `mode`. */
export function modeUniform(mode: DitherMode): number {
  return mode === 'halftone' ? 1 : 0;
}

// ─── the threshold ─────────────────────────────────────────────────────────────────────

function fract(x: number): number {
  return x - Math.floor(x);
}

/** 2x2 Bayer by arithmetic: 0, 0.5, 0.75, 0.25. Line for line the SkSL `b2`. */
export function bayer2(x: number, y: number): number {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  return fract(fx * 0.5 + fy * fy * 0.75);
}

/**
 * The 8x8 ordered-dither threshold at cell (x, y), in [0, 63/64]. The SkSL `b8`, and the
 * same arithmetic as `bayer8` in scripts/gen_tokens.py, which asserts it against
 * `tokens.dither.bayer8` at generation time.
 */
export function bayer8(x: number, y: number): number {
  return bayer2(x * 0.25, y * 0.25) * 0.0625 + bayer2(x * 0.5, y * 0.5) * 0.25 + bayer2(x, y);
}

/** The table in design/tokens.json, for code that wants a lookup rather than arithmetic. */
export const BAYER8: readonly (readonly number[])[] = tokens.dither.bayer8;

/** Ink when the value is STRICTLY above the threshold, so 0 stays paper and 1 is solid. */
export function isInk(value: number, x: number, y: number): boolean {
  return value > bayer8(x, y);
}

/** Halftone dot radius in cell units for an ink amount: HalftoneReveal's rule. */
export function halftoneRadius(value: number): number {
  return Math.sqrt(Math.min(1, Math.max(0, value))) * tokens.dither.halftoneRadius;
}

// ─── fields: greyscale sources made from data ──────────────────────────────────────────

/** Ink amounts 0..1, row major, one entry per dither cell. */
export interface Field {
  width: number;
  height: number;
  data: Float32Array;
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** Whole cells that fit in a `width` x `height` point box, and the box they fill exactly. */
export function fitCells(width: number, height: number, cell: number) {
  const cols = Math.max(1, Math.floor(width / cell));
  const rows = Math.max(1, Math.floor(height / cell));
  return { cols, rows, width: cols * cell, height: rows * cell };
}

/** A field from a function of the cell centre in unit coordinates (u, v in 0..1). */
export function fieldFromFunction(width: number, height: number, fn: (u: number, v: number) => number): Field {
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data[y * width + x] = clamp01(fn((x + 0.5) / width, (y + 0.5) / height));
  }
  return { width, height, data };
}

/** [start, end) of the `i`th of `n` equal spans across `size` cells, on whole cells. */
function span(i: number, n: number, size: number): [number, number] {
  return [Math.floor((i * size) / n), Math.floor(((i + 1) * size) / n)];
}

export interface GridFieldOptions {
  /** Cells of paper after each datum, right and bottom, when the datum is 3+ cells wide. */
  gap?: number;
}

/**
 * A 2D grid of 0..1 values (rows of columns: a contribution graph's weeks by days, say),
 * each datum a block of cells with a paper gap after it, so the dither shows levels as
 * density and the grid still reads as a grid.
 */
export function fieldFromGrid(
  grid: readonly (readonly number[])[],
  width: number,
  height: number,
  options: GridFieldOptions = {},
): Field {
  const gap = Math.max(0, Math.floor(options.gap ?? 1));
  const rows = grid.length;
  const cols = grid.reduce((m, r) => Math.max(m, r.length), 0);
  const data = new Float32Array(width * height);
  if (rows === 0 || cols === 0) return { width, height, data };
  for (let r = 0; r < rows; r++) {
    const [y0, y1] = span(r, rows, height);
    const yGap = y1 - y0 >= 3 ? gap : 0;
    for (let c = 0; c < cols; c++) {
      const [x0, x1] = span(c, cols, width);
      const xGap = x1 - x0 >= 3 ? gap : 0;
      const v = clamp01(grid[r]?.[c] ?? 0);
      for (let y = y0; y < y1 - yGap; y++) {
        for (let x = x0; x < x1 - xGap; x++) data[y * width + x] = v;
      }
    }
  }
  return { width, height, data };
}

export interface SeriesFieldOptions {
  /**
   * `band`: every column's density is its value, full height (a session strip).
   * `area`: a filled chart, a solid top edge over a `fill` density body (a trend).
   */
  shape?: 'band' | 'area';
  /** Density under the edge in `area`. Default 0.5, the checkerboard. */
  fill?: number;
}

/**
 * A 1D series of 0..1 values across the width. A long series is averaged into columns for
 * `band` (density is a mean) and maxed for `area` (a peak must not vanish).
 */
export function fieldFromSeries(
  series: readonly number[],
  width: number,
  height: number,
  options: SeriesFieldOptions = {},
): Field {
  const shape = options.shape ?? 'band';
  const fill = clamp01(options.fill ?? 0.5);
  const data = new Float32Array(width * height);
  const n = series.length;
  if (n === 0) return { width, height, data };
  for (let x = 0; x < width; x++) {
    const [s0, s1raw] = span(x, width, n);
    const s1 = Math.max(s1raw, s0 + 1);
    let sum = 0;
    let max = 0;
    for (let i = s0; i < s1; i++) {
      const v = clamp01(series[Math.min(i, n - 1)] ?? 0);
      sum += v;
      if (v > max) max = v;
    }
    if (shape === 'band') {
      const v = sum / (s1 - s0);
      for (let y = 0; y < height; y++) data[y * width + x] = v;
    } else {
      const h = max > 0 ? Math.max(1, Math.round(max * height)) : 0;
      for (let k = 0; k < h; k++) {
        const y = height - 1 - k;
        data[y * width + x] = k === h - 1 ? 1 : fill;
      }
    }
  }
  return { width, height, data };
}

// ─── bytes, masks, colours ─────────────────────────────────────────────────────────────

/** The ink amount the shader will actually see after the field goes through 8-bit grey. */
export function quantize(value: number): number {
  return 1 - Math.round((1 - clamp01(value)) * 255) / 255;
}

/** RGBA8888 bytes for the field: grey = paper where there is no ink, black where it is full. */
export function fieldToRGBA(field: Field): Uint8Array {
  const out = new Uint8Array(field.width * field.height * 4);
  for (let i = 0; i < field.width * field.height; i++) {
    const g = Math.round((1 - clamp01(field.data[i] ?? 0)) * 255);
    out[i * 4] = g;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = g;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * What the ordered-dither shader draws for this field at t = 0, one bit per cell (1 ink,
 * 0 paper). The same arithmetic as the GPU, so a 1-bit PNG for a widget or the Mac can be
 * written from it and match the phone cell for cell.
 */
export function ditherMask(field: Field): Uint8Array {
  const out = new Uint8Array(field.width * field.height);
  for (let y = 0; y < field.height; y++) {
    for (let x = 0; x < field.width; x++) {
      const i = y * field.width + x;
      out[i] = isInk(quantize(field.data[i] ?? 0), x, y) ? 1 : 0;
    }
  }
  return out;
}

/** `#RRGGBB` (or `transparent`) as a premultiplied RGBA uniform, 0..1 per channel. */
export function premultiplied(color: string, alpha: number = 1): [number, number, number, number] {
  if (color === 'transparent') return [0, 0, 0, 0];
  const m = /^#?([0-9a-f]{6})$/i.exec(color);
  if (!m) throw new Error(`dither colours are #RRGGBB from the tokens, got ${color}`);
  const n = parseInt(m[1]!, 16);
  const a = clamp01(alpha);
  return [(((n >> 16) & 255) / 255) * a, (((n >> 8) & 255) / 255) * a, ((n & 255) / 255) * a, a];
}
