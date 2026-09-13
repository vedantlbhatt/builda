/**
 * The harness glyphs: one small pixel mark per coding tool, drawn as one family.
 *
 * DESIGN-DIRECTION 5. The owner's note was that the icons were "an orange and black mess"
 * and should all be "the same thing, the same picker thing". So every mark here obeys the
 * same four rules, and `__tests__/harness.test.ts` holds all of them:
 *
 *   1. ONE ROLE. Frames draw only `b`. It renders in `text` on a dark surface, `onAccent`
 *      (#1C1917) on the selected amber tile and `textFaint` when the tool was not found. No
 *      brand colour ever appears: Claude's terracotta, Gemini's gradient and Cursor's black
 *      are left to the vendors. Identity comes from shape and the name under it.
 *   2. SAME GRID. 16x16 frames in the `frames.ts` format, everything inside the 12x12 live
 *      area (cells 2 to 13 on both axes), centred in it.
 *   3. SAME WEIGHT. Strokes are 2 cells (a 45 degree stroke is 3 cells per row, which is 2.1
 *      cells measured across it), and every mark's filled-cell count is within 15% of the
 *      set's mean, so no tool looks louder than another in a row of tiles.
 *   4. SYMMETRIC WHERE THE SOURCE IS. `symmetry` on each mark declares which symmetries the
 *      vendor's own mark has, and the test holds the drawing to every one of them. A drawing
 *      may be more symmetric than its source only where the one-colour rule dropped the
 *      asymmetric part (opencode's second grey, Cursor's shaded faces).
 *
 * Render only at 16, 32, 48 or 64 pt (`GLYPH_SIZES`): whole points per cell, so at @2x and
 * @3x every cell is whole device pixels and nothing is anti-aliased.
 *
 * Pure, no React Native imports, so `bun test` can hold it. `HarnessGlyph.tsx` draws a mark
 * and `HarnessPicker.tsx` is the one picker every surface uses.
 */

import type { Frame } from './frames';

/**
 * The wire values, in the order `privacy/upload-contract.json` declares them. A new value
 * there is a failing test here until it has a mark and a name.
 */
export const HARNESSES = [
  'claude_code',
  'cursor_ide',
  'cursor_agent',
  'codex',
  'gemini_cli',
  'cline',
  'opencode',
  'aider',
] as const;
export type Harness = (typeof HARNESSES)[number];

export type Symmetry = 'mirror' | 'flip' | 'rotate';

// ─── the marks ───────────────────────────────────────────────────────────────────────

/**
 * Claude Code: an eight-ray spark. Four rays on the axes and four on the diagonals, every one
 * 2 cells wide and ending on the same ring, meeting in a solid centre. Claude's own spark has
 * more rays of uneven length; eight equal ones are the simplification, not a trace.
 */
const CLAUDE_CODE: Frame = [
  '................',
  '................',
  '................',
  '...bb..bb..bb...',
  '....bb.bb.bb....',
  '.....bbbbbb.....',
  '......bbbb......',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '......bbbb......',
  '.....bbbbbb.....',
  '....bb.bb.bb....',
  '...bb..bb..bb...',
  '................',
  '................',
  '................',
];

/**
 * Codex: the hexagon of OpenAI's knot, closed into a ring that opens on the right. Every
 * diagonal is 3 cells a row, the same stroke as Aider's chevron and the bars.
 *
 * It was the knot itself, two strands crossing at opposite corners, for rounds 3 to 5. At 16
 * pt the two crossings are two breaks, and a hexagon broken at opposite corners is an "S" (all
 * three round-5 reviewers read it as an S, a G or a 5). Thickening its diagonals to 3 cells a
 * row did not change that, so this is the fallback the first reviewer named: one opening, a
 * hexagonal C. A letter, like opencode's "o" and Aider's `>_`, and not a letter any other tool
 * in the set is drawn as.
 */
