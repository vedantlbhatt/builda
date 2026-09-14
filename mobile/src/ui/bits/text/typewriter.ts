/**
 * TextType's schedule: every visible change of a typewriter (a character typed, a character
 * deleted) with the millisecond it happens, computed ahead of time, and the caret's blink.
 * Pure, so `bun test` can hold react-bits' timing exactly.
 *
 * Ported from react-bits `TextAnimations/TextType/TextType.tsx` by David Haz. react-bits is
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
 * What the port keeps: `initialDelay` before each sentence, a character every `typingSpeed`
 * (or a random speed between `variableSpeed.min` and `.max`), `pauseDuration` on a finished
 * sentence, a deletion every `deletingSpeed`, the next sentence, and `loop` deciding whether
 * the last sentence is deleted and the first comes back. What it changes: characters are
 * graphemes (react-bits typed UTF-16 units, which splits an accented letter or a flag), the
 * random source can be seeded, `reverseMode` is gone, and the caret blinks a set number of
 * times and hides (the doc: three) instead of blinking forever.
 */
import { graphemes } from './segment';

export interface TypeFrame {
  /** Milliseconds from play. */
  at: number;
  /** Which sentence. */
  index: number;
  /** How many of its characters show. */
  typed: number;
  /** Deleting (or about to): the caret stays solid, as it does while typing. */
  deleting: boolean;
}

export interface TypeOptions {
  typingMs: number;
  deletingMs: number;
  pauseMs: number;
  /** react-bits' `initialDelay`: before each sentence's first character. */
  startMs: number;
  loop: boolean;
  variableSpeed?: { min: number; max: number };
  rng?: () => number;
}

export interface TypePlan {
  frames: TypeFrame[];
  /**
   * With `loop`, the moment the last sentence is deleted and the first begins again (its frames
   * repeat shifted by this); null when the plan ends typed.
   */
  cycleMs: number | null;
}

/** One pass of react-bits' typewriter over `texts`, as frames in time order. */
export function typeFrames(texts: readonly string[], options: TypeOptions): TypePlan {
  const rng = options.rng ?? Math.random;
  const speed = () => {
    const v = options.variableSpeed;
    if (!v) return options.typingMs;
    return rng() * (v.max - v.min) + v.min;
  };
  const frames: TypeFrame[] = [{ at: 0, index: 0, typed: 0, deleting: false }];
  let t = 0;
  const n = texts.length;
  for (let i = 0; i < n; i++) {
    const len = graphemes(texts[i] ?? '').length;
    t += options.startMs;
    for (let c = 1; c <= len; c++) {
      t += speed();
      frames.push({ at: t, index: i, typed: c, deleting: false });
    }
    if (i === n - 1 && !options.loop) return { frames, cycleMs: null };
    t += options.pauseMs;
    frames.push({ at: t, index: i, typed: len, deleting: true });
    for (let c = len - 1; c >= 0; c--) {
      t += options.deletingMs;
      frames.push({ at: t, index: i, typed: c, deleting: true });
    }
  }
  return { frames, cycleMs: options.loop ? t : null };
}

/** The text a frame shows: its sentence's first `typed` characters. */
export function typedText(texts: readonly string[], frame: TypeFrame): string {
  return graphemes(texts[frame.index] ?? '').slice(0, frame.typed).join('');
}

/** The rest of the sentence, still to type: drawn transparent so lines break where they will. */
export function untypedText(texts: readonly string[], frame: TypeFrame): string {
  return graphemes(texts[frame.index] ?? '').slice(frame.typed).join('');
}

/**
 * The per character time that fits `length` characters, after `startMs`, inside `budgetMs`
 * (rule 7), never slower than `typingMs` asks for and never under 1 ms.
 */
export function fitTypingMs(length: number, typingMs: number, budgetMs: number, startMs: number = 0): number {
  if (length <= 0) return typingMs;
  return Math.max(1, Math.min(typingMs, (budgetMs - startMs) / length));
}

/**
 * Whether the caret shows, `ms` after the typing stopped: on for `blinkMs`, then `blinks`
 * times off and on again, then gone. `blinks` Infinity blinks for as long as it is asked.
 */
export function caretVisible(ms: number, blinkMs: number, blinks: number): boolean {
  if (ms < 0) return true;
  const beat = Math.max(1, blinkMs);
  if (Number.isFinite(blinks) && ms >= beat * (1 + 2 * Math.max(0, blinks))) return false;
  return Math.floor(ms / beat) % 2 === 0;
}

/** When the caret is gone for good, `ms` after the typing stopped; Infinity if it never goes. */
export function caretGoneAt(blinkMs: number, blinks: number): number {
  return Number.isFinite(blinks) ? Math.max(1, blinkMs) * (1 + 2 * Math.max(0, blinks)) : Infinity;
}
