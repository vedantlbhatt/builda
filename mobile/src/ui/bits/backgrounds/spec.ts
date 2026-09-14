/**
 * The shader backgrounds' shared props API, their tuning (each react-bits number beside what a
 * phone changed), the clock's pacing, the resolution plan, the tones and the uniform builders.
 * Pure: no React Native import (types only), so `__tests__/bitsBackgrounds.test.ts` holds it.
 *
 * Ported from react-bits `Backgrounds/*` (Dither, PixelBlast, Silk, Grainient, Radar, DotGrid,
 * Topography) by David Haz.
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
 * What changed in the ports is written beside each program in `shaders.ts`.
 *
 * ─── The props every background takes (`BackgroundProps`) ─────────────────────────────────
 *
 *   width, height   the box in points (required: a field is sized, never measured mid frame)
 *   hue             a spectrum name (`'tide'`) or a resolved `Hue` (`creatureHue('fox')`);
 *                   default per component (`DEFAULT_HUE`). Paper, partner and ink are that hue.
 *   ink, partner, paper   override one tone, `#RRGGBB`; paper defaults to `'transparent'`, so
 *                   the surface under the canvas is the paper
 *   levels          3 (paper, partner, ink; default) or 2 (ink over paper)
 *   speed           multiplies the component's rate (`RATE`, react-bits' speed x AMBIENT 0.3
 *                   for ambient fields); 0 is a still field that still answers a finger
 *   scale           feature size: 2 draws every feature twice as big; 1 is react-bits' tuning
 *   cell            the grain in points; default tokens.dither.cell (3)
 *   fps             how often the field advances; default AMBIENT.fps (20)
 *   seed            seconds into the field: the still frame, and where motion starts; default 0
 *   paused          stop on the current frame. A `SharedValue<boolean>` lets a scroll handler
 *                   pause a hero that scrolled away without a React render
 *   develop         on mount the cells switch on in Bayer order over REVEAL_MS (HalftoneReveal)
 *   reveal          or drive that develop yourself, 0..1
 *   edgeFade        the field thins toward every edge through the dither (react-bits
 *                   PixelBlast `edgeFade`); 0 is off; PixelBlast defaults to 0.5
 *   clear           a rect in points kept as paper, grown by one cell on every side: Bit's box,
 *                   so he never sits on his own hue (DESIGN-V2 3.2)
 *   resolution      'auto' (default): one pass, or one texel per cell when the field covers more
 *                   than LARGE_FIELD_PT2; 'pass' or 'texture' to force one
 *   style, accessibilityLabel   decorative (hidden from VoiceOver) unless a label is given
 *
 * Always: paused when the screen is not focused, when the app is not active and when `paused`
 * says so (the frame callback stops, it does not redraw the same frame); under Reduce Motion
 * the field is one still frame at `seed`, a develop lands at once and fingers do nothing.
 */
import type { StyleProp, ViewStyle } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import { tokens } from '../../../generated/tokens';
import { hue as resolveHue, isHueName, type Hue, type HueName, type Scheme } from '../../../theme';
import { premultiplied } from '../../dithering';
import type { BackgroundName } from './shaders';

// ─── motion ──────────────────────────────────────────────────────────────────────────────

/**
 * Ambient fields run at 20 fps at react-bits' speeds x 0.3 (DESIGN-V2 3, rule 2). The design
 * puts these in `motionSpec.ts`; the test holds this copy to that one the day it lands there.
 */
export const AMBIENT = { fps: 20, speed: 0.3 } as const;

/** A field develops in (cells switching on in Bayer order) over this, on EASE (DESIGN-V2 3). */
export const REVEAL_MS = 500;

/** A frame longer than this (a hitch, a return from the background) advances the field this much. */
export const MAX_FRAME_DT_MS = 100;

/** A frame is due this many ms early: at 60 Hz three frames are 50.01 or 49.99 ms. */
const FRAME_SLACK_MS = 2;

/**
 * Field seconds per real second, before `speed`. Ambient fields are react-bits' clock x 0.3;
 * Radar is not ambient (it says "waiting"), so it keeps react-bits' sweep, one turn in 6.3 s.
 */
export const RATE: Readonly<Record<BackgroundName, number>> = {
  /** react-bits Dither's clock is seconds. */
  FieldDither: AMBIENT.speed,
  /** react-bits PixelBlast scales its clock by `speed 0.5`. */
  PixelBlast: AMBIENT.speed * 0.5,
  /** react-bits Silk adds `0.1` a second to its clock. */
  Silk: AMBIENT.speed * 0.1,
  Grainient: AMBIENT.speed,
  Radar: 1,
  Topography: AMBIENT.speed,
  /** No field time: only a finger moves the dots. */
  DotGrid: 0,
};

