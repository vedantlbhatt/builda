/**
 * The motion vocabulary as plain numbers (DESIGN-DIRECTION 3.5). No Reanimated import, so
 * the tests can read it; `motion.ts` re-exports all of it next to the `EASE` curve and the
 * Reduce Motion hook. Import from `motion.ts` in components.
 *
 * Frequency gate first: tab switch, scroll and back use the platform default and nothing
 * else. If a finger was involved it is a spring seeded with the gesture's velocity;
 * everything else is timing on `EASE`, under 300ms. Exits are 0.7x their entrance.
 */

/** Settle, drag release, layout. Critically damped: no overshoot. */
export const SNAP = { duration: 400, dampingRatio: 1 };
/** Anything sheet-like, a card fling. */
export const SHEET = { duration: 300, dampingRatio: 0.8 };
/** RARE: the mascot's arrival, a reveal. One soft overshoot. */
export const POP = { duration: 450, dampingRatio: 0.72 };

/** The control points of `EASE`, the one timing curve. Strong ease out. */
export const EASE_BEZIER = [0.23, 1, 0.32, 1] as const;

/** Timing durations in ms. Exits are `exitMs(entrance)`. */
export const T = { press: 120, micro: 180, std: 240, enter: 300 } as const;

/** Per item, capped at `STAGGER_CAP` items; the rest enter as a block. */
export const STAGGER = 40;
export const STAGGER_CAP = 8;

/** Exits are faster than entrances and leave the way they came in. */
export const EXIT_FACTOR = 0.7;

/** Under Reduce Motion every spatial animation becomes this opacity fade. */
export const REDUCED_FADE = 150;

/** Numbers count up over this on FIRST reveal only. Live numbers roll instead. */
export const COUNT_UP_MS = 800;

/** One decrypt tick. Two places only: the archetype reveal and the cryptic prompt card. */
export const DECRYPT_TICK_MS = 40;

/** Buttons and cards scale to this on press-in over `T.press`. Rows highlight instead. */
export const PRESS_SCALE = 0.97;

export function exitMs(entranceMs: number): number {
  // A worklet, because gesture release handlers call it on the UI thread (TiltedCard,
  // MagicBento, PixelCard). As a plain function it crashed the app on the first scroll past the
  // You tab's profile card: "Tried to synchronously call a non-worklet function exitMs".
  'worklet';
  return Math.round(entranceMs * EXIT_FACTOR);
}

/** Delay for the `index`th item of a staggered entrance. */
export function staggerDelay(index: number): number {
  'worklet';
  return Math.min(Math.max(0, Math.floor(index)), STAGGER_CAP) * STAGGER;
}
