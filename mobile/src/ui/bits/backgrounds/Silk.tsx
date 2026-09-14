/**
 * Silk: react-bits' folded cloth (`0.6 + 0.4 sin(5 (x + y + cos(3x + 5y)) + sin(20 (x + y)))`)
 * printed in three levels of one hue, the folds sliding slowly across. A quiet ground for a card
 * or a band where FieldDither's clouds would be too loud.
 *
 *   <Silk width={w} height={180} hue="heather" rotation={0.4} />
 *
 * Props: every `BackgroundProps` (spec.ts: width, height, hue, ink, partner, paper, levels,
 * speed, scale, cell, fps, seed, paused, develop, reveal, edgeFade, clear, resolution, style,
 * accessibilityLabel), plus
 *   rotation         radians the folds turn (react-bits `rotation 0`)
 *   noiseIntensity   react-bits' grain, one hash per cell: 1.5
 *   brightness       the folds' scalar before the dither: 0.75 keeps the cloth mostly partner
 *                    with ink on the crests (react-bits tints a 48% grey, so its cloth is mostly
 *                    shadow; at 1 a spectrum ink is mostly solid ink)
 * Defaults: heather, react-bits' fold numbers (`speed 5`), time at AMBIENT (x 0.3). Reduce Motion:
 * the seed frame.
 *
 * Ported from react-bits `Backgrounds/Silk/Silk.tsx` by David Haz.
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
 * What changed in the port: a three.js plane becomes one SkSL program; one colour's brightness
 * over black becomes paper, partner and ink (which is also what keeps Silk visible: DESIGN-V2 4.5
 * cut the first plan's Silk because `raised` over `bg` was 1.21:1); the silk unit is 390 pt
 * rather than the stretched canvas; the per pixel sine grain is one Hoskins hash per cell; no
 * light mode (the light scheme's tones do it). The shader is in `shaders.ts`.
 */
import type { Uniforms } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { useDerivedValue } from 'react-native-reanimated';

import { FieldSurface, useBackgroundBase } from './FieldSurface';
import { frameUniforms, silkUniforms, type BackgroundProps } from './spec';

export interface SilkProps extends BackgroundProps {
  rotation?: number;
  noiseIntensity?: number;
  brightness?: number;
}

export function Silk(props: SilkProps) {
  const base = useBackgroundBase('Silk', props);
  const { clock, reveal, common } = base;
  const own = useMemo(
    () => silkUniforms({ scale: props.scale, rotation: props.rotation, noiseIntensity: props.noiseIntensity, brightness: props.brightness }),
    [props.scale, props.rotation, props.noiseIntensity, props.brightness],
  );
  const fixed = useMemo(() => ({ ...common, ...own }), [common, own]);
  const uniforms = useDerivedValue<Uniforms>(() => frameUniforms('Silk', fixed, { t: clock.t.value, now: 0, reveal: reveal.value }));
  return <FieldSurface base={base} uniforms={uniforms} />;
}
