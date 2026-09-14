/**
 * The Wrapped deck's rules, pure: the card order, the grid's tilts, the story stack's four
 * slots, the rule that decides when a thrown card commits, and the poses the stack moves
 * through. No React Native import, so `bun test` holds every number here, and every function
 * the gesture reads on the UI thread is a worklet.
 *
 * THE STACK is adapted from Appllama's animated-card-stack, `src/scene/motion.ts`:
 *
 *   MIT License. Copyright (c) 2026 Appllama.
 *   Permission is hereby granted, free of charge, to any person obtaining a copy of this
 *   software and associated documentation files (the "Software"), to deal in the Software
 *   without restriction, including without limitation the rights to use, copy, modify,
 *   merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 *   permit persons to whom the Software is furnished to do so, subject to the following
 *   conditions: The above copyright notice and this permission notice shall be included in
 *   all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS",
 *   WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.
 *
 * What is kept, number for number: the four rest poses (`REST_TRANSFORMS`), the exit sides,
 * the peak rotations, the z swap progress, the outward, return and incoming sample tables,
 * and the 22 frame (367ms) transition. What changed, each for a reason
 * (DESIGN-DIRECTION 6, "Story view and the stack"):
 *
 * - The front card FOLLOWS THE FINGER. The original only reads a finished swipe. A released
 *   card starts its authored exit from wherever the finger left it (`releasedOutgoingPose`
 *   blends the drag pose into the table before the z swap), under the `SHEET` spring seeded
 *   with the finger's velocity.
 * - The exit side is the side it was thrown to. A tap still uses the slot's authored side.
 * - The whole scene holds (`EFFECTIVE_LOCAL_FRAMES`) are dropped. They exist to keep a DOM
 *   playback frame identical to a video render; under a spring they read as hitches.
 * - The glass layer, the blur ramps and the shadows are dropped (the brief bans glass; the
 *   design allows one float shadow, and a 4 card stack on the canvas does not need it).
 * - The cards behind the front one show their band and NOTHING ON IT (`BACK_CONTENT_OPACITY`
 *   0, not the original's 0.55). FOUND IN THE FINAL CAPTURE (2026-09-13, shots 52 and 54): the
 *   fan turns a back card up to 10.56 degrees, so its corner stands out past the front card's
 *   edge, and there its dimmed index ("0" of "05") was printed at the screen's left edge, a
 *   word from another card. The band is the depth cue; the words wait until the card comes
 *   forward, on the original's own curve (`incomingContentOpacity`, rescaled to start at 0),
 *   and a card going behind lets its words go as it tucks in (`outgoingContentOpacity`).
 * - Distances in the tables are in the original's 1240 unit scene, where a card is 704
 *   units wide (CSS `width: 56.774194cqw` of 1240). They are kept as written and divided
 *   by `CARD_UNITS` at the one place a pose is made, so the tables stay diffable against
 *   the source.
 */
import { REPORT_ENUMS, type WrappedCard } from '../generated/report';

// ─── the deck ───────────────────────────────────────────────────────────────────────────

/** The fifteen cards in the order the engine writes them (`wrapped.CARD_IDS`). */
export const CARD_ORDER: readonly WrappedCard[] = REPORT_ENUMS.wrapped_card;
export const DECK_SIZE = CARD_ORDER.length;

// ─── the grid ───────────────────────────────────────────────────────────────────────────

/** Two columns, 12pt apart (DESIGN-DIRECTION 6; `tokens.layout.tileGap`). */
export const GRID_COLUMNS = 2;

/**
 * Each card in the grid is rotated by this table, by index, in degrees. Fixed, never
 * random, so two screenshots of the same deck are the same picture (DESIGN-DIRECTION 6).
 */
export const GRID_TILT = [-1.5, 1, -0.5, 1.5] as const;

export function gridTilt(index: number): number {
  const i = Math.floor(index);
  return GRID_TILT[((i % GRID_TILT.length) + GRID_TILT.length) % GRID_TILT.length]!;
}

// ─── the story stack: four slots ────────────────────────────────────────────────────────

export type SlotIndex = 0 | 1 | 2 | 3;
export const SLOTS = 4;

