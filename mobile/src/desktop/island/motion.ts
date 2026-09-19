/**
 * The desktop pill's motion. The springs and timings are `src/motion/spec.ts`'s, re-exported, so a
 * spring still lives in one place (docs/motion.md); only what is the desktop's own lives here: how
 * long a pointer may leave before the pill folds, and the two helpers its morph uses.
 *
 * This was a verbatim copy while the two branches were written side by side; it became a
 * re-export when they met, and `__tests__/desktop.test.ts` still pins the numbers it reads.
 */
export {
  BLINK,
  BREATHE_BACK_MS,
  BREATHE_OUT_MS,
  CONTENT,
  CONTENT_IN,
  CONTENT_OUT,
  EXIT_MS,
  IN_RISE,
  IN_SCALE,
  ISLAND,
  OUT_SCALE,
  POP,
  SHIMMER_MS,
  STAGGER_MS,
  WHEEL,
  WORD_MS,
  type SpringSpec,
} from '../../motion/spec';
import type { SpringSpec } from '../../motion/spec';

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
