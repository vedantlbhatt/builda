/**
 * The island's motion, as plain numbers. The ONLY place a spring lives (docs/motion.md).
 *
 * Measured off the notch kit's source clip (720 x 720, 30 fps, 53 s) frame by frame, then held
 * against the physics: a container that rises to its first peak in about 300 ms, passes its
 * target by about 10% and is still at about 450 ms is an underdamped spring with a damping ratio
 * near 0.59. `damping 17, stiffness 210, mass 1` is 0.587, peaks at 268 ms and overshoots 10.3%
 * (`peakMs`, `overshoot` below, and `__tests__/motionSpec.test.ts` holds both). The Swift side
 * (`IslandMotion.swift`, the widget) copies these numbers and a test holds the copies equal.
 *
 * No Reanimated import, so tests and the web build read it as data. `springs.ts` turns these into
 * Reanimated configs.
 */

export interface SpringSpec {
  readonly damping: number;
  readonly stiffness: number;
  readonly mass: number;
}

/**
 * Every container morph: the island, a card opening into its page, a sheet. Underdamped on
 * purpose. The overshoot IS the effect: a box that arrives exactly at its size reads as a
 * resized rectangle, one that passes it and comes back reads as an object with weight.
 */
export const ISLAND: SpringSpec = { damping: 17, stiffness: 210, mass: 1 };

/**
 * What rides inside a container. Stiffer and better damped, so text and faces settle BEFORE the
 * box does; content that is still moving when its box stops looks loose.
 */
export const CONTENT: SpringSpec = { damping: 22, stiffness: 320, mass: 0.9 };

/** Small things arriving: a chip, a face on the rail, a badge. Light and quick. */
export const POP: SpringSpec = { damping: 14, stiffness: 260, mass: 0.7 };

/** The status wheel and anything list-like that moves as one. Heavier, so a step feels weighted. */
export const WHEEL: SpringSpec = { damping: 20, stiffness: 190, mass: 1 };

/**
 * A finger let go. Critically damped or close to it (ratio 0.75 here would still wobble under a
 * thumb, 0.95 does not), because a thing you placed should stay where you placed it.
 */
export const SNAP: SpringSpec = { damping: 33, stiffness: 300, mass: 1 };

/**
 * Where the content layers sit on a morph's 0 to 1 progress.
 *
 * The outgoing layer is gone by 0.28 and scales UP as it leaves, so it reads as passing the
 * viewer rather than shrinking into the box; the incoming one starts at 0.34, when the box is
 * most of the way open, rises 5 points and grows from 0.92. The gap between 0.28 and 0.34 is
 * deliberate: a frame or two of empty black is what makes the morph read as one object changing,
 * not two layers cross fading.
 */
export const CONTENT_OUT: readonly [number, number] = [0, 0.28];
export const CONTENT_IN: readonly [number, number] = [0.34, 0.84];
export const OUT_SCALE = 1.22;
export const IN_SCALE = 0.92;
export const IN_RISE = 5;

/** Chips, rows, anything in a group: each one this long after the last. Entrances only. */
export const STAGGER_MS = 45;
/** Faces on the agent rail, a touch slower so each one registers as a different agent. */
export const RAIL_STAGGER_MS = 60;
/** A sentence, a word at a time: slow enough to read as speech, fast enough nobody waits. */
export const WORD_MS = 55;
/** Everything in a group leaves together, in this long. A staggered exit feels reluctant. */
export const EXIT_MS = 120;
/** Past this many, a stagger stops adding delay: the tenth chip should not wait half a second. */
export const STAGGER_CAP = 10;

/**
 * The character's idle loops. Deliberately mismatched: breathe out and back take different
 * times, and the blink is random, so the creature never falls into a rhythm you can see.
 * Breath moves the GLOW only: the pixel family's rule 7 (`src/pixel/animals.ts`) forbids a
 * scale breath on the pixels themselves, which would put them between device pixels.
 */
export const BREATHE_OUT_MS = 1500;
export const BREATHE_BACK_MS = 1700;
export const BLINK = { minGapMs: 1800, maxGapMs: 5000, closeMs: 70, openMs: 90, double: 0.25 } as const;

/** One pass of the light across the active line of a wheel. */
export const SHIMMER_MS = 1800;
/** One turn of the aura around whatever an agent is driving. Slow: it is a presence, not a spinner. */
export const AURA_TURN_MS = 6000;

/** Delay for the `i`th item of a staggered entrance. */
export function staggerDelay(i: number, per: number = STAGGER_MS): number {
  'worklet';
  return Math.min(Math.max(0, Math.floor(i)), STAGGER_CAP) * per;
}

/**
 * Where a spring released from rest at 0 toward 1 is after `ms`, in closed form. For surfaces that
 * play on a CLOCK rather than on a Reanimated spring (the chapter bands read their block's clock,
 * `insights/reveal.tsx`), so they can still move with the island's physics: the same overshoot and
 * settle as `withSpring(1, ISLAND)`, as a pure function of time. A worklet.
 */
export function springAt(ms: number, s: SpringSpec = ISLAND): number {
  'worklet';
  if (ms <= 0) return 0;
  const t = ms / 1000;
  const w0 = Math.sqrt(s.stiffness / s.mass);
  const z = s.damping / (2 * Math.sqrt(s.stiffness * s.mass));
  if (z >= 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const wd = w0 * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z / Math.sqrt(1 - z * z)) * Math.sin(wd * t));
}

/** The damping ratio: under 1 overshoots, 1 is critical. */
export function dampingRatio(s: SpringSpec): number {
  return s.damping / (2 * Math.sqrt(s.stiffness * s.mass));
}

/** When an underdamped spring released from rest first reaches its peak, in ms. */
export function peakMs(s: SpringSpec): number {
  const w0 = Math.sqrt(s.stiffness / s.mass);
  const z = dampingRatio(s);
  if (z >= 1) return Infinity;
  return (Math.PI / (w0 * Math.sqrt(1 - z * z))) * 1000;
}

/** How far past its target it goes, as a fraction of the distance travelled. */
export function overshoot(s: SpringSpec): number {
  const z = dampingRatio(s);
  if (z >= 1) return 0;
  return Math.exp((-z * Math.PI) / Math.sqrt(1 - z * z));
}

/**
 * When the spring is within `eps` of its target for good (the envelope, not the oscillation),
 * in ms. The clip's container reads as still at about 450 ms at a 2% eye.
 */
export function settleMs(s: SpringSpec, eps = 0.02): number {
  const w0 = Math.sqrt(s.stiffness / s.mass);
  const z = dampingRatio(s);
  return (Math.log(1 / eps) / (z * w0)) * 1000;
}
