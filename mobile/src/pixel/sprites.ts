/**
 * Bit — the pixel mascot.
 *
 * A small robot on a 16x16 grid, drawn in the same one ink and to the same rules as the
 * creature pack (`animals.ts`): a square body ten cells wide with its top corners cut, a T
 * antenna, two legs, and the family's eyes, two 2x2 holes at columns 5-6 and 9-10 on rows 6
 * and 7. It used to have six colour roles (a teal antenna bulb, black eyes with a white glint,
 * a dark amber mouth, cheeks and feet), and after that a bolt on each side at row 7. Slot eyes,
 * side bolts and two legs on a square amber body is Clawd, Claude Code's own mascot, so the
 * bolts are gone and the eyes are round-ish holes: what is left is a robot, and reads at 16 pt.
 *
 * Frames are strings so there are no binary assets: they diff, they review, and they
 * scale to any size as SVG rects. Glyph meanings are in `frames.ts`; the one ink comes from
 * `palette.ts`. The tests assert every frame is 16x16, uses only known glyphs, and keeps its
 * body pixel count within 4 of its siblings (eyes counted shut).
 *
 * Layout of the resting pose (row:col, zero-based):
 *   antenna    rows 2-3, cols 6-9 (bar) and 7-8 (stem)
 *   body       rows 4-11, cols 3-12, row 4 cols 4-11      eyes   rows 6-7, cols 5-6 and 9-10 (holes)
 *   legs       rows 12-13, cols 4-5 and 10-11
 *
 * The props (the hammer, sparks, z's, thought dots and confetti) are one-ink overlays with
 * roles of their own (`h`, `w`, `z`) so `motion.ts` can move them; none of them is ever in
 * the idle pose, which is the one the picker and the icons show. An arm is drawn only when a
 * state needs one, out of the body's side.
 */

import type { Frame } from './frames';

export type { Frame } from './frames';

export const SPRITE_STATES = [
  'idle',
  'blink',
  'building',
  'sleeping',
  'celebrating',
  'thinking',
  'waving',
] as const;

export type SpriteState = (typeof SPRITE_STATES)[number];

// ─── idle ────────────────────────────────────────────────────────────────────────────
// The family's idle: rest, a breath drawn in four cells, rest, and one gesture. Bit's
// gesture is the antenna tipping a cell to the right. The loop's timing is `MOTION.idle`.

/** The resting pose. The picker, the icons and every still frame of Bit are this. */
const IDLE_0: Frame = [
  '................',
  '................',
  '......bbbb......',
  '.......bb.......',
  '....bbbbbbbb....',
  '...bbbbbbbbbb...',
  '...bb..bb..bb...',
  '...bb..bb..bb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '....bb....bb....',
  '....bb....bb....',
  '................',
  '................',
];

/** The breath: the body widens a cell each side at rows 9 and 10. */
const IDLE_1: Frame = [
  '................',
  '................',
  '......bbbb......',
  '.......bb.......',
  '....bbbbbbbb....',
  '...bbbbbbbbbb...',
  '...bb..bb..bb...',
  '...bb..bb..bb...',
  '...bbbbbbbbbb...',
  '..bbbbbbbbbbbb..',
  '..bbbbbbbbbbbb..',
  '...bbbbbbbbbb...',
  '....bb....bb....',
  '....bb....bb....',
  '................',
  '................',
];

/** The gesture: the antenna tips one cell to the right. */
const IDLE_2: Frame = [
  '................',
  '................',
  '.......bbbb.....',
  '........bb......',
  '....bbbbbbbb....',
  '...bbbbbbbbbb...',
  '...bb..bb..bb...',
  '...bb..bb..bb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '....bb....bb....',
  '....bb....bb....',
  '................',
  '................',
];

// ─── blink ───────────────────────────────────────────────────────────────────────────
// A blink fills the two eye holes. The running mascot derives it (`closeEyes`); this is the
// same frame drawn out, for the static state.

const EYES_CLOSED: Frame = [
  '................',
  '................',
  '......bbbb......',
  '.......bb.......',
  '....bbbbbbbb....',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '....bb....bb....',
  '....bb....bb....',
  '................',
  '................',
];