const CODEX: Frame = [
  '................',
  '................',
  '.....bbbbbb.....',
  '....bbbbbbbb....',
  '...bbb....bbb...',
  '..bbb......bbb..',
  '..bb........bb..',
  '..bb............',
  '..bb............',
  '..bb........bb..',
  '..bbb......bbb..',
  '...bbb....bbb...',
  '....bbbbbbbb....',
  '.....bbbbbb.....',
  '................',
  '................',
];

/**
 * Cursor (the IDE and cursor-agent): an isometric cube, pointed top and bottom. The top face is
 * solid (the "one solid face" of DESIGN-DIRECTION 5), a two-cell edge runs down the centre from
 * its lowest point, and the two side faces are open, each a parallelogram whose top and bottom
 * both slope down toward the centre edge, as an isometric face does.
 *
 * Round 5 drew Cursor's own arrowhead cut into a hexagon with one solid face; with no second
 * tone to separate the faces it read as a shield or a guitar pick, and it was the only mark
 * asymmetric on every axis. Cursor's mark is shaded faces, which one colour cannot carry, so
 * the drawing is the cube those faces make and is mirror-symmetric where the source is not.
 */
const CURSOR: Frame = [
  '................',
  '................',
  '................',
  '.......bb.......',
  '.....bbbbbb.....',
  '...bbbbbbbbbb...',
  '...bb.bbbb.bb...',
  '...bb..bb..bb...',
  '...bb..bb..bb...',
  '...bb..bb..bb...',
  '...bb..bb..bb...',
  '...bbb.bb.bbb...',
  '......bbbb......',
  '.......bb.......',
  '................',
  '................',
];

/**
 * Gemini CLI: a four-point star with concave sides, made the way the sparkle is made: four
 * quarter-circle arcs centred on the corners of the live area, radius 5.5 cells, rasterised.
 * It has no diagonal rays, so it can never read as the Claude spark (a test checks those cells).
 */
const GEMINI_CLI: Frame = [
  '................',
  '................',
  '.......bb.......',
  '.......bb.......',
  '.......bb.......',
  '......bbbb......',
  '.....bbbbbb.....',
  '..bbbbbbbbbbbb..',
  '..bbbbbbbbbbbb..',
  '.....bbbbbb.....',
  '......bbbb......',
  '.......bb.......',
  '.......bb.......',
  '.......bb.......',
  '................',
  '................',
];

/**
 * Cline: the robot head. A solid head with two 2x3 eye holes, the antenna sitting on it, and a
 * one-cell ear nub either side: the three parts of Cline's own mark, and nothing else. The
 * antenna is one row, not two, which centres the mark in the live area (rows 4 to 11) and
 * keeps it from reading as Bit's head with its T antenna.
 */
const CLINE: Frame = [
  '................',
  '................',
  '................',
  '................',
  '.......bb.......',
  '....bbbbbbbb....',
  '...bbbbbbbbbb...',
  '..bbb..bb..bbb..',
  '..bbb..bb..bbb..',
  '...bb..bb..bb...',
  '...bbbbbbbbbb...',
  '....bbbbbbbb....',
  '................',
  '................',
  '................',
  '................',
];

/**
 * opencode: the block "o" of the opencode wordmark, a 4:5 block with a 2-cell stroke, and the
 * wordmark's notch drawn solid: the lower half of the counter is filled, so what is left open
 * is a 4x4 window sitting high. An empty ring read as a zero, as the box a missing character
 * is drawn as, and in a picker as an unticked checkbox.
 */
const OPENCODE: Frame = [
  '................',
  '................',
  '................',
  '....bbbbbbbb....',
  '....bbbbbbbb....',
  '....bb....bb....',
  '....bb....bb....',
  '....bb....bb....',
  '....bb....bb....',
  '....bbbbbbbb....',
  '....bbbbbbbb....',
  '....bbbbbbbb....',
  '....bbbbbbbb....',
  '................',
  '................',
  '................',
];

/**
 * Aider: a `>_` prompt. A 45 degree chevron (3 cells per row, 2.1 across) with square 3-cell
 * ends and a flat tip, and the cursor bar on the baseline two clear cells to its right: with
 * one, the two touched at 16 pt and read as "≥". Aider has no mark of its own, only its name
 * in a terminal. The lightest drawing in the set by nature; the bar runs to the live edge.
 */
