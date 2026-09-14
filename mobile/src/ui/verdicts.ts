/**
 * The three verdict glyphs as path data (DESIGN-DIRECTION 7.1). Linear's idea: a state is a
 * drawn icon, not a coloured badge, so the verdicts get no colour at all, only `textDim`,
 * a 2pt stroke at any size, and round caps. Pure so the geometry can be tested and rendered
 * outside React Native.
 *
 * On a 16 unit grid centred in an 18 unit box (one unit of room each side for the stroke).
 * - converging: three lines meeting at a point.
 * - circling: a loop with one arrowhead, running clockwise into the top. It is left open
 *   by one arrowhead's length before the head (the `arrow.clockwise` construction): fully
 *   closed, the head merged into the loop at 12pt in a render and read as a bump.
 * - lost: a dashed circle left open at the top.
 */
export type Verdict = 'converging' | 'circling' | 'lost';

export const VERDICTS: readonly Verdict[] = ['converging', 'circling', 'lost'];

export const VERDICT_VIEWBOX = 18;

export const VERDICT_PATHS: Record<Verdict, { d: string; dashed?: boolean }> = {
  converging: { d: 'M2.5 3.5 L13 8 M2.5 8 L13 8 M2.5 12.5 L13 8' },
  circling: { d: 'M11.9 4.1 A5.5 5.5 0 1 1 8 2.5 M6.9 0.3 L9.4 2.5 L6.9 4.7' },
  lost: { d: 'M10.4 3.05 A5.5 5.5 0 1 1 5.6 3.05', dashed: true },
};

/** Stroke in viewBox units that lands as 2pt on screen at `size` points. */
export function verdictStroke(size: number): number {
  return (2 * VERDICT_VIEWBOX) / size;
}

/** The dash pattern of `lost`, in viewBox units, for a stroke of `stroke` units. */
export function verdictDash(stroke: number): [number, number] {
  return [stroke * 0.9, stroke * 1.6];
}
