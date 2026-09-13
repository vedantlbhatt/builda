import { Canvas, Group, Rect, vec } from '@shopify/react-native-skia';
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Pressable, View, type AccessibilityActionEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  cancelAnimation,
  ReduceMotion,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useDerivedValue,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';

import { ANIMAL_FRAMES, ANIMAL_LABELS, ANIMALS, type Animal } from '../pixel/animals';
import { animalAt, indexOf, litSlot, panTarget } from '../pixel/carousel';
import { GRID } from '../pixel/frames';
import { glyphInk } from '../pixel/palette';
import { PixelAnimal } from '../pixel/PixelAnimal';
import { cellsFor } from '../pixel/PixelSprite';
import { space } from '../theme';
import { select } from '../ui/haptics';
import { SNAP, useReduceMotion } from '../ui/motion';
import { SymbolIcon } from '../ui/Symbol';
import { T } from '../ui/Text';
import { CREATURE, positionLine } from './copy';
import { STAGE_CREATURE } from './flow';

/**
 * The creature picker's stage, shared by onboarding's creature step and `app/icon.tsx`:
 * the chosen creature large and alive in the middle, its neighbours small and still either
 * side, and a finger that moves them (DESIGN-DIRECTION 4, "Your creature").
 *
 * The stage holds ONE number, `position`, in creature units; slot k draws `animalAt(k)` at
 * `(k - position) * pitch` points from the centre. A drag moves that number on the UI thread,
 * a release springs it (`SNAP`, seeded with the finger's velocity) to the slot `panTarget`
 * picks: 30% of the way to a neighbour or an 800pt/s flick moves on. Every slot the centre
 * passes is a `selectionAsync` tick, during the drag and during the spring alike.
 *
 * Only the centre creature animates, and only once it has come to rest. The neighbours are
 * still frames at half size (whole points per cell, so still crisp) in the faint ink: the
 * one-ink rule's tone for a carousel neighbour (`src/pixel/palette.ts`), the text colour at
 * about 40% over the canvas. Amber at 45% opacity is the muddy brown that rule forbids, so
 * the ink never blends: exactly one slot is lit at any moment (`litSlot`, with a little
 * hysteresis so a finger held half way does not flicker it), and the lit slot changes on the
 * same frame as the selection tick. Every creature scales about its feet (row 14 of 16), so
 * the small neighbours stand on the same ground line as the one in the middle.
 *
 * The chevrons under the stage (the caller's) and the VoiceOver adjustable action both move
 * through `step`, the same spring as a swipe.
 *
 * Drawing: every still creature on the stage is one Skia canvas (a few hundred cells as draw
 * calls, placed and inked on the UI thread from `position` and the lit slot). Only the live
 * centre creature is `PixelAnimal`, laid over its still twin once the stage is at rest. As
 * separate SVG views the stage was a few hundred native components, and mounting them stalled
 * the transition that brought the step in.
 */
export interface CreatureCarouselHandle {
  step(by: -1 | 1): void;
}

export interface CreatureCarouselProps {
  /** Where the stage opens. Read once: remount (a new `key`) to open somewhere else. */
  initial: Animal;
  /** The stage's width in points: usually the screen's, so neighbours slide off its edges. */
  width: number;
  /** The centre creature, a multiple of 16. Default `STAGE_CREATURE` (160). */
  size?: number;
  /** Every time the creature under the centre changes, during a drag included. */
  onChange?: (animal: Animal) => void;
  /** When the stage comes to rest on a creature. */
  onSettle?: (animal: Animal) => void;
}

/** Neighbours are drawn at half size: 80pt from a 160pt stage, 5pt per cell. */
const NEIGHBOUR_SCALE = 0.5;
/**
 * The creatures stand on the bottom of row 13 of 16 (the family's baseline): scale about that
 * line. As points, not a percentage: React Native's parser reads "87.5%" as "5%".
 */
const GROUND_ROW = 14 / 16;
/** Creatures either side of the centre that are drawn. */
const REACH = 2;
/** The live creature fades in over its still twin; the twin goes once it is fully there. */
const LIVE_HANDOFF_MS = 260;
/** Room over the creatures inside the stage (the stage is `size + 2 * STAGE_PAD` tall). */
const STAGE_PAD = 8;
const AMBER = glyphInk('dark', 'rest');
const FAINT = glyphInk('dark', 'faint');
/** No slot hidden: the live creature is not over its twin. */
const NONE = -1e9;

