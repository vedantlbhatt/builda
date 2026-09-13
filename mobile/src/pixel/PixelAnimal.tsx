import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, View, type StyleProp, type ViewStyle } from 'react-native';

import type { Scheme } from '../theme';
import { ANIMAL_FRAMES, ANIMAL_LABELS, type Animal } from './animals';
import { GRID, type Frame } from './frames';
import {
  CUT,
  MOTION,
  animalTimeline,
  blinkGapMs,
  clampTempo,
  closeEyes,
  initLayers,
  layerFrames,
  stepLayers,
  type Layers,
} from './motion';
import { animalPalette, type AnimalPalette, type InkTone } from './palette';
import { FrameSvg, useReducedMotion } from './PixelSprite';

export { ANIMALS, ANIMAL_LABELS, animalChoices, animalForArchetype, resolveAnimal, type Animal } from './animals';
export { animalPalette } from './palette';

interface AnimalProps {
  animal: Animal;
  /** Requested box size in points. Rendered at the largest whole-pixel scale that fits. */
  size?: number;
  scheme?: Scheme;
  paused?: boolean;
  /** 0.5–2, as `PixelSprite`: shortens every beat. */
  tempo?: number;
  /** Which ink (`palette.ts`): `selected` on an amber tile, `faint` for a carousel neighbour. */
  tone?: InkTone;
  style?: StyleProp<ViewStyle>;
}

/**
 * One of the eight animals, alive.
 *
 * The prop shape is `PixelSprite`'s on purpose — a screen swapping the mascot for an
 * animal should change the tag and the one prop that names the creature, nothing else.
 * The motion is the family's idle and nothing else: the drawn loop (rest, breath, rest,
 * gesture, `ANIMAL_MOTION`) and Bit's blink, the eye holes filled for 120 ms on a random
 * 3–6 s gap. No drift, no scale breath: whole pixels, always.
 *
 * `paused` is OR-ed with the OS reduce-motion setting exactly as the mascot does: a
 * caller can stop an animal, and can never start one against that setting.
 */
export function PixelAnimal({ animal, size = 64, scheme = 'dark', paused = false, tempo, tone = 'rest', style }: AnimalProps) {
  const reduced = useReducedMotion();
  if (paused || reduced) {
    return <AnimalFrameView animal={animal} frame={ANIMAL_FRAMES[animal][0]!} size={size} scheme={scheme} tone={tone} style={style} />;
  }
  return <LiveAnimal animal={animal} size={size} scheme={scheme} tempo={tempo} tone={tone} style={style} />;
}

/** The first frame, static. For list rows, pickers, and anywhere motion would be noise. */
export function PixelAnimalIcon({
  animal,
  size = 24,
  scheme = 'dark',
  tone = 'rest',
  style,
}: {
  animal: Animal;
  size?: number;
  scheme?: Scheme;
  tone?: InkTone;
  style?: StyleProp<ViewStyle>;
}) {
  return <AnimalFrameView animal={animal} frame={ANIMAL_FRAMES[animal][0]!} size={size} scheme={scheme} tone={tone} style={style} />;
}

// ─── the runtime ─────────────────────────────────────────────────────────────────────

const NATIVE = Platform.OS !== 'web';

function timing(value: Animated.Value, toValue: number, duration: number, ease: 'linear' | 'inOut' | 'out') {
  const easing = ease === 'linear' ? Easing.linear : ease === 'out' ? Easing.out(Easing.cubic) : Easing.inOut(Easing.ease);
  return Animated.timing(value, { toValue, duration, easing, useNativeDriver: NATIVE });
}

