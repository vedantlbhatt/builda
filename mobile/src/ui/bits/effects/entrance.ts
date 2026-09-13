/**
 * The plan of an entrance (AnimatedContent, FadeContent, Rise, Stagger), apart from the
 * component so `bun test` can hold the kit's timings: where the content starts, how long it
 * moves, how long its opacity takes, and when it starts.
 *
 * Ported from react-bits `Animations/AnimatedContent/AnimatedContent.tsx` and
 * `Animations/FadeContent/FadeContent.tsx` by David Haz.
 * react-bits is MIT + Commons Clause (Copyright (c) 2026 David Haz): the notice is kept
 * here as the licence asks, and the port is used as part of this application only; it is
 * not to be redistributed as a component.
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
 * What changed in the port: the props keep the original's names and meanings (`distance`,
 * `direction`, `reverse`, `initialOpacity`, `animateOpacity`, `scale`, `delay`), the numbers
 * are the kit's (8pt, not 100px; 300ms on `EASE`, not 0.8s power3; the kit's 40ms stagger,
 * capped at eight), GSAP and its ScrollTrigger are replaced by one Reanimated timing that
 * runs once on mount (or when `trigger` changes), and FadeContent's blur is gone: a blur in
 * is the landing page look, and a second texture beside the pixel grid.
 */
import { REDUCED_FADE, STAGGER, STAGGER_CAP, T, exitMs } from '../../motionSpec';
import { EFFECTS } from './spec';

export type EntranceDirection = 'vertical' | 'horizontal';

export interface EntranceOptions {
  /** Place in a staggered list. Items past the eighth enter with the eighth, as a block. */
  index?: number;
  /** Before the stagger, in ms. */
  delay?: number;
  /** How long the move takes, in ms. Default `T.enter` (300). Lists use `T.std` (240). */
  duration?: number;
  /** How far it travels into place, in points. Default 8. 0 is a fade. */
  distance?: number;
  /** react-bits: `vertical` rises from below, `horizontal` slides in from the right. */
  direction?: EntranceDirection;
  /** react-bits: come from the other side (above, or the left). */
  reverse?: boolean;
  /** Opacity it starts from. Default 0. */
  initialOpacity?: number;
  /** react-bits: false keeps the opacity at 1 and only moves. Default true. */
  animateOpacity?: boolean;
  /** Scale it starts from (0.95 for a Wrapped card popping in). Default 1. */
  scale?: number;
  /** Rotation it starts from, in degrees (a staggered pop). Default 0. */
  rotate?: number;
  /**
   * The content wears an identity hue (a creature, a card face, a harness tile). Its opacity
   * snaps in over `EFFECTS.enter.hueFadeMs` while it moves: a hue at partial opacity over the
   * warm ground is brown, so colour arrives by position and scale, never by a long fade.
   */
  hue?: boolean;
  /** Stagger per item, in ms. Default the kit's 40. */
  step?: number;
  /** Items that stagger before the rest enter as a block. Default the kit's 8. */
  cap?: number;
}

export interface EntrancePlan {
  /** When it starts, in ms after mount (or after `trigger` changes). */
  delay: number;
  /** How long the move and scale take, in ms. 0 when nothing moves. */
  moveMs: number;
  /** How long the opacity takes, in ms. */
  fadeMs: number;
  from: { x: number; y: number; scale: number; rotate: number; opacity: number };
}

/**
 * The entrance for `options`, and its still form under Reduce Motion: nothing moves, and the
 * content fades in over the kit's 150ms (never skipped: the fade IS the reduced motion).
 */
export function entrancePlan(options: EntranceOptions = {}, reduced = false): EntrancePlan {
  const step = options.step ?? STAGGER;
  const cap = options.cap ?? STAGGER_CAP;
  const index = Math.min(Math.max(0, Math.floor(options.index ?? 0)), cap);
  const delay = Math.max(0, options.delay ?? 0) + index * step;
  const animateOpacity = options.animateOpacity ?? true;
  const opacity = animateOpacity ? clamp01(options.initialOpacity ?? 0) : 1;
  if (reduced) {
    return { delay, moveMs: 0, fadeMs: REDUCED_FADE, from: { x: 0, y: 0, scale: 1, rotate: 0, opacity: animateOpacity ? opacity : 0 } };
  }
  const duration = Math.max(0, options.duration ?? T.enter);
  const distance = options.distance ?? EFFECTS.enter.distancePt;
  const offset = options.reverse ? -distance : distance;
  const horizontal = options.direction === 'horizontal';
  const scale = options.scale ?? 1;
  const rotate = options.rotate ?? 0;
  const moves = distance !== 0 || scale !== 1 || rotate !== 0;
  return {
    delay,
    moveMs: moves ? duration : 0,
    fadeMs: options.hue ? Math.min(EFFECTS.enter.hueFadeMs, duration) : duration,
    from: { x: horizontal ? offset : 0, y: horizontal ? 0 : offset, scale, rotate, opacity },
  };
}

/** The same entrance leaving: 0.7x as long (the kit's exit rule), back the way it came. */
export function exitPlan(options: EntranceOptions = {}, reduced = false): EntrancePlan {
  const plan = entrancePlan({ ...options, index: 0, delay: 0 }, reduced);
  return { ...plan, moveMs: exitMs(plan.moveMs), fadeMs: reduced ? REDUCED_FADE : exitMs(plan.fadeMs) };
}

/** When the whole of a staggered list of `count` items has arrived, in ms. */
export function staggerTotalMs(count: number, options: EntranceOptions = {}, reduced = false): number {
  if (count <= 0) return 0;
  const last = entrancePlan({ ...options, index: count - 1 }, reduced);
  return last.delay + Math.max(last.moveMs, last.fadeMs);
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}
