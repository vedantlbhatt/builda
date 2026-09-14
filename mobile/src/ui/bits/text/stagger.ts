/**
 * When each unit of a text effect starts: the stagger order (react-bits RotatingText's
 * `staggerFrom`), and the stagger squeezed so the whole effect lands inside rule 7's 1.2 s.
 * Pure, so `bun test` can hold it.
 *
 * Ported from react-bits `TextAnimations/RotatingText/RotatingText.tsx` (`getStaggerDelay`)
 * and `TextAnimations/SplitText/SplitText.tsx` (GSAP's `stagger`) by David Haz. react-bits is
 * MIT + Commons Clause (Copyright (c) 2026 David Haz): the notice is kept here as the licence
 * asks, and the port is used as part of this application only; it is not to be redistributed
 * as a component.
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
 * What changed in the port: `random` picks ONE pivot for the whole text (react-bits drew a new
 * pivot per character, which scatters the order into noise), from a source that can be seeded;
 * and the stagger never lets the last unit finish after the budget.
 */
import { TEXT_EFFECT_DONE_MS } from './spec';

export type StaggerFrom = 'first' | 'last' | 'center' | 'random' | number;

/**
 * Each unit's place in the stagger: its delay is `rank * staggerMs`. react-bits' rule:
 * `first` counts from the start, `last` from the end, `center` outward from the middle, a
 * number outward from that index, `random` outward from a random one.
 */
export function staggerRanks(n: number, from: StaggerFrom = 'first', rng: () => number = Math.random): number[] {
  const count = Math.max(0, Math.floor(n));
  const out: number[] = [];
  let pivot = 0;
  if (from === 'center') pivot = Math.floor(count / 2);
  else if (from === 'random') pivot = Math.min(count - 1, Math.floor(rng() * count));
  else if (typeof from === 'number') pivot = from;
  for (let i = 0; i < count; i++) {
    if (from === 'first') out.push(i);
    else if (from === 'last') out.push(count - 1 - i);
    else out.push(Math.abs(pivot - i));
  }
  return out;
}

/**
 * The stagger to use: `staggerMs`, or less when the last unit would otherwise finish after
 * `budgetMs` (the last unit starts at `maxRank * stagger` and runs `unitMs`). Never negative;
 * zero when one unit alone fills the budget.
 */
export function fitStagger(
  maxRank: number,
  unitMs: number,
  staggerMs: number,
  budgetMs: number = TEXT_EFFECT_DONE_MS,
): number {
  if (maxRank <= 0) return Math.max(0, staggerMs);
  const room = (budgetMs - unitMs) / maxRank;
  return Math.max(0, Math.min(staggerMs, room));
}

/** How long a staggered effect runs: the last unit's start plus its own length. */
export function staggeredTotal(ranks: readonly number[], staggerMs: number, unitMs: number): number {
  if (ranks.length === 0) return 0;
  let max = 0;
  for (const r of ranks) if (r > max) max = r;
  return max * staggerMs + unitMs;
}

export interface UnitWindow {
  start: number;
  duration: number;
}

/** Every unit's start and length on one clock, with the stagger already fitted. */
export function unitWindows(
  n: number,
  options: {
    unitMs: number;
    staggerMs: number;
    from?: StaggerFrom;
    budgetMs?: number;
    rng?: () => number;
  },
): { windows: UnitWindow[]; staggerMs: number; totalMs: number } {
  const ranks = staggerRanks(n, options.from ?? 'first', options.rng);
  let maxRank = 0;
  for (const r of ranks) if (r > maxRank) maxRank = r;
  const stagger = fitStagger(maxRank, options.unitMs, options.staggerMs, options.budgetMs);
  const windows = ranks.map((r) => ({ start: r * stagger, duration: options.unitMs }));
  return { windows, staggerMs: stagger, totalMs: staggeredTotal(ranks, stagger, options.unitMs) };
}
