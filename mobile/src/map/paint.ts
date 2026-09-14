/**
 * How the codebase map is painted, as plain arithmetic: which hue each kind of file wears, the
 * order the map draws itself on in, the flip a cell makes when it lights, the knot's rings, the
 * trail the agent leaves, and the ripple at the end. Every function the canvas calls per frame is
 * a worklet (it runs on the UI thread inside a derived value) and every one is a plain function
 * to `bun test` (`__tests__/mapPaint.test.ts`).
 *
 * Where each rule came from, named, so the next person can go and read the original:
 *
 *   the draw on       Appllama loader-buttons "Sandpile Bloom" (22-sandpile-bloom.js, GPL 3.0; the
 *                     IDEA only, no code: an avalanche's arrival waves spread from one seed across
 *                     a lattice, and a cell arrives in four discrete sizes, 0.2 0.36 0.53 0.7 of
 *                     the pitch, with a bright "release beat" before it settles). Here the seed is
 *                     the top of the repository, the lattice is each island's cells, and a sandpile
 *                     of all threes topples every cell exactly one wave after its neighbour, so the
 *                     arrival wave is the breadth first distance, computed as that.
 *   the flip          Appllama loader-buttons "Braille Flipwave" (25-braille-flipwave.js, GPL 3.0,
 *                     idea only): a dot turns over in 0.31 s on an ease in out cubic, dipping 5.5%
 *                     at its edge, its lit face showing after the half turn, neighbours a few
 *                     hundredths of a second apart. A cell flips when a refresh changes its heat
 *                     and when the time lapse first touches it.
 *   the rings         react-bits `Animations/MagicRings` (David Haz, MIT + Commons Clause): rings
 *                     grow from a centre over a 3.45 s cycle, starting 2.95 s apart, fading in over
 *                     0.7 s and out from 0.5 s to 0.2 s before the cycle ends. The knot's rings
 *                     are squares (the map is a pixel grid) and fade by THINNING, never by opacity:
 *                     a hue at partial opacity over the warm ground reads brown (DESIGN-V2 1.3).
 *   the trail         react-bits `Backgrounds/ShapeGrid` `hoverTrailAmount`: the i-th cell back of
 *                     n holds (n - i) / (n + 1) of the head's weight; and `Animations/PixelTrail`
 *                     `maxAge`: a lit pixel fades linearly to nothing over its age.
 *   the path          Strava's route polyline (design-md/fitness/strava DESIGN.md: the map carries
 *                     the page, the route drawn over it with a halo beneath, round caps and joins):
 *                     the last files the agent touched, joined in the order it touched them, so
 *                     wandering draws long strides across the islands and circling a tight loop.
 *   the ripple        react-bits `Backgrounds/PixelBlast` ripples: a ring `exp(-((r - speed t) /
 *                     thickness)^2)` damped by `exp(-t) exp(-10 r)`, thresholded through the 8x8
 *                     Bayer matrix so a pixel is on or off. It runs once, from the burst, when a
 *                     replay lands.
 *
 * react-bits is MIT + Commons Clause (Copyright (c) 2026 David Haz); the notice is in
 * `src/ui/digits.ts` and every port under `src/ui/bits/`; used as part of this application, not
 * redistributed. The Appllama loaders are GPL 3.0 and nothing of theirs is copied here: the
 * numbers above are observations of what they draw, and the code is this file's own.
 *
 * Pure: no React Native.
 */

import type { LiveFile, PlainRole } from '../generated/live';
import { DATA, GROUND, SPECTRUM, type Hue, type HueName } from '../insights/palette';
import { LEVEL_EDIT_WARM, LEVEL_HOT, LEVEL_READ_WARM, touchedAt, type Replay } from './heat';
import type { CellRects, MapLayout } from './layout';

// ------------------------------------------------------------------ what each file wears

/**
 * Each kind of file wears one spectrum hue, so the islands read as what the code is made of:
 * the four roles most repositories are mostly made of (source, test, config, docs) take four
 * hues from different families; the rest fill in. `unknown` wears no hue: a warm grey, because a
 * file the engine could not place is not a kind. Green and red are data (added, removed, a
 * failing call) and are never a role. UNMEASURED JUDGEMENT CALL, judged on the sample.
 */
