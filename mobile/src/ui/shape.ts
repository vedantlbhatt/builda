import { tokens } from '../generated/tokens';

/**
 * The radius rule, stated once (DESIGN-DIRECTION 3.4): actions are capsules; containers
 * are 18; things inside a container are 12; marks are 6; Wrapped and share cards are 28.
 * Sheets and the island belong to the system. Every kit component takes its radius from
 * here, never from a literal, and `__tests__/uikit.test.ts` scans the kit to hold that.
 */
export const RADIUS_SCALE = [
  tokens.radius.xs,
  tokens.radius.sm,
  tokens.radius.md,
  tokens.radius.lg,
  tokens.radius.pill,
] as const;

export const SHAPE = {
  /** Buttons, the progress capsule: a pill. */
  action: tokens.radius.pill,
  /** Cards, tiles, grouped lists. */
  container: tokens.radius.md,
  /** A thing inside a container: an input fill, a nested tile. */
  inner: tokens.radius.sm,
  /** Swatches and small marks. */
  mark: tokens.radius.xs,
  /** Wrapped and share cards. */
  wrapped: tokens.radius.lg,
} as const;

export type ShapeName = keyof typeof SHAPE;

/** Concentric corners: the inner radius is the outer one minus the padding between them. */
export function concentric(outer: number, inset: number): number {
  return Math.max(0, outer - inset);
}

/** The dashed outline on a Wrapped card sits 8pt inside the card's edge. */
export const DASH_INSET = tokens.space.sm;
/** Derived, not chosen: concentric with the 28pt card at an 8pt inset. */
export const DASHED_FRAME_RADIUS = concentric(SHAPE.wrapped, DASH_INSET);
/** Skia `DashPathEffect` intervals: 4pt on, 4pt off. */
export const DASH_INTERVALS = [4, 4] as const;

/** Window chrome dots on a Wrapped card: three, 6pt, 8pt apart. */
export const WINDOW_DOT = { size: 6, gap: tokens.space.sm, count: 3 } as const;

/** Stroke for a progress ring of `size` when none is given: 5pt at 44, never under 2. */
export function ringStroke(size: number): number {
  return Math.max(2, Math.round((size * 5) / 44));
}

/**
 * The no-ETA track: whole dots evenly round the circle, about 2.2 strokes apart, drawn as
 * near-zero dashes with round caps. `interval` is the dash period along the circumference.
 */
export function dottedTrack(size: number, stroke: number): { count: number; interval: number } {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const count = Math.max(8, Math.round(circumference / (stroke * 2.2)));
  return { count, interval: circumference / count };
}
