/**
 * Radar: react-bits' rings, spokes and one sweep, printed in three levels of one hue. "Waiting":
 * the onboarding connect step and Pair while the Mac has not answered, and live surfaces waiting
 * on a session. Stop it with `paused` the moment the wait ends (DESIGN-V2 3.2, 4.1 #3).
 *
 *   <Radar width={w} height={220} paused={paired} />
 *
 * Props: every `BackgroundProps` (spec.ts: width, height, hue, ink, partner, paper, levels,
 * speed, scale, cell, fps, seed, paused, develop, reveal, edgeFade, clear, resolution, style,
 * accessibilityLabel), plus
 *   center           where the radar sits, points; default the middle of the box
 *   and react-bits' tuning: ringCount 10, spokeCount 10, ringThickness 0.05, spokeThickness 0.01,
 *   sweepSpeed 1, sweepWidth 5 (react-bits 2), sweepLobes 1, falloff 2, brightness 1
 * `scale` multiplies the reach: the radar fades out 0.75 of the shorter side from its centre.
 * Defaults: amber (the pairing wait), react-bits' own clock (a turn every 6.3 s; a radar says
 * "waiting", it is not an ambient field). Reduce Motion: the seed frame (a still radar).
 *
 * Ported from react-bits `Backgrounds/Radar/Radar.tsx` by David Haz.
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
 * What changed in the port: an ogl program becomes one SkSL program; the additive glow over a
 * background colour becomes paper, partner and ink; the radar is placed and sized in points and
 * seen whole; rings and spokes never go thinner than three quarters of a cell; the sweep is a
 * narrower lobe; no mouse drift, no light mode. The shader is in `shaders.ts`.
 */
import type { Uniforms } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { useDerivedValue } from 'react-native-reanimated';

import { FieldSurface, useBackgroundBase } from './FieldSurface';
import { frameUniforms, radarUniforms, type BackgroundProps, type FieldPoint, type RadarTuning } from './spec';

export interface RadarProps extends BackgroundProps, RadarTuning {
  center?: FieldPoint | null;
}

export function Radar(props: RadarProps) {
  const base = useBackgroundBase('Radar', props);
  const { clock, reveal, common } = base;
  const { width, height, scale, ringCount, spokeCount, ringThickness, spokeThickness, sweepSpeed, sweepWidth, sweepLobes, falloff, brightness } =
    props;
  const cx = props.center?.x;
  const cy = props.center?.y;
  const own = useMemo(
    () =>
      radarUniforms({
        width,
        height,
        scale,
        center: cx !== undefined && cy !== undefined ? { x: cx, y: cy } : null,
        ringCount,
        spokeCount,
        ringThickness,
        spokeThickness,
        sweepSpeed,
        sweepWidth,
        sweepLobes,
        falloff,
        brightness,
      }),
    [width, height, scale, cx, cy, ringCount, spokeCount, ringThickness, spokeThickness, sweepSpeed, sweepWidth, sweepLobes, falloff, brightness],
  );
  const fixed = useMemo(() => ({ ...common, ...own }), [common, own]);
  const uniforms = useDerivedValue<Uniforms>(() => frameUniforms('Radar', fixed, { t: clock.t.value, now: 0, reveal: reveal.value }));
  return <FieldSurface base={base} uniforms={uniforms} />;
}