// ─── building ────────────────────────────────────────────────────────────────────────
// The right arm swings a hammer (`h`, the same ink): raised, level, struck with sparks
// (`w`), and resting on the strike with one spark left.

/** Hammer raised overhead, the arm up the right side from the body. */
const BUILD_0: Frame = [
  '.............hhh',
  '.............hhh',
  '......bbbb....h.',
  '.......bb.....h.',
  '....bbbbbbbb..b.',
  '...bbbbbbbbbb.b.',
  '...bb..bb..bb.b.',
  '...bb..bb..bb.b.',
  '...bbbbbbbbbbbb.',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '....bb....bb....',
  '....bb....bb....',
  '................',
  '................',
];

/** Mid-swing, the hammer beside the head. */
const BUILD_1: Frame = [
  '................',
  '................',
  '......bbbb......',
  '.......bb.....hh',
  '....bbbbbbbb..hh',
  '...bbbbbbbbbb.h.',
  '...bb..bb..bbbb.',
  '...bb..bb..bbbb.',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '....bb....bb....',
  '....bb....bb....',
  '................',
  '................',
];

/** Strike: hammer down by the right leg, two sparks. */
const BUILD_2: Frame = [
  '................',
  '................',
  '......bbbb......',
  '.......bb.......',
  '....bbbbbbbb....',
  '...bbbbbbbbbb...',
  '...bb..bb..bb...',
  '...bb..bb..bb...',
  '...bbbbbbbbbbbb.',
  '...bbbbbbbbbb.hw',
  '...bbbbbbbbbb.h.',
  '...bbbbbbbbbbhhh',
  '....bb....bb.hhh',
  '....bb....bb...w',
  '................',
  '................',
];

/** Rest on the strike, one spark drifting off. */
const BUILD_3: Frame = [
  '................',
  '................',
  '......bbbb......',
  '.......bb.......',
  '....bbbbbbbb....',
  '...bbbbbbbbbb...',
  '...bb..bb..bb..w',
  '...bb..bb..bb...',
  '...bbbbbbbbbbbb.',
  '...bbbbbbbbbb.h.',
  '...bbbbbbbbbb.h.',
  '...bbbbbbbbbbhhh',
  '....bb....bb.hhh',
  '....bb....bb....',
  '................',
  '................',
];

// ─── sleeping ────────────────────────────────────────────────────────────────────────
// Eyes shut to slits (the lower row of each eye, row 7), the antenna folded flat onto the
// head, and a trail of z's rising to the top right that accumulates across the three frames.

const SLEEP_0: Frame = [
  '................',
  '................',
  '................',
  '......bbbb......',
  '....bbbbbbbb....',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '...bb..bb..bb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb.z.',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '....bb....bb....',
  '....bb....bb....',
  '................',
  '................',
];

const SLEEP_1: Frame = [
  '................',
  '................',
  '................',
  '......bbbb......',
  '....bbbbbbbb....',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb.z.',
  '...bb..bb..bb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb.z.',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '....bb....bb....',
  '....bb....bb....',
  '................',
  '................',
];

const SLEEP_2: Frame = [
  '.............zzz',
  '..............z.',
  '.............zzz',
  '......bbbb......',
  '....bbbbbbbb....',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb.z.',
  '...bb..bb..bb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb.z.',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '....bb....bb....',
  '....bb....bb....',
  '................',
  '................',
];

// ─── celebrating ─────────────────────────────────────────────────────────────────────
// Both arms up out of the body's sides, pumping a cell higher on the middle frame; confetti
// (`h`, `w`, `z`, all the one ink) lifted out by `motion.ts` to fall on its own. No hop: the
// body never moves.

const CHEER_0: Frame = [
  '..w..........h..',
  'h..............w',
  '....z.bbbb..z...',
  'w......bb......h',
  '.b..bbbbbbbb..b.',
  '.b.bbbbbbbbbb.b.',
  '.b.bb..bb..bb.b.',
  '.bbbb..bb..bbbb.',
  '...bbbbbbbbbb...',
  '.h.bbbbbbbbbbz..',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '....bb....bb....',
  '....bb....bb....',
  '................',
  '................',
];

