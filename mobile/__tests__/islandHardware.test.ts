import { describe, expect, test } from 'bun:test';

import { ISLAND_H, ISLAND_MIN_INSET, ISLAND_W, islandOf } from '../src/island/hardware';

describe('the hardware island', () => {
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

  test('a notch or a flat top gets none at all', () => {
    for (const inset of [0, 20, 47, 50, ISLAND_MIN_INSET - 1]) expect(islandOf(393, inset)).toBeNull();
  });

  test('a wider phone puts the same pill in the middle of it', () => {
    const small = islandOf(393, 59)!;
    const large = islandOf(430, 62)!;
    expect(large.width).toBe(small.width);
    expect(large.y).toBe(small.y);
    expect(large.x).toBeGreaterThan(small.x);
  });
});
