/**
 * The geometry of StarBorder's comet, apart from the component so `bun test` can hold it:
 * the tile's continuous corner outline as path commands, the trim windows that walk a comet
 * round it, the dash that thins its tail by cells, and the stage that keeps one comet on
 * screen at a time.
 *
 * Ported from react-bits `Animations/StarBorder/StarBorder.tsx` by David Haz.
 * react-bits is MIT + Commons Clause (Copyright (c) 2026 David Haz): the notice is kept
 * here as the licence asks, and the port is used as part of this application only; it is
 * not to be redistributed as a component.
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy of this
 *   software and associated documentation files (the "Software"), to deal in the Software
 *   without restriction, including without limitation the rights to use, copy, modify,
 *   merge, publish, and distribute the Software as part of an application, website, or
 *   product, subject to the following conditions: The above copyright notice and this
 *   permission notice shall be included in all copies or substantial portions of the
 *   Software. Commons Clause Restriction: You may use this Software, including for any
 *   commercial purpose, so long as you do not sell, sublicense, or redistribute the
 *   components themselves, whether alone, in a bundle, or as a ported version.
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
 *
 * What changed in the port: the original slides two radial gradient glows along the top
 * and bottom edges of a clipped box, forever. Here one comet runs the tile's own edge (the
 * continuous corner outline below, so it sits on the hairline instead of cutting the
 * corners), 24% of the perimeter long, 6s a lap as the original's `speed`, for three laps,
 * and then the edge stays lit as a still outline. No gradient and no blur: the head is solid
 * and the tail thins in three flat steps of density, each a dash of whole stroke-sized cells.
 */

/** A path command: move, line, cubic, close. Plain arrays so a test can read them. */
export type PathCmd =
  | readonly ['M', number, number]
  | readonly ['L', number, number]
  | readonly ['C', number, number, number, number, number, number]
  | readonly ['Z'];

/**
 * iOS's continuous corner (`borderCurve: 'continuous'`, `CALayer.cornerCurve`) is not a
 * circular arc: it starts easing in 1.52866 radii from the corner and meets the edge with
 * matching curvature. These are the control points of that curve in radius units, the widely
 * used reconstruction of `UIBezierPath(roundedRect:cornerRadius:)`, measured from the corner.
 */
export const CONTINUOUS_EXTENT = 1.52866483;
const K = {
  a: 1.08849323,
  b: 0.86840689,
  c: 0.66993427,
  d: 0.065496,
  e: 0.37282392,
  f: 0.16244129,
} as const;

/** The largest radius a continuous corner can have in a `width` by `height` box. */
export function continuousRadiusLimit(width: number, height: number): number {
  return Math.max(0, Math.min(width, height) / 2 / CONTINUOUS_EXTENT);
}

/**
 * The outline of a continuous corner rounded rect at (`x`, `y`), `width` by `height`, corner
 * `radius`, clockwise from the end of the top left corner. `laps` repeats the outline without
 * closing it, so a trim window can cross the start point and stay one piece (a comet whose
 * head has passed the start while its tail has not). One lap closes the contour.
 */
export function continuousRect(x: number, y: number, width: number, height: number, radius: number, laps = 1): PathCmd[] {
  const r = Math.max(0, Math.min(radius, continuousRadiusLimit(width, height)));
  const right = x + width;
  const bottom = y + height;
  const tl = (px: number, py: number): [number, number] => [x + px * r, y + py * r];
  const tr = (px: number, py: number): [number, number] => [right - px * r, y + py * r];
  const br = (px: number, py: number): [number, number] => [right - px * r, bottom - py * r];
  const bl = (px: number, py: number): [number, number] => [x + px * r, bottom - py * r];
  const E = CONTINUOUS_EXTENT;
  const c = (p1: [number, number], p2: [number, number], p: [number, number]): PathCmd => ['C', p1[0], p1[1], p2[0], p2[1], p[0], p[1]];
  const l = (p: [number, number]): PathCmd => ['L', p[0], p[1]];

  const lap: PathCmd[] = [
    l(tr(E, 0)),
    c(tr(K.a, 0), tr(K.b, 0), tr(K.c, K.d)),
    c(tr(K.e, K.f), tr(K.f, K.e), tr(K.d, K.c)),
    c(tr(0, K.b), tr(0, K.a), tr(0, E)),
    l(br(0, E)),
    c(br(0, K.a), br(0, K.b), br(K.d, K.c)),
    c(br(K.f, K.e), br(K.e, K.f), br(K.c, K.d)),
    c(br(K.b, 0), br(K.a, 0), br(E, 0)),
    l(bl(E, 0)),
    c(bl(K.a, 0), bl(K.b, 0), bl(K.c, K.d)),
    c(bl(K.e, K.f), bl(K.f, K.e), bl(K.d, K.c)),
    c(bl(0, K.b), bl(0, K.a), bl(0, E)),
    l(tl(0, E)),
    c(tl(0, K.a), tl(0, K.b), tl(K.d, K.c)),
    c(tl(K.f, K.e), tl(K.e, K.f), tl(K.c, K.d)),
    c(tl(K.b, 0), tl(K.a, 0), tl(E, 0)),
  ];
  const start = tl(E, 0);
  const out: PathCmd[] = [['M', start[0], start[1]]];
  const n = Math.max(1, Math.floor(laps));
  for (let i = 0; i < n; i++) out.push(...lap);
  if (n === 1) out.push(['Z']);
  return out;
}

