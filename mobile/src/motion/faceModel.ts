/**
 * The creature's face, as cells. PURE, so `__tests__/motionFace.test.ts` holds it.
 *
 * The island's character is the builder's own creature, not the Grok bot's sphere
 * (docs/motion.md): it takes the sphere's STATE MACHINE and draws it in the pack's one ink. The
 * body is the rest pose (frame 0); the eyes are the two 2 x 2 holes every member of the family
 * shares (`EYES`), and a state fills some of those holes back in.
 */
import { ANIMAL_FRAMES, type Animal } from '../pixel/animals';
import { EMPTY, EYES } from '../pixel/frames';
import type { Eyes } from './states';

export interface Cell {
  x: number;
  y: number;
}

const EYE_KEYS = new Set(EYES.map(([x, y]) => `${x}.${y}`));
const TOP_ROW = Math.min(...EYES.map(([, y]) => y));
const BOTTOM_ROW = Math.max(...EYES.map(([, y]) => y));

/** Which eye cells are filled (closed) for an eye shape. */
export function filledEyeCells(eyes: Eyes): readonly (readonly [number, number])[] {
  switch (eyes) {
    case 'open':
      return [];
    case 'low':
      return EYES.filter(([, y]) => y === TOP_ROW);
    case 'high':
      return EYES.filter(([, y]) => y === BOTTOM_ROW);
    case 'shut':
      return EYES;
  }
}

/**
 * Every inked cell of the creature's face for an eye shape, blinking or not.
 *
 * A blink fills every eye cell whatever the shape, except `shut`, which is already closed.
 * The rest pose's own cells never change: a state moves the lids, not the silhouette, so the
 * nine creatures still read as themselves in every state.
 */
export function faceCells(animal: Animal, eyes: Eyes, blinking = false): Cell[] {
  const frame = ANIMAL_FRAMES[animal]?.[0] ?? [];
  const out: Cell[] = [];
  frame.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] !== EMPTY && !EYE_KEYS.has(`${x}.${y}`)) out.push({ x, y });
    }
  });
  const fill = blinking ? EYES : filledEyeCells(eyes);
  for (const [x, y] of fill) out.push({ x, y });
  return out;
}

/**
 * Cells as ONE path: a square per cell, in the 16 unit grid. One SVG node instead of ninety: a
 * creature drawn as a Rect per cell is ninety native views to lay out and redraw, and a list of
 * fifty sessions drew four and a half thousand of them. The 1.02 overdraw closes the hairline
 * seams antialiasing leaves between squares that only touch.
 */
export function cellsPath(cells: readonly Cell[], size = 1.02): string {
  let d = '';
  for (const c of cells) d += `M${c.x} ${c.y}h${size}v${size}h-${size}Z`;
  return d;
}

/** The eye cells a blink fills, for the blink overlay: open eyes only lose what is still a hole. */
export function blinkCells(eyes: Eyes): Cell[] {
  const filled = new Set(filledEyeCells(eyes).map(([x, y]) => `${x}.${y}`));
  return EYES.filter(([x, y]) => !filled.has(`${x}.${y}`)).map(([x, y]) => ({ x, y }));
}

/**
 * The gap before the next blink, in ms, from a uniform draw `u` in [0, 1). Random on purpose
 * (docs/motion.md: idle loops never sync); the draw is a parameter so a test can hold the range.
 */
export function blinkGap(u: number, min: number, max: number): number {
  return Math.round(min + Math.max(0, Math.min(0.999999, u)) * (max - min));
}
