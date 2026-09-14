/**
 * Carousel: slides on a track the finger drags, each neighbour turned away on its vertical
 * axis, a flick or 30% of a slide moving on, with dots under it. The onboarding creature step
 * and the Settings icon picker (DESIGN-V2 4.3, row 19), and any row of a few big choices.
 *
 * Ported from react-bits `Components/Carousel/Carousel.tsx` by David Haz.
 * react-bits is MIT + Commons Clause (Copyright (c) 2026 David Haz): the notice is kept here
 * as the licence asks, and the port is used as part of this application only; it is not to be
 * redistributed as a component.
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy of this
 *   software and associated documentation files (the "Software"), to deal in the Software
 *   without restriction, including without limitation the rights to use, copy, modify,
 *   merge, publish, and distribute the Software as part of an application, website, or
 *   product, subject to the following conditions: The above copyright notice and this
 *   permission notice shall be included in all copies or substantial portions of the
 *   Software. Commons Clause Restriction: You may use this Software, including for any
 *   commercial purpose, so long as you do not sell, sublicense, or redistribute the
 *   components themselves, whether alone, in a bundle, or as a ported version.
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
 *
 * What changed in the port:
 * - Kept: the track the finger drags, `rotateY` from the track's offset under perspective
 *   1000, the 16pt gap, the loop, and the dots (the active one at 1.2x over 0.15s).
 * - The turn is plus or minus 35 degrees and held there (react-bits turns a neighbour 90 per
 *   slide with no clamp, edge on); a neighbour keeps its full ink, pushed back by the turn,
 *   never dimmed (DESIGN-V2 1.3: a hue at partial opacity is brown).
 * - The release is the kit's `SNAP` spring seeded with the finger's velocity (react-bits'
 *   300/30), moving on at 30% of a slide or an 800pt/s flick (react-bits: any drag at all, or
 *   500px/s), rubber banding at a quarter past either end when it does not loop. One
 *   `selectionAsync` each time the active slide changes, on that frame, during a drag as well.
 * - The loop draws only the slides within two of the centre (react-bits clones the ends and
 *   jumps back after each settle, which flashes a frame on a phone). No autoplay: a slide that
 *   moves by itself is a second ambient motion.
 *
 * Reduce Motion: no turn; the dots and VoiceOver's adjust move by a jump; a drag still follows
 * the finger and still settles, because that motion is the finger's own.
 */
import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, View, type AccessibilityActionEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  ReduceMotion,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { space } from '../../../theme';
import { select } from '../../haptics';
import { EASE, SNAP, useReduceMotion } from '../../motion';
import { useColors } from '../../scheme';
import { SHAPE } from '../../shape';
import { activeSlide, carouselTarget, rubberBand, slideTurn, windowSlots, wrapIndex } from './geometry';
import { CAROUSEL } from './spec';

export interface CarouselSlideState {
  /** This slide is the one in the middle. */
  active: boolean;
}