export const CreatureCarousel = forwardRef<CreatureCarouselHandle, CreatureCarouselProps>(function CreatureCarousel(
  { initial, width, size = STAGE_CREATURE, onChange, onSettle },
  ref,
) {
  const reduced = useReduceMotion();
  const pitch = Math.round(width * 0.38);
  const start = indexOf(initial);

  const position = useSharedValue(start);
  const lit = useSharedValue(start);
  // The still twin under the live creature, hidden once the live one is fully there (its
  // breath and gesture frames must not show the still frame's cells behind them).
  const hiddenSlot = useSharedValue(NONE);
  const dragFrom = useSharedValue(start);
  const touchX = useSharedValue(0);
  const [centre, setCentre] = useState(start);
  const [moving, setMoving] = useState(false);

  const onChangeRef = useRef(onChange);
  const onSettleRef = useRef(onSettle);
  onChangeRef.current = onChange;
  onSettleRef.current = onSettle;

  const crossed = useCallback((k: number) => {
    select();
    setCentre(k);
    onChangeRef.current?.(animalAt(k));
  }, []);

  const settled = useCallback((k: number) => {
    setMoving(false);
    onSettleRef.current?.(animalAt(k));
  }, []);

  const began = useCallback(() => setMoving(true), []);

  // One lit slot, and a tick for every change of it, whatever is moving the stage: the ink
  // and the haptic change on the same frame.
  useAnimatedReaction(
    () => litSlot(position.value, lit.value),
    (k) => {
      if (k === lit.value) return;
      lit.value = k;
      runOnJS(crossed)(k);
    },
    [crossed],
  );

  const springTo = useCallback(
    (target: number, velocity = 0) => {
      'worklet';
      // Never: Reduce Motion is handled by `step` (a jump); a finger's release always springs.
      position.value = withSpring(target, { ...SNAP, velocity, reduceMotion: ReduceMotion.Never }, (finished) => {
        if (finished) runOnJS(settled)(target);
      });
    },
    [position, settled],
  );

  const step = useCallback(
    (by: -1 | 1) => {
      hiddenSlot.value = NONE;
      began();
      const from = Math.round(position.value);
      if (reduced) {
        position.value = from + by;
        settled(from + by);
        return;
      }
      springTo(from + by);
    },
    [began, position, reduced, settled, springTo, hiddenSlot],
  );

  useImperativeHandle(ref, () => ({ step }), [step]);

  // Memoised: a re-render mid drag (the crossing tick sets state) must not hand the detector a
  // new gesture while a finger is down.
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-8, 8])
        .failOffsetY([-14, 14])
        .onStart((e) => {
          // Grabbed mid spring: start from where it is, not from where it was going. The still
          // twin shows again on this frame; the live creature leaves once React hears of it.
          cancelAnimation(position);
          hiddenSlot.value = NONE;
          dragFrom.value = position.value;
          touchX.value = e.translationX;
          runOnJS(began)();
        })
        .onUpdate((e) => {
          position.value = dragFrom.value - (e.translationX - touchX.value) / pitch;
        })
        .onEnd((e) => {
          const from = Math.round(dragFrom.value);
          const target = panTarget({ from, position: position.value, vx: e.velocityX, pitch });
          springTo(target, -e.velocityX / pitch);
        }),
    [position, dragFrom, touchX, began, pitch, springTo, hiddenSlot],
  );

  const onAccessibilityAction = useCallback(
    (e: AccessibilityActionEvent) => {
      if (e.nativeEvent.actionName === 'increment') step(1);
      if (e.nativeEvent.actionName === 'decrement') step(-1);
    },
    [step],
  );

  const slots: number[] = [];
  for (let k = centre - REACH; k <= centre + REACH; k++) slots.push(k);
  const current = animalAt(centre);
  const live = !moving;
  const left = Math.round((width - size) / 2);

  // The live creature settles in over its still twin, then the twin is hidden.
  useEffect(() => {
    if (!live) {
      hiddenSlot.value = NONE;
      return;
    }
    const t = setTimeout(() => {
      hiddenSlot.value = centre;
    }, LIVE_HANDOFF_MS);
    return () => clearTimeout(t);
  }, [live, centre, hiddenSlot]);

  return (
    <GestureDetector gesture={pan}>
      <View
        style={{ width, height: size + 2 * STAGE_PAD, overflow: 'visible' }}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Creature"
        accessibilityValue={{ text: `${ANIMAL_LABELS[current]}, ${ANIMALS.indexOf(current) + 1} of ${ANIMALS.length}` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={onAccessibilityAction}
      >
        <Canvas pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width, height: size + 2 * STAGE_PAD }}>
          {slots.map((k) => (
            <StillSlot
              key={k}
              k={k}
              position={position}
              lit={lit}
              hiddenSlot={hiddenSlot}
              pitch={pitch}
              size={size}
              left={left}
            />
          ))}
        </Canvas>
        {live && (
          <View pointerEvents="none" style={{ position: 'absolute', left, top: STAGE_PAD }}>
            <PixelAnimal key={centre} animal={current} size={size} />
          </View>
        )}
      </View>
    </GestureDetector>
  );
});

