/**
 * The react-bits text ports (DESIGN-V2-COLOUR-MOTION 4.2), ported to React Native with
 * Reanimated from react-bits `TextAnimations/*` by David Haz. react-bits is MIT + Commons Clause
 * (Copyright (c) 2026 David Haz): the notice is kept here and at the top of every file beside
 * it, as the licence asks, and the ports are used as part of this application only; they are
 * not to be redistributed as components.
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
 * Every one: typed props, the kit's type roles and motion vocabulary, colour from the spectrum
 * (`hue`, `color`) or a kit `tone`, a still under Reduce Motion, one effect per text element,
 * done within 1.2 s of its arrival (rule 7), and the whole string announced once to VoiceOver.
 * The pure logic (splitting, stagger, typewriter frames, flap plans, shuffle strips, bands) is
 * in the `.ts` files beside them, and `__tests__/bitsText.test.ts` holds it.
 *
 * The dev gallery is not exported here (Metro does not tree shake); import it from
 * './TextBitsGallery' directly.
 */
export { SplitText, type SplitTextProps } from './SplitText';
export { BlurText, type BlurTextProps } from './BlurText';
export { RotatingText, type RotatingTextProps, type RotatingTextRef } from './RotatingText';
export { TextType, type TextTypeProps } from './TextType';
export { ShinyText, type ShinyTextProps } from './ShinyText';
export { GradientText, type GradientTextProps } from './GradientText';
export { Shuffle, type ShuffleProps } from './Shuffle';
export { SplitFlapText, type SplitFlapTextProps } from './SplitFlapText';
export type { PlayProps, TextLookProps } from './shared';
export { SPLIT, SPLIT_WORDS, BLUR, ROTATE, TYPE, SHINY, GRADIENT, SHUFFLE, FLIP, TEXT_EFFECT_DONE_MS } from './spec';
