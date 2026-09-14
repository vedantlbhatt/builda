/**
 * Topography: react-bits' morphing contour map, lines one cell wide on the pixel grid, in the
 * partner and ink of one hue. The time lapse's ground (DESIGN-V2 4.5, deferred there, built
 * here), a map of how a codebase moved.
 *
 *   <Topography width={w} height={240} hue="tide" interactive />
 *
 * Props: every `BackgroundProps` (spec.ts: width, height, hue, ink, partner, paper, levels,
 * speed, scale, cell, fps, seed, paused, develop, reveal, edgeFade, clear, resolution, style,
 * accessibilityLabel), plus
 *   bands          contours per unit of height: 1 (react-bits 2, see spec.ts)
 *   lineWidth      a contour's width in cells: 1
 *   glow           react-bits' halo, in bands past the line, raised to `contrast 3`: 0.5
 *   mode           'alternating' (lines partner, ink, partner: default), 'uniform' (all ink) or
 *                  'elevation' (react-bits' default: low lines partner, high lines ink)
 *   fill           partner cells between the lines, rising with the ground: 0 (off)
 *   morphAmount    react-bits 3; morphSpeed react-bits 0.05
 *   interactive    a finger raises a hill under it (react-bits' mouse bump, radius 0.3 of the
 *                  height, strength 0.4); never steals a scroll. Default false
 * Defaults: tide, the control points moved at react-bits `speed 0.35` on AMBIENT time. Reduce
 * Motion: the seed frame, no hill.
 *
 * Ported from react-bits `Backgrounds/Topography/Topography.tsx` by David Haz.
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
 * What changed in the port: an ogl program with its control points moved in a rAF loop becomes
 * one SkSL program whose control points are moved on the UI thread (`topographyCtrl`, the same
 * loop); `fwidth` anti aliasing becomes a line measured in cells; three hues become two levels
 * of one; no grain pass. The shader is in `shaders.ts`.
 */
import type { Uniforms } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { useDerivedValue } from 'react-native-reanimated';

import { FieldSurface, useBackgroundBase } from './FieldSurface';
import { useFingerPool } from './fingers';
import { frameUniforms, TOPOGRAPHY, topographyUniforms, type BackgroundProps, type TopographyMode } from './spec';

export interface TopographyProps extends BackgroundProps {
  bands?: number;
  lineWidth?: number;
  glow?: number;
  contrast?: number;
  mode?: TopographyMode;
  fill?: number;
  morphAmount?: number;
  morphSpeed?: number;
  interactive?: boolean;
  touchRadius?: number;
  touchStrength?: number;
}

export function Topography(props: TopographyProps) {
  const base = useBackgroundBase('Topography', props, { interactive: props.interactive === true });
  const { clock, reveal, common } = base;
  const live = props.interactive === true && !base.still;
  const finger = useFingerPool(live, TOPOGRAPHY.touchInMs, TOPOGRAPHY.touchOutMs);
  const { scale, bands, lineWidth, glow, contrast, mode, fill, morphAmount, touchRadius, touchStrength } = props;
  const own = useMemo(
    () => topographyUniforms({ scale, bands, lineWidth, glow, contrast, mode, fill, morphAmount, touchRadius, touchStrength }),
    [scale, bands, lineWidth, glow, contrast, mode, fill, morphAmount, touchRadius, touchStrength],
  );
  const fixed = useMemo(() => ({ ...common, ...own }), [common, own]);
  const morphSpeed = props.morphSpeed ?? TOPOGRAPHY.morphSpeed;
  const { x, y, k } = finger;
  const uniforms = useDerivedValue<Uniforms>(() =>
    frameUniforms('Topography', fixed, {
      t: clock.t.value,
      now: 0,
      reveal: reveal.value,
      touch: [x.value, y.value, k.value],
      morphSpeed,
    }),
  );
  return <FieldSurface base={base} uniforms={uniforms} gesture={live ? finger.gesture : undefined} />;
}
