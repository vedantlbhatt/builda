import { Canvas, ImageShader, Rect, Shader, Skia, type SkRuntimeEffect } from '@shopify/react-native-skia';
import React, { useEffect } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { colors } from '../theme';
import { EASE, useReduceMotion } from '../ui/motion';
import { finish, useDissolve } from './dissolve';
import { DISSOLVE } from './flow';
import { colorUniform, DISSOLVE_SKSL, waveSpan } from './shaders';

const c = colors('dark');
/**
 * A switching cell is a `card` square for its moment: one step off the canvas, so the wave's
 * front reads as pixels turning over, never as a flash of amber or a grey checkerboard.
 */
const FLASH = colorUniform(c.card);
/** Beyond the last cell's turn and its band: the shader returns transparent everywhere. */
const WARM_PROGRESS = 2;

let effect: SkRuntimeEffect | null | undefined;
function dissolveEffect(): SkRuntimeEffect | null {
  if (effect === undefined) {
    effect = Skia.RuntimeEffect.Make(DISSOLVE_SKSL);
    if (!effect && __DEV__) console.warn('[onboarding] DISSOLVE_SKSL did not compile; hello fades instead');
  }
  return effect;
}

/**
 * The picture of hello, breaking into 32pt cells that turn over in a ragged wave out of the
 * Continue that was pressed (DESIGN-DIRECTION 4, react-bits PixelTransition as SkSL). Sits
 * above the onboarding stack, touches pass straight through it, and it is not in the tree at
 * all when idle.
 *
 * Reduce Motion, or a shader that did not compile: the picture fades out over 150ms instead.
 */
export function PixelDissolve() {
  const state = useDissolve();
  const { width, height } = useWindowDimensions();
  const reduced = useReduceMotion();
  const progress = useSharedValue(0);
  const opacity = useSharedValue(1);
  const source = dissolveEffect();

  useEffect(() => {
    if (state.phase === 'warm') {
      // Past the end: every cell has turned, so the canvas draws nothing a person can see.
      progress.value = WARM_PROGRESS;
      opacity.value = 1;
      return;
    }
    if (state.phase === 'cover') {
      progress.value = 0;
      opacity.value = 1;
      return;
    }
    if (state.phase !== 'reveal') return;
    const id = state.id;
    const done = () => finish(id);
    if (reduced || !source) {
      // The fade is what Reduce Motion asks for, so it is never skipped itself.
      opacity.value = withTiming(0, { duration: DISSOLVE.reducedMs, easing: EASE, reduceMotion: ReduceMotion.Never }, (ok) => {
        if (ok) runOnJS(done)();
      });
    } else {
      // Linear: the wave front moves out of the finger at an even speed.
      progress.value = withTiming(1 + DISSOLVE.band, { duration: DISSOLVE.ms, easing: Easing.linear, reduceMotion: ReduceMotion.Never }, (ok) => {
        if (ok) runOnJS(done)();
      });
    }
  }, [state, reduced, source, progress, opacity]);

  const geometry = state.phase === 'cover' || state.phase === 'reveal' ? state.geometry : null;
  const origin: [number, number] = geometry?.origin ? [geometry.origin[0], geometry.origin[1]] : [width / 2, height];
  const anchor: [number, number] = geometry?.anchor ? [geometry.anchor[0], geometry.anchor[1]] : [0, 0];
  const span = waveSpan(origin, width, height);
  const uniforms = useDerivedValue(() => ({
    cell: DISSOLVE.cell,
    anchor,
    origin,
    span,
    wave: DISSOLVE.wave,
    jitter: DISSOLVE.jitter,
    progress: progress.value,
    band: DISSOLVE.band,
    flash: FLASH,
  }));
  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));

  if (state.phase === 'idle') return null;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, fade]}>
      <View style={{ width, height }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Canvas style={{ width, height }}>
          {source && (!reduced || state.phase === 'warm') ? (
            <Rect x={0} y={0} width={width} height={height}>
              <Shader source={source} uniforms={uniforms}>
                <ImageShader image={state.image} fit="fill" rect={{ x: 0, y: 0, width, height }} />
              </Shader>
            </Rect>
          ) : (
            <Rect x={0} y={0} width={width} height={height}>
              <ImageShader image={state.image} fit="fill" rect={{ x: 0, y: 0, width, height }} />
            </Rect>
          )}
        </Canvas>
      </View>
    </Animated.View>
  );
}
