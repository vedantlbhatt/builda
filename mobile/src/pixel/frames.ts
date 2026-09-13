/**
 * Frame helpers for the pixel identity: Bit (`sprites.ts`) and the creature pack
 * (`animals.ts`).
 *
 * A frame is 16 rows of 16 characters. '.' is transparent; every other character is a
 * palette ROLE, not a colour. The colour is resolved per scheme at render time
 * (`palette.ts`), so one set of frames serves light and dark, the selected tile and a
 * dimmed neighbour.
 *
 * Everything here is pure and free of React Native imports so it runs under `bun test`.
 */

export type Frame = string[];

export const GRID = 16;

/** The transparent glyph. */
export const EMPTY = '.';

/**
 * Palette roles a frame may use. Anything else fails `validateFrame`, so a typo in a
 * sprite string is a test failure rather than a pixel silently rendered in the fallback
 * colour.
 *
 *   b  body   the one ink every identity glyph is drawn in
 *   w  spark  Bit's hammer sparks
 *   h  tool   Bit's hammer
 *   z  trail  Bit's z's, thought dots and confetti
 *
 * ONE INK. All four resolve to the same colour (`palette.ts`). The letters exist only so
 * `motion.ts` can lift a spark or a z out of a frame and give it its own motion; they are
 * roles, not tones. There is no dark body role and no eye colour any more: the pack used to
 * draw eyes, mouths and feet in a darker amber that sank into the background, and that is
 * the "orange and black" the owner asked to lose. Eyes are HOLES now (`EYES`).
 */
export const GLYPHS = ['b', 'w', 'h', 'z'] as const;
export type Glyph = (typeof GLYPHS)[number];

/** Glyphs that count as "the character's body" when checking frame consistency. */
export const BODY_GLYPHS: readonly Glyph[] = ['b'];

/**
 * The eyes of every member of the family, as `[x, y]` cells: two 2x2 holes on rows 6 and 7,
 * at columns 5-6 and 9-10, with a two-cell bridge between them. The same eight cells in Bit
 * and in all eight creatures, which is most of what makes nine different silhouettes read as
 * one set. A blink fills them (`closeEyes` in `motion.ts`).
 *
 * They were 1x2 slots at columns 6 and 9 (round 5). At 16 pt @3x a slot is 3x6 device pixels
 * and the blink barely registers; a 2x2 hole is 6x6. The slots also read as stern, and on Bit
 * (a square amber body with side nubs and two legs) they made him Clawd, Claude Code's own
 * mascot, which is the "orange and black thing" the owner asked to lose.
 */
export const EYES: readonly (readonly [number, number])[] = [
  [5, 6],
  [6, 6],
  [5, 7],
  [6, 7],
  [9, 6],
  [10, 6],
  [9, 7],
  [10, 7],
];

const KNOWN = new Set<string>([EMPTY, ...GLYPHS]);

export interface Run {
  start: number;
  length: number;
  ch: string;
}

/**
 * Run-length encode one row. `"..bbb.b"` → `[. x2, b x3, . x1, b x1]`.
 *
 * Transparent runs are returned too — this is a plain RLE, and the renderer is the one
 * that decides '.' draws nothing. One Rect per run rather than per pixel keeps a 16×16
 * frame at ~40 nodes instead of 256.
 */
export function runsFor(row: string): Run[] {
  const runs: Run[] = [];
  for (let i = 0; i < row.length; i++) {
    const ch = row[i]!;
    const last = runs[runs.length - 1];
    if (last && last.ch === ch) {
      last.length += 1;
    } else {
      runs.push({ start: i, length: 1, ch });
    }
  }
  return runs;
}

/**
 * Problems with a frame, or an empty array when it is well-formed. Returned rather than
 * thrown so a test can print every fault in a sprite at once instead of the first one.
 */
export function validateFrame(frame: Frame): string[] {
  const problems: string[] = [];
  if (frame.length !== GRID) {
    problems.push(`expected ${GRID} rows, got ${frame.length}`);
  }
  frame.forEach((row, y) => {
    if (row.length !== GRID) {
      problems.push(`row ${y}: expected ${GRID} columns, got ${row.length}`);
    }
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!;
      if (!KNOWN.has(ch)) problems.push(`row ${y} col ${x}: unknown glyph '${ch}'`);
    }
  });
  return problems;
}

export function isValidFrame(frame: Frame): boolean {
  return validateFrame(frame).length === 0;
}

/** Horizontal flip. `mirror(mirror(f))` is `f`. */
export function mirror(frame: Frame): Frame {
  return frame.map((row) => row.split('').reverse().join(''));
}

/** Count of pixels drawn with any of `glyphs` (default: the body glyphs). */
export function countGlyphs(frame: Frame, glyphs: readonly string[] = BODY_GLYPHS): number {
  const set = new Set(glyphs);
  let n = 0;
  for (const row of frame) for (const ch of row) if (set.has(ch)) n += 1;
  return n;
}

/**
 * The transparent cells the drawing encloses: empty, and with no 4-connected path of
 * empty cells to outside the grid. These are the eyes, a nose, a beak. A notch that opens
 * to the outside (the gap under a dog's ear) is not a hole. Row-major `[x, y]` pairs.
 */
export function holes(frame: Frame): [number, number][] {
  const drawn = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < GRID && y < GRID && (frame[y]?.[x] ?? EMPTY) !== EMPTY;
  const outside = new Set<string>();
  const stack: [number, number][] = [[-1, -1]];
  outside.add('-1,-1');
  while (stack.length) {
    const [x, y] = stack.pop()!;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      const k = `${nx},${ny}`;
      if (nx < -1 || ny < -1 || nx > GRID || ny > GRID || outside.has(k) || drawn(nx, ny)) continue;
      outside.add(k);
      stack.push([nx, ny]);
    }
  }
  const out: [number, number][] = [];
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) if (!drawn(x, y) && !outside.has(`${x},${y}`)) out.push([x, y]);
  }
  return out;
}

/** Whether both eyes are open: all four `EYES` cells are holes. */
export function eyesOpen(frame: Frame): boolean {
  const h = new Set(holes(frame).map(([x, y]) => `${x},${y}`));
  return EYES.every(([x, y]) => h.has(`${x},${y}`));
}

/**
 * Plain-text rendering, for test output and eyeballing. Transparent pixels become a
 * space so the silhouette is readable in a terminal.
 */
export function ascii(frame: Frame): string {
  return frame.map((row) => row.replace(/\./g, ' ')).join('\n');
}
