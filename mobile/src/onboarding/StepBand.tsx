import { Canvas, Rect, Shader, Skia, type SkRuntimeEffect } from '@shopify/react-native-skia';
import React, { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Easing, ReduceMotion, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';

import { tokens } from '../generated/tokens';
import { FRINGE } from '../insights/Band';
import { ease, phase } from '../insights/motion';
import { Block, useClock } from '../insights/reveal';
import { useReduceMotion } from '../ui/motion';
import { modeOf, type PixelMotion } from '../motion/pixelMotion';
import { STEP_BAND_SKSL } from './bandShader';
import { BAND_SHIFT, GUTTER } from './flow';
import { colorUniform } from './shaders';

/**
 * A step's chapter band: the analysis page's `Band` (a full bleed field of one hue that prints
 * itself in 1 bit cells, top first, then dissolves into the warm ground through the Bayer
 * dither), laid from the top of the screen so it runs under the status bar and the flow's
 * chrome, with the step's words and its one big thing on it in the band's dark ink.
 *
 * Two things the analysis band does not do. It can hold still (`print={false}`), for a step that
 * arrives under onboarding's own pixel cover, where a second print would be pixels on pixels.
 * And it can change hue: give it a new `hue` and its cells switch to the new one in a random
 * order, a block at a time, over 240ms (`bandShader.ts`), which is how the creature step's band
 * turns into whichever creature is in the middle. Reduce Motion: it is simply there and a new
 * hue is a cut.
 *
 * It must sit inside a step's `RevealPage` and `Section` (`stepPage.ts`): its own clock is a
 * `Block`'s, so the figures and words on it can read the same clock (`BandFigure`, `BandWords`).
 */
const CELL = tokens.dither.cell;
/** How long the band takes to print (the analysis band's). */
const PRINT_MS = 560;

let effect: SkRuntimeEffect | null | undefined;
function bandEffect(): SkRuntimeEffect | null {
  if (effect === undefined) {
    effect = Skia.RuntimeEffect.Make(STEP_BAND_SKSL);
    if (!effect && __DEV__) console.warn('[onboarding/StepBand] the band shader did not compile; bands draw flat');
  }
  return effect;
}

export interface BandHue {
  ink: string;
  partner: string;
}

export interface StepBandProps {
  hue: BandHue;
  children?: ReactNode;
  /** Print itself when the step is ready (default), or be there from the first frame. */
  print?: boolean;
  /** Room at the top for the status bar and the chrome, in points. */
  inset?: number;
  /** Take the height the step gives it (the creature step's band is the whole stage). */
  fill?: boolean;
  /** The dissolve under it. Default the analysis band's 36pt. */
  fringe?: number;
  /** How it prints (`bandShader.STEP_MOTION`, one per step). */
  motion?: PixelMotion;
  contentStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
}

export function StepBand({ hue, children, print = true, inset = 0, fill = false, fringe = FRINGE, motion = 'rain', contentStyle, style }: StepBandProps) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((b) => (b.w === width && b.h === height ? b : { w: width, h: height }));
  }, []);
  return (
    <Block enter={false} style={[fill ? { flex: 1 } : null, style]}>
      <View style={fill ? { flex: 1 } : undefined}>
        <BandCanvas width={box.w} solid={box.h} fringe={fringe} ink={hue.ink} print={print} motion={motion} />
        <View
          onLayout={onLayout}
          style={[{ paddingTop: inset, paddingHorizontal: GUTTER, paddingBottom: 22 }, fill ? { flex: 1 } : null, contentStyle]}
        >
          {children}
        </View>
        <View pointerEvents="none" style={{ height: fringe }} />
      </View>
    </Block>
  );
}

function BandCanvas({ width, solid, fringe, ink, print, motion }: { width: number; solid: number; fringe: number; ink: string; print: boolean; motion: PixelMotion }) {
  const clock = useClock();
  const reduced = useReduceMotion();
  const source = bandEffect();
  const ink0 = useSharedValue(colorUniform(ink));
  const ink1 = useSharedValue(colorUniform(ink));
  const shift = useSharedValue(1);
  const shown = useRef(ink);

  useEffect(() => {
    if (shown.current === ink) return;
    const from = shown.current;
    shown.current = ink;
    if (reduced) {
      ink0.value = colorUniform(ink);
      ink1.value = colorUniform(ink);
      shift.value = 1;
      return;
    }
    // A change that lands mid switch starts from the hue it was switching to: the cells still on
    // the older one cut to it, and every cell then switches to the newest once.
    ink0.value = colorUniform(from);
    ink1.value = colorUniform(ink);
    shift.value = 0;
    // Never: Reduce Motion is handled above from the live setting. Linear: cells at an even rate.
    shift.value = withTiming(1, { duration: BAND_SHIFT.ms, easing: Easing.linear, reduceMotion: ReduceMotion.Never });
  }, [ink, reduced, ink0, ink1, shift]);

  const still = print ? 0 : 1;
  const mode = modeOf(motion);
  const cols = Math.max(1, Math.ceil(width / CELL));
  const rows = Math.max(1, Math.ceil((solid + fringe) / CELL));
  const uniforms = useDerivedValue(() => ({
    cell: CELL,
    solid,
    fringe,
    reveal: still === 1 ? 1 : ease(phase(clock.value, 0, PRINT_MS)),
    shift: shift.value,
    block: BAND_SHIFT.block,
    ink0: ink0.value,
    ink1: ink1.value,
    mode,
    cols,
    rows,
    origin: [0.5, 1],
  }));

  const height = solid + fringe;
  if (width <= 0 || solid <= 0) return null;
  if (!source) {
    return <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width, height: solid, backgroundColor: ink }} />;
  }
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width, height }}>
      <Canvas style={{ width, height }}>
        <Rect x={0} y={0} width={width} height={height}>
          <Shader source={source} uniforms={uniforms} />
        </Rect>
      </Canvas>
    </View>
  );
}
