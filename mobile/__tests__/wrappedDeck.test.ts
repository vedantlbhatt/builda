/**
 * The Wrapped deck's rules (`src/wrapped/deck.ts`): the grid's tilt table, the story stack's
 * four slots, the rule that decides when a thrown card commits, and the poses the stack
 * moves through, held to the Appllama animated-card-stack tables they were adapted from.
 */
import { describe, expect, test } from 'bun:test';

import { REPORT_ENUMS } from '../src/generated/report';
import {
  CARD_ORDER,
  CARD_UNITS,
  COMMIT_DISTANCE,
  COMMIT_DOMINANCE,
  COMMIT_VELOCITY,
  DECK_SIZE,
  DRAG_TILT_MAX,
  EXIT_SIDE,
  FRONT_POSE,
  GRID_TILT,
  MAX_PROGRESS_VELOCITY,
  PEAK_ROTATION,
  REST_TRANSFORMS,
  SLOTS,
  TRANSITION_MS,
  Z_SWAP_PROGRESS,
  cardInSlot,
  depthOf,
  dragPose,
  gridTilt,
  incomingContentOpacity,
  incomingPose,
  outgoingPose,
  progressAtDistance,
  progressVelocity,
  releasedOutgoingPose,
  restPose,
  slotOf,
  throwOf,
  type Pose,
  type SlotIndex,
} from '../src/wrapped/deck';

const SLOT_IDS: SlotIndex[] = [0, 1, 2, 3];
const W = 338;

function close(a: Pose, b: Pose, eps = 1e-9) {
  expect(Math.abs(a.x - b.x)).toBeLessThan(eps);
  expect(Math.abs(a.y - b.y)).toBeLessThan(eps);
  expect(Math.abs(a.scale - b.scale)).toBeLessThan(eps);
  expect(Math.abs(a.rotation - b.rotation)).toBeLessThan(eps);
}

describe('the deck', () => {
  test('fifteen cards, in the engine order the spec declares', () => {
    expect(DECK_SIZE).toBe(15);
    expect([...CARD_ORDER]).toEqual([...REPORT_ENUMS.wrapped_card]);
    expect(CARD_ORDER[0]).toBe('builder_type');
    expect(CARD_ORDER[14]).toBe('kind_of_work');
  });
});

describe('the grid: a fixed tilt table, never random', () => {
  test('the table is the design doc\'s, in degrees', () => {
    expect([...GRID_TILT]).toEqual([-1.5, 1, -0.5, 1.5]);
  });

  test('card i wears table[i mod 4], and asking twice gives the same answer', () => {
    const first = Array.from({ length: DECK_SIZE }, (_, i) => gridTilt(i));
    const second = Array.from({ length: DECK_SIZE }, (_, i) => gridTilt(i));
    expect(first).toEqual(second);
    expect(first).toEqual([-1.5, 1, -0.5, 1.5, -1.5, 1, -0.5, 1.5, -1.5, 1, -0.5, 1.5, -1.5, 1, -0.5]);
  });

  test('a negative or fractional index still lands in the table', () => {
    expect(gridTilt(-1)).toBe(1.5);
    expect(gridTilt(2.7)).toBe(-0.5);
  });
});