export const ROLE_HUE: Readonly<Record<PlainRole, HueName | null>> = {
  source: 'cobalt',
  test: 'brass',
  config: 'orchid',
  docs: 'heather',
  migration: 'ember',
  style: 'tide',
  build: 'iris',
  dependency: 'amber',
  unknown: null,
};

export interface RoleInk {
  /** A warm or hot cell, a label, the role's word in the legend. */
  ink: string;
  /** A cell it has moved on from: the same hue at its partner lightness. */
  partner: string;
}

/** The ink and partner a role's cells are drawn in. */
export function roleInk(role: PlainRole): RoleInk {
  const name = ROLE_HUE[role];
  if (!name) return { ink: GROUND.dim, partner: GROUND.faint };
  const h: Hue = SPECTRUM[name];
  return { ink: h.ink, partner: h.partner };
}

/** The colour a failing call paints a cell: the one red, `data.del`. */
export const FAIL_INK = DATA.del;
/** A cell not touched yet in the replay: the outline of a slot. */
export const SLOT_INK = GROUND.border;

// ------------------------------------------------------------------ one hue, one meaning

/*
 * Every spectrum hue but coral is a kind of file here (`ROLE_HUE`), and the page's band and its
 * controls wear the builder's own hue. So the marks that are not a kind of file take what is left.
 * FOUND IN THE CAPTURE (2026-09-14, 73-map and 74-timelapse): the path, the stuck files, their
 * rings and the scrubber's bars were all drawn in the builder's hue, the purple of the band, of
 * the play key and of every build file, so one purple meant five things.
 *
 *   the line the agent leaves  the ground's white (`PATH_INK`), the colour of the outline round the
 *                              file it is on, which is where the line ends.
 *   the stuck files            `stuckHue`: coral, the one hue no kind of file wears, unless the
 *                              builder wears it; then the first hue no kind on this map wears.
 *   the scrubber               neutrals: changes in the dim grey, reads in the faint, failures in
 *                              the red, the stuck stretch bracketed in the stuck files' hue.
 */

/** The live path and the replay's trail: the ground's white. */
export const PATH_INK = GROUND.text;

/** The order the stuck files look for a hue in: coral first, then the warm hues, the kinds of file last. */
export const STUCK_ORDER: readonly HueName[] = ['coral', 'orchid', 'ember', 'amber', 'heather', 'tide', 'brass', 'iris', 'cobalt'];

/**
 * The stuck files' hue on a map whose kinds of file are `roles`, on a page whose band wears
 * `accent`: the first of `STUCK_ORDER` that neither wears. With every hue taken (nine kinds and a
 * builder), the first that no kind wears, then coral.
 */
export function stuckHue(accent: HueName, roles: readonly PlainRole[]): HueName {
  const kinds = new Set(roles.map((r) => ROLE_HUE[r]).filter((h): h is HueName => h !== null));
  return STUCK_ORDER.find((h) => h !== accent && !kinds.has(h)) ?? STUCK_ORDER.find((h) => !kinds.has(h)) ?? 'coral';
}

/** A hue as a person names it, for the legend ("Pulsing in pink"). */
export const HUE_WORD: Readonly<Record<HueName, string>> = {
  amber: 'gold',
  brass: 'yellow',
  tide: 'cyan',
  cobalt: 'blue',
  iris: 'purple',
  heather: 'lilac',
  orchid: 'magenta',
  coral: 'pink',
  ember: 'orange',
};

/** The scrubber's bars: what changed in the dim grey, what was only read in the faint one. */
export const SCRUB_INK = { change: GROUND.dim, read: GROUND.faint } as const;

// ------------------------------------------------------------------ the draw on

/** The draw on's longest spread from the first cell to the last, ms. */
export const BLOOM_SPAN_MS = 1100;
/** One wave of the draw on at most, ms: a small map blooms at this pace rather than all at once. */
export const BLOOM_STEP_MS = 70;
/** One cell's arrival: four size steps and the release beat, ms. */
export const CELL_MS = 260;
/**
 * How much of a wave a cell may land late by, as a share of a wave: the flipwave's "deliberately
 * irregular" timing, so the front is organic rather than a ruled diamond. UNMEASURED.
 */
export const BLOOM_JITTER = 0.45;