function LiveAnimal({
  animal,
  size,
  scheme,
  tempo,
  tone,
  style,
}: {
  animal: Animal;
  size: number;
  scheme: Scheme;
  tempo: number | undefined;
  tone: InkTone;
  style?: StyleProp<ViewStyle>;
}) {
  const px = Math.max(1, Math.floor(size / GRID));
  const drawn = px * GRID;
  const palette = useMemo(() => animalPalette(animal, scheme, tone), [animal, scheme, tone]);
  const rate = clampTempo(tempo);
  const frames = ANIMAL_FRAMES[animal];

  const settleScale = useRef(new Animated.Value(MOTION.settle.fromScale)).current;
  const settleOpacity = useRef(new Animated.Value(0)).current;
  const layerA = useRef(new Animated.Value(1)).current;
  const layerB = useRef(new Animated.Value(0)).current;

  const [layers, setLayers] = useState<Layers<Frame>>(() => initLayers(frames[0]!, Date.now()));

  // Same three-layer cross-fade as the mascot: the pixels the two frames AGREE on are
  // drawn once and opaque, and only the difference fades, so a wagging tail never dims
  // the dog (`splitFrames`).
  const drawn3 = useMemo(() => layerFrames(layers), [layers]);
  useEffect(() => {
    const [front, back] = layers.front === 0 ? [layerA, layerB] : [layerB, layerA];
    if (layers.fade.ms <= 0) {
      front.setValue(1);
      back.setValue(0);
      return;
    }
    const anim = Animated.parallel([
      timing(front, 1, layers.fade.ms, layers.fade.easing === 'inOut' ? 'inOut' : 'linear'),
      timing(back, 0, layers.fade.ms, layers.fade.easing === 'inOut' ? 'inOut' : 'linear'),
    ]);
    anim.start();
    return () => anim.stop();
  }, [layers, layerA, layerB]);

  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const anims = new Set<Animated.CompositeAnimation>();
    const run = (anim: Animated.CompositeAnimation) => {
      anims.add(anim);
      anim.start(({ finished }) => {
        if (finished) anims.delete(anim);
      });
    };
    const after = (ms: number, fn: () => void) => {
      const id = setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    };

    // 1. Entrance: the one transform an animal has, and it ends at exactly scale 1.
    setLayers(initLayers(frames[0]!, Date.now()));
    settleOpacity.setValue(0);
    settleScale.setValue(MOTION.settle.fromScale);
    run(
      Animated.parallel([
        timing(settleOpacity, 1, MOTION.settle.ms, 'out'),
        timing(settleScale, 1, MOTION.settle.ms, 'out'),
      ])
    );

    // Blinks derive a frame per source frame, memoised, so the layer scheduler (which
    // compares by identity) sees a blink as one change and its end as one change.
    const closed = new Map<Frame, Frame>();
    const shut = (f: Frame) => {
      let d = closed.get(f);
      if (!d) {
        d = closeEyes(f);
        closed.set(f, d);
      }
      return d;
    };
    let beatFrame = frames[0]!;
    let eyesShut = false;
    const show = (fade = MOTION.crossfade) => {
      const f = eyesShut ? shut(beatFrame) : beatFrame;
      setLayers((l) => stepLayers(l, f, fade, Date.now()));
    };

    // 2. The frame loop: rest, breath, rest, gesture.
    const timeline = animalTimeline(animal, rate);
    if (timeline.length > 1) {
      let i = 0;
      const tick = () => {
        const beat = timeline[i]!;
        beatFrame = frames[beat.frame]!;
        show();
        i = (i + 1) % timeline.length;
        after(beat.ms, tick);
      };
      tick();
    }

    // 3. Blinks: Bit's cadence exactly, a 120 ms cut on a random 3–6 s gap.
    const blink = () =>
      after(blinkGapMs(), () => {
        eyesShut = true;
        show(CUT);
        after(MOTION.blink.closedMs, () => {
          eyesShut = false;
          show(CUT);
          blink();
        });
      });
    blink();

    return () => {
      for (const id of timers) clearTimeout(id);
      for (const a of anims) a.stop();
    };
  }, [animal, rate, frames, settleScale, settleOpacity]);

  const transform = [{ scale: settleScale }];

  return (
    <View
      style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View style={{ width: drawn, height: drawn, opacity: settleOpacity, transform }}>
        <View style={layer}>
          <FrameSvg frame={drawn3.shared} drawn={drawn} palette={palette} />
        </View>
        <Animated.View style={[layer, { opacity: layerA }]}>
          <FrameSvg frame={drawn3.a} drawn={drawn} palette={palette} />
        </Animated.View>
        <Animated.View style={[layer, { opacity: layerB }]}>
          <FrameSvg frame={drawn3.b} drawn={drawn} palette={palette} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const layer = { position: 'absolute', left: 0, top: 0 } as const;

/**
 * A still animal, centred in the requested box.
 *
 * Labelled rather than hidden: unlike the mascot, which never says anything the caption
 * beside it does not, a person's chosen animal IS the information in a picker row.
 */
function AnimalFrameView({
  animal,
  frame,
  size,
  scheme,
  tone,
  style,
}: {
  animal: Animal;
  frame: Frame;
  size: number;
  scheme: Scheme;
  tone: InkTone;
  style?: StyleProp<ViewStyle>;
}) {
  const px = Math.max(1, Math.floor(size / GRID));
  const palette: AnimalPalette = useMemo(() => animalPalette(animal, scheme, tone), [animal, scheme, tone]);
  return (
    <View
      style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}
      accessibilityRole="image"
      accessibilityLabel={ANIMAL_LABELS[animal]}
    >
      <FrameSvg frame={frame} drawn={px * GRID} palette={palette} />
    </View>
  );
}
