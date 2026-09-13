/**
 * The numbers behind the ported react-bits components (DESIGN-V2-COLOUR-MOTION 4.3, 4.4), each
 * beside the number the web original used, so a reader can see what was cut for a phone and
 * why. Pure: no React Native import, so `__tests__/bitsComponents.test.ts` holds every one.
 *
 * Ported from react-bits `Components/*` by David Haz.
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
 * What changed in the port, in general: every spring is the kit's (`SNAP`, `SHEET`, `POP`) and
 * every timing is on `EASE`, so the ports move like the rest of the app; hover becomes a finger;
 * nothing autoplays on a loop; glows, particles and gradients are gone (the brief bans them);
 * colour comes from the spectrum in `theme.ts`, never a literal.
 */
import { STAGGER, T } from '../../motionSpec';

/** Ambient motion: 20 fps, react-bits speeds x 0.3 (DESIGN-V2 3). */
export const AMBIENT = { fps: 20, speed: 0.3 } as const;

/** TiltedCard (react-bits `rotateAmplitude 14`, `scaleOnHover 1.1`, `perspective 800px`). */
export const TILT = {
  /** Degrees at the card's edge. react-bits 14: at 14 a phone card reads as falling over. */
  maxDeg: 8,
  /** The stepped glare crossing once (GlareHover). */
  glareMs: 380,
  perspective: 800,
  /** While held. react-bits 1.1 is a hover lift; under a thumb 1.02 is enough. */
  pressScale: 1.02,
  /** The glare: three flat steps, no ramp (DESIGN-V2 4.4, GlareHover). */
  glareSteps: [0.06, 0.1, 0.06],
  /** Each step's width in points: 24 across. */
  glareStepPt: 8,
} as const;

/** ProfileCard's arrival sweep (react-bits `ANIMATION_CONFIG`). */
export const PROFILE = {
  /** react-bits `INITIAL_X_OFFSET`: the sweep starts this far in from the right edge. */
  initialX: 70,
  /** react-bits `INITIAL_Y_OFFSET`: and this far down from the top. */
  initialY: 60,
  /** react-bits `INITIAL_DURATION`. */
  initialMs: 1200,
  /** react-bits card aspect (`aspect-ratio: 0.718`). */
  aspect: 0.718,
  /** The art band's share of the card: the field lives here and never behind the words. */
  artShare: 0.56,
  /** Creatures at 16/32/48/64 only (DESIGN-DIRECTION 9). */
  creature: 64,
  /**
   * How much of the field reaches ink, after the wave's contrast curve (`FIELD_SKSL`). Drawn and
   * looked at: read straight, 0.72 and 0.55 both filled the band with partner and the creature
   * stopped being the subject; through the curve at 0.8 the troughs are paper and only the
   * crests are ink.
   */
  density: 0.8,
  /** The arrival's opacity snaps in under this (colour enters by position, not by a fade). */
  snapMs: 100,
} as const;

/** Stack (react-bits: rotate `(n - i - 1) * 4`, scale `1 + 0.06 (i - n)`, sensitivity 200). */
export const STACK = {
  rotateStep: 4,
  scaleStep: 0.06,
  /** Cards drawn behind the top one. The web version draws all of them; fifteen is a fan. */
  visible: 4,
  /** A drag this far sends the card back. react-bits 200px; a phone card is ~300pt wide. */
  sensitivity: 110,
  /** Or a flick this fast, the kit's flick (react-bits has no velocity rule). */
  flick: 800,
  /** Degrees of rotateX and rotateY at 100pt of drag. react-bits 60, which folds a card flat. */
  tiltDeg: 12,
  /** `randomRotation`: plus or minus this, seeded by card so screenshots never change. */
  jitterDeg: 5,
  /** react-bits `perspective: 600px` on the container. */
  perspective: 600,
  /** react-bits `transformOrigin: '90% 90%'`. */
  origin: 0.9,
} as const;

/** CardSwap (react-bits `cardDistance 60`, `verticalDistance 70`, `skewAmount 6`, perspective 900). */
export const CARD_SWAP = {
  cardDistance: 16,
  verticalDistance: 18,
  skew: 2,
  perspective: 900,
  /** react-bits `z: -i * distX * 1.5`, projected: RN has no translateZ. */
  depthFactor: 1.5,
  /** react-bits promotes the rest `0.15s` apart. */
  staggerMs: 150,
  /** When the rest start forward, into the front card's drop. react-bits linear: 0.44s of 0.8. */
  promoteMs: 120,
  /** When the dropped card starts back. It is behind the others by then. */
  returnMs: 300,
  /** How far the front card drops, in card heights (react-bits `y: '+=500'` on 400px cards). */
  drop: 1.25,
  /** The one swap waits this long after it is asked for, so it is seen as a swap. */
  firstSwapDelayMs: 600,
} as const;