const AIDER: Frame = [
  '................',
  '................',
  '..bbb...........',
  '..bbb...........',
  '...bbb..........',
  '....bbb.........',
  '.....bbb........',
  '......bbbb......',
  '......bbbb......',
  '.....bbb........',
  '....bbb.........',
  '...bbb..........',
  '..bbb..bbbbbbb..',
  '..bbb..bbbbbbb..',
  '................',
  '................',
];

/**
 * One tile in the picker. Cursor's IDE and its CLI (`cursor-agent`) are one tool to a
 * person choosing what they use, so they are one mark and one tile covering both values.
 */
export interface HarnessMark {
  id: 'claude_code' | 'codex' | 'cursor' | 'gemini_cli' | 'cline' | 'opencode' | 'aider';
  /** Brand casing: "opencode" is lower case, "Gemini CLI" is not. */
  name: string;
  harnesses: readonly Harness[];
  /** The symmetries the vendor's own mark has; the drawing keeps every one of them. */
  symmetry: readonly Symmetry[];
  frame: Frame;
}

/** The seven marks in picker order. */
export const HARNESS_MARKS: readonly HarnessMark[] = [
  { id: 'claude_code', name: 'Claude Code', harnesses: ['claude_code'], symmetry: ['mirror', 'flip', 'rotate'], frame: CLAUDE_CODE },
  { id: 'codex', name: 'Codex', harnesses: ['codex'], symmetry: ['flip'], frame: CODEX },
  { id: 'cursor', name: 'Cursor', harnesses: ['cursor_ide', 'cursor_agent'], symmetry: [], frame: CURSOR },
  { id: 'gemini_cli', name: 'Gemini CLI', harnesses: ['gemini_cli'], symmetry: ['mirror', 'flip', 'rotate'], frame: GEMINI_CLI },
  { id: 'cline', name: 'Cline', harnesses: ['cline'], symmetry: ['mirror'], frame: CLINE },
  { id: 'opencode', name: 'opencode', harnesses: ['opencode'], symmetry: ['mirror'], frame: OPENCODE },
  { id: 'aider', name: 'Aider', harnesses: ['aider'], symmetry: [], frame: AIDER },
];

export type HarnessMarkId = HarnessMark['id'];

/** The glyph for each wire value. `cursor_ide` and `cursor_agent` share one frame. */
export const HARNESS_GLYPHS: Record<Harness, Frame> = {
  claude_code: CLAUDE_CODE,
  cursor_ide: CURSOR,
  cursor_agent: CURSOR,
  codex: CODEX,
  gemini_cli: GEMINI_CLI,
  cline: CLINE,
  opencode: OPENCODE,
  aider: AIDER,
};

/** The name to print beside a glyph, in the vendor's casing. */
export const HARNESS_NAMES: Record<Harness, string> = {
  claude_code: 'Claude Code',
  cursor_ide: 'Cursor',
  cursor_agent: 'Cursor',
  codex: 'Codex',
  gemini_cli: 'Gemini CLI',
  cline: 'Cline',
  opencode: 'opencode',
  aider: 'Aider',
};

export function isHarness(value: string): value is Harness {
  return (HARNESSES as readonly string[]).includes(value);
}

/**
 * The glyph for a wire value, or `undefined` for one this build does not know. A newer Mac
 * can upload a harness this phone has never heard of; the caller then shows the name alone
 * rather than a blank tile or somebody else's mark.
 */
export function harnessGlyph(value: string): Frame | undefined {
  return isHarness(value) ? HARNESS_GLYPHS[value] : undefined;
}

export function markFor(harness: Harness): HarnessMark {
  const mark = HARNESS_MARKS.find((m) => m.harnesses.includes(harness));
  if (!mark) throw new Error(`no mark for ${harness}`);
  return mark;
}

// ─── sizes and ink ───────────────────────────────────────────────────────────────────

/** The only sizes a glyph renders at: 1, 2, 3 or 4 points per cell. */
export const GLYPH_SIZES = [16, 32, 48, 64] as const;
export type GlyphSize = (typeof GLYPH_SIZES)[number];

