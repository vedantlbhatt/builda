/**
 * The rules of AnimatedList and Stepper, pure: which rows enter and when, how strong the
 * scroll edges are, and how full each step indicator is. No React Native import, so `bun test`
 * holds them.
 *
 * Ported from react-bits `Components/AnimatedList` and `Components/Stepper` by David Haz.
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
 * What changed in the port: react-bits AnimatedList re-animates every item each time it
 * scrolls back into view (`useInView` with `once: false`), which the skill forbids on recycled
 * rows; here a row enters once, on the first load, or when it is new and lands above every row
 * already shown. Stepper's indicators are kept (circle, active dot, drawn check, a connector
 * that fills); its content slide and its Back and Continue buttons are not, because on a phone
 * the native push moves the content (DESIGN-V2 4.3).
 */
import { STAGGER, STAGGER_CAP } from '../../motionSpec';
import { LIST } from './spec';

// ─── AnimatedList: who enters ───────────────────────────────────────────────────────────

export type EntranceKind = 'stagger' | 'insert' | 'none';

export interface Entrance {
  kind: EntranceKind;
  /** ms after mount. */
  delay: number;
}

/**
 * How each row of `next` enters, given the keys that were on screen before (`prev`, or null
 * until the first non empty list has been shown).
 *
 * - First load: every row staggers, 40ms apart, and from the eighth on they enter as a block.
 * - A key that was already there: nothing. A refresh with the same rows is not an entrance.
 * - A new key ABOVE every row already shown slides in at the top (40ms apart if several).
 * - A new key anywhere else (a page appended at the end, a row scrolled into view): nothing.
 */
export function planEntrances(prev: readonly string[] | null, next: readonly string[]): Map<string, Entrance> {
  const out = new Map<string, Entrance>();
  if (prev === null || prev.length === 0) {
    next.forEach((k, i) => out.set(k, { kind: 'stagger', delay: Math.min(i, STAGGER_CAP) * STAGGER }));
    return out;
  }
  const known = new Set(prev);
  let firstKnown = next.findIndex((k) => known.has(k));
  if (firstKnown < 0) firstKnown = next.length;
  let inserted = 0;
  next.forEach((k, i) => {
    if (known.has(k)) out.set(k, { kind: 'none', delay: 0 });
    else if (i < firstKnown) out.set(k, { kind: 'insert', delay: Math.min(inserted++, STAGGER_CAP) * STAGGER });
    else out.set(k, { kind: 'none', delay: 0 });
  });
  return out;
}

/**
 * A row mounting long after the first load (the list virtualises, so a far row mounts when it
 * is scrolled to) is not entering; it was always there.
 */
export function entranceAt(e: Entrance | undefined, msSinceLoad: number): Entrance {
  if (!e || e.kind === 'none') return { kind: 'none', delay: 0 };
  if (e.kind === 'stagger' && msSinceLoad > LIST.firstLoadWindowMs) return { kind: 'none', delay: 0 };
  return e;
}

// ─── AnimatedList: the edges ────────────────────────────────────────────────────────────

/**
 * react-bits' edge strengths, exactly: the top edge over the first 50pt of scroll, the bottom
 * over the last 50pt, and no bottom edge when everything fits.
 */
export function edgeStrengths(scrollY: number, contentHeight: number, viewportHeight: number, distance: number = LIST.fadeDistance) {
  'worklet';
  const top = Math.min(Math.max(scrollY, 0) / distance, 1);
  const bottomDistance = contentHeight - (scrollY + viewportHeight);
  const bottom = contentHeight <= viewportHeight ? 0 : Math.min(Math.max(bottomDistance, 0) / distance, 1);
  return { top, bottom };
}

// ─── Stepper ────────────────────────────────────────────────────────────────────────────

export type StepStatus = 'complete' | 'active' | 'upcoming';

/** react-bits `StepIndicator`: before the current step is complete, the current one active. */
export function stepStatus(index: number, current: number): StepStatus {
  if (index < current) return 'complete';
  if (index === current) return 'active';
  return 'upcoming';
}

/**
 * How full bar `index` is when the flow stands at `position` (in steps, 0 on the first; a
 * transition carries it between two whole numbers): the current step's bar and every bar
 * before it are full, and the next fills as the push lands.
 */
export function barFill(index: number, position: number): number {
  'worklet';
  const f = position - index + 1;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

/** The connector after step `index` fills as the flow moves past it (react-bits `StepConnector`). */
export function connectorFill(index: number, position: number): number {
  'worklet';
  const f = position - index;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

/** What VoiceOver reads: "Step 2 of 4". Never 0 based. */
export function stepLabel(current: number, steps: number): string {
  const n = Math.max(1, Math.floor(steps));
  const at = Math.min(n, Math.max(1, Math.floor(current) + 1));
  return `Step ${at} of ${n}`;
}

/** react-bits' check path (`M5 13l4 4L19 7`), on a 24 box, and its length for the draw. */
export const CHECK_PATH = 'M5 13l4 4L19 7';
export const CHECK_LENGTH = Math.hypot(4, 4) + Math.hypot(10, 10);