/**
 * The outline a stroke of `stroke` points should follow to lie inside a `width` by `height`
 * tile with corner `radius`: inset by half the stroke, the radius concentric with the tile's.
 */
export function strokeOutline(width: number, height: number, radius: number, stroke: number, laps = 1): PathCmd[] {
  const h = stroke / 2;
  return continuousRect(h, h, Math.max(0, width - stroke), Math.max(0, height - stroke), Math.max(0, radius - h), laps);
}

// ─── the walk ──────────────────────────────────────────────────────────────────────────

/** One piece of the comet: a trim window on the two-lap outline, and how dense its cells are. */
export interface CometPart {
  /** Trim start and end, fractions of the TWO-lap path. */
  start: number;
  end: number;
  /** 1 is solid; below 1 the piece is a dash with that share of its length inked. */
  density: number;
}

/**
 * The comet with its head at `head` laps round the outline (only the fractional part
 * counts), `length` laps long, cut into a solid head and one piece per `tail` density,
 * equal lengths, head first. Positions are on the two-lap path, where the comet always sits
 * inside the second lap's span `[head + 1 - length, head + 1]`, so no piece ever wraps.
 */
export function cometParts(head: number, length: number, tail: readonly number[]): CometPart[] {
  'worklet';
  const h = head - Math.floor(head);
  const L = Math.min(0.95, Math.max(0, length));
  const n = tail.length + 1;
  const seg = L / n;
  const tip = h + 1;
  const parts: CometPart[] = [];
  for (let k = 0; k < n; k++) {
    const end = tip - k * seg;
    const start = end - seg;
    parts.push({ start: start / 2, end: end / 2, density: k === 0 ? 1 : (tail[k - 1] ?? 1) });
  }
  return parts;
}

/**
 * The trim window of piece `k` alone, for a derived value per piece: `[start, end]` on the
 * two-lap path. The same arithmetic as `cometParts`, without building the array.
 */
export function cometPart(head: number, length: number, pieces: number, k: number): [number, number] {
  'worklet';
  const h = head - Math.floor(head);
  const L = Math.min(0.95, Math.max(0, length));
  const seg = L / Math.max(1, pieces);
  const end = h + 1 - k * seg;
  return [(end - seg) / 2, end / 2];
}

/**
 * The dash that makes a piece `density` inked with cells as long as the stroke is wide:
 * `[on, off]` in points. 1 (or more) is solid and returns null. 0.5 is one cell on, one off.
 */
export function tailDash(density: number, stroke: number): [number, number] | null {
  if (density >= 1) return null;
  const d = Math.max(0.05, density);
  return [stroke, (stroke * (1 - d)) / d];
}

// ─── one comet on screen ───────────────────────────────────────────────────────────────

/**
 * A comet is the one thing on a live screen asking for you, so there is only ever one
 * (DESIGN-V2 3.2: "the top needs you tile"). Every StarBorder that wants to run claims the
 * stage; the first claimant runs its comet, the rest draw the still outline, and when the
 * runner leaves the next in line takes over. Mission control mounts tiles top first, so the
 * first claim is the top tile's.
 */
export interface Stage {
  claim(id: number): void;
  release(id: number): void;
  owner(): number | null;
  subscribe(listener: () => void): () => void;
}

export function createStage(): Stage {
  let queue: number[] = [];
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const l of listeners) l();
  };
  return {
    claim(id) {
      if (queue.includes(id)) return;
      queue = [...queue, id];
      notify();
    },
    release(id) {
      if (!queue.includes(id)) return;
      queue = queue.filter((q) => q !== id);
      notify();
    },
    owner() {
      return queue[0] ?? null;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The app's one comet stage. */
export const cometStage: Stage = createStage();

let nextStageId = 1;
/** A fresh id for a StarBorder instance. */
export function newStageId(): number {
  return nextStageId++;
}

/**
 * Where the head is after `elapsedMs` of `laps` laps of `lapMs`: laps travelled so far,
 * clamped to the run. The component drives this from a Reanimated timing; the function is
 * what a paused run resumes from.
 */
export function cometHead(elapsedMs: number, lapMs: number, laps: number): number {
  if (lapMs <= 0) return laps;
  return Math.min(laps, Math.max(0, elapsedMs / lapMs));
}