export function isGlyphSize(n: number): n is GlyphSize {
  return (GLYPH_SIZES as readonly number[]).includes(n);
}

/**
 * The largest allowed size that fits in `n` points (never below 16). For a caller outside
 * TypeScript's reach: a 20 or 24 pt glyph would put cell edges between device pixels and
 * blur the grid, so it draws at 16 instead of drawing wrong.
 */
export function snapGlyphSize(n: number): GlyphSize {
  let out: GlyphSize = GLYPH_SIZES[0];
  for (const s of GLYPH_SIZES) if (s <= n) out = s;
  return out;
}

/**
 * The state a mark is drawn in, and so its one colour:
 *   idle      `text`       (on `raised` in the picker, on `bg` or `card` elsewhere)
 *   dim       `textDim`    (the 16 pt glyph beside a name in a row or on a card)
 *   missing   `textFaint`  (the tool was not found on this Mac; still tappable)
 *   selected  `onAccent`   (on the amber tile)
 */
export type GlyphInk = 'idle' | 'dim' | 'missing' | 'selected';

export function glyphColor(
  ink: GlyphInk,
  c: { text: string; textDim: string; textFaint: string; onAccent: string },
): string {
  switch (ink) {
    case 'idle':
      return c.text;
    case 'dim':
      return c.textDim;
    case 'missing':
      return c.textFaint;
    case 'selected':
      return c.onAccent;
  }
}

// ─── the picker's rules ──────────────────────────────────────────────────────────────

/** DESIGN-DIRECTION 5: three columns, a 16 pt gutter each side, 12 pt between tiles. */
export const PICKER = {
  columns: 3,
  gutter: 16,
  gap: 12,
  tileHeight: 88,
  radius: 18,
  glyph: 32 as GlyphSize,
  glyphTop: 12,
  /** The cross-fade between a tile's two states. */
  fadeMs: 120,
} as const;

/** Tile width inside a container `inner` points wide (the gutters already outside it). */
export function tileWidthInside(inner: number): number {
  const { columns, gap } = PICKER;
  return Math.max(0, (inner - (columns - 1) * gap) / columns);
}

/** DESIGN-DIRECTION 5's formula, for a screen `width` points wide: (width - 32 - 2 x 12) / 3. */
export function pickerTileWidth(width: number): number {
  return tileWidthInside(width - 2 * PICKER.gutter);
}

/**
 * Selecting a mark selects every wire value it covers; deselecting removes them all. The
 * order of the result follows `HARNESSES`, so two equal selections compare equal.
 */
export function toggleMark(selected: readonly Harness[], mark: HarnessMark): Harness[] {
  const set = new Set(selected);
  const on = mark.harnesses.every((h) => set.has(h));
  for (const h of mark.harnesses) {
    if (on) set.delete(h);
    else set.add(h);
  }
  return HARNESSES.filter((h) => set.has(h));
}

/** A mark is selected when every value it covers is. */
export function isMarkSelected(selected: readonly Harness[], mark: HarnessMark): boolean {
  return mark.harnesses.every((h) => selected.includes(h));
}

/**
 * Sessions found for a mark, summed over the values it covers. `undefined` when the caller
 * has no count for any of them (no Mac paired yet), which is different from zero.
 */
export function sessionsFor(
  mark: HarnessMark,
  found: Partial<Record<Harness, number>> | undefined,
): number | undefined {
  if (!found) return undefined;
  let any = false;
  let n = 0;
  for (const h of mark.harnesses) {
    const v = found[h];
    if (typeof v === 'number') {
      any = true;
      n += v;
    }
  }
  return any ? n : undefined;
}

/** The status line under a tile's name. Nothing at all when there is no count to state. */
export function statusLine(sessions: number | undefined): string | null {
  if (sessions === undefined) return null;
  if (sessions <= 0) return 'not found';
  return sessions === 1 ? 'found 1 session' : `found ${grouped(sessions)} sessions`;
}

/** 1234 -> "1,234". Not `toLocaleString`: the status line reads the same on every device. */
function grouped(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
