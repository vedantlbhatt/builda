/**
 * RotatingText's bookkeeping: which text comes next (react-bits' `next`, `previous`, `jumpTo`,
 * `reset`), how a text splits into the elements that move, and when each element moves in and
 * out. Pure, so `bun test` can hold it.
 *
 * Ported from react-bits `TextAnimations/RotatingText/RotatingText.tsx` by David Haz.
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
 * What changed in the port: `loop` defaults to false, so the rotation stops on the last text
 * (rule 6: nothing moves while a sentence is being read, so a rotation says its list once);
 * `wait` mode's timing is computed here instead of by AnimatePresence.
 */
import { graphemes } from './segment';
import { staggerRanks, type StaggerFrom } from './stagger';

/** react-bits' `next`: the following index, wrapping only with `loop`. */
export function nextIndex(current: number, length: number, loop: boolean): number {
  if (length <= 0) return 0;
  if (current >= length - 1) return loop ? 0 : current;
  return current + 1;
}

/** react-bits' `previous`. */
export function previousIndex(current: number, length: number, loop: boolean): number {
  if (length <= 0) return 0;
  if (current <= 0) return loop ? length - 1 : current;
  return current - 1;
}

/** react-bits' `jumpTo`: clamped into the list. */
export function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(Math.floor(index), length - 1));
}

export type RotateSplit = 'characters' | 'words' | 'lines' | (string & {});

export interface RotateWord {
  /** The elements that move, in order. */
  characters: string[];
  /** A space after this word (never animated). */
  needsSpace: boolean;
}

/** react-bits' `elements`: characters by word, whole words, whole lines, or any separator. */
export function rotateElements(text: string, splitBy: RotateSplit = 'characters'): RotateWord[] {
  if (splitBy === 'characters') {
    const words = text.split(' ');
    return words.map((w, i) => ({ characters: graphemes(w), needsSpace: i !== words.length - 1 }));
  }
  const sep = splitBy === 'words' ? ' ' : splitBy === 'lines' ? '\n' : splitBy;
  const parts = text.split(sep);
  return parts.map((p, i) => ({ characters: [p], needsSpace: i !== parts.length - 1 }));
}

export function elementCount(words: readonly RotateWord[]): number {
  let n = 0;
  for (const w of words) n += w.characters.length;
  return n;
}

/**
 * Each element's delay, in reading order across the words: react-bits'
 * `getStaggerDelay(previousCharsCount + charIndex, total)`.
 */
export function rotateDelays(words: readonly RotateWord[], staggerMs: number, from: StaggerFrom = 'first', rng?: () => number): number[] {
  return staggerRanks(elementCount(words), from, rng).map((r) => r * staggerMs);
}

/**
 * A rotation's timing. `wait` (react-bits' default): the incoming text starts once the outgoing
 * one has left; `sync`: both at once. `lastDelayMs` is the latest element's stagger delay.
 * Returns when the incoming starts, when the outgoing is gone and when all is done.
 */
export function rotationTiming(
  outgoing: { lastDelayMs: number; exitMs: number } | null,
  incoming: { lastDelayMs: number; enterMs: number },
  mode: 'wait' | 'sync' = 'wait',
): { enterAt: number; exitDone: number; done: number } {
  const exitDone = outgoing ? Math.max(0, outgoing.lastDelayMs) + outgoing.exitMs : 0;
  const enterAt = mode === 'wait' ? exitDone : 0;
  const done = Math.max(exitDone, enterAt + Math.max(0, incoming.lastDelayMs) + incoming.enterMs);
  return { enterAt, exitDone, done };
}
