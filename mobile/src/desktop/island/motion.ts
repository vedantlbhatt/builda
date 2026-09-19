/**
 * The island's springs, as the desktop pill uses them.
 *
 * A LOCAL COPY, TO BE MERGED. `docs/motion.md` makes `src/motion/spec.ts` the only place a spring
 * lives; that file is being written on the motion branch at the same time as this one and was not
 * in this worktree. The numbers below are that file's, verbatim (ISLAND, CONTENT, POP, WHEEL and
 * the content timings); when the branches meet, delete this file and import `../../motion/spec`.
 * `__tests__/desktopIsland.test.ts` pins them so a drift before then fails loudly.
 */

export interface SpringSpec {
  readonly damping: number;
  readonly stiffness: number;
  readonly mass: number;
}

/** Every container morph. Underdamped: first peak ~270 ms, ~10% past the target. */
export const ISLAND: SpringSpec = { damping: 17, stiffness: 210, mass: 1 };
/** What rides inside a container: stiffer, so it settles before the box does. */
export const CONTENT: SpringSpec = { damping: 22, stiffness: 320, mass: 0.9 };
/** Small things arriving: a dot, a face, a badge. */
export const POP: SpringSpec = { damping: 14, stiffness: 260, mass: 0.7 };
/** The status wheel and anything list-like that moves as one. */
export const WHEEL: SpringSpec = { damping: 20, stiffness: 190, mass: 1 };

/** Where the content layers sit on a morph's 0 to 1 progress. Out is gone by 0.28, in starts at 0.34. */
export const CONTENT_OUT: readonly [number, number] = [0, 0.28];
export const CONTENT_IN: readonly [number, number] = [0.34, 0.84];
export const OUT_SCALE = 1.22;
export const IN_SCALE = 0.92;
export const IN_RISE = 5;

/** Entrances stagger; exits never do. */
export const STAGGER_MS = 45;
export const WORD_MS = 55;
export const EXIT_MS = 120;

/** Idle loops, mismatched on purpose so the face never falls into a rhythm. */
export const BREATHE_OUT_MS = 1500;
export const BREATHE_BACK_MS = 1700;
export const BLINK = { minGapMs: 1800, maxGapMs: 5000, closeMs: 70, openMs: 90, double: 0.25 } as const;
export const SHIMMER_MS = 1800;

/** How long the pointer may leave before the island folds back: a pass over it is not a leave. */
export const LEAVE_GRACE_MS = 260;

/** A spec as Reanimated's `withSpring` config. */
export function springConfig(s: SpringSpec) {
  return { damping: s.damping, stiffness: s.stiffness, mass: s.mass, overshootClamping: false } as const;
}

/** Linear map of `p` from [a, b] to [0, 1], clamped. */
export function phase(p: number, [a, b]: readonly [number, number]): number {
  'worklet';
  if (b <= a) return p >= b ? 1 : 0;
  return Math.min(1, Math.max(0, (p - a) / (b - a)));
}
