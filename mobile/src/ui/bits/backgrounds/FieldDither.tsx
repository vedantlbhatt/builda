/**
 * FieldDither: react-bits Dither's wave field (`fbm(p + fbm(p - t * waveSpeed))` over classic
 * Perlin noise) printed in three levels of one hue, drifting at 20 fps. The You hero behind the
 * archetype creature, the onboarding creature step's ground, the archetype reveal's field and the
 * ProfileCard ground (DESIGN-V2 4.1 #1).
 *
 *   <FieldDither width={w} height={260} hue={archetypeHue(archetype)} develop />
 *
 * Props: every `BackgroundProps` (spec.ts: width, height, hue, ink, partner, paper, levels,
 * speed, scale, cell, fps, seed, paused, develop, reveal, edgeFade, clear, resolution, style,
 * accessibilityLabel), plus
 *   interactive    a finger carves a pool in the wave where it rests (react-bits' mouse hole),
 *                  easing in over 180 ms and out over 240 ms; never steals a scroll. Default false
 *   octaves        1 to 4 (react-bits 4); a large field drawn in one pass uses 2
 *   touchRadius    the pool's radius in wave units (one unit is 280 pt): 0.35
 * Defaults: amber (the generalist; pass the archetype's hue), react-bits' wave numbers, time at
 * AMBIENT (x 0.3). Reduce Motion: the seed frame, no pool.
 *
 * Ported from react-bits `Backgrounds/Dither/Dither.tsx` by David Haz.
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
 * What changed in the port: three.js, a postprocessing pass and an RGB `colorNum 4` posterise
 * become one SkSL program over a scalar, dithered to paper, partner and ink with the threshold
 * fixed to the screen (so the drift never crawls inside a cell); the wave's unit is 280 pt rather
 * than the canvas height; the hover hole is a finger. The shader and each change are in
 * `shaders.ts`.
 */
import type { Uniforms } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { useDerivedValue } from 'react-native-reanimated';

import { FieldSurface, useBackgroundBase } from './FieldSurface';
import { useFingerPool } from './fingers';
import { DITHER_WAVES, ditherWavesUniforms, frameUniforms, type BackgroundProps } from './spec';

export interface FieldDitherProps extends BackgroundProps {
  interactive?: boolean;
  octaves?: number;
  touchRadius?: number;
}

export function FieldDither(props: FieldDitherProps) {
  const base = useBackgroundBase('FieldDither', props, { interactive: props.interactive === true });
  const { clock, reveal, common } = base;
  const live = props.interactive === true && !base.still;
  const finger = useFingerPool(live, DITHER_WAVES.touchInMs, DITHER_WAVES.touchOutMs);
  const own = useMemo(
    () => ditherWavesUniforms({ scale: props.scale, octaves: props.octaves, touchRadius: props.touchRadius }),
    [props.scale, props.octaves, props.touchRadius],
  );
  const fixed = useMemo(() => ({ ...common, ...own }), [common, own]);
  const { x, y, k } = finger;
  const uniforms = useDerivedValue<Uniforms>(() =>
    frameUniforms('FieldDither', fixed, { t: clock.t.value, now: 0, reveal: reveal.value, touch: [x.value, y.value, k.value] }),
  );
  return <FieldSurface base={base} uniforms={uniforms} gesture={live ? finger.gesture : undefined} />;
}