describe('the stack commit rule', () => {
  const at = (dx: number, dy = 0, vx = 0, vy = 0) => throwOf({ dx, dy, vx, vy });

  test('the constants are the original rule plus the design doc\'s flick', () => {
    expect(COMMIT_DISTANCE).toBe(24);
    expect(COMMIT_DOMINANCE).toBe(1.15);
    expect(COMMIT_VELOCITY).toBe(800);
  });

  test('24pt mostly sideways commits, in the direction thrown; 23pt springs home', () => {
    expect(at(24)).toBe(1);
    expect(at(-24)).toBe(-1);
    expect(at(23)).toBe(0);
    expect(at(-23.9)).toBe(0);
  });

  test('sideways means the horizontal beats the vertical by 1.15', () => {
    expect(at(30, 26)).toBe(1); // 26 x 1.15 = 29.9
    expect(at(30, 27)).toBe(0); // 27 x 1.15 = 31.05
    expect(at(-80, -60)).toBe(-1);
    expect(at(40, 200)).toBe(0); // a scroll, not a throw
  });

  test('a flick of 800pt/s commits whatever the distance, and beats the distance', () => {
    expect(at(0, 0, 800)).toBe(1);
    expect(at(0, 0, -800)).toBe(-1);
    expect(at(5, 0, 799)).toBe(0);
    expect(at(60, 0, -900)).toBe(-1); // dragged right, flicked back left: it goes left
  });

  test('a fast vertical flick is not a throw', () => {
    expect(at(0, 0, 900, 900)).toBe(0);
    expect(at(10, 0, 900, 1200)).toBe(0);
  });
});

describe('four slots, a card keeps its slot', () => {
  test('card i lives in slot i mod 4', () => {
    expect(Array.from({ length: 8 }, (_, i) => slotOf(i))).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
  });

  test('the four views show the front card and the three behind it, each in its own slot', () => {
    for (let front = 0; front < DECK_SIZE; front++) {
      const shown = SLOT_IDS.map((s) => cardInSlot(s, front, DECK_SIZE)).filter((c): c is number => c !== null).sort((a, b) => a - b);
      const expected = [front, front + 1, front + 2, front + 3].filter((c) => c < DECK_SIZE);
      expect(shown).toEqual(expected);
      for (const s of SLOT_IDS) {
        const card = cardInSlot(s, front, DECK_SIZE);
        if (card !== null) {
          expect(slotOf(card)).toBe(s);
          expect(depthOf(s, front)).toBe(card - front);
        }
      }
    }
  });

  test('the stack thins at the end instead of wrapping to card 1', () => {
    expect(SLOT_IDS.map((s) => cardInSlot(s, 14, DECK_SIZE))).toEqual([null, null, 14, null]);
    expect(SLOT_IDS.map((s) => cardInSlot(s, 12, DECK_SIZE))).toEqual([12, 13, 14, null]);
  });
});

describe('poses: the Appllama tables, in points', () => {
  test('the rest poses are the original four, rotations -10.56, 5.42, 8.62, 5.52', () => {
    expect(REST_TRANSFORMS.map((r) => r.rotation)).toEqual([-10.56, 5.42, 8.62, 5.52]);
    expect(SLOTS).toBe(4);
    // At the original's own card width the offsets are the scene's units, verbatim.
    close(restPose(0, CARD_UNITS), { x: 645.4 - 620.5, y: 633.3 - 620, scale: 0.9748, rotation: -10.56 }, 1e-9);
    // And they scale with the card: half the width, half the offset.
    const half = restPose(3, CARD_UNITS / 2);
    expect(half.x).toBeCloseTo((619.7 - 620.5) / 2, 9);
  });

  test('exit sides alternate and the peak turns keep their signs', () => {
    expect([...EXIT_SIDE]).toEqual([1, -1, 1, -1]);
    expect([...PEAK_ROTATION]).toEqual([8.2, -11, 19.5, -11.24]);
    expect([...Z_SWAP_PROGRESS]).toEqual([0.455, 0.455, 0.5, 0.59]);
    expect(TRANSITION_MS).toBe(367);
  });

  test('outgoing starts at the front and ends exactly at its slot\'s rest pose', () => {
    for (const s of SLOT_IDS) {
      const side = EXIT_SIDE[s];
      const start = outgoingPose(s, 0, side, W);
      expect(Math.abs(start.x)).toBeLessThan(2); // the left table starts 2 units out
      expect(Math.abs(start.rotation)).toBe(0);
      close(outgoingPose(s, 1, side, W), restPose(s, W));
    }
  });

  test('incoming rises from its rest pose to the front, and never overshoots', () => {
    for (const s of SLOT_IDS) {
      close(incomingPose(s, 0, W), restPose(s, W));
      close(incomingPose(s, 1, W), FRONT_POSE);
      for (let p = 0; p <= 1; p += 0.01) expect(incomingPose(s, p, W).scale).toBeLessThanOrEqual(1);
    }
  });

  test('at the z swap the outgoing card is at its smallest and furthest out', () => {
    for (const s of SLOT_IDS) {
      const swap = outgoingPose(s, Z_SWAP_PROGRESS[s], EXIT_SIDE[s], W);
      expect(swap.scale).toBeLessThan(0.65);
      expect(Math.abs(swap.x)).toBeGreaterThan(W * 0.4);
    }
  });

  test('thrown against its authored side, the path and its turn are mirrored', () => {
    for (const s of [2, 3] as SlotIndex[]) {
      for (const p of [0.1, 0.3, 0.45]) {
        const a = outgoingPose(s, p, 1, W);
        const b = outgoingPose(s, p, -1, W);
        expect(b.x).toBeCloseTo(-a.x, 9);
        expect(b.rotation).toBeCloseTo(-a.rotation, 9);
        expect(b.scale).toBe(a.scale);
      }
    }
  });

  test('a tap-thrown card turns with the original\'s sign', () => {
    for (const s of SLOT_IDS) {
      const r = outgoingPose(s, 0.3, EXIT_SIDE[s], W).rotation;
      expect(Math.sign(r)).toBe(Math.sign(PEAK_ROTATION[s]));
    }
  });

  test('the incoming content brightens from the back cards\' 0.55 to full', () => {
    expect(incomingContentOpacity(0)).toBe(0.55);
    expect(incomingContentOpacity(1)).toBe(1);
  });
});

