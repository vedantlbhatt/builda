/**
 * A drop's sigil: a pixel glyph grown from the drop's own link, in its kind's hue.
 *
 * WHY A NEW GENERATOR AND NOT THE MASCOT. `src/pixel/` draws Bit and the eight animals from
 * hand authored frames, which is right for a cast of nine that has to be recognisable. A board
 * has a hundred drops and no two should look alike, so these are GROWN, not drawn: the same
 * link always makes the same sigil, on every device, with nothing stored.
 *
 * It keeps the pixel family's rules, because they are what makes a grid of cells read as an
 * object rather than as noise (`src/pixel/animals.ts` and the bun tests that hold it):
 *
 *   ONE INK AND ONE PARTNER.   The kind's hue, and its dither partner. Never a third colour,
 *                              never a gradient, never the ink at reduced opacity.
 *   A LIVE AREA.               13x13, with the outer ring always empty, so a sigil never
 *                              touches its own edge and two of them side by side stay apart.
 *   MIRRORED.                  Left and right are the same. Every glyph in the family faces
 *                              forward, and a mirrored grid is the cheapest way a random field
 *                              reads as made rather than spilled.
 *   NO ONE CELL THIN PARTS.    A cell with fewer than two orthogonal neighbours is removed,
 *                              repeatedly, until none is left. This single rule is the whole
 *                              difference between an identicon and something that looks drawn.
 *   A CORE.                    The middle 2x2 is always ink, so every sigil has a centre and no
 *                              hash can produce an empty one.
 *
 * WHAT MOVES, AND WHY IT IS NOT A BREATH. The mascot idles with a breath; repeating that here
 * would be the same animation a third time. A sigil's motion says the drop's STATE instead:
 * it GROWS cell by cell in hash order while the Mac is reading the link, holds still once it is
 * planned, and runs a single bright cell down its spine while one of its moves is running. Three
 * states, three motions, each one information (`Sigil.tsx`).
 */

/** The grid. Odd, so there is a true centre column to mirror about. */
export const SIZE = 13;
/** The outer ring is always empty: a sigil never touches its own edge. */
export const MARGIN = 1;

export type Cell = 0 | 1 | 2; // empty | ink | partner

/** FNV-1a, 32 bit. The same hash `src/live/crew.ts` picks a session's creature with. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * A deterministic bit stream from one seed. xorshift32, which is the smallest generator that
 * passes an eyeball test at this size; `Math.random` would make a sigil that changes on every
 * render, and a hash's raw bits run out after 32 of them.
 */
export function stream(seed: number): () => number {
  let x = seed || 0x9e3779b9;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x;
  };
}

/** Rows of cells, `SIZE` by `SIZE`. */
export type Grid = Cell[][];

function blank(): Grid {
  return Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => 0 as Cell));
}

/**
 * How much of the live area a finished sigil fills. MEASURED by eye over the corpus's links:
 * under 0.24 the glyphs read as specks, over 0.42 they read as blobs, and the family's own rule
 * is that two siblings stay within 15% of the mean mass, so this is a target rather than a
 * probability.
 */
const TARGET_FILL = 0.33;
/** How much of the filled area is the partner tone rather than the ink. */
const PARTNER_SHARE = 0.3;

/**
 * Grow a sigil OUTWARD FROM ITS CORE, one cell at a time.
 *
 * The first version filled the half grid at random and then eroded every thin part. It does not
 * work: erosion run to a fixed point removes far more than it leaves (MEASURED: a 0.42 field
 * came back at 0.05 mass, nine cells, three sigils in a row that were all a square), because a
 * random field is almost entirely thin parts. Accretion has the property the erosion pass was
 * trying to buy: every cell is placed NEXT TO one that is already there, so the result is
 * connected by construction and reads as one object. Growth is the shape of the thing and the
 * animation both.
 */
