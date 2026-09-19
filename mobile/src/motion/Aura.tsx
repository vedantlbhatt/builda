/**
 * The ring around whatever an agent is driving right now. In the clip it circles the window the
 * bot is operating; in Builda it circles the one thing on screen a Claude Code run is touching at
 * this moment: a running session's tile, a drop whose move is running. ONE per screen, because
 * the ring means "this one, now", and two rings mean nothing.
 *
 * ONE HUE, the state's own (`stateColor`): a light travelling round the edge with a tail behind
 * it, over a faint ring in the same colour so the edge is there when the light is on the far side.
 * It was a sweep through four hues first, the clip's iridescent ring; a multi hue ring turning
 * round a card is the most generated looking thing a screen can wear, and in this app a colour
 * already means a state, so four of them at once said four things. Turned once every
 * `AURA_TURN_MS`, three times, then it rests. Slow on purpose: a presence, not a spinner. Under
 * Reduce Motion it stands still.
 */
import { Canvas, RoundedRect, SweepGradient, vec, BlurMask, Group } from '@shopify/react-native-skia';
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { cancelAnimation, Easing, useDerivedValue, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { tokens } from '../generated/tokens';
import { useReduceMotion } from '../ui/motion';
import { AURA_TURN_MS } from './spec';
import { withAlpha } from './states';

/** Where the light sits on the sweep: dark for half the turn, a tail, then the head. */
const STOPS = [0, 0.45, 0.82, 0.985, 1];
/**
 * Turns when it arrives, then the light rests where it began and the faint ring stays. MEASURED
 * (the simulator, Drops idle with one card being built, 20 one second samples of the app's own
 * process): a light turning forever cost 8.5% of a core median, and kept costing it from a tab
 * nobody was looking at, for a move that can wait on the Mac for twenty minutes. The same rule as
 * the face's breath and the shimmer: it moves when something happens, then it holds still.
 */
const TURNS = 3;

export function Aura({
  radius,
  width = 1.5,
  glow = true,
  active = true,
  color = tokens.spectrum.hues.cobalt.dark,
}: {
  radius: number;
  width?: number;
  glow?: boolean;
  active?: boolean;
  /** The state's colour (`stateColor`). Working's cobalt unless told otherwise. */
  color?: string;
}) {
  const reduced = useReduceMotion();
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const turn = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(turn);
    if (!active || reduced) return;
    turn.value = 0;
    turn.value = withRepeat(withTiming(1, { duration: AURA_TURN_MS, easing: Easing.linear }), TURNS);
    return () => cancelAnimation(turn);
  }, [active, reduced, turn]);

  const transform = useDerivedValue(() => [{ rotate: turn.value * Math.PI * 2 }]);
  const onLayout = (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  const ring = useMemo(() => [withAlpha(color, 0), withAlpha(color, 0), withAlpha(color, 0.4), color, withAlpha(color, 0)], [color]);
  const base = useMemo(() => withAlpha(color, 0.16), [color]);

  if (!active) return null;
  const pad = glow ? 8 : 0;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { margin: -pad }]} onLayout={onLayout}>
      {size ? (
        <Canvas style={StyleSheet.absoluteFill}>
          <Group>
            {glow ? (
              <RoundedRect x={pad} y={pad} width={size.w - pad * 2} height={size.h - pad * 2} r={radius} style="stroke" strokeWidth={width * 3} opacity={0.35}>
                <SweepGradient c={vec(size.w / 2, size.h / 2)} colors={ring} positions={STOPS} transform={transform} origin={vec(size.w / 2, size.h / 2)} />
                <BlurMask blur={6} style="normal" />
              </RoundedRect>
            ) : null}
            <RoundedRect x={pad + width / 2} y={pad + width / 2} width={size.w - pad * 2 - width} height={size.h - pad * 2 - width} r={radius} style="stroke" strokeWidth={width} color={base} />
            <RoundedRect x={pad + width / 2} y={pad + width / 2} width={size.w - pad * 2 - width} height={size.h - pad * 2 - width} r={radius} style="stroke" strokeWidth={width}>
              <SweepGradient c={vec(size.w / 2, size.h / 2)} colors={ring} positions={STOPS} transform={transform} origin={vec(size.w / 2, size.h / 2)} />
            </RoundedRect>
          </Group>
        </Canvas>
      ) : null}
    </View>
  );
}
