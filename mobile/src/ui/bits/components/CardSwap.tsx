/**
 * CardSwap: a few card faces fanned up and to the right, and once, the front card drops away
 * while the rest step forward and it slides in at the back. The You page's Wrapped entry
 * (DESIGN-V2 4.3, row 12: three faces, one swap when it first comes into view, then rest; a tap
 * opens Wrapped).
 *
 * Ported from react-bits `Components/CardSwap/CardSwap.tsx` by David Haz.
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
 * - Kept: the diagonal slots (`x = i * distX`, `y = -i * distY`, `z = -i * distX * 1.5`
 *   through perspective 900), the skew, the swap's beats (drop, the rest promoted 0.15s apart,
 *   the dropped card returning to the back slot), and the order rotating front to back.
 * - Distances 60 and 70 become 16 and 18, the skew 6 becomes 2 (DESIGN-V2 4.3), and the depth
 *   is projected into a scale, since React Native has no translateZ (`swapSlot`).
 * - GSAP's `elastic.out(0.6, 0.9)` (a toy's wobble) and 0.8s power tweens become the kit's
 *   `SHEET` spring. The 5s `setInterval` autoplay is gone: one swap when `swapWhen` first turns
 *   true (the entry scrolling into view), then it rests; `interval` brings a repeat back only
 *   when asked. The dropped card is clipped by the box, not thrown 500px over the page.
 *
 * Reduce Motion: a static fan, no swap; the tap still opens.
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, type SharedValue } from 'react-native-reanimated';

import { type HapticKind } from '../../haptics';
import { SHEET, useReduceMotion } from '../../motion';
import { PressableScale } from '../../PressableScale';
import { SHAPE, type ShapeName } from '../../shape';
import { rotateOrder, swapBox, swapSlot, swapTimeline } from './geometry';
import { CARD_SWAP } from './spec';

export interface CardSwapProps {
  /** How many faces. Three on the You page. */
  count: number;
  renderFace: (index: number, state: { front: boolean }) => ReactNode;
  /** One face's size. The fan needs `swapBox` of room; the component takes it. */
  width: number;
  height: number;
  /** Default 16 (react-bits 60). */
  cardDistance?: number;
  /** Default 18 (react-bits 70). */
  verticalDistance?: number;
  /** Degrees of skewY. Default 2 (react-bits 6). */
  skew?: number;
  /** The one swap plays the first time this is true: pass "scrolled into view". Default true. */
  swapWhen?: boolean;
  /** ms from `swapWhen` to the swap, so it is seen. Default 600. */
  swapDelay?: number;
  /** Repeat every this many ms. Default none: one swap, then rest. */
  interval?: number;
  /** From the radius rule. Default `wrapped` (28). */
  shape?: ShapeName;
  onPress?: () => void;
  haptic?: HapticKind;
  /** The face now in front, after a swap. */
  onSwap?: (front: number) => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

export interface CardSwapHandle {
  /** One swap now (ignored mid swap and under Reduce Motion). */
  swap(): void;
}

/** The most faces a fan draws. */
export const MAX_FACES = 5;

interface FaceValues {
  x: SharedValue<number>;
  y: SharedValue<number>;
  s: SharedValue<number>;
}

