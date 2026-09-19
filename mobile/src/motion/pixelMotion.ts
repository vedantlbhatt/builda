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
function fnv(s: string): number {
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

/** The shader's hash, in JS, so a JS print and a shader band scatter alike. */
export function cellHash(x: number, y: number, seed = 0): number {
  const v = Math.sin((x + seed * 7.13) * 12.9898 + (y + seed * 3.7) * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * When cell (x, y) of a `cols` by `rows` grid switches on, 0 to 1. `origin` is the ripple's centre
 * as a fraction of the grid (a tap), defaulting to the top left.
 */
export function cellOrder(m: PixelMotion, x: number, y: number, cols: number, rows: number, seed = 0, origin: { x: number; y: number } = { x: 0, y: 0 }): number {
  const u = cols <= 1 ? 0 : x / (cols - 1);
  const v = rows <= 1 ? 0 : y / (rows - 1);
  const h = cellHash(x, y, seed);
  switch (m) {
    case 'rain':
      return clamp01(h * 0.55 + v * 0.45);
    case 'scan':
      return clamp01(v * 0.9 + h * 0.1);
    case 'ripple': {
      const aspect = rows > 0 ? cols / Math.max(1, rows) : 1;
      const dx = (u - origin.x) * aspect;
      const dy = v - origin.y;
      const far = Math.hypot(Math.max(origin.x, 1 - origin.x) * aspect, Math.max(origin.y, 1 - origin.y)) || 1;
      return clamp01((Math.hypot(dx, dy) / far) * 0.85 + h * 0.15);
    }
    case 'rise': {
      // Each column has its own speed; within a column, the foot first.
      const speed = 0.45 + 0.55 * cellHash(x, 0, seed + 11);
      return clamp01((1 - v) * speed + h * 0.08);
    }
    case 'interlace':
      return clamp01(((x + y) % 2) * 0.5 + v * 0.42 + h * 0.08);
    case 'blocks': {
      const bx = Math.floor(x / 8);
      const by = Math.floor(y / 8);
      return clamp01(cellHash(bx, by, seed + 5) * 0.72 + h * 0.28);
    }
    case 'spiral': {
      const dx = u - 0.5;
      const dy = v - 0.5;
      const r = Math.min(1, Math.hypot(dx, dy) / 0.7072);
      const a = (Math.atan2(dy, dx) / (2 * Math.PI) + 0.5) % 1;
      return clamp01(r * 0.7 + a * 0.22 + h * 0.08);
    }
    case 'wipe':
      return clamp01(u * 0.82 + h * 0.18);
  }
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