/** A stable 0..1 per integer, the same on every render and every device. */
export function unitHash(i: number): number {
  let h = Math.imul((i + 1) ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/**
 * The wave each cell arrives on, from the top of the repository outward.
 *
 * The seed is the first cell of the first island (`layoutMap` puts the top of the checkout first
 * and packs it at the centre). Inside an island the front moves one cell per wave to the four
 * neighbours (the sandpile's topple); across open water it moves one cell's width per wave, so an
 * island starts blooming, from its cell nearest the seed, when the front reaches it. Plus a
 * stable jitter under one wave. Deterministic: the same layout blooms the same way every time.
 */
export function bloomWaves(layout: MapLayout): number[] {
  const n = layout.cells.length;
  const out = new Array<number>(n).fill(0);
  if (n === 0 || layout.folders.length === 0) return out;
  const seed = layout.folders[0]!.cells[0]!;
  const sx = layout.cells[seed]!.x;
  const sy = layout.cells[seed]!.y;
  for (const f of layout.folders) {
    const at = new Map<string, number>();
    const off = new Map<number, [number, number]>();
    for (const ci of f.cells) {
      const c = layout.cells[ci]!;
      const dx = Math.round(c.x - f.ox);
      const dy = Math.round(c.y - f.oy);
      at.set(`${dx},${dy}`, ci);
      off.set(ci, [dx, dy]);
    }
    // The island's first cell to bloom: the one nearest the seed, ties to the lower index.
    let entry = f.cells[0]!;
    let best = Number.POSITIVE_INFINITY;
    for (const ci of f.cells) {
      const c = layout.cells[ci]!;
      const d = (c.x - sx) * (c.x - sx) + (c.y - sy) * (c.y - sy);
      if (d < best) {
        best = d;
        entry = ci;
      }
    }
    const start = Math.sqrt(best);
    const hops = new Map<number, number>([[entry, 0]]);
    const queue = [entry];
    for (let q = 0; q < queue.length; q++) {
      const ci = queue[q]!;
      const [dx, dy] = off.get(ci)!;
      for (const [ex, ey] of [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ] as const) {
        const next = at.get(`${dx + ex},${dy + ey}`);
        if (next === undefined || hops.has(next)) continue;
        hops.set(next, hops.get(ci)! + 1);
        queue.push(next);
      }
    }
    for (const ci of f.cells) {
      // Every spiral island is four-connected (each cell has a neighbour nearer its centre), so
      // this fallback is never taken; it keeps a malformed island drawable.
      const [dx, dy] = off.get(ci)!;
      const [ex, ey] = off.get(entry)!;
      const h = hops.get(ci) ?? Math.abs(dx - ex) + Math.abs(dy - ey);
      out[ci] = start + h + (ci === seed ? 0 : unitHash(ci) * BLOOM_JITTER);
    }
  }
  return out;
}

/** Each cell's start on the block's clock, ms: its wave at a pace that fits `span`, from `at`. */
export function bloomDelays(waves: readonly number[], at: number, span: number = BLOOM_SPAN_MS, step: number = BLOOM_STEP_MS): number[] {
  let most = 0;
  for (const w of waves) most = Math.max(most, w);
  const pace = most > 0 ? Math.min(step, span / most) : 0;
  return waves.map((w) => at + w * pace);
}

/** When the last cell has landed, on the same clock. */
export function bloomEnd(delays: readonly number[]): number {
  let last = 0;
  for (const d of delays) last = Math.max(last, d);
  return last + CELL_MS;
}

/**
 * A cell's size as it arrives (0 to 1 of its arrival): the sandpile's four discrete sizes, 0.2,
 * 0.36, 0.53 and 0.7 of the pitch, taken as shares of the largest, so a cell grows by steps
 * the way a pixel would and never by a smooth scale.
 */
export function bloomSize(a: number): number {
  'worklet';
  if (a <= 0) return 0;
  if (a >= 1) return 1;
  const k = Math.floor(a * 4);
  return k <= 0 ? 0.2 / 0.7 : k === 1 ? 0.36 / 0.7 : k === 2 ? 0.53 / 0.7 : 1;
}

/** The release beat: an arriving cell is drawn bright for the first half of its arrival. */
export function bloomFlash(a: number): boolean {
  'worklet';
  return a > 0 && a < 0.5;
}

// ------------------------------------------------------------------ the flip

/** One flip, ms: the flipwave's 0.31 s. */
export const FLIP_MS = 310;
/** How far a refresh's flips spread across the map, left to right, ms. */
export const FLIP_WAVE_MS = 180;

export function easeInOutCubic(x: number): number {
  'worklet';
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/**
 * A cell turning over at progress `p` (0 to 1): its height as a share of its side (it narrows to
 * an edge at the half turn and opens again), which face shows (0 the old, 1 the new), and the
 * 5.5% dip the flipwave's dots take at their edge.
 */
export function flipAt(p: number): [number, number, number] {
  'worklet';
  const q = p <= 0 ? 0 : p >= 1 ? 1 : p;
  const f = easeInOutCubic(q);
  const tall = Math.abs(Math.cos(Math.PI * f));
  return [tall, f >= 0.5 ? 1 : 0, 1 - Math.sin(Math.PI * q) * 0.055];
}

// ------------------------------------------------------------------ the knot's rings

/** MagicRings' cycle, s. */
export const RING_CYCLE_S = 3.45;
/** Three rings, MagicRings' offsets: 0, 2.95 s and 5.9 s into the cycle. */
export const RING_OFFSETS_S: readonly number[] = [0, 2.95 % RING_CYCLE_S, 5.9 % RING_CYCLE_S];
/** How far a ring travels past the knot over its cycle, in pitches. UNMEASURED. */
export const RING_REACH = 2.4;
/** A ring's stroke at its fullest, points. */
export const RING_STROKE = 2;

function smoothstep(e0: number, e1: number, x: number): number {
  'worklet';
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** MagicRings' `fade(t)` with its defaults, `fadeIn` 0.7 s and `fadeOut` 0.5 s, `t` in seconds of the cycle. */
export function ringFade(t: number): number {
  'worklet';
  return t < 0.7 ? smoothstep(0, 0.7, t) : 1 - smoothstep(0.5, RING_CYCLE_S - 0.2, t);
}

/** Ring `i` at `seconds` of the pulse: how far it has grown (0 to 1) and its weight (0 to 1). */
export function ringAt(seconds: number, i: number): [number, number] {
  'worklet';
  const o = i === 0 ? 0 : i === 1 ? 2.95 % RING_CYCLE_S : 5.9 % RING_CYCLE_S;
  const raw = (seconds + o) % RING_CYCLE_S;
  const t = raw < 0 ? raw + RING_CYCLE_S : raw;
  return [t / RING_CYCLE_S, ringFade(t)];
}

/**
 * How far in from the canvas's edges the knot's rings stop, points: the page's 20pt gutter, so
 * the bracket's widest reach lines up with the words above and below the map.
 */
export const RING_INSET = 20;
/** A ring never comes nearer the knot's own cells than this, points, even where the inset is tight. */
const RING_CLEAR = 2;

/**
 * The knot's ring at growth `g` (0 to 1 of its cycle), as `[x, y, w, h]`: the box round the
 * knot's cells (`l t r b`) padded by `pad`, grown outward on each side by `g` of up to `reach`,
 * and never past `inset` from the canvas's edge. Each side grows by its own share of the room it
 * has, so a knot near an edge keeps its whole bracket on the map and its rings still breathe on
 * the other sides; a side with no room at all stays on the knot (never on its cells).
 *
 * FOUND IN THE FINAL CAPTURE (2026-09-13, the circling time lapse): the rings were squares on the
 * knot's longer side, centred on it, so a wide knot just under the band grew them past the top of
 * the canvas, where the band cut them off, and within 5 points of the screen's left edge.
 */
export function ringBox(
  l: number,
  t: number,
  r: number,
  b: number,
  pad: number,
  reach: number,
  g: number,
  width: number,
  height: number,
  inset: number = RING_INSET,
): [number, number, number, number] {
  'worklet';
  const grow = g <= 0 ? 0 : g >= 1 ? 1 : g;
  // At rest: round the cells by `pad`, pulled in to the inset where the pad would cross it.
  const L = Math.max(l - pad, Math.min(inset, l - RING_CLEAR));
  const T = Math.max(t - pad, Math.min(inset, t - RING_CLEAR));
  const R = Math.min(r + pad, Math.max(width - inset, r + RING_CLEAR));
  const B = Math.min(b + pad, Math.max(height - inset, b + RING_CLEAR));
  const x0 = L - Math.max(0, Math.min(reach, L - inset)) * grow;
  const y0 = T - Math.max(0, Math.min(reach, T - inset)) * grow;
  const x1 = R + Math.max(0, Math.min(reach, width - inset - R)) * grow;
  const y1 = B + Math.max(0, Math.min(reach, height - inset - B)) * grow;
  return [x0, y0, x1 - x0, y1 - y0];
}

// ------------------------------------------------------------------ heat, glow and the trail

/**
 * How brightly a cell glows at a level: the roadmap's "files glow as the agent reads them, go hot
 * as it edits them, fade as it moves on". Only the working set glows (the last WARM_FILES files):
 * a read among them softly, a change more, the file it is changing now most. Cooled files do not.
 */
export function glowOf(level: number): number {
  'worklet';
  return level === LEVEL_HOT ? 1 : level === LEVEL_EDIT_WARM ? 0.7 : level === LEVEL_READ_WARM ? 0.4 : 0;
}

/** Hot: changed, and one of the last three files it touched. What "3 hot" counts. */
export function isHot(level: number): boolean {
  'worklet';
  return level >= LEVEL_EDIT_WARM;
}

export function hotCount(levels: readonly number[]): number {
  let n = 0;
  for (const l of levels) if (isHot(l)) n += 1;
  return n;
}

/** ShapeGrid's trail: the `i`-th of `len` cells back from the head holds this share of it. */
export function trailStrength(i: number, len: number): number {
  'worklet';
  if (len <= 0 || i < 0 || i >= len) return 0;
  return (len - i) / (len + 1);
}

/** PixelTrail's age: a lit pixel `ageMs` old of `maxAgeMs` keeps this much of its light. */
export function trailFade(ageMs: number, maxAgeMs: number): number {
  'worklet';
  if (ageMs < 0 || maxAgeMs <= 0) return 0;
  const x = 1 - ageMs / maxAgeMs;
  return x <= 0 ? 0 : x >= 1 ? 1 : x;
}

/** The path joins this many files: two working sets, so a knot of three draws as a closed loop. */
export const PATH_FILES = 6;
/** How far back the replay looks for them, in frames. */
export const TRAIL_BACK = 240;
/** How long a touched cell stays lit in the replay, real ms (PixelTrail's `maxAge`). */
export const TRAIL_MS = 900;

/**
 * The live map's path: the last `n` files it touched that are on the map, oldest first, as cell
 * indices. A file only named by a failing call (no read, no change) was not visited and is left
 * out. Fewer than two is no path.
 */
export function recentPath(files: readonly LiveFile[], index: Readonly<Record<string, number>>, n: number = PATH_FILES): number[] {
  const rows = files
    .map((f) => ({ id: f.id, at: touchedAt(f) }))
    .filter((r): r is { id: string; at: number } => r.at !== null && index[r.id] !== undefined)
    .sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, n)
    .reverse();
  return rows.length >= 2 ? rows.map((r) => index[r.id]!) : [];
}

/**
 * The replay's trail as of frame `k`: up to `n` distinct cells, newest first, looking back at most
 * `back` frames, as `[cell, frame, cell, frame, ...]` (a flat array: a worklet copies nothing
 * nested). Frames on files the map left out are skipped.
 */
export function trailAt(r: Replay, k: number, n: number, back: number): number[] {
  'worklet';
  const out: number[] = [];
  if (k < 0) return out;
  const lo = Math.max(0, k - back);
  for (let j = k; j >= lo && out.length < n * 2; j--) {
    const c = r.cell[j]!;
    if (c < 0) continue;
    let seen = false;
    for (let q = 0; q < out.length; q += 2) {
      if (out[q] === c) {
        seen = true;
        break;
      }
    }
    if (!seen) {
      out.push(c);
      out.push(j);
    }
  }
  return out;
}

// ------------------------------------------------------------------ the ripple at the end

/**
 * PixelBlast's ripple, tuned for a map rather than a background: react-bits runs `speed 0.3`,
 * `thickness 0.1`, damped by `exp(-t)` and `exp(-10 r)`, so a ripple dies within a third of the
 * field; here it has to cross the map once, so it travels three times as fast and damps a quarter
 * as hard with distance. `r` in heights of the canvas, `t` in seconds.
 */
export const RIPPLE = { speed: 0.9, thickness: 0.09, dampT: 1.1, dampR: 2.4, lifeS: 1.4 } as const;

export function rippleAt(r: number, t: number): number {
  'worklet';
  if (t < 0) return 0;
  const w = RIPPLE.speed * t;
  const d = (r - w) / RIPPLE.thickness;
  return Math.exp(-d * d) * Math.exp(-RIPPLE.dampT * t) * Math.exp(-RIPPLE.dampR * r);
}

// bayer2 is defined BEFORE bayer8 on purpose: Reanimated turns every worklet function into a
// value that is not hoisted, and bayer8 captures bayer2 when it is created. In the other order the
// time lapse crashed with "bayer2 is not a function (it is undefined)" (2026-09-13 capture pass).
/** One level of the ordered matrix: `fract(floor(x) / 2 + floor(y)^2 * 3 / 4)`, as the band's shader. */
export function bayer2(x: number, y: number): number {
  'worklet';
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const v = fx * 0.5 + fy * fy * 0.75;
  return v - Math.floor(v);
}

/** The 8x8 ordered dither threshold at a lattice point, 0 to 1: the band's own arithmetic. */
export function bayer8(x: number, y: number): number {
  'worklet';
  return bayer2(x * 0.25, y * 0.25) * 0.0625 + bayer2(x * 0.5, y * 0.5) * 0.25 + bayer2(x, y);
}

/** Whether the ripple lights a cell: PixelBlast's `step(0.5, feed + bayer - 0.5)`. */
export function rippleLit(feed: number, threshold: number): boolean {
  'worklet';
  return feed > 0.001 && feed + threshold - 0.5 >= 0.5;
}

// ------------------------------------------------------------------ geometry

/** The box round some cells, points: `[left, top, right, bottom]`, or null with none. */
export function boxOf(cells: readonly number[], rects: CellRects): [number, number, number, number] | null {
  let l = Number.POSITIVE_INFINITY;
  let t = Number.POSITIVE_INFINITY;
  let r = Number.NEGATIVE_INFINITY;
  let b = Number.NEGATIVE_INFINITY;
  for (const i of cells) {
    const x = rects.x[i];
    const y = rects.y[i];
    if (x === undefined || y === undefined) continue;
    l = Math.min(l, x);
    t = Math.min(t, y);
    r = Math.max(r, x + rects.size);
    b = Math.max(b, y + rects.size);
  }
  return Number.isFinite(l) ? [l, t, r, b] : null;
}

/** The middle of the cells, points, or null with none. */
export function centreOf(cells: readonly number[], rects: CellRects): [number, number] | null {
  const box = boxOf(cells, rects);
  return box ? [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2] : null;
}

/** The path's stroke for a pitch: about a fifth of a cell, between 1.5 and 3 points. */
export function pathWidth(pitch: number): number {
  return Math.max(1.5, Math.min(3, Math.round(pitch * 0.22 * 2) / 2));
}

/** A label's knockout reaches this far past its box, points: across, then up and down. */
export const KNOCKOUT_PAD: readonly [number, number] = [3, 1];

/**
 * Where the map is cut back to the ground under its role labels, as a flat `[x, y, w, h, ...]`
 * (a worklet copies nothing nested): each label's box, a little wider, painted in the ground's
 * colour after the path, the knot's loop and its rings and before the glow and the cells. So a
 * line running under "configuration" stops short of the word on both sides, the way a road map
 * lets a town's name sit on the road, and no cell is ever covered: `placeLabels` keeps every
 * label clear of every cell, and the cells are drawn after the knockout in any case.
 *
 * FOUND IN THE FINAL CAPTURE (2026-09-13): the live path and the replay's trail were drawn in
 * the canvas and the labels as text over it with nothing between, so the line ran straight
 * through "configuration" and "source code".
 */
export function knockouts(labels: readonly { x: number; y: number; width: number; height: number }[]): number[] {
  const [px, py] = KNOCKOUT_PAD;
  const out: number[] = [];
  for (const l of labels) out.push(l.x - px, l.y - py, l.width + px * 2, l.height + py * 2);
  return out;
}