/** The hue a background wears when the caller gives none: its first use in the design. */
export const DEFAULT_HUE: Readonly<Record<BackgroundName, HueName>> = {
  /** The generalist's hero and the ProfileCard ground before an archetype exists. */
  FieldDither: 'amber',
  /** Onboarding hello and the Now empty state: Bit's amber (DESIGN-V2 3.1, 3.2). */
  PixelBlast: 'amber',
  /** Pairing: "a Radar sweeps in amber while waiting" (DESIGN-V2 3.2). */
  Radar: 'amber',
  Silk: 'heather',
  Grainient: 'iris',
  Topography: 'tide',
  DotGrid: 'cobalt',
};

// ─── the common props ────────────────────────────────────────────────────────────────────

export type Resolution = 'auto' | 'pass' | 'texture';

export interface ClearRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Tones {
  ink: string;
  partner: string;
  paper: string;
}

/** The props every background takes. The file header says what each does. */
export interface BackgroundProps {
  width: number;
  height: number;
  hue?: HueName | Hue;
  ink?: string;
  partner?: string;
  paper?: string;
  levels?: 2 | 3;
  speed?: number;
  scale?: number;
  cell?: number;
  fps?: number;
  seed?: number;
  paused?: boolean | SharedValue<boolean>;
  develop?: boolean;
  reveal?: SharedValue<number>;
  edgeFade?: number;
  clear?: ClearRect | null;
  resolution?: Resolution;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

/** A point in the canvas, points, handed to `onTap`. */
export interface FieldPoint {
  x: number;
  y: number;
}

// ─── resolution ──────────────────────────────────────────────────────────────────────────

/**
 * Past this many square points a field is drawn into a texture at one pixel per cell and
 * scaled up (about 390 x 385 pt: more than about half an iPhone screen). Under it every device
 * pixel evaluates its cell's centre, which a hero band holds at 20 fps with room to spare; over
 * it that is ~3 million evaluations a frame for ~40 thousand distinct values (DESIGN-V2 3.3).
 */
export const LARGE_FIELD_PT2 = 150_000;

/** Octaves a large field keeps when it must draw in one pass (DESIGN-V2 3.3: cut to 2). */
export const PASS_OCTAVE_CAP = 2;

export interface FieldPlan {
  path: 'pass' | 'texture';
  /** Whole or partial cells across and down: the texture's size. */
  cols: number;
  rows: number;
  large: boolean;
}

export function planField(width: number, height: number, cell: number, resolution: Resolution = 'auto'): FieldPlan {
  const w = Math.max(0, width);
  const h = Math.max(0, height);
  const c = cell > 0 ? cell : tokens.dither.cell;
  const cols = Math.max(1, Math.ceil(w / c));
  const rows = Math.max(1, Math.ceil(h / c));
  const large = w * h > LARGE_FIELD_PT2;
  const path = resolution === 'auto' ? (large ? 'texture' : 'pass') : resolution;
  return { path, cols, rows, large };
}

/** The octaves a field draws with: its own, or `PASS_OCTAVE_CAP` for a large field in one pass. */
export function octavesFor(own: number, plan: Pick<FieldPlan, 'path' | 'large'>): number {
  return plan.path === 'pass' && plan.large ? Math.min(own, PASS_OCTAVE_CAP) : own;
}

// ─── the clock ───────────────────────────────────────────────────────────────────────────

export interface ClockTick {
  /** Ms this frame counts for: the frame's own, at most MAX_FRAME_DT_MS, 0 on the first. */
  dt: number;
  /** Real ms the clock has run (paused time does not count). */
  real: number;
  /** Ms since the field last advanced. */
  since: number;
  /** Whether this frame advances the field (publishes `t` and `now`). */
  publish: boolean;
}

/**
 * One frame of the field clock. `real` always advances (by a frame of at most MAX_FRAME_DT_MS,
 * so a hitch or a return from the background never jumps the field); the field advances every
 * `1000 / fps` ms, and only when `live` (the field moves, or a finger's ripple or shock is
 * still running). A frame is due FRAME_SLACK_MS early, so 20 fps on a 60 Hz display is every
 * third frame and never an uneven fourth.
 */
export function clockStep(prev: { real: number; since: number }, dtMs: number | null, fps: number, live: boolean): ClockTick {
  'worklet';
  const dt = dtMs === null || !(dtMs > 0) ? 0 : Math.min(dtMs, MAX_FRAME_DT_MS);
  const real = prev.real + dt;
  const frameMs = 1000 / Math.max(1, fps);
  const since = prev.since + dt;
  if (!live || since < frameMs - FRAME_SLACK_MS) return { dt, real, since: live ? since : 0, publish: false };
  return { dt, real, since: since >= frameMs * 2 ? 0 : Math.max(0, since - frameMs), publish: true };
}

/**
 * Field time after a frame of `dtMs`: it INTEGRATES the component's rate times `speed`, so a
 * speed change mid run bends the field's pace instead of jumping it, and speed 0 holds the frame
 * it is on.
 */
export function advanceField(t: number, dtMs: number, rate: number, speed: number): number {
  'worklet';
  return t + (dtMs / 1000) * rate * speed;
}

// ─── tones ───────────────────────────────────────────────────────────────────────────────

/**
 * The three tones for a scheme. A hue name resolves through `theme.ts` (the ink is the dark ink
 * on dark and the 3:1 mark tone on light, the partner the matching partner); a `Hue` is taken as
 * given; an unknown name falls back to the component's default rather than drawing nothing.
 */
export function resolveTones(
  scheme: Scheme,
  given: HueName | Hue | undefined,
  fallback: HueName,
  over: Partial<Tones> = {},
): Tones {
  const h: Hue =
    given !== undefined && typeof given === 'object'
      ? given
      : resolveHue(isHueName(given) ? given : fallback, scheme);
  return { ink: over.ink ?? h.ink, partner: over.partner ?? h.partner, paper: over.paper ?? 'transparent' };
}

export type Vec = readonly number[];

/** The uniforms every field shares (`COMMON_UNIFORMS`), with no time, no develop and no texture. */
export interface CommonUniforms {
  size: Vec;
  cell: number;
  unit: number;
  t: number;
  levels: number;
  reveal: number;
  edge: number;
  clearRect: Vec;
  ink: Vec;
  partner: Vec;
  paper: Vec;
}

/** The cleared rect grown by one cell on every side, as the `clearRect` uniform; none is zeros. */
export function clearRectUniform(clear: ClearRect | null | undefined, cell: number): number[] {
  if (!clear || !(clear.width > 0) || !(clear.height > 0)) return [0, 0, 0, 0];
  return [clear.x - cell, clear.y - cell, clear.width + 2 * cell, clear.height + 2 * cell];
}

export function commonUniforms(o: {
  width: number;
  height: number;
  cell: number;
  levels?: 2 | 3;
  edgeFade?: number;
  clear?: ClearRect | null;
  tones: Tones;
}): CommonUniforms {
  return {
    size: [Math.max(1, o.width), Math.max(1, o.height)],
    cell: o.cell,
    unit: 1,
    t: 0,
    levels: o.levels === 2 ? 2 : 3,
    reveal: 1,
    edge: Math.max(0, o.edgeFade ?? 0),
    clearRect: clearRectUniform(o.clear, o.cell),
    ink: premultiplied(o.tones.ink),
    partner: premultiplied(o.tones.partner),
    paper: premultiplied(o.tones.paper),
  };
}

const positive = (v: number | undefined, fallback: number) => (v !== undefined && Number.isFinite(v) && v > 0 ? v : fallback);

// ─── 1. FieldDither (react-bits Dither) ──────────────────────────────────────────────────

/** react-bits Dither's defaults; only the finger's radius changed (1 is a hover, see shaders.ts). */
export const DITHER_WAVES = {
  waveSpeed: 0.05,
  waveFrequency: 3,
  waveAmplitude: 0.3,
  octaves: 4,
  /** Points per wave unit. react-bits: the canvas height; 280 pt is a phone's hero band. */
  ref: 280,
  /** react-bits `mouseRadius 1`, in height units. */
  touchRadius: 0.35,
  /** The hole eases in and out over these (`T.micro`, `T.std`). */
  touchInMs: 180,
  touchOutMs: 240,
} as const;

/** Whole octaves from 1 up to a program's loop bound. */
export function clampOctaves(v: number | undefined, fallback: number, max: number): number {
  return v === undefined || !Number.isFinite(v) ? fallback : Math.min(max, Math.max(1, Math.round(v)));
}

export function ditherWavesUniforms(o: { scale?: number; octaves?: number; touchRadius?: number } = {}) {
  return {
    waveSpeed: DITHER_WAVES.waveSpeed,
    waveFrequency: DITHER_WAVES.waveFrequency,
    waveAmplitude: DITHER_WAVES.waveAmplitude,
    octaves: clampOctaves(o.octaves, DITHER_WAVES.octaves, 4),
    ref: DITHER_WAVES.ref,
    zoom: positive(o.scale, 1),
    touch: [0, 0, 0] as Vec,
    touchRadius: positive(o.touchRadius, DITHER_WAVES.touchRadius),
  };
}

// ─── 2. PixelBlast ───────────────────────────────────────────────────────────────────────

/** react-bits PixelBlast's defaults and the phone's cuts. */
export const PIXEL_BLAST = {
  patternScale: 2,
  /**
   * react-bits `patternDensity 1`, kept. MEASURED (`__tests__/bitsBackgrounds.test.ts`, 30 frames
   * of a 390 x 220 band with the 0.5 edge fade): 1 lights about 11% of the cells, 1.5 about 22%,
   * and DESIGN-V2's own numbers, 0.35 for hello and 0.25 for the Now empty state, about 3% (a
   * median of 1 to 2%, often none). Those were written against react-bits' look, where a faded
   * edge keeps its cells at partial alpha; here the fade thins the cells instead (a hue at partial
   * opacity is the brown frame), so the same number draws less. An empty state that must be seen
   * wants 1 or more.
   */
  density: 1,
  octaves: 5,
  /** Cells per noise block: react-bits evaluates its noise once per 8 x pixelSize. */
  block: 8,
  /**
   * Points per noise unit. react-bits: the canvas height, which on a portrait phone is under one
   * noise cell across; 300 pt keeps the web demo's clouds, several to a screen.
   */
  ref: 300,
  edgeFade: 0.5,
  rippleSpeed: 0.3,
  rippleThickness: 0.1,
  rippleIntensity: 1,
  /** A ripple's age runs on react-bits' `speed 0.5` clock, not the ambient one: a tap is immediate. */
  rippleRate: 0.5,
  /** react-bits keeps 10 ripples; 4 is DESIGN-V2 3.3's cut. */
  maxTaps: 4,
} as const;

/** Under half a Bayer step a field value is paper (the prelude's `tone`, `twins.TONE_DEAD_ZONE`). */
export const DEAD_ZONE = 1 / 128;

/**
 * How long a ripple can still switch a cell on, in real seconds: its `exp(-age)` bounds it, and
 * falls under DEAD_ZONE at age ln 128 on the ripple clock (about 9.7 s; its crest is gone in 3).
 */
export const RIPPLE_LIFE_S = Math.log(1 / DEAD_ZONE) / PIXEL_BLAST.rippleRate;

export const NO_TAP: Vec = [0, 0, 0, 0];

export function pixelBlastUniforms(
  o: { scale?: number; density?: number; block?: number; octaves?: number; rippleIntensity?: number } = {},
) {
  return {
    patternScale: PIXEL_BLAST.patternScale,
    density: o.density ?? PIXEL_BLAST.density,
    octaves: clampOctaves(o.octaves, PIXEL_BLAST.octaves, 5),
    block: Math.max(1, Math.round(o.block ?? PIXEL_BLAST.block)),
    ref: PIXEL_BLAST.ref,
    zoom: positive(o.scale, 1),
    now: 0,
    tap0: NO_TAP,
    tap1: NO_TAP,
    tap2: NO_TAP,
    tap3: NO_TAP,
    rippleSpeed: PIXEL_BLAST.rippleSpeed,
    rippleThickness: PIXEL_BLAST.rippleThickness,
    rippleIntensity: o.rippleIntensity ?? PIXEL_BLAST.rippleIntensity,
    rippleRate: PIXEL_BLAST.rippleRate,
  };
}

/**
 * A ring buffer of four taps (x, y, start, live), oldest overwritten: returns the new buffer and
 * the next slot. Pure, and a worklet, so a Gesture Handler callback can call it on the UI thread.
 */
export function pushTap(
  taps: readonly Vec[],
  next: number,
  x: number,
  y: number,
  start: number,
  strength: number = 1,
): { taps: Vec[]; next: number } {
  'worklet';
  const n = taps.length > 0 ? taps.length : 4;
  const slot = ((Math.floor(next) % n) + n) % n;
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) out.push(i === slot ? [x, y, start, strength] : (taps[i] ?? NO_TAP));
  return { taps: out, next: (slot + 1) % n };
}

