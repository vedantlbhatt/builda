/**
 * Grainient: react-bits' warped, grainy three stop blend, where the three stops are the three
 * levels of one hue (dark stop paper, middle stop partner, light stop ink), so it prints as a
 * dithered risograph in one colour and never as a gradient (DESIGN-V2 1.3). Picked over
 * Iridescence (a rainbow by construction) and SoftAurora (48 gradient hashes a pixel) because its
 * three stops ARE the three levels.
 *
 *   <Grainient width={w} height={200} hue={cardHue('longest_session', archetype)} />
 *
 * Props: every `BackgroundProps` (spec.ts: width, height, hue, ink, partner, paper, levels,
 * speed, scale, cell, fps, seed, paused, develop, reveal, edgeFade, clear, resolution, style,
 * accessibilityLabel), plus react-bits' own tuning, every one that acts on a scalar:
 *   timeSpeed 0.25, colorBalance 0, warpStrength 2.5 (react-bits 1), warpFrequency 5,
 *   warpSpeed 2, warpAmplitude 50, blendAngle 0, blendSoftness 0.05, rotationAmount 500,
 *   noiseScale 2, grainAmount 0.1, contrast 2.5 (react-bits 1.5), zoom 0.6 (react-bits 0.9;
 *   times `scale`), centerX 0, centerY 0. At the web's three a phone box is one wide dithered
 *   ramp (spec.ts `GRAINIENT` says why), which reads as the gradient the brief bans.
 * Defaults: iris, time at AMBIENT (x 0.3). Reduce Motion: the seed frame.
 *
 * Ported from react-bits `Backgrounds/Grainient/Grainient.tsx` by David Haz.
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
 * What changed in the port: an ogl WebGL2 program becomes one SkSL program; the RGB blend of
 * three colours becomes a scalar blend of three levels, dithered; gamma, saturation and light
 * mode go (they act on RGB); sine hashes become Hoskins'; the grain is one hash per cell. The
 * shader is in `shaders.ts`.
 */
import type { Uniforms } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { useDerivedValue } from 'react-native-reanimated';

import { FieldSurface, useBackgroundBase } from './FieldSurface';
import { frameUniforms, grainientUniforms, type BackgroundProps, type GrainientTuning } from './spec';

export interface GrainientProps extends BackgroundProps, GrainientTuning {
  centerX?: number;
  centerY?: number;
}

export function Grainient(props: GrainientProps) {
  const base = useBackgroundBase('Grainient', props);
  const { clock, reveal, common } = base;
  const {
    scale,
    zoom,
    timeSpeed,
    colorBalance,
    warpStrength,
    warpFrequency,
    warpSpeed,
    warpAmplitude,
    blendAngle,
    blendSoftness,
    rotationAmount,
    noiseScale,
    grainAmount,
    contrast,
    centerX,
    centerY,
  } = props;
  const own = useMemo(
    () =>
      grainientUniforms({
        scale,
        zoom,
        timeSpeed,
        colorBalance,
        warpStrength,
        warpFrequency,
        warpSpeed,
        warpAmplitude,
        blendAngle,
        blendSoftness,
        rotationAmount,
        noiseScale,
        grainAmount,
        contrast,
        centerX,
        centerY,
      }),
    [
      scale,
      zoom,
      timeSpeed,
      colorBalance,
      warpStrength,
      warpFrequency,
      warpSpeed,
      warpAmplitude,
      blendAngle,
      blendSoftness,
      rotationAmount,
      noiseScale,
      grainAmount,
      contrast,
      centerX,
      centerY,
    ],
  );
  const fixed = useMemo(() => ({ ...common, ...own }), [common, own]);
  const uniforms = useDerivedValue<Uniforms>(() => frameUniforms('Grainient', fixed, { t: clock.t.value, now: 0, reveal: reveal.value }));
  return <FieldSurface base={base} uniforms={uniforms} />;
}
