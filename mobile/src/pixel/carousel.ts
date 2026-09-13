import { ANIMALS, ANIMAL_LABELS, DEFAULT_ANIMAL, type Animal, isAnimal } from './animals';

/**
 * The wrap-around list behind the icon picker: one creature in the middle, a chevron
 * either side.
 *
 * Pure, so `bun test` runs it. The screen is a rendering of these functions and nothing
 * else, because the only things that can be wrong here are wrapping and identity, and
 * both are invisible in a screenshot: an off-by-one at the seam means the last chevron
 * press lands on the wrong creature, which a person notices on their first pass through
 * and no test would ever catch.
 *
 * WHY IT WRAPS RATHER THAN STOPPING. Eight is few enough that a dead end at either edge
 * reads as a broken button rather than as the end of the list. There is no "back to the
 * start" affordance to add and none is needed.
 */

/** Where a chevron press moves: -1 for the left one, +1 for the right. */
export type Step = -1 | 1;

/** The index of an animal, or 0 for anything unknown. */
export function indexOf(animal: string | null | undefined): number {
  const i = ANIMALS.indexOf(animal as Animal);
  return i < 0 ? 0 : i;
}

/**
 * The animal `step` presses away, wrapping at both ends.
 *
 * Modulo in JavaScript keeps the sign of the dividend, so `-1 % 8` is `-1` and a naive
 * version indexes off the front of the array at the left edge. The extra `+ length` is
 * what makes the left chevron on the first creature land on the last one.
 */
export function step(animal: string | null | undefined, by: Step): Animal {
  const n = ANIMALS.length;
  const next = (indexOf(animal) + by + n) % n;
  return ANIMALS[next]!;
}

/** "owl", "4 of 8" and the two neighbours, everything the screen needs to draw a frame. */
export interface CarouselView {
  animal: Animal;
  label: string;
  /** 1-based, for "3 of 8". Never 0-based on screen: nobody counts creatures from zero. */
  position: number;
  total: number;
  previous: Animal;
  next: Animal;
}

export function view(animal: string | null | undefined): CarouselView {
  const current = isAnimal(animal) ? animal : DEFAULT_ANIMAL;
  return {
    animal: current,
    label: ANIMAL_LABELS[current],
    position: indexOf(current) + 1,
    total: ANIMALS.length,
    previous: step(current, -1),
    next: step(current, 1),
  };
}

/**
 * The creature to open the picker on.
 *
 * Their own choice first, then the one their archetype earned, then the default, which is
 * the first in the pack (`DEFAULT_ANIMAL`). Opening on the default when the rules already
 * picked one for them would throw away the only personalised thing the app knows then.
 */
export function openOn(
  chosen: string | null | undefined,
  suggested: string | null | undefined
): Animal {
  if (isAnimal(chosen)) return chosen;
  if (isAnimal(suggested)) return suggested;
  return DEFAULT_ANIMAL;
}

// ─── the pan ─────────────────────────────────────────────────────────────────────────
//
// The picker also follows a finger (DESIGN-DIRECTION 4, "Your creature"). The stage keeps one
// continuous POSITION in creature units: slot k shows `ANIMALS[wrap(k)]` at
// `(k - position) * pitch` points from the centre, so dragging is just moving that number and
// nothing is ever re-centred mid-gesture. These are the rules for where a release lands; the
// component is `src/onboarding/CreatureCarousel.tsx`.

/** Drag this share of the distance between two creatures and letting go moves one on. */
export const PAN_COMMIT_SHARE = 0.3;
/** A flick this fast (points per second) moves on however short the drag was. */
export const PAN_FLICK_VELOCITY = 800;
/** A release never moves further than this in one go: the stage draws two either side. */
export const PAN_MAX_STEPS = 2;

/**
 * How far past the half way point the stage must move before the lit creature changes. A
 * little over half, so a finger held at exactly half way (a slow drag does that) keeps ONE
 * creature lit instead of flickering between two, and never leaves both in a blend.
 */
export const LIT_HYSTERESIS = 0.55;

/**
 * The slot drawn in the amber ink, given where the stage is and which slot is lit now. It
 * changes only when the stage is more than `LIT_HYSTERESIS` of a slot away from the lit one,
 * and then to the nearest slot. The selection tick fires on the same change, so the colour
 * and the haptic land on one frame. At rest the stage is on a whole slot, so that slot is lit.
 */
export function litSlot(position: number, lit: number): number {
  'worklet';
  return Math.abs(position - lit) > LIT_HYSTERESIS ? Math.round(position) : lit;
}

/** The pack index for any slot, wrapping both ways. `wrapIndex(-1)` is the last creature. */
export function wrapIndex(k: number): number {
  const n = ANIMALS.length;
  return ((Math.round(k) % n) + n) % n;
}

/** The creature a slot shows. */
export function animalAt(k: number): Animal {
  return ANIMALS[wrapIndex(k)]!;
}

/**
 * The slot a released pan settles on.
 *
 * `from` is the slot the drag started on, `position` where the stage is now (in creature
 * units, forward is a finger moving left), `vx` the finger's velocity in points per second
 * and `pitch` the distance between two creatures in points.
 *
 * A flick of at least 800pt/s always lands one past where the stage is, in the direction of
 * the flick, even from a drag of a few points. Otherwise the stage lands on the nearest slot,
 * except that 30% of the way to a neighbour is enough to reach it: `floor(|moved| + 0.7)`.
 * Never more than two slots from `from`.
 */
export function panTarget({ from, position, vx, pitch }: { from: number; position: number; vx: number; pitch: number }): number {
  'worklet';
  const moved = position - from;
  let steps: number;
  if (Math.abs(vx) >= PAN_FLICK_VELOCITY && pitch > 0) {
    const dir = vx < 0 ? 1 : -1;
    // Where it is, rounded AGAINST the flick, then one more in its direction.
    const whole = dir > 0 ? Math.floor(moved + 1e-6) : Math.ceil(moved - 1e-6);
    steps = whole + dir;
  } else {
    const commit = 1 - PAN_COMMIT_SHARE;
    steps = Math.sign(moved) * Math.floor(Math.abs(moved) + commit + 1e-9);
  }
  if (steps > PAN_MAX_STEPS) steps = PAN_MAX_STEPS;
  if (steps < -PAN_MAX_STEPS) steps = -PAN_MAX_STEPS;
  return from + steps;
}