// ─── 3. Silk ─────────────────────────────────────────────────────────────────────────────

/** react-bits Silk's defaults (`speed 5` is inside the shader, `color` is the hue). */
export const SILK = {
  rotation: 0,
  noiseIntensity: 1.5,
  /**
   * Not a react-bits prop: the folds' scalar is multiplied by this before the dither. react-bits
   * tints `#7B7481`, a grey at 48% luminance, so its cloth is mostly shadow with light on the
   * crests; the same scalar in a spectrum ink is mostly solid ink. 0.75 keeps it mostly partner
   * with ink on the crests.
   */
  brightness: 0.75,
  /** Points per silk unit. react-bits: the canvas, stretched; 390 pt is a phone's width. */
  ref: 390,
} as const;

export function silkUniforms(o: { scale?: number; rotation?: number; noiseIntensity?: number; brightness?: number } = {}) {
  return {
    ref: SILK.ref,
    zoom: positive(o.scale, 1),
    rotation: o.rotation ?? SILK.rotation,
    noiseIntensity: o.noiseIntensity ?? SILK.noiseIntensity,
    brightness: o.brightness ?? SILK.brightness,
  };
}

// ─── 4. Grainient ────────────────────────────────────────────────────────────────────────

/**
 * react-bits Grainient's defaults, every one that acts on a scalar, and three a phone changed
 * (`GRAINIENT_WEB` keeps the originals). At the web's numbers a 390 pt box shows one wide ramp
 * from ink through partner to paper: the whole blend fits the box, the 1/50 sine warp moves its
 * edge about two cells, and a contrast of 1.5 leaves the ramp wide. Dithered or not, a wide ramp
 * is the gradient the brief bans. Closer in, warped harder and steeper, it prints as shapes.
 */
