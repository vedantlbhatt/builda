/**
 * Stack: a pile of cards, the top one follows the finger, leans toward it, and a throw (or a
 * tap) tucks it under the pile. The Wrapped story's stack is `src/wrapped/StoryStack.tsx`
 * (it recycles four slots through fifteen cards on Appllama's tables); this is react-bits'
 * own Stack, for piles of a handful of faces: a share preview's alternates, a stack of badges.
 *
 * Ported from react-bits `Components/Stack/Stack.tsx` by David Haz.
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
 * - Kept: the pile (each card 4 degrees and 6% smaller than the one above, turned about 90%
 *   90%), the drag on an outer layer and the pile on an inner one, perspective 600, and
 *   `sendToBack` moving the card to the bottom while it springs home under the others.
 * - The card follows the finger 1:1 (react-bits' `dragElastic 0.6` fights a thumb), leans at
 *   12 degrees per 100pt instead of 60, and a release is the kit's `SHEET` spring seeded with
 *   the finger's velocity. A flick at 800pt/s sends it back even from a short drag
 *   (react-bits reads distance only, 200px).
 * - `randomRotation` is seeded per card: react-bits draws a new random turn on every render,
 *   so the pile twitched each time it re-rendered and no two screenshots matched.
 * - Four cards are drawn (react-bits draws every one); autoplay is gone (nothing here moves by
 *   itself on a timer); one `selectionAsync` per card sent back; VoiceOver's increment sends
 *   the top card back.
 *
 * Reduce Motion: the card does not follow the finger; a throw or a tap still sends it back,
 * the pile steps without a spring and the new top card fades in over 150ms.
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import { View, type AccessibilityActionEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { select } from '../../haptics';
import { EASE, REDUCED_FADE, SHEET, SNAP, useReduceMotion } from '../../motion';
import { SHAPE } from '../../shape';
import { dragTilt, initialOrder, pilePose, seededTurn, sendsToBack, sendToBack, topOf } from './geometry';
import { STACK } from './spec';

export interface StackCardState {
  /** This card is on top: the one a finger moves. */
  top: boolean;
  /** How far under the top: 0 is the top. */
  depth: number;
}

export interface StackProps {
  count: number;
  renderCard: (index: number, state: StackCardState) => ReactNode;
  /** One card's size. The pile turns past it, so leave room around the stack. */
  width: number;
  height: number;
  /** The card on top when the stack mounts. Default 0. */
  initial?: number;
  /** Points of drag that send the card back. Default 110 (react-bits 200px). */
  sensitivity?: number;
  /** A fixed turn per card, up to 5 degrees either way. Default off. */
  randomRotation?: boolean;
  /** A tap sends the top card back (react-bits `sendToBackOnClick`, on for phones). Default on. */
  sendToBackOnTap?: boolean;
  /** Cards drawn under the top one, plus the top. Default 4. */
  visible?: number;
  /** A new card reached the top. */
  onTopChange?: (index: number) => void;
  /** What VoiceOver reads for the top card. */
  labelFor?: (index: number) => string;
  style?: StyleProp<ViewStyle>;
}

export interface StackHandle {
  /** Send the top card back, as a tap would. */
  next(): void;
}

export const Stack = forwardRef<StackHandle, StackProps>(function Stack(
  {
    count,
    renderCard,
    width,
    height,
    initial = 0,
    sensitivity = STACK.sensitivity,
    randomRotation = false,
    sendToBackOnTap = true,
    visible = STACK.visible,
    onTopChange,
    labelFor,
    style,
  },
  ref,
) {
  const reduce = useReduceMotion();
  const [order, setOrder] = useState(() => initialOrder(count, initial));
  // The card just sent back stays drawn while it tucks, however deep it lands.
  const [leaving, setLeaving] = useState<number | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTopRef = useRef(onTopChange);
  onTopRef.current = onTopChange;
  const orderRef = useRef(order);
  orderRef.current = order;

  const firstCount = useRef(count);
  useEffect(() => {
    if (firstCount.current === count) return;
    firstCount.current = count;
    setOrder(initialOrder(count, initial));
    // A new count is a new pile; `initial` is read once per pile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);
  useEffect(
    () => () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
    },
    [],
  );

  const send = useCallback((id: number) => {
    const o = orderRef.current;
    if (topOf(o) !== id || o.length < 2) return;
    const next = sendToBack(o, id);
    orderRef.current = next;
    setOrder(next);
    select();
    onTopRef.current?.(topOf(next));
    setLeaving(id);
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => setLeaving(null), SHEET.duration + 200);
  }, []);

  const top = topOf(order);
  const next = useCallback(() => {
    if (top >= 0 && order.length > 1) send(top);
  }, [order.length, send, top]);
  useImperativeHandle(ref, () => ({ next }), [next]);

  const onAccessibilityAction = useCallback(
    (e: AccessibilityActionEvent) => {
      if (e.nativeEvent.actionName === 'increment') next();
    },
    [next],
  );

  return (
    <View
      style={[{ width, height }, style]}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={top >= 0 ? labelFor?.(top) : undefined}
      accessibilityValue={top >= 0 ? { text: `${top + 1} of ${count}` } : undefined}
      accessibilityActions={[{ name: 'increment' }]}
      onAccessibilityAction={onAccessibilityAction}
    >
      {order.map((id, z) => {
        const depth = order.length - 1 - z;
        if (depth >= visible && id !== leaving) return null;
        return (
          <StackCard
            key={id}
            id={id}
            z={z}
            depth={depth}
            visible={Math.min(visible, order.length)}
            width={width}
            height={height}
            jitter={randomRotation ? seededTurn(id) : 0}
            reduce={reduce}
            draggable={depth === 0 && order.length > 1}
            sensitivity={sensitivity}
            tapSends={sendToBackOnTap}
            onSend={send}
          >
            {renderCard(id, { top: depth === 0, depth })}
          </StackCard>
        );
      })}
    </View>
  );
});

