/**
 * How a pixel surface arrives. PURE, so `__tests__/pixelMotion.test.ts` holds it.
 *
 * The pixels are Builda's identity and they stay: bands in the 1-bit ordered dither with their
 * dissolve, creatures in whole cells, prints. What made every screen look the same was never the
 * pixels, it was that every one of them arrived THE SAME WAY (the same half second of random
 * cells biased downwards, on 52 bands across 30 screens). So each item gets its own arrival from a
 * small set of orders that each read as a different physical thing, chosen by the item's own name
 * (so a band always arrives the same way), and a page hands out the next free order when two of
 * its bands would share one (`takeOrder`, through `insights/reveal.RevealPage`).
 *
 * Every order maps a cell to a number in [0, 1]: when in the arrival it switches on. The band's
 * shader (`insights/Band.tsx`) carries the same formulas in SkSL; the creature and tile prints use
 * these in JS through `PixelField`. `mode` is the order's index in `PIXEL_MOTIONS`, which is also
 * the shader's `mode` uniform, so the two can never name different orders.
 */

export const PIXEL_MOTIONS = [
  /** Random cells, a little biased down: the original print, kept as one of the eight. */
  'rain',
  /** Row by row with a ragged edge, a CRT drawing its frame. */
  'scan',
  /** Out from a point in rings: from where you touched, else the top left. */
  'ripple',
  /** Each column fills from its foot at its own rate, a level meter settling. */
  'rise',
  /** Every other cell, then the rest: an interlaced frame's two fields. */
  'interlace',
  /** Eight-cell blocks land in a random order and fill in: a progressive image loading. */
  'blocks',
  /** Round from the centre outward: a lens opening. */
  'spiral',
  /** Left to right with a stagger, a page turned over. */
  'wipe',
] as const;

export type PixelMotion = (typeof PIXEL_MOTIONS)[number];

/** FNV-1a, 32 bit: the same stable pick on every device and every launch. */
export function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The order an item arrives in, from its own name. */
export function motionFor(key: string): PixelMotion {
  return PIXEL_MOTIONS[fnv(key) % PIXEL_MOTIONS.length]!;
}

export function modeOf(m: PixelMotion): number {
  return PIXEL_MOTIONS.indexOf(m);
}

