/**
 * The Dynamic Island, as a place things come out of. PURE, so `__tests__/dropsPortal.test.ts`
 * holds it.
 *
 * A DROP ARRIVES FROM SOMEWHERE ELSE. You were in TikTok; the board is where it lands. So it does
 * not fade in where it will live, it comes out of the top of the phone and flies to its pile,
 * which is the one moment in this app that is allowed to be theatre.
 *
 * WHAT THE PILL IS. iOS does not let an app expand the real Dynamic Island without a Live Activity
 * (and a Live Activity is a different product surface with its own rules), so the sheet draws its
 * own: a black capsule at the island's own frame that swells for a beat and settles. On a device
 * with no island it is simply not drawn, and the cards fly from the top edge instead, which still
 * reads as "in from outside".
 *
 * THE FRAMES ARE MEASURED, not guessed. iPhone 15 Pro and 15: 125 x 37 at y 11. 15 Pro Max and
 * 15 Plus: the same pill on a wider screen. Anything with a top inset under 54 points has a notch
 * or nothing, and gets no pill.
 */

/** The island's own size, in points. The same on every device that has one. */
export const ISLAND_W = 125;
export const ISLAND_H = 37;
export const ISLAND_TOP = 11;

/** Devices with an island have a top inset of 59 (15 Pro) or 62 (16 Pro). A notch is 47 or 50. */
export const ISLAND_MIN_INSET = 54;

export interface Island {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The island's frame on a screen this wide, or null where there is none. */
export function islandOf(width: number, topInset: number): Island | null {
  if (topInset < ISLAND_MIN_INSET) return null;
  return { x: width / 2, y: ISLAND_TOP + ISLAND_H / 2, width: ISLAND_W, height: ISLAND_H };
}

/** Where a card flies FROM: the island's middle, or the top edge where there is none. */
export function portalPoint(width: number, topInset: number): { x: number; y: number } {
  const island = islandOf(width, topInset);
  return island ? { x: island.x, y: island.y } : { x: width / 2, y: 0 };
}

/** One card's turn to come out, in ms. */
export const STAGGER = 78;
/** The pill swells before the first card, so the portal opens before anything leaves it. */
export const PILL_LEAD = 190;
/** One card's flight. */
export const FLIGHT = 760;

/**
 * When each card leaves, in the order they should leave.
 *
 * Capped, because a board of forty would otherwise take three seconds to arrive and the last
 * card would land after the person had already started reading. Past the cap they share the last
 * slot, which looks like a handful arriving at once and is what actually happens.
 */
export const MAX_STAGGERED = 12;

export function schedule(count: number): number[] {
  return Array.from({ length: count }, (_, i) => PILL_LEAD + Math.min(i, MAX_STAGGERED) * STAGGER);
}

/** How long the whole arrival takes, so a caller knows when the board is settled. */
export function arrivalMs(count: number): number {
  return count === 0 ? 0 : PILL_LEAD + Math.min(count - 1, MAX_STAGGERED) * STAGGER + FLIGHT;
}

/** The spin a card makes on its way out, in degrees. One turn and a little, so it reads as a
 * whip rather than as a wobble. */
export const SPIN = 400;
/**
 * How small it starts, as a fraction of the card.
 *
 * 0.08 was a speck. At 0.13 a 104 x 185 card leaves as 14 x 24, which still fits inside a 125 x 37
 * island — the point of the number — and is big enough to read as a card rather than as dust.
 */
export const BORN = 0.13;
