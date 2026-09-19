/**
 * The creature as the island's character: its pixels, its eyes in the state's shape, and a soft
 * glow behind it in the state's colour.
 *
 * What it took from the notch kit's face (docs/motion.md): the state machine. The glow springs
 * from one state's colour to the next (two layers crossing on `CONTENT`, so the change is itself
 * an animation), the eyes change shape, the glow breathes on 1500 / 1700 ms and the eyes blink on
 * a random 1.8 to 5 s timer with a one in four double. What it did NOT take: the sphere, and a
 * breathing scale on the pixels themselves (the pixel family's rule 7 forbids it; the breath is
 * the glow's). Under Reduce Motion nothing loops and the colour cuts.
 */
import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Rect, Stop, Circle } from 'react-native-svg';

import type { Animal } from '../pixel/animals';
import { useReduceMotion } from '../ui/motion';
import { blinkGap, faceCells } from './faceModel';
import { BLINK, BREATHE_BACK_MS, BREATHE_OUT_MS } from './spec';
import { SPRING } from './springs';
import { EYES_FOR, stateColor, type FaceState } from './states';

const GRID = 16;

export interface FaceProps {
  animal: Animal;
  state: FaceState;
  /** The creature's own ink (its identity hue); the glow is the STATE's colour. */
  ink: string;
  /** Snapped down to whole points per cell so pixels stay square. */
  size: number;
  /** Draw the glow. Off where the face sits on something that already carries the state. */
  glow?: boolean;
  /** Blink and breathe. Off for a face in a list, where twenty blinking creatures is noise. */
  alive?: boolean;
  style?: ViewStyle;
}

export function Face({ animal, state, ink, size, glow = true, alive = true, style }: FaceProps) {
  const reduced = useReduceMotion();
  const px = Math.max(1, Math.floor(size / GRID));
  const drawn = px * GRID;
  const [blinking, setBlinking] = useState(false);
  const cells = useMemo(() => faceCells(animal, EYES_FOR[state], blinking), [animal, state, blinking]);

  // Blink: a random gap, a short close, and sometimes a second one straight after.
  useEffect(() => {
    if (!alive || reduced || state === 'sleep') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let live = true;
    const schedule = () => {
      timer = setTimeout(() => {
        if (!live) return;
        const twice = Math.random() < BLINK.double;
        setBlinking(true);
        timer = setTimeout(() => {
          if (!live) return;
          setBlinking(false);
          if (twice) {
            timer = setTimeout(() => {
              if (!live) return;
              setBlinking(true);
              timer = setTimeout(() => {
                if (!live) return;
                setBlinking(false);
                schedule();
              }, BLINK.closeMs + BLINK.openMs / 2);
            }, BLINK.openMs * 1.6);
          } else schedule();
        }, BLINK.closeMs + BLINK.openMs / 2);
      }, blinkGap(Math.random(), BLINK.minGapMs, BLINK.maxGapMs));
    };
    schedule();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [alive, reduced, state]);

  return (
    <View style={[{ width: drawn, height: drawn, alignItems: 'center', justifyContent: 'center' }, style]}>
      {glow ? <Glow color={stateColor(state, ink)} size={drawn} breathe={alive && !reduced && state !== 'sleep'} reduced={reduced} /> : null}
      <Svg width={drawn} height={drawn} viewBox={`0 0 ${GRID} ${GRID}`} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {cells.map((c) => (
          <Rect key={`${c.x}.${c.y}`} x={c.x} y={c.y} width={1.02} height={1.02} fill={ink} />
        ))}
      </Svg>
    </View>
  );
}

/**
 * The glow: two layers, the colour it was and the colour it is, crossing on the content spring.
 * A radial gradient rather than a shadow, because Android draws no coloured shadow at all and the
 * glow is the state, not decoration.
 */
function Glow({ color, size, breathe, reduced }: { color: string; size: number; breathe: boolean; reduced: boolean }) {
  const [pair, setPair] = useState<{ from: string; to: string; n: number }>({ from: color, to: color, n: 0 });
  // Gradient ids are document wide on the web; React's id has colons, which `url(#...)` refuses.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  // `mix` 1 means the old colour is gone. The NEW colour is the bottom layer at full strength and
  // the old one lies on top fading out, so a frame where the two updates land apart can only ever
  // show the destination, never a flash of something else.
  const mix = useSharedValue(1);
  const breath = useSharedValue(0);
  const first = useRef(true);

  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setPair((p) => ({ from: p.to, to: color, n: p.n + 1 }));
    mix.value = 0;
    mix.value = reduced ? 1 : withSpring(1, SPRING.content);
  }, [color, mix, reduced]);

  useEffect(() => {
    if (!breathe) {
      cancelAnimation(breath);
      breath.value = withTiming(0, { duration: 300 });
      return;
    }
    breath.value = withRepeat(
      withSequence(
        withTiming(1, { duration: BREATHE_OUT_MS, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: BREATHE_BACK_MS, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
    );
    return () => cancelAnimation(breath);
  }, [breathe, breath]);

  const box = size * 2.2;
  const outer = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + breath.value * 0.08 }],
    opacity: 0.85 + breath.value * 0.15,
  }));
  const fromStyle = useAnimatedStyle(() => ({ opacity: 1 - mix.value }));

  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: box, height: box }, outer]}>
      <View style={StyleSheet.absoluteFill}>
        <GlowDisc color={pair.to} size={box} id={`g${uid}${pair.n}b`} />
      </View>
      <Animated.View style={[StyleSheet.absoluteFill, fromStyle]}>
        <GlowDisc color={pair.from} size={box} id={`g${uid}${pair.n}a`} />
      </Animated.View>
    </Animated.View>
  );
}

function GlowDisc({ color, size, id }: { color: string; size: number; id: string }) {
  return (
    <Svg width={size} height={size}>
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color} stopOpacity={0.42} />
          <Stop offset="0.45" stopColor={color} stopOpacity={0.16} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
    </Svg>
  );
}
