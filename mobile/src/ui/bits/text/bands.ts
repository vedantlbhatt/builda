/**
 * The light on ShinyText and the tones on GradientText, as flat bands: the colours, where each
 * band sits at a given moment, and the pass and drift cycles. Pure, so `bun test` can hold it;
 * the position functions are worklets the UI thread calls per frame.
 *
 * Ported from react-bits `TextAnimations/ShinyText/ShinyText.tsx` and
 * `TextAnimations/GradientText/GradientText.tsx` by David Haz. react-bits is MIT + Commons
 * Clause (Copyright (c) 2026 David Haz): the notice is kept here as the licence asks, and the
 * port is used as part of this application only; it is not to be redistributed as a component.
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
 * What changed in the port: react-bits paints a smooth `linear-gradient` and clips it to the
 * glyphs (`background-clip: text`). Builda has no smooth ramps (DESIGN-V2 1.3: "light comes
 * from a stepped band"), so a ramp is quantised into flat steps, each step drawn as a copy of
 * the text inside a moving clip. The cycle arithmetic (pass, pause, yoyo) is react-bits', line
 * for line, on elapsed milliseconds.
 */

const HEX = /^#?([0-9a-f]{6})$/i;

export function parseHex(color: string): [number, number, number] {
  const m = HEX.exec(color);
  if (!m) throw new Error(`text bands mix #RRGGBB colours from the tokens, got ${color}`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex(rgb: readonly [number, number, number]): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0').toUpperCase();
  return `#${c(rgb[0])}${c(rgb[1])}${c(rgb[2])}`;
}

/**
 * `a` moved `t` of the way to `b`, in sRGB. An opaque colour, never a colour at partial opacity
 * over the ground (that is the brown DESIGN-V2 1.3 warns about).
 */
export function mixHex(a: string, b: string, t: number): string {
  const p = parseHex(a);
  const q = parseHex(b);
  const k = Math.min(1, Math.max(0, t));
  return toHex([p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k]);
}

// ─── ShinyText ────────────────────────────────────────────────────────────────────────

/**
 * The shine's steps, dimmest first: `steps` flat tones from one step above `base` up to
 * `shine`. react-bits ramps `color` to `shineColor` and back; three steps is the GlareHover
 * rule.
 */
export function shineTones(base: string, shine: string, steps: number = 3): string[] {
  const n = Math.max(1, Math.floor(steps));
  const out: string[] = [];
  for (let k = 1; k <= n; k++) out.push(mixHex(base, shine, k / n));
  return out;
}

/**
 * Each step's width in points, widest (dimmest) first. The widest is `spread` of the text,
 * react-bits' 35% to 65% of a 200% background, held between `minPt` and `maxPt` so a long line
 * gets a band and not a floodlight; the others step down evenly to the peak.
 */
export function shineBandWidths(
  width: number,
  options: { spread?: number; maxPt?: number; minPt?: number; steps?: number } = {},
): number[] {
  const steps = Math.max(1, Math.floor(options.steps ?? 3));
  const outer = Math.min(options.maxPt ?? 120, Math.max(options.minPt ?? 18, width * (options.spread ?? 0.6)));
  const out: number[] = [];
  for (let k = 0; k < steps; k++) out.push((outer * (steps - k)) / steps);
  return out;
}

/** How far a band leaning `skewDeg` off vertical reaches past its width, each side. */
export function skewReach(height: number, skewDeg: number): number {
  return Math.abs(Math.tan((skewDeg * Math.PI) / 180)) * (height / 2);
}

/**
 * The shine's centre at pass progress `p`: from fully off the start of the text to fully off
 * its end (react-bits runs 150% to -50% of the background, the same off to off pass).
 */
export function sweepCenter(p: number, width: number, reach: number): number {
  'worklet';
  return -reach + (width + 2 * reach) * p;
}

/**
 * react-bits ShinyText's clock, on elapsed ms: a pass of `sweepMs`, then a hold of `pauseMs`
 * with the shine off the end; `yoyo` runs the next pass back. Returns the pass progress, 0 at
 * the start edge and 1 at the far edge.
 */
export function shineCycle(elapsedMs: number, sweepMs: number, pauseMs: number, yoyo: boolean): number {
  'worklet';
  const pass = Math.max(1, sweepMs);
  const hold = Math.max(0, pauseMs);
  const cycle = pass + hold;
  if (yoyo) {
    const t = elapsedMs % (cycle * 2);
    if (t < pass) return t / pass;
    if (t < cycle) return 1;
    if (t < cycle + pass) return 1 - (t - cycle) / pass;
    return 0;
  }
  const t = elapsedMs % cycle;
  return t < pass ? t / pass : 1;
}

/** ShinyText's passes as a whole number, at least one, or Infinity. */
export function passCount(sweeps: number): number {
  return Number.isFinite(sweeps) ? Math.max(1, Math.floor(sweeps)) : Infinity;
}

/**
 * How long `passes` passes run: a finite run ends the moment its last pass leaves the text,
 * not after the pause that would follow it. Infinity for an endless run.
 */
export function shineRunMs(passes: number, sweepMs: number, pauseMs: number): number {
  const pass = Math.max(1, sweepMs);
  return Number.isFinite(passes) ? (Math.max(1, passes) - 1) * (pass + Math.max(0, pauseMs)) + pass : Infinity;
}

// ─── GradientText ─────────────────────────────────────────────────────────────────────

/**
 * One hue's tones for GradientText: a positive lift moves its ink toward `light` (the text
 * colour), a negative one toward `deep` (the hue's own partner, the dither's middle tone, so a
 * deeper band stays in the hue's family instead of going brown toward the ground). With no
 * `deep`, a negative lift is the ink itself. The default runs ink, light, ink, deep: one period
 * of light moving over the word, repeating seamlessly the way react-bits repeats its first
 * colour at the end.
 */
export function gradientTones(
  ink: string,
  light: string,
  lifts: readonly number[] = [0, 0.3, 0, -0.35],
  deep?: string,
): string[] {
  return lifts.map((l) => (l >= 0 ? mixHex(ink, light, l) : deep ? mixHex(ink, deep, -l) : ink));
}

export interface BandLayout {
  /** One band's width, in points. */
  band: number;
  /** One repeat of the colours, in points. */
  period: number;
  /** How many bands it takes to cover the text at every shift, reach included. */
  count: number;
  /** How far a leaning band reaches past its width, each side. */
  reach: number;
}

/**
 * The bands for a text `width` points wide: `bandFraction` of the width each, the colours
 * repeating every `period`, enough of them that the text is covered at every shift from 0 to
 * one period.
 */
export function gradientLayout(width: number, colors: number, bandFraction: number = 1 / 3, reach: number = 0): BandLayout {
  const band = Math.max(1, width * Math.min(1, Math.max(0.05, bandFraction)));
  const n = Math.max(1, Math.floor(colors));
  const period = band * n;
  const count = Math.ceil((width + 2 * reach + period) / band) + 1;
  return { band, period, count, reach };
}

/**
 * Band `k`'s left edge at `shift` (0 to one period). Band 0 starts one period and one reach
 * before the text, so a shift of a whole period lands on the same picture it started from.
 */
export function gradientBandX(k: number, shift: number, band: number, period: number, reach: number): number {
  'worklet';
  return k * band - period - reach + shift;
}

/**
 * react-bits GradientText's clock, on elapsed ms: `yoyo` runs 0 to 1 over `durationMs` and
 * back; otherwise 0 to 1 and round again. Returns a fraction of one period.
 */
export function gradientCycle(elapsedMs: number, durationMs: number, yoyo: boolean): number {
  'worklet';
  const d = Math.max(1, durationMs);
  if (yoyo) {
    const t = elapsedMs % (d * 2);
    return t < d ? t / d : 1 - (t - d) / d;
  }
  return (elapsedMs % d) / d;
}