export const GRAINIENT = {
  /** react-bits 0.9: 0.6 shows more of the warped field in a small box. */
  zoom: 0.6,
  timeSpeed: 0.25,
  colorBalance: 0,
  /** react-bits 1: the warp's amplitude is `warpAmplitude / warpStrength`, so 2.5 moves it ~5 cells. */
  warpStrength: 2.5,
  warpFrequency: 5,
  warpSpeed: 2,
  warpAmplitude: 50,
  blendAngle: 0,
  blendSoftness: 0.05,
  rotationAmount: 500,
  noiseScale: 2,
  grainAmount: 0.1,
  /** react-bits 1.5: 2.5 turns the ramps into edges with a dithered rim. */
  contrast: 2.5,
} as const;

/** The react-bits numbers `GRAINIENT` changed. */
export const GRAINIENT_WEB = { zoom: 0.9, warpStrength: 1, contrast: 1.5 } as const;

export type GrainientTuning = { -readonly [K in keyof typeof GRAINIENT]?: number };

export function grainientUniforms(o: GrainientTuning & { scale?: number; centerX?: number; centerY?: number } = {}) {
  return {
    zoom: positive(o.zoom, GRAINIENT.zoom) * positive(o.scale, 1),
    timeSpeed: o.timeSpeed ?? GRAINIENT.timeSpeed,
    colorBalance: o.colorBalance ?? GRAINIENT.colorBalance,
    warpStrength: o.warpStrength ?? GRAINIENT.warpStrength,
    warpFrequency: o.warpFrequency ?? GRAINIENT.warpFrequency,
    warpSpeed: o.warpSpeed ?? GRAINIENT.warpSpeed,
    warpAmplitude: positive(o.warpAmplitude, GRAINIENT.warpAmplitude),
    blendAngle: o.blendAngle ?? GRAINIENT.blendAngle,
    blendSoftness: o.blendSoftness ?? GRAINIENT.blendSoftness,
    rotationAmount: o.rotationAmount ?? GRAINIENT.rotationAmount,
    noiseScale: o.noiseScale ?? GRAINIENT.noiseScale,
    grainAmount: o.grainAmount ?? GRAINIENT.grainAmount,
    contrast: o.contrast ?? GRAINIENT.contrast,
    center: [o.centerX ?? 0, o.centerY ?? 0] as Vec,
  };
}

