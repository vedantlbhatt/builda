import { Canvas, ColorShader, Rect, Shader, Skia, type SkRuntimeEffect } from '@shopify/react-native-skia';
import React, { useEffect } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Easing, ReduceMotion, runOnJS, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';

import { covered, finish, useDissolve } from './dissolve';
import { DISSOLVE } from './flow';
import { colorUniform, DISSOLVE_SKSL, waveSpan } from './shaders';

let effect: SkRuntimeEffect | null | undefined;
function dissolveEffect(): SkRuntimeEffect | null {
  if (effect === undefined) {
    effect = Skia.RuntimeEffect.Make(DISSOLVE_SKSL);
    if (!effect && __DEV__) console.warn('[onboarding] DISSOLVE_SKSL did not compile; hello pushes with a fade');
  }
  return effect;
}

/** Past the last cell's turn and its front: every cell clear. */
const CLEAR = 1 + DISSOLVE.band;

/** Whether the cover can be drawn at all (the shader compiled). Hello asks before it covers. */
export function canCover(): boolean {
  return dissolveEffect() !== null;
}

/**
 * Hello into the name step, react-bits PixelTransition across two routes (`dissolve.ts`): 32pt
 * cells in the builder's colour, laid on Bit's grid, GATHER over the screen in a ragged wave that
 * closes on the finger (the far cells first), the name step is pushed under the full cover, and
 * the cells CLEAR in a wave out of the finger, so the name step's Continue, standing where
 * hello's was, is the first thing uncovered. One shader (`DISSOLVE_SKSL`, the flow's own, its
 * hash held bit for bit to the kit's PixelTransition by the kit's tests) over one colour: the
 * front of each wave is the colour's partner tone, the dither's middle tone. Linear in time: the
 * front moves at an even speed.
 *
 * It sits above the onboarding stack and the chrome, touches pass straight through it, and it
 * is not in the tree at all when idle. Hello does not ask for it under Reduce Motion (the name
 * step fades in instead), nor when the shader did not compile.
 */
export function PixelDissolve() {
  const state = useDissolve();
  const { width, height } = useWindowDimensions();
  const progress = useSharedValue(CLEAR);
  const source = dissolveEffect();

  useEffect(() => {
    if (state.phase === 'cover') {
      const id = state.id;
      progress.value = CLEAR;
      progress.value = withTiming(0, { duration: DISSOLVE.ms, easing: Easing.linear, reduceMotion: ReduceMotion.Never }, (ok) => {
        if (ok) runOnJS(covered)(id);
      });
      return;
    }
    if (state.phase === 'covered') {
      progress.value = 0;
      return;
    }
    if (state.phase === 'reveal') {
      const id = state.id;
      progress.value = withTiming(CLEAR, { duration: DISSOLVE.ms, easing: Easing.linear, reduceMotion: ReduceMotion.Never }, (ok) => {
        if (ok) runOnJS(finish)(id);
      });
    }
  }, [state, progress]);

  const geometry = state.phase === 'idle' ? null : state.geometry;
  const origin: [number, number] = geometry?.origin ? [geometry.origin[0], geometry.origin[1]] : [width / 2, height];
  const anchor: [number, number] = geometry?.anchor ? [geometry.anchor[0], geometry.anchor[1]] : [0, 0];
  const span = waveSpan(origin, width, height);
  const front = colorUniform(state.phase === 'idle' ? '#000000' : state.front);
  const uniforms = useDerivedValue(() => ({
    cell: DISSOLVE.cell,
    anchor,
    origin,
    span,
    wave: DISSOLVE.wave,
    jitter: DISSOLVE.jitter,
    progress: progress.value,
    band: DISSOLVE.band,
    flash: front,
  }));

  if (state.phase === 'idle' || !source) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Canvas style={{ width, height }}>
        <Rect x={0} y={0} width={width} height={height}>
          <Shader source={source} uniforms={uniforms}>
            <ColorShader color={state.ink} />
          </Shader>
        </Rect>
      </Canvas>
    </View>
  );
}
