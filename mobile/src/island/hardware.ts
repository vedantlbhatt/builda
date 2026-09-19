/**
 * Where the hardware island is, so the drawn one can sit exactly on it. PURE.
 *
 * THE FRAMES ARE MEASURED, not guessed (carried over from the drops portal that first needed
 * them). iPhone 15 Pro and 15: 125 x 37 at y 11. 15 Pro Max, 15 Plus and the 16s: the same pill on
 * a wider screen. Anything with a top inset under 54 points has a notch or nothing, and gets no
 * island at all: the drawn one then only ever appears as a toast from the top edge.
 */

/** The island's own size, in points. The same on every device that has one. */
export const ISLAND_W = 125;
export const ISLAND_H = 37;
export const ISLAND_TOP = 11;

/** Devices with an island have a top inset of 59 (15 Pro) or 62 (16 Pro). A notch is 47 or 50. */
export const ISLAND_MIN_INSET = 54;

export interface HardwareFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The island's frame on a screen this wide, or null where there is none. */
export function islandOf(width: number, topInset: number): HardwareFrame | null {
  if (topInset < ISLAND_MIN_INSET) return null;
  return { x: width / 2, y: ISLAND_TOP + ISLAND_H / 2, width: ISLAND_W, height: ISLAND_H };
}