/** BounceCards (react-bits `transformStyles`, `animationStagger 0.06`, hover push 160px). */
export const BOUNCE = {
  rotations: [10, 5, -3, -10, 2],
  offsets: [-170, -85, 0, 85, 170],
  /** The container the offsets were written for. */
  designWidth: 400,
  /** Cards arrive from this scale (react-bits 0, which the skill bans: never enter from 0). */
  fromScale: 0.94,
  staggerMs: 60,
  /** Siblings push away this far (react-bits 160px), scaled with the offsets. */
  pushPt: 160,
  /** react-bits `delay = distance * 0.05`. */
  pushStaggerMs: 50,
  /** Opacity snaps in under this, so a card never hangs half there (colour enters by position). */
  snapMs: 100,
} as const;

/** AnimatedList (react-bits: from scale 0.7, 0.2s; top fade 50px, bottom 100px). */
export const LIST = {
  /** Rise, in points (DESIGN-V2 rule 3: 8 to 12). */
  risePt: 12,
  /** From scale (react-bits 0.7; the skill enters from 0.95). */
  fromScale: 0.96,
  enterMs: T.enter,
  /** Opacity snaps in under 120ms. */
  fadeMs: 120,
  /** A row mounting later than this after the first load is a scroll, not an entrance. */
  firstLoadWindowMs: 600,
  /** react-bits fades each edge over its first 50px of scroll. */
  fadeDistance: 50,
  /** The dithered edges' heights (react-bits 50 and 100px, gradients). */
  edgeTop: 32,
  edgeBottom: 40,
  stagger: STAGGER,
} as const;

/** SpotlightCard (react-bits: `rgba(255,255,255,0.25)` at 80%, a hover light). */
export const SPOT = {
  /** Points (DESIGN-V2 4.3: radius 120). */
  radius: 120,
  /**
   * The amount at the finger, 0 to 1 before the three level dither: 0.36 is 72% of the cells
   * under the finger in the partner, falling off on a squared curve, and never the ink. Drawn
   * and looked at: 0.42 on a plain curve covered a whole mission tile, which is not subtle.
   */
  strength: 0.36,
  inMs: T.press,
  outMs: T.std,
} as const;

/** PixelCard (react-bits: gap 5, speed 35, delay = distance, per pixel random). */
export const PIXEL = {
  /** The grain in points (tokens.dither.cell). */
  cell: 3,
  /** DESIGN-V2 4.3: 240ms from the finger to the far corner. */
  ms: T.std,
  /** One cell grows over this share of the run, from nothing to a full square: short, so the
   *  front is a crisp edge of squares, not a field of half grown ones. */
  grow: 0.25,
  /** How ragged the front is: the hashed share of each cell's turn. */
  jitter: 0.3,
  /** The ink on the tile flips to `onFill` here. */
  flipAt: 0.5,
  /** Reduce Motion: the fill cross fades in under 120ms (the tools step's still). */
  reducedMs: 120,
} as const;

/** MagicBento (react-bits: spotlight 300px, tilt 10 on move, magnetism 0.05, 2 to 4 columns). */
export const BENTO = {
  columns: 2,
  rowHeight: 120,
  gap: 12,
  /** The shared light's radius in points (react-bits 300px on a desktop grid). */
  spotlightRadius: 160,
  /** A gentle tilt (react-bits 10). */
  tiltDeg: 5,
  /** react-bits `magnetX = (x - centerX) * 0.05`. */
  magnet: 0.05,
  /** react-bits `calculateSpotlightValues`: full inside half the radius, gone at three quarters. */
  proximity: 0.5,
  fade: 0.75,
} as const;

/** Stepper (react-bits: 32px circles, a 2px connector, 0.4s fills). */
export const STEPPER = {
  /** Onboarding's bars (DESIGN-DIRECTION 4: ~27 x 3.7pt, gap 9): 4pt tall on the space scale. */
  barHeight: 4,
  circle: 24,
  dot: 8,
  connector: 2,
  /** react-bits draws the check 0.1s in, over 0.3s. */
  checkDelayMs: 100,
  checkMs: 300,
} as const;

/** Carousel (react-bits: rotateY 90 per item, velocity 500px/s, gap 16, spring 300/30). */
export const CAROUSEL = {
  /** A neighbour's turn (DESIGN-V2 4.3: plus or minus 35). react-bits 90 turns it edge on. */
  rotateDeg: 35,
  perspective: 1000,
  gap: 16,
  /** 30% of the way to a neighbour moves on (the creature carousel's rule). */
  commitShare: 0.3,
  /** Or a flick (react-bits 500px/s; the kit's 800pt/s). */
  flick: 800,
  /** Past either end of a list that does not loop, the stage follows at this fraction. */
  rubber: 0.25,
  /** Slots drawn either side of the centre. */
  reach: 2,
  /** A little over half, so a finger held half way keeps one item active. */
  hysteresis: 0.55,
  /** The indicator dot and its tap box. */
  dot: 6,
  dotBox: 24,
  /** react-bits scales the active dot to 1.2 over 0.15s. */
  dotActiveScale: 1.2,
  dotMs: 150,
} as const;
