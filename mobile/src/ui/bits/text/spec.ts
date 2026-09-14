/**
 * The text effects' timing, as plain numbers (DESIGN-V2-COLOUR-MOTION 3, "v2 adds to
 * motionSpec.ts"). No React Native import, so `bun test` can hold every value; the components
 * import from here. The v2 doc asks for these in the kit's `motionSpec.ts`; that file belongs to
 * the kit, so the text ports keep their own copy under the same names and the same numbers, and
 * `__tests__/bitsText.test.ts` pins them to the doc.
 *
 * Ported from react-bits `TextAnimations/*` by David Haz (SplitText, BlurText, RotatingText,
 * TextType, ShinyText, GradientText, Shuffle, SplitFlapText). react-bits is MIT + Commons
 * Clause (Copyright (c) 2026 David Haz): the notice is kept here as the licence asks, and the
 * ports are used as part of this application only; they are not to be redistributed as
 * components.
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
 * What changed in the ports: the react-bits numbers are kept where a phone can use them and
 * tuned where the v2 doc says so (each constant says which). Every effect finishes within
 * `TEXT_EFFECT_DONE_MS` of its arrival (rule 7): a long string compresses its stagger rather
 * than running long, the way `decrypt.ts` caps its ticks.
 */
import { EXIT_FACTOR, REDUCED_FADE, T } from '../../motionSpec';

/** Rule 7: every text effect is finished within 1.2 s of its element's arrival. */
export const TEXT_EFFECT_DONE_MS = 1200;

/**
 * SplitText by characters. react-bits: 50 ms stagger, 1.25 s, `power3.out`, from 40 px low.
 * The doc: 24 ms, 360 ms, 10 pt, on `EASE`.
 */
export const SPLIT = { charMs: 360, staggerMs: 24, risePt: 10 } as const;

/**
 * SplitText by words: rise 6 pt, each word's opacity snapping in under 120 ms, 60 ms apart, no
 * blur (the doc). The rise takes `T.enter`, the kit's entrance.
 */
export const SPLIT_WORDS = { staggerMs: 60, risePt: 6, fadeMs: 120, riseMs: T.enter } as const;

/**
 * BlurText. react-bits: 200 ms per word, two 0.35 s steps (from, mid, to), blur 10 px to 5 to 0,
 * opacity 0 to 0.5 to 1, y 50 px away to 5 px past to 0. The phone keeps the steps and the
 * opacity, scales the travel to 12 pt and the overshoot to 1.2 pt, and draws the blur as four
 * ghost copies that close in (a real blur on RN text would be Skia text per word, which takes
 * a typeface by family name and so risks a face other than SF Pro; see `BlurText.tsx`).
 */
export const BLUR = {
  stepMs: 350,
  staggerMs: 200,
  travelPt: 12,
  overshootPt: 1.2,
  /** How far the ghosts sit at full blur, in points (react-bits' 10 px blur, halved: a radius). */
  spreadPt: 4,
  /** Of the unit's opacity, the share the ghosts carry at full blur. */
  ghostShare: 0.8,
  ghosts: 4,
} as const;

/** The keyframes BlurText steps through, react-bits' defaults, in react-bits' order. */
export const BLUR_KEYFRAMES = {
  opacity: [0, 0.5, 1],
  /** 1 is full blur. react-bits: 10 px, 5 px, 0. */
  blur: [1, 0.5, 0],
} as const;

/**
 * RotatingText. react-bits: a new text every 2 s, characters in from `y: 100%` and out to
 * `y: -120%` on a spring (damping 25, stiffness 300: a damping ratio of 0.72, POP's). Nothing
 * here is pulled by a finger, so the move is timing on `EASE` (DESIGN-DIRECTION 3.5): in over
 * `T.enter`, out in 0.7x of it.
 */
export const ROTATE = {
  intervalMs: 2000,
  enterMs: T.enter,
  exitMs: Math.round(T.enter * EXIT_FACTOR),
  staggerMs: 0,
  fromLines: 1,
  toLines: -1.2,
} as const;

/**
 * TextType. The doc: 18 ms a character, the caret blinks three times then hides, no deleting,
 * no loop. react-bits' own numbers stay for the multi text mode: 30 ms a deletion, a 2 s pause.
 */
export const TYPE = { charMs: 18, blinkMs: 500, blinks: 3, deleteMs: 30, pauseMs: 2000 } as const;

/**
 * ShinyText. react-bits: a 2 s pass, the band 30% of the text either side of the peak, at
 * 120 degrees, looping. Here the light is three flat steps (DESIGN-V2 1.3: "light comes from a
 * stepped band"), one pass on arrival inside rule 7, and a loop only when asked.
 */
export const SHINY = {
  sweepMs: 1000,
  pauseMs: 1000,
  /** The widest step's share of the text width: react-bits' 35% to 65% of a 200% background. */
  spread: 0.6,
  maxBandPt: 120,
  minBandPt: 18,
  steps: 3,
  /** react-bits' 120 degree gradient: bands lean 30 degrees off vertical. */
  skewDeg: 30,
} as const;

/**
 * GradientText. react-bits: an 8 s pass back and forth through three colours on a 300%
 * background. Here the colours are flat bands of one hue's tones (no smooth ramp, DESIGN-V2
 * 1.3), three bands across the text, and the bands slide one period on arrival and rest; the
 * react-bits drift is `animate="loop"`.
 */
export const GRADIENT = {
  driftMs: 8000,
  arriveMs: 1100,
  bandFraction: 1 / 3,
  /**
   * Each band's tone: up toward the text colour, down toward the hue's partner. Ink, light, ink,
   * deep: one period of light passing, periodic so the loop is seamless.
   */
  lifts: [0, 0.3, 0, -0.35],
  skewDeg: 30,
} as const;

/**
 * Shuffle. react-bits: 0.35 s, 30 ms stagger, `evenodd` (odd characters first, even ones at 70%
 * of the odd run), one roll. The doc: three shuffled copies, the Wrapped word answers only.
 */
export const SHUFFLE = { ms: 350, staggerMs: 30, rolls: 3, evenStart: 0.7 } as const;

/**
 * SplitFlapText. react-bits: 120 ms a flip, 60 ms stagger, 8 flips a character, perspective
 * 520. The doc: 6 flips, perspective 600. The back flap waits for 45% of a flip (react-bits'
 * keyframes) and the front flap darkens to 52% as it falls.
 */
export const FLIP = { flipMs: 120, staggerMs: 60, flips: 6, perspective: 600, backFrom: 0.45, shade: 0.48 } as const;

/** Under Reduce Motion an entrance is this fade and a flip or a scramble lands at once. */
export const TEXT_REDUCED_FADE = REDUCED_FADE;
