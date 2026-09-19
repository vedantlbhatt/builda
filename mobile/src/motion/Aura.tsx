/**
 * The ring around whatever an agent is driving right now. In the clip it circles the window the
 * bot is operating; in Builda it circles the one thing on screen a Claude Code run is touching at
 * this moment: a running session's tile, a drop whose move is running. ONE per screen, because
 * the ring means "this one, now", and two rings mean nothing.
 *
 * A sweep gradient through four cool hues of the spectrum, stroked around a rounded rectangle and
 * turned once every `AURA_TURN_MS`. Slow on purpose: a presence, not a spinner. Under Reduce
 * Motion it stands still.
 */
import { Canvas, RoundedRect, SweepGradient, vec, BlurMask, Group } from '@shopify/react-native-skia';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { cancelAnimation, Easing, useDerivedValue, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { tokens } from '../generated/tokens';
import { useReduceMotion } from '../ui/motion';
import { AURA_TURN_MS } from './spec';

const H = tokens.spectrum.hues;
/** Cool to warm and back, so the seam of the sweep is invisible. */
const RING = [H.cobalt.dark, H.iris.dark, H.orchid.dark, H.tide.dark, H.cobalt.dark];

export function Aura({ radius, width = 1.5, glow = true, active = true }: { radius: number; width?: number; glow?: boolean; active?: boolean }) {
  const reduced = useReduceMotion();
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const turn = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(turn);
    if (!active || reduced) return;
    turn.value = 0;
    turn.value = withRepeat(withTiming(1, { duration: AURA_TURN_MS, easing: Easing.linear }), -1);
    return () => cancelAnimation(turn);
  }, [active, reduced, turn]);

  const transform = useDerivedValue(() => [{ rotate: turn.value * Math.PI * 2 }]);
  const onLayout = (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  if (!active) return null;
  const pad = glow ? 8 : 0;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { margin: -pad }]} onLayout={onLayout}>
      {size ? (
        <Canvas style={StyleSheet.absoluteFill}>
          <Group>
            {glow ? (
              <RoundedRect x={pad} y={pad} width={size.w - pad * 2} height={size.h - pad * 2} r={radius} style="stroke" strokeWidth={width * 3} opacity={0.35}>
                <SweepGradient c={vec(size.w / 2, size.h / 2)} colors={RING} transform={transform} origin={vec(size.w / 2, size.h / 2)} />
                <BlurMask blur={6} style="normal" />
              </RoundedRect>
            ) : null}
            <RoundedRect x={pad + width / 2} y={pad + width / 2} width={size.w - pad * 2 - width} height={size.h - pad * 2 - width} r={radius} style="stroke" strokeWidth={width}>
              <SweepGradient c={vec(size.w / 2, size.h / 2)} colors={RING} transform={transform} origin={vec(size.w / 2, size.h / 2)} />
            </RoundedRect>
          </Group>
        </Canvas>
      ) : null}
    </View>
  );
}
