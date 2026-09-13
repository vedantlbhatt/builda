/**
 * The tuning numbers of the effect ports, in one place, as plain numbers so `bun test` can
 * hold them against DESIGN-V2-COLOUR-MOTION.md section 3 (`SPARK`, `COMET`, `SWAP`, `TILT`)
 * and against the react-bits originals they were cut from.
 *
 * Every number below says where it came from. "react-bits" is the original's default, read
 * from `design-refs/react-bits/src/ts-default/Animations/<Name>/<Name>.tsx` (David Haz, MIT +
 * Commons Clause; the full notice is in each port and in `src/ui/digits.ts`). "v2" is the
 * design doc. Where the two differ, the phone number wins and the reason is on the line.
 *
 * One object, not eight constants, so a later `motionSpec.ts` that grows its own `SPARK` or
 * `SWAP` can never collide with these in a barrel.
 */
export const EFFECTS = {
  /**
   * ClickSpark. react-bits: 8 sparks, 10px long, 15px radius, 400ms, ease-out, 2px lines.
   * v2 SPARK: 8 sparks of the 3pt grain flying 24pt over 400ms on EASE. The ray keeps the
   * original's geometry (a segment that shrinks as it flies) at the grain's weight: 3pt wide
   * with square ends, starting 9pt long (three grain cells).
   */
  spark: { count: 8, sizePt: 3, lengthPt: 9, radiusPt: 24, ms: 400 },
  /**
   * A finger that travelled further than this between down and up was a drag or a scroll,
   * not a press: no spark. The platform's own touch slop, 10pt.
   */
  tapSlopPt: 10,
  /**
   * StarBorder. react-bits: `speed` 6s, two radial glows sliding along the top and bottom.
   * v2 COMET: the tile's own continuous edge, a comet 24% of the perimeter long, 6s a lap,
   * three laps, then a still outline 1.5pt wide. The tail thins in three flat steps of
   * density (cells on the edge switching off), never in opacity: a hue at partial opacity
   * over the warm ground is brown.
   */
  comet: { lapMs: 6000, laps: 3, length: 0.24, strokePt: 1.5, tail: [0.75, 0.5, 0.25] },
  /**
   * GlareHover. react-bits: -45deg, a soft band at 50% white, 650ms, `playOnce`. v2: a band
   * at -45 degrees in three flat steps (white at 6, 10, 6%), 24pt wide, crossing once on press
   * in over 380ms (TILT.glareMs). Flat steps, because a gradient sheen is banned.
   */
  glare: { ms: 380, angleDeg: -45, bandPt: 24, steps: [0.06, 0.1, 0.06] },
  /**
   * PixelSwap. react-bits: 64px pixels, 1400ms total, 450ms a pixel, windows from 0.35,
   * fade on, at most 220 pixels. v2 SWAP: 900ms and 240ms, a spiral. Cells grow to whole
   * dither cells (`snapPt`, tokens.dither.cell) so a cell edge never cuts a dither dot. The
   * cap is 256, not 220: the original's cap bounds its DOM clones, a shader has no cost per
   * cell, and 256 is one cell per pixel of a 16 by 16 creature (a creature at 192pt swaps
   * pixel for pixel). It still keeps the cells chunky on a wide art band.
   */
  swap: { totalMs: 900, cellMs: 240, cellPt: 12, startScale: 0.35, maxCells: 256, snapPt: 3 },
  /**
   * PixelTransition. react-bits: a 7 by 7 grid, 0.3s to cover and 0.3s to uncover, random
   * order. v2: grid 12 across. Squares, so a portrait card gets more rows than columns.
   */
  cover: { grid: 12, stepMs: 300 },
  /**
   * Magnet. react-bits: 100px of padding, strength 2 (offset = distance / 2), 0.3s ease-out
   * while pulled, 0.5s ease-in-out home. A phone has no hovering pointer, so the pull is
   * the finger that is already down, and it is gentle: never past `maxPt` (6pt, about a ninth
   * of the 52pt capsule), soft-clamped so it eases into the limit instead of hitting it.
   */
  magnet: { paddingPt: 24, strength: 2, maxPt: 6, followMs: 300 },
  /**
   * LogoLoop. react-bits: 120px/s, 32px gap, 28px logos, velocity eased with tau 0.25s, at
   * least two copies plus two of headroom. v2 AMBIENT: react-bits speeds times 0.3, so
   * 36pt/s. Glyphs at 32pt, the nearest whole-cell size to 28.
   */
  loop: { speed: 36, gapPt: 32, glyphPt: 32, smoothTau: 0.25, minCopies: 2, headroom: 2 },
  /**
   * AnimatedContent and FadeContent. react-bits: 100px, 0.8s power3.out, once on scroll in.
   * v2 (Rise): 8 to 12pt on EASE over 240 to 300ms, once, blur off. Content that wears a
   * hue has its opacity snap in over `hueFadeMs` (under 120ms) while it rises.
   */
  enter: { distancePt: 8, hueFadeMs: 100 },
} as const;

export type EffectsSpec = typeof EFFECTS;