export function grow(seed: string): Grid {
  const next = stream(fnv1a32(seed));
  const g = blank();
  const mid = (SIZE - 1) / 2;
  const lo = MARGIN;
  const hi = SIZE - 1 - MARGIN;
  const live = (hi - lo + 1) * (hi - lo + 1);
  const target = Math.round(live * TARGET_FILL);

  const put = (r: number, c: number, tone: Cell) => {
    g[r][c] = tone;
    g[r][SIZE - 1 - c] = tone;
  };

  // The core: a 2x2 of ink about the centre, so every sigil has a middle and none is empty.
  for (const r of [mid - 1, mid]) for (const c of [mid - 1, mid]) put(r, c, 1);

  const DIRS: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  let filled = 0;
  for (const row of g) for (const cell of row) if (cell) filled++;

  // Bounded: a walk that keeps landing outside the live area must not spin. The bound is
  // generous (twenty tries per cell wanted) and reaching it simply ends the growth, which is a
  // slightly sparser sigil and never a hang.
  let guard = target * 20;
  const frontier: [number, number][] = [[mid - 1, mid - 1], [mid, mid - 1]];
  while (filled < target && guard-- > 0 && frontier.length) {
    const from = frontier[next() % frontier.length];
    const [dr, dc] = DIRS[next() % 4];
    const r = from[0] + dr;
    const c = from[1] + dc;
    if (r < lo || r > hi || c < lo || c > mid) continue;
    if (g[r][c]) continue;
    const tone: Cell = next() / 0xffffffff < PARTNER_SHARE ? 2 : 1;
    put(r, c, tone);
    frontier.push([r, c]);
    filled += c === mid ? 1 : 2;
  }

  return thin(g);
}

/**
 * Remove every cell with NO orthogonal neighbour.
 *
 * The family's "no one cell thin parts" rule, applied at the strength accretion needs rather
 * than the strength a random field needs. Growth already guarantees every cell touches one that
 * was there before it, so the only strays left are the ones the MIRROR created: a cell one step
 * left of centre has a mirror one step right of it, and on an odd grid those two can land with
 * a gap between them. One pass, to a fixed point, over exactly that case.
 */
export function thin(g: Grid): Grid {
  const mid = (SIZE - 1) / 2;
  const core = (r: number, c: number) => r >= mid - 1 && r <= mid && c >= mid - 1 && c <= mid;
  let changed = true;
  let guard = 0;
  while (changed && guard++ < SIZE * SIZE) {
    changed = false;
    const before = g.map((row) => row.slice());
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (!before[r][c] || core(r, c)) continue;
        let n = 0;
        if (r > 0 && before[r - 1][c]) n++;
        if (r < SIZE - 1 && before[r + 1][c]) n++;
        if (c > 0 && before[r][c - 1]) n++;
        if (c < SIZE - 1 && before[r][c + 1]) n++;
        if (n < 1) {
          g[r][c] = 0;
          changed = true;
        }
      }
    }
  }
  return g;
}

export interface SigilCell {
  r: number;
  c: number;
  tone: Cell;
  /** 0 to 1: when this cell appears while the sigil is growing. */
  at: number;
}

/**
 * The cells, in the order they appear while the sigil grows.
 *
 * Centre outwards by Chebyshev distance, then clockwise, so growth reads as something forming
 * around a core rather than as a raster scan. A mirrored pair appears TOGETHER, which keeps the
 * glyph symmetric at every frame of the growth and not only at the end.
 */
export function cells(g: Grid): SigilCell[] {
  const mid = (SIZE - 1) / 2;
  const out: SigilCell[] = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (g[r][c]) out.push({ r, c, tone: g[r][c], at: 0 });
    }
  }
  out.sort((a, b) => {
    const da = Math.max(Math.abs(a.r - mid), Math.abs(a.c - mid));
    const db = Math.max(Math.abs(b.r - mid), Math.abs(b.c - mid));
    if (da !== db) return da - db;
    // Mirrored pairs share an angle's magnitude; folding the column keeps them adjacent.
    const fa = Math.abs(a.c - mid) * 100 + a.r;
    const fb = Math.abs(b.c - mid) * 100 + b.r;
    return fa - fb;
  });
  const n = out.length || 1;
  return out.map((cell, i) => ({ ...cell, at: (i + 1) / n }));
}

/** The middle column's filled rows, top to bottom: the path the running pulse travels. */
export function spine(g: Grid): number[] {
  const mid = (SIZE - 1) / 2;
  const rows: number[] = [];
  for (let r = 0; r < SIZE; r++) if (g[r][mid]) rows.push(r);
  return rows;
}

/** How full a sigil is, 0 to 1. Used only by the tests, which hold the family's mass rule. */
export function mass(g: Grid): number {
  let n = 0;
  for (const row of g) for (const cell of row) if (cell) n++;
  return n / (SIZE * SIZE);
}