/** The slot a card lives in. A card keeps its slot, so card 5 wears card 1's rest pose. */
export function slotOf(cardIndex: number): SlotIndex {
  'worklet';
  return ((((Math.floor(cardIndex) % SLOTS) + SLOTS) % SLOTS) as SlotIndex);
}

/**
 * The card a slot shows while `front` is on top: the one of front, front+1, front+2,
 * front+3 that lives in it. Null past the end of the deck, so the stack thins to one card
 * at card 15 instead of wrapping round to card 1.
 */
export function cardInSlot(slot: SlotIndex, front: number, total: number): number | null {
  const card = front + ((slot - slotOf(front) + SLOTS) % SLOTS);
  return card >= 0 && card < total ? card : null;
}

/** How far down the stack a slot is while `front` is on top: 0 is the front card. */
export function depthOf(slot: SlotIndex, front: number): number {
  return (slot - slotOf(front) + SLOTS) % SLOTS;
}

// ─── when a thrown card commits ─────────────────────────────────────────────────────────

/** A drag this far, mostly sideways, commits: the original's own rule (App.tsx). */
export const COMMIT_DISTANCE = 24;
/** "Mostly sideways": the horizontal part beats the vertical part by this much. */
export const COMMIT_DOMINANCE = 1.15;
/** A flick this fast commits whatever the distance (DESIGN-DIRECTION 6), in pt/s. */
export const COMMIT_VELOCITY = 800;

export interface Release {
  dx: number;
  dy: number;
  vx: number;
  vy: number;
}

/**
 * Which way a released card was thrown: -1 left, 1 right, 0 not at all (it springs home).
 * A fast flick decides by its velocity, even against the distance (dragged right, flicked
 * back left, it goes left); otherwise the distance decides. Either way it has to be mostly
 * sideways, so a vertical scroll attempt never advances the deck.
 */
export function throwOf(r: Release): -1 | 0 | 1 {
  'worklet';
  const avx = Math.abs(r.vx);
  if (avx >= COMMIT_VELOCITY && avx > COMMIT_DOMINANCE * Math.abs(r.vy)) return r.vx < 0 ? -1 : 1;
  const adx = Math.abs(r.dx);
  if (adx >= COMMIT_DISTANCE && adx > COMMIT_DOMINANCE * Math.abs(r.dy)) return r.dx < 0 ? -1 : 1;
  return 0;
}

// ─── poses ──────────────────────────────────────────────────────────────────────────────

