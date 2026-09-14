/**
 * Shuffle's strips and schedule: for each character, the column of copies that slides past
 * before the real one lands, and when each character's slide starts. Pure, so `bun test` can
 * hold react-bits' order exactly.
 *
 * Ported from react-bits `TextAnimations/Shuffle/Shuffle.tsx` by David Haz. react-bits is MIT
 * + Commons Clause (Copyright (c) 2026 David Haz): the notice is kept here as the licence asks,
 * and the port is used as part of this application only; it is not to be redistributed as a
 * component.
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
 * What the port keeps: a strip of the original, `shuffleTimes` copies and the real character;
 * `right` and `down` start on the original at the far end and slide to the real one at the
 * near end, `left` and `up` the other way; `evenodd` sends the odd characters first and the even
 * ones at 70% of the odd run, each group staggered; `random` delays each by up to `maxDelay`.
 * What it changes: three copies (the doc), drawn from the word's OWN letters when no charset is
 * given (react-bits repeats the same letter, which reads as a slide rather than a shuffle), a
 * seedable random source, and a stagger that fits rule 7.
 */
import { graphemes, isBlank } from './segment';
import { TEXT_EFFECT_DONE_MS } from './spec';

export type ShuffleDirection = 'left' | 'right' | 'up' | 'down';
export type ShuffleMode = 'evenodd' | 'random';

/** The characters a copy may be drawn from when no charset is given: the text's own. */
export function shuffleCharset(text: string): string {
  const seen = new Set<string>();
  for (const g of graphemes(text)) if (!isBlank(g)) seen.add(g);
  return Array.from(seen).join('');
}

export interface ShuffleStrip {
  /** The strip's cells in layout order: left to right, or top to bottom. */
  cells: string[];
  /** The strip's offset at the start and at the end, in cells (negative is left or up). */
  from: number;
  to: number;
}

/**
 * One character's strip. The first and last cells are the character itself (react-bits' clone
 * and the original), the `rolls` between are drawn from `charset` (the character again when it
 * is empty), and the strip slides a whole `rolls + 1` cells.
 */
export function shuffleStrip(
  ch: string,
  rolls: number,
  charset: string,
  rng: () => number,
  direction: ShuffleDirection,
): ShuffleStrip {
  const set = graphemes(charset);
  const n = Math.max(1, Math.floor(rolls));
  const middle: string[] = [];
  for (let k = 0; k < n; k++) middle.push(set.length ? (set[Math.floor(rng() * set.length)] ?? ch) : ch);
  const cells = [ch, ...middle, ch];
  const steps = n + 1;
  return direction === 'right' || direction === 'down' ? { cells, from: -steps, to: 0 } : { cells, from: 0, to: -steps };
}

export interface ShuffleTiming {
  delay: number;
  duration: number;
}

/**
 * When each of `n` characters slides. `evenodd` (react-bits' default): odd indices from 0,
 * `staggerMs` apart; even indices from `evenStart` (0.7) of the odd group's run, `staggerMs`
 * apart. `random`: each after a random share of `maxDelayMs`.
 */
export function shuffleSchedule(
  n: number,
  options: {
    mode?: ShuffleMode;
    durationMs: number;
    staggerMs: number;
    evenStart?: number;
    maxDelayMs?: number;
    rng?: () => number;
  },
): ShuffleTiming[] {
  const count = Math.max(0, Math.floor(n));
  const out: ShuffleTiming[] = [];
  const d = options.durationMs;
  if ((options.mode ?? 'evenodd') === 'random') {
    const rng = options.rng ?? Math.random;
    for (let i = 0; i < count; i++) out.push({ delay: rng() * (options.maxDelayMs ?? 0), duration: d });
    return out;
  }
  const odd = Math.floor(count / 2);
  const oddTotal = d + Math.max(0, odd - 1) * options.staggerMs;
  const evenStart = odd > 0 ? oddTotal * (options.evenStart ?? 0.7) : 0;
  for (let i = 0; i < count; i++) {
    const rank = Math.floor(i / 2);
    out.push({ delay: i % 2 === 1 ? rank * options.staggerMs : evenStart + rank * options.staggerMs, duration: d });
  }
  return out;
}

/** When the last character lands. */
export function shuffleTotalMs(schedule: readonly ShuffleTiming[]): number {
  let end = 0;
  for (const s of schedule) end = Math.max(end, s.delay + s.duration);
  return end;
}

/**
 * The `evenodd` stagger that lands `n` characters within `budgetMs`: the run is
 * `(1 + evenStart) * duration + stagger * (evenStart * (odd - 1) + (even - 1))`.
 */
export function fitShuffleStagger(
  n: number,
  durationMs: number,
  staggerMs: number,
  budgetMs: number = TEXT_EFFECT_DONE_MS,
  evenStart: number = 0.7,
): number {
  const count = Math.max(0, Math.floor(n));
  const odd = Math.floor(count / 2);
  const even = count - odd;
  const perStagger = (odd > 0 ? evenStart * Math.max(0, odd - 1) : 0) + Math.max(0, even - 1);
  if (perStagger <= 0) return staggerMs;
  const fixed = odd > 0 ? (1 + evenStart) * durationMs : durationMs;
  return Math.max(0, Math.min(staggerMs, (budgetMs - fixed) / perStagger));
}