/** The band shader's hash, in JS, so a JS print and a shader band scatter alike. */
export function cellHash(x: number, y: number, seed = 0): number {
  const v = Math.sin((x + seed * 7.13) * 12.9898 + (y + seed * 3.7) * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** A 2D hash in [0, 1): the band's sine one, or onboarding's sine-free `hash12`. */
export type Hash2 = (x: number, y: number) => number;

/**
 * When cell (x, y) of a `cols` by `rows` grid switches on, 0 to 1, under hash `H`. The SkSL twin is
 * `orderSksl` below, cell for cell. `origin` is the ripple's centre as a fraction of the grid (a
 * tap), defaulting to the top left.
 */
export function cellOrderWith(H: Hash2, m: PixelMotion, x: number, y: number, cols: number, rows: number, origin: { x: number; y: number } = { x: 0, y: 0 }): number {
  const u = cols <= 1 ? 0 : x / (cols - 1);
  const v = rows <= 1 ? 0 : y / (rows - 1);
  const h = H(x, y);
  switch (m) {
    case 'rain':
      return clamp01(h * 0.55 + v * 0.45);
    case 'scan':
      return clamp01(v * 0.9 + h * 0.1);
    case 'ripple': {
      const aspect = cols / Math.max(1, rows);
      const dx = (u - origin.x) * aspect;
      const dy = v - origin.y;
      const far = Math.hypot(Math.max(origin.x, 1 - origin.x) * aspect, Math.max(origin.y, 1 - origin.y)) || 1;
      return clamp01((Math.hypot(dx, dy) / far) * 0.85 + h * 0.15);
    }
    case 'rise': {
      // Each column has its own speed; within a column, the foot first.
      const speed = 0.45 + 0.55 * H(x + 78.43, 40.7);
      return clamp01((1 - v) * speed + h * 0.08);
    }
    case 'interlace':
      return clamp01(((x + y) % 2) * 0.5 + v * 0.42 + h * 0.08);
    case 'blocks':
      return clamp01(H(Math.floor(x / 8) + 35.65, Math.floor(y / 8) + 18.5) * 0.72 + h * 0.28);
    case 'spiral': {
      const dx = u - 0.5;
      const dy = v - 0.5;
      const r = Math.min(1, Math.hypot(dx, dy) / 0.7072);
      const a = (((Math.atan2(dy, dx) / (2 * Math.PI) + 0.5) % 1) + 1) % 1;
      return clamp01(r * 0.7 + a * 0.22 + h * 0.08);
    }
    case 'wipe':
      return clamp01(u * 0.82 + h * 0.18);
  }
}

/** `cellOrderWith` under the band's sine hash, `seed` shifting the scatter. */
export function cellOrder(m: PixelMotion, x: number, y: number, cols: number, rows: number, seed = 0, origin: { x: number; y: number } = { x: 0, y: 0 }): number {
  return cellOrderWith((a, b) => cellHash(a, b, seed), m, x, y, cols, rows, origin);
}

/**
 * `cellOrderWith` in SkSL, calling a hash named `H` the program already defines (`hash` in the
 * band, onboarding's sine-free `hash12` in the step band). Seven thresholds on `mode` and the last
 * order as the fall through, in `PIXEL_MOTIONS` order.
 */
export function orderSksl(H: string): string {
  return `
float orderOf(float2 c, float mode, float cols, float rows, float2 origin) {
  float u = cols <= 1.0 ? 0.0 : c.x / (cols - 1.0);
  float v = rows <= 1.0 ? 0.0 : c.y / (rows - 1.0);
  float h = ${H}(c);
  if (mode < 0.5) { return h * 0.55 + v * 0.45; }
  if (mode < 1.5) { return v * 0.9 + h * 0.1; }
  if (mode < 2.5) {
    float aspect = cols / max(1.0, rows);
    float2 d = float2((u - origin.x) * aspect, v - origin.y);
    float far = length(float2(max(origin.x, 1.0 - origin.x) * aspect, max(origin.y, 1.0 - origin.y)));
    return length(d) / max(far, 0.0001) * 0.85 + h * 0.15;
  }
  if (mode < 3.5) {
    float speed = 0.45 + 0.55 * ${H}(float2(c.x + 78.43, 40.7));
    return (1.0 - v) * speed + h * 0.08;
  }
  if (mode < 4.5) { return mod(c.x + c.y, 2.0) * 0.5 + v * 0.42 + h * 0.08; }
  if (mode < 5.5) { return ${H}(floor(c / 8.0) + float2(35.65, 18.5)) * 0.72 + h * 0.28; }
  if (mode < 6.5) {
    float2 d = float2(u - 0.5, v - 0.5);
    float r = min(1.0, length(d) / 0.7072);
    float a = fract(atan(d.y, d.x) / 6.2831853 + 0.5);
    return r * 0.7 + a * 0.22 + h * 0.08;
  }
  return u * 0.82 + h * 0.18;
}`;
}

/**
 * A page's next order for a band whose own is `own`: its own when free, else the next free one,
 * and marked taken. Once every order is taken (a page of nine bands) they repeat from `own`.
 */
export function takeOrder(taken: Set<number>, own: number, count: number = PIXEL_MOTIONS.length): number {
  let o = own % count;
  if (taken.size < count) {
    while (taken.has(o)) o = (o + 1) % count;
    taken.add(o);
  }
  return o;
}

/**
 * How a screen's one counting number arrives (`insights/Num.tsx`: only the first number on a
 * page moves). Four ways, so the number that moves is not the same movement on every screen:
 *
 *   count      up from zero on the page's curve (react-bits CountUp, the original)
 *   scramble   every digit spins and they settle left to right, a split flap board
 *   type       the characters arrive left to right, a terminal printing its answer
 *   tick       up in ten steps, a mechanical counter clicking over
 */
export const NUM_MOTIONS = ['count', 'scramble', 'type', 'tick'] as const;
export type NumMotion = (typeof NUM_MOTIONS)[number];

export function numMotionFor(key: string): NumMotion {
  return NUM_MOTIONS[fnv(`num:${key}`) % NUM_MOTIONS.length]!;
}

/**
 * The text a number shows at `p` (0 to 1, already eased) of its arrival, for the three motions
 * that are not a plain count (`count` is `formatWith(fmt, value * p)` in Num). A worklet: it runs
 * on the UI thread every frame of the arrival. `tick` needs the count's own formatter, so Num
 * computes it; here it is only the step.
 */
export function numFrame(motion: number, final: string, p: number, frame: number): string {
  'worklet';
  if (p >= 1) return final;
  const n = final.length;
  if (motion === 1) {
    let out = '';
    for (let i = 0; i < n; i++) {
      const c = final.charCodeAt(i);
      const settle = 0.15 + (0.8 * (i + 1)) / (n + 1);
      if (c < 48 || c > 57 || p >= settle) {
        out += final[i];
      } else {
        const v = Math.sin((frame + i * 7) * 12.9898 + i * 78.233) * 43758.5453;
        out += String.fromCharCode(48 + Math.floor((v - Math.floor(v)) * 10));
      }
    }
    return out;
  }
  if (motion === 2) {
    const k = Math.ceil(p * n);
    return final.slice(0, k);
  }
  return final;
}

/** `tick`'s step: the count held on tenths. */
export function tickStep(p: number): number {
  'worklet';
  return p >= 1 ? 1 : Math.floor(p * 10) / 10;
}
