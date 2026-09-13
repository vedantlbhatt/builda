/**
 * The 1-bit dither as a Skia RuntimeEffect: ordered Bayer 8x8 (default, it matches the
 * pixel mascot) or a 45 degree halftone, one ink over paper (DESIGN-DIRECTION 6).
 *
 * Algorithm from react-bits Dither and PixelBlast by David Haz, MIT + Commons Clause
 * (Copyright (c) 2026 David Haz; the full notice is in `digits.ts`; used as part of this
 * application, not redistributed). The shader source and its changes are in `dithering.ts`.
 *
 * `t` drifts the threshold field very slowly on the archetype hero ONLY; every other use is
 * static, which is also the cheap case (the canvas redraws only when a prop changes).
 * Export a card through `canvasRef.makeImageSnapshot()` on the Canvas this renders.
 */
import {
  AlphaType,
  Canvas,
  ColorType,
  FilterMode,
  ImageShader,
  MipmapMode,
  Rect,
  Shader,
  Skia,
  type SkImage,
  type SkRuntimeEffect,
} from '@shopify/react-native-skia';
import React, { useEffect, useMemo, type ReactNode } from 'react';
import { PixelRatio, View, type StyleProp, type ViewStyle } from 'react-native';
import { useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { tokens } from '../generated/tokens';
import {
  DITHER_SKSL,
  fieldFromGrid,
  fieldFromSeries,
  fieldToRGBA,
  fitCells,
  modeUniform,
  premultiplied,
  type DitherMode,
  type Field,
} from './dithering';
import { useColors } from './scheme';

// Compiled on first use, not at import: a screen that imports the kit and never dithers
// should not pay for a shader compile at startup.
let effect: SkRuntimeEffect | null | undefined;
function ditherEffect(): SkRuntimeEffect | null {
  if (effect === undefined) {
    effect = Skia.RuntimeEffect.Make(DITHER_SKSL);
    if (!effect && __DEV__) console.warn('[ui/Dither] DITHER_SKSL did not compile; dithers render empty');
  }
  return effect;
}

export interface DitherProps {
  width: number;
  height: number;
  /** The source art: a greyscale illustration. Dark is ink, white and transparent are paper. */
  image?: SkImage | null;
  /** How `image` maps onto the box. Default `cover`. */
  fit?: 'cover' | 'contain' | 'fill';
  /** `linear` for art (default), `nearest` for data, so a datum keeps its hard edge. */
  sampling?: 'linear' | 'nearest';
  /** Instead of `image`: any Skia shader element, evaluated in points. */
  children?: ReactNode;
  /** Default `bayer`. */
  mode?: DitherMode;
  /** Default the accent. The Wrapped header is amber only. */
  ink?: string;
  /** Default transparent: the surface under the canvas shows through as paper. */
  paper?: string;
  /** The grain in points. Default 3 (tokens.dither.cell), whole device pixels at @2x and @3x. */
  cell?: number;
  /** Threshold drift. A shared value only on the archetype hero; everything else is 0. */
  t?: number | SharedValue<number>;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function Dither({
  width,
  height,
  image,
  fit = 'cover',
  sampling = 'linear',
  children,
  mode = 'bayer',
  ink,
  paper = 'transparent',
  cell = tokens.dither.cell,
  t = 0,
  accessibilityLabel,
  style,
}: DitherProps) {
  const c = useColors();
  const inkColor = ink ?? c.accent;

  // One shared value either way, so the uniforms are a single derived value and a static
  // dither never re-renders React to change them.
  const fixedT = useSharedValue(typeof t === 'number' ? t : 0);
  useEffect(() => {
    if (typeof t === 'number') fixedT.value = t;
  }, [fixedT, t]);
  const tValue = typeof t === 'number' ? fixedT : t;

  const inkU = useMemo(() => premultiplied(inkColor), [inkColor]);
  const paperU = useMemo(() => premultiplied(paper), [paper]);
  const modeU = modeUniform(mode);
  const px = 1 / PixelRatio.get();
  const uniforms = useDerivedValue(() => ({
    cell,
    mode: modeU,
    t: tValue.value,
    px,
    ink: inkU,
    paper: paperU,
  }));

  const decorative = accessibilityLabel === undefined;
  const source = ditherEffect();
  if (!source) return <View style={[{ width, height }, style]} />;
  return (
    <View
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : 'image'}
      accessibilityLabel={accessibilityLabel}
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'auto'}
      style={[{ width, height }, style]}
    >
      <Canvas style={{ width, height }}>
        <Rect x={0} y={0} width={width} height={height}>
          <Shader source={source} uniforms={uniforms}>
            {image ? (
              <ImageShader
                image={image}
                fit={fit}
                rect={{ x: 0, y: 0, width, height }}
                sampling={
                  sampling === 'nearest'
                    ? { filter: FilterMode.Nearest, mipmap: MipmapMode.None }
                    : { filter: FilterMode.Linear, mipmap: MipmapMode.None }
                }
              />
            ) : (
              children
            )}
          </Shader>
        </Rect>
      </Canvas>
    </View>
  );
}

/** A field as an SkImage, one pixel per dither cell. Null if Skia refuses the bytes. */
export function fieldImage(field: Field): SkImage | null {
  return Skia.Image.MakeImage(
    { width: field.width, height: field.height, alphaType: AlphaType.Opaque, colorType: ColorType.RGBA_8888 },
    Skia.Data.fromBytes(fieldToRGBA(field)),
    field.width * 4,
  );
}

export interface DitherFieldProps extends Omit<DitherProps, 'image' | 'fit' | 'sampling' | 'children'> {
  /** A 2D grid of 0..1, rows of columns: the contribution graph (days by weeks). */
  grid?: readonly (readonly number[])[];
  /** A 1D series of 0..1 across the width: a session strip, a trend. */
  series?: readonly number[];
  /** For `series`: `band` (density per column, default) or `area` (a filled chart). */
  shape?: 'band' | 'area';
  /** For `series` `area`: the density under the edge. Default 0.5. */
  fill?: number;
  /** For `grid`: cells of paper between data. Default 1. */
  gap?: number;
}

/**
 * The dither over REAL data. The field is computed in JS at exactly one pixel per dither
 * cell (`fieldFromGrid` / `fieldFromSeries`), sampled nearest, so every cell the shader
 * draws is one the CPU `ditherMask` predicts, and a datum's edge lands on a cell edge. The
 * box shrinks to whole cells (at most one cell less than asked) so nothing is cut in half.
 * Pass memoised arrays: the field is rebuilt when their identity changes.
 */
export function DitherField({
  width,
  height,
  grid,
  series,
  shape = 'band',
  fill,
  gap,
  cell = tokens.dither.cell,
  ...rest
}: DitherFieldProps) {
  const box = fitCells(width, height, cell);
  const image = useMemo(() => {
    const field = grid
      ? fieldFromGrid(grid, box.cols, box.rows, { gap })
      : fieldFromSeries(series ?? [], box.cols, box.rows, { shape, fill });
    return fieldImage(field);
  }, [grid, series, shape, fill, gap, box.cols, box.rows]);
  return <Dither {...rest} width={box.width} height={box.height} cell={cell} image={image} fit="fill" sampling="nearest" />;
}
