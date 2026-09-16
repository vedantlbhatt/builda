/**
 * Where each cluster's STACK goes on the board. Pure: `__tests__/dropsBoard.test.ts` holds it.
 *
 * The board used to be one dot per drop on a phyllotaxis spiral. It is stacks of real cards now
 * (`card.ts` says why), which changes the problem: the things being placed are chunky rectangles
 * of different sizes rather than points of one size, and a spiral of points packs nothing.
 *
 * SO IT PACKS RECTANGLES. Stacks are placed biggest first, each one taking the first spot on a
 * spiral of candidate positions whose box clears every box already placed. Biggest first because
 * a big stack dropped in late has to go a long way out, and a board with its largest pile on the
 * rim reads as an accident.
 *
 * It terminates (the spiral's radius grows without bound), it is deterministic (same clusters,
 * same order, same spots, on the phone and in the review sheet), and it packs tight: the step is
 * small and collisions are what push things apart, so a board of singletons is dense and a board
 * with one huge pile still closes up around it.
 */

import { CARD_H, CARD_W, fan, stackSize } from './card';

/** Columns on a phone. Two: a 104 point card plus its fan is about half a phone's width. */
export const COLUMNS = 2;
/** Clear air between two stacks. */
export const GAP = 22;
/** The board's own side margin, so a stack never touches the edge. */
export const GUTTER = 16;

export interface Box {
  width: number;
  height: number;
  /**
   * Which band of the wall this box belongs in: -1 above everything, 0 with everything, 1 below.
   *
   * Tallest-first is the right order for a wall of libraries and the wrong one for the two piles
   * that are not libraries. A reel you shared ten seconds ago is one card tall, so height alone
   * files it halfway down the board — under four piles you were not looking for — at the exact
   * moment you opened the app to see it. And the drops nobody could read are a dead end, so they
   * sort under the board rather than into it. Default 0: an ordinary pile is placed by its size,
   * which is what the rest of this file is about.
   */
  band?: -1 | 0 | 1;
}

export interface Spot extends Box {
  /** The box's CENTRE, in points. */
  x: number;
  y: number;
  /** Index into the input, so a caller can put the answer back where it came from. */
  index: number;
}

/** FNV-1a, for the per stack nudge. Deterministic: a board never rearranges itself. */
function seed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Flow the stacks down a two column wall, tallest first, each one into the shorter column.
 *
 * THE SPIRAL WAS THE WRONG SHAPE. Packing rectangles around an origin gives a board 657 points
 * wide, which on a 393 point phone either overflows sideways or shrinks every card to a smudge,
 * and a board you have to pan in two directions to read is a board nobody reads. A phone is a
 * column. The wall flows down it, the width always fits, and the only gesture is the one a phone
 * already is.
 *
 * It is not a table. Each stack is a fan of its own shape and height, and a small deterministic
 * nudge (never more than a third of the gap, so columns never collide) keeps the two columns from
 * reading as ruled lines. Tallest first, because a wall whose biggest pile is at the bottom reads
 * as a list that ran out.
 */
export function flow(boxes: Box[], width: number, keys: string[] = []): Spot[] {
  const usable = Math.max(120, width - GUTTER * 2);
  const colWidth = (usable - GAP * (COLUMNS - 1)) / COLUMNS;
  const heights = new Array(COLUMNS).fill(0);
  const out: Spot[] = [];

  const order = boxes
    .map((b, index) => ({ b, index }))
    .sort(
      (p, q) =>
        (p.b.band ?? 0) - (q.b.band ?? 0) || q.b.height - p.b.height || p.index - q.index,
    );

  for (const { b, index } of order) {
    let col = 0;
    for (let i = 1; i < COLUMNS; i++) if (heights[i] < heights[col]) col = i;
    const nudge = (((seed(keys[index] ?? String(index)) % 1000) / 1000) - 0.5) * (GAP * 0.6);
    const cx = GUTTER + col * (colWidth + GAP) + colWidth / 2 + nudge;
    const cy = heights[col] + b.height / 2;
    heights[col] += b.height + GAP;
    out[index] = { x: cx, y: cy, width: b.width, height: b.height, index };
  }
  return out;
}

export interface StackSpot extends Spot {
  /** Which cluster this is, in the clustering's own order. */
  cluster: number;
  label: string;
  size: number;
  members: number[];
}

/** The width of one column on a wall `width` points across. */
export function columnWidth(width: number): number {
  const usable = Math.max(120, width - GUTTER * 2);
  return (usable - GAP * (COLUMNS - 1)) / COLUMNS;
}

/**
 * How much to shrink every card so the widest pile on this board fits a column.
 *
 * One number for the whole board, never per pile: cards of two different sizes on one wall reads
 * as a bug. Capped at 1, so a board of singletons does not blow its cards up past their design
 * size; floored well above nothing, because a card too small to recognise defeats the point, and
 * a pile that still will not fit simply overlaps its neighbour's air rather than becoming a smudge.
 */
