/**
 * The page's motion, as plain worklet arithmetic over ONE clock per section.
 *
 * Each section owns a shared value that runs 0 to `SECTION_CLOCK_MS` once, linearly, the first
 * time the section scrolls into view. Every number and every mark in the section reads its own
 * progress off that clock (`phase`), then shapes it with the page's one timing curve (`ease`,
 * the kit's `EASE_BEZIER`, 0.23 1 0.32 1) or a damped spring (`spring`, for bars, which grow
 * with a little give). Nothing re-renders React while it moves, a section that never scrolls
 * into view never animates, and when the clock stops everything is still.
 *
 * Why one clock and not a `withTiming` per mark: a stagger is then just a delay in arithmetic,
 * sixty marks cost one animation, and Reduce Motion is one line (the clock jumps to the end).
 *
 * Pure: no React Native, so `bun test` holds the curves.
 */
import { EASE_BEZIER } from '../ui/motionSpec';

/** How long a section's clock runs. Long enough for the last staggered mark to land. */
export const SECTION_CLOCK_MS = 3200;

/** Number count ups run this long (the brief: 700 to 1100 ms). */
export const COUNT_MS = 950;
/** A bar growing, a line tracing, a ring sweeping. */
export const DRAW_MS = 1000;
/** The gap between one element and the next inside a section. */
export const STAGGER_MS = 90;
/** Under Reduce Motion, everything appears at rest over this fade. */
export const REDUCED_FADE_MS = 150;
/** A block's entrance: it snaps in over the first third and rises into place (V2 3, rule 3). */
export const ENTER_MS = 300;
/** How far text rises as it fades in, in points. */
export const RISE = 10;

/** 0 before `delay`, 1 after `delay + duration`, linear between. */
export function phase(clock: number, delay: number, duration: number): number {
  'worklet';
  if (duration <= 0) return clock >= delay ? 1 : 0;
  const t = (clock - delay) / duration;
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}

const [X1, Y1, X2, Y2] = EASE_BEZIER;

function bez(t: number, a1: number, a2: number): number {
  'worklet';
  return ((1 - 3 * a2 + 3 * a1) * t + (3 * a2 - 6 * a1)) * t * t + 3 * a1 * t;
}

function bezSlope(t: number, a1: number, a2: number): number {
  'worklet';
  return 3 * (1 - 3 * a2 + 3 * a1) * t * t + 2 * (3 * a2 - 6 * a1) * t + 3 * a1;
}

/** The page's timing curve at `x` (0 to 1): cubic bezier 0.23 1 0.32 1, a strong ease out. */
export function ease(x: number): number {
  'worklet';
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  // Newton on x(t) = x, falling back to bisection where the slope flattens.
  let t = x;
  for (let i = 0; i < 8; i++) {
    const err = bez(t, X1, X2) - x;
    if (Math.abs(err) < 1e-6) break;
    const d = bezSlope(t, X1, X2);
    if (Math.abs(d) < 1e-6) break;
    t -= err / d;
  }
  if (t < 0 || t > 1 || Math.abs(bez(t, X1, X2) - x) > 1e-4) {
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 30; i++) {
      const v = bez(t, X1, X2);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
  }
  return bez(t, Y1, Y2);
}

/**
 * A damped spring's step response over normalised time (0 to 1): overshoots about 4% at
 * `damping` 0.72 and has settled to within 0.2% by t = 1, where it is pinned to exactly 1 so a
 * bar at rest is its value and not a hair past it.
 */
export function spring(x: number, damping = 0.72): number {
  'worklet';
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const z = Math.min(0.99, Math.max(0.1, damping));
  const w = 9;
  const wd = w * Math.sqrt(1 - z * z);
  const env = Math.exp(-z * w * x);
  return 1 - env * (Math.cos(wd * x) + ((z * w) / wd) * Math.sin(wd * x));
}

/** `ease` over a staggered window of the clock: the usual way a mark reads its progress. */
export function eased(clock: number, delay: number, duration: number = DRAW_MS): number {
  'worklet';
  return ease(phase(clock, delay, duration));
}

/** `spring` over a staggered window of the clock. */
export function sprung(clock: number, delay: number, duration: number = DRAW_MS): number {
  'worklet';
  return spring(phase(clock, delay, duration));
}

/** Delay of the `i`th element of a stagger that starts at `start`. */
export function nth(i: number, start = 0, step = STAGGER_MS): number {
  return start + Math.max(0, i) * step;
}