export interface CarouselProps<T> {
  items: readonly T[];
  renderItem: (item: T, index: number, state: CarouselSlideState) => ReactNode;
  keyOf?: (item: T, index: number) => string;
  /** The stage's width. Slides run off both its edges. */
  width: number;
  /** The slide's height (the stage adds the dots under it). */
  height: number;
  /** One slide's width. Default the stage less 32 each side (react-bits `baseWidth - 32`). */
  itemWidth?: number;
  /** Default 16. */
  gap?: number;
  /** Past the last slide comes the first. Default off. */
  loop?: boolean;
  initialIndex?: number;
  /** The active slide changed (during a drag as well). */
  onIndexChange?: (index: number) => void;
  /** The track came to rest on a slide. */
  onSettle?: (index: number) => void;
  /** The dots under the stage. Default on. */
  indicators?: boolean;
  /** A neighbour's turn in degrees. Default 35. */
  rotate?: number;
  /** A neighbour's scale. Default 1 (react-bits'). */
  neighbourScale?: number;
  /** What VoiceOver reads for a slide. */
  labelFor?: (item: T, index: number) => string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export interface CarouselHandle {
  step(by: -1 | 1): void;
  goTo(index: number): void;
}

function CarouselInner<T>(
  {
    items,
    renderItem,
    keyOf,
    width,
    height,
    itemWidth: itemWidthProp,
    gap = CAROUSEL.gap,
    loop = false,
    initialIndex = 0,
    onIndexChange,
    onSettle,
    indicators = true,
    rotate = CAROUSEL.rotateDeg,
    neighbourScale = 1,
    labelFor,
    accessibilityLabel,
    style,
  }: CarouselProps<T>,
  ref: React.ForwardedRef<CarouselHandle>,
) {
  const reduce = useReduceMotion();
  const n = items.length;
  const itemWidth = itemWidthProp ?? Math.max(1, width - 64);
  const pitch = itemWidth + gap;
  const start = n === 0 ? 0 : Math.min(n - 1, Math.max(0, Math.floor(initialIndex)));

  const position = useSharedValue(start);
  const active = useSharedValue(start);
  const dragFrom = useSharedValue(start);
  const [centre, setCentre] = useState(start);
  const onIndexRef = useRef(onIndexChange);
  const onSettleRef = useRef(onSettle);
  onIndexRef.current = onIndexChange;
  onSettleRef.current = onSettle;

  const crossed = useCallback(
    (k: number) => {
      select();
      setCentre(k);
      onIndexRef.current?.(wrapIndex(k, n));
    },
    [n],
  );
  const settled = useCallback((k: number) => onSettleRef.current?.(wrapIndex(k, n)), [n]);

  // One active slide, and one tick each time it changes, whatever moves the track.
  useAnimatedReaction(
    () => activeSlide(position.value, active.value),
    (k) => {
      if (k === active.value) return;
      active.value = k;
      runOnJS(crossed)(k);
    },
    [crossed],
  );

  const springTo = useCallback(
    (target: number, velocity: number) => {
      'worklet';
      // Never: a finger's release always springs (the finger moved it). The Reduce Motion
      // jump for the dots and VoiceOver is in `goTo` and `step`.
      position.value = withSpring(target, { ...SNAP, velocity, reduceMotion: ReduceMotion.Never }, (done) => {
        if (done) runOnJS(settled)(target);
      });
    },
    [position, settled],
  );

  const goTo = useCallback(
    (index: number) => {
      if (n === 0) return;
      const from = Math.round(position.value);
      // The nearest slot that shows `index`: a looping stage goes the short way round.
      let target = loop ? from + (((index - wrapIndex(from, n)) % n) + n) % n : Math.min(n - 1, Math.max(0, index));
      if (loop && target - from > n / 2) target -= n;
      if (reduce) {
        cancelAnimation(position);
        position.value = target;
        settled(target);
        return;
      }
      springTo(target, 0);
    },
    [n, loop, position, reduce, settled, springTo],
  );

  const step = useCallback(
    (by: -1 | 1) => {
      if (n === 0) return;
      const from = Math.round(position.value);
      const to = loop ? from + by : Math.min(n - 1, Math.max(0, from + by));
      if (reduce) {
        cancelAnimation(position);
        position.value = to;
        settled(to);
        return;
      }
      springTo(to, 0);
    },
    [n, loop, position, reduce, settled, springTo],
  );

  useImperativeHandle(ref, () => ({ step, goTo }), [step, goTo]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(n > 1)
        .activeOffsetX([-8, 8])
        .failOffsetY([-14, 14])
        .onStart(() => {
          // Grabbed mid spring: from where it is, not where it was going.
          cancelAnimation(position);
          dragFrom.value = position.value;
        })
        .onUpdate((e) => {
          position.value = rubberBand(dragFrom.value - e.translationX / pitch, n, loop);
        })
        .onEnd((e) => {
          const from = Math.round(dragFrom.value);
          const target = carouselTarget({ from, position: position.value, vx: e.velocityX, pitch, count: n, loop });
          springTo(target, -e.velocityX / pitch);
        }),
    [n, loop, pitch, position, dragFrom, springTo],
  );

  const onAccessibilityAction = useCallback(
    (e: AccessibilityActionEvent) => {
      if (e.nativeEvent.actionName === 'increment') step(1);
      if (e.nativeEvent.actionName === 'decrement') step(-1);
    },
    [step],
  );

  const slots = windowSlots(centre, n, loop);
  const current = wrapIndex(centre, n);
  const left = (width - itemWidth) / 2;
  const currentItem = items[current];

  return (
    <View style={style}>
      <GestureDetector gesture={pan}>
        <View
          style={{ width, height, overflow: 'visible' }}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={accessibilityLabel}
          accessibilityValue={{
            text: `${currentItem !== undefined && labelFor ? `${labelFor(currentItem, current)}, ` : ''}${current + 1} of ${n}`,
          }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={onAccessibilityAction}
        >
          {slots.map((k) => {
            const i = wrapIndex(k, n);
            const item = items[i];
            if (item === undefined) return null;
            return (
              <Slide
                key={k}
                slot={k}
                position={position}
                pitch={pitch}
                left={left}
                width={itemWidth}
                height={height}
                rotate={reduce ? 0 : rotate}
                neighbourScale={neighbourScale}
              >
                {renderItem(item, i, { active: k === centre })}
              </Slide>
            );
          })}
        </View>
      </GestureDetector>
      {indicators && n > 1 ? <Dots count={n} active={current} onPress={goTo} reduce={reduce} keys={keyOf ? items.map(keyOf) : undefined} /> : null}
    </View>
  );
}

/** Generic over the item type; `ref` takes a `CarouselHandle`. */
export const Carousel = forwardRef(CarouselInner) as unknown as <T>(
  props: CarouselProps<T> & { ref?: React.Ref<CarouselHandle> },
) => React.ReactElement | null;

function Slide({
  slot,
  position,
  pitch,
  left,
  width,
  height,
  rotate,
  neighbourScale,
  children,
}: {
  slot: number;
  position: SharedValue<number>;
  pitch: number;
  left: number;
  width: number;
  height: number;
  rotate: number;
  neighbourScale: number;
  children: ReactNode;
}) {
  const place = useAnimatedStyle(() => {
    const off = slot - position.value;
    const near = Math.min(1, Math.abs(off));
    return {
      transform: [
        { perspective: CAROUSEL.perspective },
        { translateX: off * pitch },
        { rotateY: `${slideTurn(position.value, slot, rotate)}deg` },
        { scale: 1 - (1 - neighbourScale) * near },
      ],
    };
  });
  return (
    <Animated.View pointerEvents="box-none" style={[{ position: 'absolute', left, top: 0, width, height }, place]}>
      {children}
    </Animated.View>
  );
}

function Dots({
  count,
  active,
  onPress,
  reduce,
  keys,
}: {
  count: number;
  active: number;
  onPress: (i: number) => void;
  reduce: boolean;
  keys?: string[];
}) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: space.tile }}>
      {Array.from({ length: count }, (_, i) => (
        <Dot key={keys?.[i] ?? i} on={i === active} reduce={reduce} onPress={() => onPress(i)} label={`Go to ${i + 1} of ${count}`} />
      ))}
    </View>
  );
}

function Dot({ on, reduce, onPress, label }: { on: boolean; reduce: boolean; onPress: () => void; label: string }) {
  const c = useColors();
  const s = useSharedValue(on ? CAROUSEL.dotActiveScale : 1);
  React.useEffect(() => {
    const to = on ? CAROUSEL.dotActiveScale : 1;
    s.value = reduce ? to : withTiming(to, { duration: CAROUSEL.dotMs, easing: EASE });
  }, [on, reduce, s]);
  const grow = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      style={{ width: CAROUSEL.dotBox, height: CAROUSEL.dotBox, alignItems: 'center', justifyContent: 'center' }}
    >
      <Animated.View
        style={[
          { width: CAROUSEL.dot, height: CAROUSEL.dot, borderRadius: SHAPE.action, borderCurve: 'continuous', backgroundColor: on ? c.text : c.textFaint },
          grow,
        ]}
      />
    </Pressable>
  );
}
