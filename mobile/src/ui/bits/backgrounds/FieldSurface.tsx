/**
 * What every shader background shares: the base hook (tones for the scheme, the resolution plan,
 * the clock, the develop, the common uniforms) and `FieldSurface`, the canvas that draws a
 * program either in one pass or into a texture at one pixel per cell.
 *
 * Ported from react-bits `Backgrounds/*` (Dither, PixelBlast, Silk, Grainient, Radar, DotGrid,
 * Topography) by David Haz.
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
 * What changed in the port: the originals each own a WebGL context (three.js, ogl) at the
 * display's resolution. Here a field is one Skia RuntimeEffect.
 *
 *   one pass   (a field under LARGE_FIELD_PT2) every device pixel evaluates its cell's centre.
 *              The canvas redraws only when a uniform changes: 20 times a second while the field
 *              moves, never while it is paused or still.
 *   texture    (a larger field) the program is drawn on the UI thread into an offscreen surface
 *              one pixel per cell (`unit = cell`), which the canvas scales up with nearest
 *              sampling: ~40 thousand evaluations a frame for a full screen instead of ~3
 *              million, and the same cells. This is the path DESIGN-V2 3.3 calls the riskiest on
 *              Skia 2.0.0-next.4, so any failure (no surface, a throw) drops the field back to one
 *              pass with its octaves cut to 2, for good, rather than drawing nothing.
 */
