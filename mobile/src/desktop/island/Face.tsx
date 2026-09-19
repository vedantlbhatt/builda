/**
 * The builder's creature as the island's face: the pixel animal in the colour of its state, with
 * the state machine the notch kit's face has (docs/motion.md 5 and 6), drawn in this app's pixels
 * rather than the kit's sphere.
 *
 *   working / thinking / reading   eyes open, a glow in the state's hue breathing out and back
 *   waiting, error                 the lids down: only the lower row of each eye open (flat lines)
 *   done                           the eyes pushed up: only the upper row open (the arcs)
 *   sleep                          shut, no glow
 *
 * The eyes are the family's holes (`pixel/frames.EYES`), so a state is those eight cells filled
 * or not; a blink fills all eight for 70 ms on a random 1.8 to 5 s timer, a quarter of the time
 * twice. Breath moves the glow only: the pixels never scale (the pixel family's rule 7).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Rect } from 'react-native-svg';

import { ANIMAL_FRAMES, type Animal } from '../../pixel/animals';
import { EYES } from '../../pixel/frames';
import { BLINK, BREATHE_BACK_MS, BREATHE_OUT_MS } from './motion';
import type { FaceState } from './model';
import { stateInk } from './palette';

const GRID = 16;

function inked(animal: Animal): { x: number; y: number }[] {
  const frame = ANIMAL_FRAMES[animal]?.[0] ?? [];
  const out: { x: number; y: number }[] = [];
  frame.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] !== '.') out.push({ x, y });
  });
  return out;
}

function filledEyes(state: FaceState, blinking: boolean): readonly (readonly [number, number])[] {
  if (blinking || state === 'sleep') return EYES;
  if (state === 'waiting' || state === 'error') return EYES.filter(([, y]) => y === 6);
  if (state === 'done') return EYES.filter(([, y]) => y === 7);
  return [];
}

export function Face({ animal, state, size }: { animal: Animal; state: FaceState; size: number }) {
  const ink = stateInk(state);
  const cells = useMemo(() => inked(animal), [animal]);
  const [blinking, setBlinking] = useState(false);
  const glow = useSharedValue(0.35);

  // The breath: out in 1500, back in 1700, so it never locks to anything else on screen.
  useEffect(() => {
    if (state === 'sleep') {
      glow.value = withTiming(0, { duration: 300 });
      return;
    }
    glow.value = withRepeat(
      withSequence(
        withTiming(0.85, { duration: BREATHE_OUT_MS, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.35, { duration: BREATHE_BACK_MS, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
    );
  }, [state, glow]);

  // The blink: a random gap, sometimes twice.
  useEffect(() => {
    if (state === 'sleep') return;
    let timer: ReturnType<typeof setTimeout>;
    let live = true;
    const once = (then: () => void) => {
      setBlinking(true);
      timer = setTimeout(() => {
        setBlinking(false);
        timer = setTimeout(then, BLINK.openMs);
      }, BLINK.closeMs);
    };
    const schedule = () => {
      const gap = BLINK.minGapMs + Math.random() * (BLINK.maxGapMs - BLINK.minGapMs);
      timer = setTimeout(() => {
        if (!live) return;
        once(() => (Math.random() < BLINK.double ? once(schedule) : schedule()));
      }, gap);
    };
    schedule();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [state]);

  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));
  const lids = filledEyes(state, blinking);

  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View
        pointerEvents="none"
        style={[
          { position: 'absolute', left: -size * 0.35, top: -size * 0.35, width: size * 1.7, height: size * 1.7, borderRadius: size, borderCurve: 'continuous', backgroundColor: ink },
          { filter: `blur(${Math.round(size * 0.45)}px)` } as object,
          glowStyle,
        ]}
      />
      <Svg width={size} height={size} viewBox={`0 0 ${GRID} ${GRID}`}>
        {cells.map((c) => (
          <Rect key={`${c.x}.${c.y}`} x={c.x} y={c.y} width={1.02} height={1.02} fill={ink} />
        ))}
        {lids.map(([x, y]) => (
          <Rect key={`lid${x}.${y}`} x={x} y={y} width={1.02} height={1.02} fill={ink} />
        ))}
      </Svg>
    </View>
  );
}
