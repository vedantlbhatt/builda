/**
 * One flat band of colour across a piece of text: a copy of the text in the band's colour,
 * seen through a moving window. The window slides (and leans, for a diagonal band); the copy
 * inside slides back by the same amount, so the letters stay exactly on top of the text below
 * and only the band's edges travel. ShinyText stacks three of these into a stepped highlight;
 * GradientText tiles them into stepped tones.
 *
 * Part of the react-bits ShinyText and GradientText ports (by David Haz; MIT + Commons Clause,
 * Copyright (c) 2026 David Haz; used as part of this application, not redistributed as
 * components).
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
 * Why a window and not Skia or a mask: react-bits clips a gradient to the glyphs with
 * `background-clip: text`. Here there is no masked view in the app, and Skia text takes a
 * typeface looked up by family name, which the system face is not published under on iOS (the
 * app ships no font files), so Skia text would risk a different face from every other line.
 * The text stays RN text and the clip is a view. The math: the window's transform is translate(x) then skewX(-a) about
 * its centre; the copy's is translate(-x) then skewX(a) about its own. Both boxes share a
 * vertical centre and skewX commutes with a horizontal shift, so the two compose to identity.
 */
import React from 'react';
import { Text, type TextStyle } from 'react-native';
import Animated, { useAnimatedStyle, type DerivedValue, type SharedValue } from 'react-native-reanimated';

import { gradientBandX, sweepCenter } from './bands';
import type { TextLook } from './shared';

export type BandPlace =
  /** ShinyText: the band's centre sweeps with pass progress (0 to 1) across the text. */
  | { kind: 'sweep'; reach: number; reverse: boolean }
  /** GradientText: band `k` of a tiling, shifted by `progress` points. */
  | { kind: 'tile'; k: number; band: number; period: number; reach: number };

export interface ClipBandProps {
  text: string;
  textStyle: TextStyle[];
  scaling: TextLook['scaling'];
  /** The text box: the copy is laid out at exactly this size, so it wraps like the text. */
  width: number;
  height: number;
  bandWidth: number;
  skewDeg: number;
  /** Pass progress (0 to 1) for a sweep; the shift in points for a tile. */
  progress: SharedValue<number> | DerivedValue<number>;
  place: BandPlace;
}

export function ClipBand({ text, textStyle, scaling, width, height, bandWidth, skewDeg, progress, place }: ClipBandProps) {
  const sweep = place.kind === 'sweep';
  const reach = place.reach;
  const reverse = place.kind === 'sweep' ? place.reverse : false;
  const k = place.kind === 'tile' ? place.k : 0;
  const band = place.kind === 'tile' ? place.band : 0;
  const period = place.kind === 'tile' ? place.period : 0;
  const lean = `${-skewDeg}deg`;
  const unlean = `${skewDeg}deg`;

  const windowStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const x = sweep ? sweepCenter(reverse ? 1 - p : p, width, reach) - bandWidth / 2 : gradientBandX(k, p, band, period, reach);
    return { transform: [{ translateX: x }, { skewX: lean }] };
  });
  const copyStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const x = sweep ? sweepCenter(reverse ? 1 - p : p, width, reach) - bandWidth / 2 : gradientBandX(k, p, band, period, reach);
    return { transform: [{ translateX: -x }, { skewX: unlean }] };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', left: 0, top: 0, width: bandWidth, height, overflow: 'hidden' }, windowStyle]}
    >
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width, height }, copyStyle]}>
        <Text {...scaling} style={textStyle}>
          {text}
        </Text>
      </Animated.View>
    </Animated.View>
  );
}
