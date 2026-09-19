/**
 * The portal: where a drop comes from, and when.
 *
 * Pure (`src/drops/portal.ts`), so the one moment in this app that is theatre can be held to the
 * frames it is supposed to hit without a simulator. The regressions this exists to catch are both
 * real ones: a flight whose easing put the card most of the way home before it was visible, and a
 * card born so small it read as dust rather than as something leaving a slot.
 */
import { describe, expect, test } from 'bun:test';

import {
  arrivalMs,
  BORN,
  FLIGHT,
  ISLAND_H,
  ISLAND_MIN_INSET,
  ISLAND_W,
  islandOf,
  MAX_STAGGERED,
  PILL_LEAD,
  portalPoint,
  schedule,
  SPIN,
  STAGGER,
} from '../src/drops/portal';
import { NODE_H, NODE_W } from '../src/drops/force';

describe('the island', () => {
  test('a phone with one gets its measured frame, centred', () => {
    const island = islandOf(393, 59)!;
    expect(island).not.toBeNull();
    expect(island.width).toBe(ISLAND_W);
    expect(island.height).toBe(ISLAND_H);
    expect(island.x).toBe(393 / 2);
    // Wholly inside the inset it lives in: an island drawn below the status bar is a rectangle
    // stuck to the screen rather than the hole it is pretending to be.
    expect(island.y + ISLAND_H / 2).toBeLessThanOrEqual(59);
  });

  test('a notch or a flat top gets none at all, and the top edge instead', () => {
    for (const inset of [0, 20, 47, 50, ISLAND_MIN_INSET - 1]) {
      expect(islandOf(393, inset)).toBeNull();
      expect(portalPoint(393, inset)).toEqual({ x: 393 / 2, y: 0 });
    }
  });

  test('a wider phone puts the same pill in the middle of it', () => {
    const small = islandOf(393, 59)!;
    const large = islandOf(430, 59)!;
    expect(large.width).toBe(small.width);
    expect(large.y).toBe(small.y);
    expect(large.x).toBeGreaterThan(small.x);
  });
});

describe('whose turn it is', () => {
  test('the pill opens before anything comes out of it', () => {
    expect(schedule(1)[0]).toBe(PILL_LEAD);
    expect(PILL_LEAD).toBeGreaterThan(0);
  });

  test('one after another, in order', () => {
    const times = schedule(5);
    expect(times).toEqual([0, 1, 2, 3, 4].map((i) => PILL_LEAD + i * STAGGER));
    for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThan(times[i - 1]!);
  });

  test('a big board does not take all day', () => {
    // Past the cap they share the last slot: a handful landing together, which is what actually
    // happens when you have shared forty things.
    const times = schedule(40);
    expect(times[39]).toBe(times[MAX_STAGGERED]);
    expect(arrivalMs(40)).toBeLessThan(2000);
  });

  test('nothing to arrive takes no time', () => {
    expect(schedule(0)).toEqual([]);
    expect(arrivalMs(0)).toBe(0);
  });

  test('the whole arrival is the last card leaving plus its flight', () => {
    for (const n of [1, 3, 12, 30]) {
      expect(arrivalMs(n)).toBe(schedule(n)[n - 1]! + FLIGHT);
    }
  });
});

describe('what leaves the island', () => {
  test('a newborn node fits inside the island it came out of', () => {
    // The whole claim of the effect. A frame wider than the slot did not come out of the slot.
    expect(NODE_W * BORN).toBeLessThan(ISLAND_W);
    expect(NODE_H * BORN).toBeLessThan(ISLAND_H);
  });

  test('and is still big enough to read as a frame', () => {
    expect(NODE_W * BORN).toBeGreaterThan(5);
  });

  test('it turns more than once, so it reads as a whip and not a wobble', () => {
    expect(SPIN).toBeGreaterThan(360);
  });
});
