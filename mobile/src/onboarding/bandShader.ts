/**
 * The onboarding band's program, and the JavaScript twin of its rules so `bun test` can hold
 * them without a GPU. Pure: no React Native.
 *
 * It is the analysis page's band (`insights/Band.tsx`: a full bleed field of the hue that PRINTS
 * ITSELF, its cells arriving in the step's own order (`STEP_MOTION`), then a dissolve under it
 * through the 8x8 Bayer dither into the warm ground) with one thing added for the creature step:
 * the band can change hue, and when it does its cells switch from the old hue to the new one in
 * a second random order, a block of four cells at a time (react-bits PixelTransition's order),
 * so the colour changes by pixels and never by a blend.
 *
 * Nothing is copied: the Bayer threshold and the hash are the kit's own SkSL (`BAYER_SKSL`,
 * `HASH_SKSL` in `ui/bits/components/fills.ts`, held to `bayer8` and to onboarding's `hash12`
 * by the kit's tests), composed here.
 */
import { BAYER_SKSL, HASH_SKSL } from '../ui/bits/components/fills';
import { cellOrderWith, orderSksl, type PixelMotion } from '../motion/pixelMotion';
import { hash12 } from './shaders';

export const STEP_BAND_SKSL = `
uniform float cell;
uniform float solid;
uniform float fringe;
uniform float reveal;
uniform float shift;
uniform float block;
uniform half4 ink0;
uniform half4 ink1;
uniform float mode;
uniform float cols;
uniform float rows;
uniform float2 origin;
${BAYER_SKSL}
${HASH_SKSL}
${orderSksl('hash12')}
half4 main(float2 p) {
  float2 c = floor(p / cell);
  float y = (c.y + 0.5) * cell;
  float d = y < solid ? 1.0 : clamp(1.0 - (y - solid) / fringe, 0.0, 1.0);
  if (d <= 0.0) { return half4(0.0); }
  float on = b8(p / cell) < d * 0.999 ? 1.0 : 0.0;
  float order = orderOf(c, mode, cols, rows, origin);
  float arrived = order < reveal * 1.02 ? 1.0 : 0.0;
  half4 ink = hash12(floor(p / block) + float2(71.0, 113.0)) < shift ? ink1 : ink0;
  return ink * half(on * arrived);
}`;

/**
 * When a cell of the band arrives, 0 first to 1 last, in the step's order (`motion/pixelMotion.ts`
 * over `hash12`, the program's twin). `rain`, random biased to the top, is the old print.
 */
export function bandArrival(col: number, row: number, cell: number, total: number, motion: PixelMotion = 'rain', cols = 1): number {
  const rows = Math.max(1, Math.ceil(total / cell));
  return cellOrderWith(hash12, motion, col, row, cols, rows);
}

/**
 * Each onboarding step prints its band its own way, all eight different, so the flow reads as a
 * sequence of distinct pages rather than one page eight times: hello opens from the centre, the
 * name scans in, the creature's stage lands in blocks, the tools interlace, connect ripples out,
 * notifications rise, done wipes across, the app icon picker rains.
 */
export const STEP_MOTION = {
  hello: 'spiral',
  name: 'scan',
  creature: 'blocks',
  tools: 'interlace',
  connect: 'ripple',
  notify: 'rise',
  done: 'wipe',
  icon: 'rain',
} as const satisfies Record<string, PixelMotion>;

/** Whether the block a point sits in has switched to the new hue at `shift` (0 to 1). */
export function bandShifted(x: number, y: number, block: number, shift: number): boolean {
  return hash12(Math.floor(x / block) + 71, Math.floor(y / block) + 113) < shift;
}

/** The density of the band at a height: whole across the band, falling to none over the fringe. */
export function bandDensity(y: number, solid: number, fringe: number): number {
  if (y < solid) return 1;
  if (!(fringe > 0)) return 0;
  return Math.min(1, Math.max(0, 1 - (y - solid) / fringe));
}
