/**
 * A Wrapped card's art, drawn and alive: the card's data field (`art.ts`, one value per cell)
 * through `DATA_FIELD_SKSL` (`field.ts`) on one Skia canvas. It prints itself as the card
 * arrives (the caller's `develop`, off the card's reveal clock), then react-bits PixelBlast's
 * clouds drift through it at the ambient 20 fps and one of its ripples runs out from the finger,
 * all of which only thin the data. Paused whenever the card is not the front one; one still
 * frame under Reduce Motion, in the grid and on the share card, where it is exactly the data's
 * three level print.
 *
 * Ported in part from react-bits PixelBlast and PixelTransition by David Haz (MIT + Commons
 * Clause; the notice and what changed are in `field.ts`; used as part of this application, not
 * redistributed). The clock is the ported backgrounds' own (`useFieldClock`): off, not idling,
 * when the screen or the app is not in front.
 */
import { Canvas, FilterMode, ImageShader, MipmapMode, Rect, Shader, Skia, type SkRuntimeEffect } from '@shopify/react-native-skia';
import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { runOnUI, useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { AMBIENT } from '../ui/bits/backgrounds/spec';
import { useFieldClock } from '../ui/bits/backgrounds/useFieldClock';
import { Dither, fieldImage } from '../ui/Dither';
import { premultiplied, type Field } from '../ui/dithering';
import { toneLayers } from './art';
import { DATA_FIELD_SKSL, FIELD, type PrintAxis } from './field';

let effect: SkRuntimeEffect | null | undefined;
function dataEffect(): SkRuntimeEffect | null {
  if (effect === undefined) {
    effect = Skia.RuntimeEffect.Make(DATA_FIELD_SKSL);
    if (!effect && __DEV__) console.warn('[wrapped/DataField] DATA_FIELD_SKSL did not compile; the art draws still');
  }
  return effect;
}

const NEAREST = { filter: FilterMode.Nearest, mipmap: MipmapMode.None } as const;
const NO_TAP = [0, 0, 0, 0];
const PAPER = [0, 0, 0, 0];

export interface DataFieldProps {
  /** The data, one value per cell, exactly `width / cell` by `height / cell`. */
  field: Field;
  cell: number;
  /** The field's box in points: whole cells (`fitCells`). */
  width: number;
  height: number;
  /** The full ink (the band's dark ink) and the midtone (the hue's partner). */
  ink: string;
  partner: string;
  axis: PrintAxis;
  /** 0..1, the print; absent is printed. */
  develop?: SharedValue<number>;
  /** The card is in front: the clouds drift and the ripple runs. */
  live: boolean;
  /** No motion at all: the grid, the share card, Reduce Motion, a refusal. */
  still: boolean;
  /** Where the finger was, in the field's points: the one ripple starts there. */
  ripple?: { x: number; y: number } | null;
  /** Seconds into the clouds: each card its own weather. */
  seed: number;
}

export function DataField({ field, cell, width, height, ink, partner, axis, develop, live, still, ripple, seed }: DataFieldProps) {
  const source = dataEffect();
  const image = useMemo(() => fieldImage(field), [field]);
  const clock = useFieldClock({ rate: FIELD.rate, speed: 1, fps: AMBIENT.fps, seed, paused: !live, still });
  const printed = useSharedValue(1);
  const print = develop ?? printed;
  const tap = useSharedValue<number[]>(NO_TAP);

  // The one ripple, when the card first comes to the front with a finger behind it.
  const rx = ripple?.x ?? null;
  const ry = ripple?.y ?? null;
  useEffect(() => {
    if (!live || still || rx === null || ry === null) return;
    const now = clock.now;
    runOnUI((x: number, y: number) => {
      'worklet';
      tap.value = [x, y, now.value + FIELD.rippleDelayS, 1];
    })(rx, ry);
    // Only the arrival starts one; a later render with the same finger does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  const inkU = useMemo(() => premultiplied(ink), [ink]);
  const partnerU = useMemo(() => premultiplied(partner), [partner]);
  const shimmer = live && !still ? FIELD.shimmer : 0;
  const uniforms = useDerivedValue(
    () => ({
      size: [width, height],
      cell,
      t: clock.t.value,
      now: clock.now.value,
      develop: print.value,
      axis,
      shimmer,
      noiseUnit: FIELD.noiseUnit,
      tap: tap.value,
      rippleSpeed: FIELD.rippleSpeed,
      rippleWidth: FIELD.rippleWidth,
      rippleDepth: FIELD.rippleDepth,
      rippleReach: FIELD.rippleReach,
      ink: inkU,
      partner: partnerU,
      paper: PAPER,
    }),
    [width, height, cell, axis, shimmer, inkU, partnerU, print, tap, clock.t, clock.now],
  );

  if (!image || width <= 0 || height <= 0) return <View style={{ width, height }} />;
  if (!source) return <StillLayers field={field} cell={cell} width={width} height={height} ink={ink} partner={partner} />;
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width, height }}>
      <Canvas style={{ width, height }}>
        <Rect x={0} y={0} width={width} height={height}>
          <Shader source={source} uniforms={uniforms}>
            <ImageShader image={image} fit="fill" rect={{ x: 0, y: 0, width, height }} sampling={NEAREST} />
          </Shader>
        </Rect>
      </Canvas>
    </View>
  );
}

/**
 * If the program ever fails to compile: the same three levels, still, through the kit's one
 * level dither twice (`toneLayers`, the partner layer and the ink over it).
 */
function StillLayers({ field, cell, width, height, ink, partner }: { field: Field; cell: number; width: number; height: number; ink: string; partner: string }) {
  const images = useMemo(() => {
    const layers = toneLayers(field);
    return { partner: fieldImage(layers.partner), ink: fieldImage(layers.ink) };
  }, [field]);
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width, height }}>
      <Dither width={width} height={height} cell={cell} image={images.partner} ink={partner} fit="fill" sampling="nearest" />
      <Dither width={width} height={height} cell={cell} image={images.ink} ink={ink} fit="fill" sampling="nearest" style={StyleSheet.absoluteFill} />
    </View>
  );
}
