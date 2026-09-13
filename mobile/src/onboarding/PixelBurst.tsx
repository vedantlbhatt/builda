import { Canvas, Fill, Shader, Skia, type SkRuntimeEffect } from '@shopify/react-native-skia';
import React, { useEffect } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Easing, ReduceMotion, runOnJS, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';

import { colors } from '../theme';
import { BURST } from './flow';
import { BURST_SKSL, colorUniform } from './shaders';

const c = colors('dark');
const INK = colorUniform(c.accent);

let effect: SkRuntimeEffect | null | undefined;
function burstEffect(): SkRuntimeEffect | null {
  if (effect === undefined) {
    effect = Skia.RuntimeEffect.Make(BURST_SKSL);
    if (!effect && __DEV__) console.warn('[onboarding] BURST_SKSL did not compile; no burst');
  }
  return effect;
}

/**
 * One ring of amber pixel squares leaving the creature on "That's me" (DESIGN-DIRECTION 4),
 * about 600ms, then nothing: it plays once per `play` and is not a loop. The canvas is a
 * square of `size` points centred on the creature; place it so its centre is the creature's.
 * `onDone` fires when the ring has gone, which is when the flow finishes.
 */
export function PixelBurst({
  size,
  play,
  onDone,
  style,
}: {
  size: number;
  /** Starts the burst when it becomes true. */
  play: boolean;
  onDone?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const p = useSharedValue(0);
  const source = burstEffect();

  useEffect(() => {
    if (!play) return;
    if (!source) {
      onDone?.();
      return;
    }
    p.value = 0;
    // Never: the caller does not play the burst at all under Reduce Motion.
    p.value = withTiming(1, { duration: BURST.ms, easing: Easing.linear, reduceMotion: ReduceMotion.Never }, (ok) => {
      if (ok && onDone) runOnJS(onDone)();
    });
    // onDone is the caller's; the burst plays once per `play` edge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play, source]);

  const half = size / 2;
  const uniforms = useDerivedValue(() => ({
    center: [half, half],
    cell: BURST.cell,
    p: p.value,
    r0: BURST.from,
    r1: BURST.to,
    ring: BURST.ring,
    density: BURST.density,
    ink: INK,
  }));

  if (!source || !play) return null;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width: size, height: size }, style]}
    >
      <Canvas style={{ width: size, height: size }}>
        <Fill>
          <Shader source={source} uniforms={uniforms} />
        </Fill>
      </Canvas>
    </View>
  );
}
