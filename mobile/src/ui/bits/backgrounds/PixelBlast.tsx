/**
 * PixelBlast: react-bits' field of dithered pixel clouds (value noise over blocks of 8 cells) in
 * three levels of one hue, with tap ripples. Onboarding hello (amber, edge fade 0.5, `develop`,
 * `interactive`) and the Now empty state (`clear` around Bit) (DESIGN-V2 3.1, 3.2, 4.1 #2).
 *
 *   <PixelBlast width={w} height={h} develop interactive />
 *   <PixelBlast width={w} height={220} clear={bitBox} interactive onTap={stir} />
 *
 * Props: every `BackgroundProps` (spec.ts: width, height, hue, ink, partner, paper, levels,
 * speed, scale, cell, fps, seed, paused, develop, reveal, edgeFade, clear, resolution, style,
 * accessibilityLabel), plus
 *   density          react-bits `patternDensity` (1): each 0.1 lifts the clouds 0.03. Measured on a
 *                    390 x 220 band: 1 lights ~11% of the cells, 1.5 ~22%, 0.35 ~3% and 0.25 often
 *                    none (spec.ts `PIXEL_BLAST.density` says why DESIGN-V2's numbers draw less here)
 *   block            cells per noise block (react-bits 8 x pixelSize): 8
 *   interactive      a tap sends a ripple out through the field, up to 4 alive, on react-bits'
 *                    ripple numbers; never steals a scroll. Default false
 *   onTap            where the tap landed, points (the empty state's "the first tap stirs him")
 *   rippleIntensity  react-bits `rippleIntensityScale`: 1
 * Defaults: amber (Bit's), edge fade 0.5, time at AMBIENT x react-bits `speed 0.5`. A large field
 * (a full screen) draws into a texture at one pixel per cell. Reduce Motion: the seed frame, no
 * ripples.
 *
 * Ported from react-bits `Backgrounds/PixelBlast/PixelBlast.tsx` by David Haz.
 * react-bits is MIT + Commons Clause (Copyright (c) 2026 David Haz): the notice is kept here
 * as the licence asks, and the port is used as part of this application only; it is not to be
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
 * What changed in the port: three.js and 10 click slots become one SkSL program with 4 tap
 * uniforms written from a Gesture Handler Tap; square pixels only (no circle, triangle or diamond,
 * no liquid touch texture, no jitter, no noise pass); the one bit mask with a smooth alpha edge
 * becomes three levels whose edge thins by cells; the noise unit is 300 pt rather than the canvas
 * height; sine hashes become Hoskins'. The shader and each change are in `shaders.ts`.
 */
import type { Uniforms } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { useDerivedValue } from 'react-native-reanimated';

import { FieldSurface, useBackgroundBase } from './FieldSurface';
import { useTapRing } from './fingers';
import { frameUniforms, PIXEL_BLAST, pixelBlastUniforms, RIPPLE_LIFE_S, type BackgroundProps, type FieldPoint } from './spec';

export interface PixelBlastProps extends BackgroundProps {
  density?: number;
  block?: number;
  interactive?: boolean;
  onTap?: (point: FieldPoint) => void;
  rippleIntensity?: number;
}

export function PixelBlast(props: PixelBlastProps) {
  const base = useBackgroundBase('PixelBlast', props, { edgeFade: PIXEL_BLAST.edgeFade, interactive: props.interactive === true });
  const { clock, reveal, common } = base;
  const live = props.interactive === true && !base.still;
  const ring = useTapRing({ enabled: live, clock, life: RIPPLE_LIFE_S, onTap: props.onTap });
  const own = useMemo(
    () =>
      pixelBlastUniforms({
        scale: props.scale,
        density: props.density,
        block: props.block,
        rippleIntensity: props.rippleIntensity,
      }),
    [props.scale, props.density, props.block, props.rippleIntensity],
  );
  const fixed = useMemo(() => ({ ...common, ...own }), [common, own]);
  const taps = ring.taps;
  const uniforms = useDerivedValue<Uniforms>(() =>
    frameUniforms('PixelBlast', fixed, { t: clock.t.value, now: clock.now.value, reveal: reveal.value, taps: taps.value }),
  );
  return <FieldSurface base={base} uniforms={uniforms} gesture={live ? ring.gesture : undefined} />;
}
