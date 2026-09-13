/**
 * SplitFlapText's plans: which tiles flip, through which characters, starting when, and what a
 * tile shows at any moment. Pure, so `bun test` can hold react-bits' timing exactly.
 *
 * Ported from react-bits `TextAnimations/SplitFlapText/SplitFlapText.tsx` by David Haz.
 * react-bits is MIT + Commons Clause (Copyright (c) 2026 David Haz): the notice is kept here as
 * the licence asks, and the port is used as part of this application only; it is not to be
 * redistributed as a component.
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
 * What the port keeps: phrases padded to one width, only the tiles whose character changes
 * flip, each through `flipsPerChar` random characters and then its target, tile `i` starting
 * `i * stagger` in, a step every `flipDuration`. What it changes: 6 flips (the doc, from 8), an
 * `auto` charset that flips a digit through digits and a lower case letter through lower case
 * (the ETA phrase is lower case; react-bits' alphanumeric is upper case), a seedable random
 * source, characters as graphemes, and a fit that squeezes the stagger, then the flips, so a
 * long phrase still lands inside rule 7.
 */
import { graphemes } from './segment';

export const FLAP_CHARSETS = {
  alpha: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  alphanumeric: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  numeric: '0123456789',
  lower: 'abcdefghijklmnopqrstuvwxyz',
} as const;

export type FlapCharset = keyof typeof FLAP_CHARSETS | 'auto' | (string & {});

/** The characters a tile flips through on its way to `target`. */
export function flapCharsetFor(charset: FlapCharset, target: string): string {
  if (charset === 'auto') {
    if (/^[0-9]$/.test(target)) return FLAP_CHARSETS.numeric;
    if (/^[A-Z]$/.test(target)) return FLAP_CHARSETS.alpha;
    return FLAP_CHARSETS.lower;
  }
  if (Object.prototype.hasOwnProperty.call(FLAP_CHARSETS, charset)) {
    return FLAP_CHARSETS[charset as keyof typeof FLAP_CHARSETS];
  }
  return charset.length > 0 ? charset : FLAP_CHARSETS.alphanumeric;
}

/** react-bits' `normalizePhrase`: padded with spaces to `width` characters, or cut to it. */
export function padPhrase(phrase: string, width: number): string[] {
  const g = graphemes(String(phrase ?? '')).slice(0, Math.max(0, width));
  while (g.length < width) g.push(' ');
  return g;
}

/** The board's width: the longest phrase, at least `padTo`, at least one tile. */
export function flapWidth(phrases: readonly string[], padTo: number = 0): number {
  let longest = 1;
  for (const p of phrases) longest = Math.max(longest, graphemes(p).length);
  return Math.max(1, Math.ceil(Number(padTo) || 0), longest);
}

export interface FlapPlan {
  index: number;
  from: string;
  target: string;
  /** The characters shown one after another; the last is the target. */
  sequence: string[];
  /** Milliseconds after the change when this tile starts. */
  start: number;
}

export interface FlapOptions {
  flips: number;
  staggerMs: number;
  charset?: FlapCharset;
  rng?: () => number;
}

/** Only the tiles that change flip, like react-bits; a tile starts at `index * staggerMs`. */
export function flapPlans(from: readonly string[], to: readonly string[], options: FlapOptions): FlapPlan[] {
  const rng = options.rng ?? Math.random;
  const flips = Math.max(0, Math.floor(options.flips));
  const plans: FlapPlan[] = [];
  const width = Math.max(from.length, to.length);
  for (let i = 0; i < width; i++) {
    const a = from[i] ?? ' ';
    const b = to[i] ?? ' ';
    if (a === b) continue;
    const set = Array.from(flapCharsetFor(options.charset ?? 'auto', b));
    const sequence: string[] = [];
    for (let k = 0; k < flips; k++) sequence.push(set[Math.floor(rng() * set.length)] ?? ' ');
    sequence.push(b);
    plans.push({ index: i, from: a, target: b, sequence, start: i * Math.max(0, options.staggerMs) });
  }
  return plans;
}

/** When the last tile lands. */
export function flapTotalMs(plans: readonly FlapPlan[], flipMs: number): number {
  let end = 0;
  for (const p of plans) end = Math.max(end, p.start + p.sequence.length * flipMs);
  return end;
}

/**
 * The stagger and flips that land a change whose last flipping tile is `lastIndex` within
 * `budgetMs`: fewer flips only if one tile's run alone is too long, then a tighter stagger.
 */
export function fitFlap(
  lastIndex: number,
  options: { flipMs: number; staggerMs: number; flips: number },
  budgetMs: number,
): { staggerMs: number; flips: number } {
  const run = (f: number) => (f + 1) * options.flipMs;
  let flips = Math.max(0, Math.floor(options.flips));
  while (flips > 0 && run(flips) > budgetMs) flips -= 1;
  const room = budgetMs - run(flips);
  const staggerMs = lastIndex > 0 ? Math.max(0, Math.min(options.staggerMs, room / lastIndex)) : options.staggerMs;
  return { staggerMs, flips };
}

export interface FlapTileState {
  /** Showing, and on the falling front flap. */
  current: string;
  /** Arriving, on the rising back flap and behind the front one. */
  next: string;
  flipping: boolean;
  /** Which flip is under way: -1 before the tile starts, `sequence.length` once it has landed. */
  step: number;
}

/** What a tile shows `elapsed` ms after the change (react-bits' `tick`). */
export function flapStateAt(plan: FlapPlan, elapsed: number, flipMs: number): FlapTileState {
  const local = elapsed - plan.start;
  if (local < 0) return { current: plan.from, next: plan.from, flipping: false, step: -1 };
  const step = Math.floor(local / Math.max(1, flipMs));
  if (step < plan.sequence.length) {
    return {
      current: step === 0 ? plan.from : (plan.sequence[step - 1] ?? plan.from),
      next: plan.sequence[step] ?? plan.target,
      flipping: true,
      step,
    };
  }
  return { current: plan.target, next: plan.target, flipping: false, step: plan.sequence.length };
}