export const CardSwap = forwardRef<CardSwapHandle, CardSwapProps>(function CardSwap(
  {
    count,
    renderFace,
    width,
    height,
    cardDistance = CARD_SWAP.cardDistance,
    verticalDistance = CARD_SWAP.verticalDistance,
    skew = CARD_SWAP.skew,
    swapWhen = true,
    swapDelay = CARD_SWAP.firstSwapDelayMs,
    interval,
    shape = 'wrapped',
    onPress,
    haptic,
    onSwap,
    accessibilityLabel,
    accessibilityHint,
    style,
  },
  ref,
) {
  const reduce = useReduceMotion();
  // Up to five faces: hooks cannot run in a loop over a changing count, so each face's values
  // come from a fixed bank of five (below). The entry shows three.
  const n = Math.min(MAX_FACES, Math.max(0, Math.floor(count)));
  const [order, setOrder] = useState<number[]>(() => Array.from({ length: n }, (_, i) => i));
  const orderRef = useRef(order);
  orderRef.current = order;
  const busy = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const onSwapRef = useRef(onSwap);
  onSwapRef.current = onSwap;

  const slot = useCallback((i: number) => swapSlot(i, n, cardDistance, verticalDistance), [n, cardDistance, verticalDistance]);
  const box = swapBox(width, height, n);
  // The front slot's top left, inside the box: the fan climbs up and right from it.
  const baseTop = box.height - height;

  const bank: FaceValues[] = [useFace(slot(0)), useFace(slot(1)), useFace(slot(2)), useFace(slot(3)), useFace(slot(4))];

  // A new count is a new fan, at rest.
  useEffect(() => {
    const fresh = Array.from({ length: n }, (_, i) => i);
    setOrder(fresh);
    fresh.forEach((face, i) => {
      const v = bank[face];
      if (!v) return;
      const p = slot(i);
      v.x.value = p.x;
      v.y.value = p.y;
      v.s.value = p.scale;
    });
    // `bank` is stable shared values; `slot` changes with the same inputs listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, cardDistance, verticalDistance]);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
    },
    [],
  );

  const swap = useCallback(() => {
    const o = orderRef.current;
    if (reduce || busy.current || o.length < 2) return;
    busy.current = true;
    const [front, ...rest] = o;
    const tl = swapTimeline();
    const drop = height * CARD_SWAP.drop;
    const fv = bank[front!];
    if (fv) {
      const back = slot(o.length - 1);
      fv.y.value = withSequence(withSpring(slot(0).y + drop, SHEET), withSpring(back.y, SHEET));
      fv.x.value = withDelay(tl.returnMs, withSpring(back.x, SHEET));
      fv.s.value = withDelay(tl.returnMs, withSpring(back.scale, SHEET));
    }
    rest.forEach((face, i) => {
      const v = bank[face];
      if (!v) return;
      const p = slot(i);
      const at = tl.promoteMs(i);
      v.x.value = withDelay(at, withSpring(p.x, SHEET));
      v.y.value = withDelay(at, withSpring(p.y, SHEET));
      v.s.value = withDelay(at, withSpring(p.scale, SHEET));
    });
    // The order flips as the dropped card starts back, so it slides in behind the rest.
    timers.current.push(
      setTimeout(() => {
        const next = rotateOrder(orderRef.current);
        orderRef.current = next;
        setOrder(next);
        onSwapRef.current?.(next[0]!);
      }, tl.returnMs),
      setTimeout(() => {
        busy.current = false;
      }, tl.promoteMs(rest.length) + SHEET.duration),
    );
    // `bank` is stable shared values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce, height, slot]);

  useImperativeHandle(ref, () => ({ swap }), [swap]);

  // The one swap, the first time it is asked for; then an optional repeat.
  const played = useRef(false);
  useEffect(() => {
    if (!swapWhen || played.current || reduce || n < 2) return;
    played.current = true;
    const t = setTimeout(swap, swapDelay);
    timers.current.push(t);
  }, [swapWhen, reduce, n, swap, swapDelay]);
  useEffect(() => {
    if (!interval || reduce || n < 2) return;
    const id = setInterval(swap, Math.max(interval, 1500));
    return () => clearInterval(id);
  }, [interval, reduce, n, swap]);

  const radius = SHAPE[shape];
  const faces = useMemo(() => order.map((face, i) => ({ face, z: n - i, front: i === 0 })), [order, n]);

  const fan = (
    <View style={{ width: box.width, height: box.height, overflow: 'hidden' }}>
      {faces.map(({ face, z, front }) => (
        <Face key={face} values={bank[face]!} z={z} left={0} top={baseTop} width={width} height={height} skew={skew} radius={radius}>
          {renderFace(face, { front })}
        </Face>
      ))}
    </View>
  );

  if (!onPress) {
    return (
      <View style={style} accessible={accessibilityLabel !== undefined} accessibilityLabel={accessibilityLabel}>
        {fan}
      </View>
    );
  }
  return (
    <PressableScale onPress={onPress} haptic={haptic} accessibilityLabel={accessibilityLabel} accessibilityHint={accessibilityHint} style={style}>
      {fan}
    </PressableScale>
  );
});

function useFace(p: { x: number; y: number; scale: number }): FaceValues {
  const x = useSharedValue(p.x);
  const y = useSharedValue(p.y);
  const s = useSharedValue(p.scale);
  return useMemo(() => ({ x, y, s }), [x, y, s]);
}

function Face({
  values,
  z,
  left,
  top,
  width,
  height,
  skew,
  radius,
  children,
}: {
  values: FaceValues;
  z: number;
  left: number;
  top: number;
  width: number;
  height: number;
  skew: number;
  radius: number;
  children: ReactNode;
}) {
  const place = useAnimatedStyle(() => ({
    transform: [{ translateX: values.x.value }, { translateY: values.y.value }, { scale: values.s.value }, { skewY: `${skew}deg` }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', left, top, width, height, zIndex: z, borderRadius: radius, borderCurve: 'continuous', overflow: 'hidden' },
        place,
      ]}
    >
      {children}
    </Animated.View>
  );
}
