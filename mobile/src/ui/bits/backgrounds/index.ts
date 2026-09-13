/**
 * The shader backgrounds: seven react-bits fields as Skia RuntimeEffects, printed in three levels
 * of one spectrum hue, advancing at 20 fps, paused off screen, still under Reduce Motion.
 *
 *   FieldDither   react-bits Dither's wave        the You hero, the creature step, the ProfileCard
 *   PixelBlast    pixel clouds with tap ripples   onboarding hello, the Now empty state
 *   Silk          folded cloth                    a quiet band behind a card
 *   Grainient     a warped three stop blend       a Wrapped header's print
 *   Radar         rings, spokes, one sweep        pairing and any "waiting"
 *   Topography    a morphing contour map          the time lapse
 *   DotGrid       dots a tap shoves               the codebase map
 *
 * Every one takes `BackgroundProps` (spec.ts documents them) and adds its own react-bits tuning.
 * Import from here; `BackgroundsGallery` is deliberately not exported (Metro does not tree shake):
 * import it from './BackgroundsGallery' in a dev screen.
 *
 * Ported from react-bits `Backgrounds/*` by David Haz.
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
 * What changed in the ports is written beside each program in `shaders.ts`.
 */
export { FieldDither, type FieldDitherProps } from './FieldDither';
export { PixelBlast, type PixelBlastProps } from './PixelBlast';
export { Silk, type SilkProps } from './Silk';
export { Grainient, type GrainientProps } from './Grainient';
export { Radar, type RadarProps } from './Radar';
export { Topography, type TopographyProps } from './Topography';
export { DotGrid, type DotGridProps } from './DotGrid';
export { FieldSurface, useBackgroundBase, backgroundEffect, type BackgroundBase, type FieldSurfaceProps } from './FieldSurface';
export { useFieldClock, useScreenFocused, useAppActive, type FieldClock } from './useFieldClock';
export {
  AMBIENT,
  REVEAL_MS,
  DEFAULT_HUE,
  RATE,
  LARGE_FIELD_PT2,
  planField,
  type BackgroundProps,
  type ClearRect,
  type FieldPoint,
  type Resolution,
  type TopographyMode,
} from './spec';
export { PROGRAMS, BACKGROUND_NAMES, type BackgroundName } from './shaders';