// ─── 5. Radar ────────────────────────────────────────────────────────────────────────────

/** react-bits Radar's defaults, and the two a phone changed. */
export const RADAR = {
  ringCount: 10,
  spokeCount: 10,
  ringThickness: 0.05,
  spokeThickness: 0.01,
  sweepSpeed: 1,
  /**
   * react-bits 2: `pow(0.5 sin + 0.5, 2)` lights half the disc, which on a 390 pt box through the
   * dither is a blob with rings in it. At 5 the beam is about a quarter turn: a sweep.
   */
  sweepWidth: 5,
  sweepLobes: 1,
  falloff: 2,
  brightness: 1,
} as const;

export type RadarTuning = { -readonly [K in keyof typeof RADAR]?: number };

/**
 * react-bits fades its radar out at `(height / 2) / scale` from the centre with `scale 0.5`: the
 * whole shorter side, so the canvas shows a crop of the inner rings. On a phone the whole radar
 * should be seen, so it fades out this far into the shorter side: the outermost ring just past
 * the box's edge.
 */
export const RADAR_REACH = 0.75;

/** Where the radar sits and how far it reaches, points. `scale` multiplies the reach. */
export function radarGeometry(width: number, height: number, scale: number = 1, center?: FieldPoint | null) {
  return {
    center: [center?.x ?? width / 2, center?.y ?? height / 2] as Vec,
    reach: Math.max(1, Math.min(width, height) * RADAR_REACH * positive(scale, 1)),
  };
}