function StackCard({
  id,
  z,
  depth,
  visible,
  width,
  height,
  jitter,
  reduce,
  draggable,
  sensitivity,
  tapSends,
  onSend,
  children,
}: {
  id: number;
  z: number;
  depth: number;
  visible: number;
  width: number;
  height: number;
  jitter: number;
  reduce: boolean;
  draggable: boolean;
  sensitivity: number;
  tapSends: boolean;
  onSend: (id: number) => void;
  children: ReactNode;
}) {
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const d = useSharedValue(depth);
  const fade = useSharedValue(1);
  const was = useRef(depth);

  useEffect(() => {
    const from = was.current;
    was.current = depth;
    if (reduce) {
      d.value = depth;
      if (depth === 0 && from !== 0) {
        fade.value = 0;
        fade.value = withTiming(1, { duration: REDUCED_FADE, easing: EASE, reduceMotion: ReduceMotion.Never });
      }
      return;
    }
    d.value = withSpring(depth, SHEET);
  }, [depth, reduce, d, fade]);

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .enabled(draggable)
      .minDistance(4)
      .onStart(() => {
        // Grabbed mid flight: from where it is, not where it was going.
        cancelAnimation(x);
        cancelAnimation(y);
        startX.value = x.value;
        startY.value = y.value;
      })
      .onUpdate((e) => {
        if (reduce) return;
        x.value = startX.value + e.translationX;
        y.value = startY.value + e.translationY;
      })
      .onEnd((e) => {
        const r = { dx: e.translationX, dy: e.translationY, vx: e.velocityX, vy: e.velocityY };
        if (sendsToBack(r, sensitivity)) {
          runOnJS(onSend)(id);
          // It tucks under the pile as the order changes; the throw carries it out first.
          x.value = withSpring(0, { ...SHEET, velocity: e.velocityX });
          y.value = withSpring(0, { ...SHEET, velocity: e.velocityY });
          return;
        }
        x.value = withSpring(0, { ...SNAP, velocity: e.velocityX });
        y.value = withSpring(0, { ...SNAP, velocity: e.velocityY });
      });
    const tap = Gesture.Tap()
      .enabled(draggable && tapSends)
      .maxDuration(260)
      .onEnd((_e, ok) => {
        if (ok) runOnJS(onSend)(id);
      });
    return Gesture.Race(pan, tap);
  }, [draggable, tapSends, reduce, sensitivity, onSend, id, x, y, startX, startY]);

  const drag = useAnimatedStyle(() => {
    const t = dragTilt(x.value, y.value);
    return {
      transform: [
        { perspective: STACK.perspective },
        { translateX: x.value },
        { translateY: y.value },
        { rotateX: `${t.rotateX}deg` },
        { rotateY: `${t.rotateY}deg` },
      ],
    };
  });
  const pile = useAnimatedStyle(() => {
    // Past the drawn pile a card sits at the back pose, hidden behind the last drawn one.
    const deep = Math.min(d.value, Math.max(0, visible - 1));
    const p = pilePose(deep, jitter);
    return {
      opacity: (d.value > visible - 0.5 ? 0 : 1) * fade.value,
      transform: [{ rotate: `${p.rotate}deg` }, { scale: p.scale }],
    };
  });

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width, height, zIndex: z }, drag]}>
        <Animated.View
          style={[
            {
              width,
              height,
              borderRadius: SHAPE.wrapped,
              borderCurve: 'continuous',
              overflow: 'hidden',
              transformOrigin: [width * STACK.origin, height * STACK.origin, 0],
            },
            pile,
          ]}
        >
          {children}
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}
