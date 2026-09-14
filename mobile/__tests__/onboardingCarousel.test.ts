/**
 * Where a released pan on the creature stage lands (`panTarget` in `src/pixel/carousel.ts`).
 * DESIGN-DIRECTION 4: commit at 30% of the way to a neighbour or at 800pt/s. Every case is a
 * finger a person really has: a nudge that should spring back, a drag that should move on, a
 * flick from a standstill, a flick back against a drag, and a long drag past two creatures.
 */
import { describe, expect, test } from 'bun:test';

import { ANIMALS } from '../src/pixel/animals';
import {
  LIT_HYSTERESIS,
  PAN_COMMIT_SHARE,
  PAN_FLICK_VELOCITY,
  PAN_MAX_STEPS,
  animalAt,
  litSlot,
  panTarget,
  wrapIndex,
} from '../src/pixel/carousel';

const PITCH = 153; // 38% of a 402pt screen
const land = (moved: number, vx = 0, from = 0) => panTarget({ from, position: from + moved, vx, pitch: PITCH }) - from;

describe('the commit rule', () => {
  test('the numbers are the design doc\'s', () => {
    expect(PAN_COMMIT_SHARE).toBe(0.3);
    expect(PAN_FLICK_VELOCITY).toBe(800);
  });

  test('a nudge under 30% springs back, either way', () => {
    expect(land(0)).toBe(0);
    expect(land(0.29)).toBe(0);
    expect(land(-0.29)).toBe(0);
    expect(land(0.1, 300)).toBe(0);
  });

  test('30% of the way to a neighbour is enough to reach it', () => {
    expect(land(0.3)).toBe(1);
    expect(land(-0.3)).toBe(-1);
    expect(land(0.85)).toBe(1);
  });

  test('the same 30% applies to the second creature on a long drag', () => {
    expect(land(1.29)).toBe(1);
    expect(land(1.3)).toBe(2);
    expect(land(-1.3)).toBe(-2);
  });

  test('an 800pt/s flick moves on from a standstill (a finger moving left is forward)', () => {
    expect(land(0.02, -PAN_FLICK_VELOCITY)).toBe(1);
    expect(land(-0.02, PAN_FLICK_VELOCITY)).toBe(-1);
    expect(land(0.02, -(PAN_FLICK_VELOCITY - 1))).toBe(0);
  });

  test('a flick lands one past where the stage is, in the direction of the flick', () => {
    expect(land(1.0, -1200)).toBe(2);
    expect(land(0.6, -1200)).toBe(1);
    // Dragged forward, then flicked back: it goes back to where it started, not past it.
    expect(land(0.6, 1200)).toBe(0);
  });

  test('never more than two creatures in one release', () => {
    expect(land(5)).toBe(PAN_MAX_STEPS);
    expect(land(-5, 5000)).toBe(-PAN_MAX_STEPS);
    expect(land(2.4, -3000)).toBe(PAN_MAX_STEPS);
  });

  test('landing is relative to the slot the drag started on, wherever that is', () => {
    expect(panTarget({ from: 17, position: 17.4, vx: 0, pitch: PITCH })).toBe(18);
    expect(panTarget({ from: -9, position: -9.4, vx: 0, pitch: PITCH })).toBe(-10);
  });

  test('a stage with no width yet never flicks', () => {
    expect(panTarget({ from: 3, position: 3.1, vx: -5000, pitch: 0 })).toBe(3);
  });
});

describe('slots wrap through the pack both ways', () => {
  test('slot k shows the pack in order, forever', () => {
    for (let k = -20; k <= 20; k++) {
      expect(animalAt(k)).toBe(ANIMALS[((k % ANIMALS.length) + ANIMALS.length) % ANIMALS.length]!);
    }
  });

  test('the slot before the first is the last', () => {
    expect(wrapIndex(-1)).toBe(ANIMALS.length - 1);
    expect(animalAt(-1)).toBe(ANIMALS[ANIMALS.length - 1]!);
    expect(animalAt(ANIMALS.length)).toBe(ANIMALS[0]!);
  });

  test('a fractional slot rounds to the creature under the centre', () => {
    expect(animalAt(0.49)).toBe(ANIMALS[0]!);
    expect(animalAt(0.51)).toBe(ANIMALS[1]!);
  });
});

describe('exactly one creature is lit, and it changes on the tick', () => {
  /** Walk the stage through `path` from slot `from`; return the lit slot after each step. */
  const walk = (from: number, path: number[]) => {
    let lit = from;
    return path.map((p) => (lit = litSlot(p, lit)));
  };

  test('a finger held at exactly half way keeps one creature lit, however long it stays', () => {
    expect(walk(0, [0.2, 0.4, 0.5, 0.5, 0.5, 0.5])).toEqual([0, 0, 0, 0, 0, 0]);
  });

  test('past half way by the margin, the next one is lit; back to half way, it stays lit', () => {
    expect(LIT_HYSTERESIS).toBeGreaterThan(0.5);
    expect(LIT_HYSTERESIS).toBeLessThan(0.6);
    expect(walk(0, [0.3, 0.56, 0.5, 0.47])).toEqual([0, 1, 1, 1]);
    // Only clearly back past the margin the other way does it return.
    expect(walk(0, [0.56, 0.44])).toEqual([1, 0]);
  });

  test('a fling across several creatures lights each in turn and ends on the one it rests on', () => {
    const lit = walk(0, [0.3, 0.7, 1.2, 1.6, 2.1, 2.4, 2.0]);
    expect(lit).toEqual([0, 1, 1, 2, 2, 2, 2]);
    expect(lit[lit.length - 1]).toBe(2);
  });

  test('at rest on a slot, that slot is lit, wherever the lit one was', () => {
    expect(litSlot(3, 0)).toBe(3);
    expect(litSlot(-2, 1)).toBe(-2);
    expect(litSlot(5, 5)).toBe(5);
  });
});