export function radarUniforms(o: RadarTuning & { width: number; height: number; scale?: number; center?: FieldPoint | null }) {
  const g = radarGeometry(o.width, o.height, o.scale, o.center);
  return {
    center: g.center,
    reach: g.reach,
    ringCount: positive(o.ringCount, RADAR.ringCount),
    spokeCount: positive(o.spokeCount, RADAR.spokeCount),
    ringThickness: positive(o.ringThickness, RADAR.ringThickness),
    spokeThickness: positive(o.spokeThickness, RADAR.spokeThickness),
    sweepSpeed: o.sweepSpeed ?? RADAR.sweepSpeed,
    sweepWidth: positive(o.sweepWidth, RADAR.sweepWidth),
    sweepLobes: positive(o.sweepLobes, RADAR.sweepLobes),
    falloff: o.falloff ?? RADAR.falloff,
    brightness: o.brightness ?? RADAR.brightness,
  };
}

// ─── 6. Topography ───────────────────────────────────────────────────────────────────────

export type TopographyMode = 'elevation' | 'uniform' | 'alternating';

/** react-bits Topography's defaults, and what a contour is on the cell grid. */
export const TOPOGRAPHY = {
  speed: 0.35,
  morphAmount: 3,
  morphSpeed: 0.05,
  /**
   * react-bits 2. Its contour tile spans the canvas, so on a 390 pt box the lines land 2 to 4
   * cells apart and a one cell line every three cells is a fill, not a map; 1 halves them.
   */
  bands: 1,
  /** A contour's width in cells (react-bits `thickness 0.01` is under one cell on a phone). */
  lineWidth: 1,
  /** react-bits `glow 0.5`: the halo reaches half this of a band past the line. 0 is none. */
  glow: 0.5,
  /** react-bits `contrast 3`: the halo's coverage is raised to it, so it stays faint. */
  contrast: 3,
  /**
   * react-bits `elevation` mixes three hues by height; here that picks partner or ink cell by
   * cell along a line, which speckles. `alternating` keeps each line whole: partner, ink, partner.
   */
  mode: 'alternating' as TopographyMode,
  /** react-bits `fillBands false`; a value is the density of partner cells at the highest ground. */
  fill: 0,
  touchRadius: 0.3,
  touchStrength: 0.4,
  /** The bump rises and falls over these (react-bits eases it 5% a frame, ~0.3 s at 60 Hz). */
  touchInMs: 300,
  touchOutMs: 300,
} as const;

/** react-bits `CTRL_INDICES`: the four control groups' phase indices. */
export const TOPOGRAPHY_CTRL_INDICES = [
  [1, -2, 3, -4],
  [9, -8, 7, -6],
  [5, 2, 5, -5],
  [-1, -3, 8, 9],
] as const;

export const TOPOGRAPHY_MODE: Readonly<Record<TopographyMode, number>> = { elevation: 0, uniform: 1, alternating: 2 };

/**
 * The four control groups at `time` seconds, react-bits' loop exactly:
 * `morphAmount * sin(time * speed * sin(i * morphSpeed) + i)` for each index `i`.
 */
export function topographyCtrl(
  time: number,
  speed: number = TOPOGRAPHY.speed,
  morphAmount: number = TOPOGRAPHY.morphAmount,
  morphSpeed: number = TOPOGRAPHY.morphSpeed,
): [number[], number[], number[], number[]] {
  'worklet';
  const g = (row: readonly number[]) => {
    const out: number[] = [];
    for (let j = 0; j < 4; j++) {
      const i = row[j]!;
      out.push(morphAmount * Math.sin(time * speed * Math.sin(i * morphSpeed) + i));
    }
    return out;
  };
  return [g(TOPOGRAPHY_CTRL_INDICES[0]), g(TOPOGRAPHY_CTRL_INDICES[1]), g(TOPOGRAPHY_CTRL_INDICES[2]), g(TOPOGRAPHY_CTRL_INDICES[3])];
}

