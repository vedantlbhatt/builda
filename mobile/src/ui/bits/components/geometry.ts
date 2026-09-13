/**
 * Where every card, slide and tile of the ported components sits, pure. No React Native
 * import, so `bun test` holds every pose, and every function the UI thread reads from a
 * gesture or an animated style is a worklet.
 *
 * Ported from react-bits `Components/Stack`, `Components/CardSwap`, `Components/BounceCards`,
 * `Components/Carousel`, `Components/TiltedCard` and `Components/MagicBento` by David Haz.
 * react-bits is MIT + Commons Clause (Copyright (c) 2026 David Haz): the notice is kept here
 * as the licence asks, and the ports are used as part of this application only; they are not
 * to be redistributed as components.
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
 * What changed in the port: the originals compute these inline against the DOM
 * (`getBoundingClientRect`, GSAP transform strings, motion values). Here each is a function of
 * numbers, so a pose can be tested and read on the UI thread. The numbers they start from are
 * in `spec.ts`, each beside the web original's.
 */
import { BENTO, BOUNCE, CARD_SWAP, CAROUSEL, PROFILE, STACK, TILT } from './spec';

function clamp(v: number, lo: number, hi: number): number {
  'worklet';
  return v < lo ? lo : v > hi ? hi : v;
}

// ─── Stack ──────────────────────────────────────────────────────────────────────────────

/**
 * A seeded turn in [-amplitude, amplitude] for card `id`: react-bits `randomRotation` draws a
 * new `Math.random()` on every render, so a screenshot never repeats and a card twitches each
 * time the stack re-renders. This is the same spread, fixed per card.
 */
export function seededTurn(id: number, amplitude: number = STACK.jitterDeg): number {
  'worklet';
  const x = Math.sin((id + 1) * 12.9898) * 43758.5453;
  const f = x - Math.floor(x);
  return (f * 2 - 1) * amplitude;
}

export interface PilePose {
  rotate: number;
  scale: number;
}

/**
 * A card `depth` below the top of the pile (0 is the top). react-bits: `rotateZ = (n - i - 1) * 4`
 * and `scale = 1 + 0.06 (i - n)` for index `i` of `n` from the bottom, which puts the TOP card at
 * 0.94. Here the top card is 1 and every card keeps the same step to its neighbour.
 */
export function pilePose(depth: number, jitter: number = 0): PilePose {
  'worklet';
  const d = depth < 0 ? 0 : depth;
  return { rotate: d * STACK.rotateStep + jitter, scale: 1 - d * STACK.scaleStep };
}

/**
 * The drag's 3D turn. react-bits maps a 100px drag to 60 degrees of rotateX and rotateY,
 * clamped; this is the same map at `maxDeg` (12), so a card leans toward the finger rather
 * than folding flat.
 */
export function dragTilt(dx: number, dy: number, maxDeg: number = STACK.tiltDeg): { rotateX: number; rotateY: number } {
  'worklet';
  return {
    rotateX: clamp((-dy / 100) * maxDeg, -maxDeg, maxDeg),
    rotateY: clamp((dx / 100) * maxDeg, -maxDeg, maxDeg),
  };
}

export interface StackRelease {
  dx: number;
  dy: number;
  vx: number;
  vy: number;
}

/**
 * Whether a released card goes to the back. react-bits: past `sensitivity` on either axis.
 * Added: a flick at the kit's 800pt/s, so a quick throw from a few points away still counts.
 */
export function sendsToBack(r: StackRelease, sensitivity: number = STACK.sensitivity, flick: number = STACK.flick): boolean {
  'worklet';
  if (Math.abs(r.dx) > sensitivity || Math.abs(r.dy) > sensitivity) return true;
  return Math.hypot(r.vx, r.vy) >= flick;
}

/**
 * react-bits' `sendToBack`: the order runs bottom to top, and the card moves to the front of
 * the array (the bottom of the pile). A card that is not in the order leaves it unchanged.
 */
export function sendToBack(order: readonly number[], id: number): number[] {
  const i = order.indexOf(id);
  if (i < 0) return [...order];
  const next = [...order];
  next.splice(i, 1);
  next.unshift(id);
  return next;
}

/** The inverse, for going back one card: the bottom card comes to the top. */
export function bringToTop(order: readonly number[]): number[] {
  if (order.length < 2) return [...order];
  const [bottom, ...rest] = order;
  return [...rest, bottom!];
}