const CHEER_1: Frame = [
  '..w..........h..',
  'h..............w',
  '....z.bbbb..z...',
  'wb.....bb.....bh',
  '.b..bbbbbbbb..b.',
  '.b.bbbbbbbbbb.b.',
  '.bbbb..bb..bbbb.',
  '...bb..bb..bb...',
  '...bbbbbbbbbb...',
  '.h.bbbbbbbbbbz..',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '....bb....bb....',
  '....bb....bb....',
  '................',
  '................',
];

const CHEER_2: Frame = [
  '..w..........h..',
  'h..............w',
  '....z.bbbb..z...',
  'w......bb......h',
  '.b..bbbbbbbb..b.',
  '.b.bbbbbbbbbb.b.',
  '.b.bb..bb..bb.b.',
  '.bbbb..bb..bbbb.',
  '...bbbbbbbbbb...',
  '.h.bbbbbbbbbbz..',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '....bb....bb....',
  '....bb....bb....',
  '................',
  '................',
];

// ─── thinking ────────────────────────────────────────────────────────────────────────
// Three thought dots on row 1 light in turn (`w` lit, `z` waiting), over a two-dot trail.

const THINK_0: Frame = [
  '................',
  '...........w.z.z',
  '......bbbb......',
  '.......bb.....z.',
  '....bbbbbbbb....',
  '...bbbbbbbbbb.z.',
  '...bb..bb..bb...',
  '...bb..bb..bb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '....bb....bb....',
  '....bb....bb....',
  '................',
  '................',
];

const THINK_1: Frame = [
  '................',
  '...........z.w.z',
  '......bbbb......',
  '.......bb.....z.',
  '....bbbbbbbb....',
  '...bbbbbbbbbb.z.',
  '...bb..bb..bb...',
  '...bb..bb..bb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '....bb....bb....',
  '....bb....bb....',
  '................',
  '................',
];

const THINK_2: Frame = [
  '................',
  '...........z.z.w',
  '......bbbb......',
  '.......bb.....z.',
  '....bbbbbbbb....',
  '...bbbbbbbbbb.z.',
  '...bb..bb..bb...',
  '...bb..bb..bb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '....bb....bb....',
  '....bb....bb....',
  '................',
  '................',
];

// ─── waving ──────────────────────────────────────────────────────────────────────────
// The right arm up the side, the hand flung a cell out and back.

const WAVE_0: Frame = [
  '................',
  '................',
  '......bbbb....b.',
  '.......bb.....b.',
  '....bbbbbbbb..b.',
  '...bbbbbbbbbb.b.',
  '...bb..bb..bbbb.',
  '...bb..bb..bb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '....bb....bb....',
  '....bb....bb....',
  '................',
  '................',
];

const WAVE_1: Frame = [
  '................',
  '................',
  '......bbbb.....b',
  '.......bb......b',
  '....bbbbbbbb..b.',
  '...bbbbbbbbbb.b.',
  '...bb..bb..bbbb.',
  '...bb..bb..bb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '....bb....bb....',
  '....bb....bb....',
  '................',
  '................',
];

// ─── table ───────────────────────────────────────────────────────────────────────────

/**
 * Every state's drawn frames. Idle is the family loop `[REST, BREATH, REST, GESTURE]`, and
 * its two rests are one frame object, so the renderer sees the repeat as no change.
 */
export const SPRITES: Record<SpriteState, Frame[]> = {
  idle: [IDLE_0, IDLE_1, IDLE_0, IDLE_2],
  blink: [IDLE_0, IDLE_1, EYES_CLOSED],
  building: [BUILD_0, BUILD_1, BUILD_2, BUILD_3],
  sleeping: [SLEEP_0, SLEEP_1, SLEEP_2],
  celebrating: [CHEER_0, CHEER_1, CHEER_2],
  thinking: [THINK_0, THINK_1, THINK_2],
  waving: [WAVE_0, WAVE_1],
};

export function framesFor(state: SpriteState): Frame[] {
  return SPRITES[state];
}
