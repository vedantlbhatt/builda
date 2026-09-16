/**
 * The board's geometry, in points. PURE, so `__tests__/dropsCards.test.ts` holds it.
 *
 * WHAT CHANGED AND WHY. The first board drew one generated pixel glyph per drop on a dotted
 * field. It was wrong twice: a glyph grown from a URL tells you NOTHING about the post, so a
 * board of them is a board you cannot read, and a field of identical little marks is exactly the
 * look this app has a rule against. A drop is a video somebody made. The card is its own frame.
 *
 * A CLUSTER IS A STACK, not a constellation of dots. Six pasta posts are one thing on the board,
 * fanned so each one peeks, and opening the stack is what spreads them. That keeps a board of
 * forty drops to eight objects, which is the difference between a map and a starfield.
 *
 * Everything here is deterministic from the drop's own id: the same board draws the same way on
 * every device and in the review sheet, and a card never jitters between renders.
 */

/**
 * A card at rest. 9:16, the shape every one of these posts is.
 *
 * This is the DESIGN size; what actually draws is this times the board's `cardScale`, which the
 * layout works out so the widest pile fits a phone's column. FOUND BY THE LAYOUT TEST: a pile
 * four deep fans to 194 points and a column on a 393 point phone is 170, so a fixed card width
 * put the widest pile over the edge on every phone narrower than the one it was designed on.
 */
export const CARD_W = 104;
export const CARD_H = Math.round((CARD_W * 16) / 9);
export const CARD_RADIUS = 14;

/**
 * How far a fanned card behind the top one peeks out, in points, and how much it leans.
 *
 * FOUND ON THE SIMULATOR: at 9 and 7 a pile of two read as one card with a smudge down its left
 * edge, which is the one thing a pile has to say. These are the numbers at which a pile is
 * obviously a pile at a glance and still fits its column once the board's card scale has had its
 * say (`layout.cardScaleFor`).
 */
export const PEEK_X = 15;
export const PEEK_Y = 11;
/** How much a fanned card leans, in degrees. */
export const LEAN = 4.5;
/** Cards drawn in a collapsed stack. Past this the rest are one number. */
export const STACK_SHOWN = 4;

/** Gap between two stacks, edge to edge, when the board packs them. */
export const STACK_GAP = 34;

/** FNV-1a over the id: the same card leans the same way forever. */
export function seed(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** -1 to 1, deterministic per id. Used for the lean and the peek, never for position. */
export function jitter(id: string, salt = 0): number {
  const h = seed(id + (salt ? `#${salt}` : ''));
  return ((h % 2000) / 1000) - 1;
}

export interface Placed {
  /** Index into the drops array. */
  index: number;
  /** Points, relative to the stack's own top left. */
  x: number;
  y: number;
  /** Degrees. */
  rotate: number;
  /** 0 is the top card. */
  depth: number;
}

/**
 * The cards of one collapsed stack, back to front.
 *
 * The TOP card is the last member and is drawn last, square on with no lean, because it is the
 * one you are looking at. The ones behind lean and peek by a deterministic amount, so the stack
 * reads as a pile of real things rather than as a shadow.
 */
export function fan(members: number[], ids: string[]): Placed[] {
  const shown = members.slice(-STACK_SHOWN);
  const out: Placed[] = [];
  shown.forEach((index, i) => {
    const depth = shown.length - 1 - i;
    const id = ids[index] ?? String(index);
    // Alternating sides, so a stack fans rather than leaning off one edge; the magnitude is
    // jittered per card so no two stacks are the same shape.
    const side = depth % 2 === 1 ? -1 : 1;
    const spread = 0.7 + Math.abs(jitter(id, 1)) * 0.6;
    out.push({
      index,
      x: depth === 0 ? 0 : side * depth * PEEK_X * spread,
      y: depth * PEEK_Y,
      rotate: depth === 0 ? 0 : side * (0.6 + Math.abs(jitter(id)) * 0.9) * LEAN,
      depth,
    });
  });
  return out;
}

/** The box a collapsed stack occupies, including everything that peeks out of it. */
export function stackSize(count: number): { width: number; height: number } {
  const depth = Math.max(0, Math.min(count, STACK_SHOWN) - 1);
  // 1.3 is the widest `spread` a jittered card can take, and the lean adds a little more; this
  // is the box a tap has to cover and a neighbour has to clear.
  const reach = depth * PEEK_X * 1.3 + 10;
  return { width: CARD_W + reach * 2, height: CARD_H + depth * PEEK_Y + 10 };
}

/**
 * Where the cards of an OPEN stack go: a grid that grows down, two across, so a stack of six
 * opens into three rows and stays on screen.
 *
 * Not a ring. A ring looks good with three and unreadable with nine, and the thing you do with an
 * open stack is read it.
 */
export const OPEN_COLS = 2;
export const OPEN_GAP = 14;

export function spread(members: number[]): Placed[] {
  return members.map((index, i) => ({
    index,
    x: (i % OPEN_COLS) * (CARD_W + OPEN_GAP),
    y: Math.floor(i / OPEN_COLS) * (CARD_H + OPEN_GAP),
    rotate: 0,
    depth: 0,
  }));
}

export function spreadSize(count: number): { width: number; height: number } {
  const cols = Math.min(count, OPEN_COLS);
  const rows = Math.ceil(count / OPEN_COLS);
  return {
    width: cols * CARD_W + (cols - 1) * OPEN_GAP,
    height: rows * CARD_H + (rows - 1) * OPEN_GAP,
  };
}