export function topographyUniforms(
  o: {
    scale?: number;
    bands?: number;
    lineWidth?: number;
    glow?: number;
    contrast?: number;
    mode?: TopographyMode;
    fill?: number;
    morphAmount?: number;
    touchRadius?: number;
    touchStrength?: number;
    time?: number;
    speed?: number;
    morphSpeed?: number;
  } = {},
) {
  const morph = o.morphAmount ?? TOPOGRAPHY.morphAmount;
  const [ctrlA, ctrlB, ctrlC, ctrlD] = topographyCtrl(o.time ?? 0, o.speed ?? TOPOGRAPHY.speed, morph, o.morphSpeed ?? TOPOGRAPHY.morphSpeed);
  return {
    zoom: positive(o.scale, 1),
    ctrlA: ctrlA as Vec,
    ctrlB: ctrlB as Vec,
    ctrlC: ctrlC as Vec,
    ctrlD: ctrlD as Vec,
    bands: positive(o.bands, TOPOGRAPHY.bands),
    lineWidth: positive(o.lineWidth, TOPOGRAPHY.lineWidth),
    glow: Math.max(0, o.glow ?? TOPOGRAPHY.glow),
    contrast: positive(o.contrast, TOPOGRAPHY.contrast),
    mode: TOPOGRAPHY_MODE[o.mode ?? TOPOGRAPHY.mode],
    fill: Math.min(1, Math.max(0, o.fill ?? TOPOGRAPHY.fill)),
    morph,
    touch: [0, 0, 0] as Vec,
    touchRadius: positive(o.touchRadius, TOPOGRAPHY.touchRadius),
    touchStrength: o.touchStrength ?? TOPOGRAPHY.touchStrength,
  };
}

// ─── 7. DotGrid ──────────────────────────────────────────────────────────────────────────

/**
 * react-bits DotGrid's numbers, on a phone and on the cell grid. The web original is 16 px dots
 * every 48 px, `proximity 150`, `shockRadius 250`, `shockStrength 5`, `resistance 750`,
 * `returnDuration 1.5`, `speedTrigger 100`.
 */
export const DOT_GRID = {
  /** Cells from one dot to the next: a 3 pt dot every 12 pt (react-bits 1:3, calmer here). */
  pitch: 4,
  /** A dot's side in cells. */
  dot: 1,
  /** Points around the finger where dots light (react-bits 150 px). */
  proximity: 90,
  /** Points a tap's shock reaches (react-bits 250 px). */
  reach: 150,
  /**
   * The farthest a dot moves, in cells. react-bits' inertia carries a dot ~65 px at 250 px out;
   * each cell here checks only its nine nearest dots, so a push stays under 1.5 pitches.
   */
  push: 3,
  /** The inertia's rise (GSAP inertia at `resistance 750` stops in about this). */
  rise: 0.3,
  /** react-bits `returnDuration 1.5` on `elastic.out(1, 0.75)`. */
  settle: 1.5,
  /** A drag faster than this (points a second; react-bits 100 px/s) shoves the dots it passes. */
  speedTrigger: 100,
  /** A drag shoves at most this often (react-bits throttles its move handler to 50 ms). */
  dragEveryS: 0.12,
  /** A drag's shove is this fraction of a tap's. */
  dragStrength: 0.45,
  /** The glow around the finger rises and falls over these. */
  touchInMs: 120,
  touchOutMs: 240,
} as const;

/** GSAP `elastic.out(amplitude, period)`: 0 at 0, 1 at 1, overshooting around 1 between. */
export function elasticOut(p: number, amplitude: number = 1, period: number = 0.75): number {
  'worklet';
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const a = Math.max(1, amplitude);
  const s = (period / (2 * Math.PI)) * Math.asin(1 / a);
  return a * Math.pow(2, -10 * p) * Math.sin(((p - s) * 2 * Math.PI) / period) + 1;
}

/**
 * How far out a dot is, 0..1, `age` seconds after a shock: the inertia's quadratic rise over
 * `rise`, then `1 - elastic.out(1, 0.75)` back to rest over `settle`, then 0. The shader's
 * `envelope`, line for line.
 */
export function dotEnvelope(age: number, rise: number = DOT_GRID.rise, settle: number = DOT_GRID.settle): number {
  'worklet';
  if (age < 0) return 0;
  if (age < rise) {
    const k = 1 - age / rise;
    return 1 - k * k;
  }
  const q = (age - rise) / settle;
  if (q >= 1) return 0;
  return 1 - elasticOut(q);
}