/**
 * One still creature on the stage's canvas: its frame's cells as rectangles, placed at
 * `(k - position) * pitch` and scaled about its feet, in the amber ink while it is the lit
 * slot and the faint one otherwise. A switch, never a blend: any cross fade between the two
 * inks spends its middle in a brown that is neither.
 */
function StillSlot({
  k,
  position,
  lit,
  hiddenSlot,
  pitch,
  size,
  left,
}: {
  k: number;
  position: SharedValue<number>;
  lit: SharedValue<number>;
  hiddenSlot: SharedValue<number>;
  pitch: number;
  size: number;
  left: number;
}) {
  const animal = animalAt(k);
  const px = Math.max(1, Math.floor(size / GRID));
  const cells = useMemo(() => cellsFor(ANIMAL_FRAMES[animal][0]!, { b: AMBER }), [animal]);
  const origin = vec(left + size / 2, STAGE_PAD + size * GROUND_ROW);

  const transform = useDerivedValue(() => {
    const d = k - position.value;
    const s = interpolate(Math.abs(d), [0, 1], [1, NEIGHBOUR_SCALE], Extrapolation.CLAMP);
    return [{ translateX: d * pitch }, { scale: s }];
  });
  const color = useDerivedValue(() => (lit.value === k ? AMBER : FAINT));
  const opacity = useDerivedValue(() => (hiddenSlot.value === k ? 0 : 1));

  return (
    <Group transform={transform} origin={origin} color={color} opacity={opacity}>
      {cells.map((c, i) => (
        <Rect key={i} x={left + c.x * px} y={STAGE_PAD + c.y * px} width={c.w * px} height={px} />
      ))}
    </Group>
  );
}

/**
 * The accessible path under the stage: a chevron either side of "6 of 8". The chevrons are
 * chrome, so SF Symbols in `textDim`, and like bar buttons they dim when pressed. Both move
 * through the stage's own `step`, the same spring and the same tick as a swipe.
 */
export function CreaturePager({
  stage,
  animal,
}: {
  stage: React.RefObject<CreatureCarouselHandle | null>;
  /** Null until the stage knows where it opens: the chevrons are there, the count is not. */
  animal: Animal | null;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.lg }}>
      <PagerChevron dir="left" onPress={() => stage.current?.step(-1)} />
      <T role="meta" tone="dim" style={{ minWidth: 44, textAlign: 'center' }}>
        {animal ? positionLine(ANIMALS.indexOf(animal) + 1, ANIMALS.length) : ' '}
      </T>
      <PagerChevron dir="right" onPress={() => stage.current?.step(1)} />
    </View>
  );
}

function PagerChevron({ dir, onPress }: { dir: 'left' | 'right'; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={dir === 'left' ? CREATURE.previous : CREATURE.next}
      hitSlop={space.sm}
      style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}
    >
      <SymbolIcon name={dir === 'left' ? 'chevron.left' : 'chevron.right'} size={20} weight="semibold" tone="dim" />
    </Pressable>
  );
}
