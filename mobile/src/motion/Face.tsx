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
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';

import type { Animal } from '../pixel/animals';
import { useReduceMotion } from '../ui/motion';
import { blinkCells, blinkGap, cellsPath, faceCells } from './faceModel';
import { BLINK, BREATHE_BACK_MS, BREATHE_OUT_MS } from './spec';
import { SPRING } from './springs';
import { EYES_FOR, stateColor, type FaceState } from './states';

const GRID = 16;
/** Breaths after an arrival or a change of state; then the glow holds still. */
const BREATHS = 3;

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

// No glow by default (2026-09-19, the owner: "no glow, why do you even glow everything").
export function Face({ animal, state, ink, size, glow = false, alive = true, style }: FaceProps) {
  const reduced = useReduceMotion();
  const px = Math.max(1, Math.floor(size / GRID));
  const drawn = px * GRID;
  const eyes = EYES_FOR[state];
  // The body is ONE path (`cellsPath`), and a blink is a second tiny path over the open eye cells
  // whose opacity a shared value flips: no React render per blink. MEASURED (the simulator, Now
  // idle, 20 s): with a Rect per cell and a state change per blink the app sat at 3.8% median
  // with 17% spikes on every blink; the build before the island sat at 0.
  const body = useMemo(() => cellsPath(faceCells(animal, eyes, false)), [animal, eyes]);
  const lids = useMemo(() => cellsPath(blinkCells(eyes)), [eyes]);
  const shut = useSharedValue(0);

  // Blink: a random gap, a short close, and sometimes a second one straight after.
  useEffect(() => {
    if (!alive || reduced || state === 'sleep') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let live = true;
    const close = BLINK.closeMs + BLINK.openMs / 2;
    const schedule = () => {
      timer = setTimeout(() => {
        if (!live) return;
        const twice = Math.random() < BLINK.double;
        shut.value = twice
          ? withSequence(withTiming(1, { duration: 0 }), withDelay(close, withTiming(0, { duration: 0 })), withDelay(BLINK.openMs * 1.6, withTiming(1, { duration: 0 })), withDelay(close, withTiming(0, { duration: 0 })))
          : withSequence(withTiming(1, { duration: 0 }), withDelay(close, withTiming(0, { duration: 0 })));
        schedule();
      }, blinkGap(Math.random(), BLINK.minGapMs, BLINK.maxGapMs));
    };
    schedule();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [alive, reduced, state, shut]);

  const lidStyle = useAnimatedStyle(() => ({ opacity: shut.value }));

  return (
    <View style={[{ width: drawn, height: drawn, alignItems: 'center', justifyContent: 'center' }, style]}>
      {glow ? <Glow color={stateColor(state, ink)} size={drawn} breathe={alive && !reduced && state !== 'sleep'} reduced={reduced} /> : null}
      <Svg width={drawn} height={drawn} viewBox={`0 0 ${GRID} ${GRID}`} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Path d={body} fill={ink} />
      </Svg>
      {alive && lids ? (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, lidStyle]}>
          <Svg width={drawn} height={drawn} viewBox={`0 0 ${GRID} ${GRID}`}>
            <Path d={lids} fill={ink} />
          </Svg>
        </Animated.View>
      ) : null}
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
    // A few breaths after it arrives or changes colour, then rest. MEASURED (2026-09-19, the
    // simulator, Now idle for 20 s): the app sat at 24.5% of a core with every face and shimmer
    // looping forever, against 14.4% for the build before them. An island is a thing that moves
    // when something happens, not a screensaver; the blink keeps it alive for the price of a
    // state change every few seconds.
    breath.value = withRepeat(
      withSequence(
        withTiming(1, { duration: BREATHE_OUT_MS, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: BREATHE_BACK_MS, easing: Easing.inOut(Easing.quad) }),
      ),
      BREATHS,
    );
    return () => cancelAnimation(breath);
  }, [breathe, breath, color]);

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