/** The card on top (the last in the order), or -1 for an empty pile. */
export function topOf(order: readonly number[]): number {
  return order.length === 0 ? -1 : order[order.length - 1]!;
}

/** How far below the top card `id` sits: 0 is the top, -1 if it is not in the pile. */
export function depthIn(order: readonly number[], id: number): number {
  const i = order.indexOf(id);
  return i < 0 ? -1 : order.length - 1 - i;
}

/** The initial pile: card 0 on top, then 1, 2... (react-bits keeps its array order, last on top). */
export function initialOrder(count: number, top: number = 0): number[] {
  const n = Math.max(0, Math.floor(count));
  const t = n === 0 ? 0 : ((Math.floor(top) % n) + n) % n;
  const fromTop: number[] = [];
  for (let k = 0; k < n; k++) fromTop.push((t + k) % n);
  return fromTop.reverse();
}

// ─── CardSwap ───────────────────────────────────────────────────────────────────────────

export interface SwapSlot {
  x: number;
  y: number;
  scale: number;
  zIndex: number;
}

/**
 * Slot `i` of `total` (0 is the front). react-bits `makeSlot`: `x = i * distX`, `y = -i * distY`,
 * `z = -i * distX * 1.5`, seen through `perspective: 900px`. React Native has no translateZ, so
 * the depth is projected here: a point `z` behind the screen at perspective `P` draws at
 * `P / (P - z)` of its size, and its offset from the vanishing point (the container's centre)
 * shrinks by the same factor.
 */
export function swapSlot(
  i: number,
  total: number,
  distX: number = CARD_SWAP.cardDistance,
  distY: number = CARD_SWAP.verticalDistance,
  perspective: number = CARD_SWAP.perspective,
): SwapSlot {
  'worklet';
  const z = -i * distX * CARD_SWAP.depthFactor;
  const s = perspective / (perspective - z);
  return { x: i * distX * s, y: -i * distY * s, scale: s, zIndex: total - i };
}

/** react-bits: after a swap the front card goes to the back of the order. */
export function rotateOrder(order: readonly number[]): number[] {
  if (order.length < 2) return [...order];
  const [front, ...rest] = order;
  return [...rest, front!];
}

export interface SwapTimeline {
  /** The front card drops at 0. */
  dropMs: number;
  /** When the `i`th of the rest starts forward. */
  promoteMs: (i: number) => number;
  /** When the dropped card starts to the back slot, and the order flips. */
  returnMs: number;
}

/**
 * The swap's beats, from react-bits' GSAP timeline (linear config: drop 0.8s, promote at
 * 55% of the drop, the rest 0.15s apart, the return just after): here on `SHEET` springs,
 * which settle in about 300ms, so the beats are the spring's, not GSAP's 0.8s tweens.
 */
export function swapTimeline(): SwapTimeline {
  return {
    dropMs: 0,
    promoteMs: (i: number) => CARD_SWAP.promoteMs + Math.max(0, i) * CARD_SWAP.staggerMs,
    returnMs: CARD_SWAP.returnMs,
  };
}

/** The box the fan needs: the front card plus the room the back slots climb into. */
export function swapBox(width: number, height: number, total: number): { width: number; height: number } {
  const back = swapSlot(Math.max(0, total - 1), total);
  return { width: Math.ceil(width + back.x), height: Math.ceil(height - back.y) };
}

// ─── BounceCards ────────────────────────────────────────────────────────────────────────

export interface FanPose {
  x: number;
  rotate: number;
}

/**
 * The fan at rest for `count` cards in a `containerWidth` box. Five cards take react-bits'
 * `transformStyles` exactly (rotations 10, 5, -3, -10, 2; offsets -170 to 170 on a 400 box),
 * scaled to the box. Any other count spreads the same span evenly and cycles the rotations.
 */
export function fanPoses(count: number, containerWidth: number): FanPose[] {
  const n = Math.max(0, Math.floor(count));
  const k = containerWidth / BOUNCE.designWidth;
  const span = BOUNCE.offsets[BOUNCE.offsets.length - 1]! * k;
  const out: FanPose[] = [];
  for (let i = 0; i < n; i++) {
    const x = n === BOUNCE.offsets.length ? BOUNCE.offsets[i]! * k : n === 1 ? 0 : -span + (2 * span * i) / (n - 1);
    out.push({ x, rotate: BOUNCE.rotations[i % BOUNCE.rotations.length]! });
  }
  return out;
}

