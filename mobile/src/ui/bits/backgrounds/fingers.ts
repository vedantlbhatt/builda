/**
 * A finger on a background: a pool that follows it (Dither's mouse hole, Topography's bump,
 * DotGrid's glow) and a ring of four taps (PixelBlast's ripples, DotGrid's shocks).
 *
 * Ported from react-bits `Backgrounds/Dither`, `Backgrounds/PixelBlast`, `Backgrounds/Topography`
 * and `Backgrounds/DotGrid` by David Haz.
 * react-bits is MIT + Commons Clause (Copyright (c) 2026 David Haz): the notice is kept here
 * as the licence asks, and the ports are used as part of this application only; they are not
 * to be redistributed as components.
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
 * What changed in the port: the originals listen to `pointermove` and `pointerdown` on the
 * window; a phone has no hover. The pool is a Gesture Handler Manual gesture that only WATCHES
 * the touch and never activates, so a background inside a ScrollView never steals a scroll (the
 * scroll takes the touch and the pool fades). A tap is a Tap gesture that fails past 12 pt of
 * movement. Neither fires a haptic: a background is not a control (DESIGN-V2 3, rule 10).
 */
import { useMemo } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

import { timing } from '../../motion';
import { NO_TAP, pushTap, type FieldPoint, type Vec } from './spec';
import type { FieldClock } from './useFieldClock';

/** A tap that moves further than this is a scroll or a drag, not a tap. */
export const TAP_SLOP = 12;

export interface FingerPool {
  gesture: ReturnType<typeof Gesture.Manual>;
  x: SharedValue<number>;
  y: SharedValue<number>;
  /** 0..1: eases in when the finger lands and out when it lifts. */
  k: SharedValue<number>;
}

/** A pool under the finger, in points. Off (and never touching `k`) when `enabled` is false. */
export function useFingerPool(enabled: boolean, inMs: number, outMs: number): FingerPool {
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const k = useSharedValue(0);
  const gesture = useMemo(() => {
    const easeIn = timing(inMs);
    const easeOut = timing(outMs);
    return Gesture.Manual()
      .enabled(enabled)
      .onTouchesDown((e) => {
        'worklet';
        const p = e.allTouches[0];
        if (!p) return;
        x.value = p.x;
        y.value = p.y;
        k.value = withTiming(1, easeIn);
      })
      .onTouchesMove((e) => {
        'worklet';
        const p = e.allTouches[0];
        if (!p) return;
        x.value = p.x;
        y.value = p.y;
      })
      .onTouchesUp(() => {
        'worklet';
        k.value = withTiming(0, easeOut);
      })
      .onTouchesCancelled(() => {
        'worklet';
        k.value = withTiming(0, easeOut);
      });
  }, [enabled, inMs, outMs, x, y, k]);
  return { gesture, x, y, k };
}

export interface TapRing {
  gesture: ReturnType<typeof Gesture.Tap>;
  /** Four slots of `[x, y, start, strength]`, oldest overwritten; strength 0 is empty. */
  taps: SharedValue<Vec[]>;
}

/**
 * Taps into a four slot ring, each stamped with the clock's running seconds, keeping the clock
 * publishing `now` for `life` seconds after each so a still field still plays its ripple.
 */
export function useTapRing(o: {
  enabled: boolean;
  clock: FieldClock;
  life: number;
  strength?: number;
  onTap?: (point: FieldPoint) => void;
}): TapRing {
  const taps = useSharedValue<Vec[]>([NO_TAP, NO_TAP, NO_TAP, NO_TAP]);
  const next = useSharedValue(0);
  const { enabled, clock, life, onTap } = o;
  const strength = o.strength ?? 1;
  const { realMs, until } = clock;
  const gesture = useMemo(
    () =>
      Gesture.Tap()
        .enabled(enabled)
        .maxDistance(TAP_SLOP)
        .onStart((e) => {
          'worklet';
          const start = realMs.value / 1000;
          const r = pushTap(taps.value, next.value, e.x, e.y, start, strength);
          taps.value = r.taps;
          next.value = r.next;
          until.value = Math.max(until.value, start + life);
          if (onTap) runOnJS(onTap)({ x: e.x, y: e.y });
        }),
    [enabled, realMs, until, life, strength, onTap, taps, next],
  );
  return { gesture, taps };
}