export const MIN_CARD_SCALE = 0.7;

export function cardScaleFor(
  clusters: { size: number }[],
  width: number,
): number {
  const widest = clusters.reduce((m, c) => Math.max(m, stackSize(c.size).width), 1);
  return Math.max(MIN_CARD_SCALE, Math.min(1, columnWidth(width) / widest));
}

/** Every cluster's stack, flowed down a wall `width` points across. */
export function board(
  clusters: { label: string; size: number; members: number[]; band?: -1 | 0 | 1 }[],
  width: number,
): StackSpot[] {
  const k = cardScaleFor(clusters, width);
  const boxes = clusters.map((c) => {
    const s = stackSize(c.size);
    // Room above each stack for its word.
    return { width: s.width * k, height: s.height * k + LABEL_ROOM, band: c.band };
  });
  const spots = flow(boxes, width, clusters.map((c) => `${c.label}.${c.size}`));
  return clusters.map((c, i) => ({
    ...(spots[i] as Spot),
    cluster: i,
    label: c.label,
    size: c.size,
    members: c.members,
  }));
}

export interface Extent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Room above each stack for its word. */
export const LABEL_ROOM = 26;

export function extentOf(spots: Spot[], width: number): Extent {
  if (spots.length === 0) return { minX: 0, minY: 0, maxX: width, maxY: width };
  return {
    minX: 0,
    minY: Math.min(...spots.map((s) => s.y - s.height / 2)) - 8,
    maxX: width,
    maxY: Math.max(...spots.map((s) => s.y + s.height / 2)) + 24,
  };
}

/**
 * Never smaller than this. A 104 point card at 0.5 is a 52 point thumbnail, which is a smudge:
 * the whole point of showing the post's own frame is that you recognise it.
 */
export const MIN_FIT = 0.72;
export const MAX_FIT = 1.1;

/**
 * The opening view: the board's WIDTH fits, and the top of it sits near the top of the screen.
 *
 * Not both dimensions. MEASURED on a real board of six clusters, the extent is 657 by 729 and
 * fitting both gives 0.60, which draws every card at 62 points and is unreadable. Fitting the
 * width alone gives a wall you scroll down, which is the shape a phone is, and the cards stay
 * big enough to recognise. Vertical panning is the natural gesture here and horizontal is not.
 */
export const TOP_ROOM = 64;

export function fit(
  extent: Extent,
  viewport: { width: number; height: number },
): { scale: number; x: number; y: number } {
  const w = extent.maxX - extent.minX;
  const h = extent.maxY - extent.minY;
  const scale = Math.max(MIN_FIT, Math.min(viewport.width / Math.max(w, 1), MAX_FIT));
  const cx = (extent.minX + extent.maxX) / 2;
  const tall = h * scale;
  // A board shorter than the screen is centred; a taller one starts at its top.
  const y =
    tall < viewport.height - TOP_ROOM
      ? viewport.height / 2 - ((extent.minY + extent.maxY) / 2) * scale
      : TOP_ROOM - extent.minY * scale;
  return { scale, x: viewport.width / 2 - cx * scale, y };
}

/** The transform that puts a point in the middle of the viewport at `scale`. */
export function focus(
  at: { x: number; y: number },
  viewport: { width: number; height: number },
  scale: number,
): { scale: number; x: number; y: number } {
  return { scale, x: viewport.width / 2 - at.x * scale, y: viewport.height / 2 - at.y * scale };
}

/** The word's row above every pile, which the cards sit under. */
export const LABEL_H = 22;

export interface Seat {
  /** Index into the board's drops. */
  index: number;
  /** Where the card's top left corner sits INSIDE its pile. */
  left: number;
  top: number;
  rotate: number;
  depth: number;
  /** The card's CENTRE on the wall, which is what a flight has to aim at. */
  homeX: number;
  homeY: number;
  width: number;
  height: number;
}

/**
 * Every card of one pile, placed: once for the pile itself and once for the flight that arrives
 * into it.
 *
 * It exists because those two used to compute it separately. The wall drew a card at one place
 * and the arrival flew to another, and a discrepancy of a few points is invisible while both are
 * wrong in the same direction and a jump the moment they are not. One function, one answer.
 */
export function seats(
  spot: { x: number; y: number; width: number; height: number; size: number; members: number[] },
  ids: string[],
  cardScale: number,
): Seat[] {
  const raw = stackSize(spot.size);
  const boxWidth = raw.width * cardScale;
  const w = CARD_W * cardScale;
  const h = CARD_H * cardScale;
  return fan(spot.members, ids).map((p) => {
    const left = boxWidth / 2 - w / 2 + p.x * cardScale;
    const top = p.y * cardScale;
    return {
      index: p.index,
      left,
      top,
      rotate: p.rotate,
      depth: p.depth,
      homeX: spot.x - spot.width / 2 + left + w / 2,
      homeY: spot.y - spot.height / 2 + LABEL_H + top + h / 2,
      width: w,
      height: h,
    };
  });
}