/**
 * react-bits `pushSiblings`: the held card straightens where it is, the rest move away from it
 * by `push`. `held` -1 is the fan at rest.
 */
export function pushedPose(i: number, held: number, base: FanPose, push: number): FanPose {
  'worklet';
  if (held < 0) return base;
  if (i === held) return { x: base.x, rotate: 0 };
  return { x: base.x + (i < held ? -push : push), rotate: base.rotate };
}

/** react-bits: a sibling starts `distance * 0.05s` after the held card. */
export function pushDelay(i: number, held: number): number {
  'worklet';
  return held < 0 ? 0 : Math.abs(i - held) * BOUNCE.pushStaggerMs;
}

/** The card nearest a finger at `x` (container coordinates, centre at width / 2). */
export function nearestFanCard(x: number, poses: readonly FanPose[], containerWidth: number): number {
  'worklet';
  let best = -1;
  let bestD = Infinity;
  const local = x - containerWidth / 2;
  for (let i = 0; i < poses.length; i++) {
    const d = Math.abs(poses[i]!.x - local);
    // Ties go to the later card: it is drawn on top.
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// ─── Carousel ───────────────────────────────────────────────────────────────────────────

/** Index `k` wrapped into `0..n-1`, both ways. */
export function wrapIndex(k: number, n: number): number {
  'worklet';
  if (n <= 0) return 0;
  return ((Math.round(k) % n) + n) % n;
}

/**
 * A slide's turn at `position` (in slides): react-bits maps one slide's offset to 90 degrees
 * with no clamp, so the second neighbour is past edge on; here it is `maxDeg` and held there.
 */
export function slideTurn(position: number, index: number, maxDeg: number = CAROUSEL.rotateDeg): number {
  'worklet';
  return clamp((position - index) * maxDeg, -maxDeg, maxDeg);
}

/**
 * Where a released drag lands, in slides. A flick of at least `flick` pt/s moves one past
 * where the stage is, in its direction; otherwise 30% of the way to a neighbour is enough.
 * Never more than one slide from `from` (react-bits moves exactly one), and inside the list
 * unless it loops.
 */
export function carouselTarget(a: { from: number; position: number; vx: number; pitch: number; count: number; loop: boolean }): number {
  'worklet';
  const moved = a.position - a.from;
  let steps: number;
  if (Math.abs(a.vx) >= CAROUSEL.flick && a.pitch > 0) {
    steps = a.vx < 0 ? 1 : -1;
  } else {
    steps = Math.sign(moved) * Math.floor(Math.abs(moved) + (1 - CAROUSEL.commitShare) + 1e-9);
  }
  steps = clamp(steps, -1, 1);
  const target = a.from + steps;
  if (a.loop || a.count <= 0) return target;
  return clamp(target, 0, a.count - 1);
}

/** Past either end of a list that does not loop, the stage follows at a quarter. */
export function rubberBand(position: number, count: number, loop: boolean): number {
  'worklet';
  if (loop || count <= 0) return position;
  const max = count - 1;
  if (position < 0) return position * CAROUSEL.rubber;
  if (position > max) return max + (position - max) * CAROUSEL.rubber;
  return position;
}

/** The slide that is active: it changes only past `hysteresis` of a slide, then to the nearest. */
export function activeSlide(position: number, current: number): number {
  'worklet';
  return Math.abs(position - current) > CAROUSEL.hysteresis ? Math.round(position) : current;
}

/** The slots drawn around `centre`: every one for a looping stage, the real ones otherwise. */
export function windowSlots(centre: number, count: number, loop: boolean, reach: number = CAROUSEL.reach): number[] {
  'worklet';
  const out: number[] = [];
  if (count <= 0) return out;
  for (let k = centre - reach; k <= centre + reach; k++) {
    if (loop || (k >= 0 && k < count)) out.push(k);
  }
  return out;
}

// ─── TiltedCard ─────────────────────────────────────────────────────────────────────────

/**
 * The turn toward a finger at (`x`, `y`) on a `w` by `h` card. react-bits:
 * `rotateX = (offsetY / (h / 2)) * -amplitude`, `rotateY = (offsetX / (w / 2)) * amplitude`,
 * offsets from the centre. Clamped, because a finger can slide off the edge while held.
 */
export function tiltAt(x: number, y: number, w: number, h: number, maxDeg: number = TILT.maxDeg): { rotateX: number; rotateY: number } {
  'worklet';
  const ox = x - w / 2;
  const oy = y - h / 2;
  return {
    rotateX: clamp((oy / Math.max(1, h / 2)) * -maxDeg, -maxDeg, maxDeg),
    rotateY: clamp((ox / Math.max(1, w / 2)) * maxDeg, -maxDeg, maxDeg),
  };
}

/**
 * Where the stepped glare band sits across a `w` wide card for a turn of `rotateY`: centred at
 * rest, a full card width across at the extremes, so tilting sweeps the light over the face.
 */
export function glareOffset(rotateY: number, maxDeg: number, w: number): number {
  'worklet';
  if (maxDeg <= 0) return 0;
  return clamp(rotateY / maxDeg, -1, 1) * w * 0.75;
}

/** Where ProfileCard's arrival sweep starts: react-bits' initial pointer, near the top right. */
export function introPoint(w: number): { x: number; y: number } {
  return { x: Math.max(0, w - PROFILE.initialX), y: PROFILE.initialY };
}

// ─── MagicBento ─────────────────────────────────────────────────────────────────────────

export interface BentoSpan {
  /** Columns. Default 1. */
  span?: number;
  /** Rows. Default 1. */
  rows?: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The bento: items placed in order into `columns` equal columns, each taking `span` columns and
 * `rows` rows, dense (a later small item fills a hole an earlier big one left, CSS
 * `grid-auto-flow: dense`). react-bits hard codes a desktop layout per `nth-child`; this places
 * any list. Returns each item's rectangle and the grid's height.
 */
export function bentoLayout(
  items: readonly BentoSpan[],
  width: number,
  columns: number = BENTO.columns,
  gap: number = BENTO.gap,
  rowHeight: number = BENTO.rowHeight,
): { rects: Rect[]; height: number } {
  const cols = Math.max(1, Math.floor(columns));
  const colW = (width - gap * (cols - 1)) / cols;
  const taken: boolean[][] = [];
  const isFree = (r: number, c: number) => !(taken[r]?.[c] ?? false);
  const take = (r: number, c: number) => {
    while (taken.length <= r) taken.push(new Array<boolean>(cols).fill(false));
    taken[r]![c] = true;
  };
  const rects: Rect[] = [];
  let rowsUsed = 0;
  for (const item of items) {
    const span = clamp(Math.floor(item.span ?? 1), 1, cols);
    const rows = Math.max(1, Math.floor(item.rows ?? 1));
    let placed = false;
    for (let r = 0; !placed; r++) {
      for (let c = 0; c + span <= cols && !placed; c++) {
        let fits = true;
        for (let dr = 0; dr < rows && fits; dr++) for (let dc = 0; dc < span && fits; dc++) fits = isFree(r + dr, c + dc);
        if (!fits) continue;
        for (let dr = 0; dr < rows; dr++) for (let dc = 0; dc < span; dc++) take(r + dr, c + dc);
        rects.push({
          x: c * (colW + gap),
          y: r * (rowHeight + gap),
          w: span * colW + (span - 1) * gap,
          h: rows * rowHeight + (rows - 1) * gap,
        });
        rowsUsed = Math.max(rowsUsed, r + rows);
        placed = true;
      }
    }
  }
  return { rects, height: rowsUsed === 0 ? 0 : rowsUsed * rowHeight + (rowsUsed - 1) * gap };
}

/**
 * How lit a tile is by a finger at (`x`, `y`): react-bits' `GlobalSpotlight`. The distance is
 * from the tile's centre less half its longer side; full inside half the radius, nothing past
 * three quarters, linear between.
 */
export function bentoGlow(x: number, y: number, r: Rect, radius: number = BENTO.spotlightRadius): number {
  'worklet';
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const d = Math.max(0, Math.hypot(x - cx, y - cy) - Math.max(r.w, r.h) / 2);
  const near = radius * BENTO.proximity;
  const far = radius * BENTO.fade;
  if (d <= near) return 1;
  if (d >= far) return 0;
  return (far - d) / (far - near);
}

/** The tile under (`x`, `y`), or -1. */
export function hitTest(rects: readonly Rect[], x: number, y: number): number {
  'worklet';
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]!;
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
  }
  return -1;
}

/** react-bits magnetism: the tile leans `k` of the finger's offset from its centre. */
export function magnetOffset(x: number, y: number, r: Rect, k: number = BENTO.magnet): { x: number; y: number } {
  'worklet';
  return { x: (x - (r.x + r.w / 2)) * k, y: (y - (r.y + r.h / 2)) * k };
}