describe('the finger', () => {
  test('the front card follows the finger, lifted a quarter, turning at most 16 degrees', () => {
    const p = dragPose(100, 40, W);
    expect(p.x).toBe(100);
    expect(p.y).toBe(10);
    expect(p.scale).toBe(1);
    expect(p.rotation).toBeGreaterThan(0);
    expect(dragPose(5000, 0, W).rotation).toBe(DRAG_TILT_MAX);
    expect(dragPose(-5000, 0, W).rotation).toBe(-DRAG_TILT_MAX);
  });

  test('a release continues from where the finger left the card, not from the start', () => {
    for (const s of SLOT_IDS) {
      for (const side of [1, -1]) {
        for (const d of [30, 60, 120]) {
          const from = progressAtDistance(s, side, side * d, W);
          expect(from).toBeGreaterThan(0);
          expect(from).toBeLessThan(Z_SWAP_PROGRESS[s]);
          expect(Math.abs(outgoingPose(s, from, side, W).x)).toBeCloseTo(d, 0);
        }
      }
    }
  });

  test('a long drag is held short of the z swap, so it is still in front when let go', () => {
    for (const s of SLOT_IDS) expect(progressAtDistance(s, 1, 10_000, W)).toBeCloseTo(Z_SWAP_PROGRESS[s] - 0.05, 9);
  });

  test('the released card is exactly the drag pose at release, and the authored path from the swap on', () => {
    const release = dragPose(90, 20, W);
    for (const s of SLOT_IDS) {
      const from = progressAtDistance(s, 1, 90, W);
      close(releasedOutgoingPose(s, from, 1, W, release, from), release);
      close(releasedOutgoingPose(s, Z_SWAP_PROGRESS[s], 1, W, release, from), outgoingPose(s, Z_SWAP_PROGRESS[s], 1, W));
      close(releasedOutgoingPose(s, 1, 1, W, release, from), restPose(s, W));
    }
  });

  test('the finger\'s velocity reaches the spring as progress per second, clamped', () => {
    const v = progressVelocity(0, 1, 0.2, 900, W);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThanOrEqual(MAX_PROGRESS_VELOCITY);
    expect(progressVelocity(0, 1, 0.2, 1e9, W)).toBe(MAX_PROGRESS_VELOCITY);
    expect(progressVelocity(0, 1, 0.2, 0, W)).toBe(0);
  });
});