/** A card's transform relative to the front position: points, a scale, degrees. */
export interface Pose {
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

/** One frame at 59.94 fps: the original's authoring rate. */
const FRAME_MS = (1000 * 1001) / 60000;
/** The transition, 22 frames: 367ms (the fourth slot's 23 is folded into 22). */
export const TRANSITION_MS = Math.round(22 * FRAME_MS);

/** Width of a card in the original scene's units (56.774194% of 1240). */
export const CARD_UNITS = 704;

/** The front card's centre in the original scene, which every pose below is relative to. */
const FRONT_X = 620.5;
const FRONT_Y = 620;

/** Rest pose of each slot, behind the front card, in scene units. The original, verbatim. */
export const REST_TRANSFORMS = [
  { x: 645.4, y: 633.3, scale: 0.9748, rotation: -10.56 },
  { x: 644.1, y: 628.9, scale: 0.9745, rotation: 5.42 },
  { x: 634, y: 633.5, scale: 0.979, rotation: 8.62 },
  { x: 619.7, y: 631.5, scale: 0.975, rotation: 5.52 },
] as const;

/** The side each slot leaves by on a tap: right, left, right, left. */
export const EXIT_SIDE = [1, -1, 1, -1] as const;
/** The most each slot turns on its way out, in degrees; the sign is its authored side. */
export const PEAK_ROTATION = [8.2, -11, 19.5, -11.24] as const;
/** Where in the transition the outgoing card passes behind the stack. */
export const Z_SWAP_PROGRESS = [0.455, 0.455, 0.5, 0.59] as const;
const OUTWARD_END_PROGRESS = [0.455, 0.455, 0.5, 0.609] as const;

interface Outward {
  t: number;
  distance: number;
  y: number;
  scale: number;
  rotation: number;
}
interface Return {
  t: number;
  distance: number;
  y: number;
  scale: number;
  peakWeight: number;
}
interface Weight {
  t: number;
  value: number;
}

const RIGHT_OUTWARD: readonly Outward[] = [
  { t: 0, distance: 0, y: 0, scale: 1, rotation: 0 },
  { t: 0.045, distance: 2, y: 0, scale: 0.997, rotation: 0.005 },
  { t: 0.091, distance: 22, y: 1, scale: 0.975, rotation: 0.045 },
  { t: 0.136, distance: 44, y: 2, scale: 0.95, rotation: 0.102 },
  { t: 0.182, distance: 76, y: 3, scale: 0.912, rotation: 0.185 },
  { t: 0.227, distance: 120, y: 6, scale: 0.862, rotation: 0.308 },
  { t: 0.318, distance: 176, y: 8, scale: 0.798, rotation: 0.455 },
  { t: 0.364, distance: 245, y: 11, scale: 0.717, rotation: 0.627 },
  { t: 0.409, distance: 324, y: 16, scale: 0.627, rotation: 0.812 },
  { t: 0.455, distance: 448, y: 23, scale: 0.48, rotation: 1 },
];

const LEFT_OUTWARD: readonly Outward[] = [
  { t: 0, distance: 2, y: 0, scale: 0.997, rotation: 0 },
  { t: 0.045, distance: 8, y: 0.5, scale: 0.99, rotation: 0.02 },
  { t: 0.091, distance: 41, y: 3, scale: 0.951, rotation: 0.076 },
  { t: 0.136, distance: 73, y: 5, scale: 0.912, rotation: 0.163 },
  { t: 0.227, distance: 116, y: 8, scale: 0.861, rotation: 0.274 },
  { t: 0.318, distance: 167, y: 11, scale: 0.8, rotation: 0.409 },
  { t: 0.364, distance: 310, y: 21, scale: 0.626, rotation: 0.777 },
  { t: 0.455, distance: 412, y: 23, scale: 0.48, rotation: 1 },
];

const CARD_C_OUTWARD: readonly Outward[] = [
  { t: 0, distance: 0, y: 0, scale: 1, rotation: 0 },
  { t: 0.045, distance: 2.7, y: 0, scale: 0.9967, rotation: 0.026 },
  { t: 0.091, distance: 9.4, y: 0.4, scale: 0.9891, rotation: 0.04 },
  { t: 0.136, distance: 22.2, y: 1.3, scale: 0.9748, rotation: 0.067 },
  { t: 0.182, distance: 42.8, y: 2.9, scale: 0.9507, rotation: 0.108 },
  { t: 0.227, distance: 75.5, y: 5.2, scale: 0.912, rotation: 0.174 },
  { t: 0.273, distance: 119.8, y: 8.4, scale: 0.8605, rotation: 0.263 },
  { t: 0.318, distance: 119.8, y: 8.4, scale: 0.8607, rotation: 0.263 },
  { t: 0.364, distance: 175.1, y: 12.4, scale: 0.7969, rotation: 0.374 },
  { t: 0.409, distance: 245.4, y: 17.8, scale: 0.7138, rotation: 0.521 },
  { t: 0.455, distance: 316.3, y: 22.9, scale: 0.6297, rotation: 0.67 },
  { t: 0.5, distance: 442, y: 35, scale: 0.48, rotation: 1 },
];

const CARD_D_OUTWARD: readonly Outward[] = [
  { t: 0, distance: 0, y: 0, scale: 1, rotation: 0 },
  { t: 0.043, distance: 2, y: 0, scale: 0.9969, rotation: 0.027 },
  { t: 0.087, distance: 8.8, y: 0.5, scale: 0.9896, rotation: 0.034 },
  { t: 0.13, distance: 21.1, y: 1, scale: 0.9747, rotation: 0.076 },
  { t: 0.174, distance: 42.3, y: 2, scale: 0.9495, rotation: 0.129 },
  { t: 0.217, distance: 74.2, y: 3.9, scale: 0.9129, rotation: 0.194 },
  { t: 0.261, distance: 117.9, y: 6.3, scale: 0.8615, rotation: 0.299 },
  { t: 0.304, distance: 117.9, y: 6.3, scale: 0.8615, rotation: 0.299 },
  { t: 0.348, distance: 174.1, y: 9.2, scale: 0.7951, rotation: 0.442 },
  { t: 0.391, distance: 316.2, y: 17.8, scale: 0.6271, rotation: 0.761 },
  { t: 0.565, distance: 385.4, y: 23.6, scale: 0.5487, rotation: 0.881 },
  { t: 0.609, distance: 435.7, y: 27.2, scale: 0.4792, rotation: 1 },
];

const RETURN: readonly Return[] = [
  { t: 0.455, distance: 448, y: 23, scale: 0.48, peakWeight: 1 },
  { t: 0.545, distance: 465, y: 25, scale: 0.425, peakWeight: 0.915 },
  { t: 0.682, distance: 273, y: 33, scale: 0.669, peakWeight: 0.358 },
  { t: 0.727, distance: 202, y: 29, scale: 0.744, peakWeight: 0.267 },
  { t: 0.773, distance: 153, y: 24, scale: 0.78, peakWeight: 0.175 },
];

const CARD_C_RETURN: readonly Return[] = [
  { t: 0.5, distance: 442, y: 35, scale: 0.484, peakWeight: 0.985 },
  { t: 0.545, distance: 442, y: 35, scale: 0.484, peakWeight: 0.985 },
  { t: 0.591, distance: 446, y: 39, scale: 0.475, peakWeight: 1.065 },
  { t: 0.636, distance: 446, y: 39, scale: 0.475, peakWeight: 1.065 },
  { t: 0.682, distance: 339, y: 38, scale: 0.57, peakWeight: 0.99 },
  { t: 0.727, distance: 260, y: 35, scale: 0.67, peakWeight: 0.868 },
  { t: 0.773, distance: 190, y: 33, scale: 0.75, peakWeight: 0.736 },
  { t: 0.818, distance: 130, y: 28, scale: 0.82, peakWeight: 0.47 },
  { t: 0.864, distance: 80, y: 23, scale: 0.88, peakWeight: 0.25 },
  { t: 0.909, distance: 40, y: 18, scale: 0.93, peakWeight: 0.08 },
  { t: 0.955, distance: 14, y: 13.5, scale: 0.979, peakWeight: 0 },
];

const CARD_D_RETURN: readonly Return[] = [
  { t: 0.609, distance: 435.7, y: 27.2, scale: 0.4792, peakWeight: 1 },
  { t: 0.652, distance: 322.9, y: 33.3, scale: 0.5868, peakWeight: 0.658 },
  { t: 0.739, distance: 178.6, y: 31.2, scale: 0.7424, peakWeight: 0.366 },
  { t: 0.783, distance: 100, y: 25, scale: 0.82, peakWeight: 0.15 },
  { t: 0.826, distance: 40, y: 18, scale: 0.9, peakWeight: 0.05 },
  { t: 0.87, distance: 0, y: 11.5, scale: 0.975, peakWeight: 0 },
];

// The incoming card lingers in its fanned pose, then catches up quickly as the outgoing
// card crosses behind it. Rest = 1, front = 0.
const INCOMING_WEIGHT: readonly Weight[] = [
  { t: 0, value: 1 },
  { t: 0.273, value: 0.994 },
  { t: 0.318, value: 0.943 },
  { t: 0.364, value: 0.886 },
  { t: 0.409, value: 0.809 },
  { t: 0.455, value: 0.607 },
  { t: 0.545, value: 0.479 },
  { t: 0.591, value: 0.363 },
  { t: 0.636, value: 0.277 },
  { t: 0.682, value: 0.202 },
  { t: 0.727, value: 0.136 },
  { t: 0.773, value: 0.088 },
  { t: 0.818, value: 0.064 },
  { t: 0.864, value: 0.02 },
  { t: 0.955, value: 0 },
  { t: 1, value: 0 },
];

const CARD_D_INCOMING_WEIGHT: readonly Weight[] = [
  { t: 0, value: 1 },
  { t: 0.318, value: 1 },
  { t: 0.364, value: 0.95 },
  { t: 0.409, value: 0.905 },
  { t: 0.455, value: 0.84 },
  { t: 0.5, value: 0.62 },
  { t: 0.545, value: 0.62 },
  { t: 0.591, value: 0.501 },
  { t: 0.636, value: 0.501 },
  { t: 0.682, value: 0.29 },
  { t: 0.727, value: 0.215 },
  { t: 0.773, value: 0.152 },
  { t: 0.818, value: 0.103 },
  { t: 0.864, value: 0.071 },
  { t: 0.909, value: 0.03 },
  { t: 0.955, value: 0.019 },
  { t: 1, value: 0 },
];

const CARD_A_INCOMING_WEIGHT: readonly Weight[] = [
  { t: 0, value: 1 },
  { t: 0.304, value: 1 },
  { t: 0.348, value: 0.963 },
  { t: 0.391, value: 0.809 },
  { t: 0.565, value: 0.714 },
  { t: 0.609, value: 0.596 },
  { t: 0.652, value: 0.253 },
  { t: 0.739, value: 0.106 },
  { t: 0.783, value: 0.057 },
  { t: 0.826, value: 0.021 },
  { t: 0.87, value: 0 },
  { t: 1, value: 0 },
];

function clamp01(v: number): number {
  'worklet';
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function mix(from: number, to: number, amount: number): number {
  'worklet';
  return from + (to - from) * amount;
}

function smoothstep(v: number): number {
  'worklet';
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

function sampleWeight(samples: readonly Weight[], progress: number): number {
  'worklet';
  const t = clamp01(progress);
  for (let i = 1; i < samples.length; i++) {
    const right = samples[i]!;
    if (t <= right.t) {
      const left = samples[i - 1]!;
      return mix(left.value, right.value, (t - left.t) / (right.t - left.t));
    }
  }
  return samples[samples.length - 1]!.value;
}

function outwardTable(slot: SlotIndex, side: number): readonly Outward[] {
  'worklet';
  if (slot === 2) return CARD_C_OUTWARD;
  if (slot === 3) return CARD_D_OUTWARD;
  return side > 0 ? RIGHT_OUTWARD : LEFT_OUTWARD;
}

function sampleOutward(slot: SlotIndex, side: number, progress: number): Outward {
  'worklet';
  const samples = outwardTable(slot, side);
  const t = clamp01(progress);
  for (let i = 1; i < samples.length; i++) {
    const right = samples[i]!;
    if (t <= right.t) {
      const left = samples[i - 1]!;
      const k = (t - left.t) / (right.t - left.t);
      return {
        t,
        distance: mix(left.distance, right.distance, k),
        y: mix(left.y, right.y, k),
        scale: mix(left.scale, right.scale, k),
        rotation: mix(left.rotation, right.rotation, k),
      };
    }
  }
  return samples[samples.length - 1]!;
}

function sampleReturn(slot: SlotIndex, progress: number): Return | null {
  'worklet';
  const samples = slot === 2 ? CARD_C_RETURN : slot === 3 ? CARD_D_RETURN : RETURN;
  for (let i = 1; i < samples.length; i++) {
    const right = samples[i]!;
    if (progress <= right.t) {
      const left = samples[i - 1]!;
      const k = (progress - left.t) / (right.t - left.t);
      return {
        t: progress,
        distance: mix(left.distance, right.distance, k),
        y: mix(left.y, right.y, k),
        scale: mix(left.scale, right.scale, k),
        peakWeight: mix(left.peakWeight, right.peakWeight, k),
      };
    }
  }
  return null;
}

/** The pose at the front: upright, full size, no offset. */
export const FRONT_POSE: Pose = { x: 0, y: 0, scale: 1, rotation: 0 };

/** A slot's rest pose behind the front card, for a card `width` points wide. */
export function restPose(slot: SlotIndex, width: number): Pose {
  'worklet';
  const r = REST_TRANSFORMS[slot]!;
  const k = width / CARD_UNITS;
  return { x: (r.x - FRONT_X) * k, y: (r.y - FRONT_Y) * k, scale: r.scale, rotation: r.rotation };
}

/**
 * The outgoing card at `progress` (0 front, 1 back at rest), leaving by `side`. The
 * authored path: out along the slot's table, behind the stack at the z swap, home along the
 * return table. Thrown against its authored side, the path and its turn are mirrored.
 */
export function outgoingPose(slot: SlotIndex, progress: number, side: number, width: number): Pose {
  'worklet';
  const p = clamp01(progress);
  const k = width / CARD_UNITS;
  const s = side < 0 ? -1 : 1;
  const rest = restPose(slot, width);
  const peak = Math.abs(PEAK_ROTATION[slot]!) * s;

  if (p <= OUTWARD_END_PROGRESS[slot]!) {
    const o = sampleOutward(slot, s, p);
    return { x: o.distance * s * k, y: o.y * k, scale: o.scale, rotation: peak * o.rotation };
  }
  const r = sampleReturn(slot, p);
  if (r) {
    // Slot 1 mirrors slot 0's return arc a little tighter; 2 and 3 have their own tables.
    const reach = slot === 1 ? 0.92 : 1;
    return { x: r.distance * reach * s * k, y: r.y * k, scale: r.scale, rotation: mix(rest.rotation, peak, r.peakWeight) };
  }
  if ((slot === 2 && p >= 0.955) || (slot === 3 && p >= 0.87)) return rest;

  const home = smoothstep((p - 0.773) / (1 - 0.773));
  return {
    x: mix(153 * (s < 0 ? 0.92 : 1) * s * k, rest.x, home),
    y: mix(24 * k, rest.y, home),
    scale: mix(0.78, rest.scale, home),
    rotation: mix(mix(rest.rotation, peak, 0.175), rest.rotation, home),
  };
}

/** The incoming card at `progress`: from its slot's rest pose up to the front. */
export function incomingPose(slot: SlotIndex, progress: number, width: number): Pose {
  'worklet';
  const rest = restPose(slot, width);
  const table = slot === 0 ? CARD_A_INCOMING_WEIGHT : slot === 3 ? CARD_D_INCOMING_WEIGHT : INCOMING_WEIGHT;
  const w = sampleWeight(table, progress);
  return { x: rest.x * w, y: rest.y * w, scale: mix(1, rest.scale, w), rotation: rest.rotation * w };
}

/** Content of the cards behind the front one: hidden (the file comment says why). */
export const BACK_CONTENT_OPACITY = 0;

/** The original's back card dim, which its incoming table below starts from. */
const ORIGINAL_BACK_CONTENT_OPACITY = 0.55;

// The incoming card's content brightens as it comes forward: the original's table, as written
// (from its 0.55 dim), rescaled where it is read so it starts from this stack's hidden words.
const INCOMING_CONTENT_OPACITY: readonly Weight[] = [
  { t: 0, value: 0.55 },
  { t: 0.273, value: 0.55 },
  { t: 0.409, value: 0.66 },
  { t: 0.455, value: 0.7 },
  { t: 0.545, value: 0.76 },
  { t: 0.682, value: 0.88 },
  { t: 0.818, value: 0.96 },
  { t: 1, value: 1 },
];

export function incomingContentOpacity(progress: number): number {
  'worklet';
  const o = sampleWeight(INCOMING_CONTENT_OPACITY, progress);
  return clamp01((o - ORIGINAL_BACK_CONTENT_OPACITY) / (1 - ORIGINAL_BACK_CONTENT_OPACITY));
}

/**
 * The outgoing card's content at `progress`, thrown forward: whole until it passes behind the
 * stack at `swap`, then gone by half way home, before it tucks into the fan where a word at its
 * turned edge would peek past the new front card.
 */
export function outgoingContentOpacity(progress: number, swap: number): number {
  'worklet';
  if (progress < swap) return 1;
  return clamp01(1 - (progress - swap) / Math.max(0.0001, (1 - swap) / 2));
}

// ─── the finger ─────────────────────────────────────────────────────────────────────────

/**
 * Degrees the front card turns per card width dragged, and the most it turns.
 * UNMEASURED JUDGEMENT CALL: about the outgoing table's turn at the same distance (slot 0
 * is 2.5 degrees at a sixth of a card), so a release does not snap its angle.
 */
export const DRAG_TILT = 14;
export const DRAG_TILT_MAX = 16;
/** The card follows a vertical drag at this fraction: it is thrown sideways, not lifted. */
export const DRAG_LIFT = 0.25;
/**
 * Past the end of the deck the card still follows, at this fraction: the 25% rubber band
 * the liquid glass reference uses, so the stop is felt rather than hit.
 */
export const RUBBER_BAND = 0.25;

export function dragPose(dx: number, dy: number, width: number): Pose {
  'worklet';
  const turn = (dx / Math.max(1, width)) * DRAG_TILT;
  const rotation = turn > DRAG_TILT_MAX ? DRAG_TILT_MAX : turn < -DRAG_TILT_MAX ? -DRAG_TILT_MAX : turn;
  return { x: dx, y: dy * DRAG_LIFT, scale: 1, rotation };
}

/**
 * Where on the outward table a card thrown from `distance` points out already is: the
 * progress whose authored distance matches, so a release continues from the finger rather
 * than starting the exit over. Held short of the z swap, so even a long drag is still in
 * front when it lets go.
 */
export function progressAtDistance(slot: SlotIndex, side: number, distance: number, width: number): number {
  'worklet';
  const samples = outwardTable(slot, side);
  const target = (Math.abs(distance) * CARD_UNITS) / Math.max(1, width);
  const cap = Z_SWAP_PROGRESS[slot]! - 0.05;
  for (let i = 1; i < samples.length; i++) {
    const left = samples[i - 1]!;
    const right = samples[i]!;
    if (target <= right.distance && right.distance > left.distance) {
      const k = clamp01((target - left.distance) / (right.distance - left.distance));
      const t = mix(left.t, right.t, k);
      return t > cap ? cap : t;
    }
  }
  return cap;
}

/** UNMEASURED JUDGEMENT CALL: six whole transitions a second is already a blur. */
export const MAX_PROGRESS_VELOCITY = 6;

/**
 * The finger's velocity as progress per second at `progress`: points per second over the
 * table's slope there. Clamped, so a violent flick cannot hand the spring a speed that
 * overshoots past the z swap in one frame.
 *
 * Declared after everything it reads: a worklet captures its closure where it is defined,
 * so a constant further down the file would be read before it exists.
 */
export function progressVelocity(slot: SlotIndex, side: number, progress: number, velocity: number, width: number): number {
  'worklet';
  const samples = outwardTable(slot, side);
  const t = clamp01(progress);
  let slope = 0;
  for (let i = 1; i < samples.length; i++) {
    const left = samples[i - 1]!;
    const right = samples[i]!;
    if (t <= right.t) {
      slope = ((right.distance - left.distance) / (right.t - left.t)) * (width / CARD_UNITS);
      break;
    }
  }
  if (slope <= 0) return 0;
  const v = Math.abs(velocity) / slope;
  return v > MAX_PROGRESS_VELOCITY ? MAX_PROGRESS_VELOCITY : v;
}

/**
 * The outgoing card after a release: the drag pose it was let go in, blended into the
 * authored path over the stretch before the z swap, then the authored path alone. At
 * `progress === from` it is exactly the release pose, so nothing jumps under the finger.
 */
export function releasedOutgoingPose(
  slot: SlotIndex,
  progress: number,
  side: number,
  width: number,
  release: Pose,
  from: number,
): Pose {
  'worklet';
  const authored = outgoingPose(slot, progress, side, width);
  const swap = Z_SWAP_PROGRESS[slot]!;
  if (progress >= swap || from >= swap) return authored;
  const w = smoothstep((progress - from) / Math.max(0.0001, swap - from));
  return {
    x: mix(release.x, authored.x, w),
    y: mix(release.y, authored.y, w),
    scale: mix(release.scale, authored.scale, w),
    rotation: mix(release.rotation, authored.rotation, w),
  };
}