import {
  BlendMode,
  Canvas,
  FilterMode,
  Image as SkiaImage,
  MipmapMode,
  processUniforms,
  Rect,
  Shader,
  Skia,
  type SkImage,
  type SkRuntimeEffect,
  type Uniforms,
} from '@shopify/react-native-skia';
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { GestureDetector, type ComposedGesture, type GestureType } from 'react-native-gesture-handler';
import { runOnJS, useAnimatedReaction, useDerivedValue, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

import { tokens } from '../../../generated/tokens';
import { timing, useReduceMotion } from '../../motion';
import { useScheme } from '../../scheme';
import { PROGRAMS, type BackgroundName } from './shaders';
import {
  AMBIENT,
  commonUniforms,
  DEFAULT_HUE,
  PASS_OCTAVE_CAP,
  planField,
  RATE,
  REVEAL_MS,
  resolveTones,
  type BackgroundProps,
  type CommonUniforms,
  type FieldPlan,
  type Tones,
} from './spec';
import { useFieldClock, type FieldClock } from './useFieldClock';

// Compiled on first use, not at import: a screen that imports the kit and never draws a field
// should not pay for seven shader compiles at startup.
const effects: Partial<Record<BackgroundName, SkRuntimeEffect | null>> = {};

export function backgroundEffect(name: BackgroundName): SkRuntimeEffect | null {
  if (!(name in effects)) {
    const effect = Skia.RuntimeEffect.Make(PROGRAMS[name].source);
    if (!effect && __DEV__) console.warn(`[ui/bits/backgrounds] ${name} did not compile; it draws nothing`);
    effects[name] = effect;
  }
  return effects[name] ?? null;
}

const NEAREST = { filter: FilterMode.Nearest, mipmap: MipmapMode.None } as const;

/**
 * The develop: 0 to 1 over REVEAL_MS on mount when `develop` is set (cells switch on in Bayer
 * order, the dither's `reveal`), or the caller's own value. Reduce Motion: it lands at once.
 */
function useReveal(develop: boolean, external: SharedValue<number> | undefined, still: boolean): SharedValue<number> {
  const own = useSharedValue(develop && !still ? 0 : 1);
  useEffect(() => {
    if (!develop || still) {
      own.value = 1;
      return;
    }
    own.value = 0;
    own.value = withTiming(1, timing(REVEAL_MS));
  }, [develop, still, own]);
  return external ?? own;
}

export interface BackgroundBase {
  name: BackgroundName;
  width: number;
  height: number;
  cell: number;
  plan: FieldPlan;
  tones: Tones;
  /** The shared uniforms with no time and no develop: spread them first. */
  common: CommonUniforms;
  clock: FieldClock;
  reveal: SharedValue<number>;
  /** Reduce Motion is on: the field holds its seed frame and fingers do nothing. */
  still: boolean;
  style: BackgroundProps['style'];
  accessibilityLabel: string | undefined;
}

/** Everything a background resolves from the shared props. Call it once, first. */
export function useBackgroundBase(
  name: BackgroundName,
  p: BackgroundProps,
  defaults: { edgeFade?: number; interactive?: boolean } = {},
): BackgroundBase {
  const scheme = useScheme();
  const still = useReduceMotion();
  const cell = p.cell !== undefined && p.cell > 0 ? p.cell : tokens.dither.cell;
  const width = Math.max(0, p.width);
  const height = Math.max(0, p.height);
  const resolved = resolveTones(scheme, p.hue, DEFAULT_HUE[name], { ink: p.ink, partner: p.partner, paper: p.paper });
  const { ink, partner, paper } = resolved;
  const tones = useMemo(() => ({ ink, partner, paper }), [ink, partner, paper]);
  const plan = useMemo(() => planField(width, height, cell, p.resolution), [width, height, cell, p.resolution]);
  const levels = p.levels === 2 ? 2 : 3;
  const edgeFade = p.edgeFade ?? defaults.edgeFade ?? 0;
  const cx = p.clear?.x;
  const cy = p.clear?.y;
  const cw = p.clear?.width;
  const ch = p.clear?.height;
  const common = useMemo(
    () =>
      commonUniforms({
        width,
        height,
        cell,
        levels,
        edgeFade,
        clear: cw !== undefined && ch !== undefined ? { x: cx ?? 0, y: cy ?? 0, width: cw, height: ch } : null,
        tones,
      }),
    [width, height, cell, levels, edgeFade, cx, cy, cw, ch, tones],
  );
  const clock = useFieldClock({
    rate: RATE[name],
    speed: p.speed !== undefined && Number.isFinite(p.speed) ? Math.max(0, p.speed) : 1,
    fps: p.fps !== undefined && p.fps > 0 ? p.fps : AMBIENT.fps,
    seed: p.seed ?? 0,
    paused: p.paused,
    still,
    interactive: defaults.interactive === true,
  });
  const reveal = useReveal(p.develop === true, p.reveal, still);
  return { name, width, height, cell, plan, tones, common, clock, reveal, still, style: p.style, accessibilityLabel: p.accessibilityLabel };
}

/**
 * The program drawn at one pixel per cell into an offscreen surface on the UI thread. Null on
 * any failure, which sends the field back to one pass.
 */
function drawCells(effect: SkRuntimeEffect, u: Uniforms, cell: number, cols: number, rows: number): SkImage | null {
  'worklet';
  try {
    const surface = Skia.Surface.MakeOffscreen(cols, rows);
    if (surface === null) return null;
    const paint = Skia.Paint();
    paint.setBlendMode(BlendMode.Src);
    const shader = effect.makeShader(processUniforms(effect, { ...u, unit: cell }));
    paint.setShader(shader);
    surface.getCanvas().drawPaint(paint);
    surface.flush();
    const image = surface.makeImageSnapshot();
    shader.dispose();
    paint.dispose();
    surface.dispose();
    return image;
  } catch {
    return null;
  }
}

export interface FieldSurfaceProps {
  base: BackgroundBase;
  /** Every uniform the program declares: `base.common`, the component's own, then time. */
  uniforms: SharedValue<Uniforms>;
  /** A finger on the field (taps, a pool, shoves). Without one the field never takes a touch. */
  gesture?: GestureType | ComposedGesture;
}

export function FieldSurface({ base, uniforms, gesture }: FieldSurfaceProps) {
  const { name, width, height, cell, plan } = base;
  const effect = backgroundEffect(name);
  const [textureFailed, setTextureFailed] = useState(false);
  const textured = plan.path === 'texture' && !textureFailed && effect !== null;
  const capOctaves = plan.large && !textured;
  const cols = plan.cols;
  const rows = plan.rows;

  const passUniforms = useDerivedValue<Uniforms>(() => {
    const u = uniforms.value;
    const o = u.octaves;
    return capOctaves && typeof o === 'number' && o > PASS_OCTAVE_CAP ? { ...u, octaves: PASS_OCTAVE_CAP } : u;
  });

  const texture = useSharedValue<SkImage | null>(null);
  useAnimatedReaction(
    () => (textured ? uniforms.value : null),
    (u) => {
      if (u === null || effect === null) return;
      const image = drawCells(effect, u, cell, cols, rows);
      if (image === null) {
        runOnJS(setTextureFailed)(true);
        return;
      }
      const old = texture.value;
      texture.value = image;
      // The recorded picture holds its own reference to the last image; this only lets go of
      // ours, so the textures never wait for a garbage collection that native memory does not
      // trigger.
      if (old !== null) old.dispose();
    },
    [textured, effect, cell, cols, rows],
  );

  const decorative = base.accessibilityLabel === undefined;
  const surface = (
    <View
      pointerEvents={gesture ? 'auto' : 'none'}
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : 'image'}
      accessibilityLabel={base.accessibilityLabel}
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'auto'}
      style={[{ width, height, overflow: 'hidden' }, base.style]}
    >
      {effect !== null && width > 0 && height > 0 ? (
        <Canvas style={{ width, height }}>
          {textured ? (
            <SkiaImage image={texture} x={0} y={0} width={cols * cell} height={rows * cell} fit="fill" sampling={NEAREST} />
          ) : (
            <Rect x={0} y={0} width={width} height={height}>
              <Shader source={effect} uniforms={passUniforms} />
            </Rect>
          )}
        </Canvas>
      ) : null}
    </View>
  );
  return gesture ? <GestureDetector gesture={gesture}>{surface}</GestureDetector> : surface;
}