/** A dot grid centred in the box: dots across and down and the top left dot's cell. */
export function dotGridLayout(width: number, height: number, cell: number, pitch: number = DOT_GRID.pitch, dot: number = DOT_GRID.dot) {
  const cx = Math.max(1, Math.floor(width / cell));
  const cy = Math.max(1, Math.floor(height / cell));
  const p = Math.max(1, Math.round(pitch));
  const d = Math.max(1, Math.min(p, Math.round(dot)));
  const cols = cx >= d ? Math.floor((cx - d) / p) + 1 : 0;
  const rows = cy >= d ? Math.floor((cy - d) / p) + 1 : 0;
  const usedX = cols > 0 ? (cols - 1) * p + d : 0;
  const usedY = rows > 0 ? (rows - 1) * p + d : 0;
  return { cols, rows, pitch: p, dot: d, origin: [Math.floor((cx - usedX) / 2), Math.floor((cy - usedY) / 2)] as Vec };
}

export function dotGridUniforms(o: {
  width: number;
  height: number;
  cell: number;
  base: string;
  pitch?: number;
  dot?: number;
  proximity?: number;
  reach?: number;
  push?: number;
}) {
  const g = dotGridLayout(o.width, o.height, o.cell, o.pitch, o.dot);
  return {
    pitch: g.pitch,
    dotCells: g.dot,
    origin: g.origin,
    grid: [g.cols, g.rows] as Vec,
    base: premultiplied(o.base),
    now: 0,
    shock0: NO_TAP,
    shock1: NO_TAP,
    shock2: NO_TAP,
    shock3: NO_TAP,
    touch: [0, 0, 0] as Vec,
    proximity: positive(o.proximity, DOT_GRID.proximity),
    reach: positive(o.reach, DOT_GRID.reach),
    push: Math.min(Math.max(0, o.push ?? DOT_GRID.push), g.pitch * 1.49),
    rise: DOT_GRID.rise,
    settle: DOT_GRID.settle,
  };
}

// ─── one frame's uniforms ────────────────────────────────────────────────────────────────

const ZERO3: Vec = [0, 0, 0];

/** What moves between frames; each program reads the ones it declares. */
export interface FrameInputs {
  /** Field seconds (`clock.t`). */
  t: number;
  /** Running seconds (`clock.now`): ripples and shocks age by it. */
  now: number;
  /** The develop, 0..1. */
  reveal: number;
  /** A finger's pool: x, y in points, strength 0..1. */
  touch?: Vec;
  /** PixelBlast's ripples or DotGrid's shocks: four slots of x, y, start, strength. */
  taps?: readonly Vec[];
  /** Topography's react-bits `morphSpeed`. */
  morphSpeed?: number;
}

/**
 * Every uniform `name` declares for one frame: `fixed` (the shared uniforms and the component's
 * own, spread once when a prop changes) plus what moves. Each component's derived value is this
 * call and nothing else, so the test that feeds it through CanvasKit holds exactly what the
 * phone sends. A worklet: it runs on the UI thread, 20 times a second.
 */
export function frameUniforms(name: BackgroundName, fixed: Readonly<Record<string, number | Vec>>, f: FrameInputs): Record<string, number | Vec> {
  'worklet';
  const taps = f.taps ?? [];
  switch (name) {
    case 'FieldDither':
      return { ...fixed, t: f.t, reveal: f.reveal, touch: f.touch ?? ZERO3 };
    case 'PixelBlast':
      return {
        ...fixed,
        t: f.t,
        now: f.now,
        reveal: f.reveal,
        tap0: taps[0] ?? NO_TAP,
        tap1: taps[1] ?? NO_TAP,
        tap2: taps[2] ?? NO_TAP,
        tap3: taps[3] ?? NO_TAP,
      };
    case 'Topography': {
      const morph = typeof fixed.morph === 'number' ? fixed.morph : TOPOGRAPHY.morphAmount;
      const [ctrlA, ctrlB, ctrlC, ctrlD] = topographyCtrl(f.t, TOPOGRAPHY.speed, morph, f.morphSpeed ?? TOPOGRAPHY.morphSpeed);
      return { ...fixed, t: f.t, reveal: f.reveal, ctrlA, ctrlB, ctrlC, ctrlD, touch: f.touch ?? ZERO3 };
    }
    case 'DotGrid':
      return {
        ...fixed,
        t: f.t,
        now: f.now,
        reveal: f.reveal,
        shock0: taps[0] ?? NO_TAP,
        shock1: taps[1] ?? NO_TAP,
        shock2: taps[2] ?? NO_TAP,
        shock3: taps[3] ?? NO_TAP,
        touch: f.touch ?? ZERO3,
      };
    default:
      return { ...fixed, t: f.t, reveal: f.reveal };
  }
}
